// Population-based world expansion.
//
// Every region has a minPopulation. When enough players are online, the
// expansion islands open (their portals light up, monsters and Lucky Blocks
// appear there) and the server raises its monster capacity. When players
// leave, regions close again after a delay (hysteresis), players inside are
// warned and then brought back to the plaza. Everything stays bounded: a
// fixed set of region templates, a hard monster cap, and cleanup on close.

import { CONFIG } from '#shared/config.js';
import { REGIONS, REGION_BY_ID, regionIdAt } from '#shared/regions.js';

export class WorldExpansion {
  constructor(game, thresholds) {
    this.game = game;
    this.minPop = {};
    for (const r of REGIONS) this.minPop[r.id] = r.minPopulation || 0;
    // optional override, e.g. EXPANSION_THRESHOLDS="2,4" for bloomveil,starfall
    if (Array.isArray(thresholds)) {
      const exp = REGIONS.filter((r) => r.expansion);
      exp.forEach((r, i) => {
        if (Number.isFinite(thresholds[i])) this.minPop[r.id] = thresholds[i];
      });
    }
    this.active = new Set(REGIONS.filter((r) => this.minPop[r.id] <= 0).map((r) => r.id));
    this.closing = new Map(); // region id -> { at, warned }
  }

  population() {
    return this.game.players.size;
  }

  tier() {
    return REGIONS.filter((r) => r.expansion && this.active.has(r.id)).length;
  }

  spawnScale() {
    return 1 + 0.15 * this.tier();
  }

  state() {
    return {
      active: [...this.active],
      population: this.population(),
      tier: this.tier(),
      monsterCap: this.game.monsters ? this.game.monsters.cap() : 0,
      minPop: this.minPop,
      closing: Object.fromEntries([...this.closing].map(([id, c]) => [id, c.at])),
    };
  }

  update(silent = false) {
    const pop = this.population();
    const now = this.game.now();
    let changed = false;
    for (const r of REGIONS) {
      const want = this.minPop[r.id] <= pop;
      if (want && !this.active.has(r.id)) {
        this.active.add(r.id);
        changed = true;
        if (!silent) this.game.broadcast('announce', { text: `${r.name} has opened! (${pop} players online)`, kind: 'world' });
      }
      if (want && this.closing.has(r.id)) {
        this.closing.delete(r.id);
        changed = true;
      }
      if (!want && this.active.has(r.id) && !this.closing.has(r.id)) {
        this.closing.set(r.id, { at: now + CONFIG.expansion.shrinkDelayMs, warned: false });
        changed = true;
      }
    }
    if (changed && !silent) this.game.broadcast('world', this.state());
  }

  tick(dt, now) {
    for (const [id, c] of [...this.closing]) {
      const region = REGION_BY_ID[id];
      if (!c.warned && now >= c.at - CONFIG.expansion.closeWarningMs) {
        c.warned = true;
        for (const s of this.game.players.values()) {
          if (s.region === id) this.game.toast(s, `${region.name} is closing soon — not enough players online!`, 'warn');
        }
      }
      if (now >= c.at) {
        this.closing.delete(id);
        this.active.delete(id);
        for (const s of this.game.players.values()) {
          if (regionIdAt(s.pos.x, s.pos.z) === id) {
            const portal = this.game.world.portals.find((p) => p.region === 'plains' && regionIdAt(p.x, p.z) === id);
            const dest = portal ? portal.to : { x: 10, y: 3.6, z: -10 };
            this.game.stealing.interrupt(s, 'closed', 'returnToOwner');
            this.game.teleport(s, dest.x, dest.y, dest.z, 'region_closed');
            this.game.toast(s, `${region.name} closed. You were sent back to the plaza.`, 'warn');
          }
        }
        this.game.broadcast('world', this.state());
        this.game.broadcast('announce', { text: `${region.name} has closed until more players join.`, kind: 'world' });
      }
    }
  }
}
