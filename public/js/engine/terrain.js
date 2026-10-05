// Deterministic procedural terrain generator. Every chunk is a pure function of
// (seed, cx, cz), so the server only has to remember player edits and every
// client regenerates identical terrain locally.

import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, CHUNK_VOLUME, blockIndex } from './constants.js';
import { SimplexNoise, hash2, hash3, hashInt, mulberry32 } from './noise.js';
import { B, IS_OPAQUE } from './blocks.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, JUNGLE: 4, DESERT: 5,
  TAIGA: 6, SNOWY: 7, MOUNTAINS: 8, BIRCH_FOREST: 9, RIVER: 10,
};
export const BIOME_NAMES = Object.fromEntries(Object.entries(BIOME).map(([k, v]) => [v, k.replace('_', ' ').toLowerCase()]));

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }

// Piecewise-linear spline used to shape continent height.
const CONT_X = [-1.0, -0.42, -0.22, -0.12, -0.04, 0.12, 0.35, 1.0];
const CONT_Y = [-30, -17, -6, -1, 2, 6, 13, 26];
function continentHeight(c) {
  if (c <= CONT_X[0]) return CONT_Y[0];
  for (let i = 1; i < CONT_X.length; i++) {
    if (c <= CONT_X[i]) {
      const t = (c - CONT_X[i - 1]) / (CONT_X[i] - CONT_X[i - 1]);
      return lerp(CONT_Y[i - 1], CONT_Y[i], t);
    }
  }
  return CONT_Y[CONT_Y.length - 1];
}

