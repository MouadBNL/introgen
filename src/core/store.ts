import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { AudioClip, Ease, HitKind, Keyframe, Layer, LayerType, Marker, MusicConfig, Project, PropValue, SyncHit, Track } from './types';
import { LAYER_DEFS, createLayer, HIT_DEF } from './schema';
import { evalTrack, snapToBeat, snapToFrame } from './eval';
import { uid } from './rng';

setAutoFreeze(false);

/**
 * Transport lives in its own store: it changes every frame during playback and
 * must not re-render panels that only care about the project.
 */
export interface TransportState {
  time: number;
  playing: boolean;
  loop: boolean;
  setTime: (t: number) => void;
}
export const useTransport = create<TransportState>((set) => ({
  time: 0,
  playing: false,
  loop: true,
  setTime: (t) => set({ time: t }),
}));

export type PreviewQuality = 'draft' | 'half' | 'full';
export type ViewMode = 'camera' | 'free';
export type TimelineMode = 'dope' | 'graph';
export type LeftTab = 'layers' | 'library' | 'audio' | 'project';

export interface Selection {
  layers: string[];
  keys: string[];   // keyframe ids (unique project-wide)
  hits: string[];
  clips: string[];
}

export interface UIState {
  quality: PreviewQuality;
  view: ViewMode;
  timelineMode: TimelineMode;
  leftTab: LeftTab;
  snapBeats: boolean;
  beatDiv: number;       // 1, 2, 4, 8 subdivisions per beat
  pxPerSec: number;      // timeline zoom
  scrollX: number;       // timeline horizontal scroll in seconds
  graphProp: { layer: string; key: string } | null;
  showGizmo: boolean;
  safeAreas: boolean;
  exportOpen: boolean;
  musicOpen: boolean;
  shortcutsOpen: boolean;
  /** Sync kind stamped by the Tap key during playback. */
  tapKind: HitKind;
  toast: { id: number; text: string } | null;
}

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  sel: Selection;
  ui: UIState;
  /** Bumps on every project change so non-React consumers (engine, audio) can diff cheaply. */
  rev: number;

  // history
  /** Record an undo step, then apply recipe. */
  commit: (label: string, recipe: (p: Project) => void) => void;
  /** Apply without recording. Use between beginDrag() and endDrag(). */
  patch: (recipe: (p: Project) => void) => void;
  beginDrag: () => void;
  endDrag: () => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: Project) => void;

  // selection & ui
  select: (s: Partial<Selection>, additive?: boolean) => void;
  clearSelection: () => void;
  setUI: (u: Partial<UIState>) => void;
  toast: (text: string) => void;

  // layers
  addLayer: (type: LayerType, overrides?: Partial<Layer>) => string;
  removeSelected: () => void;
  removeLayers: (ids: string[]) => void;
  duplicateLayers: (ids: string[]) => void;
  moveLayer: (id: string, toIndex: number) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  setSetting: (id: string, key: string, value: any) => void;

  // properties & keys
  /** Sets the value at the playhead: writes a key if the property is animated, otherwise the static value. */
  setProp: (layerId: string, key: string, value: PropValue, opts?: { noHistory?: boolean }) => void;
  /** Stopwatch: turns animation on (keys at playhead) or off (keeps current value). */
  toggleAnimated: (layerId: string, key: string) => void;
  addKeyAtPlayhead: (layerId: string, key: string) => void;
  setTrack: (layerId: string, key: string, patch: Partial<Track>) => void;
  moveKeys: (ids: string[], dt: number, opts?: { noHistory?: boolean }) => void;
  setKeyValue: (keyId: string, v: PropValue, opts?: { noHistory?: boolean }) => void;
  setKeysEase: (ids: string[], ease: Ease) => void;
  deleteKeys: (ids: string[]) => void;
  copyKeys: () => void;
  pasteKeys: () => void;

  // sync hits
  addHit: (kind: HitKind, t: number, amount?: number) => string;
  updateHits: (ids: string[], patch: Partial<SyncHit>) => void;
  moveHits: (ids: string[], dt: number, opts?: { noHistory?: boolean }) => void;
  deleteHits: (ids: string[]) => void;

  // audio
  addClip: (clip: Omit<AudioClip, 'id'>) => string;
  updateClip: (id: string, patch: Partial<AudioClip>, opts?: { noHistory?: boolean }) => void;
  deleteClips: (ids: string[]) => void;
  setMusic: (m: Partial<MusicConfig>) => void;

  // markers
  addMarker: (t: number, label?: string) => void;
  deleteMarker: (id: string) => void;

  // project
  setProjectMeta: (patch: Partial<Pick<Project, 'name' | 'width' | 'height' | 'fps' | 'duration' | 'bpm' | 'beatOffset' | 'masterGain'>>) => void;
  snapTime: (t: number) => number;
}

