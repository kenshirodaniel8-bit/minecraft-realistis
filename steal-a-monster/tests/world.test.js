// World layout, regions, expansion, Lucky Blocks, LUCKY LUCKY and anti-cheat movement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B, TOKEN_C, FIELD } from './helpers.js';
import { buildWorld, isInsideBase, PLAZA, SPOTS } from '../shared/world.js';
import { REGIONS, regionIdAt, regionLockReason, REGION_BY_ID } from '../shared/regions.js';
import { CONFIG } from '../shared/config.js';
import { MS } from '../server/services/monsterAI.js';

test('the world is deterministic, has 12 bases, every named spot is inside its region, and bases are flat', () => {
  const w = buildWorld();
  assert.equal(w.bases.length, 12);
  assert.ok(w.props.length > 1000);
  for (const s of SPOTS) assert.equal(regionIdAt(s.x, s.z), s.region, s.id);
  for (const b of w.bases) {
    assert.equal(regionIdAt(b.x, b.z), 'plains');
    const ys = b.slots.map((p) => w.groundHeight(p.x, p.z));
    assert.ok(Math.max(...ys) - Math.min(...ys) < 0.05, 'base floor is flat');
  }
  // heights are a pure function of the shared seed
  const pts = [[10, 20], [200, -150], [-333, 120], [450, 400], [1000, 30]];
  const again = pts.map(([x, z]) => w.groundHeight(x, z));
  assert.deepEqual(again, pts.map(([x, z]) => w.groundHeight(x, z)));
  // ten core regions + expansion islands
  assert.ok(REGIONS.filter((r) => !r.expansion).length >= 10);
  assert.ok(REGIONS.filter((r) => r.expansion).length >= 2);
  // plaza and bases never overlap
  for (const b of w.bases) assert.ok(Math.hypot(b.x, b.z) - b.half * 1.5 > PLAZA.r);
});

test('regions unlock with progression; locked regions are refused by the server', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const jungle = REGION_BY_ID.jungle;
  assert.ok(regionLockReason(jungle, { level: 1, swordTier: 1 }, h.game.expansion.active));
  assert.equal(regionLockReason(jungle, { level: 3, swordTier: 1 }, h.game.expansion.active), null);
  // walk north along the road into the jungle at level 1
  h.place(a, 0, 140);
  const r = h.walk(a, 0, 160);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'locked');
  assert.equal(regionIdAt(a.s.pos.x, a.s.pos.z), 'plains');
  // at level 3 the way is open
  a.profile.level = 3;
  assert.equal(h.walk(a, 0, 162).ok, true);
  assert.equal(a.s.region, 'jungle');
  assert.ok(a.profile.regionsVisited.includes('jungle'));
  assert.ok(a.events('discovery').some((d) => d.id === 'jungle'));
});

test('21. expansion regions open at configured population thresholds and close again with hysteresis', async () => {
  const h = await makeGame({ expansionThresholds: [2, 3] });
  const e = h.game.expansion;
  const a = await h.join(TOKEN_A, 'Alice');
  assert.equal(e.active.has('bloomveil'), false);
  assert.equal(e.active.has('starfall'), false);
  const capSolo = h.game.monsters.cap();
  const b = await h.join(TOKEN_B, 'Bob');
  assert.equal(e.active.has('bloomveil'), true);
  assert.equal(e.active.has('starfall'), false);
  const c = await h.join(TOKEN_C, 'Cara');
  assert.equal(e.active.has('starfall'), true);
  assert.ok(h.game.monsters.cap() > capSolo, 'more players -> more monster capacity');
  assert.ok(h.game.monsters.cap() <= CONFIG.monsters.hardCap);
  assert.ok(a.events('world').length > 0 || a.events('announce').length > 0);
  // Cara goes to Starfall; then Bob and Cara leave (both islands also need levels)
  a.profile.level = 20;
  c.profile.level = 20;
  const portal = h.game.world.portals.find((p) => p.id === 'to_starfall');
  h.place(c, portal.x, portal.z);
  h.place(a, h.game.world.portals.find((p) => p.id === 'to_bloomveil').x, h.game.world.portals.find((p) => p.id === 'to_bloomveil').z);
  assert.equal(regionIdAt(a.s.pos.x, a.s.pos.z), 'bloomveil');
  h.game.leave(b.sid);
  h.game.leave(c.sid);
  // still open during the grace period
  assert.equal(e.active.has('bloomveil'), true);
  h.advance(CONFIG.expansion.shrinkDelayMs + 500, 250);
  assert.equal(e.active.has('bloomveil'), false);
  assert.equal(e.active.has('starfall'), false);
  // Alice was brought back to the plaza
  assert.equal(regionIdAt(a.s.pos.x, a.s.pos.z), 'plains');
  assert.ok(Math.hypot(a.s.pos.x, a.s.pos.z) < PLAZA.r + 5);
});

