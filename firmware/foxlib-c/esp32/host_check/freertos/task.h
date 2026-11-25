#pragma once
#include "FreeRTOS.h"
void vTaskDelay(TickType_t); BaseType_t xTaskCreate(void (*)(void *), const char *, uint32_t, void *, unsigned, void *);
