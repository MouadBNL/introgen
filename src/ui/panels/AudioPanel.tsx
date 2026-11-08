import { useEffect, useMemo, useRef, useState } from 'react';
import type { Band, HitKind, MusicConfig, MusicStyle, SfxId } from '../../core/types';
import { editor, useEditor } from '../../core/store';
import { HIT_DEF, HIT_DEFS, SFX_LIST } from '../../core/schema';
import { formatTimecode } from '../../core/eval';
import { uid } from '../../core/rng';
import { AudioEngine, musicLayout } from '../../audio/engine';
import { Icon } from '../icons';
import { Btn, Check, IconBtn, Row, Scrub, Section, Select, Slider, type Opt } from '../controls';
import { addClipAt, batch, firstFreeLane, stampTime } from '../actions';
import { decodeDuration, pickFile, readDataUrl } from '../files';

const STYLES: Opt<MusicStyle>[] = [
  { value: 'dubstep', label: 'Dubstep' }, { value: 'trap', label: 'Trap' }, { value: 'hardstyle', label: 'Hardstyle' },
  { value: 'synthwave', label: 'Synthwave' }, { value: 'drumstep', label: 'Drumstep' },
];
const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const ROOTS: Opt<number>[] = NOTES.map((n, i) => ({ value: 36 + i, label: n }));

function MusicCard() {
  const music = useEditor((s) => s.project.music);
  const [d, setD] = useState<MusicConfig>(music);
  const [busy, setBusy] = useState(false);
  useEffect(() => setD(music), [music]);
  const up = (patch: Partial<MusicConfig>) => setD((x) => ({ ...x, ...patch }));
  const layout = useMemo(() => {
    try { return musicLayout(d); } catch { return null; }
  }, [d]);
  const fps = useEditor((s) => s.project.fps);

  const generate = async () => {
    const e = editor();
    const lay = musicLayout(d);
    setBusy(true);
    batch(() => {
      e.setMusic(d);
      e.commit('Generate music', (p) => {
        const clip = p.clips.find((c) => c.source.kind === 'music');
        if (clip) { clip.dur = lay.duration; clip.offset = 0; }
        else p.clips.push({ id: uid('c'), name: 'Music', source: { kind: 'music' }, lane: 0, t: 0, offset: 0, dur: lay.duration, gain: 0.9, fadeIn: 0, fadeOut: 0, muted: false });
        p.bpm = d.bpm;
        p.beatOffset = 0;
        if (p.duration < lay.duration) p.duration = lay.duration;
      });
    });
    try {
      await AudioEngine.get().prepare(editor().project);
      e.toast(`Music ready: drop at ${formatTimecode(lay.dropTime, editor().project.fps)}`);
    } catch (err) {
      console.error(err);
      e.toast('Music generation failed');
    }
    setBusy(false);
  };

  return (
    <Section id="audio.music" title="Music">
      <Row label="Style"><Select value={d.style} options={STYLES} onChange={(v) => up({ style: v })} /></Row>
      <Row label="BPM"><Scrub value={d.bpm} min={60} max={220} step={1} onChange={(v) => up({ bpm: Math.round(v) })} /></Row>
      <Row label="Key">
        <div className="inline">
          <Select value={d.root} options={ROOTS} onChange={(v) => up({ root: v })} className="w-note" />
          <Check checked={d.minor} onChange={(v) => up({ minor: v })} label="Minor" />
        </div>
      </Row>
      <Row label="Seed">
        <div className="inline">
          <Scrub value={d.seed} min={0} max={9999} step={1} onChange={(v) => up({ seed: Math.round(v) })} />
          <IconBtn icon="dice" title="Roll a new seed" onClick={() => up({ seed: Math.floor(Math.random() * 10000) })} />
        </div>
      </Row>
      <Row label="Bars"><div className="inline trio">
        <span title="Bars of build before the drop"><i>Build</i><Scrub value={d.buildBars} min={1} max={32} step={1} onChange={(v) => up({ buildBars: Math.round(v) })} /></span>
        <span title="Bars of drop"><i>Drop</i><Scrub value={d.dropBars} min={1} max={32} step={1} onChange={(v) => up({ dropBars: Math.round(v) })} /></span>
        <span title="Tail bars after the drop"><i>Outro</i><Scrub value={d.outroBars} min={0} max={16} step={1} onChange={(v) => up({ outroBars: Math.round(v) })} /></span>
      </div></Row>
      <Row label="Intensity">
        <div className="inline"><Slider value={d.intensity} onChange={(v) => up({ intensity: v })} /><span className="mono dim w-pct">{Math.round(d.intensity * 100)}%</span></div>
      </Row>
      {layout && (
        <div className="music-map" title="Song structure">
          {layout.sections.map((s) => (
            <span key={s.name + s.start} className={/drop/i.test(s.name) ? 'drop' : ''} style={{ flexGrow: Math.max(0.01, s.end - s.start) }}>{s.name}</span>
          ))}
        </div>
      )}
      <div className="card-foot">
        <Btn block icon="music" disabled={busy} onClick={generate}>{busy ? 'Rendering…' : 'Generate'}</Btn>
        {layout && <span className="note mono">{formatTimecode(layout.duration, fps)} · drop {formatTimecode(layout.dropTime, fps)}</span>}
      </div>
    </Section>
  );
}

