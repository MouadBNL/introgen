/** One-click recipes. Everything here is plain data on top of createLayer. */
import type { Ease, HitKind, Keyframe, Layer, LayerType, PropValue, Track } from '../core/types';
import { createLayer } from '../core/schema';
import { uid } from '../core/rng';

type KeyDef = [dt: number, v: PropValue, ease?: Ease];
type PropSpec = Record<string, PropValue | KeyDef[]>;

const EASY: Ease = [0.33, 0, 0.67, 1];
const OUT: Ease = [0, 0, 0.3, 1];
const SNAP: Ease = [0.05, 0.9, 0.1, 1];

function buildProps(type: LayerType, t0: number, spec: PropSpec): Record<string, Track> {
  const props = createLayer(type).props;
  for (const key in spec) {
    const s = spec[key];
    if (!props[key]) continue;
    if (Array.isArray(s)) {
      const keys: Keyframe[] = s.map(([dt, v, ease]) => ({ id: uid('k'), t: t0 + dt, v, ease: ease ?? EASY }));
      props[key] = { value: keys[0].v, keys };
    } else props[key] = { value: s, keys: [] };
  }
  return props;
}

export interface Recipe {
  id: string;
  name: string;
  blurb: string;
  type: LayerType;
  /** Layer length in seconds. */
  dur: number;
  settings?: Record<string, unknown>;
  props: PropSpec;
}

export const RECIPES: Recipe[] = [
  { id: 'spark', name: 'Spark Burst', blurb: 'Hot sparks thrown out from the center', type: 'particles', dur: 2,
    settings: { mode: 'burst', count: 2600 },
    props: { speed: 20, drag: 2.4, life: 1.5, size: 0.035, stretch: 3, brightness: 4, gravity: -3, spread: 4, color: '#ff7a3c', color2: '#fff2c8' } },
  { id: 'warp', name: 'Warp Tunnel', blurb: 'Stars streaking past the lens', type: 'particles', dur: 3,
    settings: { mode: 'warp', count: 6000 },
    props: { speed: 34, stretch: 6, size: 0.03, spread: 16, brightness: 3, color: '#7fb4ff', color2: '#ffffff', opacity: [[0, 0], [0.25, 1], [2.6, 1], [3, 0]] } },
  { id: 'bokeh', name: 'Bokeh Orbs', blurb: 'Soft out-of-focus orbs drifting in depth', type: 'particles', dur: 6,
    settings: { mode: 'bokeh', count: 140 },
    props: { size: 0.55, brightness: 1.1, spread: 18, speed: 0.6, life: 6, turb: 0.6, color: '#ff4468', color2: '#ffb0c0', opacity: [[0, 0], [0.8, 0.8]] } },
  { id: 'crown', name: 'Liquid Crown', blurb: 'Metal splash blooming on the hit', type: 'splash', dur: 3,
    settings: { arms: 160, flat: 0.3 },
    props: { grow: [[0, 0, OUT], [0.8, 1]], radius: 6.5, thickness: 0.3, turb: 1.2, flow: 0.5, pz: -1.5 } },
  { id: 'sheet', name: 'Dot Sheet', blurb: 'Waving halftone floor', type: 'dots', dur: 6,
    settings: { cols: 120, rows: 80 },
    props: { py: -3.5, rx: -72, waveAmp: 1.4, waveFreq: 0.3, spacing: 0.5, reveal: [[0, 0, OUT], [1.2, 1]] } },
  { id: 'rocks', name: 'Rock Explosion', blurb: 'Fractured chunks thrown out on impact', type: 'debris', dur: 2.5,
    settings: { count: 150, flat: 0.45 },
    props: { explode: [[0, 0, SNAP], [2.5, 1, 'linear']], radius: 13, size: 0.42, spin: 2.2, gravity: -2 } },
  { id: 'ring', name: 'Electric Ring', blurb: 'Arcs crackling around the title', type: 'lightning', dur: 1.2,
    settings: { bolts: 26, segments: 32 },
    props: { radius: 7, inner: 5.2, jitter: 0.7, glow: 5, rate: 24, opacity: [[0, 1], [0.8, 1], [1.2, 0]] } },
  { id: 'shock', name: 'Impact Shockwave', blurb: 'Fast expanding ring', type: 'shockwave', dur: 0.8,
    props: { radius: [[0, 0.2, OUT], [0.8, 15]], width: [[0, 0.8], [0.8, 0.05]], glow: 4, opacity: [[0, 1], [0.55, 0.9], [0.8, 0]] } },
  { id: 'flare', name: 'Anamorphic Flare', blurb: 'Wide blue-streak flare popping on', type: 'flare', dur: 2,
    props: { color: '#5aa2ff', streak: 3.2, ghosts: 0.6, flicker: 0.15, intensity: [[0, 0, SNAP], [0.12, 2.6], [2, 0.3]] } },
];

