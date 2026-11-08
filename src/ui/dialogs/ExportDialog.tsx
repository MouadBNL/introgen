import { useEffect, useMemo, useRef, useState } from 'react';
import { editor, useEditor } from '../../core/store';
import { formatTimecode } from '../../core/eval';
import { exportVideo, type ExportProgress } from '../../render/export';
import { Btn, parseTime, Row, Scrub, Seg, Select, type Opt } from '../controls';
import { saveFramePNG } from '../actions';
import { safeFileName } from '../files';
import { Modal } from './Modal';

type ResId = 'project' | '720' | '1080' | '1440' | '2160';
const RES: Opt<ResId>[] = [
  { value: 'project', label: 'Project size' }, { value: '720', label: '720p' }, { value: '1080', label: '1080p' }, { value: '1440', label: '1440p' }, { value: '2160', label: '4K' },
];
const QUALITY = [
  { value: 'draft', label: 'Draft', samples: 1, rate: 0.6 },
  { value: 'good', label: 'Good', samples: 4, rate: 1 },
  { value: 'best', label: 'Best', samples: 8, rate: 1.25 },
  { value: 'ultra', label: 'Ultra', samples: 16, rate: 1.5 },
] as const;
type QualityId = (typeof QUALITY)[number]['value'];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function outputSize(res: ResId, w: number, h: number): [number, number] {
  if (res === 'project') return [even(w), even(h)];
  // The preset names the short side, so vertical comps stay vertical.
  const k = Number(res) / Math.min(w, h);
  return [even(w * k), even(h * k)];
}

/** Sync intros are all fast motion and grain: this is deliberately above typical web bitrates. */
function bitrateFor(w: number, h: number, fps: number, rate: number): number {
  const base = 16e6 * ((w * h) / (1920 * 1080)) ** 0.75;
  return Math.round(base * (fps >= 50 ? 1.3 : 1) * rate);
}

type Phase =
  | { s: 'idle' }
  | { s: 'running'; p: ExportProgress | null }
  | { s: 'done'; url: string; size: number; name: string }
  | { s: 'error'; msg: string };

const PHASE_LABEL: Record<ExportProgress['phase'], string> = { audio: 'Rendering audio', video: 'Rendering frames', mux: 'Finishing file', done: 'Done' };

