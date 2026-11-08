import { useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { editor, useEditor } from '../../core/store';
import { Ctl, type Parts } from './ctl';
import { HeaderColumn } from './Header';
import { Toolbar } from './Toolbar';
import './timeline.css';

export function Timeline(): JSX.Element {
  const [ctl] = useState(() => new Ctl());
  const mode = useEditor((s) => s.ui.timelineMode);
  const parts = useRef<Partial<Parts>>({});
  const ref = <K extends keyof Parts>(k: K) => (el: Parts[K] | null) => { if (el) parts.current[k] = el; };

  useLayoutEffect(() => {
    ctl.attach(parts.current as Parts);
    return () => ctl.detach();
  }, [ctl]);

  const onResizer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const w0 = ctl.persist.headW, x0 = e.clientX;
    ctl.startDrag(e.nativeEvent, e.currentTarget, { threshold: 0, move: (_x, _y, _m, ev) => ctl.setHeadW(w0 + ev.clientX - x0) });
  };

  return (
    <div className="tl" ref={ref('root')}>
      <Toolbar ctl={ctl} />
      <div className="tl-main">
        <div className="tl-left">
          <div className="tl-corner">
            <span className="tl-tc" ref={ref('corner')}>00:00:00</span>
            <span className="tl-bb" ref={ref('cornerBars')}>1.1</span>
          </div>
          <div className="tl-head" ref={ref('head')}>
            <div className="tl-head-inner" ref={ref('headInner')}><HeaderColumn ctl={ctl} /></div>
            <div className="tl-drop" ref={ref('drop')} />
          </div>
        </div>
        <div className="tl-resizer" onPointerDown={onResizer} />
        <div className="tl-right">
          <div className="tl-ruler"><canvas ref={ref('ruler')} /><RenameMarker ctl={ctl} /></div>
          <div className="tl-tracks" ref={ref('tracks')}>
            <canvas ref={ref('lanes')} />
            <div className="tl-box" ref={ref('box')} />
            <div className="tl-guide" ref={ref('guide')} />
            <div className="tl-vbar" ref={ref('vbar')}><div className="tl-vthumb" ref={ref('vthumb')} /></div>
            {mode === 'graph' && <button className="tl-fity" onClick={() => ctl.fitGraphY()}>Fit Y</button>}
          </div>
          <div className="tl-hbar" ref={ref('hbar')}><div className="tl-hthumb" ref={ref('hthumb')} /></div>
          <div className="tl-ph" ref={ref('playhead')}><div className="tl-ph-flag" ref={ref('flag')} /></div>
        </div>
      </div>
      <div className="tl-readout" ref={ref('readout')} />
      <Menu ctl={ctl} />
    </div>
  );
}

function RenameMarker({ ctl }: { ctl: Ctl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const r = ctl.rename;
  if (!r) return null;
  const commit = (value: string) => {
    if (ctl.rename?.id !== r.id) return;
    ctl.endRename();
    editor().commit('Rename marker', (d) => {
      const m = d.markers.find((q) => q.id === r.id);
      if (m) m.label = value.trim();
    });
  };
  return (
    <input className="tl-rename" autoFocus defaultValue={r.value} style={{ left: r.x + 3 }} placeholder="Marker" key={r.id}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit(e.currentTarget.value);
        if (e.key === 'Escape') ctl.endRename();
      }} />
  );
}

function Menu({ ctl }: { ctl: Ctl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const ref = useRef<HTMLDivElement>(null);
  const m = ctl.menu;
  useLayoutEffect(() => {
    if (!m) return;
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(m.x, innerWidth - r.width - 6))}px`;
    el.style.top = `${Math.max(4, Math.min(m.y, innerHeight - r.height - 6))}px`;
    const close = (e: Event) => { if (!el.contains(e.target as Node)) ctl.closeMenu(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); ctl.closeMenu(); } };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', close, true);
    };
  }, [m, ctl]);
  if (!m) return null;
  return createPortal(
    <div className="tl-menu" ref={ref} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {m.items.map((it, i) => it.sep ? <hr key={i} /> : (
        <button key={i} role="menuitem" disabled={it.disabled} className={it.danger ? 'danger' : ''} onClick={() => { ctl.closeMenu(); it.action?.(); }}>
          <span className="tl-menu-check">{it.checked ? '•' : ''}</span>
          <span>{it.label}</span>
          {it.hint && <kbd>{it.hint}</kbd>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
