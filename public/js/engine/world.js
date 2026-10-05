// Main-thread world: chunk storage, streaming around the player, block edits,
// voxel raycasting and conversion of worker mesh data into Three.js meshes.

import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT, blockIndex } from './constants.js';
import { B, BLOCKS, IS_SOLID, RENDER, isValidBlockId } from './blocks.js';

export function ckey(cx, cz) {
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}

function keyToString(cx, cz) { return cx + ',' + cz; }

class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = null;
    this.light = null;
    this.generating = false;
    this.meshing = false;
    this.version = 0;
    this.meshedVersion = -1;
    this.meshes = { solid: null, cutout: null, water: null };
  }
}

const NEIGHBORS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

export class World {
  constructor({ seed, scene, materials, pool, renderDistance = 8, fancyLeaves = true }) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.materials = materials;
    this.pool = pool;
    this.fancyLeaves = fancyLeaves;
    this.chunks = new Map();
    this.edits = new Map(); // ckey -> Map(localIndex -> blockId)
    this.urgent = new Set();
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);
    this.onEdit = null;
    this.onBlockChanged = null;
    this.disposed = false;
    this.frame = 0;
    this.lastCenter = null;
    this.setRenderDistance(renderDistance);
  }

  setRenderDistance(r) {
    this.renderDistance = Math.max(2, Math.min(24, r | 0));
    const R = this.renderDistance + 1;
    const offs = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= (R + 0.5) * (R + 0.5)) offs.push([dx, dz, d2]);
      }
    }
    offs.sort((a, b) => a[2] - b[2]);
    this.offsets = offs;
    this.meshRadius2 = (this.renderDistance + 0.5) * (this.renderDistance + 0.5);
  }

  setFancyLeaves(v) {
    if (this.fancyLeaves === v) return;
    this.fancyLeaves = v;
    for (const c of this.chunks.values()) if (c.blocks) c.version++;
  }

  // ---------------------------------------------------------------- access

  getChunk(cx, cz) {
    return this.chunks.get(ckey(cx, cz));
  }

  // Returns the block id, or -1 if the chunk is not loaded yet.
  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= WORLD_HEIGHT) return B.AIR;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(ckey(cx, cz));
    if (!c || !c.blocks) return -1;
    return c.blocks[blockIndex(x - (cx << 4), y, z - (cz << 4))];
  }

  isLoaded(x, z) {
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return !!(c && c.blocks);
  }

  // Light at a block: { sky: 0..15, block: 0..15 }.
  getLight(x, y, z) {
    if (y >= WORLD_HEIGHT) return { sky: 15, block: 0 };
    if (y < 0) return { sky: 0, block: 0 };
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(ckey(cx, cz));
    if (!c || !c.light) return { sky: 15, block: 0 };
    const v = c.light[blockIndex(x - (cx << 4), y, z - (cz << 4))];
    return { sky: v >> 4, block: v & 15 };
  }

  isChunkMeshed(cx, cz) {
    const c = this.chunks.get(ckey(cx, cz));
    return !!(c && c.meshedVersion >= 0);
  }

  // ---------------------------------------------------------------- edits

  setBlock(x, y, z, id, opts = {}) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= WORLD_HEIGHT || !isValidBlockId(id)) return false;
    const local = opts.local !== false;
    const cx = x >> 4, cz = z >> 4;
    const lx = x - (cx << 4), lz = z - (cz << 4);
    const key = ckey(cx, cz);
    const idx = blockIndex(lx, y, lz);
    const c = this.chunks.get(key);
    if (c && c.blocks && c.blocks[idx] === id) return false;

    let em = this.edits.get(key);
    if (!em) { em = new Map(); this.edits.set(key, em); }
    em.set(idx, id);

    if (c && c.blocks) {
      c.blocks[idx] = id;
      this._markDirty(c, lx, y, lz);
    }
    if (local && this.onEdit) this.onEdit(x, y, z, id);
    if (this.onBlockChanged) this.onBlockChanged(x, y, z, id);

    // Blocks that need support (plants, torches) pop off when the block below goes.
    if (!IS_SOLID[id] && y + 1 < WORLD_HEIGHT) {
      const above = this.getBlock(x, y + 1, z);
      if (above > 0 && BLOCKS[above].needsSupport) this.setBlock(x, y + 1, z, B.AIR, opts);
    }
    return true;
  }

  _markDirty(c, lx, y, lz) {
    c.version++;
    this.urgent.add(c);
    // Light reaches 15 blocks, so neighbours within that (Manhattan) distance must be re-meshed.
    for (const [dx, dz] of NEIGHBORS) {
      const distX = dx < 0 ? lx + 1 : dx > 0 ? CHUNK_SIZE - lx : 0;
      const distZ = dz < 0 ? lz + 1 : dz > 0 ? CHUNK_SIZE - lz : 0;
      if (distX + distZ > 15) continue;
      const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
      if (!n || !n.blocks) continue;
      n.version++;
      // Seams (faces + AO) change immediately for directly adjacent blocks.
      if (distX + distZ <= 1 || (distX <= 1 && distZ <= 1)) this.urgent.add(n);
    }
  }

  // Applies a list of remote edits [[x,y,z,id], ...] without echoing them back.
  applyRemoteEdits(list) {
    for (const e of list) this.setBlock(e[0], e[1], e[2], e[3], { local: false });
  }

  exportEdits() {
    const out = {};
    for (const [key, m] of this.edits) {
      if (m.size === 0) continue;
      const cx = (key >> 16) << 16 >> 16; // sign-extend
      const cz = (key << 16) >> 16;
      out[keyToString(cx, cz)] = Array.from(m.entries());
    }
    return out;
  }

  importEdits(obj) {
    if (!obj) return;
    for (const k of Object.keys(obj)) {
      const [cx, cz] = k.split(',').map(Number);
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      const m = new Map();
      for (const [idx, id] of obj[k]) {
        if (Number.isInteger(idx) && idx >= 0 && idx < CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT && isValidBlockId(id)) m.set(idx, id);
      }
      this.edits.set(ckey(cx, cz), m);
    }
  }

  // Imports flat [x,y,z,id,...] edits (multiplayer join).
  importFlatEdits(arr) {
    for (let i = 0; i + 3 < arr.length; i += 4) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2], id = arr[i + 3];
      if (y < 0 || y >= WORLD_HEIGHT || !isValidBlockId(id)) continue;
      const cx = x >> 4, cz = z >> 4;
      const key = ckey(cx, cz);
      let m = this.edits.get(key);
      if (!m) { m = new Map(); this.edits.set(key, m); }
      m.set(blockIndex(x - (cx << 4), y, z - (cz << 4)), id);
    }
  }

  // ---------------------------------------------------------------- streaming

  update(px, pz) {
    if (this.disposed) return;
    this.frame++;
    const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
    let budget = this.pool.idleCount;

    // 1. Urgent re-meshes after edits.
    if (budget > 0 && this.urgent.size) {
      for (const c of this.urgent) {
        if (budget <= 0) break;
        if (this.chunks.get(ckey(c.cx, c.cz)) !== c || !c.blocks) { this.urgent.delete(c); continue; }
        if (c.meshing) continue;
        if (c.meshedVersion === c.version) { this.urgent.delete(c); continue; }
        if (!this._neighborsReady(c)) { this.urgent.delete(c); continue; }
        this.urgent.delete(c);
        this._submitMesh(c);
        budget--;
      }
    }

    // 2. Nearest-first generation and meshing.
    if (budget > 0) {
      for (let i = 0; i < this.offsets.length && budget > 0; i++) {
        const o = this.offsets[i];
        const cx = pcx + o[0], cz = pcz + o[1];
        const key = ckey(cx, cz);
        let c = this.chunks.get(key);
        if (!c) { c = new Chunk(cx, cz); this.chunks.set(key, c); }
        if (!c.blocks) {
          if (!c.generating) { this._submitGenerate(c); budget--; }
          continue;
        }
        if (o[2] <= this.meshRadius2 && !c.meshing && c.meshedVersion !== c.version && this._neighborsReady(c)) {
          this._submitMesh(c);
          budget--;
        }
      }
    }

    // 3. Unload far chunks occasionally.
    if (this.frame % 30 === 0) {
      const limit = this.renderDistance + 3;
      for (const [key, c] of this.chunks) {
        if (Math.abs(c.cx - pcx) > limit || Math.abs(c.cz - pcz) > limit) {
          this._disposeChunk(c);
          this.chunks.delete(key);
          this.urgent.delete(c);
        }
      }
    }
  }

  _neighborsReady(c) {
    for (const [dx, dz] of NEIGHBORS) {
      const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
      if (!n || !n.blocks) return false;
    }
    return true;
  }

  _submitGenerate(c) {
    c.generating = true;
    this.pool.run('generate', { seed: this.seed, cx: c.cx, cz: c.cz }).then((res) => {
      c.generating = false;
      if (this.disposed || this.chunks.get(ckey(c.cx, c.cz)) !== c) return;
      const blocks = res.blocks;
      const em = this.edits.get(ckey(c.cx, c.cz));
      if (em) for (const [idx, id] of em) blocks[idx] = id;
      c.blocks = blocks;
      c.version++;
    }).catch((err) => {
      c.generating = false;
      if (!this.disposed) console.error('Chunk generation failed', err);
    });
  }

  _submitMesh(c) {
    c.meshing = true;
    const ver = c.version;
    const arrs = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
        arrs.push(n && n.blocks ? n.blocks : null);
      }
    }
    this.pool.run('mesh', { seed: this.seed, cx: c.cx, cz: c.cz, chunks: arrs, fancyLeaves: this.fancyLeaves }).then((res) => {
      c.meshing = false;
      if (this.disposed || this.chunks.get(ckey(c.cx, c.cz)) !== c) return;
      c.meshedVersion = ver;
      c.light = res.light;
      this._applyMesh(c, res.mesh);
      if (c.version !== ver) this.urgent.add(c);
    }).catch((err) => {
      c.meshing = false;
      if (!this.disposed) console.error('Chunk meshing failed', err);
    });
  }

  _applyMesh(c, mesh) {
    for (const kind of ['solid', 'cutout', 'water']) {
      const data = mesh[kind];
      let m = c.meshes[kind];
      if (!data) {
        if (m) {
          this.group.remove(m);
          m.geometry.dispose();
          c.meshes[kind] = null;
        }
        continue;
      }
      const geo = makeGeometry(data);
      if (m) {
        m.geometry.dispose();
        m.geometry = geo;
      } else {
        m = new THREE.Mesh(geo, this.materials[kind]);
        m.position.set(c.cx * CHUNK_SIZE, 0, c.cz * CHUNK_SIZE);
        m.scale.setScalar(1 / 16);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        if (kind === 'water') {
          m.renderOrder = 2;
          m.castShadow = false;
          m.receiveShadow = false;
        } else {
          m.castShadow = true;
          m.receiveShadow = true;
          m.customDepthMaterial = this.materials.depth[kind];
        }
        m.name = 'chunk_' + kind;
        c.meshes[kind] = m;
        this.group.add(m);
      }
    }
  }

  _disposeChunk(c) {
    for (const kind of ['solid', 'cutout', 'water']) {
      const m = c.meshes[kind];
      if (m) {
        this.group.remove(m);
        m.geometry.dispose();
        c.meshes[kind] = null;
      }
    }
    c.blocks = null;
    c.light = null;
  }

  * waterMeshes() {
    for (const c of this.chunks.values()) if (c.meshes.water) yield c.meshes.water;
  }

  // Counts meshed chunks within `radius` chunks of a position (for loading screens).
  readiness(px, pz, radius) {
    const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
    let total = 0, ready = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius + 0.5) continue;
        total++;
        if (this.isChunkMeshed(pcx + dx, pcz + dz)) ready++;
      }
    }
    return total === 0 ? 1 : ready / total;
  }

  // ---------------------------------------------------------------- raycast

  // Voxel DDA. Returns { x, y, z, id, nx, ny, nz, dist } or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? (x + 1 - ox) : (ox - x)) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? (y + 1 - oy) : (oy - y)) * tDeltaY : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? (z + 1 - oz) : (oz - z)) * tDeltaZ : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 256; i++) {
      const id = this.getBlock(x, y, z);
      if (id < 0) return null;
      if (id > 0 && RENDER[id] !== 4) return { x, y, z, id, nx, ny, nz, dist: t };
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX; x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        t = tMaxY; y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) return null;
      if (y < -1 || y > WORLD_HEIGHT) return null;
    }
    return null;
  }

  dispose() {
    this.disposed = true;
    for (const c of this.chunks.values()) this._disposeChunk(c);
    this.chunks.clear();
    this.scene.remove(this.group);
  }
}

function makeGeometry(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3, true));
  g.setAttribute('aTexUv', new THREE.BufferAttribute(m.uv, 2));
  g.setAttribute('aData', new THREE.BufferAttribute(m.data, 4));
  g.setAttribute('aTint', new THREE.BufferAttribute(m.tint, 3, true));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  // Waving foliage can move a little outside its rest position.
  if (g.boundingSphere) g.boundingSphere.radius += 16;
  return g;
}
