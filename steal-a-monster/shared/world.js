// Deterministic world layout shared by the server and the browser:
// terrain heights and colours, props (trees, rocks...), player bases, the hub
// plaza with its shops and portals, hidden spots and their structures, lava,
// and the collision shapes for all of it.
//
// buildWorld() is pure: the same seed always produces the same world, so the
// server can validate positions against exactly what the players see.

import { REGIONS, REGION_BY_ID, REGION_INDEX, RING, regionIdAt } from './regions.js';
import { fbm, ridged, hashString, rngFor, clamp, lerp, smoothstep } from './rng.js';
import { CONFIG, WORLD_SEED } from './config.js';
import { ColliderGrid, boxCollider, circleCollider } from './collision.js';

export const CELL = 4;          // terrain grid spacing
export const STEP_UP = 0.95; // highest ledge you can walk up without jumping
export const WATER_Y = 0;
export const VOID_Y = -14;      // sea floor beyond the edge of the world
export const PLAZA = { r: 38, y: 3.6 };
export const ROAD_ANGLES = [0, 90, 180, 270];
export const RING_PATH_R = 128;
export const BASE_RING_R = 72; // path linking every base entrance

const DEG = Math.PI / 180;
const P = (angleDeg, r) => ({ x: Math.cos(angleDeg * DEG) * r, z: Math.sin(angleDeg * DEG) * r });

// ---------------------------------------------------------------------------
// Prop types: collision radius (scaled), minimum spacing and where they grow.

export const PROP_TYPES = {
  tree_round: { r: 1.1, spacing: 8, scale: [0.85, 1.4], place: 'land' },
  bush: { r: 0, spacing: 3, scale: [0.7, 1.3], place: 'land' },
  flowers: { r: 0, spacing: 2.5, scale: [0.8, 1.2], place: 'land' },
  rock: { r: 1.5, spacing: 6, scale: [0.6, 1.6], place: 'any' },
  fence: { r: 0, spacing: 4, scale: [1, 1], place: 'land' },
  jungle_tree: { r: 1.7, spacing: 10, scale: [0.9, 1.6], place: 'land' },
  fern: { r: 0, spacing: 2.5, scale: [0.8, 1.4], place: 'land' },
  cactus: { r: 0.8, spacing: 7, scale: [0.8, 1.5], place: 'land' },
  desert_rock: { r: 2.2, spacing: 9, scale: [0.7, 1.6], place: 'land' },
  ruin_pillar: { r: 1.3, spacing: 7, scale: [0.8, 1.4], place: 'land' },
  ruin_wall: { r: 2.2, spacing: 9, scale: [0.8, 1.3], place: 'land' },
  bones: { r: 0, spacing: 6, scale: [0.8, 1.3], place: 'land' },
  pine_snow: { r: 1.0, spacing: 7, scale: [0.8, 1.6], place: 'land' },
  ice_spike: { r: 1.1, spacing: 7, scale: [0.7, 1.7], place: 'land' },
  snow_rock: { r: 1.8, spacing: 7, scale: [0.7, 1.5], place: 'land' },
  palm: { r: 0.6, spacing: 7, scale: [0.8, 1.3], place: 'shore' },
  coral: { r: 0, spacing: 3, scale: [0.7, 1.6], place: 'under' },
  shell_rock: { r: 1.2, spacing: 6, scale: [0.7, 1.3], place: 'shore' },
  dark_tree: { r: 1.2, spacing: 8, scale: [0.9, 1.6], place: 'land' },
  glow_mushroom: { r: 0.5, spacing: 4, scale: [0.6, 1.8], place: 'land' },
  crystal: { r: 1.4, spacing: 7, scale: [0.6, 1.8], place: 'land' },
  lava_rock: { r: 1.6, spacing: 7, scale: [0.6, 1.5], place: 'land' },
  obsidian: { r: 1.2, spacing: 7, scale: [0.8, 1.8], place: 'land' },
  dead_tree: { r: 0.6, spacing: 8, scale: [0.8, 1.3], place: 'land' },
  golden_tree: { r: 1.3, spacing: 9, scale: [0.9, 1.5], place: 'land' },
  blossom_tree: { r: 1.2, spacing: 8, scale: [0.9, 1.4], place: 'land' },
  star_crystal: { r: 1.2, spacing: 7, scale: [0.6, 1.6], place: 'land' },
};

// ---------------------------------------------------------------------------
// Named spots: landmarks, hidden caves, lairs and secrets. Entering one for the
// first time counts as a discovery. Hidden monsters spawn at their spot.

export const SPOTS = [
  { id: 'elder_oak', name: 'The Elder Oak', region: 'plains', ...P(200, 126), r: 10, kind: 'landmark', reward: 50 },
  { id: 'draklet_hollow', name: 'Draklet Hollow', region: 'plains', ...P(300, 134), r: 9, kind: 'cave', hidden: true, reward: 150, door: 300 },
  { id: 'whisper_clearing', name: 'Whispering Clearing', region: 'jungle', ...P(112, 272), r: 15, kind: 'clearing', hidden: true, reward: 250, door: 90 },
  { id: 'croc_pond', name: 'Crumbite Pond', region: 'jungle', ...P(68, 215), r: 16, kind: 'pond', reward: 120 },
  { id: 'sunken_chamber', name: 'Sunken Chamber', region: 'desert', ...P(196, 282), r: 13, kind: 'chamber', hidden: true, reward: 400, door: 180 },
  { id: 'oasis', name: 'Mirage Oasis', region: 'desert', ...P(152, 210), r: 14, kind: 'pond', reward: 120 },
  { id: 'frost_lake', name: 'Frostglass Lake', region: 'frozen', ...P(252, 225), r: 30, kind: 'lake', reward: 150 },
  { id: 'yeti_cave', name: 'Yetibo Cave', region: 'frozen', ...P(292, 288), r: 10, kind: 'cave', hidden: true, reward: 400, door: 270 },
  { id: 'coral_cove', name: 'Coral Cove', region: 'ocean', ...P(18, 272), r: 18, kind: 'island', hidden: true, reward: 400 },
  { id: 'shipwreck', name: 'The Old Shipwreck', region: 'ocean', ...P(338, 215), r: 14, kind: 'landmark', reward: 150 },
  { id: 'moonlit_hollow', name: 'Moonlit Hollow', region: 'shadow', ...P(76, 418), r: 14, kind: 'clearing', hidden: true, reward: 700, door: 76 },
  { id: 'wisp_grove', name: 'Wisp Grove', region: 'shadow', ...P(118, 360), r: 12, kind: 'landmark', reward: 300 },
  { id: 'temple_vault', name: 'Temple of the Guardian', region: 'ruins', ...P(180, 398), r: 11, kind: 'temple', reward: 900 },
  { id: 'broken_arch', name: 'The Broken Arch', region: 'ruins', ...P(150, 352), r: 10, kind: 'landmark', reward: 300 },
  { id: 'geode_grotto', name: 'Geode Grotto', region: 'crystal', ...P(240, 410), r: 10, kind: 'cave', hidden: true, reward: 900, door: 240 },
  { id: 'prism_peak', name: 'Prism Peak', region: 'crystal', ...P(292, 384), r: 12, kind: 'landmark', reward: 400 },
  { id: 'volcano_crater', name: 'Heart of the Volcano', region: 'volcanic', ...P(2, 398), r: 15, kind: 'crater', reward: 1200 },
  { id: 'ember_falls', name: 'Ember Falls', region: 'volcanic', ...P(330, 350), r: 12, kind: 'landmark', reward: 400 },
  { id: 'celestial_altar', name: 'Celestial Altar', region: 'legendary', ...P(90, 540), r: 14, kind: 'altar', reward: 3000 },
  { id: 'wyrm_nest', name: 'Aurora Wyrm Nest', region: 'legendary', ...P(268, 542), r: 16, kind: 'lair', reward: 3000 },
  { id: 'gilded_secret', name: 'The Gilded Glitch', region: 'legendary', ...P(181, 552), r: 8, kind: 'cave', hidden: true, reward: 5000, door: 181 },
  { id: 'petal_glade', name: 'Petal Glade', region: 'bloomveil', x: 1000 + 70, z: 60, r: 14, kind: 'clearing', hidden: true, reward: 800, door: 40 },
  { id: 'comet_crater', name: 'Comet Crater', region: 'starfall', x: -1000 - 60, z: -70, r: 16, kind: 'crater', reward: 1500 },
];

