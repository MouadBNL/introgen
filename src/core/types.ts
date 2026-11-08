/**
 * Introgen project model. Everything rendered is a pure function of (Project, time):
 * no simulation state survives between frames, so scrubbing and export are exact.
 */

export type PropValue = number | string; // number, or '#rrggbb' for colors

/** CSS-style cubic bezier in normalized segment space. y may overshoot 0..1. */
export type Bezier = [number, number, number, number];
/** Ease governs the segment that STARTS at this key. */
export type Ease = 'linear' | 'hold' | Bezier;

export interface Keyframe {
  id: string;
  t: number; // seconds
  v: PropValue;
  ease: Ease;
}

export type Band = 'low' | 'mid' | 'high' | 'full';

/** After Effects' wiggle(), as a per-property switch. */
export interface Wiggle { amp: number; freq: number; seed: number }
/** Adds amount * bandEnvelope(t) (0..1) to the property. */
export interface AudioLink { band: Band; amount: number }

export interface Track {
  value: PropValue;     // used when keys is empty
  keys: Keyframe[];     // sorted by t
  wiggle?: Wiggle;
  audio?: AudioLink;
}

export type LayerType =
  | 'camera' | 'post' | 'background' | 'text3d' | 'text2d' | 'logo' | 'image' | 'light'
  | 'particles' | 'streaks' | 'splash' | 'dots' | 'debris' | 'lightning' | 'shockwave'
  | 'flare' | 'null';

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  visible: boolean;
  solo: boolean;
  locked: boolean;
  start: number;  // in point, seconds
  end: number;    // out point, seconds
  parent: string | null;
  props: Record<string, Track>;
  settings: Record<string, any>; // non-animatable: changing these rebuilds geometry
}

export type HitKind =
  | 'shake' | 'punch' | 'whip' | 'flash' | 'rgb' | 'invert' | 'hue' | 'bars' | 'glitch' | 'blur';

/** One sync event: a decaying envelope layered on top of camera + post. */
export interface SyncHit {
  id: string;
  t: number;
  kind: HitKind;
  amount: number; // 0..2, 1 = default strength
  dur: number;    // seconds
}

export interface Marker { id: string; t: number; label: string; color?: string }

export type SfxId =
  | 'whoosh' | 'whooshLong' | 'impact' | 'subDrop' | 'riser' | 'reverseCymbal' | 'glitch'
  | 'zap' | 'boom' | 'snareRoll' | 'tapeStop' | 'shimmer' | 'stutter' | 'metalHit';

export type AudioSource =
  | { kind: 'music' }
  | { kind: 'sfx'; sfx: SfxId; seed: number }
  | { kind: 'asset'; assetId: string };

export interface AudioClip {
  id: string;
  name: string;
  source: AudioSource;
  lane: number;    // timeline audio lane index
  t: number;       // timeline start, seconds
  offset: number;  // seek into source, seconds
  dur: number;     // seconds
  gain: number;    // linear
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
}

export type MusicStyle = 'dubstep' | 'trap' | 'hardstyle' | 'synthwave' | 'drumstep';

export interface MusicConfig {
  style: MusicStyle;
  bpm: number;
  root: number;       // MIDI note of tonic, e.g. 41 = F2
  minor: boolean;
  seed: number;
  buildBars: number;  // bars before the drop
  dropBars: number;   // bars of drop
  outroBars: number;  // tail bars after the drop
  intensity: number;  // 0..1
}

export type AssetKind = 'audio' | 'image' | 'font' | 'svg';
export interface Asset { id: string; kind: AssetKind; name: string; dataUrl: string }

export interface Project {
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  bpm: number;
  beatOffset: number; // seconds: where beat 1 of the grid falls
  layers: Layer[];    // index 0 = top of the layer stack
  hits: SyncHit[];
  markers: Marker[];
  clips: AudioClip[];
  music: MusicConfig;
  assets: Asset[];
  masterGain: number;
}

/** Sampled audio envelopes for audio-reactive links, values 0..1. */
export interface BandEnvelopes {
  rate: number; // samples per second
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  full: Float32Array;
}
