/** Canvas painters for the dope sheet lanes and the ruler. Everything is drawn in CSS pixels on a dpr transform. */
import { editor } from '../../core/store';
import { beatDuration, formatTimecode } from '../../core/eval';
import { HIT_DEF } from '../../core/schema';
import type { AudioClip, Ease, Keyframe, LayerType, Project, SyncHit } from '../../core/types';
import * as AudioModule from '../../audio/engine';
import type { Ctl } from './ctl';
import { hitsOfKind, layerSummary, lowerBound, lowerBoundNum, type Row, type Summary } from './model';

export const FONT_UI = '10.5px Inter, system-ui, sans-serif';
export const FONT_UI_B = '600 9.5px Inter, system-ui, sans-serif';
export const FONT_MONO = '9.5px "JetBrains Mono", ui-monospace, monospace';

export interface Colors {
  bg0: string; bg1: string; bg2: string; bg3: string; line: string; lineStrong: string; text0: string; text1: string; text2: string; text3: string;
  accent: string; accentSoft: string; key: string; keySel: string; audio: string; sync: string; beat: string; bar: string; lt: Record<string, string>;
}

const LAYER_TYPES: LayerType[] = ['camera', 'post', 'background', 'text3d', 'text2d', 'logo', 'image', 'light', 'particles', 'streaks', 'splash', 'dots', 'debris', 'lightning', 'shockwave', 'flare', 'null'];

export function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  const lt: Record<string, string> = {};
  for (const t of LAYER_TYPES) lt[t] = v(`--lt-${t}`, '#8e8e93');
  return {
    bg0: v('--bg-0', '#0b0b0d'), bg1: v('--bg-1', '#141417'), bg2: v('--bg-2', '#1b1b1f'), bg3: v('--bg-3', '#24242a'),
    line: v('--line', '#2a2a31'), lineStrong: v('--line-strong', '#3a3a43'),
    text0: v('--text-0', '#f2f2f5'), text1: v('--text-1', '#b9b9c3'), text2: v('--text-2', '#7c7c88'), text3: v('--text-3', '#55555f'),
    accent: v('--accent', '#ff2d55'), accentSoft: v('--accent-soft', 'rgba(255,45,85,.16)'), key: v('--key', '#ffcc4d'), keySel: v('--key-sel', '#ffffff'),
    audio: v('--audio', '#3ddc97'), sync: v('--sync', '#bf5af2'), beat: v('--beat', 'rgba(255,255,255,.05)'), bar: v('--bar', 'rgba(255,255,255,.11)'), lt,
  };
}

/** Crisp device-pixel lines at any devicePixelRatio. */
export function vline(c: Ctl, ctx: CanvasRenderingContext2D, x: number, y: number, h: number) {
  const d = c.dpr;
  ctx.fillRect(Math.round(x * d) / d, y, Math.max(1, Math.round(d)) / d, h);
}
export function hline(c: Ctl, ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const d = c.dpr;
  ctx.fillRect(x, Math.round(y * d) / d, w, Math.max(1, Math.round(d)) / d);
}

export type GridLevel = 0 | 1 | 2; // bar, beat, subdivision

/** Walks the musical grid at the density the current zoom can show. */
export function forGrid(c: Ctl, p: Project, cb: (x: number, level: GridLevel, bar: number) => void, minPx = 8) {
  const pps = c.pps, beat = beatDuration(p), barS = beat * 4;
  const t0 = Math.max(0, c.xToT(-2)), t1 = c.xToT(c.w + 2);
  const beatPx = beat * pps;
  if (beatPx < minPx) {
    let stride = 1;
    while (barS * stride * pps < minPx) stride *= 2;
    const step = barS * stride;
    for (let i = Math.ceil((t0 - p.beatOffset) / step); ; i++) {
      const t = p.beatOffset + i * step;
      if (t > t1) break;
      cb(c.tToX(t), 0, i * stride + 1);
    }
    return;
  }
  const subs = beatPx / 8 >= 11 ? 8 : beatPx / 4 >= 11 ? 4 : beatPx / 2 >= 11 ? 2 : 1;
  const step = beat / subs;
  for (let i = Math.ceil((t0 - p.beatOffset) / step); ; i++) {
    const t = p.beatOffset + i * step;
    if (t > t1) break;
    const inBar = ((i % (subs * 4)) + subs * 4) % (subs * 4);
    const level: GridLevel = inBar === 0 ? 0 : inBar % subs === 0 ? 1 : 2;
    cb(c.tToX(t), level, Math.floor(i / (subs * 4)) + 1);
  }
}

