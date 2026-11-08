/**
 * Procedural intro-track generator. Every style shares one arrangement:
 *   BUILD  pad + arp opening up, riser, pitch sweep, accelerating snare roll, 1-beat gap with a reverse cymbal
 *   DROP   full beat + bass, impact on the downbeat
 *   OUTRO  impact, sub drop, ring-out
 * Everything lands on the grid from musicLayout(); nothing in the chain adds latency, so the first
 * drop kick starts on the exact sample of dropTime.
 */
import type { MusicConfig } from '../core/types';
import {
  SR, TAU, addInto, addMono, clamp, convolveHalfRate, edgeFade, type F32, filter, fork, lerp, makeIR, mixStereo,
  mtof, noise, normalize, pick, pingPong, sat, saw, stereo, sweep, type Stereo,
} from './dsp';
import { clap, crash, hat, kick, noiseRise, reversed, snare, subFall } from './instruments';
import { type MusicLayout, musicLayout } from './layout';
import {
  type BassNote, bass808, growl, lead, padChord, pluck, pulseBass, reese, reverseBass, screech, stab, subLine,
} from './synths';

/** Target output peak: about -1 dBFS. */
const PEAK = 0.891;
/** Level of everything before the drop, relative to the drop. */
const BUILD_TRIM = 0.62;

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR_PROGRESSIONS = [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 5, 3, 4], [0, 2, 6, 5]];
const MAJOR_PROGRESSIONS = [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4], [0, 3, 5, 4]];

interface Drums {
  kick: F32; snare: F32; clap: F32; hatC: F32; hatO: F32; roll: F32; crash: F32;
}

class Song {
  readonly cfg: MusicConfig;
  readonly lay: MusicLayout;
  readonly n: number;
  readonly beat: number;
  readonly bar: number;
  readonly dropT: number;
  readonly dropEnd: number;
  readonly outroEnd: number;
  readonly buildBars: number;
  readonly dropBars: number;
  readonly outroBars: number;
  readonly intensity: number;

  readonly drums: Stereo;
  readonly bass: Stereo;
  readonly synth: Stereo;
  readonly fx: Stereo;
  /** Mono reverb send. */
  readonly send: F32;
  /** Times at which bass and synth bus duck, with depth and release in seconds. */
  readonly ducks: { t: number; depth: number; rel: number }[] = [];

  readonly rhythm: () => number;
  readonly tone: () => number;
  readonly scale: number[];
  readonly degrees: number[];
  readonly kit: Drums;
  /** Bass octave root, kept in E1..D#2 so the sub stays deep but audible. */
  readonly bassRoot: number;
  /** Chord octave root, C3..B3. */
  readonly chordRoot: number;

  constructor(cfg: MusicConfig) {
    this.cfg = cfg;
    this.lay = musicLayout(cfg);
    this.n = Math.ceil(this.lay.duration * SR);
    this.beat = this.lay.beat;
    this.bar = this.lay.bar;
    this.buildBars = Math.max(0, Math.round(cfg.buildBars));
    this.dropBars = Math.max(0, Math.round(cfg.dropBars));
    this.outroBars = Math.max(0, Math.round(cfg.outroBars));
    this.dropT = this.lay.dropTime;
    this.dropEnd = this.lay.sections[1].end;
    this.outroEnd = this.dropEnd + this.outroBars * this.bar;
    this.intensity = clamp(cfg.intensity, 0, 1);
    this.drums = stereo(this.n);
    this.bass = stereo(this.n);
    this.synth = stereo(this.n);
    this.fx = stereo(this.n);
    this.send = new Float32Array(this.n);
    this.rhythm = fork(cfg.seed, 'rhythm');
    this.tone = fork(cfg.seed, 'tone');
    this.scale = cfg.minor ? MINOR : MAJOR;
    this.degrees = pick(fork(cfg.seed, 'prog'), cfg.minor ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS);
    const pc = ((cfg.root % 12) + 12) % 12;
    this.bassRoot = 28 + ((pc - 4 + 12) % 12);
    this.chordRoot = 48 + pc;
    this.kit = makeKit(cfg);
  }

