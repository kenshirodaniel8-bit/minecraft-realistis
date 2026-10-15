// The authoritative game simulation. Transport-agnostic: server/network.js
// connects it to Socket.IO, and tests drive it directly.
//
//   const game = new Game({ store });
//   await game.init();
//   const res = await game.join(sid, helloPayload, { send(event, data) {}, disconnect() {} });
//   game.handle(sid, 'move', {...});
//   game.tick(50);
//   game.leave(sid);

import { CONFIG, PROTOCOL_VERSION } from '#shared/config.js';
import { buildWorld, isInsideBase, WATER_Y } from '#shared/world.js';
import { REGION_BY_ID, regionIdAt, regionLockReason } from '#shared/regions.js';
import { SWORD_BY_ID, SWORD_INDEX } from '#shared/weapons.js';
import { SPECIES_INDEX } from '#shared/monsters.js';
import { COSMETIC_INDEX } from '#shared/lucky.js';
import { isObj, finite, int, sanitizeName, sanitizeText, color as isColor, fail } from './validate.js';
import { nameKey, isAdminName } from '#shared/names.js';
import { RateLimiter } from './rateLimit.js';
import {
  profileIdFromToken, accountProfileId, newProfile, migrateProfile, sanitizeProfile, computePerks, playerMaxHp,
  OwnershipLedger, xpProgress, levelForXp,
} from './services/playerData.js';
import { Economy } from './services/economy.js';
import { Combat } from './services/combat.js';
import { MonsterManager } from './services/monsterAI.js';
import { Recruitment } from './services/recruitment.js';
import { BaseManager } from './services/bases.js';
import { Security } from './services/security.js';
import { Stealing } from './services/stealing.js';
import { ItemSystem } from './services/items.js';
import { LuckyBlocks } from './services/luckyBlocks.js';
import { EventManager } from './services/events.js';
import { WorldExpansion } from './services/worldExpansion.js';
import { Puzzles } from './services/puzzles.js';
import { MoonSecret } from './services/moonSecret.js';
import { Companions } from './services/companions.js';
import { CostumeShop } from './services/costumes.js';
import { Admin } from './services/admin.js';
import { GuardSystem } from './services/guards.js';

export { fail };

export const EFFECT = {
  frozen: 1, rooted: 2, slowed: 4, shield: 8, speed: 16, dodge: 32, protected: 64, burning: 128,
  stunned: 256, slipping: 512, radar: 1024, dead: 2048, thief: 4096,
};

class Session {
  constructor(sid, pn, profile, transport, now) {
    this.sid = sid;
    this.pn = pn;                    // small public player number used in snapshots
    this.id = profile.id;
    this.profile = profile;
    this.name = profile.name;
    this.transport = transport;
    this.joinedAt = now;
    this.pos = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.anim = 0;
    this.lastMoveAt = now;
    this.teleportSeq = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.dead = false;
    this.respawnAt = 0;
    this.protectUntil = now + CONFIG.player.spawnProtectionMs;
    this.lastDamagedAt = 0;
    this.dodgeUntil = 0;
    this.dodgeReadyAt = 0;
    this.lastAttackAt = 0;
    this.combo = { count: 0, at: 0 };
    this.baseIndex = -1;
    this.carrying = null;
    this.stealPending = null;
    this.fx = { frozenUntil: 0, rootedUntil: 0, slowUntil: 0, slowFactor: 1, shieldUntil: 0, speedUntil: 0, speedMult: 1, slipUntil: 0, radarUntil: 0, burnUntil: 0, burnDps: 0, stunUntil: 0 };
    this.itemReadyAt = {};
    this.homeReadyAt = 0;
    this.knockbackUntil = 0;
    this.region = 'plains';
    this.spotsInside = new Set();
    this.inBases = new Set();
    this.recent = new Map();         // request id -> result (idempotency)
    this.profileDirty = true;
    this.saveDirty = false;
    this.violations = 0;
    this.perks = null;
    this.income = 0;
    this.lastLava = 0;
    this.lastCollectAt = 0;
  }

  remember(reqId, result) {
    if (typeof reqId !== 'string') return result;
    this.recent.set(reqId, result);
    if (this.recent.size > 64) this.recent.delete(this.recent.keys().next().value);
    return result;
  }

  recall(reqId) {
    return typeof reqId === 'string' ? this.recent.get(reqId) : undefined;
  }
}

