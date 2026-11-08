import { useEffect, useState } from 'react';
import { editor, useEditor } from '../../core/store';
import { HIT_DEF, LAYER_DEFS } from '../../core/schema';
import { Icon, LayerIcon } from '../icons';
import { Section } from '../controls';
import { applyTemplate, batch, loadTemplates, stampHits, stampTime, type TemplateInfo } from '../actions';
import { COMBOS, GRADES, MATERIALS, MATERIAL_TYPES, RECIPES, recipeLayer, type GradePreset, type MaterialPreset, type Recipe } from '../presets';

function addRecipe(r: Recipe) {
  const e = editor();
  const t = stampTime();
  e.addLayer(r.type, recipeLayer(r, t, e.project.duration));
  e.toast(`${r.name} added`);
}

function applyMaterial(m: MaterialPreset) {
  const e = editor();
  const targets = e.project.layers.filter((l) => e.sel.layers.includes(l.id) && MATERIAL_TYPES.includes(l.type));
  if (!targets.length) { e.toast('Select a text, logo, splash or debris layer first'); return; }
  batch(() => { for (const l of targets) for (const k in m.values) e.setProp(l.id, k, m.values[k]); });
  e.toast(`${m.name} applied to ${targets.length} ${targets.length === 1 ? 'layer' : 'layers'}`);
}

function applyGrade(g: GradePreset) {
  const e = editor();
  batch(() => {
    const post = e.project.layers.find((l) => l.type === 'post')?.id ?? e.addLayer('post');
    for (const k in g.values) e.setProp(post, k, g.values[k]);
  });
  e.toast(`${g.name} grade applied`);
}

function Templates() {
  const [list, setList] = useState<TemplateInfo[] | null>(null);
  useEffect(() => { loadTemplates().then(setList); }, []);
  if (!list?.length) return <div className="empty small">{list ? 'No templates installed.' : 'Loading…'}</div>;
  return (
    <div className="card-grid">
      {list.map((t) => (
        <button key={t.id} type="button" className="tpl" title={t.blurb} onClick={() => applyTemplate(t)}>
          <b>{t.name}</b><small>{t.blurb}</small>
        </button>
      ))}
    </div>
  );
}

export function LibraryPanel() {
  const hasMaterialTarget = useEditor((s) => s.project.layers.some((l) => s.sel.layers.includes(l.id) && MATERIAL_TYPES.includes(l.type)));
  return (
    <div className="panel-scroll scroll">
      <Section id="lib.templates" title="Templates"><Templates /></Section>
      <Section id="lib.presets" title="Presets" badge={<span className="section-note">at playhead</span>}>
        <div className="list">
          {RECIPES.map((r) => (
            <button key={r.id} type="button" className="list-item" title={`${LAYER_DEFS[r.type].label}, ${r.dur}s`} onClick={() => addRecipe(r)}>
              <LayerIcon type={r.type} />
              <span className="list-text"><b>{r.name}</b><small>{r.blurb}</small></span>
              <Icon name="plus" size={12} className="list-add" />
            </button>
          ))}
        </div>
      </Section>
      <Section id="lib.combos" title="Sync Combos" badge={<span className="section-note">at playhead</span>}>
        <div className="combo-grid">
          {COMBOS.map((c) => (
            <button key={c.id} type="button" className="combo" title={c.blurb} onClick={() => stampHits(c.hits, c.name)}>
              <b>{c.name}</b>
              <span className="combo-dots">{c.hits.map((h) => <i key={h.kind} style={{ background: HIT_DEF[h.kind].color }} />)}</span>
              <small>{c.blurb}</small>
            </button>
          ))}
        </div>
      </Section>
      <Section id="lib.materials" title="Materials" badge={hasMaterialTarget ? undefined : <span className="section-note">select a layer</span>}>
        <div className="swatch-grid">
          {MATERIALS.map((m) => (
            <button key={m.id} type="button" className="mat" onClick={() => applyMaterial(m)}>
              <span className="mat-ball" style={{ background: `radial-gradient(circle at 34% 30%, #fff 0, ${m.values.color} 28%, ${m.values.color2} 86%)`, boxShadow: Number(m.values.emissiveAmt) > 1 ? `0 0 8px ${m.values.emissive}` : undefined }} />
              <span>{m.name}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section id="lib.grades" title="Grades" badge={<span className="section-note">Post FX</span>}>
        <div className="swatch-grid">
          {GRADES.map((g) => (
            <button key={g.id} type="button" className="mat" onClick={() => applyGrade(g)}>
              <span className="grade-chip" style={{ background: g.swatch }} />
              <span>{g.name}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
