#pragma once

#include "config.h"

namespace ir_capture {

//Call once from main() before starting the scheduler. Sets up the GPIO
//interrupt on IR_RX_PIN, the ring of capture buffers and the repeating alarm
//used for idle-gap detection.
void init();

//FreeRTOS task entry point. Blocks on a queue of ready buffer indices, posted
//by the idle-gap alarm once a full pulse train has been captured, then
//packages that buffer as an IrMessage and pushes it to g_captureToMqttQueue.
//
//The IrMessage carries frame_count and truncated alongside the pulses, so a
//clipped or multi-frame capture is reported rather than passed off as a clean
//single command.
void task(void *params);

} //namespace ir_capture
