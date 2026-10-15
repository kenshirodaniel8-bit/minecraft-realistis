// Builds the 3D world from the shared deterministic layout: terrain chunks,
// water, lava, props (instanced per region), structures (merged by
// material), plaza decorations, portals, signs and region barriers.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WATER_Y, terrainColor, PLAZA, PROP_TYPES } from '#shared/world.js';
import { REGIONS, REGION_BY_ID, RING, regionLockReason, regionIdAt } from '#shared/regions.js';
import { makeLabel } from './labels.js';
import { ARENA } from '#shared/moonSecret.js';
import { RARITIES } from '#shared/monsters.js';

const DEG = Math.PI / 180;
const CHUNK_CELLS = 32;
const PROP_CELL = 100;
const DETAIL_DIST = 110;
const DETAIL_PROPS = new Set(['flowers', 'fern', 'bush', 'bones', 'coral', 'fence', 'glow_mushroom']);

// ------------------------------------------------------------------ materials

const STRUCT_MATS = {
  // the base towers: studded blocks like the toy bricks in the reference
  base_wall: { color: 0x4a4c55, studs: true },
  base_trim: { color: 0xd7dae2, studs: true },
  base_floor: { color: 0x8a8d96, studs: true },
  stairs: { color: 0x9a9da6, studs: true },
  stairs_dark: { color: 0x82858e, studs: true },
  cave_rock: { color: 0x7d6e60 },
  ice_rock: { color: 0xc6e6fa },
  crystal_rock: { color: 0x8b7cd8, emissive: 0x2a1a5a },
  gold_stone: { color: 0xe8c860, emissive: 0x3a2a00 },
  sandstone: { color: 0xe2ba7c },
  temple: { color: 0xbab296 },
  vault_door: { color: 0x5c5444, emissive: 0x0f3a33 },
  nest: { color: 0x8c6c4c },
  counter: { color: 0xa8743c },
  stall_back: { color: 0xe0b886 },
  stall_post: { color: 0x7a4a24 },
  awning_red: { color: 0xee4a5a },
  awning_blue: { color: 0x4a8af0 },
  awning_gold: { color: 0xf3c234 },
  awning_black: { color: 0x26262e, emissive: 0x0a2a30 },
  awning_purple: { color: 0x9a5ae0, emissive: 0x2a0a4a },
  wood_dark: { color: 0x5c3c22 },
  // the Moon Sky Arena
  moon_stone: { color: 0xdcd6f6, emissive: 0x1c1844 },
  moon_rock: { color: 0x6a6490 },
  moon_arena: { color: 0xf0ecff, emissive: 0x242050 },
  moon_rim_0: { color: 0x4fc8ff, emissive: 0x2a8acc },
  moon_rim_1: { color: 0x6b7bff, emissive: 0x3a46cc },
  moon_rim_2: { color: 0xc46bff, emissive: 0x8a3acc },
  moon_rim_3: { color: 0xffb12a, emissive: 0xcc7a10 },
};

const matCache = new Map();
export function lambert(color, opts = {}) {
  const key = `${color}|${opts.emissive || 0}|${opts.flat ? 1 : 0}|${opts.opacity || 1}|${opts.vc ? 1 : 0}`;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshLambertMaterial({
    color,
    emissive: opts.emissive || 0,
    flatShading: !!opts.flat,
    transparent: (opts.opacity || 1) < 1,
    opacity: opts.opacity || 1,
    vertexColors: !!opts.vc,
  });
  matCache.set(key, m);
  return m;
}

// ------------------------------------------------------------------ prop models
// Each prop type is a list of parts: { geo, mat, colors? } with the geometry
// already positioned for a scale-1 prop standing at the origin.

function g(geo, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  return geo.clone().applyMatrix4(m);
}

