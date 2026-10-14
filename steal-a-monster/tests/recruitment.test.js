// Defeat -> Pay -> Recruit, base placement and passive income.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B, FIELD } from './helpers.js';
import { recruitPrice, incomePerSecond, SPECIES_BY_ID } from '../shared/monsters.js';
import { CONFIG } from '../shared/config.js';
import { MS } from '../server/services/monsterAI.js';

async function defeated(h, client, species = 'chompkin', level = 1) {
  h.place(client, FIELD.x, FIELD.z, 0);
  const m = h.spawnMonster(species, level, FIELD.x + 2, FIELD.z);
  assert.equal(h.defeat(client, m), true);
  return m;
}

test('9. recruitment fails without enough Money and nothing changes hands', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const m = await defeated(h, a, 'voltkit', 3);
  a.profile.money = 10;
  const r = a.send('recruit', { monsterId: m.id, reqId: 'r1' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'money');
  assert.equal(a.profile.money, 10);
  assert.equal(a.profile.monsters.length, 0);
  assert.equal(m.state, MS.defeated, 'still recruitable by someone who can pay');
});

test('10. successful recruitment deducts exactly the listed price and grants ownership once', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const m = await defeated(h, a, 'chompkin', 2);
  const before = a.profile.money;
  const price = recruitPrice(SPECIES_BY_ID.chompkin, 2);
  assert.equal(a.last('recruitOffer').price, price);
  const r = a.send('recruit', { monsterId: m.id, reqId: 'buy-1' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.price, price);
  assert.equal(a.profile.money, before - price);
  assert.equal(a.profile.monsters.length, 1);
  const owned = a.profile.monsters[0];
  assert.equal(owned.species, 'chompkin');
  assert.equal(owned.level, 2);
  assert.equal(h.game.ledger.owner(owned.id), a.profile.id);
  assert.equal(h.game.monsters.get(m.id), undefined, 'removed from the wild');
});

test('11. a monster cannot be recruited twice (retries, double clicks, two players racing)', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  h.place(b, FIELD.x + 1, FIELD.z + 1, 0);
  const m = await defeated(h, a);
  // Bob helps so he is eligible too
  m.eligible.add(b.profile.id);
  const before = a.profile.money;
  const r1 = a.send('recruit', { monsterId: m.id, reqId: 'same' });
  const r2 = a.send('recruit', { monsterId: m.id, reqId: 'same' }); // network retry
  const r3 = a.send('recruit', { monsterId: m.id, reqId: 'other' }); // double click
  h.advance(CONFIG.combat.exclusiveRecruitMs + 100);
  const r4 = b.send('recruit', { monsterId: m.id, reqId: 'bob' });
  assert.equal(r1.ok, true);
  assert.deepEqual(r2, r1, 'the retry gets the same answer');
  assert.equal(r3.ok, false);
  assert.equal(r4.ok, false);
  assert.equal(a.profile.monsters.length, 1);
  assert.equal(b.profile.monsters.length, 0);
  assert.equal(a.profile.money, before - r1.price, 'charged exactly once');
});

test('the top fighter gets priority, then any helper may recruit; base capacity is enforced', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  const m = await defeated(h, a);
  m.eligible.add(b.profile.id);
  h.place(b, m.x + 1, m.z, 0);
  assert.equal(b.send('recruit', { monsterId: m.id, reqId: 'b1' }).error, 'priority');
  h.advance(CONFIG.combat.exclusiveRecruitMs + 50);
  // Bob's base is full
  b.profile.base.slots = 4;
  for (let i = 0; i < 4; i++) b.profile.monsters.push({ id: `mfill${i}`, species: 'mossbun', level: 1, slot: i, following: false, origin: 'recruited', obtainedAt: 0 });
  assert.equal(b.send('recruit', { monsterId: m.id, reqId: 'b2' }).error, 'base_full');
  b.profile.monsters = [];
  assert.equal(b.send('recruit', { monsterId: m.id, reqId: 'b3' }).ok, true);
  // distance is checked
  const m2 = await defeated(h, a);
  h.place(a, m2.x + 40, m2.z, 0);
  assert.equal(a.send('recruit', { monsterId: m2.id, reqId: 'far' }).error, 'too_far');
});

test('declining an offer lets the monster recover and respawn later', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const m = await defeated(h, a);
  assert.equal(a.send('decline', { monsterId: m.id }).ok, true);
  assert.equal(m.state, MS.recover);
  h.advance(3000);
  assert.equal(h.game.monsters.get(m.id), undefined);
  assert.equal(a.profile.monsters.length, 0);
});

