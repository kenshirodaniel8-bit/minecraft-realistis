// Monster Gems (the rare upgrade material) and base decorations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B, FIELD } from './helpers.js';
import { CONFIG } from '../shared/config.js';
import { regionCenter, REGION_BY_ID } from '../shared/regions.js';
import { DECOR_BY_ID } from '../shared/decor.js';

test('defeating rare monsters drops Monster Gems; the Volcanic Kingdom drops extra; clients cannot add gems', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  h.place(a, FIELD.x, FIELD.z);
  // a common plains monster: no gems
  const common = h.spawnMonster('chompkin', 1, FIELD.x + 3, FIELD.z);
  assert.ok(h.defeat(a, common));
  assert.equal(a.profile.gems, 0);
  // an epic monster always drops 1-2
  const epic = h.spawnMonster('pyrodrake', 3, FIELD.x + 3, FIELD.z + 6);
  a.profile.sword = 'celestial';
  assert.ok(h.defeat(a, epic));
  const g1 = a.profile.gems;
  assert.ok(g1 >= 1 && g1 <= 2, `epic dropped ${g1}`);
  assert.equal(a.last('reward').gems, g1, 'the reward message tells the client');
  // anything defeated in the Volcanic Kingdom gives at least the region bonus
  const v = regionCenter(REGION_BY_ID.volcanic);
  const lava = h.spawnMonster('chompkin', 14, v.x, v.z);
  assert.ok(h.defeat(a, lava));
  assert.ok(a.profile.gems >= g1 + CONFIG.gems.regionBonus.volcanic);
  // forged messages can't create gems
  const before = a.profile.gems;
  a.send('claimLucky', { blockId: 999, reward: { kind: 'gems', amount: 1e6 } });
  a.send('buySword', { swordId: 'stone', gems: -100, reqId: 'g0' });
  assert.equal(a.profile.gems, before);
});

test('Gem Geodes appear in gem-rich regions, pay out once, and do not count as Lucky Blocks', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  // the regular tick keeps geodes in the gem regions only
  const tick = Object.getPrototypeOf(h.game.lucky).tick;
  tick.call(h.game.lucky, 0, h.game.now() + 10000);
  const geodes = [...h.game.lucky.blocks.values()].filter((x) => x.kind === 'geode');
  assert.ok(geodes.length > 0);
  assert.ok(geodes.every((x) => CONFIG.gems.geodeRegions.includes(x.region)));
  const g = geodes[0];
  h.place(a, g.x + 1, g.z);
  h.place(b, g.x - 1, g.z);
  const r1 = a.send('claimLucky', { blockId: g.id });
  const r2 = b.send('claimLucky', { blockId: g.id });
  assert.equal(r1.ok, true);
  assert.equal(r1.reward.kind, 'gems');
  assert.equal(r2.ok, false);
  const [lo, hi] = CONFIG.gems.geodeReward;
  assert.ok(a.profile.gems >= lo && a.profile.gems <= hi);
  assert.equal(b.profile.gems, 0);
  assert.equal(a.profile.stats.luckyOpened, 0, 'geodes are not Lucky Blocks');
});

test('top swords and base upgrades cost Gems as well as Money, all or nothing', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const p = a.profile;
  p.xp = 1e7;
  p.level = 30;
  p.regionsVisited.push('crystal');
  p.money = 100000;
  const shop = h.game.world.shops.find((s) => s.kind === 'swords');
  h.place(a, shop.x, shop.z);
  const r1 = a.send('buySword', { swordId: 'crystal', reqId: 'c1' });
  assert.equal(r1.error, 'gems');
  assert.equal(p.money, 100000, 'no Money taken when Gems are short');
  assert.ok(!p.swords.includes('crystal'));
  p.gems = 5;
  const r2 = a.send('buySword', { swordId: 'crystal', reqId: 'c2' });
  assert.equal(r2.ok, true);
  assert.equal(p.money, 100000 - 70000);
  assert.equal(p.gems, 5 - 3);
  // base pads 8 -> 10 need 3 gems
  p.base.slots = 8;
  p.money = 50000;
  p.gems = 2;
  const base = h.game.world.bases[a.s.baseIndex];
  h.place(a, base.spawn.x, base.spawn.z);
  assert.equal(a.send('buyUpgrade', { kind: 'slots', reqId: 'u1' }).error, 'gems');
  assert.equal(p.base.slots, 8);
  assert.equal(p.money, 50000);
  p.gems = 3;
  assert.equal(a.send('buyUpgrade', { kind: 'slots', reqId: 'u2' }).ok, true);
  assert.equal(p.base.slots, 10);
  assert.equal(p.gems, 0);
  assert.equal(p.money, 50000 - 20000);
});

