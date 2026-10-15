// Global timed events. Each event definition has hooks; the manager runs a
// simple lifecycle for every event: idle -> announce -> active -> idle, and
// synchronises the state to every player (with server timestamps, so every
// client shows the same countdown).

import { CONFIG } from '#shared/config.js';
import { SPECIES_BY_ID } from '#shared/monsters.js';

const EVENT_DEFS = {
  luckyLucky: {
    name: 'LUCKY LUCKY',
    cfg: () => CONFIG.events.luckyLucky,
    onStart(game) {
      const n = game.lucky.spawnEventBlocks(CONFIG.events.luckyLucky.blocks);
      game.broadcast('announce', { text: `LUCKY LUCKY! ${n} Lucky Blocks appeared and Luckitty is roaming!`, kind: 'lucky' });
    },
    onEnd(game) {
      game.lucky.clearEventBlocks();
    },
    // event monsters spawn near players while it runs
    spawnTick(game, now, st) {
      if (now < (st.nextSpawnAt || 0)) return;
      st.nextSpawnAt = now + 8000;
      const live = [...game.monsters.list.values()].filter((m) => m.event === 'luckyLucky').length;
      const want = Math.min(6, Math.max(2, game.players.size));
      if (live >= want) return;
      const players = [...game.players.values()].filter((s) => !s.dead);
      if (!players.length) return;
      const s = players[Math.floor(game.rng() * players.length)];
      if (!game.expansion.active.has(s.region)) return;
      const sp = SPECIES_BY_ID.luckitty;
      const pt = game.monsters.findSpawnPoint(sp, s.region, s.pos, 30, 90);
      if (!pt) return;
      game.monsters.spawn(sp, Math.max(1, game.monsters.pickLevel({ levels: [s.profile.level, s.profile.level + 2] })), pt.x, pt.z, { region: s.region, event: 'luckyLucky' });
    },
  },
};

export class EventManager {
  constructor(game) {
    this.game = game;
    this.events = {};
  }

  init() {
    const now = this.game.now();
    for (const [id, def] of Object.entries(EVENT_DEFS)) {
      this.events[id] = { id, name: def.name, phase: 'idle', nextAt: now + def.cfg().firstDelayMs, startsAt: 0, endsAt: 0 };
    }
  }

  state() {
    return Object.values(this.events).map((e) => ({ id: e.id, name: e.name, phase: e.phase, startsAt: e.startsAt, endsAt: e.endsAt, nextAt: e.nextAt }));
  }

  isActive(id) {
    return this.events[id]?.phase === 'active';
  }

  rareMultiplier() {
    return this.isActive('luckyLucky') ? CONFIG.events.luckyLucky.rareSpawnMultiplier : 1;
  }

  // Starts an event now (dev command / tests).
  trigger(id) {
    const e = this.events[id];
    if (!e || e.phase !== 'idle') return false;
    e.nextAt = this.game.now();
    this.tick(0, this.game.now());
    return true;
  }

  broadcastState() {
    this.game.broadcast('event', this.state());
  }

  tick(dt, now) {
    for (const e of Object.values(this.events)) {
      const def = EVENT_DEFS[e.id];
      const cfg = def.cfg();
      if (e.phase === 'idle' && now >= e.nextAt) {
        if (this.game.players.size === 0) {
          e.nextAt = now + 30000; // nobody to enjoy it, try again later
          continue;
        }
        e.phase = 'announce';
        e.startsAt = now + cfg.announceMs;
        e.endsAt = e.startsAt + cfg.durationMs;
        this.broadcastState();
      } else if (e.phase === 'announce' && now >= e.startsAt) {
        e.phase = 'active';
        def.onStart(this.game, e);
        this.broadcastState();
      } else if (e.phase === 'active' && now >= e.endsAt) {
        e.phase = 'idle';
        e.nextAt = now + cfg.intervalMs;
        def.onEnd(this.game, e);
        this.broadcastState();
        this.game.broadcast('announce', { text: `${e.name} is over! Next one in ${Math.round(cfg.intervalMs / 60000)} minutes.`, kind: 'info' });
      }
    }
  }

  spawnTick(now) {
    for (const e of Object.values(this.events)) {
      if (e.phase === 'active' && EVENT_DEFS[e.id].spawnTick) EVENT_DEFS[e.id].spawnTick(this.game, now, e);
    }
  }
}