  /** Semitone offset of a scale degree above the tonic. */
  semis(deg: number): number {
    return this.scale[deg % 7] + 12 * Math.floor(deg / 7);
  }

  /** Triad (plus optional 7th) of the bar's chord, around octave 3. */
  chord(bar: number, sevenths = false): number[] {
    const d = this.degrees[bar % this.degrees.length];
    const degs = sevenths ? [d, d + 2, d + 4, d + 6] : [d, d + 2, d + 4];
    const out = degs.map((x) => this.chordRoot + this.semis(x));
    if (this.cfg.minor && d === 4) out[1] += 1; // the V of a minor key takes the leading tone
    return out;
  }

  /** Bass note of the bar's chord. */
  bassNote(bar: number): number {
    let m = this.bassRoot + this.semis(this.degrees[bar % this.degrees.length]);
    if (m > 39) m -= 12;
    return m;
  }

  /** Adds a bus to the synth stem at a sample offset, with its reverb send. */
  synthBus(bus: Stereo, at: number, send: number): void {
    addInto(this.synth.l, bus.l, at, 1);
    addInto(this.synth.r, bus.r, at, 1);
    addInto(this.send, bus.l, at, send * 0.5);
    addInto(this.send, bus.r, at, send * 0.5);
  }

  hit(stem: Stereo, s: F32, t: number, gain: number, pan = 0, send = 0): void {
    const at = Math.round(t * SR);
    addMono(stem, s, at, gain, pan);
    if (send > 0) addInto(this.send, s, at, gain * send);
  }

  kick(t: number, gain = 1, depth = 0.8): void {
    this.hit(this.drums, this.kit.kick, t, gain);
    this.ducks.push({ t, depth, rel: this.beat * 0.55 });
  }

  snare(t: number, gain = 1, depth = 0.55): void {
    this.hit(this.drums, this.kit.snare, t, gain, 0, 0.32);
    this.ducks.push({ t, depth, rel: this.beat * 0.4 });
  }
}

function makeKit(cfg: MusicConfig): Drums {
  const r = fork(cfg.seed, 'kit');
  const I = clamp(cfg.intensity, 0, 1);
  const base = {
    clap: clap(r), hatC: hat(r, 0.026), hatO: hat(r, 0.14), crash: crash(r, 3.2),
    roll: snare(r, { tone: 230, tail: 0.05, snap: 0.6 }),
  };
  switch (cfg.style) {
    case 'hardstyle':
      return { ...base, kick: kick(r, { f0: 420, f1: 58, pitchTau: 0.022, ampTau: 0.2, len: 0.36, click: 0.8, drive: 3.5 + I * 4.5 }), snare: snare(r, { tone: 215, tail: 0.11 }) };
    case 'trap':
      return { ...base, kick: kick(r, { f0: 210, f1: 58, pitchTau: 0.022, ampTau: 0.1, len: 0.3, click: 0.6, drive: 2.1 }), snare: snare(r, { tone: 205, tail: 0.13, snap: 1.3 }) };
    case 'synthwave': {
      // Gated reverb: a burst of dense noise chopped off hard, the 80s snare.
      const body = snare(r, { tone: 180, tail: 0.1 });
      const gated = new Float32Array(Math.round(0.34 * SR));
      gated.set(body.subarray(0, Math.min(body.length, gated.length)));
      const nz = noise(gated.length, r);
      filter(nz, 'bp', 2100, 0.7);
      for (let i = 0; i < gated.length; i++) {
        const t = i / SR;
        gated[i] += nz[i] * 1.5 * Math.min(1, t * 60) * (t < 0.27 ? 1 - t * 1.4 : Math.max(0, (0.3 - t) / 0.03) * 0.62);
      }
      edgeFade(gated, 0, 0.01);
      return { ...base, kick: kick(r, { f0: 165, f1: 52, pitchTau: 0.028, ampTau: 0.13, len: 0.36, click: 0.5, drive: 1.5 }), snare: gated };
    }
    case 'drumstep':
      return { ...base, kick: kick(r, { f0: 230, f1: 56, pitchTau: 0.02, ampTau: 0.09, len: 0.28, click: 0.7, drive: 2.3 }), snare: snare(r, { tone: 225, tail: 0.1, snap: 1.5 }) };
    default:
      return { ...base, kick: kick(r, { f0: 200, f1: 50, pitchTau: 0.03, ampTau: 0.15, len: 0.45, click: 0.55, drive: 2.2 }), snare: snare(r, { tone: 195, tail: 0.12, snap: 1.3 }) };
  }
}

