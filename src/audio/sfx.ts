/** Procedural sound effects. Each one is a pure function of (id, seed) with a fixed length. */
import type { SfxId } from '../core/types';
import {
  SR, SVF, TAU, addMono, clamp, convolveHalfRate, edgeFade, type F32, filter, fork, lerp, makeIR, mixStereo, mtof, noise,
  normalize, sat, saw, square, stereo, sweep, type Stereo,
} from './dsp';
import { crash, hat, noiseRise, reversed, snare, subFall } from './instruments';

/** Length of each effect in seconds; these match SFX_LIST in core/schema. */
export const SFX_DURATION: Record<SfxId, number> = {
  whoosh: 0.7, whooshLong: 2, impact: 2.5, boom: 3, subDrop: 2, riser: 4, reverseCymbal: 2, snareRoll: 2,
  glitch: 0.5, stutter: 0.6, zap: 0.4, tapeStop: 1, shimmer: 3, metalHit: 1.5,
};

type Rand = () => number;
const len = (id: SfxId) => Math.round(SFX_DURATION[id] * SR);

function reverb(dry: Stereo, seconds: number, wet: number, seed: number, brightness = 7000): void {
  const send = new Float32Array(dry.l.length);
  for (let i = 0; i < send.length; i++) send[i] = (dry.l[i] + dry.r[i]) * 0.5;
  mixStereo(dry, convolveHalfRate(send, makeIR(seconds, { seed, brightness, halfRate: true })), wet);
}

function whooshCore(r: Rand, n: number): Stereo {
  const out = stereo(n);
  const secs = n / SR;
  const dir = r() < 0.5 ? -1 : 1;
  const peakAt = 0.45 + r() * 0.2;
  const lo = 240 + r() * 200;
  const hi = 2400 + r() * 2800;
  const body = noise(n, r);
  const bell = (x: number) => (x < peakAt ? x / peakAt : (1 - x) / (1 - peakAt));
  sweep(body, 'bp', (t) => lo * Math.pow(hi / lo, bell(clamp(t / secs, 0, 1))), 1.4);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const b = bell(x);
    const v = body[i] * b * b * (3 - 2 * b);
    const a = ((clamp(dir * (x * 2 - 1) * 0.9, -1, 1) + 1) * Math.PI) / 4;
    out.l[i] = v * Math.cos(a) * Math.SQRT2;
    out.r[i] = v * Math.sin(a) * Math.SQRT2;
  }
  return out;
}

function whoosh(r: Rand, seed: number): Stereo {
  const out = whooshCore(r, len('whoosh'));
  reverb(out, 0.5, 0.2, seed);
  return out;
}

function whooshLong(r: Rand, seed: number): Stereo {
  const n = len('whooshLong');
  const out = whooshCore(r, n);
  // Low rumble that follows the same swell.
  const rumble = noise(n, r);
  filter(rumble, 'lp', 160, 1);
  for (let i = 0; i < n; i++) rumble[i] *= 1.2 * Math.sin((Math.PI * i) / n);
  addMono(out, rumble, 0, 1);
  reverb(out, 0.9, 0.25, seed);
  return out;
}

function impact(r: Rand, seed: number): Stereo {
  const n = len('impact');
  const out = stereo(n);
  addMono(out, subFall(2, 125 + r() * 25, 36, 0.07, 1.5), 0, 0.9);
  // Mid crack.
  const crack = noise(Math.round(0.12 * SR), r);
  filter(crack, 'bp', 1400 + r() * 500, 0.8);
  for (let i = 0; i < crack.length; i++) crack[i] *= 2.4 * Math.exp(-i / SR / 0.02);
  addMono(out, crack, 0, 1);
  const air = noise(Math.round(0.7 * SR), r);
  sweep(air, 'lp', (t) => 7000 * Math.exp(-t * 6) + 180, 0.8);
  for (let i = 0; i < air.length; i++) air[i] *= Math.exp(-i / SR / 0.15);
  edgeFade(air, 0, 0.02);
  addMono(out, air, 0, 0.7);
  reverb(out, 2.2, 0.55, seed, 5000);
  return out;
}

