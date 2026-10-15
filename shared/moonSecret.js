// The secret of Cute Monster Island:
//   1. find the five small moon buttons hidden on the island and step on
//      them (each one turns blue: 1/5, 2/5 ...),
//   2. a portal appears out of nowhere (an arrow points the way),
//   3. it leads to the Moon Sky Arena: floating platforms with four battle
//      platforms in a row: an Uncommon, a Rare, an Epic and a Legendary
//      monster, one per round,
//   4. win all four rounds and the Secret monster joins you.
// This file holds the shared layout; the rules live in server/services/moonSecret.js.

import { ISLAND_BY_ID, islandPoint } from './islands.js';

const CUTE = ISLAND_BY_ID.cute;

export const MOON = {
  buttonRadius: 1.6,           // how close you must step
  buttons: [
    islandPoint(CUTE, 62, 78),
    islandPoint(CUTE, -38, 104),
    islandPoint(CUTE, -112, -18),
    islandPoint(CUTE, 18, -112),
    islandPoint(CUTE, 96, -64),
  ].map((p, id) => ({ id, ...p })),
  portal: { ...islandPoint(CUTE, 28, 34), r: 3.2 },
  // where you land when you come back
  returnTo: islandPoint(CUTE, 36, 40),
  secretSpecies: 'cute_lunamochi',
  rounds: ['uncommon', 'rare', 'epic', 'legendary'],
  roundLevels: [4, 5, 6, 7],
  fallY: 3,                    // below this in the arena you are caught and sent back
};

// The Moon Sky Arena is its own little region far out at sea (see regions.js).
export const ARENA = { id: 'moonsky', cx: 0, cz: 1700, r: 120 };

const A = (u, v) => ({ x: ARENA.cx + u, z: ARENA.cz + v });

// Battle platforms (round 1..4) and the start platform. top = walking height.
export const ARENA_START = { ...A(0, 72), half: 6, top: 6 };
export const ARENA_PLATFORMS = [
  { round: 0, ...A(0, 26), half: 9, top: 10 },
  { round: 1, ...A(-36, -8), half: 9, top: 13 },
  { round: 2, ...A(4, -44), half: 9, top: 16 },
  { round: 3, ...A(42, -12), half: 11, top: 19 },
];

// Stepping stones between two platforms: about one jump apart, rising evenly.
function stones(from, to, n, seed) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const wobble = Math.sin((i + seed) * 1.7) * 3.2;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    out.push({
      x: from.x + dx * t + (-dz / len) * wobble,
      z: from.z + dz * t + (dx / len) * wobble,
      half: 2.2,
      top: from.top + (to.top - from.top) * t,
    });
  }
  return out;
}

export const ARENA_STONES = [
  ...stones(ARENA_START, ARENA_PLATFORMS[0], 5, 0),
  ...stones(ARENA_PLATFORMS[0], ARENA_PLATFORMS[1], 5, 2),
  ...stones(ARENA_PLATFORMS[1], ARENA_PLATFORMS[2], 5, 4),
  ...stones(ARENA_PLATFORMS[2], ARENA_PLATFORMS[3], 6, 6),
];

export function arenaRegionDef() {
  return {
    id: ARENA.id,
    name: 'Moon Sky Arena',
    blurb: 'Floating platforms under a giant moon. Only the moon buttons open the way.',
    shape: { kind: 'island', cx: ARENA.cx, cz: ARENA.cz, r: ARENA.r },
    levels: [4, 8],
    unlock: {},
    minPopulation: 0,
    arena: true,
    terrain: { style: 'void', base: -14 },
    colors: { low: 0x2a2a6a, high: 0x3a3a8a, cliff: 0x1a1a4a, path: 0x9a8aff, accent: 0xb8a0ff },
    fog: { color: 0x3a3a8a, near: 90, far: 300 },
    props: [],
    music: 'stars',
  };
}

// Walkable boxes for world.js: { x, z, half, top }.
export function arenaSurfaces() {
  return [ARENA_START, ...ARENA_PLATFORMS, ...ARENA_STONES];
}

// Which battle platform (index) is under (x, z), or -1.
export function arenaPlatformAt(x, z) {
  for (let i = 0; i < ARENA_PLATFORMS.length; i++) {
    const p = ARENA_PLATFORMS[i];
    if (Math.abs(x - p.x) <= p.half && Math.abs(z - p.z) <= p.half) return i;
  }
  return -1;
}