// --- Build --------------------------------------------------------------------------------------

function arpSteps(style: MusicConfig['style']): number {
  if (style === 'synthwave' || style === 'hardstyle' || style === 'drumstep') return 4; // sixteenths
  return 2; // eighths
}

function arpeggio(s: Song, bus: Stereo, t0: number, bars: number, firstBar: number, gain: number): void {
  const steps = arpSteps(s.cfg.style);
  const shapes = [[0, 1, 2, 3, 2, 1], [0, 2, 1, 3, 1, 2], [0, 1, 2, 1, 3, 2, 1, 2], [3, 2, 1, 0, 1, 2]];
  const shape = pick(s.rhythm, shapes);
  const per = s.beat / steps;
  const total = bars * 4 * steps;
  for (let i = 0; i < total; i++) {
    const bar = firstBar + Math.floor(i / (4 * steps));
    const c = s.chord(bar);
    const tones = [c[0] + 12, c[1] + 12, c[2] + 12, c[0] + 24];
    const accent = i % (steps * 2) === 0 ? 1 : 0.72;
    pluck(bus, tones[shape[i % shape.length]], t0 + i * per, gain * accent, Math.sin(i * 1.7) * 0.5, s.tone);
  }
}

function buildSection(s: Song): void {
  const { beat, bar, dropT, buildBars } = s;
  if (buildBars <= 0) return;
  const gapT = dropT - beat;
  const size = Math.ceil(gapT * SR);
  const pads = stereo(size);
  const arp = stereo(size);

  for (let b = 0; b < buildBars; b++) {
    const t = b * bar;
    padChord(pads, s.chord(b, true), t, bar + 0.05, 0.13, s.tone, { attack: b === 0 ? 0.015 : 0.05, release: 0.1 });
    // Bass root underneath, so the build isn't all treble.
    const dur = Math.min(bar, gapT - t);
    subLine(s.bass, [{ t, dur, midi: s.bassNote(b) + 12, vel: lerp(0.08, 0.16, b / buildBars) }], 1);
  }
  arpeggio(s, arp, 0, buildBars, 0, 0.1);
  pingPong(arp, beat * 0.75, 0.42, 0.4);

  // The filter opens across the whole build, the classic pre-drop tension.
  const open = (t: number) => 320 * Math.pow(26, clamp(t / Math.max(gapT, 1e-3), 0, 1));
  for (const bus of [pads, arp]) {
    sweep(bus.l, 'lp', open, 0.9);
    sweep(bus.r, 'lp', open, 0.9);
    edgeFade(bus.l, 0, 0.006);
    edgeFade(bus.r, 0, 0.006);
  }
  s.synthBus(pads, 0, 0.3);
  s.synthBus(arp, 0, 0.45);

  // Half-time pulse grows in over the last half of the build.
  const pulseFrom = Math.floor(buildBars / 2);
  for (let b = pulseFrom; b < buildBars; b++) {
    const g = lerp(0.28, 0.5, (b - pulseFrom + 1) / Math.max(1, buildBars - pulseFrom));
    s.hit(s.drums, s.kit.kick, b * bar, g);
    if (b < buildBars - 1) s.hit(s.drums, s.kit.kick, b * bar + 2 * beat, g * 0.8);
  }
  // Soft beat-one marker so the track starts on the grid.
  s.hit(s.drums, s.kit.kick, 0, 0.26);

  // Rising noise and pitch sweep across the build, cut dead at the gap.
  const riser = noiseRise(s.tone, gapT, 500, 9500);
  edgeFade(riser.l, 0, 0.006);
  edgeFade(riser.r, 0, 0.006);
  addInto(s.fx.l, riser.l, 0, 0.3);
  addInto(s.fx.r, riser.r, 0, 0.3);
  pitchSweep(s, gapT);

  snareRoll(s, gapT);

  // Reverse cymbal lands precisely on the drop.
  const rc = reversed(crash(s.tone, Math.min(beat * 2.5, Math.max(beat, dropT)), 0));
  s.hit(s.fx, rc, dropT - rc.length / SR, 0.34);
}

