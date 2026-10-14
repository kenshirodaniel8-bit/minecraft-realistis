// Base security, stealing, theft interruption, H-key teleport and gadgets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B, TOKEN_C, FIELD } from './helpers.js';
import { CONFIG } from '../shared/config.js';
import { ITEM_BY_ID } from '../shared/items.js';
import { isInsideBase } from '../shared/world.js';

// Alice owns a placed Mossbun; Bob is the would-be thief.
async function setup(opts = {}) {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  const mon = { id: 'mvictim01', species: 'mossbun', level: 2, slot: 0, following: false, origin: 'recruited', obtainedAt: 0 };
  a.profile.monsters.push(mon);
  h.game.ledger.set(mon.id, a.profile.id, mon.species, mon.level);
  h.game.refreshPerks(a.s);
  const baseA = h.game.world.bases[a.s.baseIndex];
  const baseB = h.game.world.bases[b.s.baseIndex];
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  if (!opts.keepPositions) {
    h.place(a, FIELD.x, FIELD.z);
    h.place(b, baseA.outside.x, baseA.outside.z);
  }
  return { h, a, b, mon, baseA, baseB };
}

function stealHold(h, b, ownedId) {
  const r1 = b.send('stealBegin', { ownedId });
  if (!r1.ok) return r1;
  h.advance(CONFIG.stealing.holdMs + 50, 50);
  return b.send('stealConfirm', { ownedId });
}

test('14. active lasers keep rivals out and block theft', async () => {
  const { h, a, b, mon, baseA } = await setup();
  // Alice locks at home
  h.place(a, baseA.lockPad.x, baseA.lockPad.z); // stepping on the pad locks
  assert.ok(h.game.security.isLocked(a.s.baseIndex));
  // Bob tries to walk in through the door
  const r = h.walk(b, baseA.slots[0].x, baseA.slots[0].z);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'lasers');
  assert.ok(!isInsideBase(baseA, b.s.pos.x, b.s.pos.z));
  // even standing next to the pad (e.g. a cheat) theft is refused while locked
  b.s.pos = { x: baseA.slots[0].x + 1, y: baseA.y, z: baseA.slots[0].z };
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).error, 'lasers');
  assert.equal(a.profile.monsters.length, 1);
  // locking only works at your own base
  h.advance(200_000); // lasers expire
  assert.equal(h.game.security.isLocked(a.s.baseIndex), false);
  h.place(a, FIELD.x, FIELD.z);
  assert.equal(a.send('lock', {}).error, 'not_at_base');
});

test('lasers switching on push intruders out and make a thief inside drop the monster', async () => {
  const { h, a, b, mon, baseA } = await setup();
  h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
  assert.ok(isInsideBase(baseA, b.s.pos.x, b.s.pos.z));
  assert.equal(stealHold(h, b, mon.id).ok, true);
  assert.ok(b.s.carrying);
  h.place(a, baseA.lockPad.x, baseA.lockPad.z);
  assert.equal(b.s.carrying, null, 'theft interrupted');
  assert.ok(!isInsideBase(baseA, b.s.pos.x, b.s.pos.z), 'thief pushed outside');
  assert.equal(h.game.stealing.isAway(mon.id), false);
  assert.equal(a.profile.monsters.length, 1);
});

test('15. with lasers off a rival can steal: carry, deliver, ownership moves exactly once', async () => {
  const { h, a, b, mon, baseA, baseB } = await setup();
  // too far to grab
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).error, 'too_far');
  h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
  // confirming too early is refused (the server times the hold)
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).ok, true);
  assert.equal(b.send('stealConfirm', { ownedId: mon.id }).error, 'too_soon');
  h.advance(CONFIG.stealing.holdMs + 50);
  assert.equal(b.send('stealConfirm', { ownedId: mon.id }).ok, true);
  assert.equal(b.s.carrying.ownedId, mon.id);
  assert.ok(a.events('theft').some((t) => t.stage === 'carry'), 'victim is alerted');
  // still Alice's while carried
  assert.equal(h.game.ledger.owner(mon.id), a.profile.id);
  assert.equal(a.profile.monsters.length, 1);
  // the pad shows it as away; a second thief can't grab it
  assert.ok(h.game.bases.state(a.s.baseIndex).monsters[0].away);
  // can't teleport home while carrying
  assert.equal(b.send('home', {}).error, 'carrying');
  // carry it home on foot
  const r = h.walk(b, baseB.spawn.x, baseB.spawn.z, 13);
  assert.notEqual(r.error, 'speed');
  assert.equal(b.s.carrying, null);
  assert.equal(a.profile.monsters.length, 0);
  assert.equal(b.profile.monsters.length, 1);
  assert.equal(b.profile.monsters[0].id, mon.id);
  assert.equal(b.profile.monsters[0].origin, 'stolen');
  assert.equal(h.game.ledger.owner(mon.id), b.profile.id);
  assert.ok(a.events('theft').some((t) => t.stage === 'stolen'));
  // completing again does nothing
  assert.equal(h.game.stealing.completeTheft(b.s), false);
  assert.equal(b.profile.monsters.length, 1);
});

