import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { AudioEngine } from '../audio/engine';
import { evalLayer, emptySync } from '../core/eval';
import { LAYER_DEFS } from '../core/schema';
import { editor, transport, useEditor, useTransport } from '../core/store';
import type { Project } from '../core/types';
import { Engine } from './engine';
import './viewport.css';

type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'orbit' | 'pan' | 'dolly';

const QUALITY = {
  draft: { scale: 0.4, samples: 1, msaa: 4 },
  half: { scale: 0.6, samples: 3, msaa: 4 },
  full: { scale: 1, samples: 6, msaa: 0 },
};
const REFINE_SAMPLES = 12;

const TOOLS: { id: Tool; label: string; key: string; d: string }[] = [
  { id: 'select', label: 'Select', key: 'V', d: 'M3 2l9 5-4 1.2L6.3 12z' },
  { id: 'move', label: 'Move', key: 'W', d: 'M7.5 1v13M1 7.5h13M7.5 1 5.5 3M7.5 1l2 2M7.5 14l-2-2M7.5 14l2-2M1 7.5l2-2M1 7.5l2 2M14 7.5l-2-2M14 7.5l-2 2' },
  { id: 'rotate', label: 'Rotate', key: 'E', d: 'M12.5 7.5a5 5 0 1 1-1.6-3.7M11 1v3h-3' },
  { id: 'scale', label: 'Scale', key: 'R', d: 'M2 13 13 2M13 2H8.5M13 2v4.5M2 13h4.5M2 13V8.5' },
  { id: 'orbit', label: 'Orbit camera', key: 'Alt+drag', d: 'M7.5 2a5.5 2.2 0 1 0 0 .01M7.5 2v11M2 7.5c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2' },
  { id: 'pan', label: 'Pan camera', key: 'Middle drag', d: 'M5 7V3a1 1 0 0 1 2 0v3-4a1 1 0 0 1 2 0v4-3a1 1 0 0 1 2 0v6c0 3-2 5-4 5-3 0-4-2-6-5a1 1 0 0 1 2-1z' },
  { id: 'dolly', label: 'Dolly camera', key: 'Wheel', d: 'M1 5h8v5H1zM9 7l5-2.5v6L9 8' },
];

