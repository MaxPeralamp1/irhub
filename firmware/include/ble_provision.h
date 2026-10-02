#pragma once

#include <cstdint>

#include "FreeRTOS.h"
#include "task.h"

#include "net_config.h"

//BLE GATT server that receives Wi-Fi and MQTT broker settings.
//
//BTstack runs on the cyw43 async-context task, the same task that runs lwIP
//callbacks. Its callbacks here only touch static buffers and signal
//NetworkTask with xTaskNotify (NET_EVT_* in config.h). Every function below is
//for NetworkTask and takes the async-context lock around its BTstack calls.
namespace ble_provision {

//Wire values of the status characteristic's state byte. Mirrored in app.js.
enum class State : uint8_t {
    Unprovisioned  = 0,
    Idle           = 1,
    WifiConnecting = 2,
    WifiFailed     = 3,  //reason: 1 no network/timeout, 2 bad password, 3 other
    MqttConnecting = 4,
    MqttFailed     = 5,  //reason: 1 timeout, 2 refused, 3 TCP/connect error
    Online         = 6,  //ip is set
    Reverted       = 7,  //new settings failed; back on the previous ones
    Invalid        = 8,  //reason: net_config::Invalid
    SaveFailed     = 9,  //online, but the settings could not be written to flash
};

//Which settings the status refers to.
enum class Source : uint8_t { Stored = 0, Candidate = 1, BuildDefaults = 2 };

struct Status {
    State state;
    int8_t reason;
    uint8_t ip[4];
    uint8_t attempt;
    Source source;
};

//Once, after cyw43_arch_init(). Registers the GATT server; the radio stays off.
void init(TaskHandle_t network_task);

//Power BLE on and advertise. `current` pre-fills what a client reads back
//and is what an apply keeps for any field the client did not write
//(notably the password). Idempotent; calling it again refreshes `current`.
void start(const net_config::NetConfig &current);

//Drop any connection and power BLE off. Idempotent.
void stop();

bool is_active();
bool has_central();

//Store and, if a client is subscribed, notify.
void set_status(const Status &s);

//Copy the settings handed over by the last apply (NET_EVT_COMMIT) and wipe
//the handoff buffer. False if there is nothing to take.
bool take_candidate(net_config::NetConfig &out);

} //namespace ble_provision
