import * as THREE from 'three';
import { hexToRgb } from '../core/eval';
import type { SyncState, Values } from '../core/eval';

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

const PREFILTER_FS = /* glsl */ `
uniform sampler2D tIn; uniform vec2 uPx; uniform float uThresh;
varying vec2 vUv;
vec3 s(vec2 o){ return min(texture2D(tIn,vUv+o*uPx).rgb,vec3(48.)); }
void main(){
  vec3 c=(s(vec2(-1,-1))+s(vec2(1,-1))+s(vec2(-1,1))+s(vec2(1,1)))*.25;
  float b=max(c.r,max(c.g,c.b));
  float knee=uThresh*.5+1e-4;
  float soft=clamp(b-uThresh+knee,0.,2.*knee);
  soft=soft*soft/(4.*knee);
  c*=max(soft,b-uThresh)/max(b,1e-4);
  gl_FragColor=vec4(c,1.);
}`;

const DOWN_FS = /* glsl */ `
uniform sampler2D tIn; uniform vec2 uPx;
varying vec2 vUv;
void main(){
  vec3 c=texture2D(tIn,vUv).rgb*4.;
  c+=texture2D(tIn,vUv+uPx*vec2(-1,-1)).rgb+texture2D(tIn,vUv+uPx*vec2(1,-1)).rgb;
  c+=texture2D(tIn,vUv+uPx*vec2(-1,1)).rgb+texture2D(tIn,vUv+uPx*vec2(1,1)).rgb;
  gl_FragColor=vec4(c/8.,1.);
}`;

const UP_FS = /* glsl */ `
uniform sampler2D tIn; uniform vec2 uPx; uniform float uK;
varying vec2 vUv;
void main(){
  vec3 c=vec3(0.);
  c+=texture2D(tIn,vUv+uPx*vec2(-1,0)).rgb*2.+texture2D(tIn,vUv+uPx*vec2(1,0)).rgb*2.;
  c+=texture2D(tIn,vUv+uPx*vec2(0,-1)).rgb*2.+texture2D(tIn,vUv+uPx*vec2(0,1)).rgb*2.;
  c+=texture2D(tIn,vUv+uPx*vec2(-1,-1)).rgb+texture2D(tIn,vUv+uPx*vec2(1,-1)).rgb;
  c+=texture2D(tIn,vUv+uPx*vec2(-1,1)).rgb+texture2D(tIn,vUv+uPx*vec2(1,1)).rgb;
  gl_FragColor=vec4(c/12.*uK,1.);
}`;

const RAYS_FS = /* glsl */ `
uniform sampler2D tIn; uniform vec2 uC; uniform float uLen;
varying vec2 vUv;
void main(){
  vec2 d=(uC-vUv)*uLen/16.;
  vec2 p=vUv; vec3 c=vec3(0.); float w=1.,ws=0.;
  for(int i=0;i<16;i++){ c+=texture2D(tIn,p).rgb*w; ws+=w; w*=.93; p+=d; }
  gl_FragColor=vec4(c/ws,1.);
}`;

