/** Global keyboard map. Ignored while typing and while a dialog is up. */
import { editor } from '../core/store';
import { playback } from '../core/playback';
import { HIT_DEFS } from '../core/schema';
import { saveProject, selectAllLayers, stampHit, stampTime } from './actions';
import { anyPopoverOpen } from './popover';
import { useShell } from './shell';

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  { group: 'Transport', items: [['Space', 'Play / pause'], ['← / →', 'Step one frame'], ['Shift + ← / →', 'Step ten frames'], ['Home / End', 'Go to start / end']] },
  { group: 'Edit', items: [['Ctrl Z', 'Undo'], ['Ctrl Shift Z', 'Redo'], ['Delete', 'Remove selection'], ['Ctrl D', 'Duplicate layers'], ['Ctrl C / V', 'Copy / paste keyframes'], ['Ctrl A', 'Select all layers']] },
  { group: 'Timeline', items: [['M', 'Add marker'], ['B', 'Toggle beat snap'], ['G', 'Toggle dope sheet / graph']] },
  { group: 'Sync hits', items: HIT_DEFS.map((h) => [h.key, h.label] as [string, string]) },
  { group: 'File', items: [['Ctrl S', 'Save project file'], ['Ctrl E', 'Export video'], ['?', 'This list']] },
];

function typing(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  if (n.isContentEditable || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT') return true;
  if (n.tagName === 'INPUT') return !['checkbox', 'radio', 'range', 'button', 'color'].includes((n as HTMLInputElement).type);
  return false;
}

function modalOpen(): boolean {
  const { ui } = editor();
  const sh = useShell.getState();
  return ui.exportOpen || ui.shortcutsOpen || sh.aboutOpen || !!sh.confirm;
}

function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || typing(e.target) || modalOpen() || anyPopoverOpen()) return;
  const ed = editor();
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const done = () => e.preventDefault();

  if (mod) {
    switch (key) {
      case 'z': done(); e.shiftKey ? ed.redo() : ed.undo(); return;
      case 'y': done(); ed.redo(); return;
      case 'd': done(); if (ed.sel.layers.length) ed.duplicateLayers(ed.sel.layers); return;
      case 'c': if (ed.sel.keys.length) { done(); ed.copyKeys(); } return;
      case 'v': done(); ed.pasteKeys(); return;
      case 's': done(); saveProject(); return;
      case 'e': done(); playback.pause(); ed.setUI({ exportOpen: true }); return;
      case 'a': done(); selectAllLayers(); return;
    }
    return;
  }
  if (e.altKey) return;

  switch (e.key) {
    case ' ':
      done();
      // A focused button would also click on keyup.
      if ((document.activeElement as HTMLElement | null)?.tagName === 'BUTTON') (document.activeElement as HTMLElement).blur();
      playback.toggle();
      return;
    case 'ArrowLeft': done(); playback.step(e.shiftKey ? -10 : -1); return;
    case 'ArrowRight': done(); playback.step(e.shiftKey ? 10 : 1); return;
    case 'Home': done(); playback.seek(0); return;
    case 'End': done(); playback.seek(ed.project.duration); return;
    case 'Delete': case 'Backspace': done(); ed.removeSelected(); return;
    case 'Escape': ed.clearSelection(); return;
    case '?': done(); ed.setUI({ shortcutsOpen: true }); return;
  }
  if (e.shiftKey) return;
  switch (key) {
    case 'm': done(); ed.addMarker(stampTime()); return;
    case 'b':
      done();
      ed.setUI({ snapBeats: !ed.ui.snapBeats });
      ed.toast(`Beat snap ${ed.ui.snapBeats ? 'off' : 'on'}`);
      return;
    case 'g': done(); ed.setUI({ timelineMode: ed.ui.timelineMode === 'dope' ? 'graph' : 'dope' }); return;
  }
  const hit = HIT_DEFS.find((h) => h.key === e.key);
  if (hit && !e.repeat) { done(); stampHit(hit.kind); }
}

/**
 * Ends text editing before anything else sees the press. Drags on canvases and scrubbers cancel the
 * default focus change, which would leave shortcuts dead and a text undo session open under the drag.
 */
function onPress(e: PointerEvent) {
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== e.target && typing(a)) a.blur();
}

export function installShortcuts(): () => void {
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onPress, true);
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerdown', onPress, true);
  };
}

