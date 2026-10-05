import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGenerator } from '../public/js/engine/terrain.js';
import { computeLight, buildChunkMesh, paddedIndex, extractChunkLight } from '../public/js/engine/mesher.js';
import { generateTextures } from '../public/js/engine/textures.js';
import { normalizeSeed, SimplexNoise } from '../public/js/engine/noise.js';
import { B, BLOCKS, TEXTURE_NAMES, CREATIVE_ORDER, isValidBlockId } from '../public/js/engine/blocks.js';
import { CHUNK_VOLUME, WORLD_HEIGHT, PADDED_SIZE, MESH_PAD, SEA_LEVEL, blockIndex } from '../public/js/engine/constants.js';

test('seeds: text and numbers map to stable uint32 values', () => {
  assert.equal(normalizeSeed('hello'), normalizeSeed('hello'));
  assert.notEqual(normalizeSeed('hello'), normalizeSeed('world'));
  assert.equal(normalizeSeed('12345'), 12345);
  assert.equal(normalizeSeed(42), 42);
  const r = normalizeSeed('');
  assert.ok(Number.isInteger(r) && r >= 0 && r <= 0xffffffff);
});

test('noise is deterministic and bounded', () => {
  const a = new SimplexNoise(7), b = new SimplexNoise(7);
  for (let i = 0; i < 200; i++) {
    const x = i * 0.37, y = i * 0.11, z = i * 0.53;
    assert.equal(a.noise2(x, y), b.noise2(x, y));
    assert.equal(a.noise3(x, y, z), b.noise3(x, y, z));
    assert.ok(Math.abs(a.noise2(x, y)) <= 1.01);
  }
});

test('block registry is consistent', () => {
  for (const b of BLOCKS) {
    assert.ok(b, 'no holes in block ids');
    if (b.id !== 0) for (const k of ['top', 'bottom', 'side']) assert.ok(b.tex[k] >= 0 && b.tex[k] < TEXTURE_NAMES.length);
  }
  for (const id of CREATIVE_ORDER) assert.ok(isValidBlockId(id) && id !== 0);
  assert.equal(isValidBlockId(-1), false);
  assert.equal(isValidBlockId(9999), false);
  assert.equal(isValidBlockId(1.5), false);
});

test('chunks are identical regardless of generation order (seamless borders)', () => {
  const seed = normalizeSeed('order-test');
  const g1 = new TerrainGenerator(seed);
  const a1 = g1.generateChunk(0, 0);
  const b1 = g1.generateChunk(1, 0);
  const g2 = new TerrainGenerator(seed);
  const b2 = g2.generateChunk(1, 0);
  const a2 = g2.generateChunk(0, 0);
  assert.deepEqual(a1, a2);
  assert.deepEqual(b1, b2);
});

test('generated chunks have bedrock floor, sensible surface and valid ids', () => {
  const g = new TerrainGenerator(normalizeSeed('surface'));
  for (const [cx, cz] of [[0, 0], [5, -3], [-12, 7]]) {
    const c = g.generateChunk(cx, cz);
    assert.equal(c.length, CHUNK_VOLUME);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) assert.equal(c[blockIndex(x, 0, z)], B.BEDROCK);
    for (let i = 0; i < c.length; i++) assert.ok(isValidBlockId(c[i]));
    // Every column is solid at the bottom and empty at the very top.
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) assert.equal(c[blockIndex(x, WORLD_HEIGHT - 1, z)], B.AIR);
  }
});

test('spawn point is on dry land', () => {
  for (const s of ['a', 'b', 'jungle', 12345]) {
    const g = new TerrainGenerator(normalizeSeed(s));
    const sp = g.findSpawn();
    const col = g.column(Math.floor(sp.x), Math.floor(sp.z));
    assert.ok(col.h > SEA_LEVEL, `spawn above sea level for seed ${s}`);
    assert.equal(sp.y, col.h + 1);
  }
});

function paddedFrom(fill) {
  const pb = new Uint8Array(PADDED_SIZE * PADDED_SIZE * WORLD_HEIGHT);
  for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < PADDED_SIZE; z++) for (let x = 0; x < PADDED_SIZE; x++) {
    pb[paddedIndex(x, y, z)] = fill(x - MESH_PAD, y, z - MESH_PAD);
  }
  return pb;
}

