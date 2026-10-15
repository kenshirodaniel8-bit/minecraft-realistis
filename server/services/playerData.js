// Player profiles: creation, schema migration, sanitizing loaded data,
// levels, perks, and the ownership ledger that keeps monster ownership
// consistent across crashes.

import { CONFIG, SAVE_SCHEMA_VERSION, xpForLevel, maxHpForLevel } from '#shared/config.js';
import { SPECIES_BY_ID, PERKS, perkValue, incomePerSecond } from '#shared/monsters.js';
import { SWORD_BY_ID } from '#shared/weapons.js';
import { ITEM_BY_ID } from '#shared/items.js';
import { COSMETIC_BY_ID } from '#shared/lucky.js';
import { DECOR_BY_ID, DECOR_SPOTS, DECOR_MAX_OWNED } from '#shared/decor.js';
import { REGION_BY_ID } from '#shared/regions.js';
import { MOON } from '#shared/moonSecret.js';
import { COSTUME_BY_ID, POWER_UPGRADE, LEGEND_POWERS } from '#shared/costumes.js';
import { GUARDS } from '#shared/guards.js';
import { randomId } from '#shared/rng.js';
import { sha256Hex } from '#shared/sha256.js';

// The client keeps a random secret token; the profile id is derived from it so
// nobody can load someone else's profile without their token.
export function profileIdFromToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  return 'p_' + sha256Hex('steal-a-monster:' + token).slice(0, 32);
}

export function newProfile(id, name, now) {
  const items = {};
  for (const [k, v] of Object.entries(CONFIG.startingItems)) items[k] = v;
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    id,
    name,
    color: null,
    createdAt: now,
    lastSeen: now,
    money: CONFIG.startingMoney, // granted exactly once, here
    gems: 0,
    xp: 0,
    level: 1,
    sword: CONFIG.startingSword,
    swords: [CONFIG.startingSword],
    items,
    monsters: [],
    base: { slots: CONFIG.startingSlots, laserLevel: 0, guardLevel: 0, decor: new Array(DECOR_SPOTS).fill(null) },
    decor: { owned: {} },
    storedIncome: 0,
    discoveries: { species: {}, spots: {} },
    regionsVisited: ['plains'],
    tutorial: { step: 0, done: false },
    moon: { found: [], won: false }, // the moon buttons of Cute Monster Island
    costumes: { owned: [], equipped: null, power: null }, // power: the Legend Master's chosen power
    powerLevel: 0,                    // "Upgrade your power" levels (+130 each)
    cosmetics: { owned: [], equipped: null },
    coupons: { recruitDiscount: 0 },
    stats: { defeated: 0, recruited: 0, stolen: 0, lost: 0, luckyOpened: 0, deaths: 0 },
    milestones: {},
  };
}

// Upgrade older save files to the current schema.
const MIGRATIONS = {
  // 0 -> 1: early prototype saves had no schemaVersion and no ledger fields
  0: (p) => {
    p.schemaVersion = 1;
    p.discoveries = p.discoveries || { species: {}, spots: {} };
    p.coupons = p.coupons || { recruitDiscount: 0 };
    return p;
  },
  // 1 -> 2: Monster Gems and base decorations
  1: (p) => {
    p.schemaVersion = 2;
    p.gems = 0;
    p.decor = { owned: {} };
    p.base = { ...(p.base || {}), decor: new Array(DECOR_SPOTS).fill(null) };
    return p;
  },
};

export function migrateProfile(p) {
  let v = Number.isInteger(p.schemaVersion) ? p.schemaVersion : 0;
  while (v < SAVE_SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`no migration from schema ${v}`);
    p = m(p);
    v = p.schemaVersion;
  }
  if (v > SAVE_SCHEMA_VERSION) throw new Error(`profile schema ${v} is newer than this server (${SAVE_SCHEMA_VERSION})`);
  return p;
}

