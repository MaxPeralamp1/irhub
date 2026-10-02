#pragma once

#include "config.h"

namespace mqtt_manager {
void init();
//FreeRTOS task entry point ("NetworkTask"):
//brings up cyw43/Wi-Fi and joins the network from net_config (flash, else
//the -D build defaults), starting BLE provisioning when there are none or
//they keep failing
//connects to the MQTT broker from the same settings
//subscribes to MQTT_TOPIC_SEND, decodes payloads, pushes to
//g_mqttToTransmitQueue for IRTransmitTask
//drains g_captureToMqttQueue and publishes each entry to
//MQTT_TOPIC_LEARNED
//monitors link/broker state and auto-reconnects on drop
void task(void *params);

//True once Wi-Fi + MQTT are both up. Safe to poll from other tasks/cores.
bool is_connected();

} //namespace mqtt_manager
