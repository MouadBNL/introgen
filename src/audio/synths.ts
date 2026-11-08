/** Pitched voices used by the music generator. Each one renders straight into a Stereo bus. */
import { type F32, SR, SVF, TAU, clamp, mtof, saw, sat, square, type Stereo } from './dsp';

const CTRL = 16; // samples between filter coefficient updates

/** Writes a gate envelope for [t0, t0+dur) with linear attack and release. */
function gate(n: number, attack: number, release: number): F32 {
  const e = new Float32Array(n);
  const a = Math.max(1, Math.round(attack * SR));
  const r = Math.max(1, Math.round(release * SR));
  for (let i = 0; i < n; i++) e[i] = Math.min(1, i / a, (n - i) / r);
  return e;
}

/** Detuned supersaw chord, unfiltered: the caller filters the whole bus. */
export function padChord(
  bus: Stereo, notes: number[], t0: number, dur: number, gain: number,
  r: () => number, o: { attack?: number; release?: number; detune?: number } = {},
): void {
  const at = Math.round(t0 * SR);
  const n = Math.min(Math.round(dur * SR), bus.l.length - at);
  if (n <= 0) return;
  const env = gate(n, o.attack ?? 0.03, o.release ?? 0.12);
  const det = o.detune ?? 9;
  const g = gain / Math.sqrt(notes.length * 2);
  for (const m of notes) {
    for (const cents of [-det, det * 0.6]) {
      for (const ch of [bus.l, bus.r]) {
        const c = cents * (ch === bus.l ? 1 : -1);
        const dt = (mtof(m) * Math.pow(2, c / 1200)) / SR;
        let ph = r();
        for (let i = 0; i < n; i++) {
          ph += dt;
          if (ph >= 1) ph -= 1;
          ch[at + i] += saw(ph, dt) * env[i] * g;
        }
      }
    }
  }
}

/** Short filtered saw with a fast filter envelope. */
export function pluck(
  bus: Stereo, m: number, t0: number, gain: number, pan: number, r: () => number,
  o: { decay?: number; bright?: number } = {},
): void {
  const decay = o.decay ?? 0.16;
  const bright = o.bright ?? 5200;
  const at = Math.round(t0 * SR);
  const n = Math.min(Math.round(decay * 3.5 * SR), bus.l.length - at);
  if (n <= 0) return;
  const f = mtof(m);
  const d1 = f / SR;
  const d2 = (f * 1.006) / SR;
  let p1 = r();
  let p2 = r();
  const flt = new SVF(bright, 1.1);
  const gl = gain * (1 - Math.max(0, pan));
  const gr = gain * (1 + Math.min(0, pan));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (i % CTRL === 0) flt.set(180 + bright * Math.exp(-t / (decay * 0.55)), 1.1);
    p1 += d1;
    if (p1 >= 1) p1 -= 1;
    p2 += d2;
    if (p2 >= 1) p2 -= 1;
    flt.tick(saw(p1, d1) + square(p2, d2) * 0.6);
    const v = flt.lp * Math.exp(-t / decay) * Math.min(1, t * 900, (n - i) / 200);
    bus.l[at + i] += v * gl;
    bus.r[at + i] += v * gr;
  }
}

/** Chord stab: brass-ish saw stack with a slow-ish filter swell. */
export function stab(
  bus: Stereo, notes: number[], t0: number, dur: number, gain: number, r: () => number, bright = 3800,
): void {
  const at = Math.round(t0 * SR);
  const n = Math.min(Math.round((dur + 0.06) * SR), bus.l.length - at);
  if (n <= 0) return;
  const g = gain / Math.sqrt(notes.length);
  [bus.l, bus.r].forEach((ch, c) => {
    const flt = new SVF(500, 1.2);
    const fs = notes.map((m) => mtof(m) * (c ? 1.0035 : 0.9965) / SR);
    const fs2 = notes.map((m) => mtof(m) * (c ? 0.998 : 1.002) / SR);
    const p = notes.map(() => r());
    const p2 = notes.map(() => r());
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (i % CTRL === 0) {
        const swell = Math.min(1, t / 0.03) * Math.exp(-t / (dur * 1.2));
        flt.set(350 + bright * swell, 1.3);
      }
      let s = 0;
      for (let k = 0; k < p.length; k++) {
        p[k] += fs[k];
        if (p[k] >= 1) p[k] -= 1;
        p2[k] += fs2[k];
        if (p2[k] >= 1) p2[k] -= 1;
        s += saw(p[k], fs[k]) + saw(p2[k], fs2[k]);
      }
      flt.tick(s);
      const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.06) : 1;
      ch[at + i] += sat(flt.lp * 0.8) * g * rel * Math.min(1, t * 500);
    }
  });
}