export const SPOT_BY_ID = Object.fromEntries(SPOTS.map((s) => [s.id, s]));

// Lava pools (Volcanic Kingdom): standing in them hurts.
export const LAVA_POOLS = [
  { ...P(338, 360), r: 13, y: 1.2 },
  { ...P(24, 352), r: 11, y: 1.2 },
  { ...P(350, 445), r: 14, y: 1.2 },
  { ...P(32, 452), r: 10, y: 1.2 },
  { ...P(10, 335), r: 8, y: 1.2 },
];

// The hub plaza: shops and portals.
export const SHOPS = [
  { id: 'sword_shop', name: 'Sword Shop', kind: 'swords', ...P(135, 25), facing: 135 + 180 },
  { id: 'item_shop', name: 'Gadget Shop', kind: 'items', ...P(45, 25), facing: 45 + 180 },
  { id: 'lucky_board', name: 'Lucky Board', kind: 'board', ...P(225, 25), facing: 225 + 180 },
];

export const PORTALS = [
  { id: 'to_bloomveil', name: 'Bloomveil Isle', region: 'bloomveil', ...P(300, 28), to: { x: 1000 - 112, z: 0 } },
  { id: 'to_starfall', name: 'Starfall Isle', region: 'starfall', ...P(330, 28), to: { x: -1000 + 112, z: 0 } },
  { id: 'from_bloomveil', name: 'Return to the Plaza', region: 'plains', x: 1000 - 140, z: 0, to: { ...P(315, 17) } },
  { id: 'from_starfall', name: 'Return to the Plaza', region: 'plains', x: -1000 + 140, z: 0, to: { ...P(315, 17) } },
];

// Ancient Ruins puzzle: step on the plates in order to open the vault.
export const RUINS_PUZZLE = (() => {
  const c = SPOTS.find((s) => s.id === 'temple_vault');
  const out = (a, r) => ({ x: c.x + Math.cos(a * DEG) * r, z: c.z + Math.sin(a * DEG) * r });
  return {
    spot: 'temple_vault',
    center: { x: c.x, z: c.z },
    doorAngle: 0, // the vault door faces +x (toward the hub along the road)
    plates: [
      { id: 0, symbol: 'Sun', ...out(60, 26) },
      { id: 1, symbol: 'Moon', ...out(180, 27) },
      { id: 2, symbol: 'Star', ...out(300, 26) },
    ],
    order: [1, 2, 0],
    plateRadius: 2.6,
    windowMs: 25000,
    openMs: 90000,
  };
})();

// ---------------------------------------------------------------------------
// Bases: CONFIG.maxPlayers plots in a ring around the plaza, doors facing the hub.

function makeBases() {
  const bases = [];
  const n = 12;
  const R = CONFIG.bases.ringRadius;
  const half = CONFIG.bases.size / 2;
  for (let i = 0; i < n; i++) {
    const angle = (15 + (360 / n) * i) * DEG;
    const cx = Math.cos(angle) * R;
    const cz = Math.sin(angle) * R;
    // local axes: u = tangent, v = toward the hub (door side)
    const tu = { x: -Math.sin(angle), z: Math.cos(angle) };
    const tv = { x: -Math.cos(angle), z: -Math.sin(angle) };
    const toWorld = (u, v) => ({ x: cx + tu.x * u + tv.x * v, z: cz + tu.z * u + tv.z * v });
    // monster pads: 10 per floor (two rows of five), floor 1 first
    const B = CONFIG.bases;
    const slots = [];
    for (let f = 0; f < B.floors; f++) {
      for (let j = 0; j < B.padsPerFloor && slots.length < B.maxSlots; j++) {
        const p = toWorld(-8 + 4 * (j % 5), j < 5 ? -8 : -3.5);
        slots.push({ ...p, y: f * B.floorHeight, floor: f });
      }
    }
    const faceIn = (u) => (u < 0 ? Math.atan2(tu.x, tu.z) : Math.atan2(-tu.x, -tu.z));
    bases.push({
      index: i,
      x: cx,
      z: cz,
      angle,               // direction from the hub to the base
      yaw: Math.atan2(tv.x, tv.z), // facing of the door (toward the hub)
      half,
      tu,
      tv,
      toWorld,
      slots,
      collector: toWorld(0, 6),
      lockPad: toWorld(8.5, 9.5),
      terminal: toWorld(-8.5, 9.5),
      door: toWorld(0, half),
      outside: toWorld(0, half + 6),   // where intruders are pushed when lasers switch on
      spawn: toWorld(0, 4),
      sign: toWorld(-9, half + 4),
      // decoration spots on the ground floor along the walls (clear of the
      // stairs on the right), facing into the base
      decor: [[-11, -10.5], [-11, -5], [-11, 0.5], [-11, 5.5], [-11, 11], [11, -11], [11, 5.5], [11, 11]]
        .map(([u, v]) => ({ ...toWorld(u, v), yaw: faceIn(u) })),
      y: 0,
    });
  }
  return bases;
}

export function baseLocal(base, x, z) {
  const dx = x - base.x;
  const dz = z - base.z;
  return { u: dx * base.tu.x + dz * base.tu.z, v: dx * base.tv.x + dz * base.tv.z };
}

export function isInsideBase(base, x, z, margin = 0) {
  const { u, v } = baseLocal(base, x, z);
  const h = base.half - 0.5 + margin;
  return Math.abs(u) < h && v > -h && v < h;
}

// ---------------------------------------------------------------------------
// Terrain

const SEED = hashString(WORLD_SEED);
const BLEND_R = 18;
const BLEND_OFFSETS = [
  [0, 0], [BLEND_R, 0], [-BLEND_R, 0], [0, BLEND_R], [0, -BLEND_R],
  [BLEND_R * 0.7, BLEND_R * 0.7], [-BLEND_R * 0.7, BLEND_R * 0.7],
  [BLEND_R * 0.7, -BLEND_R * 0.7], [-BLEND_R * 0.7, -BLEND_R * 0.7],
];

