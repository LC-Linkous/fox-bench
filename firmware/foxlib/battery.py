# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/battery.py -- battery voltage through a resistor divider on an ADC pin.
# The ESP32-C3 ADC full scale varies ~10 % chip to chip (calibration trim) and
# spikes during RF activity (averaged reads).

import analogio


class Monitor:
    def __init__(self, pin, cfg):
        self._adc = analogio.AnalogIn(pin)
        self.samples = cfg.get("samples", 16)
        self.ratio = cfg.get("divider_ratio", 2.0)
        self.cal = cfg.get("calibration", 1.0)

    def read(self):
        total = 0
        for _ in range(self.samples):
            total += self._adc.value
        mean = total / self.samples
        ref = getattr(self._adc, "reference_voltage", 3.3)
        return (mean / 65535) * ref * self.ratio * self.cal

    def deinit(self):
        self._adc.deinit()


def policy(volts, cfg, previous):
    """'ok' | 'low' | 'critical', with hysteresis on the critical threshold."""
    if volts is None:
        return "ok"
    if volts < cfg["critical_v"]:
        return "critical"
    if previous == "critical" and volts < cfg["recovery_v"]:
        return "critical"
    if volts < cfg["low_v"]:
        return "low"
    return "ok"


def telemetry(volts):
    """3.72 -> 'BAT 3V7' (Morse-friendly, no decimal point)."""
    whole = int(volts)
    tenth = int(round((volts - whole) * 10))
    if tenth == 10:
        whole += 1
        tenth = 0
    return "BAT %dV%d" % (whole, tenth)
