import * as THREE from 'three';
import { applyMarble, createMarble } from '../material';
import { applyTransform, disposeTree, type NodeFactory } from './base';
import { mulberry32 } from '../../core/rng';
import type { Values } from '../../core/eval';

/**
 * Instanced tubes whose centre-line is computed in the vertex shader, so a splash or a swarm of
 * streaks is a closed-form function of time: no sim to bake, nothing to cache, scrubs freely.
 */
function tubeGeometry(count: number, seed: number, rings: number, sides: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const verts = (rings + 1) * sides;
  const uv = new Float32Array(verts * 2);
  const pos = new Float32Array(verts * 3);
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s < sides; s++) {
      const i = r * sides + s;
      uv[i * 2] = r / rings;
      uv[i * 2 + 1] = (s / sides) * Math.PI * 2;
      if (r < rings) {
        const n = (s + 1) % sides;
        idx.push(i, r * sides + n, (r + 1) * sides + s, r * sides + n, (r + 1) * sides + n, (r + 1) * sides + s);
      }
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aTube', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  const rnd = mulberry32(seed * 7919 + 13);
  const a = new Float32Array(count * 4), b = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) { a[i] = rnd(); b[i] = rnd(); }
  g.setAttribute('aS1', new THREE.InstancedBufferAttribute(a, 4));
  g.setAttribute('aS2', new THREE.InstancedBufferAttribute(b, 4));
  g.instanceCount = count;
  return g;
}

const COMMON_DECL = /* glsl */ `
attribute vec2 aTube; attribute vec4 aS1; attribute vec4 aS2;
uniform float uT;
float tn(float x){ return sin(x)*.6 + sin(x*2.17+1.3)*.3 + sin(x*4.31+.7)*.1; }
`;

/** Shared tube sweep: expects igCurve(u) and igRadius(u) to be declared before it. */
const SWEEP = /* glsl */ `
void igFrame(float u, out vec3 C, out vec3 N, out vec3 B){
  float e=.012;
  C=igCurve(u);
  vec3 T=normalize(igCurve(min(u+e,1.))-igCurve(max(u-e,0.))+vec3(1e-5,0,0));
  vec3 ref=abs(T.z)>.9?vec3(1,0,0):vec3(0,0,1);
  N=normalize(cross(T,ref)); B=cross(T,N);
}`;

const BEGIN_NORMAL = /* glsl */ `
vec3 igC,igN,igB; igFrame(aTube.x,igC,igN,igB);
vec3 objectNormal=normalize(cos(aTube.y)*igN+sin(aTube.y)*igB);`;

const BEGIN_VERTEX = /* glsl */ `
vec2 igR=igRadius(aTube.x);
vec3 transformed=igC+igN*cos(aTube.y)*igR.x+igB*sin(aTube.y)*igR.y;`;

const SPLASH_DECL = COMMON_DECL + /* glsl */ `
uniform float uGrow,uRadius,uThick,uTurb,uFlat;
vec3 igCurve(float u){
  // Detached fragments cover only part of their arm, which reads as flung liquid.
  float frag=step(.42,aS1.w);
  float u0=mix(0.,aS2.x*.7,frag), u1=mix(1.,u0+.12+aS2.y*.3,frag);
  float s=mix(u0,u1,u);
  float ang=aS1.x*6.2831853;
  float len=(.45+.75*aS1.y)*uRadius;
  float grow=1.-pow(1.-uGrow,2.2);
  float r=len*s*grow+.18*uRadius*grow;
  float ph=aS1.z*40.;
  float flow=uT;
  ang+=uTurb*.42*tn(s*3.4+ph+flow*.6)*(.3+s);
  float z=(aS2.z-.5)*2.*(1.-uFlat)*r*.9+uTurb*.5*tn(s*4.1+ph*1.7-flow*.5)*s*uRadius*.2;
  return vec3(cos(ang)*r,sin(ang)*r,z);
}
vec2 igRadius(float u){
  float frag=step(.42,aS1.w);
  float taper=pow(max(sin(3.14159*min(u*.97+.03,1.)),0.),.75);
  float blob=.62+.38*tn(u*9.+aS1.z*30.+uT*.8);
  float w=uThick*(.35+.9*aS2.w)*taper*blob*(frag>.5?.7:1.)*(.15+.85*uGrow);
  return vec2(w*1.75,w*.55); // flattened: sheets of liquid, not spaghetti
}
` + SWEEP;

