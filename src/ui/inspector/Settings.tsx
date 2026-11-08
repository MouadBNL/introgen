import type { Layer } from '../../core/types';
import { editor, useEditor } from '../../core/store';
import { FONTS, LAYER_DEFS, type SettingDef } from '../../core/schema';
import { uid } from '../../core/rng';
import { Check, IconBtn, Row, Scrub, Select, TextField, type Opt } from '../controls';
import { batch } from '../actions';
import { pickFile, readDataUrl } from '../files';

const NEW_FONT = '__import_font__';

async function importAsset(ids: string[], key: string, kind: 'font' | 'image' | 'svg', accept: string) {
  const file = await pickFile(accept);
  if (!file) return;
  const e = editor();
  try {
    const dataUrl = await readDataUrl(file);
    const id = uid('a');
    // Fonts resolve by name in the renderer, everything else by asset id.
    const name = kind === 'font' ? file.name.replace(/\.[^.]+$/, '') : file.name;
    e.commit(`Import ${kind}`, (p) => {
      p.assets.push({ id, kind, name, dataUrl });
      for (const l of p.layers) if (ids.includes(l.id)) l.settings[key] = kind === 'font' ? name : id;
    });
  } catch (err) {
    console.error(err);
    e.toast(`Could not read ${file.name}`);
  }
}

function FontSelect({ value, onChange, ids, settingKey, disabled }: { value: string; onChange: (v: string) => void; ids: string[]; settingKey: string; disabled?: boolean }) {
  const custom = useEditor((s) => s.project.assets).filter((a) => a.kind === 'font');
  const options: Opt<string>[] = [
    ...FONTS.map((f) => ({ value: f, label: f, style: { fontFamily: `'${f}', var(--font-ui)` } })),
    ...custom.map((a) => ({ value: a.name, label: a.name, hint: 'Imported' })),
    { value: NEW_FONT, label: 'Import font…', sep: true, action: () => importAsset(ids, settingKey, 'font', '.ttf,.otf,.woff') },
  ];
  return <Select value={value} options={options} onChange={onChange} disabled={disabled} />;
}

function AssetSelect({ def, value, onChange, ids, disabled }: { def: SettingDef; value: string; onChange: (v: string) => void; ids: string[]; disabled?: boolean }) {
  const kind = def.assetKind ?? 'image';
  const assets = useEditor((s) => s.project.assets).filter((a) => a.kind === kind);
  const accept = kind === 'svg' ? '.svg,image/svg+xml' : 'image/*';
  const options: Opt<string>[] = [{ value: '', label: 'None' }, ...assets.map((a) => ({ value: a.id, label: a.name }))];
  return (
    <div className="inline">
      <Select value={value ?? ''} options={options} onChange={onChange} disabled={disabled} />
      <IconBtn icon="upload" title="Upload a file" disabled={disabled} onClick={() => importAsset(ids, def.key, kind, accept)} />
    </div>
  );
}

function SettingRow({ def, layer, ids, disabled }: { def: SettingDef; layer: Layer; ids: string[]; disabled?: boolean }) {
  const value = layer.settings[def.key] ?? def.def;
  const raw = (v: unknown) => { for (const id of ids) editor().setSetting(id, def.key, v); };
  const once = (v: unknown) => batch(() => raw(v));

  switch (def.kind) {
    case 'text': return <Row label={def.label}><TextField value={String(value)} onChange={raw} disabled={disabled} /></Row>;
    case 'multiline': return <Row label={def.label} stack><TextField multiline value={String(value)} onChange={raw} disabled={disabled} /></Row>;
    case 'number': {
      const step = def.step ?? 0.01;
      const whole = step >= 1;
      return (
        <Row label={def.label}>
          <div className="inline">
            <Scrub value={Number(value)} min={def.min} max={def.max} step={step} disabled={disabled} onChange={(v) => raw(whole ? Math.round(v) : v)} />
            {def.key === 'seed' && <IconBtn icon="dice" title="New seed" disabled={disabled} onClick={() => once(Math.floor(Math.random() * 10000))} />}
          </div>
        </Row>
      );
    }
    case 'select': return <Row label={def.label}><Select value={String(value)} options={def.options ?? []} onChange={once} disabled={disabled} /></Row>;
    case 'bool': return <Row label={def.label}><Check checked={!!value} onChange={once} disabled={disabled} /></Row>;
    case 'font': return <Row label={def.label}><FontSelect value={String(value)} onChange={once} ids={ids} settingKey={def.key} disabled={disabled} /></Row>;
    case 'asset': return <Row label={def.label}><AssetSelect def={def} value={String(value)} onChange={once} ids={ids} disabled={disabled} /></Row>;
  }
}

export function SettingsRows({ layer, ids, disabled }: { layer: Layer; ids: string[]; disabled?: boolean }) {
  return <>{LAYER_DEFS[layer.type].settings.map((d) => <SettingRow key={d.key} def={d} layer={layer} ids={ids} disabled={disabled} />)}</>;
}