test('duplicate and invalid steal requests are refused', async () => {
  const { h, a, b, mon, baseA } = await setup();
  const c = await h.join(TOKEN_C, 'Cara');
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
  h.place(c, baseA.slots[0].x - 1.5, baseA.slots[0].z);
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).ok, true);
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).error, 'busy');
  assert.equal(c.send('stealBegin', { ownedId: mon.id }).error, 'busy');
  assert.equal(a.send('stealBegin', { ownedId: mon.id }).error, 'own');
  b.send('stealCancel', {});
  assert.equal(b.send('stealBegin', { ownedId: 'no-such-monster' }).error, 'not_found');
  assert.equal(b.send('stealBegin', { ownedId: { $ne: 1 } }).ok, false);
  // a full base can't receive a stolen monster
  b.profile.base.slots = 0;
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).error, 'base_full');
});

test('an aborted grab tells the owner their monster is safe (cancel, timeout, thief leaving)', async () => {
  const { h, a, b, mon, baseA } = await setup();
  h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
  const safeCount = () => a.events('theft').filter((t) => t.stage === 'safe').length;
  // let go of the key
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).ok, true);
  assert.ok(a.events('theft').some((t) => t.stage === 'grab'));
  b.send('stealCancel', {});
  assert.equal(safeCount(), 1);
  // never confirmed: the pending grab times out
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).ok, true);
  h.advance(CONFIG.stealing.holdMs + 4500, 100);
  assert.equal(b.s.stealPending, null);
  assert.equal(safeCount(), 2);
  // the thief disconnects mid-grab
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).ok, true);
  h.game.leave(b.sid);
  assert.equal(safeCount(), 3);
  assert.equal(h.game.ledger.owner(mon.id), a.profile.id, 'nothing changed hands');
});

test('16. hitting a thief with a gadget releases the monster (return-to-owner and drop-recoverable rules)', async () => {
  for (const rule of ['returnToOwner', 'dropRecoverable']) {
    const old = CONFIG.stealing.dropRule;
    CONFIG.stealing.dropRule = rule;
    try {
      const { h, a, b, mon, baseA } = await setup();
      h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
      assert.equal(stealHold(h, b, mon.id).ok, true);
      // Alice runs up and punches him with the Boing Glove (starter gadget)
      h.place(a, b.s.pos.x - 2, b.s.pos.z);
      const yaw = Math.atan2(b.s.pos.x - a.s.pos.x, b.s.pos.z - a.s.pos.z);
      const r = a.send('useItem', { itemId: 'knockback', yaw });
      assert.equal(r.hit, true, JSON.stringify(r));
      assert.equal(b.s.carrying, null);
      assert.ok(b.events('knock').length > 0, 'thief knocked back');
      assert.equal(h.game.ledger.owner(mon.id), a.profile.id);
      assert.equal(a.profile.monsters.length, 1);
      if (rule === 'returnToOwner') {
        assert.equal(h.game.stealing.isAway(mon.id), false);
      } else {
        assert.ok(h.game.stealing.dropped.has(mon.id), 'dropped on the ground');
        // the owner touches it: back home
        const d = h.game.stealing.dropped.get(mon.id);
        h.place(a, d.x + 1, d.z);
        h.advance(100);
        assert.equal(h.game.stealing.dropped.has(mon.id), false);
        assert.equal(h.game.stealing.isAway(mon.id), false);
      }
    } finally {
      CONFIG.stealing.dropRule = old;
    }
  }
});

