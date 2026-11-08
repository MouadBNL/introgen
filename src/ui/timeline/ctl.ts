/**
 * Timeline controller. Owns everything that must not go through React: canvases, scroll, the playhead,
 * pointer drags and the live values in the header. React renders chrome and listens to `version`.
 */
import { editor, transport, useEditor, useTransport } from '../../core/store';
import { evalTrack, formatTimecode, snapToBeat, snapToFrame } from '../../core/eval';
import { playback } from '../../core/playback';
import { AudioEngine } from '../../audio/engine';
import type { BandEnvelopes } from '../../core/types';
import { buildGraphRows, buildRows, formatValue, loadPersist, MAX_PPS, MIN_PPS, PAD, rowsSignature, savePersist, type Persist, type PropRow, type Row, type SectionId } from './model';
import { paintLanes, paintRuler, readColors, type Colors } from './paint';
import { fitGraph, graphPointerDown, graphDblClick, graphContext, graphHover, newGraphView, paintGraph, type GraphView } from './graph';
import { laneContext, laneDblClick, laneHover, lanePointerDown } from './lanes';
import { rulerContext, rulerDblClick, rulerHover, rulerPointerDown } from './ruler';

export interface Mods { shift: boolean; alt: boolean; ctrl: boolean }
export const modsOf = (e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Mods =>
  ({ shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey });

export interface DragSpec {
  /** Pixels of travel before it counts as a drag. */
  threshold?: number;
  /** Wrap in beginDrag/endDrag: one undo step, Esc restores the project. */
  history?: boolean;
  /** Scroll when the pointer reaches the track area's edges. */
  auto?: 'x' | 'y' | 'xy';
  begin?(m: Mods): void;
  /** x, y are relative to the track canvas. */
  move(x: number, y: number, m: Mods, e: { clientX: number; clientY: number }): void;
  end?(moved: boolean, m: Mods): void;
  cancel?(): void;
}

interface ActiveDrag {
  spec: DragSpec; el: HTMLElement; id: number; x0: number; y0: number; x: number; y: number; cx: number; cy: number;
  m: Mods; moved: boolean; project: unknown; sel: unknown; raf: number;
  off: () => void;
}

export interface MenuItem { label?: string; hint?: string; action?: () => void; danger?: boolean; checked?: boolean; disabled?: boolean; sep?: boolean }
export interface MenuState { x: number; y: number; items: MenuItem[] }
export interface RenameState { id: string; x: number; value: string }

export interface Parts {
  root: HTMLElement; tracks: HTMLElement; lanes: HTMLCanvasElement; ruler: HTMLCanvasElement; head: HTMLElement; headInner: HTMLElement;
  playhead: HTMLElement; flag: HTMLElement; corner: HTMLElement; cornerBars: HTMLElement; box: HTMLElement; guide: HTMLElement; readout: HTMLElement;
  drop: HTMLElement; vbar: HTMLElement; vthumb: HTMLElement; hbar: HTMLElement; hthumb: HTMLElement;
}

export class Ctl {
  parts!: Parts;
  lctx!: CanvasRenderingContext2D;
  rctx!: CanvasRenderingContext2D;
  colors!: Colors;
  dpr = 1;
  w = 0;
  h = 0;
  scrollY = 0;
  rows: Row[] = [];
  contentH = 0;
  persist: Persist = loadPersist();
  graph: GraphView = newGraphView();
  /** Header row range currently in the DOM. */
  win: [number, number] = [0, 0];
  menu: MenuState | null = null;
  rename: RenameState | null = null;

  private sig = '';
  private version = 0;
  private listeners = new Set<() => void>();
  private dirty = false;
  private raf = 0;
  private active: ActiveDrag | null = null;
  private offs: (() => void)[] = [];
  private valueEls = new Map<string, { value: HTMLElement | null; dot: HTMLElement | null; row: PropRow }>();
  private lastLive = 0;
  private lastCode = '';
  private selMemo: { sel: unknown; keys: Set<string>; hits: Set<string>; clips: Set<string>; layers: Set<string> } | null = null;

  // ---- React bridge ----
  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };
  getVersion = () => this.version;
  emit() { this.version++; for (const l of this.listeners) l(); }

  // ---- geometry ----
  get pps() { return editor().ui.pxPerSec; }
  get sx() { return editor().ui.scrollX; }
  get isGraph() { return editor().ui.timelineMode === 'graph'; }
  tToX(t: number) { const u = editor().ui; return PAD + (t - u.scrollX) * u.pxPerSec; }
  xToT(x: number) { const u = editor().ui; return u.scrollX + (x - PAD) / u.pxPerSec; }

  rowIndexAt(contentY: number): number {
    const r = this.rows;
    let lo = 0, hi = r.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (r[m].y <= contentY) lo = m; else hi = m - 1;
    }
    return lo;
  }
  rowAt(contentY: number): Row | null {
    if (contentY < 0 || contentY >= this.contentH) return null;
    return this.rows[this.rowIndexAt(contentY)] ?? null;
  }

  selSets() {
    const sel = editor().sel;
    if (this.selMemo?.sel !== sel) {
      this.selMemo = { sel, keys: new Set(sel.keys), hits: new Set(sel.hits), clips: new Set(sel.clips), layers: new Set(sel.layers) };
    }
    return this.selMemo;
  }

  /** Beat grid snapping with Shift inverted, plus magnets on the playhead and markers. */
  snap(t: number, m?: Pick<Mods, 'shift'>, opts?: { scrub?: boolean; marker?: string }): { t: number; hard: boolean } {
    const { project: p, ui } = editor();
    const beat = ui.snapBeats !== !!m?.shift;
    if (!beat) return { t: snapToFrame(p.fps, t), hard: false };
    const reach = 6 / ui.pxPerSec;
    let best = snapToBeat(p, t, ui.beatDiv), dist = Infinity;
    const consider = (c: number) => {
      const d = Math.abs(c - t);
      if (d < reach && d < dist) { dist = d; best = c; }
    };
    if (!opts?.scrub) consider(transport().time); // the playhead must not attract itself
    for (const mk of p.markers) if (mk.id !== opts?.marker) consider(mk.t);
    return { t: Math.max(0, best), hard: true };
  }

  // ---- lifecycle ----
  attach(parts: Parts) {
    this.parts = parts;
    this.lctx = parts.lanes.getContext('2d', { alpha: false })!;
    this.rctx = parts.ruler.getContext('2d', { alpha: false })!;
    this.colors = readColors(parts.root);
    parts.root.style.setProperty('--tl-head-w', `${this.persist.headW}px`);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(parts.tracks);
    this.offs.push(() => ro.disconnect());

    this.offs.push(useEditor.subscribe((s, prev) => {
      const graphDeps = s.ui.timelineMode === 'graph' && (s.sel.layers !== prev.sel.layers || s.ui.graphProp !== prev.ui.graphProp);
      if (s.project !== prev.project || s.ui.timelineMode !== prev.ui.timelineMode || s.ui.tapKind !== prev.ui.tapKind || graphDeps) this.rebuild();
      if (s.project !== prev.project || s.sel !== prev.sel || s.ui !== prev.ui) this.invalidate();
      if (s.ui.pxPerSec !== prev.ui.pxPerSec || s.ui.scrollX !== prev.ui.scrollX) this.placePlayhead(transport().time);
      if (s.project !== prev.project) this.updateLive(true);
    }));
    this.offs.push(useTransport.subscribe((s) => this.onTime(s.time, s.playing)));
    try {
      this.offs.push(AudioEngine.get().subscribe(() => this.invalidate()));
    } catch { /* audio module not available: clips render without waveforms */ }

    const listen = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, opts);
      this.offs.push(() => el.removeEventListener(type, fn, opts));
    };
    listen(parts.root, 'wheel', this.onWheel, { passive: false });
    listen(parts.root, 'contextmenu', (e) => e.preventDefault());
    listen(parts.lanes, 'pointerdown', (e) => {
      if (e.button === 1) return this.startPan(e, parts.lanes);
      if (e.button !== 0) return;
      this.isGraph ? graphPointerDown(this, e) : lanePointerDown(this, e);
    });
    listen(parts.lanes, 'pointermove', (e) => {
      if (this.active) return;
      const r = parts.lanes.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      parts.lanes.style.cursor = this.isGraph ? graphHover(this, x, y) : laneHover(this, x, y);
    });
    listen(parts.lanes, 'dblclick', (e) => (this.isGraph ? graphDblClick(this, e) : laneDblClick(this, e)));
    listen(parts.lanes, 'contextmenu', (e) => (this.isGraph ? graphContext(this, e) : laneContext(this, e)));
    listen(parts.ruler, 'pointerdown', (e) => {
      if (e.button === 1) return this.startPan(e, parts.ruler);
      if (e.button === 0) rulerPointerDown(this, e);
    });
    listen(parts.ruler, 'pointermove', (e) => {
      if (!this.active) parts.ruler.style.cursor = rulerHover(this, e.clientX - parts.ruler.getBoundingClientRect().left, e.clientY - parts.ruler.getBoundingClientRect().top);
    });
    listen(parts.ruler, 'dblclick', (e) => rulerDblClick(this, e));
    listen(parts.ruler, 'contextmenu', (e) => rulerContext(this, e));
    listen(parts.head, 'pointerdown', (e) => { if (e.button === 1) this.startPan(e, parts.head); });
    listen(parts.vbar, 'pointerdown', this.onVBar);
    listen(parts.hbar, 'pointerdown', this.onHBar);
    document.fonts?.ready.then(() => this.invalidate());

    this.rebuild();
    this.resize();
    this.onTime(transport().time, transport().playing);
  }

  detach() {
    for (const off of this.offs) off();
    this.offs = [];
    cancelAnimationFrame(this.raf);
    this.dirty = false;
    this.active?.off();
    this.active = null;
  }

  private resize() {
    const { tracks, lanes, ruler } = this.parts;
    const r = tracks.getBoundingClientRect();
    this.w = Math.max(1, Math.floor(r.width));
    this.h = Math.max(1, Math.floor(r.height));
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    lanes.width = Math.round(this.w * this.dpr);
    lanes.height = Math.round(this.h * this.dpr);
    lanes.style.width = `${this.w}px`;
    lanes.style.height = `${this.h}px`;
    ruler.width = Math.round(this.w * this.dpr);
    ruler.height = Math.round(26 * this.dpr);
    ruler.style.width = `${this.w}px`;
    ruler.style.height = '26px';
    this.setScrollY(this.scrollY);
    this.syncWindow();
    this.placePlayhead(transport().time);
    this.draw();
  }

  invalidate() {
    if (this.dirty) return;
    this.dirty = true;
    this.raf = requestAnimationFrame(() => this.draw());
  }

  private draw() {
    this.dirty = false;
    if (!this.lctx) return;
    if (this.isGraph) paintGraph(this); else paintLanes(this);
    paintRuler(this);
    this.syncScrollbars();
  }

  /** Rebuild rows after a project or view change. */
  rebuild() {
    const s = editor();
    const rows = s.ui.timelineMode === 'graph'
      ? buildGraphRows(s.project, s.sel.layers, s.ui.graphProp)
      : buildRows(s.project, this.persist, s.ui.tapKind);
    this.rows = rows;
    const last = rows[rows.length - 1];
    this.contentH = last ? last.y + last.h : 0;
    for (const r of rows) if (r.kind === 'prop') {
      const e = this.valueEls.get(r.id);
      if (e) e.row = r;
    }
    if (this.isGraph && !this.active) fitGraph(this);
    const sig = s.ui.timelineMode + rowsSignature(rows);
    if (sig !== this.sig) {
      this.sig = sig;
      if (this.parts) { this.setScrollY(this.scrollY); this.syncWindow(true); }
    }
    this.invalidate();
  }

  // ---- persisted view state ----
  updatePersist(fn: (p: Persist) => void) {
    fn(this.persist);
    savePersist(this.persist);
    this.sig = '';
    this.rebuild();
  }
  toggleSection(id: SectionId) { this.updatePersist((p) => { p.collapsed[id] = !p.collapsed[id]; }); }
  toggleLayer(id: string) { this.updatePersist((p) => { p.expanded[id] = !p.expanded[id]; }); }
  toggleGroup(id: string) { this.updatePersist((p) => { p.closedGroups[id] = !p.closedGroups[id]; }); }
  setAnimatedOnly(v: boolean) { this.updatePersist((p) => { p.animatedOnly = v; }); }
  setHeadW(px: number) {
    this.persist.headW = Math.max(170, Math.min(560, px));
    this.parts.root.style.setProperty('--tl-head-w', `${this.persist.headW}px`);
    savePersist(this.persist);
  }

  // ---- scroll & zoom ----
  private maxScrollY() { return Math.max(0, this.contentH - this.h); }
  private span() { return Math.max(0.01, (this.w - PAD) / this.pps); }
  maxScrollX() { return Math.max(0, editor().project.duration - this.span() * 0.75); }

  setScrollY(v: number) {
    const y = Math.max(0, Math.min(this.maxScrollY(), Math.round(v)));
    if (this.parts) this.parts.headInner.style.transform = `translate3d(0,${-y}px,0)`;
    if (y === this.scrollY) return;
    this.scrollY = y;
    this.syncWindow();
    this.invalidate();
  }

  setScrollX(v: number) {
    const x = Math.max(0, Math.min(this.maxScrollX(), v));
    if (x !== this.sx) editor().setUI({ scrollX: x });
  }

  /** Zoom keeping the time under `anchorX` in place. */
  zoomTo(pps: number, anchorX = this.tToX(transport().time)) {
    const next = Math.max(MIN_PPS, Math.min(MAX_PPS, pps));
    const t = this.xToT(anchorX);
    const span = (this.w - PAD) / next;
    const sx = Math.max(0, Math.min(Math.max(0, editor().project.duration - span * 0.75), t - (anchorX - PAD) / next));
    editor().setUI({ pxPerSec: next, scrollX: sx });
  }

  fitAll() {
    const p = editor().project;
    editor().setUI({ pxPerSec: Math.max(MIN_PPS, Math.min(MAX_PPS, (this.w - PAD * 2) / Math.max(0.1, p.duration))), scrollX: 0 });
    if (this.isGraph) { this.graph.auto = true; fitGraph(this); this.invalidate(); }
  }

  private onWheel = (e: WheelEvent) => {
    if (this.menu) return;
    const target = e.target as HTMLElement;
    if (target.closest('.tl-toolbar')) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const r = this.parts.lanes.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (e.ctrlKey || e.metaKey) {
      this.zoomTo(this.pps * Math.exp(-dy * 0.0022), x < 0 ? undefined : x);
    } else if (this.isGraph && e.altKey) {
      this.graph.zoomY(Math.exp((dy || dx) * 0.0022), e.clientY - r.top, this.h);
      this.invalidate();
    } else if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
      this.setScrollX(this.sx + (dx || dy) / this.pps);
    } else if (this.isGraph && x >= 0) {
      this.graph.panY(dy, this.h);
      this.invalidate();
    } else this.setScrollY(this.scrollY + dy);
  };

  private startPan(e: PointerEvent, el: HTMLElement) {
    e.preventDefault();
    let px = e.clientX, py = e.clientY;
    this.startDrag(e, el, {
      threshold: 0,
      move: (_x, _y, _m, ev) => {
        this.setScrollX(this.sx - (ev.clientX - px) / this.pps);
        if (this.isGraph) { this.graph.panY(-(ev.clientY - py), this.h); this.invalidate(); } else this.setScrollY(this.scrollY - (ev.clientY - py));
        px = ev.clientX; py = ev.clientY;
      },
    });
  }

  private syncScrollbars() {
    const { vbar, vthumb, hthumb, hbar } = this.parts;
    const max = this.maxScrollY();
    const showV = max > 0 && !this.isGraph;
    vbar.style.display = showV ? '' : 'none';
    if (showV) {
      const th = Math.max(24, this.h * (this.h / this.contentH));
      vthumb.style.height = `${th}px`;
      vthumb.style.transform = `translateY(${(this.h - th) * (this.scrollY / max)}px)`;
    }
    const total = this.navTotal(), bw = hbar.clientWidth;
    const left = (this.sx / total) * bw, width = Math.max(14, (this.span() / total) * bw);
    hthumb.style.width = `${Math.min(bw, width)}px`;
    hthumb.style.transform = `translateX(${Math.min(bw - Math.min(bw, width), left)}px)`;
  }

  private navTotal() { return Math.max(editor().project.duration * 1.02, this.sx + this.span()); }

  private onVBar = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { vthumb } = this.parts;
    const th = vthumb.getBoundingClientRect();
    const range = this.h - th.height;
    if (e.target !== vthumb) this.setScrollY(((e.clientY - this.parts.vbar.getBoundingClientRect().top - th.height / 2) / range) * this.maxScrollY());
    const y0 = e.clientY, s0 = this.scrollY;
    this.startDrag(e, this.parts.vbar, {
      threshold: 0,
      move: (_x, _y, _m, ev) => this.setScrollY(s0 + ((ev.clientY - y0) / Math.max(1, range)) * this.maxScrollY()),
    });
  };

  /** The nav bar pans from the thumb's middle and zooms from its ends, like AE's time navigator. */
  private onHBar = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { hbar, hthumb } = this.parts;
    const b = hbar.getBoundingClientRect(), th = hthumb.getBoundingClientRect();
    const total = this.navTotal(), bw = b.width;
    const x0 = e.clientX;
    const toT = (cx: number) => ((cx - b.left) / bw) * total;
    const tStart = this.sx, tEnd = this.sx + this.span();
    const edge = e.clientX < th.left + 6 && e.clientX >= th.left - 1 ? 'l' : e.clientX > th.right - 6 && e.clientX <= th.right + 1 ? 'r' : null;
    if (!edge && (e.clientX < th.left || e.clientX > th.right)) this.setScrollX(toT(e.clientX) - this.span() / 2);
    const s0 = this.sx;
    this.startDrag(e, hbar, {
      threshold: 0,
      move: (_x, _y, _m, ev) => {
        if (!edge) return this.setScrollX(s0 + ((ev.clientX - x0) / bw) * total);
        const a = edge === 'l' ? Math.max(0, Math.min(toT(ev.clientX), tEnd - 0.05)) : tStart;
        const z = edge === 'r' ? Math.max(toT(ev.clientX), tStart + 0.05) : tEnd;
        const pps = Math.max(MIN_PPS, Math.min(MAX_PPS, (this.w - PAD) / (z - a)));
        editor().setUI({ pxPerSec: pps, scrollX: a });
      },
    });
  };

  // ---- pointer drags ----
  startDrag(e: PointerEvent, el: HTMLElement, spec: DragSpec) {
    const onMove = (ev: PointerEvent) => this.dragMove(ev);
    const onUp = (ev: PointerEvent) => this.dragEnd(ev);
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); this.dragCancel(); } };
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true);
    const r = this.parts.lanes.getBoundingClientRect();
    const d: ActiveDrag = {
      spec, el, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY,
      m: modsOf(e), moved: false, project: null, sel: null, raf: 0,
      off: () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        window.removeEventListener('keydown', onKey, true);
        cancelAnimationFrame(d.raf);
        try { el.releasePointerCapture(d.id); } catch { /* already released */ }
      },
    };
    this.active = d;
    if (spec.auto) d.raf = requestAnimationFrame(this.autoScroll);
  }

  private dragMove(e: PointerEvent) {
    const d = this.active;
    if (!d) return;
    const r = this.parts.lanes.getBoundingClientRect();
    d.x = e.clientX - r.left; d.y = e.clientY - r.top; d.cx = e.clientX; d.cy = e.clientY;
    d.m = modsOf(e);
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < (d.spec.threshold ?? 3)) return;
      d.moved = true;
      if (d.spec.history) {
        d.project = editor().project;
        d.sel = editor().sel;
        editor().beginDrag();
      }
      d.spec.begin?.(d.m);
    }
    d.spec.move(d.x, d.y, d.m, e);
  }

  private dragEnd(e: PointerEvent) {
    const d = this.active;
    if (!d) return;
    this.active = null;
    d.off();
    d.m = modsOf(e);
    d.spec.end?.(d.moved, d.m);
    if (d.moved && d.spec.history) editor().endDrag();
    this.clearOverlays();
    if (this.isGraph) this.rebuild();
  }

  private dragCancel() {
    const d = this.active;
    if (!d) return;
    this.active = null;
    d.off();
    if (d.moved && d.spec.history) {
      useEditor.setState((s) => ({ project: d.project as typeof s.project, sel: d.sel as typeof s.sel, rev: s.rev + 1 }));
      editor().endDrag();
    }
    d.spec.cancel?.();
    this.clearOverlays();
  }

  private autoScroll = () => {
    const d = this.active;
    if (!d) return;
    if (d.moved && d.spec.auto) {
      const edge = 26;
      const sx = this.sx, sy = this.scrollY;
      if (d.spec.auto !== 'y') {
        const over = d.x < edge ? d.x - edge : d.x > this.w - edge ? d.x - (this.w - edge) : 0;
        if (over) this.setScrollX(sx + (over * 0.35) / this.pps);
      }
      if (d.spec.auto !== 'x') {
        const overY = d.y < edge ? d.y - edge : d.y > this.h - edge ? d.y - (this.h - edge) : 0;
        if (overY) this.setScrollY(sy + overY * 0.35);
      }
      if (sx !== this.sx || sy !== this.scrollY) d.spec.move(d.x, d.y, d.m, { clientX: d.cx, clientY: d.cy });
    }
    d.raf = requestAnimationFrame(this.autoScroll);
  };

  // ---- overlays ----
  showReadout(text: string, cx: number, cy: number) {
    const el = this.parts.readout;
    el.textContent = text;
    el.style.display = 'block';
    el.style.transform = `translate3d(${cx + 14}px,${cy - 26}px,0)`;
  }
  showGuide(t: number | null) {
    const el = this.parts.guide;
    if (t == null) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.transform = `translateX(${Math.round(this.tToX(t))}px)`;
  }
  showBox(x0: number, y0: number, x1: number, y1: number) {
    const el = this.parts.box;
    el.style.display = 'block';
    el.style.left = `${Math.min(x0, x1)}px`;
    el.style.top = `${Math.min(y0, y1)}px`;
    el.style.width = `${Math.abs(x1 - x0)}px`;
    el.style.height = `${Math.abs(y1 - y0)}px`;
  }
  private clearOverlays() {
    const { readout, guide, box, drop } = this.parts;
    readout.style.display = guide.style.display = box.style.display = drop.style.display = 'none';
  }

  openMenu(cx: number, cy: number, items: MenuItem[]) { this.menu = { x: cx, y: cy, items }; this.emit(); }
  closeMenu() { if (this.menu) { this.menu = null; this.emit(); } }
  startRename(id: string, x: number, value: string) { this.rename = { id, x, value }; this.emit(); }
  endRename() { this.rename = null; this.emit(); }

  // ---- playhead ----
  private onTime(t: number, playing: boolean) {
    if (playing) this.flipPage(t);
    this.placePlayhead(t);
    const code = formatTimecode(t, editor().project.fps);
    if (code !== this.lastCode) {
      this.lastCode = code;
      this.parts.flag.textContent = code;
      this.parts.corner.textContent = code;
      const p = editor().project;
      const beats = Math.floor((t - p.beatOffset) * (p.bpm / 60) + 1e-6);
      this.parts.cornerBars.textContent = beats < 0 ? '—' : `${Math.floor(beats / 4) + 1}.${(beats % 4) + 1}`;
    }
    this.updateLive(false);
  }

  private placePlayhead(t: number) {
    const x = Math.round(this.tToX(t));
    const el = this.parts.playhead;
    const on = x >= 0 && x <= this.w;
    el.style.visibility = on ? 'visible' : 'hidden';
    if (on) {
      el.style.transform = `translate3d(${x}px,0,0)`;
      this.parts.flag.classList.toggle('flip', x > this.w - 70);
    }
  }

  private flipPage(t: number) {
    const x = this.tToX(t);
    if (x > this.w - 4 || x < 0) this.setScrollX(t - (x < 0 ? this.span() * 0.1 : 0.02 * this.span()));
  }

  seek(t: number) { playback.seek(t); }

  fitGraphY() {
    this.graph.auto = true;
    fitGraph(this);
    this.invalidate();
  }

  // ---- live values ----
  registerValue(row: PropRow, value: HTMLElement | null, dot: HTMLElement | null) {
    this.valueEls.set(row.id, { value, dot, row });
    return () => { this.valueEls.delete(row.id); };
  }

  /** Only rows in the DOM are evaluated, and at 15 Hz while playing. */
  updateLive(force: boolean) {
    const now = performance.now();
    const playing = transport().playing;
    if (playing && !force && now - this.lastLive < 66) return;
    this.lastLive = now;
    const t = transport().time;
    let env: BandEnvelopes | null = null;
    try { env = AudioEngine.get().envelopes(); } catch { /* audio module not available */ }
    for (const { value, dot, row } of this.valueEls.values()) {
      const tr = row.track;
      const v = evalTrack(tr, t, env);
      if (value) {
        if (typeof v === 'string') value.style.background = v;
        else {
          const txt = formatValue(row.def, v);
          if (value.textContent !== txt) value.textContent = txt;
        }
      }
      if (dot) {
        const on = tr.keys.some((k) => Math.abs(k.t - t) < 1 / 240);
        dot.classList.toggle('on', on);
      }
    }
  }

  // ---- header virtualisation ----
  private syncWindow(force = false) {
    const rows = this.rows;
    if (!rows.length || !this.h) { if (force) this.emit(); return; }
    const a = this.rowIndexAt(this.scrollY);
    const b = this.rowIndexAt(this.scrollY + this.h);
    const i0 = Math.max(0, Math.floor((a - 8) / 16) * 16);
    const i1 = Math.min(rows.length, Math.ceil((b + 9) / 16) * 16);
    if (force || i0 !== this.win[0] || i1 !== this.win[1]) {
      this.win = [i0, i1];
      this.emit();
    }
  }
}
