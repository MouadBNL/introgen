import { memo, useState } from 'react';
import type { Band, PropValue, Track } from '../../core/types';
import { editor, transport, useTransport } from '../../core/store';
import type { PropDef } from '../../core/schema';
import { evalKeys } from '../../core/eval';
import { hashString } from '../../core/rng';
import { playback } from '../../core/playback';
import { Icon } from '../icons';
import { Check, Row, Scrub, Select, type Opt } from '../controls';
import { Popover } from '../popover';
import { ColorField } from './ColorPicker';
import { batch } from '../actions';

const EPS = 1 / 240;

/** Scrub props for a numeric PropDef. Shared with the keyframe editor. */
export function numberProps(def: PropDef) {
  if (def.kind === 'percent') return { min: def.min, max: def.max, step: def.step ?? 0.01, scale: 100, unit: '%' };
  if (def.kind === 'angle') return { min: def.min, max: def.max, step: def.step ?? 1, unit: '°', decimals: 1 };
  return { min: def.min, max: def.max, step: def.step ?? 0.01, unit: def.unit ? ` ${def.unit}` : '' };
}

const BANDS: Opt<Band>[] = [{ value: 'low', label: 'Low' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High' }, { value: 'full', label: 'Full' }];

function ExtrasPopover({ anchor, onClose, ids, def, track }: { anchor: HTMLElement; onClose: () => void; ids: string[]; def: PropDef; track: Track }) {
  const set = (patch: Partial<Track>) => { for (const id of ids) editor().setTrack(id, def.key, patch); };
  const once = (patch: Partial<Track>) => batch(() => set(patch));
  const angle = def.kind === 'angle';
  const span = angle ? 180 : def.max != null && def.min != null ? def.max - def.min : 10;
  const seed = hashString(`${ids[0]}.${def.key}`) % 9973;
  const w = track.wiggle;
  const a = track.audio;
  const step = angle ? 0.1 : def.step ?? 0.01;
  const unit = angle ? '°' : '';
  return (
    <Popover anchor={anchor} onClose={onClose} placement="bottom-end" className="pop-extras">
      <div className="pop-title">{def.label}</div>
      <div className="extras-group">
        <Check checked={!!w} label="Wiggle" onChange={(on) => once({ wiggle: on ? { amp: +(span * 0.02).toFixed(3) || step, freq: 4, seed } : undefined })} />
        {w && <>
          <Row label="Amount"><Scrub value={w.amp} step={step} unit={unit} onChange={(v) => set({ wiggle: { ...w, amp: v } })} /></Row>
          <Row label="Frequency"><Scrub value={w.freq} min={0} max={60} step={0.1} unit=" Hz" onChange={(v) => set({ wiggle: { ...w, freq: v } })} /></Row>
        </>}
      </div>
      <div className="extras-group">
        <Check checked={!!a} label="Audio link" onChange={(on) => once({ audio: on ? { band: 'low', amount: +(span * 0.1).toFixed(3) || step } : undefined })} />
        {a && <>
          <Row label="Band"><Select value={a.band} options={BANDS} onChange={(v) => once({ audio: { ...a, band: v } })} /></Row>
          <Row label="Amount"><Scrub value={a.amount} step={step} unit={unit} onChange={(v) => set({ audio: { ...a, amount: v } })} /></Row>
        </>}
      </div>
    </Popover>
  );
}

function KeyNav({ layerId, propKey, track }: { layerId: string; propKey: string; track: Track }) {
  const keys = track.keys;
  const nav = useTransport((s) => (keys[0].t < s.time - EPS ? 1 : 0) | (keys[keys.length - 1].t > s.time + EPS ? 2 : 0));
  const here = useTransport((s) => keys.find((k) => Math.abs(k.t - s.time) < EPS)?.id ?? null);
  const jump = (d: 1 | -1) => {
    const t = transport().time;
    const k = d > 0 ? keys.find((x) => x.t > t + EPS) : [...keys].reverse().find((x) => x.t < t - EPS);
    if (k) playback.seek(k.t);
  };
  return (
    <span className="keynav">
      <button type="button" title="Previous keyframe" disabled={!(nav & 1)} onClick={() => jump(-1)}><Icon name="chevL" size={10} /></button>
      <button type="button" className={here ? 'on' : ''} title={here ? 'Remove keyframe' : 'Add keyframe'} onClick={() => here ? editor().deleteKeys([here]) : editor().addKeyAtPlayhead(layerId, propKey)}>
        <Icon name={here ? 'diamondOn' : 'diamond'} size={11} />
      </button>
      <button type="button" title="Next keyframe" disabled={!(nav & 2)} onClick={() => jump(1)}><Icon name="chevR" size={10} /></button>
    </span>
  );
}

export const PropRow = memo(function PropRow({ def, track, ids, disabled }: { def: PropDef; track: Track; ids: string[]; disabled?: boolean }) {
  const [moreEl, setMoreEl] = useState<HTMLElement | null>(null);
  const animated = track.keys.length > 0;
  // Static tracks never change with time, so this selector only re-renders animated rows.
  const live: PropValue = useTransport((s) => (track.keys.length ? evalKeys(track.keys, s.time) : track.value));
  const setAll = (v: PropValue) => { for (const id of ids) editor().setProp(id, def.key, v, { noHistory: true }); };
  const hasExtras = !!track.wiggle || !!track.audio;

  return (
    <div className={`prop${animated ? ' animated' : ''}`}>
      <button type="button" className={`watch${animated ? ' on' : ''}`} disabled={disabled} aria-pressed={animated} title={animated ? 'Remove animation' : 'Animate this property'}
        onClick={() => batch(() => { for (const id of ids) editor().toggleAnimated(id, def.key); })}>
        <Icon name="stopwatch" size={12} />
      </button>
      <span className="prop-label" title={def.label} onClick={() => { if (animated) editor().setUI({ graphProp: { layer: ids[0], key: def.key } }); }}>{def.label}</span>
      <span className="prop-value">
        {def.kind === 'color'
          ? <ColorField value={String(live)} onChange={setAll} disabled={disabled} />
          : <Scrub value={Number(live)} onChange={setAll} disabled={disabled} {...numberProps(def)} />}
      </span>
      <span className="prop-keys">{animated && <KeyNav layerId={ids[0]} propKey={def.key} track={track} />}</span>
      {def.kind === 'color' ? <span /> : (
        <button type="button" className={`more${hasExtras ? ' on' : ''}${moreEl ? ' open' : ''}`} disabled={disabled} title="Wiggle and audio link"
          onClick={(e) => { const t = e.currentTarget; setMoreEl((v) => (v ? null : t)); }}>
          {track.wiggle && track.audio ? <><i className="dot-w" /><i className="dot-a" /></>
            : track.wiggle ? <Icon name="wiggle" size={12} className="tint-w" />
            : track.audio ? <Icon name="wave" size={12} className="tint-a" />
            : <Icon name="more" size={12} />}
        </button>
      )}
      {moreEl && <ExtrasPopover anchor={moreEl} onClose={() => setMoreEl(null)} ids={ids} def={def} track={track} />}
    </div>
  );
});
