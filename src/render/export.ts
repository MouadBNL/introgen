import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, WebMOutputFormat, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } from 'mediabunny';
import { AudioEngine } from '../audio/engine';
import type { Project } from '../core/types';
import { Engine } from './engine';

export interface ExportOptions {
  format: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number;
  /** Motion-blur samples per frame (1 = off). */
  samples: number;
  bitrate: number; // bits per second
  start: number;
  end: number;
}
export interface ExportProgress { frame: number; total: number; phase: 'audio' | 'video' | 'mux' | 'done'; previewUrl?: string }

/** Stacked SFX can push the mix past full scale; codecs then overshoot further. Leave headroom. */
function guardPeak(buf: AudioBuffer, ceiling = 0.89) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  if (peak <= ceiling) return;
  const k = ceiling / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

function sliceBuffer(ctx: BaseAudioContext, src: AudioBuffer, start: number, end: number): AudioBuffer {
  const a = Math.floor(start * src.sampleRate), b = Math.min(src.length, Math.ceil(end * src.sampleRate));
  const out = ctx.createBuffer(src.numberOfChannels, Math.max(1, b - a), src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) out.copyToChannel(src.getChannelData(c).subarray(a, b), c);
  return out;
}

/**
 * Offline render: every frame is drawn at full quality however slow that is, then encoded with
 * WebCodecs. Unlike screen-capture export this can't drop frames, and timing is exact.
 */
export async function exportVideo(project: Project, opts: ExportOptions, onProgress: (p: ExportProgress) => void, signal: AbortSignal): Promise<Blob> {
  const { width, height, fps, start, end } = opts;
  // Encoders need even dimensions.
  const w = width & ~1, h = height & ~1;
  const ae = AudioEngine.get();

  onProgress({ frame: 0, total: 0, phase: 'audio' });
  await ae.prepare(project);
  const mix = project.clips.length ? await ae.renderMix(project) : null;
  const env = ae.envelopes();

  const videoCodec = await getFirstEncodableVideoCodec(opts.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'av1', 'vp8'], { width: w, height: h });
  if (!videoCodec) throw new Error('This browser has no usable video encoder for that format.');
  // Not every Chromium build ships an AAC encoder. MP4 can carry Opus, so negotiate; never drop sound silently.
  const audioCodec = mix
    ? await getFirstEncodableAudioCodec(opts.format === 'mp4' ? ['aac', 'opus', 'flac'] : ['opus', 'vorbis'], { numberOfChannels: 2, sampleRate: 48000 })
    : null;
  if (mix && !audioCodec) throw new Error('This browser has no usable audio encoder for that format. Try WebM.');

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const engine = new Engine(canvas);
  try {
    engine.setSize(w, h, opts.samples > 2 ? 0 : 4);
    // A resolution change must not change the look: the project is rendered at the export size,
    // with fps replaced so shutter time matches the export frame rate.
    const proj: Project = { ...project, fps };
    await engine.ready(proj);

    const output = new Output({
      format: opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: opts.bitrate, keyFrameInterval: 1 });
    output.addVideoTrack(video, { frameRate: fps });
    const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: 256_000 }) : null;
    if (audio) output.addAudioTrack(audio);
    await output.start();

    if (audio && mix) {
      const part = sliceBuffer(ae.ctx, mix, start, end);
      guardPeak(part);
      await audio.add(part);
    }
    audio?.close();

    const total = Math.max(1, Math.round((end - start) * fps));
    const thumb = document.createElement('canvas');
    thumb.width = 384; thumb.height = Math.round((384 * h) / w);
    const tctx = thumb.getContext('2d')!;
    let lastPreview = 0;
    for (let f = 0; f < total; f++) {
      if (signal.aborted) {
        await output.cancel();
        throw new DOMException('Export cancelled', 'AbortError');
      }
      const t = start + f / fps;
      engine.render(proj, t, { samples: opts.samples, env });
      await video.add(f / fps, 1 / fps);
      let previewUrl: string | undefined;
      const now = performance.now();
      if (now - lastPreview > 250) {
        lastPreview = now;
        tctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
        previewUrl = thumb.toDataURL('image/jpeg', 0.7);
      }
      onProgress({ frame: f + 1, total, phase: 'video', previewUrl });
      // Let the page paint and encoders drain.
      if (f % 2 === 0) await new Promise((r) => setTimeout(r));
    }
    video.close();
    onProgress({ frame: total, total, phase: 'mux' });
    await output.finalize();
    onProgress({ frame: total, total, phase: 'done' });
    const buf = (output.target as BufferTarget).buffer!;
    return new Blob([buf], { type: opts.format === 'mp4' ? 'video/mp4' : 'video/webm' });
  } finally {
    engine.dispose();
    engine.renderer.forceContextLoss();
  }
}

/** Grab the current frame as a PNG blob at project resolution, with full-quality blur. */
export async function snapshotPNG(project: Project, time: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const engine = new Engine(canvas);
  try {
    engine.setSize(project.width, project.height, 0);
    await engine.ready(project);
    engine.render(project, time, { samples: 16, env: AudioEngine.get().envelopes() });
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode PNG'))), 'image/png'));
  } finally {
    engine.dispose();
    engine.renderer.forceContextLoss();
  }
}
