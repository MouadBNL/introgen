import { memo, useEffect, useRef, useState } from 'react';
import type { Layer, LayerType } from '../../core/types';
import { editor, useEditor } from '../../core/store';
import { LAYER_DEFS, LAYER_ORDER, type LayerDef } from '../../core/schema';
import { Icon, LayerIcon } from '../icons';
import { IconBtn } from '../controls';
import { Popover, type MenuItem } from '../popover';
import { openContextMenu, useShell } from '../shell';
import { selectAllKeys, trimLayers } from '../actions';

const CATEGORIES: LayerDef['category'][] = ['Type', 'Generators', 'Light', 'Scene'];

function AddLayerPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const add = (t: LayerType) => { editor().addLayer(t); onClose(); };
  const all: LayerType[] = [...LAYER_ORDER, 'post'];
  return (
    <Popover anchor={anchor} onClose={onClose} className="pop-add">
      {CATEGORIES.map((c) => (
        <div key={c}>
          <div className="menu-header">{c}</div>
          {all.filter((t) => LAYER_DEFS[t].category === c).map((t) => (
            <button key={t} type="button" className="add-item" onClick={() => add(t)}>
              <LayerIcon type={t} />
              <span className="add-text"><b>{LAYER_DEFS[t].label}</b><small>{LAYER_DEFS[t].blurb}</small></span>
            </button>
          ))}
        </div>
      ))}
    </Popover>
  );
}

function wouldCycle(layers: Layer[], child: string, parent: string): boolean {
  let cur: string | null = parent;
  for (let i = 0; cur && i < 256; i++) {
    if (cur === child) return true;
    cur = layers.find((l) => l.id === cur)?.parent ?? null;
  }
  return false;
}

function layerMenu(l: Layer): MenuItem[] {
  const e = editor();
  const ids = e.sel.layers.includes(l.id) ? e.sel.layers : [l.id];
  const layers = e.project.layers;
  const singleton = !!LAYER_DEFS[l.type].singleton;
  const candidates = layers.filter((c) => !ids.includes(c.id) && LAYER_DEFS[c.type].spatial && !ids.some((id) => wouldCycle(layers, id, c.id)));
  const setParent = (parent: string | null) => e.commit('Parent', (p) => { for (const x of p.layers) if (ids.includes(x.id)) x.parent = parent; });
  return [
    { label: 'Rename', hint: 'Dbl-click', onClick: () => useShell.setState({ renaming: l.id }) },
    { label: 'Duplicate', hint: 'Ctrl D', disabled: singleton, onClick: () => e.duplicateLayers(ids) },
    { label: 'Delete', hint: 'Del', danger: true, disabled: singleton, onClick: () => e.removeLayers(ids) },
    { sep: true },
    { label: 'Parent to', icon: 'link', disabled: !LAYER_DEFS[l.type].spatial, items: [
      { label: 'None', checked: !l.parent, onClick: () => setParent(null) },
      ...(candidates.length ? [{ sep: true } as MenuItem] : []),
      ...candidates.map((c): MenuItem => ({ label: c.name, checked: l.parent === c.id, onClick: () => setParent(c.id) })),
    ] },
    { sep: true },
    { label: 'Trim In to Playhead', onClick: () => trimLayers(ids, 'in') },
    { label: 'Trim Out to Playhead', onClick: () => trimLayers(ids, 'out') },
    { sep: true },
    { label: 'Select All Keys', onClick: () => selectAllKeys(ids) },
  ];
}

function RenameInput({ layer }: { layer: Layer }) {
  const ref = useRef<HTMLInputElement>(null);
  const cancel = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input ref={ref} className="layer-rename" defaultValue={layer.name} spellCheck={false} aria-label="Layer name"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur(); }
      }}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (!cancel.current && v && v !== layer.name) editor().updateLayer(layer.id, { name: v });
        useShell.setState({ renaming: null });
      }} />
  );
}

const LayerRow = memo(function LayerRow({ layer, index, selected, renaming, parentName, onRowDown }: {
  layer: Layer; index: number; selected: boolean; renaming: boolean; parentName?: string;
  onRowDown: (e: React.PointerEvent, l: Layer, index: number) => void;
}) {
  const set = (patch: Partial<Layer>) => (e: React.MouseEvent) => { e.stopPropagation(); editor().updateLayer(layer.id, patch); };
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className={`layer-row${selected ? ' selected' : ''}${layer.visible ? '' : ' hidden-layer'}${layer.locked ? ' locked' : ''}`} data-layer={layer.id} role="option" aria-selected={selected}
      onPointerDown={(e) => onRowDown(e, layer, index)}
      onDoubleClick={() => useShell.setState({ renaming: layer.id })}
      onContextMenu={(e) => {
        const ed = editor();
        if (!ed.sel.layers.includes(layer.id)) ed.select({ layers: [layer.id] });
        openContextMenu(e, layerMenu(layer));
      }}>
      <span className="layer-label" style={{ background: `var(--lt-${layer.type})` }} />
      <span className="layer-idx">{index + 1}</span>
      <LayerIcon type={layer.type} colored={false} />
      {renaming ? <RenameInput layer={layer} /> : <span className="layer-name">{layer.name}</span>}
      {parentName && <span className="layer-parent" title={`Parented to ${parentName}`}><Icon name="link" size={11} /></span>}
      <span className="layer-sw" onPointerDown={stop} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className={`sw${layer.solo ? ' on-solo' : ''}`} title="Solo" aria-pressed={layer.solo} onClick={set({ solo: !layer.solo })}><Icon name="solo" size={12} /></button>
        <button type="button" className={`sw${layer.locked ? ' on-lock' : ''}`} title="Lock" aria-pressed={layer.locked} onClick={set({ locked: !layer.locked })}><Icon name={layer.locked ? 'lock' : 'unlock'} size={12} /></button>
        <button type="button" className={`sw${layer.visible ? '' : ' off'}`} title="Visible" aria-pressed={layer.visible} onClick={set({ visible: !layer.visible })}><Icon name={layer.visible ? 'eye' : 'eyeOff'} size={12} /></button>
      </span>
    </div>
  );
});