const CAVE_STEP = 4;
const CAVE_LY = WORLD_HEIGHT / CAVE_STEP + 1;

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed >>> 0;
    const s = this.seed;
    this.nContinent = new SimplexNoise(s ^ 0x1f123bb5);
    this.nErosion = new SimplexNoise(s ^ 0x2a9b7c11);
    this.nMountain = new SimplexNoise(s ^ 0x3c6ef372);
    this.nDetail = new SimplexNoise(s ^ 0x4b0d2f9a);
    this.nRiver = new SimplexNoise(s ^ 0x5e3779b9);
    this.nTemp = new SimplexNoise(s ^ 0x6a09e667);
    this.nHumid = new SimplexNoise(s ^ 0x7f4a7c15);
    this.nCave1 = new SimplexNoise(s ^ 0x8badf00d);
    this.nCave2 = new SimplexNoise(s ^ 0x9e3779b1);
    this.nCave3 = new SimplexNoise(s ^ 0xa54ff53a);
    this.nPatch = new SimplexNoise(s ^ 0xb5ad4ece);
    this.colCache = new Map();
  }

  // Temperature / humidity in roughly [-1, 1]. Smooth, so biome colours blend.
  climate(x, z) {
    const t = this.nTemp.fbm2(x / 720, z / 720, 3) * 1.15;
    const m = this.nHumid.fbm2(x / 610 + 91.3, z / 610 - 47.1, 3) * 1.15;
    return [t, m];
  }

  // Grass tint (sRGB 0..1) from climate. Hot+wet = lush jungle green.
  static grassColor(t, m) {
    const tt = clamp((t + 0.55) / 1.1, 0, 1);
    const mm = clamp((m + 0.55) / 1.1, 0, 1);
    const coldDry = [0.56, 0.66, 0.50], coldWet = [0.40, 0.62, 0.44];
    const hotDry = [0.78, 0.71, 0.34], hotWet = [0.30, 0.80, 0.14];
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const cold = lerp(coldDry[i], coldWet[i], mm);
      const hot = lerp(hotDry[i], hotWet[i], mm);
      out[i] = lerp(cold, hot, tt);
    }
    return out;
  }

  static foliageColor(t, m) {
    const g = TerrainGenerator.grassColor(t, m);
    return [g[0] * 0.82, g[1] * 0.9, g[2] * 0.78];
  }

  column(x, z) {
    const key = x * 131072 + z;
    let c = this.colCache.get(key);
    if (c) return c;
    if (this.colCache.size > 120000) this.colCache.clear();

    const cont = this.nContinent.fbm2(x / 1000, z / 1000, 5) * 1.25;
    const ero = this.nErosion.fbm2(x / 520 + 100.5, z / 520 - 33.2, 3);
    const ridge = this.nMountain.ridged2(x / 280, z / 280, 5);
    const detail = this.nDetail.fbm2(x / 64, z / 64, 4);

    let h = SEA_LEVEL + continentHeight(cont);
    const mountainness = smoothstep(-0.02, 0.5, cont) * smoothstep(0.55, -0.35, ero);
    h += mountainness * Math.pow(ridge, 2.1) * 64;
    const hilliness = 2.5 + 6 * smoothstep(-0.3, 0.5, -ero) + 10 * mountainness;
    h += detail * hilliness;

    // Rivers carve winding valleys across the land.
    let river = 0;
    if (h > SEA_LEVEL - 2) {
      const rv = Math.abs(this.nRiver.fbm2(x / 380, z / 380, 3));
      const rf = smoothstep(0.012, 0.06, rv);
      const strength = 1 - mountainness * 0.85;
      if (rf < 1 && strength > 0) {
        const target = SEA_LEVEL - 3 - (1 - rf) * 1.5;
        const nh = lerp(target, h, rf);
        h = lerp(h, Math.min(h, nh), strength);
        if (rf < 0.35 && strength > 0.5) river = 1;
      }
    }

    h = Math.round(clamp(h, 6, WORLD_HEIGHT - 10));

    const [t0, m] = this.climate(x, z);
    const t = t0 - Math.max(0, h - 88) * 0.025;

    let biome;
    if (h < SEA_LEVEL) {
      biome = river ? BIOME.RIVER : BIOME.OCEAN;
    } else if (river && h <= SEA_LEVEL + 1) {
      biome = BIOME.RIVER;
    } else if (h <= SEA_LEVEL + 2 && cont < -0.06) {
      biome = BIOME.BEACH;
    } else if (h > 100) {
      biome = BIOME.MOUNTAINS;
    } else if (t < -0.34) {
      biome = BIOME.SNOWY;
    } else if (t < -0.13) {
      biome = BIOME.TAIGA;
    } else if (t > 0.26 && m < -0.06) {
      biome = BIOME.DESERT;
    } else if (t > 0.12 && m > 0.1) {
      biome = BIOME.JUNGLE;
    } else if (m > 0.02) {
      biome = (t < 0.02 && m > 0.22) ? BIOME.BIRCH_FOREST : BIOME.FOREST;
    } else {
      biome = BIOME.PLAINS;
    }

    c = { h, biome, t, m, cont };
    this.colCache.set(key, c);
    return c;
  }

  slopeAt(x, z) {
    const a = this.column(x + 1, z).h, b = this.column(x - 1, z).h;
    const c = this.column(x, z + 1).h, d = this.column(x, z - 1).h;
    return Math.max(Math.abs(a - b), Math.abs(c - d));
  }

  // How many blocks below the surface caves are forbidden to reach.
  caveProtect(x, z) {
    const h = this.column(x, z).h;
    if (h <= SEA_LEVEL + 1) return 7;
    if (this.column(x + 1, z).h <= SEA_LEVEL || this.column(x - 1, z).h <= SEA_LEVEL ||
        this.column(x, z + 1).h <= SEA_LEVEL || this.column(x, z - 1).h <= SEA_LEVEL) return 7;
    return 0;
  }

  caveLattice(lx, ly, lz, out, o) {
    const x = lx * CAVE_STEP, y = ly * CAVE_STEP, z = lz * CAVE_STEP;
    out[o] = this.nCave1.noise3(x / 42, y / 26, z / 42);
    out[o + 1] = this.nCave2.noise3(x / 42 + 50, y / 26, z / 42 - 50);
    out[o + 2] = this.nCave3.noise3(x / 72, y / 38, z / 72);
  }

  static caveTest(n1, n2, n3, y) {
    if (y < 5) return false;
    if (n1 * n1 + n2 * n2 < 0.0105) return true;
    if (y < 52 && y > 8 && n3 > 0.56) return true;
    return false;
  }

  // Direct (non-batched) cave test used to validate features in neighbouring chunks.
  isCarved(x, y, z) {
    if (y < 5 || y >= WORLD_HEIGHT) return false;
    const col = this.column(x, z);
    if (y > col.h) return false;
    const protect = this.caveProtect(x, z);
    if (protect && y > col.h - protect) return false;
    const lx = Math.floor(x / CAVE_STEP), ly = Math.floor(y / CAVE_STEP), lz = Math.floor(z / CAVE_STEP);
    const fx = (x - lx * CAVE_STEP) / CAVE_STEP, fy = (y - ly * CAVE_STEP) / CAVE_STEP, fz = (z - lz * CAVE_STEP) / CAVE_STEP;
    const c = new Float64Array(24);
    let o = 0;
    for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      this.caveLattice(lx + dx, ly + dy, lz + dz, c, o); o += 3;
    }
    const v = [0, 0, 0];
    for (let k = 0; k < 3; k++) v[k] = trilerp(c, k, fx, fy, fz);
    return TerrainGenerator.caveTest(v[0], v[1], v[2], y);
  }

  surfaceBlocks(col, slope, x, z) {
    // Returns [top, filler, fillerDepth].
    const r = hash2(x, z, this.seed ^ 0x1234);
    const depth = 3 + (r * 2 | 0);
    const patch = this.nPatch.noise2(x / 9, z / 9);
    switch (col.biome) {
      case BIOME.OCEAN:
        if (col.h < SEA_LEVEL - 9) return [B.GRAVEL, B.GRAVEL, 3];
        return patch > 0.55 ? [B.CLAY, B.CLAY, 2] : [B.SAND, B.SAND, 3];
      case BIOME.RIVER:
        return patch > 0.45 ? [B.GRAVEL, B.GRAVEL, 2] : (patch < -0.5 ? [B.CLAY, B.DIRT, 2] : [B.SAND, B.SAND, 3]);
      case BIOME.BEACH:
        return col.t < -0.3 ? [B.GRAVEL, B.GRAVEL, 3] : [B.SAND, B.SAND, 4];
      case BIOME.DESERT:
        return [B.SAND, B.SAND, 5];
      case BIOME.MOUNTAINS:
        if (col.h > 112 || (col.h > 104 && slope < 3)) return [B.SNOW, B.STONE, 1];
        if (slope >= 3) return [B.STONE, B.STONE, 1];
        return col.t < -0.25 ? [B.SNOW_GRASS, B.DIRT, 2] : [B.GRASS, B.DIRT, 2];
      case BIOME.SNOWY:
        if (slope >= 4) return [B.STONE, B.STONE, 1];
        return [B.SNOW_GRASS, B.DIRT, depth];
      case BIOME.TAIGA:
        if (slope >= 4) return [B.STONE, B.STONE, 1];
        return patch > 0.35 ? [B.PODZOL, B.DIRT, depth] : [B.GRASS, B.DIRT, depth];
      case BIOME.JUNGLE:
        if (slope >= 5) return [B.STONE, B.STONE, 1];
        return patch > 0.62 ? [B.MOSS_BLOCK, B.DIRT, depth] : [B.GRASS, B.DIRT, depth];
      default:
        if (slope >= 5) return [B.STONE, B.STONE, 1];
        return [B.GRASS, B.DIRT, depth];
    }
  }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const seed = this.seed;

    // Cave noise lattice for this chunk (5 x 33 x 5 points, 3 noises each).
    const LX = CHUNK_SIZE / CAVE_STEP + 1;
    const lat = new Float64Array(LX * LX * CAVE_LY * 3);
    const lx0 = x0 / CAVE_STEP, lz0 = z0 / CAVE_STEP;
    for (let lz = 0; lz < LX; lz++) for (let ly = 0; ly < CAVE_LY; ly++) for (let lx = 0; lx < LX; lx++) {
      this.caveLattice(lx0 + lx, ly, lz0 + lz, lat, ((lz * CAVE_LY + ly) * LX + lx) * 3);
    }
    const corner = new Float64Array(24);

    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = x0 + x, wz = z0 + z;
        const col = this.column(wx, wz);
        const h = col.h;
        heights[z * CHUNK_SIZE + x] = h;
        const slope = this.slopeAt(wx, wz);
        const [top, filler, depth] = this.surfaceBlocks(col, slope, wx, wz);
        const protect = this.caveProtect(wx, wz);
        const desertLayer = col.biome === BIOME.DESERT || col.biome === BIOME.BEACH;

        const lxi = (x / CAVE_STEP) | 0, lzi = (z / CAVE_STEP) | 0;
        const fx = (x - lxi * CAVE_STEP) / CAVE_STEP, fz = (z - lzi * CAVE_STEP) / CAVE_STEP;

        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y <= 3 && hash3(wx, y, wz, seed ^ 0xbed) < 0.55 - y * 0.15) id = B.BEDROCK;
          else if (y === h) id = top;
          else if (y > h - depth) id = filler;
          else if (desertLayer && y > h - depth - 4) id = B.SANDSTONE;
          else id = B.STONE;

          if (id !== B.BEDROCK && y >= 5 && !(protect && y > h - protect)) {
            const lyi = (y / CAVE_STEP) | 0;
            const fy = (y - lyi * CAVE_STEP) / CAVE_STEP;
            let o = 0;
            for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
              const li = (((lzi + dz) * CAVE_LY + (lyi + dy)) * LX + (lxi + dx)) * 3;
              corner[o] = lat[li]; corner[o + 1] = lat[li + 1]; corner[o + 2] = lat[li + 2];
              o += 3;
            }
            const n1 = trilerp(corner, 0, fx, fy, fz);
            const n2 = trilerp(corner, 1, fx, fy, fz);
            const n3 = trilerp(corner, 2, fx, fy, fz);
            if (TerrainGenerator.caveTest(n1, n2, n3, y)) id = B.AIR;
          }
          blocks[blockIndex(x, y, z)] = id;
        }

        // Oceans, rivers and lakes.
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          const frozen = y === SEA_LEVEL && (col.biome === BIOME.SNOWY || (col.t < -0.36 && col.biome !== BIOME.RIVER));
          blocks[blockIndex(x, y, z)] = frozen ? B.ICE : B.WATER;
        }
      }
    }

    this.placeOres(blocks, cx, cz);
    this.placeTrees(blocks, cx, cz);
    this.placePlants(blocks, cx, cz, heights);
    return blocks;
  }

  placeOres(blocks, cx, cz) {
    const rand = mulberry32(hashInt(cx, cz, this.seed ^ 0x0e5));
    const veins = [
      [B.COAL_ORE, 18, 6, 110, 10],
      [B.IRON_ORE, 12, 5, 64, 7],
      [B.GOLD_ORE, 4, 5, 32, 6],
      [B.DIAMOND_ORE, 2, 5, 16, 5],
      [B.GRANITE, 3, 5, 80, 30],
      [B.DIORITE, 3, 5, 80, 30],
      [B.ANDESITE, 3, 5, 80, 30],
      [B.GRAVEL, 2, 5, 64, 20],
      [B.DIRT, 2, 5, 70, 20],
    ];
    for (const [id, tries, minY, maxY, size] of veins) {
      for (let t = 0; t < tries; t++) {
        let x = (rand() * 16) | 0, z = (rand() * 16) | 0;
        let y = minY + ((rand() * (maxY - minY)) | 0);
        const n = 1 + ((rand() * size) | 0);
        for (let i = 0; i < n; i++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WORLD_HEIGHT) {
            const idx = blockIndex(x, y, z);
            if (blocks[idx] === B.STONE) blocks[idx] = id;
          }
          const d = (rand() * 6) | 0;
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) z++;
          else if (d === 3) z--; else if (d === 4) y++; else y--;
        }
      }
    }
  }

  // Trees use a jittered 4x4 grid so placement is identical from every chunk.
  treeAt(cellX, cellZ) {
    const hv = hashInt(cellX, cellZ, this.seed ^ 0x7ee5);
    const x = cellX * 4 + (hv & 3);
    const z = cellZ * 4 + ((hv >>> 2) & 3);
    const roll = ((hv >>> 8) & 0xffff) / 65536;
    const kindRoll = ((hv >>> 24) & 0xff) / 256;
    const col = this.column(x, z);
    if (col.h <= SEA_LEVEL || col.h >= WORLD_HEIGHT - 12) return null;
    let density = 0, type = null;
    switch (col.biome) {
      case BIOME.JUNGLE:
        density = 0.62;
        type = kindRoll < 0.09 ? 'jungle_giant' : (kindRoll < 0.5 ? 'jungle' : (kindRoll < 0.8 ? 'bush' : 'oak'));
        break;
      case BIOME.FOREST: density = 0.62; type = kindRoll < 0.78 ? 'oak' : 'birch'; break;
      case BIOME.BIRCH_FOREST: density = 0.6; type = kindRoll < 0.85 ? 'birch' : 'oak'; break;
      case BIOME.TAIGA: density = 0.55; type = 'spruce'; break;
      case BIOME.SNOWY: density = 0.12; type = 'spruce'; break;
      case BIOME.PLAINS: density = 0.035; type = kindRoll < 0.8 ? 'oak' : 'bush'; break;
      case BIOME.MOUNTAINS: density = col.h < 108 ? 0.08 : 0; type = 'spruce'; break;
      case BIOME.DESERT: density = 0.07; type = 'cactus'; break;
      default: return null;
    }
    if (roll >= density) return null;
    if (this.slopeAt(x, z) > (type === 'cactus' ? 2 : 3)) return null;
    if (this.isCarved(x, col.h, z) || this.isCarved(x, col.h - 1, z)) return null;
    if (type === 'jungle_giant') {
      // Needs a fairly flat 2x2 base.
      for (const [ox, oz] of [[1, 0], [0, 1], [1, 1]]) {
        const c2 = this.column(x + ox, z + oz);
        if (Math.abs(c2.h - col.h) > 1 || c2.h <= SEA_LEVEL) return null;
      }
    }
    return { x, y: col.h + 1, z, type, seed: hv };
  }

  placeTrees(blocks, cx, cz) {
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const set = (wx, wy, wz, id, force) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || wy <= 0 || wy >= WORLD_HEIGHT) return;
      const idx = blockIndex(lx, wy, lz);
      const cur = blocks[idx];
      if (force) {
        if (cur === B.BEDROCK) return;
        blocks[idx] = id;
      } else if (cur === B.AIR || cur === B.TALL_GRASS || cur === B.FERN || cur === B.VINES) {
        blocks[idx] = id;
      }
    };
    const get = (wx, wy, wz) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || wy < 0 || wy >= WORLD_HEIGHT) return -1;
      return blocks[blockIndex(lx, wy, lz)];
    };
    // Tree canopies reach at most ~7 blocks from the trunk, so 2 cells (8 blocks) of margin suffice.
    const c0x = Math.floor(x0 / 4) - 2, c1x = Math.floor((x0 + CHUNK_SIZE - 1) / 4) + 2;
    const c0z = Math.floor(z0 / 4) - 2, c1z = Math.floor((z0 + CHUNK_SIZE - 1) / 4) + 2;
    for (let cz2 = c0z; cz2 <= c1z; cz2++) {
      for (let cx2 = c0x; cx2 <= c1x; cx2++) {
        const t = this.treeAt(cx2, cz2);
        if (t) buildTree(t, set, get, this);
      }
    }
  }

  placePlants(blocks, cx, cz, heights) {
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = heights[z * CHUNK_SIZE + x];
        if (h + 1 >= WORLD_HEIGHT) continue;
        const ground = blocks[blockIndex(x, h, z)];
        const aboveIdx = blockIndex(x, h + 1, z);
        if (blocks[aboveIdx] !== B.AIR) continue;
        const wx = x0 + x, wz = z0 + z;
        const r = hash2(wx, wz, this.seed ^ 0x91a7);
        const col = this.column(wx, wz);
        if (ground === B.GRASS || ground === B.MOSS_BLOCK) {
          let grassChance = 0.12, fernChance = 0, flowerChance = 0.01;
          switch (col.biome) {
            case BIOME.JUNGLE: grassChance = 0.42; fernChance = 0.18; flowerChance = 0.025; break;
            case BIOME.PLAINS: grassChance = 0.32; flowerChance = 0.04; break;
            case BIOME.FOREST: case BIOME.BIRCH_FOREST: grassChance = 0.22; fernChance = 0.03; flowerChance = 0.03; break;
            case BIOME.TAIGA: grassChance = 0.1; fernChance = 0.15; break;
            case BIOME.MOUNTAINS: grassChance = 0.08; break;
            default: break;
          }
          const flowerField = this.nPatch.noise2(wx / 23 + 40, wz / 23) > 0.45;
          if (flowerField) flowerChance *= 6;
          if (r < flowerChance) {
            const k = hash2(Math.floor(wx / 8), Math.floor(wz / 8), this.seed ^ 0xf10);
            blocks[aboveIdx] = k < 0.4 ? B.POPPY : (k < 0.75 ? B.DANDELION : B.CORNFLOWER);
          } else if (r < flowerChance + fernChance) {
            blocks[aboveIdx] = B.FERN;
          } else if (r < flowerChance + fernChance + grassChance) {
            blocks[aboveIdx] = B.TALL_GRASS;
          }
        } else if (ground === B.PODZOL) {
          if (r < 0.2) blocks[aboveIdx] = B.FERN;
        } else if (ground === B.SAND && col.biome === BIOME.DESERT) {
          if (r < 0.012) blocks[aboveIdx] = B.DEAD_BUSH;
        }
      }
    }
  }

  // Finds a pleasant spawn point, preferring forests/jungles on dry land.
  findSpawn() {
    let fallback = null;
    for (let r = 0; r < 600; r += 8) {
      const steps = Math.max(1, Math.floor((2 * Math.PI * r) / 8));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        const col = this.column(x, z);
        if (col.h <= SEA_LEVEL + 1 || col.h > 100) continue;
        if (this.slopeAt(x, z) > 2) continue;
        if (this.isCarved(x, col.h, z)) continue;
        if (!fallback) fallback = { x: x + 0.5, y: col.h + 1, z: z + 0.5 };
        if (col.biome === BIOME.JUNGLE || col.biome === BIOME.FOREST) {
          return { x: x + 0.5, y: col.h + 1, z: z + 0.5 };
        }
      }
    }
    return fallback || { x: 0.5, y: WORLD_HEIGHT - 20, z: 0.5 };
  }
}

