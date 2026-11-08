import type { Project } from '../core/types';
import LOGO_SVG from '../../public/favicon.svg?raw';
import { baseProject, ease as E, hit, keys, layer, music, postOf, set, sfx, type K } from './dsl';

/**
 * The demo intro. Sixteen seconds on a 140 BPM grid: credit card, macro letter shots, build,
 * white-flash drop, whip-cut hero section, hue-flip section, rock explosion, sign-off.
 * It deliberately touches every generator, every sync hit and every kind of property modifier.
 */
export function createDemoProject(): Project {
  const BPM = 140;
  const B = 60 / BPM;          // beat
  const BAR = B * 4;
  const at = (bar: number, beat = 0) => (bar * 4 + beat) * B;
  const DROP = at(4);          // bars are zero-based: four bars of build
  const END2 = at(8);          // end of the drop
  const END = 16.2;

  const p = baseProject('Crimson Drop', END, BPM);
  p.music = { style: 'dubstep', bpm: BPM, root: 41, minor: true, seed: 11, buildBars: 4, dropBars: 4, outroBars: 1, intensity: 0.85 };

  const add = <T extends { id: string }>(l: T) => { p.layers.push(l as any); return l; };

  // ---------- Post FX: one stack, keyed across the piece
  const post = add(layer('post', 'Post FX', 0, END, {}, {
    shutter: 300, exposure: 0, contrast: 1.16, saturation: 1.08, tint: '#ff2d55', tintAmt: 0.42, bloom: 0.95, bloomThresh: 0.9, bloomRadius: 0.78,
    rgb: 0.4, vignette: 0.75, grain: 0.05, raysX: 0.5, raysY: 0.5, raysLen: 0.75,
  }));
  keys(post, 'tintAmt', [[0, 0, 'hold'], [at(1), 0.42, 'hold']]);
  keys(post, 'bars', [[0, 0, 'hold'], [at(1), 0.16, E.smooth], [at(3, 3.5), 0.26, 'hold'], [DROP, 0, 'hold'], [at(6), 0.12, 'hold'], [at(7), 0, 'hold'], [at(8), 0.14, 'hold']]);
  keys(post, 'exposure', [[at(3, 2), 0, E.in], [at(3, 3.75), -1.2, 'hold'], [DROP, 0.25, E.out], [at(4, 2), 0]]);
  keys(post, 'rays', [[at(3), 0, E.in], [DROP - 0.02, 1.4, 'hold'], [DROP, 1.6, E.out], [at(5), 0.3, E.smooth], [at(8), 0.3, 'hold'], [at(8) + 0.01, 1.3, E.out], [at(8, 3), 0.2]]);
  keys(post, 'zoomBlur', [[at(3, 3), 0, E.in], [DROP - 0.01, 1.1, 'hold'], [DROP, 0.3, E.out], [DROP + 0.5, 0]]);
  keys(post, 'fade', [[END - 1.2, 0, E.in], [END - 0.1, 1, 'hold']]);
  keys(post, 'frameRot', [[at(3, 2), 0, E.in], [DROP, -3, 'hold'], [DROP + 0.001, 0]]);
  post.props.bloom.audio = { band: 'low', amount: 0.45 };
  post.props.rgb.audio = { band: 'mid', amount: 0.25 };
  post.props.distort.wiggle = { amp: 0.03, freq: 3, seed: 5 };

  // ---------- Credit card
  const card = add(layer('text2d', 'Credits', 0.2, at(1), { text: '3D: INTROGEN\nFX: CLAUDE', font: 'Black Ops One', size: 0.052, skew: 0.18 }, { y: 0.56, color: '#f2f2f5', glow: 0.25, spacing: 0.02 }));
  keys(card, 'opacity', [[0.2, 0, E.out], [0.55, 1, 'hold'], [at(1) - 0.45, 1, E.in], [at(1) - 0.05, 0]]);
  keys(card, 's', [[0.2, 1.06, E.out], [at(1), 0.97]]);
  keys(card, 'spacing', [[0.2, 0.09, E.out], [at(1), 0.0]]);

  // The logo on the card is an image layer: any PNG or SVG you import works the same way.
  const mark = LOGO_SVG.replace('<svg ', '<svg width="512" height="512" ');
  p.assets.push({ id: 'asset_logo', kind: 'image', name: 'introgen-mark.svg', dataUrl: `data:image/svg+xml,${encodeURIComponent(mark)}` });
  const stamp = add(layer('image', 'Logo Stamp', 0.2, at(1), { asset: 'asset_logo' }, { py: 2.05, s: 0.42 }));
  keys(stamp, 'opacity', [[0.2, 0, E.out], [0.55, 1, 'hold'], [at(1) - 0.45, 1, E.in], [at(1) - 0.05, 0]]);
  keys(stamp, 'ry', [[0.2, -28, E.out], [at(1), 8]]);

  // ---------- The word. A null carries it so the whole rig can be nudged at once.
  const rig = add(layer('null', 'Hero Rig', at(1), END, {}, {}));
  rig.props.rz.wiggle = { amp: 0.6, freq: 1.3, seed: 2 };
  rig.props.py.wiggle = { amp: 0.05, freq: 1.1, seed: 3 };

  const text = add(layer('text3d', 'INTROGEN', at(1), END, { text: 'INTROGEN', font: 'Black Ops One', depth: 0.72, bevel: 0.055, bevelSegs: 3, tracking: 0.035, order: 'center', seed: 4 }, {
    color: '#fff0f2', color2: '#8a0f2c', metal: 1, rough: 0.22, marble: 0.92, marbleScale: 1.05, marbleWarp: 2.4, bump: 0.6, emissive: '#ff2d55', emissiveAmt: 0.02, envAmt: 1.35,
    anStagger: 0.35, flipSpread: 0.6,
  }));
  text.parent = rig.id;
  // Reveal in bar 2 with letters thrown from depth.
  keys(text, 'anRev', [[at(1), 0, E.out], [at(2, 2), 1]]);
  set(text, { anOz: -22, anOy: 3, anRx: 160, anRy: -90, anS: 0.4 });
  // Flip waves on the build and again in the drop.
  keys(text, 'flip', [[at(3), 0, E.whip], [at(3, 2), 1, 'hold'], [at(5), 0, E.whip], [at(5, 2), 1, 'hold'], [at(6, 2), 0, E.whip], [at(7), 2, 'hold'], [at(8), 0, 'hold']]);
  keys(text, 'letterJitter', [[at(3, 3), 0, E.in], [DROP - 0.02, 0.8, 'hold'], [DROP, 0, 'hold'], [at(7, 3), 0, E.in], [at(8) - 0.02, 1.2, 'hold'], [at(8), 0, 'hold']]);
  text.props.emissiveAmt.audio = { band: 'low', amount: 0.1 };
  keys(text, 'pz', [[at(8), 0, E.snap], [at(8) + 0.35, 0.8, E.smooth], [END, 0.3]]);

  // ---------- Liquid crown: blooms on the drop
  const crown = add(layer('splash', 'Liquid Crown', DROP, at(6), { arms: 190, flat: 0.84, seed: 7 }, {
    pz: -4.6, color: '#d42a4c', color2: '#2a020b', metal: 1, rough: 0.2, marble: 0.75, marbleScale: 0.8, marbleWarp: 2.2, bump: 0.45, envAmt: 0.85, emissive: '#ff2d55', emissiveAmt: 0.04,
    radius: 7.6, thickness: 0.26, turb: 1.2, flow: 0.55,
  }));
  keys(crown, 'grow', [[DROP, 0.02, [0.02, 0.8, 0.2, 1]], [DROP + 1.1, 0.86, E.smooth], [at(6), 1]]);
  keys(crown, 'rz', [[DROP, -14, E.out], [at(6), 16]]);
  crown.props.s.audio = { band: 'low', amount: 0.12 };

  const crown2 = add(layer('splash', 'Second Bloom', at(8), END, { arms: 220, flat: 0.84, seed: 21 }, {
    pz: -5.4, color: '#d42a4c', color2: '#2a020b', rough: 0.2, marble: 0.75, marbleScale: 0.8, bump: 0.45, envAmt: 0.85,
    radius: 8.8, thickness: 0.27, turb: 1.35, flow: 0.45,
  }));
  keys(crown2, 'grow', [[at(8), 0.02, [0.02, 0.8, 0.2, 1]], [at(8) + 1.2, 0.9, E.smooth], [END, 1]]);
  keys(crown2, 'rz', [[at(8), 12, E.out], [END, -8]]);

  // ---------- Streaks, bursts, orbs
  const streaksA = add(layer('streaks', 'Worm Streaks', at(1), at(4), { mode: 'flow', count: 70, seed: 3 }, {
    color: '#ff2d55', color2: '#ffc7d2', glow: 3, width: 0.05, length: 3.4, spread: 7, speed: 17, curl: 1.4,
  }));
  keys(streaksA, 'opacity', [[at(1), 0, E.out], [at(1, 2), 1]]);

  const streaksB = add(layer('streaks', 'Drop Streaks', DROP, at(8), { mode: 'burst', count: 170, seed: 9 }, {
    color: '#ff2d55', color2: '#ffd3dc', glow: 3.2, width: 0.075, length: 5.5, spread: 20, speed: 30, curl: 1.8,
  }));
  const streaksC = add(layer('streaks', 'Finale Streaks', at(8), END, { mode: 'burst', count: 150, seed: 15 }, {
    color: '#ff2d55', color2: '#ffd3dc', glow: 3, width: 0.08, length: 6, spread: 24, speed: 34, curl: 1.6,
  }));
  keys(streaksC, 'opacity', [[END - 1.4, 1, E.in], [END - 0.3, 0]]);

  const sparks = add(layer('particles', 'Drop Sparks', DROP, DROP + 3.4, { mode: 'burst', count: 2400, seed: 5 }, {
    color: '#ff5a7a', color2: '#ffffff', size: 0.04, brightness: 3.5, stretch: 2.2, spread: 2, speed: 36, drag: 2.3, life: 2.6, turb: 0.7, gravity: 1.2,
  }));
  void sparks;
  add(layer('particles', 'Beat Sparks', at(6), at(8), { mode: 'burst', count: 900, seed: 6, period: B * 2 }, {
    color: '#ff5a7a', color2: '#ffffff', size: 0.035, brightness: 3, stretch: 2, speed: 30, drag: 2.8, life: 0.8, turb: 0.5,
  }));
  add(layer('particles', 'Finale Sparks', at(8), END, { mode: 'burst', count: 2600, seed: 8 }, {
    color: '#ff5a7a', color2: '#ffffff', size: 0.04, brightness: 3.5, stretch: 2.2, speed: 40, drag: 2, life: 3.4, turb: 0.8, gravity: 0.8,
  }));

  const bokeh = add(layer('particles', 'Bokeh Orbs', at(1), END, { mode: 'bokeh', count: 46, seed: 12 }, {
    color: '#ff2d55', color2: '#ffc2cf', size: 0.05, brightness: 0.9, spread: 15, speed: 5, turb: 0.9, pz: -3,
  }));
  bokeh.props.brightness.audio = { band: 'low', amount: 1.1 };

  add(layer('particles', 'Dust', 0, END, { mode: 'ambient', count: 900, seed: 2 }, {
    color: '#ffb3c2', color2: '#ffffff', size: 0.012, brightness: 1.7, spread: 16, speed: 3, turb: 0.5, opacity: 0.8,
  }));

  const warp = add(layer('particles', 'Warp Stars', at(3), DROP, { mode: 'warp', count: 2600, seed: 4 }, {
    color: '#ff5a7a', color2: '#ffffff', size: 0.018, brightness: 3.5, stretch: 3.2, spread: 9, speed: 40,
  }));
  keys(warp, 'speed', [[at(3), 22, E.in], [DROP, 95]]);
  keys(warp, 'opacity', [[at(3), 0, E.out], [at(3, 1), 1]]);

  // ---------- Second half: dot sheet + electricity, with a green hue flip riding on top
  const dots = add(layer('dots', 'Dot Sheet', at(6), END, { cols: 76, rows: 46, seed: 3 }, {
    pz: -9, rx: -10, color: '#ff2d55', color2: '#ffc2cf', size: 0.13, brightness: 2.2, spacing: 1.05, waveAmp: 1.5, waveFreq: 0.3, waveSpeed: 2.4, twinkle: 0.5,
  }));
  keys(dots, 'reveal', [[at(6), 0, [0.1, 0.8, 0.2, 1]], [at(6, 3), 1]]);
  keys(dots, 'opacity', [[END - 2.5, 1, E.in], [END - 0.6, 0.25]]);
  dots.props.waveAmp.audio = { band: 'low', amount: 2.6 };

  const arcs = add(layer('lightning', 'Electric Arcs', at(6), at(8), { bolts: 24, segments: 34, seed: 5 }, {
    pz: -1, color: '#ff4468', glow: 5, thickness: 0.05, radius: 11, inner: 3.6, jitter: 1, rate: 20,
  }));
  keys(arcs, 'reach', [[at(6), 0, E.out], [at(6, 1), 1]]);
  arcs.props.opacity.audio = { band: 'low', amount: 0.8 };
  set(arcs, { opacity: 0.25 });

  // ---------- Impacts
  const ring = add(layer('shockwave', 'Drop Ring', DROP, DROP + 1.2, { seed: 2 }, { color: '#ff7f96', glow: 5, width: 0.42, noise: 0.5 }));
  keys(ring, 'radius', [[DROP, 0.3, E.out], [DROP + 1.2, 26]]);
  keys(ring, 'opacity', [[DROP, 1, E.in], [DROP + 1.15, 0]]);
  const ring2 = add(layer('shockwave', 'Finale Ring', at(8), at(8) + 1.4, { seed: 8 }, { color: '#ff7f96', glow: 5, width: 0.5, noise: 0.6 }));
  keys(ring2, 'radius', [[at(8), 0.3, E.out], [at(8) + 1.4, 30]]);
  keys(ring2, 'opacity', [[at(8), 1, E.in], [at(8) + 1.35, 0]]);

  // ---------- Rock explosion on the last bar of the drop
  const rocks = add(layer('debris', 'Rock Burst', at(7, 2), END, { count: 70, flat: 0.55, seed: 4 }, {
    color: '#ffd5dc', color2: '#6a0a20', rough: 0.34, marble: 0.9, marbleScale: 1.8, bump: 0.8, envAmt: 1.3, size: 0.62, radius: 12, spin: 1.6,
  }));
  keys(rocks, 'explode', [[at(7, 2), 0, E.out], [at(8), 0.55, 'hold'], [at(8) + 0.001, 0.55, [0.02, 0.8, 0.2, 1]], [END, 1.0]]);

  // ---------- The emblem: a chrome bolt that slams through bar 8
  const bolt = add(layer('logo', 'Bolt Emblem', at(7), at(7, 2), { shape: 'bolt', depth: 0.7, bevel: 0.08 }, {
    color: '#ffffff', color2: '#ff2d55', rough: 0.14, marble: 0.6, marbleScale: 1.2, bump: 0.5, envAmt: 1.6, pz: 3.2, s: 1.15,
  }));
  keys(bolt, 'ry', [[at(7), -120, E.snap], [at(7, 2), 40]]);
  keys(bolt, 's', [[at(7), 0.1, E.snap], [at(7, 0.5), 1.3, E.smooth], [at(7, 2), 1.45]]);

  // ---------- Light
  const flareA = add(layer('flare', 'Hero Flare', at(1), END, { seed: 3 }, { px: -5.5, py: 2.4, pz: 1, color: '#ff4468', intensity: 0.55, size: 1.1, streak: 1.2, ghosts: 0.8, flicker: 0.25 }));
  flareA.props.intensity.audio = { band: 'low', amount: 1.1 };
  keys(flareA, 'px', [[at(1), -7, E.smooth], [at(4), 6, 'hold'], [DROP, -6.2, E.smooth], [at(6), 5.5, 'hold'], [at(6) + 0.001, 6, E.smooth], [END, -5]]);
  const flareB = add(layer('flare', 'Core Flare', DROP, END, { seed: 9 }, { px: 0, py: 0, pz: -2.5, color: '#ff4468', size: 1.6, streak: 2.2, ghosts: 0.2, flicker: 0.1 }));
  keys(flareB, 'intensity', [[DROP, 1.3, E.out], [DROP + 0.7, 0.14, 'hold'], [at(8), 1.4, E.out], [at(8) + 0.8, 0.12]]);

  const keyL = add(layer('light', 'Key Light', 0, END, { kind: 'point' }, { px: 0, py: 3.5, pz: 8, color: '#ffd8df', intensity: 40 }));
  keyL.props.intensity.audio = { band: 'low', amount: 60 };
  const rimL = add(layer('light', 'Rim Light', 0, END, { kind: 'point' }, { px: -8, py: -2, pz: -5, color: '#ff2d55', intensity: 120 }));
  void rimL;
  const sweep = add(layer('light', 'Sweep Light', at(1), END, { kind: 'point' }, { py: 1.2, pz: 4, color: '#ffffff', intensity: 45 }));
  keys(sweep, 'px', [[at(1), -13, E.smooth], [at(2), 13, 'hold'], [at(2) + 0.001, -13, E.smooth], [at(4), 13, 'hold'], [at(4) + 0.001, -13, E.smooth], [at(5), 13, 'hold'], [at(5) + 0.001, -13, E.smooth], [at(6), 13, 'hold'], [at(6) + 0.001, -13, E.smooth], [at(7), 13, 'hold'], [at(7) + 0.001, -13, E.smooth], [at(8), 13, 'hold'], [at(8) + 0.001, -13, E.smooth], [END, 13]]);

  const bg = add(layer('background', 'Backdrop', 0, END, { mode: 'nebula' }, { colorA: '#4a0616', colorB: '#040102', spread: 0.8, smoke: 0.7, smokeSpeed: 0.14 }));
  keys(bg, 'opacity', [[at(1) - 0.05, 0, 'hold'], [at(1), 1, 'hold']]);
  bg.props.spread.audio = { band: 'low', amount: 0.35 };

  // ---------- Camera: every shot is a layer, so a cut is just where one ends
  const shot = (name: string, a: number, b: number, base: Record<string, number>, ks: Record<string, K[]> = {}) => {
    const c = layer('camera', name, a, b, {}, { shake: 0.1, shakeFreq: 2, ...base });
    for (const k in ks) keys(c, k, ks[k]);
    p.layers.unshift(c);
    return c;
  };

  shot('Card', 0, at(1), { dist: 16, lens: 35, shake: 0 });
  // Macro glide across the letter faces with shallow focus.
  shot('Macro Slide', at(1), at(2), { lens: 70, aperture: 0.2, el: -7, shake: 0.05 }, {
    tx: [[at(1), -6.5, E.smooth], [at(2), -1.6]], az: [[at(1), 40, E.smooth], [at(2), 22]], dist: [[at(1), 8.6, E.smooth], [at(2), 7.6]], roll: [[at(1), -13, E.smooth], [at(2), -5]],
  });
  // Behind the word, orbiting round to the front: the text reads mirrored first, like the classics.
  shot('Back Orbit', at(2), at(3), { lens: 32, el: 9, shake: 0.08 }, {
    az: [[at(2), 192, [0.2, 0.7, 0.3, 1]], [at(3), 372]], dist: [[at(2), 17, E.smooth], [at(3), 15.5]], roll: [[at(2), 9, E.smooth], [at(3), -2]],
  });
  // Build: push in, roll, faster and faster.
  shot('Build Push', at(3), at(3, 2), { lens: 28, el: -6, shake: 0.12 }, {
    az: [[at(3), -24, E.smooth], [at(3, 2), -6]], dist: [[at(3), 19, E.in], [at(3, 2), 12]], roll: [[at(3), 6, E.smooth], [at(3, 2), -5]],
  });
  shot('Build Dive', at(3, 2), DROP, { lens: 22, shake: 0.22, shakeFreq: 9 }, {
    az: [[at(3, 2), 16, E.smooth], [DROP, 0]], el: [[at(3, 2), 12, E.smooth], [DROP, 0]], dist: [[at(3, 2), 13, E.in], [DROP, 2.8]], roll: [[at(3, 2), 8, E.in], [DROP, 42]],
  });
  // The drop, cut on the half-time beat. Each shot snaps in and then drifts.
  const hero = (i: number, a: number, b: number, az: number, el: number, roll: number, d0: number, d1: number, lens = 30) =>
    shot(`Drop ${i}`, a, b, { lens, shake: 0.14, shakeFreq: 3 }, {
      az: [[a, az - 26, E.snap], [a + 0.32, az, E.smooth], [b, az + 6]],
      el: [[a, el + 7, E.snap], [a + 0.32, el]],
      roll: [[a, roll - 14, E.snap], [a + 0.32, roll, E.smooth], [b, roll + 2]],
      dist: [[a, d0 * 0.55, E.snap], [a + 0.32, d0, E.smooth], [b, d1]],
    });
  hero(1, DROP, at(4, 2), -14, 6, -4, 15, 13.8);
  hero(2, at(4, 2), at(5), 18, -5, 5, 13, 12.2, 24);
  hero(3, at(5), at(5, 2), -32, 12, -9, 12, 11);
  hero(4, at(5, 2), at(6), 150, 6, 7, 15, 14, 26);
  hero(5, at(6), at(6, 2), 26, 15, -6, 16, 14.5, 26);
  hero(6, at(6, 2), at(7), -24, -9, 8, 13.5, 12.2, 24);
  shot('Bolt Close', at(7), at(7, 2), { lens: 40, shake: 0.2, shakeFreq: 5 }, {
    az: [[at(7), 14, E.snap], [at(7, 2), -8]], dist: [[at(7), 12, E.snap], [at(7, 2), 10.5]], roll: [[at(7), -9, E.smooth], [at(7, 2), 4]], tz: [[at(7), 2, E.smooth], [at(7, 2), 2]],
  });
  shot('Rock Dolly', at(7, 2), at(8), { lens: 24, shake: 0.2, shakeFreq: 6 }, {
    az: [[at(7, 2), -38, E.smooth], [at(8), -2]], el: [[at(7, 2), 13, E.smooth], [at(8), 2]], dist: [[at(7, 2), 11, E.in], [at(8), 4.2]], roll: [[at(7, 2), -12, E.in], [at(8), -32]],
  });
  // Sign-off: one slow, wide hold on the finished title.
  shot('Finale', at(8), END, { lens: 32, aperture: 0.03, shake: 0.09, shakeFreq: 1.4 }, {
    az: [[at(8), -22, E.snap], [at(8) + 0.5, -9, E.smooth], [END, 7]], el: [[at(8), 9, E.snap], [at(8) + 0.5, 4, E.smooth], [END, 1]],
    dist: [[at(8), 8, E.snap], [at(8) + 0.5, 17.5, E.smooth], [END, 15.2]], roll: [[at(8), -16, E.snap], [at(8) + 0.5, -2.5, E.smooth], [END, 1.5]],
  });

  // ---------- Sync track. This is the part that took all night in After Effects.
  for (const [t, a] of [[at(1), 0.7], [at(2), 0.8], [at(3), 0.8]] as const) { hit(p, 'punch', t, a); hit(p, 'rgb', t, 0.7); hit(p, 'shake', t, 0.5); }
  // Accelerating snare roll on the build
  for (const b of [0, 1, 2, 2.5, 3, 3.25, 3.5, 3.625, 3.75, 3.875]) { hit(p, 'punch', at(3, b), 0.28 + b * 0.09, 0.14); hit(p, 'rgb', at(3, b), 0.25 + b * 0.1, 0.12); }
  hit(p, 'glitch', at(3, 3.5), 0.8, 0.2);
  // The drop
  hit(p, 'flash', DROP, 1, 0.42); hit(p, 'shake', DROP, 1.8, 0.75); hit(p, 'punch', DROP, 1.4, 0.4); hit(p, 'rgb', DROP, 1.5, 0.45); hit(p, 'bars', DROP, 0.5, 0.5);
  // Kick on 1, snare on 3 (half-time), bars 5 to 8
  for (let bar = 4; bar < 8; bar++) {
    if (bar > 4) { hit(p, 'punch', at(bar), 0.85); hit(p, 'shake', at(bar), 0.95); hit(p, 'rgb', at(bar), 0.9); }
    hit(p, 'punch', at(bar, 2), 1); hit(p, 'shake', at(bar, 2), 1.1); hit(p, 'rgb', at(bar, 2), 1); hit(p, 'flash', at(bar, 2), 0.32, 0.12);
    hit(p, 'glitch', at(bar, 3.5), 0.6, 0.12);
    hit(p, 'whip', at(bar, 1.5), 0.55, 0.22);
  }
  // Accents: the frames people remember
  for (const t of [at(5, 3), at(6, 1), at(7, 3)]) { hit(p, 'invert', t, 1, 0.1); hit(p, 'blur', t, 0.7, 0.16); }
  for (const t of [at(6, 3), at(7, 1)]) hit(p, 'hue', t, 0.95, 0.2);
  // Finale
  hit(p, 'flash', at(8), 1, 0.5); hit(p, 'shake', at(8), 2, 1); hit(p, 'punch', at(8), 1.5, 0.5); hit(p, 'rgb', at(8), 1.6, 0.6); hit(p, 'invert', at(8) + 0.06, 1, 0.07);
  hit(p, 'bars', at(8), 0.5, 0.5);
  p.hits.sort((a, b) => a.t - b.t);

  // ---------- Sound
  music(p, Math.min(END, 9 * BAR + 2));
  sfx(p, 'shimmer', 0.05, 1, 0.3, 2);
  sfx(p, 'whooshLong', at(1) - 0.4, 2, 0.5, 1);
  sfx(p, 'whoosh', at(2) - 0.2, 3, 0.55, 2);
  sfx(p, 'metalHit', at(3), 1, 0.35, 3);
  sfx(p, 'reverseCymbal', DROP - 2, 2, 0.6, 1);
  sfx(p, 'impact', DROP, 1, 0.8, 1);
  sfx(p, 'whoosh', at(5) - 0.15, 3, 0.4, 4);
  sfx(p, 'whoosh', at(6) - 0.15, 3, 0.4, 5);
  sfx(p, 'glitch', at(6, 3.5), 2, 0.4, 2);
  sfx(p, 'zap', at(7), 3, 0.45, 2);
  sfx(p, 'tapeStop', at(8) - 1, 2, 0.3, 1);
  sfx(p, 'boom', at(8), 1, 0.85, 2);
  sfx(p, 'shimmer', at(8) + 0.4, 3, 0.3, 4);

  // ---------- Markers
  const mk = (t: number, label: string, color?: string) => p.markers.push({ id: `m_${t}`, t, label, color });
  mk(0, 'Card'); mk(at(1), 'Build'); mk(DROP, 'DROP', '#ff2d55'); mk(at(6), 'Dots + Arcs'); mk(at(8), 'Finale', '#ff2d55');

  // Stack order: the grade on top, the things people edit next, the shot list and backdrop below.
  const rank = (t: string) => (t === 'post' ? 0 : t === 'light' ? 2 : t === 'camera' ? 3 : t === 'background' ? 4 : 1);
  p.layers.sort((a, b) => rank(a.type) - rank(b.type));
  void BAR; void END2;
  return p;
}
