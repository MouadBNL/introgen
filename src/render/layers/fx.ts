import * as THREE from 'three';
import { applyMarble, createMarble } from '../material';
import { applyTransform, disposeTree, type NodeFactory } from './base';
import { hash1, mulberry32, noise1 } from '../../core/rng';
import type { Values } from '../../core/eval';

export const createDebris: NodeFactory = (layer) => {
  const s = layer.settings;
  const n = Math.max(1, Math.floor(s.count));
  // A lumpy, flat-shaded icosahedron reads as fractured stone.
  const base = new THREE.IcosahedronGeometry(1, 1);
  const pos = base.getAttribute('position') as THREE.BufferAttribute;
  const lump = new Map<string, number>();
  const rnd0 = mulberry32(s.seed * 11 + 3);
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!lump.has(key)) lump.set(key, 0.68 + rnd0() * 0.5);
    const k = lump.get(key)!;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.86, pos.getZ(i) * k);
  }
  base.computeVertexNormals();
  const mat = createMarble({ cacheKey: 'debris' });
  mat.flatShading = true;
  const mesh = new THREE.InstancedMesh(base, mat, n);
  mesh.frustumCulled = false;
  const rnd = mulberry32(s.seed * 7 + 1);
  const seeds = Array.from({ length: n }, () => {
    const a = rnd() * Math.PI * 2, z = (rnd() * 2 - 1) * (1 - s.flat * 0.8);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    return { dir: new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z), dist: 0.25 + rnd() * 0.75, scale: 0.35 + Math.pow(rnd(), 2.2) * 1.4, axis, spin: 0.4 + rnd() * 1.6, phase: rnd() * 6.28 };
  });
  const root = new THREE.Group();
  root.add(mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  return {
    object: root,
    update(v: Values, ctx) {
      applyTransform(root, v);
      applyMarble(mat, v, v.opacity);
      root.visible = v.opacity > 0.001;
      const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, v.explode)), 3);
      for (let i = 0; i < n; i++) {
        const d = seeds[i];
        p.copy(d.dir).multiplyScalar(v.radius * d.dist * e);
        p.y -= 0.5 * v.gravity * ctx.age * ctx.age;
        q.setFromAxisAngle(d.axis, d.phase + ctx.age * v.spin * d.spin);
        sc.setScalar(Math.max(1e-4, v.size * d.scale * Math.min(1, e * 6)));
        m.compose(p, q, sc);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { disposeTree(root); },
  };
};

const BOLT_VS = /* glsl */ `
attribute vec3 aNext; attribute float aSide; attribute float aW;
uniform float uThick,uAspect;
varying float vS; varying float vW;
void main(){
  vec4 a=projectionMatrix*modelViewMatrix*vec4(position,1.);
  vec4 b=projectionMatrix*modelViewMatrix*vec4(aNext,1.);
  vec2 d=(b.xy/max(b.w,.01)-a.xy/max(a.w,.01))*vec2(uAspect,1.);
  vec2 n=length(d)>1e-6?normalize(vec2(-d.y,d.x)):vec2(0,1);
  n.x/=uAspect;
  vS=aSide; vW=aW;
  gl_Position=a+vec4(n*aSide*uThick*aW*projectionMatrix[1][1]*a.w/max(a.w,.2),0.,0.);
}`;
const BOLT_FS = /* glsl */ `
uniform vec3 uColor; uniform float uGlow,uOpacity;
varying float vS; varying float vW;
void main(){
  float r=abs(vS);
  float core=pow(1.-r,1.6);
  vec3 c=mix(uColor,vec3(1.),pow(core,3.));
  gl_FragColor=vec4(c*core*uGlow*uOpacity*vW,1.);
}`;