function boom(r: Rand): Stereo {
  const n = len('boom');
  const out = stereo(n);
  addMono(out, subFall(3, 95 + r() * 20, 26 + r() * 6, 0.16, 1.6), 0, 1);
  const rumble = noise(n, r);
  sweep(rumble, 'lp', (t) => 420 * Math.exp(-t * 2.2) + 50, 1);
  for (let i = 0; i < n; i++) rumble[i] *= 1.3 * Math.exp(-i / SR / 0.5);
  addMono(out, rumble, 0, 1);
  return out;
}

function subDrop(r: Rand): Stereo {
  const n = len('subDrop');
  const out = stereo(n);
  const b = new Float32Array(n);
  const f0 = 78 + r() * 6;
  const f1 = 24 + r() * 3;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    ph += (f0 * Math.pow(f1 / f0, Math.pow(x, 0.7))) / SR;
    b[i] = sat(Math.sin(TAU * ph) * 1.4) * Math.min(1, x * 60) * Math.pow(1 - x, 1.1);
  }
  edgeFade(b, 0.002, 0.02);
  addMono(out, b, 0, 1);
  return out;
}

function riser(r: Rand): Stereo {
  const n = len('riser');
  const secs = n / SR;
  const out = noiseRise(r, secs, 350, 11000);
  const tone = new Float32Array(n);
  const f0 = 110 * (1 + r() * 0.25);
  const voices = [1, 1.008, 1.5];
  const ph = voices.map(() => r());
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const f = f0 * Math.pow(8, x * x);
    let s = 0;
    for (let k = 0; k < 3; k++) {
      const dt = (f * voices[k]) / SR;
      ph[k] += dt;
      if (ph[k] >= 1) ph[k] -= 1;
      s += saw(ph[k], dt);
    }
    tone[i] = s * x * x * 0.35;
  }
  sweep(tone, 'hp', (t) => 120 * Math.pow(30, clamp(t / secs, 0, 1)), 1.2);
  addMono(out, tone, 0, 1);
  edgeFade(out.l, 0.005, 0.015);
  edgeFade(out.r, 0.005, 0.015);
  return out;
}

function reverseCymbal(r: Rand, seed: number): Stereo {
  const n = len('reverseCymbal');
  const out = stereo(n);
  const a = reversed(crash(r, n / SR, 0));
  const b = reversed(crash(fork(seed, 'rc2'), n / SR, 0));
  for (let i = 0; i < n; i++) {
    out.l[i] = a[i] * 0.8 + b[i] * 0.2;
    out.r[i] = a[i] * 0.2 + b[i] * 0.8;
  }
  edgeFade(out.l, 0.01, 0.002);
  edgeFade(out.r, 0.01, 0.002);
  return out;
}

function snareRoll(r: Rand, seed: number): Stereo {
  const n = len('snareRoll');
  const out = stereo(n);
  const hit = snare(r, { tone: 215 + r() * 40, tail: 0.055, snap: 0.8 });
  const secs = n / SR;
  let t = 0;
  while (t < secs - 0.02) {
    const x = t / secs;
    addMono(out, hit, Math.round(t * SR), lerp(0.25, 1, x * x), (r() - 0.5) * 0.15);
    t += lerp(0.25, 0.028, Math.pow(x, 0.7));
  }
  reverb(out, 0.7, 0.18, seed);
  return out;
}

/** Bit depth and sample-rate reduction of a short tone fragment. */
function crushed(r: Rand, n: number): F32 {
  const b = new Float32Array(n);
  const steps = 3 + Math.floor(r() * 12);
  const hold = 2 + Math.floor(r() * 24);
  const f = 180 + r() * 2600;
  const mod = 20 + r() * 400;
  let ph = 0;
  let held = 0;
  for (let i = 0; i < n; i++) {
    const dt = (f * (1 + 0.5 * Math.sin((TAU * mod * i) / SR))) / SR;
    ph += dt;
    if (ph >= 1) ph -= 1;
    if (i % hold === 0) held = Math.round((square(ph, dt) * 0.6 + (r() * 2 - 1) * 0.5) * steps) / steps;
    b[i] = held;
  }
  edgeFade(b, 0.0006, 0.0015);
  return b;
}

