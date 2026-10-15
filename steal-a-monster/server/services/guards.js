// Base guards (shared/guards.js): bought and upgraded in the Base panel.
//
// Each guard has a post (the door, or a spot on one of the tower's floors).
// A guard goes for "intruders": other players who are inside the base, who
// are carrying one of the owner's monsters away, or who hit a guard. Guards
// stay on their own floor (the door guards may step out in front of the
// door), hit with their swords, and can be knocked out; they get up again
// after GUARDS.respawnMs. From level 7 helicopters circle the tower and shoot
// intruders from the air while at least one guard is still standing.
//
// The owner is told when a thief comes in ("guardAlert" intruder) and when
// the thief has beaten every guard ("defeated"); the thief gets a red
// "THIEF" tag (EFFECT.thief) for everyone to see.

import { CONFIG } from '#shared/config.js';
import { GUARDS, GUARD_POSTS, guardLevel } from '#shared/guards.js';
import { baseLocal } from '#shared/world.js';
import { angleDiff } from './combat.js';

export const GS = { idle: 0, walk: 1, chase: 2, windup: 3, strike: 4, down: 7, fly: 8 };
const ID_BASE = 2_000_000_000;
const REACH = 2.8;
const WINDUP_MS = 380;
const STRIKE_MS = 320;
const ATTACK_EVERY_MS = 1150;
const INSIDE = 11.2;        // |u|, |v| inside the walls
const DOOR_V = 13.5;        // just outside the door
const OUTSIDE_V = 26;       // door guards don't go farther out than this
const OUTSIDE_U = 14;