/** createLayer-style overrides for a recipe placed at t, trimmed to the comp. */
export function recipeLayer(r: Recipe, t: number, duration: number): Partial<Layer> {
  const def = createLayer(r.type);
  return {
    name: r.name, start: t, end: Math.min(duration, t + r.dur),
    settings: { ...def.settings, ...r.settings },
    props: buildProps(r.type, t, r.props),
  };
}

export interface Combo { id: string; name: string; blurb: string; hits: { kind: HitKind; amount?: number }[] }

export const COMBOS: Combo[] = [
  { id: 'drop', name: 'DROP', blurb: 'Flash, shake, punch, RGB, bars', hits: [{ kind: 'flash' }, { kind: 'shake', amount: 1.4 }, { kind: 'punch', amount: 1.2 }, { kind: 'rgb' }, { kind: 'bars' }] },
  { id: 'snare', name: 'SNARE', blurb: 'Punch, RGB', hits: [{ kind: 'punch', amount: 0.7 }, { kind: 'rgb', amount: 0.8 }] },
  { id: 'accent', name: 'ACCENT', blurb: 'Invert, glitch', hits: [{ kind: 'invert' }, { kind: 'glitch' }] },
  { id: 'whip', name: 'WHIP CUT', blurb: 'Whip, zoom blur', hits: [{ kind: 'whip' }, { kind: 'blur' }] },
];

export interface MaterialPreset { id: string; name: string; values: Record<string, PropValue> }

const mat = (id: string, name: string, color: string, color2: string, metal: number, rough: number, marble: number, marbleScale: number, marbleWarp: number, bump: number, emissive: string, emissiveAmt: number, envAmt: number): MaterialPreset =>
  ({ id, name, values: { color, color2, metal, rough, marble, marbleScale, marbleWarp, bump, emissive, emissiveAmt, envAmt } });

export const MATERIALS: MaterialPreset[] = [
  mat('damascus', 'Damascus Chrome', '#c8c8d0', '#26262c', 1, 0.22, 0.9, 1.6, 2.6, 0.6, '#ff2d55', 0, 1.4),
  mat('gold', 'Gold', '#ffc65a', '#6a3c08', 1, 0.24, 0.35, 1.1, 1.6, 0.3, '#ffb43a', 0, 1.5),
  mat('blood', 'Blood Metal', '#b3122e', '#1c0307', 1, 0.3, 0.8, 1.4, 2.4, 0.5, '#ff2d55', 0.25, 1.1),
  mat('ice', 'Ice', '#cfefff', '#2a6f9a', 0.6, 0.12, 0.6, 2, 3, 0.25, '#7fd4ff', 0.2, 1.8),
  mat('black', 'Matte Black', '#141417', '#050506', 0.4, 0.62, 0.1, 1, 1, 0.2, '#ffffff', 0, 0.5),
  mat('neon', 'Neon', '#0b0b12', '#050508', 0.8, 0.3, 0, 1, 1, 0, '#00f0ff', 3, 0.8),
];

export const MATERIAL_TYPES: LayerType[] = ['text3d', 'logo', 'splash', 'debris'];

export interface GradePreset { id: string; name: string; swatch: string; values: Record<string, PropValue> }

export const GRADES: GradePreset[] = [
  { id: 'crimson', name: 'Crimson', swatch: '#ff2d55', values: { tint: '#ff2d55', tintAmt: 0.35, hue: 0, saturation: 1.1, contrast: 1.2, exposure: 0 } },
  { id: 'toxic', name: 'Toxic', swatch: '#39ff14', values: { tint: '#39ff14', tintAmt: 0.3, hue: 0, saturation: 1.15, contrast: 1.2, exposure: 0 } },
  { id: 'ice', name: 'Ice', swatch: '#66c8ff', values: { tint: '#66c8ff', tintAmt: 0.35, hue: 0, saturation: 0.85, contrast: 1.15, exposure: 0.1 } },
  { id: 'gold', name: 'Gold', swatch: '#ffb43a', values: { tint: '#ffb43a', tintAmt: 0.3, hue: 0, saturation: 1.05, contrast: 1.15, exposure: 0 } },
  { id: 'mono', name: 'Mono', swatch: '#b9b9c3', values: { tintAmt: 0, hue: 0, saturation: 0, contrast: 1.3, exposure: 0 } },
];
