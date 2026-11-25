#pragma once
#include <stdint.h>
typedef int BaseType_t; typedef uint32_t TickType_t; typedef void *QueueHandle_t; typedef void *SemaphoreHandle_t;
#define pdTRUE 1
#define portMAX_DELAY 0xFFFFFFFFu
#define pdMS_TO_TICKS(ms) ((TickType_t)(ms))