export class Game {
  constructor(opts = {}) {
    this.store = opts.store;
    this.now = opts.now || (() => Date.now());
    this.rng = opts.rng || Math.random;
    this.log = opts.log || ((...a) => console.log('[game]', ...a));
    this.devCommands = !!opts.devCommands;
    this.world = buildWorld();
    this.players = new Map();            // sid -> Session
    this.byProfile = new Map();          // profile id -> Session
    this.profileCache = new Map();       // profile id -> profile (online + recently offline)
    this.joining = new Map();            // profile id -> Promise
    this.pnFree = [];
    this.pnNext = 1;
    this.ledger = new OwnershipLedger(this.store, this.log);
    this.tickCount = 0;
    this.time = 0;
    this.dayEpoch = this.now();
    this.lastSaveAt = this.now();
    this.saveFailures = 0;
    this.saving = new Map(); // profile id -> the save of it still running

    this.economy = new Economy(this);
    this.combat = new Combat(this);
    this.monsters = new MonsterManager(this);
    this.recruitment = new Recruitment(this);
    this.bases = new BaseManager(this);
    this.security = new Security(this);
    this.stealing = new Stealing(this);
    this.items = new ItemSystem(this);
    this.lucky = new LuckyBlocks(this);
    this.events = new EventManager(this);
    this.expansion = new WorldExpansion(this, opts.expansionThresholds);
    this.puzzles = new Puzzles(this);
    this.moonSecret = new MoonSecret(this);
    this.companions = new Companions(this);
    this.costumes = new CostumeShop(this);
    this.admin = new Admin(this);
    this.guards = new GuardSystem(this);
    this.accounts = opts.accounts || null;     // server/accounts.js (Node server only)
    this.accountSaver = opts.accountSaver || null; // saves online accounts (browser rooms)
    this.bans = new Map();                     // profile id -> ban
    this.pendingReturns = new Map();           // monster id -> admin return waiting for its owner

    this.handlers = {
      move: (s, p) => this.handleMove(s, p),
      attack: (s, p) => this.combat.handleAttack(s, p),
      dodge: (s, p) => this.combat.handleDodge(s, p),
      recruit: (s, p) => this.recruitment.handleRecruit(s, p),
      decline: (s, p) => this.recruitment.handleDecline(s, p),
      place: (s, p) => this.bases.handlePlace(s, p),
      unplace: (s, p) => this.bases.handleUnplace(s, p),
      follow: (s, p) => this.bases.handleFollow(s, p),
      callAllies: (s) => this.companions.handleCall(s),
      buyCostume: (s, p) => this.costumes.handleBuy(s, p),
      equipCostume: (s, p) => this.costumes.handleEquip(s, p),
      buyPower: (s, p) => this.costumes.handleBuyPower(s, p),
      power: (s, p) => this.costumes.handlePower(s, p),
      choosePower: (s, p) => this.costumes.handleChoosePower(s, p),
      buyGuards: (s, p) => this.bases.handleBuyGuards(s, p),
      adminPlayers: (s) => this.admin.handlePlayers(s),
      adminReturn: (s, p) => this.admin.handleReturn(s, p),
      adminBan: (s, p) => this.admin.handleBan(s, p),
      release: (s, p) => this.bases.handleRelease(s, p),
      collect: (s) => this.bases.handleCollect(s),
      buyDecor: (s, p) => this.bases.handleBuyDecor(s, p),
      placeDecor: (s, p) => this.bases.handlePlaceDecor(s, p),
      buySword: (s, p) => this.economy.handleBuySword(s, p),
      equipSword: (s, p) => this.economy.handleEquipSword(s, p),
      buyItem: (s, p) => this.economy.handleBuyItem(s, p),
      buyUpgrade: (s, p) => this.economy.handleBuyUpgrade(s, p),
      travel: (s, p) => this.economy.handleTravel(s, p),
      useItem: (s, p) => this.items.handleUse(s, p),
      lock: (s) => this.security.handleLock(s),
      home: (s) => this.bases.handleHome(s),
      stealBegin: (s, p) => this.stealing.handleBegin(s, p),
      stealConfirm: (s, p) => this.stealing.handleConfirm(s, p),
      stealCancel: (s) => this.stealing.handleCancel(s),
      grabDropped: (s, p) => this.stealing.handleGrabDropped(s, p),
      claimLucky: (s, p) => this.lucky.handleClaim(s, p),
      chat: (s, p) => this.handleChat(s, p),
      equipCosmetic: (s, p) => this.handleEquipCosmetic(s, p),
      setColor: (s, p) => this.handleSetColor(s, p),
      tutorial: (s, p) => this.handleTutorial(s, p),
      ping: () => ({ ok: true, t: this.now() }),
    };
  }

  async init() {
    await this.ledger.load();
    if (this.store.loadBans) {
      for (const b of Object.values((await this.store.loadBans()) || {})) if (b && b.id) this.bans.set(b.id, b);
    }
    if (this.accounts) await this.accounts.load();
    this.events.init();
    this.expansion.update(true);
  }

  // ---------------------------------------------------------------- sessions