function merge(list) {
  const clean = list.map((geo) => {
    const n = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    return n;
  });
  const out = mergeGeometries(clean, false);
  out.computeVertexNormals();
  return out;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const CONE = new THREE.ConeGeometry(0.5, 1, 8);
const ICO = new THREE.IcosahedronGeometry(1, 1);
const ICO0 = new THREE.IcosahedronGeometry(1, 0);
const DODE = new THREE.DodecahedronGeometry(1, 0);
const OCTA = new THREE.OctahedronGeometry(1, 0);
const SPH = new THREE.SphereGeometry(1, 10, 8);

let propPartsCache = null;
function propParts() {
  if (propPartsCache) return propPartsCache;
  const P = {};
  const flat = (c, o = {}) => lambert(c, { flat: true, ...o });
  P.tree_round = [
    { geo: merge([g(CYL6, 0, 2.2, 0, 0.9, 4.4, 0.9)]), mat: flat(0x8a5a32) },
    { geo: merge([g(ICO, 0, 6, 0, 3.1, 2.7, 3.1), g(ICO, 1.4, 7.6, 0.4, 1.9, 1.7, 1.9), g(ICO, -1.2, 7.2, -0.8, 1.7, 1.6, 1.7)]), mat: flat(0x5cc244), tint: [0x5cc244, 0x6fd04a, 0x4fb83e, 0x7ad65a] },
  ];
  P.bush = [{ geo: merge([g(ICO, 0, 0.7, 0, 1.3, 1.0, 1.3), g(ICO, 0.8, 0.6, 0.3, 0.8, 0.7, 0.8)]), mat: flat(0x4aa83a), tint: [0x4aa83a, 0x5cbc44, 0x3e9a34] }];
  P.flowers = [
    { geo: merge([g(CYL, 0, 0.35, 0, 0.08, 0.7, 0.08), g(CYL, 0.4, 0.3, 0.2, 0.08, 0.6, 0.08), g(CYL, -0.3, 0.3, 0.3, 0.08, 0.6, 0.08)]), mat: flat(0x3e9a34) },
    { geo: merge([g(ICO0, 0, 0.75, 0, 0.26, 0.2, 0.26), g(ICO0, 0.4, 0.65, 0.2, 0.22, 0.18, 0.22), g(ICO0, -0.3, 0.65, 0.3, 0.22, 0.18, 0.22)]), mat: flat(0xffffff), tint: [0xff7ab8, 0xffe14a, 0xffffff, 0xb48cff, 0xff8a4a, 0x7ad8ff] },
  ];
  P.rock = [{ geo: merge([g(DODE, 0, 0.6, 0, 1.4, 1.0, 1.2)]), mat: flat(0x9a968e), tint: [0x9a968e, 0x8a867e, 0xa8a49a] }];
  P.fence = [{ geo: merge([g(BOX, 0, 0.6, 0, 0.2, 1.2, 0.2)]), mat: flat(0xb08050) }];
  P.jungle_tree = [
    { geo: merge([g(CYL6, 0, 6, 0, 1.5, 12, 1.5), g(CYL6, 0.9, 1, 0, 0.6, 2.4, 0.6, 0, 0, -0.5), g(CYL6, -0.9, 1, 0.3, 0.6, 2.4, 0.6, 0, 0, 0.5)]), mat: flat(0x6a4a2a) },
    { geo: merge([g(ICO, 0, 12.5, 0, 5, 2.2, 5), g(ICO, 1.5, 14.2, 0.6, 3.4, 1.8, 3.4), g(ICO, -1.2, 10.8, -1.2, 3.8, 1.6, 3.8)]), mat: flat(0x2f8a34), tint: [0x2f8a34, 0x3a9a3a, 0x267a2e] },
  ];
  P.fern = [{ geo: merge([0, 1, 2, 3, 4].map((k) => g(BOX, Math.cos(k * 1.26) * 0.5, 0.45, Math.sin(k * 1.26) * 0.5, 0.25, 0.08, 1.3, 0.5, -k * 1.26 + Math.PI / 2, 0))), mat: flat(0x3fae44), tint: [0x3fae44, 0x52c24e, 0x2e9a3a] }];
  P.cactus = [{ geo: merge([g(CYL, 0, 2, 0, 1.1, 4, 1.1), g(SPH, 0, 4, 0, 0.55, 0.4, 0.55), g(CYL, 0.95, 2.2, 0, 0.6, 1.4, 0.6), g(CYL, 0.95, 3.0, 0, 0.6, 0.6, 0.6, 0, 0, 0), g(BOX, 0.55, 1.6, 0, 0.9, 0.5, 0.5), g(CYL, -0.9, 2.8, 0, 0.55, 1.2, 0.55), g(BOX, -0.55, 2.3, 0, 0.8, 0.45, 0.45)]), mat: flat(0x4caf50) }];
  P.desert_rock = [{ geo: merge([g(DODE, 0, 1.2, 0, 2.4, 1.8, 2.0), g(DODE, 1.6, 0.6, 0.8, 1.2, 1.0, 1.1)]), mat: flat(0xc98a52), tint: [0xc98a52, 0xd89a62, 0xb87a46] }];
  P.ruin_pillar = [{ geo: merge([g(CYL, 0, 3, 0, 1.6, 6, 1.6), g(BOX, 0, 6.2, 0, 2.2, 0.5, 2.2), g(BOX, 0, 0.2, 0, 2.3, 0.4, 2.3)]), mat: flat(0xc9c0a0), tint: [0xc9c0a0, 0xb8af90, 0xd8d0b0] }];
  P.ruin_wall = [{ geo: merge([g(BOX, 0, 1.6, 0, 4.4, 3.2, 0.9), g(BOX, -1.4, 3.6, 0, 1.6, 0.8, 0.9), g(BOX, 1.6, 0.2, 0.9, 1, 0.4, 1)]), mat: flat(0xbcb294) }];
  P.bones = [{ geo: merge([0, 1, 2, 3].map((k) => g(new THREE.TorusGeometry(1, 0.12, 5, 10, Math.PI), k * 0.6 - 0.9, 0, 0, 0.9, 1, 0.9, 0, Math.PI / 2, 0)).concat([g(CYL, 0, 0.1, 0, 0.2, 3, 0.2, 0, 0, Math.PI / 2)])), mat: flat(0xf3ead6) }];
  P.pine_snow = [
    { geo: merge([g(CYL6, 0, 1.2, 0, 0.7, 2.4, 0.7)]), mat: flat(0x6a4a30) },
    { geo: merge([g(CONE, 0, 3.4, 0, 4.2, 3.4, 4.2), g(CONE, 0, 5.4, 0, 3.2, 3, 3.2), g(CONE, 0, 7.2, 0, 2.2, 2.6, 2.2)]), mat: flat(0x2f6e4a) },
    { geo: merge([g(CONE, 0, 4.1, 0, 2.6, 1.6, 2.6), g(CONE, 0, 6.0, 0, 2.0, 1.5, 2.0), g(CONE, 0, 7.9, 0, 1.4, 1.3, 1.4)]), mat: flat(0xffffff) },
  ];
  P.ice_spike = [{ geo: merge([g(CONE, 0, 3, 0, 1.8, 6, 1.8), g(CONE, 1, 1.6, 0.4, 1, 3.2, 1, 0, 0, -0.3), g(CONE, -0.8, 1.3, -0.5, 0.9, 2.6, 0.9, 0.2, 0, 0.3)]), mat: lambert(0xa8e4ff, { flat: true, emissive: 0x15394a }) }];
  P.snow_rock = [
    { geo: merge([g(DODE, 0, 0.8, 0, 1.6, 1.2, 1.4)]), mat: flat(0x8a98a8) },
    { geo: merge([g(SPH, 0, 1.75, 0, 1.25, 0.45, 1.1)]), mat: flat(0xffffff) },
  ];
  P.palm = [
    { geo: merge([0, 1, 2, 3, 4].map((k) => g(CYL6, k * 0.22, 0.9 + k * 1.6, 0, 0.6 - k * 0.04, 1.7, 0.6 - k * 0.04, 0, 0, -0.12 - k * 0.02))), mat: flat(0xa8834a) },
    { geo: merge([0, 1, 2, 3, 4, 5].map((k) => g(BOX, 1.1 + Math.cos(k * 1.05) * 1.6, 8.6, Math.sin(k * 1.05) * 1.6, 3.4, 0.15, 0.9, 0, -k * 1.05, -0.35))), mat: flat(0x3fb84a) },
    { geo: merge([g(SPH, 1.0, 8.1, 0.4, 0.35, 0.35, 0.35), g(SPH, 1.4, 8.0, -0.3, 0.35, 0.35, 0.35)]), mat: flat(0x6a4a2a) },
  ];
  P.coral = [{ geo: merge([g(CYL, 0, 0.8, 0, 0.4, 1.6, 0.4), g(CYL, 0.4, 1.4, 0, 0.3, 1.2, 0.3, 0, 0, -0.6), g(CYL, -0.4, 1.3, 0.2, 0.3, 1.0, 0.3, 0.3, 0, 0.6), g(SPH, 0, 1.7, 0, 0.35, 0.35, 0.35), g(SPH, 0.85, 1.85, 0, 0.3, 0.3, 0.3), g(SPH, -0.75, 1.75, 0.3, 0.3, 0.3, 0.3)]), mat: flat(0xff7a9a), tint: [0xff7a9a, 0xff9f4a, 0xb48cff, 0x5ad8c8, 0xffd23a] }];
  P.shell_rock = [{ geo: merge([g(CONE, 0, 1, 0, 2, 2.4, 2, 0, 0, Math.PI / 2.4), g(SPH, -0.6, 0.8, 0, 1.1, 0.9, 1.1)]), mat: flat(0xffd0c0), tint: [0xffd0c0, 0xf8c8e0, 0xfff0d8] }];
  P.dark_tree = [
    { geo: merge([g(CYL6, 0, 2.5, 0, 0.9, 5, 0.9, 0, 0, 0.12), g(CYL6, 0.8, 5, 0, 0.45, 2.6, 0.45, 0, 0, -0.7), g(CYL6, -0.7, 4.6, 0.3, 0.4, 2.2, 0.4, 0.3, 0, 0.8)]), mat: flat(0x3a2a3a) },
    { geo: merge([g(ICO0, 0.3, 6.6, 0, 2.6, 2.2, 2.6), g(ICO0, 1.8, 6.3, 0.2, 1.4, 1.2, 1.4), g(ICO0, -1.3, 6.0, 0.5, 1.5, 1.3, 1.5)]), mat: flat(0x4a2f6a), tint: [0x4a2f6a, 0x3a2a5a, 0x5a3a7a] },
    { geo: merge([g(SPH, 1.2, 5.6, 1.2, 0.25, 0.25, 0.25), g(SPH, -1.4, 5.4, -0.8, 0.25, 0.25, 0.25), g(SPH, 0.2, 5.2, -1.6, 0.22, 0.22, 0.22)]), mat: lambert(0x9dff6a, { emissive: 0x6ad83a }) },
  ];
  P.glow_mushroom = [
    { geo: merge([g(CYL, 0, 0.8, 0, 0.45, 1.6, 0.45)]), mat: flat(0xf0ecf8) },
    { geo: merge([g(SPH, 0, 1.6, 0, 1.2, 0.6, 1.2)]), mat: lambert(0xffffff, { emissive: 0x404040 }), tint: [0x5affd8, 0x9dff6a, 0xb48cff, 0x5ad8ff] },
  ];
  P.crystal = [{ geo: merge([g(OCTA, 0, 1.8, 0, 0.8, 2.2, 0.8, 0, 0, 0.1), g(OCTA, 0.8, 1.1, 0.3, 0.5, 1.4, 0.5, 0.2, 0, -0.5), g(OCTA, -0.7, 1.0, -0.2, 0.5, 1.2, 0.5, -0.2, 0, 0.5)]), mat: lambert(0xffffff, { flat: true, emissive: 0x2a2050 }), tint: [0x9a8aff, 0x7ae8ff, 0xff9fe8, 0xb8a8ff] }];
  P.lava_rock = [
    { geo: merge([g(DODE, 0, 0.8, 0, 1.6, 1.2, 1.4)]), mat: flat(0x3a3030) },
    { geo: merge([g(BOX, 0, 1.6, 0, 1.0, 0.15, 0.25, 0, 0.4, 0), g(BOX, 0.3, 1.2, 0.9, 0.2, 0.6, 0.15)]), mat: lambert(0xff6a1f, { emissive: 0xff4a0f }) },
  ];
  P.obsidian = [{ geo: merge([g(OCTA, 0, 2.4, 0, 1, 3.2, 1), g(OCTA, 0.9, 1.3, 0.2, 0.6, 1.8, 0.6, 0, 0, -0.3)]), mat: lambert(0x1a1420, { flat: true, emissive: 0x150a20 }) }];
  P.dead_tree = [{ geo: merge([g(CYL6, 0, 2.2, 0, 0.6, 4.4, 0.6), g(CYL6, 0.6, 4, 0, 0.25, 2, 0.25, 0, 0, -0.8), g(CYL6, -0.5, 3.6, 0.2, 0.22, 1.8, 0.22, 0.3, 0, 0.9)]), mat: flat(0x5a4a44) }];
  P.golden_tree = [
    { geo: merge([g(CYL6, 0, 2.6, 0, 0.9, 5.2, 0.9)]), mat: flat(0xf4ecdc) },
    { geo: merge([g(ICO, 0, 6.8, 0, 3.2, 2.6, 3.2), g(ICO, 1.6, 8.0, 0.6, 1.8, 1.6, 1.8)]), mat: lambert(0xffd24a, { flat: true, emissive: 0x3a2800 }), tint: [0xffd24a, 0xffe27a, 0xffb83a] },
  ];
  P.blossom_tree = [
    { geo: merge([g(CYL6, 0, 2.4, 0, 0.8, 4.8, 0.8, 0, 0, 0.08)]), mat: flat(0x7a4a3a) },
    { geo: merge([g(ICO, 0.3, 6.2, 0, 3, 2.4, 3), g(ICO, 1.8, 7.0, 0.5, 1.7, 1.5, 1.7), g(ICO, -1.4, 6.6, -0.6, 1.6, 1.4, 1.6)]), mat: flat(0xff9fd0), tint: [0xff9fd0, 0xffb8e0, 0xff86c0, 0xffffff] },
  ];
  P.star_crystal = [{ geo: merge([g(OCTA, 0, 1.8, 0, 1, 1.8, 1), g(OCTA, 0, 1.8, 0, 1.6, 0.35, 0.35), g(OCTA, 0, 1.8, 0, 0.35, 0.35, 1.6)]), mat: lambert(0xfff27a, { flat: true, emissive: 0x6a5a10 }), tint: [0xfff27a, 0xffffff, 0x9fd8ff] }];
  propPartsCache = P;
  return P;
}

// ------------------------------------------------------------------ barrier shader

const BARRIER_MAT = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xff5a7a) } },
  vertexShader: `varying vec2 vUv; varying vec3 vPos; void main(){ vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying vec3 vPos;
    void main(){
      float stripe = step(0.5, fract((vPos.x + vPos.z) * 0.12 + vPos.y * 0.25 - uTime * 0.6));
      float fade = (1.0 - vUv.y) * 0.85 + 0.1;
      float edge = smoothstep(0.0, 0.08, vUv.y) ;
      gl_FragColor = vec4(mix(uColor, vec3(1.0), stripe * 0.35), (0.22 + stripe * 0.18) * fade * edge);
    }`,
});

