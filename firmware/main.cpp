#include <cstdio>

#include "pico/stdlib.h"
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"

#include "config.h"
#include "ir_capture.h"
#include "ir_transmit.h"
#include "mqtt_manager.h"


//Shared RTOS objects (declared extern in config.h)
QueueHandle_t g_captureToMqttQueue = nullptr;
QueueHandle_t g_mqttToTransmitQueue = nullptr;
SemaphoreHandle_t g_mqttPublishMutex = nullptr;

static TaskHandle_t s_networkTaskHandle = nullptr;
static TaskHandle_t s_captureTaskHandle = nullptr;
static TaskHandle_t s_transmitTaskHandle = nullptr;

extern "C" void vAssertCalled(const char *file, int line) {
    printf("FreeRTOS assert failed: %s:%d\n", file, line);
    taskDISABLE_INTERRUPTS();
    for (;;) {}
}

//FreeRTOS hooks required by FreeRTOSConfig.h
extern "C" void vApplicationMallocFailedHook(void) {
    printf("FATAL: FreeRTOS malloc failed\n");
    taskDISABLE_INTERRUPTS();
    for (;;) {}
}

extern "C" void vApplicationStackOverflowHook(TaskHandle_t task, char *name) {
    (void)task;
    printf("FATAL: stack overflow in task '%s'\n", name);
    taskDISABLE_INTERRUPTS();
    for (;;) {}
}

static void network_task_trampoline(void *params) { mqtt_manager::task(params); }
static void capture_task_trampoline(void *params) { ir_capture::task(params); }
static void transmit_task_trampoline(void *params) { ir_transmit::task(params); }

int main() {
    stdio_init_all();
    sleep_ms(1500); //let USB CDC settle so early printf isn't lost

    printf("\n=== IR Hub firmware booting ===\n");

    //RTOS primitives (created before any task starts)
    g_captureToMqttQueue = xQueueCreate(4, sizeof(IrMessage));
    g_mqttToTransmitQueue = xQueueCreate(4, sizeof(IrMessage));
    g_mqttPublishMutex = xSemaphoreCreateMutex();

    configASSERT(g_captureToMqttQueue != nullptr);
    configASSERT(g_mqttToTransmitQueue != nullptr);
    configASSERT(g_mqttPublishMutex != nullptr);

    //Hardware init (ISR wiring, PWM setup) must happen before the
    //corresponding tasks are scheduled
    ir_capture::init();
    ir_transmit::init();

    //Tasks
    xTaskCreate(network_task_trampoline, "NetworkTask", TASK_STACK_NETWORK,
                nullptr, TASK_PRIO_NETWORK, &s_networkTaskHandle);

    xTaskCreate(capture_task_trampoline, "IRCaptureTask", TASK_STACK_CAPTURE,
                nullptr, TASK_PRIO_CAPTURE, &s_captureTaskHandle);

    xTaskCreate(transmit_task_trampoline, "IRTransmitTask", TASK_STACK_TRANSMIT,
                nullptr, TASK_PRIO_TRANSMIT, &s_transmitTaskHandle);

    vTaskStartScheduler();

    // Should never reach here.
    for (;;) {}
    return 0;
}
