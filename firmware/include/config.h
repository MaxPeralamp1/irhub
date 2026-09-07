#pragma once

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
#define IR_MAX_PULSES       400         //max mark/space entries per capture
#define IR_IDLE_TIMEOUT_US  12000       //gap that signals "end of transmission"
#define IR_MIN_PULSE_US     60          //debounce / glitch filter

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
#define TASK_STACK_NETWORK    2048
#define TASK_STACK_CAPTURE    1024
#define TASK_STACK_TRANSMIT   1024

//Payload size limits
#define MQTT_MAX_PAYLOAD_LEN  4096

//Shared RTOS handles (defined in main.cpp)
extern QueueHandle_t g_captureToMqttQueue;   //IRCaptureTask -> NetworkTask (publish irhub/learned)
extern QueueHandle_t g_mqttToTransmitQueue;  //NetworkTask MQTT callback -> IRTransmitTask
extern SemaphoreHandle_t g_mqttPublishMutex; //guards MQTT client publish calls

//Message structure carried on the queues: a decoded IR pulse train
struct IrMessage {
    uint32_t carrier_freq;
    uint16_t pulse_count;
    uint16_t pulses[IR_MAX_PULSES]; //durations in microseconds, alternating mark/space starting with mark
};
