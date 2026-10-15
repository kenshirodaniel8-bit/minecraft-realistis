// Sword combat (player -> monster) and damage to players (monster -> player).
//
// Clients only say "I swung my sword facing this way". The server decides
// which monsters are in reach (using the server's own positions), applies
// cooldowns, rolls damage and crits, and owns all health values.

import { CONFIG } from '#shared/config.js';
import { SWORD_BY_ID } from '#shared/weapons.js';
import { isObj, finite, fail } from '../validate.js';

const DEG = Math.PI / 180;

export class Combat {
  constructor(game) {
    this.game = game;
  }

  canAct(s, now) {
    return !s.dead && s.fx.frozenUntil <= now && s.fx.stunUntil <= now && s.fx.slipUntil <= now;
  }

  handleAttack(s, p) {
    if (!isObj(p) || !finite(p.yaw, -100, 100)) return fail('bad');
    const game = this.game;
    const now = game.now();
    if (!this.canAct(s, now)) return fail('cant_act');
    const sword = SWORD_BY_ID[s.profile.sword];
    // small tolerance for network jitter, never more than ~15% faster
    if (now - s.lastAttackAt < sword.cooldownMs * 0.85) return fail('cooldown');
    s.lastAttackAt = now;
    if (now - s.combo.at < CONFIG.combat.comboWindowMs) s.combo.count++;
    else s.combo.count = 1;
    s.combo.at = now;
    const comboHit = s.combo.count % 3 === 0;
    s.yaw = p.yaw;
    game.broadcastNear(s.pos.x, s.pos.z, 120, 'swing', { pn: s.pn, combo: comboHit }, s);

    const reach = sword.range + CONFIG.player.radius + CONFIG.combat.rangeTolerance;
    const targets = game.monsters.findInArc(s.pos, p.yaw, reach, sword.arc + 20, sword.maxTargets, s);
    const hits = [];
    for (const m of targets) hits.push(this.hitMonster(s, m, sword, comboHit, 1, now));
    const sp = sword.special;
    if (sp && sp.kind === 'chain' && targets.length) {
      const extra = game.monsters.nearestTo(targets[0], sp.range, new Set(targets), s);
      if (extra) hits.push(this.hitMonster(s, extra, sword, false, sp.share, now, true));
    }
    // Galaxy Sword: every third hit sets off a star nova around the target
    let nova = null;
    if (sp && sp.kind === 'nova' && comboHit && targets.length) {
      const c = targets[0];
      nova = { x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10, r: sp.radius };
      const done = new Set(targets);
      for (let i = 0; i < sp.maxTargets; i++) {
        const m = game.monsters.nearestTo(c, sp.radius, done, s);
        if (!m) break;
        done.add(m);
        const h = this.hitMonster(s, m, sword, false, sp.share, now, true);
        h.fx = 'nova';
        hits.push(h);
      }
    }
    if (hits.length) game.broadcastNear(s.pos.x, s.pos.z, 140, 'hits', { pn: s.pn, hits, nova });
    // swinging at a lucky block opens it too
    if (!hits.length) game.lucky.trySwing(s, p.yaw);
    return { ok: true, hits: hits.length };
  }

  hitMonster(s, m, sword, comboHit, mult, now, chained = false) {
    const c = CONFIG.combat;
    const sp = sword.special || {};
    let dmg = sword.damage * mult * (1 + (s.perks?.damage || 0));
    dmg *= 1 - c.damageVariance + this.game.rng() * c.damageVariance * 2;
    let critChance = c.critChance + (sp.kind === 'crit' ? sp.chance : 0) + (sp.kind === 'celestial' ? sp.crit : 0);
    const crit = this.game.rng() < critChance;
    if (crit) dmg *= c.critMultiplier;
    if (comboHit) dmg *= 1 + c.comboBonus;
    // the special effect of this hit (shown by the client)
    let fx = null;
    if (sp.kind === 'jackpot' && !chained && this.game.rng() < sp.chance) {
      dmg *= sp.mult;
      fx = 'jackpot';
    }
    let rainbow = -1;
    if (sp.kind === 'rainbow' && !chained) {
      rainbow = s.rainbowStep = ((s.rainbowStep || 0) + 1) % 3;
      if (rainbow === 2) dmg *= 1 + sp.bonus;
      fx = ['rainbow_fire', 'rainbow_ice', 'rainbow_star'][rainbow];
    }
    dmg *= 100 / (100 + m.def * 3);
    dmg = Math.max(1, Math.round(dmg));
    const monsters = this.game.monsters;
    if (sp.kind === 'burn') m.burn = { dps: sword.damage * sp.dps, until: now + sp.durationMs, by: s, acc: 0 };
    if (rainbow === 0) m.burn = { dps: sword.damage * sp.burnDps, until: now + sp.burnMs, by: s, acc: 0 };
    if (sp.kind === 'slow' || rainbow === 1) {
      m.slowUntil = Math.max(m.slowUntil, now + (sp.durationMs || sp.slowMs));
      if (!fx) fx = 'slow';
    }
    if (sp.kind === 'freeze' && !m.species.ai.boss && this.game.rng() < sp.chance) {
      m.stunnedUntil = Math.max(m.stunnedUntil, now + sp.durationMs);
      fx = 'freeze';
    }
    if (sp.kind === 'cleave') monsters.knockback(m, s.pos, sp.knockback);
    if (comboHit && !m.species.ai.boss) m.stunnedUntil = Math.max(m.stunnedUntil, now + 450);
    if (sp.kind === 'lifesteal') this.heal(s, dmg * sp.share);
    if (sp.kind === 'celestial') this.heal(s, dmg * sp.heal);
    monsters.damage(m, dmg, s, { crit });
    return { id: m.id, dmg, crit, combo: comboHit, chain: chained, fx, hp: Math.round((100 * m.hp) / m.maxHp) };
  }

