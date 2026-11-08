/** Deterministic helpers. Never use Math.random in anything that affects a frame. */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 1D value noise in -1..1 */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i + seed * 57.31);
  const b = hash1(i + 1 + seed * 57.31);
  return (a + (b - a) * u) * 2 - 1;
}

/** Two octaves, roughly matching AE's wiggle() character. */
export function wiggleNoise(t: number, freq: number, seed: number): number {
  return noise1(t * freq, seed) * 0.75 + noise1(t * freq * 2.13 + 9.7, seed + 3) * 0.25;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter++;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
