import * as THREE from 'three';
import { applyTransform, disposeTree, pendingLoads, type NodeFactory } from './base';
import { fontCssName } from '../fonts';
import { hash1, noise1 } from '../../core/rng';
import type { Values } from '../../core/eval';

const FULLSCREEN_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,1.,1.); }`;

const BG_FS = /* glsl */ `
uniform vec3 uA,uB; uniform vec2 uC; uniform float uSpread,uSmoke,uT,uOpacity,uAspect; uniform int uMode;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.02+3.1; a*=.5; } return s; }
void main(){
  vec2 q=(vUv-uC)*vec2(uAspect,1.);
  float d=length(q)/uSpread;
  float g=uMode==0?0.:exp(-d*d*2.2);
  float smoke=1.;
  if(uSmoke>.001){
    vec2 p=q*2.2;
    float w=fbm(p+vec2(uT,-uT*.6));
    smoke=mix(1.,smoothstep(.15,.85,fbm(p*1.4+w*2.+vec2(-uT*.5,uT*.3))),uSmoke);
    if(uMode==2) g=clamp(g*.6+smoke*.9*exp(-d*.8),0.,1.);
  }
  vec3 c=uMode==0?uA:mix(uB,uA,g*smoke);
  // Dither: dark gradients band badly otherwise.
  c+=(h(vUv*913.+uT)-.5)/255.;
  gl_FragColor=vec4(c,uOpacity);
}`;

export const createBackground: NodeFactory = (layer) => {
  const u: Record<string, THREE.IUniform> = {
    uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uC: { value: new THREE.Vector2(0.5, 0.5) }, uSpread: { value: 1 }, uSmoke: { value: 0 },
    uT: { value: 0 }, uOpacity: { value: 1 }, uAspect: { value: 1.78 }, uMode: { value: ({ solid: 0, radial: 1, nebula: 2 } as Record<string, number>)[layer.settings.mode] ?? 1 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VS, fragmentShader: BG_FS, uniforms: u, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return {
    object: mesh,
    update(v: Values, ctx) {
      (u.uA.value as THREE.Color).set(v.colorA); (u.uB.value as THREE.Color).set(v.colorB);
      (u.uC.value as THREE.Vector2).set(v.gx, 1 - v.gy);
      u.uSpread.value = v.spread; u.uSmoke.value = v.smoke; u.uT.value = ctx.t * v.smokeSpeed; u.uOpacity.value = v.opacity;
      u.uAspect.value = ctx.width / ctx.height;
    },
    dispose() { disposeTree(mesh); },
  };
};

const FLARE_FS = /* glsl */ `
uniform vec2 uP; uniform vec3 uColor; uniform float uAspect,uInt,uSize,uStreak,uGhosts,uSeed;
varying vec2 vUv;
float ghost(vec2 p,vec2 c,float r,float soft){ float d=length(p-c)/r; return smoothstep(1.,1.-soft,d)*(.35+.65*d*d); }
float h1(float x){ return fract(sin(x*91.7+uSeed)*4375.5); }
void main(){
  vec2 p=(vUv*2.-1.)*vec2(uAspect,1.);
  vec2 s=uP*vec2(uAspect,1.);
  vec2 d=p-s;
  float r=length(d);
  float S=uSize;
  float core=.018*S/(r+.012*S);
  float halo=exp(-r*r/(.09*S*S))*.5;
  float streak=exp(-abs(d.y)*90./S)*exp(-abs(d.x)*1.25/(S*max(uStreak,.02)))*uStreak;
  float ang=atan(d.y,d.x);
  float star=pow(abs(cos(ang*3.+uSeed)),40.)*exp(-r*5./S)*.4;
  vec3 c=uColor*(halo+streak*1.3+star)+mix(uColor,vec3(1.),.75)*core;
  c+=mix(uColor,vec3(.7,.85,1.),.5)*exp(-abs(d.y)*260./S)*exp(-abs(d.x)*2.4/(S*max(uStreak,.02)))*uStreak*.8;
  if(uGhosts>.001){
    vec2 ax=-s;
    for(int i=0;i<6;i++){
      float fi=float(i);
      float k=.35+h1(fi)*1.9;
      float rad=(.03+h1(fi+7.)*.13)*S;
      vec3 gc=mix(uColor,vec3(h1(fi+2.),h1(fi+3.),1.),.5);
      c+=gc*ghost(p,s+ax*k,rad,.5)*.05*uGhosts;
    }
    float rr=abs(length(p+s*.6)-.62*S);
    c+=uColor*exp(-rr*rr*900.)*.02*uGhosts;
  }
  gl_FragColor=vec4(c*uInt,1.);
}`;

export const createFlare: NodeFactory = (layer) => {
  const u: Record<string, THREE.IUniform> = {
    uP: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color() }, uAspect: { value: 1.78 }, uInt: { value: 1 }, uSize: { value: 1 },
    uStreak: { value: 1 }, uGhosts: { value: 1 }, uSeed: { value: layer.settings.seed },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VS, fragmentShader: FLARE_FS, uniforms: u, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const anchor = new THREE.Object3D();
  const w = new THREE.Vector3();
  return {
    object: anchor,
    overlayObject: quad,
    update(v: Values, ctx) {
      anchor.position.set(v.px, v.py, v.pz);
      anchor.updateWorldMatrix(true, false);
      w.setFromMatrixPosition(anchor.matrixWorld).project(ctx.camera);
      const behind = w.z > 1 || w.z < -1;
      (u.uP.value as THREE.Vector2).set(w.x, w.y);
      (u.uColor.value as THREE.Color).set(v.color);
      const seed = layer.settings.seed;
      const flick = 1 - v.flicker * (0.5 + 0.5 * noise1(ctx.t * 22, seed));
      // Dim towards frame edges so flares don't pop when they leave the shot.
      const edge = Math.max(0, 1 - Math.max(0, Math.max(Math.abs(w.x), Math.abs(w.y)) - 1) * 2.5);
      u.uInt.value = v.intensity * flick * edge;
      u.uAspect.value = ctx.width / ctx.height;
      u.uSize.value = v.size; u.uStreak.value = v.streak; u.uGhosts.value = v.ghosts;
      quad.visible = !behind && v.intensity > 0.001 && edge > 0;
    },
    dispose() { quad.geometry.dispose(); mat.dispose(); },
  };
};

const T2D_VS = /* glsl */ `
uniform vec2 uCenter,uHalf; uniform float uRot,uAspect;
varying vec2 vUv;
void main(){
  vUv=uv;
  vec2 p=position.xy*uHalf;
  float c=cos(uRot),s=sin(uRot);
  p=vec2(p.x*c-p.y*s,p.x*s+p.y*c);
  p.x/=uAspect;
  gl_Position=vec4(uCenter*2.-1.+p*2.,0.,1.);
}`;
const T2D_FS = /* glsl */ `
uniform sampler2D tMap; uniform vec3 uColor; uniform float uOpacity,uGlow;
varying vec2 vUv;
void main(){
  float a=texture2D(tMap,vUv).a;
  gl_FragColor=vec4(uColor*(1.+uGlow)*a*uOpacity,a*uOpacity);
}`;

export const createText2D: NodeFactory = (layer) => {
  const s = layer.settings;
  const canvas = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const u: Record<string, THREE.IUniform> = {
    tMap: { value: tex }, uCenter: { value: new THREE.Vector2() }, uHalf: { value: new THREE.Vector2(0.2, 0.1) }, uRot: { value: 0 }, uAspect: { value: 1.78 },
    uColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, uGlow: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: T2D_VS, fragmentShader: T2D_FS, uniforms: u, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  let aspectBox = 1, lastSpacing = NaN;
  const draw = (spacing: number) => {
    lastSpacing = spacing;
    const px = 220; // raster size per em: keeps titles crisp when scaled up
    const lines = String(s.text).split('\n');
    const ctx = canvas.getContext('2d')!;
    const font = `${px}px "${fontCssName(s.font)}"`;
    ctx.font = font;
    (ctx as any).letterSpacing = `${spacing * px}px`;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const pad = px * 0.35 + Math.abs(s.skew) * px * lines.length;
    const lh = px * 1.15;
    const w = Math.ceil(Math.max(...widths, 1) + pad * 2), h = Math.ceil(lh * lines.length + pad * 2);
    canvas.width = Math.min(4096, w); canvas.height = Math.min(4096, h);
    ctx.font = font;
    (ctx as any).letterSpacing = `${spacing * px}px`;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    lines.forEach((l, i) => {
      const x = s.align === 'left' ? pad : s.align === 'right' ? w - pad - widths[i] : (w - widths[i]) / 2;
      const y = pad + lh * (i + 0.5);
      ctx.setTransform(1, 0, -s.skew, 1, s.skew * y, 0);
      ctx.fillText(l, x, y);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    tex.dispose();
    tex.needsUpdate = true;
    aspectBox = w / h;
    return h / px;
  };
  let hEm = 1;
  return {
    object: new THREE.Object3D(),
    overlayObject: quad,
    update(v: Values, ctx) {
      const sp = Math.round(v.spacing * 200) / 200;
      if (sp !== lastSpacing) hEm = draw(sp);
      const halfH = (s.size * hEm * v.s) / 2;
      (u.uCenter.value as THREE.Vector2).set(v.x, 1 - v.y);
      (u.uHalf.value as THREE.Vector2).set(halfH * aspectBox, halfH);
      u.uRot.value = (-v.rz * Math.PI) / 180;
      u.uAspect.value = ctx.width / ctx.height;
      (u.uColor.value as THREE.Color).set(v.color);
      u.uOpacity.value = v.opacity; u.uGlow.value = v.glow;
      quad.visible = v.opacity > 0.001;
    },
    dispose() { quad.geometry.dispose(); mat.dispose(); tex.dispose(); },
  };
};

export const createImage: NodeFactory = (layer, project, invalidate) => {
  const s = layer.settings;
  const mat = new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xffffff,
    blending: s.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false;
  let aspect = 1;
  const asset = project.assets.find((a) => a.id === s.asset);
  if (asset) {
    const job = new THREE.TextureLoader().loadAsync(asset.dataUrl).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
      mat.needsUpdate = true;
      const im = tex.image as { width: number; height: number };
      aspect = im.width / im.height;
      invalidate();
    }).catch((e) => console.warn('image load failed', asset.name, e)).finally(() => pendingLoads.delete(job));
    pendingLoads.add(job);
  }
  const root = new THREE.Group();
  root.add(mesh);
  return {
    object: root,
    update(v: Values, ctx) {
      applyTransform(root, v);
      if (s.billboard) root.quaternion.copy(ctx.camera.quaternion);
      mesh.scale.set(4 * aspect, 4, 1);
      mat.color.setScalar(v.brightness);
      mat.opacity = v.opacity;
      root.visible = !!mat.map && v.opacity > 0.001;
    },
    dispose() { mat.map?.dispose(); disposeTree(root); },
  };
};

export const createLight: NodeFactory = (layer) => {
  const kind = layer.settings.kind;
  const light: THREE.Light =
    kind === 'spot' ? new THREE.SpotLight(0xffffff, 1, 0, Math.PI / 5, 0.5, 2)
    : kind === 'directional' ? new THREE.DirectionalLight(0xffffff, 1)
    : kind === 'ambient' ? new THREE.AmbientLight(0xffffff, 1)
    : new THREE.PointLight(0xffffff, 1, 0, 2);
  const scale = kind === 'directional' || kind === 'ambient' ? 0.05 : 1;
  return {
    object: light,
    update(v: Values) {
      light.position.set(v.px, v.py, v.pz);
      light.color.set(v.color);
      light.intensity = v.intensity * scale;
      if ('distance' in light) (light as THREE.PointLight).distance = v.range;
    },
    dispose() { light.dispose(); },
  };
};

export const createNull: NodeFactory = () => {
  const o = new THREE.Object3D();
  return { object: o, update(v: Values) { applyTransform(o, v); }, dispose() {} };
};

export { hash1 };
