/** Band envelopes, waveform peaks and onset detection. */
import type { Band, BandEnvelopes } from '../core/types';
import { type F32, SVF, clamp } from './dsp';

export const ENV_RATE = 120;

export interface Analysis {
  env: BandEnvelopes;
  /** Raw per-hop RMS of each band, before normalization and release smoothing. */
  raw: Record<Band, F32>;
}

function percentile(x: F32, p: number): number {
  const s = Float32Array.from(x).sort();
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

/** Normalizes by the 98th percentile, then applies instant attack and ~80 ms release. */
function shape(raw: F32): F32 {
  const out = new Float32Array(raw.length);
  const ref = percentile(raw, 0.98);
  if (ref < 1e-5) return out;
  const rel = Math.exp(-1 / (ENV_RATE * 0.08));
  let y = 0;
  for (let i = 0; i < raw.length; i++) {
    const v = clamp(raw[i] / ref, 0, 1);
    y = v > y ? v : v + (y - v) * rel;
    out[i] = y;
  }
  return out;
}

/** Bands from a mixed buffer. `frames` is the number of envelope samples to produce. */
export function analyze(l: F32, r: F32, sampleRate: number, duration: number): Analysis {
  const frames = Math.max(1, Math.ceil(duration * ENV_RATE));
  const hop = sampleRate / ENV_RATE;
  const raw: Record<Band, F32> = {
    low: new Float32Array(frames), mid: new Float32Array(frames),
    high: new Float32Array(frames), full: new Float32Array(frames),
  };
  // Two cascaded 12 dB/oct stages per edge.
  const lowHp = new SVF(20, 0.707);
  const lowLp1 = new SVF(150, 0.707);
  const lowLp2 = new SVF(150, 0.707);
  const midHp1 = new SVF(150, 0.707);
  const midHp2 = new SVF(150, 0.707);
  const midLp1 = new SVF(2500, 0.707);
  const midLp2 = new SVF(2500, 0.707);
  const hiHp1 = new SVF(2500, 0.707);
  const hiHp2 = new SVF(2500, 0.707);
  const n = Math.min(l.length, Math.round(duration * sampleRate));
  let sl = 0;
  let sm = 0;
  let sh = 0;
  let sf = 0;
  let count = 0;
  let frame = 0;
  let next = hop;
  const flush = () => {
    if (frame < frames && count) {
      raw.low[frame] = Math.sqrt(sl / count);
      raw.mid[frame] = Math.sqrt(sm / count);
      raw.high[frame] = Math.sqrt(sh / count);
      raw.full[frame] = Math.sqrt(sf / count);
    }
    frame++;
    sl = sm = sh = sf = count = 0;
  };
  for (let i = 0; i < n; i++) {
    const x = (l[i] + r[i]) * 0.5;
    lowHp.tick(x);
    lowLp1.tick(lowHp.hp);
    lowLp2.tick(lowLp1.lp);
    midHp1.tick(x);
    midHp2.tick(midHp1.hp);
    midLp1.tick(midHp2.hp);
    midLp2.tick(midLp1.lp);
    hiHp1.tick(x);
    hiHp2.tick(hiHp1.hp);
    const a = lowLp2.lp;
    const b = midLp2.lp;
    const c = hiHp2.hp;
    sl += a * a;
    sm += b * b;
    sh += c * c;
    sf += x * x;
    count++;
    if (i + 1 >= next) {
      flush();
      next += hop;
    }
  }
  if (count) flush();
  return {
    raw,
    env: {
      rate: ENV_RATE,
      low: shape(raw.low), mid: shape(raw.mid), high: shape(raw.high), full: shape(raw.full),
    },
  };
}

/**
 * Onset times from log-energy rise, with an adaptive local threshold and a minimum gap.
 * `span` is the energy window in hops: a low band needs several, because an 8 ms window of a 50 Hz
 * wave follows the waveform rather than its envelope. Slower rises (sidechain recovery, swells) score
 * low, and each candidate must also stand up against the strongest onset nearby, so bass notes
 * under a kick don't trigger on their own.
 */
export function onsets(raw: F32, rate: number, sensitivity = 1, span = 1, minGap = 0.09): number[] {
  const n = raw.length;
  if (n < span + 3) return [];
  const ref = percentile(raw, 0.98);
  if (ref < 1e-5) return [];
  const g = 30 / ref;
  const sens = Math.max(0.1, sensitivity);
  const level = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += raw[i] * raw[i];
    if (i >= span) acc -= raw[i - span] * raw[i - span];
    level[i] = Math.log1p(Math.sqrt(Math.max(0, acc) / span) * g);
  }
  const flux = new Float32Array(n);
  for (let i = span; i < n; i++) flux[i] = Math.max(0, level[i] - level[i - span]);

  const w = Math.round(rate * 0.4); // +-400 ms of context
  const k = 2 / sens;
  const floor = 0.18 / sens;
  const dominance = Math.min(0.9, 0.55 / sens);
  const gap = Math.round(minGap * rate);
  // Running sums keep the window statistics O(n).
  const sum = new Float64Array(n + 1);
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    sum[i + 1] = sum[i] + flux[i];
    sq[i + 1] = sq[i] + flux[i] * flux[i];
  }
  const out: number[] = [];
  let last = -gap;
  for (let i = 1; i < n - 1; i++) {
    const v = flux[i];
    if (v < floor || v < flux[i - 1] || v < flux[i + 1]) continue;
    const a = Math.max(0, i - w);
    const b = Math.min(n, i + w + 1);
    const m = (sum[b] - sum[a]) / (b - a);
    const sd = Math.sqrt(Math.max(0, (sq[b] - sq[a]) / (b - a) - m * m));
    if (v < m + k * sd) continue;
    let top = 0;
    for (let j = a; j < b; j++) if (flux[j] > top) top = flux[j];
    if (v < top * dominance) continue;
    const at = i - span + 1; // the rise completes one window after the attack
    if (at - last < gap) continue;
    out.push(at / rate);
    last = at;
  }
  return out;
}

/**
 * A pitched kick only reaches the low band tens of milliseconds after its click, so low-band
 * onsets are moved back onto the sharpest full-band rise just before them.
 */
export function snapToAttack(times: number[], full: F32, rate: number, lookBack = 0.05): number[] {
  const back = Math.round(lookBack * rate);
  return times.map((t) => {
    const i = Math.round(t * rate);
    let best = i;
    let top = 0;
    for (let j = Math.max(1, i - back); j <= Math.min(full.length - 1, i + 1); j++) {
      const rise = full[j] - full[j - 1];
      if (rise > top) {
        top = rise;
        best = j;
      }
    }
    return best / rate;
  });
}

export interface PeakData { rate: number; min: F32; max: F32 }

/** Min/max per bucket, about 200 buckets per second, across all channels. */
export function computePeaks(channels: F32[], sampleRate: number): PeakData {
  const rate = 200;
  const len = channels[0]?.length ?? 0;
  const size = sampleRate / rate;
  const buckets = Math.ceil(len / size);
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) {
    const i0 = Math.floor(b * size);
    const i1 = Math.min(len, Math.floor((b + 1) * size));
    let lo = Infinity;
    let hi = -Infinity;
    for (const ch of channels) {
      for (let i = i0; i < i1; i++) {
        const v = ch[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[b] = lo === Infinity ? 0 : lo;
    max[b] = hi === -Infinity ? 0 : hi;
  }
  return { rate, min, max };
}