export interface BassNote {
  t: number;
  dur: number;
  midi: number;
  /** LFO cycles per second for wobble voices. */
  rate?: number;
  /** Semitones to slide from at the start of the note. */
  from?: number;
  /** Peak level, 1 by default. */
  vel?: number;
}

/** Plain sine sub that follows the bass line, centered. */
export function subLine(bus: Stereo, notes: BassNote[], gain: number, drive = 1.1): void {
  let ph = 0;
  for (const nt of notes) {
    const at = Math.round(nt.t * SR);
    const n = Math.min(Math.round(nt.dur * SR), bus.l.length - at);
    const env = gate(Math.max(n, 1), 0.003, 0.012);
    const f = mtof(nt.midi);
    const g = gain * (nt.vel ?? 1);
    for (let i = 0; i < n; i++) {
      ph += f / SR;
      if (ph >= 1) ph -= 1;
      const v = sat(Math.sin(TAU * ph) * drive) * env[i] * g;
      bus.l[at + i] += v;
      bus.r[at + i] += v;
    }
  }
}

/**
 * Dubstep growl: detuned saws plus a phase-modulated sine (the metallic part) into an LFO-swept
 * resonant lowpass, distortion, then two formant bandpasses that move with the LFO to make it talk.
 * Rendered above ~110 Hz; the sub layer is separate and stays mono.
 */
export function growl(bus: Stereo, notes: BassNote[], gain: number, drive: number, r: () => number): void {
  [bus.l, bus.r].forEach((ch, c) => {
    const lp = new SVF(400, 3.2);
    const f1 = new SVF(500, 4.5);
    const f2 = new SVF(1400, 5);
    const hp = new SVF(115, 0.7);
    const sgn = c ? 1 : -1;
    let p1 = r();
    let p2 = r();
    let p3 = r();
    let pf = r();
    for (const nt of notes) {
      const at = Math.round(nt.t * SR);
      const n = Math.min(Math.round(nt.dur * SR), ch.length - at);
      if (n <= 0) continue;
      const env = gate(n, 0.002, 0.01);
      const rate = nt.rate ?? 4;
      const base = mtof(nt.midi + 12);
      const slide = nt.from ?? 0;
      const g = gain * (nt.vel ?? 1);
      let shape = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        if (i % CTRL === 0) {
          const lfo = 0.5 - 0.5 * Math.cos(TAU * rate * t);
          shape = lfo * lfo * (3 - 2 * lfo);
          lp.set(170 * Math.pow(2, shape * 5.2), 3.2);
          f1.set(320 + 620 * shape, 4.5);
          f2.set(950 + 1750 * shape, 5);
        }
        const f = slide ? base * Math.pow(2, (slide / 12) * Math.exp(-t / 0.035)) : base;
        const dt = f / SR;
        const d1 = dt * (1 + 0.0065 * sgn);
        const d2 = dt * (1 - 0.0045 * sgn);
        p1 += d1;
        if (p1 >= 1) p1 -= 1;
        p2 += d2;
        if (p2 >= 1) p2 -= 1;
        p3 += dt * 0.5;
        if (p3 >= 1) p3 -= 1;
        pf += dt;
        if (pf >= 1) pf -= 1;
        const fm = Math.sin(TAU * pf + (0.8 + shape * 4.2) * Math.sin(TAU * pf * 2));
        const raw = saw(p1, d1) + saw(p2, d2) + square(p3, dt * 0.5) * 0.7 + fm * 0.9;
        lp.tick(sat(raw * drive));
        const y = sat(lp.lp * 1.8);
        f1.tick(y);
        f2.tick(y);
        hp.tick(y * 0.55 + f1.bp * 0.9 + f2.bp * 0.75);
        ch[at + i] += sat(hp.hp * 1.3) * env[i] * g;
      }
    }
  });
}

