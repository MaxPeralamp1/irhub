#include "ble_provision.h"
#include "config.h"

#include <cstdio>
#include <cstring>

#include "btstack.h"
#include "pico/cyw43_arch.h"

#include "irhub_provision.h" //generated from irhub_provision.gatt: profile_data[], handles

namespace ble_provision {

using net_config::NetConfig;

namespace {

//Handles generated from irhub_provision.gatt.
constexpr uint16_t H_NAME = ATT_CHARACTERISTIC_GAP_DEVICE_NAME_01_VALUE_HANDLE;
constexpr uint16_t H_SSID = ATT_CHARACTERISTIC_be3d7601_0ea0_4e96_82e0_89aa6a3dc19f_01_VALUE_HANDLE;
constexpr uint16_t H_PASS = ATT_CHARACTERISTIC_be3d7602_0ea0_4e96_82e0_89aa6a3dc19f_01_VALUE_HANDLE;
constexpr uint16_t H_STATUS = ATT_CHARACTERISTIC_be3d7603_0ea0_4e96_82e0_89aa6a3dc19f_01_VALUE_HANDLE;
constexpr uint16_t H_STATUS_CCC = ATT_CHARACTERISTIC_be3d7603_0ea0_4e96_82e0_89aa6a3dc19f_01_CLIENT_CONFIGURATION_HANDLE;
constexpr uint16_t H_HOST = ATT_CHARACTERISTIC_be3d7604_0ea0_4e96_82e0_89aa6a3dc19f_01_VALUE_HANDLE;
constexpr uint16_t H_PORT = ATT_CHARACTERISTIC_be3d7605_0ea0_4e96_82e0_89aa6a3dc19f_01_VALUE_HANDLE;
constexpr uint16_t H_CMD = ATT_CHARACTERISTIC_be3d7606_0ea0_4e96_82e0_89aa6a3dc19f_01_VALUE_HANDLE;

constexpr uint8_t CMD_APPLY = 0x01;
constexpr uint8_t CMD_FORGET = 0x02;
constexpr size_t STATUS_LEN = 8;

//Everything below is touched from BTstack callbacks on the cyw43 task, or
//from NetworkTask while it holds the async-context lock (Lock below).

TaskHandle_t s_net_task = nullptr;
volatile bool s_active = false;
volatile hci_con_handle_t s_con = HCI_CON_HANDLE_INVALID;
bool s_subscribed = false;

char s_name[] = BLE_NAME_PREFIX "0000";

//s_current: the settings in use, supplied by start(). s_staged: what the
//connected client has written, seeded from s_current on connect.
//s_handoff: the snapshot passed to NetworkTask on apply.
NetConfig s_current;
NetConfig s_staged;
NetConfig s_handoff;
bool s_handoff_valid = false;

//Latest status (served on read) plus a short queue of notifications still to
//send. A failure followed immediately by Reverted must reach the client as
//two notifications, or the reason is lost.
uint8_t s_status[STATUS_LEN];
constexpr int NOTIFY_QUEUE = 4;
uint8_t s_notify_q[NOTIFY_QUEUE][STATUS_LEN];
int s_notify_head = 0, s_notify_count = 0;

//Prepared (long) write in progress. One characteristic at a time is enough
//for the setup page; a queue that mixes handles is refused at validation.
uint8_t s_prep[net_config::HOST_MAX + 1];
uint16_t s_prep_handle = 0;
uint16_t s_prep_len = 0;
bool s_prep_bad = false;

btstack_packet_callback_registration_t s_hci_reg;
btstack_packet_callback_registration_t s_sm_reg;

//Flags, then the 128-bit service UUID (little-endian) so the setup page can
//filter on it. The name does not fit alongside, so it goes in the scan
//response.
const uint8_t ADV_DATA[] = {
    0x02, BLUETOOTH_DATA_TYPE_FLAGS, 0x06,
    0x11, BLUETOOTH_DATA_TYPE_COMPLETE_LIST_OF_128_BIT_SERVICE_CLASS_UUIDS,
    0x9f, 0xc1, 0x3d, 0x6a, 0xaa, 0x89, 0xe0, 0x82, 0x96, 0x4e, 0xa0, 0x0e, 0x00, 0x76, 0x3d, 0xbe,
};
uint8_t s_scan_rsp[2 + sizeof(s_name) - 1];

struct Lock {
    Lock() { cyw43_arch_lwip_begin(); }
    ~Lock() { cyw43_arch_lwip_end(); }
};

void signal(uint32_t bits) {
    if (s_net_task) xTaskNotify(s_net_task, bits, eSetBits);
}

void reset_prepared() {
    s_prep_handle = 0;
    s_prep_len = 0;
    s_prep_bad = false;
    memset(s_prep, 0, sizeof(s_prep));
}

void wipe(NetConfig &c) {
    //volatile so the compiler cannot drop a clear of a buffer it sees as dead
    volatile uint8_t *p = reinterpret_cast<volatile uint8_t *>(&c);
    for (size_t i = 0; i < sizeof(c); i++) p[i] = 0;
}

void request_notify() {
    if (s_subscribed && s_con != HCI_CON_HANDLE_INVALID && s_notify_count > 0) {
        att_server_request_can_send_now_event(s_con);
    }
}

void push_status(const Status &s) {
    s_status[0] = (uint8_t)s.state;
    s_status[1] = (uint8_t)s.reason;
    memcpy(&s_status[2], s.ip, 4);
    s_status[6] = s.attempt;
    s_status[7] = (uint8_t)s.source;

    if (!s_subscribed) return;
    if (s_notify_count == NOTIFY_QUEUE) {
        //Drop the oldest; the client always gets the latest.
        s_notify_head = (s_notify_head + 1) % NOTIFY_QUEUE;
        s_notify_count--;
    }
    memcpy(s_notify_q[(s_notify_head + s_notify_count) % NOTIFY_QUEUE], s_status, STATUS_LEN);
    s_notify_count++;
    request_notify();
}

size_t field_cap(uint16_t handle) {
    switch (handle) {
        case H_SSID: return net_config::SSID_MAX;
        case H_PASS: return net_config::PASS_MAX;
        case H_HOST: return net_config::HOST_MAX;
        case H_PORT: return 2;
        case H_CMD:  return 1;
        default:     return 0;
    }
}

void set_text(char *dst, size_t dst_size, const uint8_t *data, uint16_t len) {
    memset(dst, 0, dst_size);
    memcpy(dst, data, len);
}

//A complete value for one characteristic, from a plain or a prepared write.
int apply_value(uint16_t handle, const uint8_t *data, uint16_t len) {
    if (len > field_cap(handle)) return ATT_ERROR_INVALID_ATTRIBUTE_VALUE_LENGTH;

    switch (handle) {
        case H_SSID:
            set_text(s_staged.ssid, sizeof(s_staged.ssid), data, len);
            return 0;
        case H_PASS:
            set_text(s_staged.password, sizeof(s_staged.password), data, len);
            return 0;
        case H_HOST:
            set_text(s_staged.broker_host, sizeof(s_staged.broker_host), data, len);
            return 0;
        case H_PORT:
            if (len != 2) return ATT_ERROR_INVALID_ATTRIBUTE_VALUE_LENGTH;
            s_staged.broker_port = little_endian_read_16(data, 0);
            return 0;
        case H_CMD:
            if (len != 1) return ATT_ERROR_INVALID_ATTRIBUTE_VALUE_LENGTH;
            if (data[0] == CMD_APPLY) {
                net_config::Invalid why = net_config::validate(s_staged);
                if (why != net_config::Invalid::Ok) {
                    printf("[ble] apply refused: invalid field %d\n", (int)why);
                    push_status(Status{State::Invalid, (int8_t)why, {0, 0, 0, 0}, 0, Source::Candidate});
                    return ATT_ERROR_VALUE_NOT_ALLOWED;
                }
                s_handoff = s_staged;
                s_handoff_valid = true;
                printf("[ble] apply: SSID '%s', broker %s:%u\n", s_staged.ssid,
                       s_staged.broker_host, (unsigned)s_staged.broker_port);
                signal(NET_EVT_COMMIT);
                return 0;
            }
            if (data[0] == CMD_FORGET) {
                printf("[ble] forget requested\n");
                signal(NET_EVT_FORGET);
                return 0;
            }
            return ATT_ERROR_VALUE_NOT_ALLOWED;
        default:
            return 0;
    }
}

uint16_t att_read_cb(hci_con_handle_t, uint16_t handle, uint16_t offset,
                     uint8_t *buffer, uint16_t buffer_size) {
    switch (handle) {
        case H_NAME:
            return att_read_callback_handle_blob(reinterpret_cast<const uint8_t *>(s_name),
                                                 (uint16_t)strlen(s_name), offset, buffer, buffer_size);
        case H_SSID:
            return att_read_callback_handle_blob(reinterpret_cast<const uint8_t *>(s_staged.ssid),
                                                 (uint16_t)strlen(s_staged.ssid), offset, buffer, buffer_size);
        case H_HOST:
            return att_read_callback_handle_blob(reinterpret_cast<const uint8_t *>(s_staged.broker_host),
                                                 (uint16_t)strlen(s_staged.broker_host), offset, buffer, buffer_size);
        case H_PORT: {
            uint8_t port[2];
            little_endian_store_16(port, 0, s_staged.broker_port);
            return att_read_callback_handle_blob(port, sizeof(port), offset, buffer, buffer_size);
        }
        case H_STATUS:
            return att_read_callback_handle_blob(s_status, STATUS_LEN, offset, buffer, buffer_size);
        default:
            //The password is deliberately absent: it is write-only.
            return 0;
    }
}

int att_write_cb(hci_con_handle_t, uint16_t handle, uint16_t mode, uint16_t offset,
                 uint8_t *buffer, uint16_t size) {
    switch (mode) {
        case ATT_TRANSACTION_MODE_NONE:
            if (handle == H_STATUS_CCC) {
                s_subscribed = little_endian_read_16(buffer, 0) ==
                               GATT_CLIENT_CHARACTERISTICS_CONFIGURATION_NOTIFICATION;
                if (s_subscribed) {
                    //Tell a fresh subscriber where things stand.
                    Status now{(State)s_status[0], (int8_t)s_status[1],
                               {s_status[2], s_status[3], s_status[4], s_status[5]},
                               s_status[6], (Source)s_status[7]};
                    push_status(now);
                }
                return 0;
            }
            return apply_value(handle, buffer, size);

        case ATT_TRANSACTION_MODE_ACTIVE: {
            size_t cap = field_cap(handle);
            if (cap == 0 || handle == H_CMD) return ATT_ERROR_REQUEST_NOT_SUPPORTED;
            if (s_prep_handle != 0 && s_prep_handle != handle) s_prep_bad = true;
            s_prep_handle = handle;
            if ((size_t)offset + size > cap) return ATT_ERROR_INVALID_ATTRIBUTE_VALUE_LENGTH;
            memcpy(s_prep + offset, buffer, size);
            if (offset + size > s_prep_len) s_prep_len = (uint16_t)(offset + size);
            return 0;
        }

        case ATT_TRANSACTION_MODE_VALIDATE:
            return s_prep_bad ? ATT_ERROR_REQUEST_NOT_SUPPORTED : 0;

        case ATT_TRANSACTION_MODE_EXECUTE: {
            int rc = s_prep_handle ? apply_value(s_prep_handle, s_prep, s_prep_len) : 0;
            reset_prepared();
            return rc;
        }

        case ATT_TRANSACTION_MODE_CANCEL:
        default:
            reset_prepared();
            return 0;
    }
}

void att_packet_handler(uint8_t packet_type, uint16_t, uint8_t *packet, uint16_t) {
    if (packet_type != HCI_EVENT_PACKET) return;
    if (hci_event_packet_get_type(packet) != ATT_EVENT_CAN_SEND_NOW) return;
    if (s_notify_count == 0 || s_con == HCI_CON_HANDLE_INVALID) return;

    att_server_notify(s_con, H_STATUS, s_notify_q[s_notify_head], STATUS_LEN);
    s_notify_head = (s_notify_head + 1) % NOTIFY_QUEUE;
    s_notify_count--;
    request_notify();
}

void start_advertising() {
    bd_addr_t addr;
    gap_local_bd_addr(addr);
    snprintf(s_name + strlen(BLE_NAME_PREFIX), 5, "%02X%02X", addr[4], addr[5]);

    s_scan_rsp[0] = (uint8_t)(1 + strlen(s_name));
    s_scan_rsp[1] = BLUETOOTH_DATA_TYPE_COMPLETE_LOCAL_NAME;
    memcpy(&s_scan_rsp[2], s_name, strlen(s_name));

    bd_addr_t null_addr = {0};
    //100-200ms interval: quick to find, still light on the shared radio.
    gap_advertisements_set_params(160, 320, 0, 0, null_addr, 0x07, 0x00);
    gap_advertisements_set_data(sizeof(ADV_DATA), const_cast<uint8_t *>(ADV_DATA));
    gap_scan_response_set_data(sizeof(s_scan_rsp), s_scan_rsp);
    gap_advertisements_enable(1);
    printf("[ble] advertising as %s (%s)\n", s_name, bd_addr_to_str(addr));
}

void hci_packet_handler(uint8_t packet_type, uint16_t, uint8_t *packet, uint16_t) {
    if (packet_type != HCI_EVENT_PACKET) return;

    switch (hci_event_packet_get_type(packet)) {
        case BTSTACK_EVENT_STATE:
            if (btstack_event_state_get_state(packet) == HCI_STATE_WORKING) start_advertising();
            break;

        case HCI_EVENT_META_GAP:
            if (hci_event_gap_meta_get_subevent_code(packet) == GAP_SUBEVENT_LE_CONNECTION_COMPLETE) {
                s_con = gap_subevent_le_connection_complete_get_connection_handle(packet);
                s_staged = s_current;
                s_subscribed = false;
                s_notify_count = 0;
                reset_prepared();
                printf("[ble] client connected\n");
            }
            break;

        case HCI_EVENT_DISCONNECTION_COMPLETE:
            if (s_con == HCI_CON_HANDLE_INVALID) break;
            s_con = HCI_CON_HANDLE_INVALID;
            s_subscribed = false;
            s_notify_count = 0;
            wipe(s_staged);
            reset_prepared();
            printf("[ble] client disconnected\n");
            signal(NET_EVT_BLE_DISCONNECTED);
            break;

        default:
            break;
    }
}

void sm_packet_handler(uint8_t packet_type, uint16_t, uint8_t *packet, uint16_t) {
    if (packet_type != HCI_EVENT_PACKET) return;

    switch (hci_event_packet_get_type(packet)) {
        case SM_EVENT_JUST_WORKS_REQUEST:
            sm_just_works_confirm(sm_event_just_works_request_get_handle(packet));
            break;
        case SM_EVENT_PAIRING_COMPLETE:
            printf("[ble] pairing %s (status 0x%02x)\n",
                   sm_event_pairing_complete_get_status(packet) == ERROR_CODE_SUCCESS ? "ok" : "FAILED",
                   sm_event_pairing_complete_get_status(packet));
            break;
        default:
            break;
    }
}

} //namespace

void init(TaskHandle_t network_task) {
    Lock lock;
    s_net_task = network_task;
    push_status(Status{State::Idle, 0, {0, 0, 0, 0}, 0, Source::Stored});

    l2cap_init();
    sm_init();
    att_server_init(profile_data, att_read_cb, att_write_cb);
    att_server_register_packet_handler(att_packet_handler);

    //LE Secure Connections with Just Works (the hub has no display or
    //keyboard) and no bonding, so a reflash never leaves stale keys behind.
    //Just Works is encrypted but not protected against an active
    //man-in-the-middle.
    sm_set_io_capabilities(IO_CAPABILITY_NO_INPUT_NO_OUTPUT);
    sm_set_authentication_requirements(SM_AUTHREQ_SECURE_CONNECTION);
    sm_set_secure_connections_only_mode(true);

    s_hci_reg.callback = &hci_packet_handler;
    hci_add_event_handler(&s_hci_reg);
    s_sm_reg.callback = &sm_packet_handler;
    sm_add_event_handler(&s_sm_reg);
}

void start(const NetConfig &current) {
    Lock lock;
    s_current = current;
    if (s_active) return;
    s_active = true;
    printf("[ble] powering on for provisioning\n");
    hci_power_control(HCI_POWER_ON);
}

void stop() {
    Lock lock;
    if (!s_active) return;
    s_active = false;
    //Powering off disconnects any client. Clear the connection state here
    //rather than relying on the disconnect event, so it is gone either way.
    hci_power_control(HCI_POWER_OFF);
    s_con = HCI_CON_HANDLE_INVALID;
    s_subscribed = false;
    s_notify_count = 0;
    reset_prepared();
    wipe(s_staged);
    wipe(s_current);
    printf("[ble] powered off\n");
}

bool is_active() { return s_active; }

bool has_central() { return s_con != HCI_CON_HANDLE_INVALID; }

void set_status(const Status &s) {
    Lock lock;
    push_status(s);
}

bool take_candidate(NetConfig &out) {
    Lock lock;
    if (!s_handoff_valid) return false;
    out = s_handoff;
    wipe(s_handoff);
    s_handoff_valid = false;
    return true;
}

} //namespace ble_provision
