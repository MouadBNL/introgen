/**
 * Playback controller. The audio clock is the master while playing, so picture and sound stay locked.
 * UI calls: playback.toggle(), playback.play(), playback.pause(), playback.seek(t), playback.step(frames).
 */
import { AudioEngine } from '../audio/engine';
import { editor, transport, useTransport } from './store';

const MAX_CLOCK_DRIFT = 0.4;

let raf = 0;
let wallStart = 0;
let timeStart = 0;

function tick() {
  const tr = transport();
  if (!tr.playing) return;
  const p = editor().project;
  // The audio clock leads while it's believable. A stalled or missing output device must not
  // freeze the playhead, so anything far from wall time falls back to wall time.
  const wall = timeStart + (performance.now() - wallStart) / 1000;
  const audio = AudioEngine.get().now();
  const t = audio != null && Math.abs(audio - wall) < MAX_CLOCK_DRIFT ? audio : wall;
  if (t >= p.duration) {
    if (tr.loop) {
      start(0);
      return;
    }
    pause();
    useTransport.setState({ time: p.duration });
    return;
  }
  useTransport.setState({ time: t });
  raf = requestAnimationFrame(tick);
}

function start(from: number) {
  const p = editor().project;
  cancelAnimationFrame(raf);
  timeStart = from;
  wallStart = performance.now();
  const ae = AudioEngine.get();
  ae.stop();
  ae.play(p, from);
  useTransport.setState({ playing: true, time: from });
  raf = requestAnimationFrame(tick);
}

export function play() {
  const p = editor().project;
  const t = transport().time;
  start(t >= p.duration - 1e-3 ? 0 : t);
}

export function pause() {
  cancelAnimationFrame(raf);
  AudioEngine.get().stop();
  useTransport.setState({ playing: false });
}

export function toggle() {
  transport().playing ? pause() : play();
}

export function seek(t: number) {
  const p = editor().project;
  const c = Math.max(0, Math.min(p.duration, t));
  if (transport().playing) start(c);
  else useTransport.setState({ time: c });
}

export function step(frames: number) {
  const p = editor().project;
  const f = Math.round(transport().time * p.fps) + frames;
  pause();
  seek(f / p.fps);
}

export const playback = { play, pause, toggle, seek, step };
