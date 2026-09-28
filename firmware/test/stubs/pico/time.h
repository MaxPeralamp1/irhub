#pragma once
#include <cstdint>
extern uint64_t g_sim_now_us;           // driven by the test harness
inline uint64_t time_us_64() { return g_sim_now_us; }
