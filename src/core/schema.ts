import type { HitKind, Layer, LayerType, PropValue, SfxId, Track } from './types';
import { uid } from './rng';

export type PropKind = 'number' | 'angle' | 'percent' | 'color';

export interface PropDef {
  key: string;
  label: string;
  group: string;
  kind: PropKind;
  def: PropValue;
  min?: number;  // soft UI limits
  max?: number;
  step?: number;
  unit?: string;
}

export type SettingKind = 'text' | 'multiline' | 'number' | 'select' | 'bool' | 'font' | 'asset';

export interface SettingDef {
  key: string;
  label: string;
  kind: SettingKind;
  def: any;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  assetKind?: 'image' | 'svg';
}

export interface LayerDef {
  type: LayerType;
  label: string;
  /** Plain-language origin: what you'd have used in 2014. Shown in the Add menu. */
  blurb: string;
  category: 'Scene' | 'Type' | 'Generators' | 'Light';
  singleton?: boolean;
  /** Layers with a transform get a gizmo in the viewport and can be parented. */
  spatial?: boolean;
  props: PropDef[];
  settings: SettingDef[];
}

const n = (key: string, label: string, group: string, def: number, min?: number, max?: number, step?: number, unit?: string): PropDef =>
  ({ key, label, group, kind: 'number', def, min, max, step, unit });
const a = (key: string, label: string, group: string, def = 0): PropDef =>
  ({ key, label, group, kind: 'angle', def, step: 1, unit: '°' });
const p = (key: string, label: string, group: string, def: number, min = 0, max = 1): PropDef =>
  ({ key, label, group, kind: 'percent', def, min, max, step: 0.01 });
const c = (key: string, label: string, group: string, def: string): PropDef =>
  ({ key, label, group, kind: 'color', def });
const opts = (...v: [string, string][]) => v.map(([value, label]) => ({ value, label }));

const G_T = 'Transform';
const transform = (): PropDef[] => [
  n('px', 'Position X', G_T, 0, -50, 50, 0.01), n('py', 'Position Y', G_T, 0, -50, 50, 0.01), n('pz', 'Position Z', G_T, 0, -50, 50, 0.01),
  a('rx', 'Rotation X', G_T), a('ry', 'Rotation Y', G_T), a('rz', 'Rotation Z', G_T),
  n('s', 'Scale', G_T, 1, 0, 10, 0.01),
  p('opacity', 'Opacity', G_T, 1),
];

const G_M = 'Material';
const material = (color = '#c8c8d0', color2 = '#26262c'): PropDef[] => [
  c('color', 'Base Color', G_M, color), c('color2', 'Vein Color', G_M, color2),
  p('metal', 'Metalness', G_M, 1), p('rough', 'Roughness', G_M, 0.28),
  p('marble', 'Marble', G_M, 0.85), n('marbleScale', 'Marble Scale', G_M, 1.4, 0.1, 8, 0.01),
  n('marbleWarp', 'Marble Warp', G_M, 2.2, 0, 6, 0.01),
  p('bump', 'Relief', G_M, 0.5),
  c('emissive', 'Glow Color', G_M, '#ff2d55'), n('emissiveAmt', 'Glow', G_M, 0, 0, 8, 0.01),
  n('envAmt', 'Reflections', G_M, 1, 0, 4, 0.01),
];

const G_A = 'Letter Animator';
const animator = (): PropDef[] => [
  p('anRev', 'Reveal', G_A, 1),
  n('anStagger', 'Stagger', G_A, 0.35, 0, 1, 0.01),
  n('anOx', 'Offset X', G_A, 0, -30, 30, 0.01), n('anOy', 'Offset Y', G_A, 0, -30, 30, 0.01), n('anOz', 'Offset Z', G_A, 0, -60, 60, 0.01),
  a('anRx', 'Offset Rot X', G_A), a('anRy', 'Offset Rot Y', G_A), a('anRz', 'Offset Rot Z', G_A),
  n('anS', 'Offset Scale', G_A, 1, 0, 4, 0.01),
  n('flip', 'Flip Wave', G_A, 0, 0, 8, 0.01, 'turns'),
  n('flipSpread', 'Flip Spread', G_A, 0.5, 0, 2, 0.01),
  n('letterJitter', 'Letter Jitter', G_A, 0, 0, 3, 0.01),
];

