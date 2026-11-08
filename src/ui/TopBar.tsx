import { useRef, useState } from 'react';
import { useEditor, editor, type PreviewQuality } from '../core/store';
import { LAYER_DEFS, LAYER_ORDER } from '../core/schema';
import { playback } from '../core/playback';
import { LogoMark, LogoWordmark } from './Logo';
import { Btn, IconBtn, Select, Seg, TextField } from './controls';
import { MenuList, Popover, type MenuItem } from './popover';
import { newFromDemo, newProject, openProject, saveFramePNG, saveProject, selectAllKeys, selectAllLayers, trimLayers } from './actions';
import { resetLayout } from './layout';
import { useShell } from './shell';

const QUALITY: { value: PreviewQuality; label: string }[] = [
  { value: 'draft', label: 'Draft' }, { value: 'half', label: 'Half' }, { value: 'full', label: 'Full' },
];

function buildMenus(): { id: string; label: string; items: MenuItem[] }[] {
  const e = editor();
  const { sel, ui } = e;
  const hasLayers = sel.layers.length > 0;
  const cats = ['Type', 'Generators', 'Light', 'Scene'] as const;
  const addItems: MenuItem[] = cats.flatMap((c, i) => [
    ...(i ? [{ sep: true } as MenuItem] : []),
    ...LAYER_ORDER.filter((t) => LAYER_DEFS[t].category === c).map((t): MenuItem => ({ label: LAYER_DEFS[t].label, icon: t, onClick: () => e.addLayer(t) })),
  ]);
  return [
    { id: 'file', label: 'File', items: [
      { label: 'New Project', onClick: newProject },
      { label: 'New from Demo', onClick: newFromDemo },
      { label: 'Open…', icon: 'folder', onClick: openProject },
      { sep: true },
      { label: 'Save Project File', hint: 'Ctrl S', icon: 'download', onClick: saveProject },
      { sep: true },
      { label: 'Save Frame as PNG', icon: 'image', onClick: saveFramePNG },
      { label: 'Export Video…', hint: 'Ctrl E', icon: 'film', onClick: () => { playback.pause(); e.setUI({ exportOpen: true }); } },
    ] },
    { id: 'edit', label: 'Edit', items: [
      { label: 'Undo', hint: 'Ctrl Z', disabled: !e.past.length, onClick: e.undo },
      { label: 'Redo', hint: 'Ctrl Shift Z', disabled: !e.future.length, onClick: e.redo },
      { sep: true },
      { label: 'Copy Keyframes', hint: 'Ctrl C', disabled: !sel.keys.length, onClick: e.copyKeys },
      { label: 'Paste Keyframes', hint: 'Ctrl V', onClick: e.pasteKeys },
      { sep: true },
      { label: 'Duplicate', hint: 'Ctrl D', disabled: !hasLayers, onClick: () => e.duplicateLayers(sel.layers) },
      { label: 'Delete', hint: 'Del', onClick: e.removeSelected },
      { sep: true },
      { label: 'Select All Layers', hint: 'Ctrl A', onClick: selectAllLayers },
      { label: 'Deselect All', hint: 'Esc', onClick: e.clearSelection },
    ] },
    { id: 'layer', label: 'Layer', items: [
      { label: 'Add Layer', icon: 'plus', items: addItems },
      { sep: true },
      { label: 'Duplicate', hint: 'Ctrl D', disabled: !hasLayers, onClick: () => e.duplicateLayers(sel.layers) },
      { label: 'Delete', disabled: !hasLayers, onClick: () => e.removeLayers(sel.layers) },
      { sep: true },
      { label: 'Trim In to Playhead', disabled: !hasLayers, onClick: () => trimLayers(sel.layers, 'in') },
      { label: 'Trim Out to Playhead', disabled: !hasLayers, onClick: () => trimLayers(sel.layers, 'out') },
      { label: 'Select All Keys', disabled: !hasLayers, onClick: () => selectAllKeys(sel.layers) },
    ] },
    { id: 'view', label: 'View', items: [
      { label: 'Preview Quality', items: QUALITY.map((q) => ({ label: q.label, checked: ui.quality === q.value, onClick: () => e.setUI({ quality: q.value }) })) },
      { sep: true },
      { label: 'Camera View', checked: ui.view === 'camera', onClick: () => e.setUI({ view: 'camera' }) },
      { label: 'Free View', checked: ui.view === 'free', onClick: () => e.setUI({ view: 'free' }) },
      { sep: true },
      { label: 'Safe Areas', checked: ui.safeAreas, onClick: () => e.setUI({ safeAreas: !ui.safeAreas }) },
      { label: 'Transform Gizmo', checked: ui.showGizmo, onClick: () => e.setUI({ showGizmo: !ui.showGizmo }) },
      { sep: true },
      { label: 'Snap to Beats', hint: 'B', checked: ui.snapBeats, onClick: () => e.setUI({ snapBeats: !ui.snapBeats }) },
      { label: 'Graph Editor', hint: 'G', checked: ui.timelineMode === 'graph', onClick: () => e.setUI({ timelineMode: ui.timelineMode === 'graph' ? 'dope' : 'graph' }) },
      { sep: true },
      { label: 'Reset Panel Layout', onClick: resetLayout },
    ] },
    { id: 'help', label: 'Help', items: [
      { label: 'Keyboard Shortcuts', hint: '?', onClick: () => e.setUI({ shortcutsOpen: true }) },
      { label: 'About Introgen', icon: 'info', onClick: () => useShell.setState({ aboutOpen: true }) },
    ] },
  ];
}

