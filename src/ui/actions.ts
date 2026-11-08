/** Commands shared by menus, shortcuts and panels. */
import type { AudioSource, Asset, HitKind, Project } from '../core/types';
import { editor, emptyProject, transport } from '../core/store';
import { playback } from '../core/playback';
import { HIT_DEF } from '../core/schema';
import { formatTimecode } from '../core/eval';
import { uid } from '../core/rng';
import { snapshotPNG } from '../render/export';
import { downloadBlob, safeFileName } from './files';
import { openProjectFile, saveProjectFile } from './persist';
import { confirmAction } from './shell';

export interface TemplateInfo { id: string; name: string; blurb: string; create: () => Project }

// Globbed so a missing demo module cannot break the build.
const demoMods = import.meta.glob('../demo/*.ts');

export async function loadDemoProject(): Promise<Project | null> {
  const load = demoMods['../demo/demo.ts'];
  if (!load) return null;
  try {
    const m = (await load()) as { createDemoProject: () => Project };
    return m.createDemoProject();
  } catch (err) {
    console.warn('[introgen] demo unavailable', err);
    return null;
  }
}

export async function loadTemplates(): Promise<TemplateInfo[]> {
  const load = demoMods['../demo/templates.ts'];
  if (!load) return [];
  try {
    const m = (await load()) as { TEMPLATES: TemplateInfo[] };
    return m.TEMPLATES ?? [];
  } catch (err) {
    console.warn('[introgen] templates unavailable', err);
    return [];
  }
}

/** Runs several recording actions as one undo step. */
export function batch(fn: () => void) {
  const e = editor();
  e.beginDrag();
  try { fn(); } finally { e.endDrag(); }
}

const replaceWarn = 'This replaces the open project. Save it first if you want to keep it.';

async function replaceProject(p: Project | null, title: string) {
  if (!p) return;
  if (!(await confirmAction(title, replaceWarn, 'Replace project'))) return;
  playback.pause();
  editor().loadProject(p);
  playback.seek(0);
}

export const newProject = () => replaceProject(emptyProject(), 'New project?');
export async function newFromDemo() {
  const p = await loadDemoProject();
  if (!p) { editor().toast('Demo project is not available'); return; }
  await replaceProject(p, 'Open the demo project?');
}
export const applyTemplate = (t: TemplateInfo) => replaceProject(t.create(), `Start from "${t.name}"?`);

export async function openProject() {
  const p = await openProjectFile();
  if (!p) return;
  playback.pause();
  editor().loadProject(p);
  playback.seek(0);
  editor().toast(`Opened ${p.name}`);
}

export const saveProject = () => saveProjectFile();

export async function saveFramePNG() {
  const { project, toast } = editor();
  const t = transport().time;
  try {
    const blob = await snapshotPNG(project, t);
    const name = `${safeFileName(project.name)}_${formatTimecode(t, project.fps).replace(/:/g, '-')}.png`;
    downloadBlob(blob, name);
    toast(`Saved ${name}`);
  } catch (err) {
    console.error(err);
    toast('Could not capture this frame');
  }
}

/** Sync hit at the playhead. Snaps when parked, keeps raw time while playing so people can tap along. */
export function stampTime(): number {
  const { time, playing } = transport();
  return playing ? time : editor().snapTime(time);
}

export function stampHit(kind: HitKind) {
  const e = editor();
  const t = stampTime();
  e.addHit(kind, t);
  e.toast(`${HIT_DEF[kind].label} at ${formatTimecode(t, e.project.fps)}`);
}

export function stampHits(kinds: { kind: HitKind; amount?: number }[], label: string) {
  const e = editor();
  const t = stampTime();
  e.commit(label, (p) => {
    for (const { kind, amount = 1 } of kinds) p.hits.push({ id: uid('h'), t, kind, amount, dur: HIT_DEF[kind].dur });
    p.hits.sort((a, b) => a.t - b.t);
  });
  e.toast(`${label} at ${formatTimecode(t, e.project.fps)}`);
}

export function trimLayers(ids: string[], edge: 'in' | 'out') {
  const e = editor();
  const t = transport().time;
  e.commit(edge === 'in' ? 'Trim in' : 'Trim out', (p) => {
    for (const l of p.layers) {
      if (!ids.includes(l.id) || l.locked) continue;
      if (edge === 'in' && t < l.end) l.start = t;
      if (edge === 'out' && t > l.start) l.end = t;
    }
  });
}

export function selectAllKeys(ids: string[]) {
  const e = editor();
  const keys: string[] = [];
  for (const l of e.project.layers) {
    if (!ids.includes(l.id)) continue;
    for (const k in l.props) for (const kf of l.props[k].keys) keys.push(kf.id);
  }
  e.select({ layers: ids, keys });
}

export function selectAllLayers() {
  const e = editor();
  e.select({ layers: e.project.layers.map((l) => l.id) });
}

/** Lowest audio lane from `from` up with no clip overlapping [t, t + dur). */
export function firstFreeLane(p: Project, t: number, dur: number, from = 1): number {
  for (let lane = from; ; lane++) {
    if (!p.clips.some((c) => c.lane === lane && c.t < t + dur && c.t + c.dur > t)) return lane;
  }
}

export function addClipAt(source: AudioSource, name: string, dur: number, t: number, gain = 0.85): string {
  const e = editor();
  const id = e.addClip({ name, source, lane: firstFreeLane(e.project, t, dur), t, offset: 0, dur, gain, fadeIn: 0, fadeOut: 0, muted: false });
  e.select({ clips: [id] });
  return id;
}

/** Drops an asset, and anything that pointed at it. */
export function removeAsset(a: Asset) {
  editor().commit('Remove asset', (p) => {
    p.assets = p.assets.filter((x) => x.id !== a.id);
    p.clips = p.clips.filter((c) => !(c.source.kind === 'asset' && c.source.assetId === a.id));
    for (const l of p.layers) if (l.settings.asset === a.id) l.settings.asset = '';
  });
}