export function paintGrid(c: Ctl, ctx: CanvasRenderingContext2D, p: Project, y: number, h: number) {
  const C = c.colors;
  const lines: [number[], number[], number[]] = [[], [], []];
  forGrid(c, p, (x, level) => lines[level].push(x));
  ctx.fillStyle = 'rgba(255,255,255,0.022)';
  for (const x of lines[2]) vline(c, ctx, x, y, h);
  ctx.fillStyle = C.beat;
  for (const x of lines[1]) vline(c, ctx, x, y, h);
  ctx.fillStyle = C.bar;
  for (const x of lines[0]) vline(c, ctx, x, y, h);
}

export function paintWorkEnd(c: Ctl, ctx: CanvasRenderingContext2D, p: Project, y: number, h: number) {
  const x = c.tToX(p.duration);
  if (x < c.w) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y, c.w - x, h);
    ctx.fillStyle = c.colors.lineStrong;
    vline(c, ctx, x, y, h);
  }
  const x0 = c.tToX(0);
  if (x0 > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, y, x0, h);
  }
}

// ---- music sections ----
export interface MusicBand { name: string; t0: number; t1: number; drop: boolean }
let bandMemo: { music: unknown; clips: unknown; bands: MusicBand[] } | null = null;

/** Where the generated track's build/drop sections sit on the timeline, if a music clip exists. */
export function musicBands(p: Project): MusicBand[] {
  if (bandMemo && bandMemo.music === p.music && bandMemo.clips === p.clips) return bandMemo.bands;
  let bands: MusicBand[] = [];
  const clip = p.clips.find((k) => k.source.kind === 'music');
  const layoutFn = (AudioModule as unknown as { musicLayout?: typeof AudioModule.musicLayout }).musicLayout;
  if (clip && layoutFn) {
    try {
      const base = clip.t - clip.offset;
      bands = layoutFn(p.music).sections.map((s) => ({
        name: s.name, t0: Math.max(clip.t, base + s.start), t1: Math.min(clip.t + clip.dur, base + s.end), drop: /drop/i.test(s.name),
      })).filter((b) => b.t1 > b.t0);
    } catch { /* music layout unavailable */ }
  }
  bandMemo = { music: p.music, clips: p.clips, bands };
  return bands;
}

// ---- lanes ----
export function keyShape(ctx: CanvasRenderingContext2D, x: number, y: number, ease: Ease, r: number) {
  if (ease === 'hold') {
    const s = r * 0.8;
    ctx.rect(x - s, y - s, s * 2, s * 2);
  } else if (ease === 'linear') {
    const s = r * 0.85;
    ctx.moveTo(x + s, y);
    ctx.arc(x, y, s, 0, Math.PI * 2);
  } else {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  }
}

function paintKeys(c: Ctl, ctx: CanvasRenderingContext2D, keys: Keyframe[], cy: number, selected: Set<string>) {
  if (!keys.length) return;
  const C = c.colors;
  const i0 = Math.max(0, lowerBound(keys, c.xToT(-8)) - 1);
  const i1 = Math.min(keys.length, lowerBound(keys, c.xToT(c.w + 8)) + 1);

  ctx.fillStyle = C.key;
  ctx.globalAlpha = 0.24;
  for (let i = i0; i < i1 - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (a.v === b.v) continue;
    const xa = c.tToX(a.t), xb = c.tToX(b.t);
    if (xb - xa > 2) hline(c, ctx, xa, cy, xb - xa);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = C.bg0;
  ctx.lineWidth = 1;
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    let last = -1e9, count = 0;
    for (let i = i0; i < i1; i++) {
      const k = keys[i];
      if (selected.has(k.id) !== (pass === 1)) continue;
      const x = Math.round(c.tToX(k.t));
      if (x === last) continue; // thousands of keys collapse to one mark per pixel
      last = x;
      count++;
      keyShape(ctx, x + 0.5, cy + 0.5, k.ease, 4.5);
    }
    if (!count) continue;
    ctx.fillStyle = pass ? C.keySel : C.key;
    ctx.fill();
    ctx.stroke();
  }
}

