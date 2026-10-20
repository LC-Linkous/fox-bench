/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef MSC_DISK_H
#define MSC_DISK_H
#include <stdbool.h>
#include <stdint.h>
bool msc_host_has_drive(void);     /* USB configured and the LUN not ejected */
uint32_t msc_host_writes(void);    /* number of host write transfers since boot */
void msc_reset_eject(void);
#endif
