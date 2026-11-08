import * as THREE from 'three';

/**
 * A procedural photo studio: dark room, hard softboxes and strip lights. Metal only looks like
 * metal when it has something bright and sharp to reflect, so this does most of the work of an HDRI.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050506);

  const box = (w: number, h: number, pos: [number, number, number], color: number, intensity: number) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  box(14, 4, [0, 12, 4], 0xffffff, 7);        // overhead key
  box(2.4, 16, [-13, 2, 6], 0xffffff, 6);       // left strip
  box(2.4, 16, [13, 0, 7], 0xfff2f0, 5);         // right strip
  box(10, 2, [0, -11, 8], 0xffffff, 4);        // floor kick
  box(18, 1.6, [0, 3, 14], 0xffffff, 1.6);       // front band: the long highlight across letter faces
  box(6, 6, [-8, -6, -12], 0xffffff, 3);       // back rims
  box(6, 6, [9, 7, -12], 0xffffff, 3);
  for (let i = 0; i < 10; i++) {               // small hot spots break up the reflections
    const a = (i / 10) * Math.PI * 2;
    box(0.9, 0.9, [Math.cos(a) * 15, Math.sin(a * 2) * 7, Math.sin(a) * 15], 0xffffff, 12);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.012);
  pm.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  });
  return rt.texture;
}