function styleHeight(region, x, z) {
  const t = region.terrain;
  const s = (SEED + REGION_INDEX[region.id] * 7717) | 0;
  const f = t.freq;
  switch (t.style) {
    case 'hills':
      return t.base + t.amp * fbm(x * f, z * f, s, 3);
    case 'jungle':
      return t.base + t.amp * fbm(x * f, z * f, s, 3) + 3 * ridged(x * f * 2, z * f * 2, s + 5, 2);
    case 'dunes': {
      const warp = fbm(x * f * 0.5, z * f * 0.5, s + 3, 2) * 1.5;
      const n = ridged(x * f * 0.55 + warp, z * f * 1.3, s, 2);
      return t.base + t.amp * n + 1.0 * fbm(x * f * 3, z * f * 3, s + 9, 2);
    }
    case 'mountains': {
      const r = ridged(x * f, z * f, s, 4);
      return t.base + t.amp * r * r * 1.7 + 2.5 * fbm(x * f * 3, z * f * 3, s + 1, 2);
    }
    case 'ocean': {
      const n = fbm(x * f, z * f, s, 3);
      const isl = smoothstep(0.08, 0.42, n);
      return lerp(t.base, 3.0 + 1.8 * fbm(x * f * 3, z * f * 3, s + 2, 2), isl);
    }
    case 'terraces': {
      const raw = t.base + t.amp * fbm(x * f, z * f, s, 3);
      return lerp(raw, Math.round(raw / 2.5) * 2.5, 0.8);
    }
    case 'crystal': {
      const r = ridged(x * f, z * f, s, 3);
      const raw = t.base + t.amp * r * r * 1.5 + 2 * fbm(x * f * 4, z * f * 4, s + 4, 2);
      return lerp(raw, Math.round(raw / 3) * 3, 0.6);
    }
    case 'volcanic':
      return t.base + t.amp * fbm(x * f, z * f, s, 3) + 2.5 * ridged(x * f * 3, z * f * 3, s + 6, 2);
    case 'legendary':
      return t.base + t.amp * (0.6 * fbm(x * f, z * f, s, 3) + 0.5 * ridged(x * f * 0.8, z * f * 0.8, s + 2, 3));
    case 'island': {
      const sh = region.shape;
      const dx = x - sh.cx;
      const dz = z - sh.cz;
      const d = Math.sqrt(dx * dx + dz * dz) / sh.r;
      const dome = clamp(1 - d * d, 0, 1);
      return -4 + (t.base + 4) * smoothstep(0, 0.35, dome) + t.amp * fbm(x * f, z * f, s, 3) * dome;
    }
    default:
      return t.base;
  }
}

function regionWeights(x, z) {
  const ids = [];
  const counts = [];
  for (const [ox, oz] of BLEND_OFFSETS) {
    const id = regionIdAt(x + ox, z + oz) || 'void';
    const k = ids.indexOf(id);
    if (k >= 0) counts[k]++;
    else {
      ids.push(id);
      counts.push(1);
    }
  }
  return { ids, counts, total: BLEND_OFFSETS.length };
}

function blendedHeight(x, z) {
  const { ids, counts, total } = regionWeights(x, z);
  let h = 0;
  for (let i = 0; i < ids.length; i++) {
    const w = counts[i] / total;
    h += w * (ids[i] === 'void' ? VOID_Y : styleHeight(REGION_BY_ID[ids[i]], x, z));
  }
  return h;
}

// Terrain modifiers applied after the regional blend (flattened plazas, pits,
// the volcano...). Each has a bounding radius for quick rejection.
function makeModifiers(bases) {
  const mods = [];
  const flat = (x, z, inner, outer, y) => mods.push({ kind: 'flat', x, z, inner, outer, y, br: outer });
  flat(0, 0, PLAZA.r, PLAZA.r + 10, PLAZA.y);
  for (const s of SPOTS) {
    const y0 = blendedHeight(s.x, s.z);
    if (s.kind === 'cave' || s.kind === 'clearing' || s.kind === 'temple' || s.kind === 'altar' || s.kind === 'lair' || s.kind === 'landmark') {
      const y = Math.max(1.5, y0);
      s.y = y;
      flat(s.x, s.z, s.r + 3, s.r + 14, y);
    } else if (s.kind === 'chamber') {
      const y = Math.max(2, y0) - 7;
      s.y = y;
      s.rimY = y + 7;
      flat(s.x, s.z, s.r + 9, s.r + 22, y + 7);
      mods.push({ kind: 'pit', x: s.x, z: s.z, inner: s.r, outer: s.r + 8, depth: 7, br: s.r + 8 });
    } else if (s.kind === 'pond') {
      const y = Math.max(1.5, y0);
      s.y = y;
      flat(s.x, s.z, s.r + 4, s.r + 14, y);
      mods.push({ kind: 'pond', x: s.x, z: s.z, r: s.r * 0.8, floor: -1.6, br: s.r * 0.8 });
    } else if (s.kind === 'lake') {
      s.y = 4;
      flat(s.x, s.z, s.r, s.r + 16, 4);
    } else if (s.kind === 'island') {
      s.y = 3;
      mods.push({ kind: 'raise', x: s.x, z: s.z, inner: s.r, outer: s.r + 16, y: 3, br: s.r + 16 });
    } else if (s.kind === 'crater') {
      if (s.id === 'volcano_crater') {
        mods.push({ kind: 'volcano', x: s.x, z: s.z, r: 95, height: 34, crater: s.r + 4, br: 95 });
        s.y = null; // computed below
      } else {
        const y = Math.max(2, y0);
        s.y = y - 3;
        mods.push({ kind: 'bowl', x: s.x, z: s.z, r: s.r + 4, depth: 3, br: s.r + 4 });
      }
    } else {
      s.y = y0;
    }
  }
  for (const p of LAVA_POOLS) mods.push({ kind: 'lava', x: p.x, z: p.z, r: p.r, y: p.y - 1.8, br: p.r + 6 });
  for (const p of PORTALS) {
    if (Math.sqrt(p.x * p.x + p.z * p.z) < PLAZA.r) continue; // the plaza is already flat
    flat(p.x, p.z, 5, 12, Math.max(3, blendedHeight(p.x, p.z)));
  }
  for (const p of RUINS_PUZZLE.plates) flat(p.x, p.z, 3, 8, Math.max(3, blendedHeight(p.x, p.z)));
  // bases last, so nothing nearby can bend a base floor
  for (const b of bases) {
    const y = Math.max(2.6, Math.min(5.5, blendedHeight(b.x, b.z)));
    b.y = y;
    mods.push({ kind: 'flatSquare', base: b, inner: b.half + 3, outer: b.half + 12, y, br: (b.half + 12) * 1.5 });
  }
  return mods;
}

