# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""NiceRF SA868 driver over busio.UART (9600 8N1).

Replies are parsed, not discarded:
    AT+DMOCONNECT          -> +DMOCONNECT:0
    AT+DMOSETGROUP=...     -> +DMOSETGROUP:0   (1 = rejected, e.g. out of band)
    AT+DMOSETVOLUME=n      -> +DMOSETVOLUME:0
    AT+VERSION             -> +VERSION:...
    RSSI?                  -> RSSI=nnn

Radio.status is 'ok' | 'err(<reply>)' | 'noreply' for the banner.
"""


class Radio:
    def __init__(self, pins, radio_cfg, uart_factory=None):
        raise NotImplementedError

    def retune(self, mhz):
        """DMOSETGROUP with PTT released. Returns True if the module accepted."""
        raise NotImplementedError

    def keyed(self):
        """context manager: PTT low on enter, high in finally -- always."""
        raise NotImplementedError

    def key(self, seconds):
        """bench: key unmodulated for N seconds, then release"""
        raise NotImplementedError

    def rssi(self):
        raise NotImplementedError

    def probe(self, test_mhz=(146.5, 433.5)):
        """bench: which test frequencies does the fitted module accept?
        Retunes in receive only; nothing is transmitted."""
        raise NotImplementedError
