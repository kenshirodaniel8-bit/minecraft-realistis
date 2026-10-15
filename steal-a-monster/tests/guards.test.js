// Base guards: 420,000,000 for two guards, upgrades to level 10 (24 guards,
// 4 helicopters); they fight thieves, can be knocked out, and tell the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B, FIELD } from './helpers.js';
import { CONFIG } from '../shared/config.js';
import { GUARDS } from '../shared/guards.js';
import { GS } from '../server/services/guards.js';

async function setup(level) {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  a.profile.base.guardLevel = level;
  const baseA = h.game.world.bases[a.s.baseIndex];
  h.advance(CONFIG.player.spawnProtectionMs + 1100);
  h.place(a, FIELD.x, FIELD.z);
  h.place(b, baseA.outside.x, baseA.outside.z);
  b.s.hp = b.s.maxHp = 100000; // a very tough thief, so the fight lasts
  return { h, a, b, baseA, squad: () => h.game.guards.squadOf(a.s.baseIndex) };
}

test('guards cost 420,000,000 at your base; upgrades up to level 10 = 24 guards and 4 helicopters', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  assert.equal(GUARDS.buyPrice, 420_000_000);
  h.place(a, FIELD.x, FIELD.z);
  assert.equal(a.send('buyGuards').error, 'not_at_base');
  const base = h.game.world.bases[a.s.baseIndex];
  h.place(a, base.spawn.x, base.spawn.z);
  a.profile.money = 419_999_999;
  assert.equal(a.send('buyGuards').error, 'money');
  a.profile.money = 5_000_000_000;
  const r = a.send('buyGuards', { reqId: 'g1' });
  assert.equal(r.ok, true);
  assert.equal(r.guards, 2);
  assert.equal(a.profile.money, 5_000_000_000 - 420_000_000);
  assert.equal(a.send('buyGuards', { reqId: 'g1' }).level, 1, 'a retried request is not charged twice');
  for (let lvl = 2; lvl <= 10; lvl++) assert.equal(a.send('buyGuards').level, lvl);
  assert.equal(a.send('buyGuards').error, 'max');
  h.advance(1100);
  const squad = h.game.guards.squadOf(a.s.baseIndex);
  assert.equal(squad.guards.length, 24);
  assert.equal(squad.helis.length, 4);
  assert.ok(squad.L.damage > GUARDS.levels[0].damage * 5, 'much stronger swords at level 10');
  assert.equal(h.game.bases.state(a.s.baseIndex).guardLevel, 10, 'everyone sees the level (uniforms, helicopters)');
});

test('guards go for a thief in the base (not the owner), tag them and tell the owner', async () => {
  const { h, a, b, baseA, squad } = await setup(1);
  // the owner walks around her own base: nothing happens
  h.place(a, baseA.spawn.x, baseA.spawn.z);
  h.advance(2000);
  assert.ok(squad().guards.every((g) => g.state === GS.idle || g.state === GS.walk), 'calm for the owner');
  h.place(a, FIELD.x, FIELD.z);
  // a passer-by in front of the door is left alone
  h.advance(1500);
  assert.equal(b.s.hp, b.s.maxHp);
  // Bob walks in
  a.clear();
  h.walk(b, baseA.spawn.x, baseA.spawn.z);
  h.advance(4000);
  assert.ok(b.s.hp < b.s.maxHp, 'the guards hit the thief');
  assert.ok(a.events('guardAlert').some((e) => e.stage === 'intruder' && e.thief === 'Bob'), 'Alice is told');
  assert.ok(b.events('guardAlert').some((e) => e.stage === 'spotted'));
  const snap = b.last('snap');
  const me = snap.p.find((r) => r[0] === b.s.pn);
  assert.ok(me[9] & 4096, 'Bob has the THIEF tag');
  assert.ok(snap.g.length === 2 && snap.g.every((r) => r[1] === a.s.baseIndex), 'the guards are in the snapshot');
});

test('a thief can knock out every guard; the owner hears it; they get up again later', async () => {
  const { h, a, b, baseA, squad } = await setup(1);
  b.profile.swords.push('galaxy');
  b.profile.sword = 'galaxy';
  h.walk(b, baseA.spawn.x, baseA.spawn.z);
  a.clear();
  for (let i = 0; i < 200 && squad().guards.some((g) => g.state !== GS.down); i++) {
    const g = squad().guards.find((x) => x.state !== GS.down);
    b.s.pos = { x: g.x - 1.5, y: g.y, z: g.z };
    h.advance(450, 50);
    b.send('attack', { yaw: Math.atan2(g.x - b.s.pos.x, g.z - b.s.pos.z) });
  }
  assert.ok(squad().guards.every((g) => g.state === GS.down), 'both guards are down');
  h.advance(200);
  assert.ok(a.events('guardAlert').some((e) => e.stage === 'defeated' && e.thief === 'Bob'), 'Alice: the thief beat the guards');
  assert.ok(b.events('guardAlert').some((e) => e.stage === 'beaten'));
  assert.ok(b.events('hits').some((e) => e.hits.some((x) => x.guard)), 'hits on guards show numbers');
  h.advance(GUARDS.respawnMs + 1000);
  assert.ok(squad().guards.every((g) => g.state !== GS.down), 'back on duty');
});

test('guards stay on their floor; helicopters shoot thieves near the tower while a guard stands', async () => {
  const { h, a, b, baseA, squad } = await setup(7);
  const sq = squad();
  assert.equal(sq.helis.length, 1);
  const upstairs = sq.guards.filter((g) => g.post.floor === 2);
  // Bob stands in front of the door, hostile (he hit a guard)
  sq.hitBy.set(b.s.pn, h.clock.t);
  h.place(b, baseA.outside.x, baseA.outside.z);
  const hp0 = b.s.hp;
  b.clear();
  h.advance(6000);
  assert.ok(b.events('gShot').length >= 1, 'the helicopter fired');
  assert.ok(b.s.hp < hp0);
  for (const g of upstairs) assert.ok(Math.abs(g.y - g.post.y) < 0.5, 'upstairs guards did not leave their floor');
  // all guards down: the helicopter backs off
  for (const g of sq.guards) {
    g.state = GS.down;
    g.downUntil = h.clock.t + 1e9;
  }
  h.advance(3000);
  b.clear();
  h.advance(6000);
  assert.equal(b.events('gShot').length, 0, 'no more shots once the guards are beaten');
});