function applyModifiers(mods, x, z, h) {
  for (const m of mods) {
    const dx = x - m.x;
    const dz = z - m.z;
    if (m.kind !== 'flatSquare' && (dx * dx + dz * dz > m.br * m.br)) continue;
    switch (m.kind) {
      case 'flat': {
        const d = Math.sqrt(dx * dx + dz * dz);
        h = lerp(m.y, h, smoothstep(m.inner, m.outer, d));
        break;
      }
      case 'flatSquare': {
        const b = m.base;
        const ddx = x - b.x;
        const ddz = z - b.z;
        if (ddx * ddx + ddz * ddz > m.br * m.br) break;
        const u = Math.abs(ddx * b.tu.x + ddz * b.tu.z);
        const v = Math.abs(ddx * b.tv.x + ddz * b.tv.z);
        const d = Math.max(u, v);
        h = lerp(m.y, h, smoothstep(m.inner, m.outer, d));
        break;
      }
      case 'pit': {
        const d = Math.sqrt(dx * dx + dz * dz);
        h -= m.depth * (1 - smoothstep(m.inner, m.outer, d));
        break;
      }
      case 'bowl': {
        const d = Math.sqrt(dx * dx + dz * dz) / m.r;
        if (d < 1) h -= m.depth * (1 - d * d);
        break;
      }
      case 'pond': {
        const d = Math.sqrt(dx * dx + dz * dz);
        h = lerp(m.floor, h, smoothstep(m.r * 0.45, m.r, d));
        break;
      }
      case 'raise': {
        const d = Math.sqrt(dx * dx + dz * dz);
        const t = 1 - smoothstep(m.inner, m.outer, d);
        h = Math.max(h, lerp(h, m.y, t));
        break;
      }
      case 'volcano': {
        const d = Math.sqrt(dx * dx + dz * dz);
        const t = clamp(1 - d / m.r, 0, 1);
        h += m.height * Math.pow(t, 1.4);
        if (d < m.crater) h -= (m.height * 0.42) * (1 - smoothstep(m.crater * 0.4, m.crater, d));
        break;
      }
      case 'lava': {
        const d = Math.sqrt(dx * dx + dz * dz);
        const t = 1 - smoothstep(m.r - 2, m.r + 6, d);
        h = lerp(h, Math.min(h, m.y), t);
        break;
      }
      default:
        break;
    }
  }
  return h;
}

class HeightPatch {
  constructor(x0, z0, size, fn) {
    this.x0 = x0;
    this.z0 = z0;
    this.n = Math.round(size / CELL) + 1;
    this.size = size;
    this.h = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        this.h[j * this.n + i] = fn(x0 + i * CELL, z0 + j * CELL);
      }
    }
  }

  contains(x, z) {
    return x >= this.x0 && z >= this.z0 && x <= this.x0 + this.size && z <= this.z0 + this.size;
  }

  // Same triangle split as the client terrain mesh: diagonal from (0,0) to (1,1).
  sample(x, z) {
    const gx = (x - this.x0) / CELL;
    const gz = (z - this.z0) / CELL;
    let i = Math.floor(gx);
    let j = Math.floor(gz);
    if (i >= this.n - 1) i = this.n - 2;
    if (j >= this.n - 1) j = this.n - 2;
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    const fx = clamp(gx - i, 0, 1);
    const fz = clamp(gz - j, 0, 1);
    const n = this.n;
    const h00 = this.h[j * n + i];
    const h10 = this.h[j * n + i + 1];
    const h01 = this.h[(j + 1) * n + i];
    const h11 = this.h[(j + 1) * n + i + 1];
    if (fx >= fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }
}

// ---------------------------------------------------------------------------
// Roads

export function roadDistance(x, z) {
  const r = Math.sqrt(x * x + z * z);
  let best = Math.min(Math.abs(r - RING_PATH_R), Math.abs(r - BASE_RING_R));
  if (x > PLAZA.r - 4) best = Math.min(best, Math.abs(z));
  if (x < -(PLAZA.r - 4)) best = Math.min(best, Math.abs(z));
  if (z > PLAZA.r - 4) best = Math.min(best, Math.abs(x));
  if (z < -(PLAZA.r - 4)) best = Math.min(best, Math.abs(x));
  return best;
}

// ---------------------------------------------------------------------------
// Terrain colour (only the browser needs this, but it lives here so it stays
// in sync with the heights).

const _c = [0, 0, 0];
function hexToRgb(hex, out) {
  out[0] = ((hex >> 16) & 255) / 255;
  out[1] = ((hex >> 8) & 255) / 255;
  out[2] = (hex & 255) / 255;
  return out;
}

export function terrainColor(world, x, z, h, slope, out = [0, 0, 0]) {
  const { ids, counts, total } = regionWeights(x, z);
  out[0] = out[1] = out[2] = 0;
  const n = fbm(x * 0.05, z * 0.05, SEED + 99, 2) * 0.5 + 0.5;
  for (let i = 0; i < ids.length; i++) {
    const w = counts[i] / total;
    const reg = REGION_BY_ID[ids[i]];
    if (!reg) {
      hexToRgb(0xc8b27a, _c);
    } else {
      const col = reg.colors;
      const lo = hexToRgb(col.low, [0, 0, 0]);
      const hi = hexToRgb(col.high, _c);
      for (let k = 0; k < 3; k++) _c[k] = lo[k] + (hi[k] - lo[k]) * n;
      if (reg.id === 'frozen' && h < 9) {
        // grassy-blue foothills under the snow
        const t = smoothstep(9, 4, h);
        _c[0] = lerp(_c[0], 0.62, t); _c[1] = lerp(_c[1], 0.8, t); _c[2] = lerp(_c[2], 0.86, t);
      }
      if (slope > 0.9) {
        const cl = hexToRgb(col.cliff, [0, 0, 0]);
        const t = smoothstep(0.9, 1.6, slope);
        for (let k = 0; k < 3; k++) _c[k] = lerp(_c[k], cl[k], t);
      }
    }
    out[0] += _c[0] * w; out[1] += _c[1] * w; out[2] += _c[2] * w;
  }
  // beaches and sea floor
  if (h < 1.4) {
    const t = smoothstep(1.4, 0.2, h);
    out[0] = lerp(out[0], 0.93, t); out[1] = lerp(out[1], 0.86, t); out[2] = lerp(out[2], 0.62, t);
  }
  if (h < -2) {
    const t = smoothstep(-2, -8, h);
    out[0] = lerp(out[0], 0.55, t); out[1] = lerp(out[1], 0.72, t); out[2] = lerp(out[2], 0.62, t);
  }
  // roads and the plaza
  const rd = roadDistance(x, z);
  const region = world ? regionIdAt(x, z) : null;
  if (rd < 4.5 && h > 0.5) {
    const t = smoothstep(4.5, 2.5, rd);
    const pc = hexToRgb(region ? REGION_BY_ID[region].colors.path : 0xd8b878, [0, 0, 0]);
    for (let k = 0; k < 3; k++) out[k] = lerp(out[k], pc[k], t * 0.85);
  }
  const pr = Math.sqrt(x * x + z * z);
  if (pr < PLAZA.r + 1) {
    const t = smoothstep(PLAZA.r + 1, PLAZA.r - 2, pr);
    const ring = (Math.floor(pr / 6) % 2 === 0) ? 0.86 : 0.8;
    out[0] = lerp(out[0], ring, t); out[1] = lerp(out[1], ring * 0.97, t); out[2] = lerp(out[2], ring * 0.9, t);
  }
  if (world) {
    for (const p of LAVA_POOLS) {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < p.r + 5) {
        const t = smoothstep(p.r + 5, p.r, d);
        out[0] = lerp(out[0], 0.2, t); out[1] = lerp(out[1], 0.12, t); out[2] = lerp(out[2], 0.1, t);
      }
    }
  }
  const v = 0.94 + 0.12 * fbm(x * 0.3, z * 0.3, SEED + 5, 1);
  out[0] *= v; out[1] *= v; out[2] *= v;
  return out;
}

