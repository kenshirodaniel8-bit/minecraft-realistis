// The regions of the world.
//
// The main continent is laid out in rings around the starter hub:
//   r <  150         Greenstarter Plains (hub, shops, player bases)
//   150 <= r < 320   four beginner/intermediate regions, one per quarter
//   320 <= r < 470   four advanced regions behind them
//   470 <= r < 600   the Legendary Wilderness, all the way around
// Expansion islands sit off the coast and are reached through portals in the
// plaza. They only open when enough players are online (minPopulation).
//
// Angles are measured with atan2(z, x) in degrees, 0..360.

import { islandRegions } from './islands.js';

export const RING = {
  hub: 150,
  inner: 320,
  outer: 470,
  edge: 600,
};

export const REGIONS = [
  {
    id: 'plains',
    name: 'Greenstarter Plains',
    blurb: 'Rolling meadows where young monsters nap in the sun.',
    shape: { kind: 'disc', r: RING.hub },
    levels: [1, 4],
    unlock: {},
    minPopulation: 0,
    terrain: { style: 'hills', base: 3, amp: 3.2, freq: 1 / 85 },
    colors: { low: 0x6cc24a, high: 0x8fd65a, cliff: 0x9a7b4f, path: 0xd8b878, accent: 0xffe27a },
    fog: { color: 0xbfe6ff, near: 120, far: 330 },
    props: [['tree_round', 60], ['bush', 70], ['flowers', 140], ['rock', 30], ['fence', 0]],
    music: 'meadow',
  },
  {
    id: 'jungle',
    name: 'Deep Jungle',
    blurb: 'Giant trees, hidden clearings and territorial creatures.',
    shape: { kind: 'sector', r1: RING.hub, r2: RING.inner, a0: 45, a1: 135 },
    levels: [3, 9],
    unlock: { level: 3 },
    minPopulation: 0,
    terrain: { style: 'jungle', base: 4, amp: 6.5, freq: 1 / 55 },
    colors: { low: 0x2f8f3a, high: 0x46a842, cliff: 0x6b5233, path: 0x9b7a4a, accent: 0xff7ab8 },
    fog: { color: 0x9fd8a8, near: 60, far: 220 },
    props: [['jungle_tree', 120], ['bush', 160], ['fern', 200], ['rock', 40], ['flowers', 60]],
    music: 'jungle',
  },
  {
    id: 'desert',
    name: 'Scorching Desert',
    blurb: 'Sun-baked dunes, ancient ruins and a sealed underground chamber.',
    shape: { kind: 'sector', r1: RING.hub, r2: RING.inner, a0: 135, a1: 225 },
    levels: [4, 10],
    unlock: { level: 4 },
    minPopulation: 0,
    terrain: { style: 'dunes', base: 3, amp: 7, freq: 1 / 70 },
    colors: { low: 0xf0cf7c, high: 0xf7dd96, cliff: 0xc98f4e, path: 0xd8a860, accent: 0xff9d3a },
    fog: { color: 0xffe6b0, near: 110, far: 320 },
    props: [['cactus', 90], ['desert_rock', 60], ['ruin_pillar', 18], ['bones', 20]],
    music: 'desert',
  },
  {
    id: 'frozen',
    name: 'Frozen Highlands',
    blurb: 'Snowy peaks, a frozen lake and frosty little paws.',
    shape: { kind: 'sector', r1: RING.hub, r2: RING.inner, a0: 225, a1: 315 },
    levels: [6, 12],
    unlock: { level: 6 },
    minPopulation: 0,
    terrain: { style: 'mountains', base: 6, amp: 22, freq: 1 / 105 },
    colors: { low: 0xe8f4ff, high: 0xffffff, cliff: 0x9fb4c8, path: 0xc9dced, accent: 0x7fd8ff },
    fog: { color: 0xdcefff, near: 80, far: 260 },
    props: [['pine_snow', 110], ['ice_spike', 45], ['snow_rock', 40]],
    music: 'frost',
  },
  {
    id: 'ocean',
    name: 'Sunken Ocean',
    blurb: 'Sandbars, palm islands and bubbly sea monsters.',
    shape: { kind: 'sector', r1: RING.hub, r2: RING.inner, a0: 315, a1: 45 },
    levels: [5, 11],
    unlock: { level: 5 },
    minPopulation: 0,
    terrain: { style: 'ocean', base: -6, amp: 9, freq: 1 / 60 },
    colors: { low: 0xf3e2a6, high: 0x8ed46b, cliff: 0xd9c38a, path: 0xf3e2a6, accent: 0x4fd6ff },
    fog: { color: 0xb5ecff, near: 110, far: 330 },
    props: [['palm', 70], ['coral', 90], ['shell_rock', 30]],
    music: 'ocean',
  },
  {
    id: 'shadow',
    name: 'Shadow Forest',
    blurb: 'Glowing mushrooms, twisted trees and creatures of the night.',
    shape: { kind: 'sector', r1: RING.inner, r2: RING.outer, a0: 45, a1: 135 },
    levels: [9, 16],
    unlock: { level: 9 },
    minPopulation: 0,
    terrain: { style: 'hills', base: 4, amp: 5, freq: 1 / 60 },
    colors: { low: 0x3a3358, high: 0x4d4475, cliff: 0x2b2440, path: 0x5b4d7a, accent: 0x9dff6a },
    fog: { color: 0x2c2645, near: 30, far: 170 },
    props: [['dark_tree', 120], ['glow_mushroom', 110], ['rock', 30]],
    music: 'shadow',
  },
  {
    id: 'ruins',
    name: 'Ancient Ruins',
    blurb: 'Crumbling temples, pressure plates and a sleeping guardian.',
    shape: { kind: 'sector', r1: RING.inner, r2: RING.outer, a0: 135, a1: 225 },
    levels: [11, 18],
    unlock: { level: 11 },
    minPopulation: 0,
    terrain: { style: 'terraces', base: 5, amp: 6, freq: 1 / 70 },
    colors: { low: 0xa9a06f, high: 0xc2b98a, cliff: 0x8a8070, path: 0xd8cfae, accent: 0x5fe3c0 },
    fog: { color: 0xe6e0c8, near: 90, far: 280 },
    props: [['ruin_pillar', 70], ['ruin_wall', 50], ['bush', 50], ['rock', 30]],
    music: 'ruins',
  },
  {
    id: 'crystal',
    name: 'Crystal Mountains',
    blurb: 'Glittering cliffs, climbing routes and rare gem creatures.',
    shape: { kind: 'sector', r1: RING.inner, r2: RING.outer, a0: 225, a1: 315 },
    levels: [12, 19],
    unlock: { level: 12 },
    minPopulation: 0,
    terrain: { style: 'crystal', base: 8, amp: 20, freq: 1 / 90 },
    colors: { low: 0x8d7bc4, high: 0xb7a6ef, cliff: 0x6a5a9a, path: 0xc7b8f2, accent: 0x7af7ff },
    fog: { color: 0xd7ccff, near: 80, far: 260 },
    props: [['crystal', 120], ['rock', 40]],
    music: 'crystal',
  },
  {
    id: 'volcanic',
    name: 'Volcanic Kingdom',
    blurb: 'Lava rivers, ash fields and fiery little troublemakers.',
    shape: { kind: 'sector', r1: RING.inner, r2: RING.outer, a0: 315, a1: 45 },
    levels: [14, 21],
    unlock: { level: 14 },
    minPopulation: 0,
    terrain: { style: 'volcanic', base: 5, amp: 8, freq: 1 / 65 },
    colors: { low: 0x3b3236, high: 0x564a4c, cliff: 0x2a2224, path: 0x6d5a52, accent: 0xff6a1f },
    fog: { color: 0x5a3a33, near: 50, far: 210 },
    props: [['lava_rock', 80], ['obsidian', 50], ['dead_tree', 30]],
    music: 'volcano',
  },
  {
    id: 'legendary',
    name: 'Legendary Wilderness',
    blurb: 'Golden plains at the edge of the world where legends roam.',
    shape: { kind: 'ring', r1: RING.outer, r2: RING.edge },
    levels: [20, 30],
    unlock: { level: 20, swordTier: 6 },
    minPopulation: 0,
    terrain: { style: 'legendary', base: 6, amp: 10, freq: 1 / 80 },
    colors: { low: 0xd8c25a, high: 0xf0de7a, cliff: 0x9b8a5a, path: 0xfff1b0, accent: 0xff7af0 },
    fog: { color: 0xffe9c4, near: 100, far: 300 },
    props: [['golden_tree', 90], ['crystal', 30], ['rock', 40], ['flowers', 80]],
    music: 'legend',
  },
  // ---- expansion islands (open with server population) -------------------
  {
    id: 'bloomveil',
    name: 'Bloomveil Isle',
    blurb: 'A floating garden island that blooms when the server is lively.',
    shape: { kind: 'island', cx: 1000, cz: 0, r: 170 },
    levels: [6, 14],
    unlock: { level: 5 },
    minPopulation: 3,
    expansion: true,
    terrain: { style: 'island', base: 5, amp: 6, freq: 1 / 50 },
    colors: { low: 0x79d98a, high: 0xa4ef8a, cliff: 0xc98fbf, path: 0xffd1ec, accent: 0xff8fd0 },
    fog: { color: 0xffe0f4, near: 100, far: 300 },
    props: [['blossom_tree', 70], ['flowers', 160], ['bush', 50]],
    music: 'bloom',
  },
  {
    id: 'starfall',
    name: 'Starfall Isle',
    blurb: 'A night-sky island of fallen stars, open only on busy servers.',
    shape: { kind: 'island', cx: -1000, cz: 0, r: 170 },
    levels: [15, 25],
    unlock: { level: 15 },
    minPopulation: 6,
    expansion: true,
    terrain: { style: 'island', base: 6, amp: 9, freq: 1 / 45 },
    colors: { low: 0x2b3b7a, high: 0x4257a8, cliff: 0x1c2550, path: 0x8ea0ff, accent: 0xfff27a },
    fog: { color: 0x1d2350, near: 60, far: 240 },
    props: [['star_crystal', 80], ['crystal', 30], ['rock', 30]],
    music: 'stars',
  },
];

