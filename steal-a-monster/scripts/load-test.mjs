// Server load test: N simulated players (real Socket.IO clients) walk out of
// their bases, wander the plains and swing swords, while the server's tick
// time, event-loop lag and per-client bandwidth are measured.
//   node scripts/load-test.mjs [players=12] [seconds=60]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { io as ioClient } from 'socket.io-client';
import { createGameServer } from '../server/network.js';
import { PROTOCOL_VERSION, CONFIG } from '../shared/config.js';
import { buildWorld } from '../shared/world.js';

const N = Math.max(1, Math.min(CONFIG.maxPlayers, Number(process.argv[2]) || 12));
const SECONDS = Math.max(5, Number(process.argv[3]) || 60);
const world = buildWorld();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-load-'));
const srv = await createGameServer({ port: 0, host: '127.0.0.1', dataDir, quiet: true });
const game = srv.game;

// time every server tick
const ticks = [];
const tick = game.tick.bind(game);
game.tick = (dt) => {
  const t0 = performance.now();
  tick(dt);
  ticks.push(performance.now() - t0);
};
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();

function connect() {
  const s = ioClient(`http://127.0.0.1:${srv.port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const bots = [];
const reasons = {};
for (let i = 0; i < N; i++) {
  const s = await connect();
  const w = await s.timeout(5000).emitWithAck('hello', { protocol: PROTOCOL_VERSION, token: `load-test-token-${i}-xxxxxxxx`, name: `Bot${i + 1}` });
  if (!w.ok) throw new Error(`join failed: ${w.error}`);
  const base = world.bases[w.baseIndex];
  // out through the tower door, then round the tower through the gap between
  // two bases (towers are solid: walking through one is refused)
  const gap = base.angle + (i % 2 ? 1 : -1) * (Math.PI / 12);
  const route = [base.spawn, base.outside, { x: Math.cos(gap) * 76, z: Math.sin(gap) * 76 }, { x: Math.cos(gap) * 128, z: Math.sin(gap) * 128 }];
  const bot = { s, pos: { ...w.pos }, tp: w.teleportSeq, yaw: 0, base, bytes: 0, corrections: 0, route, leg: 0 };
  s.onAny((e, d) => { bot.bytes += e.length + JSON.stringify(d ?? null).length; });
  s.on('teleport', (d) => {
    bot.pos = { x: d.x, y: d.y, z: d.z };
    bot.tp = d.seq;
    bot.corrections++;
    reasons[d.reason] = (reasons[d.reason] || 0) + 1;
  });
  bots.push(bot);
}
console.log(`${N} players joined; running ${SECONDS}s`);

// after leaving the base, wander between random points on the plains ring
// behind the towers (close enough together that no straight line between
// two of them cuts through a tower)
function nextTarget(bot) {
  const a = bot.base.angle + (Math.random() - 0.5) * 0.6;
  const r = 120 + Math.random() * 25;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

const speed = CONFIG.player.walkSpeed * 0.85;
const stepMs = 66;
const bytesAtStart = new Map();
const started = Date.now();
await new Promise((resolve) => {
  const iv = setInterval(() => {
    for (const bot of bots) {
      const target = bot.route[bot.leg] || (bot.route[bot.leg] = nextTarget(bot));
      const dx = target.x - bot.pos.x;
      const dz = target.z - bot.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) bot.leg++;
      const step = Math.min(d, (speed * stepMs) / 1000);
      if (d > 0.01) {
        bot.pos.x += (dx / d) * step;
        bot.pos.z += (dz / d) * step;
        bot.yaw = Math.atan2(dx, dz);
      }
      // slide around trees and walls like the real client does; if stuck on
      // something, pick another place to go
      const bx = bot.pos.x;
      const bz = bot.pos.z;
      world.colliders.resolve(bot.pos, CONFIG.player.radius, CONFIG.player.height);
      if (Math.hypot(bot.pos.x - bx, bot.pos.z - bz) > step * 0.8 && bot.leg >= bot.route.length - 1) bot.route[bot.leg] = nextTarget(bot);
      bot.pos.y = world.surfaceHeight(bot.pos.x, bot.pos.z, bot.pos.y);
      bot.s.emit('move', { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z, yaw: bot.yaw, a: 1, tp: bot.tp });
      if (Math.random() < 0.08) bot.s.emit('attack', { yaw: bot.yaw });
    }
    if (Date.now() - started > 5000 && !bytesAtStart.size) for (const b of bots) bytesAtStart.set(b, b.bytes);
    if (Date.now() - started > SECONDS * 1000) {
      clearInterval(iv);
      resolve();
    }
  }, stepMs);
});

const sorted = [...ticks].sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const measured = SECONDS - 5;
const kbps = bots.map((b) => (b.bytes - (bytesAtStart.get(b) || 0)) / 1024 / measured);
const result = {
  players: N,
  seconds: SECONDS,
  monsters: game.monsters.list.size,
  ticks: ticks.length,
  tickMs: { avg: +(ticks.reduce((a, b) => a + b, 0) / ticks.length).toFixed(2), p50: +pct(0.5).toFixed(2), p95: +pct(0.95).toFixed(2), p99: +pct(0.99).toFixed(2), max: +sorted[sorted.length - 1].toFixed(2) },
  budgetMs: 1000 / CONFIG.tickRate,
  eventLoopLagMs: { p50: +(lag.percentile(50) / 1e6).toFixed(1), p99: +(lag.percentile(99) / 1e6).toFixed(1) },
  downKBps: { avg: +(kbps.reduce((a, b) => a + b, 0) / kbps.length).toFixed(1), max: +Math.max(...kbps).toFixed(1) },
  corrections: bots.reduce((a, b) => a + b.corrections, 0),
  correctionReasons: reasons,
  rssMB: Math.round(process.memoryUsage().rss / 1048576),
};
console.log(JSON.stringify(result, null, 2));
for (const b of bots) b.s.disconnect();
await srv.close();
fs.rmSync(dataDir, { recursive: true, force: true });
const ok = result.tickMs.p95 < result.budgetMs;
console.log(ok ? `\nLOAD OK: p95 tick ${result.tickMs.p95} ms of a ${result.budgetMs} ms budget` : '\nLOAD WARNING: ticks exceed the budget');
process.exit(ok ? 0 : 1);
