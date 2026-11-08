import * as THREE from 'three';
import { emptySync, evalLayer, evalSync, layerActive, type SyncState, type Values } from '../core/eval';
import { LAYER_DEFS, createLayer } from '../core/schema';
import { wiggleNoise } from '../core/rng';
import type { BandEnvelopes, Layer, LayerType, Project } from '../core/types';
import { buildEnvironment } from './env';
import { getFont, loadFont } from './fonts';
import { PostChain } from './post';
import { pendingLoads, type FrameCtx, type LayerNode, type NodeFactory } from './layers/base';
import { createLogo, createText3D } from './layers/text3d';
import { createSplash, createStreaks } from './layers/tendrils';
import { createDots, createParticles } from './layers/sprites';
import { createDebris, createLightning, createShockwave } from './layers/fx';
import { createBackground, createFlare, createImage, createLight, createNull, createText2D } from './layers/scene';

const FACTORIES: Partial<Record<LayerType, NodeFactory>> = {
  text3d: createText3D, logo: createLogo, splash: createSplash, streaks: createStreaks, particles: createParticles, dots: createDots,
  debris: createDebris, lightning: createLightning, shockwave: createShockwave, background: createBackground, flare: createFlare,
  text2d: createText2D, image: createImage, light: createLight, null: createNull,
};

interface Entry {
  layer: Layer;
  node: LayerNode;
  settings: Layer['settings'];
  assets: Project['assets'] | null;
  /** Holder is the attach point in the graph; link mirrors the transform for children. */
  holder: THREE.Group;
  link: THREE.Group;
  fontReady: boolean;
}

export interface RenderOptions {
  samples: number;
  env?: BandEnvelopes | null;
  freeCamera?: THREE.PerspectiveCamera | null;
  target?: THREE.WebGLRenderTarget | null;
}

const DEG = Math.PI / 180;
const halton = (i: number, b: number) => {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
};

