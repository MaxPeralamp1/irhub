#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
typedef int BaseType_t;
typedef unsigned int UBaseType_t;
typedef uint32_t TickType_t;
#define pdTRUE  1
#define pdFALSE 0
#define pdPASS  1
#define portMAX_DELAY ((TickType_t)0xFFFFFFFFUL)
#define pdMS_TO_TICKS(ms) ((TickType_t)(ms))
#define tskIDLE_PRIORITY 0
#define configMAX_PRIORITIES 8
#define configASSERT(x) do { if(!(x)) { printf("configASSERT failed: %s\n", #x); abort(); } } while(0)
#define portYIELD_FROM_ISR(x) ((void)(x))
