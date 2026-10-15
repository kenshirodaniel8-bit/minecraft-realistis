// Companions: up to five of your monsters walk with you (owned monsters with
// following = true and no base pad). The server moves them, so everybody
// sees the same thing and their hits are real:
//   - they keep a little formation behind you,
//   - when a wild monster hits you, or you hit one, or one is about to
//     attack you, they run over and attack it with you,
//   - one that ends up more than "9 feet" (7.5 m) away while not fighting
//     pops back to your side (X calls all of them at once),
//   - they cannot be hurt and never fight other players.
// They are sent in the monster snapshot with the ALLY flag and their
// owner's player number, so the client draws them with the monster renderer.

import { SPECIES_BY_ID, SPECIES_INDEX, monsterStats } from '#shared/monsters.js';
import { WATER_Y } from '#shared/world.js';
import { fail } from '../validate.js';
import { MS } from './monsterAI.js';

export const MAX_COMPANIONS = 5;
export const ALLY_FLAG = 256;
export const COMPANION = {
  teleportDist: 7.5,   // ~9 feet: farther than this (not fighting) -> back to your side
  fightLeash: 24,      // while fighting they may chase this far from you
  threatMs: 8000,      // how long a monster that hit you (or you hit) stays a target
  callCooldownMs: 1000,
};
const ID_BASE = 1_000_000_000;
const SLOTS = [[0, 3.2], [-0.75, 3.8], [0.75, 3.8], [-1.35, 4.9], [1.35, 4.9]];
const FLYERS = new Set(['fly', 'flutter', 'serpent', 'float']);

export class Companions {
  constructor(game) {
    this.game = game;
    this.nextId = 1;
    this.think = 0;
  }

  followers(s) {
    return s.profile.monsters.filter((m) => m.following && m.slot === null).slice(0, MAX_COMPANIONS);
  }

  // Keeps s.allies in step with the monsters the player brings along.
  sync(s) {
    const want = this.followers(s);
    if (!s.allies) s.allies = new Map();
    const keep = new Set(want.map((m) => m.id));
    for (const [oid, a] of s.allies) {
      if (!keep.has(oid) || this.game.stealing.isAway(oid)) {
        s.allies.delete(oid);
        this.game.broadcastNear(a.x, a.z, 160, 'mGone', { id: a.id, reason: 'home' });
      }
    }
    want.forEach((m, i) => {
      if (this.game.stealing.isAway(m.id)) return;
      let a = s.allies.get(m.id);
      if (!a || a.level !== m.level) {
        if (a) this.game.broadcastNear(a.x, a.z, 160, 'mGone', { id: a.id, reason: 'home' });
        a = this.create(s, m, i);
        s.allies.set(m.id, a);
      }
      a.slotIndex = i;
    });
  }

  create(s, owned, i) {
    const sp = SPECIES_BY_ID[owned.species];
    const st = monsterStats(sp, owned.level);
    const slot = this.slotPos(s, i);
    const a = {
      id: ID_BASE + this.nextId++,
      ownedId: owned.id,
      sp,
      idx: SPECIES_INDEX[sp.id],
      level: owned.level,
      atk: st.atk,
      // they are drawn a little smaller than the wild giants (see client)
      radius: 0.75 * Math.min(sp.size, 1.6),
      fly: FLYERS.has(sp.ai.move),
      x: slot.x,
      z: slot.z,
      y: s.pos.y,
      yaw: s.yaw,
      state: MS.idle,
      target: null,
      attack: null,
      readyAt: 0,
      farSince: 0,
      slotIndex: i,
    };
    a.y = this.heightAt(s, a, a.x, a.z);
    return a;
  }

  slotPos(s, i) {
    const [da, d] = SLOTS[i % SLOTS.length];
    const ang = s.yaw + Math.PI + da;
    return { x: s.pos.x + Math.sin(ang) * d, z: s.pos.z + Math.cos(ang) * d };
  }

  heightAt(s, a, x, z) {
    const world = this.game.world;
    let g = world.surfaceHeight(x, z, s.pos.y + 1);
    // over a gap (floating platforms, a tower floor's edge) they keep to your height
    if (g < s.pos.y - 3.5) g = s.pos.y;
    if (!a.fly) g = Math.max(g, WATER_Y - 0.5);
    return a.fly ? Math.max(g, WATER_Y) + 1.4 : g;
  }