test('sky light: open sky is 15, sealed caves are dark, light spreads into overhangs', () => {
  // Flat ground at y<=60, a sealed room at y 40-42 and an overhang roof at y=64 over x>=4.
  const pb = paddedFrom((x, y, z) => {
    if (y <= 60) {
      if (y >= 40 && y <= 42 && x >= 4 && x <= 8 && z >= 4 && z <= 8) return B.AIR;
      return B.STONE;
    }
    if (y === 64 && x >= 4) return B.STONE;
    return B.AIR;
  });
  const light = computeLight(pb);
  const sky = (x, y, z) => light[paddedIndex(x + MESH_PAD, y, z + MESH_PAD)] >> 4;
  assert.equal(sky(0, 70, 0), 15);
  assert.equal(sky(0, 61, 0), 15);
  assert.equal(sky(6, 41, 6), 0, 'sealed cave is dark');
  // Under the roof: lit from the side, dimmer further in.
  assert.equal(sky(4, 62, 0), 14);
  assert.equal(sky(8, 62, 0), 10);
  assert.ok(sky(15, 62, 0) < sky(8, 62, 0));
});

test('torches light up their surroundings with falloff', () => {
  const pb = paddedFrom((x, y) => (y <= 60 ? B.STONE : (y >= 70 ? B.STONE : B.AIR)));
  pb[paddedIndex(MESH_PAD + 8, 61, MESH_PAD + 8)] = B.TORCH;
  const light = computeLight(pb);
  const blk = (x, y, z) => light[paddedIndex(x + MESH_PAD, y, z + MESH_PAD)] & 15;
  assert.equal(blk(8, 61, 8), 14);
  assert.equal(blk(9, 61, 8), 13);
  assert.equal(blk(8, 61, 12), 10);
  assert.equal(blk(8, 61, 30), 0);
});

test('mesher culls hidden faces and emits valid buffers', () => {
  // A single stone block floating in the air: exactly 6 faces.
  const pb = paddedFrom((x, y, z) => (x === 3 && y === 70 && z === 3 ? B.STONE : B.AIR));
  const light = computeLight(pb);
  const mesh = buildChunkMesh(pb, light, null);
  assert.equal(mesh.solid.vertexCount, 24);
  assert.equal(mesh.solid.index.length, 36);
  assert.equal(mesh.cutout, null);
  assert.equal(mesh.water, null);
  for (const i of mesh.solid.index) assert.ok(i < 24);

  // Two adjacent blocks share a hidden face pair: 10 faces.
  const pb2 = paddedFrom((x, y, z) => ((x === 3 || x === 4) && y === 70 && z === 3 ? B.STONE : B.AIR));
  const mesh2 = buildChunkMesh(pb2, computeLight(pb2), null);
  assert.equal(mesh2.solid.vertexCount, 40);
});

test('meshing a real generated area works and lights are in range', () => {
  const g = new TerrainGenerator(normalizeSeed('mesh'));
  const chunks = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) chunks.push(g.generateChunk(dx, dz));
  const pb = new Uint8Array(PADDED_SIZE * PADDED_SIZE * WORLD_HEIGHT);
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
    const c = chunks[dz * 3 + dx];
    for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) {
      const src = blockIndex(0, y, z);
      pb.set(c.subarray(src, src + 16), paddedIndex(dx * 16, y, dz * 16 + z));
    }
  }
  const light = computeLight(pb);
  const mesh = buildChunkMesh(pb, light, null);
  assert.ok(mesh.solid && mesh.solid.vertexCount > 100);
  for (const k of ['solid', 'cutout', 'water']) {
    const m = mesh[k];
    if (!m) continue;
    assert.equal(m.position.length, m.vertexCount * 3);
    assert.equal(m.data.length, m.vertexCount * 4);
    for (let i = 0; i < m.index.length; i++) assert.ok(m.index[i] < m.vertexCount);
    for (let i = 0; i < m.vertexCount; i++) {
      assert.ok(m.data[i * 4] < TEXTURE_NAMES.length, 'texture layer in range');
      assert.ok(m.data[i * 4 + 2] <= 255 && m.data[i * 4 + 3] <= 255);
    }
  }
  const cl = extractChunkLight(light);
  assert.equal(cl.length, CHUNK_VOLUME);
});

test('procedural textures have the expected size and are not empty', () => {
  const t = generateTextures();
  assert.equal(t.count, TEXTURE_NAMES.length);
  assert.equal(t.albedo.length, t.count * t.size * t.size * 4);
  for (let l = 0; l < t.count; l++) {
    let opaque = 0;
    for (let i = 0; i < t.size * t.size; i++) if (t.albedo[(l * t.size * t.size + i) * 4 + 3] > 127) opaque++;
    assert.ok(opaque > 20, `texture ${TEXTURE_NAMES[l]} has visible pixels`);
  }
});
