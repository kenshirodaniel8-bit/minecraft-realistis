// The base tower: floors of 10 pads, inside stairs, capacity upgrades.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B } from './helpers.js';
import { CONFIG } from '../shared/config.js';
import { buildWorld, STAIR, STEP_UP, stairSide } from '../shared/world.js';

const B = CONFIG.bases;

test('a base holds 15 monsters at first and each upgrade adds 10 (one floor = 10 pads)', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const p = a.profile;
  assert.equal(p.base.slots, 15);
  const base = h.game.world.bases[a.s.baseIndex];
  assert.equal(base.slots.length, B.maxSlots);
  base.slots.forEach((s, i) => assert.equal(s.floor, Math.floor(i / B.padsPerFloor), `pad ${i} floor`));
  h.place(a, base.spawn.x, base.spawn.z);
  p.money = 1e6;
  p.gems = 100;
  p.xp = 1e7;
  p.level = 30;
  const sizes = [];
  for (let i = 0; i < 4; i++) {
    a.send('buyUpgrade', { kind: 'slots', reqId: `t${i}` });
    sizes.push(p.base.slots);
  }
  assert.deepEqual(sizes, [25, 35, 45, 45], 'maxed out at 45');
});

test('the inside stairs connect every floor in small steps; each floor has a floor to stand on', () => {
  const w = buildWorld();
  for (const b of w.bases) {
    for (let f = 0; f < B.floors - 1; f++) {
      const side = stairSide(f);
      let y = b.y + f * B.floorHeight;
      // walk up the flight from front to back
      for (let v = STAIR.v0 + 0.5; v >= STAIR.v1 - 1; v -= 0.25) {
        const p = b.toWorld(side * (STAIR.u0 + STAIR.u1) / 2, v);
        const next = w.surfaceHeight(p.x, p.z, y);
        assert.ok(next - y <= STEP_UP + 1e-9, `base ${b.index} flight ${f}: a step of ${(next - y).toFixed(2)}`);
        y = Math.max(y, next);
      }
      assert.ok(Math.abs(y - (b.y + (f + 1) * B.floorHeight)) < 1e-6, `flight ${f} reaches floor ${f + 1}`);
    }
    // every pad has a floor under it
    for (const s of b.slots) assert.ok(Math.abs(w.surfaceHeight(s.x, s.z, b.y + s.y + 0.1) - (b.y + s.y)) < 1e-6);
  }
});

test('players walk up the inside stairs; a thief can only grab monsters on the floor they are on', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  const base = h.game.world.bases[a.s.baseIndex];
  // Alice keeps a monster on pad 10 (floor 2)
  const mon = { id: 'mtower1', species: 'mossbun', level: 1, slot: 10, following: false, origin: 'recruited', obtainedAt: h.clock.t };
  a.profile.monsters.push(mon);
  h.game.ledger.set(mon.id, a.profile.id, mon.species, 1);
  // Bob walks in through the door and stands right under pad 10
  h.place(b, base.outside.x, base.outside.z);
  const pad = base.slots[10];
  assert.equal(h.walk(b, base.spawn.x, base.spawn.z).ok, true);
  assert.equal(h.walk(b, pad.x + 1, pad.z).ok, true);
  assert.ok(Math.abs(b.s.pos.y - base.y) < 0.01, 'still on the ground floor');
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).error, 'too_far', 'the monster is a floor up');
  // up the stairs: front of the flight, to the back, onto floor 2
  const side = stairSide(0);
  const bottom = base.toWorld(side * 11.1, STAIR.v0 + 1);
  const topLanding = base.toWorld(side * 11.1, STAIR.v1 - 2);
  assert.equal(h.walk(b, bottom.x, bottom.z, 8).ok, true);
  assert.equal(h.walk(b, topLanding.x, topLanding.z, 8).ok, true);
  assert.ok(Math.abs(b.s.pos.y - (base.y + B.floorHeight)) < 0.01, `on floor 2 (y ${b.s.pos.y.toFixed(2)})`);
  assert.equal(h.walk(b, pad.x + 1, pad.z, 8).ok, true);
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).ok, true, 'now within reach');
});

test('tower walls are solid on the server: only the front door leads in, and a raised position cannot skip the stairs', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  const base = h.game.world.bases[a.s.baseIndex];
  // out through the door (the wall above it is high enough to pass under)
  h.place(a, base.spawn.x, base.spawn.z);
  assert.equal(h.walk(a, base.outside.x, base.outside.z).ok, true);
  // Bob tries to walk in through the side wall
  const side = base.toWorld(base.half + 6, 0);
  const inside = base.toWorld(base.half - 4, 0);
  h.place(b, side.x, side.z);
  const r = h.walk(b, inside.x, inside.z);
  assert.equal(r.error, 'wall');
  // ... or claims to be at floor-3 height next to the tower and steps in
  const front = base.toWorld(-11, base.half + 1.2);
  const floor3 = base.toWorld(-11, base.half - 1.2);
  h.place(b, front.x, front.z);
  h.advance(300);
  const res = h.game.handle(b.sid, 'move', { x: floor3.x, y: base.y + 2 * B.floorHeight, z: floor3.z, yaw: 0, a: 1, tp: b.s.teleportSeq });
  assert.equal(res.error, 'wall');
  assert.ok(b.s.pos.y < base.y + 1, 'still on the ground outside');
});
