// Base guards (bought in the Base panel at your base). They fight anyone who
// comes into your base to steal (and thieves carrying your monsters away),
// and they can be beaten: a knocked-out guard gets up again after a while.
// Each upgrade adds guards, better uniforms and swords, and from level 7
// armed helicopters that circle the tower. Level 10: 24 guards, 4 helicopters.

export const GUARDS = {
  buyPrice: 420_000_000,
  maxLevel: 10,
  // price of the upgrade from `level` to level + 1 (level >= 1)
  upgradePrice: (level) => 60_000_000 * level,
  respawnMs: 90_000,          // a knocked-out guard is back after this
  helicopterRange: 46,        // helicopters shoot intruders this close to the tower
  levels: [
    { guards: 2, helis: 0, hp: 600, damage: 20, look: 'basic', sword: 'stone', speed: 13 },
    { guards: 4, helis: 0, hp: 800, damage: 26, look: 'basic', sword: 'iron', speed: 13.5 },
    { guards: 6, helis: 0, hp: 1000, damage: 32, look: 'police', sword: 'iron', speed: 14 },
    { guards: 8, helis: 0, hp: 1300, damage: 40, look: 'police', sword: 'steel', speed: 14.5 },
    { guards: 10, helis: 0, hp: 1700, damage: 50, look: 'armor', sword: 'steel', speed: 15 },
    { guards: 12, helis: 0, hp: 2200, damage: 62, look: 'armor', sword: 'flame', speed: 15.5 },
    { guards: 15, helis: 1, hp: 2800, damage: 76, look: 'elite', sword: 'thunder', speed: 16 },
    { guards: 18, helis: 2, hp: 3500, damage: 92, look: 'elite', sword: 'thunder', speed: 16.5 },
    { guards: 21, helis: 3, hp: 4300, damage: 110, look: 'elite', sword: 'celestial', speed: 17 },
    { guards: 24, helis: 4, hp: 5500, damage: 140, look: 'gold', sword: 'galaxy', speed: 18 },
  ],
};

// Uniforms (drawn with the costume code in client/humanoid.js).
export const GUARD_LOOKS = {
  basic: {
    style: 'guard',
    colors: { jacket: 0x3a6ad8, pants: 0x22325a, shoes: 0x14141c, gloves: 0x22325a, hat: 0x22325a, trim: 0xffd23a, glow: 0x5ab8ff },
    look: { hat: 'cap', badge: true },
  },
  police: {
    style: 'guard',
    colors: { jacket: 0x1f2f5a, pants: 0x141c34, shoes: 0x0a0a10, gloves: 0x0a0a10, hat: 0x141c34, trim: 0xd8dde6, glow: 0x5ab8ff },
    look: { hat: 'cap', badge: true, vest: 0x3a3f4a },
  },
  armor: {
    style: 'guard',
    colors: { jacket: 0x6a7280, pants: 0x3a4048, shoes: 0x22262c, gloves: 0x3a4048, hat: 0x8a929e, trim: 0xd8dde6, glow: 0x9fe8ff },
    look: { hat: 'helmet', armor: true },
  },
  elite: {
    style: 'guard',
    colors: { jacket: 0x14161c, pants: 0x0c0d12, shoes: 0x060608, gloves: 0x0c0d12, hat: 0x1a1c24, trim: 0xff3a4a, glow: 0xff3a4a },
    look: { hat: 'helmet', armor: true, visor: 0xff3a4a },
  },
  gold: {
    style: 'guard',
    colors: { jacket: 0xf3c234, pants: 0x3a2a0a, shoes: 0x2a1a08, gloves: 0xf3c234, hat: 0xffe27a, trim: 0xffffff, glow: 0xfff27a },
    look: { hat: 'helmet', armor: true, visor: 0x7affd8, cape: 0xd8384a },
  },
};

export function guardLevel(level) {
  return level >= 1 ? GUARDS.levels[Math.min(level, GUARDS.maxLevel) - 1] : null;
}

// Where guard number i stands: [u, v, floor] in the base's own axes (u along
// the front, v toward the door; see world.js makeBases). The first ones
// guard the door, then the floors, then more of everything.
export const GUARD_POSTS = [
  [-4, 16, 0], [4, 16, 0], [-6, 1, 0], [6, -0.5, 0], [-6, 0.5, 1], [4, 0.5, 1],
  [-6, 0.5, 2], [4, 0.5, 2], [-6, 0.5, 3], [4, 0.5, 3], [-6, 0.5, 4], [4, 0.5, 4],
  [-7.5, 17, 0], [7.5, 17, 0], [0, -0.5, 0], [0, -0.5, 1], [0, -0.5, 2], [0, -0.5, 3],
  [0, -0.5, 4], [-2, 8, 0], [2, 8, 0], [-8, 5, 1], [-8, 5, 2], [-8, 5, 3],
];