  // trusted: an identity the caller has already checked (an online
  // account signed in with Firebase, see client/rooms.js and localNet.js):
  //   { account, name, profile (saved progress or null), external: true }
  // Without it, hello.account logs in to an account of this server
  // (server/accounts.js), or hello.token alone plays without an account.
  async join(sid, hello, transport, trusted = null) {
    if (!isObj(hello)) return fail('bad_hello', 'Invalid hello');
    if (hello.protocol !== PROTOCOL_VERSION) return fail('protocol', 'The game was updated. Please refresh the page.');
    if (this.players.has(sid)) return fail('already_joined');
    let ident = trusted;
    if (!ident && isObj(hello.account)) {
      if (!this.accounts) return fail('no_accounts', 'This server has no accounts.');
      const r = await this.accounts.verify(hello.account, hello.token);
      if (!r.ok) return r;
      ident = r.ident;
    }
    const pid = ident ? ident.pid || accountProfileId(ident.account) : profileIdFromToken(hello.token);
    if (!pid) return fail('bad_token', 'Invalid player token');
    const name = ident ? ident.name : sanitizeName(hello.name) || 'Player';
    // names are unique: account names belong to their account
    if (!ident && this.accounts?.taken(name)) return fail('name_taken', `"${name}" is the name of an account. Log in, or choose another name.`);
    if (this.isBanned(pid)) return fail('banned', 'You are banned from this server.');
    if (this.joining.has(pid)) {
      try { await this.joining.get(pid); } catch { /* ignore */ }
    }
    const existing = this.byProfile.get(pid);
    if (existing) this.kick(existing, 'You joined from another window.');
    if (this.players.size >= CONFIG.maxPlayers) return fail('full', 'The server is full (12 players). Try again soon.');

    let loaded;
    const p = this.loadOrCreate(pid, name, ident, hello.fresh === true);
    this.joining.set(pid, p);
    try {
      loaded = await p;
    } catch (e) {
      this.log('profile load failed', pid, e.message);
      return fail('load_failed', 'Your saved progress could not be loaded, so you were not logged in (nothing was overwritten). Please try again later.');
    } finally {
      this.joining.delete(pid);
    }
    if (transport.closed) return fail('gone');
    if (this.players.size >= CONFIG.maxPlayers) return fail('full', 'The server is full.');
    for (const o of this.players.values()) {
      if (o.id !== pid && nameKey(o.profile.name) === nameKey(name)) {
        return fail('name_taken', `Someone here is already called "${o.profile.name}". Choose another name.`);
      }
    }
    const { profile, isNew } = loaded;
    if (!isNew && name && name !== profile.name) profile.name = name;
    if (ident) profile.account = ident.account;
    this.applyPendingReturns(profile);
    if (isColor(hello.color)) profile.color = hello.color;

    const baseIndex = this.bases.assign(pid);
    if (baseIndex < 0) return fail('full', 'No free base plot.');
    const pn = this.pnFree.length ? this.pnFree.pop() : this.pnNext++;
    const now = this.now();
    const s = new Session(sid, pn, profile, transport, now);
    s.account = ident ? ident.account : null;
    s.admin = !!ident && isAdminName(ident.name); // the account named "daniel"
    s.baseIndex = baseIndex;
    this.players.set(sid, s);
    this.byProfile.set(pid, s);
    this.profileCache.set(pid, profile);
    this.refreshPerks(s);
    s.hp = s.maxHp;
    const base = this.world.bases[baseIndex];
    s.pos = { x: base.spawn.x, y: base.y, z: base.spawn.z };
    s.yaw = base.yaw;
    s.inBases.add(baseIndex);
    // passive income earned while offline (reduced rate, capped)
    if (!isNew) this.bases.applyOfflineIncome(s, now);
    profile.lastSeen = now;
    this.markSave(s);

    const welcome = {
      ok: true,
      pn,
      isNew,
      serverTime: now,
      dayEpoch: this.dayEpoch,
      dayLength: CONFIG.dayLengthMs,
      profile: this.clientProfile(s),
      admin: s.admin,
      remember: ident?.remember || null,
      pos: { ...s.pos, yaw: s.yaw },
      teleportSeq: s.teleportSeq,
      baseIndex,
      players: [...this.players.values()].map((o) => this.playerInfo(o)),
      bases: this.bases.allStates(),
      world: this.expansion.state(),
      event: this.events.state(),
      lucky: this.lucky.list(),
      puzzle: this.puzzles.state(),
      moon: this.moonSecret.state(s),
      dropped: this.stealing.droppedList(),
      traps: this.items.groundList(),
    };
    this.broadcast('playerJoined', this.playerInfo(s), s);
    this.bases.broadcastBase(baseIndex);
    this.expansion.update();
    this.log(`${profile.name} joined (${isNew ? 'new profile' : 'returning'}) -> base ${baseIndex + 1}, ${this.players.size} online`);
    return welcome;
  }

