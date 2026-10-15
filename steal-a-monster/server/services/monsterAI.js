// Wild monsters: spawning, AI, attacks and projectiles.
//
// One central manager updates every monster (no per-monster timers). Monsters
// only exist in regions near players; regions nobody is near go dormant and
// their monsters are cleaned up. Each species' temperament decides how it
// reacts to players:
//   aggressive  - chases any player it notices
//   territorial - attacks players who come close to its home
//   neutral     - ignores players until it is hit
//   shy         - runs away; fights back only after being hit
// Movement styles (hop, fly, swim...) are visual on the client; on the server
// they decide hover height and whether water is allowed.

import { CONFIG } from '#shared/config.js';
import { SPECIES, SPECIES_BY_ID, SPECIES_INDEX, RARITIES, monsterStats } from '#shared/monsters.js';
import { REGIONS, REGION_BY_ID, regionIdAt } from '#shared/regions.js';
import { randomGroundPoint, isInsideBase, PLAZA, WATER_Y, SPOT_BY_ID } from '#shared/world.js';
import { angleDiff } from './combat.js';

export const MS = {
  idle: 0, wander: 1, chase: 2, windup: 3, strike: 4, flee: 5, stunned: 6, defeated: 7, sleep: 8, recover: 9, return: 10, quirk: 11,
};

const FLYERS = new Set(['fly', 'flutter', 'serpent']);

function rand(rng, a, b) {
  return a + rng() * (b - a);
}

