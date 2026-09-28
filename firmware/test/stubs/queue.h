#pragma once
#include "FreeRTOS.h"
#include <deque>
#include <vector>
#include <cstring>

// Signals the test harness that the task under test has drained everything
// and would now block forever on portMAX_DELAY.
struct TestQueueEmpty {};

struct FakeQueue {
    size_t item_size;
    size_t capacity;
    std::deque<std::vector<uint8_t>> items;
    bool throw_when_empty = false;   // set on the queue the task blocks on
};
typedef FakeQueue* QueueHandle_t;

inline QueueHandle_t xQueueCreate(size_t len, size_t item_size) {
    return new FakeQueue{item_size, len, {}, false};
}
inline BaseType_t xQueueSend(QueueHandle_t q, const void *item, TickType_t) {
    if (q->items.size() >= q->capacity) return pdFALSE;
    std::vector<uint8_t> v(q->item_size);
    memcpy(v.data(), item, q->item_size);
    q->items.push_back(std::move(v));
    return pdTRUE;
}
inline BaseType_t xQueueSendFromISR(QueueHandle_t q, const void *item, BaseType_t *woken) {
    if (woken) *woken = pdFALSE;
    return xQueueSend(q, item, 0);
}
inline BaseType_t xQueueReceive(QueueHandle_t q, void *dst, TickType_t ticks) {
    if (q->items.empty()) {
        if (q->throw_when_empty && ticks == portMAX_DELAY) throw TestQueueEmpty{};
        return pdFALSE;
    }
    memcpy(dst, q->items.front().data(), q->item_size);
    q->items.pop_front();
    return pdTRUE;
}