  async loadOrCreate(pid, name, ident = null, fresh = false) {
    const now = this.now();
    // starting over: a brand-new profile (the old monsters are let go)
    if (fresh) {
      this.profileCache.delete(pid);
      this.ledger.removeOwner(pid);
      const profile = newProfile(pid, name, now);
      if (ident) profile.account = ident.account;
      this.profileCache.set(pid, profile);
      if (!ident?.external) await this.store.saveProfile(pid, profile);
      return { profile, isNew: true };
    }
    const cached = this.profileCache.get(pid);
    if (cached) return { profile: cached, isNew: false };
    // an online account brings its own saved progress (from any room)
    if (ident?.external) {
      const profile = ident.profile ? sanitizeProfile(migrateProfile(ident.profile), pid, now) : newProfile(pid, name, now);
      profile.account = ident.account;
      this.ledger.adopt(profile);
      this.profileCache.set(pid, profile);
      return { profile, isNew: !ident.profile };
    }
    const raw = await this.store.loadProfile(pid);
    if (raw === null) {
      const profile = newProfile(pid, name, this.now());
      this.profileCache.set(pid, profile);
      await this.store.saveProfile(pid, profile);
      return { profile, isNew: true };
    }
    const profile = sanitizeProfile(migrateProfile(raw), pid, this.now());
    const fixes = this.ledger.reconcile(profile);
    if (fixes.length) {
      this.log(`ownership reconciled for ${pid}:`, fixes.join(', '));
      await this.ledger.save();
    }
    this.profileCache.set(pid, profile);
    return { profile, isNew: false };
  }

  leave(sid) {
    const s = this.players.get(sid);
    if (!s) return;
    this.stealing.onLeave(s);
    this.recruitment.onLeave(s);
    this.items.onLeave(s);
    this.moonSecret.onLeave(s);
    this.companions.onLeave(s);
    this.players.delete(sid);
    if (this.byProfile.get(s.id) === s) this.byProfile.delete(s.id);
    this.bases.release(s.baseIndex);
    this.pnFree.push(s.pn);
    s.profile.lastSeen = this.now();
    const profile = s.profile;
    this.saveProfile(profile).finally(() => {
      if (!this.byProfile.has(profile.id)) this.profileCache.delete(profile.id);
    });
    this.broadcast('playerLeft', { pn: s.pn });
    this.bases.broadcastBase(s.baseIndex);
    this.expansion.update();
    this.log(`${s.name} left, ${this.players.size} online`);
  }