export function Viewport() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('move');
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [stats, setStats] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const view = useEditor((s) => s.ui.view);
  const safe = useEditor((s) => s.ui.safeAreas);
  const pw = useEditor((s) => s.project.width);
  const ph = useEditor((s) => s.project.height);

  // Fit the frame inside the panel.
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const pad = 12;
      const k = Math.min((r.width - pad * 2) / pw, (r.height - pad * 2) / ph);
      setBox({ w: Math.max(2, Math.floor(pw * k)), h: Math.max(2, Math.floor(ph * k)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pw, ph]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let engine: Engine;
    try {
      engine = new Engine(canvas);
    } catch (e) {
      setErr('WebGL 2 is not available in this browser, so the viewport cannot render.');
      return;
    }
    const gizmoScene = new THREE.Scene();
    const freeCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 2000);
    freeCam.position.set(22, 14, 30);
    freeCam.lookAt(0, 0, 0);
    const free = { az: 0.63, el: 0.35, dist: 40, target: new THREE.Vector3() };

    const tc = new TransformControls(engine.camera, canvas);
    tc.setSize(0.8);
    const helper = tc.getHelper();
    gizmoScene.add(helper);
    let attachedLayer: string | null = null;
    tc.addEventListener('dragging-changed', (e: any) => {
      if (e.value) editor().beginDrag(); else editor().endDrag();
      dirty = true;
    });
    tc.addEventListener('objectChange', () => {
      const obj = tc.object;
      if (!obj || !attachedLayer) return;
      const st = editor();
      const set = (k: string, v: number) => st.setProp(attachedLayer!, k, v, { noHistory: true });
      if (tc.mode === 'translate') { set('px', obj.position.x); set('py', obj.position.y); set('pz', obj.position.z); }
      else if (tc.mode === 'rotate') {
        const e = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ');
        const D = 180 / Math.PI;
        set('rx', e.x * D); set('ry', e.y * D); set('rz', e.z * D);
      } else set('s', obj.scale.x);
    });

    // Camera path + frustum, only in free view.
    const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff2d55 }));
    pathLine.frustumCulled = false;
    const camHelper = new THREE.CameraHelper(engine.camera);
    gizmoScene.add(pathLine, camHelper);
    let pathRev = -1;

    const updateGizmo = (p: Project) => {
      const st = editor();
      const id = st.sel.layers.length === 1 ? st.sel.layers[0] : null;
      const layer = id ? p.layers.find((l) => l.id === id) : null;
      const t = toolRef.current;
      const mode = t === 'move' ? 'translate' : t === 'rotate' ? 'rotate' : t === 'scale' ? 'scale' : null;
      const usable = !!layer && !layer.locked && mode && LAYER_DEFS[layer.type].spatial && st.ui.showGizmo
        && !transport().playing && (mode === 'translate' || 'rx' in layer.props);
      if (usable) {
        const obj = engine.objectFor(layer!.id);
        if (obj && (tc.object !== obj)) tc.attach(obj);
        attachedLayer = layer!.id;
        tc.setMode(mode as any);
        tc.camera = engine.viewCamera;
        helper.visible = true;
      } else {
        if (tc.object) tc.detach();
        attachedLayer = null;
        helper.visible = false;
      }
    };

    const updatePath = (p: Project) => {
      const st = editor();
      if (pathRev === st.rev) return;
      pathRev = st.rev;
      const pts: THREE.Vector3[] = [];
      const c = new THREE.PerspectiveCamera();
      for (let i = 0; i <= 300; i++) {
        const t = (i / 300) * p.duration;
        const cl = engine.activeCamera(p, t);
        if (!cl) continue;
        engine.poseCamera(c, evalLayer(cl, t), t, emptySync(), 16 / 9);
        pts.push(c.position.clone());
      }
      pathLine.geometry.dispose();
      pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    };

    // --- render loop
    let raf = 0, dirty = true, lastT = -1, lastRev = -1, refined = false, idleAt = 0;
    let dynScale = 1, dynSamples = Infinity;
    let frames = 0, statAt = performance.now(), lastFrameAt = performance.now(), slow = 0;
    let lastKey = '';

    const drawGizmos = () => {
      const r = engine.renderer;
      if (!helper.visible && editor().ui.view !== 'free') return;
      r.setRenderTarget(null);
      r.autoClear = false;
      r.clearDepth();
      r.render(gizmoScene, engine.viewCamera);
      r.autoClear = true;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const st = editor();
      const tr = transport();
      const p = st.project;
      const q = QUALITY[st.ui.quality];
      const key = `${st.ui.quality}|${p.width}|${p.height}|${st.ui.view}|${st.sel.layers.join()}|${toolRef.current}|${tr.playing}`;
      const t = tr.time;
      const changed = t !== lastT || st.rev !== lastRev || dirty || key !== lastKey;
      if (changed) {
        const dt = now - lastFrameAt;
        lastFrameAt = now;
        if (tr.playing) {
          // Hold frame rate during playback by giving up samples first, then resolution.
          if (dt > 30) slow++; else slow = Math.max(0, slow - 1);
          if (slow > 12) {
            slow = 0;
            if (dynSamples === Infinity) dynSamples = q.samples;
            if (dynSamples > 1) dynSamples--;
            else dynScale = Math.max(0.5, dynScale * 0.8);
          }
        } else { dynSamples = Infinity; dynScale = 1; slow = 0; }
        const scale = q.scale * dynScale;
        engine.setSize(p.width * scale, p.height * scale, q.msaa);
        if (st.rev !== lastRev) engine.sync(p);
        const isFree = st.ui.view === 'free';
        if (isFree) {
          freeCam.position.set(Math.sin(free.az) * Math.cos(free.el), Math.sin(free.el), Math.cos(free.az) * Math.cos(free.el)).multiplyScalar(free.dist).add(free.target);
          freeCam.lookAt(free.target);
        }
        pathLine.visible = camHelper.visible = isFree;
        engine.render(p, t, { samples: Math.min(q.samples, dynSamples), env: AudioEngine.get().envelopes(), freeCamera: isFree ? freeCam : null });
        if (isFree) { updatePath(p); camHelper.update(); }
        updateGizmo(p);
        drawGizmos();
        lastT = t; lastRev = st.rev; dirty = false; lastKey = key; refined = false; idleAt = now;
        frames++;
      } else if (!tr.playing && !refined && now - idleAt > 180) {
        // Parked on a frame: spend the idle time on a clean render.
        refined = true;
        engine.render(p, t, { samples: Math.max(REFINE_SAMPLES, q.samples), env: AudioEngine.get().envelopes(), freeCamera: st.ui.view === 'free' ? freeCam : null });
        drawGizmos();
      }
      if (now - statAt > 500) {
        const fps = (frames * 1000) / (now - statAt);
        setStats(`${engine.size.width}×${engine.size.height}${tr.playing ? ` · ${fps.toFixed(0)} fps` : ''}`);
        frames = 0; statAt = now;
      }
    };
    raf = requestAnimationFrame(frame);
    engine.onInvalidate(() => { dirty = true; });
    engine.ready(editor().project).then(() => { dirty = true; });
    const unAudio = AudioEngine.get().subscribe(() => { dirty = true; });

    // --- pointer navigation
    let drag: { mode: 'orbit' | 'pan' | 'dolly'; x: number; y: number; camId: string | null; start: Record<string, number> } | null = null;
    const ray = new THREE.Raycaster();

    const camLayer = () => {
      const st = editor();
      return engine.activeCamera(st.project, transport().time);
    };
    const onDown = (e: PointerEvent) => {
      if (tc.dragging || (tc as any).axis) return;
      const t = toolRef.current;
      const mode: 'orbit' | 'pan' | 'dolly' | null =
        e.button === 1 ? 'pan' : e.altKey ? (e.shiftKey ? 'pan' : 'orbit') : t === 'orbit' || t === 'pan' || t === 'dolly' ? t : null;
      if (e.button === 0 && !mode) {
        const r = canvas.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), engine.viewCamera);
        const st = editor();
        const tNow = transport().time;
        for (const l of st.project.layers) {
          if (!(l.type === 'text3d' || l.type === 'logo' || l.type === 'image') || !l.visible || tNow < l.start || tNow >= l.end) continue;
          const obj = engine.objectFor(l.id);
          if (obj && ray.intersectObject(obj, true).length) { st.select({ layers: [l.id] }); return; }
        }
        return;
      }
      if (!mode) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const inFree = editor().ui.view === 'free';
      const cl = inFree ? null : camLayer();
      const v = cl ? evalLayer(cl, transport().time) : null;
      if (cl) editor().beginDrag();
      drag = { mode, x: e.clientX, y: e.clientY, camId: cl?.id ?? null, start: v ? { az: v.az, el: v.el, dist: v.dist, tx: v.tx, ty: v.ty, tz: v.tz } : { az: free.az, el: free.el, dist: free.dist, tx: free.target.x, ty: free.target.y, tz: free.target.z } };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      const s = drag.start;
      const right = new THREE.Vector3().setFromMatrixColumn(engine.viewCamera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(engine.viewCamera.matrixWorld, 1);
      if (drag.camId) {
        const st = editor();
        const set = (k: string, v: number) => st.setProp(drag!.camId!, k, v, { noHistory: true });
        if (drag.mode === 'orbit') { set('az', s.az - dx * 0.35); set('el', Math.max(-89, Math.min(89, s.el + dy * 0.35))); }
        else if (drag.mode === 'dolly') set('dist', Math.max(0.2, s.dist * Math.exp(dy * 0.006)));
        else {
          const k = s.dist * 0.0016;
          set('tx', s.tx - right.x * dx * k + up.x * dy * k); set('ty', s.ty - right.y * dx * k + up.y * dy * k); set('tz', s.tz - right.z * dx * k + up.z * dy * k);
        }
      } else {
        if (drag.mode === 'orbit') { free.az = s.az - dx * 0.006; free.el = Math.max(-1.5, Math.min(1.5, s.el + dy * 0.006)); }
        else if (drag.mode === 'dolly') free.dist = Math.max(1, s.dist * Math.exp(dy * 0.006));
        else {
          const k = s.dist * 0.0016;
          free.target.set(s.tx - right.x * dx * k + up.x * dy * k, s.ty - right.y * dx * k + up.y * dy * k, s.tz - right.z * dx * k + up.z * dy * k);
        }
        dirty = true;
      }
    };
    const onUp = () => {
      if (drag?.camId) editor().endDrag();
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (editor().ui.view === 'free') {
        free.dist = Math.max(1, free.dist * Math.exp(e.deltaY * 0.001));
        dirty = true;
        return;
      }
      const cl = camLayer();
      if (!cl || cl.locked) return;
      const v = evalLayer(cl, transport().time);
      editor().setProp(cl.id, 'dist', Math.max(0.2, (v.dist as number) * Math.exp(e.deltaY * 0.001)), { noHistory: true });
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || e.ctrlKey || e.metaKey) return;
      const map: Record<string, Tool> = { v: 'select', w: 'move', e: 'rotate', r: 'scale' };
      const n = map[e.key.toLowerCase()];
      if (n) setTool(n);
    };
    window.addEventListener('keydown', onKey);

    // Test and scripting hook.
    (window as any).__engine = engine;
    (window as any).__renderAt = async (time: number, samples = 8) => {
      const st = editor();
      await engine.ready(st.project);
      useTransport.setState({ time });
      engine.render(st.project, time, { samples, env: AudioEngine.get().envelopes() });
      refined = true; lastT = time;
    };

    return () => {
      cancelAnimationFrame(raf);
      unAudio();
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      tc.dispose();
      engine.dispose();
    };
  }, []);

  return (
    <div className="vp" ref={wrap}>
      <div className="vp-frame" style={{ width: box.w, height: box.h }}>
        <canvas ref={canvasRef} className="vp-canvas" />
        {safe && (
          <div className="vp-safe" aria-hidden>
            <i /><b />
          </div>
        )}
      </div>
      <div className="vp-tools" role="toolbar" aria-label="Viewport tools">
        {TOOLS.map((t, i) => (
          <button key={t.id} className={`vp-tool ${tool === t.id ? 'on' : ''} ${i === 4 ? 'sep' : ''}`} title={`${t.label} (${t.key})`} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d={t.d} /></svg>
          </button>
        ))}
      </div>
      <div className="vp-info">
        {view === 'free' && <span className="vp-badge">FREE VIEW</span>}
        <span>{stats}</span>
      </div>
      {err && <div className="vp-err">{err}</div>}
    </div>
  );
}
