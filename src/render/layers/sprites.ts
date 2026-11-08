import * as THREE from 'three';
import { applyTransform, disposeTree, quadGeometry, type NodeFactory } from './base';
import { mulberry32 } from '../../core/rng';
import type { Values } from '../../core/eval';

const PARTICLE_VS = /* glsl */ `
attribute vec4 aA; attribute vec4 aB;
uniform float uAge,uSize,uSpread,uSpeed,uGravity,uDrag,uLife,uTurb,uStretch,uPeriod,uAspect,uScaleY;
uniform int uMode;
varying vec2 vQ; varying float vFade; varying float vHot; varying float vSoft;

vec3 turb(vec3 p,float t,float seed){
  return vec3(sin(p.y*.7+t*1.3+seed),sin(p.z*.6+t*1.1+seed*2.),sin(p.x*.8+t*.9+seed*3.));
}
vec3 dirOf(){
  float z=aA.x*2.-1., a=aA.y*6.2831853, r=sqrt(max(0.,1.-z*z));
  return vec3(r*cos(a),r*sin(a),z);
}
// Position at a local time. Returns life fraction in w (>1 or <0 means dead).
vec4 sim(float age){
  vec3 dir=dirOf();
  float seed=aA.z*40.;
  if(uMode==0){ // burst
    float a=uPeriod>0.?mod(age,uPeriod):age;
    float life=uLife*(.45+.55*aB.x);
    float v=uSpeed*(.25+.75*aA.w*aA.w+.2*aB.y);
    float d=max(uDrag,.001);
    float dist=v*(1.-exp(-d*a))/d;
    vec3 p=dir*(dist+aB.z*uSpread*.05);
    p.y+=-.5*uGravity*a*a;
    p+=turb(p,a,seed)*uTurb*a*.35;
    return vec4(p,age<0.?-1.:a/life);
  }
  if(uMode==2){ // warp tunnel: comes at the camera along +Z, wraps
    float span=uSpread*6.;
    float z=mod(aA.x*span+age*uSpeed*(.6+.8*aA.w),span)-span*.75;
    float ang=aA.y*6.2831853, r=uSpread*(.15+.85*sqrt(aB.x));
    return vec4(cos(ang)*r,sin(ang)*r,z,.5);
  }
  if(uMode==4){ // embers: loop upward
    float life=uLife*(.5+aB.x);
    float a=mod(age+aA.z*life,life);
    vec3 p=vec3((aA.x-.5),0.,(aA.y-.5))*uSpread*2.;
    p.y=-uSpread*.5+a*uSpeed*.25*(.5+aA.w);
    p+=turb(p,age,seed)*uTurb;
    return vec4(p,a/life);
  }
  // ambient / bokeh: drift around a seed point
  vec3 p=(vec3(aA.x,aA.y,aB.x)-.5)*2.*uSpread;
  p.z*=.7;
  p+=turb(p*.3,age*uSpeed*.05,seed)*uTurb*2.;
  return vec4(p,.5);
}
void main(){
  vec4 s1=sim(uAge);
  vec4 s0=sim(uAge-.018);
  vQ=position.xy;
  float life=s1.w;
  vFade=(life<0.||life>1.)?0.:smoothstep(0.,.04,life)*pow(1.-life,1.2);
  if(uMode==1||uMode==3){ vFade=.5+.5*sin(uAge*(.3+aB.y)+aA.z*30.); vFade=mix(.35,1.,vFade); }
  if(uMode==2) vFade=1.;
  vHot=pow(aB.w,3.);
  vec4 c1=projectionMatrix*modelViewMatrix*vec4(s1.xyz,1.);
  vec4 c0=projectionMatrix*modelViewMatrix*vec4(s0.xyz,1.);
  float size=uSize*(.35+1.1*aB.y);
  if(uMode==3) size*=6.+10.*aB.z;
  if(uMode==0) size*=mix(1.,.25,clamp(life,0.,1.));
  vec4 view=modelViewMatrix*vec4(s1.xyz,1.);
  // Sprites grazing the lens would otherwise fill the frame with additive white.
  vFade*=uMode==3?1.:smoothstep(.4,2.5,-view.z);
  float rad=min(size*uScaleY*projectionMatrix[1][1]/max(.05,-view.z),uMode==3?.3:.03);
  vec2 n1=c1.xy/max(c1.w,.01), n0=c0.xy/max(c0.w,.01);
  vec2 vel=(n1-n0)*vec2(uAspect,1.);
  float L=min(length(vel)*uStretch*2.2,.45);
  vec2 dir=L>1e-5?vel/length(vel):vec2(1,0);
  vec2 perp=vec2(-dir.y,dir.x);
  vec2 off=dir*position.x*(rad+L)+perp*position.y*rad;
  off.x/=uAspect;
  vSoft=uMode==3?1.:0.;
  if(c1.w<=.05){ gl_Position=vec4(2.,2.,2.,1.); return; }
  gl_Position=vec4(c1.xy+off*c1.w,c1.zw);
}`;

const PARTICLE_FS = /* glsl */ `
uniform vec3 uColor,uColor2; uniform float uBright,uOpacity;
varying vec2 vQ; varying float vFade; varying float vHot; varying float vSoft;
void main(){
  float r=length(vQ);
  if(r>1.||vFade<=.001) discard;
  float core=vSoft>.5 ? smoothstep(1.,.86,r)*(.5+.5*r*r) : pow(1.-r,2.2);
  vec3 c=mix(uColor,uColor2,vHot);
  gl_FragColor=vec4(c*core*vFade*uBright*uOpacity,1.);
}`;

const MODES: Record<string, number> = { burst: 0, ambient: 1, warp: 2, bokeh: 3, embers: 4 };

