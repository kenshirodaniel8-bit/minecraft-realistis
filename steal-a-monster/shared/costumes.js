// Costumes from the Costume Shop in the plaza. Wearing one changes your
// look and your animations (standing still, attacking, dodging and
// teleporting) and gives you its master power on Z. The "Upgrade your
// power" shop next to it makes every costume power stronger.
//
// power.shape:
//   wave  - a slash wave in front of you (range, arc, maxTargets)
//   ring  - everything around you (radius, maxTargets)
//   chain - lightning that jumps between the nearest monsters (range, maxTargets)
// The damage is exact (no defence, no randomness): 583 means 583.

export const POWER_UPGRADE = {
  bonus: 130,       // + damage per level, for every costume
  maxLevel: 10,
  price: (level) => 20000 * (level + 1), // the next level from `level`
};

export const COSTUMES = [
  {
    id: 'black_spy',
    name: 'Black Spy',
    icon: '🕶️',
    price: 150000,
    blurb: 'All black: a jacket with the STEAL A MONSTER logo, hat, shoes and gloves. At night glowing stickman lines follow your bones and LED lights blink on the suit. Comes with the Spy Sword.',
    style: 'spy',
    colors: { jacket: 0x16161c, pants: 0x0e0e12, shoes: 0x060608, gloves: 0x0a0a0d, hat: 0x0b0b0e, trim: 0x2c2c38, glow: 0x5ff3ff, led: [0x5ff3ff, 0xff3df2, 0x7ef06a] },
    look: { hat: 'fedora', glasses: true, logo: true, nightLines: true, leds: true },
    sword: 'spy_sword',
    power: { name: 'Master Power', damage: 583, shape: 'wave', range: 12, arc: 130, maxTargets: 6, cooldownMs: 6000, color: 0x5ff3ff },
  },
  {
    id: 'flame_ninja',
    name: 'Flame Ninja',
    icon: '🔥',
    price: 60000,
    blurb: 'A red and black ninja suit with a flaming scarf. Its power bursts into a ring of fire that keeps burning.',
    style: 'ninja',
    colors: { jacket: 0x2a1418, pants: 0x1a0c0e, shoes: 0x120808, gloves: 0xd8384a, hat: 0xff6a2a, trim: 0xd8384a, glow: 0xff8a2a },
    look: { hat: 'headband', mask: true, scarf: true },
    power: { name: 'Inferno Burst', damage: 320, shape: 'ring', radius: 8, maxTargets: 8, burn: true, cooldownMs: 5000, color: 0xff6a2a },
  },
  {
    id: 'frost_knight',
    name: 'Frost Knight',
    icon: '❄️',
    price: 45000,
    blurb: 'Shiny ice armour and a helmet with a blue plume. Its power is a blizzard that freezes the monsters around you.',
    style: 'knight',
    colors: { jacket: 0xbfe6ff, pants: 0x8fbfe0, shoes: 0x5a8ab0, gloves: 0x9fd0f0, hat: 0xd8f0ff, trim: 0x4fa8e8, glow: 0x9fe8ff },
    look: { hat: 'helmet', armor: true },
    power: { name: 'Blizzard Nova', damage: 260, shape: 'ring', radius: 10, maxTargets: 10, freezeMs: 1500, cooldownMs: 5500, color: 0x9fe8ff },
  },
  {
    id: 'thunder_hero',
    name: 'Thunder Hero',
    icon: '⚡',
    price: 90000,
    blurb: 'A superhero suit with a lightning bolt on the chest and a flowing cape. Its power calls lightning that jumps between monsters.',
    style: 'hero',
    colors: { jacket: 0xffd23a, pants: 0x2a3a8a, shoes: 0x1a2460, gloves: 0x2a3a8a, hat: 0x2a3a8a, trim: 0x3a5ae0, glow: 0xfff27a },
    look: { hat: 'mask', cape: true, bolt: true },
    power: { name: 'Thunder Strike', damage: 420, shape: 'chain', range: 16, maxTargets: 3, cooldownMs: 5500, color: 0xfff27a },
  },
  {
    id: 'bunny_hoodie',
    name: 'Bunny Hoodie',
    icon: '🐰',
    price: 25000,
    blurb: 'A fluffy pink hoodie with long bunny ears. Its power is a sweet hug of sparkles that heals you.',
    style: 'bunny',
    colors: { jacket: 0xffb3d1, pants: 0xfff0f6, shoes: 0xff7ab8, gloves: 0xfff0f6, hat: 0xffb3d1, trim: 0xffffff, glow: 0xffc2e8 },
    look: { hat: 'bunny', pompom: true },
    power: { name: 'Sweet Hug', damage: 180, shape: 'ring', radius: 7, maxTargets: 8, heal: 0.4, cooldownMs: 7000, color: 0xff9fd8 },
  },
];

