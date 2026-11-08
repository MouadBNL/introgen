import { useMemo } from 'react';
import type { AudioClip, Bezier, Ease, HitKind, Layer } from '../../core/types';
import { editor, findKey, useEditor } from '../../core/store';
import { HIT_DEF, HIT_DEFS, LAYER_DEFS, propDef, type PropDef } from '../../core/schema';
import { EASE_PRESETS, formatTimecode } from '../../core/eval';
import { Icon, LayerIcon } from '../icons';
import { Btn, Check, parseTime, Row, Scrub, Section, Select, TextField, type Opt } from '../controls';
import { ColorField } from './ColorPicker';
import { numberProps, PropRow } from './PropRow';
import { SettingsRows } from './Settings';
import { batch } from '../actions';

function TimeScrub({ value, onChange, disabled, max }: { value: number; onChange: (t: number) => void; disabled?: boolean; max?: number }) {
  const fps = useEditor((s) => s.project.fps);
  return <Scrub value={value} min={0} max={max} step={1 / fps} format={(v) => formatTimecode(v, fps)} parse={(s) => parseTime(s, fps)} onChange={onChange} disabled={disabled} className="time" />;
}

function easeEq(a: Ease, b: Ease) {
  return typeof a === 'string' || typeof b === 'string' ? a === b : a.every((v, i) => Math.abs(v - (b as Bezier)[i]) < 1e-3);
}

function EaseCurve({ ease }: { ease: Ease }) {
  const y = (v: number) => 19 - v * 14;
  const x = (v: number) => 3 + v * 16;
  let d: string;
  if (ease === 'linear') d = `M${x(0)} ${y(0)}L${x(1)} ${y(1)}`;
  else if (ease === 'hold') d = `M${x(0)} ${y(0)}H${x(1)}V${y(1)}`;
  else d = `M${x(0)} ${y(0)}C${x(ease[0])} ${y(ease[1])} ${x(ease[2])} ${y(ease[3])} ${x(1)} ${y(1)}`;
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true"><path d={d} /></svg>;
}

function KeyPanel() {
  const keys = useEditor((s) => s.sel.keys);
  const project = useEditor((s) => s.project);
  const found = useMemo(() => keys.map((k) => findKey(project, k)).filter((f) => !!f), [keys, project]);
  if (!found.length) return null;
  const first = found[0].kf.ease;
  const same = found.every((f) => easeEq(f.kf.ease, first));
  const current = same ? EASE_PRESETS.find((p) => easeEq(p.ease, first)) : undefined;
  const one = found.length === 1 ? found[0] : null;
  const def: PropDef | undefined = one ? propDef(one.layer.type, one.key) : undefined;
  return (
    <div className="key-panel">
      <div className="key-head">
        <Icon name="diamondOn" size={11} className="tint-key" />
        <b>{one ? `${one.layer.name} · ${def?.label ?? one.key}` : `${found.length} keyframes`}</b>
        <span className="grow" />
        <span className="dim">{current?.label ?? (same ? 'Custom' : 'Mixed')}</span>
      </div>
      <div className="ease-grid">
        {EASE_PRESETS.map((p) => (
          <button key={p.id} type="button" title={p.label} className={current?.id === p.id ? 'active' : ''} onClick={() => editor().setKeysEase(keys, p.ease)}><EaseCurve ease={p.ease} /></button>
        ))}
      </div>
      {one && def && (
        <div className="key-fields">
          <Row label="Time"><TimeScrub value={one.kf.t} onChange={(t) => editor().moveKeys([one.kf.id], t - one.kf.t, { noHistory: true })} /></Row>
          <Row label="Value">
            {def.kind === 'color'
              ? <ColorField value={String(one.kf.v)} onChange={(v) => editor().setKeyValue(one.kf.id, v, { noHistory: true })} />
              : <Scrub value={Number(one.kf.v)} {...numberProps(def)} onChange={(v) => editor().setKeyValue(one.kf.id, v, { noHistory: true })} />}
          </Row>
        </div>
      )}
    </div>
  );
}

const HIT_OPTS: Opt<HitKind>[] = HIT_DEFS.map((h) => ({ value: h.kind, label: h.label, hint: h.key }));

