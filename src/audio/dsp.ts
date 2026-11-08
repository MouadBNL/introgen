/**
 * Hand-written DSP primitives. Pure TypeScript with no Web Audio dependency, so the generators run
 * identically in a worker, on the main thread and in tests, and are sample-exact (no node latency).
 */
export const SR = 48000;

export type F32 = Float32Array<ArrayBuffer>;
export interface Stereo { l: F32; r: F32 }

export const TAU = Math.PI * 2;
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToLin = (db: number) => Math.pow(10, db / 20);

export function stereo(n: number): Stereo {
  return { l: new Float32Array(n), r: new Float32Array(n) };
}

/** mulberry32: all content randomness comes from here, never Math.random. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent stream per purpose, so adding a draw to one part never shifts another. */
export function fork(seed: number, tag: string): () => number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193) >>> 0;
  return rng(h);
}

export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

/** Saturator: tanh-like rational, exactly +-1 beyond |x| = 3. */
export function sat(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const q = x * x;
  return (x * (27 + q)) / (27 + 9 * q);
}

function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Band-limited saw; ph in 0..1, dt = f / SR. */
export function saw(ph: number, dt: number): number {
  return 2 * ph - 1 - blep(ph, dt);
}

/** Band-limited square. */
export function square(ph: number, dt: number): number {
  const p2 = ph + 0.5;
  return (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep(p2 >= 1 ? p2 - 1 : p2, dt);
}

/** Zero-delay-feedback state variable filter: stays stable under fast cutoff modulation. */
export class SVF {
  lp = 0;
  bp = 0;
  hp = 0;
  private c1 = 0;
  private c2 = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;

  constructor(fc = 1000, q = 0.707) {
    this.set(fc, q);
  }

  set(fc: number, q: number): void {
    const g = Math.tan((Math.PI * clamp(fc, 5, SR * 0.46)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  tick(x: number): void {
    const v3 = x - this.c2;
    const v1 = this.a1 * this.c1 + this.a2 * v3;
    const v2 = this.c2 + this.a2 * this.c1 + this.a3 * v3;
    this.c1 = 2 * v1 - this.c1;
    this.c2 = 2 * v2 - this.c2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
  }
}

export type FilterMode = 'lp' | 'hp' | 'bp';

/** In-place filter with a static cutoff. */
export function filter(buf: F32, mode: FilterMode, fc: number, q = 0.707): void {
  const f = new SVF(fc, q);
  const n = buf.length;
  if (mode === 'lp') for (let i = 0; i < n; i++) { f.tick(buf[i]); buf[i] = f.lp; }
  else if (mode === 'hp') for (let i = 0; i < n; i++) { f.tick(buf[i]); buf[i] = f.hp; }
  else for (let i = 0; i < n; i++) { f.tick(buf[i]); buf[i] = f.bp; }
}

/** In-place filter whose cutoff follows fc(time in seconds), updated at control rate. */
export function sweep(buf: F32, mode: FilterMode, fc: (t: number) => number, q = 0.707): void {
  const f = new SVF(fc(0), q);
  const n = buf.length;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) f.set(fc(i / SR), q);
    f.tick(buf[i]);
    buf[i] = mode === 'lp' ? f.lp : mode === 'hp' ? f.hp : f.bp;
  }
}

export function noise(n: number, r: () => number): F32 {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
  return b;
}

/** Adds a mono sample at a sample position with equal-power pan. */
export function addMono(dst: Stereo, src: F32, at: number, gain: number, pan = 0): void {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  const gl = gain * Math.cos(a) * Math.SQRT2;
  const gr = gain * Math.sin(a) * Math.SQRT2;
  const i0 = Math.max(0, -at);
  const i1 = Math.min(src.length, dst.l.length - at);
  for (let i = i0; i < i1; i++) {
    const s = src[i];
    dst.l[at + i] += s * gl;
    dst.r[at + i] += s * gr;
  }
}

export function addInto(dst: F32, src: F32, at: number, gain: number): void {
  const i0 = Math.max(0, -at);
  const i1 = Math.min(src.length, dst.length - at);
  for (let i = i0; i < i1; i++) dst[at + i] += src[i] * gain;
}

export function mixStereo(dst: Stereo, src: Stereo, gain = 1): void {
  addInto(dst.l, src.l, 0, gain);
  addInto(dst.r, src.r, 0, gain);
}

export function peakOf(s: Stereo): number {
  let p = 0;
  for (let i = 0; i < s.l.length; i++) {
    const a = Math.abs(s.l[i]);
    const b = Math.abs(s.r[i]);
    if (a > p) p = a;
    if (b > p) p = b;
  }
  return p;
}

export function normalize(s: Stereo, target: number): void {
  const p = peakOf(s);
  if (p < 1e-9) return;
  const g = target / p;
  for (let i = 0; i < s.l.length; i++) {
    s.l[i] *= g;
    s.r[i] *= g;
  }
}

/** Short linear fades that keep a buffer from starting or ending on a click. */
export function edgeFade(b: F32, inSec: number, outSec: number): void {
  const ni = Math.min(b.length, Math.round(inSec * SR));
  const no = Math.min(b.length, Math.round(outSec * SR));
  for (let i = 0; i < ni; i++) b[i] *= i / ni;
  for (let i = 0; i < no; i++) b[b.length - 1 - i] *= i / no;
}

/** Ping-pong delay, added in place to the buffer. */
export function pingPong(s: Stereo, delay: number, fb: number, mix: number): void {
  const d = Math.max(1, Math.round(delay * SR));
  const n = s.l.length;
  const wl = new Float32Array(n);
  const wr = new Float32Array(n);
  for (let i = d; i < n; i++) {
    wl[i] = (s.l[i - d] + s.r[i - d]) * 0.5 + wr[i - d] * fb;
    wr[i] = wl[i - d] * fb;
  }
  for (let i = 0; i < n; i++) {
    s.l[i] += wl[i] * mix;
    s.r[i] += wr[i] * mix;
  }
}

// --- FFT convolution ------------------------------------------------------------------------

interface Plan { cos: Float64Array; sin: Float64Array; rev: Uint32Array }
const plans = new Map<number, Plan>();

function plan(n: number): Plan {
  let p = plans.get(n);
  if (p) return p;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((TAU * i) / n);
    sin[i] = -Math.sin((TAU * i) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = y;
  }
  p = { cos, sin, rev };
  plans.set(n, p);
  return p;
}

/** In-place radix-2 complex FFT; n must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, rev } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j;
        const b = a + half;
        const wr = cos[k];
        const wi = sin[k];
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/**
 * Convolves a mono send with a stereo impulse response. The IR is packed as the complex signal
 * L + iR, so one complex convolution yields both output channels at once.
 * Output is truncated to x.length.
 */
export function convolve(x: F32, ir: Stereo): Stereo {
  const m = ir.l.length;
  let n = 1 << 12;
  while (n < m * 2) n <<= 1;
  const hop = n - m + 1;
  const hr = new Float64Array(n);
  const hi = new Float64Array(n);
  hr.set(ir.l);
  hi.set(ir.r);
  fft(hr, hi);
  const out = stereo(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let pos = 0; pos < x.length; pos += hop) {
    const end = Math.min(x.length, pos + hop);
    let silent = true;
    for (let i = pos; i < end; i++) {
      if (x[i] > 1e-6 || x[i] < -1e-6) {
        silent = false;
        break;
      }
    }
    if (silent) continue;
    re.fill(0);
    im.fill(0);
    for (let i = pos; i < end; i++) re[i - pos] = x[i];
    fft(re, im);
    // Multiply by H, then invert via conj(FFT(conj(Y))): only the sign of im changes.
    for (let i = 0; i < n; i++) {
      const a = re[i];
      const b = im[i];
      re[i] = a * hr[i] - b * hi[i];
      im[i] = -(a * hi[i] + b * hr[i]);
    }
    fft(re, im);
    const lim = Math.min(n, x.length - pos);
    const inv = 1 / n;
    for (let i = 0; i < lim; i++) {
      out.l[pos + i] += re[i] * inv;
      out.r[pos + i] -= im[i] * inv;
    }
  }
  return out;
}

/**
 * Reverb at half the sample rate: the send is decimated, convolved and interpolated back, which halves
 * the FFT work. `ir` must be built for the half rate (see makeIR's `halfRate`). Reverb tails carry
 * nothing above 12 kHz anyway.
 */
export function convolveHalfRate(x: F32, ir: Stereo): Stereo {
  const aa = Float32Array.from(x);
  filter(aa, 'lp', 10500, 0.7);
  filter(aa, 'lp', 10500, 0.7);
  const half = new Float32Array(Math.ceil(x.length / 2));
  for (let i = 0; i < half.length; i++) half[i] = aa[i * 2];
  const wet = convolve(half, ir);
  const out = stereo(x.length);
  for (const [src, dst] of [[wet.l, out.l], [wet.r, out.r]] as const) {
    for (let i = 0; i < x.length; i++) {
      const k = i >> 1;
      dst[i] = i & 1 ? (src[k] + (src[k + 1] ?? 0)) * 0.5 : src[k];
    }
  }
  return out;
}

/** Decaying-noise impulse response that darkens over time, unit energy per channel. */
export function makeIR(
  seconds: number,
  opts: { seed: number; predelay?: number; brightness?: number; halfRate?: boolean },
): Stereo {
  const rate = opts.halfRate ? SR / 2 : SR;
  const n = Math.round(seconds * rate);
  const pre = Math.round((opts.predelay ?? 0.012) * rate);
  // SVF cutoffs are in full-rate Hz, so a half-rate IR needs them doubled.
  const fscale = SR / rate;
  const bright = (opts.brightness ?? 9000) * fscale;
  const out = stereo(n);
  const tail = 6.9 / seconds; // about -60 dB at the end
  [out.l, out.r].forEach((ch, c) => {
    const r = fork(opts.seed, c ? 'irR' : 'irL');
    const f = new SVF(bright, 0.5);
    let energy = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / rate;
      if ((i & 63) === 0) f.set(300 * fscale + bright * Math.exp(-t * 3.2), 0.5);
      f.tick(r() * 2 - 1);
      const v = f.lp * Math.exp(-t * tail) * Math.min(1, t * 200 + 0.2);
      ch[i] = v;
      energy += v * v;
    }
    const g = 1 / Math.sqrt(Math.max(energy, 1e-12));
    for (let i = 0; i < n; i++) ch[i] *= g;
  });
  return out;
}