// ---------------------------------------------------------------------------
// Structures: plain boxes that both the server (collision) and the browser
// (rendering) understand. Each box: { x, y, z, hw, hh, hd, rot, mat, solid }
// where rot is the yaw of the box's width axis.

function addBox(list, x, y, z, hw, hh, hd, rot, mat, solid = true, extra = {}) {
  list.push({ x, y, z, hw, hh, hd, rot, mat, solid, ...extra });
}

// The base is a tower of CONFIG.bases.floors floors. Inside, flights of
// stairs alternate between the right and the left wall; each floor has a
// hole above the flight that arrives on it (with a railing). The only way in
// is the front door on the ground floor (guarded by the lasers).
//   flight f (floor f -> f+1) runs along side stairSide(f), rising from the
//   front (v = STAIR_V0) to the back (v = STAIR_V1).
export const STAIR = { u0: 9.8, u1: 12.4, v0: 3, v1: -9, steps: 12 };
export const stairSide = (f) => (f % 2 === 0 ? 1 : -1);

function buildBaseBoxes(b, out, platforms) {
  const B = CONFIG.bases;
  const FH = B.floorHeight;
  const top = B.floors * FH;
  const h = b.half;
  const door = B.doorWidth / 2;
  const doorH = 6.2;
  const rot = Math.atan2(b.tu.z, b.tu.x); // width axis along u
  const at = (u, v) => b.toWorld(u, v);
  const box = (u, v, y0, y1, hw, hd, mat, solid = false, extra = {}) => {
    const p = at(u, v);
    addBox(out, p.x, b.y + (y0 + y1) / 2, p.z, hw, (y1 - y0) / 2, hd, rot, mat, solid, { base: b.index, ...extra });
  };
  const platform = (u0, u1, v0, v1, topY) => {
    const p = at((u0 + u1) / 2, (v0 + v1) / 2);
    platforms.push({ x: p.x, z: p.z, hw: Math.abs(u1 - u0) / 2, hd: Math.abs(v1 - v0) / 2, rot, top: b.y + topY });
  };
  const W = 0.6; // wall half-thickness

  // --- collision: solid walls the full height (windows are glass), the
  // front wall is open only at the ground-floor door
  const solidWall = (u, v, hw, hd, y0 = -0.5, y1 = top + 1.5) => box(u, v, y0, y1, hw, hd, 'base_wall', true, { invisible: true, colY0: y0 > 0 ? b.y + y0 : undefined });
  solidWall(0, -h, h + W, W);
  solidWall(-h, 0, W, h + W);
  solidWall(h, 0, W, h + W);
  const sideLen = (h - door) / 2;
  solidWall(-(door + sideLen), h, sideLen, W);
  solidWall(door + sideLen, h, sideLen, W);
  solidWall(0, h, door, W, doorH, top + 1.5);

  // --- looks: dark block walls with light window frames on every floor
  for (let f = 0; f < B.floors; f++) {
    const y0 = f * FH;
    const sill = y0 + 1.6;
    const lintel = y0 + FH - 1.3;
    for (const side of ['back', 'left', 'right', 'front']) {
      // a wall runs along t in [-h, h]; place(t, ...) maps to (u, v)
      const place = (t, ya, yb, halfLen, mat) => {
        if (side === 'back') box(t, -h, ya, yb, halfLen, W, mat);
        else if (side === 'front') box(t, h, ya, yb, halfLen, W, mat);
        else box(side === 'left' ? -h : h, t, ya, yb, W, halfLen, mat);
      };
      const isDoor = side === 'front' && f === 0;
      if (isDoor) {
        place(-(door + sideLen), y0, y0 + FH, sideLen, 'base_wall');
        place(door + sideLen, y0, y0 + FH, sideLen, 'base_wall');
        place(0, doorH, y0 + FH, door, 'base_wall');
        place(-door - 0.35, y0, doorH, 0.45, 'base_trim');
        place(door + 0.35, y0, doorH, 0.45, 'base_trim');
        continue;
      }
      place(0, y0, sill, h + W, 'base_wall');            // below the windows
      place(0, lintel, y0 + FH, h + W, 'base_wall');     // above the windows
      for (const t of [-h, -h / 3, h / 3, h]) place(t, sill, lintel, 1.1, 'base_wall'); // pillars
      // window frames (light trim), and dark glass you can see through a bit
      for (const c of [-(2 * h) / 3, (2 * h) / 3, 0]) {
        if (c === 0 && side !== 'front' && side !== 'back') continue;
        const half = c === 0 ? h / 3 - 1.1 : h / 3 - 1.1;
        place(c, sill, sill + 0.35, half, 'base_trim');
        place(c, lintel - 0.35, lintel, half, 'base_trim');
        place(c - half + 0.2, sill + 0.35, lintel - 0.35, 0.2, 'base_trim');
        place(c + half - 0.2, sill + 0.35, lintel - 0.35, 0.2, 'base_trim');
      }
    }
  }
  // corner columns and the roof edge
  for (const [u, v] of [[-h, -h], [h, -h], [-h, h], [h, h]]) box(u, v, -0.5, top + 1.6, 1.2, 1.2, 'base_trim');
  box(0, 0, top, top + 0.6, h + W, h + W, 'base_wall');
  for (const [u, v, hw, hd] of [[0, -h, h + W, W], [0, h, h + W, W], [-h, 0, W, h + W], [h, 0, W, h + W]]) box(u, v, top + 0.6, top + 1.6, hw, hd, 'base_trim');

  // --- ground floor (visual; the terrain under the base is flat)
  box(0, 0, -0.55, 0.05, h, h, 'base_floor');
  platform(-h, h, -h, h, 0);

  // --- upper floors with a hole over the arriving flight, and railings
  const S = STAIR;
  for (let f = 1; f < B.floors; f++) {
    const y = f * FH;
    const hole = stairSide(f - 1);
    const holeIn = hole * (S.u0 - 0.2);   // inner edge of the hole
    const slab = (u0, u1, v0, v1) => {
      box((u0 + u1) / 2, (v0 + v1) / 2, y - 0.5, y, Math.abs(u1 - u0) / 2, Math.abs(v1 - v0) / 2, 'base_floor');
      platform(u0, u1, v0, v1, y);
    };
    slab(-h, h, S.v0 + 0.2, h);                       // front
    slab(-h, h, -h, S.v1);                            // back (landing)
    if (hole > 0) slab(-h, holeIn, S.v1, S.v0 + 0.2); // middle, minus the hole
    else slab(holeIn, h, S.v1, S.v0 + 0.2);
    // railing along the hole (open at the back where the stairs arrive)
    const railLen = (S.v0 + 0.2 - S.v1) / 2;
    box(holeIn, (S.v0 + 0.2 + S.v1) / 2, y, y + 1.2, 0.15, railLen, 'base_trim', true);
    box(hole * (S.u0 + S.u1) / 2 - hole * 0.05, S.v0 + 0.2, y, y + 1.2, (S.u1 - S.u0) / 2 + 0.3, 0.15, 'base_trim', true);
  }

  // --- stairs: one flight per floor, alternating sides
  const run = (S.v0 - S.v1) / S.steps;
  for (let f = 0; f < B.floors - 1; f++) {
    const side = stairSide(f);
    const uc = side * (S.u0 + S.u1) / 2;
    const hw = (S.u1 - S.u0) / 2;
    for (let i = 0; i < S.steps; i++) {
      const vMid = S.v0 - (i + 0.5) * run;
      const y0 = f * FH;
      const stepTop = y0 + ((i + 1) * FH) / S.steps;
      // the step (solid from the floor below, so you can't walk under it;
      // its collision stops a little under the tread so you can step up)
      box(uc, vMid, y0, stepTop, hw, run / 2, i % 2 ? 'stairs_dark' : 'stairs', false);
      const p = at(uc, vMid);
      out.push({ stairStep: true, x: p.x, z: p.z, hw, hd: run / 2, rot, y0: b.y + y0, y1: b.y + stepTop - 0.62, base: b.index });
      platform(uc - hw, uc + hw, vMid - run / 2, vMid + run / 2, stepTop);
    }
  }
}