const MAX_HISTORY = 200;

export function emptyProject(): Project {
  return {
    version: 1, name: 'Untitled Intro', width: 1920, height: 1080, fps: 60, duration: 10,
    bpm: 140, beatOffset: 0, layers: [
      createLayer('camera', { name: 'Camera' }),
      createLayer('post', { name: 'Post FX' }),
      createLayer('background', { name: 'Background' }),
    ], hits: [], markers: [], clips: [],
    music: { style: 'dubstep', bpm: 140, root: 41, minor: true, seed: 7, buildBars: 4, dropBars: 4, outroBars: 1, intensity: 0.8 },
    assets: [], masterGain: 0.9,
  };
}

let clipboard: { layerId: string; key: string; keys: Keyframe[] }[] = [];

export function findKey(p: Project, keyId: string): { layer: Layer; key: string; kf: Keyframe } | null {
  for (const layer of p.layers) {
    for (const key in layer.props) {
      const kf = layer.props[key].keys.find((k) => k.id === keyId);
      if (kf) return { layer, key, kf };
    }
  }
  return null;
}

function sortKeys(tr: Track) {
  tr.keys.sort((a, b) => a.t - b.t);
}

function upsertKey(tr: Track, t: number, v: PropValue, ease: Ease = [0.33, 0, 0.67, 1]) {
  const eps = 1 / 240;
  const existing = tr.keys.find((k) => Math.abs(k.t - t) < eps);
  if (existing) existing.v = v;
  else {
    tr.keys.push({ id: uid('k'), t, v, ease });
    sortKeys(tr);
  }
}