  heal(s, amount) {
    if (s.dead) return;
    s.hp = Math.min(s.maxHp, s.hp + amount);
  }

  handleDodge(s) {
    const now = this.game.now();
    if (!this.canAct(s, now) || s.fx.rootedUntil > now) return fail('cant_act');
    if (now < s.dodgeReadyAt) return fail('cooldown');
    s.dodgeUntil = now + CONFIG.player.dodgeMs;
    s.dodgeReadyAt = now + CONFIG.player.dodgeCooldownMs;
    this.game.broadcastNear(s.pos.x, s.pos.z, 120, 'dodge', { pn: s.pn }, s);
    return { ok: true, until: s.dodgeUntil };
  }

  // Damage a player. opts: { from (monster id), kb: {x, z, up}, effect, power }
  damagePlayer(s, raw, opts = {}) {
    const game = this.game;
    const now = game.now();
    if (s.dead) return { blocked: 'dead' };
    if (s.protectUntil > now) return { blocked: 'protected' };
    if (s.dodgeUntil > now) {
      game.send(s, 'dodged', { from: opts.from });
      return { blocked: 'dodge' };
    }
    const dmg = Math.max(1, Math.round(raw));
    s.hp -= dmg;
    s.lastDamagedAt = now;
    const fx = s.fx;
    switch (opts.effect) {
      case 'burn': fx.burnUntil = now + 3000; fx.burnDps = Math.max(fx.burnDps, raw * 0.15); break;
      case 'slow': fx.slowUntil = now + 2500; fx.slowFactor = 0.6; break;
      case 'freeze': fx.frozenUntil = Math.max(fx.frozenUntil, now + 900); break;
      case 'stun': fx.stunUntil = Math.max(fx.stunUntil, now + 800); break;
      default: break;
    }
    if (opts.kb) {
      s.knockbackUntil = now + CONFIG.movement.knockbackAllowanceMs;
      game.send(s, 'knock', { x: opts.kb.x, z: opts.kb.z, up: opts.kb.up || 4 });
    }
    game.send(s, 'hurt', { dmg, hp: Math.max(0, Math.round(s.hp)), maxHp: s.maxHp, from: opts.from, effect: opts.effect || null });
    if (s.hp <= 0) this.killPlayer(s, opts);
    return { dmg };
  }

  killPlayer(s, opts = {}) {
    const game = this.game;
    const now = game.now();
    s.hp = 0;
    s.dead = true;
    s.respawnAt = now + CONFIG.player.respawnMs;
    s.profile.stats.deaths++;
    s.fx.burnUntil = 0;
    game.stealing.interrupt(s, 'defeated');
    game.stealing.cancelPending(s);
    game.markProfile(s);
    game.broadcast('playerDown', { pn: s.pn, by: opts.from ?? null, respawnAt: s.respawnAt });
  }

  respawn(s) {
    const game = this.game;
    const now = game.now();
    const base = game.world.bases[s.baseIndex];
    s.dead = false;
    s.hp = s.maxHp;
    s.protectUntil = now + CONFIG.player.spawnProtectionMs;
    s.fx.frozenUntil = s.fx.rootedUntil = s.fx.slowUntil = s.fx.stunUntil = s.fx.slipUntil = s.fx.burnUntil = 0;
    game.teleport(s, base.spawn.x, base.y, base.spawn.z, 'respawn', base.yaw);
    game.broadcast('playerUp', { pn: s.pn });
  }

  tick(dt, now) {
    const P = CONFIG.player;
    for (const s of this.game.players.values()) {
      if (s.dead) {
        if (now >= s.respawnAt) this.respawn(s);
        continue;
      }
      // burning
      if (s.fx.burnUntil > now) {
        s.burnAcc = (s.burnAcc || 0) + s.fx.burnDps * dt;
        if (s.burnAcc >= 3) {
          const d = Math.floor(s.burnAcc);
          s.burnAcc -= d;
          this.damagePlayer(s, d, { effect: null });
        }
      }
      // lava pools
      if (this.game.world.isLava(s.pos.x, s.pos.z, s.pos.y)) {
        s.lavaAcc = (s.lavaAcc || 0) + P.lavaDps * dt;
        if (s.lavaAcc >= 5) {
          const d = Math.floor(s.lavaAcc);
          s.lavaAcc -= d;
          this.damagePlayer(s, d, { effect: 'burn', kb: { x: 0, z: 0, up: 9 } });
        }
      }
      if (s.dead) continue;
      // natural regeneration out of combat
      if (now - s.lastDamagedAt > P.regenDelayMs && s.hp < s.maxHp) {
        s.hp = Math.min(s.maxHp, s.hp + s.maxHp * P.regenPerSecond * (1 + (s.perks?.regen || 0)) * dt);
      }
    }
  }
}

export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export { DEG };