  kick(s, reason) {
    try { this.send(s, 'kicked', { reason }); } catch { /* ignore */ }
    this.leave(s.sid);
    try { s.transport.disconnect?.(reason); } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- messages

  handle(sid, type, payload) {
    const s = this.players.get(sid);
    if (!s) return fail('not_joined');
    const h = this.handlers[type];
    if (!h) return fail('unknown');
    if (!s.rate) s.rate = new RateLimiter(CONFIG.rateLimits, this.now);
    if (!s.rate.allow(type)) return fail('rate_limited', 'Slow down!');
    try {
      return h(s, payload) || { ok: true };
    } catch (e) {
      this.log('handler error', type, e.stack || e);
      return fail('error', 'Something went wrong');
    }
  }

  send(s, event, data) {
    s.transport.send(event, data);
  }

  sendVolatile(s, event, data) {
    (s.transport.sendVolatile || s.transport.send)(event, data);
  }

  broadcast(event, data, except) {
    for (const s of this.players.values()) if (s !== except) s.transport.send(event, data);
  }

  broadcastNear(x, z, radius, event, data, except) {
    const r2 = radius * radius;
    for (const s of this.players.values()) {
      if (s === except) continue;
      const dx = s.pos.x - x;
      const dz = s.pos.z - z;
      if (dx * dx + dz * dz <= r2) s.transport.send(event, data);
    }
  }

  toast(s, text, kind = 'info') {
    this.send(s, 'toast', { text, kind });
  }

  // ---------------------------------------------------------------- movement

  maxSpeed(s) {
    let v = CONFIG.player.sprintSpeed * (1 + (s.perks?.speed || 0));
    const t = this.now();
    if (s.fx.speedUntil > t) v *= s.fx.speedMult;
    return v;
  }

  handleMove(s, p) {
    if (!isObj(p) || !finite(p.x) || !finite(p.y) || !finite(p.z) || !finite(p.yaw, -100, 100)) return fail('bad_move');
    if (p.tp !== s.teleportSeq) return { ok: true, stale: true }; // sent before our last teleport
    const now = this.now();
    if (s.dead) return { ok: true, dead: true };
    s.yaw = p.yaw;
    s.anim = int(p.a, 0, 31) ? p.a : 0;
    const frozen = s.fx.frozenUntil > now || s.fx.rootedUntil > now;
    const dt = Math.min(CONFIG.movement.maxUpdateGapMs, now - s.lastMoveAt) / 1000;
    const dx = p.x - s.pos.x;
    const dz = p.z - s.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    let allowed = this.maxSpeed(s) * CONFIG.movement.speedTolerance * dt + CONFIG.movement.slackUnits;
    if (s.knockbackUntil > now) allowed += 30;
    if (s.dodgeUntil + 400 > now) allowed += CONFIG.player.dodgeDistance;
    if (frozen) allowed = 0.6;
    if (dist > allowed) return this.correct(s, 'speed');

    const nx = p.x;
    const nz = p.z;
    // regions: locked or closed areas can't be entered
    const regionId = regionIdAt(nx, nz);
    const region = regionId ? REGION_BY_ID[regionId] : null;
    if (!region) return this.correct(s, 'edge');
    if (regionId !== s.region) {
      const reason = regionLockReason(region, this.playerProgress(s), this.expansion.active);
      if (reason) return this.correct(s, 'locked', reason);
    }
    // base lasers: rivals can't walk into a locked base
    for (const b of this.world.bases) {
      const inside = isInsideBase(b, nx, nz);
      if (inside && !s.inBases.has(b.index)) {
        if (!this.security.mayEnter(s, b.index)) return this.correct(s, 'lasers', 'Security lasers are on!');
      }
    }
    if (!this.puzzles.mayMove(s, nx, nz)) return this.correct(s, 'sealed', 'The vault door is sealed.');
    // walls: the client stays out of them on its own, so a move through one
    // (for example into a base tower anywhere but its door) is refused
    if (this.world.colliders.segmentBlocked(s.pos.x, s.pos.z, nx, nz, 0.3, p.y + 0.6, p.y + CONFIG.player.height - 0.6)) {
      return this.correct(s, 'wall');
    }

    // ground, or the base floor / stair tread under the player
    const ground = this.world.surfaceHeight(nx, nz, p.y);
    let y = p.y;
    if (y < ground - 3 && y < WATER_Y - 3) y = Math.max(ground, WATER_Y - 2);
    if (y < ground - 3) y = ground;
    if (y > Math.max(ground, WATER_Y) + CONFIG.movement.maxHeightAboveGround) return this.correct(s, 'fly');

    s.pos.x = nx;
    s.pos.y = y;
    s.pos.z = nz;
    s.lastMoveAt = now;
    this.afterMove(s, regionId);
    return null; // no ack needed
  }

  correct(s, why, message) {
    s.violations++;
    s.teleportSeq++;
    this.send(s, 'teleport', { x: s.pos.x, y: s.pos.y, z: s.pos.z, seq: s.teleportSeq, reason: why, message });
    return { ok: false, error: why, message };
  }

  teleport(s, x, y, z, reason, yaw) {
    // others nearby see you vanish here and appear there
    const from = { x: s.pos.x, z: s.pos.z };
    const r1 = (v) => Math.round(v * 10) / 10;
    const ev = { pn: s.pn, x: r1(x), y: r1(y), z: r1(z), fx: r1(from.x), fz: r1(from.z) };
    this.broadcastNear(from.x, from.z, 120, 'ptp', ev, s);
    if ((x - from.x) ** 2 + (z - from.z) ** 2 > 240 * 240) this.broadcastNear(x, z, 120, 'ptp', ev, s);
    s.teleportSeq++;
    s.pos = { x, y, z };
    s.lastMoveAt = this.now();
    if (yaw !== undefined) s.yaw = yaw;
    this.send(s, 'teleport', { x, y, z, yaw, seq: s.teleportSeq, reason });
    this.afterMove(s, regionIdAt(x, z));
  }

  afterMove(s, regionId) {
    if (regionId && regionId !== s.region) {
      s.region = regionId;
      if (!s.profile.regionsVisited.includes(regionId)) {
        s.profile.regionsVisited.push(regionId);
        this.markProfile(s);
        this.send(s, 'discovery', { kind: 'region', id: regionId, name: REGION_BY_ID[regionId].name });
      }
    }
    // spots (landmarks and hidden places)
    for (const spot of this.world.spots) {
      const dx = s.pos.x - spot.x;
      const dz = s.pos.z - spot.z;
      const inside = dx * dx + dz * dz < (spot.r + 4) * (spot.r + 4);
      if (inside && !s.profile.discoveries.spots[spot.id]) {
        s.profile.discoveries.spots[spot.id] = this.now();
        this.economy.credit(s, spot.reward, 'discovery');
        this.send(s, 'discovery', { kind: 'spot', id: spot.id, name: spot.name, reward: spot.reward, hidden: !!spot.hidden });
        this.markProfile(s);
      }
    }
    // bases: entering/leaving
    for (const b of this.world.bases) {
      const inside = isInsideBase(b, s.pos.x, s.pos.z);
      if (inside && !s.inBases.has(b.index)) {
        s.inBases.add(b.index);
        if (b.index === s.baseIndex) this.bases.onEnterOwnBase(s);
      } else if (!inside && s.inBases.has(b.index)) {
        s.inBases.delete(b.index);
      }
    }
    if (s.carrying && s.inBases.has(s.baseIndex)) this.stealing.completeTheft(s);
    this.bases.checkPads(s);
    this.puzzles.checkPlates(s);
    this.moonSecret.afterMove(s);
    this.items.checkGround(s);
    this.economy.checkPortals(s);
  }

  // ---------------------------------------------------------------- admin

  isBanned(pid) {
    return this.bans.has(pid);
  }

  addBan(ban) {
    this.bans.set(ban.id, ban);
    if (this.store.saveBans) {
      this.store.saveBans(Object.fromEntries(this.bans)).catch((e) => this.log('ban save failed', e.message));
    }
  }

  // An admin return for an owner who is not in the server right now. A
  // profile saved by this server gets it at once; an online account gets
  // it through the admin's browser (sam/returns, see client/accounts.js).
  async deliverLater(d) {
    if (!d.profileId) return;
    const cached = this.profileCache.get(d.profileId);
    if (cached?.account && this.accountSaver) return;
    this.pendingReturns.set(d.monster.id, d);
    try {
      let profile = cached;
      if (!profile) {
        const raw = await this.store.loadProfile(d.profileId);
        if (!raw) return;
        profile = sanitizeProfile(migrateProfile(raw), d.profileId, this.now());
      }
      if (this.byProfile.has(d.profileId)) return; // they came back meanwhile (applied at join)
      if (this.applyPendingReturns(profile)) await this.saveProfile(profile);
    } catch (e) {
      this.log('return delivery failed', e.message);
    }
  }

  applyPendingReturns(profile) {
    let n = 0;
    for (const [mid, d] of [...this.pendingReturns]) {
      if (d.profileId !== profile.id) continue;
      this.pendingReturns.delete(mid);
      if (profile.monsters.some((m) => m.id === mid)) continue;
      profile.monsters.push({ ...d.monster, slot: null, following: false });
      this.ledger.set(mid, profile.id, d.monster.species, d.monster.level);
      n++;
    }
    return n;
  }

  playerProgress(s) {
    const sw = SWORD_BY_ID[s.profile.sword];
    return { level: s.profile.level, swordTier: Math.max(...s.profile.swords.map((id) => SWORD_BY_ID[id]?.tier || 1), sw?.tier || 1) };
  }

  // ---------------------------------------------------------------- profiles

  refreshPerks(s) {
    const { perks, income } = computePerks(s.profile);
    s.perks = perks;
    s.income = income;
    const oldMax = s.maxHp;
    s.maxHp = playerMaxHp(s.profile, perks);
    if (s.maxHp !== oldMax && oldMax > 0) s.hp = Math.min(s.maxHp, Math.round(s.hp * (s.maxHp / oldMax)));
  }

  addXp(s, amount) {
    const p = s.profile;
    const gain = Math.round(amount * (1 + (s.perks?.xp || 0)));
    p.xp += gain;
    const newLevel = levelForXp(p.xp);
    if (newLevel > p.level) {
      p.level = newLevel;
      this.refreshPerks(s);
      s.hp = s.maxHp;
      this.send(s, 'levelUp', { level: newLevel });
      this.broadcast('playerInfo', this.playerInfo(s));
    }
    this.markProfile(s);
    return gain;
  }

  markProfile(s) {
    s.profileDirty = true;
    s.saveDirty = true;
  }

  markSave(s) {
    s.saveDirty = true;
  }

  // Saves of one profile run one after another (they write the same file and
  // its backup), and flushSaves()/shutdown() can wait for every save that is
  // still running, including the one started when a player leaves.
  saveProfile(profile) {
    const prev = this.saving.get(profile.id) || Promise.resolve();
    const job = prev.then(() => this.writeProfile(profile));
    this.saving.set(profile.id, job);
    job.finally(() => {
      if (this.saving.get(profile.id) === job) this.saving.delete(profile.id);
    });
    return job;
  }

  async writeProfile(profile) {
    try {
      // online accounts are saved to the account (by its owner's browser)
      if (profile.account && this.accountSaver) await this.accountSaver(profile);
      else await this.store.saveProfile(profile.id, profile);
      return true;
    } catch (e) {
      this.saveFailures++;
      this.log('SAVE FAILED for', profile.id, e.message);
      const s = this.byProfile.get(profile.id);
      if (s) s.saveDirty = true; // retry on the next save cycle
      return false;
    }
  }

  // Immediately persist (used after money/ownership transactions).
  async saveNow(...sessionsOrProfiles) {
    const jobs = [];
    if (this.ledger.dirty) jobs.push(this.ledger.save().catch((e) => this.log('LEDGER SAVE FAILED', e.message)));
    for (const x of sessionsOrProfiles) {
      if (!x) continue;
      const profile = x.profile || x;
      const s = this.byProfile.get(profile.id);
      if (s) s.saveDirty = false;
      jobs.push(this.saveProfile(profile));
    }
    return Promise.all(jobs);
  }

  clientProfile(s) {
    const p = s.profile;
    const prog = xpProgress(p.xp);
    return {
      name: p.name,
      color: p.color,
      money: Math.floor(p.money),
      gems: p.gems,
      decor: p.decor,
      xp: p.xp,
      level: p.level,
      xpInto: prog.into,
      xpNeed: prog.need,
      sword: p.sword,
      swords: p.swords,
      items: p.items,
      monsters: p.monsters,
      base: p.base,
      storedIncome: Math.floor(p.storedIncome),
      income: s.income,
      perks: s.perks,
      maxHp: s.maxHp,
      discoveries: p.discoveries,
      regionsVisited: p.regionsVisited,
      tutorial: p.tutorial,
      moon: p.moon,
      costumes: p.costumes,
      powerLevel: p.powerLevel,
      powerReadyAt: s.powerReadyAt || 0,
      cosmetics: p.cosmetics,
      coupons: p.coupons,
      stats: p.stats,
      homeReadyAt: s.homeReadyAt,
      itemReadyAt: s.itemReadyAt,
    };
  }

  playerInfo(s) {
    return {
      pn: s.pn,
      name: s.profile.name,
      color: s.profile.color,
      level: s.profile.level,
      baseIndex: s.baseIndex,
      cosmetic: s.profile.cosmetics.equipped,
      costume: s.profile.costumes.equipped,
      costumePower: s.profile.costumes.power || null,
      sword: s.profile.sword,
      admin: !!s.admin,
    };
  }

  // ---------------------------------------------------------------- misc handlers

  handleChat(s, p) {
    if (!isObj(p)) return fail('bad');
    const text = sanitizeText(p.text, 160);
    if (!text) return fail('empty');
    if (text.startsWith('/')) return this.devCommand(s, text);
    this.broadcast('chat', { pn: s.pn, name: s.profile.name, text });
    return { ok: true };
  }

  devCommand(s, text) {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    if (cmd === 'help') {
      this.toast(s, this.devCommands ? 'Dev commands: /lucky, /money N, /level N, /night, /day, /spawn species, /tp X Z' : 'No commands on this server.');
      return { ok: true };
    }
    if (!this.devCommands) return fail('no_commands', 'Commands are disabled on this server.');
    if (cmd === 'lucky') this.events.trigger('luckyLucky');
    else if (cmd === 'money') this.economy.credit(s, Math.min(1e7, Math.max(0, Number(args[0]) || 0)), 'dev');
    else if (cmd === 'level') {
      const target = Math.max(1, Math.min(CONFIG.progression.maxLevel, Number(args[0]) | 0));
      while (s.profile.level < target) this.addXp(s, 1e5);
    } else if (cmd === 'night') this.dayEpoch = this.now() - CONFIG.dayLengthMs * 0.75;
    else if (cmd === 'day') this.dayEpoch = this.now() - CONFIG.dayLengthMs * 0.2;
    else if (cmd === 'spawn') this.monsters.devSpawn(s, args[0]);
    else if (cmd === 'tp') {
      const x = Number(args[0]);
      const z = Number(args[1]);
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1200 || Math.abs(z) > 1200) return fail('bad');
      this.teleport(s, x, this.world.groundHeight(x, z), z, 'dev');
    } else return fail('unknown_command');
    if (cmd === 'night' || cmd === 'day') this.broadcast('time', { dayEpoch: this.dayEpoch });
    this.markProfile(s);
    return { ok: true };
  }