const FONT_DEFAULT = 'Black Ops One';

const SHAPES = opts(['bolt', 'Bolt'], ['hex', 'Hexagon'], ['star', 'Star'], ['ring', 'Ring'], ['chevron', 'Chevron'], ['shield', 'Shield'], ['crown', 'Crown'], ['svg', 'Imported SVG']);

export const LAYER_DEFS: Record<LayerType, LayerDef> = {
  camera: {
    type: 'camera', label: 'Camera', category: 'Scene',
    blurb: 'Orbit rig. Replaces the C4D camera + target null. The topmost camera in range is the one you see, so trimming layers makes cuts.',
    props: [
      n('tx', 'Target X', 'Target', 0, -50, 50, 0.01), n('ty', 'Target Y', 'Target', 0, -50, 50, 0.01), n('tz', 'Target Z', 'Target', 0, -50, 50, 0.01),
      a('az', 'Orbit', 'Rig', 0), a('el', 'Tilt', 'Rig', 0), n('dist', 'Distance', 'Rig', 12, 0.2, 120, 0.01), a('roll', 'Roll', 'Rig', 0),
      n('lens', 'Lens', 'Lens', 35, 8, 200, 0.1, 'mm'),
      n('focus', 'Focus Offset', 'Lens', 0, -40, 40, 0.01), n('aperture', 'Aperture', 'Lens', 0, 0, 2, 0.001),
      n('shake', 'Handheld', 'Shake', 0, 0, 2, 0.01), n('shakeFreq', 'Handheld Speed', 'Shake', 2.4, 0, 30, 0.01),
    ],
    settings: [],
  },
  post: {
    type: 'post', label: 'Post FX', category: 'Scene', singleton: true,
    blurb: 'The whole After Effects adjustment-layer stack in one place: Deep Glow, Curves, Tint, RSMB, chromatic aberration, Shine, Twitch.',
    props: [
      n('shutter', 'Shutter Angle', 'Motion Blur', 240, 0, 720, 1, '°'),
      n('exposure', 'Exposure', 'Grade', 0, -4, 4, 0.01, 'EV'), n('contrast', 'Contrast', 'Grade', 1.1, 0.5, 2, 0.01),
      n('saturation', 'Saturation', 'Grade', 1, 0, 2, 0.01), a('hue', 'Hue Shift', 'Grade', 0),
      c('tint', 'Duotone', 'Grade', '#ff2d55'), p('tintAmt', 'Duotone Mix', 'Grade', 0),
      n('bloom', 'Glow', 'Glow', 0.7, 0, 4, 0.01), n('bloomThresh', 'Glow Threshold', 'Glow', 0.9, 0, 4, 0.01), p('bloomRadius', 'Glow Radius', 'Glow', 0.7),
      n('rays', 'Light Rays', 'Light Rays', 0, 0, 3, 0.01), n('raysX', 'Rays X', 'Light Rays', 0.5, 0, 1, 0.001), n('raysY', 'Rays Y', 'Light Rays', 0.5, 0, 1, 0.001), p('raysLen', 'Rays Length', 'Light Rays', 0.6),
      n('rgb', 'RGB Split', 'Lens', 0.15, 0, 4, 0.01), n('distort', 'Lens Distortion', 'Lens', 0, -1, 1, 0.01),
      n('zoomBlur', 'Zoom Blur', 'Lens', 0, 0, 2, 0.01), n('vignette', 'Vignette', 'Lens', 0.45, 0, 2, 0.01),
      n('frameZoom', 'Frame Zoom', 'Frame', 1, 0.2, 4, 0.001), a('frameRot', 'Frame Rotate', 'Frame', 0), n('frameX', 'Frame X', 'Frame', 0, -1, 1, 0.001), n('frameY', 'Frame Y', 'Frame', 0, -1, 1, 0.001),
      p('bars', 'Letterbox', 'Frame', 0),
      p('invert', 'Invert', 'Stylize', 0), p('flash', 'Flash', 'Stylize', 0), c('flashColor', 'Flash Color', 'Stylize', '#ffffff'),
      n('glitch', 'Glitch', 'Stylize', 0, 0, 2, 0.01), n('grain', 'Film Grain', 'Stylize', 0.06, 0, 1, 0.001), p('fade', 'Fade to Black', 'Stylize', 0),
    ],
    settings: [],
  },
  background: {
    type: 'background', label: 'Background', category: 'Scene',
    blurb: 'Solid, gradient or drifting nebula backdrop behind everything.',
    props: [
      c('colorA', 'Core Color', 'Background', '#3a0512'), c('colorB', 'Edge Color', 'Background', '#050103'),
      n('gx', 'Center X', 'Background', 0.5, 0, 1, 0.001), n('gy', 'Center Y', 'Background', 0.5, 0, 1, 0.001),
      n('spread', 'Spread', 'Background', 0.8, 0.05, 3, 0.01),
      p('smoke', 'Smoke', 'Background', 0.4), n('smokeSpeed', 'Smoke Speed', 'Background', 0.15, 0, 3, 0.01),
      p('opacity', 'Opacity', 'Background', 1),
    ],
    settings: [{ key: 'mode', label: 'Mode', kind: 'select', def: 'radial', options: opts(['solid', 'Solid'], ['radial', 'Radial Glow'], ['nebula', 'Nebula']) }],
  },
  text3d: {
    type: 'text3d', label: '3D Text', category: 'Type', spatial: true,
    blurb: 'Extruded, bevelled type with per-letter animation. Replaces C4D MoText + a MoGraph effector.',
    props: [...transform(), ...material(), ...animator()],
    settings: [
      { key: 'text', label: 'Text', kind: 'text', def: 'INTROGEN' },
      { key: 'font', label: 'Font', kind: 'font', def: FONT_DEFAULT },
      { key: 'depth', label: 'Extrude', kind: 'number', def: 0.55, min: 0, max: 4, step: 0.01 },
      { key: 'bevel', label: 'Bevel', kind: 'number', def: 0.05, min: 0, max: 0.4, step: 0.005 },
      { key: 'bevelSegs', label: 'Bevel Segments', kind: 'number', def: 3, min: 1, max: 8, step: 1 },
      { key: 'tracking', label: 'Tracking', kind: 'number', def: 0.04, min: -0.2, max: 1, step: 0.005 },
      { key: 'order', label: 'Letter Order', kind: 'select', def: 'ltr', options: opts(['ltr', 'Left to right'], ['rtl', 'Right to left'], ['center', 'From center'], ['edges', 'From edges'], ['random', 'Random']) },
      { key: 'seed', label: 'Seed', kind: 'number', def: 1, min: 0, max: 9999, step: 1 },
    ],
  },
  text2d: {
    type: 'text2d', label: '2D Title', category: 'Type',
    blurb: 'Flat screen-space type for credit cards, like "3D: name / FX: name".',
    props: [
      n('x', 'X', 'Transform', 0.5, -0.5, 1.5, 0.001), n('y', 'Y', 'Transform', 0.5, -0.5, 1.5, 0.001),
      n('s', 'Scale', 'Transform', 1, 0, 8, 0.01), a('rz', 'Rotation', 'Transform', 0), p('opacity', 'Opacity', 'Transform', 1),
      c('color', 'Color', 'Style', '#ffffff'), n('glow', 'Glow', 'Style', 0, 0, 8, 0.01),
      n('spacing', 'Tracking', 'Style', 0, -0.2, 2, 0.001),
    ],
    settings: [
      { key: 'text', label: 'Text', kind: 'multiline', def: 'TITLE' },
      { key: 'font', label: 'Font', kind: 'font', def: FONT_DEFAULT },
      { key: 'size', label: 'Size', kind: 'number', def: 0.05, min: 0.005, max: 0.5, step: 0.001 },
      { key: 'skew', label: 'Italic Skew', kind: 'number', def: 0, min: -0.5, max: 0.5, step: 0.01 },
      { key: 'align', label: 'Align', kind: 'select', def: 'center', options: opts(['left', 'Left'], ['center', 'Center'], ['right', 'Right']) },
    ],
  },
  logo: {
    type: 'logo', label: '3D Logo', category: 'Type', spatial: true,
    blurb: 'Extrudes a built-in emblem or your own SVG, with the same material as 3D text.',
    props: [...transform(), ...material()],
    settings: [
      { key: 'shape', label: 'Shape', kind: 'select', def: 'bolt', options: SHAPES },
      { key: 'asset', label: 'SVG File', kind: 'asset', def: '', assetKind: 'svg' },
      { key: 'depth', label: 'Extrude', kind: 'number', def: 0.5, min: 0, max: 4, step: 0.01 },
      { key: 'bevel', label: 'Bevel', kind: 'number', def: 0.06, min: 0, max: 0.4, step: 0.005 },
      { key: 'bevelSegs', label: 'Bevel Segments', kind: 'number', def: 3, min: 1, max: 8, step: 1 },
    ],
  },
  image: {
    type: 'image', label: 'Image', category: 'Type', spatial: true,
    blurb: 'A picture on a plane in 3D space. Use it for a channel avatar or a logo PNG.',
    props: [...transform(), n('brightness', 'Brightness', 'Style', 1, 0, 8, 0.01)],
    settings: [
      { key: 'asset', label: 'Image File', kind: 'asset', def: '', assetKind: 'image' },
      { key: 'additive', label: 'Additive', kind: 'bool', def: false },
      { key: 'billboard', label: 'Face Camera', kind: 'bool', def: false },
    ],
  },
  light: {
    type: 'light', label: 'Light', category: 'Light', spatial: true,
    blurb: 'Point, spot, sun or ambient light.',
    props: [
      n('px', 'Position X', G_T, 4, -50, 50, 0.01), n('py', 'Position Y', G_T, 4, -50, 50, 0.01), n('pz', 'Position Z', G_T, 6, -50, 50, 0.01),
      c('color', 'Color', 'Light', '#ffffff'), n('intensity', 'Intensity', 'Light', 40, 0, 500, 0.1), n('range', 'Range', 'Light', 0, 0, 100, 0.1),
    ],
    settings: [{ key: 'kind', label: 'Kind', kind: 'select', def: 'point', options: opts(['point', 'Point'], ['spot', 'Spot'], ['directional', 'Sun'], ['ambient', 'Ambient']) }],
  },
  particles: {
    type: 'particles', label: 'Particles', category: 'Generators', spatial: true,
    blurb: 'Sparks, embers, warp stars, bokeh orbs. Replaces Trapcode Particular, but scrubs instantly.',
    props: [
      n('px', 'Position X', G_T, 0, -50, 50, 0.01), n('py', 'Position Y', G_T, 0, -50, 50, 0.01), n('pz', 'Position Z', G_T, 0, -50, 50, 0.01),
      n('s', 'Scale', G_T, 1, 0, 10, 0.01), p('opacity', 'Opacity', G_T, 1),
      c('color', 'Color', 'Look', '#ff5a7a'), c('color2', 'Hot Color', 'Look', '#ffffff'),
      n('size', 'Size', 'Look', 0.06, 0, 3, 0.001), n('brightness', 'Brightness', 'Look', 2, 0, 12, 0.01), n('stretch', 'Velocity Stretch', 'Look', 1, 0, 8, 0.01),
      n('spread', 'Spread', 'Motion', 10, 0, 60, 0.01), n('speed', 'Speed', 'Motion', 8, 0, 80, 0.01),
      n('gravity', 'Gravity', 'Motion', 0, -30, 30, 0.01), n('drag', 'Drag', 'Motion', 1.5, 0, 12, 0.01),
      n('life', 'Life', 'Motion', 1.6, 0.05, 12, 0.01, 's'), n('turb', 'Turbulence', 'Motion', 0.4, 0, 8, 0.01),
    ],
    settings: [
      { key: 'mode', label: 'Mode', kind: 'select', def: 'burst', options: opts(['burst', 'Burst'], ['ambient', 'Ambient Dust'], ['warp', 'Warp Tunnel'], ['bokeh', 'Bokeh Orbs'], ['embers', 'Rising Embers']) },
      { key: 'count', label: 'Count', kind: 'number', def: 1500, min: 10, max: 40000, step: 10 },
      { key: 'period', label: 'Re-burst Every', kind: 'number', def: 0, min: 0, max: 16, step: 0.01 },
      { key: 'seed', label: 'Seed', kind: 'number', def: 1, min: 0, max: 9999, step: 1 },
    ],
  },
  streaks: {
    type: 'streaks', label: 'Streaks', category: 'Generators', spatial: true,
    blurb: 'Glossy worm-like tendrils flying through frame. Replaces a Particular streaklet setup.',
    props: [
      ...transform(),
      c('color', 'Color', 'Look', '#ff2d55'), c('color2', 'Core Color', 'Look', '#ffd0da'),
      n('glow', 'Brightness', 'Look', 2.5, 0, 12, 0.01),
      n('width', 'Width', 'Look', 0.07, 0, 1, 0.001), n('length', 'Length', 'Look', 3, 0.05, 30, 0.01),
      n('spread', 'Spread', 'Motion', 12, 0, 60, 0.01), n('speed', 'Speed', 'Motion', 7, -60, 60, 0.01), n('curl', 'Curl', 'Motion', 1, 0, 6, 0.01),
    ],
    settings: [
      { key: 'mode', label: 'Mode', kind: 'select', def: 'burst', options: opts(['burst', 'Radial Burst'], ['flow', 'Fly Through'], ['swirl', 'Swirl']) },
      { key: 'count', label: 'Count', kind: 'number', def: 90, min: 1, max: 1200, step: 1 },
      { key: 'seed', label: 'Seed', kind: 'number', def: 1, min: 0, max: 9999, step: 1 },
    ],
  },
  splash: {
    type: 'splash', label: 'Liquid Crown', category: 'Generators', spatial: true,
    blurb: 'A liquid-metal splash blooming behind the text. Replaces a RealFlow sim and an overnight bake.',
    props: [
      ...transform(), ...material('#ff4468', '#30040e'),
      p('grow', 'Grow', 'Liquid', 1), n('radius', 'Radius', 'Liquid', 5, 0.1, 40, 0.01), n('thickness', 'Thickness', 'Liquid', 0.32, 0.01, 2, 0.001),
      n('turb', 'Turbulence', 'Liquid', 1, 0, 4, 0.01), n('flow', 'Flow Speed', 'Liquid', 0.4, 0, 6, 0.01),
    ],
    settings: [
      { key: 'arms', label: 'Arms', kind: 'number', def: 110, min: 8, max: 600, step: 1 },
      { key: 'flat', label: 'Flatness', kind: 'number', def: 0.3, min: 0, max: 1, step: 0.01 },
      { key: 'seed', label: 'Seed', kind: 'number', def: 1, min: 0, max: 9999, step: 1 },
    ],
  },
  dots: {
    type: 'dots', label: 'Dot Field', category: 'Generators', spatial: true,
    blurb: 'A waving halftone sheet of glowing dots. Replaces a Plexus grid.',
    props: [
      ...transform(),
      c('color', 'Color', 'Look', '#ff2d55'), c('color2', 'Peak Color', 'Look', '#ffc2cf'),
      n('size', 'Dot Size', 'Look', 0.09, 0, 1, 0.001), n('brightness', 'Brightness', 'Look', 2, 0, 12, 0.01), n('spacing', 'Spacing', 'Look', 0.6, 0.05, 4, 0.001),
      n('waveAmp', 'Wave Height', 'Wave', 1.2, 0, 12, 0.01), n('waveFreq', 'Wave Frequency', 'Wave', 0.35, 0, 4, 0.001), n('waveSpeed', 'Wave Speed', 'Wave', 1, -8, 8, 0.01),
      p('reveal', 'Radial Reveal', 'Wave', 1), p('twinkle', 'Twinkle', 'Wave', 0.3),
    ],
    settings: [
      { key: 'cols', label: 'Columns', kind: 'number', def: 90, min: 4, max: 300, step: 1 },
      { key: 'rows', label: 'Rows', kind: 'number', def: 60, min: 4, max: 300, step: 1 },
      { key: 'seed', label: 'Seed', kind: 'number', def: 1, min: 0, max: 9999, step: 1 },
    ],
  },
  debris: {
    type: 'debris', label: 'Debris', category: 'Generators', spatial: true,
    blurb: 'Tumbling rock chunks. Replaces C4D Voronoi Fracture + dynamics.',
    props: [
      ...transform(), ...material('#d8c8cc', '#4a0a18'),
      p('explode', 'Explode', 'Motion', 1), n('radius', 'Radius', 'Motion', 7, 0, 60, 0.01),
      n('size', 'Chunk Size', 'Motion', 0.5, 0.01, 4, 0.001), n('spin', 'Spin', 'Motion', 1, 0, 12, 0.01),
      n('gravity', 'Gravity', 'Motion', 0, -30, 30, 0.01),
    ],
    settings: [
      { key: 'count', label: 'Count', kind: 'number', def: 60, min: 1, max: 1500, step: 1 },
      { key: 'flat', label: 'Flatness', kind: 'number', def: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'seed', label: 'Seed', kind: 'number', def: 1, min: 0, max: 9999, step: 1 },
    ],
  },
  lightning: {
    type: 'lightning', label: 'Lightning', category: 'Generators', spatial: true,
    blurb: 'Crackling electric arcs. Replaces Saber and Advanced Lightning.',
    props: [
      ...transform(),
      c('color', 'Color', 'Look', '#ff4468'), n('glow', 'Brightness', 'Look', 4, 0, 16, 0.01), n('thickness', 'Thickness', 'Look', 0.035, 0, 0.4, 0.001),
      n('radius', 'Radius', 'Arc', 6, 0, 40, 0.01), n('inner', 'Inner Radius', 'Arc', 1.5, 0, 40, 0.01), n('jitter', 'Jitter', 'Arc', 0.6, 0, 3, 0.01),
      n('rate', 'Crackle Rate', 'Arc', 18, 0, 60, 0.1, 'fps'), p('reach', 'Reach', 'Arc', 1),
    ],
    settings: [
      { key: 'bolts', label: 'Bolts', kind: 'number', def: 14, min: 1, max: 120, step: 1 },
      { key: 'segments', label: 'Segments', kind: 'number', def: 28, min: 4, max: 96, step: 1 },
      { key: 'seed', label: 'Seed', kind: 'number', def: 1, min: 0, max: 9999, step: 1 },
    ],
  },
  shockwave: {
    type: 'shockwave', label: 'Shockwave', category: 'Generators', spatial: true,
    blurb: 'An expanding energy ring for impacts.',
    props: [
      ...transform(),
      c('color', 'Color', 'Look', '#ff5a7a'), n('glow', 'Brightness', 'Look', 3, 0, 16, 0.01),
      n('radius', 'Radius', 'Ring', 6, 0, 80, 0.01), n('width', 'Width', 'Ring', 0.35, 0.001, 8, 0.001), p('noise', 'Roughness', 'Ring', 0.4),
    ],
    settings: [{ key: 'seed', label: 'Seed', kind: 'number', def: 1, min: 0, max: 9999, step: 1 }],
  },
  flare: {
    type: 'flare', label: 'Lens Flare', category: 'Light', spatial: true,
    blurb: 'A flare pinned to a 3D point. Replaces Optical Flares.',
    props: [
      n('px', 'Position X', G_T, 0, -50, 50, 0.01), n('py', 'Position Y', G_T, 0, -50, 50, 0.01), n('pz', 'Position Z', G_T, 0, -50, 50, 0.01),
      c('color', 'Color', 'Flare', '#ff4468'), n('intensity', 'Intensity', 'Flare', 1, 0, 8, 0.01), n('size', 'Size', 'Flare', 1, 0, 6, 0.01),
      n('streak', 'Streak', 'Flare', 0.8, 0, 4, 0.01), n('ghosts', 'Ghosts', 'Flare', 0.4, 0, 3, 0.01), p('flicker', 'Flicker', 'Flare', 0.1),
    ],
    settings: [{ key: 'seed', label: 'Seed', kind: 'number', def: 1, min: 0, max: 9999, step: 1 }],
  },
  null: {
    type: 'null', label: 'Null', category: 'Scene', spatial: true,
    blurb: 'An invisible parent. Link layers to it and move them together.',
    props: transform(),
    settings: [],
  },
};

