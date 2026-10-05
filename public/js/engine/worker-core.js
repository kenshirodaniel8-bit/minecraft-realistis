// Task handlers for terrain generation, lighting, meshing and textures.
// Used by the web workers, or directly on the main thread when workers are unavailable.

import { TerrainGenerator } from './terrain.js';
import { computeLight, buildChunkMesh, extractChunkLight, paddedIndex } from './mesher.js';
import { generateTextures } from './textures.js';
import { CHUNK_SIZE, WORLD_HEIGHT, PADDED_SIZE, blockIndex } from './constants.js';

let gen = null;
let genSeed = null;

function ensureGen(seed) {
  if (gen === null || genSeed !== seed) {
    gen = new TerrainGenerator(seed);
    genSeed = seed;
  }
  return gen;
}

// Build the padded (3x3 chunk) volume the mesher expects.
function buildPadded(chunks) {
  const PS = PADDED_SIZE;
  const pb = new Uint8Array(PS * PS * WORLD_HEIGHT);
  for (let dz = 0; dz < 3; dz++) {
    for (let dx = 0; dx < 3; dx++) {
      const c = chunks[dz * 3 + dx];
      if (!c) continue;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const src = blockIndex(0, y, z);
          pb.set(c.subarray(src, src + CHUNK_SIZE), paddedIndex(dx * CHUNK_SIZE, y, dz * CHUNK_SIZE + z));
        }
      }
    }
  }
  return pb;
}

function tintGrid(g, cx, cz) {
  const G = CHUNK_SIZE + 1;
  const out = new Float32Array(G * G * 6);
  for (let z = 0; z < G; z++) {
    for (let x = 0; x < G; x++) {
      const [t, m] = g.climate(cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z);
      const gc = TerrainGenerator.grassColor(t, m);
      const fc = TerrainGenerator.foliageColor(t, m);
      const i = (z * G + x) * 6;
      out[i] = gc[0]; out[i + 1] = gc[1]; out[i + 2] = gc[2];
      out[i + 3] = fc[0]; out[i + 4] = fc[1]; out[i + 5] = fc[2];
    }
  }
  return out;
}

function meshTransfers(mesh) {
  const list = [];
  for (const k of ['solid', 'cutout', 'water']) {
    const m = mesh[k];
    if (!m) continue;
    list.push(m.position.buffer, m.normal.buffer, m.uv.buffer, m.data.buffer, m.tint.buffer, m.index.buffer);
  }
  return list;
}

// Runs one task. Returns { result, transfers }.
export function handleTask(msg) {
  switch (msg.type) {
    case 'ping':
      return { result: 'pong', transfers: [] };
    case 'generate': {
      const g = ensureGen(msg.seed);
      const blocks = g.generateChunk(msg.cx, msg.cz);
      return { result: { blocks }, transfers: [blocks.buffer] };
    }
    case 'mesh': {
      const g = ensureGen(msg.seed);
      const pb = buildPadded(msg.chunks);
      const light = computeLight(pb);
      const mesh = buildChunkMesh(pb, light, tintGrid(g, msg.cx, msg.cz), { fancyLeaves: msg.fancyLeaves });
      const chunkLight = extractChunkLight(light);
      const transfers = meshTransfers(mesh);
      transfers.push(chunkLight.buffer);
      return { result: { mesh, light: chunkLight }, transfers };
    }
    case 'textures': {
      const tex = generateTextures();
      return { result: tex, transfers: [tex.albedo.buffer, tex.normal.buffer, tex.avg.buffer] };
    }
    case 'spawn':
      return { result: ensureGen(msg.seed).findSpawn(), transfers: [] };
    case 'biome': {
      const c = ensureGen(msg.seed).column(msg.x, msg.z);
      return { result: { biome: c.biome, height: c.h }, transfers: [] };
    }
    default:
      throw new Error('Unknown task ' + msg.type);
  }
}
