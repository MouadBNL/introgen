import { describe, expect, it } from 'vitest';
import type { MusicConfig, MusicStyle, SfxId } from '../core/types';
import { SFX_LIST } from '../core/schema';
import { SR, type Stereo } from './dsp';
import { ENV_RATE, analyze, onsets } from './analysis';
import { MUSIC_TAIL, musicLayout } from './layout';
import { renderMusic } from './music';
import { SFX_DURATION, renderSfx } from './sfx';

const cfg = (o: Partial<MusicConfig> = {}): MusicConfig => ({
  style: 'dubstep', bpm: 140, root: 41, minor: true, seed: 3, buildBars: 2, dropBars: 2, outroBars: 1, intensity: 0.8, ...o,
});

function stats(s: Stereo) {
  let peak = 0;
  let finite = true;
  for (const ch of [s.l, s.r]) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (!Number.isFinite(a)) finite = false;
      else if (a > peak) peak = a;
    }
  }
  return { peak, finite };
}

const rms = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
};

describe('musicLayout', () => {
  it('derives the grid from bpm and bar counts', () => {
    const l = musicLayout(cfg({ bpm: 120, buildBars: 4, dropBars: 4, outroBars: 2 }));
    expect(l.beat).toBeCloseTo(0.5);
    expect(l.bar).toBeCloseTo(2);
    expect(l.dropTime).toBeCloseTo(8);
    expect(l.duration).toBeCloseTo(20 + MUSIC_TAIL);
    expect(l.sections.map((s) => s.name)).toEqual(['Build', 'Drop', 'Outro']);
    expect(l.sections[2].end).toBeCloseTo(l.duration);
  });
});

describe('renderMusic', () => {
  const styles: MusicStyle[] = ['dubstep', 'trap', 'hardstyle', 'synthwave', 'drumstep'];

  it.each(styles)('%s: right length, no clipping, drop louder than build, attack on the drop', (style) => {
    const c = cfg({ style });
    const l = musicLayout(c);
    const out = renderMusic(c);
    expect(out.l.length).toBe(Math.ceil(l.duration * SR));
    const { peak, finite } = stats(out);
    expect(finite).toBe(true);
    expect(peak).toBeLessThanOrEqual(0.9);
    expect(peak).toBeGreaterThan(0.85);
    const drop = Math.round(l.dropTime * SR);
    const gap = Math.round((l.dropTime - l.beat) * SR);
    const end = Math.round(l.sections[1].end * SR);
    expect(rms(out.l, drop, end)).toBeGreaterThan(rms(out.l, 0, gap) * 1.6);
    // The kick is in the first 5 ms after dropTime, and louder than what precedes it.
    expect(rms(out.l, drop, drop + 240)).toBeGreaterThan(rms(out.l, drop - 240, drop) * 1.5);
  });

  it('is deterministic and seed-dependent', () => {
    const a = renderMusic(cfg());
    const b = renderMusic(cfg());
    const c = renderMusic(cfg({ seed: 4 }));
    expect(a.l).toEqual(b.l);
    expect(a.l).not.toEqual(c.l);
  });

  it('survives degenerate arrangements', () => {
    for (const o of [{ buildBars: 0 }, { dropBars: 0 }, { outroBars: 0 }, { buildBars: 1 }, { minor: false }, { intensity: 0 }]) {
      expect(stats(renderMusic(cfg(o))).finite).toBe(true);
    }
  });
});

describe('renderSfx', () => {
  it('matches the library list', () => {
    for (const s of SFX_LIST) expect(SFX_DURATION[s.id]).toBe(s.dur);
  });

  it.each(Object.keys(SFX_DURATION) as SfxId[])('%s renders sound of the listed length', (id) => {
    const out = renderSfx(id, 5);
    expect(out.l.length).toBe(Math.round(SFX_DURATION[id] * SR));
    const { peak, finite } = stats(out);
    expect(finite).toBe(true);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(0.9);
    expect(renderSfx(id, 5).l).toEqual(out.l);
    expect(renderSfx(id, 6).l).not.toEqual(out.l);
  });
});

describe('analysis', () => {
  it('finds clicks on a known grid and normalizes envelopes', () => {
    const n = SR * 4;
    const x = new Float32Array(n);
    const hits = [0.5, 1, 1.5, 2, 2.5, 3];
    for (const t of hits) {
      for (let i = 0; i < 2400; i++) x[Math.round(t * SR) + i] = Math.sin(i * 0.3) * Math.exp(-i / 500);
    }
    const a = analyze(x, x, SR, 4);
    expect(a.env.rate).toBe(ENV_RATE);
    expect(a.env.full.length).toBe(4 * ENV_RATE);
    expect(Math.max(...a.env.full)).toBeLessThanOrEqual(1);
    const found = onsets(a.raw.full, ENV_RATE);
    expect(found.length).toBe(hits.length);
    found.forEach((t, i) => expect(Math.abs(t - hits[i])).toBeLessThan(0.02));
  });
});
