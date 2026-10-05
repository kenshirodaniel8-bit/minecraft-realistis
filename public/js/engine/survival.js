// Survival rules: mining speed and drops, hunger, crafting recipes and the
// inventory. Pure JS (no DOM / Three.js) so it can be unit tested.

import { B, BLOCKS } from './blocks.js';
import { I, getTool, getFood, maxStack, isValidItemId, isItemId } from './items.js';

// ---------------------------------------------------------------------------
// Mining

export function canHarvest(blockId, toolId) {
  const b = BLOCKS[blockId];
  if (!b) return false;
  if (!b.requiresTool) return true;
  const tool = getTool(toolId);
  return !!tool && tool.type === b.tool && tool.tier >= b.tier;
}

// Seconds needed to break a block with the given held item (Minecraft-like).
export function breakTime(blockId, toolId) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness === Infinity) return Infinity;
  if (b.hardness <= 0) return 0.05;
  const tool = getTool(toolId);
  let speed = 1;
  if (tool && b.tool && tool.type === b.tool) speed = tool.speed;
  if (tool && tool.type === 'sword' && b.wave === 1) speed = 1.5; // swords cut leaves faster
  const harvest = canHarvest(blockId, toolId);
  return Math.max(0.05, (b.hardness * (harvest ? 1.5 : 5)) / speed);
}

// Items dropped when a block is broken in survival. rand() returns [0,1).
export function getDrops(blockId, toolId, rand = Math.random) {
  const b = BLOCKS[blockId];
  if (!b || !canHarvest(blockId, toolId)) return [];
  switch (blockId) {
    case B.COAL_ORE: return [[I.COAL, 1]];
    case B.DIAMOND_ORE: return [[I.DIAMOND, 1]];
    case B.OAK_LEAVES:
    case B.JUNGLE_LEAVES:
      return rand() < 0.05 ? [[I.APPLE, 1]] : [];
    case B.GRAVEL:
      return [[B.GRAVEL, 1]];
    default:
      return b.drop ? [[b.drop, 1]] : [];
  }
}

export function attackDamage(toolId) {
  const tool = getTool(toolId);
  return tool ? tool.damage : 1;
}

