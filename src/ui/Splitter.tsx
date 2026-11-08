import { useRef } from 'react';
import { DEFAULTS, getSize, persistLayout, setSize, type PanelKey } from './layout';

/** `dir` is +1 when dragging right/down grows the panel, -1 when it shrinks it. */
export function Splitter({ panel, axis, dir }: { panel: PanelKey; axis: 'x' | 'y'; dir: 1 | -1 }) {
  const start = useRef<{ pos: number; size: number } | null>(null);
  const cursor = axis === 'x' ? 'col-resize' : 'row-resize';
  return (
    <div className={`splitter splitter-${axis}`} role="separator" aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} title="Drag to resize. Double-click to reset."
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: axis === 'x' ? e.clientX : e.clientY, size: getSize(panel) };
        document.body.style.cursor = cursor;
        e.currentTarget.classList.add('dragging');
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        setSize(panel, s.size + ((axis === 'x' ? e.clientX : e.clientY) - s.pos) * dir);
      }}
      onPointerUp={(e) => {
        start.current = null;
        document.body.style.cursor = '';
        e.currentTarget.classList.remove('dragging');
        persistLayout();
      }}
      onDoubleClick={() => { setSize(panel, DEFAULTS[panel]); persistLayout(); }} />
  );
}
