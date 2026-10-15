// Worst case for the wild monster population: 12 players, each on a different
// island/region, so every one of those regions fills up to its 50 monsters.
// Runs the real Game in-process with a simulated clock and times every tick
// (AI, combat, snapshots for every player).
//   node scripts/population-bench.mjs [seconds=60]
import { Game } from '../server/game.js';
import { MemoryStore } from '../server/storage.js';
import { CONFIG, PROTOCOL_VERSION } from '../shared/config.js';
import { REGIONS, regionCenter } from '../shared/regions.js';

const SECONDS = Math.max(10, Number(process.argv[2]) || 60);
const clock = { t: 1_700_000_000_000 };
const game = new Game({ store: new MemoryStore(), now: () => clock.t, expansionThresholds: [0, 0], log: () => {} });
await game.init();

// one player per region (the plaza hub has the bases, so it counts as one)
const regions = REGIONS.slice(0, CONFIG.maxPlayers);
const players = [];
for (let i = 0; i < regions.length; i++) {
  const bytes = { n: 0 };
  const transport = {
    closed: false,
    send: (e, d) => { bytes.n += e.length + JSON.stringify(d ?? null).length; },
    sendVolatile: (e, d) => { bytes.n += e.length + JSON.stringify(d ?? null).length; },
    disconnect() {},
  };
  const res = await game.join(`bench${i}`, { protocol: PROTOCOL_VERSION, token: `population-bench-token-${i}-xx`, name: `Bench${i + 1}` }, transport);
  if (!res.ok) throw new Error(res.error);
  const s = game.players.get(`bench${i}`);
  s.profile.level = 30;
  const c = regionCenter(regions[i]);
  // the plains centre is the plaza (a safe zone): stand out in the meadow
  const home = regions[i].id === 'plains' ? { x: 60, z: -40 } : c;
  players.push({ s, home, bytes, region: regions[i].id });
}

const step = 1000 / CONFIG.tickRate;
const ticks = [];
let bytesAtWarm = null;
const total = SECONDS * CONFIG.tickRate;
for (let k = 0; k < total; k++) {
  clock.t += step;
  // walk slowly in a circle around the region centre, never knocked out
  for (const [i, p] of players.entries()) {
    const a = (k / total) * Math.PI * 2 + i;
    p.s.pos.x = p.home.x + Math.cos(a) * 20;
    p.s.pos.z = p.home.z + Math.sin(a) * 20;
    p.s.hp = p.s.maxHp;
  }
  const t0 = performance.now();
  game.tick(step);
  ticks.push(performance.now() - t0);
  if (k === 20 * CONFIG.tickRate) bytesAtWarm = players.map((p) => p.bytes.n);
}

const warm = ticks.slice(20 * CONFIG.tickRate); // after the islands filled up
const sorted = [...warm].sort((a, b) => a - b);
const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const perRegion = {};
for (const m of game.monsters.list.values()) perRegion[m.region] = (perRegion[m.region] || 0) + 1;
const measured = SECONDS - 20;
const kbps = players.map((p, i) => (p.bytes.n - bytesAtWarm[i]) / 1024 / measured);
console.log(JSON.stringify({
  players: players.length,
  simulatedSeconds: SECONDS,
  monsters: game.monsters.list.size,
  monstersPerRegion: perRegion,
  tickMs: {
    avg: +(warm.reduce((a, b) => a + b, 0) / warm.length).toFixed(2),
    p50: +pct(0.5).toFixed(2),
    p95: +pct(0.95).toFixed(2),
    p99: +pct(0.99).toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
  },
  budgetMs: step,
  downKBpsPerPlayer: { avg: +(kbps.reduce((a, b) => a + b, 0) / kbps.length).toFixed(1), max: +Math.max(...kbps).toFixed(1) },
}, null, 2));