const FINAL_FS = /* glsl */ `
uniform sampler2D tScene,tBloom,tRays;
uniform vec2 uRes,uFrameOff,uDir;
uniform vec3 uTint,uFlashColor;
uniform float uSeed,uExposure,uContrast,uSat,uHue,uTintAmt,uBloom,uRaysAmt,uRgb,uDistort,uZoom,uVignette,uFrameZoom,uFrameRot,uBars,uInvert,uFlash,uGlitch,uGrain,uFade;
varying vec2 vUv;

float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
vec2 mirror(vec2 u){ return abs(mod(u+1.,2.)-1.); }
vec3 hdr(vec2 u){
  u=mirror(u);
  return texture2D(tScene,u).rgb+texture2D(tBloom,u).rgb*uBloom+texture2D(tRays,u).rgb*uRaysAmt;
}
vec3 aces(vec3 x){ return clamp(x*(2.51*x+.03)/(x*(2.43*x+.59)+.14),0.,1.); }
vec3 toSrgb(vec3 c){ return mix(c*12.92,1.055*pow(max(c,vec3(1e-5)),vec3(1./2.4))-.055,step(.0031308,c)); }
vec3 hueRot(vec3 c,float a){
  const vec3 k=vec3(.57735);
  float ca=cos(a);
  return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.-ca);
}
void main(){
  float aspect=uRes.x/uRes.y;
  vec2 p=(vUv-.5)*vec2(aspect,1.);
  float cr=cos(uFrameRot),sr=sin(uFrameRot);
  p=vec2(p.x*cr-p.y*sr,p.x*sr+p.y*cr)/uFrameZoom;
  p-=uFrameOff*vec2(aspect,1.);
  vec2 uv=p/vec2(aspect,1.)+.5;

  vec2 c0=uv-.5;
  float r2=dot(c0*vec2(aspect,1.),c0*vec2(aspect,1.));
  uv=.5+c0*(1.+uDistort*r2);

  if(uGlitch>.001){
    float st=floor(uSeed*24.);
    float bandH=mix(8.,42.,h(vec2(st,3.)));
    float band=floor(uv.y*bandH);
    float r=h(vec2(band,st));
    float on=step(1.-min(uGlitch,1.)*.55,r);
    uv.x+=on*(h(vec2(band,st+1.))-.5)*.22*uGlitch;
    float blk=step(.93-uGlitch*.05,h(floor(uv*vec2(14.,9.))+st));
    uv+=blk*(vec2(h(vec2(st,band)),h(vec2(band,st+5.)))-.5)*.09*uGlitch;
  }

  float effect=uRgb+uZoom+length(uDir);
  vec3 col=vec3(0.);
  if(effect<.0005){
    col=hdr(uv);
  } else {
    // Spectral taps: one loop gives chromatic split, zoom blur and directional blur together.
    vec2 rad=(uv-.5);
    float amt=uRgb*.012*(.35+1.6*length(rad));
    vec3 ws=vec3(0.);
    for(int i=0;i<14;i++){
      float t=(float(i)+.5)/14.-.5;
      float jitter=(h(vUv*uRes+float(i))-.5)/14.;
      float tj=t+jitter;
      vec2 u=uv+normalize(rad+1e-5)*tj*amt*2.;
      u=.5+(u-.5)*(1.-uZoom*.32*(tj+.5));
      u+=uDir*tj;
      vec3 w=vec3(smoothstep(.05,-.42,tj),1.-abs(tj)*2.,smoothstep(-.05,.42,tj));
      w=max(w,vec3(.02));
      col+=hdr(u)*w; ws+=w;
    }
    col/=ws;
  }
  // Scanning glitch colour tear.
  if(uGlitch>.001){ col.r=mix(col.r,hdr(uv+vec2(.012*uGlitch,0.)).r,.7); }

  col*=exp2(uExposure);
  col=aces(col);
  col=toSrgb(col);

  col=(col-.5)*uContrast+.5;
  col=clamp(col,0.,1.);
  float l=dot(col,vec3(.2126,.7152,.0722));
  col=mix(vec3(l),col,uSat);
  if(abs(uHue)>.01) col=clamp(hueRot(col,uHue),0.,1.);
  if(uTintAmt>.001){
    vec3 duo=l<.5?mix(vec3(0.),uTint,l*2.):mix(uTint,vec3(1.),(l-.5)*2.);
    col=mix(col,duo,uTintAmt);
  }
  if(uInvert>.001){
    float li=dot(col,vec3(.2126,.7152,.0722));
    col=mix(col,1.-mix(col,vec3(li),.8),uInvert);
  }
  vec2 vq=(vUv-.5)*vec2(1.,1.);
  float vig=1.-uVignette*smoothstep(.25,1.05,length(vq)*1.42);
  col*=max(vig,0.);
  col=mix(col,uFlashColor,uFlash);
  if(uGrain>.0005){
    float g=h(vUv*uRes*.73+fract(uSeed)*91.)-.5;
    col+=g*uGrain*(.45+.55*(1.-l));
  }
  col*=1.-uFade;
  if(abs(vUv.y-.5)>.5-uBars*.5) col=vec3(0.);
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

function rt(w: number, h: number) {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  });
}

export class PostChain {
  private renderer: THREE.WebGLRenderer;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.Camera();
  private levels: THREE.WebGLRenderTarget[] = [];
  private raysA: THREE.WebGLRenderTarget | null = null;
  private raysB: THREE.WebGLRenderTarget | null = null;
  private black: THREE.DataTexture;
  private mPre: THREE.ShaderMaterial;
  private mDown: THREE.ShaderMaterial;
  private mUp: THREE.ShaderMaterial;
  private mRays: THREE.ShaderMaterial;
  private mFinal: THREE.ShaderMaterial;
  private w = 0;
  private h = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const mk = (fs: string, uniforms: Record<string, THREE.IUniform>, add = false) => new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false,
      ...(add ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true } : { blending: THREE.NoBlending }),
    });
    this.mPre = mk(PREFILTER_FS, { tIn: { value: null }, uPx: { value: new THREE.Vector2() }, uThresh: { value: 1 } });
    this.mDown = mk(DOWN_FS, { tIn: { value: null }, uPx: { value: new THREE.Vector2() } });
    this.mUp = mk(UP_FS, { tIn: { value: null }, uPx: { value: new THREE.Vector2() }, uK: { value: 1 } }, true);
    this.mRays = mk(RAYS_FS, { tIn: { value: null }, uC: { value: new THREE.Vector2(0.5, 0.5) }, uLen: { value: 0.5 } });
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.mFinal = mk(FINAL_FS, {
      tScene: { value: null }, tBloom: { value: null }, tRays: { value: this.black },
      uRes: { value: new THREE.Vector2() }, uFrameOff: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2() },
      uTint: { value: new THREE.Vector3() }, uFlashColor: { value: new THREE.Vector3(1, 1, 1) },
      uSeed: { value: 0 }, uExposure: { value: 0 }, uContrast: { value: 1 }, uSat: { value: 1 }, uHue: { value: 0 }, uTintAmt: { value: 0 }, uBloom: { value: 1 },
      uRaysAmt: { value: 0 }, uRgb: { value: 0 }, uDistort: { value: 0 }, uZoom: { value: 0 }, uVignette: { value: 0 }, uFrameZoom: { value: 1 }, uFrameRot: { value: 0 },
      uBars: { value: 0 }, uInvert: { value: 0 }, uFlash: { value: 0 }, uGlitch: { value: 0 }, uGrain: { value: 0 }, uFade: { value: 0 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mPre);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.levels.forEach((l) => l.dispose());
    this.raysA?.dispose(); this.raysB?.dispose();
    this.levels = [];
    for (let i = 1; i <= 7; i++) this.levels.push(rt(w >> i, h >> i));
    this.raysA = rt(w >> 2, h >> 2);
    this.raysB = rt(w >> 2, h >> 2);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, clear = true) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    const auto = this.renderer.autoClear;
    this.renderer.autoClear = clear;
    this.renderer.render(this.scene, this.cam);
    this.renderer.autoClear = auto;
  }

  render(input: THREE.Texture, v: Values, s: SyncState, seed: number, target: THREE.WebGLRenderTarget | null = null) {
    const L = this.levels;
    const px = (r: THREE.WebGLRenderTarget) => new THREE.Vector2(1 / r.width, 1 / r.height);

    // Glow: threshold, walk down the mip chain, then accumulate back up.
    this.mPre.uniforms.tIn.value = input;
    (this.mPre.uniforms.uPx.value as THREE.Vector2).set(0.5 / L[0].width, 0.5 / L[0].height);
    this.mPre.uniforms.uThresh.value = v.bloomThresh;
    this.pass(this.mPre, L[0]);
    for (let i = 1; i < L.length; i++) {
      this.mDown.uniforms.tIn.value = L[i - 1].texture;
      this.mDown.uniforms.uPx.value = px(L[i - 1]);
      this.pass(this.mDown, L[i]);
    }
    const f = this.mFinal.uniforms;
    let rays: THREE.Texture = this.black;
    if (v.rays > 0.001 && this.raysA && this.raysB) {
      // Two chained radial passes give 16x16 effective taps.
      this.mRays.uniforms.tIn.value = L[1].texture;
      (this.mRays.uniforms.uC.value as THREE.Vector2).set(v.raysX, 1 - v.raysY);
      this.mRays.uniforms.uLen.value = v.raysLen;
      this.pass(this.mRays, this.raysA);
      this.mRays.uniforms.tIn.value = this.raysA.texture;
      this.mRays.uniforms.uLen.value = v.raysLen / 16;
      this.pass(this.mRays, this.raysB);
      rays = this.raysB.texture;
    }

    const K = 0.35 + v.bloomRadius * 0.6;
    let energy = 1;
    for (let i = 1, k = 1; i < L.length; i++) { k *= K; energy += k; }
    for (let i = L.length - 1; i > 0; i--) {
      this.mUp.uniforms.tIn.value = L[i].texture;
      this.mUp.uniforms.uPx.value = px(L[i]);
      this.mUp.uniforms.uK.value = K;
      this.pass(this.mUp, L[i - 1], false);
    }

    f.tScene.value = input;
    f.tBloom.value = L[0].texture;
    f.tRays.value = rays;
    (f.uRes.value as THREE.Vector2).set(this.w, this.h);
    (f.uFrameOff.value as THREE.Vector2).set(v.frameX + s.whipX + s.shakeX * 0.04, v.frameY + s.shakeY * 0.04);
    (f.uDir.value as THREE.Vector2).set(s.whipBlur * 0.16, 0);
    const srgb = (hex: string, out: THREE.Vector3) => { const c = hexToRgb(hex); out.set(c[0] / 255, c[1] / 255, c[2] / 255); };
    srgb(v.tint, f.uTint.value);
    srgb(v.flashColor, f.uFlashColor.value);
    f.uSeed.value = seed;
    f.uExposure.value = v.exposure;
    f.uContrast.value = v.contrast;
    f.uSat.value = v.saturation;
    f.uHue.value = ((v.hue + s.hue) * Math.PI) / 180;
    f.uTintAmt.value = v.tintAmt;
    f.uBloom.value = v.bloom / energy; // the mip chain sums energy; this keeps Glow independent of Radius
    f.uRaysAmt.value = v.rays * 0.9;
    f.uRgb.value = v.rgb + s.rgb;
    f.uDistort.value = v.distort;
    f.uZoom.value = v.zoomBlur + s.blur;
    f.uVignette.value = v.vignette;
    f.uFrameZoom.value = Math.max(0.05, v.frameZoom * s.zoom);
    f.uFrameRot.value = (v.frameRot * Math.PI) / 180;
    f.uBars.value = Math.max(v.bars, s.bars);
    f.uInvert.value = Math.max(v.invert, s.invert);
    f.uFlash.value = Math.max(v.flash, s.flash);
    f.uGlitch.value = v.glitch + s.glitch;
    f.uGrain.value = v.grain;
    f.uFade.value = v.fade;
    this.pass(this.mFinal, target);
  }

  dispose() {
    this.levels.forEach((l) => l.dispose());
    this.raysA?.dispose(); this.raysB?.dispose();
    this.black.dispose();
    [this.mPre, this.mDown, this.mUp, this.mRays, this.mFinal].forEach((m) => m.dispose());
    this.quad.geometry.dispose();
  }
}
