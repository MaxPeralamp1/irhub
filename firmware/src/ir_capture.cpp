#include "ir_capture.h"
#include "hardware/gpio.h"
#include "hardware/timer.h"
#include "pico/time.h"
#include <cstring>

namespace ir_capture {

namespace {

//ouble-buffered so the ISR can keep writing into one buffer while the
//task drains the other without a lock on the hot path.
static volatile uint16_t s_buf[2][IR_MAX_PULSES];
static volatile uint16_t s_count[2] = {0, 0};
static volatile uint8_t  s_active_buf = 0;

static volatile uint64_t s_last_edge_us = 0;
static volatile bool     s_capturing = false;

static SemaphoreHandle_t s_frame_ready_sem = nullptr;
static repeating_timer_t s_idle_timer;
static alarm_pool_t     *s_alarm_pool = nullptr;

//Runs in IRQ context (core 0). Must stay short & ISR-safe.
static void gpio_edge_isr(uint gpio, uint32_t events) {
    if (gpio != IR_RX_PIN) return;

    uint64_t now = time_us_64();
    uint64_t delta = now - s_last_edge_us;
    s_last_edge_us = now;

    uint8_t buf = s_active_buf;

    if (!s_capturing) {
        //First edge of a new transmission: start fresh.
        s_capturing = true;
        s_count[buf] = 0;
        //The first interval isn't meaningful (time since last idle), skip it.
        return;
    }

    if (delta < IR_MIN_PULSE_US) {
        //Glitch filter: too short to be a real mark/space, ignore but keep
        //s_last_edge_us updated (already done above).
        return;
    }

    if (s_count[buf] < IR_MAX_PULSES) {
        s_buf[buf][s_count[buf]] = (delta > 0xFFFF) ? 0xFFFF : (uint16_t)delta;
        s_count[buf]++;
    }
}

//Repeating timer fired every ~2ms from a hardware alarm; detects the idle
//gap that marks "end of transmission" without blocking the ISR.
static bool idle_timeout_cb(repeating_timer_t *rt) {
    if (s_capturing) {
        uint64_t now = time_us_64();
        uint64_t since_last = now - s_last_edge_us;
        if (since_last >= IR_IDLE_TIMEOUT_US) {
            //Freeze the buffer: swap active buffer, hand this one to the task.
            uint8_t finished_buf = s_active_buf;
            s_active_buf ^= 1;
            s_capturing = false;

            BaseType_t higher_prio_woken = pdFALSE;
            //Stash which buffer is ready via count on the *other* index by
            //reusing a simple protocol: task always reads (active_buf ^ 1)
            //right after being signalled, which is exactly finished_buf.
            xSemaphoreGiveFromISR(s_frame_ready_sem, &higher_prio_woken);
            portYIELD_FROM_ISR(higher_prio_woken);
        }
    }
    return true; // keep repeating
}

} //namespace

void init() {
    s_frame_ready_sem = xSemaphoreCreateBinary();
    configASSERT(s_frame_ready_sem != nullptr);

    gpio_init(IR_RX_PIN);
    gpio_set_dir(IR_RX_PIN, GPIO_IN);
    gpio_pull_up(IR_RX_PIN); //VS1838B output is active-low, idle-high

    gpio_set_irq_enabled_with_callback(
        IR_RX_PIN,
        GPIO_IRQ_EDGE_RISE | GPIO_IRQ_EDGE_FALL,
        true,
        &gpio_edge_isr);

    //2ms poll granularity for idle detection is more than adequate given a
    //12ms idle timeout, and keeps ISR/timer overhead low.
    add_repeating_timer_ms(2, idle_timeout_cb, nullptr, &s_idle_timer);

    s_last_edge_us = time_us_64();
}

void task(void *params) {
    (void)params;

    for (;;) {
        if (xSemaphoreTake(s_frame_ready_sem, portMAX_DELAY) == pdTRUE) {
            uint8_t ready_buf = s_active_buf ^ 1; //see idle_timeout_cb comment
            uint16_t n = s_count[ready_buf];
            if (n == 0) continue;

            IrMessage msg;
            msg.carrier_freq = IR_CARRIER_HZ;
            msg.pulse_count = n;
            memcpy(msg.pulses, (const void *)s_buf[ready_buf], n * sizeof(uint16_t));

            //Non-blocking-ish push: drop oldest if the network task is slow.
            if (xQueueSend(g_captureToMqttQueue, &msg, pdMS_TO_TICKS(100)) != pdTRUE) {
                IrMessage discard;
                xQueueReceive(g_captureToMqttQueue, &discard, 0);
                xQueueSend(g_captureToMqttQueue, &msg, 0);
            }
        }
    }
}

} // namespace ir_capture