// The Legend Master (200,000,000): right after buying it you choose its
// power. The power decides its colours, its glow, its animations, the
// effects of its 10 different sword moves (one after the other, then again)
// and its master power on Z. You can change the power later in the shop.
export const LEGEND_POWERS = {
  fire: {
    name: 'Fire', icon: '🔥', power: 'Phoenix Inferno', blurb: 'A ring of fire that keeps burning',
    colors: { jacket: 0x4a0e0a, pants: 0x2a0806, shoes: 0x1a0504, gloves: 0xff6a1a, hat: 0xffd23a, trim: 0xff8a2a, glow: 0xff6a1a, armor: 0xffb03a, cape: 0xb8141a },
    fx: [0xff6a1a, 0xffd23a, 0xff2a1a], shape: 'ring', radius: 12, maxTargets: 10, burn: true,
  },
  ice: {
    name: 'Ice', icon: '❄️', power: 'Absolute Zero', blurb: 'Ice spikes that freeze everything around you',
    colors: { jacket: 0xdff4ff, pants: 0x5a9ad8, shoes: 0x2a5a9a, gloves: 0x9fe8ff, hat: 0xffffff, trim: 0x5ab8ff, glow: 0x9fe8ff, armor: 0xeaf8ff, cape: 0x2a7ad8 },
    fx: [0x9fe8ff, 0xffffff, 0x5ab8ff], shape: 'ring', radius: 13, maxTargets: 10, freezeMs: 2500,
  },
  lightning: {
    name: 'Lightning', icon: '⚡', power: 'Thunder God', blurb: 'Lightning from the sky on six monsters',
    colors: { jacket: 0x1a1f5a, pants: 0x0e1238, shoes: 0x080a20, gloves: 0xfff27a, hat: 0xffe14a, trim: 0xfff27a, glow: 0xfff27a, armor: 0xffd23a, cape: 0x2a3a9a },
    fx: [0xfff27a, 0xffffff, 0x8fb8ff], shape: 'chain', range: 22, maxTargets: 6,
  },
  shadow: {
    name: 'Shadow', icon: '🌑', power: 'Void Eclipse', blurb: 'A huge wave of darkness in front of you',
    colors: { jacket: 0x14081e, pants: 0x0a0410, shoes: 0x050208, gloves: 0x9a5ae0, hat: 0x2a1040, trim: 0xb48cff, glow: 0xb48cff, armor: 0x3a1a5a, cape: 0x1a0628 },
    fx: [0x6a2ab0, 0xb48cff, 0x14081e], shape: 'wave', range: 18, arc: 180, maxTargets: 10,
  },
  light: {
    name: 'Light', icon: '☀️', power: 'Holy Judgment', blurb: 'Pillars of light; heals you too',
    colors: { jacket: 0xfff8e8, pants: 0xe8d8a8, shoes: 0xc8a840, gloves: 0xffe27a, hat: 0xffe27a, trim: 0xffd23a, glow: 0xffb820, armor: 0xfff2c0, cape: 0xffffff },
    fx: [0xfff6c0, 0xffe27a, 0xffffff], shape: 'ring', radius: 12, maxTargets: 10, heal: 0.3,
  },
  cosmic: {
    name: 'Cosmic', icon: '🌌', power: 'Galaxy Collapse', blurb: 'A star explosion that hits everything around you',
    colors: { jacket: 0x1a1240, pants: 0x0e0a28, shoes: 0x080618, gloves: 0xff7ae0, hat: 0x7affd8, trim: 0x7affd8, glow: 0xff7ae0, armor: 0x5a3ab0, cape: 0x2a1a6a },
    fx: [0xff7ae0, 0x7affd8, 0xb48cff, 0xfff27a], shape: 'ring', radius: 15, maxTargets: 12,
  },
};

COSTUMES.push({
  id: 'legend_master',
  name: 'Legend Master',
  icon: '👑',
  price: 200_000_000,
  blurb: 'The strongest costume: a glowing armoured hero with a crown and a long cape. Choose its power when you buy it — the power changes its colours, every animation, 10 different sword moves and its master power.',
  style: 'legend',
  choosePower: true,
  colors: LEGEND_POWERS.fire.colors,
  look: { hat: 'crown', armor: true, cape: true, glowLines: true },
  power: { name: 'Legend Power', damage: 1200, shape: 'ring', radius: 12, maxTargets: 10, cooldownMs: 6000, color: 0xff6a1a },
});

export const LEGEND_MOVES = 10; // sword moves in a row before they start again

// The costume as it looks and fights with the chosen power (Legend Master).
export function costumeWithPower(costume, powerId) {
  if (!costume?.choosePower) return costume;
  const el = LEGEND_POWERS[powerId] || LEGEND_POWERS.fire;
  return {
    ...costume,
    colors: el.colors,
    look: { ...costume.look, cape: el.colors.cape },
    element: powerId in LEGEND_POWERS ? powerId : 'fire',
    power: {
      ...costume.power, name: el.power, shape: el.shape, color: el.fx[0],
      radius: el.radius, range: el.range, arc: el.arc, maxTargets: el.maxTargets,
      burn: el.burn, freezeMs: el.freezeMs, heal: el.heal,
    },
  };
}

export const COSTUME_BY_ID = Object.fromEntries(COSTUMES.map((c) => [c.id, c]));
export const COSTUME_INDEX = Object.fromEntries(COSTUMES.map((c, i) => [c.id, i]));

// Damage of a costume's master power with the player's power upgrades.
export function powerDamage(costume, level = 0) {
  return costume.power.damage + POWER_UPGRADE.bonus * level;
}
