import { useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { editor, transport, useEditor } from '../../core/store';
import { evalTrack } from '../../core/eval';
import { HIT_DEF, LAYER_DEFS } from '../../core/schema';
import type { Ctl } from './ctl';
import { hitsOfKind, type PropRow, type Row } from './model';
import { setSel } from './lanes';
import { Diamond, Eye, EyeOff, Lock, Next, Prev, Stopwatch, Twirl, Unlock, Wave, Wiggle } from './Glyphs';

const SECTION_LABEL = { sync: 'Sync', audio: 'Audio', layers: 'Layers' };

export function HeaderColumn({ ctl }: { ctl: Ctl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const selLayers = useEditor((s) => s.sel.layers);
  const mode = useEditor((s) => s.ui.timelineMode);
  useLayoutEffect(() => ctl.updateLive(true));
  const [i0, i1] = ctl.win;
  const rows = ctl.rows.slice(i0, i1);
  return (
    <>
      {rows.map((r) => <RowView key={r.id} row={r} ctl={ctl} selected={r.kind === 'layer' && selLayers.includes(r.layer.id)} graph={mode === 'graph'} />)}
    </>
  );
}

function Shell({ row, className, children, onPointerDown }: { row: Row; className: string; children: ReactNode; onPointerDown?: (e: RPointerEvent<HTMLDivElement>) => void }) {
  return <div className={`tl-row ${className}`} style={{ top: row.y, height: row.h }} onPointerDown={onPointerDown}>{children}</div>;
}

function RowView({ row, ctl, selected, graph }: { row: Row; ctl: Ctl; selected: boolean; graph: boolean }) {
  switch (row.kind) {
    case 'section':
      return (
        <Shell row={row} className={`section ${row.section}`} onPointerDown={(e) => { if (e.button === 0) ctl.toggleSection(row.section); }}>
          <Twirl open={!ctl.persist.collapsed[row.section]} />
          <span className="tl-section-name">{SECTION_LABEL[row.section]}</span>
          <span className="tl-count">{row.count}</span>
        </Shell>
      );
    case 'hitAll':
      return <Shell row={row} className="lane"><span className="tl-lane-dot" style={{ background: 'var(--sync)' }} /><span className="tl-name">All</span><span className="tl-count">{row.count}</span></Shell>;
    case 'hitLane': {
      const d = HIT_DEF[row.hitKind];
      return (
        <Shell row={row} className="lane" onPointerDown={(e) => {
          if (e.button !== 0) return;
          editor().setUI({ tapKind: row.hitKind });
          setSel({ hits: hitsOfKind(editor().project.hits, row.hitKind).map((h) => h.id), keys: [], clips: [] });
        }}>
          <span className="tl-lane-dot" style={{ background: d.color }} />
          <span className="tl-name">{d.label}</span>
          <span className="tl-count">{row.count || ''}</span>
        </Shell>
      );
    }
    case 'clipLane':
      return <Shell row={row} className="lane audio"><span className="tl-lane-tag">A{row.lane + 1}</span></Shell>;
    case 'layer':
      return graph ? <GraphLayerRow row={row} selected={selected} /> : <LayerRow row={row} ctl={ctl} selected={selected} />;
    case 'group': {
      const id = `${row.layer.id}/${row.group}`;
      return (
        <Shell row={row} className="group" onPointerDown={(e) => { if (e.button === 0) ctl.toggleGroup(id); }}>
          <Twirl open={!ctl.persist.closedGroups[id]} />
          <span className="tl-name">{row.group}</span>
        </Shell>
      );
    }
    case 'prop':
      return <PropRowView row={row} ctl={ctl} graph={graph} />;
    case 'note':
      return <Shell row={row} className="note"><span>{row.text}</span></Shell>;
  }
}

function GraphLayerRow({ row, selected }: { row: Extract<Row, { kind: 'layer' }>; selected: boolean }) {
  const l = row.layer;
  return (
    <Shell row={row} className={`layer${selected ? ' sel' : ''}`}>
      <span className="tl-chip" style={{ background: `var(--lt-${l.type})` }} />
      <span className="tl-name strong">{l.name}</span>
    </Shell>
  );
}

function LayerRow({ row, ctl, selected }: { row: Extract<Row, { kind: 'layer' }>; ctl: Ctl; selected: boolean }) {
  const l = row.layer, id = l.id;
  const flag = (k: 'visible' | 'solo' | 'locked') => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button === 0) editor().updateLayer(id, { [k]: !editor().project.layers.find((q) => q.id === id)?.[k] });
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const was = editor().sel.layers.includes(id);
    if (additive) editor().select({ layers: [id] }, true);
    else if (!was) editor().select({ layers: [id] });
    else setSel({ keys: [], hits: [], clips: [] });
    if (additive) return;
    let target = -1;
    const { drop } = ctl.parts;
    ctl.startDrag(e.nativeEvent, e.currentTarget, {
      threshold: 5,
      auto: 'y',
      move: (_x, y) => {
        const cy = y + ctl.scrollY;
        const ls = ctl.rows.filter((r): r is Extract<Row, { kind: 'layer' }> => r.kind === 'layer');
        let idx = ls.length, lineY = 0;
        for (let i = 0; i < ls.length; i++) {
          if (cy < ls[i].y + ls[i].h / 2) { idx = i; lineY = ls[i].y; break; }
        }
        if (idx === ls.length && ls.length) {
          const last = ctl.rows[ctl.rows.length - 1];
          lineY = last.y + last.h;
        }
        target = idx;
        drop.style.display = 'block';
        drop.style.transform = `translateY(${lineY - ctl.scrollY}px)`;
      },
      end: (moved) => {
        if (!moved || target < 0) return;
        const from = editor().project.layers.findIndex((q) => q.id === id);
        const to = target > from ? target - 1 : target;
        if (to !== from) editor().moveLayer(id, to);
      },
    });
  };

  return (
    <Shell row={row} className={`layer${selected ? ' sel' : ''}${l.visible ? '' : ' off'}`} onPointerDown={onDown}>
      <button className="tl-ico twirl" onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0) ctl.toggleLayer(id); }} aria-label="Expand layer"><Twirl open={!!ctl.persist.expanded[id]} /></button>
      <span className="tl-chip" style={{ background: `var(--lt-${l.type})` }} title={LAYER_DEFS[l.type].label} />
      <span className="tl-name strong">{l.name}</span>
      <span className="tl-flags">
        <button className={`tl-ico${l.solo ? ' solo' : ' idle'}`} onPointerDown={flag('solo')} aria-label="Solo">S</button>
        <button className={`tl-ico${l.locked ? ' lit' : ' idle'}`} onPointerDown={flag('locked')} aria-label="Lock">{l.locked ? <Lock /> : <Unlock />}</button>
        <button className={`tl-ico${l.visible ? '' : ' dim'}`} onPointerDown={flag('visible')} aria-label="Visible">{l.visible ? <Eye /> : <EyeOff />}</button>
      </span>
    </Shell>
  );
}