function glitch(r: Rand): Stereo {
  const n = len('glitch');
  const out = stereo(n);
  let at = 0;
  while (at < n - 600) {
    const size = Math.round((0.012 + r() * 0.05) * SR);
    const frag = crushed(r, size);
    const repeats = 1 + Math.floor(r() * 4);
    const pan = (r() - 0.5) * 1.6;
    for (let k = 0; k < repeats && at < n; k++) {
      addMono(out, frag, at, 0.5 + r() * 0.5, pan);
      at += Math.round(size * (0.9 + r() * 0.3));
    }
    if (r() < 0.3) at += Math.round(r() * 0.03 * SR);
  }
  return out;
}

function stutter(r: Rand): Stereo {
  const n = len('stutter');
  const out = stereo(n);
  const base = 55 + Math.floor(r() * 7);
  const frag = new Float32Array(Math.round(0.07 * SR));
  const notes = [0, 3, 7].map((d) => mtof(base + d));
  const ph = notes.map(() => r());
  for (let i = 0; i < frag.length; i++) {
    let s = 0;
    for (let k = 0; k < 3; k++) {
      const dt = notes[k] / SR;
      ph[k] += dt;
      if (ph[k] >= 1) ph[k] -= 1;
      s += saw(ph[k], dt);
    }
    frag[i] = s * 0.45;
  }
  filter(frag, 'lp', 4200, 1);
  edgeFade(frag, 0.001, 0.003);
  // Retriggers tighten towards the end, like a sampler gate.
  let t = 0;
  const secs = n / SR;
  let i = 0;
  while (t < secs - 0.02) {
    const x = t / secs;
    const slice = frag.subarray(0, Math.round(frag.length * lerp(1, 0.32, x)));
    addMono(out, slice as F32, Math.round(t * SR), lerp(1, 0.75, x), i % 2 ? 0.25 : -0.25);
    t += lerp(0.075, 0.024, x);
    i++;
  }
  return out;
}

function zap(r: Rand): Stereo {
  const n = len('zap');
  const out = stereo(n);
  const b = new Float32Array(n);
  const f0 = 3200 + r() * 2400;
  const f1 = 70 + r() * 60;
  const useSquare = r() < 0.5;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const dt = (f1 + (f0 - f1) * Math.exp(-x * 9)) / SR;
    ph += dt;
    if (ph >= 1) ph -= 1;
    b[i] = (useSquare ? square(ph, dt) : saw(ph, dt)) * Math.pow(1 - x, 1.5);
  }
  filter(b, 'lp', 8000, 0.9);
  edgeFade(b, 0.001, 0.01);
  addMono(out, b, 0, 1);
  return out;
}

function tapeStop(r: Rand): Stereo {
  const n = len('tapeStop');
  const out = stereo(n);
  const base = 45 + Math.floor(r() * 7);
  const notes = [0, 7, 12, 15, 19].map((d) => mtof(base + d));
  const pl = notes.map(() => r());
  const f = new SVF(5000, 0.8);
  const f2 = new SVF(5000, 0.8);
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const speed = Math.pow(1 - x, 2.2);
    if ((i & 31) === 0) {
      f.set(150 + 5000 * speed, 0.8);
      f2.set(150 + 5000 * speed, 0.8);
    }
    let s = 0;
    for (let k = 0; k < notes.length; k++) {
      const dt = (notes[k] * speed) / SR;
      pl[k] += dt;
      if (pl[k] >= 1) pl[k] -= 1;
      s += saw(pl[k], Math.max(dt, 1e-5));
    }
    p2 += (55 * speed) / SR;
    if (p2 >= 1) p2 -= 1;
    const amp = Math.min(1, (1 - x) * 8);
    f.tick(s * 0.3);
    f2.tick(s * 0.3 + Math.sin(TAU * p2) * 0.3);
    out.l[i] = sat(f.lp) * amp;
    out.r[i] = sat(f2.lp) * amp;
  }
  edgeFade(out.l, 0.002, 0.02);
  edgeFade(out.r, 0.002, 0.02);
  return out;
}