/** Saw climbing two octaves over the build. */
function pitchSweep(s: Song, end: number): void {
  const n = Math.round(end * SR);
  const buf = new Float32Array(n);
  const f0 = mtof(s.chordRoot);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const dt = (f0 * Math.pow(4, x * x)) / SR;
    ph += dt;
    if (ph >= 1) ph -= 1;
    buf[i] = saw(ph, dt) * x * x * x * 0.55;
  }
  sweep(buf, 'lp', (t) => 600 + 7000 * clamp(t / end, 0, 1), 1.6);
  edgeFade(buf, 0, 0.006);
  s.hit(s.fx, buf, 0, 0.3, 0, 0.12);
}

function snareRoll(s: Song, gapT: number): void {
  const { beat, buildBars, dropT } = s;
  // [length in beats, subdivision per beat]: 1/4 -> 1/8 -> 1/16 -> 1/32.
  const plan: [number, number][] = buildBars >= 2 ? [[2, 1], [2, 2], [2, 4], [1, 8]] : [[1, 2], [1, 4], [1, 8]];
  const total = plan.reduce((a, [b]) => a + b, 0);
  let t = gapT - total * beat;
  const start = t;
  if (t < 0) return;
  for (const [beats, sub] of plan) {
    const hits = beats * sub;
    for (let i = 0; i < hits; i++) {
      const x = (t - start) / (dropT - beat - start);
      s.hit(s.drums, s.kit.roll, t, lerp(0.16, 0.62, x * x), 0, 0.2);
      t += beat / sub;
    }
  }
}

// --- Drop ---------------------------------------------------------------------------------------

function hats(s: Song, t0: number, stepBeats: number, count: number, gain: number, pan = 0.15): void {
  for (let i = 0; i < count; i++) {
    const offbeat = (i * stepBeats) % 1 !== 0;
    s.hit(s.drums, s.kit.hatC, t0 + i * stepBeats * s.beat, gain * (offbeat ? 1 : 0.65), pan);
  }
}

/** Short fill closing an 8-beat phrase: snare stutter in the last beat. */
function fill(s: Song, t: number): void {
  for (let i = 0; i < 4; i++) s.hit(s.drums, s.kit.roll, t + (i * s.beat) / 4, 0.55 + i * 0.12, 0, 0.2);
}

const DUB_PHRASES: { b: number; len: number; n: number; rate: number; from?: number }[][] = [
  [{ b: 0, len: 1.5, n: 0, rate: 2 }, { b: 1.5, len: 0.5, n: 12, rate: 4 }, { b: 2.5, len: 0.75, n: 0, rate: 3 }, { b: 3.25, len: 0.75, n: 3, rate: 4 }],
  [{ b: 0, len: 0.75, n: 0, rate: 4 }, { b: 0.75, len: 0.75, n: 0, rate: 6 }, { b: 1.5, len: 0.5, n: -2, rate: 2 }, { b: 2.5, len: 1.5, n: 0, rate: 1.5, from: 7 }],
  [{ b: 0, len: 2, n: 0, rate: 1 }, { b: 2.5, len: 0.5, n: 7, rate: 4 }, { b: 3, len: 0.5, n: 5, rate: 4 }, { b: 3.5, len: 0.5, n: 3, rate: 8 }],
  [{ b: 0, len: 1, n: 0, rate: 3 }, { b: 1, len: 1, n: 12, rate: 2, from: -12 }, { b: 2.5, len: 0.5, n: 0, rate: 8 }, { b: 3, len: 1, n: -2, rate: 3 }],
];