  handleEquipCosmetic(s, p) {
    if (!isObj(p)) return fail('bad');
    const id = p.id === null ? null : p.id;
    if (id !== null && !s.profile.cosmetics.owned.includes(id)) return fail('not_owned');
    s.profile.cosmetics.equipped = id;
    this.markProfile(s);
    this.broadcast('playerInfo', this.playerInfo(s));
    return { ok: true };
  }

  handleSetColor(s, p) {
    if (!isObj(p) || !isColor(p.color)) return fail('bad');
    s.profile.color = p.color;
    this.markProfile(s);
    this.broadcast('playerInfo', this.playerInfo(s));
    this.bases.broadcastBase(s.baseIndex);
    return { ok: true };
  }

  handleTutorial(s, p) {
    if (isObj(p) && p.skip) {
      s.profile.tutorial.done = true;
      this.markProfile(s);
    }
    return { ok: true };
  }

  // Called by services when the player did something the tutorial teaches.
  tutorialEvent(s, what) {
    const t = s.profile.tutorial;
    if (t.done) return;
    const steps = ['explore', 'defeat', 'recruit', 'place', 'collect', 'lock', 'sword'];
    const want = steps[t.step];
    if (what === want) {
      t.step++;
      if (t.step >= steps.length) {
        t.done = true;
        this.economy.credit(s, 300, 'tutorial');
        this.toast(s, 'Tutorial complete! +300 Money. Go explore and collect them all!', 'good');
      }
      this.markProfile(s);
    }
  }

