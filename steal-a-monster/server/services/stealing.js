// Multiplayer monster stealing.
//
// 1. A rival walks into a base whose lasers are OFF and holds E next to a
//    placed monster (stealBegin ... stealConfirm, the server times the hold).
// 2. The thief carries the monster (slower, can't teleport home). Ownership
//    does NOT change yet: the monster still belongs to the victim.
// 3. If the thief reaches their own base, ownership transfers exactly once.
// 4. If the thief is hit by a gadget, defeated, disconnects or runs out of
//    time, the theft is interrupted and the monster goes back according to
//    CONFIG.stealing.dropRule:
//      'returnToOwner'   - it flies straight back to its pad
//      'dropRecoverable' - it is dropped on the ground for a few seconds; the
//                          owner can touch it to send it home, another rival
//                          can grab it, otherwise it flies home by itself.

import { CONFIG } from '#shared/config.js';
import { SPECIES_BY_ID } from '#shared/monsters.js';
import { isObj, id as isId, fail } from '../validate.js';

export class Stealing {
  constructor(game) {
    this.game = game;
    this.away = new Map();     // owned monster id -> { kind: 'carried' | 'dropped', by: profile id }
    this.dropped = new Map();  // owned monster id -> drop record
  }

  isAway(ownedId) {
    return this.away.has(ownedId);
  }

  // Finds a placed monster in an online player's base.
  findPlaced(ownedId) {
    for (const owner of this.game.players.values()) {
      const m = owner.profile.monsters.find((x) => x.id === ownedId);
      if (m) return m.slot !== null ? { owner, m } : null;
    }
    return null;
  }

  handleBegin(s, p) {
    if (!isObj(p) || !isId(p.ownedId)) return fail('bad');
    const game = this.game;
    const now = game.now();
    if (s.dead) return fail('dead');
    if (s.fx.frozenUntil > now || s.fx.rootedUntil > now) return fail('stuck');
    if (s.carrying) return fail('carrying', 'You are already carrying a monster.');
    if (s.stealPending) return fail('busy', 'Already grabbing a monster.');
    const found = this.findPlaced(p.ownedId);
    if (!found) return fail('not_found', 'That monster is not on a pad.');
    const { owner, m } = found;
    if (owner === s) return fail('own', 'That monster is already yours!');
    if (this.isAway(m.id)) return fail('busy', 'Someone else is already stealing it.');
    if (game.security.isLocked(owner.baseIndex)) return fail('lasers', 'The security lasers are on!');
    if (CONFIG.stealing.victimProtectionMs && now - owner.joinedAt < CONFIG.stealing.victimProtectionMs) return fail('protected', 'That player just arrived.');
    const slot = game.world.bases[owner.baseIndex].slots[m.slot];
    if (Math.hypot(s.pos.x - slot.x, s.pos.z - slot.z) > CONFIG.stealing.maxDistance) return fail('too_far', 'Get closer.');
    if (s.profile.monsters.length >= s.profile.base.slots) return fail('base_full', 'Your base is full — no room for a stolen monster!');
    for (const o of game.players.values()) {
      if (o !== s && o.stealPending && o.stealPending.ownedId === m.id) return fail('busy', 'Someone else is grabbing it.');
    }
    s.stealPending = { ownedId: m.id, baseIndex: owner.baseIndex, startedAt: now, victim: owner.id };
    const sp = SPECIES_BY_ID[m.species];
    game.send(owner, 'theft', { stage: 'grab', thief: s.profile.name, species: m.species, name: sp.name });
    return { ok: true, holdMs: CONFIG.stealing.holdMs };
  }

  handleConfirm(s, p) {
    if (!isObj(p) || !isId(p.ownedId)) return fail('bad');
    const game = this.game;
    const now = game.now();
    const pend = s.stealPending;
    if (!pend || pend.ownedId !== p.ownedId) return fail('no_pending');
    if (now - pend.startedAt < CONFIG.stealing.holdMs - CONFIG.stealing.holdToleranceMs) return fail('too_soon', 'Keep holding!');
    s.stealPending = null;
    if (s.dead || s.carrying) return fail('cant');
    if (s.fx.frozenUntil > now || s.fx.rootedUntil > now) return fail('stuck');
    const found = this.findPlaced(p.ownedId);
    if (!found || found.owner.id !== pend.victim) return fail('gone', 'The monster is gone.');
    const { owner, m } = found;
    if (this.isAway(m.id)) return fail('busy');
    if (game.security.isLocked(owner.baseIndex)) return fail('lasers', 'The security lasers switched on!');
    const slot = game.world.bases[owner.baseIndex].slots[m.slot];
    if (Math.hypot(s.pos.x - slot.x, s.pos.z - slot.z) > CONFIG.stealing.maxDistance + 1) return fail('too_far');
    if (s.profile.monsters.length >= s.profile.base.slots) return fail('base_full');
    s.carrying = { ownedId: m.id, victimId: owner.id, baseIndex: owner.baseIndex, species: m.species, level: m.level, since: now };
    this.away.set(m.id, { kind: 'carried', by: s.id });
    const name = SPECIES_BY_ID[m.species].name;
    game.send(owner, 'theft', { stage: 'carry', thief: s.profile.name, species: m.species, name });
    game.broadcast('announce', { text: `${s.profile.name} is stealing ${owner.profile.name}'s ${name}!`, kind: 'theft' });
    game.bases.broadcastBase(owner.baseIndex);
    if (s.inBases.has(s.baseIndex)) this.completeTheft(s);
    return { ok: true, carrying: m.id };
  }

