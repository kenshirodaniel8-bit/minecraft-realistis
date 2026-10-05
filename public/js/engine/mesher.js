// Chunk lighting + meshing. Runs inside web workers (and in Node tests).
//
// Input is a padded block volume (chunk + MESH_PAD blocks on every side) so
// that flood-fill lighting and ambient occlusion are exact across chunk seams.
//
// Vertex format (positions are in 1/16 block units so they fit in Uint16):
//   position Uint16x3, normal Int8x3 (normalized), uv Uint8x2 (1/16 units),
//   data Uint8x4 = [textureLayer, ao | wave << 2, sky * 17, block * 17],
//   tint Uint8x3 (normalized, linear colour).

import { CHUNK_SIZE, WORLD_HEIGHT, MESH_PAD, PADDED_SIZE } from './constants.js';
import { BLOCKS, IS_OPAQUE, RENDER, EMIT, LIGHT_ATTEN, B } from './blocks.js';

const PS = PADDED_SIZE;
const PS2 = PS * PS;
const H = WORLD_HEIGHT;

const R_NONE = 0, R_CUBE = 1, R_CUTOUT = 2, R_CROSS = 3, R_WATER = 4, R_TORCH = 5;

export function paddedIndex(x, y, z) {
  return (y * PS + z) * PS + x;
}

// ---------------------------------------------------------------------------
// Lighting: returns Uint8Array with (sky << 4) | block for every padded cell.

export function computeLight(pb) {
  const N = PS2 * H;
  const sky = new Uint8Array(N);
  const blk = new Uint8Array(N);

  // Highest non-air block in the region; everything above is open sky.
  let maxY = 0;
  for (let y = H - 1; y >= 0 && maxY === 0; y--) {
    const base = y * PS2;
    for (let i = 0; i < PS2; i++) {
      if (pb[base + i] !== 0) { maxY = y; break; }
    }
  }
  const topY = Math.min(H - 1, maxY + 1);
  if (topY < H - 1) sky.fill(15, (topY + 1) * PS2);

  // Direct sky columns.
  for (let z = 0; z < PS; z++) {
    for (let x = 0; x < PS; x++) {
      let L = 15;
      for (let y = topY; y >= 0; y--) {
        const i = (y * PS + z) * PS + x;
        const id = pb[i];
        if (IS_OPAQUE[id]) { L = 0; continue; }
        const a = LIGHT_ATTEN[id];
        if (a) L = L > a ? L - a : 0;
        sky[i] = L;
      }
    }
  }

  // Bucketed flood fill (values only ever decrease along a path, so buckets
  // processed from 15 down give each cell its final value with few repeats).
  const skyBuckets = [];
  const blkBuckets = [];
  for (let v = 0; v <= 15; v++) { skyBuckets.push([]); blkBuckets.push([]); }

  for (let y = 0; y <= topY; y++) {
    for (let z = 0; z < PS; z++) {
      for (let x = 0; x < PS; x++) {
        const i = (y * PS + z) * PS + x;
        const id = pb[i];
        const e = EMIT[id];
        if (e) { blk[i] = e; blkBuckets[e].push(i); }
        if (IS_OPAQUE[id]) continue;
        const v = sky[i];
        if (v <= 1) continue;
        // Seed only cells that can raise a neighbour.
        const t = v - 1;
        if ((x > 0 && sky[i - 1] < t && !IS_OPAQUE[pb[i - 1]]) ||
            (x < PS - 1 && sky[i + 1] < t && !IS_OPAQUE[pb[i + 1]]) ||
            (z > 0 && sky[i - PS] < t && !IS_OPAQUE[pb[i - PS]]) ||
            (z < PS - 1 && sky[i + PS] < t && !IS_OPAQUE[pb[i + PS]]) ||
            (y > 0 && sky[i - PS2] < t && !IS_OPAQUE[pb[i - PS2]]) ||
            (y < H - 1 && sky[i + PS2] < t && !IS_OPAQUE[pb[i + PS2]])) {
          skyBuckets[v].push(i);
        }
      }
    }
  }

  floodBuckets(pb, sky, skyBuckets);
  floodBuckets(pb, blk, blkBuckets);

  const light = new Uint8Array(N);
  for (let i = 0; i < N; i++) light[i] = (sky[i] << 4) | blk[i];
  return light;
}

