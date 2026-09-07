#pragma once

#include "config.h"

namespace mqtt_manager {
void init();
//FreeRTOS task entry point ("NetworkTask"):
//brings up cyw43/Wi-Fi, connects to WIFI_SSID
//connects to the MQTT broker at MQTT_BROKER_IP:MQTT_BROKER_PORT
//subscribes to MQTT_TOPIC_SEND, decodes payloads, pushes to
//g_mqttToTransmitQueue for IRTransmitTask
//drains g_captureToMqttQueue and publishes each entry to
//MQTT_TOPIC_LEARNED
//monitors link/broker state and auto-reconnects on drop
void task(void *params);

//True once Wi-Fi + MQTT are both up. Safe to poll from other tasks/cores.
bool is_connected();

} //namespace mqtt_manager
