// wav.js — render an event stream (hz, ms) to PCM and wrap it as a WAV file.
// SPDX-License-Identifier: GPL-2.0-only
//
// Used for boards that play an audio file instead of running foxlib (the
// PicoFox): the same events the Payload tab previews become the samples
// the firmware frequency-modulates. `level` is the peak amplitude as a
// fraction of full scale; for the PicoFox full scale is ±10 kHz deviation,
// so level = deviationHz / 10000.

/**
 * Int16 samples for `events` at `sampleRate`, peak `level` (0–1), with short raised-cosine edges to avoid key clicks.
 *   shape: 'sine' | 'bright' — bright adds the odd harmonics (3rd, 5th) a PWM square wave has, within what the
 *          sample rate can carry; it is what the ESP32 + SA868 fox sounds like.
 *   preemphasis: FM voice radios boost highs ~6 dB/octave on transmit and the receiver cuts them back; a transmitter
 *          that modulates straight from the samples (PicoFox) needs it done here or low notes come out dull.
 *          Implemented as a 6 dB/octave slope relative to the highest tone in the stream, floored at `preFloor`.
 */
export function renderPcm(events, { sampleRate = 5000, level = 0.5, rampMs = 5, maxHz = sampleRate / 2 - 100, shape = 'sine', preemphasis = false, preFloor = 0.4 } = {}) {
  const total = Math.round(events.reduce((a, [, ms]) => a + ms, 0) * sampleRate / 1000);
  const out = new Int16Array(total);
  const fold = hz => { while (hz > maxHz) hz /= 2; return hz; };
  const tones = events.map(([hz]) => fold(hz)).filter(hz => hz > 0);
  const fTop = tones.length ? Math.max(...tones) : 1;
  const gain = hz => preemphasis ? Math.max(preFloor, hz / fTop) : 1;
  // harmonic set and a peak normaliser so `level` stays the true peak whatever the shape
  const harm = shape === 'bright' ? [[1, 1], [3, 1 / 3], [5, 1 / 5]] : [[1, 1]];
  const wave = (ph, hz) => { let v = 0; for (const [k, a] of harm) if (hz * k <= maxHz) v += a * Math.sin(ph * k); return v; };
  const peaks = new Map();   // the harmonic set depends on the tone (harmonics above maxHz are dropped), so normalise per tone
  const peakFor = hz => { if (!peaks.has(hz)) { let pk = 0; for (let i = 0; i < 400; i++) pk = Math.max(pk, Math.abs(wave(2 * Math.PI * i / 400, hz))); peaks.set(hz, pk || 1); } return peaks.get(hz); };
  const amp = Math.max(0, Math.min(1, level)) * 32767, ramp = Math.max(1, Math.round(rampMs * sampleRate / 1000));
  let pos = 0, phase = 0;
  for (const [hz0, ms] of events) {
    const n = Math.round(ms * sampleRate / 1000);
    const hz = fold(hz0);
    if (hz > 0) {
      const step = 2 * Math.PI * hz / sampleRate, g = gain(hz) / peakFor(hz);
      for (let i = 0; i < n && pos + i < total; i++) {
        let env = 1;
        if (i < ramp) env = 0.5 - 0.5 * Math.cos(Math.PI * i / ramp);
        else if (n - i <= ramp) env = 0.5 - 0.5 * Math.cos(Math.PI * (n - i) / ramp);
        out[pos + i] = Math.round(amp * g * env * wave(phase, hz));
        phase += step; if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
      }
    } else phase = 0;
    pos += n;
  }
  return out;
}

/** Canonical 44-byte RIFF/WAVE header + mono signed 16-bit PCM. */
export function wavBytes(pcm, sampleRate = 5000) {
  const data = pcm.length * 2, buf = new ArrayBuffer(44 + data), v = new DataView(buf), u8 = new Uint8Array(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
  return u8;
}

/** Parse a WAV file into { sampleRate, channels, bits, pcm (Int16Array of the data chunk, as stored) }; throws if not PCM. */
export function parseWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = o => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= bytes.length) {
    const id = tag(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') { data = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + len)); break; }
    o += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('WAV without fmt/data chunks');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`WAV is not 16-bit PCM (format ${fmt.format}, ${fmt.bits} bit)`);
  const pcm = new Int16Array(data.length >> 1); const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < pcm.length; i++) pcm[i] = dv.getInt16(i * 2, true);
  return { ...fmt, pcm };
}

/** Peak and RMS of PCM as fractions of full scale. */
export function levels(pcm) {
  let peak = 0, sq = 0;
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; sq += pcm[i] * pcm[i]; }
  return { peak: peak / 32767, rms: Math.sqrt(sq / Math.max(1, pcm.length)) / 32767, ms: 0 };
}