const num = (v, d, lo = 0, hi = 1e12) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
// timestamps (ms since 1970): never later than "now" (today's clock is
// already above num()'s default 1e12 limit, which would turn every save into
// "last seen in 2001")
const time = (v, now = Date.now()) => num(v, now, 0, now);

// Repairs anything inconsistent in a loaded profile instead of trusting it.
export function sanitizeProfile(p, id, now = Date.now()) {
  const out = newProfile(id, typeof p.name === 'string' ? p.name.slice(0, 16) : 'Player', time(p.createdAt, now));
  out.money = Math.floor(num(p.money, 0, 0, CONFIG.economy.maxMoney));
  out.gems = Math.floor(num(p.gems, 0, 0, CONFIG.gems.max));
  out.createdAt = time(p.createdAt, now);
  out.lastSeen = time(p.lastSeen, now);
  out.xp = Math.floor(num(p.xp, 0));
  out.level = Math.floor(num(p.level, 1, 1, CONFIG.progression.maxLevel));
  out.color = Number.isInteger(p.color) ? p.color & 0xffffff : null;
  out.swords = Array.isArray(p.swords) ? [...new Set(p.swords.filter((s) => SWORD_BY_ID[s]))] : [CONFIG.startingSword];
  if (!out.swords.includes(CONFIG.startingSword)) out.swords.unshift(CONFIG.startingSword);
  out.sword = out.swords.includes(p.sword) ? p.sword : out.swords[0];
  out.items = {};
  if (p.items && typeof p.items === 'object') {
    for (const [k, v] of Object.entries(p.items)) {
      const def = ITEM_BY_ID[k];
      if (def) {
        const n = Math.floor(num(v, 0, 0, def.maxStack));
        if (n > 0) out.items[k] = n;
      }
    }
  }
  const b = p.base || {};
  out.base = {
    slots: Math.floor(num(b.slots, CONFIG.startingSlots, CONFIG.startingSlots, CONFIG.bases.maxSlots)),
    laserLevel: Math.floor(num(b.laserLevel, 0, 0, CONFIG.security.lockDurationsSec.length - 1)),
    guardLevel: Math.floor(num(b.guardLevel, 0, 0, GUARDS.maxLevel)),
    decor: new Array(DECOR_SPOTS).fill(null),
  };
  // decorations: known ids, bounded counts, never more placed than owned
  out.decor = { owned: {} };
  for (const [k, v] of Object.entries(p.decor?.owned || {})) {
    const n = Math.floor(num(v, 0, 0, DECOR_MAX_OWNED));
    if (DECOR_BY_ID[k] && n > 0) out.decor.owned[k] = n;
  }
  const placed = {};
  (Array.isArray(b.decor) ? b.decor : []).slice(0, DECOR_SPOTS).forEach((id, i) => {
    if (!DECOR_BY_ID[id] || (placed[id] || 0) >= (out.decor.owned[id] || 0)) return;
    placed[id] = (placed[id] || 0) + 1;
    out.base.decor[i] = id;
  });
  out.storedIncome = num(p.storedIncome, 0);
  // monsters: valid species, unique ids, unique slots within capacity
  const seen = new Set();
  const usedSlots = new Set();
  out.monsters = [];
  for (const m of Array.isArray(p.monsters) ? p.monsters : []) {
    if (!m || typeof m.id !== 'string' || seen.has(m.id) || !SPECIES_BY_ID[m.species]) continue;
    seen.add(m.id);
    let slot = Number.isInteger(m.slot) && m.slot >= 0 && m.slot < out.base.slots && !usedSlots.has(m.slot) ? m.slot : null;
    if (slot !== null) usedSlots.add(slot);
    out.monsters.push({
      id: m.id,
      species: m.species,
      level: Math.floor(num(m.level, 1, 1, 60)),
      obtainedAt: time(m.obtainedAt, now),
      origin: ['recruited', 'stolen', 'event', 'gift', 'returned'].includes(m.origin) ? m.origin : 'recruited',
      slot,
      following: !!m.following,
      team: !!m.team,
      stolenFrom: typeof m.stolenFrom === 'string' ? m.stolenFrom.slice(0, 16) : undefined,
      // who it was stolen from (for the admin's "return to owner")
      stolenFromId: typeof m.stolenFromId === 'string' ? m.stolenFromId.slice(0, 40) : undefined,
      stolenFromAccount: typeof m.stolenFromAccount === 'string' ? m.stolenFromAccount.slice(0, 128) : undefined,
    });
  }
  // at most five companions (monsters that walk with you; never on a pad)
  let followers = 0;
  for (const m of out.monsters) {
    if (m.following && m.slot === null && followers < 5) followers++;
    else m.following = false;
    if (!m.following) m.team = false;
  }
  const d = p.discoveries || {};
  out.discoveries = {
    species: d.species && typeof d.species === 'object' ? Object.fromEntries(Object.entries(d.species).filter(([k]) => SPECIES_BY_ID[k])) : {},
    spots: d.spots && typeof d.spots === 'object' ? { ...d.spots } : {},
  };
  out.regionsVisited = Array.isArray(p.regionsVisited) ? [...new Set(p.regionsVisited.filter((r) => REGION_BY_ID[r]))] : ['plains'];
  if (!out.regionsVisited.includes('plains')) out.regionsVisited.unshift('plains');
  out.tutorial = { step: Math.floor(num(p.tutorial?.step, 0, 0, 20)), done: !!p.tutorial?.done };
  const found = Array.isArray(p.moon?.found) ? p.moon.found.filter((i) => Number.isInteger(i) && i >= 0 && i < MOON.buttons.length) : [];
  out.moon = { found: [...new Set(found)], won: !!p.moon?.won };
  const costumes = Array.isArray(p.costumes?.owned) ? [...new Set(p.costumes.owned.filter((c) => COSTUME_BY_ID[c]))] : [];
  out.costumes = { owned: costumes, equipped: costumes.includes(p.costumes?.equipped) ? p.costumes.equipped : null, power: LEGEND_POWERS[p.costumes?.power] ? p.costumes.power : null };
  out.powerLevel = Math.floor(num(p.powerLevel, 0, 0, POWER_UPGRADE.maxLevel));
  const owned = Array.isArray(p.cosmetics?.owned) ? p.cosmetics.owned.filter((c) => COSMETIC_BY_ID[c]) : [];
  out.cosmetics = { owned: [...new Set(owned)], equipped: owned.includes(p.cosmetics?.equipped) ? p.cosmetics.equipped : null };
  out.coupons = { recruitDiscount: num(p.coupons?.recruitDiscount, 0, 0, 0.5) };
  out.stats = { ...out.stats };
  for (const k of Object.keys(out.stats)) out.stats[k] = Math.floor(num(p.stats?.[k], 0));
  out.milestones = p.milestones && typeof p.milestones === 'object' ? { ...p.milestones } : {};
  if (typeof p.account === 'string' && p.account) out.account = p.account.slice(0, 128);
  // level must match xp
  out.level = levelForXp(out.xp);
  return out;
}