test('12. a recruited monster can be placed on a free pad — never two pads, never two monsters per pad', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const m1 = await defeated(h, a, 'chompkin');
  a.send('recruit', { monsterId: m1.id, reqId: 'x1' });
  const m2 = await defeated(h, a, 'mossbun');
  a.send('recruit', { monsterId: m2.id, reqId: 'x2' });
  const [o1, o2] = a.profile.monsters;
  assert.equal(o1.slot, null);
  // placing away from home is refused
  assert.equal(a.send('place', { ownedId: o1.id, slot: 0 }).error, 'not_at_base');
  const base = h.game.world.bases[a.s.baseIndex];
  h.place(a, base.spawn.x, base.spawn.z);
  // entering the base auto-places the new arrivals
  assert.notEqual(o1.slot, null);
  assert.notEqual(o2.slot, null);
  assert.notEqual(o1.slot, o2.slot);
  // move o1 onto o2's pad: they swap, still one monster per pad
  const s2 = o2.slot;
  const s1 = o1.slot;
  assert.equal(a.send('place', { ownedId: o1.id, slot: s2 }).ok, true);
  assert.equal(o1.slot, s2);
  assert.equal(o2.slot, s1);
  // locked pads and nonsense slots are refused
  assert.equal(a.send('place', { ownedId: o1.id, slot: 11 }).error, 'locked_slot');
  assert.equal(a.send('place', { ownedId: o1.id, slot: -1 }).ok, false);
  assert.equal(a.send('place', { ownedId: 'not-mine', slot: 0 }).error, 'not_owned');
  const slots = a.profile.monsters.map((m) => m.slot);
  assert.equal(new Set(slots).size, slots.length);
  // the base broadcast shows them
  const st = h.game.bases.state(a.s.baseIndex);
  assert.equal(st.monsters.length, 2);
});

test('13. placed monsters earn passive income by their own rates; collecting pays it out; offline income is capped', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const base = h.game.world.bases[a.s.baseIndex];
  a.profile.monsters.push({ id: 'minc1', species: 'chompkin', level: 1, slot: 0, following: false, origin: 'recruited', obtainedAt: 0 });
  a.profile.monsters.push({ id: 'minc2', species: 'voltkit', level: 1, slot: 1, following: false, origin: 'recruited', obtainedAt: 0 });
  a.profile.monsters.push({ id: 'minc3', species: 'draklet', level: 1, slot: null, following: true, origin: 'recruited', obtainedAt: 0 });
  h.game.refreshPerks(a.s);
  const expected = incomePerSecond(SPECIES_BY_ID.chompkin, 1) + incomePerSecond(SPECIES_BY_ID.voltkit, 1);
  // unplaced monsters (the follower) earn nothing; the chompkin's perk boosts income a little
  assert.ok(a.s.income >= expected && a.s.income < expected * 1.1, `income ${a.s.income}`);
  h.place(a, FIELD.x, FIELD.z); // away from the collector
  a.profile.storedIncome = 0;
  h.advance(10_000, 100);
  const stored = a.profile.storedIncome;
  assert.ok(Math.abs(stored - a.s.income * 10) <= a.s.income * 1.2, `stored ${stored}`);
  // stepping on the collector pays out
  const before = a.profile.money;
  h.place(a, base.collector.x, base.collector.z);
  assert.equal(a.profile.money, before + Math.floor(stored));
  assert.ok(a.profile.storedIncome < 1);
  // collecting remotely is refused
  h.place(a, FIELD.x, FIELD.z);
  assert.equal(a.send('collect', {}).error, 'not_at_base');
  // offline income: half rate, capped at 8 hours
  h.game.leave(a.sid);
  h.clock.t += 48 * 3600e3;
  const back = await h.join(TOKEN_A, 'Alice');
  const maxOffline = back.s.income * CONFIG.bases.offlineIncomeMaxHours * 3600 * CONFIG.bases.offlineIncomeRate;
  assert.ok(back.profile.storedIncome <= Math.min(maxOffline, back.s.income * CONFIG.bases.incomeAccumulateCap) + 1);
  assert.ok(back.profile.storedIncome > 0);
});

test('24a. a player disconnecting while an offer is open does not corrupt anything', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const m = await defeated(h, a);
  const money = a.profile.money;
  h.game.leave(a.sid);
  assert.equal(m.state, MS.recover, 'the only eligible player left, so it recovers');
  const back = await h.join(TOKEN_A, 'Alice');
  assert.equal(back.profile.money, money);
  assert.equal(back.profile.monsters.length, 0);
  assert.equal(back.send('recruit', { monsterId: m.id, reqId: 'late' }).ok, false);
});

test('rare monsters can set extra recruit conditions (sword tier, Monsterdex discoveries), checked by the server', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  h.place(a, FIELD.x, FIELD.z, 0);
  const p = a.profile;
  p.money = 1e6;
  // Celestail wants a Crystal Sword (Tier 7) or better in your collection
  const m = h.spawnMonster('celestail', 20, FIELD.x + 2, FIELD.z);
  m.hp = 1;
  assert.ok(h.defeat(a, m));
  p.money = 1e6;
  const offer = a.last('recruitOffer');
  assert.ok(offer.requirement, 'the offer explains the condition');
  assert.match(offer.requirementMissing, /Tier 7/);
  const r1 = a.send('recruit', { monsterId: m.id, reqId: 'c1' });
  assert.equal(r1.error, 'requirement');
  assert.equal(p.money, 1e6);
  assert.equal(p.monsters.length, 0);
  p.swords.push('crystal'); // owning it is enough, it needn't be equipped
  const r2 = a.send('recruit', { monsterId: m.id, reqId: 'c2' });
  assert.equal(r2.ok, true);
  assert.equal(p.monsters[0].species, 'celestail');
  // Glitchling also wants 30 discovered species
  const g = h.spawnMonster('glitchling', 20, FIELD.x + 2, FIELD.z + 4);
  g.hp = 1;
  assert.ok(h.defeat(a, g));
  assert.match(a.send('recruit', { monsterId: g.id, reqId: 'g1' }).message, /Discover 30 species/);
  for (const sp of Object.keys(SPECIES_BY_ID).slice(0, 30)) p.discoveries.species[sp] = 1;
  assert.equal(a.send('recruit', { monsterId: g.id, reqId: 'g2' }).ok, true);
});
