/** Chrome-only state that does not belong in the project store: dialogs, context menu, inline rename. */
import { create } from 'zustand';
import type { MenuItem } from './popover';

interface ConfirmReq { title: string; body: string; ok: string; resolve: (v: boolean) => void }

interface ShellState {
  aboutOpen: boolean;
  confirm: ConfirmReq | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  renaming: string | null;
}

export const useShell = create<ShellState>(() => ({ aboutOpen: false, confirm: null, menu: null, renaming: null }));

export function confirmAction(title: string, body: string, ok = 'Continue'): Promise<boolean> {
  return new Promise((resolve) => useShell.setState({ confirm: { title, body, ok, resolve } }));
}

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]) {
  e.preventDefault();
  useShell.setState({ menu: { x: e.clientX, y: e.clientY, items } });
}

/** Tiny localStorage wrapper: storage can be blocked, and chrome must still work. */
export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch { return fallback; }
}
export function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