function shimmer(r: Rand, seed: number): Stereo {
  const n = len('shimmer');
  const out = stereo(n);
  const base = 72 + Math.floor(r() * 7);
  const scale = [0, 3, 7, 10, 12, 14, 19, 24, 26, 31];
  const count = 22;
  for (let k = 0; k < count; k++) {
    const m = base + scale[Math.floor(r() * scale.length)];
    const f = mtof(m) * (1 + (r() - 0.5) * 0.002);
    const at = r() * 1.2;
    const dec = 0.35 + r() * 0.7;
    const size = Math.min(Math.round(dec * 4 * SR), n - Math.round(at * SR));
    const b = new Float32Array(size);
    // Rotating phasors instead of sin() per sample: this is the hot loop of the effect.
    const c1 = Math.cos((TAU * f) / SR);
    const s1 = Math.sin((TAU * f) / SR);
    const c2 = Math.cos((TAU * f * 2.76) / SR);
    const s2 = Math.sin((TAU * f * 2.76) / SR);
    const decay = Math.exp(-1 / (dec * SR));
    const decay2 = Math.exp(-7 / SR);
    let x1 = 1;
    let y1 = 0;
    let x2 = 1;
    let y2 = 0;
    let amp = 1;
    let amp2 = 0.4;
    for (let i = 0; i < size; i++) {
      b[i] = (y1 + y2 * amp2) * amp * Math.min(1, i / 120);
      const a1 = x1 * c1 - y1 * s1;
      y1 = x1 * s1 + y1 * c1;
      x1 = a1;
      const a2 = x2 * c2 - y2 * s2;
      y2 = x2 * s2 + y2 * c2;
      x2 = a2;
      amp *= decay;
      amp2 *= decay2;
    }
    edgeFade(b, 0, 0.02);
    addMono(out, b, Math.round(at * SR), 0.16, (r() - 0.5) * 1.6);
  }
  reverb(out, 2.4, 1.2, seed, 11000);
  for (const ch of [out.l, out.r]) {
    filter(ch, 'hp', 350);
    edgeFade(ch, 0, 0.3);
  }
  return out;
}

function metalHit(r: Rand, seed: number): Stereo {
  const n = len('metalHit');
  const out = stereo(n);
  const f0 = 340 + r() * 260;
  const ratios = [1, 1.47, 2.09, 2.56, 3.14, 3.9, 4.73, 5.61, 6.8, 8.21];
  for (let k = 0; k < ratios.length; k++) {
    const f = f0 * ratios[k] * (1 + (r() - 0.5) * 0.015);
    const tau = 0.55 / (1 + k * 0.32);
    const b = new Float32Array(n);
    let ph = r();
    for (let i = 0; i < n; i++) {
      ph += f / SR;
      if (ph >= 1) ph -= 1;
      b[i] = Math.sin(TAU * ph) * Math.exp(-i / SR / tau);
    }
    addMono(out, b, 0, 0.22, (k % 2 ? 1 : -1) * 0.25);
  }
  const clank = hat(r, 0.03);
  addMono(out, clank, 0, 1.1);
  reverb(out, 1.2, 0.35, seed, 8000);
  return out;
}

export function renderSfx(id: SfxId, seed: number): Stereo {
  const r = fork(seed, id);
  let out: Stereo;
  switch (id) {
    case 'whoosh': out = whoosh(r, seed); break;
    case 'whooshLong': out = whooshLong(r, seed); break;
    case 'impact': out = impact(r, seed); break;
    case 'boom': out = boom(r); break;
    case 'subDrop': out = subDrop(r); break;
    case 'riser': out = riser(r); break;
    case 'reverseCymbal': out = reverseCymbal(r, seed); break;
    case 'snareRoll': out = snareRoll(r, seed); break;
    case 'glitch': out = glitch(r); break;
    case 'stutter': out = stutter(r); break;
    case 'zap': out = zap(r); break;
    case 'tapeStop': out = tapeStop(r); break;
    case 'shimmer': out = shimmer(r, seed); break;
    case 'metalHit': out = metalHit(r, seed); break;
  }
  edgeFade(out.l, 0, 0.004);
  edgeFade(out.r, 0, 0.004);
  normalize(out, 0.89);
  return out;
}
