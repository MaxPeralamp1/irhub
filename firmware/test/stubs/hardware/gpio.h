#pragma once
#include <cstdint>
typedef unsigned int uint;
#define GPIO_IN 0
#define GPIO_IRQ_EDGE_RISE 0x8u
#define GPIO_IRQ_EDGE_FALL 0x4u
inline void gpio_init(uint) {}
inline void gpio_set_dir(uint, int) {}
inline void gpio_pull_up(uint) {}
typedef void (*gpio_irq_callback_t)(uint, uint32_t);
inline void gpio_set_irq_enabled_with_callback(uint, uint32_t, bool, gpio_irq_callback_t) {}
