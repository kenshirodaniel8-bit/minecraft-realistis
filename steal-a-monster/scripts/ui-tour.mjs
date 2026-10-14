// Opens every UI panel in a real browser and saves screenshots (manual QA aid).
//   node scripts/ui-tour.mjs ./shots
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
if (!pw) {
  console.error('Playwright is not installed.');
  process.exit(2);
}
const out = process.argv[2] || './ui-shots';
fs.mkdirSync(out, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-ui-'));
const srv = await createGameServer({ port: 0, host: '127.0.0.1', dataDir, devCommands: true, quiet: true });
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => localStorage.setItem('sam_settings', JSON.stringify({ quality: 'medium', name: 'Tourist', volume: 0 })));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${srv.port}/`);
await page.screenshot({ path: path.join(out, '00-title.png') });
await page.click('#play-btn');
await page.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 90000 });
// give the tourist some progress so the panels have content
const s = [...srv.game.players.values()][0];
srv.game.economy.credit(s, 50000, 'test');
for (const [sp, lvl, slot] of [['draklet', 3, 0], ['mossbun', 2, 1], ['voltkit', 2, 2], ['chompkin', 1, null]]) {
  const m = { id: `mtour${sp}`, species: sp, level: lvl, slot, following: slot === null, origin: 'recruited', obtainedAt: Date.now() };
  s.profile.monsters.push(m);
  srv.game.ledger.set(m.id, s.id, sp, lvl);
  s.profile.discoveries.species[sp] = Date.now();
}
s.profile.cosmetics.owned.push('party_hat');
s.profile.cosmetics.equipped = 'party_hat';
srv.game.refreshPerks(s);
srv.game.markProfile(s);
srv.game.bases.broadcastBase(s.baseIndex);
srv.game.broadcast('playerInfo', srv.game.playerInfo(s));
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(out, '01-hud-base.png') });
for (const panel of ['collection', 'codex', 'swords', 'items', 'base', 'board', 'map', 'settings', 'help']) {
  await page.evaluate((p) => window.__app.ui.open(p), panel);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, `panel-${panel}.png`) });
}
await page.evaluate(() => window.__app.ui.open('inspect', { owned: 'mtourdraklet' }));
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(out, 'panel-inspect.png') });
await page.evaluate(() => window.__app.ui.close());
// LUCKY LUCKY
srv.game.events.trigger('luckyLucky');
srv.game.events.events.luckyLucky.startsAt = Date.now() + 1000;
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(out, '02-lucky-lucky.png') });
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no browser errors');
await browser.close();
await srv.close();
fs.rmSync(dataDir, { recursive: true, force: true });
