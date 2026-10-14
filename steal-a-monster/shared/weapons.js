// Sword tiers. All numbers are server-authoritative; the shop UI reads the
// same table so players see exactly what they buy.
//
// cooldownMs: minimum time between swings
// range:      reach in front of the player (edge of the monster)
// arc:        swing cone in degrees
// maxTargets: monsters hit by one swing
// special:    optional on-hit effect handled in server/services/combat.js
// gems:       Monster Gems needed on top of the Money price (top tiers)

export const SWORDS = [
  {
    id: 'wooden', tier: 1, name: 'Wooden Sword', price: 0, damage: 10, cooldownMs: 520, range: 3.2, arc: 110, maxTargets: 1,
    unlock: {}, colors: { blade: 0xc8955a, edge: 0xe8b77a, guard: 0x7a4a24, grip: 0x5a3416 }, length: 2.3,
    description: 'Every adventure starts with a stick. A nicely shaped stick.',
  },
  {
    id: 'stone', tier: 2, name: 'Stone Sword', price: 800, damage: 16, cooldownMs: 520, range: 3.3, arc: 110, maxTargets: 1,
    unlock: { level: 2 }, colors: { blade: 0x9a9a9a, edge: 0xc8c8c8, guard: 0x6a6a6a, grip: 0x5a3416 }, length: 2.4,
    description: 'Heavier and sharper. Mostly heavier.',
  },
  {
    id: 'iron', tier: 3, name: 'Iron Sword', price: 2500, damage: 25, cooldownMs: 500, range: 3.4, arc: 115, maxTargets: 2,
    unlock: { level: 4 }, colors: { blade: 0xdfe6ee, edge: 0xffffff, guard: 0x7a8a9a, grip: 0x3a2a1a }, length: 2.6,
    description: 'A trusty blade that can hit two monsters at once.',
  },
  {
    id: 'steel', tier: 4, name: 'Steel Sword', price: 6000, damage: 38, cooldownMs: 480, range: 3.5, arc: 115, maxTargets: 2,
    unlock: { level: 7 }, colors: { blade: 0xb8c8e0, edge: 0xeaf2ff, guard: 0x3a4a6a, grip: 0x2a1a2a }, length: 2.7,
    description: 'Polished steel with a balanced swing. Crits a little more often.',
    special: { kind: 'crit', chance: 0.06 },
  },
  {
    id: 'flame', tier: 5, name: 'Flame Sword', price: 15000, damage: 55, cooldownMs: 480, range: 3.6, arc: 120, maxTargets: 2,
    unlock: { level: 10 }, colors: { blade: 0xff7a2a, edge: 0xffe23a, guard: 0x8a2a1a, grip: 0x2a1a1a, glow: 0xff8a2a }, length: 2.8,
    description: 'Sets monsters on fire for a few seconds of extra damage.',
    special: { kind: 'burn', dps: 0.25, durationMs: 3000 },
  },
  {
    id: 'thunder', tier: 6, name: 'Thunder Sword', price: 35000, damage: 75, cooldownMs: 460, range: 3.7, arc: 120, maxTargets: 3,
    unlock: { level: 13 }, colors: { blade: 0xfff27a, edge: 0xffffff, guard: 0x3a3f8f, grip: 0x1a1a3a, glow: 0xfff27a }, length: 2.9,
    description: 'Lightning jumps to one more nearby monster on every hit.',
    special: { kind: 'chain', range: 7, share: 0.5 },
  },
  {
    id: 'crystal', tier: 7, name: 'Crystal Sword', price: 70000, gems: 3, damage: 100, cooldownMs: 450, range: 3.8, arc: 125, maxTargets: 3,
    unlock: { level: 16, discovered: 'crystal' }, colors: { blade: 0x8ff0ff, edge: 0xe8ffff, guard: 0xc28fff, grip: 0x3a2a5a, glow: 0x8ff0ff }, length: 3.0,
    description: 'Razor-sharp crystal. Big crit chance. Requires discovering the Crystal Mountains.',
    special: { kind: 'crit', chance: 0.2 },
  },
  {
    id: 'shadow', tier: 8, name: 'Shadow Sword', price: 140000, gems: 8, damage: 135, cooldownMs: 440, range: 3.9, arc: 125, maxTargets: 3,
    unlock: { level: 19, discovered: 'shadow' }, colors: { blade: 0x5a3a9a, edge: 0xb48cff, guard: 0x1a1030, grip: 0x0a0510, glow: 0x9a6bff }, length: 3.1,
    description: 'Drinks a little of every hit to heal you.',
    special: { kind: 'lifesteal', share: 0.06 },
  },
  {
    id: 'dragon', tier: 9, name: 'Dragon Sword', price: 280000, gems: 15, damage: 180, cooldownMs: 430, range: 4.1, arc: 140, maxTargets: 4,
    unlock: { level: 23, discovered: 'volcanic' }, colors: { blade: 0xd83a1f, edge: 0xffc25a, guard: 0x2a1a1a, grip: 0x5a1a10, glow: 0xff6a1f }, length: 3.3,
    description: 'A huge sweeping blade that knocks monsters back.',
    special: { kind: 'cleave', knockback: 6 },
  },
  {
    id: 'celestial', tier: 10, name: 'Celestial Sword', price: 600000, gems: 40, damage: 250, cooldownMs: 420, range: 4.3, arc: 145, maxTargets: 5,
    unlock: { level: 27, discovered: 'legendary' }, colors: { blade: 0xfff7d8, edge: 0xffffff, guard: 0xffc23a, grip: 0x8a7aff, glow: 0xfff7a8 }, length: 3.5,
    description: 'Forged from starlight. Heals you on hit and crits often.',
    special: { kind: 'celestial', crit: 0.15, heal: 0.03 },
  },
];

export const SWORD_BY_ID = Object.fromEntries(SWORDS.map((s) => [s.id, s]));

// Returns null if the player may buy/equip the sword, else a reason.
export function swordLockReason(sword, player) {
  const u = sword.unlock || {};
  if (u.level && (player.level || 1) < u.level) return `Requires Level ${u.level}`;
  if (u.discovered && !(player.regionsVisited || []).includes(u.discovered)) return `Discover the ${regionNameHint(u.discovered)} first`;
  return null;
}

function regionNameHint(id) {
  return {
    crystal: 'Crystal Mountains', shadow: 'Shadow Forest', volcanic: 'Volcanic Kingdom', legendary: 'Legendary Wilderness',
  }[id] || id;
}

export function swordDps(sword) {
  return Math.round((sword.damage / (sword.cooldownMs / 1000)) * 10) / 10;
}
