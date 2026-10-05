import { test } from 'node:test';
import assert from 'node:assert/strict';
import { B, BLOCKS } from '../public/js/engine/blocks.js';
import { I, ITEMS, isValidItemId, itemName, maxStack, getTool, getFood } from '../public/js/engine/items.js';
import {
  breakTime, canHarvest, getDrops, attackDamage, Hunger, Inventory, RECIPES, GROUPS, toolWear,
} from '../public/js/engine/survival.js';

test('item registry: ids are unique, above block ids and named', () => {
  const ids = new Set();
  for (const it of ITEMS) {
    assert.ok(it.id >= 256);
    assert.ok(!ids.has(it.id));
    ids.add(it.id);
    assert.ok(itemName(it.id).length > 0);
    assert.ok(isValidItemId(it.id));
  }
  assert.equal(maxStack(I.DIAMOND_PICKAXE), 1);
  assert.equal(maxStack(I.COAL), 64);
  assert.equal(maxStack(B.STONE), 64);
  assert.ok(getFood(I.COOKED_MEAT).hunger > getFood(I.RAW_MEAT).hunger);
  assert.equal(isValidItemId(0), false);
  assert.equal(isValidItemId(9999), false);
});

test('every recipe uses valid ingredients and produces something', () => {
  for (const r of RECIPES) {
    assert.ok(isValidItemId(r.out[0]), 'output ' + r.out[0]);
    assert.ok(r.out[1] > 0);
    for (const [id, n] of r.in) {
      assert.ok(typeof id === 'string' ? GROUPS[id] : isValidItemId(id), 'ingredient ' + id);
      assert.ok(n > 0);
    }
    assert.ok([null, 'table', 'furnace'].includes(r.station));
  }
});

test('mining: hand vs tools, harvest tiers', () => {
  // Logs: punchable but much faster with an axe.
  assert.ok(Math.abs(breakTime(B.OAK_LOG, 0) - 3) < 1e-9);
  assert.ok(breakTime(B.OAK_LOG, I.WOOD_AXE) < breakTime(B.OAK_LOG, 0));
  // Stone needs a pickaxe to drop anything and is slow by hand.
  assert.equal(canHarvest(B.STONE, 0), false);
  assert.deepEqual(getDrops(B.STONE, 0), []);
  assert.ok(breakTime(B.STONE, 0) > 5);
  assert.deepEqual(getDrops(B.STONE, I.WOOD_PICKAXE), [[B.COBBLESTONE, 1]]);
  assert.ok(breakTime(B.STONE, I.STONE_PICKAXE) < breakTime(B.STONE, I.WOOD_PICKAXE));
  // Ore tiers
  assert.equal(canHarvest(B.IRON_ORE, I.WOOD_PICKAXE), false);
  assert.equal(canHarvest(B.IRON_ORE, I.STONE_PICKAXE), true);
  assert.equal(canHarvest(B.DIAMOND_ORE, I.STONE_PICKAXE), false);
  assert.deepEqual(getDrops(B.DIAMOND_ORE, I.IRON_PICKAXE), [[I.DIAMOND, 1]]);
  assert.deepEqual(getDrops(B.COAL_ORE, I.WOOD_PICKAXE), [[I.COAL, 1]]);
  // Grass drops dirt, glass drops nothing, bedrock can't be broken.
  assert.deepEqual(getDrops(B.GRASS, 0), [[B.DIRT, 1]]);
  assert.deepEqual(getDrops(B.GLASS, 0), []);
  assert.equal(breakTime(B.BEDROCK, I.DIAMOND_PICKAXE), Infinity);
  // Leaves sometimes drop apples.
  assert.deepEqual(getDrops(B.OAK_LEAVES, 0, () => 0.01), [[I.APPLE, 1]]);
  assert.deepEqual(getDrops(B.OAK_LEAVES, 0, () => 0.9), []);
  // Plants break instantly.
  assert.ok(breakTime(B.TALL_GRASS, 0) <= 0.05);
});

test('every block has a sane harvest setup', () => {
  for (const b of BLOCKS) {
    if (b.requiresTool) assert.equal(b.tool, 'pickaxe', b.key);
    assert.ok(breakTime(b.id, I.DIAMOND_PICKAXE) > 0);
  }
});