function dropDubstep(s: Song): void {
  const { bar, beat, dropT, dropBars, intensity: I, rhythm: r } = s;
  const notes: BassNote[] = [];
  const pa = pick(r, DUB_PHRASES);
  const pb = pick(r, DUB_PHRASES);
  const ghost = r();
  for (let i = 0; i < dropBars; i++) {
    const t = dropT + i * bar;
    s.kick(t);
    s.snare(t + 2 * beat);
    if (ghost > 0.5 ? i % 2 === 1 : i % 2 === 0) s.kick(t + 1.5 * beat, 0.8, 0.5);
    if (I > 0.5 && i % 2 === 1) s.kick(t + 3.25 * beat, 0.7, 0.4);
    hats(s, t, 0.5, 8, 0.2);
    s.hit(s.drums, s.kit.hatO, t + 3.5 * beat, 0.22, -0.15);
    for (const p of i % 2 ? pb : pa) {
      notes.push({ t: t + p.b * beat, dur: p.len * beat, midi: s.bassNote(i) + p.n, rate: p.rate / beat, from: p.from });
    }
    stabRow(s, i, t, 0.24, 2600);
    if (i === dropBars - 1 || i % 4 === 3) fill(s, t + 3 * beat);
  }
  growl(s.bass, notes, 0.55, 1.6 + I * 2.6, s.tone);
  subLine(s.bass, notes.map((n) => ({ ...n, midi: n.midi >= s.bassRoot + 12 ? n.midi - 12 : n.midi })), 0.72);
}

function dropTrap(s: Song): void {
  const { bar, beat, dropT, dropBars, intensity: I, rhythm: r } = s;
  const notes: BassNote[] = [];
  const kicks = pick(r, [[0, 0.75, 2.5], [0, 1.5, 2.75], [0, 0.75, 1.5, 3.25]]);
  for (let i = 0; i < dropBars; i++) {
    const t = dropT + i * bar;
    const root = s.bassNote(i);
    for (const k of kicks) s.kick(t + k * beat, k === 0 ? 1 : 0.85, 0.25);
    s.snare(t + 2 * beat, 0.9, 0.2);
    s.hit(s.drums, s.kit.clap, t + 2 * beat, 0.7, 0.05, 0.3);

    // Rolling hats: eighths broken up by 1/16, 1/32 and triplet rolls.
    let p = 0;
    while (p < 4 - 1e-6) {
      const x = r();
      const roll = x < 0.25 + I * 0.25 ? 0.125 : x < 0.55 + I * 0.15 ? 0.25 : 0.5;
      const len = roll === 0.5 ? 0.5 : roll === 0.25 ? 0.5 : 0.5 + (r() < 0.4 ? 0.5 : 0);
      const span = Math.min(len, 4 - p);
      for (let q = 0; q < span - 1e-6; q += roll) {
        s.hit(s.drums, s.kit.hatC, t + (p + q) * beat, (roll < 0.5 ? 0.24 : 0.3) * (0.7 + 0.3 * (q / span)), Math.sin((p + q) * 3) * 0.2);
      }
      p += span;
    }
    if (i % 2 === 1) s.hit(s.drums, s.kit.hatO, t + 3.5 * beat, 0.26);

    // 808: long note, then a gliding pickup.
    notes.push({ t, dur: 1.45 * beat, midi: root, from: i ? s.bassNote(i - 1) - root : 0 });
    notes.push({ t: t + 1.5 * beat, dur: 1 * beat, midi: root + (i % 2 ? 7 : 0), vel: 0.92 });
    notes.push({ t: t + 2.5 * beat, dur: 1.5 * beat, midi: root, from: i % 2 ? 7 : 12, vel: 0.95 });

    // Brass-ish stabs on the offbeats.
    const c = s.chord(i).map((m) => m + 12);
    for (const b of [0, 0.75, 1.5, 2.75]) stab(s.synth, c, t + b * beat, beat * 0.38, 0.26, s.tone, 3400 + I * 1800);
    if (i === dropBars - 1) fill(s, t + 3 * beat);
  }
  bass808(s.bass, notes, 0.82, 1.7 + I * 2.6);
}