/** Reese: two pairs of slowly beating saws through a slowly moving lowpass. */
export function reese(bus: Stereo, notes: BassNote[], gain: number, drive: number, r: () => number): void {
  [bus.l, bus.r].forEach((ch, c) => {
    const lp = new SVF(900, 1.4);
    const notch = new SVF(600, 0.9);
    const hp = new SVF(95, 0.7);
    const sgn = c ? 1 : -1;
    let p1 = r();
    let p2 = r();
    let p3 = r();
    for (const nt of notes) {
      const at = Math.round(nt.t * SR);
      const n = Math.min(Math.round(nt.dur * SR), ch.length - at);
      if (n <= 0) continue;
      const env = gate(n, 0.003, 0.012);
      const base = mtof(nt.midi + 12);
      const rate = nt.rate ?? 1.2;
      const g = gain * (nt.vel ?? 1);
      for (let i = 0; i < n; i++) {
        const t = (at + i) / SR;
        if (i % CTRL === 0) {
          const lfo = 0.5 + 0.5 * Math.sin(TAU * rate * t + c * 0.8);
          lp.set(420 * Math.pow(2, lfo * 3.1), 1.4);
          notch.set(280 * Math.pow(2, (1 - lfo) * 2.6), 0.9);
        }
        const dt = base / SR;
        const d1 = dt * (1 + 0.011 * sgn);
        const d2 = dt * (1 - 0.0085 * sgn);
        p1 += d1;
        if (p1 >= 1) p1 -= 1;
        p2 += d2;
        if (p2 >= 1) p2 -= 1;
        p3 += dt;
        if (p3 >= 1) p3 -= 1;
        const raw = saw(p1, d1) + saw(p2, d2) + saw(p3, dt) * 0.7;
        lp.tick(sat(raw * drive));
        notch.tick(lp.lp);
        hp.tick(sat((lp.lp - notch.bp * 0.8) * 1.3));
        ch[at + i] += hp.hp * env[i] * g;
      }
    }
  });
}

/** 808: sine with a pitch slide between notes, driven until it has audible harmonics. */
export function bass808(bus: Stereo, notes: BassNote[], gain: number, drive: number): void {
  let ph = 0;
  for (const nt of notes) {
    const at = Math.round(nt.t * SR);
    const n = Math.min(Math.round(nt.dur * SR), bus.l.length - at);
    if (n <= 0) continue;
    const env = gate(n, 0.002, 0.03);
    const base = nt.midi;
    const slide = nt.from ?? 0;
    const tau = Math.max(0.25, nt.dur * 1.1);
    const g = gain * (nt.vel ?? 1);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      // A short click-pitch at the attack, then an optional glide into the note.
      const m = base + slide * Math.exp(-t / 0.06) + 7 * Math.exp(-t / 0.012);
      ph += mtof(m) / SR;
      if (ph >= 1) ph -= 1;
      const a = env[i] * Math.exp(-t / tau);
      const v = sat(Math.sin(TAU * ph) * drive * (0.4 + 0.6 * a)) * a * g;
      bus.l[at + i] += v;
      bus.r[at + i] += v;
    }
  }
}

/** Hardstyle reverse bass: a distorted tone swelling into the next kick. */
export function reverseBass(bus: Stereo, notes: BassNote[], gain: number, drive: number): void {
  [bus.l, bus.r].forEach((ch, c) => {
    const lp = new SVF(1400, 1.6);
    let ph = 0;
    let p2 = 0;
    for (const nt of notes) {
      const at = Math.round(nt.t * SR);
      const n = Math.min(Math.round(nt.dur * SR), ch.length - at);
      if (n <= 0) continue;
      const f = mtof(nt.midi);
      const dt = f / SR;
      const d2 = dt * (c ? 1.004 : 0.996);
      const g = gain * (nt.vel ?? 1);
      for (let i = 0; i < n; i++) {
        const x = i / n;
        if (i % CTRL === 0) lp.set(220 + 2600 * x * x, 1.6);
        ph += dt;
        if (ph >= 1) ph -= 1;
        p2 += d2;
        if (p2 >= 1) p2 -= 1;
        lp.tick(sat((saw(ph, dt) + saw(p2, d2) + Math.sin(TAU * ph) * 1.3) * drive));
        const amp = Math.pow(x, 1.4) * Math.min(1, (1 - x) * 60);
        ch[at + i] += sat(lp.lp * 1.6) * amp * g;
      }
    }
  });
}

