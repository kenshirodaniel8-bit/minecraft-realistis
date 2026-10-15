// Money, shops and upgrades. Every purchase is validated here on the server:
// the price comes from the shared tables (never from the client), the player
// must be at the right shop, own enough money and meet unlock requirements,
// and repeated requests with the same request id are answered from cache.

import { CONFIG } from '#shared/config.js';
import { SWORD_BY_ID, swordLockReason } from '#shared/weapons.js';
import { ITEM_BY_ID } from '#shared/items.js';
import { isObj, id as isId, int, fail } from '../validate.js';
import { isInsideBase } from '#shared/world.js';
import { regionLockReason, REGION_BY_ID } from '#shared/regions.js';

export class Economy {
  constructor(game) {
    this.game = game;
    this.ledgerLog = []; // recent money movements, for debugging
  }

  credit(s, amount, reason) {
    const n = Math.floor(amount);
    if (!(n > 0)) return 0;
    const p = s.profile;
    const before = p.money;
    p.money = Math.min(CONFIG.economy.maxMoney, p.money + n);
    this.record(s, p.money - before, reason);
    this.game.markProfile(s);
    return p.money - before;
  }

  debit(s, amount, reason) {
    const n = Math.ceil(amount);
    if (!(n >= 0) || s.profile.money < n) return false;
    s.profile.money -= n;
    this.record(s, -n, reason);
    this.game.markProfile(s);
    return true;
  }

  // Monster Gems (the rare upgrade material). Same rules as Money: only the
  // server adds or removes them, never below zero.
  creditGems(s, amount, reason) {
    const n = Math.floor(amount);
    if (!(n > 0)) return 0;
    const p = s.profile;
    const before = p.gems;
    p.gems = Math.min(CONFIG.gems.max, p.gems + n);
    this.ledgerLog.push({ t: this.game.now(), who: s.id, gems: p.gems - before, reason });
    this.game.markProfile(s);
    return p.gems - before;
  }

  // Takes Money and Gems together, or neither.
  pay(s, money, gems, reason) {
    const m = Math.ceil(money || 0);
    const g = Math.ceil(gems || 0);
    if (!(m >= 0) || !(g >= 0) || s.profile.money < m || s.profile.gems < g) return false;
    if (!this.debit(s, m, reason)) return false;
    if (g) {
      s.profile.gems -= g;
      this.ledgerLog.push({ t: this.game.now(), who: s.id, gems: -g, reason });
    }
    return true;
  }

  // "Not enough Money" / "Not enough Gems" for a failed pay()
  shortfall(s, money, gems) {
    if (s.profile.money < (money || 0)) return fail('money', 'Not enough Money.');
    return fail('gems', `You need ${gems} 💎 Monster Gems (you have ${s.profile.gems}).`);
  }

  record(s, delta, reason) {
    this.ledgerLog.push({ t: this.game.now(), who: s.id, delta, reason, balance: s.profile.money });
    if (this.ledgerLog.length > 500) this.ledgerLog.splice(0, 100);
  }

  nearShop(s, kind) {
    if (!CONFIG.economy.requireShopProximity) return true;
    const r = CONFIG.economy.shopRange;
    return this.game.world.shops.some((sh) => sh.kind === kind && (s.pos.x - sh.x) ** 2 + (s.pos.z - sh.z) ** 2 <= r * r);
  }

  atOwnBase(s) {
    const b = this.game.world.bases[s.baseIndex];
    return b && isInsideBase(b, s.pos.x, s.pos.z, 1);
  }

  handleBuySword(s, p) {
    if (!isObj(p) || !isId(p.swordId)) return fail('bad');
    const cached = s.recall(p.reqId);
    if (cached) return cached;
    const sword = SWORD_BY_ID[p.swordId];
    if (!sword) return fail('unknown_sword');
    if (s.profile.swords.includes(sword.id)) return s.remember(p.reqId, fail('owned', 'You already own this sword.'));
    if (!this.nearShop(s, 'swords')) return fail('not_at_shop', 'Visit the Sword Shop in the plaza.');
    const lock = swordLockReason(sword, s.profile);
    if (lock) return fail('locked', lock);
    if (!this.pay(s, sword.price, sword.gems, `sword:${sword.id}`)) return this.shortfall(s, sword.price, sword.gems);
    s.profile.swords.push(sword.id);
    s.profile.sword = sword.id;
    this.game.saveNow(s);
    this.game.broadcast('playerInfo', this.game.playerInfo(s));
    this.game.tutorialEvent(s, 'sword');
    return s.remember(p.reqId, { ok: true, sword: sword.id, money: s.profile.money });
  }

  handleEquipSword(s, p) {
    if (!isObj(p) || !isId(p.swordId)) return fail('bad');
    if (!s.profile.swords.includes(p.swordId)) return fail('not_owned');
    s.profile.sword = p.swordId;
    this.game.markProfile(s);
    this.game.broadcast('playerInfo', this.game.playerInfo(s));
    return { ok: true };
  }

