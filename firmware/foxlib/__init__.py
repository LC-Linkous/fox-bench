# SPDX-License-Identifier: GPL-3.0-or-later
# foxlib -- shared firmware library for fox-bench transmitters.
#
#   import foxlib
#   fox = foxlib.Fox("fox.json", defaults="defaults.json", version="1.0.0")
#   for tx in fox.cycles():
#       tx.morse(tx.id_message)
#       ...
#
# Fox loads and validates the config, brings up radio / tones / LED / battery /
# schedule, prints the boot banner, and hands cycles() to cycle.run().
# quiet=True (bench use from the REPL): no banner, nothing keyed.

import board
import microcontroller
from . import cfg as _cfg, radio as _radio, tones, melody, sstv, battery, schedule, led, cycle

try:
    __version__ = open(__file__.rsplit("/", 1)[0] + "/VERSION").read().strip()
except Exception:
    __version__ = "0"


class Fox:
    def __init__(self, path="fox.json", defaults="defaults.json", version="?", quiet=False):
        self.quiet = quiet
        self.template_version = version
        self.board_id = getattr(board, "board_id", "unknown")
        self.uid = "".join("%02x" % b for b in microcontroller.cpu.uid)
        self.cfg, self.report = _cfg.load(path, defaults, dir(board), self.board_id)
        self.fatal = self.report.fatal
        self.radio = None
        self.player = None
        self.batt = None
        self.playlist = None
        self.images = None
        self.led = led.Status(None)
        if self.cfg is None:
            self.id_ok = False
            self.schedule = schedule.make({"kind": "fixed", "delay_ms": 30000})
            self._banner()
            return
        c = self.cfg
        pins = {}
        for role, name in c["pins"].items():
            pins[role] = getattr(board, name) if name else None
        # LED first so a fatal boot can still blink
        try:
            self.led = led.Status(pins.get("led"))
        except Exception:
            self.led = led.Status(None)
        if not self.fatal:
            try:
                self.radio = _radio.make(pins, c["radio"])
                self.player = tones.Player(pins["audio"])
            except Exception as e:
                self.fatal = "hardware(%s:%s)" % (e.__class__.__name__, str(e).replace(" ", "_")[:40])
        if not self.fatal:
            if self.radio.setup():
                if not self.radio.retune(c["plan"]["frequencies_mhz"][0]):
                    pass        # status already says why
        if pins.get("batt_sense") is not None:
            try:
                self.batt = battery.Monitor(pins["batt_sense"], c["battery"])
            except Exception:
                self.batt = None
        p = c["payload"]
        if p["kind"] == "songs":
            self.playlist = melody.Playlist(p["playlist"], p["articulation"])
        elif p["kind"] == "sstv":
            self.images = sstv.Images(sstv.load_images(p["images_file"]))
        self.schedule = schedule.make(c["schedule"])
        self.id_ok = c["id"]["placeholder"] not in c["id"]["callmessage"]
        self._banner()

    def deinit(self):
        """Release every pin, the UART and the PWM. The bench builds a fresh Fox per action in one REPL
        session; without this the second one fails with '<pin> in use' and boots with radio=None."""
        for part in (self.radio, self.player, self.batt, self.led):
            if part is not None:
                try:
                    part.deinit()
                except Exception:
                    pass
        self.radio = self.player = self.batt = None

    # ---- output
    def log(self, text):
        if not self.quiet:
            print(text)

    def banner_line(self):
        c = self.cfg or {}
        freqs = ",".join("%g" % f for f in c.get("plan", {}).get("frequencies_mhz", [])) if c else "none"
        return "FOX template=%s/%s foxlib=%s board=%s uid=%s cfg=%s radio=%s id=%s freq=%s" % (
            c.get("template", "?") if c else "?", self.template_version, __version__, self.board_id, self.uid,
            ("fatal(%s)" % self.fatal) if self.fatal else self.report.status(), (self.radio.status if self.radio else "skipped"), "set" if self.id_ok else "unset", freqs or "none")

    def _banner(self):
        if self.quiet:
            return
        print("initializing system ... ")
        print(self.banner_line())
        for key, reason in self.report.items:
            print("  cfg: %s -> default (%s)" % (key, reason))
        if self.fatal:
            print("** fatal: %s -- staying silent **" % self.fatal)
        elif not self.id_ok:
            print("** callsign not set: %s **" % ("transmitting anyway (tx_without_callsign)" if self.cfg["id"]["tx_without_callsign"] else "staying silent (id.tx_without_callsign=false)"))

    # ---- the loop
    def cycles(self):
        try:
            for tx in cycle.run(self):
                yield tx
        finally:
            if self.radio:
                self.radio.unkey()
            if self.player:
                self.player.pwm.duty_cycle = 0
