// Player bases: plot assignment, monster placement, passive income,
// collecting Money, milestones and the H-key "return to base" teleport.

import { CONFIG } from '#shared/config.js';
import { SPECIES_BY_ID, incomePerSecond } from '#shared/monsters.js';
import { isInsideBase } from '#shared/world.js';
import { isObj, id as isId, int, fail } from '../validate.js';

const MILESTONES = [
  { id: 'species_3', count: 3, reward: 300, title: 'Monster Friend' },
  { id: 'species_6', count: 6, reward: 1000, title: 'Collector' },
  { id: 'species_10', count: 10, reward: 4000, title: 'Monster Expert' },
  { id: 'species_20', count: 20, reward: 20000, title: 'Monster Master' },
  { id: 'species_30', count: 30, reward: 80000, title: 'Living Legend' },
];

export class BaseManager {
  constructor(game) {
    this.game = game;
    this.owners = new Array(12).fill(null);   // profile id per plot
    this.lastIncomeAt = game.now();
    this.lastStoredBroadcast = 0;
  }

  assign(pid) {
    const existing = this.owners.indexOf(pid);
    if (existing >= 0) return existing;
    const free = this.owners.indexOf(null);
    if (free < 0 || free >= CONFIG.maxPlayers) return -1;
    this.owners[free] = pid;
    this.game.security.resetBase(free);
    return free;
  }

  release(index) {
    if (index < 0) return;
    this.owners[index] = null;
    this.game.security.resetBase(index);
  }

  ownerSession(index) {
    const pid = this.owners[index];
    return pid ? this.game.byProfile.get(pid) : null;
  }

  // ----------------------------------------------------------- base state

  state(index) {
    const s = this.ownerSession(index);
    if (!s) return { index, empty: true };
    const p = s.profile;
    const stealing = this.game.stealing;
    return {
      index,
      pn: s.pn,
      name: p.name,
      color: p.color,
      level: p.level,
      slots: p.base.slots,
      laserLevel: p.base.laserLevel,
      lockedUntil: this.game.security.lockedUntil[index],
      relockAt: this.game.security.relockAt[index],
      stored: Math.floor(p.storedIncome),
      income: s.income,
      monsters: p.monsters
        .filter((m) => m.slot !== null)
        .map((m) => ({ id: m.id, species: m.species, level: m.level, slot: m.slot, away: stealing.isAway(m.id), income: incomePerSecond(SPECIES_BY_ID[m.species], m.level) })),
    };
  }

  allStates() {
    const out = [];
    for (let i = 0; i < this.owners.length; i++) if (this.owners[i]) out.push(this.state(i));
    return out;
  }

  broadcastBase(index) {
    if (index < 0) return;
    this.game.broadcast('base', this.state(index));
  }

  isAtOwnBase(s, margin = 1) {
    const b = this.game.world.bases[s.baseIndex];
    return b && isInsideBase(b, s.pos.x, s.pos.z, margin);
  }

  // ----------------------------------------------------------- placement

  findOwned(s, ownedId) {
    return isId(ownedId) ? s.profile.monsters.find((m) => m.id === ownedId) : null;
  }

  handlePlace(s, p) {
    if (!isObj(p) || !int(p.slot, 0, CONFIG.bases.maxSlots - 1)) return fail('bad');
    const m = this.findOwned(s, p.ownedId);
    if (!m) return fail('not_owned');
    if (this.game.stealing.isAway(m.id)) return fail('busy', 'That monster is being stolen!');
    if (p.slot >= s.profile.base.slots) return fail('locked_slot', 'Upgrade your base to unlock that pad.');
    if (!this.isAtOwnBase(s, 6)) return fail('not_at_base', 'Go back to your base to place monsters (press H).');
    const other = s.profile.monsters.find((o) => o.slot === p.slot && o !== m);
    if (other) {
      if (this.game.stealing.isAway(other.id)) return fail('busy');
      other.slot = m.slot; // swap (may become unplaced)
    }
    m.slot = p.slot;
    m.following = false;
    this.afterPlacementChange(s);
    this.game.tutorialEvent(s, 'place');
    return { ok: true };
  }

  handleUnplace(s, p) {
    if (!isObj(p)) return fail('bad');
    const m = this.findOwned(s, p.ownedId);
    if (!m) return fail('not_owned');
    if (this.game.stealing.isAway(m.id)) return fail('busy');
    if (m.slot === null) return { ok: true };
    if (!this.isAtOwnBase(s, 6)) return fail('not_at_base', 'You can only pick up monsters at your base.');
    m.slot = null;
    this.afterPlacementChange(s);
    return { ok: true };
  }

  handleFollow(s, p) {
    if (!isObj(p)) return fail('bad');
    const m = this.findOwned(s, p.ownedId);
    if (!m) return fail('not_owned');
    if (this.game.stealing.isAway(m.id)) return fail('busy');
    const want = p.follow !== false;
    if (want && m.slot !== null) {
      if (!this.isAtOwnBase(s, 6)) return fail('not_at_base', 'Pick it up at your base first.');
      m.slot = null;
    }
    for (const o of s.profile.monsters) o.following = false;
    m.following = want;
    this.afterPlacementChange(s);
    return { ok: true };
  }

  handleRelease(s, p) {
    if (!isObj(p) || p.confirm !== true) return fail('bad');
    const m = this.findOwned(s, p.ownedId);
    if (!m) return fail('not_owned');
    if (this.game.stealing.isAway(m.id)) return fail('busy');
    s.profile.monsters = s.profile.monsters.filter((o) => o !== m);
    this.game.ledger.remove(m.id);
    this.afterPlacementChange(s);
    this.game.saveNow(s);
    return { ok: true };
  }

