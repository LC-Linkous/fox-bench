/* host stub: a virtual clock the simulator advances */
#pragma once
#include <stdint.h>
typedef uint64_t absolute_time_t;
extern uint64_t sim_now_us;
static inline absolute_time_t get_absolute_time(void) { return sim_now_us; }
static inline uint32_t to_ms_since_boot(absolute_time_t t) { return (uint32_t)(t / 1000); }
static inline uint64_t time_us_64(void) { return sim_now_us; }
static inline void sleep_ms(uint32_t ms) { sim_now_us += (uint64_t)ms * 1000; }
