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
#
# Built to run for a whole hunt (foxlib 1.6; limits.recover=false turns the watchdog and the carry-on off, and
# safemode.py then leaves safe mode alone -- the pre-1.6 behaviour, for finding out what a fox dies of): the hardware watchdog is armed (limits.watchdog_s) and fed through
# every wait; the module is re-tuned before every transmission (an SA8x8 that lost power forgets its channel);
# a cycle that raises is logged and the loop goes on; gc.collect() each cycle keeps the heap from fragmenting;
# timing is integer milliseconds from monotonic_ns (CircuitPython floats have ~22 bits of mantissa, so
# time.monotonic() is only good to several ms after a few hours).

import time
import gc
from . import morse, battery, guard

GAP_MS = 750
FAIL_HOLD_MS = 5000        # after a cycle raised: LED 'fatal' this long, then try again


def _now_ms():
    return time.monotonic_ns() // 1000000


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
        self.failed = None         # the exception class name when the transmitter raised; the cycle goes on
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
        try:
            ok = self.fox.player.play(events, max_ms=rem)
        except Exception as e:                    # a bad event, a PWM the port refused, MemoryError: unkey and carry on
            if not self.fox.cfg["limits"].get("recover", True):
                raise
            self.failed = e.__class__.__name__
            self.fox.log("play failed (%s: %s)" % (self.failed, str(e)[:60]))
            return False
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
    recover = cfg["limits"].get("recover", True)       # the page's "enable automatic recovery attempts"
    fox.log("watchdog %s" % guard.arm(cfg["limits"].get("watchdog_s") if recover else None))
    if not recover:
        fox.log("recovery off: a failed cycle stops the fox; safe mode is left alone")
    try:
        while True:
            # 1. configured?
            if fox.fatal or not (fox.id_ok or cfg["id"]["tx_without_callsign"]):
                fox.log("unconfigured (%s): silent" % (fox.fatal or "callsign unset"))
                fox.led.hold(20000, "unconfigured")
                continue
            gc.collect()
            guard.feed()
            try:
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
                freqs = cfg["plan"]["frequencies_mhz"]
                _ensure_radio(fox, freqs[freq_index])
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
                    guard.healthy()
                    fox.led.hold(fox.schedule.wait_ms(_now_ms()))
                    continue
                # 4. alive
                fox.led.show("low" if state == "low" else "alive")
                if volts is not None:
                    fox.log("cycle %d: battery %.2f V (%s)" % (cycle, volts, state))
                tx = Tx(fox, cycle, volts, state, id_message)
                rotating = len(freqs) > 1
                next_index = (freq_index + 1) % len(freqs) if rotating else freq_index
                # 5. keyed section
                fox.radio.key()
                try:
                    tx.gap()
                    yield tx
                    if rotating and cfg["plan"]["announce_qsy"] and not tx.cut and not tx.failed:
                        tx.morse("QSY %.3f" % freqs[next_index])
                finally:
                    fox.radio.unkey()
                # 6. retune
                if rotating:
                    freq_index = next_index
                    if not _ensure_radio(fox, freqs[freq_index]):
                        fox.log("retune to %.4f failed: %s" % (freqs[freq_index], fox.radio.status))
                if tx.cut:
                    fox.log("keydown limit reached; transmission cut")
                    fox.led.show("keydown-limit")
                cycle += 1
                guard.healthy()
                # 7. wait
                fox.led.hold(fox.schedule.wait_ms(_now_ms()))
            except Exception as e:
                # nothing a fox does is worth staying silent for the rest of the hunt: release, log, go on
                try:
                    fox.radio.unkey()
                except Exception:
                    pass
                if not recover:
                    raise
                fox.log("cycle %d failed (%s: %s); continuing" % (cycle, e.__class__.__name__, str(e)[:60]))
                cycle += 1
                fox.led.hold(FAIL_HOLD_MS, "fatal")
    finally:
        guard.disarm()


def _ensure_radio(fox, mhz):
    """Re-send the channel before every transmission, and redo setup when the module had not answered. A module
    that browned out or was reset keeps running on its default channel otherwise, and the fox goes 'silent'."""
    r = fox.radio
    was = r.status
    ok = r.ensure(mhz)
    if r.status != was:
        fox.log("radio %s -> %s (%s)" % (was, r.status, "re-tuned" if ok else "retune failed"))
    return ok