  handleCancel(s) {
    this.cancelPending(s);
    return { ok: true };
  }

  cancelPending(s, message) {
    if (!s.stealPending) return;
    s.stealPending = null;
    if (message) this.game.toast(s, message, 'bad');
  }

  // Delivery: the thief made it home.
  completeTheft(s) {
    const game = this.game;
    const c = s.carrying;
    if (!c) return false;
    s.carrying = null; // cleared first: this can only ever run once per theft
    this.away.delete(c.ownedId);
    const victim = game.byProfile.get(c.victimId);
    const victimProfile = victim ? victim.profile : game.profileCache.get(c.victimId);
    const vm = victimProfile && victimProfile.monsters.find((x) => x.id === c.ownedId);
    if (!vm || game.ledger.owner(c.ownedId) !== c.victimId) {
      game.toast(s, 'The monster slipped away.', 'bad');
      return false;
    }
    if (s.profile.monsters.length >= s.profile.base.slots) {
      game.toast(s, 'Your base is full — the monster ran home!', 'bad');
      if (victim) game.bases.broadcastBase(victim.baseIndex);
      return false;
    }
    // ledger first, then both profiles
    game.ledger.set(c.ownedId, s.id, vm.species, vm.level);
    victimProfile.monsters = victimProfile.monsters.filter((x) => x.id !== c.ownedId);
    const free = game.bases.freeSlots(s.profile);
    const moved = { ...vm, slot: free.length ? free[0] : null, following: false, origin: 'stolen', stolenFrom: victimProfile.name, obtainedAt: game.now() };
    s.profile.monsters.push(moved);
    s.profile.stats.stolen++;
    victimProfile.stats.lost++;
    game.saveNow(s, victimProfile);
    const name = SPECIES_BY_ID[vm.species].name;
    game.toast(s, `You stole ${victimProfile.name}'s ${name}!`, 'good');
    if (victim) {
      game.send(victim, 'theft', { stage: 'stolen', thief: s.profile.name, species: vm.species, name });
      game.refreshPerks(victim);
      game.markProfile(victim);
      game.bases.broadcastBase(victim.baseIndex);
    }
    game.refreshPerks(s);
    game.markProfile(s);
    game.bases.broadcastBase(s.baseIndex);
    game.bases.checkMilestones(s);
    game.broadcast('announce', { text: `${s.profile.name} stole a ${name} from ${victimProfile.name}!`, kind: 'theft' });
    return true;
  }

  // The thief was hit / defeated / left. rule overrides CONFIG.stealing.dropRule.
  interrupt(s, reason, rule) {
    const game = this.game;
    const c = s.carrying;
    if (!c) return false;
    s.carrying = null;
    const how = rule || CONFIG.stealing.dropRule;
    const victim = game.byProfile.get(c.victimId);
    if (how === 'dropRecoverable' && victim) {
      const now = game.now();
      const d = {
        ownedId: c.ownedId, victimId: c.victimId, baseIndex: c.baseIndex, species: c.species, level: c.level,
        x: s.pos.x, y: game.world.groundHeight(s.pos.x, s.pos.z), z: s.pos.z,
        until: now + CONFIG.stealing.dropRecoverMs, regrabAt: now + CONFIG.stealing.regrabCooldownMs, by: s.id,
      };
      this.dropped.set(c.ownedId, d);
      this.away.set(c.ownedId, { kind: 'dropped', by: null });
      game.broadcast('dropped', this.dropInfo(d));
      game.send(victim, 'theft', { stage: 'dropped', thief: s.profile.name, species: c.species, name: SPECIES_BY_ID[c.species].name });
    } else {
      this.returnHome(c.ownedId, c.victimId, c.baseIndex);
      if (victim) game.send(victim, 'theft', { stage: 'saved', thief: s.profile.name, species: c.species, name: SPECIES_BY_ID[c.species].name });
    }
    game.toast(s, reason === 'defeated' ? 'You were knocked out and dropped the monster!' : 'You dropped the stolen monster!', 'bad');
    game.broadcast('theftInterrupted', { pn: s.pn, reason });
    return true;
  }

