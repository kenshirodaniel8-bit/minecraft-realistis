// Lucky Blocks, their reward tables, and cosmetics.
// Rewards are always rolled on the server; the client only shows the result.

export const LUCKY_KINDS = {
  lucky: { name: 'Lucky Block', color: 0xffc23a, color2: 0xfff27a, moneyMult: 1 },
  super: { name: 'Super Lucky Block', color: 0x7a5aff, color2: 0xff7af0, moneyMult: 2.5 },
  mythic: { name: 'Mythic Lucky Block', color: 0xff3d6a, color2: 0xffe23a, moneyMult: 5 },
  // not a Lucky Block: a rock full of Monster Gems in the gem-rich regions
  geode: { name: 'Gem Geode', color: 0x6a4a3a, color2: 0xff6af0, moneyMult: 1, geode: true },
};

// weight: base chance weight; luckWeight: extra weight per point of luck
// (luck = 0 normally, up to ~1 with perks; event blocks add luck too).
export const LUCKY_TABLE = [
  { kind: 'money', weight: 34, luckWeight: -8, min: 60, max: 180 },
  { kind: 'money', weight: 12, luckWeight: 6, min: 250, max: 600, big: true },
  { kind: 'xp', weight: 12, luckWeight: 0, min: 40, max: 120 },
  { kind: 'item', weight: 14, luckWeight: 0, pool: ['sticky_trap', 'slippery_gel', 'shield', 'speed_boost', 'detector'], qty: [1, 3] },
  { kind: 'tool', weight: 3, luckWeight: 2, pool: ['knockback', 'capture_net', 'freeze'] },
  { kind: 'discount', weight: 8, luckWeight: 3, value: 0.25 },
  { kind: 'clue', weight: 7, luckWeight: 4 },
  { kind: 'encounter', weight: 5, luckWeight: 4 },
  { kind: 'cosmetic', weight: 4, luckWeight: 3 },
  { kind: 'sword', weight: 1.5, luckWeight: 2.5 },
  { kind: 'gems', weight: 6, luckWeight: 3, min: 1, max: 3 },
];

export const COSMETICS = [
  { id: 'party_hat', name: 'Party Hat', color: 0xff5a9a },
  { id: 'lucky_crown', name: 'Lucky Crown', color: 0xffd23a },
  { id: 'flower_crown', name: 'Flower Crown', color: 0xff9fd8 },
  { id: 'monster_ears', name: 'Monster Ears', color: 0xffa23a },
  { id: 'halo', name: 'Starlight Halo', color: 0xfff7a8 },
  { id: 'top_hat', name: 'Fancy Top Hat', color: 0x2a2a3a },
  { id: 'propeller', name: 'Propeller Cap', color: 0x4fb8ff },
  { id: 'horns', name: 'Dragon Horns', color: 0xd8452a },
];

export const COSMETIC_BY_ID = Object.fromEntries(COSMETICS.map((c) => [c.id, c]));
export const COSMETIC_INDEX = Object.fromEntries(COSMETICS.map((c, i) => [c.id, i]));

export function rollLucky(rng, luck = 0) {
  let total = 0;
  const weights = LUCKY_TABLE.map((e) => {
    const w = Math.max(0.5, e.weight + e.luckWeight * luck);
    total += w;
    return w;
  });
  let r = rng() * total;
  for (let i = 0; i < LUCKY_TABLE.length; i++) {
    r -= weights[i];
    if (r <= 0) return LUCKY_TABLE[i];
  }
  return LUCKY_TABLE[0];
}