function dropHardstyle(s: Song): void {
  const { bar, beat, dropT, dropBars, intensity: I, rhythm: r } = s;
  const notes: BassNote[] = [];
  const lead: BassNote[] = [];
  const motif = pick(r, [[0, 2, 1, 2, 3, 2, 1, 0], [0, 0, 2, 1, 0, 3, 2, 1], [2, 1, 0, 1, 2, 3, 2, 1]]);
  for (let i = 0; i < dropBars; i++) {
    const t = dropT + i * bar;
    const c = s.chord(i);
    const tones = [c[0] + 24, c[1] + 24, c[2] + 24, c[0] + 36];
    for (let k = 0; k < 4; k++) {
      s.kick(t + k * beat, 1, 0.85);
      notes.push({ t: t + (k + 0.28) * beat, dur: 0.72 * beat, midi: s.bassNote(i) + 12 });
      s.hit(s.drums, s.kit.hatO, t + (k + 0.5) * beat, 0.16, 0.1);
    }
    if (i % 2 === 1) s.hit(s.drums, s.kit.clap, t + 3 * beat, 0.5, 0, 0.3);
    for (let k = 0; k < 8; k++) {
      const m = tones[motif[k]];
      lead.push({ t: t + k * 0.5 * beat, dur: 0.46 * beat, midi: m, from: k === 0 ? -3 : 0, vel: k % 2 ? 0.8 : 1 });
    }
    if (i === dropBars - 1) fill(s, t + 3 * beat);
  }
  reverseBass(s.bass, notes, 0.5, 1.3 + I * 1.6);
  const scr = stereo(s.n);
  screech(scr, lead, 0.26, 2 + I * 3, s.tone);
  s.synthBus(scr, 0, 0.2);
}

function dropSynthwave(s: Song): void {
  const { bar, beat, dropT, dropBars, rhythm: r } = s;
  const notes: BassNote[] = [];
  const line: BassNote[] = [];
  const motif = pick(r, [[0, 2, 1, 0, 2, 3, 2, 1], [2, 1, 0, 1, 3, 2, 1, 0]]);
  const arp = stereo(s.n);
  const pads = stereo(s.n);
  for (let i = 0; i < dropBars; i++) {
    const t = dropT + i * bar;
    const root = s.bassNote(i) + 12;
    for (let k = 0; k < 4; k++) {
      s.kick(t + k * beat, 0.95, 0.55);
      s.hit(s.drums, s.kit.hatC, t + (k + 0.5) * beat, 0.22, 0.12);
    }
    s.snare(t + beat, 0.75, 0.2);
    s.snare(t + 3 * beat, 0.75, 0.2);
    for (let k = 0; k < 8; k++) {
      notes.push({ t: t + k * 0.5 * beat, dur: 0.46 * beat, midi: root + (k % 2 ? 12 : 0), vel: k % 2 ? 0.8 : 1 });
    }
    const c = s.chord(i);
    padChord(pads, s.chord(i, true), t, bar + 0.05, 0.3, s.tone, { attack: 0.04, detune: 7 });
    const tones = [c[0] + 24, c[1] + 24, c[2] + 24, c[0] + 36];
    if (i % 2 === 0) {
      for (let k = 0; k < 4; k++) line.push({ t: t + k * beat, dur: beat * 0.9, midi: tones[motif[(k + (i % 4 ? 4 : 0)) % 8]], vel: 0.9 });
    }
    if (i === dropBars - 1) fill(s, t + 3 * beat);
  }
  arpeggio(s, arp, dropT, dropBars, 0, 0.13);
  pingPong(arp, beat * 0.75, 0.4, 0.45);
  for (const ch of [pads.l, pads.r]) filter(ch, 'lp', 3400, 0.8);
  s.synthBus(pads, 0, 0.12);
  s.synthBus(arp, 0, 0.18);
  const ld = stereo(s.n);
  lead(ld, line, 0.2, s.tone);
  s.synthBus(ld, 0, 0.25);
  pulseBass(s.bass, notes, 0.62, s.tone);
  subLine(s.bass, notes.map((n) => ({ ...n, midi: s.bassNote(Math.floor((n.t - dropT) / bar)), vel: 0.6 })), 0.5);
}