  // ------------------------------------------------------------ threats

  // A wild monster hit the player, or the player hit it.
  noteThreat(s, monsterId) {
    if (!s.threats) s.threats = new Map();
    s.threats.set(monsterId, this.game.now());
  }

  threatsOf(s, now) {
    const out = [];
    const monsters = this.game.monsters;
    if (s.threats) {
      for (const [id, at] of s.threats) {
        const m = monsters.get(id);
        if (!m || now - at > COMPANION.threatMs || !monsters.isAlive(m)) {
          s.threats.delete(id);
          continue;
        }
        out.push(m);
      }
    }
    // and monsters going for you right now
    for (const m of monsters.list.values()) {
      if (m.target !== s.pn || !monsters.isAlive(m) || out.includes(m)) continue;
      if ((m.x - s.pos.x) ** 2 + (m.z - s.pos.z) ** 2 < 16 * 16) out.push(m);
    }
    return out.filter((m) => monsters.canHit(s, m) && (m.x - s.pos.x) ** 2 + (m.z - s.pos.z) ** 2 < COMPANION.fightLeash ** 2);
  }

  // ------------------------------------------------------------ handlers

  handleCall(s) {
    const now = this.game.now();
    this.sync(s);
    if (!s.allies.size) return fail('none', 'No monsters are following you. Open one in your collection and press "Bring along".');
    if (now < (s.callReadyAt || 0)) return fail('cooldown');
    s.callReadyAt = now + COMPANION.callCooldownMs;
    let n = 0;
    for (const a of s.allies.values()) {
      a.target = null;
      a.attack = null;
      this.poof(s, a);
      n++;
    }
    return { ok: true, count: n };
  }

  poof(s, a) {
    const p = this.slotPos(s, a.slotIndex);
    a.x = p.x;
    a.z = p.z;
    a.y = this.heightAt(s, a, a.x, a.z);
    a.yaw = s.yaw;
    a.farSince = 0;
    a.state = MS.idle;
    this.game.broadcastNear(a.x, a.z, 160, 'allyPoof', { id: a.id, x: Math.round(a.x * 10) / 10, y: Math.round(a.y * 10) / 10, z: Math.round(a.z * 10) / 10 });
  }

  // ------------------------------------------------------------ simulation

  tick(dt, now) {
    this.think = (this.think + 1) % 4;
    for (const s of this.game.players.values()) {
      if (this.think === 0 || !s.allies) this.sync(s);
      if (!s.allies.size) continue;
      const threats = this.think === 0 || !s.threatCache ? (s.threatCache = this.threatsOf(s, now)) : s.threatCache;
      for (const a of s.allies.values()) this.update(s, a, threats, dt, now);
    }
  }

