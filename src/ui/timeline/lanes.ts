/** Dope sheet interaction: geometry hit tests and every drag that lives on the lanes. */
import { editor, transport, useEditor } from '../../core/store';
import { EASE_PRESETS, evalTrack, formatTimecode } from '../../core/eval';
import { uid } from '../../core/rng';
import { AudioEngine } from '../../audio/engine';
import type { AudioClip, HitKind, Keyframe, Project, SyncHit, Track } from '../../core/types';
import type { Selection } from '../../core/store';
import { modsOf, type Ctl, type DragSpec, type MenuItem } from './ctl';
import { hitsOfKind, layerSummary, lowerBound, lowerBoundNum, type PropRow, type Row } from './model';
import { CLIP_INSET } from './paint';

export type LaneHit =
  | { type: 'none' }
  | { type: 'lane'; row: Row }
  | { type: 'key'; row: PropRow; key: Keyframe }
  | { type: 'summary'; row: Row; t: number; ids: string[] }
  | { type: 'hit'; hit: SyncHit }
  | { type: 'hitTail'; hit: SyncHit }
  | { type: 'clip'; clip: AudioClip; part: 'body' | 'left' | 'right' | 'fadeIn' | 'fadeOut' }
  | { type: 'bar'; row: Extract<Row, { kind: 'layer' }>; part: 'body' | 'in' | 'out' };

const KEY_REACH = 7;

function nearestKey(c: Ctl, keys: Keyframe[], x: number): Keyframe | null {
  if (!keys.length) return null;
  const i = lowerBound(keys, c.xToT(x));
  let best: Keyframe | null = null, dist = KEY_REACH;
  for (let j = Math.max(0, i - 4); j < Math.min(keys.length, i + 4); j++) {
    const d = Math.abs(c.tToX(keys[j].t) - x);
    if (d <= dist) { dist = d; best = keys[j]; }
  }
  return best;
}

function nearestSummary(c: Ctl, s: { t: number[]; ids: string[][] }, x: number): number {
  const i = lowerBoundNum(s.t, c.xToT(x));
  let best = -1, dist = 6;
  for (let j = Math.max(0, i - 3); j < Math.min(s.t.length, i + 3); j++) {
    const d = Math.abs(c.tToX(s.t[j]) - x);
    if (d <= dist) { dist = d; best = j; }
  }
  return best;
}

function pickHit(c: Ctl, hits: SyncHit[], x: number, tails: boolean): LaneHit | null {
  const sel = c.selSets().hits;
  let found: LaneHit | null = null, foundDist = Infinity;
  for (const h of hits) {
    const hx = c.tToX(h.t), ex = hx + h.dur * c.pps;
    if (tails && ex - hx > 10 && Math.abs(x - ex) <= 4) return { type: 'hitTail', hit: h };
    const inside = x >= hx - 4 && x <= (tails ? ex : hx + 4);
    if (!inside) continue;
    const d = Math.abs(x - hx) - (sel.has(h.id) ? 0.5 : 0);
    if (d < foundDist) { foundDist = d; found = { type: 'hit', hit: h }; }
  }
  return found;
}

