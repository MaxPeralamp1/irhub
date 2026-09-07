#pragma once

#include "config.h"

namespace ir_transmit {

//Configures GP14 as a PWM output (carrier generator) but leaves it
//disabled. Call once before starting the scheduler.
void init();

//FreeRTOS task entry point. Blocks on g_mqttToTransmitQueue for incoming
//IrMessage commands (populated by the MQTT subscribe callback on
//irhub/send) and bit-bangs the carrier on/off to reproduce the mark/space
//pattern on IR_TX_PIN via the MOSFET gate.
void task(void *params);

} //namespace ir_transmit