function trilerp(c, k, fx, fy, fz) {
  // c laid out as [z][y][x] corners, 3 values each.
  const c000 = c[k], c100 = c[3 + k], c010 = c[6 + k], c110 = c[9 + k];
  const c001 = c[12 + k], c101 = c[15 + k], c011 = c[18 + k], c111 = c[21 + k];
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

// ---------------------------------------------------------------------------
// Tree builders. `set(x,y,z,id,force)` writes only inside the current chunk.

function blob(set, cx, cy, cz, rx, ry, rz, id, rand, sparse = 0.12) {
  for (let y = -ry; y <= ry; y++) {
    for (let z = -rz; z <= rz; z++) {
      for (let x = -rx; x <= rx; x++) {
        const d = (x * x) / (rx * rx + 0.01) + (y * y) / (ry * ry + 0.01) + (z * z) / (rz * rz + 0.01);
        if (d > 1.05) continue;
        if (d > 0.7 && rand(x + cx, y + cy, z + cz) < sparse * 2.5) continue;
        set(cx + x, cy + y, cz + z, id, false);
      }
    }
  }
}

function buildTree(t, set, get, gen) {
  const s = t.seed;
  const rand = (x, y, z) => hash3(x, y, z, s);
  const r01 = (k) => hash3(k, 7, 13, s);
  const { x, y, z } = t;

  switch (t.type) {
    case 'oak': {
      const height = 4 + ((r01(1) * 3) | 0);
      for (let i = 0; i < height; i++) set(x, y + i, z, B.OAK_LOG, true);
      const top = y + height;
      blob(set, x, top - 1, z, 2 + (r01(2) < 0.5 ? 1 : 0), 2, 2 + (r01(3) < 0.5 ? 1 : 0), B.OAK_LEAVES, rand);
      set(x, top, z, B.OAK_LEAVES, false);
      break;
    }
    case 'birch': {
      const height = 5 + ((r01(1) * 3) | 0);
      for (let i = 0; i < height; i++) set(x, y + i, z, B.BIRCH_LOG, true);
      const top = y + height;
      blob(set, x, top - 1, z, 2, 2, 2, B.BIRCH_LEAVES, rand, 0.2);
      set(x, top, z, B.BIRCH_LEAVES, false);
      break;
    }
    case 'spruce': {
      const height = 7 + ((r01(1) * 5) | 0);
      for (let i = 0; i < height; i++) set(x, y + i, z, B.SPRUCE_LOG, true);
      const top = y + height;
      let radius = 0;
      for (let ly = top + 1; ly >= y + 2; ly--) {
        const fromTop = top + 1 - ly;
        radius = fromTop < 2 ? 0 : ((fromTop % 2 === 0) ? Math.min(3, 1 + (fromTop >> 2)) : Math.max(1, Math.min(3, (fromTop >> 2))));
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > radius + (radius > 1 ? 1 : 0)) continue;
            if (dx === 0 && dz === 0 && ly < top) continue;
            set(x + dx, ly, z + dz, B.SPRUCE_LEAVES, false);
          }
        }
      }
      set(x, top + 1, z, B.SPRUCE_LEAVES, false);
      break;
    }
    case 'jungle': {
      const height = 7 + ((r01(1) * 6) | 0);
      for (let i = 0; i < height; i++) set(x, y + i, z, B.JUNGLE_LOG, true);
      const top = y + height;
      blob(set, x, top - 1, z, 3, 2, 3, B.JUNGLE_LEAVES, rand, 0.15);
      hangVines(set, get, x, top - 2, z, 4, rand, s);
      break;
    }
    case 'jungle_giant': {
      const height = 16 + ((r01(1) * 10) | 0);
      for (let i = -1; i < height; i++) {
        set(x, y + i, z, B.JUNGLE_LOG, true);
        set(x + 1, y + i, z, B.JUNGLE_LOG, true);
        set(x, y + i, z + 1, B.JUNGLE_LOG, true);
        set(x + 1, y + i, z + 1, B.JUNGLE_LOG, true);
      }
      const top = y + height;
      blob(set, x, top - 1, z, 5, 3, 5, B.JUNGLE_LEAVES, rand, 0.14);
      blob(set, x + 1, top + 1, z + 1, 3, 2, 3, B.JUNGLE_LEAVES, rand, 0.1);
      // Side branches with smaller canopies.
      const branches = 2 + ((r01(4) * 3) | 0);
      for (let b = 0; b < branches; b++) {
        const a = r01(10 + b) * Math.PI * 2;
        const by = y + Math.floor(height * (0.45 + r01(20 + b) * 0.35));
        const len = 3 + ((r01(30 + b) * 2) | 0);
        let bx = x, bz = z;
        for (let i = 1; i <= len; i++) {
          bx = x + Math.round(Math.cos(a) * i);
          bz = z + Math.round(Math.sin(a) * i);
          set(bx, by + (i >> 1), bz, B.JUNGLE_LOG, true);
        }
        blob(set, bx, by + (len >> 1) + 1, bz, 3, 1, 3, B.JUNGLE_LEAVES, rand, 0.15);
      }
      hangVines(set, get, x, top - 3, z, 6, rand, s);
      break;
    }
    case 'bush': {
      set(x, y, z, B.JUNGLE_LOG, true);
      blob(set, x, y + 1, z, 2, 1, 2, B.JUNGLE_LEAVES, rand, 0.2);
      set(x, y + 1, z, B.JUNGLE_LEAVES, false);
      break;
    }
    case 'cactus': {
      const height = 1 + ((r01(1) * 3) | 0);
      for (let i = 0; i < height; i++) set(x, y + i, z, B.CACTUS, true);
      break;
    }
    default: break;
  }
}

function hangVines(set, get, cx, cy, cz, radius, rand, seed) {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const wx = cx + dx, wz = cz + dz;
      if (hash2(wx, wz, seed ^ 0x77) > 0.35) continue;
      // Find the lowest leaf in this column of the canopy (scanning down from above).
      let startY = -1;
      for (let y = cy + 4; y >= cy - 3; y--) {
        const b = get(wx, y, wz);
        if (b === -1) { startY = -2; break; }
        if (b === B.JUNGLE_LEAVES) startY = y;
        else if (startY !== -1) break;
      }
      if (startY < 0) continue;
      const len = 2 + ((hash2(wx, wz, seed ^ 0x99) * 7) | 0);
      for (let i = 1; i <= len; i++) {
        const b = get(wx, startY - i, wz);
        if (b !== B.AIR) break;
        set(wx, startY - i, wz, B.VINES, false);
      }
    }
  }
}

export function isOpaqueId(id) { return IS_OPAQUE[id] === 1; }