/** Hardstyle screech: hard-driven detuned saws through a resonant bandpass with fast vibrato. */
export function screech(bus: Stereo, notes: BassNote[], gain: number, drive: number, r: () => number): void {
  [bus.l, bus.r].forEach((ch, c) => {
    const bp = new SVF(2200, 3);
    const hp = new SVF(500, 0.7);
    const sgn = c ? 1 : -1;
    let p1 = r();
    let p2 = r();
    for (const nt of notes) {
      const at = Math.round(nt.t * SR);
      const n = Math.min(Math.round(nt.dur * SR), ch.length - at);
      if (n <= 0) continue;
      const env = gate(n, 0.002, 0.02);
      const slide = nt.from ?? 0;
      const g = gain * (nt.vel ?? 1);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        if (i % CTRL === 0) bp.set(1700 + 1500 * (0.5 + 0.5 * Math.sin(TAU * 7 * t)), 3);
        const m = nt.midi + slide * Math.exp(-t / 0.05) + 0.45 * Math.sin(TAU * 11 * t) * clamp(t * 6, 0, 1);
        const dt = mtof(m) / SR;
        const d1 = dt * (1 + 0.009 * sgn);
        const d2 = dt * (1 - 0.007 * sgn);
        p1 += d1;
        if (p1 >= 1) p1 -= 1;
        p2 += d2;
        if (p2 >= 1) p2 -= 1;
        const x = sat((saw(p1, d1) + square(p2, d2)) * drive);
        bp.tick(x);
        hp.tick(sat((x * 0.45 + bp.bp * 1.3) * 1.6));
        ch[at + i] += hp.hp * env[i] * g;
      }
    }
  });
}

/** Warm mono saw lead with vibrato, for synthwave. */
export function lead(bus: Stereo, notes: BassNote[], gain: number, r: () => number): void {
  [bus.l, bus.r].forEach((ch, c) => {
    const lp = new SVF(3000, 1);
    let p1 = r();
    let p2 = r();
    for (const nt of notes) {
      const at = Math.round(nt.t * SR);
      const n = Math.min(Math.round(nt.dur * SR), ch.length - at);
      if (n <= 0) continue;
      const env = gate(n, 0.012, 0.05);
      const g = gain * (nt.vel ?? 1);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        if (i % CTRL === 0) lp.set(1100 + 3000 * Math.exp(-t / 0.2), 1);
        const m = nt.midi + 0.12 * Math.sin(TAU * 5.3 * t) * clamp(t * 3 - 0.3, 0, 1);
        const dt = mtof(m) / SR;
        const d2 = dt * (c ? 1.004 : 0.996);
        p1 += dt;
        if (p1 >= 1) p1 -= 1;
        p2 += d2;
        if (p2 >= 1) p2 -= 1;
        lp.tick(saw(p1, dt) + saw(p2, d2));
        ch[at + i] += lp.lp * env[i] * g;
      }
    }
  });
}

/** Saw bass with a tight filter pluck, for synthwave eighths. */
export function pulseBass(bus: Stereo, notes: BassNote[], gain: number, r: () => number): void {
  const flt = new SVF(800, 1);
  let ph = r();
  let p2 = r();
  for (const nt of notes) {
    const at = Math.round(nt.t * SR);
    const n = Math.min(Math.round(nt.dur * SR), bus.l.length - at);
    if (n <= 0) continue;
    const env = gate(n, 0.002, 0.012);
    const f = mtof(nt.midi);
    const dt = f / SR;
    const d2 = dt * 1.004;
    const g = gain * (nt.vel ?? 1);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (i % CTRL === 0) flt.set(160 + 1500 * Math.exp(-t / 0.07), 1.1);
      ph += dt;
      if (ph >= 1) ph -= 1;
      p2 += d2;
      if (p2 >= 1) p2 -= 1;
      flt.tick(saw(ph, dt) + saw(p2, d2) + Math.sin(TAU * ph));
      const v = sat(flt.lp * 1.3) * env[i] * g;
      bus.l[at + i] += v;
      bus.r[at + i] += v;
    }
  }
}