export function levelForXp(xp) {
  let level = 1;
  let need = 0;
  while (level < CONFIG.progression.maxLevel) {
    need += xpForLevel(level);
    if (xp < need) break;
    level++;
  }
  return level;
}

export function xpProgress(xp) {
  let level = 1;
  let floor = 0;
  while (level < CONFIG.progression.maxLevel) {
    const need = xpForLevel(level);
    if (xp < floor + need) return { level, into: xp - floor, need };
    floor += need;
    level++;
  }
  return { level, into: 0, need: 0 };
}

// Perks from monsters placed in the base, with caps.
export function computePerks(profile) {
  const perks = {};
  for (const k of Object.keys(PERKS)) perks[k] = 0;
  let income = 0;
  for (const m of profile.monsters) {
    if (m.slot === null || m.slot === undefined) continue;
    const sp = SPECIES_BY_ID[m.species];
    perks[sp.perk.kind] += perkValue(sp, m.level);
    income += incomePerSecond(sp, m.level);
  }
  for (const k of Object.keys(PERKS)) perks[k] = Math.min(PERKS[k].cap, Math.round(perks[k] * 1000) / 1000);
  return { perks, baseIncome: income, income: Math.round(income * (1 + perks.income) * 10) / 10 };
}

export function playerMaxHp(profile, perks) {
  return Math.round(maxHpForLevel(profile.level) * (1 + (perks?.hp || 0)));
}

