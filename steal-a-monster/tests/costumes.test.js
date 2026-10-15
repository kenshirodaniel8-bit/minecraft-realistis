// Costumes: the Black Spy (150,000 Money, Spy Sword, 583 master power on Z),
// the other costumes and their powers, and the "Upgrade your power" shop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B, FIELD } from './helpers.js';
import { COSTUMES, COSTUME_BY_ID, POWER_UPGRADE, LEGEND_POWERS, LEGEND_MOVES, powerDamage, costumeWithPower } from '../shared/costumes.js';
import { SWORD_BY_ID } from '../shared/weapons.js';
import { sanitizeProfile } from '../server/services/playerData.js';

function at(h, c, kind) {
  const shop = h.game.world.shops.find((s) => s.kind === kind);
  h.place(c, shop.x, shop.z);
}

test('the Black Spy costume costs 150,000, comes with the Spy Sword and is seen by everyone', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  const spy = COSTUME_BY_ID.black_spy;
  assert.equal(spy.price, 150000);
  assert.equal(spy.power.damage, 583);
  assert.ok(COSTUMES.length >= 4, 'other costumes too');
  assert.equal(new Set(COSTUMES.map((c) => c.power.name)).size, COSTUMES.length, 'each with its own power');
  // not in the shop, not enough money
  assert.equal(a.send('buyCostume', { id: 'black_spy' }).error, 'not_at_shop');
  at(h, a, 'costumes');
  assert.equal(a.send('buyCostume', { id: 'black_spy' }).error, 'money');
  a.profile.money = 160000;
  const res = a.send('buyCostume', { id: 'black_spy', reqId: 'r1' });
  assert.equal(res.ok, true);
  assert.equal(a.profile.money, 10000, 'exactly 150,000 taken');
  assert.equal(a.send('buyCostume', { id: 'black_spy', reqId: 'r1' }).ok, true, 'a retried request is not charged twice');
  assert.equal(a.profile.money, 10000);
  assert.deepEqual(a.profile.costumes, { owned: ['black_spy'], equipped: 'black_spy', power: null });
  assert.ok(a.profile.swords.includes('spy_sword') && a.profile.sword === 'spy_sword', 'Spy Sword given and equipped');
  assert.ok(SWORD_BY_ID.spy_sword.damage >= 180, 'a strong sword');
  // the Spy Sword is not for sale
  at(h, b, 'swords');
  b.profile.money = 1e6;
  assert.equal(b.send('buySword', { swordId: 'spy_sword' }).error, 'costume');
  // others see the costume
  const info = b.events('playerInfo').find((i) => i.pn === a.s.pn);
  assert.equal(info.costume, 'black_spy');
  // take it off and on again
  assert.equal(a.send('equipCostume', { id: null }).ok, true);
  assert.equal(a.profile.costumes.equipped, null);
  assert.equal(a.send('equipCostume', { id: 'flame_ninja' }).error, 'not_owned');
  assert.equal(a.send('equipCostume', { id: 'black_spy' }).ok, true);
  // saved and loaded
  const again = sanitizeProfile(JSON.parse(JSON.stringify(a.profile)), a.profile.id);
  assert.deepEqual(again.costumes, { owned: ['black_spy'], equipped: 'black_spy', power: null });
  assert.deepEqual(sanitizeProfile({ costumes: { owned: ['nope', 'black_spy'], equipped: 'nope' }, powerLevel: 99 }, 'p_x').costumes, { owned: ['black_spy'], equipped: null, power: null });
  assert.equal(sanitizeProfile({ powerLevel: 99 }, 'p_x').powerLevel, POWER_UPGRADE.maxLevel);
});

test('Z: the master power deals exactly 583 to the monsters in front, +130 per power upgrade', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  a.profile.costumes = { owned: ['black_spy'], equipped: null };
  h.place(a, FIELD.x, FIELD.z, 0);
  assert.equal(a.send('power', { yaw: 0 }).error, 'no_costume');
  a.profile.costumes.equipped = 'black_spy';
  const big = h.spawnMonster('chompkin', 30, FIELD.x, FIELD.z + 5);
  const side = h.spawnMonster('mossbun', 30, FIELD.x + 2, FIELD.z + 7);
  const behind = h.spawnMonster('voltkit', 30, FIELD.x, FIELD.z - 6);
  for (const m of [big, side, behind]) {
    m.maxHp = m.hp = 5000;
    m.stunnedUntil = h.clock.t + 1e6;
  }
  a.clear();
  const res = a.send('power', { yaw: 0 });
  assert.equal(res.ok, true);
  assert.equal(res.dmg, 583);
  assert.equal(big.hp, 5000 - 583, 'exactly 583');
  assert.equal(side.hp, 5000 - 583);
  assert.equal(behind.hp, 5000, 'only in front');
  assert.ok(a.events('power').length === 1 && a.events('hits').some((e) => e.power));
  assert.equal(a.send('power', { yaw: 0 }).error, 'cooldown');
  // Upgrade your power: +130 per level
  assert.equal(a.send('buyPower').error, 'not_at_shop');
  at(h, a, 'power');
  a.profile.money = 1e6;
  const before = a.profile.money;
  const up = a.send('buyPower', { reqId: 'p1' });
  assert.equal(up.ok, true);
  assert.equal(up.level, 1);
  assert.equal(before - a.profile.money, POWER_UPGRADE.price(0));
  assert.equal(a.send('buyPower', { reqId: 'p2' }).level, 2);
  assert.equal(powerDamage(COSTUME_BY_ID.black_spy, 2), 583 + 260);
  h.place(a, FIELD.x, FIELD.z, 0);
  h.advance(6100);
  big.hp = 5000;
  assert.equal(a.send('power', { yaw: 0 }).dmg, 843);
  assert.equal(big.hp, 5000 - 843);
});