function dropDrumstep(s: Song): void {
  const { bar, beat, dropT, dropBars, intensity: I, rhythm: r } = s;
  const notes: BassNote[] = [];
  const kicks = pick(r, [[0, 1.5], [0, 2.5], [0, 1.25, 2.75]]);
  for (let i = 0; i < dropBars; i++) {
    const t = dropT + i * bar;
    const root = s.bassNote(i);
    for (const k of kicks) s.kick(t + k * beat, k === 0 ? 1 : 0.85, 0.65);
    s.snare(t + 2 * beat, 1, 0.5);
    // Breakbeat: quick ghost snares and busy sixteenth hats with moving accents.
    for (const g of [0.75, 3.25, 3.75]) if (r() < 0.45 + I * 0.4) s.hit(s.drums, s.kit.roll, t + g * beat, 0.28, 0.05);
    for (let k = 0; k < 16; k++) {
      const acc = k % 4 === 2 ? 1 : k % 2 === 1 ? 0.55 + r() * 0.2 : 0.75;
      s.hit(s.drums, s.kit.hatC, t + (k * beat) / 4, 0.24 * acc, 0.15 * Math.sin(k));
    }
    s.hit(s.drums, s.kit.hatO, t + 1.5 * beat, 0.2, -0.12);
    notes.push({ t, dur: 1.75 * beat, midi: root, rate: 1.1 });
    notes.push({ t: t + 2 * beat, dur: 0.5 * beat, midi: root, rate: 2 });
    notes.push({ t: t + 2.5 * beat, dur: 1.25 * beat, midi: root + (i % 2 ? 3 : -2), rate: 2.5 });
    stabRow(s, i, t, 0.2, 2200);
    if (i === dropBars - 1) fill(s, t + 3 * beat);
  }
  reese(s.bass, notes, 0.5, 1.5 + I * 2.2, s.tone);
  subLine(s.bass, notes, 0.68);
}

function stabRow(s: Song, bar: number, t: number, gain: number, bright: number): void {
  const c = s.chord(bar).map((m) => m + 12);
  stab(s.synth, c, t + 0.5 * s.beat, s.beat * 0.3, gain, s.tone, bright);
  stab(s.synth, c, t + 2.5 * s.beat, s.beat * 0.3, gain * 0.8, s.tone, bright);
}

/** Sub boom, noise crash and reverb, shared by the drop and outro downbeats. */
function impact(s: Song, t: number, gain: number): void {
  const boom = subFall(2.2, 115, 34, 0.09, 1.4);
  s.hit(s.fx, boom, t, 0.85 * gain, 0, 0.1);
  const r = fork(s.cfg.seed + Math.round(t * 1000), 'impact');
  s.hit(s.fx, s.kit.crash, t, 0.34 * gain, -0.1, 0.2);
  const body = noise(Math.round(0.7 * SR), r);
  sweep(body, 'lp', (x) => 6500 * Math.exp(-x * 7) + 200, 0.9);
  for (let i = 0; i < body.length; i++) body[i] *= Math.exp(-i / SR / 0.14);
  edgeFade(body, 0, 0.02);
  s.hit(s.fx, body, t, 0.65 * gain, 0.1, 0.7);
}

function outroSection(s: Song): void {
  const { dropEnd, outroEnd, bar, outroBars } = s;
  if (s.dropBars > 0) impact(s, dropEnd, 0.85);
  if (outroBars <= 0) return;
  const len = outroEnd - dropEnd;
  // Final chord rings out through a closing filter.
  const at = Math.round(dropEnd * SR);
  const pads = stereo(s.n - at);
  padChord(pads, s.chord(0, true), 0, len + 0.6, 0.22, s.tone, { attack: 0.01, release: 1.1 });
  const close = (t: number) => 3800 * Math.pow(0.1, clamp(t / len, 0, 1));
  sweep(pads.l, 'lp', close, 0.8);
  sweep(pads.r, 'lp', close, 0.8);
  s.synthBus(pads, at, 0.3);
  // Sub drop.
  s.hit(s.bass, subFall(Math.min(len + 1, 2.4), 80, 27, Math.max(0.3, bar * 0.2), 1.2), dropEnd, 0.6);
}

