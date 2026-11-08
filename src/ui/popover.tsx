/** Popovers and menus. All portal to <body>, close on outside press / Escape, and clamp to the viewport. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';

interface StackEntry { close: () => void; el: () => HTMLElement | null; ignore: () => HTMLElement | null }
const stack: StackEntry[] = [];

function onDown(e: PointerEvent) {
  const target = e.target as Node;
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    if (s.el()?.contains(target) || s.ignore()?.contains(target)) return;
    s.close();
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !stack.length) return;
  e.stopPropagation();
  e.preventDefault();
  stack[stack.length - 1].close();
}
let installed = false;
function install() {
  if (installed) return;
  installed = true;
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', () => { for (let i = stack.length - 1; i >= 0; i--) stack[i].close(); });
}
export const anyPopoverOpen = () => stack.length > 0;

export type Anchor = HTMLElement | { x: number; y: number };
export type Placement = 'bottom-start' | 'bottom-end' | 'right-start' | 'top-start';

interface PopoverProps {
  anchor: Anchor | null;
  onClose: () => void;
  placement?: Placement;
  /** Presses inside this element do not count as "outside". Defaults to the anchor. */
  ignore?: HTMLElement | null;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Popover({ anchor, onClose, placement = 'bottom-start', ignore, className, style, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    install();
    const entry: StackEntry = {
      close: () => closeRef.current(),
      el: () => ref.current,
      ignore: () => ignore ?? (anchor instanceof HTMLElement ? anchor : null),
    };
    stack.push(entry);
    return () => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); };
  }, [anchor, ignore]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const m = 6;
    const vw = window.innerWidth, vh = window.innerHeight;
    const a = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
    const w = el.offsetWidth, h = el.scrollHeight;
    let left: number, top: number;
    if (placement === 'right-start') {
      left = a.right - 2;
      top = a.top - 4;
      if (left + w > vw - m) left = a.left - w + 2;
    } else {
      left = placement === 'bottom-end' ? a.right - w : a.left;
      top = placement === 'top-start' ? a.top - h - 2 : a.bottom + 2;
      if (top + h > vh - m && a.top - h - 2 >= m) top = a.top - h - 2;
    }
    left = Math.max(m, Math.min(left, vw - w - m));
    top = Math.max(m, Math.min(top, vh - Math.min(h, vh - 2 * m) - m));
    setPos({ left, top, maxH: vh - top - m });
  }, [anchor, placement]);

  if (!anchor) return null;
  return createPortal(
    <div ref={ref} className={`pop ${className ?? ''}`} onContextMenu={(e) => e.preventDefault()}
      style={{ ...style, left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxH, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}

export type MenuItem =
  | { sep: true }
  | { header: string }
  | { label: string; hint?: string; icon?: IconName; disabled?: boolean; checked?: boolean; danger?: boolean; onClick?: () => void; items?: MenuItem[] };

type ActionItem = Extract<MenuItem, { label: string }>;
const isAction = (m: MenuItem): m is ActionItem => 'label' in m;

export function MenuList({ items, onDone, autoFocus = true, onBack, onCross }: {
  items: MenuItem[];
  onDone: () => void;
  autoFocus?: boolean;
  onBack?: () => void;
  /** Left/Right at the top level, used by the menu bar to walk between menus. */
  onCross?: (dir: 1 | -1) => void;
}) {
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ i: number; el: HTMLElement; focus: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const hover = useRef<number | undefined>(undefined);
  useEffect(() => { if (autoFocus) root.current?.focus(); }, [autoFocus]);
  useEffect(() => () => window.clearTimeout(hover.current), []);

  const move = (d: number) => {
    const n = items.length;
    let i = active;
    for (let c = 0; c < n; c++) {
      i = (i + d + n) % n;
      const it = items[i];
      if (isAction(it) && !it.disabled) { setActive(i); rows.current[i]?.scrollIntoView({ block: 'nearest' }); return; }
    }
  };
  const openSub = (i: number, focus: boolean) => {
    const el = rows.current[i];
    if (el) setSub({ i, el, focus });
  };
  const run = (i: number) => {
    const it = items[i];
    if (!isAction(it) || it.disabled) return;
    if (it.items) { openSub(i, true); return; }
    onDone();
    it.onClick?.();
  };

  return (
    <div ref={root} className="menu" tabIndex={-1} role="menu" onKeyDown={(e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(-1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (active >= 0) run(active); }
      else if (e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        const it = items[active];
        if (it && isAction(it) && it.items) openSub(active, true); else onCross?.(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation();
        if (onBack) onBack(); else onCross?.(-1);
      }
    }}>
      {items.map((it, i) => {
        if ('sep' in it) return <div key={i} className="menu-sep" />;
        if ('header' in it) return <div key={i} className="menu-header">{it.header}</div>;
        return (
          <div key={i} ref={(el) => { rows.current[i] = el; }} role="menuitem"
            className={`menu-item${i === active ? ' active' : ''}${it.disabled ? ' disabled' : ''}${it.danger ? ' danger' : ''}`}
            onPointerEnter={() => {
              setActive(i);
              window.clearTimeout(hover.current);
              if (it.items && !it.disabled) hover.current = window.setTimeout(() => openSub(i, false), 90);
              else if (sub) hover.current = window.setTimeout(() => setSub(null), 120);
            }}
            onClick={() => run(i)}>
            <span className="menu-gutter">{it.checked ? <Icon name="check" size={12} /> : it.icon ? <Icon name={it.icon} size={13} /> : null}</span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
            {it.items && <Icon name="chevR" size={11} className="menu-arrow" />}
          </div>
        );
      })}
      {sub && isAction(items[sub.i]) && (
        <Popover anchor={sub.el} placement="right-start" ignore={root.current} onClose={() => setSub(null)} className="pop-menu">
          <MenuList items={(items[sub.i] as ActionItem).items!} onDone={onDone} autoFocus={sub.focus}
            onBack={() => { setSub(null); root.current?.focus(); }} />
        </Popover>
      )}
    </div>
  );
}
