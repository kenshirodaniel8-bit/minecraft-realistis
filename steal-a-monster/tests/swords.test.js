// The newer swords and their special effects (all decided by the server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, FIELD } from './helpers.js';
import { CONFIG } from '../shared/config.js';
import { SWORDS, SWORD_BY_ID, swordLockReason } from '../shared/weapons.js';

async function setup(swordId) {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  a.profile.sword = swordId;
  h.place(a, FIELD.x, FIELD.z);
  // sturdy targets so nothing is knocked out during the test, and Alice
  // can't be knocked out either
  const m = h.spawnMonster('golemite', 40, FIELD.x, FIELD.z + 2.5);
  m.stunnedUntil = 0;
  const swing = () => {
    h.advance(SWORD_BY_ID[swordId].cooldownMs + 10, 50);
    a.s.protectUntil = Infinity;
    h.place(a, FIELD.x, FIELD.z);
    m.x = FIELD.x;
    m.z = FIELD.z + 2.5;
    m.hp = m.maxHp;
    return a.send('attack', { yaw: 0 });
  };
  return { h, a, m, swing };
}

test('the sword list is in tier order and every new sword has a price, an unlock and a special', () => {
  for (let i = 1; i < SWORDS.length; i++) assert.ok(SWORDS[i].tier >= SWORDS[i - 1].tier, SWORDS[i].id);
  for (const id of ['candy', 'bubble', 'frost', 'lucky', 'rainbow', 'galaxy']) {
    const s = SWORD_BY_ID[id];
    assert.ok(s && s.price > 0 && s.special, id);
  }
  const galaxy = SWORD_BY_ID.galaxy;
  assert.equal(galaxy.tier, 11);
  assert.ok(galaxy.gems > 0);
  assert.match(swordLockReason(galaxy, { level: 30, regionsVisited: [] }), /Starfall Isle/);
  assert.equal(swordLockReason(galaxy, { level: 30, regionsVisited: ['starfall'] }), null);
});

test('Bubble Sword slows, Frost Sword sometimes freezes (never bosses), the server rolls it', async () => {
  const { h, a, m, swing } = await setup('bubble');
  a.clear();
  assert.equal(swing().ok, true);
  assert.ok(m.slowUntil > h.game.now(), 'slowed');
  assert.equal(a.last('hits').hits[0].fx, 'slow');

  const f = await setup('frost');
  f.h.game.rng = () => 0.99; // unlucky roll: no freeze
  f.swing();
  assert.ok(f.m.stunnedUntil <= f.h.game.now());
  f.h.game.rng = () => 0; // lucky roll
  f.a.clear();
  f.swing();
  assert.ok(f.m.stunnedUntil > f.h.game.now(), 'frozen');
  assert.equal(f.a.last('hits').hits[0].fx, 'freeze');
  // a boss shrugs it off
  const boss = f.h.spawnMonster('pyrodrake', 30, FIELD.x, FIELD.z + 2.5);
  f.m.hp = 0;
  f.h.game.monsters.remove(f.m, 'test');
  f.h.advance(600, 50);
  f.a.send('attack', { yaw: 0 });
  assert.ok(boss.stunnedUntil <= f.h.game.now() + 450, 'bosses are not frozen');
});

test('Lucky Clover Sword: a jackpot hit does triple damage; Rainbow Sword cycles fire, ice and a bonus hit', async () => {
  const { h, a, swing } = await setup('lucky');
  h.game.rng = () => 0.5; // no crit, no jackpot, middle damage
  a.clear();
  swing();
  const normal = a.last('hits').hits[0];
  assert.equal(normal.fx, null);
  h.advance(2000); // reset the combo
  h.game.rng = () => 0.09; // jackpot (10 %) but not a crit (8 %)
  a.clear();
  swing();
  const lucky = a.last('hits').hits[0];
  assert.equal(lucky.fx, 'jackpot');
  assert.ok(lucky.dmg > normal.dmg * 2.5, `${lucky.dmg} vs ${normal.dmg}`);

  const r = await setup('rainbow');
  const seen = [];
  for (let i = 0; i < 3; i++) {
    r.h.advance(1500); // no combo stun in between
    r.a.clear();
    r.swing();
    seen.push(r.a.last('hits').hits[0].fx);
    if (seen[i] === 'rainbow_fire') assert.ok(r.m.burn && r.m.burn.until > r.h.game.now());
    if (seen[i] === 'rainbow_ice') assert.ok(r.m.slowUntil > r.h.game.now());
  }
  assert.deepEqual([...seen].sort(), ['rainbow_fire', 'rainbow_ice', 'rainbow_star']);
});

test('Galaxy Sword: every third hit sets off a star nova that hits the monsters around the target', async () => {
  const { h, a, m, swing } = await setup('galaxy');
  // monsters standing behind the target (out of the sword's reach of 5)
  const others = [1, 2, 3].map((i) => h.spawnMonster('golemite', 40, m.x + (i - 2) * 2.5, m.z + 4.5));
  const far = h.spawnMonster('golemite', 40, m.x + 30, m.z);
  for (const o of [...others, far]) o.stunnedUntil = 0;
  const hold = () => others.forEach((o, i) => { o.x = m.x + (i - 1) * 2.5; o.z = m.z + 4.5; });
  a.clear();
  hold();
  swing();
  hold();
  swing();
  assert.ok(!a.events('hits').some((d) => d.nova), 'no nova on the first two hits');
  hold();
  swing();
  const last = a.last('hits');
  assert.ok(last.nova, 'the third hit sets off a nova');
  const hitIds = new Set(last.hits.map((x) => x.id));
  for (const o of others) assert.ok(hitIds.has(o.id) || o.hp < o.maxHp, `monster ${o.id} near the target is hit`);
  assert.ok(!hitIds.has(far.id), 'a monster far away is not');
  assert.ok(last.hits.some((x) => x.fx === 'nova'));
});
