# SPDX-License-Identifier: GPL-3.0-or-later
# Part of fox-bench firmware (foxlib). See firmware/LICENSE.
"""Battery voltage through a resistor divider on an ADC pin.

Monitor(pin, cfg): averaged reads (ESP32-C3 ADC spikes during RF),
divider_ratio and a calibration trim against a multimeter.
policy(volts, cfg, state) -> 'ok' | 'low' | 'critical' with hysteresis
(critical_v < recovery_v <= low_v). telemetry(volts) -> 'BAT 3V7'.
"""


class Monitor:
    def __init__(self, pin, cfg):
        raise NotImplementedError

    def read(self):
        raise NotImplementedError


def policy(volts, cfg, previous):
    raise NotImplementedError


def telemetry(volts):
    return "BAT %dV%d" % (int(volts), int(round((volts % 1) * 10)) % 10)
