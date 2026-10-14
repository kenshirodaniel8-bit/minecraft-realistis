// Phone-sized browser with touch: checks the touch controls work (manual QA aid).
//   node scripts/mobile-check.mjs ./shots
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server/network.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pw;
for (const t of [root, '/opt/node22/lib/node_modules/']) {
  try {
    pw = createRequire(path.join(t, 'x.js'))('playwright');
    break;
  } catch { /* next */ }
}
if (!pw) process.exit(2);
const out = process.argv[2] || './mobile-shots';
fs.mkdirSync(out, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-mobile-'));
const srv = await createGameServer({ port: 0, host: '127.0.0.1', dataDir, quiet: true });
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('sam_settings', JSON.stringify({ quality: 'low', name: 'Phone', volume: 0 })));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${srv.port}/`);
await page.screenshot({ path: path.join(out, 'mobile-title.png') });
await page.tap('#play-btn');
await page.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const touchVisible = await page.evaluate(() => !document.getElementById('touch-ui').hidden && document.body.classList.contains('touch'));
console.log(touchVisible ? '✔ touch controls shown' : '✘ touch controls hidden');
await page.screenshot({ path: path.join(out, 'mobile-hud.png') });
// drag the joystick forward for 2 seconds
const start = await page.evaluate(() => ({ ...window.__app.player.pos }));
const zone = await page.$('.tc-stick-zone');
const box = await zone.boundingBox();
const cx = box.x + 90;
const cy = box.y + box.height - 90;
const cdp = await ctx.newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
for (let i = 1; i <= 10; i++) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - i * 5, id: 1 }] });
  await page.waitForTimeout(30);
}
await page.waitForTimeout(2500);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const end = await page.evaluate(() => ({ ...window.__app.player.pos }));
const moved = Math.hypot(end.x - start.x, end.z - start.z);
console.log(moved > 2 ? `✔ joystick moved the player ${moved.toFixed(1)} units` : `✘ joystick did not move the player (${moved.toFixed(2)})`);
// attack button
await page.tap('.tc-attack');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, 'mobile-moved.png') });
console.log(errors.length ? `✘ errors: ${errors.join(' | ')}` : '✔ no browser errors');
await browser.close();
await srv.close();
fs.rmSync(dataDir, { recursive: true, force: true });
