#!/usr/bin/env python3
"""Drives build/player_sim (the real picofox/player.c and si5351.c on the host, core 1 as a thread on the
virtual clock) through its scenarios and judges what core 1 did on the bus: the AMP_EN edges and every
Si5351 offset write, timestamped in virtual microseconds.

The Morse check is edge for edge: the FM-write log is cut into tone spans (runs of nonzero deviation) and
lined up with the event list `core_dump morse` produces for the same text, so the keyer, the synth and the
sample pump are checked as one chain. Everything else (two plays back to back, STOP mid-stream, max_samples,
an empty list, the flash-write bus hold, the attenuator word, a rev 2 board, a hung core 1) is judged from
the per-scenario flags the harness reports plus the same two logs.

    python3 player_test.py [--bin build/player_sim] [--core-dump build/core_dump] [-v]
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RATE = 8000                       # the harness plays everything at 8 kHz: one sample every 125 µs
PERIOD_US = 1_000_000 // RATE
RAMP_MS = 5                       # synth_params_t default: the spans start/end one ramp inside the event edges

fails = 0
checks = 0


def check(cond, what):
    global fails, checks
    checks += 1
    if not cond:
        fails += 1
        print("FAIL " + what)


def run(binary, *args, timeout=600):
    p = subprocess.run([binary, *map(str, args)], capture_output=True, text=True, timeout=timeout)
    lines = [l for l in p.stdout.splitlines() if l.startswith("{")]
    if p.returncode != 0 or not lines:
        print(p.stderr[-2000:])
        raise SystemExit(f"player_sim {' '.join(map(str, args))} failed (rc {p.returncode}, no JSON)")
    return json.loads(lines[-1])


def spans(fm, merge_us=2000, min_counts=10):
    """Tone spans [(t_on_us, t_off_us)] from the offset-write log: a span runs from the first nonzero write to the
    write that returns the offset to 0 (si5351.c writes only on change, so a silent gap is one zero write). A tone
    whose period divides the sample rate hits an exact zero sample now and then (700 Hz at 8 kHz: every 10 ms), so
    zero writes shorter than a Morse gap are merged back; the 1-count probe play_loop writes at start to time one
    I2C transfer is dropped by the amplitude floor."""
    raw, on, peak = [], None, 0
    for t, c in fm:
        if c != 0:
            if on is None:
                on, peak = t, 0
            peak = max(peak, abs(c))
        elif on is not None:
            raw.append((on, t, peak)); on = None
    if on is not None:
        raw.append((on, fm[-1][0], peak))
    out = []
    for on, off, peak in raw:
        if out and on - out[-1][1] < merge_us:
            out[-1] = (out[-1][0], off, max(out[-1][2], peak))
        else:
            out.append((on, off, peak))
    return [(on, off) for on, off, peak in out if peak >= min_counts]


def morse_events(core_dump, wpm, tone, text):
    p = subprocess.run([core_dump, "morse", str(wpm), str(tone), "0", text], capture_output=True, text=True, check=True)
    return [(int(a), int(b)) for a, b in (l.split() for l in p.stdout.splitlines() if l.strip())]


def test_morse(a, wpm=20, tone=700, text="PARIS"):
    r = run(a.bin, "morse", wpm, tone, text)
    ev = morse_events(a.core_dump, wpm, tone, text)
    tones = [ms for hz, ms in ev if hz]
    total_ms = sum(ms for _, ms in ev)
    key_on = [t for t, on in r["key"] if on]
    key_off = [t for t, on in r["key"] if not on]
    check(len(key_on) == 1 and len(key_off) >= 1 and key_on[0] < key_off[-1], f"morse: one key-on then a key-off, got {r['key']}")
    fm = r["fm"]
    check(r["done"] and not r["cut"] and r["late"] == 0, f"morse: done={r['done']} cut={r['cut']} late={r['late']}")
    check(r["played"] == round(total_ms * RATE / 1000), f"morse: played {r['played']} samples, events total {total_ms} ms")
    # every FM write lies between the key-on and the key-off, and none exceeds the deviation
    dev = max(abs(c) for _, c in fm)
    check(all(round(key_on[0] * 1000) <= t <= round(key_off[-1] * 1000) for t, c in fm if c), "morse: FM deviation written while unkeyed")
    check(0 < dev <= 2500 * 1048575 // 1_000_000 + 2, f"morse: peak deviation {dev} counts")
    # sample timing: consecutive writes are whole periods apart (the pump wrote once per sample, on time)
    nz = [i for i, (_, c) in enumerate(fm) if abs(c) >= 10]
    play = fm[nz[0]:nz[-1] + 1]                                              # the stream itself, probe and key writes aside
    gaps = [b[0] - a_[0] for a_, b in zip(play, play[1:])]
    off = [g for g in gaps if g % PERIOD_US]
    check(not off, f"morse: {len(off)} inter-write gaps are not a multiple of {PERIOD_US} µs: {off[:5]}")
    # edge for edge against the keyer's event list
    sp = spans(fm)
    check(len(sp) == len(tones), f"morse: {len(sp)} tone spans on the bus, keyer produced {len(tones)}")
    if len(sp) == len(tones):
        # the stream starts at play_loop's one-write probe (offset 1 then 0); every event edge is measured from it
        t_start = next(t for t, c in fm if c)
        cursor_us, i, deltas = 0, 0, []
        for hz, ms in ev:
            if hz:
                on, offt = sp[i]
                lead = on - (t_start + cursor_us)                             # ramp-in: a few near-zero samples before the first write
                dur_ms = (offt - on) / 1000
                check(0 <= lead <= RAMP_MS * 1000, f"morse: tone {i} first deviation {lead} µs after its event edge (+{cursor_us / 1000:.0f} ms); the ramp is {RAMP_MS} ms")
                check(abs(dur_ms - ms) <= RAMP_MS + 2 * PERIOD_US / 1000, f"morse: tone {i} lasts {dur_ms:.3f} ms on the bus, event {ms} ms")
                deltas.append(lead)
                i += 1
            cursor_us += ms * 1000
        # edge for edge: the keyer's spacing survives the pump to within a few samples
        check(max(deltas) - min(deltas) <= 4 * PERIOD_US, f"morse: tone-start jitter against the event list {max(deltas) - min(deltas)} µs (leads {sorted(set(deltas))})")
    if a.v:
        print("morse spans (ms):", [(round((o - sp[0][0]) / 1000, 3), round((f - o) / 1000, 3)) for o, f in sp])


def test_two(a):
    r = run(a.bin, "two")
    check(r["extra_ok"] == 1, f"two: {r['extra']}")
    check(r["done"] and not r["cut"] and r["late"] == 0, f"two: done={r['done']} cut={r['cut']} late={r['late']}")
    key_on = [t for t, on in r["key"] if on]
    check(len(key_on) == 1, f"two: amplifier keyed {len(key_on)} times for two plays under one key")


def test_stop(a):
    r = run(a.bin, "stop", 300)
    check(r["extra_ok"] == 1, f"stop: {r['extra']}")
    check(r["cut"] and r["done"] and not r["busy"], f"stop: cut={r['cut']} done={r['done']} busy={r['busy']}")
    check(300 * RATE // 1000 <= r["played"] < 10_000 * RATE // 1000, f"stop: played {r['played']} samples of a 10 s tone stopped after 300 ms")
    check(r["fm"][-1][1] == 0, "stop: the offset was not returned to 0 after the stop (unkey)")


def test_cut(a):
    r = run(a.bin, "cut", 200)
    check(r["extra_ok"] == 1 and r["played"] == 200 * RATE // 1000, f"cut: played {r['played']}, max_samples {200 * RATE // 1000}: {r['extra']}")
    check(r["cut"] and r["done"], f"cut: cut={r['cut']} done={r['done']}")


def test_empty(a):
    r = run(a.bin, "empty")
    check(r["extra_ok"] == 1, f"empty: {r['extra']}")
    check(r["done"] and r["played"] == 0 and not r["busy"], f"empty: done={r['done']} played={r['played']} busy={r['busy']}")


def test_hold(a):
    r = run(a.bin, "hold", 100, 30)
    check(r["extra_ok"] == 1, f"hold: {r['extra']}")
    check(r["done"] and not r["cut"] and r["played"] == 400 * RATE // 1000, f"hold: done={r['done']} cut={r['cut']} played={r['played']}")
    check(r["late"] == 1, f"hold: late={r['late']}, expected exactly the one resync after the hold")
    gaps = [b[0] - a_[0] for a_, b in zip(r["fm"], r["fm"][1:]) if b[1] != 0 and a_[1] != 0]
    check(max(gaps) >= 30_000, f"hold: longest gap between writes {max(gaps)} µs, the bus was asked to be held 30 ms")


def test_atten(a):
    r = run(a.bin, "atten", 40)
    check(r["extra_ok"] == 1, f"atten: {r['extra']}")
    word = [(40 << 1 >> i) & 1 for i in range(7, -1, -1)]
    bits = r["atten_bits"]
    # 8 data bits before the LE pulse; the 9th rising edge is SCL being handed back to I2C idle after the latch
    check(bits[:8] == word and len(bits) == 9 and bits[8] == 1, f"atten: clocked {bits}, expected {word} + the idle edge (code<<1, MSB first)")
    check(r["atten_le_pulses"] == 1, f"atten: {r['atten_le_pulses']} LE pulses for one accepted write")
    check(r["attenuation"] == 40 and r["revision"] == 3, f"atten: status attenuation={r['attenuation']} revision={r['revision']}")
    check(r["i2c_errors"] == 0 and r["si5351_ok"], f"atten: i2c_errors={r['i2c_errors']} si5351_ok={r['si5351_ok']} after releasing and retaking the bus")
    check(r["done"] and r["late"] == 0, f"atten: the refused mid-stream write disturbed the pump: done={r['done']} late={r['late']}")


def test_rev2(a):
    r = run(a.bin, "rev2")
    check(r["extra_ok"] == 1 and r["revision"] == 2, f"rev2: {r['extra']} revision={r['revision']}")
    check(r["atten_le_pulses"] == 0 and r["atten_bits"] == [], f"rev2: attenuator pins toggled on a board without one: {r['atten_bits']!r}, {r['atten_le_pulses']} LE")
    check(r["done"] and r["late"] == 0, f"rev2: done={r['done']} late={r['late']}")


def test_dead(a):
    r = run(a.bin, "dead")
    check(r["extra_ok"] == 1, f"dead: {r['extra']}")
    check(r["core1_alive"] == 0 and r["key"][-1][1] == 0, f"dead: core1_alive={r['core1_alive']} last key edge {r['key'][-1]}")
    check(not r["done"], "dead: a play core 1 never finished was reported done")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", default=os.path.join(HERE, "build", "player_sim"))
    ap.add_argument("--core-dump", default=os.path.join(HERE, "build", "core_dump"))
    ap.add_argument("-v", action="store_true")
    a = ap.parse_args()
    tests = [test_morse, test_two, test_stop, test_cut, test_empty, test_hold, test_atten, test_rev2, test_dead]
    for t in tests:
        t(a)
    print(f"player: {len(tests)} scenarios, {checks} checks, {fails} failed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
