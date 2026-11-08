import { useEditor, useTransport } from '../core/store';
import { playback } from '../core/playback';
import { beatDuration, formatTimecode } from '../core/eval';
import { Icon } from './icons';
import { IconBtn } from './controls';

function Timecode() {
  const fps = useEditor((s) => s.project.fps);
  const tc = useTransport((s) => formatTimecode(s.time, fps));
  return <span className="tc" title="Current time (mm:ss:ff)">{tc}</span>;
}

function FrameCount() {
  const fps = useEditor((s) => s.project.fps);
  const f = useTransport((s) => Math.round(s.time * fps));
  return <span className="ro-val">{f}</span>;
}

function BarBeat() {
  const bpm = useEditor((s) => s.project.bpm);
  const off = useEditor((s) => s.project.beatOffset);
  const txt = useTransport((s) => {
    const b = Math.floor((s.time - off) / beatDuration({ bpm }) + 1e-4);
    return `${Math.floor(b / 4) + 1}.${(((b % 4) + 4) % 4) + 1}`;
  });
  return <span className="ro-val">{txt}</span>;
}

function PlayButton() {
  const playing = useTransport((s) => s.playing);
  return (
    <button type="button" className={`ibtn play${playing ? ' on' : ''}`} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'} onClick={() => playback.toggle()}>
      <Icon name={playing ? 'pause' : 'play'} size={14} />
    </button>
  );
}

function LoopButton() {
  const loop = useTransport((s) => s.loop);
  return <IconBtn icon="loop" title={`Loop ${loop ? 'on' : 'off'}`} active={loop} onClick={() => useTransport.setState({ loop: !loop })} />;
}

export function TransportBar() {
  const bpm = useEditor((s) => s.project.bpm);
  const duration = useEditor((s) => s.project.duration);
  const fps = useEditor((s) => s.project.fps);
  return (
    <div className="transport">
      <div className="transport-btns">
        <IconBtn icon="toStart" title="Go to start (Home)" onClick={() => playback.seek(0)} />
        <IconBtn icon="stepBack" title="Previous frame (←)" onClick={() => playback.step(-1)} />
        <PlayButton />
        <IconBtn icon="stepFwd" title="Next frame (→)" onClick={() => playback.step(1)} />
        <IconBtn icon="toEnd" title="Go to end (End)" onClick={() => playback.seek(duration)} />
        <span className="vsep" />
        <LoopButton />
      </div>
      <Timecode />
      <span className="tc-total">/ {formatTimecode(duration, fps)}</span>
      <span className="vsep" />
      <span className="ro"><label>Frame</label><FrameCount /></span>
      <span className="ro"><label>Bar</label><BarBeat /></span>
      <span className="ro"><label>BPM</label><span className="ro-val">{+bpm.toFixed(2)}</span></span>
      <span className="grow" />
      <span className="transport-hint"><kbd>1</kbd>–<kbd>0</kbd> stamp sync hits</span>
    </div>
  );
}