export class MonsterManager {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.list = new Map();
    this.nextId = 1;
    this.projectiles = new Map();
    this.nextProj = 1;
    this.spotNext = {};       // species id -> next time a spot spawn may roll
    this.spotLive = {};       // species id -> monster id
    this.regionSpawnAt = {};
    this.lastSpawnCheck = 0;
    this.thinkFlip = 0;
    this.tables = {};
    for (const r of REGIONS) {
      this.tables[r.id] = SPECIES.filter((sp) => sp.spawn.weight > 0 && sp.spawn.regions.includes(r.id) && !sp.spawn.event);
    }
    this.spotSpecies = SPECIES.filter((sp) => sp.spawn.spot);
  }

  get rng() {
    return this.game.rng;
  }

  // Every open region can hold its 50 (plus a little room for hidden-spot and
  // event monsters), so opening an expansion island raises the capacity.
  cap() {
    const c = CONFIG.monsters;
    return Math.min(c.hardCap, c.perRegion * this.game.expansion.active.size + 20);
  }

  // ------------------------------------------------------------ spawning

  spawn(species, level, x, z, opts = {}) {
    const now = this.game.now();
    const st = monsterStats(species, level);
    const regionId = opts.region || regionIdAt(x, z);
    const m = {
      id: this.nextId++,
      species,
      sp: species.id,
      idx: SPECIES_INDEX[species.id],
      level,
      maxHp: st.maxHp,
      hp: st.maxHp,
      atk: st.atk,
      def: st.def,
      speed: st.speed,
      radius: 0.75 * species.size,
      height: 2.2 * species.size,
      fly: FLYERS.has(species.ai.move),
      swims: !!species.ai.swims || species.ai.move === 'swim',
      hover: species.ai.hover || 0,
      x, z, y: 0,
      yaw: this.rng() * Math.PI * 2,
      home: { x, z },
      region: regionId,
      territory: species.ai.territory,
      state: MS.idle,
      stateUntil: now + rand(this.rng, 500, 3000),
      target: null,
      moveTarget: null,
      moveSpeed: 0,
      attack: null,
      cooldowns: species.attacks.map(() => now + rand(this.rng, 300, 1200)),
      damageBy: new Map(),
      spawnedAt: now,
      lastNearAt: now,
      spot: opts.spot || null,
      event: opts.event || null,
      clueFor: opts.clueFor || null,
      stunnedUntil: 0,
      burn: null,
      slowUntil: 0,
      provokedUntil: 0,
      kb: null,
      dash: null,
      eligible: null,
    };
    m.y = this.groundY(m, x, z);
    this.list.set(m.id, m);
    if (opts.spot) this.spotLive[species.id] = m.id;
    return m;
  }

  groundY(m, x, z) {
    const g = this.world.groundHeight(x, z);
    if (m.fly) return Math.max(g, WATER_Y) + m.hover;
    if (m.swims && g < WATER_Y - 0.6) return WATER_Y - 0.5 + (m.hover || 0);
    return g + (m.hover || 0);
  }

  pickLevel(region) {
    const [a, b] = region.levels;
    const t = this.rng();
    return Math.round(a + (b - a) * t * t); // lower levels are more common
  }

  pickSpecies(regionId) {
    const night = this.game.isNight();
    const rareMult = this.game.events.rareMultiplier();
    const table = this.tables[regionId].filter((sp) => {
      const t = sp.spawn.time;
      return !t || t === 'any' || (t === 'night' ? night : !night);
    });
    let total = 0;
    const w = table.map((sp) => {
      const v = sp.spawn.weight * (RARITIES[sp.rarity].order >= 1 ? rareMult : 1);
      total += v;
      return v;
    });
    let r = this.rng() * total;
    for (let i = 0; i < table.length; i++) {
      r -= w[i];
      if (r <= 0) return table[i];
    }
    return table[0] || null;
  }

  // Regions with a player inside them.
  occupiedRegions() {
    const out = new Set();
    for (const s of this.game.players.values()) {
      if (!s.dead) out.add(regionIdAt(s.pos.x, s.pos.z));
    }
    return out;
  }

  // Regions within reach of at least one player -> players near them.
  nearbyRegions() {
    const out = new Map();
    const add = (id, s) => {
      if (!id) return;
      if (!out.has(id)) out.set(id, []);
      const list = out.get(id);
      if (!list.includes(s)) list.push(s);
    };
    for (const s of this.game.players.values()) {
      if (s.dead) continue;
      add(regionIdAt(s.pos.x, s.pos.z), s);
      for (const r of [80, 150]) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          add(regionIdAt(s.pos.x + Math.cos(a) * r, s.pos.z + Math.sin(a) * r), s);
        }
      }
    }
    return out;
  }

  farFromPlayers(x, z, min) {
    for (const s of this.game.players.values()) {
      const dx = s.pos.x - x;
      const dz = s.pos.z - z;
      if (dx * dx + dz * dz < min * min) return false;
    }
    return true;
  }

  // A region with a player in it fills up to CONFIG.monsters.perRegion (50),
  // spread over the whole region; a region a player is only close to gets a
  // smaller group near them, so walking across a border never feels empty.
  // Regions nobody is near stay empty (see cleanup), which keeps the server
  // and every client's work bounded by where players actually are.
  spawnTick(now) {
    const game = this.game;
    if (game.players.size === 0) return;
    const C = CONFIG.monsters;
    const active = game.expansion.active;
    const counts = {};
    for (const m of this.list.values()) if (!m.spot && !m.event) counts[m.region] = (counts[m.region] || 0) + 1;
    const occupied = this.occupiedRegions();
    const nearby = this.nearbyRegions();
    for (const [regionId, near] of nearby) {
      if (!active.has(regionId)) continue;
      const inside = occupied.has(regionId);
      const target = inside ? C.perRegion : C.neighbourRegion;
      // fill quickly when a region is mostly empty, then top up slowly
      let groups = (counts[regionId] || 0) < target * 0.6 ? 6 : 1;
      if (now < (this.regionSpawnAt[regionId] || 0)) continue;
      this.regionSpawnAt[regionId] = now + 700;
      const region = REGION_BY_ID[regionId];
      while (groups-- > 0 && (counts[regionId] || 0) < target && this.list.size < this.cap()) {
        const sp = this.pickSpecies(regionId);
        if (!sp) break;
        const anchor = near[Math.floor(this.rng() * near.length)];
        // inside a region half of them go anywhere in it, half near a player
        const anywhere = inside && this.rng() < 0.5;
        const pt = this.findSpawnPoint(sp, regionId, anywhere ? null : anchor.pos, 34, C.spawnMaxPlayerDist);
        if (!pt) continue;
        const [g0, g1] = sp.spawn.group || [1, 1];
        const n = Math.min(Math.round(rand(this.rng, g0, g1)), target - (counts[regionId] || 0));
        for (let i = 0; i < n; i++) {
          const q = i === 0 ? pt : randomGroundPoint(this.world, regionId, this.rng, { near: pt, minR: 2, maxR: 7, anyWater: true }) || pt;
          this.spawn(sp, this.pickLevel(region), q.x, q.z, { region: regionId });
          counts[regionId] = (counts[regionId] || 0) + 1;
        }
      }
    }
    this.spotTick(now);
    this.game.events.spawnTick(now);
  }

  findSpawnPoint(sp, regionId, near, minR, maxR) {
    const water = !!sp.spawn.water;
    const canSwim = sp.ai.swims || sp.ai.move === 'swim';
    const flies = FLYERS.has(sp.ai.move);
    for (let t = 0; t < 4; t++) {
      const opts = near ? { near, minR, maxR } : {};
      if (water) opts.water = true;
      else if (canSwim || flies) opts.anyWater = true;
      let pt = randomGroundPoint(this.world, regionId, this.rng, opts);
      if (!pt && water && sp.ai.move !== 'swim') pt = randomGroundPoint(this.world, regionId, this.rng, { near, minR, maxR });
      if (!pt) pt = randomGroundPoint(this.world, regionId, this.rng, water ? { water: true } : canSwim || flies ? { anyWater: true } : {});
      if (pt && this.farFromPlayers(pt.x, pt.z, CONFIG.monsters.spawnMinPlayerDist)) return pt;
    }
    return null;
  }

  spotTick(now) {
    const game = this.game;
    const night = game.isNight();
    for (const sp of this.spotSpecies) {
      const live = this.spotLive[sp.id];
      if (live && this.list.has(live)) continue;
      if (now < (this.spotNext[sp.id] || 0)) continue;
      const spot = SPOT_BY_ID[sp.spawn.spot];
      if (!spot || !game.expansion.active.has(spot.region)) continue;
      const t = sp.spawn.time;
      if (t === 'night' && !night) continue;
      if (t === 'day' && night) continue;
      if (sp.spawn.requiresPuzzle && !game.puzzles.isOpen()) continue;
      let someone = false;
      for (const s of game.players.values()) {
        if ((s.pos.x - spot.x) ** 2 + (s.pos.z - spot.z) ** 2 < 230 * 230) someone = true;
      }
      if (!someone) continue;
      if (this.rng() > (sp.spawn.chance ?? 1)) {
        this.spotNext[sp.id] = now + (sp.spawn.respawnMs || 60000) * 0.5;
        continue;
      }
      const region = REGION_BY_ID[spot.region];
      let pt;
      if (sp.spawn.water) pt = randomGroundPoint(this.world, spot.region, this.rng, { near: spot, minR: spot.r + 2, maxR: spot.r + 22, water: true });
      if (!pt) pt = randomGroundPoint(this.world, spot.region, this.rng, { near: spot, minR: 0, maxR: Math.max(2, spot.r * 0.55), anyWater: true });
      if (!pt) pt = { x: spot.x, z: spot.z };
      const lvl = Math.min(region.levels[1] + 2, this.pickLevel(region) + 2);
      const m = this.spawn(sp, lvl, pt.x, pt.z, { spot: spot.id, region: spot.region });
      m.territory = Math.max(m.territory, spot.r + 4);
      this.spotNext[sp.id] = now + (sp.spawn.respawnMs || 60000);
    }
  }

  devSpawn(s, speciesId) {
    const sp = SPECIES_BY_ID[speciesId] || SPECIES[Math.floor(this.rng() * SPECIES.length)];
    const a = s.yaw;
    const x = s.pos.x + Math.sin(a) * 8;
    const z = s.pos.z + Math.cos(a) * 8;
    const region = regionIdAt(x, z) || 'plains';
    return this.spawn(sp, REGION_BY_ID[region].levels[0], x, z, { region });
  }

  // Spawns a rare monster for a Lucky Block clue or encounter.
  spawnSpecial(s, kind) {
    const regionId = s.region;
    const region = REGION_BY_ID[regionId];
    let pool;
    if (kind === 'encounter' && this.game.events.isActive('luckyLucky')) pool = [SPECIES_BY_ID.luckitty];
    else {
      pool = SPECIES.filter((sp) => (sp.spawn.regions.includes(regionId) || (sp.spawn.spot && SPOT_BY_ID[sp.spawn.spot]?.region === regionId))
        && RARITIES[sp.rarity].order >= 1 && sp.category !== 'boss' && !sp.spawn.event);
      if (!pool.length) pool = this.tables[regionId];
    }
    if (!pool.length) return null;
    const sp = pool[Math.floor(this.rng() * pool.length)];
    const near = kind === 'encounter' ? { minR: 10, maxR: 18 } : { minR: 50, maxR: 130 };
    const pt = randomGroundPoint(this.world, regionId, this.rng, { near: s.pos, ...near, anyWater: true })
      || randomGroundPoint(this.world, regionId, this.rng, { anyWater: true });
    if (!pt) return null;
    const m = this.spawn(sp, this.pickLevel(region) + 1, pt.x, pt.z, { region: regionId, clueFor: s.id, event: sp.spawn.event || null });
    m.lastNearAt = this.game.now() + 60000;
    return m;
  }

  remove(m, reason, extra = {}) {
    if (!this.list.delete(m.id)) return;
    if (m.spot && this.spotLive[m.sp] === m.id) {
      delete this.spotLive[m.sp];
      this.spotNext[m.sp] = this.game.now() + (m.species.spawn.respawnMs || 60000);
    }
    this.game.broadcastNear(m.x, m.z, CONFIG.interestRadius + 20, 'mGone', { id: m.id, reason, ...extra });
  }

  // ------------------------------------------------------------ queries

  get(id) {
    return this.list.get(id);
  }

  isAlive(m) {
    return m.state !== MS.defeated && m.state !== MS.recover;
  }

  findInArc(pos, yaw, reach, arcDeg, max) {
    const out = [];
    const half = (arcDeg / 2) * (Math.PI / 180);
    for (const m of this.list.values()) {
      if (!this.isAlive(m)) continue;
      const dx = m.x - pos.x;
      const dz = m.z - pos.z;
      const dy = m.y - pos.y;
      if (Math.abs(dy) > 3 + m.height) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d - m.radius > reach) continue;
      if (d > m.radius + 0.6 && angleDiff(Math.atan2(dx, dz), yaw) > half) continue;
      out.push({ m, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, max).map((o) => o.m);
  }

  nearestTo(m0, range, exclude) {
    let best = null;
    let bd = range * range;
    for (const m of this.list.values()) {
      if (exclude.has(m) || !this.isAlive(m)) continue;
      const d = (m.x - m0.x) ** 2 + (m.z - m0.z) ** 2;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  sessionByPn(pn) {
    for (const s of this.game.players.values()) if (s.pn === pn) return s;
    return null;
  }

  // ------------------------------------------------------------ damage

  damage(m, dmg, s, opts = {}) {
    if (!this.isAlive(m)) return;
    const now = this.game.now();
    m.hp -= dmg;
    m.damageBy.set(s.id, (m.damageBy.get(s.id) || 0) + dmg);
    m.lastNearAt = now;
    const temper = m.species.ai.temper;
    if (temper === 'shy') {
      m.provokedUntil = now + 9000;
    }
    if (m.state !== MS.windup && m.state !== MS.strike) {
      m.target = s.pn;
      m.aggroUntil = now + 12000;
      if (m.state === MS.sleep || m.state === MS.idle || m.state === MS.wander || m.state === MS.flee || m.state === MS.quirk) m.state = MS.chase;
    }
    if (m.hp <= 0) {
      m.hp = 0;
      this.defeat(m, s);
    }
  }

  knockback(m, from, force) {
    if (m.species.ai.boss) force *= 0.3;
    const dx = m.x - from.x;
    const dz = m.z - from.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    m.kb = { vx: (dx / d) * force * 4, vz: (dz / d) * force * 4, until: this.game.now() + 250 };
  }

  defeat(m, s) {
    m.state = MS.defeated;
    m.attack = null;
    m.dash = null;
    m.target = null;
    m.burn = null;
    for (const p of this.projectiles.values()) if (p.owner === m.id) p.until = 0;
    this.game.broadcastNear(m.x, m.z, CONFIG.interestRadius + 20, 'mDefeated', { id: m.id, by: s.pn });
    this.game.recruitment.onDefeated(m, s);
  }

  // A defeated monster nobody recruited wakes up and runs off.
  recover(m) {
    if (!this.list.has(m.id)) return;
    m.state = MS.recover;
    m.stateUntil = this.game.now() + 2500;
    m.hp = m.maxHp;
    m.eligible = null;
    const a = this.rng() * Math.PI * 2;
    m.moveTarget = { x: m.x + Math.cos(a) * 20, z: m.z + Math.sin(a) * 20 };
    m.moveSpeed = m.speed * 1.1;
    this.game.broadcastNear(m.x, m.z, CONFIG.interestRadius + 20, 'mRecover', { id: m.id });
  }

  // ------------------------------------------------------------ AI

  tick(dt, now) {
    if (now - this.lastSpawnCheck > 1000) {
      this.lastSpawnCheck = now;
      this.spawnTick(now);
      this.cleanup(now);
    }
    this.thinkFlip ^= 1;
    for (const m of this.list.values()) {
      this.update(m, dt, now, ((m.id & 1) ^ this.thinkFlip) === 1);
    }
    this.tickProjectiles(dt, now);
  }

  cleanup(now) {
    const active = this.game.expansion.active;
    const occupied = this.occupiedRegions();
    for (const m of [...this.list.values()]) {
      if (m.state === MS.defeated) continue;
      // a monster stays while someone is on its island or close to it
      let near = occupied.has(m.region);
      if (!near) for (const s of this.game.players.values()) {
        const dx = s.pos.x - m.x;
        const dz = s.pos.z - m.z;
        if (dx * dx + dz * dz < CONFIG.monsters.activationRadius ** 2) {
          near = true;
          break;
        }
      }
      if (near) m.lastNearAt = now;
      if (!active.has(m.region) || now - m.lastNearAt > CONFIG.monsters.dormantAfterMs) this.remove(m, 'despawn');
      else if (m.event && !this.game.events.isActive(m.event) && m.state !== MS.chase) this.remove(m, 'despawn');
    }
  }

  playerTargetable(s, m) {
    if (s.dead) return false;
    if (s.pos.x * s.pos.x + s.pos.z * s.pos.z < (PLAZA.r + 2) ** 2) return false; // the plaza is a safe zone
    if (s.inBases.size) return false;                                              // so are bases
    const dy = s.pos.y - m.y;
    return dy < 10 && dy > -10;
  }

  update(m, dt, now, think) {
    if (m.state === MS.defeated) return;
    if (m.state === MS.recover) {
      this.moveMonster(m, dt);
      if (now > m.stateUntil) this.remove(m, 'recovered');
      return;
    }
    if (m.burn && m.burn.until > now) {
      m.burn.acc += m.burn.dps * dt;
      if (m.burn.acc >= 2) {
        const d = Math.floor(m.burn.acc);
        m.burn.acc -= d;
        if (m.burn.by && this.game.players.has(m.burn.by.sid)) {
          this.damage(m, d, m.burn.by, { dot: true });
          this.game.broadcastNear(m.x, m.z, 100, 'hits', { pn: m.burn.by.pn, hits: [{ id: m.id, dmg: d, burn: true, hp: Math.round((100 * m.hp) / m.maxHp) }] });
          if (m.state === MS.defeated) return;
        }
      }
    }
    if (m.kb) {
      if (now > m.kb.until) m.kb = null;
      else this.stepTo(m, m.x + m.kb.vx * dt, m.z + m.kb.vz * dt);
    }
    if (m.stunnedUntil > now) {
      if (m.state !== MS.stunned) {
        m.state = MS.stunned;
        m.attack = null;
        m.dash = null;
      }
      return;
    } else if (m.state === MS.stunned) {
      m.state = m.target !== null ? MS.chase : MS.idle;
    }
    if (m.state === MS.windup || m.state === MS.strike) {
      this.updateAttack(m, dt, now);
      return;
    }
    if (think) this.think(m, now);
    this.moveMonster(m, dt);
  }

  think(m, now) {
    const ai = m.species.ai;
    const players = this.game.players;
    let nearest = null;
    let nd = Infinity;
    for (const s of players.values()) {
      if (!this.playerTargetable(s, m)) continue;
      const d = Math.hypot(s.pos.x - m.x, s.pos.z - m.z);
      if (d < nd) {
        nd = d;
        nearest = s;
      }
    }
    const detect = ai.detect * (0.8 + 0.2 * m.species.size);
    // keep or drop the current target
    if (m.target !== null) {
      const s = this.sessionByPn(m.target);
      const leash = m.territory * CONFIG.combat.leashFactor + 10;
      const homeD = Math.hypot(m.x - m.home.x, m.z - m.home.z);
      if (!s || !this.playerTargetable(s, m) || homeD > leash || (now > (m.aggroUntil || 0) && ai.temper !== 'aggressive' && ai.temper !== 'territorial')) {
        m.target = null;
        m.state = MS.return;
      }
    }
    if (m.target === null && m.state !== MS.return) {
      const night = this.game.isNight();
      const aggressive = ai.temper === 'aggressive' && (!ai.nightAggro || night);
      if (nearest && aggressive && nd < detect) {
        m.target = nearest.pn;
        m.aggroUntil = now + 8000;
      } else if (nearest && ai.temper === 'territorial') {
        const hd = Math.hypot(nearest.pos.x - m.home.x, nearest.pos.z - m.home.z);
        if (hd < m.territory + 2 && nd < detect * 1.4) {
          m.target = nearest.pn;
          m.aggroUntil = now + 8000;
        }
      } else if (nearest && ai.temper === 'shy' && nd < detect * 0.8 && m.provokedUntil < now) {
        m.state = MS.flee;
        m.stateUntil = now + 2500;
        const dx = m.x - nearest.pos.x;
        const dz = m.z - nearest.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        m.moveTarget = { x: m.x + (dx / d) * 16, z: m.z + (dz / d) * 16 };
        m.moveSpeed = m.speed * 1.05;
        return;
      }
    }
    if (m.target !== null) {
      const s = this.sessionByPn(m.target);
      m.state = MS.chase;
      const dx = s.pos.x - m.x;
      const dz = s.pos.z - m.z;
      const d = Math.hypot(dx, dz);
      const edge = d - m.radius - CONFIG.player.radius;
      // pick an attack that is ready and in range (longest cooldown first)
      let best = -1;
      for (let i = 0; i < m.species.attacks.length; i++) {
        const a = m.species.attacks[i];
        if (now < m.cooldowns[i]) continue;
        const reach = a.kind === 'slam' ? Math.max(a.range, a.radius * 0.7) : a.range;
        if (edge > reach || edge < (a.minRange || 0) - 0.5) continue;
        if (best < 0 || a.cooldownMs > m.species.attacks[best].cooldownMs) best = i;
      }
      if (best >= 0 && Math.abs(s.pos.y - m.y) < 4 + m.height) {
        this.startAttack(m, best, s, now);
        return;
      }
      const stop = m.radius + CONFIG.player.radius + 1.2;
      if (d > stop) {
        m.moveTarget = { x: s.pos.x - (dx / d) * stop * 0.9, z: s.pos.z - (dz / d) * stop * 0.9 };
        m.moveSpeed = m.speed;
      } else {
        m.moveTarget = null;
        m.yaw = Math.atan2(dx, dz);
      }
      return;
    }
    if (m.state === MS.flee) {
      if (now > m.stateUntil) m.state = MS.idle;
      return;
    }
    if (m.state === MS.return) {
      const d = Math.hypot(m.x - m.home.x, m.z - m.home.z);
      if (d < 3 || !m.moveTarget) {
        m.state = MS.idle;
        m.hp = m.maxHp;
        m.damageBy.clear();
        m.stateUntil = now + 1000;
      } else {
        m.moveSpeed = m.speed * 0.7;
      }
      if (m.state === MS.return) m.moveTarget = { ...m.home };
      return;
    }
    // idle behaviours
    if (now < m.stateUntil) return;
    const r = this.rng();
    const sleepy = m.species.personality.idles.includes('sleepy') || this.game.isNight();
    if (r < 0.55) {
      const a = this.rng() * Math.PI * 2;
      const dist = this.rng() * m.territory;
      m.moveTarget = { x: m.home.x + Math.cos(a) * dist, z: m.home.z + Math.sin(a) * dist };
      m.moveSpeed = m.speed * 0.35;
      m.state = MS.wander;
      m.stateUntil = now + rand(this.rng, 3000, 7000);
    } else if (r < 0.85 || !sleepy) {
      m.moveTarget = null;
      m.state = this.rng() < 0.5 ? MS.quirk : MS.idle;
      m.quirk = Math.floor(this.rng() * 8);
      m.stateUntil = now + rand(this.rng, 2000, 5000);
    } else {
      m.moveTarget = null;
      m.state = MS.sleep;
      m.stateUntil = now + rand(this.rng, 6000, 14000);
    }
  }

  // Moves toward m.moveTarget, respecting regions, safe zones, water and props.
  moveMonster(m, dt) {
    const t = m.moveTarget;
    if (!t) return;
    const dx = t.x - m.x;
    const dz = t.z - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) {
      m.moveTarget = null;
      if (m.state === MS.wander) m.state = MS.idle;
      return;
    }
    const slow = m.slowUntil > this.game.now() ? 0.6 : 1;
    const step = Math.min(d, m.moveSpeed * slow * dt);
    const ok = this.stepTo(m, m.x + (dx / d) * step, m.z + (dz / d) * step);
    const want = Math.atan2(dx, dz);
    let diff = want - m.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    m.yaw += diff * Math.min(1, dt * 10);
    if (!ok && m.state === MS.wander) {
      m.moveTarget = null;
      m.state = MS.idle;
    }
  }

  stepTo(m, nx, nz) {
    if (regionIdAt(nx, nz) !== m.region) return false;
    if (nx * nx + nz * nz < (PLAZA.r + 6) ** 2) return false;
    for (const b of this.world.bases) if (isInsideBase(b, nx, nz, 2)) return false;
    const g = this.world.groundHeight(nx, nz);
    if (!m.fly && !m.swims && g < WATER_Y - 0.7) return false;
    if (this.world.isLava(nx, nz, g) && m.species.element !== 'fire') return false;
    const pos = { x: nx, y: g, z: nz };
    this.world.colliders.resolve(pos, m.radius, m.height);
    if (regionIdAt(pos.x, pos.z) !== m.region) return false;
    m.x = pos.x;
    m.z = pos.z;
    m.y = this.groundY(m, m.x, m.z);
    return true;
  }

  // ------------------------------------------------------------ attacks

  startAttack(m, i, s, now) {
    const a = m.species.attacks[i];
    m.state = MS.windup;
    m.moveTarget = null;
    m.attack = { i, a, t0: now, pn: s.pn, aim: { x: s.pos.x, z: s.pos.z }, struck: false };
    m.yaw = Math.atan2(s.pos.x - m.x, s.pos.z - m.z);
    this.game.broadcastNear(m.x, m.z, CONFIG.interestRadius, 'mAttack', {
      id: m.id, i, kind: a.kind, windupMs: a.windupMs, tx: Math.round(s.pos.x * 10) / 10, tz: Math.round(s.pos.z * 10) / 10,
    });
  }

  updateAttack(m, dt, now) {
    const atk = m.attack;
    if (!atk) {
      m.state = MS.chase;
      return;
    }
    const a = atk.a;
    const s = this.sessionByPn(atk.pn);
    const t = now - atk.t0;
    if (m.state === MS.windup) {
      if (s && t < a.windupMs * 0.6) {
        atk.aim = { x: s.pos.x, z: s.pos.z };
        m.yaw = Math.atan2(atk.aim.x - m.x, atk.aim.z - m.z);
      }
      if (t >= a.windupMs) this.strike(m, now);
      return;
    }
    // strike / recovery
    if (m.dash) {
      const d = m.dash;
      if (now < d.until) {
        const ok = this.stepTo(m, m.x + d.vx * dt, m.z + d.vz * dt);
        if (!ok) d.until = now;
        for (const p of this.game.players.values()) {
          if (d.hit.has(p.pn) || !this.playerTargetable(p, m)) continue;
          const dist = Math.hypot(p.pos.x - m.x, p.pos.z - m.z);
          if (dist < m.radius + CONFIG.player.radius + 0.6) {
            d.hit.add(p.pn);
            this.hitPlayer(m, a, p, now);
          }
        }
        return;
      }
      m.dash = null;
    }
    if (now >= m.stateUntil) {
      m.attack = null;
      m.state = m.target !== null ? MS.chase : MS.idle;
    }
  }

  hitPlayer(m, a, p, now) {
    const dmg = m.atk * a.power * (0.9 + this.rng() * 0.2);
    const dx = p.pos.x - m.x;
    const dz = p.pos.z - m.z;
    const d = Math.hypot(dx, dz) || 1;
    const kb = a.knockback ? { x: (dx / d) * a.knockback, z: (dz / d) * a.knockback, up: Math.min(10, a.knockback * 0.5) } : null;
    this.game.combat.damagePlayer(p, dmg, { from: m.id, kb, effect: a.effect });
  }

  strike(m, now) {
    const atk = m.attack;
    const a = atk.a;
    atk.struck = true;
    m.cooldowns[atk.i] = now + a.cooldownMs;
    m.state = MS.strike;
    m.stateUntil = now + 380;
    const fx = Math.sin(m.yaw);
    const fz = Math.cos(m.yaw);
    this.game.broadcastNear(m.x, m.z, CONFIG.interestRadius, 'mStrike', { id: m.id, i: atk.i });
    const reachOf = (p) => Math.hypot(p.pos.x - m.x, p.pos.z - m.z) - m.radius - CONFIG.player.radius;
    switch (a.kind) {
      case 'melee':
        for (const p of this.game.players.values()) {
          if (!this.playerTargetable(p, m)) continue;
          if (reachOf(p) > a.range + 0.6) continue;
          if (angleDiff(Math.atan2(p.pos.x - m.x, p.pos.z - m.z), m.yaw) > 0.8 * Math.PI / 2 + 0.3) continue;
          this.hitPlayer(m, a, p, now);
        }
        break;
      case 'slam':
        for (const p of this.game.players.values()) {
          if (!this.playerTargetable(p, m)) continue;
          if (Math.hypot(p.pos.x - m.x, p.pos.z - m.z) > a.radius + CONFIG.player.radius) continue;
          this.hitPlayer(m, a, p, now);
        }
        break;
      case 'breath':
        for (const p of this.game.players.values()) {
          if (!this.playerTargetable(p, m)) continue;
          if (reachOf(p) > a.range) continue;
          if (angleDiff(Math.atan2(p.pos.x - m.x, p.pos.z - m.z), m.yaw) > (a.arc / 2) * (Math.PI / 180)) continue;
          this.hitPlayer(m, a, p, now);
        }
        break;
      case 'projectile': {
        if (this.projectiles.size >= CONFIG.monsters.maxProjectiles) break;
        const dx = atk.aim.x - m.x;
        const dz = atk.aim.z - m.z;
        const d = Math.hypot(dx, dz) || 1;
        const y = m.y + m.height * 0.55;
        const proj = {
          id: this.nextProj++, owner: m.id, a, m,
          x: m.x + (dx / d) * m.radius, y, z: m.z + (dz / d) * m.radius,
          vx: (dx / d) * a.speed, vz: (dz / d) * a.speed,
          radius: a.radius || 0.9,
          until: now + ((a.range * 1.35) / a.speed) * 1000,
        };
        this.projectiles.set(proj.id, proj);
        this.game.broadcastNear(m.x, m.z, CONFIG.interestRadius + 20, 'proj', {
          id: proj.id, x: proj.x, y: proj.y, z: proj.z, vx: proj.vx, vz: proj.vz, r: proj.radius, life: proj.until - now, color: a.color || '#ffffff', from: m.id,
        });
        break;
      }
      case 'lunge': {
        const dx = atk.aim.x - m.x;
        const dz = atk.aim.z - m.z;
        const d = Math.hypot(dx, dz) || 1;
        const dist = Math.min(a.range + 3, d + 2);
        const dur = (dist / a.dashSpeed) * 1000;
        m.dash = { vx: (dx / d) * a.dashSpeed, vz: (dz / d) * a.dashSpeed, until: now + dur, hit: new Set() };
        m.stateUntil = now + dur + 350;
        break;
      }
      default:
        break;
    }
    void fx;
    void fz;
  }

  tickProjectiles(dt, now) {
    for (const p of this.projectiles.values()) {
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      let end = now >= p.until;
      let hit = null;
      if (!end) {
        const g = this.world.groundHeight(p.x, p.z);
        if (g > p.y + 0.5) end = true;
      }
      if (!end) {
        for (const s of this.game.players.values()) {
          if (s.dead) continue;
          const dx = s.pos.x - p.x;
          const dz = s.pos.z - p.z;
          const dy = s.pos.y + 2 - p.y;
          if (dx * dx + dz * dz < (p.radius + CONFIG.player.radius) ** 2 && Math.abs(dy) < 3) {
            hit = s;
            end = true;
            break;
          }
        }
      }
      if (end) {
        this.projectiles.delete(p.id);
        if (hit && this.list.has(p.owner)) this.hitPlayer(p.m, p.a, hit, now);
        else if (hit) this.game.combat.damagePlayer(hit, p.m.atk * p.a.power, { from: p.owner, effect: p.a.effect });
        this.game.broadcastNear(p.x, p.z, CONFIG.interestRadius + 20, 'projEnd', { id: p.id, x: p.x, z: p.z, hit: !!hit });
      }
    }
  }

  // ------------------------------------------------------------ snapshots

  snapshotFor(s) {
    const out = [];
    const R = CONFIG.interestRadius;
    const r1 = (v) => Math.round(v * 10) / 10;
    for (const m of this.list.values()) {
      const dx = m.x - s.pos.x;
      const dz = m.z - s.pos.z;
      if (dx * dx + dz * dz > R * R) continue;
      let flags = 0;
      const now = this.game.now();
      if (m.burn && m.burn.until > now) flags |= 1;
      if (m.stunnedUntil > now) flags |= 2;
      if (m.clueFor === s.id) flags |= 4;
      if (m.event) flags |= 8;
      if (m.species.category === 'elite' || m.species.category === 'boss' || m.species.category === 'legendary') flags |= 16;
      if (m.target === s.pn) flags |= 32;
      if (m.dash) flags |= 64;
      out.push([m.id, m.idx, r1(m.x), r1(m.y), r1(m.z), Math.round(m.yaw * 100) / 100, m.state, Math.round((100 * m.hp) / m.maxHp), m.level, flags, m.state === MS.quirk ? m.quirk : 0]);
    }
    return out;
  }

  // Rare/hidden monsters within radar range of a player (Monster Radar item).
  radarFor(s, radius) {
    const out = [];
    for (const m of this.list.values()) {
      if (RARITIES[m.species.rarity].order < 1 || !this.isAlive(m)) continue;
      if (Math.hypot(m.x - s.pos.x, m.z - s.pos.z) > radius) continue;
      out.push({ id: m.id, sp: m.sp, x: Math.round(m.x), z: Math.round(m.z) });
    }
    return out;
  }
}