function PropRowView({ row, ctl, graph }: { row: PropRow; ctl: Ctl; graph: boolean }) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLButtonElement>(null);
  const layerId = row.layer.id, key = row.key;
  const animated = row.track.keys.length > 0;
  const isColor = row.def.kind === 'color';
  useLayoutEffect(() => ctl.registerValue(row, valueRef.current, dotRef.current), [ctl, row.id, graph]);
  const hidden = ctl.graph.hidden.has(row.id);
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  const jump = (dir: -1 | 1) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const t = transport().time;
    const ks = editor().project.layers.find((l) => l.id === layerId)?.props[key].keys ?? [];
    const k = dir < 0 ? [...ks].reverse().find((q) => q.t < t - 1e-4) : ks.find((q) => q.t > t + 1e-4);
    if (k) ctl.seek(k.t);
  };

  const onValueDown = (e: RPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || isColor) return;
    const tr = editor().project.layers.find((l) => l.id === layerId)?.props[key];
    if (!tr) return;
    const x0 = e.clientX;
    const v0 = evalTrack({ ...tr, wiggle: undefined, audio: undefined }, transport().time);
    if (typeof v0 !== 'number') return;
    const step = row.def.step ?? 0.01;
    ctl.startDrag(e.nativeEvent, e.currentTarget, {
      history: true,
      move: (_x, _y, m, ev) => {
        const speed = m.shift ? 10 : m.ctrl ? 0.1 : 1;
        editor().setProp(layerId, key, v0 + (ev.clientX - x0) * step * speed, { noHistory: true });
      },
    });
  };

  const onLabelDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (graph) editor().setUI({ graphProp: { layer: layerId, key } });
    const tr = editor().project.layers.find((l) => l.id === layerId)?.props[key];
    setSel({ keys: tr?.keys.map((k) => k.id) ?? [], layers: graph ? editor().sel.layers : [layerId], hits: [], clips: [] });
  };

  if (graph) {
    return (
      <Shell row={row} className="prop graph" onPointerDown={onLabelDown}>
        <button className={`tl-check${hidden ? '' : ' on'}`} style={{ '--c': row.color } as CSSProperties} aria-label="Show curve"
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button !== 0) return;
            if (hidden) ctl.graph.hidden.delete(row.id); else ctl.graph.hidden.add(row.id);
            ctl.updatePersist(() => {});
          }} />
        <span className="tl-name">{row.def.label}</span>
        <span ref={valueRef} className="tl-value" onPointerDown={onValueDown} />
      </Shell>
    );
  }

  return (
    <Shell row={row} className="prop" onPointerDown={onLabelDown}>
      <button className={`tl-ico watch${animated ? ' lit' : ''}`} aria-label="Toggle animation" onPointerDown={(e) => { stop(e); if (e.button === 0) editor().toggleAnimated(layerId, key); }}><Stopwatch /></button>
      <span className="tl-name">{row.def.label}</span>
      {row.track.wiggle && <span className="tl-mod" title="Wiggle"><Wiggle /></span>}
      {row.track.audio && <span className="tl-mod audio" title="Audio link"><Wave /></span>}
      <span ref={valueRef} className={isColor ? 'tl-swatch' : 'tl-value'} onPointerDown={onValueDown} />
      <span className="tl-keynav">
        <button className="tl-ico nav" disabled={!animated} onPointerDown={jump(-1)} aria-label="Previous key"><Prev /></button>
        <button ref={dotRef} className="tl-ico keydot" aria-label="Add key at playhead" onPointerDown={(e) => { stop(e); if (e.button === 0) editor().addKeyAtPlayhead(layerId, key); }}><Diamond /></button>
        <button className="tl-ico nav" disabled={!animated} onPointerDown={jump(1)} aria-label="Next key"><Next /></button>
      </span>
    </Shell>
  );
}
