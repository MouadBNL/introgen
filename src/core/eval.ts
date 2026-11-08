import type { Band, BandEnvelopes, Bezier, Ease, Keyframe, Layer, Project, PropValue, SyncHit, Track } from './types';
import { noise1, wiggleNoise } from './rng';

export const EASE_PRESETS: { id: string; label: string; ease: Ease }[] = [
  { id: 'linear', label: 'Linear', ease: 'linear' },
  { id: 'hold', label: 'Hold', ease: 'hold' },
  { id: 'smooth', label: 'Easy Ease', ease: [0.33, 0, 0.67, 1] },
  { id: 'in', label: 'Ease In', ease: [0.6, 0, 1, 1] },
  { id: 'out', label: 'Ease Out', ease: [0, 0, 0.3, 1] },
  { id: 'snap', label: 'Snap', ease: [0.05, 0.9, 0.1, 1] },
  { id: 'whip', label: 'Whip', ease: [0.85, 0, 0.1, 1] },
  { id: 'slam', label: 'Slam', ease: [0.9, 0, 1, 0.4] },
  { id: 'overshoot', label: 'Overshoot', ease: [0.2, 1.5, 0.4, 1] },
];

/** Solve a CSS cubic-bezier for y at x. */
export function bezierAt(b: Bezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = b;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  let u = x;
  for (let i = 0; i < 8; i++) {
    const e = ((ax * u + bx) * u + cx) * u - x;
    if (Math.abs(e) < 1e-5) break;
    const d = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(d) < 1e-6) break;
    u -= e / d;
  }
  if (u < 0 || u > 1) {
    let lo = 0, hi = 1;
    u = x;
    for (let i = 0; i < 24; i++) {
      const e = ((ax * u + bx) * u + cx) * u;
      if (e < x) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
  }
  return ((ay * u + by) * u + cy) * u;
}

export function easeValue(e: Ease, x: number): number {
  if (e === 'linear') return x;
  if (e === 'hold') return 0;
  return bezierAt(e, x);
}

export function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1, 7), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(a: PropValue, b: PropValue, k: number): PropValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * k;
  if (typeof a === 'string' && typeof b === 'string') {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
  }
  return k < 1 ? a : b;
}

export function evalKeys(keys: Keyframe[], t: number): PropValue {
  const n = keys.length;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[n - 1].t) return keys[n - 1].v;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (keys[m].t <= t) lo = m; else hi = m;
  }
  const a = keys[lo], b = keys[hi];
  if (a.ease === 'hold') return a.v;
  const k = easeValue(a.ease, (t - a.t) / Math.max(1e-6, b.t - a.t));
  return mix(a.v, b.v, k);
}

export function envelopeAt(env: BandEnvelopes | null | undefined, band: Band, t: number): number {
  if (!env) return 0;
  const arr = env[band];
  if (!arr || arr.length === 0) return 0;
  const x = t * env.rate;
  const i = Math.floor(x);
  if (i < 0) return arr[0];
  if (i >= arr.length - 1) return arr[arr.length - 1];
  return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
}

/** Keyframes, then wiggle, then the audio link. */
export function evalTrack(tr: Track, t: number, env?: BandEnvelopes | null): PropValue {
  let v = tr.keys.length ? evalKeys(tr.keys, t) : tr.value;
  if (typeof v === 'number') {
    if (tr.wiggle && tr.wiggle.amp !== 0) v += wiggleNoise(t, tr.wiggle.freq, tr.wiggle.seed) * tr.wiggle.amp;
    if (tr.audio && tr.audio.amount !== 0) v += envelopeAt(env, tr.audio.band, t) * tr.audio.amount;
  }
  return v;
}

export type Values = Record<string, any>;

export function evalLayer(layer: Layer, t: number, env?: BandEnvelopes | null): Values {
  const out: Values = {};
  for (const k in layer.props) out[k] = evalTrack(layer.props[k], t, env);
  return out;
}

export function layerActive(l: Layer, t: number): boolean {
  return t >= l.start && t < l.end;
}

/** Everything sync hits add on top of the camera and post stack at time t. */
export interface SyncState {
  shakeX: number; shakeY: number; shakeRoll: number;
  zoom: number;   // multiplies frame zoom
  whipX: number;  // frame offset
  whipBlur: number;
  flash: number; rgb: number; invert: number; hue: number; bars: number; glitch: number; blur: number;
}

export function emptySync(): SyncState {
  return { shakeX: 0, shakeY: 0, shakeRoll: 0, zoom: 1, whipX: 0, whipBlur: 0, flash: 0, rgb: 0, invert: 0, hue: 0, bars: 0, glitch: 0, blur: 0 };
}

const LOOKBACK = 3;

export function evalSync(hits: SyncHit[], t: number): SyncState {
  const s = emptySync();
  for (const h of hits) {
    const age = t - h.t;
    if (age < 0 || age > h.dur || age > LOOKBACK) continue;
    const u = age / Math.max(1e-4, h.dur);
    const d = 1 - u;
    const A = h.amount;
    switch (h.kind) {
      case 'shake': {
        const seed = h.t * 13.7;
        const dec = d * d * A;
        s.shakeX += noise1(age * 34, seed) * 0.35 * dec;
        s.shakeY += noise1(age * 31 + 5, seed + 1) * 0.35 * dec;
        s.shakeRoll += noise1(age * 27 + 9, seed + 2) * 5 * dec;
        break;
      }
      case 'punch': {
        // Snaps in within two frames, then springs back with a little overshoot.
        const spring = Math.exp(-u * 5) * Math.cos(u * 9);
        s.zoom *= 1 + 0.3 * A * spring * Math.min(1, age * 60);
        break;
      }
      case 'whip': {
        const sign = Math.floor(h.t * 977) % 2 ? 1 : -1;
        s.whipX += sign * Math.pow(d, 3) * 0.55 * A;
        s.whipBlur += Math.pow(d, 2) * A;
        break;
      }
      case 'flash': s.flash = Math.max(s.flash, Math.pow(d, 2.2) * Math.min(1, A)); break;
      case 'rgb': s.rgb += Math.pow(d, 1.5) * 3 * A; break;
      case 'invert': s.invert = 1; break;
      case 'hue': s.hue += 150 * A; break;
      case 'bars': s.bars = Math.max(s.bars, Math.pow(d, 0.4) * 0.5 * A); break;
      case 'glitch': s.glitch += d * 1.3 * A; break;
      case 'blur': s.blur += Math.pow(d, 2) * A; break;
    }
  }
  return s;
}

export function beatDuration(p: Pick<Project, 'bpm'>): number {
  return 60 / Math.max(1, p.bpm);
}

/** Snap to the nearest subdivision of the beat grid. div=4 means 1/16 notes. */
export function snapToBeat(p: Pick<Project, 'bpm' | 'beatOffset'>, t: number, div = 4): number {
  const step = beatDuration(p) / div;
  return p.beatOffset + Math.round((t - p.beatOffset) / step) * step;
}

export function snapToFrame(fps: number, t: number): number {
  return Math.round(t * fps) / fps;
}

export function formatTimecode(t: number, fps: number): string {
  const whole = Math.max(0, t);
  const s = Math.floor(whole + 1e-6);
  const f = Math.floor((whole - s) * fps + 1e-4);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}
