#pragma once


//FreeRTOSConfig.h - Raspberry Pi Pico W (RP2040), single-core scheduler

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif
void vAssertCalled(const char *file, int line);
#ifdef __cplusplus
}
#endif

#define configUSE_16_BIT_TICKS                 0

//Run FreeRTOS pinned to core 0; core 1 left free (SDK/lwIP callbacks etc.)
#define configNUMBER_OF_CORES                  1
#define configUSE_CORE_AFFINITY                0

#define configCPU_CLOCK_HZ                     133000000
#define configTICK_RATE_HZ                     1000
#define configMAX_PRIORITIES                   8
#define configMINIMAL_STACK_SIZE               512
#define configMAX_TASK_NAME_LEN                16
#define configUSE_PREEMPTION                   1
#define configUSE_TIME_SLICING                 1
#define configIDLE_SHOULD_YIELD                1
#define configUSE_MUTEXES                      1
#define configUSE_RECURSIVE_MUTEXES            1
#define configUSE_COUNTING_SEMAPHORES          1
#define configQUEUE_REGISTRY_SIZE              10
#define configUSE_QUEUE_SETS                   1
#define configUSE_TIME_SLICING                 1
#define configUSE_NEWLIB_REENTRANT             0

#define configSUPPORT_STATIC_ALLOCATION         0
#define configSUPPORT_DYNAMIC_ALLOCATION        1
#define configTOTAL_HEAP_SIZE                   (128 * 1024)
#define configAPPLICATION_ALLOCATED_HEAP         0

#define configUSE_IDLE_HOOK                     0
#define configUSE_TICK_HOOK                     0
#define configCHECK_FOR_STACK_OVERFLOW           2
#define configUSE_MALLOC_FAILED_HOOK             1
#define configUSE_DAEMON_TASK_STARTUP_HOOK       0

#define configUSE_TIMERS                        1
#define configTIMER_TASK_PRIORITY               (configMAX_PRIORITIES - 2)
#define configTIMER_QUEUE_LENGTH                 10
#define configTIMER_TASK_STACK_DEPTH             configMINIMAL_STACK_SIZE

#define configGENERATE_RUN_TIME_STATS            0
#define configUSE_TRACE_FACILITY                 1
#define configUSE_STATS_FORMATTING_FUNCTIONS     0

#define configUSE_CO_ROUTINES                    0
#define configMAX_CO_ROUTINE_PRIORITIES          2

//Task priorities used by the application (see include/config.h too)
#define configKERNEL_INTERRUPT_PRIORITY          255
#define configMAX_SYSCALL_INTERRUPT_PRIORITY     (5 << 5)
#define configLIBRARY_LOWEST_INTERRUPT_PRIORITY  15
#define configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY 3

//API set
#define INCLUDE_vTaskPrioritySet                1
#define INCLUDE_uxTaskPriorityGet               1
#define INCLUDE_vTaskDelete                     1
#define INCLUDE_vTaskSuspend                    1
#define INCLUDE_vTaskDelayUntil                 1
#define INCLUDE_vTaskDelay                      1
#define INCLUDE_xTaskGetSchedulerState           1
#define INCLUDE_xTaskGetCurrentTaskHandle         1
#define INCLUDE_uxTaskGetStackHighWaterMark       1
#define INCLUDE_xTaskGetIdleTaskHandle             1
#define INCLUDE_eTaskGetState                      1
#define INCLUDE_xTimerPendFunctionCall             1
#define INCLUDE_xTaskAbortDelay                    1
#define INCLUDE_xQueueGetMutexHolder               1

#define configASSERT(x) if((x)==0) vAssertCalled(__FILE__, __LINE__)

//Required by the RP2040 FreeRTOS port
#define configSUPPORT_PICO_SYNC_INTEROP          1
#define configSUPPORT_PICO_TIME_INTEROP          1
