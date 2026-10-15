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

export const COSTUME_BY_ID = Object.fromEntries(COSTUMES.map((c) => [c.id, c]));
export const COSTUME_INDEX = Object.fromEntries(COSTUMES.map((c, i) => [c.id, i]));

// Damage of a costume's master power with the player's power upgrades.
export function powerDamage(costume, level = 0) {
  return costume.power.damage + POWER_UPGRADE.bonus * level;
}