export function ExportDialog() {
  const p = useEditor((s) => s.project);
  const close = () => editor().setUI({ exportOpen: false });
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [res, setRes] = useState<ResId>('project');
  const [fps, setFps] = useState(p.fps);
  const [quality, setQuality] = useState<QualityId>('good');
  const [rangeMode, setRangeMode] = useState<'all' | 'custom'>('all');
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(p.duration);
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const lastUrl = useRef<string | null>(null);

  useEffect(() => () => {
    abort.current?.abort();
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
  }, []);

  const [w, h] = outputSize(res, p.width, p.height);
  const q = QUALITY.find((x) => x.value === quality)!;
  const bitrate = useMemo(() => bitrateFor(w, h, fps, q.rate), [w, h, fps, q.rate]);
  const start = rangeMode === 'all' ? 0 : from;
  const end = rangeMode === 'all' ? p.duration : Math.max(from + 1 / fps, to);
  const frames = Math.round((end - start) * fps);

  const run = async () => {
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase({ s: 'running', p: null });
    try {
      const blob = await exportVideo(p, { format, width: w, height: h, fps, samples: q.samples, bitrate, start, end },
        (pr) => setPhase({ s: 'running', p: pr }), ctl.signal);
      const url = URL.createObjectURL(blob);
      lastUrl.current = url;
      setPhase({ s: 'done', url, size: blob.size, name: `${safeFileName(p.name)}.${format}` });
    } catch (err) {
      if (ctl.signal.aborted || (err as Error)?.name === 'AbortError') setPhase({ s: 'idle' });
      else { console.error(err); setPhase({ s: 'error', msg: (err as Error)?.message || 'Export failed' }); }
    }
    abort.current = null;
  };

  const running = phase.s === 'running';

  if (phase.s === 'running') {
    const pr = phase.p;
    const k = pr ? (pr.phase === 'video' ? pr.frame / Math.max(1, pr.total) : pr.phase === 'audio' ? 0 : 1) : 0;
    return (
      <Modal title="Exporting" onClose={close} locked width={520}
        footer={<><span className="grow" /><Btn onClick={() => abort.current?.abort()}>Cancel</Btn></>}>
        <div className="export-preview" style={{ aspectRatio: `${w} / ${h}` }}>{pr?.previewUrl && <img src={pr.previewUrl} alt="" />}</div>
        <div className="progress"><div style={{ width: `${k * 100}%` }} /></div>
        <div className="export-status">
          <span>{pr ? PHASE_LABEL[pr.phase] : 'Starting…'}</span>
          <span className="grow" />
          {pr?.phase === 'video' && <span className="mono dim">{pr.frame} / {pr.total}</span>}
          <span className="mono">{Math.round(k * 100)}%</span>
        </div>
      </Modal>
    );
  }

  if (phase.s === 'done') {
    return (
      <Modal title="Export finished" onClose={close} footer={<>
        <Btn ghost onClick={() => setPhase({ s: 'idle' })}>Export again</Btn>
        <span className="grow" />
        <a className="btn primary" href={phase.url} download={phase.name}><span>Download {format.toUpperCase()}</span></a>
      </>}>
        <video className="export-result" src={phase.url} controls />
        <div className="export-status"><span className="mono">{phase.name}</span><span className="grow" /><span className="mono dim">{(phase.size / 1048576).toFixed(1)} MB</span></div>
      </Modal>
    );
  }

  return (
    <Modal title="Export video" onClose={close} footer={<>
      <Btn ghost icon="image" onClick={saveFramePNG}>Save frame PNG</Btn>
      <span className="grow" />
      <Btn onClick={close}>Close</Btn>
      <Btn primary icon="film" disabled={running} onClick={run}>Export</Btn>
    </>}>
      {phase.s === 'error' && <div className="error-box">{phase.msg}</div>}
      <Row label="Format"><Seg value={format} onChange={setFormat} options={[{ value: 'mp4', label: 'MP4 (H.264)' }, { value: 'webm', label: 'WebM (VP9)' }]} /></Row>
      <Row label="Resolution"><Select value={res} options={RES.map((o) => ({ ...o, hint: `${outputSize(o.value, p.width, p.height).join('×')}` }))} onChange={setRes} /></Row>
      <Row label="Frame rate"><Seg value={fps} onChange={setFps} options={[...new Set([24, 30, 60, p.fps])].sort((a, b) => a - b).map((f) => ({ value: f, label: String(f) }))} /></Row>
      <Row label="Quality"><Seg value={quality} onChange={setQuality} options={QUALITY.map((x) => ({ value: x.value, label: x.label, title: `${x.samples} motion-blur ${x.samples === 1 ? 'sample' : 'samples'} per frame` }))} /></Row>
      <Row label="Range"><Seg value={rangeMode} onChange={setRangeMode} options={[{ value: 'all', label: 'Whole intro' }, { value: 'custom', label: 'Custom' }]} /></Row>
      {rangeMode === 'custom' && (
        <Row label="In / Out">
          <div className="inline">
            <Scrub value={from} min={0} max={p.duration} step={1 / fps} format={(v) => formatTimecode(v, fps)} parse={(s) => parseTime(s, fps)} onChange={setFrom} className="time" />
            <Scrub value={to} min={0} max={p.duration} step={1 / fps} format={(v) => formatTimecode(v, fps)} parse={(s) => parseTime(s, fps)} onChange={setTo} className="time" />
          </div>
        </Row>
      )}
      <div className="export-sum mono">
        <span>{w}×{h}</span><span>{fps} fps</span><span>{frames} frames</span><span>{q.samples}× blur</span><span>{(bitrate / 1e6).toFixed(0)} Mbps</span><span>≈ {((bitrate * (end - start)) / 8 / 1048576).toFixed(0)} MB</span>
      </div>
    </Modal>
  );
}