test('other costume powers: fire ring, freezing blizzard, chain lightning, healing hug', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  a.profile.costumes = { owned: COSTUMES.map((c) => c.id), equipped: null };
  h.place(a, FIELD.x, FIELD.z, 0);
  const ring = [[0, 5], [0, -5], [5, 0]].map(([dx, dz]) => {
    const m = h.spawnMonster('chompkin', 20, FIELD.x + dx, FIELD.z + dz);
    m.maxHp = m.hp = 9000;
    m.stunnedUntil = h.clock.t + 1e7; // keep them still
    return m;
  });
  a.s.protectUntil = Infinity;
  const use = (id, before = () => {}) => {
    a.send('equipCostume', { id });
    h.advance(8000);
    for (const m of ring) {
      m.hp = 9000;
      m.burn = null;
    }
    before();
    return a.send('power', { yaw: 0 });
  };
  const fire = use('flame_ninja');
  assert.equal(fire.hits, 3, 'a ring hits all around');
  assert.ok(ring.every((m) => m.burn && m.burn.until > h.clock.t), 'and sets them on fire');
  const ice = use('frost_knight', () => {
    for (const m of ring) m.stunnedUntil = 0;
  });
  assert.equal(ice.hits, 3);
  assert.ok(ring.every((m) => m.stunnedUntil > h.clock.t + 1000), 'frozen');
  const bolt = use('thunder_hero');
  assert.equal(bolt.hits, 3, 'lightning jumps to three monsters');
  a.s.hp = 10;
  const hug = use('bunny_hoodie');
  assert.ok(hug.ok && a.s.hp > 10, 'the hug heals');
});

test('Legend Master: 11,000,000, choose a power, 1200 damage, the power sets its look and 10 sword moves', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  const legend = COSTUME_BY_ID.legend_master;
  assert.equal(legend.price, 11_000_000);
  assert.equal(legend.choosePower, true);
  at(h, a, 'costumes');
  a.profile.money = 11_000_000 - 1;
  assert.equal(a.send('buyCostume', { id: 'legend_master' }).error, 'money');
  assert.equal(a.send('choosePower', { power: 'ice' }).error, 'not_owned');
  a.profile.money = 11_000_000;
  assert.equal(a.send('buyCostume', { id: 'legend_master', reqId: 'l1' }).ok, true);
  assert.equal(a.profile.money, 0);
  // no power chosen yet: Z asks for one
  h.place(a, FIELD.x, FIELD.z, 0);
  assert.equal(a.send('power', { yaw: 0 }).error, 'no_power');
  assert.equal(a.send('choosePower', { power: 'nope' }).error, 'bad');
  assert.equal(a.send('choosePower', { power: 'lightning' }).ok, true);
  assert.equal(a.profile.costumes.power, 'lightning');
  const info = b.events('playerInfo').filter((i) => i.pn === a.s.pn).pop();
  assert.equal(info.costume, 'legend_master');
  assert.equal(info.costumePower, 'lightning', 'everyone sees the power (colours, animations)');
  const lit = costumeWithPower(legend, 'lightning');
  assert.equal(lit.colors, LEGEND_POWERS.lightning.colors);
  assert.equal(lit.power.shape, 'chain');
  // Z: 1200 exactly to every monster the chain reaches
  const ms = [[0, 5], [2, 9], [4, 13]].map(([dx, dz]) => {
    const m = h.spawnMonster('chompkin', 30, FIELD.x + dx, FIELD.z + dz);
    m.maxHp = m.hp = 9000;
    m.stunnedUntil = h.clock.t + 1e7;
    return m;
  });
  a.clear();
  const res = a.send('power', { yaw: 0 });
  assert.equal(res.ok, true);
  assert.equal(res.dmg, 1200);
  assert.ok(ms.every((m) => m.hp === 9000 - 1200), 'exactly 1200 each');
  assert.equal(a.events('power')[0].element, 'lightning');
  // change the power later: now a ring of ice that freezes
  assert.equal(a.send('choosePower', { power: 'ice' }).ok, true);
  h.advance(6100);
  for (const m of ms) m.stunnedUntil = 0;
  const ice = a.send('power', { yaw: 0 });
  assert.equal(ice.hits, 3);
  assert.ok(ms.every((m) => m.stunnedUntil > h.clock.t + 1000), 'frozen');
  // saved and loaded
  assert.equal(sanitizeProfile(JSON.parse(JSON.stringify(a.profile)), a.profile.id).costumes.power, 'ice');
  assert.equal(sanitizeProfile({ costumes: { owned: [], power: 'hack' } }, 'p_x').costumes.power, null);
  // the sword moves go 1, 2, ... 10 and then start again
  h.place(b, FIELD.x + 4, FIELD.z - 4);
  for (const m of ms) m.stunnedUntil = h.clock.t + 1e7;
  a.s.protectUntil = Infinity;
  const moves = [];
  for (let i = 0; i < 12; i++) {
    h.advance(1000);
    b.clear();
    moves.push(a.send('attack', { yaw: 0 }).move);
    assert.equal(b.events('swing').find((e) => e.pn === a.s.pn)?.move, moves[i], 'others see the same move');
  }
  assert.deepEqual(moves, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
  assert.equal(LEGEND_MOVES, 10);
});
