import { editor, useEditor } from '../../core/store';
import { EASE_PRESETS } from '../../core/eval';
import { HIT_DEF, HIT_DEFS } from '../../core/schema';
import { useSyncExternalStore } from 'react';
import type { Ctl } from './ctl';
import { MAX_PPS, MIN_PPS } from './model';
import { FitAll, Magnet } from './Glyphs';

const QUICK_EASES = ['linear', 'hold', 'smooth', 'snap', 'whip', 'overshoot'];
/** ui.beatDiv is subdivisions per beat, so a whole 4/4 bar is a quarter of one. */
const DIVISIONS: { div: number; label: string }[] = [
  { div: 0.25, label: '1/1 bar' }, { div: 0.5, label: '1/2' }, { div: 1, label: '1/4 beat' },
  { div: 2, label: '1/8' }, { div: 4, label: '1/16' }, { div: 8, label: '1/32' },
];

const toSlider = (pps: number) => (Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 1000;
const fromSlider = (v: number) => MIN_PPS * (MAX_PPS / MIN_PPS) ** (v / 1000);

export function Toolbar({ ctl }: { ctl: Ctl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const mode = useEditor((s) => s.ui.timelineMode);
  const snap = useEditor((s) => s.ui.snapBeats);
  const div = useEditor((s) => s.ui.beatDiv);
  const pps = useEditor((s) => s.ui.pxPerSec);
  const tapKind = useEditor((s) => s.ui.tapKind);
  const hasKeys = useEditor((s) => s.sel.keys.length > 0);
  const setUI = useEditor((s) => s.setUI);
  const animatedOnly = ctl.persist.animatedOnly;

  return (
    <div className="tl-toolbar">
      <div className="tl-seg">
        <button className={mode === 'dope' ? 'on' : ''} onClick={() => setUI({ timelineMode: 'dope' })}>Dope Sheet</button>
        <button className={mode === 'graph' ? 'on' : ''} onClick={() => setUI({ timelineMode: 'graph' })}>Graph</button>
      </div>
      <i className="tl-sep" />
      <div className="tl-snap">
        <button className={`tl-tool${snap ? ' on' : ''}`} onClick={() => setUI({ snapBeats: !snap })} title="Snap to the beat grid. Hold Shift while dragging to invert.">
          <Magnet /><span>Beat</span>
        </button>
        <select value={div} onChange={(e) => setUI({ beatDiv: +e.target.value })} aria-label="Grid division">
          {DIVISIONS.map((d) => <option key={d.div} value={d.div}>{d.label}</option>)}
        </select>
      </div>
      <i className="tl-sep" />
      <div className="tl-eases">
        {QUICK_EASES.map((id) => {
          const p = EASE_PRESETS.find((e) => e.id === id)!;
          return <button key={id} className="tl-tool" disabled={!hasKeys} onClick={() => editor().setKeysEase(editor().sel.keys, p.ease)}>{p.label}</button>;
        })}
      </div>
      {mode === 'dope' && <>
        <i className="tl-sep" />
        <div className="tl-seg small">
          <button className={animatedOnly ? 'on' : ''} onClick={() => ctl.setAnimatedOnly(true)}>Animated</button>
          <button className={!animatedOnly ? 'on' : ''} onClick={() => ctl.setAnimatedOnly(false)}>All</button>
        </div>
      </>}
      <div className="tl-spring" />
      <div className="tl-stamp">
        <span className="tl-stamp-name" style={{ color: HIT_DEF[tapKind].color }}>{HIT_DEF[tapKind].label}</span>
        {HIT_DEFS.map((h) => (
          <button key={h.kind} className={tapKind === h.kind ? 'on' : ''} style={{ '--chip': h.color } as React.CSSProperties}
            onClick={() => setUI({ tapKind: h.kind })} title={`${h.label}: ${h.blurb}`} aria-label={h.label} />
        ))}
      </div>
      <i className="tl-sep" />
      <input className="tl-zoom" type="range" min={0} max={1000} value={toSlider(pps)} aria-label="Timeline zoom"
        onChange={(e) => ctl.zoomTo(fromSlider(+e.target.value))} />
      <button className="tl-tool icon" onClick={() => ctl.fitAll()} title="Fit everything"><FitAll /></button>
    </div>
  );
}
