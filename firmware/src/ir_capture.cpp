#include "ir_capture.h"
#include "hardware/gpio.h"
#include "hardware/timer.h"
#include "pico/time.h"
#include <cstdio>
#include <cstring>

namespace ir_capture {

namespace {

//A ring of capture buffers. The edge ISR fills s_active_buf; when a capture
//ends, that buffer's index is posted to s_ready_queue and the ISR moves on to
//one the task is not holding.
//
//This replaces the previous two-buffer + binary-semaphore handoff. That
//scheme silently lost a frame whenever two completed before IRCaptureTask was
//scheduled: the semaphore is binary, so the second give was swallowed, and
//the task's "read (active ^ 1)" rule then pointed at the newer buffer.
static volatile uint16_t s_buf[IR_CAPTURE_BUFFERS][IR_MAX_PULSES];
static volatile uint16_t s_count[IR_CAPTURE_BUFFERS];
static volatile uint16_t s_frames[IR_CAPTURE_BUFFERS];
static volatile bool     s_trunc[IR_CAPTURE_BUFFERS];

//Set when a buffer is handed to the task, cleared once the task has copied it
//out. The ISR never reuses a buffer that is still flagged.
static volatile bool     s_busy[IR_CAPTURE_BUFFERS];
static volatile uint8_t  s_active_buf = 0;

static volatile uint64_t s_last_edge_us = 0;

//Capture state. DROPPING means a transmission arrived with no free buffer to
//put it in: its edges are swallowed until the next message gap, so the drop
//is counted once per transmission rather than once per edge.
enum : uint8_t { ST_IDLE = 0, ST_CAPTURING = 1, ST_DROPPING = 2 };
static volatile uint8_t s_state = ST_IDLE;

//Captures dropped because every buffer was still in flight. Counted here and
//reported by the task; printf from IRQ context is not safe.
static volatile uint32_t s_dropped = 0;

//Index of a buffer the task is not holding, or `from` itself if there is none.
static inline uint8_t find_free_buf(uint8_t from) {
    if (!s_busy[from]) return from;
    for (uint8_t i = 1; i < IR_CAPTURE_BUFFERS; i++) {
        const uint8_t cand = (uint8_t)((from + i) % IR_CAPTURE_BUFFERS);
        if (!s_busy[cand]) return cand;
    }
    return from;
}

static QueueHandle_t s_ready_queue = nullptr;
static repeating_timer_t s_idle_timer;

//Runs in IRQ context (core 0). Must stay short & ISR-safe.
//
//This and idle_timeout_cb both run at the default NVIC priority, so on
//Cortex-M0+ they cannot preempt one another - which is what makes the
//unguarded s_active_buf read below safe.
static void gpio_edge_isr(uint gpio, uint32_t events) {
    (void)events;
    if (gpio != IR_RX_PIN) return;

    const uint64_t now = time_us_64();
    const uint64_t delta = now - s_last_edge_us;

    if (s_state == ST_DROPPING) {
        //Already decided to discard this transmission; keep the timebase
        //moving so the idle alarm can tell when it has ended.
        s_last_edge_us = now;
        return;
    }

    if (s_state == ST_IDLE) {
        //First edge of a new transmission. The interval since the previous
        //transmission is meaningless (could be hours), so start the timebase
        //here and discard it.
        s_last_edge_us = now;

        const uint8_t buf = find_free_buf(s_active_buf);
        if (s_busy[buf]) {
            //Every buffer is still in flight with the task. Refuse the whole
            //transmission rather than overwrite one that is already queued.
            s_state = ST_DROPPING;
            s_dropped++;
            return;
        }

        s_active_buf = buf;
        s_state = ST_CAPTURING;
        s_count[buf] = 0;
        s_frames[buf] = 1;
        s_trunc[buf] = false;
        return;
    }

    if (delta < IR_MIN_PULSE_US) {
        //Noise spike. Deliberately do NOT advance s_last_edge_us: the next
        //accepted interval is then measured from the last *valid* edge, so a
        //narrow glitch is absorbed rather than shortening the pulse after it.
        return;
    }

    s_last_edge_us = now;
    const uint8_t buf = s_active_buf;

    //A gap this long ends a frame but not the capture. Count the boundary so
    //the task can report how many frames this pulse train really contains.
    if (delta >= IR_FRAME_GAP_US && s_frames[buf] < 0xFFFF) {
        s_frames[buf]++;
    }

    if (s_count[buf] < IR_MAX_PULSES) {
        s_buf[buf][s_count[buf]] = (delta > 0xFFFF) ? 0xFFFF : (uint16_t)delta;
        s_count[buf]++;
    } else {
        //Out of room. Flag it rather than silently clipping the signal and
        //handing back a capture that looks fine but can never work.
        s_trunc[buf] = true;
    }
}

//Repeating timer fired every ~2ms from a hardware alarm; detects the idle gap
//that marks end-of-capture without putting that logic in the edge ISR. 2ms
//granularity is ample against a 55ms threshold.
static bool idle_timeout_cb(repeating_timer_t *rt) {
    (void)rt;

    if (s_state == ST_IDLE) return true;
    if ((time_us_64() - s_last_edge_us) < IR_MESSAGE_GAP_US) return true;

    if (s_state == ST_DROPPING) {
        //The discarded transmission has ended; accept new ones again.
        s_state = ST_IDLE;
        return true;
    }

    const uint8_t finished = s_active_buf;
    s_state = ST_IDLE;

    if (s_count[finished] == 0) return true; //nothing worth handing over

    s_busy[finished] = true;

    BaseType_t higher_prio_woken = pdFALSE;
    if (xQueueSendFromISR(s_ready_queue, &finished, &higher_prio_woken) != pdTRUE) {
        //The queue is sized to the ring, so this should be unreachable.
        s_busy[finished] = false;
        s_dropped++;
        return true;
    }

    //Point at a buffer the task is not holding, ready for the next
    //transmission. If every buffer is in flight this leaves s_active_buf on a
    //busy one, and the edge ISR refuses the next transmission until the task
    //frees one - which is better than discarding the capture we already have.
    s_active_buf = find_free_buf(finished);

    portYIELD_FROM_ISR(higher_prio_woken);

    return true; //keep repeating
}

//Kept in static storage rather than on the task stack: IrMessage is ~1.6KB at
//IR_MAX_PULSES=800 and only this task touches these.
static IrMessage s_msg;
static IrMessage s_discard;

} //namespace

void init() {
    s_ready_queue = xQueueCreate(IR_CAPTURE_BUFFERS, sizeof(uint8_t));
    configASSERT(s_ready_queue != nullptr);

    for (uint8_t i = 0; i < IR_CAPTURE_BUFFERS; i++) {
        s_count[i] = 0;
        s_frames[i] = 1;
        s_trunc[i] = false;
        s_busy[i] = false;
    }

    gpio_init(IR_RX_PIN);
    gpio_set_dir(IR_RX_PIN, GPIO_IN);
    gpio_pull_up(IR_RX_PIN); //VS1838B output is active-low, idle-high

    gpio_set_irq_enabled_with_callback(
        IR_RX_PIN,
        GPIO_IRQ_EDGE_RISE | GPIO_IRQ_EDGE_FALL,
        true,
        &gpio_edge_isr);

    add_repeating_timer_ms(2, idle_timeout_cb, nullptr, &s_idle_timer);

    s_last_edge_us = time_us_64();
}

void task(void *params) {
    (void)params;
    uint32_t reported_drops = 0;

    for (;;) {
        uint8_t idx = 0;
        if (xQueueReceive(s_ready_queue, &idx, portMAX_DELAY) != pdTRUE) continue;

        const uint16_t n = s_count[idx];

        s_msg.carrier_freq = IR_CARRIER_HZ; //the VS1838B demodulates the
                                            //carrier away before it reaches
                                            //GP15, so it cannot be measured
        s_msg.pulse_count = n;
        s_msg.frame_count = s_frames[idx];
        s_msg.truncated = s_trunc[idx];
        memcpy(s_msg.pulses, (const void *)s_buf[idx], n * sizeof(uint16_t));

        s_busy[idx] = false; //free the moment it has been copied out

        if (s_msg.truncated) {
            printf("[ir] capture CLIPPED at %u pulses - signal is incomplete\n",
                   (unsigned)n);
        }
        if (s_msg.frame_count > 1) {
            printf("[ir] capture contains %u frames (%u pulses)\n",
                   (unsigned)s_msg.frame_count, (unsigned)n);
        }

        const uint32_t drops = s_dropped;
        if (drops != reported_drops) {
            printf("[ir] %lu capture(s) dropped: no free buffer\n",
                   (unsigned long)(drops - reported_drops));
            reported_drops = drops;
        }

        //Non-blocking-ish push: drop oldest if the network task is slow.
        if (xQueueSend(g_captureToMqttQueue, &s_msg, pdMS_TO_TICKS(100)) != pdTRUE) {
            xQueueReceive(g_captureToMqttQueue, &s_discard, 0);
            xQueueSend(g_captureToMqttQueue, &s_msg, 0);
        }
    }
}

} // namespace ir_capture