function additive(vs: string, fs: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: fs, uniforms, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  });
}

export const createParticles: NodeFactory = (layer) => {
  const s = layer.settings;
  const n = Math.max(1, Math.floor(s.count));
  const g = quadGeometry(n);
  const rnd = mulberry32(s.seed * 104729 + 7);
  const A = new Float32Array(n * 4), B = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { A[i] = rnd(); B[i] = rnd(); }
  g.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4));
  g.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 4));
  const u: Record<string, THREE.IUniform> = {
    uAge: { value: 0 }, uSize: { value: 0.06 }, uSpread: { value: 10 }, uSpeed: { value: 8 }, uGravity: { value: 0 }, uDrag: { value: 1 },
    uLife: { value: 1.6 }, uTurb: { value: 0.4 }, uStretch: { value: 1 }, uPeriod: { value: s.period ?? 0 }, uAspect: { value: 16 / 9 }, uScaleY: { value: 1 },
    uMode: { value: MODES[s.mode] ?? 0 }, uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uBright: { value: 2 }, uOpacity: { value: 1 },
  };
  const mat = additive(PARTICLE_VS, PARTICLE_FS, u);
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return {
    object: mesh,
    update(v: Values, ctx) {
      mesh.position.set(v.px, v.py, v.pz);
      mesh.scale.setScalar(Math.max(1e-4, v.s));
      u.uAge.value = ctx.age; u.uSize.value = v.size; u.uSpread.value = v.spread; u.uSpeed.value = v.speed;
      u.uGravity.value = v.gravity; u.uDrag.value = v.drag; u.uLife.value = v.life; u.uTurb.value = v.turb;
      u.uStretch.value = v.stretch; u.uAspect.value = ctx.width / ctx.height; u.uScaleY.value = v.s;
      (u.uColor.value as THREE.Color).set(v.color); (u.uColor2.value as THREE.Color).set(v.color2);
      u.uBright.value = v.brightness; u.uOpacity.value = v.opacity;
      mesh.visible = v.opacity > 0.001;
    },
    dispose() { disposeTree(mesh); },
  };
};

const DOTS_VS = /* glsl */ `
attribute vec4 aD;
uniform float uT,uSize,uSpacing,uAmp,uFreq,uReveal,uTwinkle,uCols,uRows,uAspect;
varying vec2 vQ; varying float vH; varying float vA;
void main(){
  vec2 g=(aD.xy-vec2(uCols,uRows)*.5)*uSpacing;
  float d=length(g);
  float h=sin(g.x*uFreq+uT)*.5+sin(g.y*uFreq*1.3-uT*.8)*.35+sin(d*uFreq*1.7-uT*1.4)*.45;
  vec3 p=vec3(g.x,g.y,h*uAmp);
  vH=clamp(h*.6+.5,0.,1.);
  float maxD=length(vec2(uCols,uRows))*.5*uSpacing;
  float rv=smoothstep(uReveal*maxD*1.15,uReveal*maxD*1.15-uSpacing*5.,d);
  float tw=mix(1.,.5+.5*sin(uT*2.3+aD.z*40.),uTwinkle);
  vA=rv*tw;
  vQ=position.xy;
  vec4 view=modelViewMatrix*vec4(p,1.);
  float s=uSize*(.55+.75*vH)*(.3+.7*rv);
  view.xy+=position.xy*s;
  gl_Position=projectionMatrix*view;
}`;
const DOTS_FS = /* glsl */ `
uniform vec3 uColor,uColor2; uniform float uBright,uOpacity;
varying vec2 vQ; varying float vH; varying float vA;
void main(){
  float r=length(vQ);
  if(r>1.||vA<.002) discard;
  float disc=smoothstep(1.,.8,r);
  gl_FragColor=vec4(mix(uColor,uColor2,vH*vH)*disc*uBright*vA*uOpacity,1.);
}`;

export const createDots: NodeFactory = (layer) => {
  const s = layer.settings;
  const cols = Math.floor(s.cols), rows = Math.floor(s.rows), n = cols * rows;
  const g = quadGeometry(n);
  const rnd = mulberry32(s.seed * 31 + 5);
  const D = new Float32Array(n * 4);
  for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) { D[i * 4] = x; D[i * 4 + 1] = y; D[i * 4 + 2] = rnd(); D[i * 4 + 3] = rnd(); }
  g.setAttribute('aD', new THREE.InstancedBufferAttribute(D, 4));
  const u: Record<string, THREE.IUniform> = {
    uT: { value: 0 }, uSize: { value: 0.09 }, uSpacing: { value: 0.6 }, uAmp: { value: 1 }, uFreq: { value: 0.3 }, uReveal: { value: 1 }, uTwinkle: { value: 0.3 },
    uCols: { value: cols }, uRows: { value: rows }, uAspect: { value: 1 }, uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uBright: { value: 2 }, uOpacity: { value: 1 },
  };
  const mesh = new THREE.Mesh(g, additive(DOTS_VS, DOTS_FS, u));
  mesh.frustumCulled = false;
  return {
    object: mesh,
    update(v: Values, ctx) {
      applyTransform(mesh, v);
      u.uT.value = ctx.t * v.waveSpeed; u.uSize.value = v.size; u.uSpacing.value = v.spacing; u.uAmp.value = v.waveAmp; u.uFreq.value = v.waveFreq;
      u.uReveal.value = v.reveal; u.uTwinkle.value = v.twinkle;
      (u.uColor.value as THREE.Color).set(v.color); (u.uColor2.value as THREE.Color).set(v.color2);
      u.uBright.value = v.brightness; u.uOpacity.value = v.opacity;
      mesh.visible = v.opacity > 0.001 && v.reveal > 0.001;
    },
    dispose() { disposeTree(mesh); },
  };
};
