// Test harness: a Game with a controllable clock, deterministic randomness,
// in-memory (or temp-dir) storage and fake transports that record messages.

import { Game } from '../server/game.js';
import { MemoryStore } from '../server/storage.js';
import { mulberry32 } from '../shared/rng.js';
import { PROTOCOL_VERSION } from '../shared/config.js';
import { SPECIES_BY_ID } from '../shared/monsters.js';

export const TOKEN_A = 'test-token-alpha-0001';
export const TOKEN_B = 'test-token-bravo-0002';
export const TOKEN_C = 'test-token-charlie-003';

let sidCounter = 0;

export async function makeGame(opts = {}) {
  const clock = { t: 1_700_000_000_000 };
  const store = opts.store || new MemoryStore();
  const game = new Game({
    store,
    now: () => clock.t,
    rng: mulberry32(opts.seed ?? 12345),
    log: opts.log || (() => {}),
    devCommands: opts.devCommands,
    expansionThresholds: opts.expansionThresholds,
  });
  await game.init();
  // keep tests focused: no automatic event and no ambient spawning unless asked
  if (!opts.events) for (const e of Object.values(game.events.events)) e.nextAt = Infinity;
  if (!opts.spawning) {
    game.monsters.spawnTick = () => {};
    game.lucky.tick = () => {};
  }

  const h = {
    game,
    store,
    clock,
    advance(ms, step = 50) {
      while (ms > 0) {
        const d = Math.min(step, ms);
        clock.t += d;
        ms -= d;
        game.tick(d);
      }
    },
    async join(token, name = 'Player', extra = {}) {
      const inbox = [];
      const transport = {
        closed: false,
        send: (e, d) => inbox.push([e, d]),
        sendVolatile: (e, d) => inbox.push([e, d]),
        disconnect() { this.closed = true; },
      };
      const sid = `sid${++sidCounter}`;
      const res = await game.join(sid, { protocol: PROTOCOL_VERSION, token, name, ...extra }, transport);
      const client = {
        sid,
        res,
        inbox,
        transport,
        get s() { return game.players.get(sid); },
        get profile() { return game.players.get(sid)?.profile; },
        send: (type, payload) => game.handle(sid, type, payload),
        events: (name) => inbox.filter(([e]) => e === name).map(([, d]) => d),
        last: (name) => {
          for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i][0] === name) return inbox[i][1];
          return undefined;
        },
        clear: () => { inbox.length = 0; },
      };
      return client;
    },
    // Test setup shortcut: put a player somewhere directly (not via the
    // validated move path), keeping server bookkeeping consistent.
    place(client, x, z, yaw = 0) {
      const s = client.s;
      s.pos = { x, y: game.world.groundHeight(x, z), z };
      s.yaw = yaw;
      s.lastMoveAt = clock.t;
      game.afterMove(s, require_region(x, z));
    },
    // Walk with valid, speed-limited moves (like a real client).
    walk(client, x, z, speed = 15) {
      const s = client.s;
      let guard = 0;
      while (guard++ < 2000) {
        const dx = x - s.pos.x;
        const dz = z - s.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.05) return { ok: true };
        const stepMs = 66;
        const step = Math.min(d, (speed * stepMs) / 1000);
        h.advance(stepMs, stepMs);
        const nx = s.pos.x + (dx / d) * step;
        const nz = s.pos.z + (dz / d) * step;
        const r = game.handle(client.sid, 'move', { x: nx, y: game.world.surfaceHeight(nx, nz, s.pos.y), z: nz, yaw: Math.atan2(dx, dz), a: 1, tp: s.teleportSeq });
        if (r && r.ok === false) return r;
      }
      return { ok: false, error: 'guard' };
    },
    spawnMonster(speciesId, level, x, z) {
      const sp = SPECIES_BY_ID[speciesId];
      const m = game.monsters.spawn(sp, level, x, z, { region: require_region(x, z) });
      return m;
    },
    // Attack until the monster is defeated (or attempts run out).
    defeat(client, m, max = 400) {
      for (let i = 0; i < max && m.state !== 7; i++) {
        const s = client.s;
        if (s.dead) h.advance(4000);
        // stay next to it
        s.pos.x = m.x - 2;
        s.pos.z = m.z;
        s.pos.y = m.y;
        m.stunnedUntil = clock.t + 100000; // keep it still for the test
        h.advance(600, 100);
        game.handle(client.sid, 'attack', { yaw: Math.atan2(m.x - s.pos.x, m.z - s.pos.z) });
      }
      return m.state === 7;
    },
  };
  return h;
}

import { regionIdAt } from '../shared/regions.js';
function require_region(x, z) {
  return regionIdAt(x, z);
}

// A spot inside the plains, away from bases and the plaza, for fights.
export const FIELD = { x: 60, z: -40 };
