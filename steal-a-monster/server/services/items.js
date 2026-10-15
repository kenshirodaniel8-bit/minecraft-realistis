// Action items (gadgets) for player-vs-player play. The client only says
// "use item X facing this way"; the server checks ownership, cooldown, range
// and picks the target itself.

import { CONFIG } from '#shared/config.js';
import { ITEM_BY_ID } from '#shared/items.js';
import { isObj, id as isId, finite, fail } from '../validate.js';
import { angleDiff } from './combat.js';

export class ItemSystem {
  constructor(game) {
    this.game = game;
    this.ground = new Map(); // id -> trap/gel
    this.nextGround = 1;
  }

  handleUse(s, p) {
    if (!isObj(p) || !isId(p.itemId) || !finite(p.yaw, -100, 100)) return fail('bad');
    const game = this.game;
    const now = game.now();
    const item = ITEM_BY_ID[p.itemId];
    if (!item) return fail('unknown_item');
    const have = s.profile.items[item.id] || 0;
    if (have <= 0) return fail('none', `You don't have a ${item.name}.`);
    if (s.dead) return fail('dead');
    if (s.fx.frozenUntil > now || s.fx.stunUntil > now) return fail('stuck', 'You are stuck!');
    if (now < (s.itemReadyAt[item.id] || 0)) return fail('cooldown', `${item.name} is recharging.`);
    let result;
    if (item.target === 'player') result = this.usePlayerTarget(s, item, p.yaw, now);
    else if (item.target === 'ground') result = this.placeGround(s, item, now);
    else result = this.useSelf(s, item, now);
    if (!result.ok) return result;
    s.itemReadyAt[item.id] = now + item.cooldownMs;
    if (item.kind === 'consumable') {
      s.profile.items[item.id] = have - 1;
      if (s.profile.items[item.id] <= 0) delete s.profile.items[item.id];
    }
    game.markProfile(s);
    game.broadcastNear(s.pos.x, s.pos.z, 120, 'itemUsed', { pn: s.pn, item: item.id, target: result.target ?? null, yaw: p.yaw });
    return result;
  }

