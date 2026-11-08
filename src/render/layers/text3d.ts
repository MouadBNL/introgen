import * as THREE from 'three';
import type opentype from 'opentype.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { getFont, pathToShapes } from '../fonts';
import { applyMarble, createMarble, enableMP } from '../material';
import { applyTransform, disposeTree, type LayerNode, type NodeFactory } from './base';
import { hash1, noise1 } from '../../core/rng';
import type { Values } from '../../core/eval';

const FONT_SIZE = 2.4;

function extrude(shapes: THREE.Shape[], depth: number, bevel: number, segs: number, curve = 10): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(0.001, depth), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel * 0.5,
    bevelSegments: segs, curveSegments: curve, steps: 1,
  });
  g.deleteAttribute('uv');
  const c = toCreasedNormals(g, Math.PI / 5);
  g.dispose();
  return c;
}

function rank(order: string, i: number, n: number, seed: number): number {
  const r = n > 1 ? i / (n - 1) : 0;
  switch (order) {
    case 'rtl': return 1 - r;
    case 'center': return Math.abs(r - 0.5) * 2;
    case 'edges': return 1 - Math.abs(r - 0.5) * 2;
    case 'random': return hash1(i * 3.3 + seed);
    default: return r;
  }
}

interface Letter { mesh: THREE.Mesh; home: THREE.Vector3; rank: number; idx: number }

export const createText3D: NodeFactory = (layer) => {
  const s = layer.settings;
  const root = new THREE.Group();
  const mat = createMarble({ cacheKey: 'mp' });
  enableMP(mat);
  const letters: Letter[] = [];
  const font = getFont(s.font);

  if (font) {
    const text: string = s.text || ' ';
    const scale = FONT_SIZE / font.unitsPerEm;
    // Direct cmap lookup: titles don't need ligature shaping, and GSUB parsing fails on some fonts.
    const glyphs = Array.from(text).map((ch) => font.charToGlyph(ch));
    const kerning = (a: opentype.Glyph, b: opentype.Glyph) => {
      try { return font.getKerningValue(a, b) || 0; } catch { return 0; }
    };
    let x = 0;
    const items: { glyph: any; x: number }[] = [];
    for (let i = 0; i < glyphs.length; i++) {
      items.push({ glyph: glyphs[i], x });
      const kern = i < glyphs.length - 1 ? kerning(glyphs[i], glyphs[i + 1]) : 0;
      x += ((glyphs[i].advanceWidth ?? 0) + kern) * scale + s.tracking * FONT_SIZE;
    }
    const total = x - s.tracking * FONT_SIZE;
    const capH = 0.7 * FONT_SIZE;
    const offX = -total / 2, offY = -capH / 2, offZ = -s.depth / 2;
    const n = items.length;
    items.forEach((it, i) => {
      const shapes = pathToShapes(it.glyph.getPath(0, 0, font.unitsPerEm), scale);
      if (!shapes.length) return;
      const geo = extrude(shapes, s.depth, s.bevel, s.bevelSegs);
      geo.computeBoundingBox();
      const c = geo.boundingBox!.getCenter(new THREE.Vector3());
      // Keep word-space coordinates for the marble so veins flow across letters.
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const mp = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) {
        mp[k * 3] = pos.getX(k) + it.x;
        mp[k * 3 + 1] = pos.getY(k);
        mp[k * 3 + 2] = pos.getZ(k);
      }
      geo.setAttribute('aMP', new THREE.BufferAttribute(mp, 3));
      geo.translate(-c.x, -c.y, -c.z); // pivot at the letter's center
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      const home = new THREE.Vector3(it.x + c.x + offX, c.y + offY, c.z + offZ);
      letters.push({ mesh, home, rank: rank(s.order, i, n, s.seed), idx: i });
      root.add(mesh);
    });
  }

  const d = Math.PI / 180;
  return {
    object: root,
    update(v: Values, ctx) {
      applyTransform(root, v);
      applyMarble(mat, v, v.opacity);
      root.visible = v.opacity > 0.001;
      const S = v.anStagger * 3;
      const jitterStep = Math.floor(ctx.t * 14);
      for (const L of letters) {
        const raw = Math.min(1, Math.max(0, v.anRev * (1 + S) - L.rank * S));
        const p = 1 - Math.pow(1 - raw, 3);
        const f = 1 - p;
        const sc = v.anS + (1 - v.anS) * p;
        L.mesh.visible = raw > 0 && sc > 0.001;
        L.mesh.position.set(L.home.x + v.anOx * f, L.home.y + v.anOy * f, L.home.z + v.anOz * f);
        const sp = v.flipSpread;
        const turns = v.flip > 0 ? Math.min(Math.ceil(v.flip), Math.max(0, v.flip * (1 + sp) - L.rank * sp)) : 0;
        L.mesh.rotation.set(v.anRx * f * d + turns * Math.PI * 2, v.anRy * f * d, v.anRz * f * d, 'YXZ');
        L.mesh.scale.setScalar(Math.max(1e-4, sc));
        if (v.letterJitter > 0) {
          const j = v.letterJitter;
          L.mesh.position.x += noise1(jitterStep * 3.1, L.idx) * j * 0.3;
          L.mesh.position.y += noise1(jitterStep * 2.3 + 8, L.idx) * j;
          L.mesh.position.z += noise1(jitterStep * 1.7 + 4, L.idx) * j * 2;
          L.mesh.rotation.z += noise1(jitterStep * 1.3 + 2, L.idx) * j * 0.4;
        }
      }
    },
    dispose() { disposeTree(root); mat.dispose(); },
  };
};