function buildCave(s, out, mat = 'cave_rock') {
  const segs = 14;
  const R = s.r;
  const doorA = (s.door ?? 0) * DEG;
  const gap = 0.55; // radians either side of the door
  for (let k = 0; k < segs; k++) {
    const a = (k + 0.5) * ((Math.PI * 2) / segs);
    let da = Math.abs(((a - doorA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < gap) continue;
    const x = s.x + Math.cos(a) * R;
    const z = s.z + Math.sin(a) * R;
    const len = (Math.PI * 2 * R) / segs * 0.62;
    const hh = 4.5 + ((k * 37) % 5) * 0.6;
    addBox(out, x, s.y + hh - 0.5, z, len, hh, 2.2, a + Math.PI / 2, mat);
  }
  // roof slabs (visual only) so the inside feels like a cave
  for (let k = 0; k < 3; k++) {
    const a = doorA + Math.PI + (k - 1) * 0.9;
    const x = s.x + Math.cos(a) * R * 0.45;
    const z = s.z + Math.sin(a) * R * 0.45;
    addBox(out, x, s.y + 9.2 + k * 0.4, z, R * 0.75, 1.2, R * 0.5, a + Math.PI / 2, mat, false);
  }
}

function buildChamber(s, out) {
  // stone ring on the rim of the pit with one entrance, plus a partial roof
  const segs = 16;
  const R = s.r + 9;
  const doorA = (s.door ?? 0) * DEG;
  for (let k = 0; k < segs; k++) {
    const a = (k + 0.5) * ((Math.PI * 2) / segs);
    const da = Math.abs(((a - doorA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < 0.35) continue;
    const x = s.x + Math.cos(a) * R;
    const z = s.z + Math.sin(a) * R;
    const len = (Math.PI * 2 * R) / segs * 0.55;
    addBox(out, x, s.rimY + 2.5, z, len, 3, 1.4, a + Math.PI / 2, 'sandstone');
  }
  for (let k = 0; k < 4; k++) {
    const a = doorA + Math.PI + (k - 1.5) * 0.7;
    addBox(out, s.x + Math.cos(a) * s.r * 0.6, s.rimY + 5.8, s.z + Math.sin(a) * s.r * 0.6, s.r * 0.9, 0.7, 3, a + Math.PI / 2, 'sandstone', false);
  }
}

function buildClearing(s, props) {
  // a ring of trees with one gap: the "hidden" clearing
  const n = 18;
  const doorA = (s.door ?? 0) * DEG;
  const type = s.region === 'shadow' ? 'dark_tree' : s.region === 'bloomveil' ? 'blossom_tree' : 'jungle_tree';
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const da = Math.abs(((a - doorA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < 0.3) continue;
    const r = s.r + 3 + ((k * 13) % 3);
    props.push({ type, x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r, s: 1.25 + ((k * 7) % 4) * 0.08, rot: k, forced: true });
    props.push({ type: 'bush', x: s.x + Math.cos(a + 0.17) * (r + 2.5), z: s.z + Math.sin(a + 0.17) * (r + 2.5), s: 1.4, rot: k, forced: true });
  }
}

function buildTemple(s, out) {
  // square vault with a sealed door on the +x side
  const h = 11;
  const H = 9;
  const y = s.y;
  addBox(out, s.x - h, y + H / 2, s.z, 1, H / 2, h + 1, 0, 'temple');
  addBox(out, s.x, y + H / 2, s.z - h, h + 1, H / 2, 1, 0, 'temple');
  addBox(out, s.x, y + H / 2, s.z + h, h + 1, H / 2, 1, 0, 'temple');
  addBox(out, s.x + h, y + H / 2, s.z - (h + 3.5) / 2 - 0.5, 1, H / 2, (h - 3.5) / 2 + 0.5, 0, 'temple');
  addBox(out, s.x + h, y + H / 2, s.z + (h + 3.5) / 2 + 0.5, 1, H / 2, (h - 3.5) / 2 + 0.5, 0, 'temple');
  addBox(out, s.x + h, y + H / 2, s.z, 0.7, H / 2, 3.5, 0, 'vault_door', true, { door: 'temple_vault' });
  addBox(out, s.x, y + H + 0.6, s.z, h + 1.5, 0.6, h + 1.5, 0, 'temple', false);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    addBox(out, s.x + dx * (h + 2.5), y + 6, s.z + dz * (h + 2.5), 1.3, 6, 1.3, 0, 'temple');
  }
}

function buildAltar(s, out) {
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    addBox(out, s.x + Math.cos(a) * s.r, s.y + 5, s.z + Math.sin(a) * s.r, 1, 5, 1, a, 'gold_stone');
  }
  addBox(out, s.x, s.y + 0.4, s.z, 6, 0.5, 6, Math.PI / 4, 'gold_stone', false);
}

function buildLair(s, out) {
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.2;
    const r = s.r + 2;
    addBox(out, s.x + Math.cos(a) * r, s.y + 3 + (k % 3), s.z + Math.sin(a) * r, 2.5, 3 + (k % 3), 1.5, a + 1.2, 'nest');
  }
}

function buildShop(shop, out, y) {
  const rot = shop.facing * DEG + Math.PI / 2;
  const fx = Math.cos(shop.facing * DEG);
  const fz = Math.sin(shop.facing * DEG);
  const back = (d) => ({ x: shop.x - fx * d, z: shop.z - fz * d });
  const b1 = back(2.5);
  addBox(out, b1.x, y + 1, b1.z, 5, 1, 1.2, rot, 'counter', true, { shop: shop.id });
  const b2 = back(5);
  addBox(out, b2.x, y + 4, b2.z, 5.5, 4, 0.6, rot, 'stall_back', true, { shop: shop.id });
  const tx = -Math.sin(shop.facing * DEG);
  const tz = Math.cos(shop.facing * DEG);
  for (const sgn of [-1, 1]) {
    const p = back(2.5);
    addBox(out, p.x + tx * sgn * 5.2, y + 3.5, p.z + tz * sgn * 5.2, 0.4, 3.5, 0.4, rot, 'stall_post', true);
  }
  const roof = back(3);
  addBox(out, roof.x, y + 7.4, roof.z, 6.2, 0.35, 3.6, rot, shop.kind === 'swords' ? 'awning_red' : shop.kind === 'items' ? 'awning_blue' : 'awning_gold', false);
}

function buildShipwreck(s, out) {
  const rot = 0.6;
  addBox(out, s.x, s.y + 1.5, s.z, 9, 2, 3.2, rot, 'wood_dark');
  addBox(out, s.x + Math.cos(rot) * 2, s.y + 7, s.z + Math.sin(rot) * 2, 0.4, 6, 0.4, rot, 'wood_dark', false);
}

function buildArch(s, out) {
  addBox(out, s.x - 5, s.y + 5, s.z, 1.4, 5, 1.4, 0.3, 'temple');
  addBox(out, s.x + 5, s.y + 3, s.z, 1.4, 3, 1.4, 0.3, 'temple');
  addBox(out, s.x - 1, s.y + 10.6, s.z, 5.2, 0.9, 1.3, 0.3, 'temple', false);
}

// ---------------------------------------------------------------------------
// Props

function buildProps(world) {
  const props = [];
  const occupied = new ColliderGrid(16);
  const exclusions = [];
  exclusions.push({ x: 0, z: 0, r: PLAZA.r + 10 });
  for (const b of world.bases) exclusions.push({ x: b.x, z: b.z, r: b.half * 1.45 + 6 });
  for (const s of SPOTS) exclusions.push({ x: s.x, z: s.z, r: s.r + 5 });
  for (const p of PORTALS) exclusions.push({ x: p.x, z: p.z, r: 8 });
  for (const p of LAVA_POOLS) exclusions.push({ x: p.x, z: p.z, r: p.r + 3 });
  for (const p of RUINS_PUZZLE.plates) exclusions.push({ x: p.x, z: p.z, r: 6 });
  exclusions.push({ x: SPOT_BY_ID.volcano_crater.x, z: SPOT_BY_ID.volcano_crater.z, r: 28 });

  for (const s of SPOTS) if (s.kind === 'clearing') buildClearing(s, props);
  // landmark decorations
  const oak = SPOT_BY_ID.elder_oak;
  props.push({ type: 'tree_round', x: oak.x, z: oak.z, s: 3.2, rot: 0, forced: true, landmark: true });
  for (const s of SPOTS) {
    if (s.kind === 'pond') {
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.4;
        const type = s.region === 'desert' ? 'palm' : 'jungle_tree';
        props.push({ type, x: s.x + Math.cos(a) * (s.r + 2), z: s.z + Math.sin(a) * (s.r + 2), s: 1 + (k % 3) * 0.15, rot: k, forced: true });
      }
    }
    if (s.id === 'prism_peak') props.push({ type: 'crystal', x: s.x, z: s.z, s: 4, rot: 0, forced: true, landmark: true });
    if (s.id === 'wisp_grove') {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        props.push({ type: 'glow_mushroom', x: s.x + Math.cos(a) * 7, z: s.z + Math.sin(a) * 7, s: 2 + (k % 3) * 0.4, rot: k, forced: true });
      }
    }
    if (s.id === 'coral_cove') {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        props.push({ type: 'palm', x: s.x + Math.cos(a) * (s.r - 2), z: s.z + Math.sin(a) * (s.r - 2), s: 1.2, rot: k, forced: true });
      }
    }
  }
  for (const p of props) {
    p.y = world.groundHeight(p.x, p.z);
    const pt = PROP_TYPES[p.type];
    if (pt.r > 0) occupied.add({ kind: 'circle', x: p.x, z: p.z, r: pt.spacing * 0.5 * p.s });
  }

  const free = (x, z, spacing) => {
    let ok = true;
    occupied.query(x, z, spacing, (c) => {
      if (!ok) return;
      const dx = x - c.x;
      const dz = z - c.z;
      const m = c.r + spacing * 0.5;
      if (dx * dx + dz * dz < m * m) ok = false;
    });
    return ok;
  };

  for (const region of REGIONS) {
    const rng = rngFor(WORLD_SEED, 'props', region.id);
    const bounds = regionBounds(region);
    for (const [type, count] of region.props) {
      const pt = PROP_TYPES[type];
      let placed = 0;
      for (let tries = 0; placed < count && tries < count * 25; tries++) {
        const x = bounds.x0 + rng() * (bounds.x1 - bounds.x0);
        const z = bounds.z0 + rng() * (bounds.z1 - bounds.z0);
        if (regionIdAt(x, z) !== region.id) continue;
        let bad = false;
        for (const e of exclusions) {
          const dx = x - e.x;
          const dz = z - e.z;
          if (dx * dx + dz * dz < e.r * e.r) { bad = true; break; }
        }
        if (bad) continue;
        if (roadDistance(x, z) < 5.5) continue;
        const y = world.groundHeight(x, z);
        if (pt.place === 'land' && y < 1.2) continue;
        if (pt.place === 'shore' && (y < 0.6 || y > 4.5)) continue;
        if (pt.place === 'under' && y > -1.5) continue;
        if (pt.place === 'any' && y < -3) continue;
        const s = pt.scale[0] + rng() * (pt.scale[1] - pt.scale[0]);
        const spacing = pt.spacing * s;
        if (!free(x, z, spacing)) continue;
        const prop = { type, x, z, y, s, rot: rng() * Math.PI * 2 };
        props.push(prop);
        occupied.add({ kind: 'circle', x, z, r: spacing * 0.5 });
        placed++;
      }
    }
  }
  return props;
}