  // nearest valid rival inside the item's cone
  findTarget(s, item, yaw) {
    const now = this.game.now();
    let best = null;
    let bd = Infinity;
    for (const o of this.game.players.values()) {
      if (o === s || o.dead) continue;
      const dx = o.pos.x - s.pos.x;
      const dz = o.pos.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > item.range + CONFIG.combat.rangeTolerance || Math.abs(o.pos.y - s.pos.y) > 6) continue;
      if (d > 1.5 && angleDiff(Math.atan2(dx, dz), yaw) > ((item.arc / 2) * Math.PI) / 180) continue;
      if (o.protectUntil > now) continue;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  usePlayerTarget(s, item, yaw, now) {
    const game = this.game;
    const t = this.findTarget(s, item, yaw);
    if (!t) return { ok: true, miss: true };
    if (t.fx.shieldUntil > now) {
      game.send(t, 'blocked', { by: s.pn, item: item.id });
      return { ok: true, blocked: true, target: t.pn };
    }
    switch (item.id) {
      case 'knockback': {
        const dx = t.pos.x - s.pos.x;
        const dz = t.pos.z - s.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        t.knockbackUntil = now + CONFIG.movement.knockbackAllowanceMs;
        game.send(t, 'knock', { x: (dx / d) * item.knockback, z: (dz / d) * item.knockback, up: item.lift, by: s.pn });
        break;
      }
      case 'freeze':
        t.fx.frozenUntil = Math.max(t.fx.frozenUntil, now + item.freezeMs);
        game.send(t, 'status', { kind: 'frozen', until: t.fx.frozenUntil, by: s.pn });
        break;
      case 'capture_net':
        t.fx.rootedUntil = Math.max(t.fx.rootedUntil, now + item.rootMs);
        game.send(t, 'status', { kind: 'netted', until: t.fx.rootedUntil, by: s.pn });
        break;
      default:
        break;
    }
    game.stealing.cancelPending(t);
    if (item.interrupts) game.stealing.interrupt(t, 'hit');
    return { ok: true, hit: true, target: t.pn };
  }

  placeGround(s, item, now) {
    const game = this.game;
    const mine = [...this.ground.values()].filter((g) => g.owner === s.id && g.item === item.id);
    if (mine.length >= item.maxActive) this.removeGround(mine[0]);
    const g = {
      id: this.nextGround++, item: item.id, owner: s.id, ownerPn: s.pn,
      x: s.pos.x, y: game.world.surfaceHeight(s.pos.x, s.pos.z, s.pos.y), z: s.pos.z,
      until: now + item.durationMs, r: item.triggerRadius, hitAt: new Map(),
    };
    this.ground.set(g.id, g);
    game.broadcast('ground', this.groundInfo(g));
    return { ok: true, placed: g.id };
  }

  groundInfo(g) {
    return { id: g.id, item: g.item, x: g.x, y: g.y, z: g.z, r: g.r, until: g.until, owner: g.ownerPn };
  }

  groundList() {
    return [...this.ground.values()].map((g) => this.groundInfo(g));
  }

  removeGround(g) {
    if (this.ground.delete(g.id)) this.game.broadcast('groundGone', { id: g.id });
  }

  useSelf(s, item, now) {
    const game = this.game;
    switch (item.id) {
      case 'shield':
        s.fx.shieldUntil = now + item.durationMs;
        break;
      case 'speed_boost':
        s.fx.speedUntil = now + item.durationMs;
        s.fx.speedMult = item.speedMultiplier;
        break;
      case 'detector':
        s.fx.radarUntil = now + item.durationMs;
        s.radarNextAt = 0;
        break;
      default:
        return fail('bad');
    }
    game.send(s, 'status', { kind: item.id, until: now + item.durationMs });
    return { ok: true };
  }

  // Ground gadgets trigger when a rival walks into them.
  checkGround(s) {
    if (s.dead || !this.ground.size) return;
    const game = this.game;
    const now = game.now();
    for (const g of this.ground.values()) {
      if (g.owner === s.id) continue;
      if ((s.pos.x - g.x) ** 2 + (s.pos.z - g.z) ** 2 > g.r * g.r) continue;
      if ((g.hitAt.get(s.id) || 0) > now) continue;
      const item = ITEM_BY_ID[g.item];
      if (s.fx.shieldUntil > now || s.protectUntil > now) {
        g.hitAt.set(s.id, now + 2000);
        continue;
      }
      if (g.item === 'sticky_trap') {
        s.fx.rootedUntil = Math.max(s.fx.rootedUntil, now + item.rootMs);
        game.send(s, 'status', { kind: 'trapped', until: s.fx.rootedUntil });
        game.stealing.interrupt(s, 'trap');
        game.stealing.cancelPending(s);
        this.removeGround(g);
        return;
      }
      if (g.item === 'slippery_gel') {
        g.hitAt.set(s.id, now + 3000);
        s.fx.slipUntil = Math.max(s.fx.slipUntil, now + item.slipMs);
        const a = game.rng() * Math.PI * 2;
        s.knockbackUntil = now + CONFIG.movement.knockbackAllowanceMs;
        game.send(s, 'knock', { x: Math.cos(a) * 8, z: Math.sin(a) * 8, up: 3, slip: true });
        game.send(s, 'status', { kind: 'slipping', until: s.fx.slipUntil });
        game.stealing.interrupt(s, 'slip');
        game.stealing.cancelPending(s);
      }
    }
  }

  onLeave(s) {
    for (const g of [...this.ground.values()]) if (g.owner === s.id) this.removeGround(g);
  }

  tick(dt, now) {
    for (const g of [...this.ground.values()]) if (now > g.until) this.removeGround(g);
    // ground gadgets also catch players standing still
    if (this.ground.size) for (const s of this.game.players.values()) this.checkGround(s);
    for (const s of this.game.players.values()) {
      if (s.fx.radarUntil > now && now >= (s.radarNextAt || 0)) {
        s.radarNextAt = now + 2000;
        const radius = 180 * (1 + (s.perks?.detect || 0));
        this.game.send(s, 'radar', { list: this.game.monsters.radarFor(s, radius), until: s.fx.radarUntil });
      }
    }
  }
}