test('closed expansion portals refuse travel; a player count change mid-way cancels a pending close', async () => {
  const h = await makeGame({ expansionThresholds: [2, 6] });
  const a = await h.join(TOKEN_A, 'Alice');
  const portal = h.game.world.portals.find((p) => p.id === 'to_bloomveil');
  h.place(a, portal.x, portal.z);
  assert.notEqual(regionIdAt(a.s.pos.x, a.s.pos.z), 'bloomveil');
  const b = await h.join(TOKEN_B, 'Bob');
  h.game.leave(b.sid);
  assert.ok(h.game.expansion.closing.has('bloomveil'));
  const b2 = await h.join(TOKEN_B, 'Bob');
  assert.equal(h.game.expansion.closing.has('bloomveil'), false);
  void b2;
});

test('19. Lucky Blocks can only be opened once, only up close, and rewards are decided by the server', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  const block = h.game.lucky.spawnAt('plains', 'lucky', false);
  assert.ok(block);
  h.place(a, block.x + 20, block.z);
  assert.equal(a.send('claimLucky', { blockId: block.id }).error, 'too_far');
  h.place(a, block.x + 1, block.z);
  h.place(b, block.x - 1, block.z);
  const before = JSON.stringify([a.profile.money, a.profile.xp, a.profile.items, a.profile.coupons, a.profile.cosmetics]);
  const r1 = a.send('claimLucky', { blockId: block.id, reward: { kind: 'money', amount: 1e9 } });
  const r2 = a.send('claimLucky', { blockId: block.id });
  const r3 = b.send('claimLucky', { blockId: block.id });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false);
  assert.equal(r3.ok, false);
  assert.notEqual(JSON.stringify([a.profile.money, a.profile.xp, a.profile.items, a.profile.coupons, a.profile.cosmetics]), before, 'got exactly one reward');
  assert.ok(a.profile.money < 1e6);
  assert.equal(a.profile.stats.luckyOpened, 1);
  assert.equal(h.game.lucky.blocks.has(block.id), false);
});

test('20. LUCKY LUCKY runs announce -> active -> end, scatters blocks, spawns Luckitty and cleans up', async () => {
  const h = await makeGame({ events: true, spawning: true });
  const a = await h.join(TOKEN_A, 'Alice');
  h.place(a, FIELD.x, FIELD.z);
  assert.equal(h.game.events.trigger('luckyLucky'), true);
  const ev = () => h.game.events.events.luckyLucky;
  assert.equal(ev().phase, 'announce');
  const announced = a.last('event').find((e) => e.id === 'luckyLucky');
  assert.equal(announced.phase, 'announce');
  assert.ok(announced.startsAt > h.clock.t);
  h.advance(CONFIG.events.luckyLucky.announceMs + 100, 100);
  assert.equal(ev().phase, 'active');
  const eventBlocks = [...h.game.lucky.blocks.values()].filter((b) => b.event);
  assert.ok(eventBlocks.length >= 5, `event blocks: ${eventBlocks.length}`);
  assert.equal(h.game.monsters.rareMultiplier?.() ?? h.game.events.rareMultiplier(), CONFIG.events.luckyLucky.rareSpawnMultiplier);
  h.advance(20_000, 100);
  const kitties = [...h.game.monsters.list.values()].filter((m) => m.sp === 'luckitty');
  assert.ok(kitties.length >= 1, 'Luckitty appears during the event');
  h.advance(CONFIG.events.luckyLucky.durationMs, 250);
  assert.equal(ev().phase, 'idle');
  assert.equal([...h.game.lucky.blocks.values()].filter((b) => b.event).length, 0, 'event blocks removed');
  assert.ok(ev().nextAt > h.clock.t, 'cooldown before the next event');
  h.advance(5000, 250);
  assert.equal([...h.game.monsters.list.values()].filter((m) => m.event && m.state !== MS.defeated).length, 0, 'event monsters leave');
});

