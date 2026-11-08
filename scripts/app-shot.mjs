// Opens the full app headlessly and screenshots it.  usage: node scripts/app-shot.mjs out.png [time] [samples]
import puppeteer from 'puppeteer-core';
const [out, time = '9.1', samples = '6'] = process.argv.slice(2);
const port = process.env.PORT ?? '5196';
const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium-browser', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1920, height: 1080 } });
const page = await b.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 400)));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__introgen && window.__renderAt', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 6000));
console.log('project', await page.evaluate(() => { const s = window.__introgen.useEditor.getState(); return [s.project.name, s.project.layers.length, s.project.hits.length, s.project.clips.length].join(' / '); }));
await page.evaluate(async (t, n) => { await window.__renderAt(t, n); }, +time, +samples);
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: out });
console.log('errors', errors.length, errors.slice(0, 6));
await b.close();