function floodBuckets(pb, L, buckets) {
  for (let v = 15; v >= 2; v--) {
    const bucket = buckets[v];
    for (let k = 0; k < bucket.length; k++) {
      const i = bucket[k];
      if (L[i] !== v) continue;
      const y = (i / PS2) | 0;
      const rem = i - y * PS2;
      const z = (rem / PS) | 0;
      const x = rem - z * PS;
      if (x > 0) spread(pb, L, buckets, i - 1, v);
      if (x < PS - 1) spread(pb, L, buckets, i + 1, v);
      if (z > 0) spread(pb, L, buckets, i - PS, v);
      if (z < PS - 1) spread(pb, L, buckets, i + PS, v);
      if (y > 0) spread(pb, L, buckets, i - PS2, v);
      if (y < H - 1) spread(pb, L, buckets, i + PS2, v);
    }
    bucket.length = 0;
  }
}

function spread(pb, L, buckets, n, v) {
  const id = pb[n];
  if (IS_OPAQUE[id]) return;
  const nv = v - 1 - LIGHT_ATTEN[id];
  if (nv > L[n]) {
    L[n] = nv;
    if (nv >= 2) buckets[nv].push(n);
  }
}

// ---------------------------------------------------------------------------
// Geometry buffers

class MeshBuffer {
  constructor(quads = 2048) {
    this.alloc(quads);
    this.vcount = 0;
    this.icount = 0;
  }

  alloc(quads) {
    const v = quads * 4;
    const old = this.pos ? this : null;
    const pos = new Uint16Array(v * 3), nor = new Int8Array(v * 3), uv = new Uint8Array(v * 2);
    const data = new Uint8Array(v * 4), tint = new Uint8Array(v * 3), idx = new Uint32Array(quads * 6);
    if (old) {
      pos.set(old.pos.subarray(0, old.vcount * 3));
      nor.set(old.nor.subarray(0, old.vcount * 3));
      uv.set(old.uv.subarray(0, old.vcount * 2));
      data.set(old.data.subarray(0, old.vcount * 4));
      tint.set(old.tint.subarray(0, old.vcount * 3));
      idx.set(old.idx.subarray(0, old.icount));
    }
    this.pos = pos; this.nor = nor; this.uv = uv; this.data = data; this.tint = tint; this.idx = idx;
    this.capQuads = quads;
  }

  ensure(extraQuads) {
    const need = (this.vcount >> 2) + extraQuads;
    if (need > this.capQuads) this.alloc(Math.max(need, this.capQuads * 2));
  }

  vertex(x, y, z, nx, ny, nz, u, v, layer, flags, sky, blk, tr, tg, tb) {
    const i = this.vcount++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.nor[i * 3] = nx; this.nor[i * 3 + 1] = ny; this.nor[i * 3 + 2] = nz;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.data[i * 4] = layer; this.data[i * 4 + 1] = flags; this.data[i * 4 + 2] = sky; this.data[i * 4 + 3] = blk;
    this.tint[i * 3] = tr; this.tint[i * 3 + 1] = tg; this.tint[i * 3 + 2] = tb;
  }

  quadIndices(flip) {
    const b = this.vcount - 4;
    const ix = this.idx;
    let k = this.icount;
    if (!flip) {
      ix[k++] = b; ix[k++] = b + 1; ix[k++] = b + 2;
      ix[k++] = b; ix[k++] = b + 2; ix[k++] = b + 3;
    } else {
      ix[k++] = b + 1; ix[k++] = b + 2; ix[k++] = b + 3;
      ix[k++] = b + 1; ix[k++] = b + 3; ix[k++] = b;
    }
    this.icount = k;
  }

  finish() {
    if (this.vcount === 0) return null;
    const vc = this.vcount;
    const index = vc > 65535 ? this.idx.slice(0, this.icount) : Uint16Array.from(this.idx.subarray(0, this.icount));
    return {
      position: this.pos.slice(0, vc * 3),
      normal: this.nor.slice(0, vc * 3),
      uv: this.uv.slice(0, vc * 2),
      data: this.data.slice(0, vc * 4),
      tint: this.tint.slice(0, vc * 3),
      index,
      vertexCount: vc,
    };
  }
}

