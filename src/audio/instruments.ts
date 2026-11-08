/** One-shot sample generators shared by the music generator and the SFX library. */
import { type F32, SR, SVF, TAU, clamp, edgeFade, filter, sat, stereo, sweep, type Stereo } from './dsp';

export interface KickOpts {
  f0?: number; f1?: number; pitchTau?: number; ampTau?: number; len?: number;
  click?: number; drive?: number;
}

/** Sine with an exponential pitch drop, click transient and saturation. Sound starts at sample 0. */
export function kick(r: () => number, o: KickOpts = {}): F32 {
  const { f0 = 190, f1 = 50, pitchTau = 0.03, ampTau = 0.14, len = 0.42, click = 0.45, drive = 1.8 } = o;
  const n = Math.round(len * SR);
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (f1 + (f0 - f1) * Math.exp(-t / pitchTau)) / SR;
    const body = Math.sin(TAU * ph) * Math.exp(-t / ampTau);
    const tick = (r() * 2 - 1) * click * Math.exp(-t / 0.0022);
    b[i] = sat((body + tick) * drive);
  }
  edgeFade(b, 0, 0.01);
  return b;
}

export function snare(r: () => number, o: { tone?: number; tail?: number; snap?: number } = {}): F32 {
  const { tone = 195, tail = 0.09, snap = 1 } = o;
  const n = Math.round((tail * 4 + 0.05) * SR);
  const b = new Float32Array(n);
  const hp = new SVF(1400, 0.8);
  const lp = new SVF(11000, 0.7);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const pitch = 1 + 0.7 * Math.exp(-t / 0.012);
    p1 += (tone * pitch) / SR;
    p2 += (tone * 1.72 * pitch) / SR;
    const body = (Math.sin(TAU * p1) + 0.55 * Math.sin(TAU * p2)) * Math.exp(-t / 0.055);
    hp.tick(r() * 2 - 1);
    lp.tick(hp.hp);
    const nz = lp.lp * Math.exp(-t / tail) * (1 + snap * 2 * Math.exp(-t / 0.006));
    b[i] = sat(body * 0.85 + nz * 1.25);
  }
  edgeFade(b, 0, 0.01);
  return b;
}

export function clap(r: () => number): F32 {
  const n = Math.round(0.34 * SR);
  const b = new Float32Array(n);
  const f = new SVF(1500, 1.4);
  const bursts = [0, 0.011, 0.021, 0.033];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0;
    for (const s of bursts) if (t >= s) env = Math.max(env, Math.exp(-(t - s) / (s === 0.033 ? 0.075 : 0.006)));
    f.tick((r() * 2 - 1) * env);
    b[i] = sat(f.bp * 3.2);
  }
  edgeFade(b, 0, 0.01);
  return b;
}

/** Six inharmonic squares (808 metal stack) through a highpass. */
export function hat(r: () => number, tau: number): F32 {
  const n = Math.round(Math.min(tau * 6, 1) * SR);
  const b = new Float32Array(n);
  const fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 2.4);
  const ph = fr.map(() => r());
  const f = new SVF(7500, 0.9);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = (r() * 2 - 1) * 0.7;
    for (let k = 0; k < 6; k++) {
      ph[k] += fr[k] / SR;
      if (ph[k] >= 1) ph[k] -= 1;
      s += ph[k] < 0.5 ? 0.22 : -0.22;
    }
    f.tick(s);
    b[i] = f.hp * Math.exp(-t / tau) * Math.min(1, t * 3000 + 0.3);
  }
  edgeFade(b, 0, 0.003);
  return b;
}

/** Long noisy crash. Mono; pan or reverse it at the call site. */
export function crash(r: () => number, seconds: number, transient = 1.5): F32 {
  const n = Math.round(seconds * SR);
  const b = new Float32Array(n);
  const hp = new SVF(3200, 0.7);
  const fr = [3120, 4410, 5230, 6810, 8170, 9630];
  const ph = fr.map(() => r());
  const wob = fr.map(() => 1);
  const tau = seconds / 5;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = (r() * 2 - 1) * 0.9;
    if ((i & 63) === 0) for (let k = 0; k < 6; k++) wob[k] = 1 + 0.04 * Math.sin(t * 19 + k);
    for (let k = 0; k < 6; k++) {
      ph[k] += (fr[k] * wob[k]) / SR;
      if (ph[k] >= 1) ph[k] -= 1;
      s += ph[k] < 0.5 ? 0.1 : -0.1;
    }
    hp.tick(s);
    b[i] = hp.hp * Math.exp(-t / tau) * (1 + transient * Math.exp(-t / 0.02));
  }
  edgeFade(b, 0, 0.02);
  return b;
}

export function reversed(b: F32): F32 {
  const out = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[b.length - 1 - i];
  return out;
}

/** Sub-bass fall. Used as the body of every impact. */
export function subFall(seconds: number, f0: number, f1: number, tau: number, drive = 1.2): F32 {
  const n = Math.round(seconds * SR);
  const b = new Float32Array(n);
  let ph = 0;
  const ampTau = seconds / 3.2;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (f1 + (f0 - f1) * Math.exp(-t / tau)) / SR;
    b[i] = sat(Math.sin(TAU * ph) * drive) * Math.exp(-t / ampTau);
  }
  edgeFade(b, 0, 0.02);
  return b;
}

/** Noise swell over `seconds`: bandpass climbing from f0 to f1 and level rising to full. */
export function noiseRise(r: () => number, seconds: number, f0: number, f1: number): Stereo {
  const n = Math.round(seconds * SR);
  const out = stereo(n);
  const fc = (t: number) => f0 * Math.pow(f1 / f0, clamp(t / seconds, 0, 1));
  for (const ch of [out.l, out.r]) {
    for (let i = 0; i < n; i++) ch[i] = r() * 2 - 1;
    sweep(ch, 'bp', fc, 1.1);
    filter(ch, 'hp', 180);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      ch[i] *= 1.4 * x * x * (0.5 + 0.5 * x);
    }
  }
  return out;
}
