// Shared world constants. Used by the browser, the workers and the Node server.

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const SEA_LEVEL = 62;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * WORLD_HEIGHT;

// Padding (in blocks) around a chunk that the mesher receives. Light travels
// at most 15 blocks, so 16 blocks of padding makes lighting exact at chunk seams.
export const MESH_PAD = 16;
export const PADDED_SIZE = CHUNK_SIZE + MESH_PAD * 2;

// A full Minecraft-style day lasts 20 minutes.
export const DAY_LENGTH_SECONDS = 1200;

export const MAX_REACH = 6;

// Index of a block inside a chunk's Uint8Array. y-major so that horizontal
// slices are contiguous.
export function blockIndex(x, y, z) {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

export function worldToChunk(v) {
  return Math.floor(v / CHUNK_SIZE);
}

export function mod(n, m) {
  return ((n % m) + m) % m;
}