// Durability lost when a tool is used.
export function toolWear(toolId, action) {
  const tool = getTool(toolId);
  if (!tool) return 0;
  if (action === 'attack') return tool.type === 'sword' ? 1 : 2;
  return tool.type === 'sword' ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Hunger (Minecraft-style food, saturation and exhaustion)

export const MAX_FOOD = 20;

export class Hunger {
  constructor(state) {
    this.food = MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.timer = 0;
    if (state) this.load(state);
  }

  load(s) {
    if (Number.isFinite(s.food)) this.food = Math.max(0, Math.min(MAX_FOOD, s.food));
    if (Number.isFinite(s.saturation)) this.saturation = Math.max(0, Math.min(this.food, s.saturation));
    if (Number.isFinite(s.exhaustion)) this.exhaustion = Math.max(0, Math.min(4, s.exhaustion));
  }

  serialize() {
    return { food: this.food, saturation: this.saturation, exhaustion: this.exhaustion };
  }

  exhaust(amount) {
    this.exhaustion += amount;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
  }

  canSprint() { return this.food > 6; }

  canEat() { return this.food < MAX_FOOD; }

  eat(food) {
    this.food = Math.min(MAX_FOOD, this.food + food.hunger);
    this.saturation = Math.min(this.food, this.saturation + food.saturation);
  }

  // Returns health change for this tick: positive heals, negative hurts.
  update(dt, health, maxHealth) {
    this.timer += dt;
    if (this.timer < 4) return 0;
    this.timer = 0;
    if (this.food >= 18 && health < maxHealth) {
      this.exhaust(6);
      return 1;
    }
    if (this.food <= 0 && health > 1) return -1;
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Crafting

// Ingredient groups: any of these ids counts.
export const GROUPS = {
  planks: [B.OAK_PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS, B.JUNGLE_PLANKS],
  logs: [B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG],
};

export const GROUP_NAMES = { planks: 'Any Planks', logs: 'Any Log' };

// station: null (inventory), 'table' (crafting table nearby) or 'furnace'.
export const RECIPES = [];
function r(cat, station, ingredients, out) { RECIPES.push({ cat, station, in: ingredients, out }); }

// Basics
r('Basics', null, [[B.OAK_LOG, 1]], [B.OAK_PLANKS, 4]);
r('Basics', null, [[B.BIRCH_LOG, 1]], [B.BIRCH_PLANKS, 4]);
r('Basics', null, [[B.SPRUCE_LOG, 1]], [B.SPRUCE_PLANKS, 4]);
r('Basics', null, [[B.JUNGLE_LOG, 1]], [B.JUNGLE_PLANKS, 4]);
r('Basics', null, [['planks', 2]], [I.STICK, 4]);
r('Basics', null, [['planks', 4]], [B.CRAFTING_TABLE, 1]);
r('Basics', null, [[I.COAL, 1], [I.STICK, 1]], [B.TORCH, 4]);
// Tools (crafting table)
const TOOL_HEADS = [['wood', 'planks'], ['stone', B.COBBLESTONE], ['iron', I.IRON_INGOT], ['diamond', I.DIAMOND]];
for (const [mat, head] of TOOL_HEADS) {
  r('Tools', 'table', [[head, 3], [I.STICK, 2]], [I[`${mat.toUpperCase()}_PICKAXE`], 1]);
  r('Tools', 'table', [[head, 2], [I.STICK, 1]], [I[`${mat.toUpperCase()}_SWORD`], 1]);
  r('Tools', 'table', [[head, 3], [I.STICK, 2]], [I[`${mat.toUpperCase()}_AXE`], 1]);
  r('Tools', 'table', [[head, 1], [I.STICK, 2]], [I[`${mat.toUpperCase()}_SHOVEL`], 1]);
}
// Building (crafting table)
r('Building', 'table', [[B.COBBLESTONE, 8]], [B.FURNACE, 1]);
r('Building', 'table', [[B.STONE, 4]], [B.STONE_BRICKS, 4]);
r('Building', 'table', [[B.SAND, 4]], [B.SANDSTONE, 1]);
r('Building', 'table', [['planks', 6]], [B.BOOKSHELF, 1]);
r('Building', 'table', [[I.GOLD_INGOT, 1], [I.COAL, 2]], [B.GLOWSTONE, 1]);
// Smelting (furnace, coal is the fuel)
r('Furnace', 'furnace', [[B.IRON_ORE, 1], [I.COAL, 1]], [I.IRON_INGOT, 1]);
r('Furnace', 'furnace', [[B.GOLD_ORE, 1], [I.COAL, 1]], [I.GOLD_INGOT, 1]);
r('Furnace', 'furnace', [[I.RAW_MEAT, 2], [I.COAL, 1]], [I.COOKED_MEAT, 2]);
r('Furnace', 'furnace', [[B.SAND, 2], [I.COAL, 1]], [B.GLASS, 2]);
r('Furnace', 'furnace', [[B.COBBLESTONE, 2], [I.COAL, 1]], [B.STONE, 2]);
r('Furnace', 'furnace', [[B.CLAY, 2], [I.COAL, 1]], [B.BRICKS, 2]);
r('Furnace', 'furnace', [['logs', 2]], [I.COAL, 1]);

export const STATION_NAMES = { table: 'Crafting Table', furnace: 'Furnace' };

// ---------------------------------------------------------------------------
// Inventory: 36 slots (0-8 are the hotbar). A slot is null or { id, count, dmg }.

export class Inventory {
  constructor(size = 36) {
    this.size = size;
    this.slots = new Array(size).fill(null);
    this.cursor = null; // stack held by the mouse in the inventory screen
  }

  load(arr) {
    for (let i = 0; i < this.size; i++) {
      const s = Array.isArray(arr) ? arr[i] : null;
      if (s && isValidItemId(s.id) && Number.isInteger(s.count) && s.count > 0) {
        const slot = { id: s.id, count: Math.min(maxStack(s.id), s.count) };
        const tool = getTool(s.id);
        if (tool) slot.dmg = Math.max(0, Math.min(tool.durability - 1, s.dmg | 0));
        this.slots[i] = slot;
      } else {
        this.slots[i] = null;
      }
    }
  }

  serialize() {
    return this.slots.map((s) => (s ? (s.dmg ? { id: s.id, count: s.count, dmg: s.dmg } : { id: s.id, count: s.count }) : null));
  }

  isEmpty() { return this.slots.every((s) => !s); }

  // Returns how many could not be stored.
  add(id, count = 1) {
    if (!isValidItemId(id)) return count;
    const max = maxStack(id);
    for (let i = 0; i < this.size && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max) {
        const n = Math.min(count, max - s.count);
        s.count += n; count -= n;
      }
    }
    for (let i = 0; i < this.size && count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(count, max);
        this.slots[i] = { id, count: n };
        count -= n;
      }
    }
    return count;
  }

  _matches(id, want) {
    if (typeof want === 'string') return GROUPS[want].includes(id);
    return id === want;
  }

  count(want) {
    let n = 0;
    for (const s of this.slots) if (s && this._matches(s.id, want)) n += s.count;
    return n;
  }

  remove(want, count) {
    for (let i = this.size - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (s && this._matches(s.id, want)) {
        const n = Math.min(count, s.count);
        s.count -= n; count -= n;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count === 0;
  }

  hasStation(recipe, stations) {
    return !recipe.station || !!(stations && stations[recipe.station]);
  }

  canCraft(recipe, stations) {
    return this.hasStation(recipe, stations) && recipe.in.every(([id, n]) => this.count(id) >= n);
  }

  craft(recipe, stations) {
    if (!this.canCraft(recipe, stations)) return false;
    for (const [id, n] of recipe.in) this.remove(id, n);
    const left = this.add(recipe.out[0], recipe.out[1]);
    if (left > 0) {
      // Inventory full: undo by giving the ingredients back.
      this.remove(recipe.out[0], recipe.out[1] - left);
      for (const [id, n] of recipe.in) this.add(typeof id === 'string' ? GROUPS[id][0] : id, n);
      return false;
    }
    return true;
  }

  // Use one item from a slot (placing a block, eating). Returns true if used.
  consume(index, n = 1) {
    const s = this.slots[index];
    if (!s || s.count < n) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[index] = null;
    return true;
  }

  // Wear the tool in a slot. Returns true if it broke.
  wear(index, amount) {
    const s = this.slots[index];
    const tool = s && getTool(s.id);
    if (!tool || amount <= 0) return false;
    s.dmg = (s.dmg || 0) + amount;
    if (s.dmg >= tool.durability) {
      this.slots[index] = null;
      return true;
    }
    return false;
  }

  // Mouse click on a slot in the inventory screen.
  // button 0 = take/put the whole stack, 2 = take half / put one.
  click(index, button) {
    if (index < 0 || index >= this.size) return;
    const s = this.slots[index];
    const c = this.cursor;
    if (!c) {
      if (!s) return;
      if (button === 2 && s.count > 1) {
        const half = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: half };
        s.count -= half;
      } else {
        this.cursor = s;
        this.slots[index] = null;
      }
    } else if (!s) {
      if (button === 2 && c.count > 1) {
        this.slots[index] = { id: c.id, count: 1 };
        c.count--;
      } else {
        this.slots[index] = c;
        this.cursor = null;
      }
    } else if (s.id === c.id && maxStack(s.id) > 1) {
      const room = maxStack(s.id) - s.count;
      const n = Math.min(button === 2 ? 1 : c.count, room);
      s.count += n; c.count -= n;
      if (c.count <= 0) this.cursor = null;
    } else {
      this.slots[index] = c;
      this.cursor = s;
    }
  }

  // Put the cursor stack back into the inventory (when closing the screen).
  returnCursor() {
    if (!this.cursor) return 0;
    const c = this.cursor;
    this.cursor = null;
    if (getTool(c.id)) {
      const i = this.slots.indexOf(null);
      if (i >= 0) { this.slots[i] = c; return 0; }
      return 1;
    }
    return this.add(c.id, c.count);
  }
}

export function isFood(id) { return !!getFood(id); }

export function isPlaceable(id) { return !isItemId(id) && id > 0 && !!BLOCKS[id]; }
