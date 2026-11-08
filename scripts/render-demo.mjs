// Exports the demo through the app's real export path. Needs `pnpm dev` running.
// usage: PORT=5173 node scripts/render-demo.mjs out.mp4 [width] [height] [fps] [samples]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [out = 'demo.mp4', w = '960', h = '540', fps = '30', samples = '3'] = process.argv.slice(2);
const port = process.env.PORT ?? '5173';
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium-browser', headless: 'new', protocolTimeout: 0, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'], defaultViewport: { width: 1280, height: 720 } });
const page = await b.newPage();
page.on('console', (m) => { if (m.text().startsWith('[render]')) console.log(m.text()); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.waitForFunction('window.__introgen && window.__renderAt', { timeout: 60000 });
const res = await page.evaluate(async (w, h, fps, samples) => {
  const { exportVideo } = await import('/src/render/export.ts');
  const { useEditor } = window.__introgen;
  useEditor.getState().setUI({ quality: 'draft' });
  const p = useEditor.getState().project;
  let last = 0;
  const blob = await exportVideo(p, { format: 'mp4', width: w, height: h, fps, samples, bitrate: 10e6, start: 0, end: p.duration }, (e) => {
    if (e.frame - last >= 30) { last = e.frame; console.log(`[render] ${e.frame}/${e.total}`); }
  }, new AbortController().signal);
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
  return btoa(s);
}, +w, +h, +fps, +samples);
fs.writeFileSync(out, Buffer.from(res, 'base64'));
await b.close();
console.log('wrote', out);