export function LayersPanel() {
  const layers = useEditor((s) => s.project.layers);
  const selected = useEditor((s) => s.sel.layers);
  const renaming = useShell((s) => s.renaming);
  const [addEl, setAddEl] = useState<HTMLElement | null>(null);
  const [gap, setGap] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);

  const gapAt = (y: number): number => {
    const rows = list.current?.querySelectorAll<HTMLElement>('.layer-row');
    if (!rows) return 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return rows.length;
  };

  const drop = (ids: string[], g: number) => {
    const e = editor();
    const all = e.project.layers;
    if (ids.length === 1) {
      const from = all.findIndex((l) => l.id === ids[0]);
      const to = from < g ? g - 1 : g;
      if (to !== from) e.moveLayer(ids[0], to);
      return;
    }
    e.commit('Reorder layers', (p) => {
      const moving = p.layers.filter((l) => ids.includes(l.id));
      const before = p.layers.slice(0, g).filter((l) => !ids.includes(l.id));
      const after = p.layers.slice(g).filter((l) => !ids.includes(l.id));
      p.layers = [...before, ...moving, ...after];
    });
  };

  const onRowDown = (ev: React.PointerEvent, l: Layer, index: number) => {
    if (ev.button !== 0) return;
    const e = editor();
    const cur = e.sel.layers;
    const wasSelected = cur.includes(l.id);
    if (ev.shiftKey && anchor.current) {
      const ids = e.project.layers.map((x) => x.id);
      const a = ids.indexOf(anchor.current);
      const [lo, hi] = a < index ? [a, index] : [index, a];
      e.select({ layers: ids.slice(lo, hi + 1) });
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      e.select({ layers: [l.id] }, true);
      anchor.current = l.id;
      return;
    }
    if (!wasSelected) e.select({ layers: [l.id] });
    anchor.current = l.id;

    // Past a small threshold, the press becomes a reorder.
    const y0 = ev.clientY;
    let dragging = false;
    let g = 0;
    const move = (m: PointerEvent) => {
      if (!dragging && Math.abs(m.clientY - y0) < 4) return;
      dragging = true;
      document.body.classList.add('dragging-row');
      g = gapAt(m.clientY);
      setGap(g);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.body.classList.remove('dragging-row');
      setGap(null);
      if (dragging) {
        const order = editor().project.layers.map((x) => x.id);
        const sel = editor().sel.layers;
        drop(order.filter((id) => sel.includes(id)), g);
      } else if (wasSelected && cur.length > 1) e.select({ layers: [l.id] });
    };
    const cancel = () => { dragging = false; up(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  return (
    <div className="panel-fill">
      <div className="panel-toolbar">
        <span className="panel-title">{layers.length} {layers.length === 1 ? 'layer' : 'layers'}</span>
        <span className="grow" />
        <IconBtn icon="trash" title="Delete selected layers" disabled={!selected.length} onClick={() => editor().removeLayers(selected)} />
        <IconBtn icon="plus" title="Add layer" active={!!addEl} onClick={(e) => { const t = e.currentTarget; setAddEl((v) => (v ? null : t)); }} />
      </div>
      <div className="layer-list scroll" ref={list} role="listbox" aria-multiselectable="true"
        onPointerDown={(e) => { if (e.target === e.currentTarget) editor().clearSelection(); }}>
        {layers.map((l, i) => (
          <div key={l.id} className="layer-slot">
            {gap === i && <div className="drop-line" />}
            <LayerRow layer={l} index={i} selected={selected.includes(l.id)} renaming={renaming === l.id}
              parentName={l.parent ? layers.find((x) => x.id === l.parent)?.name : undefined} onRowDown={onRowDown} />
          </div>
        ))}
        {gap === layers.length && <div className="drop-line" />}
        {!layers.length && <div className="empty">No layers yet. Press + to add one.</div>}
      </div>
      {addEl && <AddLayerPopover anchor={addEl} onClose={() => setAddEl(null)} />}
    </div>
  );
}
