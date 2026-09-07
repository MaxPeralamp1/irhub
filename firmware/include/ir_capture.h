#pragma once

#include "config.h"

namespace ir_capture {

//Call once from main() before starting the scheduler. Sets up the GPIO
//interrupt on IR_RX_PIN and a repeating alarm used for idle-timeout
//detection.
void init();

//FreeRTOS task entry point. Blocks on a semaphore that is given by the
//idle-timeout alarm once a full pulse train has been captured, then
//packages it as an IrMessage and pushes it to g_captureToMqttQueue.
void task(void *params);

} //namespace ir_capture
