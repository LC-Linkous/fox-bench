# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib/cycle.py -- the per-cycle prologue every fox repeats, written once.
#
# run(fox) is a generator. Each iteration:
#   1. unconfigured (fatal config, or callsign unset without tx_without_callsign)
#      -> hold with LED 'unconfigured', never key, loop again
#   2. read battery -> policy; 'critical' -> hold 60 s with LED 'critical', loop again
#   3. schedule.phase(): resurrection dead wakes (dit / periodic ID) are handled
#      here; the template never sees them
#   4. LED pattern, assemble id_message (+ telemetry)
#   5. key PTT, 750 ms, yield Tx to the template body; PTT released in finally
#      even if the body raises or the REPL interrupts
#   6. rotating plan: QSY announcement before unkey, retune after
#   7. sleep schedule.wait_ms()

import time
from . import morse, battery

GAP_MS = 750


def _now_ms():
    return time.monotonic() * 1000


class Tx:
    """What a template body gets. morse()/play() go through the one transmitter
    with the keydown budget from limits.max_keydown_s."""

    def __init__(self, fox, cycle, volts, state, id_message):
        self.fox = fox
        self.cycle = cycle
        self.volts = volts
        self.state = state
        self.low_battery = state == "low"
        self.id_message = id_message
        self.cut = False
        self._segments = 0

    @property
    def remaining_ms(self):
        lim = self.fox.cfg["limits"].get("max_keydown_s")
        if lim is None:
            return None
        return max(0, lim * 1000 - self.fox.radio.keyed_ms())

    def gap(self, ms=GAP_MS):
        self.fox.player.play(((0, ms),))

    def play(self, events):
        """Play an event stream; a 750 ms gap is inserted between segments."""
        if self.cut:
            return False
        if self._segments:
            self.gap()
        self._segments += 1
        rem = self.remaining_ms
        if rem is not None and rem <= 0:
            self.cut = True
            return False
        ok = self.fox.player.play(events, max_ms=rem)
        if not ok:
            self.cut = True
        return ok

    def morse(self, text, dit_s=None, wpm=None, tone_hz=None):
        c = self.fox.cfg["id"]
        self.fox.log("morse: " + text)
        return self.play(morse.events(text, wpm=wpm or c["wpm"], tone_hz=tone_hz or c["tone_hz"], dit_ms=dit_s * 1000 if dit_s else None))


def run(fox):
    cfg = fox.cfg
    state = "ok"
    cycle = 0
    freq_index = 0
    while True:
        # 1. configured?
        if fox.fatal or not (fox.id_ok or cfg["id"]["tx_without_callsign"]):
            fox.log("unconfigured (%s): silent" % (fox.fatal or "callsign unset"))
            fox.led.hold(20000, "unconfigured")
            continue
        # 2. battery
        volts = None
        if fox.batt:
            try:
                volts = fox.batt.read()
            except Exception:
                volts = None
        state = battery.policy(volts, cfg["battery"], state)
        if state == "critical":
            fox.log("CRITICAL BATTERY %.2f V: transmissions paused" % volts)
            fox.led.hold(60000, "critical")
            continue
        id_message = cfg["id"]["callmessage"]
        if volts is not None and "batt" in cfg["id"]["telemetry"]:
            id_message += " " + battery.telemetry(volts)
        now = _now_ms()
        # 3. dead-phase wakes
        if fox.schedule.phase(now) == "dead":
            kind = fox.schedule.dead_wake()
            tx = Tx(fox, cycle, volts, state, id_message)
            fox.radio.key()
            try:
                tx.gap(250)
                if kind == "id":
                    tx.morse(id_message)
                    if cfg["schedule"].get("dead_song") and not tx.low_battery and fox.playlist:
                        tx.play(fox.playlist.next_events())
                else:
                    tx.morse("e")              # a single dit at the ID's WPM and tone
            finally:
                fox.radio.unkey()
            fox.log("dead-phase wake: %s" % kind)
            fox.led.hold(fox.schedule.wait_ms(_now_ms()))
            continue
        # 4. alive
        fox.led.show("low" if state == "low" else "alive")
        if volts is not None:
            fox.log("cycle %d: battery %.2f V (%s)" % (cycle, volts, state))
        tx = Tx(fox, cycle, volts, state, id_message)
        freqs = cfg["plan"]["frequencies_mhz"]
        rotating = len(freqs) > 1
        next_index = (freq_index + 1) % len(freqs) if rotating else freq_index
        # 5. keyed section
        fox.radio.key()
        try:
            tx.gap()
            yield tx
            if rotating and cfg["plan"]["announce_qsy"] and not tx.cut:
                tx.morse("QSY %.3f" % freqs[next_index])
        finally:
            fox.radio.unkey()
        # 6. retune
        if rotating:
            freq_index = next_index
            if not fox.radio.retune(freqs[freq_index]):
                fox.log("retune to %.4f failed: %s" % (freqs[freq_index], fox.radio.status))
        if tx.cut:
            fox.log("keydown limit reached; transmission cut")
            fox.led.show("keydown-limit")
        cycle += 1
        # 7. wait
        fox.led.hold(fox.schedule.wait_ms(_now_ms()))
