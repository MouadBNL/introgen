import { createLayer } from '../core/schema';
import { emptyProject } from '../core/store';
import { uid } from '../core/rng';
import { EASE_PRESETS } from '../core/eval';
import type { Ease, Layer, LayerType, Project, PropValue, SfxId, HitKind, AudioClip } from '../core/types';
import { HIT_DEF, SFX_LIST } from '../core/schema';

const E = Object.fromEntries(EASE_PRESETS.map((e) => [e.id, e.ease])) as Record<string, Ease>;
export const ease = E;

/** [time, value, ease?]. The ease applies to the segment starting at this key. */
export type K = [number, PropValue, Ease?];

export function keys(l: Layer, prop: string, ks: K[]) {
  const tr = l.props[prop];
  if (!tr) throw new Error(`${l.type} has no prop ${prop}`);
  tr.keys = ks.map(([t, v, e]) => ({ id: uid('k'), t, v, ease: e ?? E.smooth })).sort((a, b) => a.t - b.t);
}

export function set(l: Layer, values: Record<string, PropValue>) {
  for (const k in values) {
    if (!l.props[k]) throw new Error(`${l.type} has no prop ${k}`);
    l.props[k].value = values[k];
  }
  return l;
}

export function layer(type: LayerType, name: string, start: number, end: number, settings: Record<string, any> = {}, values: Record<string, PropValue> = {}): Layer {
  const l = createLayer(type, { name, start, end });
  Object.assign(l.settings, settings);
  return set(l, values);
}

export function hit(p: Project, kind: HitKind, t: number, amount = 1, dur?: number) {
  p.hits.push({ id: uid('h'), t, kind, amount, dur: dur ?? HIT_DEF[kind].dur });
}

export function sfx(p: Project, id: SfxId, t: number, lane: number, gain = 0.8, seed = 1, offset = 0) {
  const def = SFX_LIST.find((s) => s.id === id)!;
  const clip: AudioClip = {
    id: uid('c'), name: def.label, source: { kind: 'sfx', sfx: id, seed }, lane, t, offset, dur: def.dur, gain, fadeIn: 0, fadeOut: 0.02, muted: false,
  };
  p.clips.push(clip);
}

export function music(p: Project, dur: number, gain = 0.9) {
  p.clips.push({ id: uid('c'), name: 'Generated Track', source: { kind: 'music' }, lane: 0, t: 0, offset: 0, dur, gain, fadeIn: 0, fadeOut: 0.2, muted: false });
}

export function baseProject(name: string, duration: number, bpm: number): Project {
  const p = emptyProject();
  p.name = name; p.duration = duration; p.bpm = bpm;
  p.layers = [];
  p.music = { ...p.music, bpm };
  return p;
}

export const postOf = (p: Project) => p.layers.find((l) => l.type === 'post')!;
