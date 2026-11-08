import { describe, expect, it } from 'vitest';
import { bezierAt, evalKeys, evalSync, evalTrack, formatTimecode, snapToBeat } from './eval';
import { editor, useEditor, useTransport } from './store';
import { createDemoProject } from '../demo/demo';
import { LAYER_DEFS } from './schema';
import type { Keyframe, SyncHit } from './types';

const k = (t: number, v: number | string, ease: Keyframe['ease'] = 'linear'): Keyframe => ({ id: `k${t}`, t, v, ease });

describe('easing', () => {
  it('hits the endpoints and is linear for a linear bezier', () => {
    expect(bezierAt([0.33, 0, 0.67, 1], 0)).toBe(0);
    expect(bezierAt([0.33, 0, 0.67, 1], 1)).toBe(1);
    expect(bezierAt([0.25, 0.25, 0.75, 0.75], 0.4)).toBeCloseTo(0.4, 3);
  });
  it('allows overshoot', () => {
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => bezierAt([0.2, 1.5, 0.4, 1], i / 50)));
    expect(peak).toBeGreaterThan(1);
  });
});

describe('keyframes', () => {
  it('clamps outside the key range and interpolates inside', () => {
    const ks = [k(1, 10), k(2, 20)];
    expect(evalKeys(ks, 0)).toBe(10);
    expect(evalKeys(ks, 3)).toBe(20);
    expect(evalKeys(ks, 1.5)).toBeCloseTo(15);
  });
  it('holds until the next key', () => {
    const ks = [k(0, 1, 'hold'), k(1, 2)];
    expect(evalKeys(ks, 0.99)).toBe(1);
    expect(evalKeys(ks, 1)).toBe(2);
  });
  it('blends colors', () => {
    expect(evalKeys([k(0, '#000000'), k(1, '#ffffff')], 0.5)).toBe('#808080');
  });
  it('wiggle is deterministic', () => {
    const tr = { value: 5, keys: [], wiggle: { amp: 2, freq: 3, seed: 1 } };
    expect(evalTrack(tr, 1.234)).toBe(evalTrack(tr, 1.234));
    expect(evalTrack(tr, 1.234)).not.toBe(5);
  });
  it('audio links add the band envelope', () => {
    const env = { rate: 10, low: new Float32Array([0, 1]), mid: new Float32Array(2), high: new Float32Array(2), full: new Float32Array(2) };
    expect(evalTrack({ value: 1, keys: [], audio: { band: 'low', amount: 4 } }, 0.05, env)).toBeCloseTo(3);
  });
});

describe('sync hits', () => {
  const h = (kind: SyncHit['kind'], t = 1, dur = 0.5): SyncHit => ({ id: 'h', t, kind, amount: 1, dur });
  it('has no effect before the hit or after it ends', () => {
    expect(evalSync([h('flash')], 0.9).flash).toBe(0);
    expect(evalSync([h('flash')], 1.6).flash).toBe(0);
  });
  it('decays', () => {
    expect(evalSync([h('flash')], 1).flash).toBeGreaterThan(evalSync([h('flash')], 1.3).flash);
  });
  it('stacks rgb hits', () => {
    expect(evalSync([h('rgb'), h('rgb')], 1).rgb).toBeCloseTo(evalSync([h('rgb')], 1).rgb * 2);
  });
});

describe('timing', () => {
  it('snaps to the beat grid', () => {
    const p = { bpm: 120, beatOffset: 0 };
    expect(snapToBeat(p, 0.51, 1)).toBeCloseTo(0.5);
    expect(snapToBeat(p, 0.13, 4)).toBeCloseTo(0.125);
  });
  it('formats timecode', () => {
    expect(formatTimecode(61.5, 60)).toBe('01:01:30');
  });
});

describe('store', () => {
  it('keys when animated, sets statically when not, and undoes', () => {
    const s = editor();
    const id = s.addLayer('text3d');
    useTransport.setState({ time: 1 });
    editor().setProp(id, 'px', 3);
    const layer = () => editor().project.layers.find((l) => l.id === id)!;
    expect(layer().props.px.value).toBe(3);
    editor().toggleAnimated(id, 'px');
    expect(layer().props.px.keys).toHaveLength(1);
    useTransport.setState({ time: 2 });
    editor().setProp(id, 'px', 9);
    expect(layer().props.px.keys).toHaveLength(2);
    editor().undo();
    expect(layer().props.px.keys).toHaveLength(1);
    editor().redo();
    expect(layer().props.px.keys).toHaveLength(2);
  });
  it('a drag is one undo step', () => {
    const before = useEditor.getState().past.length;
    const id = editor().project.layers[0].id;
    editor().beginDrag();
    for (let i = 0; i < 20; i++) editor().setProp(id, 'px', i, { noHistory: true });
    editor().endDrag();
    expect(useEditor.getState().past.length).toBe(before + 1);
  });
});

describe('demo project', () => {
  const p = createDemoProject();
  it('uses every layer type and every hit kind', () => {
    const types = new Set(p.layers.map((l) => l.type));
    for (const t of Object.keys(LAYER_DEFS)) expect(types, t).toContain(t);
    const kinds = new Set(p.hits.map((h) => h.kind));
    for (const k2 of ['shake', 'punch', 'whip', 'flash', 'rgb', 'invert', 'hue', 'bars', 'glitch', 'blur']) expect(kinds, k2).toContain(k2);
  });
  it('has a camera covering every frame', () => {
    for (let t = 0; t < p.duration; t += 1 / 60) {
      expect(p.layers.some((l) => l.type === 'camera' && t >= l.start - 1e-9 && t < l.end), `t=${t}`).toBe(true);
    }
  });
  it('has sorted keys and valid props', () => {
    for (const l of p.layers) for (const key in l.props) {
      const ks = l.props[key].keys;
      for (let i = 1; i < ks.length; i++) expect(ks[i].t).toBeGreaterThanOrEqual(ks[i - 1].t);
      expect(LAYER_DEFS[l.type].props.some((d) => d.key === key)).toBe(true);
    }
  });
});
