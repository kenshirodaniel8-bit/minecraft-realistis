import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerPhysics } from '../public/js/engine/player.js';
import { B } from '../public/js/engine/blocks.js';

// Minimal world: a flat floor at y=63 plus whatever extra blocks a test adds.
function makeWorld(extra = {}) {
  const blocks = new Map(Object.entries(extra));
  return {
    getBlock(x, y, z) {
      const k = `${x},${y},${z}`;
      if (blocks.has(k)) return blocks.get(k);
      if (y < 0) return B.BEDROCK;
      return y <= 63 ? B.STONE : B.AIR;
    },
    set(x, y, z, id) { blocks.set(`${x},${y},${z}`, id); },
  };
}

function run(p, seconds, controls = {}) {
  const dt = 1 / 60;
  let t = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt;
    p.step(dt, Object.assign({ time: t }, controls));
  }
}

test('player falls and lands on the ground', () => {
  const p = new PlayerPhysics(makeWorld());
  p.x = 0.5; p.y = 70; p.z = 0.5;
  run(p, 2);
  assert.equal(p.y, 64);
  assert.ok(p.onGround);
  assert.equal(p.vy, 0);
});

test('walking forward moves at walking speed (yaw 0 = -Z)', () => {
  const p = new PlayerPhysics(makeWorld());
  p.x = 0.5; p.y = 64; p.z = 0.5; p.autoJump = false;
  run(p, 0.2);
  const z0 = p.z;
  run(p, 2, { forward: true });
  const moved = z0 - p.z;
  assert.ok(moved > 7.5 && moved < 9, `moved ${moved}`);
  assert.ok(Math.abs(p.x - 0.5) < 1e-6);
});

test('strafing left/right and backwards', () => {
  const p = new PlayerPhysics(makeWorld());
  p.x = 0.5; p.y = 64; p.z = 0.5;
  run(p, 1, { left: true });
  assert.ok(p.x < -2.5, `x ${p.x}`);
  const x1 = p.x;
  run(p, 1, { right: true });
  assert.ok(p.x > x1 + 2.5);
  const z1 = p.z;
  run(p, 1, { back: true });
  assert.ok(p.z > z1 + 2.5);
});

test('walls stop the player and he does not tunnel', () => {
  const w = makeWorld();
  for (let y = 64; y < 70; y++) for (let x = -5; x <= 5; x++) w.set(x, y, -3, B.STONE);
  const p = new PlayerPhysics(w);
  p.x = 0.5; p.y = 64; p.z = 0.5; p.autoJump = true;
  run(p, 3, { forward: true, sprint: true });
  assert.ok(p.z >= -2 + 0.3 - 1e-3, `z ${p.z}`);
  assert.ok(p.z < -1.6);
  assert.equal(p.y, 64);
});

test('jump height is about 1.25 blocks', () => {
  const p = new PlayerPhysics(makeWorld());
  p.x = 0.5; p.y = 64; p.z = 0.5;
  run(p, 0.1);
  let maxY = 0;
  const dt = 1 / 60;
  p.step(dt, { jump: true, time: 1 });
  for (let i = 0; i < 90; i++) { p.step(dt, { time: 1 + i * dt }); maxY = Math.max(maxY, p.y); }
  assert.ok(maxY - 64 > 1.15 && maxY - 64 < 1.45, `jump ${maxY - 64}`);
  assert.equal(p.y, 64);
});

test('auto-jump climbs single block steps but not two-block walls', () => {
  const w = makeWorld();
  w.set(0, 64, -2, B.STONE);
  const p = new PlayerPhysics(w);
  p.x = 0.5; p.y = 64; p.z = 0.5; p.autoJump = true;
  run(p, 2, { forward: true });
  assert.ok(p.y >= 65 || p.z < -2.5, `y ${p.y} z ${p.z}`);

  const w2 = makeWorld();
  w2.set(0, 64, -2, B.STONE); w2.set(0, 65, -2, B.STONE);
  const p2 = new PlayerPhysics(w2);
  p2.x = 0.5; p2.y = 64; p2.z = 0.5;
  run(p2, 2, { forward: true });
  assert.equal(p2.y, 64);
  assert.ok(p2.z > -1.0);
});

test('sneaking stops the player at ledges', () => {
  const w = makeWorld();
  // A 1-wide pillar platform standing above the floor.
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.set(x, 63, z, B.AIR);
  w.set(0, 63, 0, B.STONE);
  const p = new PlayerPhysics(w);
  p.x = 0.5; p.y = 64; p.z = 0.5;
  run(p, 0.2, { sneak: true });
  run(p, 2, { forward: true, sneak: true });
  assert.equal(p.y, 64, 'did not fall');
  assert.ok(p.z > -0.31 && p.z < 0.5, `z ${p.z}`);
});

test('double tap jump toggles flight and flying player hovers', () => {
  const p = new PlayerPhysics(makeWorld());
  p.x = 0.5; p.y = 64; p.z = 0.5;
  const dt = 1 / 60;
  p.step(dt, { jumpPressed: true, jump: true, time: 0 });
  p.step(dt, { time: 0.1 });
  p.step(dt, { jumpPressed: true, jump: true, time: 0.2 });
  assert.ok(p.flying);
  run(p, 0.5, { jump: true });
  const y = p.y;
  run(p, 1);
  assert.ok(Math.abs(p.y - y) < 0.7, 'hovering');
});

test('swimming: player sinks slowly and can swim up', () => {
  const w = makeWorld();
  for (let y = 50; y <= 63; y++) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) w.set(x, y, z, B.WATER);
  const p = new PlayerPhysics(w);
  p.x = 0.5; p.y = 60; p.z = 0.5;
  run(p, 0.5);
  assert.ok(p.inWater);
  assert.ok(p.y > 57, 'sinks slowly');
  run(p, 2, { jump: true });
  assert.ok(p.y > 61.5, `swam up to ${p.y}`);
});

test('fall damage callback receives fall distance', () => {
  const p = new PlayerPhysics(makeWorld());
  p.x = 0.5; p.y = 80; p.z = 0.5;
  let fall = 0;
  p.onLand = (d) => { fall = d; };
  run(p, 3);
  assert.ok(Math.abs(fall - 16) < 0.5, `fall ${fall}`);
});

test('unloaded chunks act as walls', () => {
  const w = makeWorld();
  const base = w.getBlock;
  w.getBlock = (x, y, z) => (z < -3 ? -1 : base(x, y, z));
  const p = new PlayerPhysics(w);
  p.x = 0.5; p.y = 64; p.z = 0.5;
  run(p, 3, { forward: true });
  assert.ok(p.z >= -3 + 0.3 - 1e-3);
});

test('unstuck pushes a player out of a block', () => {
  const w = makeWorld();
  w.set(0, 64, 0, B.STONE); w.set(0, 65, 0, B.STONE);
  const p = new PlayerPhysics(w);
  p.x = 0.5; p.y = 64; p.z = 0.5;
  assert.ok(p.unstuck());
  assert.equal(p.y, 66);
});
