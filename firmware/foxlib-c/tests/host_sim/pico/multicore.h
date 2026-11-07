/* SPDX-License-Identifier: GPL-3.0-or-later */
/* host stub: core 1 is a pthread (player_sim); the simulator's other harnesses never launch it */
#pragma once
void multicore_launch_core1(void (*entry)(void));