test('weapons do more damage than fists; tools wear out', () => {
  assert.equal(attackDamage(0), 1);
  assert.ok(attackDamage(I.DIAMOND_SWORD) > attackDamage(I.WOOD_SWORD));
  assert.equal(toolWear(I.WOOD_SWORD, 'attack'), 1);
  assert.equal(toolWear(I.WOOD_PICKAXE, 'attack'), 2);
  assert.equal(toolWear(B.STONE, 'mine'), 0);
});

test('hunger: exhaustion drains food, full food heals, starving hurts', () => {
  const h = new Hunger();
  h.saturation = 0;
  h.exhaust(4);
  assert.equal(h.food, 19);
  h.food = 20;
  assert.equal(h.update(4, 10, 20), 1, 'heals when well fed');
  h.food = 0;
  assert.equal(h.update(4, 10, 20), -1, 'starving hurts');
  assert.equal(h.update(4, 1, 20), 0, 'starvation stops at half a heart');
  h.food = 6;
  assert.equal(h.canSprint(), false);
  h.eat(getFood(I.COOKED_MEAT));
  assert.equal(h.food, 14);
  assert.ok(h.saturation <= h.food);
  const copy = new Hunger(h.serialize());
  assert.deepEqual(copy.serialize(), h.serialize());
});

test('inventory: stacking, tools, crafting with groups and stations', () => {
  const inv = new Inventory();
  assert.equal(inv.add(B.DIRT, 100), 0);
  assert.equal(inv.slots[0].count, 64);
  assert.equal(inv.slots[1].count, 36);
  inv.add(I.WOOD_PICKAXE, 2);
  assert.equal(inv.count(I.WOOD_PICKAXE), 2);
  assert.equal(inv.slots.filter((s) => s && s.id === I.WOOD_PICKAXE).length, 2, 'tools do not stack');

  // Logs -> planks -> sticks + crafting table
  const inv2 = new Inventory();
  inv2.add(B.BIRCH_LOG, 3);
  const planks = RECIPES.find((r) => r.in[0][0] === B.BIRCH_LOG);
  assert.ok(inv2.craft(planks));
  assert.ok(inv2.craft(planks));
  assert.equal(inv2.count('planks'), 8);
  const sticks = RECIPES.find((r) => r.out[0] === I.STICK);
  assert.ok(inv2.craft(sticks));
  assert.equal(inv2.count(I.STICK), 4);
  const pick = RECIPES.find((r) => r.out[0] === I.WOOD_PICKAXE);
  assert.equal(inv2.canCraft(pick, {}), false, 'needs a crafting table');
  assert.ok(inv2.craft(pick, { table: true }));
  assert.equal(inv2.count(I.WOOD_PICKAXE), 1);
  assert.equal(inv2.count('planks'), 3);

  // Wear a tool until it breaks.
  const slot = inv2.slots.findIndex((s) => s && s.id === I.WOOD_PICKAXE);
  let broke = false;
  for (let i = 0; i < getTool(I.WOOD_PICKAXE).durability && !broke; i++) broke = inv2.wear(slot, 1);
  assert.ok(broke);
  assert.equal(inv2.count(I.WOOD_PICKAXE), 0);
});

test('inventory: clicking moves, splits and merges stacks; save/load round trip', () => {
  const inv = new Inventory();
  inv.add(B.SAND, 10);
  inv.click(0, 2); // take half
  assert.equal(inv.cursor.count, 5);
  assert.equal(inv.slots[0].count, 5);
  inv.click(5, 2); // place one
  assert.equal(inv.slots[5].count, 1);
  inv.click(0, 0); // merge rest
  assert.equal(inv.slots[0].count, 9);
  assert.equal(inv.cursor, null);
  inv.add(I.IRON_SWORD, 1);
  inv.wear(inv.slots.findIndex((s) => s && s.id === I.IRON_SWORD), 7);
  const copy = new Inventory();
  copy.load(JSON.parse(JSON.stringify(inv.serialize())));
  assert.deepEqual(copy.serialize(), inv.serialize());
  copy.load([{ id: 9999, count: 1 }, { id: B.STONE, count: -3 }, null]);
  assert.ok(copy.isEmpty(), 'invalid saved slots are dropped');
});
