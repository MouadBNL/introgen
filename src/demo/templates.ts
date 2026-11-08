import { hexToRgb, rgbToHex } from '../core/eval';
import { emptyProject } from '../core/store';
import type { MusicConfig, Project } from '../core/types';
import { createDemoProject } from './demo';
import { baseProject, ease as E, hit, keys, layer, music, sfx } from './dsl';

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Re-themes a whole project by rotating every colour, keyed or static. */
function rotateHue(p: Project, deg: number) {
  const rot = (hex: string) => {
    const [h, s, l] = rgbToHsl(...hexToRgb(hex));
    return s < 0.04 ? hex : hslToHex((((h + deg) % 360) + 360) % 360, s, l);
  };
  for (const l of p.layers) for (const k in l.props) {
    const tr = l.props[k];
    if (typeof tr.value === 'string') tr.value = rot(tr.value);
    for (const kf of tr.keys) if (typeof kf.v === 'string') kf.v = rot(kf.v);
  }
}

function retitle(p: Project, text: string) {
  for (const l of p.layers) if (l.type === 'text3d') { l.settings.text = text; l.name = text; }
}

function variant(name: string, title: string, hue: number, font: string, music_: Partial<MusicConfig>): Project {
  const p = createDemoProject();
  p.name = name;
  rotateHue(p, hue);
  retitle(p, title);
  for (const l of p.layers) if (l.type === 'text3d') l.settings.font = font;
  Object.assign(p.music, music_);
  return p;
}

/** Short, restrained logo sting: shows how little you need. */
function sting(): Project {
  const BPM = 120, B = 60 / BPM, END = 6;
  const p = baseProject('Clean Sting', END, BPM);
  p.music = { style: 'synthwave', bpm: BPM, root: 45, minor: true, seed: 3, buildBars: 1, dropBars: 2, outroBars: 0, intensity: 0.5 };
  const hitT = B * 4;
  const cam = layer('camera', 'Camera', 0, END, {}, { lens: 50, aperture: 0.05 });
  keys(cam, 'dist', [[0, 15, E.out], [END, 12]]);
  keys(cam, 'az', [[0, -18, E.out], [END, 6]]);
  const post = layer('post', 'Post FX', 0, END, {}, { bloom: 0.8, rgb: 0.2, vignette: 0.6, grain: 0.04 });
  keys(post, 'fade', [[END - 0.8, 0, E.in], [END - 0.05, 1]]);
  const text = layer('text3d', 'Title', 0, END, { text: 'YOUR NAME', font: 'Russo One', depth: 0.4, bevel: 0.04, order: 'center' }, {
    color: '#e9e9ee', color2: '#30303a', marble: 0.3, rough: 0.2, anOz: -8, anRy: 70, anS: 0.6, anStagger: 0.4,
  });
  keys(text, 'anRev', [[0.2, 0, E.out], [hitT, 1]]);
  const ring = layer('shockwave', 'Ring', hitT, hitT + 1, {}, { color: '#9fc4ff', glow: 3, width: 0.25 });
  keys(ring, 'radius', [[hitT, 0.5, E.out], [hitT + 1, 16]]);
  keys(ring, 'opacity', [[hitT, 1, E.in], [hitT + 1, 0]]);
  const sparks = layer('particles', 'Sparks', hitT, END, { mode: 'burst', count: 900 }, { color: '#9fc4ff', size: 0.03, brightness: 3, speed: 22 });
  const dust = layer('particles', 'Dust', 0, END, { mode: 'ambient', count: 500 }, { color: '#9fc4ff', color2: '#ffffff', size: 0.012, brightness: 1.2 });
  const flare = layer('flare', 'Flare', 0, END, {}, { color: '#7fb0ff', intensity: 0.5, streak: 1.5, py: 0.3 });
  keys(flare, 'px', [[0, -7, E.smooth], [END, 7]]);
  const light = layer('light', 'Key', 0, END, {}, { color: '#dfe9ff', intensity: 60, px: 3, py: 4, pz: 8 });
  const bg = layer('background', 'Backdrop', 0, END, { mode: 'radial' }, { colorA: '#0d1a33', colorB: '#02030a', smoke: 0.3 });
  p.layers = [cam, post, text, ring, sparks, dust, flare, light, bg];
  hit(p, 'flash', hitT, 0.6, 0.3); hit(p, 'punch', hitT, 0.7); hit(p, 'rgb', hitT, 0.7);
  music(p, END);
  sfx(p, 'whooshLong', 0.1, 1, 0.5, 1);
  sfx(p, 'impact', hitT, 2, 0.7, 2);
  return p;
}

export const TEMPLATES: { id: string; name: string; blurb: string; create: () => Project }[] = [
  { id: 'crimson', name: 'Crimson Drop', blurb: 'The full demo. Damascus chrome, liquid crown, dubstep.', create: createDemoProject },
  { id: 'toxic', name: 'Toxic Warp', blurb: 'The same cut in acid green, on a trap beat.', create: () => variant('Toxic Warp', 'TOXIC', 130, 'Russo One', { style: 'trap', seed: 21 }) },
  { id: 'cobalt', name: 'Cobalt Rush', blurb: 'Icy blue over a drumstep rhythm.', create: () => variant('Cobalt Rush', 'COBALT', 225, 'Orbitron', { style: 'drumstep', seed: 5, root: 43 }) },
  { id: 'gold', name: 'Solar Gold', blurb: 'Molten gold over a hard kick.', create: () => variant('Solar Gold', 'SOLAR', 55, 'Bungee', { style: 'hardstyle', seed: 9, root: 40 }) },
  { id: 'sting', name: 'Clean Sting', blurb: 'A restrained six-second logo sting.', create: sting },
  { id: 'blank', name: 'Blank', blurb: 'Camera, Post FX and a backdrop. Nothing else.', create: emptyProject },
];
