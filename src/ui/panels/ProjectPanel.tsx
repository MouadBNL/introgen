import { useEditor } from '../../core/store';
import { Icon, type IconName } from '../icons';
import { IconBtn, Row, Scrub, Section, Select, Seg, TextField, type Opt } from '../controls';
import { removeAsset } from '../actions';
import { confirmAction } from '../shell';
import type { Asset, AssetKind } from '../../core/types';

const RES: [number, number, string][] = [
  [1280, 720, '720p'], [1920, 1080, '1080p'], [2560, 1440, '1440p'], [3840, 2160, '4K UHD'], [1080, 1920, 'Vertical'],
];
const RES_OPTS: Opt<string>[] = [
  ...RES.map(([w, h, n]) => ({ value: `${w}x${h}`, label: `${w} × ${h}`, hint: n })),
];
const ASSET_ICON: Record<AssetKind, IconName> = { audio: 'speaker', image: 'image', font: 'text2d', svg: 'logo' };

export function ProjectPanel() {
  const p = useEditor((s) => s.project);
  const set = useEditor((s) => s.setProjectMeta);
  const res = `${p.width}x${p.height}`;
  const known = RES_OPTS.some((o) => o.value === res);

  const remove = async (a: Asset) => {
    const used = p.clips.some((c) => c.source.kind === 'asset' && c.source.assetId === a.id) || p.layers.some((l) => l.settings.asset === a.id);
    if (used && !(await confirmAction(`Remove ${a.name}?`, 'It is in use. Clips and layers that reference it lose it.', 'Remove'))) return;
    removeAsset(a);
  };

  return (
    <div className="panel-scroll scroll">
      <Section id="project.comp" title="Composition">
        <Row label="Name"><TextField value={p.name} onChange={(v) => set({ name: v })} /></Row>
        <Row label="Resolution">
          <Select value={res} options={known ? RES_OPTS : [...RES_OPTS, { value: res, label: `${p.width} × ${p.height}`, hint: 'Custom' }]}
            onChange={(v) => { const [w, h] = v.split('x').map(Number); set({ width: w, height: h }); }} />
        </Row>
        <Row label="Frame rate">
          <Seg value={p.fps} onChange={(v) => set({ fps: v })} options={[24, 30, 60].map((f) => ({ value: f, label: String(f) }))} />
        </Row>
        <Row label="Duration"><Scrub value={p.duration} min={0.5} max={120} step={0.05} unit=" s" onChange={(v) => set({ duration: v })} /></Row>
      </Section>
      <Section id="project.tempo" title="Tempo">
        <Row label="BPM"><Scrub value={p.bpm} min={40} max={260} step={0.1} onChange={(v) => set({ bpm: v })} /></Row>
        <Row label="Beat offset"><Scrub value={p.beatOffset} min={-4} max={4} step={0.001} unit=" s" onChange={(v) => set({ beatOffset: v })} /></Row>
      </Section>
      <Section id="project.audio" title="Output">
        <Row label="Master gain"><Scrub value={p.masterGain} min={0} max={2} step={0.01} scale={100} unit="%" onChange={(v) => set({ masterGain: v })} /></Row>
      </Section>
      <Section id="project.assets" title="Assets" badge={<span className="section-note">{p.assets.length}</span>}>
        {p.assets.length ? (
          <div className="list dense">
            {p.assets.map((a) => (
              <div key={a.id} className="asset-row">
                <Icon name={ASSET_ICON[a.kind]} size={13} />
                <span className="asset-name" title={a.name}>{a.name}</span>
                <span className="mono dim">{Math.max(1, Math.round((a.dataUrl.length * 0.75) / 1024))} KB</span>
                <IconBtn icon="trash" size={12} title="Remove asset" onClick={() => remove(a)} />
              </div>
            ))}
          </div>
        ) : <div className="empty small">Imported audio, images, fonts and SVGs show up here.</div>}
      </Section>
    </div>
  );
}