// Face tables. Corners are listed BL, BR, TR, TL as seen from outside (CCW).
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], side: true },   // +x
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], side: true },  // -x
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], top: true },    // +y
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], bottom: true }, // -y
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], side: true },   // +z
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], side: true },  // -z
];
const FACE_UV = [[0, 0], [16, 0], [16, 16], [0, 16]];

// Per face/corner: padded-index offsets of the 3 neighbours (side1, side2, corner)
// on the layer in front of the face.
const AO_OFFS = FACES.map((f) => {
  const nOff = f.n[0] + f.n[2] * PS + f.n[1] * PS2;
  const axes = [0, 1, 2].filter((a) => f.n[a] === 0);
  const stride = [1, PS2, PS]; // x, y, z
  return f.c.map((corner) => {
    const s1 = (corner[axes[0]] ? 1 : -1) * stride[axes[0]];
    const s2 = (corner[axes[1]] ? 1 : -1) * stride[axes[1]];
    return [nOff, nOff + s1, nOff + s2, nOff + s1 + s2];
  });
});
const FACE_NOFF = FACES.map((f) => f.n[0] + f.n[2] * PS + f.n[1] * PS2);

const WHITE = [255, 255, 255];
const VOLUME = PS2 * H;

function opaqueAt(pb, i) {
  return i < 0 || i >= VOLUME ? 0 : IS_OPAQUE[pb[i]];
}

function lightAt(light, i) {
  if (i >= VOLUME) return 0xf0; // above the world: open sky
  if (i < 0) return 0;
  return light[i];
}

function toLinearByte(c) {
  return Math.max(0, Math.min(255, Math.round(Math.pow(c, 2.2) * 255)));
}

