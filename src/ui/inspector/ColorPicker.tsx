import { useEffect, useRef, useState } from 'react';
import { hexToRgb, rgbToHex } from '../../core/eval';
import { editor } from '../../core/store';
import { Popover } from '../popover';

type HSV = [number, number, number];

function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return rgbToHex(f(5), f(3), f(1));
}

const SWATCHES = ['#ffffff', '#c8c8d0', '#26262c', '#000000', '#ff2d55', '#ff7a3c', '#ffc65a', '#39ff14', '#00f0ff', '#5aa2ff', '#bf5af2', '#ff4468'];

/** Drags are single undo steps: begin on press, end on release. */
function useDragArea(apply: (x: number, y: number) => void) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      editor().beginDrag();
      const r = e.currentTarget.getBoundingClientRect();
      apply((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!(e.buttons & 1)) return;
      const r = e.currentTarget.getBoundingClientRect();
      apply((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    },
    onPointerUp: () => editor().endDrag(),
    onPointerCancel: () => editor().endDrag(),
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function ColorPanel({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(...hexToRgb(value)));
  const [hex, setHex] = useState(value);
  const own = useRef(value);

  // Follow outside changes (playhead moving through animated colors) but keep hue through greys.
  useEffect(() => {
    if (value !== own.current) { own.current = value; setHsv(rgbToHsv(...hexToRgb(value))); }
    setHex(value);
  }, [value]);

  const put = (n: HSV) => {
    setHsv(n);
    const h = hsvToHex(...n);
    own.current = h;
    setHex(h);
    onChange(h);
  };
  const sv = useDragArea((x, y) => put([hsv[0], clamp01(x), 1 - clamp01(y)]));
  const hue = useDragArea((x) => put([clamp01(x) * 359.9, hsv[1], hsv[2]]));

  const commitHex = (s: string) => {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(s.trim());
    if (!m) { setHex(value); return; }
    const full = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    const out = `#${full.toLowerCase()}`;
    if (out === value) return;
    own.current = out;
    setHsv(rgbToHsv(...hexToRgb(out)));
    editor().beginDrag();
    onChange(out);
    editor().endDrag();
  };

  return (
    <div className="cp">
      <div className="cp-sv" {...sv} style={{ backgroundColor: hsvToHex(hsv[0], 1, 1) }}>
        <i style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} />
      </div>
      <div className="cp-hue" {...hue}><i style={{ left: `${(hsv[0] / 360) * 100}%` }} /></div>
      <div className="cp-row">
        <span className="cp-preview" style={{ background: value }} />
        <input className="field mono" value={hex} spellCheck={false} aria-label="Hex color" onChange={(e) => setHex(e.currentTarget.value)}
          onBlur={(e) => commitHex(e.currentTarget.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitHex(e.currentTarget.value); }} />
      </div>
      <div className="cp-swatches">
        {SWATCHES.map((c) => <button key={c} type="button" title={c} style={{ background: c }} onClick={() => commitHex(c)} />)}
      </div>
    </div>
  );
}

export function ColorField({ value, onChange, disabled }: { value: string; onChange: (hex: string) => void; disabled?: boolean }) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" ref={setEl} className={`color-field${open ? ' open' : ''}`} disabled={disabled} title="Pick color" onClick={() => setOpen((v) => !v)}>
        <span className="color-chip" style={{ background: value }} />
        <span className="mono">{value.toUpperCase()}</span>
      </button>
      {open && <Popover anchor={el} onClose={() => setOpen(false)} placement="bottom-end"><ColorPanel value={value} onChange={onChange} /></Popover>}
    </>
  );
}