test('decorations: bought at your own base, placed on spots, moved, shown to everyone, trophies only from milestones', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  const p = a.profile;
  const base = h.game.world.bases[a.s.baseIndex];
  h.place(a, FIELD.x, FIELD.z);
  assert.equal(a.send('buyDecor', { decorId: 'flower_bed', reqId: 'd0' }).error, 'not_at_base');
  h.place(a, base.spawn.x, base.spawn.z);
  const money = p.money;
  b.clear();
  const r1 = a.send('buyDecor', { decorId: 'flower_bed', reqId: 'd1', price: 0 });
  const r1b = a.send('buyDecor', { decorId: 'flower_bed', reqId: 'd1' });
  assert.equal(r1.ok, true);
  assert.deepEqual(r1b, r1, 'a retried purchase is not charged twice');
  assert.equal(p.money, money - DECOR_BY_ID.flower_bed.price);
  assert.equal(p.decor.owned.flower_bed, 1);
  assert.equal(p.base.decor[0], 'flower_bed', 'placed on the first free spot');
  assert.ok(b.events('base').some((st) => st.index === a.s.baseIndex && st.decor[0] === 'flower_bed'), 'other players see it');
  // gem decorations need gems; nothing is taken otherwise
  p.money = 10000;
  assert.equal(a.send('buyDecor', { decorId: 'crystal_cluster', reqId: 'd2' }).error, 'gems');
  assert.equal(p.money, 10000);
  // trophies can't be bought, unknown ids are refused
  assert.equal(a.send('buyDecor', { decorId: 'trophy_gold', reqId: 'd3' }).error, 'not_for_sale');
  assert.equal(a.send('buyDecor', { decorId: 'golden_toilet', reqId: 'd4' }).error, 'unknown_decor');
  // placing: an owned decoration moves to the chosen spot; unowned ones are refused
  assert.equal(a.send('placeDecor', { spot: 5, decorId: 'flower_bed' }).ok, true);
  assert.equal(p.base.decor[5], 'flower_bed');
  assert.equal(p.base.decor[0], null, 'moved, not copied');
  assert.equal(a.send('placeDecor', { spot: 1, decorId: 'fountain' }).error, 'not_owned');
  assert.equal(a.send('placeDecor', { spot: 99, decorId: 'flower_bed' }).ok, false);
  assert.equal(a.send('placeDecor', { spot: 5, decorId: null }).ok, true);
  assert.equal(p.base.decor[5], null);
  // a collection milestone awards a trophy (and the 10-species one gives gems)
  const species = ['chompkin', 'mossbun', 'voltkit', 'bloopfin', 'puffcorn', 'draklet', 'owlium', 'fennix', 'wolbit', 'crumbite'];
  p.base.slots = 12;
  species.forEach((sp, i) => {
    const m = { id: `mdecor${i}`, species: sp, level: 1, slot: null, following: false, origin: 'recruited', obtainedAt: 0 };
    p.monsters.push(m);
    h.game.ledger.set(m.id, p.id, sp, 1);
  });
  const gems = p.gems;
  h.game.bases.checkMilestones(a.s);
  assert.equal(p.decor.owned.trophy_bronze, 1);
  assert.equal(p.decor.owned.trophy_silver, 1);
  assert.equal(p.gems, gems + 3);
  assert.equal(a.send('placeDecor', { spot: 2, decorId: 'trophy_silver' }).ok, true);
  // away from the base nothing can be moved
  h.place(a, FIELD.x, FIELD.z);
  assert.equal(a.send('placeDecor', { spot: 2, decorId: null }).error, 'not_at_base');
});