function pickLane(c: Ctl, x: number, y: number): LaneHit {
  const row = c.rowAt(y + c.scrollY);
  if (!row) return { type: 'none' };
  const ry = row.y - c.scrollY;
  const cy = ry + row.h / 2;
  const p = editor().project;
  switch (row.kind) {
    case 'prop': {
      const k = nearestKey(c, row.track.keys, x);
      return k ? { type: 'key', row, key: k } : { type: 'lane', row };
    }
    case 'group': {
      if (c.persist.closedGroups[`${row.layer.id}/${row.group}`]) {
        const s = layerSummary(row.layer, row.group);
        const i = nearestSummary(c, s, x);
        if (i >= 0) return { type: 'summary', row, t: s.t[i], ids: s.ids[i] };
      }
      return { type: 'lane', row };
    }
    case 'layer': {
      const l = row.layer;
      if (!c.persist.expanded[l.id] && Math.abs(y - cy) <= 6) {
        const s = layerSummary(l);
        const i = nearestSummary(c, s, x);
        if (i >= 0) return { type: 'summary', row, t: s.t[i], ids: s.ids[i] };
      }
      const x0 = c.tToX(l.start), x1 = c.tToX(l.end);
      const reach = Math.min(5, (x1 - x0) / 3);
      if (Math.abs(x - x0) <= reach) return { type: 'bar', row, part: 'in' };
      if (Math.abs(x - x1) <= reach) return { type: 'bar', row, part: 'out' };
      if (x > x0 && x < x1) return { type: 'bar', row, part: 'body' };
      return { type: 'lane', row };
    }
    case 'hitLane':
      return pickHit(c, hitsOfKind(p.hits, row.hitKind), x, true) ?? { type: 'lane', row };
    case 'hitAll':
      return pickHit(c, p.hits, x, false) ?? { type: 'lane', row };
    case 'clipLane': {
      for (let i = p.clips.length - 1; i >= 0; i--) {
        const clip = p.clips[i];
        if (clip.lane !== row.lane) continue;
        const x0 = c.tToX(clip.t), x1 = c.tToX(clip.t + clip.dur);
        if (x < x0 - 2 || x > x1 + 2) continue;
        const edge = Math.min(6, (x1 - x0) / 4);
        const inTop = y - (ry + CLIP_INSET) <= 11;
        const fi = x0 + clip.fadeIn * c.pps, fo = x1 - clip.fadeOut * c.pps;
        if (inTop && x1 - x0 > 28) {
          if (Math.abs(x - (clip.fadeIn > 0 ? fi : x0 + 3)) <= 5) return { type: 'clip', clip, part: 'fadeIn' };
          if (Math.abs(x - (clip.fadeOut > 0 ? fo : x1 - 3)) <= 5) return { type: 'clip', clip, part: 'fadeOut' };
        }
        if (x - x0 <= edge) return { type: 'clip', clip, part: 'left' };
        if (x1 - x <= edge) return { type: 'clip', clip, part: 'right' };
        return { type: 'clip', clip, part: 'body' };
      }
      return { type: 'lane', row };
    }
    default:
      return { type: 'lane', row };
  }
}

export function laneHover(c: Ctl, x: number, y: number): string {
  const h = pickLane(c, x, y);
  switch (h.type) {
    case 'key': case 'summary': case 'hit': return 'pointer';
    case 'hitTail': return 'ew-resize';
    case 'clip': return h.clip && h.part === 'body' ? 'grab' : 'ew-resize';
    case 'bar': return h.part === 'body' ? (h.row.layer.locked ? 'default' : 'grab') : h.row.layer.locked ? 'default' : 'ew-resize';
    default: return 'default';
  }
}

// ---- selection helpers ----
export function setSel(patch: Partial<Selection>) {
  useEditor.setState((s) => ({ sel: { ...s.sel, ...patch } }));
}

/** Layers stay selected while working on keys so the inspector and graph keep their context. */
export function selectKeys(ids: string[], layerId: string | null, additive: boolean) {
  const { sel } = editor();
  if (!additive) {
    setSel({ keys: ids, hits: [], clips: [], layers: layerId ? [layerId] : sel.layers });
    return;
  }
  const keys = new Set(sel.keys);
  const allOn = ids.every((id) => keys.has(id));
  for (const id of ids) { if (allOn) keys.delete(id); else keys.add(id); }
  const layers = layerId && !sel.layers.includes(layerId) ? [...sel.layers, layerId] : sel.layers;
  setSel({ keys: [...keys], layers });
}