function regionBounds(region) {
  const s = region.shape;
  if (s.kind === 'island') return { x0: s.cx - s.r, x1: s.cx + s.r, z0: s.cz - s.r, z1: s.cz + s.r };
  const R = s.kind === 'disc' ? s.r : s.r2;
  return { x0: -R, x1: R, z0: -R, z1: R };
}

// ---------------------------------------------------------------------------

let cached = null;

export function buildWorld() {
  if (cached) return cached;
  const world = {};
  const bases = makeBases();
  const mods = makeModifiers(bases);
  const heightAt = (x, z) => applyModifiers(mods, x, z, blendedHeight(x, z));

  // height patches: the continent plus one per island
  const patches = [];
  const M = RING.edge + 40;
  patches.push(new HeightPatch(-M, -M, M * 2, heightAt));
  for (const r of REGIONS) {
    if (r.shape.kind !== 'island') continue;
    const m = r.shape.r + 40;
    patches.push(new HeightPatch(r.shape.cx - m, r.shape.cz - m, m * 2, heightAt));
  }
  world.patches = patches;
  world.groundHeight = (x, z) => {
    for (const p of patches) if (p.contains(x, z)) return p.sample(x, z);
    return VOID_Y;
  };
  world.bases = bases;
  world.shops = SHOPS.map((s) => ({ ...s, y: world.groundHeight(s.x, s.z) }));
  world.portals = PORTALS.map((p) => ({ ...p, y: world.groundHeight(p.x, p.z) }));
  for (const p of world.portals) p.to = { ...p.to, y: world.groundHeight(p.to.x, p.to.z) };
  world.spots = SPOTS;
  for (const s of SPOTS) {
    if (s.y === null || s.y === undefined) s.y = world.groundHeight(s.x, s.z);
    if (s.kind === 'crater' && s.id === 'volcano_crater') s.y = world.groundHeight(s.x, s.z);
  }
  world.lavaPools = LAVA_POOLS;
  world.puzzle = { ...RUINS_PUZZLE, plates: RUINS_PUZZLE.plates.map((p) => ({ ...p, y: world.groundHeight(p.x, p.z) })) };

  // boxes for structures
  const boxes = [];
  const platforms = [];
  for (const b of bases) buildBaseBoxes(b, boxes, platforms);
  for (const s of world.shops) buildShop(s, boxes, PLAZA.y);
  for (const s of SPOTS) {
    if (s.kind === 'cave') buildCave(s, boxes, s.region === 'frozen' ? 'ice_rock' : s.region === 'crystal' ? 'crystal_rock' : s.region === 'legendary' ? 'gold_stone' : 'cave_rock');
    else if (s.kind === 'chamber') buildChamber(s, boxes);
    else if (s.kind === 'temple') buildTemple(s, boxes);
    else if (s.kind === 'altar') buildAltar(s, boxes);
    else if (s.kind === 'lair') buildLair(s, boxes);
    else if (s.id === 'shipwreck') buildShipwreck(s, boxes);
    else if (s.id === 'broken_arch') buildArch(s, boxes);
  }
  // stair steps are collision-only entries (their looks are normal boxes)
  world.boxes = boxes.filter((b) => !b.stairStep);
  const stairSteps = boxes.filter((b) => b.stairStep);

  world.props = buildProps(world);

  // colliders
  const grid = new ColliderGrid(16);
  for (const st of stairSteps) {
    grid.add(boxCollider(st.x, st.z, st.hw, st.hd, st.rot, st.y0, st.y1, { base: st.base }));
  }
  for (const b of world.boxes) {
    if (!b.solid) continue;
    // (boxes reach a little below their bottom for uneven ground, except ones
    // that start in the air on purpose, like the wall above a door)
    const c = boxCollider(b.x, b.z, b.hw, b.hd, b.rot, b.colY0 ?? b.y - b.hh - 2, b.y + b.hh, {});
    if (b.door) c.door = b.door;
    if (b.base !== undefined) c.base = b.base;
    b.collider = c;
    grid.add(c);
  }
  for (const p of world.props) {
    const pt = PROP_TYPES[p.type];
    if (pt.r <= 0) continue;
    grid.add(circleCollider(p.x, p.z, pt.r * p.s, p.y - 2, p.y + 12 * p.s));
  }
  grid.add(circleCollider(0, 0, 5.2, -10, PLAZA.y + 6)); // fountain
  for (const p of world.portals) {
    const a = Math.atan2(p.z, p.x) + Math.PI / 2;
    for (const sgn of [-1, 1]) {
      grid.add(circleCollider(p.x + Math.cos(a) * 3.4 * sgn, p.z + Math.sin(a) * 3.4 * sgn, 0.8, p.y - 2, p.y + 9));
    }
  }
  world.colliders = grid;

  // walkable surfaces above the terrain: base floors and stair treads
  const pgrid = new ColliderGrid(16);
  for (const pl of platforms) pgrid.add(boxCollider(pl.x, pl.z, pl.hw, pl.hd, pl.rot, pl.top, pl.top, { top: pl.top }));
  world.platforms = pgrid;
  // Height of the ground or floor under (x, z) for something whose feet are
  // at y: the highest surface no more than STEP_UP above the feet.
  world.surfaceHeight = (x, z, y = Infinity) => {
    let best = world.groundHeight(x, z);
    const limit = y + STEP_UP;
    pgrid.query(x, z, 0, (c) => {
      if (c.top <= best || c.top > limit) return;
      const dx = x - c.x;
      const dz = z - c.z;
      if (Math.abs(dx * c.ax + dz * c.az) <= c.hw && Math.abs(-dx * c.az + dz * c.ax) <= c.hd) best = c.top;
    });
    return best;
  };

  world.isLava = (x, z, y) => {
    for (const p of LAVA_POOLS) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < p.r * p.r && y < p.y + 1.5) return true;
    }
    return false;
  };

  world.luckySpots = buildLuckySpots(world);
  cached = world;
  return world;
}