function SfxBrowser() {
  const add = (id: SfxId, label: string, dur: number) => {
    addClipAt({ kind: 'sfx', sfx: id, seed: Math.floor(Math.random() * 10000) }, label, dur, stampTime());
    editor().toast(`${label} added`);
  };
  return (
    <Section id="audio.sfx" title="Sound Effects">
      <div className="list dense">
        {SFX_LIST.map((s) => (
          <div key={s.id} className="sfx-row">
            <button type="button" className="sfx-play" title="Preview" onClick={() => AudioEngine.get().preview({ kind: 'sfx', sfx: s.id, seed: 1 })}>
              <Icon name="play" size={10} /><span>{s.label}</span>
            </button>
            <span className="mono dim">{s.dur.toFixed(1)}s</span>
            <IconBtn icon="plus" size={12} title="Add at playhead" onClick={() => add(s.id, s.label, s.dur)} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function ImportCard() {
  const [busy, setBusy] = useState(false);
  const importAudio = async () => {
    const file = await pickFile('audio/*');
    if (!file) return;
    const e = editor();
    setBusy(true);
    try {
      const [dataUrl, dur] = await Promise.all([readDataUrl(file), decodeDuration(file)]);
      const assetId = uid('a');
      const t = stampTime();
      const name = file.name.replace(/\.[^.]+$/, '');
      e.commit('Import audio', (p) => {
        p.assets.push({ id: assetId, kind: 'audio', name: file.name, dataUrl });
        p.clips.push({ id: uid('c'), name, source: { kind: 'asset', assetId }, lane: firstFreeLane(p, t, dur), t, offset: 0, dur, gain: 0.9, fadeIn: 0, fadeOut: 0, muted: false });
      });
      e.toast(`Imported ${file.name}`);
    } catch (err) {
      console.error(err);
      e.toast('Could not decode that audio file');
    }
    setBusy(false);
  };
  return <Btn block icon="upload" disabled={busy} onClick={importAudio}>{busy ? 'Decoding…' : 'Import audio file…'}</Btn>;
}

const BANDS: Opt<Band>[] = [{ value: 'low', label: 'Low (kicks)' }, { value: 'mid', label: 'Mid (snares)' }, { value: 'high', label: 'High (hats)' }];
const HIT_OPTS: Opt<HitKind>[] = HIT_DEFS.map((h) => ({ value: h.kind, label: h.label, hint: h.key }));

function AutoSync() {
  const [band, setBand] = useState<Band>('low');
  const [sens, setSens] = useState(0.5);
  const [kind, setKind] = useState<HitKind>('shake');

  const run = () => {
    const e = editor();
    const p = e.project;
    const times = AudioEngine.get().detectOnsets(p, band, sens);
    if (!times.length) { e.toast('No onsets found. Generate music or lower the threshold.'); return; }
    const eps = 1.5 / p.fps;
    const fresh = times.filter((t) => !p.hits.some((h) => h.kind === kind && Math.abs(h.t - t) < eps));
    e.commit('Auto-sync', (d) => {
      for (const t of fresh) d.hits.push({ id: uid('h'), t, kind, amount: 1, dur: HIT_DEF[kind].dur });
      d.hits.sort((a, b) => a.t - b.t);
    });
    e.toast(`Stamped ${fresh.length} ${HIT_DEF[kind].label} hits`);
  };

  return (
    <Section id="audio.autosync" title="Auto-Sync">
      <Row label="Band"><Select value={band} options={BANDS} onChange={setBand} /></Row>
      <Row label="Sensitivity"><div className="inline"><Slider value={sens} onChange={setSens} /><span className="mono dim w-pct">{Math.round(sens * 100)}%</span></div></Row>
      <Row label="Hit"><Select value={kind} options={HIT_OPTS} onChange={setKind} /></Row>
      <div className="card-foot"><Btn block icon="bolt" onClick={run}>Stamp hits on onsets</Btn></div>
    </Section>
  );
}

function TapTempo() {
  const taps = useRef<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const tap = () => {
    const now = performance.now();
    const list = taps.current;
    if (list.length && now - list[list.length - 1] > 2500) list.length = 0;
    list.push(now);
    if (list.length > 12) list.shift();
    if (list.length >= 2) setBpm(Math.round((60000 * (list.length - 1)) / (list[list.length - 1] - list[0])));
    else setBpm(null);
  };
  return (
    <Section id="audio.tap" title="Tap Tempo">
      <div className="inline">
        <Btn icon="tap" onClick={tap}>Tap</Btn>
        <span className="mono tap-read">{bpm ?? '---'}</span>
        <span className="grow" />
        <Btn ghost disabled={bpm == null} onClick={() => { if (bpm) { editor().setProjectMeta({ bpm }); editor().toast(`Project tempo ${bpm} BPM`); } }}>Set BPM</Btn>
      </div>
    </Section>
  );
}

export function AudioPanel() {
  return (
    <div className="panel-scroll scroll">
      <MusicCard />
      <SfxBrowser />
      <Section id="audio.import" title="Import"><ImportCard /></Section>
      <AutoSync />
      <TapTempo />
    </div>
  );
}