test('a dropped monster flies home by itself after a while; a player hit while carrying nothing just gets knocked back', async () => {
  const old = CONFIG.stealing.dropRule;
  CONFIG.stealing.dropRule = 'dropRecoverable';
  try {
    const { h, a, b, mon, baseA } = await setup();
    h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
    stealHold(h, b, mon.id);
    h.game.stealing.interrupt(b.s, 'hit');
    assert.ok(h.game.stealing.dropped.has(mon.id));
    h.place(a, FIELD.x, FIELD.z);
    h.advance(CONFIG.stealing.dropRecoverMs + 200);
    assert.equal(h.game.stealing.dropped.has(mon.id), false);
    assert.equal(h.game.stealing.isAway(mon.id), false);
    // empty-handed: knockback only
    h.advance(ITEM_BY_ID.knockback.cooldownMs);
    h.place(a, b.s.pos.x - 2, b.s.pos.z);
    const r = a.send('useItem', { itemId: 'knockback', yaw: Math.atan2(b.s.pos.x - a.s.pos.x, b.s.pos.z - a.s.pos.z) });
    assert.equal(r.hit, true);
    assert.equal(b.s.carrying, null);
    assert.equal(a.profile.monsters.length, 1);
  } finally {
    CONFIG.stealing.dropRule = old;
  }
});

test('24b. disconnects during a theft never duplicate or lose a monster', async () => {
  // thief disconnects mid-carry
  {
    const { h, a, b, mon, baseA } = await setup();
    h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
    stealHold(h, b, mon.id);
    h.game.leave(b.sid);
    assert.equal(h.game.stealing.isAway(mon.id), false);
    assert.equal(a.profile.monsters.length, 1);
    assert.equal(h.game.ledger.owner(mon.id), a.profile.id);
  }
  // victim disconnects mid-carry
  {
    const { h, a, b, mon, baseA, baseB } = await setup();
    h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
    stealHold(h, b, mon.id);
    const victimProfile = a.profile;
    h.game.leave(a.sid);
    assert.equal(b.s.carrying, null, 'theft cancelled');
    h.walk(b, baseB.spawn.x, baseB.spawn.z, 13);
    assert.equal(b.profile.monsters.length, 0);
    assert.equal(victimProfile.monsters.length, 1);
    assert.equal(h.game.ledger.owner(mon.id), victimProfile.id);
  }
  // thief knocked out by a monster mid-carry
  {
    const { h, a, b, mon, baseA } = await setup();
    h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
    stealHold(h, b, mon.id);
    h.game.combat.damagePlayer(b.s, 99999, {});
    assert.equal(b.s.carrying, null);
    assert.equal(h.game.ledger.owner(mon.id), a.profile.id);
  }
});

test('17. H teleports only to your own base, respects cooldown and the carrying rule', async () => {
  const { h, a, b } = await setup();
  const baseA = h.game.world.bases[a.s.baseIndex];
  h.place(a, FIELD.x, FIELD.z);
  // the client cannot choose coordinates
  const r = a.send('home', { x: 0, y: 500, z: 0, base: b.s.baseIndex });
  assert.equal(r.ok, true);
  assert.ok(Math.hypot(a.s.pos.x - baseA.spawn.x, a.s.pos.z - baseA.spawn.z) < 0.5);
  assert.ok(a.events('teleport').length > 0);
  // cooldown
  h.place(a, FIELD.x, FIELD.z);
  assert.equal(a.send('home', {}).error, 'cooldown');
  h.advance(CONFIG.homeTeleport.cooldownMs + 10);
  // frozen players can't
  a.s.fx.frozenUntil = h.clock.t + 5000;
  assert.equal(a.send('home', {}).error, 'stuck');
  a.s.fx.frozenUntil = 0;
  assert.equal(a.send('home', {}).ok, true);
});