  isNight() {
    const t = (((this.now() - this.dayEpoch) % CONFIG.dayLengthMs) + CONFIG.dayLengthMs) % CONFIG.dayLengthMs / CONFIG.dayLengthMs;
    return t >= 0.68 && t < 0.97;
  }

  // ---------------------------------------------------------------- loop

  tick(dtMs = 1000 / CONFIG.tickRate) {
    const now = this.now();
    this.tickCount++;
    this.time += dtMs;
    const dt = dtMs / 1000;
    this.monsters.tick(dt, now);
    this.companions.tick(dt, now);
    this.guards.tick(dt, now);
    this.combat.tick(dt, now);
    this.items.tick(dt, now);
    this.stealing.tick(dt, now);
    this.bases.tick(dt, now);
    this.security.tick(dt, now);
    this.recruitment.tick(dt, now);
    this.lucky.tick(dt, now);
    this.events.tick(dt, now);
    this.expansion.tick(dt, now);
    this.puzzles.tick(dt, now);
    this.moonSecret.tick(dt, now);
    for (const s of this.players.values()) {
      if (s.profile.tutorial.step === 0 && !s.inBases.has(s.baseIndex) && Math.hypot(s.pos.x, s.pos.z) > 45) {
        this.tutorialEvent(s, 'explore');
      }
    }
    const every = Math.max(1, Math.round(CONFIG.tickRate / CONFIG.snapshotRate));
    if (this.tickCount % every === 0) this.sendSnapshots(now);
    for (const s of this.players.values()) {
      if (s.profileDirty) {
        s.profileDirty = false;
        this.send(s, 'profile', this.clientProfile(s));
      }
    }
    if (now - this.lastSaveAt > 5000) {
      this.lastSaveAt = now;
      this.flushSaves();
    }
  }

