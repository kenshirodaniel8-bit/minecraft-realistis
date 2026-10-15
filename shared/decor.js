// Base decorations. Bought at your base terminal (Money, and Gems for the
// fancy ones) and placed on the decoration spots along your base walls.
// Trophies cannot be bought: collection milestones award them.
// Decorations are cosmetic: they show off a base to everyone who visits.

export const DECOR = [
  { id: 'flower_bed', name: 'Flower Bed', icon: '🌷', price: 600, gems: 0, desc: 'A cheerful patch of flowers.' },
  { id: 'snack_bowl', name: 'Snack Bowl', icon: '🥣', price: 900, gems: 0, desc: 'Snack time is the best time.' },
  { id: 'lantern', name: 'Paper Lantern', icon: '🏮', price: 1200, gems: 0, desc: 'Glows softly, day and night.' },
  { id: 'monster_bed', name: 'Cozy Monster Bed', icon: '🛏', price: 2500, gems: 0, desc: 'A round cushion for naps.' },
  { id: 'mushroom_lamp', name: 'Mushroom Lamp', icon: '🍄', price: 4000, gems: 0, desc: 'A glowing toadstool from the Shadow Forest.' },
  { id: 'fountain', name: 'Bubble Fountain', icon: '⛲', price: 9000, gems: 0, desc: 'Water monsters adore it.' },
  { id: 'crystal_cluster', name: 'Crystal Cluster', icon: '🔮', price: 6000, gems: 3, desc: 'Sparkling crystals that catch the light.' },
  { id: 'gold_statue', name: 'Golden Dragon Statue', icon: '🐉', price: 30000, gems: 12, desc: 'A shiny statue of a very proud baby dragon.' },
  { id: 'trophy_bronze', name: 'Bronze Trophy', icon: '🥉', milestone: true, desc: 'Awarded for owning 6 different species.' },
  { id: 'trophy_silver', name: 'Silver Trophy', icon: '🥈', milestone: true, desc: 'Awarded for owning 10 different species.' },
  { id: 'trophy_gold', name: 'Gold Trophy', icon: '🥇', milestone: true, desc: 'Awarded for owning 20 different species.' },
];

export const DECOR_BY_ID = Object.fromEntries(DECOR.map((d) => [d.id, d]));
export const DECOR_SPOTS = 8;      // per base
export const DECOR_MAX_OWNED = 8;  // copies of one decoration a player can own

// How many copies of each decoration are currently placed.
export function placedCounts(placed) {
  const n = {};
  for (const id of placed || []) if (id) n[id] = (n[id] || 0) + 1;
  return n;
}