// ---------------------------------------------------------------------------
// Ownership ledger: monsterId -> { owner, species, level }.
// It is written BEFORE profiles whenever ownership changes, so after a crash
// a profile's stale copy of a transferred monster is dropped and a missing
// one is restored.

export class OwnershipLedger {
  constructor(store, log) {
    this.store = store;
    this.log = log;
    this.map = new Map();
    this.dirty = false;
    this.loaded = false;
  }

  async load() {
    const data = await this.store.loadLedger();
    for (const [k, v] of Object.entries(data || {})) {
      if (v && typeof v.owner === 'string' && SPECIES_BY_ID[v.species]) this.map.set(k, { owner: v.owner, species: v.species, level: v.level | 0 || 1 });
    }
    this.loaded = true;
  }

  owner(monsterId) {
    return this.map.get(monsterId)?.owner ?? null;
  }

  set(monsterId, owner, species, level) {
    this.map.set(monsterId, { owner, species, level });
    this.dirty = true;
  }

  remove(monsterId) {
    if (this.map.delete(monsterId)) this.dirty = true;
  }

  async save() {
    this.dirty = false;
    await this.store.saveLedger(Object.fromEntries(this.map));
  }

  // Starting over: the player's monsters are let go.
  removeOwner(owner) {
    for (const [mid, e] of [...this.map]) {
      if (e.owner === owner) {
        this.map.delete(mid);
        this.dirty = true;
      }
    }
  }

  // An online account's profile is the truth (it may have changed in other
  // rooms): the ledger takes its monsters as they are and forgets the old
  // entries for this owner.
  adopt(profile) {
    const ids = new Set(profile.monsters.map((m) => m.id));
    for (const [mid, e] of [...this.map]) {
      if (e.owner === profile.id && !ids.has(mid)) this.map.delete(mid);
    }
    for (const m of profile.monsters) this.map.set(m.id, { owner: profile.id, species: m.species, level: m.level });
    this.dirty = true;
  }

  // Makes a freshly loaded profile agree with the ledger.
  reconcile(profile) {
    const fixes = [];
    const ids = new Set();
    profile.monsters = profile.monsters.filter((m) => {
      const owner = this.owner(m.id);
      if (owner === null) {
        this.set(m.id, profile.id, m.species, m.level);
        fixes.push(`claimed ${m.id}`);
      } else if (owner !== profile.id) {
        fixes.push(`dropped ${m.id} (owned by ${owner})`);
        return false;
      }
      ids.add(m.id);
      return true;
    });
    for (const [mid, e] of this.map) {
      if (e.owner === profile.id && !ids.has(mid)) {
        profile.monsters.push({ id: mid, species: e.species, level: e.level, obtainedAt: Date.now(), origin: 'recruited', slot: null, following: false });
        fixes.push(`restored ${mid}`);
      }
    }
    return fixes;
  }
}

// The profile id of an account (the same in every room and on every device).
export function accountProfileId(account) {
  return 'p_' + sha256Hex('steal-a-monster-account:' + account).slice(0, 32);
}

export function newOwnedMonster(speciesId, level, origin, now, extra = {}) {
  return { id: randomId('m', 12), species: speciesId, level, obtainedAt: now, origin, slot: null, following: false, ...extra };
}