// ------------------------------------------------------------------

export class WorldRenderer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.terrainChunks = [];
    this.animated = [];
    this.barriers = {};
    this.portalMeshes = {};
    this.time = 0;
  }

  build(onProgress = () => {}) {
    this.buildTerrain();
    onProgress(0.4);
    this.buildWater();
    this.buildProps();
    onProgress(0.7);
    this.buildStructures();
    this.buildPlaza();
    this.buildPortals();
    this.buildBarriers();
    this.buildSpots();
    this.buildMoon();
    onProgress(1);
  }

  // ---------------------------------------------------------------- terrain

  buildTerrain() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const patch of this.world.patches) {
      const n = patch.n;
      const chunks = Math.ceil((n - 1) / CHUNK_CELLS);
      for (let cj = 0; cj < chunks; cj++) {
        for (let ci = 0; ci < chunks; ci++) {
          const i0 = ci * CHUNK_CELLS;
          const j0 = cj * CHUNK_CELLS;
          const i1 = Math.min(n - 1, i0 + CHUNK_CELLS);
          const j1 = Math.min(n - 1, j0 + CHUNK_CELLS);
          const mesh = this.buildChunk(patch, i0, j0, i1, j1, mat);
          if (mesh) {
            this.root.add(mesh);
            this.terrainChunks.push(mesh);
          }
        }
      }
    }
  }

  buildChunk(patch, i0, j0, i1, j1, mat) {
    const w = i1 - i0 + 1;
    const h = j1 - j0 + 1;
    const H = (i, j) => patch.h[Math.min(patch.n - 1, Math.max(0, j)) * patch.n + Math.min(patch.n - 1, Math.max(0, i))];
    // skip chunks that are entirely deep sea floor (beyond the world)
    let maxH = -Infinity;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) maxH = Math.max(maxH, H(i, j));
    if (maxH < -12) return null;
    const pos = new Float32Array(w * h * 3);
    const col = new Float32Array(w * h * 3);
    const c = [0, 0, 0];
    let k = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = patch.x0 + i * CELL;
        const z = patch.z0 + j * CELL;
        const y = H(i, j);
        const slope = Math.max(Math.abs(H(i + 1, j) - H(i - 1, j)), Math.abs(H(i, j + 1) - H(i, j - 1))) / (2 * CELL) * 2;
        terrainColor(this.world, x, z, y, slope, c);
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        col[k * 3] = c[0];
        col[k * 3 + 1] = c[1];
        col[k * 3 + 2] = c[2];
        k++;
      }
    }
    const idx = [];
    for (let j = 0; j < h - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = j * w + i;
        const b = a + 1;
        const d = a + w;
        const e = d + 1;
        idx.push(a, e, b, a, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  // ---------------------------------------------------------------- water & lava

  buildWater() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(4200, 2400, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x2ea6ee, transparent: true, opacity: 0.78, roughness: 0.18, metalness: 0.05 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    water.renderOrder = 1;
    this.root.add(water);
    this.water = water;

    const lavaMat = new THREE.MeshStandardMaterial({ color: 0xff5a10, emissive: 0xff4a00, emissiveIntensity: 1.4, roughness: 0.6 });
    this.lavaMat = lavaMat;
    for (const p of this.world.lavaPools) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(p.r + 1.5, 28), lavaMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, p.y, p.z);
      this.root.add(m);
      const light = new THREE.PointLight(0xff6a1f, 40, 40, 1.6);
      light.position.set(p.x, p.y + 4, p.z);
      this.root.add(light);
    }
    const lake = this.world.spots.find((s) => s.id === 'frost_lake');
    if (lake) {
      const ice = new THREE.Mesh(new THREE.CircleGeometry(lake.r, 40), new THREE.MeshStandardMaterial({ color: 0xcdeeff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 }));
      ice.rotation.x = -Math.PI / 2;
      ice.position.set(lake.x, lake.y + 0.06, lake.z);
      ice.receiveShadow = true;
      this.root.add(ice);
    }
  }

  // ---------------------------------------------------------------- props

  // Props are instanced per type within square cells, so whole cells are
  // frustum-culled and small decorations are dropped beyond DETAIL_DIST.
  buildProps() {
    const parts = propParts();
    const byCellType = new Map();
    for (const p of this.world.props) {
      const key = `${Math.floor(p.x / PROP_CELL)},${Math.floor(p.z / PROP_CELL)}|${p.type}`;
      if (!byCellType.has(key)) byCellType.set(key, []);
      byCellType.get(key).push(p);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    this.propMeshes = [];
    for (const [key, list] of byCellType) {
      const type = key.split('|')[1];
      const defs = parts[type];
      if (!defs) continue;
      for (const part of defs) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach((p, i) => {
          q.setFromAxisAngle(up, p.rot);
          const squash = type === 'rock' || type === 'desert_rock' ? 0.75 + ((Math.floor(p.x * 7 + p.z * 13) & 1023) % 10) / 20 : 1;
          m4.compose(new THREE.Vector3(p.x, p.y - 0.15, p.z), q, new THREE.Vector3(p.s, p.s * squash, p.s));
          mesh.setMatrixAt(i, m4);
          if (part.tint) {
            color.setHex(part.tint[Math.abs(Math.floor(p.x * 3 + p.z * 5)) % part.tint.length]);
            mesh.setColorAt(i, color);
          }
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        const big = PROP_TYPES[type].r > 0.9;
        mesh.castShadow = big;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        this.propMeshes.push({ mesh, sphere: mesh.boundingSphere, detail: DETAIL_PROPS.has(type) });
      }
    }
  }

  cullProps(camPos) {
    for (const p of this.propMeshes) {
      if (!p.detail) continue;
      p.mesh.visible = p.sphere.center.distanceTo(camPos) - p.sphere.radius < DETAIL_DIST;
    }
  }

  // ---------------------------------------------------------------- structures

  buildStructures() {
    const groups = new Map();
    const door = [];
    for (const b of this.world.boxes) {
      if (b.invisible) continue; // collision-only (e.g. the glass in base windows)
      const geo = g(BOX, b.x, b.y, b.z, b.hw * 2, b.hh * 2, b.hd * 2, 0, -b.rot, 0);
      if (b.door) {
        door.push(geo);
        continue;
      }
      // one mesh per material per base, so whole towers can be culled
      const key = `${b.mat}|${b.base ?? ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(geo);
    }
    for (const [key, list] of groups) {
      const name = key.split('|')[0];
      const def = STRUCT_MATS[name] || { color: 0xcccccc };
      const geo = merge(list);
      let material;
      if (def.studs) {
        boxUV(geo, 1.25);
        material = studMaterial(def.color);
      } else {
        material = lambert(def.color, { flat: true, emissive: def.emissive });
      }
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    if (door.length) {
      this.vaultDoor = new THREE.Mesh(merge(door), lambert(STRUCT_MATS.vault_door.color, { flat: true, emissive: STRUCT_MATS.vault_door.emissive }));
      this.vaultDoor.castShadow = true;
      this.root.add(this.vaultDoor);
    }
  }

  setVaultOpen(open) {
    if (this.vaultDoor) this.vaultDoor.visible = !open;
  }

  // ---------------------------------------------------------------- plaza

  buildPlaza() {
    const y = PLAZA.y;
    const stone = lambert(0xd8d2c4, { flat: true });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.6, 1.2, 20), stone);
    basin.position.set(0, y + 0.6, 0);
    basin.castShadow = basin.receiveShadow = true;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.2, 20), new THREE.MeshStandardMaterial({ color: 0x5ac8ff, roughness: 0.1, transparent: true, opacity: 0.85 }));
    water.position.set(0, y + 1.1, 0);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1, 4, 10), stone);
    column.position.set(0, y + 2.6, 0);
    const top = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), lambert(0xffd23a, { emissive: 0x3a2a00 }));
    top.position.set(0, y + 5.2, 0);
    this.fountainTop = top;
    this.root.add(basin, water, column, top);
    this.animated.push((t) => {
      top.position.y = y + 5.2 + Math.sin(t * 1.5) * 0.25;
      top.rotation.y = t * 0.6;
    });
    const title = makeLabel('STEAL A MONSTER', { font: '900 64px "Trebuchet MS", system-ui, sans-serif', color: '#ffe14a', strokeColor: '#5a2a8a', strokeWidth: 12, scale: 0.05 });
    title.position.set(0, y + 9, 0);
    this.root.add(title);

    for (const shop of this.world.shops) {
      const sign = {
        swords: ['⚔ SWORD SHOP', '#d8384a'], items: ['🥊 GADGET SHOP', '#3a7ae0'], board: ['🍀 LUCKY BOARD', '#e0a020'],
        costumes: ['🕶 COSTUME SHOP', '#26262e'], power: ['💪 UPGRADE YOUR POWER', '#8a4ad8'],
      }[shop.kind];
      const label = makeLabel(sign[0], { color: '#ffffff', bg: sign[1], border: shop.kind === 'costumes' ? '#5ff3ff' : '#ffffff', scale: 0.035 });
      const back = { x: shop.x - Math.cos(shop.facing * DEG) * 3, z: shop.z - Math.sin(shop.facing * DEG) * 3 };
      label.position.set(back.x, y + 9.4, back.z);
      this.root.add(label);
    }
    // benches & lamps around the plaza
    const wood = lambert(0xa0703a, { flat: true });
    const metal = lambert(0x3a3a4a, { flat: true });
    const glow = lambert(0xfff2c0, { emissive: 0xffe08a });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const lx = Math.cos(a) * (PLAZA.r - 3);
      const lz = Math.sin(a) * (PLAZA.r - 3);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 5, 6), metal);
      pole.position.set(lx, y + 2.5, lz);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), glow);
      lamp.position.set(lx, y + 5.2, lz);
      this.root.add(pole, lamp);
      if (k % 2 === 0) {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 1), wood);
        const ba = a + 0.25;
        bench.position.set(Math.cos(ba) * (PLAZA.r - 4), y + 0.8, Math.sin(ba) * (PLAZA.r - 4));
        bench.rotation.y = -ba + Math.PI / 2;
        bench.castShadow = true;
        this.root.add(bench);
      }
    }
  }

  // ---------------------------------------------------------------- portals

  buildPortals() {
    const stone = lambert(0x9a8fb8, { flat: true });
    const gold = lambert(0xffc94a, { flat: true });
    for (const p of [...this.world.portals, { ...this.world.gate, gate: true }]) {
      const grp = new THREE.Group();
      const yaw = Math.atan2(p.x, p.z);
      grp.position.set(p.x, p.y, p.z);
      grp.rotation.y = yaw;
      if (p.gate) {
        // the Island Gate: a bigger golden arch with a rainbow swirl
        grp.scale.setScalar(1.25);
        for (let k = 0; k < 7; k++) {
          const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: [0xff6b9d, 0xffb84a, 0xfff06a, 0x6be08a, 0x5ab8ff, 0x9a7bff, 0xff7ae0][k], emissive: [0xff6b9d, 0xffb84a, 0xfff06a, 0x6be08a, 0x5ab8ff, 0x9a7bff, 0xff7ae0][k], emissiveIntensity: 0.6 }));
          gem.position.set(-3 + k, 9.3, 0.9);
          grp.add(gem);
        }
      }
      for (const sgn of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 8, 1.4), p.gate ? gold : stone);
        pillar.position.set(3.4 * sgn, 4, 0);
        pillar.castShadow = true;
        grp.add(pillar);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.2, 1.6), p.gate ? gold : stone);
      lintel.position.set(0, 8.4, 0);
      grp.add(lintel);
      const region = REGION_BY_ID[p.region || 'plains'];
      const color = new THREE.Color(p.gate ? 0xff9fd8 : region.id === 'plains' ? 0x7af0ff : region.colors.accent);
      const swirl = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 7.4),
        new THREE.ShaderMaterial({
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          uniforms: { uTime: { value: 0 }, uColor: { value: color }, uOn: { value: 1 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uOn; varying vec2 vUv;
            void main(){ vec2 c = vUv - 0.5; float r = length(c * vec2(1.0, 0.75)); float a = atan(c.y, c.x);
              float s = 0.5 + 0.5 * sin(a * 4.0 + r * 18.0 - uTime * 4.0);
              vec3 col = mix(uColor, vec3(1.0), s * 0.5);
              float alpha = smoothstep(0.5, 0.35, r) * (0.55 + 0.35 * s);
              col = mix(vec3(0.35), col, uOn); alpha *= mix(0.35, 1.0, uOn);
              gl_FragColor = vec4(col, alpha); }`,
        }),
      );
      swirl.position.set(0, 4, 0);
      grp.add(swirl);
      const label = makeLabel(p.gate ? '🌴 Island Gate' : p.region === 'plains' ? '🏠 Plaza' : `✨ ${p.name}`, { scale: 0.028, color: p.gate ? '#fff3a8' : '#ffffff' });
      label.position.set(0, 10.4, 0);
      grp.add(label);
      this.root.add(grp);
      if (!p.gate) this.portalMeshes[p.id] = { group: grp, swirl, label, portal: p };
      this.animated.push((t) => { swirl.material.uniforms.uTime.value = t; });
    }
  }

  setPortalStates(activeRegions, minPop) {
    for (const { swirl, portal, label } of Object.values(this.portalMeshes)) {
      const on = portal.region === 'plains' || activeRegions.has(portal.region);
      swirl.material.uniforms.uOn.value = on ? 1 : 0;
      if (!on && !label.userData.closed) {
        label.userData.closed = true;
        const need = minPop?.[portal.region] ?? REGION_BY_ID[portal.region].minPopulation;
        const nl = makeLabel(`🔒 ${portal.name}\nopens at ${need}+ players`, { scale: 0.024, color: '#ffd0d0' });
        nl.position.copy(label.position);
        label.parent.add(nl);
        label.visible = false;
        label.userData.closedLabel = nl;
      } else if (on && label.userData.closed) {
        label.userData.closed = false;
        label.visible = true;
        label.userData.closedLabel?.removeFromParent();
      }
    }
  }

  // ---------------------------------------------------------------- region barriers & signs

  buildBarriers() {
    const pts = (r, a0, a1) => {
      if (a1 < a0) a1 += 360;
      const out = [];
      const n = Math.max(8, Math.round(((a1 - a0) * DEG * r) / 4));
      for (let i = 0; i <= n; i++) {
        const a = (a0 + ((a1 - a0) * i) / n) * DEG;
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return out;
    };
    const radial = (a, r1, r2) => {
      const out = [];
      const n = Math.round((r2 - r1) / 4);
      for (let i = 0; i <= n; i++) {
        const r = r1 + ((r2 - r1) * i) / n;
        out.push([Math.cos(a * DEG) * r, Math.sin(a * DEG) * r]);
      }
      return out;
    };
    for (const region of REGIONS) {
      const s = region.shape;
      let paths = [];
      if (s.kind === 'sector') paths = [pts(s.r1, s.a0, s.a1), pts(s.r2 - 0.5, s.a0, s.a1), radial(s.a0, s.r1, s.r2), radial(s.a1, s.r1, s.r2)];
      else if (s.kind === 'ring') paths = [pts(s.r1, 0, 360)];
      if (!paths.length) continue;
      const geos = paths.map((p) => this.curtain(p, 9));
      const mat = BARRIER_MAT.clone();
      mat.uniforms.uColor.value = new THREE.Color(0xff5a7a);
      const mesh = new THREE.Mesh(merge2(geos), mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.animated.push((t) => { mat.uniforms.uTime.value = t; });
      // signs where the roads cross into the region
      const signs = new THREE.Group();
      const roadAngles = s.kind === 'ring' ? [0, 90, 180, 270] : [((s.a0 + (s.a1 < s.a0 ? s.a1 + 360 : s.a1)) / 2) % 360];
      for (const a of roadAngles) {
        const r = (s.kind === 'ring' ? s.r1 : s.r1) - 3;
        const x = Math.cos(a * DEG) * r + Math.cos((a + 90) * DEG) * 6;
        const z = Math.sin(a * DEG) * r + Math.sin((a + 90) * DEG) * 6;
        const yy = Math.max(this.world.groundHeight(x, z), WATER_Y);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), lambert(0x8a5a32, { flat: true }));
        post.position.set(x, yy + 2.5, z);
        signs.add(post);
        const lbl = makeLabel(`${region.name}\nLevel ${region.unlock.level || 1}+${region.unlock.swordTier ? ` · Tier ${region.unlock.swordTier} sword` : ''}`, {
          bg: '#2a2340', border: region.colors ? '#' + region.colors.accent.toString(16).padStart(6, '0') : '#ffffff', scale: 0.022, colors: ['#ffffff', '#ffe27a'], fog: true,
        });
        lbl.position.set(x, yy + 6, z);
        signs.add(lbl);
      }
      this.root.add(signs);
      this.barriers[region.id] = mesh;
    }
  }

  curtain(points, height) {
    const pos = [];
    const uv = [];
    const idx = [];
    points.forEach(([x, z], i) => {
      const y0 = Math.max(this.world.groundHeight(x, z), WATER_Y) - 1;
      pos.push(x, y0, z, x, y0 + height, z);
      uv.push(i / points.length, 0, i / points.length, 1);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }

  updateBarriers(progress, active) {
    for (const [id, mesh] of Object.entries(this.barriers)) {
      mesh.visible = !!regionLockReason(REGION_BY_ID[id], progress, active);
    }
  }

  // ---------------------------------------------------------------- spots

  buildSpots() {
    // ruins puzzle plates and the carved hint
    const plateMat = lambert(0x8a8270, { flat: true });
    this.plates = {};
    for (const p of this.world.puzzle.plates) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(this.world.puzzle.plateRadius, this.world.puzzle.plateRadius + 0.3, 0.4, 16), plateMat.clone());
      m.position.set(p.x, p.y + 0.2, p.z);
      m.receiveShadow = true;
      this.root.add(m);
      const icon = { Sun: '☀', Moon: '☾', Star: '★' }[p.symbol];
      const lbl = makeLabel(icon, { font: '900 90px system-ui', scale: 0.03, color: '#ffe9a0' });
      lbl.position.set(p.x, p.y + 2.2, p.z);
      this.root.add(lbl);
      this.plates[p.id] = m;
    }
    const c = this.world.puzzle.center;
    const hint = makeLabel('☾ → ★ → ☀', { font: '900 70px system-ui', scale: 0.04, color: '#7affd8', bg: 'rgba(30,40,40,0.75)' });
    hint.position.set(c.x + 13, this.world.groundHeight(c.x, c.z) + 11.5, c.z);
    this.root.add(hint);
  }

  setPuzzleState(state, serverNow) {
    const open = state.openUntil > serverNow;
    const lit = new Set(state.progress || []);
    for (const [id, m] of Object.entries(this.plates)) {
      const on = open || lit.has(Number(id));
      m.material.emissive.setHex(on ? 0x2affc0 : 0x000000);
    }
    this.setVaultOpen(open);
  }

  // ---------------------------------------------------------------- the moon secret

  buildMoon() {
    const moon = this.world.moon;
    // the five small moon buttons on Cute Monster Island
    const tex = moonButtonTexture();
    const rimMat = lambert(0xf3ead2, { flat: true });
    this.moonButtons = moon.buttons.map((b) => {
      const grp = new THREE.Group();
      grp.position.set(b.x, b.y, b.z);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.35, 0.32, 20), rimMat);
      rim.position.y = 0.12;
      rim.receiveShadow = true;
      const face = new THREE.MeshLambertMaterial({ map: tex, color: 0xfff3c4, emissive: 0x000000 });
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.14, 24), [rimMat, face, rimMat]);
      top.position.y = 0.32;
      top.rotation.y = b.id;
      grp.add(rim, top);
      this.root.add(grp);
      return { grp, face, top, found: false, pop: 0 };
    });

    // the secret portal (appears when all five are lit)
    const p = moon.portal;
    const portal = new THREE.Group();
    portal.position.set(p.x, p.y, p.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.38, 10, 40), new THREE.MeshLambertMaterial({ color: 0xfff3c4, emissive: 0x6a7aff }));
    ring.position.y = 4.2;
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(3.1, 40), swirlMaterial(0x8fb8ff));
    swirl.position.y = 4.2;
    const crescent = makeLabel('☾', { font: '900 120px system-ui', scale: 0.03, color: '#fff3a8' });
    crescent.position.y = 9;
    const lbl = makeLabel('🌙 Moon Portal', { scale: 0.026, color: '#cfe0ff' });
    lbl.position.y = 10.6;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4, 0.4, 28), lambert(0xd8d2ff, { flat: true, emissive: 0x2a2a6a }));
    pad.position.y = 0.2;
    portal.add(pad, ring, swirl, crescent, lbl);
    portal.visible = false;
    this.root.add(portal);
    this.moonPortal = { group: portal, swirl, appear: 0 };
    this.animated.push((t) => {
      swirl.material.uniforms.uTime.value = t;
      ring.rotation.y = swirl.rotation.y = Math.sin(t * 0.4) * 0.6;
    });

    // the Moon Sky Arena: a giant moon, stars, clouds below and round signs
    const arena = new THREE.Group();
    const bigMoon = new THREE.Mesh(new THREE.SphereGeometry(46, 32, 20), new THREE.MeshBasicMaterial({ color: 0xfff6d0, fog: false }));
    bigMoon.position.set(ARENA.cx - 90, 150, ARENA.cz - 230);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(58, 24, 16), new THREE.MeshBasicMaterial({ color: 0xbfc8ff, transparent: true, opacity: 0.18, fog: false, depthWrite: false }));
    glow.position.copy(bigMoon.position);
    const starPos = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 700; i++) {
      const a = rnd() * Math.PI * 2;
      const e = rnd() * 1.2 - 0.1;
      const r = 240 + rnd() * 60;
      starPos.push(ARENA.cx + Math.cos(a) * Math.cos(e) * r, 20 + Math.sin(e) * r, ARENA.cz + Math.sin(a) * Math.cos(e) * r);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, fog: false, sizeAttenuation: true }));
    const clouds = new THREE.Mesh(new THREE.CircleGeometry(170, 48), new THREE.MeshBasicMaterial({ color: 0x1c1846, transparent: true, opacity: 0.9, fog: false }));
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.set(ARENA.cx, -13, ARENA.cz);
    arena.add(bigMoon, glow, stars, clouds);
    for (let k = 0; k < 18; k++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(10 + rnd() * 10, 10, 8), lambert(0x5a4aa8, { flat: true, emissive: 0x1a1450 }));
      const a = rnd() * Math.PI * 2;
      const r = 40 + rnd() * 110;
      puff.scale.y = 0.3;
      puff.position.set(ARENA.cx + Math.cos(a) * r, -9 + rnd() * 3, ARENA.cz + Math.sin(a) * r);
      arena.add(puff);
    }
    const s0 = moon.start;
    const startLbl = makeLabel('🌙 Moon Sky Arena\nJump across the stones!', { scale: 0.02, color: '#ffffff', bg: 'rgba(40,30,90,0.8)' });
    startLbl.position.set(s0.x, s0.y + 9, s0.z + 4);
    arena.add(startLbl);
    moon.platforms.forEach((pl, k) => {
      const r = RARITIES[moon.rounds[k]];
      const l = makeLabel(`Round ${k + 1}\n${r.name}`, { scale: 0.032, colors: ['#ffffff', r.color], bg: 'rgba(30,24,70,0.82)', border: r.color });
      l.position.set(pl.x, pl.top + 8, pl.z);
      arena.add(l);
    });
    this.root.add(arena);
    this.moonArena = arena;
  }

  // found: ids of the buttons this player has lit; portal shows at 5/5
  setMoonState(state, burst) {
    if (!this.moonButtons || !state) return;
    const found = new Set(state.found);
    for (let i = 0; i < this.moonButtons.length; i++) {
      const b = this.moonButtons[i];
      const on = found.has(i);
      if (on && !b.found && burst) b.pop = 1;
      b.found = on;
      b.face.color.setHex(on ? 0x8fc4ff : 0xfff3c4);
      b.face.emissive.setHex(on ? 0x2a6cff : 0x000000);
    }
    const open = found.size >= this.moonButtons.length;
    const g = this.moonPortal.group;
    if (open && !g.visible) {
      g.visible = true;
      this.moonPortal.appear = burst ? 0.01 : 1;
    } else if (!open) g.visible = false;
  }

  updateMoon(dt, camPos) {
    if (!this.moonButtons) return;
    for (const b of this.moonButtons) {
      if (b.pop > 0) {
        b.pop = Math.max(0, b.pop - dt * 1.6);
        b.top.position.y = 0.32 + Math.sin(b.pop * Math.PI) * 0.6;
      }
    }
    const mp = this.moonPortal;
    if (mp.group.visible && mp.appear < 1) {
      mp.appear = Math.min(1, mp.appear + dt * 0.8);
      const k = mp.appear;
      mp.group.scale.setScalar(k < 0.7 ? (k / 0.7) * 1.15 : 1.15 - ((k - 0.7) / 0.3) * 0.15);
    }
    if (camPos) this.moonArena.visible = Math.hypot(camPos.x - ARENA.cx, camPos.z - ARENA.cz) < 520;
  }

  update(dt, t, camPos) {
    this.time = t;
    this.updateMoon(dt, camPos);
    if (camPos && this.propMeshes) this.cullProps(camPos);
    for (const fn of this.animated) fn(t);
    if (this.lavaMat) this.lavaMat.emissiveIntensity = 1.2 + Math.sin(t * 2) * 0.3;
  }
}