export const LAYER_ORDER: LayerType[] = [
  'text3d', 'text2d', 'logo', 'image', 'particles', 'streaks', 'splash', 'dots', 'debris', 'lightning', 'shockwave',
  'flare', 'light', 'camera', 'background', 'null',
];

export const FONTS = ['Black Ops One', 'Russo One', 'Orbitron', 'Bungee', 'Anton', 'Audiowide', 'Michroma', 'Saira Stencil One'];

export interface HitDef { kind: HitKind; label: string; key: string; color: string; dur: number; blurb: string }
export const HIT_DEFS: HitDef[] = [
  { kind: 'shake', label: 'Shake', key: '1', color: '#ff9f0a', dur: 0.35, blurb: 'Decaying camera shake' },
  { kind: 'punch', label: 'Punch', key: '2', color: '#ff375f', dur: 0.28, blurb: 'Snap zoom in, spring back' },
  { kind: 'whip', label: 'Whip', key: '3', color: '#bf5af2', dur: 0.3, blurb: 'Frame whips sideways and settles' },
  { kind: 'flash', label: 'Flash', key: '4', color: '#f5f5f7', dur: 0.22, blurb: 'White flash' },
  { kind: 'rgb', label: 'RGB', key: '5', color: '#30d158', dur: 0.25, blurb: 'Chromatic split pop' },
  { kind: 'invert', label: 'Invert', key: '6', color: '#64d2ff', dur: 0.1, blurb: 'Negative frame' },
  { kind: 'hue', label: 'Hue Flip', key: '7', color: '#a2f54a', dur: 0.14, blurb: 'Rotates the grade for a beat' },
  { kind: 'bars', label: 'Bars', key: '8', color: '#8e8e93', dur: 0.4, blurb: 'Letterbox slam' },
  { kind: 'glitch', label: 'Glitch', key: '9', color: '#5e5ce6', dur: 0.18, blurb: 'Datamosh slices' },
  { kind: 'blur', label: 'Zoom Blur', key: '0', color: '#ffd60a', dur: 0.2, blurb: 'Radial speed blur' },
];
export const HIT_DEF: Record<HitKind, HitDef> = Object.fromEntries(HIT_DEFS.map((h) => [h.kind, h])) as any;

