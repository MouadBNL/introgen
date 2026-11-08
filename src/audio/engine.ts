/**
 * Audio engine: renders and caches sources, plays the timeline, mixes for export and supplies the
 * band envelopes that drive audio-reactive properties.
 */
import type {
  AudioClip, AudioSource, Band, BandEnvelopes, MusicConfig, Project,
} from '../core/types';
import { type Analysis, ENV_RATE, analyze, computePeaks, onsets, snapToAttack } from './analysis';
import { type F32, SR, type Stereo } from './dsp';
import { type MusicLayout, musicLayout } from './layout';
import { renderMusic } from './music';
import { SFX_DURATION, renderSfx } from './sfx';
import type { SynthJob } from './synth.worker';

export { musicLayout };
export type { MusicLayout };
export type { AudioClip };

export interface Peaks { rate: number; min: Float32Array; max: Float32Array } // rate = peak pairs per second of source

/** The DynamicsCompressor delays its signal by this much; renderMix trims it off the front. */
const LIMITER_LATENCY = 0.006;
/**
 * The DynamicsCompressor adds fixed makeup gain (+0.8 dB with these settings, measured in Chromium).
 * This cancels it, so anything below the threshold passes at unity.
 */
const LIMITER_TRIM = 0.912;
/** How far ahead of the clock playback is scheduled, so the first samples are never late. */
const START_AHEAD = 0.05;
/** Music buffers are large; keep the few most recent configs. */
const MAX_MUSIC_CACHE = 4;

interface Entry { buffer: AudioBuffer; peaks?: Peaks }

interface Session {
  from: number;
  /** ctx time at which timeline position `from` is heard. */
  start: number;
  bus: GainNode;
  nodes: Set<AudioBufferSourceNode>;
  stopped: boolean;
}

function toBuffer(l: F32, r: F32): AudioBuffer {
  const b = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, l.length), sampleRate: SR });
  b.copyToChannel(l, 0);
  b.copyToChannel(r, 1);
  return b;
}

/** Applies the limiter stage shared by live playback and offline export. */
function makeLimiter(ctx: BaseAudioContext): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -2;
  c.knee.value = 2;
  c.ratio.value = 20;
  c.attack.value = 0.002;
  c.release.value = 0.12;
  return c;
}

/**
 * Connects one clip: gain automation for clip gain and fades, then the source itself.
 * `pos` is the timeline position to begin at, heard at context time `when`.
 */