export const useEditor = create<EditorState>((set, get) => {
  let dragBase: Project | null = null;

  const apply = (recipe: (p: Project) => void, record: boolean) => {
    const s = get();
    const next = produce(s.project, recipe);
    if (next === s.project) return;
    if (record && !dragBase) {
      set({ project: next, past: [...s.past.slice(-MAX_HISTORY + 1), s.project], future: [], rev: s.rev + 1 });
    } else set({ project: next, rev: s.rev + 1 });
  };
  const time = () => useTransport.getState().time;

  return {
    project: emptyProject(),
    past: [], future: [],
    sel: { layers: [], keys: [], hits: [], clips: [] },
    ui: {
      quality: 'half', view: 'camera', timelineMode: 'dope', leftTab: 'layers', snapBeats: true, beatDiv: 4,
      pxPerSec: 120, scrollX: 0, graphProp: null, showGizmo: true, safeAreas: false, exportOpen: false, musicOpen: false,
      shortcutsOpen: false, tapKind: 'shake', toast: null,
    },
    rev: 0,

    commit: (_label, recipe) => apply(recipe, true),
    patch: (recipe) => apply(recipe, false),
    beginDrag: () => { dragBase = get().project; },
    endDrag: () => {
      const s = get();
      if (dragBase && dragBase !== s.project) set({ past: [...s.past.slice(-MAX_HISTORY + 1), dragBase], future: [] });
      dragBase = null;
    },
    undo: () => {
      const s = get();
      if (!s.past.length) return;
      const prev = s.past[s.past.length - 1];
      set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], rev: s.rev + 1 });
    },
    redo: () => {
      const s = get();
      if (!s.future.length) return;
      const nxt = s.future[0];
      set({ project: nxt, future: s.future.slice(1), past: [...s.past, s.project], rev: s.rev + 1 });
    },
    loadProject: (p) => {
      set({ project: p, past: [], future: [], sel: { layers: [], keys: [], hits: [], clips: [] }, rev: get().rev + 1 });
      useTransport.getState().setTime(Math.min(useTransport.getState().time, p.duration));
    },

    select: (s, additive) => set((st) => {
      if (!additive) return { sel: { layers: [], keys: [], hits: [], clips: [], ...s } };
      const merge = (a: string[], b?: string[]) => {
        if (!b) return a;
        const out = new Set(a);
        for (const x of b) out.has(x) ? out.delete(x) : out.add(x);
        return [...out];
      };
      return { sel: { layers: merge(st.sel.layers, s.layers), keys: merge(st.sel.keys, s.keys), hits: merge(st.sel.hits, s.hits), clips: merge(st.sel.clips, s.clips) } };
    }),
    clearSelection: () => set({ sel: { layers: [], keys: [], hits: [], clips: [] } }),
    setUI: (u) => set((st) => ({ ui: { ...st.ui, ...u } })),
    toast: (text) => {
      const id = Date.now();
      set((st) => ({ ui: { ...st.ui, toast: { id, text } } }));
      setTimeout(() => { if (get().ui.toast?.id === id) set((st) => ({ ui: { ...st.ui, toast: null } })); }, 2200);
    },

    addLayer: (type, overrides = {}) => {
      const p = get().project;
      if (LAYER_DEFS[type].singleton && p.layers.some((l) => l.type === type)) {
        const existing = p.layers.find((l) => l.type === type)!;
        set({ sel: { layers: [existing.id], keys: [], hits: [], clips: [] } });
        return existing.id;
      }
      const layer = createLayer(type, { start: 0, end: p.duration, ...overrides }, p.duration);
      apply((d) => {
        // New layers go above the selected one, or at the top.
        const selId = get().sel.layers[0];
        const idx = selId ? Math.max(0, d.layers.findIndex((l) => l.id === selId)) : 0;
        d.layers.splice(idx, 0, layer);
      }, true);
      set({ sel: { layers: [layer.id], keys: [], hits: [], clips: [] } });
      return layer.id;
    },
    removeSelected: () => {
      const { sel } = get();
      if (sel.keys.length) get().deleteKeys(sel.keys);
      else if (sel.hits.length) get().deleteHits(sel.hits);
      else if (sel.clips.length) get().deleteClips(sel.clips);
      else if (sel.layers.length) get().removeLayers(sel.layers);
    },
    removeLayers: (ids) => {
      apply((d) => {
        d.layers = d.layers.filter((l) => !ids.includes(l.id) || LAYER_DEFS[l.type].singleton);
        for (const l of d.layers) if (l.parent && ids.includes(l.parent)) l.parent = null;
      }, true);
      get().clearSelection();
    },
    duplicateLayers: (ids) => {
      const newIds: string[] = [];
      apply((d) => {
        for (const id of ids) {
          const i = d.layers.findIndex((l) => l.id === id);
          if (i < 0 || LAYER_DEFS[d.layers[i].type].singleton) continue;
          const copy: Layer = JSON.parse(JSON.stringify(d.layers[i]));
          copy.id = uid('ly');
          copy.name = `${copy.name} copy`;
          for (const k in copy.props) for (const kf of copy.props[k].keys) kf.id = uid('k');
          d.layers.splice(i, 0, copy);
          newIds.push(copy.id);
        }
      }, true);
      set({ sel: { layers: newIds, keys: [], hits: [], clips: [] } });
    },
    moveLayer: (id, toIndex) => apply((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      if (i < 0) return;
      const [l] = d.layers.splice(i, 1);
      d.layers.splice(Math.max(0, Math.min(d.layers.length, toIndex)), 0, l);
    }, true),
    updateLayer: (id, patch) => apply((d) => {
      const l = d.layers.find((x) => x.id === id);
      if (l) Object.assign(l, patch);
    }, true),
    setSetting: (id, key, value) => apply((d) => {
      const l = d.layers.find((x) => x.id === id);
      if (l) l.settings[key] = value;
    }, true),

    setProp: (layerId, key, value, opts) => apply((d) => {
      const l = d.layers.find((x) => x.id === layerId);
      const tr = l?.props[key];
      if (!l || !tr) return;
      if (tr.keys.length) upsertKey(tr, snapToFrame(d.fps, time()), value);
      else tr.value = value;
    }, !opts?.noHistory),
    toggleAnimated: (layerId, key) => apply((d) => {
      const l = d.layers.find((x) => x.id === layerId);
      const tr = l?.props[key];
      if (!l || !tr) return;
      const t = time();
      if (tr.keys.length) {
        tr.value = evalTrack({ ...tr, wiggle: undefined, audio: undefined }, t);
        tr.keys = [];
      } else {
        tr.keys = [{ id: uid('k'), t: snapToFrame(d.fps, t), v: tr.value, ease: [0.33, 0, 0.67, 1] }];
      }
    }, true),
    addKeyAtPlayhead: (layerId, key) => apply((d) => {
      const l = d.layers.find((x) => x.id === layerId);
      const tr = l?.props[key];
      if (!l || !tr) return;
      const t = time();
      const v = evalTrack({ ...tr, wiggle: undefined, audio: undefined }, t);
      upsertKey(tr, snapToFrame(d.fps, t), v);
    }, true),
    setTrack: (layerId, key, patchTr) => apply((d) => {
      const tr = d.layers.find((x) => x.id === layerId)?.props[key];
      if (tr) Object.assign(tr, patchTr);
    }, true),
    moveKeys: (ids, dt, opts) => apply((d) => {
      const set_ = new Set(ids);
      for (const l of d.layers) for (const k in l.props) {
        const tr = l.props[k];
        let touched = false;
        for (const kf of tr.keys) if (set_.has(kf.id)) { kf.t = Math.max(0, kf.t + dt); touched = true; }
        if (touched) sortKeys(tr);
      }
    }, !opts?.noHistory),
    setKeyValue: (keyId, v, opts) => apply((d) => {
      const f = findKey(d, keyId);
      if (f) f.kf.v = v;
    }, !opts?.noHistory),
    setKeysEase: (ids, ease) => apply((d) => {
      const s_ = new Set(ids);
      for (const l of d.layers) for (const k in l.props) for (const kf of l.props[k].keys) if (s_.has(kf.id)) kf.ease = ease;
    }, true),
    deleteKeys: (ids) => {
      const s_ = new Set(ids);
      apply((d) => {
        for (const l of d.layers) for (const k in l.props) {
          const tr = l.props[k];
          if (!tr.keys.some((kf) => s_.has(kf.id))) continue;
          const remaining = tr.keys.filter((kf) => !s_.has(kf.id));
          if (remaining.length === 0) tr.value = tr.keys[0].v;
          tr.keys = remaining;
        }
      }, true);
      set((st) => ({ sel: { ...st.sel, keys: [] } }));
    },
    copyKeys: () => {
      const { project, sel } = get();
      const s_ = new Set(sel.keys);
      clipboard = [];
      for (const l of project.layers) for (const k in l.props) {
        const ks = l.props[k].keys.filter((kf) => s_.has(kf.id));
        if (ks.length) clipboard.push({ layerId: l.id, key: k, keys: ks.map((x) => ({ ...x })) });
      }
      if (clipboard.length) get().toast(`Copied ${clipboard.reduce((a, c) => a + c.keys.length, 0)} keyframes`);
    },
    pasteKeys: () => {
      if (!clipboard.length) return;
      const t0 = Math.min(...clipboard.flatMap((c) => c.keys.map((k) => k.t)));
      const now = time();
      const target = get().sel.layers.length === 1 ? get().sel.layers[0] : null;
      const newIds: string[] = [];
      apply((d) => {
        for (const c of clipboard) {
          const l = d.layers.find((x) => x.id === (target ?? c.layerId));
          const tr = l?.props[c.key];
          if (!tr) continue;
          for (const kf of c.keys) {
            const t = snapToFrame(d.fps, now + kf.t - t0);
            tr.keys = tr.keys.filter((x) => Math.abs(x.t - t) > 1 / 240);
            const id = uid('k');
            tr.keys.push({ ...kf, id, t });
            newIds.push(id);
          }
          sortKeys(tr);
        }
      }, true);
      set((st) => ({ sel: { ...st.sel, keys: newIds } }));
    },

    addHit: (kind, t, amount = 1) => {
      const id = uid('h');
      apply((d) => { d.hits.push({ id, t, kind, amount, dur: HIT_DEF[kind].dur }); d.hits.sort((a, b) => a.t - b.t); }, true);
      return id;
    },
    updateHits: (ids, patchH) => apply((d) => { for (const h of d.hits) if (ids.includes(h.id)) Object.assign(h, patchH); }, true),
    moveHits: (ids, dt, opts) => apply((d) => {
      for (const h of d.hits) if (ids.includes(h.id)) h.t = Math.max(0, h.t + dt);
      d.hits.sort((a, b) => a.t - b.t);
    }, !opts?.noHistory),
    deleteHits: (ids) => {
      apply((d) => { d.hits = d.hits.filter((h) => !ids.includes(h.id)); }, true);
      set((st) => ({ sel: { ...st.sel, hits: [] } }));
    },

    addClip: (clip) => {
      const id = uid('c');
      apply((d) => { d.clips.push({ ...clip, id }); }, true);
      return id;
    },
    updateClip: (id, patchC, opts) => apply((d) => {
      const c = d.clips.find((x) => x.id === id);
      if (c) Object.assign(c, patchC);
    }, !opts?.noHistory),
    deleteClips: (ids) => {
      apply((d) => { d.clips = d.clips.filter((c) => !ids.includes(c.id)); }, true);
      set((st) => ({ sel: { ...st.sel, clips: [] } }));
    },
    setMusic: (m) => apply((d) => { Object.assign(d.music, m); }, true),

    addMarker: (t, label = '') => apply((d) => { d.markers.push({ id: uid('m'), t, label }); d.markers.sort((a, b) => a.t - b.t); }, true),
    deleteMarker: (id) => apply((d) => { d.markers = d.markers.filter((m: Marker) => m.id !== id); }, true),

    setProjectMeta: (patchP) => apply((d) => { Object.assign(d, patchP); }, true),
    snapTime: (t) => {
      const { project, ui } = get();
      return ui.snapBeats ? snapToBeat(project, t, ui.beatDiv) : snapToFrame(project.fps, t);
    },
  };
});

/** Imperative helpers for non-React code. */
export const editor = () => useEditor.getState();
export const transport = () => useTransport.getState();
