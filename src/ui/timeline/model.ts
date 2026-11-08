/** Timeline row model: flattens the project into rows with fixed y offsets, plus cached key lookups. */
import type { HitKind, Keyframe, Layer, Project, SyncHit, Track } from '../../core/types';
import { HIT_DEFS, LAYER_DEFS, type PropDef } from '../../core/schema';

/** Pixels between the canvas left edge and t = scrollX, so a key on frame 0 is not clipped. */
export const PAD = 14;
export const MIN_PPS = 20;
export const MAX_PPS = 1500;
export const H = { section: 22, lane: 24, audio: 46, group: 20, note: 22 };
export const GRAPH_COLORS = ['#ff6b6b', '#5fdd7f', '#5aa9ff', '#ffcc4d', '#d08bff', '#4fd6d6', '#ff9a57', '#f49ac1'];

export type SectionId = 'sync' | 'audio' | 'layers';

interface RowBase { id: string; y: number; h: number }
export type Row =
  | RowBase & { kind: 'section'; section: SectionId; count: number }
  | RowBase & { kind: 'hitAll'; count: number }
  | RowBase & { kind: 'hitLane'; hitKind: HitKind; count: number }
  | RowBase & { kind: 'clipLane'; lane: number }
  | RowBase & { kind: 'layer'; layer: Layer }
  | RowBase & { kind: 'group'; layer: Layer; group: string }
  | RowBase & { kind: 'prop'; layer: Layer; key: string; def: PropDef; track: Track; color?: string }
  | RowBase & { kind: 'note'; text: string };
export type PropRow = Extract<Row, { kind: 'prop' }>;
type RowInit = Row extends infer R ? (R extends Row ? Omit<R, 'y'> : never) : never;

/** View state that survives reloads. */
export interface Persist {
  headW: number;
  collapsed: Record<SectionId, boolean>;
  expanded: Record<string, boolean>;     // layer id
  closedGroups: Record<string, boolean>; // `${layerId}/${group}`
  animatedOnly: boolean;
}

const STORE_KEY = 'introgen.timeline.v1';