function HitEditor({ ids }: { ids: string[] }) {
  const hits = useEditor((s) => s.project.hits);
  const list = useMemo(() => hits.filter((h) => ids.includes(h.id)), [hits, ids]);
  const h = list[0];
  if (!h) return null;
  const up = editor().updateHits;
  return (
    <>
      <div className="insp-head">
        <span className="hit-chip" style={{ background: HIT_DEF[h.kind].color }} />
        <div className="insp-title"><b>{list.length > 1 ? `${list.length} sync hits` : HIT_DEF[h.kind].label}</b><small>{HIT_DEF[h.kind].blurb}</small></div>
      </div>
      <Section id="insp.hit" title="Sync Hit">
        <Row label="Kind"><Select value={h.kind} options={HIT_OPTS} onChange={(k) => batch(() => up(ids, { kind: k, dur: HIT_DEF[k].dur }))} /></Row>
        {list.length === 1 && <Row label="Time"><TimeScrub value={h.t} onChange={(t) => editor().moveHits([h.id], t - h.t, { noHistory: true })} /></Row>}
        <Row label="Amount"><Scrub value={h.amount} min={0} max={2} step={0.01} scale={100} unit="%" onChange={(v) => up(ids, { amount: v })} /></Row>
        <Row label="Duration"><Scrub value={h.dur} min={0.02} max={3} step={0.01} unit=" s" onChange={(v) => up(ids, { dur: v })} /></Row>
      </Section>
    </>
  );
}

function clipSourceLabel(c: AudioClip) {
  return c.source.kind === 'music' ? 'Generated music' : c.source.kind === 'sfx' ? 'Generated sound effect' : 'Imported audio';
}

function ClipEditor({ ids }: { ids: string[] }) {
  const clips = useEditor((s) => s.project.clips);
  const list = useMemo(() => clips.filter((c) => ids.includes(c.id)), [clips, ids]);
  const c = list[0];
  if (!c) return null;
  const up = (patch: Partial<AudioClip>) => { for (const x of list) editor().updateClip(x.id, patch, { noHistory: true }); };
  return (
    <>
      <div className="insp-head">
        <Icon name={c.source.kind === 'music' ? 'music' : 'wave'} style={{ color: 'var(--audio)' }} />
        <div className="insp-title"><b>{list.length > 1 ? `${list.length} clips` : c.name}</b><small>{clipSourceLabel(c)}</small></div>
      </div>
      <Section id="insp.clip" title="Clip">
        {list.length === 1 && <Row label="Name"><TextField value={c.name} onChange={(v) => up({ name: v })} /></Row>}
        <Row label="Gain"><Scrub value={c.gain} min={0} max={2} step={0.01} scale={100} unit="%" onChange={(v) => up({ gain: v })} /></Row>
        <Row label="Fade in"><Scrub value={c.fadeIn} min={0} max={c.dur} step={0.01} unit=" s" onChange={(v) => up({ fadeIn: v })} /></Row>
        <Row label="Fade out"><Scrub value={c.fadeOut} min={0} max={c.dur} step={0.01} unit=" s" onChange={(v) => up({ fadeOut: v })} /></Row>
        <Row label="Source offset"><Scrub value={c.offset} min={0} step={0.01} unit=" s" onChange={(v) => up({ offset: v })} /></Row>
        {list.length === 1 && <Row label="Start"><TimeScrub value={c.t} onChange={(t) => up({ t })} /></Row>}
        <Row label="Mute"><Check checked={c.muted} onChange={(m) => batch(() => up({ muted: m }))} /></Row>
      </Section>
    </>
  );
}

function groupProps(defs: PropDef[]): [string, PropDef[]][] {
  const out = new Map<string, PropDef[]>();
  for (const d of defs) {
    if (!out.has(d.group)) out.set(d.group, []);
    out.get(d.group)!.push(d);
  }
  return [...out];
}