  handleBuyItem(s, p) {
    if (!isObj(p) || !isId(p.itemId)) return fail('bad');
    const qty = p.qty === undefined ? 1 : p.qty;
    if (!int(qty, 1, 10)) return fail('bad_qty');
    const cached = s.recall(p.reqId);
    if (cached) return cached;
    const item = ITEM_BY_ID[p.itemId];
    if (!item) return fail('unknown_item');
    if (!this.nearShop(s, 'items')) return fail('not_at_shop', 'Visit the Gadget Shop in the plaza.');
    const have = s.profile.items[item.id] || 0;
    if (have + qty > item.maxStack) return fail('full', item.kind === 'tool' ? 'You already own this gadget.' : `You can carry at most ${item.maxStack}.`);
    if (!this.debit(s, item.price * qty, `item:${item.id}x${qty}`)) return fail('money', 'Not enough Money.');
    s.profile.items[item.id] = have + qty;
    this.game.saveNow(s);
    return s.remember(p.reqId, { ok: true, item: item.id, count: s.profile.items[item.id] });
  }

  upgradeOffer(s, kind) {
    const p = s.profile;
    if (kind === 'slots') {
      const next = CONFIG.bases.slotUpgrades.find((u) => u.slots > p.base.slots);
      return next ? { price: next.price, gems: next.gems || 0, level: next.level, to: next.slots } : null;
    }
    if (kind === 'laser') {
      const lvl = p.base.laserLevel;
      if (lvl >= CONFIG.security.laserUpgradePrices.length) return null;
      return { price: CONFIG.security.laserUpgradePrices[lvl], gems: CONFIG.security.laserUpgradeGems[lvl] || 0, level: 1, to: lvl + 1 };
    }
    return null;
  }

  handleBuyUpgrade(s, p) {
    if (!isObj(p) || (p.kind !== 'slots' && p.kind !== 'laser')) return fail('bad');
    const cached = s.recall(p.reqId);
    if (cached) return cached;
    if (!this.atOwnBase(s)) return fail('not_at_base', 'Upgrade at your base terminal.');
    const offer = this.upgradeOffer(s, p.kind);
    if (!offer) return fail('maxed', 'Already fully upgraded.');
    if (s.profile.level < offer.level) return fail('locked', `Requires Level ${offer.level}`);
    if (!this.pay(s, offer.price, offer.gems, `upgrade:${p.kind}`)) return this.shortfall(s, offer.price, offer.gems);
    if (p.kind === 'slots') s.profile.base.slots = offer.to;
    else s.profile.base.laserLevel = offer.to;
    this.game.saveNow(s);
    this.game.bases.broadcastBase(s.baseIndex);
    return s.remember(p.reqId, { ok: true, kind: p.kind, to: offer.to });
  }

  // The Island Gate in the plaza: travel to any island the player may enter.
  handleTravel(s, p) {
    if (!isObj(p) || typeof p.region !== 'string') return fail('bad');
    const game = this.game;
    const gate = game.world.gate;
    if ((s.pos.x - gate.x) ** 2 + (s.pos.z - gate.z) ** 2 > (gate.range + 2) ** 2) return fail('too_far', 'Walk up to the Island Gate in the plaza.');
    if (s.carrying) return fail('carrying', 'The gate refuses monster thieves!');
    const region = REGION_BY_ID[p.region];
    if (!region || region.shape.kind !== 'island' || region.arena) return fail('bad_region', 'Unknown island.');
    const reason = regionLockReason(region, game.playerProgress(s), game.expansion.active);
    if (reason) return fail('locked', reason);
    const dest = game.world.islandArrival[region.id] || game.world.portals.find((pt) => pt.region === region.id)?.to;
    if (!dest) return fail('bad_region');
    s.portalReadyAt = game.now() + 2500;
    game.teleport(s, dest.x, dest.y, dest.z, 'portal');
    return { ok: true, region: region.id };
  }

  // Portals in the plaza lead to the expansion islands (server-chosen
  // destinations only).
  checkPortals(s) {
    const now = this.game.now();
    if (s.portalReadyAt && s.portalReadyAt > now) return;
    for (const portal of this.game.world.portals) {
      const dx = s.pos.x - portal.x;
      const dz = s.pos.z - portal.z;
      if (dx * dx + dz * dz > 3.2 * 3.2) continue;
      s.portalReadyAt = now + 2500;
      if (s.carrying) {
        this.game.toast(s, 'Portals refuse monster thieves!', 'bad');
        return;
      }
      const region = REGION_BY_ID[portal.region];
      const reason = regionLockReason(region, this.game.playerProgress(s), this.game.expansion.active);
      if (reason) {
        this.game.toast(s, reason, 'bad');
        return;
      }
      this.game.teleport(s, portal.to.x, portal.to.y, portal.to.z, 'portal');
      return;
    }
  }
}
