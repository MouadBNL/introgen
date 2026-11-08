/** The control kit. Nothing here looks like a browser default. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { editor } from '../core/store';
import { Icon, type IconName } from './icons';
import { Popover, type Placement } from './popover';
import { lsGet, lsSet } from './shell';

export function IconBtn({ icon, title, active, on, size = 14, className, disabled, onClick, style }: {
  icon: IconName; title: string; active?: boolean; on?: boolean; size?: number; className?: string; disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; style?: CSSProperties;
}) {
  return (
    <button type="button" className={`ibtn${active ? ' active' : ''}${on ? ' on' : ''} ${className ?? ''}`} title={title} aria-label={title}
      aria-pressed={active ?? on} disabled={disabled} onClick={onClick} style={style}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Btn({ children, icon, primary, ghost, small, block, disabled, title, onClick, className }: {
  children: ReactNode; icon?: IconName; primary?: boolean; ghost?: boolean; small?: boolean; block?: boolean; disabled?: boolean;
  title?: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; className?: string;
}) {
  const cls = ['btn', primary && 'primary', ghost && 'ghost', small && 'small', block && 'block', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled} title={title} onClick={onClick}>
      {icon && <Icon name={icon} size={13} />}<span>{children}</span>
    </button>
  );
}

export interface Opt<T> { value: T; label: string; hint?: string; style?: CSSProperties; action?: () => void; sep?: boolean }

export function Select<T extends string | number>({ value, options, onChange, title, className, disabled, placement = 'bottom-start', placeholder }: {
  value: T; options: Opt<T>[]; onChange: (v: T) => void; title?: string; className?: string; disabled?: boolean; placement?: Placement; placeholder?: string;
}) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    setHi(i);
    requestAnimationFrame(() => {
      list.current?.focus();
      list.current?.children[i]?.scrollIntoView({ block: 'nearest' });
    });
  }, [open]);

  const pick = (o: Opt<T>) => {
    setOpen(false);
    el?.focus();
    if (o.action) o.action(); else if (o.value !== value) onChange(o.value);
  };

  return (
    <>
      <button type="button" ref={setEl} className={`select ${className ?? ''}${open ? ' open' : ''}`} title={title} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); setOpen(true); } }}>
        <span className="select-label" style={cur?.style}>{cur?.label ?? placeholder ?? String(value)}</span>
        <Icon name="chevD" size={10} />
      </button>
      {open && (
        <Popover anchor={el} onClose={() => setOpen(false)} placement={placement} className="pop-menu" style={{ minWidth: el?.offsetWidth }}>
          <div ref={list} className="menu" role="listbox" tabIndex={-1} onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault(); e.stopPropagation();
              const n = (hi + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
              setHi(n);
              list.current?.children[n]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault(); e.stopPropagation();
              if (options[hi]) pick(options[hi]);
            }
          }}>
            {options.map((o, i) => (
              <div key={`${o.value}-${i}`} role="option" aria-selected={o.value === value}
                className={`menu-item${i === hi ? ' active' : ''}${o.sep ? ' sep-top' : ''}`} onPointerEnter={() => setHi(i)} onClick={() => pick(o)}>
                <span className="menu-gutter">{o.value === value && !o.action ? <Icon name="check" size={12} /> : null}</span>
                <span className="menu-label" style={o.style}>{o.label}</span>
                {o.hint && <span className="menu-hint">{o.hint}</span>}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

export function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

/** Accepts seconds, ss:ff or mm:ss:ff. */
export function parseTime(s: string, fps: number): number {
  const parts = s.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  if (parts.length === 1) return parts[0];
  const [m, sec, f] = parts.length === 2 ? [0, parts[0], parts[1]] : parts;
  return m * 60 + sec + f / fps;
}

export interface ScrubProps {
  value: number;
  /** Fires during a drag and on typed commits. Wrapped in begin/endDrag, so any recording action makes one undo step. */
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Display multiplier: 100 for percent. */
  scale?: number;
  unit?: string;
  decimals?: number;
  format?: (v: number) => string;
  parse?: (s: string) => number;
  disabled?: boolean;
  className?: string;
  title?: string;
}