function paintSummary(c: Ctl, ctx: CanvasRenderingContext2D, s: Summary, cy: number, selected: Set<string>) {
  const C = c.colors;
  const i0 = lowerBoundNum(s.t, c.xToT(-6)), i1 = lowerBoundNum(s.t, c.xToT(c.w + 6));
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    let last = -1e9, count = 0;
    for (let i = i0; i < i1; i++) {
      if (s.ids[i].some((id) => selected.has(id)) !== (pass === 1)) continue;
      const x = Math.round(c.tToX(s.t[i]));
      if (x === last) continue;
      last = x;
      count++;
      keyShape(ctx, x + 0.5, cy + 0.5, [0, 0, 1, 1], 3);
    }
    if (!count) continue;
    ctx.fillStyle = pass ? C.keySel : C.key;
    ctx.globalAlpha = pass ? 1 : 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function paintBar(c: Ctl, ctx: CanvasRenderingContext2D, row: Extract<Row, { kind: 'layer' }>, y: number, selected: boolean) {
  const l = row.layer, C = c.colors;
  const color = C.lt[l.type] ?? C.text2;
  const x0 = c.tToX(l.start), x1 = c.tToX(l.end);
  if (x1 < 0 || x0 > c.w) return;
  const top = y + 3, h = row.h - 6;
  const left = Math.round(x0), w = Math.max(2, Math.round(x1) - left);
  const dim = l.visible ? 1 : 0.45;

  ctx.fillStyle = color;
  ctx.globalAlpha = (selected ? 0.42 : 0.24) * dim;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 2.5);
  ctx.fill();
  ctx.globalAlpha = (selected ? 1 : 0.75) * dim;
  ctx.fillRect(left, top, 2, h);
  ctx.fillRect(left + w - 2, top, 2, h);
  ctx.globalAlpha = 0.5 * dim;
  hline(c, ctx, left, top, w);
  ctx.globalAlpha = 1;

  if (l.locked) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const a = Math.max(left, 0), b = Math.min(left + w, c.w);
    for (let x = a - h - (a % 8); x < b; x += 8) { ctx.moveTo(x, top + h); ctx.lineTo(x + h, top); }
    ctx.stroke();
    ctx.restore();
  }

  const tx = Math.max(left, 0) + 7, avail = Math.min(left + w, c.w) - tx - 5;
  if (avail > 26) {
    ctx.font = FONT_UI;
    ctx.fillStyle = selected ? C.text0 : C.text1;
    ctx.globalAlpha = dim;
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, l.name, avail), tx, y + row.h / 2 + 0.5);
    ctx.globalAlpha = 1;
  }
}

