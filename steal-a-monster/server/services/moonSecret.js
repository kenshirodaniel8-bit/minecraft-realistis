// The secret of Cute Monster Island (layout in shared/moonSecret.js).
//
//   1. Five small moon buttons are hidden around the island. Stepping on one
//      lights it up blue for that player ("Moon button 2/5") and the
//      progress is saved in the profile.
//   2. With all five found, a portal appears near the middle of the island
//      (the client shows an arrow to it). Walking into it starts a run in the
//      Moon Sky Arena.
//   3. The arena is a jumping course of floating stones with four battle
//      platforms. Reaching platform k in round k calls that round's monster:
//      one Uncommon, then a Rare, an Epic and a Legendary cute monster. It
//      only fights the player who called it. Falling off sends you back to
//      the last platform you reached.
//   4. Winning round four gives the secret monster straight to your base.

import { SPECIES, SPECIES_BY_ID, RARITIES } from '#shared/monsters.js';
import { ARENA, arenaPlatformAt } from '#shared/moonSecret.js';
import { newOwnedMonster } from './playerData.js';

const LEAVE_AFTER_WIN_MS = 3500;
const REPLAY_REWARD = { money: 25000, gems: 12 };

export class MoonSecret {
  constructor(game) {
    this.game = game;
    this.def = game.world.moon;
    // the cute monsters each round picks from
    this.pools = this.def.rounds.map((r) => SPECIES.filter((sp) => sp.island === 'cute' && sp.rarity === r));
  }

  state(s) {
    const m = s.profile.moon;
    const run = s.moonRun;
    return {
      found: [...m.found],
      won: m.won,
      run: run ? { round: run.round, done: !!run.wonAt, monster: run.monster?.id ?? null } : null,
    };
  }

  push(s) {
    this.game.send(s, 'moon', this.state(s));
  }

  // ------------------------------------------------------------ the buttons

  afterMove(s) {
    if (s.region === 'cute') {
      this.checkButtons(s);
      this.checkPortal(s);
    } else if (s.region === ARENA.id) {
      this.checkArena(s);
    }
  }

  checkButtons(s) {
    const moon = s.profile.moon;
    if (moon.found.length >= this.def.buttons.length) return;
    const r = this.def.buttonRadius;
    for (const b of this.def.buttons) {
      if (moon.found.includes(b.id)) continue;
      if ((s.pos.x - b.x) ** 2 + (s.pos.z - b.z) ** 2 > r * r || Math.abs(s.pos.y - b.y) > 2.5) continue;
      moon.found.push(b.id);
      this.game.markProfile(s);
      const n = moon.found.length;
      const total = this.def.buttons.length;
      this.game.send(s, 'moonButton', { id: b.id, found: n, total });
      if (n >= total) {
        this.game.toast(s, `🌕 You found all ${total} moon buttons! A secret portal has appeared — follow the arrow!`, 'good');
      } else {
        this.game.toast(s, `🌙 You found a moon button! ${n}/${total}`, 'good');
      }
      this.push(s);
    }
  }

  portalOpen(s) {
    return s.profile.moon.found.length >= this.def.buttons.length;
  }

