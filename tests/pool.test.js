import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MainThreadPool } from '../public/js/engine/workerpool.js';
import { CHUNK_VOLUME } from '../public/js/engine/constants.js';

test('main-thread fallback pool generates and meshes chunks', async () => {
  const pool = new MainThreadPool();
  assert.equal(pool.idleCount, 1);
  assert.equal(await pool.run('ping'), 'pong');
  const chunks = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const { blocks } = await pool.run('generate', { seed: 42, cx: dx, cz: dz });
    assert.equal(blocks.length, CHUNK_VOLUME);
    chunks.push(blocks);
  }
  const res = await pool.run('mesh', { seed: 42, cx: 0, cz: 0, chunks, fancyLeaves: true });
  assert.ok(res.mesh.solid.vertexCount > 0);
  assert.equal(res.light.length, CHUNK_VOLUME);
  const spawn = await pool.run('spawn', { seed: 42 });
  assert.ok(Number.isFinite(spawn.y));
  await assert.rejects(pool.run('nope'));
  pool.destroy();
  await assert.rejects(pool.run('ping'));
});