  flushSaves() {
    const jobs = [];
    if (this.ledger.dirty) jobs.push(this.ledger.save().catch((e) => this.log('LEDGER SAVE FAILED', e.message)));
    for (const s of this.players.values()) {
      if (s.saveDirty) {
        s.saveDirty = false;
        s.profile.lastSeen = this.now();
        jobs.push(this.saveProfile(s.profile));
      }
    }
    // and the saves still running (e.g. of players who just left)
    jobs.push(...this.saving.values());
    return Promise.all(jobs);
  }

  async shutdown() {
    for (const s of [...this.players.values()]) {
      this.stealing.onLeave(s);
      s.profile.lastSeen = this.now();
    }
    const jobs = [...this.players.values()].map((s) => this.saveProfile(s.profile));
    jobs.push(this.ledger.save().catch(() => {}));
    jobs.push(...this.saving.values());
    await Promise.all(jobs);
  }

  effectBits(s, now) {
    let b = 0;
    const f = s.fx;
    if (f.frozenUntil > now) b |= EFFECT.frozen;
    if (f.rootedUntil > now) b |= EFFECT.rooted;
    if (f.slowUntil > now) b |= EFFECT.slowed;
    if (f.shieldUntil > now) b |= EFFECT.shield;
    if (f.speedUntil > now) b |= EFFECT.speed;
    if (s.dodgeUntil > now) b |= EFFECT.dodge;
    if (s.protectUntil > now) b |= EFFECT.protected;
    if (f.burnUntil > now) b |= EFFECT.burning;
    if (f.stunUntil > now) b |= EFFECT.stunned;
    if (f.slipUntil > now) b |= EFFECT.slipping;
    if (f.radarUntil > now) b |= EFFECT.radar;
    if (s.dead) b |= EFFECT.dead;
    if ((s.thiefUntil || 0) > now) b |= EFFECT.thief; // guards are after them
    return b;
  }

  sendSnapshots(now) {
    const r = (v) => Math.round(v * 100) / 100;
    const players = [];
    for (const s of this.players.values()) {
      players.push([
        s.pn, r(s.pos.x), r(s.pos.y), r(s.pos.z), r(s.yaw), s.anim,
        Math.round((100 * s.hp) / s.maxHp),
        SWORD_INDEX[s.profile.sword] ?? 0,
        s.carrying ? SPECIES_INDEX[s.carrying.species] : -1,
        this.effectBits(s, now),
        -1, // (was: the one follower; companions now come with the monsters)
        s.profile.level,
        s.profile.cosmetics.equipped ? COSMETIC_INDEX[s.profile.cosmetics.equipped] : -1,
        s.stealPending ? 1 : 0,
      ]);
    }
    for (const s of this.players.values()) {
      const m = this.companions.snapshotFor(s, this.monsters.snapshotFor(s), CONFIG.interestRadius);
      this.sendVolatile(s, 'snap', { t: now, p: players, m, g: this.guards.snapshotFor(s) });
    }
  }
}