// Fixed candidate positions for lucky blocks in every region.
function buildLuckySpots(world) {
  const out = {};
  for (const region of REGIONS) {
    const rng = rngFor(WORLD_SEED, 'lucky', region.id);
    const b = regionBounds(region);
    const list = [];
    for (let tries = 0; list.length < 18 && tries < 2000; tries++) {
      const x = b.x0 + rng() * (b.x1 - b.x0);
      const z = b.z0 + rng() * (b.z1 - b.z0);
      if (regionIdAt(x, z) !== region.id) continue;
      if (Math.sqrt(x * x + z * z) < PLAZA.r + 6) continue;
      const y = world.groundHeight(x, z);
      if (y < 1) continue;
      if (world.bases.some((bb) => isInsideBase(bb, x, z, 6))) continue;
      const pos = { x, y, z };
      world.colliders.resolve(pos, 1.5, 3);
      if (Math.abs(pos.x - x) > 0.01 || Math.abs(pos.z - z) > 0.01) continue;
      if (list.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 40 * 40)) continue;
      list.push({ x, y, z });
    }
    out[region.id] = list;
  }
  return out;
}

// Random valid position for a wild monster in a region.
export function randomGroundPoint(world, regionId, rng, opts = {}) {
  const region = REGION_BY_ID[regionId];
  const b = regionBounds(region);
  for (let tries = 0; tries < 40; tries++) {
    let x;
    let z;
    if (opts.near) {
      const a = rng() * Math.PI * 2;
      const r = (opts.minR ?? 0) + rng() * ((opts.maxR ?? 20) - (opts.minR ?? 0));
      x = opts.near.x + Math.cos(a) * r;
      z = opts.near.z + Math.sin(a) * r;
    } else {
      x = b.x0 + rng() * (b.x1 - b.x0);
      z = b.z0 + rng() * (b.z1 - b.z0);
    }
    if (regionIdAt(x, z) !== regionId) continue;
    const y = world.groundHeight(x, z);
    if (opts.water) {
      if (y > -1.5) continue;
    } else if (!opts.anyWater && y < 0.8) continue;
    if (Math.sqrt(x * x + z * z) < PLAZA.r + 18) continue;
    if (world.bases.some((bb) => isInsideBase(bb, x, z, 10))) continue;
    if (world.isLava(x, z, y)) continue;
    const pos = { x, y, z };
    world.colliders.resolve(pos, 1.2, 3);
    if (Math.abs(pos.x - x) > 0.01 || Math.abs(pos.z - z) > 0.01) continue;
    return { x, y, z };
  }
  return null;
}