const defaultPost = createLayer('post');

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly overlay = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 800);
  /** The camera used for the last frame: free view or the shot camera. */
  viewCamera: THREE.PerspectiveCamera = this.camera;
  private entries = new Map<string, Entry>();
  private post: PostChain;
  private rtScene: THREE.WebGLRenderTarget | null = null;
  private rtAccum: THREE.WebGLRenderTarget | null = null;
  private accumScene = new THREE.Scene();
  private accumCam = new THREE.Camera();
  private accumMat: THREE.ShaderMaterial;
  private w = 0;
  private h = 0;
  private msaa = 4;
  private invalidateCb: () => void = () => {};
  private needsResync = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);
    this.scene.environment = buildEnvironment(this.renderer);
    this.post = new PostChain(this.renderer);
    this.accumMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
      fragmentShader: `uniform sampler2D tIn; uniform float uW; varying vec2 vUv; void main(){ gl_FragColor=vec4(min(texture2D(tIn,vUv).rgb,vec3(60.))*uW,1.); }`,
      uniforms: { tIn: { value: null }, uW: { value: 1 } }, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.accumMat);
    q.frustumCulled = false;
    this.accumScene.add(q);
  }

  onInvalidate(cb: () => void) { this.invalidateCb = cb; }

  setSize(w: number, h: number, msaa = 4) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h && msaa === this.msaa) return;
    this.w = w; this.h = h; this.msaa = msaa;
    this.renderer.setSize(w, h, false);
    this.rtScene?.dispose(); this.rtAccum?.dispose();
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: true, samples: msaa });
    this.rtAccum = new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: false });
    this.post.setSize(w, h);
  }

  get size() { return { width: this.w, height: this.h }; }

  /** Resolves when every font the project needs has loaded, for exact offline renders. */
  async ready(p: Project) {
    const names = new Set<string>();
    for (const l of p.layers) if (l.settings.font) names.add(l.settings.font);
    await Promise.all([...names].map((n) => loadFont(n, p.assets)));
    this.sync(p);
    await Promise.all([...pendingLoads]);
  }

  /** Reconcile layers with scene nodes. Only rebuilds what changed. */
  sync(p: Project) {
    const seen = new Set<string>();
    for (const layer of p.layers) {
      const factory = FACTORIES[layer.type];
      if (!factory) continue;
      seen.add(layer.id);
      const font = layer.settings.font as string | undefined;
      const fontReady = !font || !!getFont(font);
      if (!fontReady) loadFont(font!, p.assets).then(() => { this.needsResync = true; this.invalidateCb(); });
      const usesAsset = !!layer.settings.asset;
      const e = this.entries.get(layer.id);
      if (e && e.settings === layer.settings && e.fontReady === fontReady && (!usesAsset || e.assets === p.assets)) {
        e.layer = layer;
        continue;
      }
      if (e) this.destroy(layer.id);
      const node = factory(layer, p, () => this.invalidateCb());
      const holder = new THREE.Group();
      const link = new THREE.Group();
      holder.add(node.object, link);
      this.scene.add(holder);
      if (node.overlayObject) this.overlay.add(node.overlayObject);
      this.entries.set(layer.id, { layer, node, settings: layer.settings, assets: p.assets, holder, link, fontReady });
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.destroy(id);
    for (const e of this.entries.values()) {
      const parent = e.layer.parent ? this.entries.get(e.layer.parent) : null;
      const want = parent ? parent.link : this.scene;
      if (e.holder.parent !== want) want.add(e.holder);
    }
    // Lower layers draw first in the overlay pass, as in any compositor.
    p.layers.forEach((l, i) => {
      const o = this.entries.get(l.id)?.node.overlayObject;
      if (o) o.renderOrder = p.layers.length - i;
    });
    this.needsResync = false;
  }

  private destroy(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    for (const child of [...e.link.children]) this.scene.add(child); // orphans re-attach on the next pass
    e.holder.removeFromParent();
    e.node.overlayObject?.removeFromParent();
    e.node.dispose();
    this.entries.delete(id);
  }

  objectFor(id: string): THREE.Object3D | null {
    return this.entries.get(id)?.node.object ?? null;
  }

  activeCamera(p: Project, t: number): Layer | null {
    return p.layers.find((l) => l.type === 'camera' && l.visible && layerActive(l, t)) ?? p.layers.find((l) => l.type === 'camera') ?? null;
  }

  /** Solve the orbit rig. Lens offsets are for depth of field. */
  poseCamera(cam: THREE.PerspectiveCamera, v: Values, t: number, sync: SyncState, aspect: number, lens?: [number, number]) {
    const hw = v.shake;
    const hx = hw ? wiggleNoise(t, v.shakeFreq, 11) * hw * 0.25 : 0;
    const hy = hw ? wiggleNoise(t, v.shakeFreq, 23) * hw * 0.25 : 0;
    const hr = hw ? wiggleNoise(t, v.shakeFreq * 0.7, 31) * hw * 1.2 : 0;
    const az = v.az * DEG, el = v.el * DEG;
    const target = _t.set(v.tx, v.ty, v.tz);
    cam.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(Math.max(0.05, v.dist)).add(target);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    _r.setFromMatrixColumn(cam.matrix, 0);
    _u.setFromMatrixColumn(cam.matrix, 1);
    const sx = hx + sync.shakeX, sy = hy + sync.shakeY;
    cam.position.addScaledVector(_r, sx).addScaledVector(_u, sy);
    _f.copy(target).addScaledVector(_r, sx).addScaledVector(_u, sy);
    if (lens) {
      // Thin lens: move the pinhole on the aperture while staying aimed at the focal point.
      _d.subVectors(_f, cam.position).normalize();
      _f.copy(cam.position).addScaledVector(_d, Math.max(0.1, v.dist + v.focus));
      cam.position.addScaledVector(_r, lens[0]).addScaledVector(_u, lens[1]);
    }
    cam.lookAt(_f);
    cam.rotateZ((v.roll + hr + sync.shakeRoll) * DEG);
    const hfov = 2 * Math.atan(18 / Math.max(1, v.lens));
    cam.fov = (2 * Math.atan(Math.tan(hfov / 2) / aspect)) / DEG;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  private updateNodes(p: Project, t: number, env: BandEnvelopes | null | undefined, sync: SyncState, cam: THREE.PerspectiveCamera) {
    const anySolo = p.layers.some((l) => l.solo);
    const ctx: FrameCtx = { t, age: 0, project: p, camera: cam, width: this.w, height: this.h, sync };
    for (const e of this.entries.values()) {
      const l = e.layer;
      const active = l.visible && layerActive(l, t) && (!anySolo || l.solo || l.type === 'light' || l.type === 'background');
      const hasChildren = e.link.children.length > 0;
      e.node.object.visible = active;
      if (e.node.overlayObject) e.node.overlayObject.visible = active;
      if (!active && !hasChildren) continue;
      const v = evalLayer(l, t, env);
      ctx.age = t - l.start;
      e.node.update(v, ctx);
      if (!active) {
        e.node.object.visible = false;
        if (e.node.overlayObject) e.node.overlayObject.visible = false;
      }
      if (hasChildren) {
        e.link.position.copy(e.node.object.position);
        e.link.quaternion.copy(e.node.object.quaternion);
        e.link.scale.copy(e.node.object.scale);
      }
    }
  }

  render(p: Project, t: number, opts: RenderOptions) {
    if (this.needsResync) this.sync(p);
    if (!this.rtScene || !this.rtAccum) return;
    const postLayer = p.layers.find((l) => l.type === 'post') ?? defaultPost;
    const postV = evalLayer(postLayer, t, opts.env);
    const sync = evalSync(p.hits, t);
    const aspect = this.w / this.h;
    const camLayerAt = (time: number) => this.activeCamera(p, time);

    const shutterSec = (postV.shutter / 360) / p.fps;
    const baseLayer = camLayerAt(t);
    const aperture = baseLayer ? (evalLayer(baseLayer, t, opts.env).aperture as number) : 0;
    const wantsMulti = shutterSec > 0 || aperture > 0;
    const N = wantsMulti ? Math.max(1, Math.floor(opts.samples)) : 1;

    const r = this.renderer;
    const free = opts.freeCamera ?? null;
    this.viewCamera = free ?? this.camera;
    r.setRenderTarget(this.rtAccum);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    this.accumMat.uniforms.tIn.value = this.rtScene.texture;
    this.accumMat.uniforms.uW.value = 1 / N;
    r.autoClear = false;

    for (let i = 0; i < N; i++) {
      const ts = N > 1 ? t + ((i + 0.5) / N) * shutterSec : t;
      const syncS = evalSync(p.hits, ts);
      const camLayer = camLayerAt(ts);
      const cv = camLayer ? evalLayer(camLayer, ts, opts.env) : null;
      let lens: [number, number] | undefined;
      if (cv && N > 1 && cv.aperture > 0) {
        const rr = Math.sqrt(halton(i + 1, 2)) * cv.aperture * 0.2, a = halton(i + 1, 3) * Math.PI * 2;
        lens = [Math.cos(a) * rr, Math.sin(a) * rr];
      }
      if (cv) this.poseCamera(this.camera, cv, ts, syncS, aspect, lens);
      const view = free ?? this.camera;
      if (free) { free.aspect = aspect; free.updateProjectionMatrix(); free.updateMatrixWorld(); }
      // Sub-pixel jitter: antialiasing for free once we're accumulating anyway.
      if (N > 1) view.setViewOffset(this.w, this.h, halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5, this.w, this.h);
      else view.clearViewOffset();
      this.updateNodes(p, ts, opts.env, syncS, view);

      r.setRenderTarget(this.rtScene);
      r.clear(true, true, false);
      r.render(this.scene, view);
      r.render(this.overlay, view);
      r.setRenderTarget(this.rtAccum);
      r.render(this.accumScene, this.accumCam);
    }
    this.camera.clearViewOffset();
    free?.clearViewOffset();
    r.autoClear = true;
    this.post.render(this.rtAccum.texture, postV, sync, t * 1.37 + 0.123, opts.target ?? null);
  }

  dispose() {
    for (const id of [...this.entries.keys()]) this.destroy(id);
    this.post.dispose();
    this.rtScene?.dispose();
    this.rtAccum?.dispose();
    this.accumMat.dispose();
    (this.scene.environment as THREE.Texture | null)?.dispose();
    this.renderer.dispose();
  }
}

const _t = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3();

export { emptySync, LAYER_DEFS };
