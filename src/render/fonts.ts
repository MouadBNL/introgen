import opentype from 'opentype.js';
import * as THREE from 'three';
import type { Asset } from '../core/types';
import blackOps from '@fontsource/black-ops-one/files/black-ops-one-latin-400-normal.woff?url';
import russo from '@fontsource/russo-one/files/russo-one-latin-400-normal.woff?url';
import orbitron from '@fontsource/orbitron/files/orbitron-latin-900-normal.woff?url';
import bungee from '@fontsource/bungee/files/bungee-latin-400-normal.woff?url';
import anton from '@fontsource/anton/files/anton-latin-400-normal.woff?url';
import audiowide from '@fontsource/audiowide/files/audiowide-latin-400-normal.woff?url';
import michroma from '@fontsource/michroma/files/michroma-latin-400-normal.woff?url';
import saira from '@fontsource/saira-stencil-one/files/saira-stencil-one-latin-400-normal.woff?url';

const URLS: Record<string, string> = {
  'Black Ops One': blackOps, 'Russo One': russo, Orbitron: orbitron, Bungee: bungee, Anton: anton,
  Audiowide: audiowide, Michroma: michroma, 'Saira Stencil One': saira,
};

const cache = new Map<string, opentype.Font>();
const pending = new Map<string, Promise<opentype.Font | null>>();

function dataUrlToBuffer(url: string): ArrayBuffer {
  const b = atob(url.slice(url.indexOf(',') + 1));
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a.buffer;
}

export function fontCssName(name: string) {
  return `IG ${name}`;
}

/** Loads for both 3D outlines (opentype) and 2D canvas text (FontFace). */
export function loadFont(name: string, assets: Asset[] = []): Promise<opentype.Font | null> {
  const hit = cache.get(name);
  if (hit) return Promise.resolve(hit);
  const inFlight = pending.get(name);
  if (inFlight) return inFlight;
  const asset = assets.find((a) => a.kind === 'font' && a.name === name);
  const url = asset?.dataUrl ?? URLS[name] ?? URLS['Black Ops One'];
  const job = (async () => {
    try {
      const buf = url.startsWith('data:') ? dataUrlToBuffer(url) : await (await fetch(url)).arrayBuffer();
      const font = opentype.parse(buf);
      cache.set(name, font);
      const face = new FontFace(fontCssName(name), buf.slice(0));
      await face.load();
      document.fonts.add(face);
      return font;
    } catch (e) {
      console.warn('font load failed', name, e);
      return null;
    } finally {
      pending.delete(name);
    }
  })();
  pending.set(name, job);
  return job;
}

export function getFont(name: string): opentype.Font | null {
  return cache.get(name) ?? null;
}

/** Converts an opentype path to shapes; three nests holes geometrically, so winding does not matter. */
export function pathToShapes(path: opentype.Path, scale: number): THREE.Shape[] {
  const sp = new THREE.ShapePath();
  for (const c of path.commands as any[]) {
    switch (c.type) {
      case 'M': sp.moveTo(c.x * scale, -c.y * scale); break;
      case 'L': sp.lineTo(c.x * scale, -c.y * scale); break;
      case 'Q': sp.quadraticCurveTo(c.x1 * scale, -c.y1 * scale, c.x * scale, -c.y * scale); break;
      case 'C': sp.bezierCurveTo(c.x1 * scale, -c.y1 * scale, c.x2 * scale, -c.y2 * scale, c.x * scale, -c.y * scale); break;
    }
  }
  return sp.subPaths.length ? sp.toShapes() : [];
}