export const SFX_LIST: { id: SfxId; label: string; dur: number }[] = [
  { id: 'whoosh', label: 'Whoosh', dur: 0.7 }, { id: 'whooshLong', label: 'Long Whoosh', dur: 2 },
  { id: 'impact', label: 'Cinematic Impact', dur: 2.5 }, { id: 'boom', label: 'Sub Boom', dur: 3 },
  { id: 'subDrop', label: 'Sub Drop', dur: 2 }, { id: 'riser', label: 'Noise Riser', dur: 4 },
  { id: 'reverseCymbal', label: 'Reverse Cymbal', dur: 2 }, { id: 'snareRoll', label: 'Snare Roll', dur: 2 },
  { id: 'glitch', label: 'Glitch Burst', dur: 0.5 }, { id: 'stutter', label: 'Stutter', dur: 0.6 },
  { id: 'zap', label: 'Laser Zap', dur: 0.4 }, { id: 'tapeStop', label: 'Tape Stop', dur: 1 },
  { id: 'shimmer', label: 'Shimmer', dur: 3 }, { id: 'metalHit', label: 'Metal Hit', dur: 1.5 },
];

export function makeTrack(value: PropValue): Track {
  return { value, keys: [] };
}

export function createLayer(type: LayerType, overrides: Partial<Layer> = {}, duration = 10): Layer {
  const def = LAYER_DEFS[type];
  const props: Record<string, Track> = {};
  for (const pd of def.props) props[pd.key] = makeTrack(pd.def);
  const settings: Record<string, any> = {};
  for (const sd of def.settings) settings[sd.key] = sd.def;
  return {
    id: uid('ly'), type, name: def.label, visible: true, solo: false, locked: false,
    start: 0, end: duration, parent: null, props, settings, ...overrides,
  };
}

export function propDef(type: LayerType, key: string): PropDef | undefined {
  return LAYER_DEFS[type].props.find((d) => d.key === key);
}
