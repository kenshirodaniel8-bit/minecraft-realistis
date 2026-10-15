// Defeat -> Pay -> Recruit.
//
// Defeating a monster never makes it yours. When a wild monster is defeated
// it sits dazed for CONFIG.combat.defeatedWindowMs. Every player who did a
// meaningful share of the damage gets a recruitment offer; the top fighter
// has a short priority window. Recruiting is a single synchronous server
// transaction: checks -> take Money -> grant ownership -> remove the monster
// from the world. A request id makes retries safe (no double payment).

import { CONFIG } from '#shared/config.js';
import { RARITIES, recruitPrice, monsterStats, incomePerSecond, perkValue, monsterPower, defeatRewards, recruitReqReason } from '#shared/monsters.js';
import { SWORD_BY_ID } from '#shared/weapons.js';
import { isObj, int, fail } from '../validate.js';
import { MS } from './monsterAI.js';
import { newOwnedMonster } from './playerData.js';
import { MAX_COMPANIONS } from './companions.js';

export class Recruitment {
  constructor(game) {
    this.game = game;
  }

  discountFor(s) {
    return Math.min(0.3, (s.perks?.discount || 0) + (s.profile.coupons.recruitDiscount || 0));
  }

  priceFor(s, m) {
    return recruitPrice(m.species, m.level, this.discountFor(s));
  }

  onDefeated(m, killer) {
    const game = this.game;
    const now = game.now();
    if (m.challengeFor) return this.onChallengeDefeated(m);
    m.defeatedAt = now;
    m.deadline = now + CONFIG.combat.defeatedWindowMs;
    const min = CONFIG.combat.assistShare * m.maxHp;
    const eligible = new Set();
    let top = null;
    let topDmg = -1;
    for (const [pid, dmg] of m.damageBy) {
      if (dmg >= min) eligible.add(pid);
      if (dmg > topDmg) {
        topDmg = dmg;
        top = pid;
      }
    }
    eligible.add(killer.id);
    m.eligible = eligible;
    m.top = top || killer.id;
    m.exclusiveUntil = now + CONFIG.combat.exclusiveRecruitMs;
    const rewards = defeatRewards(m.species, m.level);
    for (const pid of eligible) {
      const s = game.byProfile.get(pid);
      if (!s) continue;
      const xp = game.addXp(s, rewards.xp);
      game.economy.credit(s, rewards.money, 'defeat');
      const gems = game.economy.creditGems(s, this.rollGems(m), 'defeat');
      s.profile.stats.defeated++;
      this.discover(s, m.sp);
      game.tutorialEvent(s, 'defeat');
      game.send(s, 'reward', { xp, money: rewards.money, gems, monsterId: m.id });
      game.send(s, 'recruitOffer', this.offerFor(s, m));
    }
  }

  // A Moon Sky Arena monster: the challenger gets the usual rewards, but it is
  // never recruited (the prize is the secret monster at the end).
  onChallengeDefeated(m) {
    const game = this.game;
    m.defeatedAt = game.now();
    m.deadline = Infinity;
    m.eligible = null;
    const s = game.byProfile.get(m.challengeFor);
    if (s) {
      const rewards = defeatRewards(m.species, m.level);
      const xp = game.addXp(s, rewards.xp);
      game.economy.credit(s, rewards.money, 'defeat');
      const gems = game.economy.creditGems(s, this.rollGems(m), 'defeat');
      s.profile.stats.defeated++;
      this.discover(s, m.sp);
      game.send(s, 'reward', { xp, money: rewards.money, gems, monsterId: m.id });
    }
    game.moonSecret.onDefeated(m);
  }

  // Monster Gems from a defeat: by rarity, plus a bonus in gem-rich regions.
  rollGems(m) {
    const rng = this.game.rng;
    const d = CONFIG.gems.drops[m.species.rarity];
    let n = 0;
    if (d && rng() < d.chance) n += d.min + Math.floor(rng() * (d.max - d.min + 1));
    n += CONFIG.gems.regionBonus[m.region] || 0;
    return n;
  }

  discover(s, speciesId) {
    const d = s.profile.discoveries.species;
    if (!d[speciesId]) {
      d[speciesId] = this.game.now();
      this.game.markProfile(s);
    }
  }

  offerFor(s, m) {
    const st = monsterStats(m.species, m.level);
    return {
      monsterId: m.id,
      species: m.sp,
      level: m.level,
      price: this.priceFor(s, m),
      basePrice: recruitPrice(m.species, m.level),
      discount: this.discountFor(s),
      rarity: m.species.rarity,
      stats: { hp: st.maxHp, atk: Math.round(st.atk), def: Math.round(st.def), speed: st.speed },
      income: incomePerSecond(m.species, m.level),
      perk: { kind: m.species.perk.kind, value: perkValue(m.species, m.level) },
      power: monsterPower(m.species, m.level),
      deadline: m.deadline,
      priorityUntil: s.id === m.top ? 0 : m.exclusiveUntil,
      requirement: m.species.recruitReq?.text || null,
      requirementMissing: this.requirementMissing(s, m),
    };
  }

