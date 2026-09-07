#include "mqtt_manager.h"
#include "json_helper.h"

#include "pico/cyw43_arch.h"
#include "lwip/apps/mqtt.h"
#include "lwip/ip_addr.h"
#include "lwip/dns.h"

#include <cstdio>
#include <cstring>

namespace mqtt_manager {

namespace {

static mqtt_client_t *s_client = nullptr;
static ip_addr_t s_broker_addr;
static volatile bool s_wifi_up = false;
static volatile bool s_mqtt_up = false;

static char s_rx_topic[64];
static char s_rx_payload[MQTT_MAX_PAYLOAD_LEN];
static size_t s_rx_payload_len = 0;

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
            IrMessage msg{};
            if (json_helper::decode_ir_message(s_rx_payload, s_rx_payload_len, msg)) {
                xQueueSend(g_mqttToTransmitQueue, &msg, pdMS_TO_TICKS(50));
            } else {
                printf("[mqtt] failed to decode irhub/send payload\n");
            }
        }
    }
}

static void mqtt_sub_request_cb(void *arg, err_t err) {
    (void)arg;
    printf("[mqtt] subscribe to %s -> %d\n", MQTT_TOPIC_SEND, (int)err);
}

static void mqtt_connection_cb(mqtt_client_t *client, void *arg, mqtt_connection_status_t status) {
    (void)arg;
    printf("[mqtt] connection callback fired, status=%d\n", (int)status);
    if (status == MQTT_CONNECT_ACCEPTED) {
        s_mqtt_up = true;
        printf("[mqtt] connected to broker\n");
        mqtt_set_inpub_callback(client, mqtt_incoming_publish_cb, mqtt_incoming_data_cb, nullptr);
        mqtt_subscribe(client, MQTT_TOPIC_SEND, 1, mqtt_sub_request_cb, nullptr);

        vTaskDelay(pdMS_TO_TICKS(300));

        mqtt_publish(client, MQTT_TOPIC_STATUS, "online", 6, 1, true, nullptr, nullptr);
    } else {
        s_mqtt_up = false;
        printf("[mqtt] disconnected / connect failed, status=%d\n", (int)status);
    }
}

static bool wifi_connect() {
    cyw43_arch_enable_sta_mode();
    printf("[net] connecting to Wi-Fi SSID '%s'...\n", WIFI_SSID);

    int rc = cyw43_arch_wifi_connect_timeout_ms(
        WIFI_SSID, WIFI_PASSWORD, CYW43_AUTH_WPA2_AES_PSK, 15000);

    if (rc != 0) {
        printf("[net] Wi-Fi connect failed: %d\n", rc);
        return false;
    }

    cyw43_wifi_pm(&cyw43_state, CYW43_NO_POWERSAVE_MODE);
    printf("[net] Wi-Fi connected\n");
    return true;
}

static bool mqtt_start() {
    ip4addr_aton(MQTT_BROKER_IP, &s_broker_addr);
    printf("[mqtt] broker address configured as: %s : %d\n", MQTT_BROKER_IP, MQTT_BROKER_PORT);

    if (s_client == nullptr) {
        s_client = mqtt_client_new();
        configASSERT(s_client != nullptr);
    } else {
        cyw43_arch_lwip_begin();
        mqtt_disconnect(s_client);
        cyw43_arch_lwip_end();
    }

    struct mqtt_connect_client_info_t ci{};
    ci.client_id = MQTT_CLIENT_ID;
    ci.keep_alive = MQTT_KEEPALIVE_S;
    ci.will_topic = MQTT_TOPIC_STATUS;
    ci.will_msg = "offline";
    ci.will_qos = 1;
    ci.will_retain = 1;

    cyw43_arch_lwip_begin();
    err_t err = mqtt_client_connect(
        s_client, &s_broker_addr, MQTT_BROKER_PORT,
        mqtt_connection_cb, nullptr, &ci);
    cyw43_arch_lwip_end();

    if (err != ERR_OK) {
        printf("[mqtt] mqtt_client_connect error: %d\n", (int)err);
        return false;
    }
    return true;
}

static void publish_learned_signal(const IrMessage &msg) {
    static char payload[MQTT_MAX_PAYLOAD_LEN];
    size_t len = json_helper::encode_ir_message(msg, payload, sizeof(payload));
    if (len == 0) {
        printf("[mqtt] encode failed, payload too large (%u pulses)\n", msg.pulse_count);
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
            printf("[mqtt] published learned signal (%u pulses)\n", msg.pulse_count);
        }
    }
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

    for (;;) {
        //(Re)connect Wi-F
        s_wifi_up = wifi_connect();
        if (!s_wifi_up) {
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }

        //(Re)connect MQTT
        s_mqtt_up = false;
        if (!mqtt_start()) {
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }

        //Wait for the connect callback to confirm, with a timeout.
        for (int i = 0; i < 100 && !s_mqtt_up; i++) {
            vTaskDelay(pdMS_TO_TICKS(100));
        }

        //Steady-state loop: bridge capture queue -> publish, monitor link
        while (s_mqtt_up) {
            IrMessage learned;
            if (xQueueReceive(g_captureToMqttQueue, &learned, pdMS_TO_TICKS(200)) == pdTRUE) {
                publish_learned_signal(learned);
            }

            cyw43_arch_lwip_begin();
            int link_status = cyw43_wifi_link_status(&cyw43_state, CYW43_ITF_STA);
            cyw43_arch_lwip_end();

            static int bad_link_count = 0;
            if (link_status != CYW43_LINK_JOIN) {
                bad_link_count++;
                printf("[net] link_status=%d (bad reading #%d)\n", link_status, bad_link_count);
                if (bad_link_count >= 5) {
                    printf("[net] Wi-Fi link genuinely dropped\n");
                    s_wifi_up = false;
                    s_mqtt_up = false;
                    bad_link_count = 0;
                    break;
                }
            } else {
                bad_link_count = 0;
            }

            if (!mqtt_client_is_connected(s_client)) {
                printf("[mqtt] client reports disconnected\n");
                s_wifi_up = false;                
                s_mqtt_up = false;
                break;
            }
        }

        printf("[net] connection lost, retrying...\n");
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

} //namespace mqtt_manager
