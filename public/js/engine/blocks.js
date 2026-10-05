// Block registry shared by the client, workers and server.
//
// render types:
//   none   - air, never drawn
//   cube   - full opaque cube
//   cutout - full cube with alpha-tested texture (leaves, glass)
//   cross  - two crossed quads (grass, flowers, vines)
//   water  - translucent liquid
//   torch  - small stick model

export const TEXTURE_NAMES = [
  'stone', 'dirt', 'grass_top', 'grass_side', 'grass_snow_side', 'cobblestone',
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
  'bedrock', 'sand', 'gravel', 'clay',
  'oak_log', 'oak_log_top', 'birch_log', 'birch_log_top', 'spruce_log', 'spruce_log_top',
  'jungle_log', 'jungle_log_top',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
  'glass', 'water',
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore',
  'sandstone_top', 'sandstone_side', 'sandstone_bottom',
  'snow', 'bricks', 'stone_bricks', 'mossy_cobblestone',
  'torch', 'glowstone',
  'tall_grass', 'fern', 'poppy', 'dandelion', 'cornflower', 'dead_bush', 'vines',
  'cactus_side', 'cactus_top',
  'wool_white', 'wool_red', 'wool_blue', 'wool_green', 'wool_yellow', 'wool_black',
  'bookshelf', 'obsidian', 'granite', 'diorite', 'andesite',
  'podzol_top', 'podzol_side', 'moss_block', 'ice',
];

export const TEX = {};
TEXTURE_NAMES.forEach((n, i) => { TEX[n] = i; });

export const BLOCKS = [];
export const BLOCK_BY_NAME = {};

const DEFAULTS = {
  render: 'cube',
  solid: true,
  opaque: true,
  emit: 0,
  hardness: 1,
  drop: null, // null -> drops itself, 0 -> drops nothing
  tint: null, // 'grass' | 'foliage' | [r,g,b]
  sound: 'stone',
  needsSupport: false,
  creative: true,
  wave: 0, // 0 none, 1 leaves, 2 plant (top vertices), 3 hanging vine
  replaceable: false, // can be overwritten by placing a block (tall grass, water)
  lightAttenuation: 0, // extra light loss when light passes through (non-opaque only)
};

function def(id, key, name, tex, opts = {}) {
  const b = Object.assign({}, DEFAULTS, opts, { id, key, name });
  let t = tex;
  if (typeof t === 'string') t = { top: t, bottom: t, side: t };
  if (t) {
    b.tex = {
      top: TEX[t.top], bottom: TEX[t.bottom], side: TEX[t.side],
    };
    for (const k of ['top', 'bottom', 'side']) {
      if (b.tex[k] === undefined) throw new Error('Unknown texture for block ' + key + ': ' + t[k]);
    }
  } else {
    b.tex = null;
  }
  if (b.render !== 'cube') b.opaque = false;
  if (b.render === 'cross' || b.render === 'water' || b.render === 'torch' || b.render === 'none') b.solid = false;
  if (b.drop === null) b.drop = id;
  BLOCKS[id] = b;
  BLOCK_BY_NAME[key] = b;
  return id;
}