  returnHome(ownedId, victimId, baseIndex) {
    this.away.delete(ownedId);
    if (this.dropped.delete(ownedId)) this.game.broadcast('droppedGone', { ownedId, home: true });
    const victim = this.game.byProfile.get(victimId);
    if (victim) this.game.bases.broadcastBase(victim.baseIndex);
    else if (baseIndex >= 0) this.game.bases.broadcastBase(baseIndex);
  }

  dropInfo(d) {
    return { ownedId: d.ownedId, species: d.species, level: d.level, x: d.x, y: d.y, z: d.z, until: d.until, baseIndex: d.baseIndex };
  }

  droppedList() {
    return [...this.dropped.values()].map((d) => this.dropInfo(d));
  }

  handleGrabDropped(s, p) {
    if (!isObj(p) || !isId(p.ownedId)) return fail('bad');
    const game = this.game;
    const now = game.now();
    const d = this.dropped.get(p.ownedId);
    if (!d) return fail('gone');
    if (s.dead || s.carrying) return fail('cant');
    if (Math.hypot(s.pos.x - d.x, s.pos.z - d.z) > 4) return fail('too_far');
    if (s.id === d.victimId) {
      this.returnHome(d.ownedId, d.victimId, d.baseIndex);
      game.toast(s, 'Rescued! It ran back to its pad.', 'good');
      return { ok: true, rescued: true };
    }
    if (now < d.regrabAt) return fail('cooldown', 'It is still dizzy...');
    if (s.profile.monsters.length >= s.profile.base.slots) return fail('base_full');
    this.dropped.delete(d.ownedId);
    game.broadcast('droppedGone', { ownedId: d.ownedId });
    s.carrying = { ownedId: d.ownedId, victimId: d.victimId, baseIndex: d.baseIndex, species: d.species, level: d.level, since: now };
    this.away.set(d.ownedId, { kind: 'carried', by: s.id });
    const victim = game.byProfile.get(d.victimId);
    if (victim) game.send(victim, 'theft', { stage: 'carry', thief: s.profile.name, species: d.species, name: SPECIES_BY_ID[d.species].name });
    if (s.inBases.has(s.baseIndex)) this.completeTheft(s);
    return { ok: true, carrying: d.ownedId };
  }

  tick(dt, now) {
    const game = this.game;
    for (const s of game.players.values()) {
      if (s.carrying && now - s.carrying.since > CONFIG.stealing.carryTimeoutMs) this.interrupt(s, 'timeout', 'returnToOwner');
      if (s.stealPending && now - s.stealPending.startedAt > CONFIG.stealing.holdMs + 4000) s.stealPending = null;
    }
    for (const d of [...this.dropped.values()]) {
      const owner = game.byProfile.get(d.victimId);
      if (!owner) {
        this.returnHome(d.ownedId, d.victimId, d.baseIndex);
        continue;
      }
      if (now > d.until) {
        this.returnHome(d.ownedId, d.victimId, d.baseIndex);
        continue;
      }
      if (!owner.dead && Math.hypot(owner.pos.x - d.x, owner.pos.z - d.z) < 3) {
        this.returnHome(d.ownedId, d.victimId, d.baseIndex);
        game.toast(owner, 'Rescued! It ran back to its pad.', 'good');
      }
    }
  }

  onLeave(s) {
    // the thief left: the monster goes home
    if (s.carrying) {
      const c = s.carrying;
      s.carrying = null;
      this.returnHome(c.ownedId, c.victimId, c.baseIndex);
      const victim = this.game.byProfile.get(c.victimId);
      if (victim) this.game.send(victim, 'theft', { stage: 'saved', thief: s.profile.name, species: c.species, name: SPECIES_BY_ID[c.species].name });
    }
    s.stealPending = null;
    // the victim left: every theft of their monsters is cancelled
    for (const o of this.game.players.values()) {
      if (o === s) continue;
      if (o.carrying && o.carrying.victimId === s.id) {
        const c = o.carrying;
        o.carrying = null;
        this.away.delete(c.ownedId);
        this.game.toast(o, 'The owner left — the monster ran home.', 'bad');
      }
      if (o.stealPending && o.stealPending.victim === s.id) o.stealPending = null;
    }
    for (const d of [...this.dropped.values()]) {
      if (d.victimId === s.id) this.returnHome(d.ownedId, d.victimId, -1);
    }
  }
}