// Studded toy-brick texture (grey, tinted by the material colour).
let studTex = null;
const studMats = new Map();
function studMaterial(color) {
  if (!studTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d4d4d4';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#b8b8b8'; // seams between bricks
    ctx.fillRect(0, 62, 64, 2);
    ctx.fillRect(62, 0, 2, 64);
    const g = ctx.createRadialGradient(28, 28, 2, 32, 32, 17);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#e2e2e2');
    g.addColorStop(1, '#9a9a9a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 32, 16, 0, Math.PI * 2);
    ctx.fill();
    studTex = new THREE.CanvasTexture(c);
    studTex.wrapS = studTex.wrapT = THREE.RepeatWrapping;
    studTex.colorSpace = THREE.SRGBColorSpace;
    studTex.anisotropy = 4;
  }
  if (!studMats.has(color)) studMats.set(color, new THREE.MeshLambertMaterial({ color, map: studTex }));
  return studMats.get(color);
}

// Box-projected UVs from world positions, so the stud pattern has the same
// size on every wall, floor and step however the boxes are scaled.
function boxUV(geo, size) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let a;
    let b;
    if (ay >= ax && ay >= az) {
      a = pos.getX(i);
      b = pos.getZ(i);
    } else if (ax >= az) {
      a = pos.getZ(i);
      b = pos.getY(i);
    } else {
      a = pos.getX(i);
      b = pos.getY(i);
    }
    uv[i * 2] = a / size;
    uv[i * 2 + 1] = b / size;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// A small round button face with a crescent moon on it.
let moonTex = null;
function moonButtonTexture() {
  if (moonTex) return moonTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#e8e2ff';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd84a';
  ctx.beginPath();
  ctx.arc(64, 64, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8e2ff'; // bite out of the full moon -> a crescent
  ctx.beginPath();
  ctx.arc(80, 52, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe98a';
  for (const [x, y, r] of [[92, 88, 5], [100, 66, 3], [38, 30, 3]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  moonTex = new THREE.CanvasTexture(c);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  return moonTex;
}

function swirlMaterial(hex) {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(hex) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main(){ vec2 c = vUv - 0.5; float r = length(c); float a = atan(c.y, c.x);
        float s = 0.5 + 0.5 * sin(a * 5.0 + r * 22.0 - uTime * 5.0);
        vec3 col = mix(uColor, vec3(1.0, 0.97, 0.8), s * 0.55);
        float alpha = smoothstep(0.5, 0.3, r) * (0.6 + 0.35 * s);
        gl_FragColor = vec4(col, alpha); }`,
  });
}

function regionOf(p) {
  return regionIdAt(p.x, p.z);
}

function merge2(geos) {
  return mergeGeometries(geos, false);
}

export { RING };