  checkPortal(s) {
    if (!this.portalOpen(s)) return;
    const p = this.def.portal;
    if ((s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2 > p.r * p.r) return;
    const now = this.game.now();
    if (now < (s.moonPortalReadyAt || 0)) return;
    s.moonPortalReadyAt = now + 2500;
    this.enter(s);
  }

  enter(s) {
    const game = this.game;
    if (s.dead) return;
    if (s.carrying) return game.toast(s, 'You cannot take a stolen monster into the Moon Sky Arena.', 'warn');
    const prof = s.profile;
    if (!prof.moon.won && prof.monsters.length >= prof.base.slots) {
      return game.toast(s, 'Your base is full! Free a slot first so the secret monster has somewhere to live.', 'warn');
    }
    s.moonRun = { round: 0, monster: null, checkpoint: this.def.start, wonAt: 0 };
    const st = this.def.start;
    game.teleport(s, st.x, st.y, st.z, 'moon', Math.PI);
    game.toast(s, `🌙 Moon Sky Arena! Jump across the stones. Round 1: defeat the ${RARITIES.uncommon.name} monster on the first big platform.`, 'info');
    this.push(s);
  }

  // ------------------------------------------------------------ the arena

  checkArena(s) {
    const run = s.moonRun;
    if (!run) {
      // nobody gets here without the portal; send strays back
      return this.sendBack(s, 'stray');
    }
    if (run.wonAt) return;
    // fell off: back to the last platform reached
    if (s.pos.y < this.def.fallY) {
      const c = run.checkpoint;
      this.game.teleport(s, c.x, c.y, c.z, 'moon_fall');
      this.game.toast(s, 'Whoops, you fell! Back to the last platform.', 'warn');
      return;
    }
    const k = arenaPlatformAt(s.pos.x, s.pos.z);
    if (k < 0) return;
    const plat = this.def.platforms[k];
    if (Math.abs(s.pos.y - plat.top) > 1.5) return;
    if (k <= run.round) run.checkpoint = { x: plat.x, y: plat.top, z: plat.z };
    if (k === run.round && !run.monster) this.callMonster(s, k);
  }

  callMonster(s, k) {
    const game = this.game;
    const pool = this.pools[k];
    const sp = pool[Math.floor(game.rng() * pool.length)];
    const plat = this.def.platforms[k];
    // across the platform from where the player stands
    const dx = plat.x - s.pos.x;
    const dz = plat.z - s.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const off = Math.min(plat.half - 2.5, 5);
    const x = plat.x + (dx / d) * off;
    const z = plat.z + (dz / d) * off;
    const m = game.monsters.spawn(sp, this.def.roundLevels[k], x, z, { region: ARENA.id, challengeFor: s.id, plat });
    m.target = s.pn;
    m.state = 2; // MS.chase
    m.aggroUntil = game.now() + 1e9;
    m.lastNearAt = game.now() + 1e9;
    s.moonRun.monster = m;
    const r = RARITIES[sp.rarity];
    game.send(s, 'moonRound', { round: k, monster: m.id, species: sp.id, rarity: sp.rarity });
    game.toast(s, `Round ${k + 1}: ${r.name} ${sp.name} appears! Defeat it!`, 'warn');
    this.push(s);
  }

  // A challenge monster was defeated (called from Recruitment.onDefeated).
  onDefeated(m) {
    const game = this.game;
    const s = game.byProfile.get(m.challengeFor);
    m.removeAt = game.now() + 1600;
    if (!s || !s.moonRun || s.moonRun.monster !== m) return;
    const run = s.moonRun;
    run.monster = null;
    const plat = this.def.platforms[run.round];
    run.checkpoint = { x: plat.x, y: plat.top, z: plat.z };
    run.round++;
    if (run.round < this.def.rounds.length) {
      const next = RARITIES[this.def.rounds[run.round]].name;
      game.toast(s, `Round ${run.round} won! Now jump on to the next platform for round ${run.round + 1}: a ${next} monster.`, 'good');
      this.push(s);
      return;
    }
    this.win(s);
  }

  win(s) {
    const game = this.game;
    const prof = s.profile;
    const run = s.moonRun;
    run.wonAt = game.now();
    const sp = SPECIES_BY_ID[this.def.secretSpecies];
    if (!prof.moon.won) {
      prof.moon.won = true;
      const owned = newOwnedMonster(sp.id, 10, 'gift', game.now());
      prof.monsters.push(owned);
      game.ledger.set(owned.id, prof.id, owned.species, owned.level);
      game.recruitment.discover(s, sp.id);
      game.bases.checkMilestones(s);
      game.refreshPerks(s);
      game.send(s, 'moonWin', { species: sp.id, owned: owned.id, first: true });
      game.toast(s, `🌕 You won all four rounds! The secret ${sp.name} joins your base!`, 'good');
      game.broadcast('announce', { text: `${prof.name} solved the moon secret of Cute Monster Island and got the Secret ${sp.name}!`, kind: 'rare' });
    } else {
      game.economy.credit(s, REPLAY_REWARD.money, 'moon');
      game.economy.creditGems(s, REPLAY_REWARD.gems, 'moon');
      game.send(s, 'moonWin', { species: sp.id, first: false, money: REPLAY_REWARD.money, gems: REPLAY_REWARD.gems });
      game.toast(s, `🌕 Arena cleared again! +${REPLAY_REWARD.money} Money, +${REPLAY_REWARD.gems} Gems`, 'good');
    }
    game.markProfile(s);
    game.saveNow(s);
    this.push(s);
  }

  sendBack(s, reason) {
    const r = this.def.returnTo;
    this.endRun(s);
    this.game.teleport(s, r.x, r.y, r.z, reason === 'won' ? 'moon_win' : 'moon');
  }

  endRun(s) {
    const run = s.moonRun;
    if (!run) return;
    s.moonRun = null;
    if (run.monster && this.game.monsters.list.has(run.monster.id)) this.game.monsters.remove(run.monster, 'vanish');
    this.push(s);
  }

  onLeave(s) {
    this.endRun(s);
  }

  tick(dt, now) {
    for (const s of this.game.players.values()) {
      const run = s.moonRun;
      if (!run) continue;
      if (s.region !== ARENA.id && !s.dead) {
        // left through H, a respawn, ... : the run is over
        this.endRun(s);
        continue;
      }
      if (run.wonAt && now - run.wonAt > LEAVE_AFTER_WIN_MS) this.sendBack(s, 'won');
    }
    // defeated challenge monsters fade away (they are never recruited)
    for (const m of this.game.monsters.list.values()) {
      if (m.challengeFor && m.removeAt && now > m.removeAt) this.game.monsters.remove(m, 'vanish');
    }
  }
}

