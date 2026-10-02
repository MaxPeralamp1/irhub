#include "mqtt_manager.h"
#include "json_helper.h"
#include "net_config.h"
#include "ble_provision.h"

#include "pico/cyw43_arch.h"
#include "lwip/apps/mqtt.h"
#include "lwip/ip_addr.h"
#include "lwip/dns.h"

#include <cstdio>
#include <cstring>

namespace mqtt_manager {

namespace {

using net_config::NetConfig;
using ble_provision::State;
using ble_provision::Source;

static mqtt_client_t *s_client = nullptr;
static ip_addr_t s_broker_addr;
static volatile bool s_wifi_up = false;
static volatile bool s_mqtt_up = false;
//Last status from mqtt_connection_cb, or -1 while a connect is pending.
static volatile int s_mqtt_status = -1;

static char s_rx_topic[64];
static char s_rx_payload[MQTT_MAX_PAYLOAD_LEN];
static size_t s_rx_payload_len = 0;

//IrMessage is ~1.6KB at IR_MAX_PULSES=800, too much to put on the cyw43
//task's stack (CYW43_TASK_STACK_SIZE=4096 words, shared by lwIP and BTstack
//callbacks) or to duplicate on this task's stack, so both directions use
//static storage.
static IrMessage s_rx_msg;
static IrMessage s_learned;

//Settings the hub runs on (from flash, build defaults, or a successful
//provision), and settings just received over BLE that are still on trial.
static NetConfig s_active;
static bool s_have_active = false;
static Source s_active_source = Source::Stored;
static NetConfig s_candidate;
//The network Wi-Fi is currently joined to, so a switch of SSID forces a
//rejoin while a broker-only change does not.
static NetConfig s_joined;

//NetworkTask notification bits (NET_EVT_*) received but not yet handled.
static uint32_t s_events = 0;
constexpr uint32_t NET_EVT_INTERRUPT = NET_EVT_COMMIT | NET_EVT_FORGET;

enum class Attempt { Ok, Failed, Aborted };
enum class Outcome { Online, WifiFailed, MqttFailed, Aborted };

//MQTT incoming publish handlers

static void mqtt_incoming_publish_cb(void *arg, const char *topic, u32_t tot_len) {
    (void)arg;
    strncpy(s_rx_topic, topic, sizeof(s_rx_topic) - 1);
    s_rx_topic[sizeof(s_rx_topic) - 1] = '\0';
    s_rx_payload_len = 0;
    (void)tot_len;
}

static void mqtt_incoming_data_cb(void *arg, const u8_t *data, u16_t len, u8_t flags) {
    (void)arg;
    if (s_rx_payload_len + len < sizeof(s_rx_payload)) {
        memcpy(s_rx_payload + s_rx_payload_len, data, len);
        s_rx_payload_len += len;
    }

    if (flags & MQTT_DATA_FLAG_LAST) {
        s_rx_payload[s_rx_payload_len] = '\0';

        if (strcmp(s_rx_topic, MQTT_TOPIC_SEND) == 0) {
            if (!json_helper::decode_ir_message(s_rx_payload, s_rx_payload_len, s_rx_msg)) {
                printf("[mqtt] failed to decode irhub/send payload\n");
            } else if (s_rx_msg.truncated) {
                //More pulses than IR_MAX_PULSES. Transmitting the first 800
                //would be a different command from the one asked for, so
                //refuse rather than blast a partial frame.
                printf("[mqtt] REFUSING irhub/send: payload exceeds %u pulses\n",
                       (unsigned)IR_MAX_PULSES);
            } else {
                xQueueSend(g_mqttToTransmitQueue, &s_rx_msg, pdMS_TO_TICKS(50));
            }
        }
    }
}

static void mqtt_sub_request_cb(void *arg, err_t err) {
    (void)arg;
    printf("[mqtt] subscribe to %s -> %d\n", MQTT_TOPIC_SEND, (int)err);
}

//Runs on the cyw43 task, which also runs BTstack, so it must not block.
static void mqtt_connection_cb(mqtt_client_t *client, void *arg, mqtt_connection_status_t status) {
    (void)arg;
    printf("[mqtt] connection callback fired, status=%d\n", (int)status);
    s_mqtt_status = (int)status;
    if (status == MQTT_CONNECT_ACCEPTED) {
        s_mqtt_up = true;
        printf("[mqtt] connected to broker\n");
        mqtt_set_inpub_callback(client, mqtt_incoming_publish_cb, mqtt_incoming_data_cb, nullptr);
        mqtt_subscribe(client, MQTT_TOPIC_SEND, 1, mqtt_sub_request_cb, nullptr);
        //Queued behind the subscribe; no delay needed between them.
        mqtt_publish(client, MQTT_TOPIC_STATUS, "online", 6, 1, true, nullptr, nullptr);
    } else {
        s_mqtt_up = false;
        printf("[mqtt] disconnected / connect failed, status=%d\n", (int)status);
    }
}

//---- events and status ----

//Every wait in this task goes through here, so an apply or forget from BLE
//interrupts whatever the task is doing. Assumes nothing else uses this
//task's notification slot 0: the SDK's async context notifies only its own
//task and the RP2040 port's sync interop uses an event group (checked
//against SDK 2.3.0).
static uint32_t wait_events(uint32_t ms) {
    uint32_t bits = 0;
    if (xTaskNotifyWait(0, UINT32_MAX, &bits, pdMS_TO_TICKS(ms)) == pdTRUE) {
        s_events |= bits;
    }
    return s_events;
}

static void report(State state, int8_t reason, Source source, uint8_t attempt) {
    if (!ble_provision::is_active()) return;
    ble_provision::Status s{state, reason, {0, 0, 0, 0}, attempt, source};
    if (state == State::Online) {
        const ip4_addr_t *ip = netif_ip4_addr(&cyw43_state.netif[CYW43_ITF_STA]);
        s.ip[0] = ip4_addr1(ip);
        s.ip[1] = ip4_addr2(ip);
        s.ip[2] = ip4_addr3(ip);
        s.ip[3] = ip4_addr4(ip);
    }
    ble_provision::set_status(s);
}

static void start_ble() {
    if (s_have_active) {
        ble_provision::start(s_active);
    } else {
        NetConfig blank{};
        ble_provision::start(blank);
    }
}

//---- Wi-Fi ----

static void wifi_leave() {
    if (cyw43_tcpip_link_status(&cyw43_state, CYW43_ITF_STA) != CYW43_LINK_DOWN) {
        cyw43_wifi_leave(&cyw43_state, CYW43_ITF_STA);
        for (int i = 0; i < 20; i++) {
            if (cyw43_tcpip_link_status(&cyw43_state, CYW43_ITF_STA) <= CYW43_LINK_DOWN) break;
            vTaskDelay(pdMS_TO_TICKS(50));
        }
    }
    s_wifi_up = false;
    memset(&s_joined, 0, sizeof(s_joined));
}

static bool joined_to(const NetConfig &c) {
    return s_wifi_up &&
           cyw43_tcpip_link_status(&cyw43_state, CYW43_ITF_STA) == CYW43_LINK_UP &&
           strcmp(s_joined.ssid, c.ssid) == 0 && strcmp(s_joined.password, c.password) == 0;
}

//The SDK's cyw43_arch_wifi_connect_timeout_ms, made interruptible by
//wait_events and reporting why it failed. reason: 1 no network/timeout,
//2 bad password, 3 other.
static Attempt wifi_join(const NetConfig &c, int8_t &reason) {
    wifi_leave();
    printf("[net] connecting to Wi-Fi SSID '%s'...\n", c.ssid);

    const char *pw = c.password[0] ? c.password : nullptr;
    uint32_t auth = pw ? CYW43_AUTH_WPA2_AES_PSK : CYW43_AUTH_OPEN;
    if (cyw43_arch_wifi_connect_async(c.ssid, pw, auth) != 0) {
        reason = 3;
        return Attempt::Failed;
    }

    absolute_time_t until = make_timeout_time_ms(WIFI_JOIN_TIMEOUT_MS);
    for (;;) {
        int st = cyw43_tcpip_link_status(&cyw43_state, CYW43_ITF_STA);
        if (st == CYW43_LINK_UP) break;
        if (st == CYW43_LINK_BADAUTH) { reason = 2; break; }
        if (st == CYW43_LINK_FAIL) { reason = 3; break; }
        //The AP may just not have answered yet; keep asking until the timeout.
        if (st == CYW43_LINK_NONET && cyw43_arch_wifi_connect_async(c.ssid, pw, auth) != 0) {
            reason = 3;
            break;
        }
        if (time_reached(until)) { reason = 1; break; }
        if (wait_events(100) & NET_EVT_INTERRUPT) {
            wifi_leave();
            return Attempt::Aborted;
        }
    }

    if (cyw43_tcpip_link_status(&cyw43_state, CYW43_ITF_STA) != CYW43_LINK_UP) {
        printf("[net] Wi-Fi connect failed (reason %d)\n", reason);
        wifi_leave();
        return Attempt::Failed;
    }

    cyw43_wifi_pm(&cyw43_state, CYW43_NO_POWERSAVE_MODE);
    s_joined = c;
    s_wifi_up = true;
    printf("[net] Wi-Fi connected, IP %s\n",
           ip4addr_ntoa(netif_ip4_addr(&cyw43_state.netif[CYW43_ITF_STA])));
    return Attempt::Ok;
}

//---- MQTT ----

static void mqtt_abort() {
    s_mqtt_up = false;
    if (s_client == nullptr) return;
    cyw43_arch_lwip_begin();
    mqtt_disconnect(s_client);
    cyw43_arch_lwip_end();
}

static bool mqtt_start(const NetConfig &c) {
    if (!ip4addr_aton(c.broker_host, ip_2_ip4(&s_broker_addr))) {
        printf("[mqtt] broker address '%s' is not an IPv4 address\n", c.broker_host);
        return false;
    }
    IP_SET_TYPE_VAL(s_broker_addr, IPADDR_TYPE_V4);
    printf("[mqtt] broker address configured as: %s : %u\n", c.broker_host, (unsigned)c.broker_port);

    if (s_client == nullptr) {
        s_client = mqtt_client_new();
        configASSERT(s_client != nullptr);
    } else {
        mqtt_abort();
    }

    struct mqtt_connect_client_info_t ci{};
    ci.client_id = MQTT_CLIENT_ID;
    ci.keep_alive = MQTT_KEEPALIVE_S;
    ci.will_topic = MQTT_TOPIC_STATUS;
    ci.will_msg = "offline";
    ci.will_qos = 1;
    ci.will_retain = 1;

    s_mqtt_up = false;
    s_mqtt_status = -1;
    cyw43_arch_lwip_begin();
    err_t err = mqtt_client_connect(
        s_client, &s_broker_addr, c.broker_port,
        mqtt_connection_cb, nullptr, &ci);
    cyw43_arch_lwip_end();

    if (err != ERR_OK) {
        printf("[mqtt] mqtt_client_connect error: %d\n", (int)err);
        return false;
    }
    return true;
}

//reason: 1 timeout, 2 refused by the broker, 3 TCP/connect error.
static Attempt mqtt_wait(int8_t &reason) {
    absolute_time_t until = make_timeout_time_ms(MQTT_CONNECT_TIMEOUT_MS);
    while (!s_mqtt_up) {
        int st = s_mqtt_status;
        if (st > 0) {
            reason = st == MQTT_CONNECT_TIMEOUT ? 1 : st == MQTT_CONNECT_DISCONNECTED ? 3 : 2;
            mqtt_abort();
            return Attempt::Failed;
        }
        if (time_reached(until)) {
            printf("[mqtt] no answer from broker within %d ms\n", MQTT_CONNECT_TIMEOUT_MS);
            reason = 1;
            mqtt_abort();
            return Attempt::Failed;
        }
        if (wait_events(100) & NET_EVT_INTERRUPT) {
            mqtt_abort();
            return Attempt::Aborted;
        }
    }
    return Attempt::Ok;
}

static void publish_learned_signal(const IrMessage &msg) {
    static char payload[MQTT_MAX_PAYLOAD_LEN];
    size_t len = json_helper::encode_ir_message(msg, payload, sizeof(payload));
    if (len == 0) {
        printf("[mqtt] encode failed: %u pulses will not fit in %u bytes\n",
               (unsigned)msg.pulse_count, (unsigned)sizeof(payload));
        return;
    }

    if (xSemaphoreTake(g_mqttPublishMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
        cyw43_arch_lwip_begin();
        err_t err = mqtt_publish(s_client, MQTT_TOPIC_LEARNED, payload, len,
                                  1, false, nullptr, nullptr);
        cyw43_arch_lwip_end();
        xSemaphoreGive(g_mqttPublishMutex);

        if (err != ERR_OK) {
            printf("[mqtt] publish irhub/learned failed: %d\n", (int)err);
        } else {
            printf("[mqtt] published learned signal (%u pulses, %u frame(s)%s)\n",
                   (unsigned)msg.pulse_count,
                   (unsigned)msg.frame_count,
                   msg.truncated ? ", TRUNCATED" : "");
        }
    }
}

//---- bring-up ----

//Joins Wi-Fi (only if not already on c's network), then connects MQTT.
static Outcome bring_up(const NetConfig &c, Source source, uint8_t attempt, int8_t &reason) {
    reason = 0;
    if (!joined_to(c)) {
        report(State::WifiConnecting, 0, source, attempt);
        Attempt a = wifi_join(c, reason);
        if (a == Attempt::Aborted) return Outcome::Aborted;
        if (a == Attempt::Failed) return Outcome::WifiFailed;
    }

    report(State::MqttConnecting, 0, source, attempt);
    if (!mqtt_start(c)) {
        reason = 3;
        return Outcome::MqttFailed;
    }
    Attempt a = mqtt_wait(reason);
    if (a == Attempt::Aborted) return Outcome::Aborted;
    if (a == Attempt::Failed) return Outcome::MqttFailed;
    return Outcome::Online;
}

//Steady state: bridge the capture queue to MQTT and watch the link. Returns
//when the link or broker drops, or an apply/forget arrives.
static void run_online(Source source, bool report_online) {
    if (report_online) report(State::Online, 0, source, 0);

    //BLE was only on to get us here. Keep it long enough for the setup page
    //to see "online", then turn it off.
    TickType_t online_since = xTaskGetTickCount();
    s_events &= ~NET_EVT_BLE_DISCONNECTED;
    int bad_link_count = 0;

    while (s_mqtt_up) {
        if (xQueueReceive(g_captureToMqttQueue, &s_learned, pdMS_TO_TICKS(200)) == pdTRUE) {
            publish_learned_signal(s_learned);
        }

        uint32_t ev = wait_events(0);
        if (ev & NET_EVT_INTERRUPT) return;
        if (ble_provision::is_active()) {
            uint32_t online_ms = (xTaskGetTickCount() - online_since) * portTICK_PERIOD_MS;
            bool client_left = (ev & NET_EVT_BLE_DISCONNECTED) != 0;
            bool grace_over = online_ms >= BLE_OFF_GRACE_MS && !ble_provision::has_central();
            if (client_left || grace_over || online_ms >= BLE_ONLINE_MAX_MS) {
                ble_provision::stop();
            }
        }
        s_events &= ~NET_EVT_BLE_DISCONNECTED;

        cyw43_arch_lwip_begin();
        int link_status = cyw43_wifi_link_status(&cyw43_state, CYW43_ITF_STA);
        cyw43_arch_lwip_end();

        if (link_status != CYW43_LINK_JOIN) { //may need to add CYW43_LINK_UP as an acceptable answer too
            bad_link_count++;
            printf("[net] link_status=%d (bad reading #%d)\n", link_status, bad_link_count);
            if (bad_link_count >= 5) {
                printf("[net] Wi-Fi link genuinely dropped\n");
                s_wifi_up = false;
                s_mqtt_up = false;
                return;
            }
        } else {
            bad_link_count = 0;
        }

        if (!mqtt_client_is_connected(s_client)) {
            //Wi-Fi may well still be up; bring_up() only rejoins if it is not.
            printf("[mqtt] client reports disconnected\n");
            s_mqtt_up = false;
            return;
        }
    }
}

static void load_active() {
    NetConfig c;
    switch (net_config::load(c)) {
        case net_config::Source::Flash:
            s_active = c;
            s_have_active = true;
            s_active_source = Source::Stored;
            break;
        case net_config::Source::BuildDefaults:
            s_active = c;
            s_have_active = true;
            s_active_source = Source::BuildDefaults;
            break;
        case net_config::Source::None:
            memset(&s_active, 0, sizeof(s_active));
            s_have_active = false;
            break;
    }
    memset(&c, 0, sizeof(c));

    if (!s_have_active) {
        printf("[net] waiting for settings over BLE\n");
        start_ble();
        report(State::Unprovisioned, 0, Source::Stored, 0);
    }
}

//Settings arrived over BLE. They replace the working ones only once Wi-Fi
//and MQTT are both up with them, so a typo can never lock the hub out.
static void handle_commit() {
    s_events &= ~NET_EVT_COMMIT;
    if (!ble_provision::take_candidate(s_candidate)) return;

    //An empty password written over BLE means an open network; the page
    //leaves the characteristic unwritten to keep the current one, which
    //ble_provision has already filled in.
    printf("[net] trying new settings: SSID '%s', broker %s:%u\n",
           s_candidate.ssid, s_candidate.broker_host, (unsigned)s_candidate.broker_port);

    int wifi_tries = 0, mqtt_tries = 0;
    for (uint8_t attempt = 1;; attempt++) {
        int8_t reason = 0;
        Outcome o = bring_up(s_candidate, Source::Candidate, attempt, reason);

        if (o == Outcome::Aborted) {
            memset(&s_candidate, 0, sizeof(s_candidate));
            return;
        }

        if (o == Outcome::Online) {
            bool saved = net_config::save(s_candidate);
            s_active = s_candidate;
            s_have_active = true;
            s_active_source = Source::Stored;
            memset(&s_candidate, 0, sizeof(s_candidate));
            if (saved) {
                report(State::Online, 0, Source::Stored, 0);
            } else {
                //Running on the new settings, but they will not survive a reboot.
                report(State::SaveFailed, 0, Source::Candidate, 0);
            }
            run_online(Source::Stored, false);
            return;
        }

        report(o == Outcome::WifiFailed ? State::WifiFailed : State::MqttFailed,
               reason, Source::Candidate, attempt);
        if (o == Outcome::WifiFailed) wifi_tries++; else mqtt_tries++;
        if (wifi_tries >= NET_CANDIDATE_WIFI_TRIES || mqtt_tries >= NET_CANDIDATE_MQTT_TRIES) break;
        if (wait_events(NET_RETRY_DELAY_MS) & NET_EVT_INTERRUPT) {
            memset(&s_candidate, 0, sizeof(s_candidate));
            return;
        }
    }

    memset(&s_candidate, 0, sizeof(s_candidate));
    mqtt_abort();
    printf("[net] new settings failed - reverting\n");
    report(State::Reverted, 0, s_active_source, 0);
    if (!s_have_active) report(State::Unprovisioned, 0, Source::Stored, 0);
}

static void handle_forget() {
    s_events &= ~NET_EVT_FORGET;
    net_config::erase();
    mqtt_abort();
    wifi_leave();
    load_active();
    if (ble_provision::is_active()) start_ble(); //refresh what a client reads back
}

} //namespace

bool is_connected() { return s_wifi_up && s_mqtt_up; }


void task(void *params) {
    (void)params;

    if (cyw43_arch_init()) {
        printf("[net] cyw43_arch_init failed\n");
        vTaskDelete(nullptr);
        return;
    }
    cyw43_arch_enable_sta_mode();
    ble_provision::init(xTaskGetCurrentTaskHandle());
    load_active();

    //Consecutive failures of s_active. Reset whenever it gets online, so a
    //brief outage later never turns BLE on by itself.
    int wifi_fails = 0, mqtt_fails = 0;

    for (;;) {
        if (s_events & NET_EVT_FORGET) {
            handle_forget();
            wifi_fails = mqtt_fails = 0;
            continue;
        }
        if (s_events & NET_EVT_COMMIT) {
            handle_commit();
            wifi_fails = mqtt_fails = 0;
            continue;
        }
        s_events &= ~NET_EVT_BLE_DISCONNECTED;

        if (!s_have_active) {
            wait_events(60000);
            continue;
        }

        int8_t reason = 0;
        uint8_t attempt = (uint8_t)(wifi_fails + mqtt_fails + 1);
        Outcome o = bring_up(s_active, s_active_source, attempt, reason);

        if (o == Outcome::Aborted) continue;
        if (o == Outcome::Online) {
            wifi_fails = mqtt_fails = 0;
            run_online(s_active_source, true);
            if (!(s_events & NET_EVT_INTERRUPT)) {
                printf("[net] connection lost, retrying...\n");
                wait_events(2000);
            }
            continue;
        }

        if (o == Outcome::WifiFailed) wifi_fails++; else mqtt_fails++;
        report(o == Outcome::WifiFailed ? State::WifiFailed : State::MqttFailed,
               reason, s_active_source, attempt);

        if (!ble_provision::is_active() &&
            (wifi_fails >= NET_WIFI_FAILS_BEFORE_BLE || mqtt_fails >= NET_MQTT_FAILS_BEFORE_BLE)) {
            printf("[net] %d Wi-Fi / %d MQTT failures in a row - starting BLE provisioning\n",
                   wifi_fails, mqtt_fails);
            start_ble();
        }
        wait_events(NET_RETRY_DELAY_MS);
    }
}

} //namespace mqtt_manager
