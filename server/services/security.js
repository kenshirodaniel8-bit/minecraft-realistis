// Base security lasers.
//
// The owner switches the lasers on at their base (lock pad or L key). While
// they are on, rivals cannot enter the base and nothing can be stolen. They
// switch off by themselves after a while, so bases are only safe while their
// owner keeps coming back to re-lock them.

import { CONFIG } from '#shared/config.js';
import { isInsideBase } from '#shared/world.js';
import { fail } from '../validate.js';

export class Security {
  constructor(game) {
    this.game = game;
    this.lockedUntil = new Array(12).fill(0);
    this.relockAt = new Array(12).fill(0);
  }

  resetBase(i) {
    this.lockedUntil[i] = 0;
    this.relockAt[i] = 0;
  }

  isLocked(i) {
    return this.lockedUntil[i] > this.game.now();
  }

  mayEnter(s, baseIndex) {
    if (baseIndex === s.baseIndex) return true;
    return !this.isLocked(baseIndex);
  }

  lockDurationMs(s) {
    const d = CONFIG.security.lockDurationsSec[s.profile.base.laserLevel] || CONFIG.security.lockDurationsSec[0];
    return d * 1000 * (1 + (s.perks?.security || 0));
  }

  handleLock(s) {
    if (CONFIG.security.requireAtBaseToLock) {
      const b = this.game.world.bases[s.baseIndex];
      const nearPad = (s.pos.x - b.lockPad.x) ** 2 + (s.pos.z - b.lockPad.z) ** 2 < 25;
      if (!isInsideBase(b, s.pos.x, s.pos.z, 1) && !nearPad) return fail('not_at_base', 'Lock your lasers at your base.');
    }
    return this.lock(s);
  }

  lock(s) {
    const game = this.game;
    const now = game.now();
    const i = s.baseIndex;
    if (s.dead) return fail('dead');
    if (this.isLocked(i)) return fail('already', 'Lasers are already on.');
    if (now < this.relockAt[i]) return fail('cooldown', `Lasers recharging (${Math.ceil((this.relockAt[i] - now) / 1000)}s)`);
    this.lockedUntil[i] = now + this.lockDurationMs(s);
    // anybody else inside gets pushed out; a thief inside drops the monster
    const b = game.world.bases[i];
    for (const o of game.players.values()) {
      if (o === s || !isInsideBase(b, o.pos.x, o.pos.z, 0.5)) continue;
      if (o.carrying && o.carrying.baseIndex === i) game.stealing.interrupt(o, 'lasers', 'returnToOwner');
      game.stealing.cancelPending(o);
      const jitter = (game.rng() - 0.5) * 6;
      o.inBases.delete(i);
      game.teleport(o, b.outside.x + b.tu.x * jitter, b.y, b.outside.z + b.tu.z * jitter, 'lasers');
      game.toast(o, 'The security lasers pushed you out!', 'bad');
    }
    for (const o of game.players.values()) {
      if (o.stealPending && o.stealPending.baseIndex === i) game.stealing.cancelPending(o, 'Lasers switched on!');
    }
    game.bases.broadcastBase(i);
    game.tutorialEvent(s, 'lock');
    return { ok: true, until: this.lockedUntil[i] };
  }

  tick(dt, now) {
    for (let i = 0; i < this.lockedUntil.length; i++) {
      if (this.lockedUntil[i] && this.lockedUntil[i] <= now) {
        this.lockedUntil[i] = 0;
        this.relockAt[i] = now + CONFIG.security.relockCooldownSec * 1000;
        const owner = this.game.bases.ownerSession(i);
        if (owner) this.game.toast(owner, 'Your security lasers are OFF! Return to your base to lock it again.', 'warn');
        this.game.bases.broadcastBase(i);
      }
    }
  }
}