/** Sidechain pump applied to bass and synth buses. */
function pump(s: Song): void {
  const env = new Float32Array(s.n).fill(1);
  for (const d of s.ducks) {
    const at = Math.round(d.t * SR);
    const len = Math.min(Math.round(d.rel * 3 * SR), s.n - at);
    const rel = d.rel * SR;
    for (let i = 0; i < len; i++) {
      const x = i / rel;
      const v = 1 - d.depth * Math.exp(-x * x * 1.6);
      if (v < env[at + i]) env[at + i] = v;
    }
  }
  // Smooth the dip's leading edge a touch so the multiply can't click.
  let y = 1;
  const k = 1 - Math.exp(-1 / (0.0015 * SR));
  for (let i = 0; i < s.n; i++) {
    y += (env[i] - y) * k;
    env[i] = y;
  }
  for (const bus of [s.bass, s.synth]) {
    for (let i = 0; i < s.n; i++) {
      bus.l[i] *= env[i];
      bus.r[i] *= env[i];
    }
  }
}

/** Zero-latency glue compressor: stereo-linked peak detector, gain updated every 32 samples. */
function glue(mix: Stereo, thresholdDb: number, ratio: number, attack: number, release: number): void {
  const thr = Math.pow(10, thresholdDb / 20);
  const ka = Math.exp(-1 / (attack * SR));
  const kr = Math.exp(-1 / (release * SR));
  const slope = 1 / ratio - 1;
  let env = 0;
  let g = 1;
  let target = 1;
  const { l, r } = mix;
  for (let i = 0; i < l.length; i++) {
    const a = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    env = a > env ? a + (env - a) * ka : a + (env - a) * kr;
    if ((i & 31) === 0) target = env > thr ? Math.pow(env / thr, slope) : 1;
    g += (target - g) * 0.02;
    l[i] *= g;
    r[i] *= g;
  }
}

function master(s: Song): Stereo {
  const wet = convolveHalfRate(s.send, makeIR(2.3, { seed: s.cfg.seed ^ 0x5eed, predelay: 0.014, brightness: 8000, halfRate: true }));
  filter(wet.l, 'hp', 240);
  filter(wet.r, 'hp', 240);

  // Pull the reverb down in the pre-drop gap so the silence actually reads as a gap.
  if (s.buildBars > 0) {
    const a = Math.round((s.dropT - s.beat) * SR);
    const b = Math.round(s.dropT * SR);
    const ramp = Math.round(0.03 * SR);
    for (const ch of [wet.l, wet.r]) {
      for (let i = a; i < b; i++) ch[i] *= lerp(1, 0.2, Math.min(1, (i - a) / ramp));
    }
  }

  const mix = stereo(s.n);
  mixStereo(mix, s.drums, 1);
  mixStereo(mix, s.bass, 1);
  mixStereo(mix, s.synth, 1);
  mixStereo(mix, s.fx, 1);
  mixStereo(mix, wet, 0.9);

  // The whole build sits under the drop, so the downbeat is a real jump in level.
  const dropAt = Math.round(s.dropT * SR);
  for (const ch of [mix.l, mix.r]) for (let i = 0; i < dropAt; i++) ch[i] *= BUILD_TRIM;

  filter(mix.l, 'hp', 24);
  filter(mix.r, 'hp', 24);
  glue(mix, -12, 2.5, 0.008, 0.14);
  const drive = 1.25 + s.intensity * 0.5;
  for (let i = 0; i < s.n; i++) {
    mix.l[i] = sat(mix.l[i] * drive);
    mix.r[i] = sat(mix.r[i] * drive);
  }
  normalize(mix, PEAK);
  edgeFade(mix.l, 0, 0.03);
  edgeFade(mix.r, 0, 0.03);
  return mix;
}

/** Renders the whole track. Pure function of cfg. */
export function renderMusic(cfg: MusicConfig): Stereo {
  const s = new Song(cfg);
  buildSection(s);
  if (s.dropBars > 0) {
    switch (cfg.style) {
      case 'trap': dropTrap(s); break;
      case 'hardstyle': dropHardstyle(s); break;
      case 'synthwave': dropSynthwave(s); break;
      case 'drumstep': dropDrumstep(s); break;
      default: dropDubstep(s);
    }
    impact(s, s.dropT, 1);
  }
  outroSection(s);
  pump(s);
  return master(s);
}
