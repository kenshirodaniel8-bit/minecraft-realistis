// Lucky Blocks. A few always sit around every active region; the LUCKY LUCKY
// event scatters many more. Opening one is a single server-side claim: the
// block is removed before the reward is rolled, so repeated requests can never
// pay out twice.

import { CONFIG } from '#shared/config.js';
import { LUCKY_KINDS, rollLucky, COSMETICS } from '#shared/lucky.js';
import { ITEM_BY_ID } from '#shared/items.js';
import { SWORDS, swordLockReason } from '#shared/weapons.js';
import { REGION_BY_ID } from '#shared/regions.js';
import { SPECIES_BY_ID } from '#shared/monsters.js';
import { isObj, int, fail } from '../validate.js';
import { angleDiff } from './combat.js';

export class LuckyBlocks {
  constructor(game) {
    this.game = game;
    this.blocks = new Map();
    this.nextId = 1;
    this.ambientNext = {};
    this.lastCheck = 0;
  }

  info(b) {
    return { id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z, event: b.event };
  }

  list() {
    return [...this.blocks.values()].map((b) => this.info(b));
  }

  occupied(x, z) {
    for (const b of this.blocks.values()) if ((b.x - x) ** 2 + (b.z - z) ** 2 < 25) return true;
    return false;
  }

  spawnAt(regionId, kind, event) {
    const spots = this.game.world.luckySpots[regionId] || [];
    const free = spots.filter((p) => !this.occupied(p.x, p.z));
    if (!free.length) return null;
    const p = free[Math.floor(this.game.rng() * free.length)];
    const b = { id: this.nextId++, kind, x: p.x, y: p.y, z: p.z, region: regionId, event: !!event, claimedBy: null };
    this.blocks.set(b.id, b);
    this.game.broadcast('luckySpawn', this.info(b));
    return b;
  }

  remove(b) {
    if (this.blocks.delete(b.id)) this.game.broadcast('luckyGone', { id: b.id });
  }

  tick(dt, now) {
    if (now - this.lastCheck < 2000) return;
    this.lastCheck = now;
    const active = this.game.expansion.active;
    const counts = {};
    for (const b of [...this.blocks.values()]) {
      if (!active.has(b.region)) {
        this.remove(b);
        continue;
      }
      if (!b.event) counts[b.region] = (counts[b.region] || 0) + 1;
    }
    for (const regionId of active) {
      if ((counts[regionId] || 0) >= CONFIG.lucky.ambientPerRegion) continue;
      if (now < (this.ambientNext[regionId] || 0)) continue;
      this.ambientNext[regionId] = now + 5000;
      this.spawnAt(regionId, this.game.rng() < 0.15 ? 'super' : 'lucky', false);
    }
  }

  // LUCKY LUCKY: scatter event blocks near where players are.
  spawnEventBlocks(n) {
    const game = this.game;
    const regions = new Map();
    for (const [id, near] of game.monsters.nearbyRegions()) {
      if (!game.expansion.active.has(id)) continue;
      const need = REGION_BY_ID[id].unlock.level || 0;
      if (near.some((s) => s.profile.level >= need)) regions.set(id, near.length);
    }
    if (!regions.size) regions.set('plains', 1);
    const ids = [...regions.keys()];
    let made = 0;
    for (let i = 0; i < n * 3 && made < n; i++) {
      const id = ids[i % ids.length];
      const roll = game.rng();
      const kind = roll < 0.12 ? 'mythic' : roll < 0.42 ? 'super' : 'lucky';
      if (this.spawnAt(id, kind, true)) made++;
    }
    return made;
  }

  clearEventBlocks() {
    for (const b of [...this.blocks.values()]) if (b.event) this.remove(b);
  }

  handleClaim(s, p) {
    if (!isObj(p) || !int(p.blockId, 1, 1e12)) return fail('bad');
    const b = this.blocks.get(p.blockId);
    if (!b) return fail('gone', 'Someone already opened that one!');
    return this.claim(s, b);
  }