test('22. forged client messages cannot create Money, ownership or arbitrary teleports', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  h.place(a, FIELD.x, FIELD.z);
  const money = a.profile.money;
  // teleport hack: one huge jump
  let r = a.send('move', { x: 500, y: 10, z: 500, yaw: 0, a: 0, tp: a.s.teleportSeq });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'speed');
  assert.ok(Math.hypot(a.s.pos.x - FIELD.x, a.s.pos.z - FIELD.z) < 1);
  assert.ok(a.events('teleport').length > 0, 'client is corrected');
  // flying hack
  h.advance(100);
  r = a.send('move', { x: FIELD.x, y: 300, z: FIELD.z, yaw: 0, a: 0, tp: a.s.teleportSeq });
  assert.equal(r.error, 'fly');
  // NaN / strings / missing fields
  for (const bad of [{ x: NaN, y: 0, z: 0, yaw: 0 }, { x: '1', y: 0, z: 0, yaw: 0 }, {}, null, 5, 'move']) {
    const res = a.send('move', bad);
    assert.equal(res.ok, false);
  }
  // unknown message types and fake admin fields are ignored
  assert.equal(a.send('setMoney', { money: 1e9 }).ok, false);
  assert.equal(a.send('chat', { text: '/money 1000000' }).ok, false, 'dev commands are off by default');
  // free recruitment / ownership attempts
  assert.equal(a.send('recruit', { monsterId: 999999, reqId: 'x', price: 0 }).ok, false);
  assert.equal(a.send('place', { ownedId: 'm_somebody_else', slot: 0 }).ok, false);
  assert.equal(a.send('follow', { ownedId: '../x' }).ok, false);
  assert.equal(a.send('release', { ownedId: 'whatever' }).ok, false);
  assert.equal(a.profile.money, money);
  assert.equal(a.profile.monsters.length, 0);
  // rate limiting
  let limited = 0;
  for (let i = 0; i < 100; i++) if (a.send('equipSword', { swordId: 'wooden' }).error === 'rate_limited') limited++;
  assert.ok(limited > 50);
});

test('hidden monsters spawn only at their spot (and night-only ones only at night); the ruins vault opens with the plate puzzle', async () => {
  const h = await makeGame({ spawning: true });
  const a = await h.join(TOKEN_A, 'Alice');
  a.profile.level = 30;
  const hollow = SPOTS.find((s) => s.id === 'draklet_hollow');
  h.place(a, hollow.x, hollow.z + 2);
  h.game.monsters.spotNext.draklet = 0;
  for (let i = 0; i < 20 && !h.game.monsters.spotLive.draklet; i++) {
    h.game.monsters.spotNext.draklet = 0;
    h.advance(1100, 100);
  }
  const id = h.game.monsters.spotLive.draklet;
  assert.ok(id, 'Draklet appeared in its hollow');
  const d = h.game.monsters.get(id);
  assert.ok(Math.hypot(d.x - hollow.x, d.z - hollow.z) < hollow.r + 2);
  // night-only Gloomkit: not during the day
  h.game.dayEpoch = h.clock.t - CONFIG.dayLengthMs * 0.2;
  assert.equal(h.game.isNight(), false);
  const moon = SPOTS.find((s) => s.id === 'moonlit_hollow');
  h.place(a, moon.x, moon.z);
  for (let i = 0; i < 10; i++) {
    h.game.monsters.spotNext.gloomkit = 0;
    h.advance(1100, 100);
  }
  assert.equal(h.game.monsters.spotLive.gloomkit, undefined);
  h.game.dayEpoch = h.clock.t - CONFIG.dayLengthMs * 0.75;
  assert.equal(h.game.isNight(), true);
  for (let i = 0; i < 30 && !h.game.monsters.spotLive.gloomkit; i++) {
    h.game.monsters.spotNext.gloomkit = 0;
    h.advance(1100, 100);
  }
  assert.ok(h.game.monsters.spotLive.gloomkit, 'Gloomkit comes out at night');
  // ruins puzzle: wrong order resets, right order opens
  const pz = h.game.world.puzzle;
  const plate = (id) => pz.plates.find((p) => p.id === id);
  const step = (id) => {
    h.place(a, plate(id).x, plate(id).z);
    h.place(a, plate(id).x + 8, plate(id).z + 8);
  };
  step(0);
  assert.equal(h.game.puzzles.progress.length, 0);
  for (const id of pz.order) step(id);
  assert.ok(h.game.puzzles.isOpen());
});