const toggled = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// ---- drags ----
const fmtDelta = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(3)}s`;

function barsBeats(p: Project, t: number) {
  const b = (t - p.beatOffset) * (p.bpm / 60);
  if (b < -1e-6) return '';
  const beat = Math.floor(b + 1e-6);
  const sub = Math.round((b - beat) * 4) + 1;
  return `  ${Math.floor(beat / 4) + 1}.${(beat % 4) + 1}.${Math.min(4, sub)}`;
}

function timeLabel(t: number) {
  const p = editor().project;
  return `${formatTimecode(t, p.fps)}${barsBeats(p, t)}`;
}

/** Duplicate selected keys in place; the copies become the selection. */
function duplicateKeys(ids: string[]) {
  const set = new Set(ids);
  const copies: string[] = [];
  editor().patch((d) => {
    for (const l of d.layers) for (const k in l.props) {
      const tr = l.props[k];
      const add: Keyframe[] = [];
      for (const kf of tr.keys) if (set.has(kf.id)) {
        const id = uid('k');
        copies.push(id);
        add.push({ ...kf, id });
      }
      if (add.length) { tr.keys.push(...add); tr.keys.sort((a, b) => a.t - b.t); }
    }
  });
  setSel({ keys: copies });
  return copies;
}

/** After a drag, a key that landed on top of another replaces it. */
export function resolveKeyCollisions(moved: string[]) {
  const set = new Set(moved);
  editor().patch((d) => {
    for (const l of d.layers) for (const k in l.props) {
      const tr: Track = l.props[k];
      if (!tr.keys.some((x) => set.has(x.id))) continue;
      const out: Keyframe[] = [];
      for (const kf of tr.keys) {
        const prev = out[out.length - 1];
        if (prev && Math.abs(prev.t - kf.t) < 1 / 480) {
          if (set.has(kf.id) && !set.has(prev.id)) out[out.length - 1] = kf;
          else if (!set.has(kf.id)) continue;
          else out.push(kf);
        } else out.push(kf);
      }
      if (out.length !== tr.keys.length) tr.keys = out;
    }
  });
}

function keysDrag(c: Ctl, e: PointerEvent, grabT: number, onClick?: () => void): DragSpec {
  let ids = editor().sel.keys;
  const t0 = c.xToT(e.clientX - c.parts.lanes.getBoundingClientRect().left);
  let applied = 0;
  let minT = Infinity;
  return {
    history: true,
    auto: 'x',
    begin: (m) => {
      if (m.alt) ids = duplicateKeys(ids);
      const set = new Set(ids);
      for (const l of editor().project.layers) for (const k in l.props) for (const kf of l.props[k].keys) if (set.has(kf.id) && kf.t < minT) minT = kf.t;
    },
    move: (x, _y, m, ev) => {
      const snapped = c.snap(grabT + c.xToT(x) - t0, m).t;
      const dt = Math.max(snapped - grabT, -minT);
      if (dt !== applied) {
        editor().moveKeys(ids, dt - applied, { noHistory: true });
        applied = dt;
      }
      c.showGuide(grabT + dt);
      c.showReadout(`${timeLabel(grabT + dt)}  ${fmtDelta(dt)}`, ev.clientX, ev.clientY);
    },
    end: (moved) => {
      if (moved) resolveKeyCollisions(ids);
      else onClick?.();
    },
  };
}

function hitsDrag(c: Ctl, e: PointerEvent, grab: SyncHit, onClick?: () => void): DragSpec {
  let ids = editor().sel.hits;
  const t0 = c.xToT(e.clientX - c.parts.lanes.getBoundingClientRect().left);
  const grabT = grab.t;
  let applied = 0, minT = 0;
  return {
    history: true,
    auto: 'x',
    begin: (m) => {
      if (m.alt) {
        const set = new Set(ids);
        const copies: string[] = [];
        editor().patch((d) => {
          const add: SyncHit[] = [];
          for (const h of d.hits) if (set.has(h.id)) {
            const id = uid('h');
            copies.push(id);
            add.push({ ...h, id });
          }
          d.hits.push(...add);
          d.hits.sort((a, b) => a.t - b.t);
        });
        ids = copies;
        setSel({ hits: copies });
      }
      const set = new Set(ids);
      minT = Math.min(...editor().project.hits.filter((h) => set.has(h.id)).map((h) => h.t));
    },
    move: (x, _y, m, ev) => {
      const snapped = c.snap(grabT + c.xToT(x) - t0, m).t;
      const dt = Math.max(snapped - grabT, -minT);
      if (dt !== applied) {
        editor().moveHits(ids, dt - applied, { noHistory: true });
        applied = dt;
      }
      c.showGuide(grabT + dt);
      c.showReadout(`${timeLabel(grabT + dt)}  ${fmtDelta(dt)}`, ev.clientX, ev.clientY);
    },
    end: (moved) => { if (!moved) onClick?.(); },
  };
}

function hitTailDrag(c: Ctl, hit: SyncHit): DragSpec {
  const sel = editor().sel.hits;
  const ids = new Set(sel.includes(hit.id) ? sel : [hit.id]);
  const orig = new Map(editor().project.hits.filter((h) => ids.has(h.id)).map((h) => [h.id, h.dur]));
  const hitT = hit.t, dur0 = hit.dur;
  return {
    history: true,
    auto: 'x',
    move: (x, _y, m, ev) => {
      const end = c.snap(c.xToT(x), m).t;
      const delta = Math.max(0.02, end - hitT) - dur0;
      editor().patch((d) => {
        for (const h of d.hits) {
          const o = orig.get(h.id);
          if (o != null) h.dur = Math.max(0.02, o + delta);
        }
      });
      c.showGuide(hitT + dur0 + delta);
      c.showReadout(`dur ${(dur0 + delta).toFixed(3)}s`, ev.clientX, ev.clientY);
    },
  };
}

function sourceDur(clip: AudioClip): number | null {
  try { return AudioEngine.get().sourceDuration(clip.source); } catch { return null; }
}

function clipDrag(c: Ctl, e: PointerEvent, clip: AudioClip, onClick?: () => void): DragSpec {
  let ids = editor().sel.clips;
  const t0 = c.xToT(e.clientX - c.parts.lanes.getBoundingClientRect().left);
  const grabT = clip.t, grabLane = clip.lane;
  let orig = new Map<string, { t: number; lane: number }>();
  let minT = 0, minLane = 0;
  return {
    history: true,
    auto: 'x',
    begin: (m) => {
      if (m.alt) {
        const set = new Set(ids);
        const copies: string[] = [];
        editor().patch((d) => {
          const add: AudioClip[] = [];
          for (const k of d.clips) if (set.has(k.id)) {
            const id = uid('c');
            copies.push(id);
            add.push({ ...k, id });
          }
          d.clips.push(...add);
        });
        ids = copies;
        setSel({ clips: copies });
      }
      const set = new Set(ids);
      const list = editor().project.clips.filter((k) => set.has(k.id));
      orig = new Map(list.map((k) => [k.id, { t: k.t, lane: k.lane }]));
      minT = Math.min(...list.map((k) => k.t));
      minLane = Math.min(...list.map((k) => k.lane));
    },
    move: (x, y, m, ev) => {
      const dt = Math.max(c.snap(grabT + c.xToT(x) - t0, m).t - grabT, -minT);
      const row = c.rowAt(y + c.scrollY);
      const dl = row?.kind === 'clipLane' ? Math.max(row.lane - grabLane, -minLane) : 0;
      editor().patch((d) => {
        for (const k of d.clips) {
          const o = orig.get(k.id);
          if (o) { k.t = o.t + dt; k.lane = o.lane + dl; }
        }
      });
      c.showGuide(grabT + dt);
      c.showReadout(`${timeLabel(grabT + dt)}  ${fmtDelta(dt)}`, ev.clientX, ev.clientY);
    },
    end: (moved) => { if (!moved) onClick?.(); },
  };
}

function clipEdgeDrag(c: Ctl, clip: AudioClip, part: 'left' | 'right' | 'fadeIn' | 'fadeOut'): DragSpec {
  const o = { ...clip };
  const srcDur = sourceDur(clip);
  const MIN = 0.05;
  const update = (patch: Partial<AudioClip>) => editor().updateClip(o.id, patch, { noHistory: true });
  return {
    history: true,
    auto: 'x',
    move: (x, _y, m, ev) => {
      const raw = c.xToT(x);
      if (part === 'left') {
        const t = Math.max(o.t - o.offset, 0, Math.min(c.snap(raw, m).t, o.t + o.dur - MIN));
        const dur = o.dur - (t - o.t);
        update({ t, offset: o.offset + (t - o.t), dur, fadeIn: Math.min(o.fadeIn, dur), fadeOut: Math.min(o.fadeOut, dur) });
        c.showGuide(t);
        c.showReadout(`in ${timeLabel(t)}`, ev.clientX, ev.clientY);
      } else if (part === 'right') {
        let end = Math.max(c.snap(raw, m).t, o.t + MIN);
        if (srcDur != null) end = Math.min(end, o.t + srcDur - o.offset);
        const dur = end - o.t;
        update({ dur, fadeIn: Math.min(o.fadeIn, dur), fadeOut: Math.min(o.fadeOut, dur) });
        c.showGuide(end);
        c.showReadout(`out ${timeLabel(end)}`, ev.clientX, ev.clientY);
      } else if (part === 'fadeIn') {
        const v = Math.max(0, Math.min(raw - o.t, o.dur - o.fadeOut));
        update({ fadeIn: v < 2 / c.pps ? 0 : v });
        c.showReadout(`fade in ${v.toFixed(3)}s`, ev.clientX, ev.clientY);
      } else {
        const v = Math.max(0, Math.min(o.t + o.dur - raw, o.dur - o.fadeIn));
        update({ fadeOut: v < 2 / c.pps ? 0 : v });
        c.showReadout(`fade out ${v.toFixed(3)}s`, ev.clientX, ev.clientY);
      }
    },
  };
}

function layerMoveDrag(c: Ctl, e: PointerEvent, layerId: string, onClick?: () => void): DragSpec {
  const { project, sel } = editor();
  const ids = new Set((sel.layers.includes(layerId) ? sel.layers : [layerId]).filter((id) => !project.layers.find((l) => l.id === id)?.locked));
  const grab = project.layers.find((l) => l.id === layerId)!;
  const s0 = grab.start, e0 = grab.end;
  let lowest = Infinity;
  for (const l of project.layers) if (ids.has(l.id)) {
    lowest = Math.min(lowest, l.start);
    for (const k in l.props) if (l.props[k].keys.length) lowest = Math.min(lowest, l.props[k].keys[0].t);
  }
  const t0 = c.xToT(e.clientX - c.parts.lanes.getBoundingClientRect().left);
  let applied = 0;
  return {
    history: true,
    auto: 'x',
    move: (x, _y, m, ev) => {
      const raw = c.xToT(x) - t0;
      const a = c.snap(s0 + raw, m).t - s0, b = c.snap(e0 + raw, m).t - e0;
      const dt = Math.max(Math.abs(a - raw) <= Math.abs(b - raw) ? a : b, -lowest);
      const delta = dt - applied;
      if (delta !== 0) {
        applied = dt;
        editor().patch((d) => {
          for (const l of d.layers) if (ids.has(l.id)) {
            l.start += delta;
            l.end += delta;
            for (const k in l.props) for (const kf of l.props[k].keys) kf.t += delta;
          }
        });
      }
      c.showGuide(s0 + dt);
      c.showReadout(`${timeLabel(s0 + dt)}  ${fmtDelta(dt)}`, ev.clientX, ev.clientY);
    },
    end: (moved) => { if (!moved) onClick?.(); },
  };
}

function layerTrimDrag(c: Ctl, layerId: string, part: 'in' | 'out'): DragSpec {
  const l0 = editor().project.layers.find((l) => l.id === layerId)!;
  const frame = 1 / editor().project.fps;
  const { start, end } = l0;
  return {
    history: true,
    auto: 'x',
    move: (x, _y, m, ev) => {
      const t = c.snap(c.xToT(x), m).t;
      const v = part === 'in' ? Math.max(0, Math.min(t, end - frame)) : Math.max(t, start + frame);
      editor().patch((d) => {
        const l = d.layers.find((q) => q.id === layerId);
        if (l) l[part === 'in' ? 'start' : 'end'] = v;
      });
      c.showGuide(v);
      c.showReadout(`${part} ${timeLabel(v)}`, ev.clientX, ev.clientY);
    },
  };
}

function boxDrag(c: Ctl, e: PointerEvent): DragSpec {
  const r = c.parts.lanes.getBoundingClientRect();
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const tA = c.xToT(e.clientX - r.left), yA = e.clientY - r.top + c.scrollY;
  const base = editor().sel;
  return {
    auto: 'xy',
    move: (x, y) => {
      const tB = c.xToT(x), yB = y + c.scrollY;
      c.showBox(c.tToX(tA), yA - c.scrollY, x, y);
      boxSelect(c, Math.min(tA, tB), Math.max(tA, tB), Math.min(yA, yB), Math.max(yA, yB), additive ? base : null);
    },
    end: (moved) => {
      if (moved || additive) return;
      setSel({ keys: [], hits: [], clips: [] });
    },
  };
}

function boxSelect(c: Ctl, t0: number, t1: number, y0: number, y1: number, base: Selection | null) {
  const { project: p } = editor();
  const keys = new Set(base?.keys), hits = new Set(base?.hits), clips = new Set(base?.clips);
  const addHits = (list: SyncHit[]) => { for (const h of list) if (h.t >= t0 && h.t <= t1) hits.add(h.id); };
  const addSummary = (s: { t: number[]; ids: string[][] }) => {
    for (let i = lowerBoundNum(s.t, t0); i < s.t.length && s.t[i] <= t1; i++) for (const id of s.ids[i]) keys.add(id);
  };
  for (let i = c.rowIndexAt(y0); i < c.rows.length; i++) {
    const r = c.rows[i];
    if (r.y > y1) break;
    switch (r.kind) {
      case 'prop': {
        const ks = r.track.keys;
        for (let j = lowerBound(ks, t0); j < ks.length && ks[j].t <= t1; j++) keys.add(ks[j].id);
        break;
      }
      case 'layer':
        if (!c.persist.expanded[r.layer.id]) addSummary(layerSummary(r.layer));
        break;
      case 'group':
        if (c.persist.closedGroups[`${r.layer.id}/${r.group}`]) addSummary(layerSummary(r.layer, r.group));
        break;
      case 'hitLane': addHits(hitsOfKind(p.hits, r.hitKind)); break;
      case 'hitAll': addHits(p.hits); break;
      case 'clipLane':
        for (const k of p.clips) if (k.lane === r.lane && k.t <= t1 && k.t + k.dur >= t0) clips.add(k.id);
        break;
    }
  }
  setSel({ keys: [...keys], hits: [...hits], clips: [...clips] });
}

export function lanePointerDown(c: Ctl, e: PointerEvent) {
  const r = c.parts.lanes.getBoundingClientRect();
  const h = pickLane(c, e.clientX - r.left, e.clientY - r.top);
  const m = modsOf(e);
  const additive = m.shift || m.ctrl;
  const el = c.parts.lanes;
  const { sel } = editor();

  switch (h.type) {
    case 'key': {
      const id = h.key.id, was = sel.keys.includes(id);
      if (additive || !was) selectKeys([id], h.row.layer.id, additive);
      if ((additive && was) || h.row.layer.locked) return;
      c.startDrag(e, el, keysDrag(c, e, h.key.t, was && !additive ? () => selectKeys([id], h.row.layer.id, false) : undefined));
      return;
    }
    case 'summary': {
      const layerId = h.row.kind === 'layer' || h.row.kind === 'group' ? h.row.layer.id : null;
      const all = h.ids.every((id) => sel.keys.includes(id));
      if (additive || !all) selectKeys(h.ids, layerId, additive);
      if ((additive && all) || (h.row.kind === 'layer' || h.row.kind === 'group' ? h.row.layer.locked : false)) return;
      c.startDrag(e, el, keysDrag(c, e, h.t, all && !additive ? () => selectKeys(h.ids, layerId, false) : undefined));
      return;
    }
    case 'hit': {
      const id = h.hit.id, was = sel.hits.includes(id);
      if (additive) setSel({ hits: toggled(sel.hits, id) });
      else if (!was) setSel({ hits: [id], keys: [], clips: [] });
      if (additive && was) return;
      c.startDrag(e, el, hitsDrag(c, e, h.hit, was && !additive ? () => setSel({ hits: [id], keys: [], clips: [] }) : undefined));
      return;
    }
    case 'hitTail':
      c.startDrag(e, el, hitTailDrag(c, h.hit));
      return;
    case 'clip': {
      const id = h.clip.id, was = sel.clips.includes(id);
      if (h.part !== 'body') {
        if (!was) setSel({ clips: [id], keys: [], hits: [] });
        c.startDrag(e, el, clipEdgeDrag(c, h.clip, h.part));
        return;
      }
      if (additive) setSel({ clips: toggled(sel.clips, id) });
      else if (!was) setSel({ clips: [id], keys: [], hits: [] });
      if (additive && was) return;
      c.startDrag(e, el, clipDrag(c, e, h.clip, was && !additive ? () => setSel({ clips: [id], keys: [], hits: [] }) : undefined));
      return;
    }
    case 'bar': {
      const l = h.row.layer, was = sel.layers.includes(l.id);
      if (additive) { editor().select({ layers: [l.id] }, true); if (was) return; }
      else if (!was) editor().select({ layers: [l.id] });
      if (l.locked) return;
      if (h.part === 'body') c.startDrag(e, el, layerMoveDrag(c, e, l.id, was && !additive ? () => editor().select({ layers: [l.id] }) : undefined));
      else c.startDrag(e, el, layerTrimDrag(c, l.id, h.part));
      return;
    }
    default:
      c.startDrag(e, el, boxDrag(c, e));
  }
}

function addKey(row: PropRow, t: number) {
  const tr = row.track;
  const v = evalTrack({ ...tr, wiggle: undefined, audio: undefined }, t);
  const id = uid('k');
  const layerId = row.layer.id, prop = row.key;
  editor().commit('Add keyframe', (d) => {
    const track = d.layers.find((l) => l.id === layerId)?.props[prop];
    if (!track || track.keys.some((k) => Math.abs(k.t - t) < 1 / 480)) return;
    track.keys.push({ id, t, v, ease: [0.33, 0, 0.67, 1] });
    track.keys.sort((a, b) => a.t - b.t);
  });
  selectKeys([id], layerId, false);
}

export function laneDblClick(c: Ctl, e: MouseEvent) {
  const r = c.parts.lanes.getBoundingClientRect();
  const x = e.clientX - r.left;
  const h = pickLane(c, x, e.clientY - r.top);
  if (h.type !== 'lane') return;
  const t = c.snap(c.xToT(x), modsOf(e)).t;
  if (h.row.kind === 'prop') { if (!h.row.layer.locked) addKey(h.row, t); }
  else if (h.row.kind === 'hitLane' || h.row.kind === 'hitAll') {
    const kind: HitKind = h.row.kind === 'hitLane' ? h.row.hitKind : editor().ui.tapKind;
    const id = editor().addHit(kind, t);
    setSel({ hits: [id], keys: [], clips: [] });
  }
}

// ---- context menus ----
export function keyMenuItems(): MenuItem[] {
  const ed = editor();
  const ids = ed.sel.keys;
  return [
    ...EASE_PRESETS.map((p): MenuItem => ({ label: p.label, action: () => ed.setKeysEase(editor().sel.keys, p.ease), disabled: !ids.length })),
    { sep: true },
    { label: 'Copy', hint: 'Ctrl C', action: () => ed.copyKeys(), disabled: !ids.length },
    { label: 'Paste at playhead', hint: 'Ctrl V', action: () => ed.pasteKeys() },
    { sep: true },
    { label: 'Delete', hint: 'Del', danger: true, action: () => ed.deleteKeys(editor().sel.keys), disabled: !ids.length },
  ];
}

function splitClip(id: string) {
  const t = transport().time;
  const newId = uid('c');
  editor().commit('Split clip', (d) => {
    const k = d.clips.find((q) => q.id === id);
    if (!k || t <= k.t + 0.01 || t >= k.t + k.dur - 0.01) return;
    const head = t - k.t;
    d.clips.push({ ...k, id: newId, t, offset: k.offset + head, dur: k.dur - head, fadeIn: 0 });
    k.dur = head;
    k.fadeOut = 0;
  });
}

export function laneContext(c: Ctl, e: MouseEvent) {
  const r = c.parts.lanes.getBoundingClientRect();
  const x = e.clientX - r.left;
  const h = pickLane(c, x, e.clientY - r.top);
  const ed = editor();
  const open = (items: MenuItem[]) => c.openMenu(e.clientX, e.clientY, items);

  switch (h.type) {
    case 'key':
      if (!ed.sel.keys.includes(h.key.id)) selectKeys([h.key.id], h.row.layer.id, false);
      open(keyMenuItems());
      return;
    case 'summary': {
      if (!h.ids.some((id) => ed.sel.keys.includes(id))) selectKeys(h.ids, null, false);
      open(keyMenuItems());
      return;
    }
    case 'hit': case 'hitTail': {
      if (!ed.sel.hits.includes(h.hit.id)) setSel({ hits: [h.hit.id], keys: [], clips: [] });
      const ids = () => editor().sel.hits;
      open([
        ...[0.5, 1, 1.5, 2].map((a): MenuItem => ({ label: `Amount ${Math.round(a * 100)}%`, checked: h.hit.amount === a, action: () => editor().updateHits(ids(), { amount: a }) })),
        { sep: true },
        { label: 'Delete', hint: 'Del', danger: true, action: () => editor().deleteHits(ids()) },
      ]);
      return;
    }
    case 'clip': {
      const id = h.clip.id;
      if (!ed.sel.clips.includes(id)) setSel({ clips: [id], keys: [], hits: [] });
      const t = transport().time;
      open([
        { label: h.clip.muted ? 'Unmute' : 'Mute', action: () => editor().updateClip(id, { muted: !h.clip.muted }) },
        { label: 'Split at playhead', disabled: t <= h.clip.t || t >= h.clip.t + h.clip.dur, action: () => splitClip(id) },
        { sep: true },
        { label: 'Delete', hint: 'Del', danger: true, action: () => editor().deleteClips(editor().sel.clips) },
      ]);
      return;
    }
    case 'bar': {
      const l = h.row.layer;
      if (!ed.sel.layers.includes(l.id)) ed.select({ layers: [l.id] });
      const t = transport().time;
      open([
        { label: 'Trim in to playhead', disabled: l.locked || t >= l.end, action: () => editor().updateLayer(l.id, { start: t }) },
        { label: 'Trim out to playhead', disabled: l.locked || t <= l.start, action: () => editor().updateLayer(l.id, { end: t }) },
        { label: 'Reset to full duration', disabled: l.locked, action: () => editor().updateLayer(l.id, { start: 0, end: editor().project.duration }) },
      ]);
      return;
    }
    case 'lane':
      if (h.row.kind === 'prop') {
        const row = h.row, t = c.snap(c.xToT(x)).t;
        open([
          { label: 'Add keyframe here', action: () => addKey(row, t) },
          { label: 'Paste at playhead', hint: 'Ctrl V', action: () => editor().pasteKeys() },
        ]);
      }
      return;
  }
}

