// Costumes and their master powers (shared/costumes.js).
//
//   buyCostume  - at the Costume Shop; the Black Spy also gives the Spy Sword
//   equipCostume - put one on (or take it off with id null)
//   buyPower    - at the "Upgrade your power" shop: +130 power per level
//   power (Z)   - the worn costume's master power, with a cooldown. It hits
//                 monsters only, for exactly its damage (583 for the Black
//                 Spy, plus 130 per upgrade level).

import { COSTUME_BY_ID, POWER_UPGRADE, powerDamage } from '#shared/costumes.js';
import { SWORD_BY_ID } from '#shared/weapons.js';
import { isObj, id as isId, finite, fail } from '../validate.js';

export class CostumeShop {
  constructor(game) {
    this.game = game;
  }

  handleBuy(s, p) {
    if (!isObj(p) || !isId(p.id)) return fail('bad');
    const cached = s.recall(p.reqId);
    if (cached) return cached;
    const c = COSTUME_BY_ID[p.id];
    if (!c) return fail('unknown');
    const prof = s.profile;
    if (prof.costumes.owned.includes(c.id)) return s.remember(p.reqId, fail('owned', 'You already own this costume.'));
    const eco = this.game.economy;
    if (!eco.nearShop(s, 'costumes')) return fail('not_at_shop', 'Visit the Costume Shop in the plaza.');
    if (!eco.debit(s, c.price, `costume:${c.id}`)) return fail('money', `You need ${c.price.toLocaleString('en-US')} Money.`);
    prof.costumes.owned.push(c.id);
    prof.costumes.equipped = c.id;
    if (c.sword && SWORD_BY_ID[c.sword] && !prof.swords.includes(c.sword)) {
      prof.swords.push(c.sword);
      prof.sword = c.sword;
    }
    this.game.markProfile(s);
    this.game.saveNow(s);
    this.game.broadcast('playerInfo', this.game.playerInfo(s));
    this.game.broadcast('announce', { text: `${prof.name} is now a ${c.name}! ${c.icon}`, kind: 'rare' });
    return s.remember(p.reqId, { ok: true, costume: c.id, sword: c.sword || null, money: prof.money });
  }

  handleEquip(s, p) {
    if (!isObj(p)) return fail('bad');
    const id = p.id === null ? null : p.id;
    if (id !== null && !s.profile.costumes.owned.includes(id)) return fail('not_owned');
    s.profile.costumes.equipped = id;
    this.game.markProfile(s);
    this.game.broadcast('playerInfo', this.game.playerInfo(s));
    return { ok: true };
  }

  handleBuyPower(s, p) {
    const cached = isObj(p) ? s.recall(p.reqId) : undefined;
    if (cached) return cached;
    const prof = s.profile;
    const level = prof.powerLevel;
    if (level >= POWER_UPGRADE.maxLevel) return fail('max', 'Your power is already at the maximum level!');
    const eco = this.game.economy;
    if (!eco.nearShop(s, 'power')) return fail('not_at_shop', 'Visit the "Upgrade your power" shop in the plaza.');
    const price = POWER_UPGRADE.price(level);
    if (!eco.debit(s, price, `power:${level + 1}`)) return fail('money', `You need ${price.toLocaleString('en-US')} Money.`);
    prof.powerLevel = level + 1;
    this.game.markProfile(s);
    this.game.saveNow(s);
    const res = { ok: true, level: prof.powerLevel, bonus: prof.powerLevel * POWER_UPGRADE.bonus, money: prof.money };
    return isObj(p) ? s.remember(p.reqId, res) : res;
  }

  // Z: the master power of the costume you wear.
  handlePower(s, p) {
    if (!isObj(p) || !finite(p.yaw, -100, 100)) return fail('bad');
    const game = this.game;
    const now = game.now();
    const c = COSTUME_BY_ID[s.profile.costumes.equipped];
    if (!c) return fail('no_costume', 'Put on a costume from the Costume Shop to use a master power (Z).');
    if (!game.combat.canAct(s, now)) return fail('cant_act');
    if (now < (s.powerReadyAt || 0)) return fail('cooldown', `${c.power.name} is ready in ${Math.ceil((s.powerReadyAt - now) / 1000)}s`);
    const pw = c.power;
    s.powerReadyAt = now + pw.cooldownMs;
    s.yaw = p.yaw;
    const dmg = powerDamage(c, s.profile.powerLevel);
    const monsters = game.monsters;
    let targets = [];
    if (pw.shape === 'wave') {
      targets = monsters.findInArc(s.pos, p.yaw, pw.range, pw.arc, pw.maxTargets, s);
    } else if (pw.shape === 'ring') {
      targets = monsters.findInArc(s.pos, p.yaw, pw.radius, 360, pw.maxTargets, s);
    } else if (pw.shape === 'chain') {
      // the first bolt goes to the closest monster in front of you (or around)
      let first = monsters.findInArc(s.pos, p.yaw, pw.range, 160, 1, s)[0] || monsters.findInArc(s.pos, p.yaw, pw.range * 0.6, 360, 1, s)[0];
      if (first) {
        targets.push(first);
        const done = new Set(targets);
        while (targets.length < pw.maxTargets) {
          const m = monsters.nearestTo(targets[targets.length - 1], pw.range * 0.6, done, s);
          if (!m) break;
          done.add(m);
          targets.push(m);
        }
      }
    }
    const hits = [];
    for (const m of targets) {
      // exact damage: no defence and no randomness
      if (pw.burn) m.burn = { dps: dmg * 0.08, until: now + 4000, by: s, acc: 0 };
      if (pw.freezeMs && !m.species.ai.boss) m.stunnedUntil = Math.max(m.stunnedUntil, now + pw.freezeMs);
      game.companions.noteThreat(s, m.id);
      monsters.damage(m, dmg, s, { power: true });
      hits.push({ id: m.id, dmg, crit: true, fx: 'power', hp: Math.round((100 * m.hp) / m.maxHp) });
    }
    if (pw.heal) game.combat.heal(s, s.maxHp * pw.heal);
    const r1 = (v) => Math.round(v * 10) / 10;
    game.broadcastNear(s.pos.x, s.pos.z, 140, 'power', {
      pn: s.pn, costume: c.id, x: r1(s.pos.x), y: r1(s.pos.y), z: r1(s.pos.z), yaw: Math.round(p.yaw * 100) / 100,
      targets: targets.map((m) => ({ id: m.id, x: r1(m.x), y: r1(m.y), z: r1(m.z) })),
    });
    if (hits.length) game.broadcastNear(s.pos.x, s.pos.z, 140, 'hits', { pn: s.pn, hits, power: true });
    // a swing at nothing still opens a Lucky Block in front of you
    if (!hits.length && pw.shape === 'wave') game.lucky.trySwing(s, p.yaw);
    return { ok: true, hits: hits.length, dmg, readyAt: s.powerReadyAt };
  }
}