export const createLightning: NodeFactory = (layer) => {
  const s = layer.settings;
  const bolts = Math.floor(s.bolts), segs = Math.floor(s.segments);
  const verts = bolts * (segs + 1) * 2;
  const P = new Float32Array(verts * 3), N = new Float32Array(verts * 3), S = new Float32Array(verts), W = new Float32Array(verts);
  const idx: number[] = [];
  for (let b = 0; b < bolts; b++) for (let i = 0; i < segs; i++) {
    const k = (b * (segs + 1) + i) * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aNext', new THREE.BufferAttribute(N, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(S, 1));
  g.setAttribute('aW', new THREE.BufferAttribute(W, 1));
  g.setIndex(idx);
  const u: Record<string, THREE.IUniform> = { uThick: { value: 0.03 }, uAspect: { value: 1 }, uColor: { value: new THREE.Color() }, uGlow: { value: 4 }, uOpacity: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: BOLT_VS, fragmentShader: BOLT_FS, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  let lastStep = NaN, lastKey = '';
  const rebuild = (step: number, v: Values) => {
    for (let b = 0; b < bolts; b++) {
      const rnd = mulberry32((s.seed * 9973 + b * 131 + step * 7) >>> 0);
      const angBase = hash1(b * 1.7 + s.seed) * Math.PI * 2 + rnd() * 0.5;
      const zTilt = (rnd() - 0.5) * 0.8;
      // Random walk bent back toward the radial line, with a few big kinks.
      let off = 0, offZ = 0;
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= segs; i++) {
        const f = i / segs;
        const r = v.inner + (v.radius - v.inner) * f * v.reach;
        off += (rnd() - 0.5) * v.jitter * 0.55 * (rnd() < 0.12 ? 3.2 : 1);
        offZ += (rnd() - 0.5) * v.jitter * 0.4;
        off *= 0.92;
        const a = angBase + off / Math.max(0.6, r);
        pts.push([Math.cos(a) * r, Math.sin(a) * r, zTilt * r * 0.4 + offZ]);
      }
      for (let i = 0; i <= segs; i++) {
        const cur = pts[i], nx = pts[Math.min(segs, i + 1)], pv = pts[Math.max(0, i - 1)];
        const dir: [number, number, number] = i === segs ? [cur[0] * 2 - pv[0], cur[1] * 2 - pv[1], cur[2] * 2 - pv[2]] : nx;
        const f = i / segs;
        const w = Math.sin(Math.PI * Math.min(1, f * 1.02 + 0.02)) ** 0.6 * (0.45 + 0.55 * noise1(i * 0.4, b + step));
        for (let side = 0; side < 2; side++) {
          const k = (b * (segs + 1) + i) * 2 + side;
          P.set(cur, k * 3); N.set(dir, k * 3);
          S[k] = side ? 1 : -1;
          W[k] = Math.max(0.05, Math.abs(w));
        }
      }
    }
    for (const n of ['position', 'aNext', 'aSide', 'aW']) g.getAttribute(n).needsUpdate = true;
  };
  return {
    object: mesh,
    update(v: Values, ctx) {
      applyTransform(mesh, v);
      const step = v.rate > 0 ? Math.floor(ctx.t * v.rate) : 0;
      const key = `${v.radius.toFixed(2)}|${v.inner.toFixed(2)}|${v.jitter.toFixed(2)}|${v.reach.toFixed(2)}`;
      if (step !== lastStep || key !== lastKey) { rebuild(step, v); lastStep = step; lastKey = key; }
      u.uThick.value = v.thickness; u.uAspect.value = ctx.width / ctx.height;
      (u.uColor.value as THREE.Color).set(v.color);
      u.uGlow.value = v.glow; u.uOpacity.value = v.opacity;
      mesh.visible = v.opacity > 0.001 && v.reach > 0.001;
    },
    dispose() { disposeTree(mesh); },
  };
};

const RING_FS = /* glsl */ `
uniform vec3 uColor; uniform float uGlow,uOpacity,uRad,uWidth,uNoise,uSeed;
varying vec2 vP;
float h(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5); }
float vn(float x){ float i=floor(x),f=fract(x); f=f*f*(3.-2.*f); return mix(h(vec2(i,uSeed)),h(vec2(i+1.,uSeed)),f); }
void main(){
  float r=length(vP);
  float a=atan(vP.y,vP.x);
  float wob=(vn(a*5.)-.5)*.5+(vn(a*17.)-.5)*.25;
  float d=abs(r-uRad*(1.+wob*uNoise*.08))/max(uWidth,1e-3);
  float ring=exp(-d*d*2.)+.35*exp(-d*.9);
  float inner=r<uRad?.14*smoothstep(0.,uRad,r):0.;
  gl_FragColor=vec4(mix(uColor,vec3(1.),exp(-d*d*9.)*.7)*(ring+inner)*uGlow*uOpacity,1.);
}`;

export const createShockwave: NodeFactory = (layer) => {
  const s = layer.settings;
  const u: Record<string, THREE.IUniform> = { uColor: { value: new THREE.Color() }, uGlow: { value: 3 }, uOpacity: { value: 1 }, uRad: { value: 1 }, uWidth: { value: 0.3 }, uNoise: { value: 0.4 }, uSeed: { value: s.seed } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vP; uniform float uExt; void main(){ vP=position.xy*uExt; gl_Position=projectionMatrix*modelViewMatrix*vec4(position.xy*uExt,0.,1.); }`,
    fragmentShader: RING_FS, uniforms: { ...u, uExt: { value: 1 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  return {
    object: mesh,
    update(v: Values) {
      applyTransform(mesh, v);
      const m = mat.uniforms;
      m.uExt.value = v.radius * 1.4 + v.width * 6 + 0.5;
      (m.uColor.value as THREE.Color).set(v.color);
      m.uGlow.value = v.glow; m.uOpacity.value = v.opacity; m.uRad.value = v.radius; m.uWidth.value = v.width; m.uNoise.value = v.noise;
      mesh.visible = v.opacity > 0.001;
    },
    dispose() { disposeTree(mesh); },
  };
};