const SHAPE_FNS: Record<string, () => THREE.Shape[]> = {
  bolt: () => [poly([[0.6, 2.4], [-1.3, -0.2], [-0.15, -0.2], [-0.7, -2.4], [1.3, 0.5], [0.15, 0.5], [1, 2.4]])],
  chevron: () => [poly([[-2, 1.2], [0, -0.6], [2, 1.2], [2, -0.4], [0, -2.2], [-2, -0.4]])],
  shield: () => {
    const s = new THREE.Shape();
    s.moveTo(0, 2.3); s.lineTo(1.9, 1.6); s.lineTo(1.9, 0);
    s.bezierCurveTo(1.9, -1.2, 0.9, -2, 0, -2.4); s.bezierCurveTo(-0.9, -2, -1.9, -1.2, -1.9, 0);
    s.lineTo(-1.9, 1.6); s.closePath();
    return [s];
  },
  crown: () => [poly([[-2.2, -1.5], [-2.2, 1.4], [-1.1, 0.2], [0, 1.9], [1.1, 0.2], [2.2, 1.4], [2.2, -1.5]])],
  hex: () => {
    const outer = ngon(6, 2.3, Math.PI / 6);
    outer.holes.push(new THREE.Path(ngon(6, 1.4, Math.PI / 6).getPoints().reverse()));
    return [outer];
  },
  star: () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 1 : 2.4, a = Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return [poly(pts)];
  },
  ring: () => {
    const s = new THREE.Shape();
    s.absarc(0, 0, 2.3, 0, Math.PI * 2, false);
    const h = new THREE.Path();
    h.absarc(0, 0, 1.5, 0, Math.PI * 2, true);
    s.holes.push(h);
    return [s];
  },
};
function poly(pts: [number, number][]) {
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}
function ngon(n: number, r: number, off: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([Math.cos(off + (i * Math.PI * 2) / n) * r, Math.sin(off + (i * Math.PI * 2) / n) * r]);
  return poly(pts);
}

function svgShapes(dataUrl: string): THREE.Shape[] {
  const text = dataUrl.includes('base64,') ? atob(dataUrl.split('base64,')[1]) : decodeURIComponent(dataUrl.split(',')[1] ?? '');
  const data = new SVGLoader().parse(text);
  const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
  if (!shapes.length) return SHAPE_FNS.bolt();
  // Normalize to about 4.6 units, Y up.
  const box = new THREE.Box2();
  shapes.forEach((s) => s.getPoints().forEach((pt) => box.expandByPoint(pt)));
  const c = box.getCenter(new THREE.Vector2());
  const k = 4.6 / Math.max(1e-3, Math.max(box.max.x - box.min.x, box.max.y - box.min.y));
  const tr = (pts: THREE.Vector2[]) => pts.map((q) => new THREE.Vector2((q.x - c.x) * k, -(q.y - c.y) * k));
  return shapes.map((s) => {
    const o = new THREE.Shape(tr(s.getPoints(12)));
    o.holes = s.holes.map((h) => new THREE.Path(tr(h.getPoints(12))));
    return o;
  });
}

export const createLogo: NodeFactory = (layer, project) => {
  const s = layer.settings;
  const asset = project.assets.find((a) => a.id === s.asset);
  const shapes = s.shape === 'svg' && asset ? svgShapes(asset.dataUrl) : (SHAPE_FNS[s.shape] ?? SHAPE_FNS.bolt)();
  const geo = extrude(shapes, s.depth, s.bevel, s.bevelSegs, 24);
  geo.center();
  const mat = createMarble();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.add(mesh);
  const node: LayerNode = {
    object: root,
    update(v) {
      applyTransform(root, v);
      applyMarble(mat, v, v.opacity);
      root.visible = v.opacity > 0.001;
    },
    dispose() { disposeTree(root); },
  };
  return node;
};
