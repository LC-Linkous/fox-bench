#pragma once
typedef enum { GPIO_MODE_OUTPUT = 2 } gpio_mode_t;
int gpio_reset_pin(int); int gpio_set_direction(int, gpio_mode_t); int gpio_set_level(int, unsigned);
