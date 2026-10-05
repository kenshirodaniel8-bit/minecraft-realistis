// Items that are not blocks: tools, weapons, food and materials.
// Item ids start at 256 so they never collide with block ids (which must fit
// in a byte inside chunk data). Shared by the browser and the server.

import { BLOCKS } from './blocks.js';

export const ITEM_BASE = 256;
export const ITEMS = [];
export const ITEM_BY_KEY = {};
export const I = {};

// Pickaxe/axe/shovel/sword materials. speed = mining multiplier for the right tool.
export const TOOL_MATERIALS = {
  wood: { tier: 0, speed: 2, durability: 59, damage: 0, color: [150, 112, 64], name: 'Wooden' },
  stone: { tier: 1, speed: 4, durability: 131, damage: 1, color: [128, 128, 126], name: 'Stone' },
  iron: { tier: 2, speed: 6, durability: 250, damage: 2, color: [222, 222, 228], name: 'Iron' },
  diamond: { tier: 3, speed: 8, durability: 1561, damage: 3, color: [96, 232, 222], name: 'Diamond' },
};

const TOOL_BASE_DAMAGE = { sword: 4, axe: 3, pickaxe: 2, shovel: 2 };

function def(key, name, opts = {}) {
  const id = ITEM_BASE + ITEMS.length;
  const item = Object.assign({ id, key, name, stack: 64, tool: null, food: null }, opts);
  ITEMS.push(item);
  ITEM_BY_KEY[key] = item;
  I[key.toUpperCase()] = id;
  return item;
}

def('stick', 'Stick');
def('coal', 'Coal');
def('iron_ingot', 'Iron Ingot');
def('gold_ingot', 'Gold Ingot');
def('diamond', 'Diamond');
def('apple', 'Apple', { food: { hunger: 4, saturation: 2.4 } });
def('raw_meat', 'Raw Meat', { food: { hunger: 3, saturation: 1.8 } });
def('cooked_meat', 'Cooked Meat', { food: { hunger: 8, saturation: 12.8 } });

for (const [mat, m] of Object.entries(TOOL_MATERIALS)) {
  for (const type of ['pickaxe', 'axe', 'shovel', 'sword']) {
    def(`${mat}_${type}`, `${m.name} ${type[0].toUpperCase()}${type.slice(1)}`, {
      stack: 1,
      tool: {
        type, material: mat, tier: m.tier, speed: m.speed, durability: m.durability,
        damage: TOOL_BASE_DAMAGE[type] + m.damage,
      },
    });
  }
}

export function isItemId(id) {
  return Number.isInteger(id) && id >= ITEM_BASE && id < ITEM_BASE + ITEMS.length;
}

export function isBlockItem(id) {
  return Number.isInteger(id) && id > 0 && id < ITEM_BASE && BLOCKS[id] !== undefined;
}

// Anything that can sit in an inventory slot.
export function isValidItemId(id) {
  return isBlockItem(id) || isItemId(id);
}

export function getItem(id) {
  return isItemId(id) ? ITEMS[id - ITEM_BASE] : null;
}

export function itemName(id) {
  if (isItemId(id)) return ITEMS[id - ITEM_BASE].name;
  return BLOCKS[id] ? BLOCKS[id].name : '';
}

export function maxStack(id) {
  const it = getItem(id);
  return it ? it.stack : 64;
}

export function getTool(id) {
  const it = getItem(id);
  return it ? it.tool : null;
}

export function getFood(id) {
  const it = getItem(id);
  return it ? it.food : null;
}

// Items shown in the creative inventory after the blocks.
export const CREATIVE_ITEMS = ITEMS.map((it) => it.id);