/** AE-style number: drag to scrub (shift 10x, alt 0.1x), click to type. */
export function Scrub({ value, onChange, min, max, step = 0.01, scale = 1, unit = '', decimals, format, parse, disabled, className, title }: ScrubProps) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; v: number; moved: boolean; id: number } | null>(null);
  const cancel = useRef(false);
  const dec = decimals ?? decimalsFor(step * scale);
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const text = format ? format(value) : (value * scale).toFixed(dec);

  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  // A drag must not outlive the control (selection change mid-drag), or history stays suspended.
  useEffect(() => () => { if (drag.current?.moved) editor().endDrag(); }, []);

  const commit = (s: string) => {
    const v = parse ? parse(s) : parseFloat(s) / scale;
    if (Number.isFinite(v) && v !== value) {
      editor().beginDrag();
      onChange(v);
      editor().endDrag();
    }
  };

  if (editing) {
    return (
      <input ref={input} className={`scrub-input ${className ?? ''}`} defaultValue={format ? text : String(+(value * scale).toFixed(Math.max(dec, 3)))} spellCheck={false}
        onBlur={(e) => { setEditing(false); if (!cancel.current) commit(e.currentTarget.value); cancel.current = false; }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur(); }
          else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !format) {
            e.preventDefault();
            const m = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            const cur = parseFloat(e.currentTarget.value);
            if (Number.isFinite(cur)) e.currentTarget.value = String(+(cur + step * scale * m).toFixed(Math.max(dec, 3)));
          }
        }} />
    );
  }

  return (
    <span className={`scrub ${disabled ? 'disabled ' : ''}${className ?? ''}`} title={title ?? 'Drag to change (Shift ×10, Alt ×0.1). Click to type.'} tabIndex={disabled ? -1 : 0} role="spinbutton"
      aria-valuenow={value}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setEditing(true); } }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, moved: false, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved) {
          if (Math.abs(dx) < 3) return;
          d.moved = true;
          d.x = e.clientX;
          editor().beginDrag();
          document.body.classList.add('scrubbing');
          return;
        }
        const m = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        d.x = e.clientX;
        d.v = clamp(d.v + dx * step * m);
        const q = step * (e.altKey ? 0.1 : 1);
        onChange(clamp(+(Math.round(d.v / q) * q).toFixed(6)));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        document.body.classList.remove('scrubbing');
        if (d.moved) editor().endDrag(); else setEditing(true);
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        document.body.classList.remove('scrubbing');
        if (d?.moved) editor().endDrag();
      }}>
      {text}{unit && <i>{unit}</i>}
    </span>
  );
}

export function Slider({ value, onChange, min = 0, max = 1, step = 0.01, disabled }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const set = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onChange(+(Math.round((min + k * (max - min)) / step) * step).toFixed(5));
  };
  return (
    <div className={`slider${disabled ? ' disabled' : ''}`} role="slider" aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
      onPointerMove={(e) => { if (e.buttons & 1) set(e); }}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        if (d) { e.preventDefault(); e.stopPropagation(); onChange(Math.max(min, Math.min(max, +(value + d).toFixed(5)))); }
      }}>
      <div className="slider-fill" style={{ width: `${((value - min) / (max - min)) * 100}%` }} />
    </div>
  );
}

export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className={`check${checked ? ' on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="check-box">{checked && <Icon name="check" size={10} />}</span>
      {label && <span>{label}</span>}
    </button>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, className }: {
  value: T; options: { value: T; label?: string; icon?: IconName; title?: string }[]; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={`seg ${className ?? ''}`} role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'active' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={13} />}{o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

/** Text bound straight to the store. One focus session is one undo step. */
export function TextField({ value, onChange, multiline, placeholder, className, disabled, ariaLabel }: {
  value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; className?: string; disabled?: boolean; ariaLabel?: string;
}) {
  const session = useRef(false);
  const open = () => { if (!session.current) { session.current = true; editor().beginDrag(); } };
  const close = () => { if (session.current) { session.current = false; editor().endDrag(); } };
  useEffect(() => close, []);
  const common = {
    value, placeholder, disabled, spellCheck: false, 'aria-label': ariaLabel, onFocus: open, onBlur: close,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.currentTarget.value),
  };
  if (multiline) return <textarea className={`field ${className ?? ''}`} rows={3} {...common} onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }} />;
  return <input className={`field ${className ?? ''}`} {...common} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} />;
}

/** Label + control row used across the panels. */
export function Row({ label, children, title, stack }: { label: string; children: ReactNode; title?: string; stack?: boolean }) {
  return (
    <div className={`row${stack ? ' stack' : ''}`} title={title}>
      <label className="row-label">{label}</label>
      <div className="row-ctl">{children}</div>
    </div>
  );
}

const SECTIONS_KEY = 'introgen.sections';
let sections: Record<string, boolean> | null = null;

export function useSectionOpen(id: string, def: boolean): [boolean, () => void] {
  sections ??= lsGet<Record<string, boolean>>(SECTIONS_KEY, {});
  const [open, setOpen] = useState(sections[id] ?? def);
  return [open, () => {
    const next = !open;
    sections![id] = next;
    lsSet(SECTIONS_KEY, sections);
    setOpen(next);
  }];
}

export function Section({ id, title, def = true, right, children, badge }: { id: string; title: string; def?: boolean; right?: ReactNode; children: ReactNode; badge?: ReactNode }) {
  const [open, toggle] = useSectionOpen(id, def);
  return (
    <section className={`section${open ? ' open' : ''}`}>
      <header className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} onClick={toggle}>
          <Icon name={open ? 'chevD' : 'chevR'} size={10} />
          <span>{title}</span>
          {badge}
        </button>
        {right}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