function scheduleClip(
  ctx: BaseAudioContext, dest: AudioNode, buffer: AudioBuffer, clip: AudioClip, pos: number, when: number,
): AudioBufferSourceNode | null {
  const clipEnd = clip.t + clip.dur;
  const begin = Math.max(clip.t, pos);
  if (begin >= clipEnd) return null;
  const offset = clip.offset + (begin - clip.t);
  if (offset >= buffer.duration) return null;
  const length = Math.min(clipEnd - begin, buffer.duration - offset);

  // Cutting into the middle of a source needs a tiny fade to avoid a click.
  const fadeIn = Math.max(clip.fadeIn, clip.offset > 0 ? 0.002 : 0);
  const fadeOut = Math.max(clip.fadeOut, 0.002);
  const curve = (u: number) => {
    const a = fadeIn > 0 ? Math.min(1, u / fadeIn) : 1;
    const b = fadeOut > 0 ? Math.min(1, (clip.dur - u) / fadeOut) : 1;
    return clip.gain * Math.max(0, a) * Math.max(0, b);
  };

  const u0 = begin - clip.t;
  const u1 = u0 + length;
  const g = ctx.createGain();
  g.gain.setValueAtTime(curve(u0), when);
  const stops = [fadeIn, clip.dur - fadeOut, u1].filter((u) => u > u0 && u <= u1);
  for (const u of [...new Set(stops)].sort((a, b) => a - b)) {
    g.gain.linearRampToValueAtTime(curve(u), when + (u - u0));
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(g);
  g.connect(dest);
  src.start(when, offset, length);
  return src;
}

export class AudioEngine {
  private static instance: AudioEngine | null = null;

  static get(): AudioEngine {
    return (AudioEngine.instance ??= new AudioEngine());
  }

  private context: AudioContext | null = null;
  private masterIn: GainNode | null = null;

  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry | null>>();
  private failed = new Set<string>();

  private music: MusicConfig | null = null;
  private project: Project | null = null;

  private analysis: Analysis | null = null;
  private analyzedKey = '';
  private queued: Project | null = null;
  private running: Promise<void> | null = null;

  private session: Session | null = null;
  private previewNode: AudioBufferSourceNode | null = null;
  private previewToken = 0;

  private subscribers = new Set<() => void>();

  private worker: Worker | null = null;
  private workerBroken = false;
  private jobs = new Map<number, { resolve: (s: Stereo) => void; reject: (e: Error) => void; job: SynthJob }>();
  private jobId = 0;

  /** Created on first use. Starts suspended if no user gesture has happened yet. */
  get ctx(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: SR, latencyHint: 'interactive' });
      this.masterIn = this.context.createGain();
      this.masterIn.connect(makeLimiter(this.context)).connect(this.context.destination);
    }
    return this.context;
  }

  private get master(): GainNode {
    void this.ctx;
    return this.masterIn!;
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private notify(): void {
    for (const cb of [...this.subscribers]) cb();
  }

  // --- Sources --------------------------------------------------------------------------------

  private keyOf(source: AudioSource, cfg: MusicConfig | null = this.music): string | null {
    switch (source.kind) {
      case 'music': return cfg ? `music:${JSON.stringify(cfg)}` : null;
      case 'sfx': return `sfx:${source.sfx}:${source.seed}`;
      case 'asset': return `asset:${source.assetId}`;
    }
  }

  private runJob(job: SynthJob): Promise<Stereo> {
    if (!this.worker && !this.workerBroken) {
      try {
        this.worker = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<{ id: number; l?: F32; r?: F32; error?: string }>) => {
          const pending = this.jobs.get(e.data.id);
          if (!pending) return;
          this.jobs.delete(e.data.id);
          if (e.data.l && e.data.r) pending.resolve({ l: e.data.l, r: e.data.r });
          else pending.reject(new Error(e.data.error ?? 'render failed'));
        };
        this.worker.onerror = () => {
          // The worker failed to load or crashed: finish its queue on the main thread.
          this.workerBroken = true;
          this.worker?.terminate();
          this.worker = null;
          const stranded = [...this.jobs.values()];
          this.jobs.clear();
          for (const p of stranded) {
            try {
              p.resolve(this.runLocal(p.job));
            } catch (err) {
              p.reject(err as Error);
            }
          }
        };
      } catch {
        this.workerBroken = true;
      }
    }
    if (!this.worker) return Promise.resolve().then(() => this.runLocal(job));
    return new Promise((resolve, reject) => {
      const id = ++this.jobId;
      this.jobs.set(id, { resolve, reject, job });
      this.worker!.postMessage({ id, job });
    });
  }

  private runLocal(job: SynthJob): Stereo {
    return job.kind === 'music' ? renderMusic(job.cfg) : renderSfx(job.sfx, job.seed);
  }

  private async load(source: AudioSource, project: Project | undefined): Promise<AudioBuffer> {
    if (source.kind === 'asset') {
      const asset = (project ?? this.project)?.assets.find((a) => a.id === source.assetId);
      if (!asset) throw new Error(`missing asset ${source.assetId}`);
      const data = await (await fetch(asset.dataUrl)).arrayBuffer();
      return new OfflineAudioContext(2, 1, SR).decodeAudioData(data);
    }
    const job: SynthJob = source.kind === 'music'
      ? { kind: 'music', cfg: project?.music ?? this.music! }
      : { kind: 'sfx', sfx: source.sfx, seed: source.seed };
    const out = await this.runJob(job);
    return toBuffer(out.l, out.r);
  }

  /** Renders or decodes a source once; concurrent callers share the same promise. */
  private ensure(source: AudioSource, project?: Project): Promise<Entry | null> {
    const key = this.keyOf(source, project?.music ?? this.music);
    if (!key) return Promise.resolve(null);
    const hit = this.entries.get(key);
    if (hit) return Promise.resolve(hit);
    if (this.failed.has(key)) return Promise.resolve(null);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.load(source, project)
      .then((buffer) => {
        const entry: Entry = { buffer };
        this.entries.set(key, entry);
        this.evictMusic();
        this.notify();
        return entry;
      })
      .catch((err) => {
        console.warn('[audio] source failed', key, err);
        this.failed.add(key);
        return null;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  private evictMusic(): void {
    const keys = [...this.entries.keys()].filter((k) => k.startsWith('music:'));
    const current = this.music ? `music:${JSON.stringify(this.music)}` : '';
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_MUSIC_CACHE))) {
      if (k !== current) this.entries.delete(k);
    }
  }

  /** Warm entry without waiting. Never rejects. */
  private entryOf(source: AudioSource): Entry | null {
    const key = this.keyOf(source);
    if (!key) return null;
    const entry = this.entries.get(key);
    if (entry) return entry;
    void this.ensure(source);
    return null;
  }

  private adopt(project: Project): void {
    this.project = project;
    this.music = project.music;
  }

  // --- Prepare --------------------------------------------------------------------------------

  private prepareKey(p: Project): string {
    return JSON.stringify([p.clips, p.music, p.assets.map((a) => a.id), p.masterGain, p.duration]);
  }

  /** Only the newest requested project is worked on; a burst of edits collapses into one pass. */
  prepare(project: Project): Promise<void> {
    this.adopt(project);
    if (!this.running && this.prepareKey(project) === this.analyzedKey) return Promise.resolve();
    this.queued = project;
    this.running ??= this.drain().finally(() => {
      this.running = null;
      if (this.queued) void this.prepare(this.queued);
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    while (this.queued) {
      const p = this.queued;
      this.queued = null;
      const key = this.prepareKey(p);
      if (key === this.analyzedKey) continue;
      this.failed.clear(); // an asset missing earlier may exist now
      await Promise.all(p.clips.map((c) => this.ensure(c.source, p)));
      if (this.queued) continue;
      const mix = await this.renderMix(p);
      const channels = [mix.getChannelData(0), mix.getChannelData(mix.numberOfChannels > 1 ? 1 : 0)] as F32[];
      this.analysis = analyze(channels[0], channels[1], mix.sampleRate, p.duration);
      this.analyzedKey = key;
      this.notify();
    }
  }

  // --- Transport ------------------------------------------------------------------------------

  play(project: Project, from: number): void {
    this.stop();
    this.adopt(project);
    const ctx = this.ctx;
    void ctx.resume();
    this.master.gain.setValueAtTime(project.masterGain * LIMITER_TRIM, ctx.currentTime);

    const bus = ctx.createGain();
    bus.connect(this.master);
    const session: Session = { from, start: ctx.currentTime + START_AHEAD, bus, nodes: new Set(), stopped: false };
    this.session = session;

    for (const clip of project.clips) {
      if (clip.muted) continue;
      const entry = this.entries.get(this.keyOf(clip.source) ?? '');
      if (entry) {
        this.startClip(session, entry.buffer, clip, from, session.start);
      } else {
        void this.ensure(clip.source, project).then((late) => {
          if (!late || session.stopped) return;
          // Join at the position the transport has reached by now, slightly ahead of the clock.
          const when = ctx.currentTime + 0.02;
          this.startClip(session, late.buffer, clip, session.from + (when - session.start), when);
        });
      }
    }
  }

  private startClip(s: Session, buffer: AudioBuffer, clip: AudioClip, pos: number, when: number): void {
    // A clip that starts later than `pos` is placed at its own timeline time.
    const at = clip.t > pos ? when + (clip.t - pos) : when;
    const node = scheduleClip(this.ctx, s.bus, buffer, clip, pos, at);
    if (!node) return;
    s.nodes.add(node);
    node.onended = () => {
      s.nodes.delete(node);
    };
  }

  stop(): void {
    const s = this.session;
    this.session = null;
    if (!s) return;
    s.stopped = true;
    const t = this.ctx.currentTime;
    s.bus.gain.setValueAtTime(1, t);
    s.bus.gain.linearRampToValueAtTime(0, t + 0.006);
    for (const node of s.nodes) {
      node.onended = null;
      node.stop(t + 0.008);
    }
    s.nodes.clear();
    setTimeout(() => s.bus.disconnect(), 40);
  }

  /** Timeline position of what is being heard, or null when stopped or the clock isn't running. */
  now(): number | null {
    const s = this.session;
    if (!s || !this.context || this.context.state !== 'running') return null;
    const heard = this.context.currentTime - (this.context.outputLatency || this.context.baseLatency || 0) - LIMITER_LATENCY;
    return Math.max(s.from, s.from + heard - s.start);
  }

  preview(source: AudioSource): void {
    const token = ++this.previewToken;
    this.stopPreview();
    void this.ctx.resume();
    void this.ensure(source).then((entry) => {
      if (!entry || token !== this.previewToken) return;
      const src = this.ctx.createBufferSource();
      src.buffer = entry.buffer;
      src.connect(this.master);
      src.start();
      this.previewNode = src;
    });
  }

  private stopPreview(): void {
    try {
      this.previewNode?.stop();
    } catch {
      // Already finished.
    }
    this.previewNode = null;
  }

  // --- Mixing ---------------------------------------------------------------------------------

  async renderMix(project: Project): Promise<AudioBuffer> {
    const entries = await Promise.all(project.clips.map((c) => this.ensure(c.source, project)));
    const trim = Math.round(LIMITER_LATENCY * SR);
    const length = Math.max(1, Math.ceil(project.duration * SR));
    const ctx = new OfflineAudioContext(2, length + trim, SR);
    const gain = ctx.createGain();
    gain.gain.value = project.masterGain * LIMITER_TRIM;
    gain.connect(makeLimiter(ctx)).connect(ctx.destination);
    project.clips.forEach((clip, i) => {
      const entry = entries[i];
      if (!entry || clip.muted) return;
      scheduleClip(ctx, gain, entry.buffer, clip, 0, Math.max(0, clip.t));
    });
    const rendered = await ctx.startRendering();
    const out = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: SR });
    for (let c = 0; c < 2; c++) {
      const data = rendered.getChannelData(c).subarray(trim, trim + length);
      for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i]));
      out.copyToChannel(data as F32, c);
    }
    return out;
  }

  // --- Queries --------------------------------------------------------------------------------

  envelopes(): BandEnvelopes | null {
    return this.analysis?.env ?? null;
  }

  peaks(source: AudioSource): Peaks | null {
    const entry = this.entryOf(source);
    if (!entry) return null;
    if (!entry.peaks) {
      const channels: F32[] = [];
      for (let c = 0; c < entry.buffer.numberOfChannels; c++) channels.push(entry.buffer.getChannelData(c) as F32);
      entry.peaks = computePeaks(channels, entry.buffer.sampleRate);
    }
    return entry.peaks;
  }

  sourceDuration(source: AudioSource): number | null {
    const key = this.keyOf(source);
    const entry = key ? this.entries.get(key) : undefined;
    if (entry) return entry.buffer.duration;
    if (source.kind === 'sfx') return SFX_DURATION[source.sfx] ?? null;
    if (source.kind === 'music') return this.music ? musicLayout(this.music).duration : null;
    this.entryOf(source);
    return null;
  }

  detectOnsets(project: Project, band: Band, sensitivity = 1): number[] {
    const a = this.analysis;
    if (!a) return [];
    const found = band === 'low'
      ? snapToAttack(onsets(a.raw.low, ENV_RATE, sensitivity, 3), a.raw.full, ENV_RATE)
      : onsets(a.raw[band], ENV_RATE, sensitivity);
    return found.filter((t) => t < project.duration);
  }
}