export const B = {
  AIR: def(0, 'air', 'Air', null, { render: 'none', solid: false, opaque: false, hardness: 0, creative: false, replaceable: true, drop: 0 }),
  STONE: def(1, 'stone', 'Stone', 'stone', { hardness: 1.5, drop: 4 }),
  GRASS: def(2, 'grass', 'Grass Block', { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, { hardness: 0.6, tint: 'grass', sound: 'grass', drop: 3 }),
  DIRT: def(3, 'dirt', 'Dirt', 'dirt', { hardness: 0.5, sound: 'gravel' }),
  COBBLESTONE: def(4, 'cobblestone', 'Cobblestone', 'cobblestone', { hardness: 2 }),
  OAK_PLANKS: def(5, 'oak_planks', 'Oak Planks', 'oak_planks', { hardness: 2, sound: 'wood' }),
  BEDROCK: def(6, 'bedrock', 'Bedrock', 'bedrock', { hardness: Infinity, creative: true }),
  SAND: def(7, 'sand', 'Sand', 'sand', { hardness: 0.5, sound: 'sand' }),
  GRAVEL: def(8, 'gravel', 'Gravel', 'gravel', { hardness: 0.6, sound: 'gravel' }),
  OAK_LOG: def(9, 'oak_log', 'Oak Log', { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' }, { hardness: 2, sound: 'wood' }),
  OAK_LEAVES: def(10, 'oak_leaves', 'Oak Leaves', 'oak_leaves', { render: 'cutout', solid: true, hardness: 0.2, tint: 'foliage', sound: 'grass', wave: 1, drop: 0, lightAttenuation: 1 }),
  GLASS: def(11, 'glass', 'Glass', 'glass', { render: 'cutout', solid: true, hardness: 0.3, sound: 'glass', drop: 0 }),
  WATER: def(12, 'water', 'Water', 'water', { render: 'water', hardness: Infinity, sound: 'water', replaceable: true, drop: 0, lightAttenuation: 1 }),
  COAL_ORE: def(13, 'coal_ore', 'Coal Ore', 'coal_ore', { hardness: 3 }),
  IRON_ORE: def(14, 'iron_ore', 'Iron Ore', 'iron_ore', { hardness: 3 }),
  GOLD_ORE: def(15, 'gold_ore', 'Gold Ore', 'gold_ore', { hardness: 3 }),
  DIAMOND_ORE: def(16, 'diamond_ore', 'Diamond Ore', 'diamond_ore', { hardness: 3 }),
  BIRCH_LOG: def(17, 'birch_log', 'Birch Log', { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log' }, { hardness: 2, sound: 'wood' }),
  BIRCH_LEAVES: def(18, 'birch_leaves', 'Birch Leaves', 'birch_leaves', { render: 'cutout', solid: true, hardness: 0.2, tint: [0.50, 0.66, 0.33], sound: 'grass', wave: 1, drop: 0, lightAttenuation: 1 }),
  SPRUCE_LOG: def(19, 'spruce_log', 'Spruce Log', { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log' }, { hardness: 2, sound: 'wood' }),
  SPRUCE_LEAVES: def(20, 'spruce_leaves', 'Spruce Leaves', 'spruce_leaves', { render: 'cutout', solid: true, hardness: 0.2, tint: [0.36, 0.55, 0.38], sound: 'grass', wave: 1, drop: 0, lightAttenuation: 1 }),
  JUNGLE_LOG: def(21, 'jungle_log', 'Jungle Log', { top: 'jungle_log_top', bottom: 'jungle_log_top', side: 'jungle_log' }, { hardness: 2, sound: 'wood' }),
  JUNGLE_LEAVES: def(22, 'jungle_leaves', 'Jungle Leaves', 'jungle_leaves', { render: 'cutout', solid: true, hardness: 0.2, tint: 'foliage', sound: 'grass', wave: 1, drop: 0, lightAttenuation: 1 }),
  SANDSTONE: def(23, 'sandstone', 'Sandstone', { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, { hardness: 0.8 }),
  SNOW_GRASS: def(24, 'snowy_grass', 'Snowy Grass Block', { top: 'snow', bottom: 'dirt', side: 'grass_snow_side' }, { hardness: 0.6, sound: 'snow', drop: 3 }),
  SNOW: def(25, 'snow', 'Snow Block', 'snow', { hardness: 0.2, sound: 'snow' }),
  BRICKS: def(26, 'bricks', 'Bricks', 'bricks', { hardness: 2 }),
  STONE_BRICKS: def(27, 'stone_bricks', 'Stone Bricks', 'stone_bricks', { hardness: 1.5 }),
  MOSSY_COBBLESTONE: def(28, 'mossy_cobblestone', 'Mossy Cobblestone', 'mossy_cobblestone', { hardness: 2 }),
  TORCH: def(29, 'torch', 'Torch', 'torch', { render: 'torch', hardness: 0, emit: 14, sound: 'wood', needsSupport: true }),
  GLOWSTONE: def(30, 'glowstone', 'Glowstone', 'glowstone', { hardness: 0.3, emit: 15, sound: 'glass' }),
  TALL_GRASS: def(31, 'tall_grass', 'Tall Grass', 'tall_grass', { render: 'cross', hardness: 0, tint: 'grass', sound: 'grass', needsSupport: true, wave: 2, replaceable: true, drop: 0 }),
  FERN: def(32, 'fern', 'Fern', 'fern', { render: 'cross', hardness: 0, tint: 'grass', sound: 'grass', needsSupport: true, wave: 2, replaceable: true, drop: 0 }),
  POPPY: def(33, 'poppy', 'Poppy', 'poppy', { render: 'cross', hardness: 0, sound: 'grass', needsSupport: true, wave: 2 }),
  DANDELION: def(34, 'dandelion', 'Dandelion', 'dandelion', { render: 'cross', hardness: 0, sound: 'grass', needsSupport: true, wave: 2 }),
  CORNFLOWER: def(35, 'cornflower', 'Cornflower', 'cornflower', { render: 'cross', hardness: 0, sound: 'grass', needsSupport: true, wave: 2 }),
  DEAD_BUSH: def(36, 'dead_bush', 'Dead Bush', 'dead_bush', { render: 'cross', hardness: 0, sound: 'grass', needsSupport: true, replaceable: true }),
  CACTUS: def(37, 'cactus', 'Cactus', { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, { hardness: 0.4, sound: 'cloth' }),
  WHITE_WOOL: def(38, 'white_wool', 'White Wool', 'wool_white', { hardness: 0.8, sound: 'cloth' }),
  RED_WOOL: def(39, 'red_wool', 'Red Wool', 'wool_red', { hardness: 0.8, sound: 'cloth' }),
  BLUE_WOOL: def(40, 'blue_wool', 'Blue Wool', 'wool_blue', { hardness: 0.8, sound: 'cloth' }),
  GREEN_WOOL: def(41, 'green_wool', 'Green Wool', 'wool_green', { hardness: 0.8, sound: 'cloth' }),
  YELLOW_WOOL: def(42, 'yellow_wool', 'Yellow Wool', 'wool_yellow', { hardness: 0.8, sound: 'cloth' }),
  BLACK_WOOL: def(43, 'black_wool', 'Black Wool', 'wool_black', { hardness: 0.8, sound: 'cloth' }),
  BOOKSHELF: def(44, 'bookshelf', 'Bookshelf', { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, { hardness: 1.5, sound: 'wood' }),
  OBSIDIAN: def(45, 'obsidian', 'Obsidian', 'obsidian', { hardness: 12 }),
  GRANITE: def(46, 'granite', 'Granite', 'granite', { hardness: 1.5 }),
  DIORITE: def(47, 'diorite', 'Diorite', 'diorite', { hardness: 1.5 }),
  ANDESITE: def(48, 'andesite', 'Andesite', 'andesite', { hardness: 1.5 }),
  VINES: def(49, 'vines', 'Hanging Vines', 'vines', { render: 'cross', hardness: 0, tint: 'foliage', sound: 'grass', wave: 3, replaceable: true, drop: 0, needsSupport: false }),
  PODZOL: def(50, 'podzol', 'Podzol', { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' }, { hardness: 0.5, sound: 'gravel', drop: 3 }),
  MOSS_BLOCK: def(51, 'moss_block', 'Moss Block', 'moss_block', { hardness: 0.3, sound: 'grass' }),
  SPRUCE_PLANKS: def(52, 'spruce_planks', 'Spruce Planks', 'spruce_planks', { hardness: 2, sound: 'wood' }),
  BIRCH_PLANKS: def(53, 'birch_planks', 'Birch Planks', 'birch_planks', { hardness: 2, sound: 'wood' }),
  JUNGLE_PLANKS: def(54, 'jungle_planks', 'Jungle Planks', 'jungle_planks', { hardness: 2, sound: 'wood' }),
  CLAY: def(55, 'clay', 'Clay', 'clay', { hardness: 0.6, sound: 'gravel' }),
  ICE: def(56, 'ice', 'Ice', 'ice', { hardness: 0.5, sound: 'glass' }),
};

export const BLOCK_COUNT = BLOCKS.length;

// Fast lookup tables (indexed by block id) for the hot loops of the mesher and physics.
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const RENDER = new Uint8Array(256); // 0 none,1 cube,2 cutout,3 cross,4 water,5 torch
export const EMIT = new Uint8Array(256);
export const LIGHT_ATTEN = new Uint8Array(256);
export const RENDER_TYPES = { none: 0, cube: 1, cutout: 2, cross: 3, water: 4, torch: 5 };

for (const b of BLOCKS) {
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  RENDER[b.id] = RENDER_TYPES[b.render];
  EMIT[b.id] = b.emit;
  LIGHT_ATTEN[b.id] = b.lightAttenuation;
}

export function isValidBlockId(id) {
  return Number.isInteger(id) && id >= 0 && id < BLOCK_COUNT && BLOCKS[id] !== undefined;
}

export function getBlock(id) {
  return BLOCKS[id] || BLOCKS[0];
}

// Blocks offered in the creative inventory, in a sensible order.
export const CREATIVE_ORDER = [
  'grass', 'dirt', 'stone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'bricks',
  'granite', 'diorite', 'andesite', 'sand', 'sandstone', 'gravel', 'clay',
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
  'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'bookshelf',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
  'glass', 'ice', 'snow', 'snowy_grass', 'podzol', 'moss_block',
  'torch', 'glowstone', 'obsidian', 'bedrock',
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore',
  'white_wool', 'red_wool', 'blue_wool', 'green_wool', 'yellow_wool', 'black_wool',
  'tall_grass', 'fern', 'poppy', 'dandelion', 'cornflower', 'dead_bush', 'vines', 'cactus',
  'water',
].map((k) => BLOCK_BY_NAME[k].id);

// Simple survival crafting recipes (ingredients -> result).
export const RECIPES = [
  { in: [[B.OAK_LOG, 1]], out: [B.OAK_PLANKS, 4] },
  { in: [[B.BIRCH_LOG, 1]], out: [B.BIRCH_PLANKS, 4] },
  { in: [[B.SPRUCE_LOG, 1]], out: [B.SPRUCE_PLANKS, 4] },
  { in: [[B.JUNGLE_LOG, 1]], out: [B.JUNGLE_PLANKS, 4] },
  { in: [[B.OAK_PLANKS, 1], [B.COAL_ORE, 1]], out: [B.TORCH, 4] },
  { in: [[B.SAND, 4]], out: [B.SANDSTONE, 1] },
  { in: [[B.SAND, 1], [B.COAL_ORE, 1]], out: [B.GLASS, 2] },
  { in: [[B.COBBLESTONE, 1], [B.COAL_ORE, 1]], out: [B.STONE, 4] },
  { in: [[B.STONE, 4]], out: [B.STONE_BRICKS, 4] },
  { in: [[B.CLAY, 2], [B.COAL_ORE, 1]], out: [B.BRICKS, 2] },
  { in: [[B.OAK_PLANKS, 6]], out: [B.BOOKSHELF, 1] },
  { in: [[B.GOLD_ORE, 1], [B.SANDSTONE, 1]], out: [B.GLOWSTONE, 1] },
];