  afterPlacementChange(s) {
    this.game.refreshPerks(s);
    this.game.markProfile(s);
    this.broadcastBase(s.baseIndex);
  }

  freeSlots(profile) {
    const used = new Set(profile.monsters.filter((m) => m.slot !== null).map((m) => m.slot));
    const out = [];
    for (let i = 0; i < profile.base.slots; i++) if (!used.has(i)) out.push(i);
    return out;
  }

  // Monsters that came home with you hop onto free pads automatically.
  autoPlace(s) {
    const free = this.freeSlots(s.profile);
    const placed = [];
    for (const m of s.profile.monsters) {
      if (m.slot !== null || !free.length || this.game.stealing.isAway(m.id)) continue;
      m.slot = free.shift();
      m.following = false;
      placed.push(m);
    }
    if (placed.length) {
      this.afterPlacementChange(s);
      this.game.tutorialEvent(s, 'place');
      const names = placed.map((m) => SPECIES_BY_ID[m.species].name).join(', ');
      this.game.toast(s, `${names} moved into your base!`, 'good');
    }
    return placed;
  }

  onEnterOwnBase(s) {
    this.autoPlace(s);
  }

  checkMilestones(s) {
    const n = Object.keys(s.profile.discoveries.species).length;
    const owned = new Set(s.profile.monsters.map((m) => m.species)).size;
    for (const ms of MILESTONES) {
      if (s.profile.milestones[ms.id] || Math.max(owned, 0) < ms.count) continue;
      s.profile.milestones[ms.id] = this.game.now();
      this.game.economy.credit(s, ms.reward, 'milestone');
      this.game.send(s, 'milestone', { title: ms.title, count: ms.count, reward: ms.reward });
    }
    return n;
  }

  // ----------------------------------------------------------- income

  incomeCap(s) {
    return Math.max(100, s.income * CONFIG.bases.incomeAccumulateCap);
  }

  applyOfflineIncome(s, now) {
    const p = s.profile;
    const ms = Math.min(Math.max(0, now - p.lastSeen), CONFIG.bases.offlineIncomeMaxHours * 3600e3);
    const earned = Math.floor((s.income * ms) / 1000 * CONFIG.bases.offlineIncomeRate);
    if (earned > 0) {
      p.storedIncome = Math.min(this.incomeCap(s), p.storedIncome + earned);
      s.offlineEarned = earned;
    }
  }

  handleCollect(s) {
    if (!this.isAtOwnBase(s, 1)) return fail('not_at_base', 'Collect at your base.');
    return this.collect(s);
  }

  collect(s) {
    const p = s.profile;
    const amount = Math.floor(p.storedIncome);
    if (amount <= 0) return { ok: true, amount: 0 };
    p.storedIncome -= amount;
    this.game.economy.credit(s, amount, 'income');
    this.game.send(s, 'collected', { amount });
    this.game.tutorialEvent(s, 'collect');
    this.broadcastBase(s.baseIndex);
    return { ok: true, amount };
  }

  // Stepping on your own pads (collector, lock button).
  checkPads(s) {
    if (s.dead || s.baseIndex < 0 || !s.inBases.has(s.baseIndex)) return;
    const b = this.game.world.bases[s.baseIndex];
    const now = this.game.now();
    const near = (p, r) => (s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2 < r * r;
    if (near(b.collector, 2.8) && now - s.lastCollectAt > 800) {
      s.lastCollectAt = now;
      this.collect(s);
    }
    if (near(b.lockPad, 2.2) && !this.game.security.isLocked(s.baseIndex) && now >= (s.lockPadReadyAt || 0)) {
      s.lockPadReadyAt = now + 1500;
      this.game.security.lock(s);
    }
  }

  tick(dt, now) {
    if (now - this.lastIncomeAt >= 1000) {
      const secs = Math.min(5, (now - this.lastIncomeAt) / 1000);
      this.lastIncomeAt = now;
      for (const s of this.game.players.values()) {
        if (s.income <= 0) continue;
        const p = s.profile;
        p.storedIncome = Math.min(this.incomeCap(s), p.storedIncome + s.income * secs);
        s.saveDirty = true;
      }
    }
    if (now - this.lastStoredBroadcast >= 2000) {
      this.lastStoredBroadcast = now;
      const list = [];
      for (const s of this.game.players.values()) list.push([s.baseIndex, Math.floor(s.profile.storedIncome)]);
      if (list.length) this.game.broadcast('baseStored', list);
    }
  }

  // ----------------------------------------------------------- H key

  handleHome(s) {
    const game = this.game;
    const now = game.now();
    const cfg = CONFIG.homeTeleport;
    if (s.dead) return fail('dead');
    if (s.fx.frozenUntil > now || s.fx.rootedUntil > now) return fail('stuck', 'You are stuck!');
    if (now < s.homeReadyAt) return fail('cooldown', `Home teleport ready in ${Math.ceil((s.homeReadyAt - now) / 1000)}s`);
    if (s.carrying && !cfg.allowWhileCarrying) return fail('carrying', 'You cannot teleport while carrying a stolen monster — run!');
    if (cfg.allowInCombatMs > 0 && now - s.lastDamagedAt < cfg.allowInCombatMs) return fail('combat', 'You cannot teleport during a fight.');
    const b = game.world.bases[s.baseIndex];
    if (!b) return fail('no_base');
    game.stealing.cancelPending(s);
    s.homeReadyAt = now + cfg.cooldownMs;
    game.teleport(s, b.spawn.x, b.y, b.spawn.z, 'home', b.yaw);
    game.markProfile(s);
    return { ok: true, readyAt: s.homeReadyAt };
  }
}
