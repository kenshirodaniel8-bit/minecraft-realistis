// The seven monster islands: 50 different species each, the Island Gate,
// level locks, and the Legendary lair / Mythic shrine of every island.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A } from './helpers.js';
import { SPECIES, RARITIES } from '../shared/monsters.js';
import { ISLANDS, RARITY_SLOTS } from '../shared/islands.js';
import { REGION_BY_ID, regionIdAt } from '../shared/regions.js';

test('every island has its own 50 species: 16 Common, 13 Uncommon, 10 Rare, 6 Epic, 3 Legendary, 2 Mythic', () => {
  assert.equal(ISLANDS.length, 7);
  assert.ok(RARITIES.mythic, 'Mythic rarity exists');
  assert.ok(RARITIES.mythic.order > RARITIES.legendary.order && RARITIES.mythic.order < RARITIES.secret.order);
  const names = new Set();
  const ids = new Set(SPECIES.map((s) => s.id));
  assert.equal(ids.size, SPECIES.length, 'species ids are unique');
  for (const isl of ISLANDS) {
    assert.ok(REGION_BY_ID[isl.id], `${isl.id} is a region`);
    // (plus the moon secret on Cute Monster Island, see moon.test.js)
    const list = SPECIES.filter((s) => s.island === isl.id && !s.moonSecret);
    assert.equal(list.length, 50, `${isl.id} has 50 species`);
    for (const [r, n] of Object.entries(RARITY_SLOTS)) {
      assert.equal(list.filter((s) => s.rarity === r).length, n, `${isl.id}: ${n} ${r}`);
    }
    for (const s of list) {
      assert.ok(!names.has(s.name), `duplicate name ${s.name}`);
      names.add(s.name);
      assert.deepEqual(s.spawn.regions, [isl.id]);
      if (s.rarity === 'legendary') assert.equal(s.spawn.spot, `${isl.id}_lair`);
      if (s.rarity === 'mythic') assert.equal(s.spawn.spot, `${isl.id}_shrine`);
      assert.ok(s.price > 0 && s.income > 0 && s.stats.hp > 0);
    }
  }
  assert.equal(names.size, 350);
  // islands later in the chain have stronger and pricier monsters
  const avg = (id, key) => {
    const l = SPECIES.filter((s) => s.island === id && s.rarity === 'common');
    return l.reduce((a, s) => a + (key === 'price' ? s.price : s.stats.hp), 0) / l.length;
  };
  assert.ok(avg('dragon', 'hp') > avg('cute', 'hp') * 2);
  assert.ok(avg('dragon', 'price') > avg('cute', 'price') * 5);
});

test('the Island Gate takes players to the islands they may enter, from the gate only', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const gate = h.game.world.gate;
  // away from the gate
  assert.equal(a.send('travel', { region: 'cute' }).error, 'too_far');
  h.place(a, gate.x + 2, gate.z);
  // level 1: Cute Monster Island is open, the Coral Reef is not
  const locked = a.send('travel', { region: 'reef' });
  assert.equal(locked.error, 'locked');
  assert.match(locked.message, /Level 5/);
  assert.equal(a.send('travel', { region: 'plains' }).error, 'bad_region');
  assert.equal(a.send('travel', { region: 'nowhere' }).error, 'bad_region');
  const ok = a.send('travel', { region: 'cute' });
  assert.equal(ok.ok, true);
  assert.equal(regionIdAt(a.s.pos.x, a.s.pos.z), 'cute');
  assert.ok(a.events('teleport').length > 0, 'the client is told');
  // higher level: the reef opens
  h.place(a, gate.x + 2, gate.z);
  a.profile.level = 5;
  assert.equal(a.send('travel', { region: 'reef' }).ok, true);
  assert.equal(regionIdAt(a.s.pos.x, a.s.pos.z), 'reef');
  // and the island's portal brings you back to the plaza
  const back = h.game.world.portals.find((p) => p.id === 'from_reef');
  h.advance(3000);
  h.place(a, back.x, back.z);
  h.game.economy.checkPortals(a.s);
  assert.equal(regionIdAt(a.s.pos.x, a.s.pos.z), 'plains');
});

test('Legendary monsters appear at the island lair and Mythic ones at the shrine', async () => {
  const h = await makeGame({ spawning: true });
  const a = await h.join(TOKEN_A, 'Alice');
  a.profile.level = 40;
  const lair = h.game.world.spots.find((s) => s.id === 'ember_lair');
  const shrine = h.game.world.spots.find((s) => s.id === 'ember_shrine');
  h.place(a, (lair.x + shrine.x) / 2, (lair.z + shrine.z) / 2);
  h.game.rng = () => 0.1; // the spawn chance always succeeds
  for (let i = 0; i < 10; i++) {
    h.advance(1000, 250);
    a.s.hp = a.s.maxHp;
  }
  const list = [...h.game.monsters.list.values()];
  const legends = list.filter((m) => m.species.rarity === 'legendary' && m.region === 'ember');
  const mythics = list.filter((m) => m.species.rarity === 'mythic' && m.region === 'ember');
  assert.equal(legends.length, 3, 'all three Legendary monsters at the lair');
  assert.equal(mythics.length, 2, 'both Mythic monsters at the shrine');
  for (const m of legends) assert.ok(Math.hypot(m.x - lair.x, m.z - lair.z) < lair.r + 4);
  for (const m of mythics) assert.ok(Math.hypot(m.x - shrine.x, m.z - shrine.z) < shrine.r + 4);
  assert.ok(mythics.every((m) => m.species.ai.boss), 'Mythic monsters are bosses');
});