// the seven monster islands (islands.js), reached through the Island Gate
REGIONS.push(...islandRegions());

export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
export const REGION_INDEX = Object.fromEntries(REGIONS.map((r, i) => [r.id, i]));

function angleDeg(x, z) {
  let a = (Math.atan2(z, x) * 180) / Math.PI;
  if (a < 0) a += 360;
  return a;
}

function inSector(a, a0, a1) {
  return a0 <= a1 ? a >= a0 && a < a1 : a >= a0 || a < a1;
}

// Returns the region id at a world position, or null outside the world.
export function regionIdAt(x, z) {
  for (const r of REGIONS) {
    if (r.shape.kind === 'island') {
      const dx = x - r.shape.cx;
      const dz = z - r.shape.cz;
      if (dx * dx + dz * dz < r.shape.r * r.shape.r) return r.id;
    }
  }
  const d = Math.sqrt(x * x + z * z);
  if (d < RING.hub) return 'plains';
  if (d >= RING.edge) return null;
  const a = angleDeg(x, z);
  if (d >= RING.outer) return 'legendary';
  const r1 = d < RING.inner ? RING.hub : RING.inner;
  for (const r of REGIONS) {
    if (r.shape.kind === 'sector' && r.shape.r1 === r1 && inSector(a, r.shape.a0, r.shape.a1)) return r.id;
  }
  return null;
}

