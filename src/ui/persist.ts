/** Autosave to IndexedDB and .intro project files. */
import type { Project } from '../core/types';
import { useEditor } from '../core/store';
import { downloadBlob, pickFile, safeFileName } from './files';

const DB = 'introgen';
const STORE = 'kv';
const KEY = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function put(key: string, value: unknown) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const out = await new Promise<T | undefined>((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return out;
}

export function validateProject(o: unknown): o is Project {
  const p = o as Project | null;
  return !!p && typeof p === 'object' && p.version === 1 && typeof p.name === 'string'
    && Array.isArray(p.layers) && Array.isArray(p.hits) && Array.isArray(p.clips) && Array.isArray(p.markers) && Array.isArray(p.assets)
    && typeof p.fps === 'number' && typeof p.duration === 'number' && !!p.music;
}

export async function loadAutosave(): Promise<Project | null> {
  try {
    const json = await get<string>(KEY);
    if (!json) return null;
    const p = JSON.parse(json);
    return validateProject(p) ? p : null;
  } catch (err) {
    console.warn('[introgen] autosave unreadable', err);
    return null;
  }
}

export function saveAutosaveNow(): Promise<void> {
  return put(KEY, JSON.stringify(useEditor.getState().project));
}

/** Debounced 1.5 s after the last project change. Returns the unsubscribe. */
export function startAutosave(): () => void {
  let timer = 0;
  const unsub = useEditor.subscribe((s, prev) => {
    if (s.rev === prev.rev) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      saveAutosaveNow().catch((err) => console.warn('[introgen] autosave failed', err));
    }, 1500);
  });
  return () => { window.clearTimeout(timer); unsub(); };
}

export function saveProjectFile() {
  const { project, toast } = useEditor.getState();
  downloadBlob(new Blob([JSON.stringify(project)], { type: 'application/json' }), `${safeFileName(project.name)}.intro`);
  toast(`Saved ${project.name}.intro`);
}

export async function openProjectFile(): Promise<Project | null> {
  const { toast } = useEditor.getState();
  const file = await pickFile('.intro,application/json');
  if (!file) return null;
  try {
    const p = JSON.parse(await file.text());
    if ((p as Project)?.version !== 1) { toast('Unsupported project version'); return null; }
    if (!validateProject(p)) { toast('Not a valid .intro file'); return null; }
    return p;
  } catch {
    toast('Could not read that file');
    return null;
  }
}
