# FatFs R0.16 (vendored)

Generic FAT filesystem module by ChaN, http://elm-chan.org/fsw/ff/ — see
`LICENSE.txt` (FatFs licence, BSD-1-clause style). Files are unmodified
except `ffconf.h`, where fox-bench enables `FF_USE_MKFS`, `FF_USE_LABEL`,
`FF_USE_FIND`, `FF_USE_LFN=1`, `FF_FS_NORTC=1` and sets code page 437.

Used by `firmware/foxlib-c/picofox` to read `fox.json`/`defaults.json` from
the FAT volume the same firmware exposes over USB mass storage. The glue
(`fatfs_diskio.c`) lives with the firmware, not here.