  update(s, a, threats, dt, now) {
    const monsters = this.game.monsters;
    // owner knocked out or gone far away (home, a portal...): straight back
    const dOwner = Math.hypot(a.x - s.pos.x, a.z - s.pos.z);
    if (s.dead) {
      a.target = null;
      a.attack = null;
      a.state = MS.idle;
      return;
    }
    if (dOwner > 60 || Math.abs(a.y - s.pos.y) > 12) {
      a.target = null;
      a.attack = null;
      this.poof(s, a);
      return;
    }
    // an attack in progress
    if (a.attack) {
      const m = a.target;
      if (a.attack.phase === 'windup' && now >= a.attack.hitAt) {
        if (m && monsters.isAlive(m)) this.strike(s, a, m);
        a.attack.phase = 'strike';
        a.state = MS.strike;
      }
      if (now >= a.attack.endAt) {
        a.attack = null;
        a.state = MS.chase;
      }
      return;
    }
    // pick or keep a target
    if (a.target && (!monsters.isAlive(a.target) || !monsters.list.has(a.target.id) || !threats.includes(a.target))) a.target = null;
    if (!a.target && threats.length) {
      let best = null;
      let bd = Infinity;
      for (const m of threats) {
        const d = (m.x - a.x) ** 2 + (m.z - a.z) ** 2;
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      a.target = best;
    }
    if (a.target) {
      const m = a.target;
      if (dOwner > COMPANION.fightLeash) {
        a.target = null;
        this.poof(s, a);
        return;
      }
      const dx = m.x - a.x;
      const dz = m.z - a.z;
      const d = Math.hypot(dx, dz) || 1;
      const reach = m.radius + a.radius + 1.4;
      a.yaw = Math.atan2(dx, dz);
      if (d > reach) {
        this.moveToward(s, a, m.x - (dx / d) * (reach - 0.6), m.z - (dz / d) * (reach - 0.6), 22, dt);
        a.state = MS.chase;
      } else if (now >= a.readyAt) {
        this.startAttack(s, a, m, now);
      } else a.state = MS.idle;
      a.farSince = 0;
      return;
    }
    // follow in formation
    const slot = this.slotPos(s, a.slotIndex);
    const ds = Math.hypot(slot.x - a.x, slot.z - a.z);
    if (ds > 0.5) {
      this.moveToward(s, a, slot.x, slot.z, Math.min(30, 4 + ds * 4), dt);
      a.state = ds > 3 ? MS.chase : MS.wander;
    } else {
      a.state = MS.idle;
      let dy = s.yaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += dy * Math.min(1, dt * 3);
    }
    // too far from you ("9 feet") for a moment: pop back
    if (Math.hypot(a.x - s.pos.x, a.z - s.pos.z) > COMPANION.teleportDist) {
      if (!a.farSince) a.farSince = now;
      else if (now - a.farSince > 450) this.poof(s, a);
    } else a.farSince = 0;
  }

  moveToward(s, a, tx, tz, speed, dt) {
    const dx = tx - a.x;
    const dz = tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    const step = Math.min(d, speed * dt);
    a.x += (dx / d) * step;
    a.z += (dz / d) * step;
    a.yaw = Math.atan2(dx, dz);
    a.y = this.heightAt(s, a, a.x, a.z);
  }

  startAttack(s, a, m, now) {
    const i = Math.max(0, a.sp.attacks.findIndex((x) => x.kind === 'melee' || x.kind === 'slam'));
    const atk = a.sp.attacks[i];
    const kind = atk.kind === 'slam' || atk.kind === 'breath' ? atk.kind : 'melee';
    const windupMs = 320;
    a.attack = { phase: 'windup', i, hitAt: now + windupMs, endAt: now + windupMs + 380 };
    a.readyAt = now + 1300 + Math.floor(this.game.rng() * 300);
    a.state = MS.windup;
    this.game.broadcastNear(a.x, a.z, 140, 'mAttack', { id: a.id, i, kind, windupMs, tx: Math.round(m.x * 10) / 10, tz: Math.round(m.z * 10) / 10, ally: true });
  }

  strike(s, a, m) {
    const game = this.game;
    const atk = a.sp.attacks[a.attack.i];
    let dmg = a.atk * 1.5 * Math.min(1.6, atk.power || 1) * (0.9 + game.rng() * 0.2);
    dmg *= 100 / (100 + m.def * 3);
    dmg = Math.max(1, Math.round(dmg));
    game.broadcastNear(a.x, a.z, 140, 'mStrike', { id: a.id, i: a.attack.i, ally: true });
    game.monsters.damage(m, dmg, s, { ally: true });
    game.broadcastNear(m.x, m.z, 140, 'hits', { pn: s.pn, ally: a.id, hits: [{ id: m.id, dmg, hp: Math.round((100 * m.hp) / m.maxHp), ally: true }] });
  }

  // ------------------------------------------------------------ snapshots

  snapshotFor(viewer, out, radius) {
    const r1 = (v) => Math.round(v * 10) / 10;
    for (const s of this.game.players.values()) {
      if (!s.allies || s.dead) continue;
      for (const a of s.allies.values()) {
        if ((a.x - viewer.pos.x) ** 2 + (a.z - viewer.pos.z) ** 2 > radius * radius) continue;
        out.push([a.id, a.idx, r1(a.x), r1(a.y), r1(a.z), Math.round(a.yaw * 100) / 100, a.state, 100, a.level, ALLY_FLAG, 0, s.pn]);
      }
    }
    return out;
  }

  onLeave(s) {
    if (!s.allies) return;
    for (const a of s.allies.values()) this.game.broadcastNear(a.x, a.z, 160, 'mGone', { id: a.id, reason: 'home' });
    s.allies.clear();
  }
}
