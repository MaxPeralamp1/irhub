#pragma once

#include <cstdint>

#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"

//Hardware pins
#define IR_RX_PIN          15   // VS1838B OUT -> GP15
#define IR_TX_PIN          14   // MOSFET gate -> GP14

//IR timing
#define IR_CARRIER_HZ       38000
#define IR_DUTY_PERCENT     33          //typical IR LED duty cycle
#define IR_MAX_PULSES       800         //max mark/space entries per capture
#define IR_MIN_PULSE_US     60          //debounce / glitch filter

//Two deliberately different gap thresholds:
//
//  IR_FRAME_GAP_US   - a quiet gap this long ends one *frame*, but not the
//                      capture. The gap itself is still recorded as an
//                      ordinary space; we only count the boundaries so the
//                      UI can say "this looks like 3 frames".
//
//  IR_MESSAGE_GAP_US - a quiet gap this long ends the whole *capture*.
//                      Sized so an air conditioner's two half-frames
//                      (typically 20-40ms apart) stay in a single pulse
//                      train, while NEC auto-repeat frames (~110ms apart)
//                      remain separate captures.
//
//IR_MESSAGE_GAP_US must stay below 65535 so that an inter-frame gap still
//fits in a uint16 pulse entry.
#define IR_FRAME_GAP_US     12000
#define IR_MESSAGE_GAP_US   55000

//Capture buffers in the ring. The edge ISR fills one while IRCaptureTask
//drains others, so frames arriving back-to-back are queued rather than
//overwriting each other.
#define IR_CAPTURE_BUFFERS  2

//MQTT
#define MQTT_CLIENT_ID      "irhub-pico"
#define MQTT_TOPIC_SEND     "irhub/send"      //subscribe: commands to transmit
#define MQTT_TOPIC_LEARNED  "irhub/learned"   //publish: captured raw signals
#define MQTT_TOPIC_STATUS   "irhub/status"    //publish: online/offline (LWT)
#define MQTT_KEEPALIVE_S    30

//Task priorities
//Higher number = higher priority (matches FreeRTOS convention)
#define TASK_PRIO_NETWORK    (tskIDLE_PRIORITY + 3)  //High
#define TASK_PRIO_TRANSMIT   (tskIDLE_PRIORITY + 3)  //High (time critical)
#define TASK_PRIO_CAPTURE    (tskIDLE_PRIORITY + 2)  //Medium

//Task stack sizes (words)
//IrMessage is ~1.6KB at IR_MAX_PULSES=800, so the tasks that handle one keep
//it in static storage rather than on the stack; these sizes leave headroom
//for the lwIP/printf call depth on top of that.
#define TASK_STACK_NETWORK    2048
#define TASK_STACK_CAPTURE    1536
#define TASK_STACK_TRANSMIT   1280

//Payload size limits
//800 pulses at up to 6 characters each ("65535,") plus the JSON envelope.
#define MQTT_MAX_PAYLOAD_LEN  8192

//Shared RTOS handles (defined in main.cpp)
extern QueueHandle_t g_captureToMqttQueue;   //IRCaptureTask -> NetworkTask (publish irhub/learned)
extern QueueHandle_t g_mqttToTransmitQueue;  //NetworkTask MQTT callback -> IRTransmitTask
extern SemaphoreHandle_t g_mqttPublishMutex; //guards MQTT client publish calls

//Message structure carried on the queues: a decoded IR pulse train.
//POD by design - it is memcpy'd in and out of FreeRTOS queues.
struct IrMessage {
    uint32_t carrier_freq;
    uint16_t pulse_count;
    uint16_t frame_count;   //1 for an ordinary single-frame command; >1 means
                            //the train contains gaps of at least
                            //IR_FRAME_GAP_US (an A/C's two halves, or a
                            //button that was held down during learning)
    bool     truncated;     //true if the signal hit IR_MAX_PULSES and was
                            //clipped - the capture is incomplete and will
                            //not reproduce the original command
    uint16_t pulses[IR_MAX_PULSES]; //durations in microseconds, alternating mark/space starting with mark
};