export class GuardSystem {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.squads = new Map(); // base index -> squad
    this.nextId = 1;
    this.lastSync = 0;
  }

  ownerOf(index) {
    for (const s of this.game.players.values()) if (s.baseIndex === index) return s;
    return null;
  }

  floorY(base, floor) {
    return base.y + floor * CONFIG.bases.floorHeight;
  }

  // Squads follow their owner's guard level (and disappear with them).
  sync() {
    for (const base of this.world.bases) {
      const owner = this.ownerOf(base.index);
      const level = owner ? owner.profile.base.guardLevel || 0 : 0;
      let squad = this.squads.get(base.index);
      if (!level) {
        if (squad) this.drop(squad);
        continue;
      }
      if (squad && squad.level === level && squad.owner === owner) continue;
      if (squad) this.drop(squad);
      squad = this.makeSquad(base, owner, level);
      this.squads.set(base.index, squad);
    }
  }

  makeSquad(base, owner, level) {
    const L = guardLevel(level);
    const guards = [];
    for (let i = 0; i < L.guards; i++) {
      const [u, v, floor] = GUARD_POSTS[i];
      const p = base.toWorld(u, v);
      const post = { x: p.x, z: p.z, y: this.floorY(base, floor), floor, outside: v > base.half };
      guards.push({
        id: ID_BASE + this.nextId++, kind: 0, i, post, x: post.x, y: post.y, z: post.z, yaw: base.yaw,
        hp: L.hp, maxHp: L.hp, state: GS.idle, target: null, attack: null, readyAt: 0, downUntil: 0,
      });
    }
    const helis = [];
    for (let i = 0; i < L.helis; i++) {
      helis.push({ id: ID_BASE + this.nextId++, kind: 1, i, angle: (i / Math.max(1, L.helis)) * Math.PI * 2, x: base.x, y: base.y + 52, z: base.z, yaw: 0, state: GS.fly, readyAt: 0 });
    }
    return { base, owner, level, L, guards, helis, hitBy: new Map(), alerted: new Map(), allDown: false };
  }

  drop(squad) {
    this.squads.delete(squad.base.index);
    for (const g of [...squad.guards, ...squad.helis]) {
      this.game.broadcastNear(g.x, g.z, CONFIG.interestRadius + 20, 'gGone', { id: g.id });
    }
  }

  // ------------------------------------------------------------ who is a thief

  intruders(squad, now) {
    const { base, owner } = squad;
    const out = [];
    for (const p of this.game.players.values()) {
      if (p === owner || p.dead) continue;
      const inside = p.inBases.has(base.index);
      const carrying = p.carrying && p.carrying.victimId === owner.id && Math.hypot(p.pos.x - base.x, p.pos.z - base.z) < 70;
      const hostile = (squad.hitBy.get(p.pn) || 0) > now - 15000 && Math.hypot(p.pos.x - base.x, p.pos.z - base.z) < 60;
      if (inside || carrying || hostile) out.push(p);
    }
    return out;
  }

  // ------------------------------------------------------------ simulation

  tick(dt, now) {
    if (now - this.lastSync > 1000) {
      this.lastSync = now;
      this.sync();
    }
    for (const squad of this.squads.values()) {
      const ints = this.intruders(squad, now);
      for (const p of ints) {
        p.thiefUntil = now + 3000;
        const last = squad.alerted.get(p.pn) || 0;
        if (now - last > 30000) {
          this.game.send(squad.owner, 'guardAlert', { stage: 'intruder', thief: p.profile.name });
          this.game.send(p, 'guardAlert', { stage: 'spotted', owner: squad.owner.profile.name });
        }
        squad.alerted.set(p.pn, now);
      }
      for (const g of squad.guards) this.updateGuard(squad, g, ints, dt, now);
      for (const h of squad.helis) this.updateHeli(squad, h, ints, dt, now);
      // every guard knocked out: the thief beat the security
      const standing = squad.guards.some((g) => g.state !== GS.down);
      if (!standing && !squad.allDown) {
        squad.allDown = true;
        const thief = ints[0] || [...this.game.players.values()].find((p) => p.pn === squad.lastHitter);
        const who = thief ? thief.profile.name : 'A thief';
        this.game.send(squad.owner, 'guardAlert', { stage: 'defeated', thief: who });
        for (const p of ints) this.game.send(p, 'guardAlert', { stage: 'beaten', owner: squad.owner.profile.name });
        this.game.broadcastNear(squad.base.x, squad.base.z, 160, 'announce', { text: `💥 ${who} defeated ${squad.owner.profile.name}'s guards!`, kind: 'theft' });
      } else if (standing) squad.allDown = false;
    }
  }

  // The zone a point is in: 'in' (inside the walls), 'out' (in front of the
  // door) or null (anywhere else, where guards don't go).
  zone(base, x, z) {
    const { u, v } = baseLocal(base, x, z);
    if (Math.abs(u) <= INSIDE && Math.abs(v) <= INSIDE) return 'in';
    if (Math.abs(u) <= OUTSIDE_U && v >= base.half && v <= OUTSIDE_V) return 'out';
    if (Math.abs(u) <= 2.6 && v > INSIDE && v < base.half + 0.5) return 'door';
    return null;
  }

  updateGuard(squad, g, ints, dt, now) {
    const base = squad.base;
    if (g.state === GS.down) {
      if (now >= g.downUntil) {
        g.hp = g.maxHp;
        g.state = GS.idle;
        g.x = g.post.x;
        g.z = g.post.z;
        g.y = g.post.y;
        this.game.broadcastNear(g.x, g.z, 140, 'gUp', { id: g.id });
      }
      return;
    }
    // an attack in progress
    if (g.attack) {
      const t = this.game.players.get(g.attack.sid);
      if (g.state === GS.windup && now >= g.attack.hitAt) {
        g.state = GS.strike;
        if (t && !t.dead && Math.hypot(t.pos.x - g.x, t.pos.z - g.z) < REACH + 1.4 && Math.abs(t.pos.y - g.y) < 3) {
          const dx = t.pos.x - g.x;
          const dz = t.pos.z - g.z;
          const d = Math.hypot(dx, dz) || 1;
          this.game.combat.damagePlayer(t, squad.L.damage * (0.9 + this.game.rng() * 0.2), { from: 'guard', kb: { x: (dx / d) * 6, z: (dz / d) * 6, up: 3 } });
        }
        this.game.broadcastNear(g.x, g.z, 140, 'gStrike', { id: g.id });
      }
      if (now >= g.attack.endAt) {
        g.attack = null;
        g.state = GS.chase;
      }
      return;
    }
    // pick the nearest intruder on this guard's floor that it may reach
    let target = null;
    let best = Infinity;
    for (const p of ints) {
      if (Math.abs(p.pos.y - g.post.y) > 3) continue;
      const z = this.zone(base, p.pos.x, p.pos.z);
      if (!z || (g.post.floor > 0 && z !== 'in')) continue;
      const d = Math.hypot(p.pos.x - g.x, p.pos.z - g.z);
      if (d < best && d < 40) {
        best = d;
        target = p;
      }
    }
    if (target) {
      const d = best;
      g.yaw = Math.atan2(target.pos.x - g.x, target.pos.z - g.z);
      if (d > REACH) {
        this.walkToward(squad, g, target.pos.x, target.pos.z, squad.L.speed, dt);
        g.state = GS.chase;
      } else if (now >= g.readyAt) {
        g.attack = { sid: target.sid, hitAt: now + WINDUP_MS, endAt: now + WINDUP_MS + STRIKE_MS };
        g.readyAt = now + ATTACK_EVERY_MS;
        g.state = GS.windup;
        this.game.broadcastNear(g.x, g.z, 140, 'gAttack', { id: g.id, windupMs: WINDUP_MS });
      } else g.state = GS.idle;
      return;
    }
    // back to the post
    const dp = Math.hypot(g.post.x - g.x, g.post.z - g.z);
    if (dp > 0.4) {
      this.walkToward(squad, g, g.post.x, g.post.z, squad.L.speed * 0.6, dt);
      g.state = GS.walk;
    } else {
      g.state = GS.idle;
      g.yaw = base.yaw;
    }
  }

  // Straight to the target, through the door when going in or out.
  walkToward(squad, g, tx, tz, speed, dt) {
    const base = squad.base;
    const from = this.zone(base, g.x, g.z);
    const to = this.zone(base, tx, tz);
    let wx = tx;
    let wz = tz;
    if (from && to && from !== to && to !== 'door') {
      // through the doorway: line up with the door first, then straight through
      const { u, v } = baseLocal(base, g.x, g.z);
      const p = Math.abs(u) > 1.2
        ? base.toWorld(0, from === 'in' ? INSIDE - 0.5 : from === 'out' ? base.half + 1.5 : v)
        : base.toWorld(0, to === 'in' ? INSIDE - 1.5 : base.half + 2.5);
      wx = p.x;
      wz = p.z;
    }
    const dx = wx - g.x;
    const dz = wz - g.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    const step = Math.min(d, speed * dt);
    const nx = g.x + (dx / d) * step;
    const nz = g.z + (dz / d) * step;
    const z = this.zone(base, nx, nz);
    if (!z || (g.post.floor > 0 && z !== 'in')) return; // never off its floor or away from the base
    g.x = nx;
    g.z = nz;
    g.yaw = Math.atan2(dx, dz);
    g.y = this.world.surfaceHeight(nx, nz, g.post.y + 0.5);
  }

  updateHeli(squad, h, ints, dt, now) {
    const base = squad.base;
    const L = squad.L;
    const active = !squad.allDown;
    // circle the tower (higher up and away while the guards are down)
    h.angle += dt * 0.35;
    const r = active ? 24 : 40;
    const tx = base.x + Math.cos(h.angle) * r;
    const tz = base.z + Math.sin(h.angle) * r;
    const ty = base.y + (active ? 46 : 62) + Math.sin(now / 900 + h.i) * 1.2;
    h.x += (tx - h.x) * Math.min(1, dt * 2);
    h.z += (tz - h.z) * Math.min(1, dt * 2);
    h.y += (ty - h.y) * Math.min(1, dt * 1.5);
    h.yaw = h.angle + Math.PI / 2;
    if (!active || now < h.readyAt) return;
    let target = null;
    let best = GUARDS.helicopterRange;
    for (const p of ints) {
      const d = Math.hypot(p.pos.x - base.x, p.pos.z - base.z);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    if (!target) return;
    h.readyAt = now + 1700 + Math.floor(this.game.rng() * 400);
    h.yaw = Math.atan2(target.pos.x - h.x, target.pos.z - h.z);
    // the gunner rarely misses a thief standing still
    const hit = this.game.rng() < 0.8;
    if (hit) this.game.combat.damagePlayer(target, L.damage * 0.7, { from: 'heli' });
    const r1 = (v) => Math.round(v * 10) / 10;
    this.game.broadcastNear(h.x, h.z, 180, 'gShot', { id: h.id, x: r1(h.x), y: r1(h.y), z: r1(h.z), tx: r1(target.pos.x), ty: r1(target.pos.y + 2.5), tz: r1(target.pos.z), hit });
  }

  // ------------------------------------------------------------ players hit guards

  // Guards in front of a player (never their own).
  findInArc(s, yaw, reach, arcDeg, max) {
    const half = (arcDeg / 2) * (Math.PI / 180);
    const out = [];
    for (const squad of this.squads.values()) {
      if (squad.owner === s) continue;
      for (const g of squad.guards) {
        if (g.state === GS.down || Math.abs(g.y - s.pos.y) > 4) continue;
        const dx = g.x - s.pos.x;
        const dz = g.z - s.pos.z;
        const d = Math.hypot(dx, dz);
        if (d - 0.9 > reach) continue;
        if (d > 1.5 && angleDiff(Math.atan2(dx, dz), yaw) > half) continue;
        out.push({ g, squad, d });
      }
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, max);
  }

  // Damage a guard; returns the hit for the 'hits' message.
  hit(s, { g, squad }, dmg, crit = false) {
    const now = this.game.now();
    squad.hitBy.set(s.pn, now);
    squad.lastHitter = s.pn;
    g.hp -= dmg;
    if (g.hp <= 0) {
      g.hp = 0;
      g.state = GS.down;
      g.attack = null;
      g.downUntil = now + GUARDS.respawnMs;
      this.game.broadcastNear(g.x, g.z, 140, 'gDown', { id: g.id });
    }
    return { id: g.id, dmg: Math.round(dmg), crit, guard: true, hp: Math.round((100 * g.hp) / g.maxHp) };
  }

  // ------------------------------------------------------------ snapshots

  snapshotFor(viewer) {
    const out = [];
    const R = CONFIG.interestRadius + 40;
    const r1 = (v) => Math.round(v * 10) / 10;
    for (const squad of this.squads.values()) {
      if (Math.hypot(squad.base.x - viewer.pos.x, squad.base.z - viewer.pos.z) > R) continue;
      for (const g of [...squad.guards, ...squad.helis]) {
        out.push([g.id, squad.base.index, g.kind, r1(g.x), r1(g.y), r1(g.z), Math.round(g.yaw * 100) / 100, g.state, g.kind ? 100 : Math.round((100 * g.hp) / g.maxHp), squad.level]);
      }
    }
    return out;
  }

  squadOf(index) {
    return this.squads.get(index) || null;
  }
}
