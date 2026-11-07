/* SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
static inline void __dmb(void) { __sync_synchronize(); }
