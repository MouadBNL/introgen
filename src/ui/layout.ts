/** Panel sizes live in CSS variables so a splitter drag never re-renders the panels. */
import { lsGet, lsSet } from './shell';

export type PanelKey = 'left' | 'right' | 'timeline';
const VAR: Record<PanelKey, string> = { left: '--left-w', right: '--right-w', timeline: '--tl-h' };
export const DEFAULTS: Record<PanelKey, number> = { left: 270, right: 300, timeline: 320 };
export const LIMITS: Record<PanelKey, [number, number]> = { left: [200, 520], right: [250, 560], timeline: [140, 720] };
const KEY = 'introgen.layout';

const sizes: Record<PanelKey, number> = { ...DEFAULTS, ...lsGet<Partial<Record<PanelKey, number>>>(KEY, {}) };

export const getSize = (k: PanelKey) => sizes[k];

export function setSize(k: PanelKey, px: number) {
  const [lo, hi] = LIMITS[k];
  sizes[k] = Math.round(Math.max(lo, Math.min(hi, px)));
  document.documentElement.style.setProperty(VAR[k], `${sizes[k]}px`);
}

export const persistLayout = () => lsSet(KEY, sizes);

export function applyLayout() {
  (Object.keys(sizes) as PanelKey[]).forEach((k) => setSize(k, sizes[k]));
}

export function resetLayout() {
  (Object.keys(DEFAULTS) as PanelKey[]).forEach((k) => setSize(k, DEFAULTS[k]));
  persistLayout();
}