const fitMemo = new Map<string, string>();
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  const memoKey = `${text}|${Math.round(max / 8)}`;
  const hit = fitMemo.get(memoKey);
  if (hit != null) return hit;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, m)}…`).width <= max) lo = m; else hi = m - 1;
  }
  const out = lo ? `${text.slice(0, lo)}…` : '';
  if (fitMemo.size > 500) fitMemo.clear();
  fitMemo.set(memoKey, out);
  return out;
}

function paintHit(c: Ctl, ctx: CanvasRenderingContext2D, h: SyncHit, top: number, bottom: number, selected: boolean, tail: boolean) {
  const x = Math.round(c.tToX(h.t)), w = h.dur * c.pps;
  if (x + w < -2 || x > c.w + 2) return;
  const color = HIT_DEF[h.kind].color;
  const full = bottom - top;
  const hh = Math.max(4, full * Math.min(1, 0.28 + h.amount * 0.36));
  ctx.fillStyle = color;
  if (tail) {
    ctx.globalAlpha = selected ? 0.5 : 0.3;
    ctx.beginPath();
    ctx.moveTo(x, bottom - hh);
    ctx.quadraticCurveTo(x + w * 0.25, bottom - hh * 0.25, x + w, bottom);
    ctx.lineTo(x, bottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = selected ? c.colors.keySel : color;
  ctx.fillRect(x - (selected ? 1 : 0.5), bottom - hh, selected ? 3 : 2, hh);
  if (selected && tail) {
    ctx.fillStyle = c.colors.keySel;
    ctx.fillRect(Math.round(x + w) - 1, bottom - 5, 2, 5);
  }
}

function paintWave(c: Ctl, ctx: CanvasRenderingContext2D, clip: AudioClip, left: number, right: number, top: number, h: number) {
  let peaks: AudioModule.Peaks | null = null;
  try { peaks = AudioModule.AudioEngine.get().peaks(clip.source); } catch { return; }
  if (!peaks || !peaks.min.length) return;
  const pps = c.pps, mid = top + h / 2, half = (h / 2) * Math.min(1.4, 0.45 + clip.gain * 0.55);
  const a = Math.max(0, Math.floor(left)), b = Math.min(c.w, Math.ceil(right));
  const x0 = c.tToX(clip.t);
  const n = peaks.min.length, { min, max, rate } = peaks;
  const count = Math.max(0, b - a);
  if (!count) return;
  const lo = new Float32Array(count), hi = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const s0 = clip.offset + (a + i - x0) / pps, s1 = s0 + 1 / pps;
    let j0 = Math.floor(s0 * rate), j1 = Math.max(j0 + 1, Math.ceil(s1 * rate));
    j0 = Math.max(0, j0); j1 = Math.min(n, j1);
    let mn = 0, mx = 0;
    for (let j = j0; j < j1; j++) {
      if (min[j] < mn) mn = min[j];
      if (max[j] > mx) mx = max[j];
    }
    const local = (a + i - x0) / pps;
    const fade = Math.min(1, clip.fadeIn > 0 ? local / clip.fadeIn : 1, clip.fadeOut > 0 ? (clip.dur - local) / clip.fadeOut : 1);
    lo[i] = mn * Math.max(0, fade);
    hi[i] = mx * Math.max(0, fade);
  }
  ctx.beginPath();
  ctx.moveTo(a, mid - hi[0] * half);
  for (let i = 1; i < count; i++) ctx.lineTo(a + i, mid - hi[i] * half);
  for (let i = count - 1; i >= 0; i--) ctx.lineTo(a + i, mid - lo[i] * half - 0.5);
  ctx.closePath();
  ctx.fill();
}

export const CLIP_INSET = 2;
const CLIP_HEADER = 13;

function paintClip(c: Ctl, ctx: CanvasRenderingContext2D, clip: AudioClip, y: number, rowH: number, selected: boolean) {
  const C = c.colors;
  const x0 = Math.round(c.tToX(clip.t)), x1 = Math.round(c.tToX(clip.t + clip.dur));
  if (x1 < 0 || x0 > c.w) return;
  const top = y + CLIP_INSET, h = rowH - CLIP_INSET * 2 - 1, w = Math.max(3, x1 - x0);
  const color = clip.muted ? C.text3 : C.audio;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, top, w, h, 3);
  ctx.clip();
  ctx.fillStyle = C.bg0;
  ctx.fillRect(x0, top, w, h);
  ctx.fillStyle = color;
  ctx.globalAlpha = selected ? 0.26 : 0.13;
  ctx.fillRect(x0, top, w, h);
  ctx.globalAlpha = selected ? 0.3 : 0.2;
  ctx.fillRect(x0, top, w, CLIP_HEADER);
  ctx.globalAlpha = clip.muted ? 0.4 : 0.85;
  paintWave(c, ctx, clip, x0, x0 + w, top + CLIP_HEADER, h - CLIP_HEADER);
  ctx.globalAlpha = 1;

  // Fades: darkened corner plus the ramp itself.
  const fi = clip.fadeIn * c.pps, fo = clip.fadeOut * c.pps;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  if (fi > 0.5) {
    ctx.beginPath(); ctx.moveTo(x0, top); ctx.lineTo(x0 + fi, top); ctx.lineTo(x0, top + h); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x0, top + h); ctx.lineTo(x0 + fi, top); ctx.stroke();
  }
  if (fo > 0.5) {
    ctx.beginPath(); ctx.moveTo(x0 + w, top); ctx.lineTo(x0 + w - fo, top); ctx.lineTo(x0 + w, top + h); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x0 + w, top + h); ctx.lineTo(x0 + w - fo, top); ctx.stroke();
  }

  const tx = Math.max(x0, 0) + 5 + (x0 >= 0 ? Math.min(fi, 8) : 0), avail = Math.min(x0 + w, c.w) - tx - 8;
  if (avail > 16) {
    ctx.font = FONT_UI;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = clip.muted ? C.text2 : C.text0;
    ctx.fillText(fitText(ctx, clip.muted ? `${clip.name} (muted)` : clip.name, avail), tx, top + CLIP_HEADER / 2 + 0.5);
  }
  ctx.restore();

  ctx.strokeStyle = selected ? C.keySel : color;
  ctx.globalAlpha = selected ? 1 : 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x0 + 0.5, top + 0.5, w - 1, h - 1, 3);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (w > 28) {
    ctx.fillStyle = selected ? C.keySel : color;
    ctx.fillRect(Math.round(x0 + fi) - (fi > 3 ? 2 : -1), top + 1, 4, 4);
    ctx.fillRect(Math.round(x0 + w - fo) - (fo > 3 ? 2 : 5), top + 1, 4, 4);
  }
}

function paintBands(c: Ctl, ctx: CanvasRenderingContext2D, p: Project, y: number, h: number) {
  const C = c.colors;
  ctx.font = FONT_UI_B;
  ctx.textBaseline = 'middle';
  for (const b of musicBands(p)) {
    const x0 = c.tToX(b.t0), x1 = c.tToX(b.t1);
    if (x1 < 0 || x0 > c.w) continue;
    ctx.fillStyle = b.drop ? C.accent : C.text2;
    ctx.globalAlpha = b.drop ? 0.2 : 0.07;
    ctx.fillRect(x0, y, x1 - x0, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = b.drop ? C.accent : C.text3;
    vline(c, ctx, x0, y, h);
    if (x1 - x0 > 40) {
      ctx.fillStyle = b.drop ? C.accent : C.text2;
      ctx.fillText(b.name.toUpperCase(), Math.max(x0, 0) + 6, y + h / 2 + 0.5);
    }
  }
}

export function paintLanes(c: Ctl) {
  const { project: p } = editor();
  const ctx = c.lctx, C = c.colors, { w, h, dpr, rows, scrollY } = c;
  const sets = c.selSets();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg1;
  ctx.fillRect(0, 0, w, h);
  if (!rows.length) return;

  const first = c.rowIndexAt(scrollY), last = c.rowIndexAt(scrollY + h);
  for (let i = first; i <= last; i++) {
    const r = rows[i], y = r.y - scrollY;
    if (r.kind === 'section') ctx.fillStyle = C.bg2;
    else if (r.kind === 'prop' || r.kind === 'group' || r.kind === 'note') ctx.fillStyle = '#101013';
    else if (r.kind === 'layer' && sets.layers.has(r.layer.id)) ctx.fillStyle = C.bg1;
    else continue;
    ctx.fillRect(0, y, w, r.h);
    if (r.kind === 'prop' || r.kind === 'group') {
      const x0 = c.tToX(r.layer.start), x1 = c.tToX(r.layer.end);
      ctx.fillStyle = 'rgba(255,255,255,0.018)';
      ctx.fillRect(x0, y, x1 - x0, r.h);
    }
  }

  const bottom = Math.min(h, c.contentH - scrollY);
  paintGrid(c, ctx, p, 0, bottom);
  paintWorkEnd(c, ctx, p, 0, h);

  for (let i = first; i <= last; i++) {
    const r = rows[i], y = r.y - scrollY;
    if (r.kind === 'layer' && sets.layers.has(r.layer.id)) {
      ctx.fillStyle = C.accentSoft;
      ctx.fillRect(0, y, w, r.h);
    }
    ctx.fillStyle = r.kind === 'section' ? C.lineStrong : C.line;
    hline(c, ctx, 0, y + r.h - 1, w);
  }

  ctx.globalAlpha = 0.5;
  for (const m of p.markers) {
    const x = c.tToX(m.t);
    if (x >= 0 && x <= w) {
      ctx.fillStyle = m.color ?? C.sync;
      vline(c, ctx, x, 0, bottom);
    }
  }
  ctx.globalAlpha = 1;

  for (let i = first; i <= last; i++) {
    const r = rows[i], y = r.y - scrollY, cy = y + Math.floor(r.h / 2);
    switch (r.kind) {
      case 'section':
        if (r.section === 'sync') paintBands(c, ctx, p, y, r.h - 1);
        break;
      case 'hitAll':
        for (const hit of p.hits) paintHit(c, ctx, hit, y + 5, y + r.h - 3, sets.hits.has(hit.id), false);
        break;
      case 'hitLane':
        for (const hit of hitsOfKind(p.hits, r.hitKind)) paintHit(c, ctx, hit, y + 3, y + r.h - 3, sets.hits.has(hit.id), true);
        break;
      case 'clipLane':
        for (const clip of p.clips) if (clip.lane === r.lane) paintClip(c, ctx, clip, y, r.h, sets.clips.has(clip.id));
        break;
      case 'layer':
        paintBar(c, ctx, r, y, sets.layers.has(r.layer.id));
        if (!c.persist.expanded[r.layer.id]) paintSummary(c, ctx, layerSummary(r.layer), cy, sets.keys);
        break;
      case 'group':
        if (c.persist.closedGroups[`${r.layer.id}/${r.group}`]) paintSummary(c, ctx, layerSummary(r.layer, r.group), cy, sets.keys);
        break;
      case 'prop':
        paintKeys(c, ctx, r.track.keys, cy, sets.keys);
        break;
    }
  }
}

// ---- ruler ----
const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];

export function paintRuler(c: Ctl) {
  const { project: p } = editor();
  const ctx = c.rctx, C = c.colors, { w, dpr } = c;
  const H = 26, mid = 13;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg2;
  ctx.fillRect(0, 0, w, H);

  // Bars strip.
  ctx.font = FONT_MONO;
  ctx.textBaseline = 'middle';
  const beatPx = beatDuration(p) * c.pps;
  let labelEvery = 1;
  while (beatPx * 4 * labelEvery < 30) labelEvery *= 2;
  forGrid(c, p, (x, level, bar) => {
    if (level === 0) {
      ctx.fillStyle = C.lineStrong;
      vline(c, ctx, x, 0, mid);
      if (bar >= 1 && (bar - 1) % labelEvery === 0) {
        ctx.fillStyle = C.text1;
        ctx.fillText(String(bar), x + 4, mid / 2 + 0.5);
      }
    } else {
      ctx.fillStyle = level === 1 ? C.lineStrong : C.line;
      vline(c, ctx, x, mid - (level === 1 ? 5 : 3), level === 1 ? 5 : 3);
    }
  }, 6);

  // Time strip.
  ctx.fillStyle = C.line;
  hline(c, ctx, 0, mid, w);
  const fps = p.fps;
  const target = 66 / c.pps;
  let step = 0;
  for (const f of [1, 2, 5, 10, 15, 30]) {
    if (f / fps >= target && f < fps) { step = f / fps; break; }
  }
  if (!step) step = (TIME_STEPS.find((s) => s >= target) ?? 600);
  const minor = step / 5;
  const t0 = Math.max(0, c.xToT(-40)), t1 = c.xToT(w + 2);
  const startI = Math.floor(t0 / minor);
  ctx.textBaseline = 'middle';
  for (let i = startI; ; i++) {
    const t = i * minor;
    if (t > t1) break;
    const x = c.tToX(t), major = i % 5 === 0;
    ctx.fillStyle = major ? C.text3 : C.lineStrong;
    vline(c, ctx, x, major ? mid + 1 : H - 3, major ? H - mid - 1 : 3);
    if (major) {
      ctx.fillStyle = C.text2;
      ctx.fillText(formatTimecode(t + 1e-6, fps), x + 4, mid + 7);
    }
  }

  // Music sections as a thin strip.
  for (const b of musicBands(p)) {
    const x0 = c.tToX(b.t0), x1 = c.tToX(b.t1);
    ctx.fillStyle = b.drop ? C.accent : C.text3;
    ctx.fillRect(x0, H - 2, x1 - x0, 2);
  }

  // Past the work area.
  paintWorkEnd(c, ctx, p, 0, H);

  // Marker flags.
  ctx.font = FONT_UI_B;
  for (const m of p.markers) {
    const x = Math.round(c.tToX(m.t));
    const label = m.label || '';
    const fw = label ? Math.min(120, ctx.measureText(label).width + 8) : 7;
    if (x + fw < 0 || x > w) continue;
    ctx.fillStyle = m.color ?? C.sync;
    ctx.fillRect(x, 0, 1, H);
    ctx.beginPath();
    ctx.moveTo(x, mid); ctx.lineTo(x + fw, mid); ctx.lineTo(x + fw, H - 4); ctx.lineTo(x + 3, H - 1); ctx.lineTo(x, H - 1);
    ctx.closePath();
    ctx.fill();
    if (label) {
      ctx.fillStyle = '#0b0b0d';
      ctx.fillText(fitText(ctx, label, fw - 6), x + 4, mid + 5.5);
    }
  }

  ctx.fillStyle = C.lineStrong;
  hline(c, ctx, 0, H - 1, w);
}

export function markerFlagWidth(c: Ctl, label: string) {
  const ctx = c.rctx;
  ctx.font = FONT_UI_B;
  return label ? Math.min(120, ctx.measureText(label).width + 8) : 7;
}