  // swinging the sword at a block opens it too
  trySwing(s, yaw) {
    for (const b of this.blocks.values()) {
      const dx = b.x - s.pos.x;
      const dz = b.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 4.5) continue;
      if (d > 1.5 && angleDiff(Math.atan2(dx, dz), yaw) > 1.1) continue;
      return this.claim(s, b);
    }
    return null;
  }

  claim(s, b) {
    const game = this.game;
    if (s.dead) return fail('dead');
    if (b.claimedBy) return fail('gone');
    if (Math.hypot(s.pos.x - b.x, s.pos.z - b.z) > CONFIG.lucky.claimRange || Math.abs(s.pos.y - b.y) > 6) return fail('too_far', 'Get closer to the Lucky Block.');
    b.claimedBy = s.id;
    this.blocks.delete(b.id); // gone before any reward is decided
    if (!b.event) this.ambientNext[b.region] = game.now() + CONFIG.lucky.ambientRespawnMs;
    const reward = this.giveReward(s, b);
    s.profile.stats.luckyOpened++;
    game.markProfile(s);
    game.saveNow(s);
    game.broadcast('luckyOpened', { id: b.id, pn: s.pn, kind: b.kind, reward: { kind: reward.kind, label: reward.label } });
    return { ok: true, reward };
  }

  giveReward(s, b) {
    const game = this.game;
    const kindDef = LUCKY_KINDS[b.kind];
    const kindLuck = b.kind === 'mythic' ? 1.2 : b.kind === 'super' ? 0.5 : 0;
    const luck = (s.perks?.luck || 0) + kindLuck + (b.event ? 0.3 : 0);
    const entry = rollLucky(game.rng, luck);
    const region = REGION_BY_ID[b.region];
    const lvl = region ? region.levels[0] : 1;
    const rnd = (a, z) => Math.round(a + game.rng() * (z - a));
    const money = (amount, label) => {
      const n = game.economy.credit(s, amount, 'lucky');
      return { kind: 'money', amount: n, label: label || `+${n} Money` };
    };
    switch (entry.kind) {
      case 'money': {
        const n = rnd(entry.min, entry.max) * kindDef.moneyMult * (1 + lvl * 0.35) * (game.events.isActive('luckyLucky') ? 2 : 1);
        return money(Math.round(n), entry.big ? `JACKPOT! +${Math.round(n)} Money` : null);
      }
      case 'xp': {
        const n = Math.round(rnd(entry.min, entry.max) * (1 + lvl * 0.25) * (b.kind === 'lucky' ? 1 : 2));
        const got = game.addXp(s, n);
        return { kind: 'xp', amount: got, label: `+${got} XP` };
      }
      case 'item': {
        const id = entry.pool[Math.floor(game.rng() * entry.pool.length)];
        const def = ITEM_BY_ID[id];
        const qty = rnd(entry.qty[0], entry.qty[1]);
        const have = s.profile.items[id] || 0;
        const add = Math.min(qty, def.maxStack - have);
        if (add <= 0) return money(def.price * qty, `+${def.price * qty} Money (bag full of ${def.name})`);
        s.profile.items[id] = have + add;
        return { kind: 'item', item: id, qty: add, label: `${def.icon} ${def.name} x${add}` };
      }
      case 'tool': {
        const id = entry.pool[Math.floor(game.rng() * entry.pool.length)];
        const def = ITEM_BY_ID[id];
        if (s.profile.items[id]) return money(Math.round(def.price * 0.6), `+${Math.round(def.price * 0.6)} Money (you already own a ${def.name})`);
        s.profile.items[id] = 1;
        return { kind: 'item', item: id, qty: 1, label: `${def.icon} New gadget: ${def.name}!` };
      }
      case 'discount': {
        s.profile.coupons.recruitDiscount = Math.max(s.profile.coupons.recruitDiscount, entry.value);
        return { kind: 'discount', value: entry.value, label: `Coupon: -${Math.round(entry.value * 100)}% on your next recruit!` };
      }
      case 'clue': {
        const m = game.monsters.spawnSpecial(s, 'clue');
        if (!m) return money(300 * kindDef.moneyMult);
        game.send(s, 'clue', { id: m.id, species: m.sp, x: Math.round(m.x), z: Math.round(m.z) });
        return { kind: 'clue', species: m.sp, label: `Clue: a ${SPECIES_BY_ID[m.sp].name} was spotted nearby! (see map)` };
      }
      case 'encounter': {
        const m = game.monsters.spawnSpecial(s, 'encounter');
        if (!m) return money(300 * kindDef.moneyMult);
        game.send(s, 'clue', { id: m.id, species: m.sp, x: Math.round(m.x), z: Math.round(m.z), encounter: true });
        return { kind: 'encounter', species: m.sp, label: `A wild ${SPECIES_BY_ID[m.sp].name} burst out! Defeat it to recruit it.` };
      }
      case 'cosmetic': {
        const left = COSMETICS.filter((c) => !s.profile.cosmetics.owned.includes(c.id));
        if (!left.length) return money(800 * kindDef.moneyMult);
        const c = left[Math.floor(game.rng() * left.length)];
        s.profile.cosmetics.owned.push(c.id);
        if (!s.profile.cosmetics.equipped) {
          s.profile.cosmetics.equipped = c.id;
          game.broadcast('playerInfo', game.playerInfo(s));
        }
        return { kind: 'cosmetic', id: c.id, label: `New hat: ${c.name}!` };
      }
      case 'sword': {
        const best = Math.max(...s.profile.swords.map((id) => SWORDS.find((w) => w.id === id)?.tier || 1));
        const next = SWORDS.find((w) => w.tier === best + 1 && !swordLockReason(w, s.profile));
        if (!next) return money(1500 * kindDef.moneyMult);
        s.profile.swords.push(next.id);
        s.profile.sword = next.id;
        game.broadcast('playerInfo', game.playerInfo(s));
        return { kind: 'sword', id: next.id, label: `NEW SWORD: ${next.name}!` };
      }
      default:
        return money(100);
    }
  }
}