function LayerInspector({ id }: { id: string }) {
  const layer = useEditor((s) => s.project.layers.find((l) => l.id === id));
  // Every selected layer of the primary's type follows edits, so one action changes them all.
  const idsKey = useEditor((s) => {
    const primary = s.project.layers.find((l) => l.id === id);
    return s.project.layers.filter((l) => l.id === id || (s.sel.layers.includes(l.id) && l.type === primary?.type)).map((l) => l.id).join(',');
  });
  const totalSel = useEditor((s) => s.sel.layers.length);
  const ids = useMemo(() => {
    const rest = idsKey.split(',').filter((x) => x && x !== id);
    return [id, ...rest];
  }, [idsKey, id]);
  const duration = useEditor((s) => s.project.duration);
  if (!layer) return null;
  const def = LAYER_DEFS[layer.type];
  const groups = groupProps(def.props);
  const lock = layer.locked;
  const trim = (patch: Partial<Layer>) => editor().updateLayer(id, patch);
  const fpsStep = 1 / editor().project.fps;
  return (
    <>
      <div className="insp-head" style={{ borderLeftColor: `var(--lt-${layer.type})` }}>
        <LayerIcon type={layer.type} />
        <div className="insp-title">
          <TextField className="bare" value={layer.name} onChange={(v) => editor().updateLayer(id, { name: v })} ariaLabel="Layer name" />
          <small>{ids.length > 1 ? `Editing ${ids.length} × ${def.label}${totalSel > ids.length ? ` (of ${totalSel} selected)` : ''}` : def.label}</small>
        </div>
        {lock && <Icon name="lock" size={12} className="dim" />}
      </div>
      <div className="insp-times">
        <span><label>In</label><TimeScrub value={layer.start} max={layer.end - fpsStep} disabled={lock} onChange={(t) => trim({ start: t })} /></span>
        <span><label>Out</label><TimeScrub value={layer.end} max={Math.max(duration, layer.end)} disabled={lock} onChange={(t) => trim({ end: Math.max(t, layer.start + fpsStep) })} /></span>
        <span><label>Dur</label><span className="mono dim">{formatTimecode(layer.end - layer.start, editor().project.fps)}</span></span>
      </div>
      {def.settings.length > 0 && (
        <Section id={`set.${layer.type}`} title="Settings"><SettingsRows layer={layer} ids={ids} disabled={lock} /></Section>
      )}
      {groups.map(([g, defs], i) => (
        <Section key={g} id={`grp.${g}`} title={g} def={i < 2}>
          {defs.map((d) => <PropRow key={d.key} def={d} track={layer.props[d.key]} ids={ids} disabled={lock} />)}
        </Section>
      ))}
    </>
  );
}

function Summary() {
  const p = useEditor((s) => s.project);
  const setUI = useEditor((s) => s.setUI);
  const stat = (label: string, value: string | number) => <div className="stat"><label>{label}</label><span className="mono">{value}</span></div>;
  return (
    <>
      <div className="insp-head">
        <Icon name="film" />
        <div className="insp-title"><b>{p.name}</b><small>Nothing selected</small></div>
      </div>
      <div className="stats">
        {stat('Frame', `${p.width} × ${p.height}`)}
        {stat('Rate', `${p.fps} fps`)}
        {stat('Length', formatTimecode(p.duration, p.fps))}
        {stat('Tempo', `${+p.bpm.toFixed(2)} BPM`)}
        {stat('Layers', p.layers.length)}
        {stat('Sync hits', p.hits.length)}
        {stat('Audio clips', p.clips.length)}
        {stat('Markers', p.markers.length)}
      </div>
      <div className="tips">
        <h4>Getting around</h4>
        <ul>
          <li><kbd>Space</kbd> plays. While it plays, tap <kbd>1</kbd>–<kbd>0</kbd> to stamp sync hits to the music.</li>
          <li>Press the stopwatch on any property to animate it. Keys land at the playhead.</li>
          <li>Drag any number to scrub it. Hold <kbd>Shift</kbd> for 10×, <kbd>Alt</kbd> for 0.1×.</li>
          <li><kbd>B</kbd> toggles beat snap. <kbd>G</kbd> swaps dope sheet and graph.</li>
        </ul>
        <Btn ghost small onClick={() => setUI({ shortcutsOpen: true })}>All shortcuts</Btn>
      </div>
    </>
  );
}

export function Inspector() {
  const sel = useEditor((s) => s.sel);
  const keyLayer = useEditor((s) => (s.sel.keys.length ? findKey(s.project, s.sel.keys[0])?.layer.id ?? null : null));
  const layerId = sel.layers[0] ?? keyLayer;
  return (
    <>
      <div className="tabs tabs-static"><span className="tabs-title">Inspector</span></div>
      <div className="panel-scroll scroll inspector">
        <KeyPanel />
        {sel.hits.length > 0 ? <HitEditor ids={sel.hits} />
          : sel.clips.length > 0 ? <ClipEditor ids={sel.clips} />
          : layerId ? <LayerInspector key={layerId} id={layerId} />
          : <Summary />}
      </div>
    </>
  );
}
