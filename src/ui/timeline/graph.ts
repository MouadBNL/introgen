/** Graph editor: value-over-time curves with bezier handles. Shares x with the dope sheet, owns its y view. */
import { editor } from '../../core/store';
import { evalTrack, formatTimecode } from '../../core/eval';
import { uid } from '../../core/rng';
import type { Bezier, Ease, Keyframe } from '../../core/types';
import { modsOf, type Ctl, type DragSpec } from './ctl';
import { keyMenuItems, resolveKeyCollisions, setSel } from './lanes';
import { lowerBound, type PropRow } from './model';
import { FONT_MONO, hline, paintGrid, paintWorkEnd, vline } from './paint';

const TOP = 16;
const BOTTOM = 16;

export interface GraphView {
  auto: boolean;
  vMin: number;
  vMax: number;
  hidden: Set<string>;
  zoomY(factor: number, y: number, h: number): void;
  panY(dyPx: number, h: number): void;
}

export function newGraphView(): GraphView {
  return {
    auto: true, vMin: 0, vMax: 1, hidden: new Set(),
    zoomY(f, y, h) {
      this.auto = false;
      const v = this.vMax - ((y - TOP) / Math.max(1, h - TOP - BOTTOM)) * (this.vMax - this.vMin);
      this.vMin = v + (this.vMin - v) * f;
      this.vMax = v + (this.vMax - v) * f;
    },
    panY(dy, h) {
      this.auto = false;
      const d = (dy / Math.max(1, h - TOP - BOTTOM)) * (this.vMax - this.vMin);
      this.vMin -= d;
      this.vMax -= d;
    },
  };
}

const vToY = (c: Ctl, v: number) => {
  const g = c.graph;
  return TOP + ((g.vMax - v) / (g.vMax - g.vMin || 1)) * (c.h - TOP - BOTTOM);
};
const yToV = (c: Ctl, y: number) => {
  const g = c.graph;
  return g.vMax - ((y - TOP) / Math.max(1, c.h - TOP - BOTTOM)) * (g.vMax - g.vMin);
};

export function graphTracks(c: Ctl): PropRow[] {
  const out: PropRow[] = [];
  for (const r of c.rows) if (r.kind === 'prop' && !c.graph.hidden.has(r.id)) out.push(r);
  return out;
}

const asBezier = (e: Ease): Bezier => (e === 'linear' || e === 'hold' ? [1 / 3, 1 / 3, 2 / 3, 2 / 3] : e);

/** Auto-fit includes overshoot, which is why this samples eases and not just key values. */
export function fitGraph(c: Ctl) {
  const g = c.graph;
  if (!g.auto) return;
  let lo = Infinity, hi = -Infinity;
  const see = (v: number) => { if (v < lo) lo = v; if (v > hi) hi = v; };
  for (const r of graphTracks(c)) {
    const ks = r.track.keys;
    for (let i = 0; i < ks.length; i++) {
      const a = ks[i];
      if (typeof a.v !== 'number') continue;
      see(a.v);
      const b = ks[i + 1];
      if (!b || Array.isArray(a.ease) === false || typeof b.v !== 'number') continue;
      const [, y1, , y2] = a.ease as Bezier;
      if (y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1) continue;
      for (let s = 1; s < 8; s++) see(evalTrack({ value: 0, keys: [a, b] }, a.t + ((b.t - a.t) * s) / 8) as number);
    }
  }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.1;
  g.vMin = lo - pad;
  g.vMax = hi + pad;
}

function niceStep(range: number, target: number) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

function visibleRange(c: Ctl, keys: Keyframe[]) {
  const i0 = Math.max(0, lowerBound(keys, c.xToT(-10)) - 1);
  const i1 = Math.min(keys.length, lowerBound(keys, c.xToT(c.w + 10)) + 1);
  return [i0, i1] as const;
}

function handlePoints(c: Ctl, a: Keyframe, b: Keyframe) {
  const e = asBezier(a.ease);
  const dt = b.t - a.t, va = a.v as number, dv = (b.v as number) - va;
  return {
    out: { x: c.tToX(a.t + e[0] * dt), y: vToY(c, va + e[1] * dv) },
    in: { x: c.tToX(a.t + e[2] * dt), y: vToY(c, va + e[3] * dv) },
  };
}