  bestSwordTier(s) {
    return Math.max(1, ...s.profile.swords.map((id) => SWORD_BY_ID[id]?.tier || 1));
  }

  requirementMissing(s, m) {
    return recruitReqReason(m.species, s.profile, this.bestSwordTier(s));
  }

  handleRecruit(s, p) {
    if (!isObj(p) || !int(p.monsterId, 1, 1e12)) return fail('bad');
    const cached = s.recall(p.reqId);
    if (cached) return cached;
    const game = this.game;
    const now = game.now();
    const m = game.monsters.get(p.monsterId);
    const no = (code, msg) => s.remember(p.reqId, fail(code, msg));
    if (!m || m.state !== MS.defeated) return no('gone', 'That monster is no longer waiting to be recruited.');
    if (now > m.deadline) return no('expired', 'Too late — it recovered!');
    if (!m.eligible || !m.eligible.has(s.id)) return fail('not_eligible', 'You need to help defeat a monster to recruit it.');
    if (s.id !== m.top && now < m.exclusiveUntil) {
      return fail('priority', `The top fighter has first pick for ${Math.ceil((m.exclusiveUntil - now) / 1000)}s.`);
    }
    if (s.dead) return fail('dead', 'You are knocked out.');
    if (Math.hypot(s.pos.x - m.x, s.pos.z - m.z) > CONFIG.recruitment.maxDistance) return fail('too_far', 'Get closer to the monster.');
    const missing = this.requirementMissing(s, m);
    if (missing) return fail('requirement', missing);
    const profile = s.profile;
    if (profile.monsters.length >= profile.base.slots) {
      return fail('base_full', 'Your base is full! Upgrade your base for more slots, or release a monster.');
    }
    const price = this.priceFor(s, m);
    if (profile.money < price) return fail('money', `You need ${price} Money (you have ${Math.floor(profile.money)}).`);

    // ---- commit (synchronous: nothing can interleave) ----
    if (!game.economy.debit(s, price, `recruit:${m.sp}`)) return fail('money');
    if (profile.coupons.recruitDiscount) profile.coupons.recruitDiscount = 0;
    const owned = newOwnedMonster(m.sp, m.level, m.event ? 'event' : 'recruited', now);
    // it comes along with you if there is room among your companions
    owned.following = profile.monsters.filter((o) => o.following && o.slot === null).length < MAX_COMPANIONS;
    profile.monsters.push(owned);
    game.ledger.set(owned.id, profile.id, owned.species, owned.level);
    profile.stats.recruited++;
    this.discover(s, m.sp);
    const others = [...m.eligible].filter((pid) => pid !== s.id);
    m.eligible = null;
    m.state = MS.recover; // no longer recruitable, even for a moment
    game.monsters.remove(m, 'recruited', { by: s.pn, owned: owned.id });
    for (const pid of others) {
      const o = game.byProfile.get(pid);
      if (o) game.send(o, 'offerGone', { monsterId: m.id, by: profile.name });
    }
    game.tutorialEvent(s, 'recruit');
    game.bases.checkMilestones(s);
    if (s.inBases.has(s.baseIndex)) game.bases.autoPlace(s);
    game.markProfile(s);
    game.saveNow(s);
    const rarity = RARITIES[m.species.rarity];
    if (rarity.order >= 3) game.broadcast('announce', { text: `${profile.name} recruited a ${rarity.name} ${m.species.name}!`, kind: 'rare' });
    return s.remember(p.reqId, { ok: true, owned, price, money: profile.money });
  }

  handleDecline(s, p) {
    if (!isObj(p) || !int(p.monsterId, 1, 1e12)) return fail('bad');
    const m = this.game.monsters.get(p.monsterId);
    if (!m || m.state !== MS.defeated || !m.eligible) return { ok: true };
    m.eligible.delete(s.id);
    if (m.eligible.size === 0) this.game.monsters.recover(m);
    else if (m.top === s.id) m.exclusiveUntil = 0;
    return { ok: true };
  }

  onLeave(s) {
    for (const m of this.game.monsters.list.values()) {
      if (m.state !== MS.defeated || !m.eligible) continue;
      if (m.eligible.delete(s.id) && m.eligible.size === 0) this.game.monsters.recover(m);
    }
  }

  tick(dt, now) {
    for (const m of this.game.monsters.list.values()) {
      if (m.state === MS.defeated && now > m.deadline) {
        if (m.eligible) {
          for (const pid of m.eligible) {
            const o = this.game.byProfile.get(pid);
            if (o) this.game.send(o, 'offerGone', { monsterId: m.id, expired: true });
          }
        }
        this.game.monsters.recover(m);
      }
    }
  }
}