export function loadPersist(): Persist {
  const base: Persist = {
    headW: 240, collapsed: { sync: true, audio: false, layers: false }, expanded: {}, closedGroups: {}, animatedOnly: true,
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...base, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return base;
}

export function savePersist(p: Persist) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

export const isAnimated = (tr: Track) => tr.keys.length > 0 || !!tr.wiggle || !!tr.audio;

export function buildRows(p: Project, v: Persist, tapKind: HitKind): Row[] {
  const rows: Row[] = [];
  let y = 0;
  const push = (r: RowInit) => { rows.push({ ...r, y } as Row); y += r.h; };

  push({ kind: 'section', section: 'sync', id: 's:sync', h: H.section, count: p.hits.length });
  if (v.collapsed.sync) push({ kind: 'hitAll', id: 'hit:all', h: H.lane, count: p.hits.length });
  else {
    const counts = hitCounts(p.hits);
    for (const d of HIT_DEFS) {
      const n = counts.get(d.kind) ?? 0;
      if (n > 0 || d.kind === tapKind) push({ kind: 'hitLane', id: `hit:${d.kind}`, h: H.lane, hitKind: d.kind, count: n });
    }
  }

  push({ kind: 'section', section: 'audio', id: 's:audio', h: H.section, count: p.clips.length });
  if (!v.collapsed.audio) {
    const lanes = Math.max(3, p.clips.reduce((m, c) => Math.max(m, c.lane), -1) + 2);
    for (let i = 0; i < lanes; i++) push({ kind: 'clipLane', id: `clip:${i}`, h: H.audio, lane: i });
  }

  push({ kind: 'section', section: 'layers', id: 's:layers', h: H.section, count: p.layers.length });
  if (!v.collapsed.layers) {
    for (const layer of p.layers) {
      push({ kind: 'layer', id: `l:${layer.id}`, h: H.lane, layer });
      if (!v.expanded[layer.id]) continue;
      let group: string | null = null;
      let any = false;
      for (const def of LAYER_DEFS[layer.type].props) {
        const track = layer.props[def.key];
        if (!track || (v.animatedOnly && !isAnimated(track))) continue;
        any = true;
        if (def.group !== group) {
          group = def.group;
          push({ kind: 'group', id: `g:${layer.id}/${group}`, h: H.group, layer, group });
        }
        if (!v.closedGroups[`${layer.id}/${group}`]) {
          push({ kind: 'prop', id: `p:${layer.id}/${def.key}`, h: H.lane, layer, key: def.key, def, track });
        }
      }
      if (!any) push({ kind: 'note', id: `n:${layer.id}`, h: H.note, text: 'No animated properties. Set Show to All.' });
    }
  }
  return rows;
}

/** Graph mode: animated numeric tracks of the selected layers (and of ui.graphProp's layer). */
export function buildGraphRows(p: Project, selLayers: string[], focus: { layer: string; key: string } | null): Row[] {
  const rows: Row[] = [];
  let y = 0;
  const ids = new Set(selLayers);
  if (focus) ids.add(focus.layer);
  let n = 0;
  for (const layer of p.layers) {
    if (!ids.has(layer.id)) continue;
    rows.push({ kind: 'layer', id: `l:${layer.id}`, y, h: H.lane, layer });
    y += H.lane;
    let any = false;
    for (const def of LAYER_DEFS[layer.type].props) {
      const track = layer.props[def.key];
      if (!track || !track.keys.length || typeof track.keys[0].v !== 'number') continue;
      any = true;
      rows.push({ kind: 'prop', id: `p:${layer.id}/${def.key}`, y, h: H.lane, layer, key: def.key, def, track, color: GRAPH_COLORS[n++ % GRAPH_COLORS.length] });
      y += H.lane;
    }
    if (!any) {
      rows.push({ kind: 'note', id: `n:${layer.id}`, y, h: H.note, text: 'No keyframed numeric properties.' });
      y += H.note;
    }
  }
  if (!rows.length) rows.push({ kind: 'note', id: 'n:none', y: 0, h: H.note, text: 'Select a layer to graph its properties.' });
  return rows;
}

/** Changes only when the header column has to re-render, so key drags cost React nothing. */
export function rowsSignature(rows: Row[]): string {
  let s = '';
  for (const r of rows) {
    s += r.id;
    switch (r.kind) {
      case 'section': case 'hitAll': case 'hitLane': s += `#${r.count}`; break;
      case 'layer': s += `#${r.layer.name}${+r.layer.visible}${+r.layer.solo}${+r.layer.locked}`; break;
      case 'prop': s += `#${+(r.track.keys.length > 0)}${+!!r.track.wiggle}${+!!r.track.audio}`; break;
    }
    s += '|';
  }
  return s;
}

function hitCounts(hits: SyncHit[]) {
  const m = new Map<HitKind, number>();
  for (const h of hits) m.set(h.kind, (m.get(h.kind) ?? 0) + 1);
  return m;
}

const byKindCache = new WeakMap<SyncHit[], Map<HitKind, SyncHit[]>>();
export function hitsOfKind(hits: SyncHit[], kind: HitKind): SyncHit[] {
  let m = byKindCache.get(hits);
  if (!m) {
    m = new Map();
    for (const h of hits) {
      const a = m.get(h.kind);
      if (a) a.push(h); else m.set(h.kind, [h]);
    }
    byKindCache.set(hits, m);
  }
  return m.get(kind) ?? [];
}

export interface Summary { t: number[]; ids: string[][] }

function summarize(tracks: Track[]): Summary {
  const all: Keyframe[] = [];
  for (const tr of tracks) all.push(...tr.keys);
  all.sort((a, b) => a.t - b.t);
  const out: Summary = { t: [], ids: [] };
  for (const k of all) {
    const n = out.t.length;
    if (n && k.t - out.t[n - 1] < 1e-4) out.ids[n - 1].push(k.id);
    else { out.t.push(k.t); out.ids.push([k.id]); }
  }
  return out;
}

const summaries = new WeakMap<Layer, Map<string, Summary>>();
/** Key times of a collapsed layer or group. Layers keep identity until edited, so this is free during playback. */
export function layerSummary(l: Layer, group = ''): Summary {
  let m = summaries.get(l);
  if (!m) summaries.set(l, m = new Map());
  let s = m.get(group);
  if (!s) {
    const defs = LAYER_DEFS[l.type].props.filter((d) => !group || d.group === group);
    s = summarize(defs.map((d) => l.props[d.key]).filter(Boolean));
    m.set(group, s);
  }
  return s;
}

/** First index with t >= value, for anything sorted by .t */
export function lowerBound(a: { t: number }[], t: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m].t < t) lo = m + 1; else hi = m;
  }
  return lo;
}

export function lowerBoundNum(a: number[], t: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < t) lo = m + 1; else hi = m;
  }
  return lo;
}

export function formatValue(def: PropDef, v: unknown): string {
  if (typeof v !== 'number') return String(v);
  if (def.kind === 'percent') return `${(v * 100).toFixed(0)}%`;
  if (def.kind === 'angle') return `${v.toFixed(1)}°`;
  const step = def.step ?? 0.01;
  const dp = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return `${v.toFixed(dp)}${def.unit ? ` ${def.unit}` : ''}`;
}