export function regionAt(x, z) {
  const id = regionIdAt(x, z);
  return id ? REGION_BY_ID[id] : null;
}

// Center point of a region (used for the minimap labels and teleports).
export function regionCenter(region) {
  const s = region.shape;
  if (s.kind === 'disc') return { x: 0, z: 0 };
  if (s.kind === 'island') return { x: s.cx, z: s.cz };
  if (s.kind === 'ring') return { x: (s.r1 + s.r2) / 2, z: 0 };
  let a1 = s.a1;
  if (a1 < s.a0) a1 += 360;
  const a = (((s.a0 + a1) / 2) * Math.PI) / 180;
  const r = (s.r1 + s.r2) / 2;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

// What a player needs to enter a region. Returns null when allowed, otherwise
// a short human readable reason.
export function regionLockReason(region, player, activeRegionIds) {
  if (!region) return 'The edge of the world';
  if (activeRegionIds && !activeRegionIds.has(region.id)) {
    return `${region.name} opens when ${region.minPopulation}+ players are online`;
  }
  const u = region.unlock || {};
  if (u.level && (player.level || 1) < u.level) return `${region.name} requires Level ${u.level}`;
  if (u.swordTier && (player.swordTier || 0) < u.swordTier) return `${region.name} requires a Tier ${u.swordTier} sword`;
  return null;
}