test('18. gadgets check ownership, range, facing, cooldowns and shields', async () => {
  const { h, a, b } = await setup();
  h.place(a, FIELD.x, FIELD.z);
  h.place(b, FIELD.x, FIELD.z + 4);
  // not owned
  assert.equal(a.send('useItem', { itemId: 'freeze', yaw: 0 }).error, 'none');
  // owned: hit, then cooldown
  assert.equal(a.send('useItem', { itemId: 'knockback', yaw: 0 }).hit, true);
  assert.equal(a.send('useItem', { itemId: 'knockback', yaw: 0 }).error, 'cooldown');
  // out of range -> miss
  h.advance(ITEM_BY_ID.knockback.cooldownMs + 10);
  h.place(b, FIELD.x, FIELD.z + 30);
  assert.equal(a.send('useItem', { itemId: 'knockback', yaw: 0 }).miss, true);
  // facing away -> miss
  h.advance(ITEM_BY_ID.knockback.cooldownMs + 10);
  h.place(b, FIELD.x, FIELD.z + 3);
  assert.equal(a.send('useItem', { itemId: 'knockback', yaw: Math.PI }).miss, true);
  // shields block
  b.profile.items.shield = 1;
  assert.equal(b.send('useItem', { itemId: 'shield', yaw: 0 }).ok, true);
  assert.equal(b.profile.items.shield, undefined, 'consumable used up');
  h.advance(ITEM_BY_ID.knockback.cooldownMs + 10);
  assert.equal(a.send('useItem', { itemId: 'knockback', yaw: 0 }).blocked, true);
  // traps: placing consumes one, max active enforced, triggers on rivals only
  const traps = a.profile.items.sticky_trap;
  assert.equal(a.send('useItem', { itemId: 'sticky_trap', yaw: 0 }).ok, true);
  assert.equal(a.profile.items.sticky_trap, traps - 1);
  h.advance(ITEM_BY_ID.sticky_trap.cooldownMs + 10);
  b.s.fx.shieldUntil = 0;
  h.place(b, a.s.pos.x, a.s.pos.z);
  h.advance(60);
  assert.ok(b.s.fx.rootedUntil > h.clock.t, 'rival is stuck');
  assert.equal(h.game.items.ground.size, 0, 'trap used up');
  // forged inventory / unknown items
  assert.equal(a.send('useItem', { itemId: 'nuke', yaw: 0 }).ok, false);
  assert.equal(a.send('useItem', { itemId: 'freeze', yaw: 'x' }).ok, false);
});

test('buying: prices come from the server, shop proximity and idempotency are enforced', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  h.place(a, FIELD.x, FIELD.z);
  assert.equal(a.send('buySword', { swordId: 'stone', reqId: 'q0' }).error, 'not_at_shop');
  const shop = h.game.world.shops.find((s) => s.kind === 'swords');
  h.place(a, shop.x, shop.z);
  assert.equal(a.send('buySword', { swordId: 'stone', reqId: 'q1' }).error, 'locked'); // level 2 needed
  a.profile.xp = 200;
  a.profile.level = 2;
  const money = a.profile.money;
  const r1 = a.send('buySword', { swordId: 'stone', reqId: 'q2', price: 1 });
  const r2 = a.send('buySword', { swordId: 'stone', reqId: 'q2', price: 1 });
  assert.equal(r1.ok, true);
  assert.deepEqual(r2, r1);
  assert.equal(a.profile.money, money - 800);
  assert.equal(a.send('buySword', { swordId: 'stone', reqId: 'q3' }).error, 'owned');
  assert.equal(a.profile.sword, 'stone');
  // items
  const ishop = h.game.world.shops.find((s) => s.kind === 'items');
  h.place(a, ishop.x, ishop.z);
  a.profile.money = 5000;
  assert.equal(a.send('buyItem', { itemId: 'shield', qty: -5, reqId: 'i0' }).ok, false);
  assert.equal(a.send('buyItem', { itemId: 'shield', qty: 1000, reqId: 'i1' }).ok, false);
  assert.equal(a.send('buyItem', { itemId: 'shield', qty: 1, reqId: 'i2' }).ok, true);
  assert.equal(a.profile.items.shield, 1);
  assert.equal(a.profile.money, 5000 - 300);
  // a tool can only be owned once
  assert.equal(a.send('buyItem', { itemId: 'knockback', qty: 1, reqId: 'i3' }).error, 'full');
});
