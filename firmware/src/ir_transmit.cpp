#include "ir_transmit.h"
#include "hardware/pwm.h"
#include "hardware/gpio.h"
#include "hardware/clocks.h"
#include "pico/time.h"

namespace ir_transmit {

namespace {
static uint s_pwm_slice = 0;
static uint s_pwm_chan = 0;
static uint32_t s_wrap = 0;

//Reconfigure the PWM slice for a given carrier frequency (Hz) and duty (%).
static void configure_carrier(uint32_t freq_hz, uint8_t duty_percent) {
    uint32_t sys_clk = clock_get_hz(clk_sys);
    //Aim for wrap in a sensible range; divider 1 is fine for 38kHz at 125-133MHz sys clk.
    float divider = 1.0f;
    s_wrap = (uint32_t)((float)sys_clk / (divider * (float)freq_hz)) - 1;

    pwm_set_clkdiv(s_pwm_slice, divider);
    pwm_set_wrap(s_pwm_slice, s_wrap);
    pwm_set_chan_level(s_pwm_slice, s_pwm_chan, (s_wrap * duty_percent) / 100);
}
} //namespace

void init() {
    gpio_set_function(IR_TX_PIN, GPIO_FUNC_PWM);
    s_pwm_slice = pwm_gpio_to_slice_num(IR_TX_PIN);
    s_pwm_chan = pwm_gpio_to_channel(IR_TX_PIN);

    configure_carrier(IR_CARRIER_HZ, IR_DUTY_PERCENT);
    pwm_set_enabled(s_pwm_slice, false); // idle low until a mark starts
}

namespace {
//Drive the carrier for `us` microseconds (a "mark"), then silence for the
//following "space". Uses a hardware microsecond timer for precision; total
//bursts are short (tens of ms) so busy-waiting from this high-priority task
//does not meaningfully affect the rest of the system.
static inline void carrier_on() { pwm_set_enabled(s_pwm_slice, true); }
static inline void carrier_off() {
    pwm_set_enabled(s_pwm_slice, false);
    gpio_put(IR_TX_PIN, 0); //ensure MOSFET gate rests low between bursts
}
} //namespace

void task(void *params) {
    (void)params;
    IrMessage msg;

    for (;;) {
        if (xQueueReceive(g_mqttToTransmitQueue, &msg, portMAX_DELAY) == pdTRUE) {
            if (msg.pulse_count == 0) continue;

            uint32_t carrier = (msg.carrier_freq >= 20000 && msg.carrier_freq <= 60000)
                                    ? msg.carrier_freq
                                    : IR_CARRIER_HZ;
            configure_carrier(carrier, IR_DUTY_PERCENT);

            //Boost this task's own priority for the duration of the burst
            //to minimize jitter from the scheduler tick.
            UBaseType_t orig_prio = uxTaskPriorityGet(nullptr);
            vTaskPrioritySet(nullptr, configMAX_PRIORITIES - 1);

            absolute_time_t next = get_absolute_time();
            for (uint16_t i = 0; i < msg.pulse_count; i++) {
                bool is_mark = (i % 2 == 0); //pulses[0] is always a mark by convention
                uint16_t duration_us = msg.pulses[i];

                if (is_mark) {
                    carrier_on();
                } else {
                    carrier_off();
                }

                next = delayed_by_us(next, duration_us);
                busy_wait_until(next);
            }
            carrier_off();

            vTaskPrioritySet(nullptr, orig_prio);
        }
    }
}

} //namespace ir_tansmit
