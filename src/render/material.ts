import * as THREE from 'three';
import type { Values } from '../core/eval';

/**
 * The "damascus chrome" look: domain-warped fbm folded into veins that drive colour, roughness
 * and relief, on top of a standard PBR material so it reflects the studio environment.
 */
const NOISE = /* glsl */ `
float ig_h(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float ig_n(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(ig_h(i),ig_h(i+vec3(1,0,0)),f.x),mix(ig_h(i+vec3(0,1,0)),ig_h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(ig_h(i+vec3(0,0,1)),ig_h(i+vec3(1,0,1)),f.x),mix(ig_h(i+vec3(0,1,1)),ig_h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float ig_fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*ig_n(p); p=p*2.03+7.1; a*=.5; } return s; }
float ig_marble(vec3 p, float warp){
  vec3 q=vec3(ig_fbm(p),ig_fbm(p+vec3(5.2,1.3,2.8)),ig_fbm(p+vec3(1.7,9.2,3.1)));
  float f=ig_fbm(p+warp*q);
  float bands=sin((f*3.2+q.x*1.4)*(1.+warp*1.25));
  return smoothstep(-.8,.8,bands);
}`;

export interface MarbleOptions {
  /** GLSL declarations for the vertex shader. */
  vertexDecl?: string;
  /** Replaces three's begin_vertex: must define `vec3 transformed`. */
  beginVertex?: string;
  /** Replaces beginnormal_vertex: must define `vec3 objectNormal`. */
  beginNormal?: string;
  /** Replaces the default object-space coordinate fed to the marble noise. */
  marbleCoord?: string;
  uniforms?: Record<string, THREE.IUniform>;
  cacheKey?: string;
}

export interface MarbleMaterial extends THREE.MeshPhysicalMaterial {
  userData: { u: Record<string, THREE.IUniform> };
}

export function createMarble(o: MarbleOptions = {}): MarbleMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 1, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 1,
  }) as MarbleMaterial;
  const u: Record<string, THREE.IUniform> = {
    uColor2: { value: new THREE.Color('#222') },
    uMarble: { value: 0.8 }, uMScale: { value: 1.4 }, uMWarp: { value: 2 }, uBump: { value: 0.5 },
    ...(o.uniforms ?? {}),
  };
  m.userData.u = u;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aMP;
        varying vec3 vIgP;
        ${o.vertexDecl ?? ''}`)
      .replace('#include <beginnormal_vertex>', o.beginNormal ?? '#include <beginnormal_vertex>')
      .replace('#include <begin_vertex>', `${o.beginVertex ?? '#include <begin_vertex>'}
        ${o.marbleCoord ?? `
        #ifdef IG_HAS_MP
          vIgP = aMP;
        #else
          vIgP = position;
          #ifdef USE_INSTANCING
            vIgP += instanceMatrix[3].xyz * 1.37;
          #endif
        #endif`}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vIgP;
        uniform vec3 uColor2; uniform float uMarble, uMScale, uMWarp, uBump;
        float igM;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        igM = uMarble > .001 ? ig_marble(vIgP * uMScale, uMWarp) : 1.;
        float igMask = mix(1., igM, uMarble);
        diffuseColor.rgb = mix(uColor2, diffuseColor.rgb, igMask);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (1. - igMask) * .32, .03, 1.);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uBump > .001 && uMarble > .001) {
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float hx = dFdx(igM), hy = dFdy(igM);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 g = sign(det) * (hx * r1 + hy * r2);
          normal = normalize(abs(det) * normal - uBump * .02 * g);
        }`);
  };
  m.customProgramCacheKey = () => `marble-${o.cacheKey ?? 'std'}`;
  return m;
}

const tmp = new THREE.Color();
export function applyMarble(m: MarbleMaterial, v: Values, opacity: number) {
  const u = m.userData.u;
  m.color.set(v.color);
  (u.uColor2.value as THREE.Color).set(v.color2);
  m.metalness = v.metal;
  m.roughness = v.rough;
  u.uMarble.value = v.marble;
  u.uMScale.value = v.marbleScale;
  u.uMWarp.value = v.marbleWarp;
  u.uBump.value = v.bump;
  m.emissive.copy(tmp.set(v.emissive));
  m.emissiveIntensity = v.emissiveAmt;
  m.envMapIntensity = v.envAmt;
  m.opacity = opacity;
  m.transparent = opacity < 0.999;
}

/** Tag a geometry so the shader reads the stored coordinate (continuous veins across letters). */
export function enableMP(m: MarbleMaterial) {
  m.defines = { ...(m.defines ?? {}), IG_HAS_MP: 1 };
}