function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const titles = useRef<Record<string, HTMLButtonElement | null>>({});
  const menus = buildMenus();
  const cur = menus.find((m) => m.id === open);

  return (
    <div className="menubar" ref={bar} role="menubar">
      {menus.map((m) => (
        <button key={m.id} type="button" ref={(el) => { titles.current[m.id] = el; }} className={`menubar-item${open === m.id ? ' open' : ''}`} aria-haspopup="menu" aria-expanded={open === m.id}
          onPointerDown={(e) => { e.preventDefault(); setOpen(open === m.id ? null : m.id); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setOpen(m.id); } }}
          onPointerEnter={() => { if (open) setOpen(m.id); }}>
          {m.label}
        </button>
      ))}
      {cur && (
        <Popover key={cur.id} anchor={titles.current[cur.id] ?? null} ignore={bar.current} onClose={() => setOpen(null)} className="pop-menu">
          <MenuList items={cur.items} onDone={() => setOpen(null)} onCross={(d) => {
            const i = menus.findIndex((m) => m.id === cur.id);
            setOpen(menus[(i + d + menus.length) % menus.length].id);
          }} />
        </Popover>
      )}
    </div>
  );
}

function ProjectName() {
  const name = useEditor((s) => s.project.name);
  const set = useEditor((s) => s.setProjectMeta);
  return <TextField className="project-name" value={name} onChange={(v) => set({ name: v })} ariaLabel="Project name" />;
}

export function TopBar() {
  const quality = useEditor((s) => s.ui.quality);
  const view = useEditor((s) => s.ui.view);
  const safe = useEditor((s) => s.ui.safeAreas);
  const setUI = useEditor((s) => s.setUI);
  return (
    <header className="topbar">
      <div className="brand"><LogoMark size={20} /><LogoWordmark size={13} /></div>
      <MenuBar />
      <span className="vsep" />
      <ProjectName />
      <span className="grow" />
      <span className="top-label">Preview</span>
      <Select value={quality} options={QUALITY} onChange={(v) => setUI({ quality: v })} title="Preview quality" className="w-quality" />
      <Seg value={view} onChange={(v) => setUI({ view: v })} options={[
        { value: 'camera', label: 'Camera', icon: 'camera', title: 'Look through the active camera' },
        { value: 'free', label: 'Free', icon: 'cube', title: 'Free orbit view' },
      ]} />
      <IconBtn icon="safe" title="Safe areas" active={safe} onClick={() => setUI({ safeAreas: !safe })} />
      <span className="vsep" />
      <Btn primary icon="film" title="Export video (Ctrl E)" onClick={() => { playback.pause(); setUI({ exportOpen: true }); }}>Export</Btn>
    </header>
  );
}