export const createSplash: NodeFactory = (layer) => {
  const s = layer.settings;
  const geo = tubeGeometry(s.arms, s.seed, 34, 7);
  const u = {
    uT: { value: 0 }, uGrow: { value: 1 }, uRadius: { value: 5 }, uThick: { value: 0.3 }, uTurb: { value: 1 }, uFlat: { value: s.flat },
  };
  const mat = createMarble({
    cacheKey: 'splash', vertexDecl: SPLASH_DECL, beginNormal: BEGIN_NORMAL, beginVertex: BEGIN_VERTEX, uniforms: u,
    marbleCoord: 'vIgP = transformed * .9 + aS1.xyz * 5.;',
  });
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.add(mesh);
  return {
    object: root,
    update(v: Values, ctx) {
      applyTransform(root, v);
      applyMarble(mat, v, v.opacity);
      u.uT.value = ctx.t * v.flow * 2;
      u.uGrow.value = v.grow; u.uRadius.value = v.radius; u.uThick.value = v.thickness; u.uTurb.value = v.turb;
      root.visible = v.opacity > 0.001 && v.grow > 0.001;
    },
    dispose() { disposeTree(root); },
  };
};

const STREAK_DECL = COMMON_DECL + /* glsl */ `
uniform float uLen,uSpread,uSpeed,uCurl,uWidth,uAge;
uniform int uMode;
vec3 igPath(float tt){
  float ph=aS1.z*30.;
  if(uMode==0){ // radial burst, decelerating
    float ang=aS1.x*6.2831853, el=(aS1.y-.5)*1.6;
    vec3 dir=normalize(vec3(cos(ang),sin(ang),el*.7));
    float d=uSpread*(.35+.65*aS2.x)*(1.-exp(-max(tt,0.)*uSpeed*.16/(.5+aS2.y)));
    d+=.4*max(tt,0.);
    vec3 side=normalize(cross(dir,vec3(.2,.1,1.)));
    vec3 up=cross(dir,side);
    return dir*d+(side*tn(d*.7+ph)+up*tn(d*.5+ph*1.3))*uCurl*.3*(.2+d*.25);
  } else if(uMode==1){ // flies along Z through the frame, wrapping
    float span=uSpread*4.;
    float z=mod(aS2.x*span+tt*uSpeed*(.7+.6*aS2.y),span)-span*.5;
    float ang=aS1.x*6.2831853;
    float r=uSpread*(.25+.75*sqrt(aS1.y));
    return vec3(cos(ang)*r+tn(z*.25+ph)*uCurl*.5,sin(ang)*r*.65+tn(z*.3+ph*2.)*uCurl*.5,z);
  } else { // swirl around the origin
    float ang=aS1.x*6.2831853+tt*uSpeed*.12*(.5+aS2.y);
    float r=uSpread*(.3+.7*aS1.y)+tn(tt*.8+ph)*uCurl*.4;
    return vec3(cos(ang)*r,sin(ang)*r*.8,(aS2.x-.5)*uSpread*.8+tn(tt+ph)*uCurl*.4);
  }
}
vec3 igCurve(float u){
  float span=uLen/max(.5,abs(uSpeed))*(.5+aS2.z);
  return igPath(uAge*1.+(aS2.w-.5)*.0-u*span);
}
vec2 igRadius(float u){
  float w=uWidth*(.4+1.2*aS2.y)*pow(max(sin(3.14159*pow(u,.6)),0.),.8);
  return vec2(w,w);
}
` + SWEEP;

export const createStreaks: NodeFactory = (layer) => {
  const s = layer.settings;
  const geo = tubeGeometry(s.count, s.seed, 22, 6);
  const u = {
    uT: { value: 0 }, uAge: { value: 0 }, uLen: { value: 3 }, uSpread: { value: 12 }, uSpeed: { value: 7 }, uCurl: { value: 1 }, uWidth: { value: 0.07 },
    uMode: { value: ({ burst: 0, flow: 1, swirl: 2 } as Record<string, number>)[s.mode] ?? 0 },
  };
  const mat = createMarble({
    cacheKey: 'streak', vertexDecl: STREAK_DECL, beginNormal: BEGIN_NORMAL, beginVertex: BEGIN_VERTEX, uniforms: u,
    marbleCoord: 'vIgP = transformed;',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.add(mesh);
  return {
    object: root,
    update(v: Values, ctx) {
      applyTransform(root, v);
      mat.color.set(v.color2);
      (mat.userData.u.uColor2.value as THREE.Color).set(v.color);
      mat.userData.u.uMarble.value = 0;
      mat.metalness = 0.9; mat.roughness = 0.22;
      mat.emissive.set(v.color); mat.emissiveIntensity = v.glow * 0.35;
      mat.opacity = v.opacity; mat.transparent = v.opacity < 0.999;
      u.uAge.value = ctx.age; u.uLen.value = v.length; u.uSpread.value = v.spread; u.uSpeed.value = v.speed;
      u.uCurl.value = v.curl; u.uWidth.value = v.width;
      root.visible = v.opacity > 0.001;
    },
    dispose() { disposeTree(root); },
  };
};