export function paintGraph(c: Ctl) {
  const { project: p, ui } = editor();
  const ctx = c.lctx, C = c.colors, { w, h, dpr } = c;
  const selected = c.selSets().keys;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#101013';
  ctx.fillRect(0, 0, w, h);
  paintGrid(c, ctx, p, 0, h);

  const g = c.graph;
  const step = niceStep(g.vMax - g.vMin, Math.max(2, h / 48));
  ctx.font = FONT_MONO;
  ctx.textBaseline = 'bottom';
  const labels: [number, string][] = [];
  const dp = Math.max(0, Math.min(4, -Math.floor(Math.log10(step))));
  for (let v = Math.ceil(g.vMin / step) * step; v <= g.vMax; v += step) {
    const y = vToY(c, v);
    ctx.fillStyle = Math.abs(v) < step / 2 ? C.lineStrong : C.line;
    hline(c, ctx, 0, y, w);
    labels.push([y, v.toFixed(dp)]);
  }
  paintWorkEnd(c, ctx, p, 0, h);

  for (const m of p.markers) {
    ctx.fillStyle = m.color ?? C.sync;
    ctx.globalAlpha = 0.5;
    vline(c, ctx, c.tToX(m.t), 0, h);
    ctx.globalAlpha = 1;
  }

  const tracks = graphTracks(c);
  const focus = ui.graphProp;
  for (const r of tracks) {
    const keys = r.track.keys;
    const [i0, i1] = visibleRange(c, keys);
    const focused = focus?.layer === r.layer.id && focus.key === r.key;
    const color = r.color ?? C.key;

    // Flat extrapolation outside the keyed range.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    const first = keys[0], last = keys[keys.length - 1];
    const xf = c.tToX(first.t), xl = c.tToX(last.t);
    if (xf > 0) { ctx.moveTo(0, vToY(c, first.v as number)); ctx.lineTo(xf, vToY(c, first.v as number)); }
    if (xl < w) { ctx.moveTo(xl, vToY(c, last.v as number)); ctx.lineTo(w, vToY(c, last.v as number)); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // The curve itself: eases are cubic beziers in segment space, so they map exactly to canvas beziers.
    ctx.lineWidth = focused ? 2 : 1.5;
    ctx.beginPath();
    for (let i = i0; i < i1 - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      const xa = c.tToX(a.t), xb = c.tToX(b.t), ya = vToY(c, a.v as number), yb = vToY(c, b.v as number);
      if (i === i0) ctx.moveTo(xa, ya);
      if (a.ease === 'hold') { ctx.lineTo(xb, ya); ctx.lineTo(xb, yb); }
      else if (a.ease === 'linear') ctx.lineTo(xb, yb);
      else {
        const [x1, y1, x2, y2] = a.ease;
        ctx.bezierCurveTo(xa + x1 * (xb - xa), ya + y1 * (yb - ya), xa + x2 * (xb - xa), ya + y2 * (yb - ya), xb, yb);
      }
    }
    ctx.stroke();

    // Handles on segments touching a selected key, or wide enough to read.
    for (let i = i0; i < i1 - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (a.ease === 'hold') continue;
      const on = selected.has(a.id) || selected.has(b.id);
      const px = (b.t - a.t) * c.pps;
      if (!on && px < 70) continue;
      const hp = handlePoints(c, a, b);
      const xa = c.tToX(a.t), xb = c.tToX(b.t), ya = vToY(c, a.v as number), yb = vToY(c, b.v as number);
      ctx.globalAlpha = on ? 0.9 : 0.4;
      ctx.strokeStyle = on ? C.text1 : color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xa, ya); ctx.lineTo(hp.out.x, hp.out.y);
      ctx.moveTo(xb, yb); ctx.lineTo(hp.in.x, hp.in.y);
      ctx.stroke();
      ctx.fillStyle = C.bg0;
      ctx.beginPath();
      ctx.arc(hp.out.x, hp.out.y, 3, 0, Math.PI * 2);
      ctx.moveTo(hp.in.x + 3, hp.in.y);
      ctx.arc(hp.in.x, hp.in.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (let i = i0; i < i1; i++) {
      const k = keys[i];
      const x = Math.round(c.tToX(k.t)), y = Math.round(vToY(c, k.v as number));
      const on = selected.has(k.id);
      ctx.fillStyle = on ? C.keySel : C.bg0;
      ctx.strokeStyle = on ? C.keySel : color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(x - 3.5, y - 3.5, 7, 7);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.font = FONT_MONO;
  ctx.textBaseline = 'bottom';
  for (const [y, text] of labels) {
    ctx.fillStyle = C.text3;
    ctx.fillText(text, 5, y - 2);
  }
}

// ---- interaction ----
type GraphHit =
  | { type: 'none' }
  | { type: 'key'; row: PropRow; key: Keyframe }
  | { type: 'handle'; row: PropRow; i: number; which: 'out' | 'in' }
  | { type: 'curve'; row: PropRow; t: number };

function pickGraph(c: Ctl, x: number, y: number): GraphHit {
  const tracks = graphTracks(c);
  const selected = c.selSets().keys;
  for (let n = tracks.length - 1; n >= 0; n--) {
    const row = tracks[n], keys = row.track.keys;
    const [i0, i1] = visibleRange(c, keys);
    for (let i = i0; i < i1; i++) {
      const k = keys[i];
      if (Math.abs(c.tToX(k.t) - x) <= 6 && Math.abs(vToY(c, k.v as number) - y) <= 6) return { type: 'key', row, key: k };
    }
    for (let i = i0; i < i1 - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (a.ease === 'hold') continue;
      if (!selected.has(a.id) && !selected.has(b.id) && (b.t - a.t) * c.pps < 70) continue;
      const hp = handlePoints(c, a, b);
      if (Math.hypot(hp.out.x - x, hp.out.y - y) <= 6) return { type: 'handle', row, i, which: 'out' };
      if (Math.hypot(hp.in.x - x, hp.in.y - y) <= 6) return { type: 'handle', row, i, which: 'in' };
    }
  }
  const t = c.xToT(x);
  for (let n = tracks.length - 1; n >= 0; n--) {
    const row = tracks[n];
    const v = evalTrack({ ...row.track, wiggle: undefined, audio: undefined }, t) as number;
    if (Math.abs(vToY(c, v) - y) <= 5) return { type: 'curve', row, t };
  }
  return { type: 'none' };
}

export function graphHover(c: Ctl, x: number, y: number): string {
  const h = pickGraph(c, x, y);
  return h.type === 'key' || h.type === 'handle' ? 'pointer' : h.type === 'curve' ? 'copy' : 'default';
}

interface Moved { layer: string; prop: string; id: string; t: number; v: number }

function collectMoved(ids: string[]): Moved[] {
  const set = new Set(ids);
  const out: Moved[] = [];
  for (const l of editor().project.layers) for (const k in l.props) for (const kf of l.props[k].keys) {
    if (set.has(kf.id) && typeof kf.v === 'number') out.push({ layer: l.id, prop: k, id: kf.id, t: kf.t, v: kf.v });
  }
  return out;
}

function graphKeysDrag(c: Ctl, e: PointerEvent, grab: Keyframe, onClick?: () => void): DragSpec {
  const r = c.parts.lanes.getBoundingClientRect();
  const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
  const t0 = c.xToT(x0), v0 = yToV(c, y0);
  const grabT = grab.t;
  let moved: Moved[] = [];
  let minT = 0;
  return {
    history: true,
    auto: 'x',
    begin: () => {
      moved = collectMoved(editor().sel.keys);
      minT = Math.min(...moved.map((m) => m.t));
    },
    move: (x, y, m, ev) => {
      // Ctrl locks the drag to its dominant axis.
      const lockT = m.ctrl && Math.abs(y - y0) > Math.abs(x - x0);
      const lockV = m.ctrl && !lockT;
      const dt = lockT ? 0 : Math.max(c.snap(grabT + c.xToT(x) - t0, m).t - grabT, -minT);
      const dv = lockV ? 0 : yToV(c, y) - v0;
      editor().patch((d) => {
        const dirty = new Set<Keyframe[]>();
        for (const q of moved) {
          const tr = d.layers.find((l) => l.id === q.layer)?.props[q.prop];
          const kf = tr?.keys.find((k) => k.id === q.id);
          if (!tr || !kf) continue;
          kf.t = q.t + dt;
          kf.v = q.v + dv;
          dirty.add(tr.keys);
        }
        for (const ks of dirty) ks.sort((a, b) => a.t - b.t);
      });
      c.showGuide(lockT ? null : grabT + dt);
      const p = editor().project;
      const val = (grab.v as number) + dv;
      c.showReadout(`${formatTimecode(grabT + dt, p.fps)}  ${val.toFixed(3)}`, ev.clientX, ev.clientY);
    },
    end: (did) => {
      if (did) resolveKeyCollisions(moved.map((m) => m.id));
      else onClick?.();
    },
  };
}

function handleDrag(c: Ctl, row: PropRow, i: number, which: 'out' | 'in'): DragSpec {
  const a = row.track.keys[i], b = row.track.keys[i + 1];
  const ease0 = asBezier(a.ease);
  const tA = a.t, dt = b.t - a.t, vA = a.v as number, dv = (b.v as number) - vA;
  const layerId = row.layer.id, prop = row.key, keyId = a.id;
  return {
    history: true,
    move: (x, y, _m, ev) => {
      const nx = Math.max(0, Math.min(1, (c.xToT(x) - tA) / dt));
      const ny = Math.abs(dv) > 1e-9 ? (yToV(c, y) - vA) / dv : ease0[which === 'out' ? 1 : 3];
      const prev = [...ease0] as Bezier;
      const next: Bezier = which === 'out' ? [nx, ny, prev[2], prev[3]] : [prev[0], prev[1], nx, ny];
      editor().patch((d) => {
        const kf = d.layers.find((l) => l.id === layerId)?.props[prop]?.keys.find((k) => k.id === keyId);
        if (kf) kf.ease = next;
      });
      c.showReadout(`${next.map((n) => n.toFixed(2)).join(' ')}`, ev.clientX, ev.clientY);
    },
  };
}

function graphBoxDrag(c: Ctl, e: PointerEvent): DragSpec {
  const r = c.parts.lanes.getBoundingClientRect();
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const tA = c.xToT(e.clientX - r.left), vA = yToV(c, e.clientY - r.top);
  const base = editor().sel.keys;
  return {
    auto: 'x',
    move: (x, y) => {
      const tB = c.xToT(x), vB = yToV(c, y);
      c.showBox(c.tToX(tA), vToY(c, vA), x, y);
      const t0 = Math.min(tA, tB), t1 = Math.max(tA, tB), v0 = Math.min(vA, vB), v1 = Math.max(vA, vB);
      const keys = new Set(additive ? base : []);
      for (const row of graphTracks(c)) {
        const ks = row.track.keys;
        for (let j = lowerBound(ks, t0); j < ks.length && ks[j].t <= t1; j++) {
          const v = ks[j].v as number;
          if (v >= v0 && v <= v1) keys.add(ks[j].id);
        }
      }
      setSel({ keys: [...keys] });
    },
    end: (moved) => { if (!moved && !additive) setSel({ keys: [] }); },
  };
}

export function graphPointerDown(c: Ctl, e: PointerEvent) {
  const r = c.parts.lanes.getBoundingClientRect();
  const h = pickGraph(c, e.clientX - r.left, e.clientY - r.top);
  const m = modsOf(e);
  const additive = m.shift || m.ctrl;
  const el = c.parts.lanes;
  const { sel } = editor();
  if (h.type === 'key') {
    const id = h.key.id, was = sel.keys.includes(id);
    if (additive || !was) setSel({ keys: additive ? (was ? sel.keys.filter((k) => k !== id) : [...sel.keys, id]) : [id] });
    if (additive && was) return;
    c.startDrag(e, el, graphKeysDrag(c, e, h.key, was && !additive ? () => setSel({ keys: [id] }) : undefined));
  } else if (h.type === 'handle') {
    c.startDrag(e, el, handleDrag(c, h.row, h.i, h.which));
  } else c.startDrag(e, el, graphBoxDrag(c, e));
}

export function graphDblClick(c: Ctl, e: MouseEvent) {
  const r = c.parts.lanes.getBoundingClientRect();
  const h = pickGraph(c, e.clientX - r.left, e.clientY - r.top);
  if (h.type !== 'curve') return;
  const t = c.snap(h.t, modsOf(e)).t;
  const v = evalTrack({ ...h.row.track, wiggle: undefined, audio: undefined }, t);
  const layerId = h.row.layer.id, prop = h.row.key, id = uid('k');
  editor().commit('Add keyframe', (d) => {
    const tr = d.layers.find((l) => l.id === layerId)?.props[prop];
    if (!tr || tr.keys.some((k) => Math.abs(k.t - t) < 1 / 480)) return;
    tr.keys.push({ id, t, v, ease: [0.33, 0, 0.67, 1] });
    tr.keys.sort((a, b) => a.t - b.t);
  });
  setSel({ keys: [id] });
}

export function graphContext(c: Ctl, e: MouseEvent) {
  const r = c.parts.lanes.getBoundingClientRect();
  const h = pickGraph(c, e.clientX - r.left, e.clientY - r.top);
  if (h.type === 'key') {
    if (!editor().sel.keys.includes(h.key.id)) setSel({ keys: [h.key.id] });
    c.openMenu(e.clientX, e.clientY, keyMenuItems());
  }
}

