import * as THREE from 'three';
import type { Values, SyncState } from '../../core/eval';
import type { Layer, Project } from '../../core/types';

export interface FrameCtx {
  t: number;              // absolute time of this sub-frame sample
  age: number;            // t - layer.start
  project: Project;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  sync: SyncState;
}

export interface LayerNode {
  /** Lives in the main 3D scene. Carries the layer's transform. */
  object: THREE.Object3D;
  /** Screen-space part, drawn over the 3D scene in the overlay pass. */
  overlayObject?: THREE.Object3D;
  update(v: Values, ctx: FrameCtx): void;
  dispose(): void;
}

export function applyTransform(o: THREE.Object3D, v: Values) {
  o.position.set(v.px ?? 0, v.py ?? 0, v.pz ?? 0);
  const d = Math.PI / 180;
  o.rotation.set((v.rx ?? 0) * d, (v.ry ?? 0) * d, (v.rz ?? 0) * d, 'YXZ');
  const s = v.s ?? 1;
  o.scale.setScalar(Math.max(1e-5, s));
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

/** In-flight texture loads. Engine.ready() waits on these so offline renders never miss an image. */
export const pendingLoads = new Set<Promise<unknown>>();

export type NodeFactory = (layer: Layer, project: Project, invalidate: () => void) => LayerNode;

/** A unit quad used by all instanced sprite systems. */
export function quadGeometry(count: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = count;
  return g;
}

export const color3 = (hex: string, out = new THREE.Color()) => out.set(hex);