// tintGrid: Float32Array (17*17*6) of sRGB grass rgb + foliage rgb at chunk corners.
export function buildChunkMesh(pb, light, tintGrid, opts = {}) {
  const fancyLeaves = opts.fancyLeaves !== false;
  const solid = new MeshBuffer(4096);
  const cutout = new MeshBuffer(1024);
  const water = new MeshBuffer(512);

  // Pre-convert tint grid to linear bytes.
  const G = CHUNK_SIZE + 1;
  const grassB = new Uint8Array(G * G * 3);
  const foliageB = new Uint8Array(G * G * 3);
  for (let i = 0; i < G * G; i++) {
    for (let k = 0; k < 3; k++) {
      grassB[i * 3 + k] = toLinearByte(tintGrid ? tintGrid[i * 6 + k] : 0.5);
      foliageB[i * 3 + k] = toLinearByte(tintGrid ? tintGrid[i * 6 + 3 + k] : 0.45);
    }
  }
  const fixedTints = {};
  for (const b of BLOCKS) {
    if (Array.isArray(b.tint)) fixedTints[b.id] = b.tint.map(toLinearByte);
  }

  // Find the vertical extent of the chunk's content.
  let maxY = -1;
  for (let y = H - 1; y >= 0 && maxY < 0; y--) {
    for (let z = 0; z < CHUNK_SIZE && maxY < 0; z++) {
      const row = paddedIndex(MESH_PAD, y, z + MESH_PAD);
      for (let x = 0; x < CHUNK_SIZE; x++) {
        if (pb[row + x] !== 0) { maxY = y; break; }
      }
    }
  }

  const sides = [0, 0, 0, 0];
  const skyV = [0, 0, 0, 0];
  const blkV = [0, 0, 0, 0];

  for (let y = 0; y <= maxY; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const pi = paddedIndex(x + MESH_PAD, y, z + MESH_PAD);
        const id = pb[pi];
        if (id === 0) continue;
        const rt = RENDER[id];
        const block = BLOCKS[id];

        if (rt === R_CUBE || rt === R_CUTOUT) {
          const buf = rt === R_CUBE ? solid : cutout;
          const isLeaves = block.wave === 1;
          const waveFlag = isLeaves ? 1 : 0;
          for (let f = 0; f < 6; f++) {
            if (f === 3 && y === 0) continue;
            let nb;
            if (f === 2 && y === H - 1) nb = 0;
            else nb = pb[pi + FACE_NOFF[f]];
            if (IS_OPAQUE[nb]) continue;
            if (rt === R_CUTOUT && nb === id && (!isLeaves || !fancyLeaves)) continue;
            const face = FACES[f];
            const layer = face.top ? block.tex.top : face.bottom ? block.tex.bottom : block.tex.side;

            // Tint selection.
            let tintMode = 0; // 0 white, 1 grass grid, 2 foliage grid, 3 fixed
            if (block.tint === 'grass') tintMode = (id === B.GRASS && face.bottom) ? 0 : 1;
            else if (block.tint === 'foliage') tintMode = 2;
            else if (Array.isArray(block.tint)) tintMode = 3;

            buf.ensure(1);
            const offs = AO_OFFS[f];
            let aoSum03 = 0, aoSum12 = 0;
            const aoArr = sides;
            const edge = y === 0 || y === H - 1;
            for (let c = 0; c < 4; c++) {
              const o = offs[c];
              const front = pi + o[0];
              const s1i = pi + o[1], s2i = pi + o[2], cni = pi + o[3];
              // Near the top/bottom of the world some neighbours fall outside the volume.
              const s1 = edge ? opaqueAt(pb, s1i) : IS_OPAQUE[pb[s1i]];
              const s2 = edge ? opaqueAt(pb, s2i) : IS_OPAQUE[pb[s2i]];
              const cn = (s1 && s2) ? 1 : (edge ? opaqueAt(pb, cni) : IS_OPAQUE[pb[cni]]);
              const ao = (s1 && s2) ? 0 : 3 - (s1 + s2 + cn);
              aoArr[c] = ao;
              // Smooth light: average the non-opaque cells around the vertex.
              let ls = 0, lb = 0, cnt = 0;
              const lf = edge ? lightAt(light, front) : light[front]; ls += lf >> 4; lb += lf & 15; cnt++;
              if (!s1) { const l = edge ? lightAt(light, s1i) : light[s1i]; ls += l >> 4; lb += l & 15; cnt++; }
              if (!s2) { const l = edge ? lightAt(light, s2i) : light[s2i]; ls += l >> 4; lb += l & 15; cnt++; }
              if (!cn) { const l = edge ? lightAt(light, cni) : light[cni]; ls += l >> 4; lb += l & 15; cnt++; }
              skyV[c] = Math.round((ls / cnt) * 17);
              blkV[c] = Math.round((lb / cnt) * 17);
            }
            aoSum03 = aoArr[0] + aoArr[2];
            aoSum12 = aoArr[1] + aoArr[3];
            const n = face.n;
            for (let c = 0; c < 4; c++) {
              const cc = face.c[c];
              const vx = x + cc[0], vz = z + cc[2];
              let tr = 255, tg = 255, tb = 255;
              if (tintMode === 1 || tintMode === 2) {
                const gi = (vz * G + vx) * 3;
                const src = tintMode === 1 ? grassB : foliageB;
                tr = src[gi]; tg = src[gi + 1]; tb = src[gi + 2];
              } else if (tintMode === 3) {
                const t = fixedTints[id]; tr = t[0]; tg = t[1]; tb = t[2];
              }
              buf.vertex(vx * 16, (y + cc[1]) * 16, vz * 16, n[0] * 127, n[1] * 127, n[2] * 127,
                FACE_UV[c][0], FACE_UV[c][1], layer, aoArr[c] | (waveFlag << 2), skyV[c], blkV[c], tr, tg, tb);
            }
            // Flip the quad diagonal so AO interpolates without artifacts.
            buf.quadIndices(aoSum03 < aoSum12);
          }
        } else if (rt === R_CROSS) {
          const l = light[pi];
          const sky = (l >> 4) * 17, bl = (l & 15) * 17;
          let t = WHITE;
          if (block.tint === 'grass' || block.tint === 'foliage') {
            const gi = (z * G + x) * 3;
            const src = block.tint === 'grass' ? grassB : foliageB;
            t = [src[gi], src[gi + 1], src[gi + 2]];
          }
          const layer = block.tex.side;
          const wave = block.wave;
          cutout.ensure(4);
          // Slight per-position offset makes fields of grass look less grid-like.
          const h = ((x * 73856093) ^ (z * 19349663) ^ (y * 83492791)) >>> 0;
          const ox = (h & 3) - 1, oz = ((h >> 2) & 3) - 1;
          const x0 = x * 16 + 2 + ox, x1 = x * 16 + 14 + ox;
          const z0 = z * 16 + 2 + oz, z1 = z * 16 + 14 + oz;
          const yb = y * 16, yt = y * 16 + 16;
          const bottomFlag = wave === 3 ? (3 << 2) : 0;
          const topFlag = wave ? (wave << 2) : 0;
          const quads = [
            [[x0, z0], [x1, z1]],
            [[x1, z1], [x0, z0]],
            [[x0, z1], [x1, z0]],
            [[x1, z0], [x0, z1]],
          ];
          for (const [a, b2] of quads) {
            cutout.vertex(a[0], yb, a[1], 0, 127, 0, 0, 0, layer, 3 | bottomFlag, sky, bl, t[0], t[1], t[2]);
            cutout.vertex(b2[0], yb, b2[1], 0, 127, 0, 16, 0, layer, 3 | bottomFlag, sky, bl, t[0], t[1], t[2]);
            cutout.vertex(b2[0], yt, b2[1], 0, 127, 0, 16, 16, layer, 3 | topFlag, sky, bl, t[0], t[1], t[2]);
            cutout.vertex(a[0], yt, a[1], 0, 127, 0, 0, 16, layer, 3 | topFlag, sky, bl, t[0], t[1], t[2]);
            cutout.quadIndices(false);
          }
        } else if (rt === R_TORCH) {
          const l = light[pi];
          const sky = (l >> 4) * 17, bl = 15 * 17;
          const layer = block.tex.side;
          cutout.ensure(6);
          const bx = x * 16, by = y * 16, bz = z * 16;
          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const n = face.n;
            for (let c = 0; c < 4; c++) {
              const cc = face.c[c];
              const px = bx + 7 + cc[0] * 2, py = by + cc[1] * 10, pz = bz + 7 + cc[2] * 2;
              let u, v;
              if (face.top || face.bottom) { u = 7 + FACE_UV[c][0] / 8; v = 8 + FACE_UV[c][1] / 8; }
              else { u = 7 + FACE_UV[c][0] / 8; v = (FACE_UV[c][1] / 16) * 10; }
              cutout.vertex(px, py, pz, n[0] * 127, n[1] * 127, n[2] * 127, u, v, layer, 3, sky, bl, 255, 255, 255);
            }
            cutout.quadIndices(false);
          }
        } else if (rt === R_WATER) {
          const above = y < H - 1 ? pb[pi + PS2] : 0;
          const surface = RENDER[above] !== R_WATER;
          const topH = surface && !IS_OPAQUE[above] ? 14 : 16;
          for (let f = 0; f < 6; f++) {
            if (f === 3 && y === 0) continue;
            const nb = (f === 2 && y === H - 1) ? 0 : pb[pi + FACE_NOFF[f]];
            if (RENDER[nb] === R_WATER || IS_OPAQUE[nb]) continue;
            const face = FACES[f];
            const n = face.n;
            const l = (f === 2 && y === H - 1) ? 0xf0 : light[pi + FACE_NOFF[f]];
            const sky = (l >> 4) * 17, bl = (l & 15) * 17;
            water.ensure(1);
            for (let c = 0; c < 4; c++) {
              const cc = face.c[c];
              const vy = cc[1] ? topH : 0;
              const isSurf = surface && cc[1] === 1 && topH === 14 ? 1 : 0;
              water.vertex((x + cc[0]) * 16, y * 16 + vy, (z + cc[2]) * 16, n[0] * 127, n[1] * 127, n[2] * 127,
                FACE_UV[c][0], FACE_UV[c][1] * vy / 16, block.tex.side, isSurf, sky, bl, 255, 255, 255);
            }
            water.quadIndices(false);
          }
        }
      }
    }
  }

  return { solid: solid.finish(), cutout: cutout.finish(), water: water.finish() };
}

// Extract the chunk's own light values (16 x H x 16) from the padded light array.
export function extractChunkLight(light) {
  const out = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * H);
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const src = paddedIndex(MESH_PAD, y, z + MESH_PAD);
      out.set(light.subarray(src, src + CHUNK_SIZE), (y * CHUNK_SIZE + z) * CHUNK_SIZE);
    }
  }
  return out;
}
