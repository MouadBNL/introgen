/** Ruler interaction: scrubbing and markers. */
import { editor, transport } from '../../core/store';
import { uid } from '../../core/rng';
import type { Marker } from '../../core/types';
import { modsOf, type Ctl } from './ctl';
import { markerFlagWidth } from './paint';

function pickMarker(c: Ctl, x: number, y: number): Marker | null {
  if (y < 13) return null;
  const ms = editor().project.markers;
  for (let i = ms.length - 1; i >= 0; i--) {
    const mx = c.tToX(ms[i].t);
    if (x >= mx - 3 && x <= mx + markerFlagWidth(c, ms[i].label) + 1) return ms[i];
  }
  return null;
}

const local = (c: Ctl, e: MouseEvent) => {
  const r = c.parts.ruler.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

export function rulerHover(c: Ctl, x: number, y: number) {
  return pickMarker(c, x, y) ? 'grab' : 'ew-resize';
}

export function rulerPointerDown(c: Ctl, e: PointerEvent) {
  const { x, y } = local(c, e);
  const mk = pickMarker(c, x, y);
  if (mk) {
    const id = mk.id, t0 = mk.t, grabT = c.xToT(x);
    c.startDrag(e, c.parts.ruler, {
      history: true,
      auto: 'x',
      move: (mx, _y, m, ev) => {
        const t = c.snap(t0 + c.xToT(mx) - grabT, m, { marker: id }).t;
        editor().patch((d) => {
          const k = d.markers.find((q) => q.id === id);
          if (k) k.t = t;
        });
        c.showGuide(t);
        c.showReadout(timeText(t), ev.clientX, ev.clientY);
      },
      end: () => editor().patch((d) => { d.markers.sort((a, b) => a.t - b.t); }),
    });
    return;
  }
  const scrub = (mx: number, shift: boolean) => c.seek(c.snap(c.xToT(mx), { shift }, { scrub: true }).t);
  scrub(x, e.shiftKey);
  c.startDrag(e, c.parts.ruler, { threshold: 0, auto: 'x', move: (mx, _y, m) => scrub(mx, m.shift) });
}

const timeText = (t: number) => `${t.toFixed(3)}s`;

export function rulerDblClick(c: Ctl, e: MouseEvent) {
  const { x, y } = local(c, e);
  const mk = pickMarker(c, x, y);
  if (mk) { c.startRename(mk.id, c.tToX(mk.t), mk.label); return; }
  const t = c.snap(c.xToT(x), modsOf(e)).t;
  const id = uid('m');
  editor().commit('Add marker', (d) => {
    d.markers.push({ id, t, label: '' });
    d.markers.sort((a, b) => a.t - b.t);
  });
  c.startRename(id, c.tToX(t), '');
}

export function rulerContext(c: Ctl, e: MouseEvent) {
  const { x, y } = local(c, e);
  const mk = pickMarker(c, x, y);
  if (mk) editor().deleteMarker(mk.id);
  else {
    const t = c.xToT(x);
    c.openMenu(e.clientX, e.clientY, [
      { label: 'Add marker here', action: () => editor().addMarker(c.snap(t).t) },
      { label: 'Add marker at playhead', action: () => editor().addMarker(transport().time) },
    ]);
  }
}
