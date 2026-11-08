import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/black-ops-one/400.css';
// Display faces: the font picker previews each option in its own face.
import '@fontsource/russo-one/400.css';
import '@fontsource/orbitron/400.css';
import '@fontsource/bungee/400.css';
import '@fontsource/anton/400.css';
import '@fontsource/audiowide/400.css';
import '@fontsource/michroma/400.css';
import '@fontsource/saira-stencil-one/400.css';
import './styles/tokens.css';
import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioEngine } from './audio/engine';
import { playback } from './core/playback';
import { useEditor, useTransport } from './core/store';
import { App } from './App';
import { loadDemoProject } from './ui/actions';
import { applyLayout } from './ui/layout';
import { loadAutosave, startAutosave } from './ui/persist';

declare global {
  interface Window { __introgen: { useEditor: typeof useEditor; useTransport: typeof useTransport; playback: typeof playback } }
}
window.__introgen = { useEditor, useTransport, playback };

function followAudio() {
  const prepare = () => {
    AudioEngine.get().prepare(useEditor.getState().project).catch((err) => console.warn('[introgen] audio prepare failed', err));
  };
  let timer = 0;
  useEditor.subscribe((s, prev) => {
    if (s.rev === prev.rev) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(prepare, 300);
  });
  prepare();
}

async function boot() {
  applyLayout();
  const saved = await loadAutosave();
  const project = saved ?? (await loadDemoProject());
  if (project) useEditor.getState().loadProject(project);
  followAudio();
  startAutosave();
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}

boot();
