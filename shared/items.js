// Action items for player-vs-player interactions (separate from sword combat).
//
// kind:
//   tool     - bought once, reusable with a cooldown
//   consumable - bought in stacks, one charge per use
// target:
//   player   - aimed at another player in front of you (server picks the target)
//   self     - affects yourself
//   ground   - placed where you stand
//
// A valid hit on a player carrying a stolen monster interrupts the theft when
// `interrupts` is true.

export const ITEMS = [
  {
    id: 'knockback', name: 'Boing Glove', kind: 'tool', target: 'player', price: 400, maxStack: 1,
    range: 6, arc: 70, cooldownMs: 4000, knockback: 20, lift: 9, interrupts: true,
    color: '#ff5a7a', icon: '🥊',
    description: 'A spring-loaded glove that sends a nearby player flying. Knocks stolen monsters out of a thief\'s arms.',
  },
  {
    id: 'sticky_trap', name: 'Sticky Trap', kind: 'consumable', target: 'ground', price: 150, maxStack: 10,
    cooldownMs: 1500, durationMs: 30000, triggerRadius: 2.2, rootMs: 2500, maxActive: 2, interrupts: true,
    color: '#9be04a', icon: '🕸️',
    description: 'Drop a gooey trap. The next rival who steps in is stuck for a moment and drops what they carry.',
  },
  {
    id: 'freeze', name: 'Freeze Ray', kind: 'tool', target: 'player', price: 1800, maxStack: 1,
    range: 18, arc: 30, cooldownMs: 12000, freezeMs: 1600, interrupts: true,
    color: '#7fd8ff', icon: '❄️',
    description: 'Freezes a player in a block of ice for a moment, from a distance.',
  },
  {
    id: 'capture_net', name: 'Tangle Net', kind: 'tool', target: 'player', price: 1200, maxStack: 1,
    range: 13, arc: 35, cooldownMs: 10000, rootMs: 2000, interrupts: true,
    color: '#c8a26a', icon: '🥅',
    description: 'Throws a net over a player, tangling them up. (It does not catch monsters — you recruit those!)',
  },
  {
    id: 'slippery_gel', name: 'Slippery Gel', kind: 'consumable', target: 'ground', price: 200, maxStack: 10,
    cooldownMs: 3000, durationMs: 14000, triggerRadius: 4, slipMs: 1200, maxActive: 2, interrupts: true,
    color: '#5affc8', icon: '🫧',
    description: 'Splashes a slippery puddle. Rivals running through it slip and drop what they carry.',
  },
  {
    id: 'shield', name: 'Bubble Shield', kind: 'consumable', target: 'self', price: 300, maxStack: 10,
    cooldownMs: 30000, durationMs: 6000,
    color: '#8fb8ff', icon: '🛡️',
    description: 'Protects you from every gadget for a few seconds.',
  },
  {
    id: 'speed_boost', name: 'Zoom Soda', kind: 'consumable', target: 'self', price: 220, maxStack: 10,
    cooldownMs: 15000, durationMs: 6000, speedMultiplier: 1.45,
    color: '#ffd23a', icon: '⚡',
    description: 'Run 45% faster for a few seconds. Great for escaping with a stolen monster.',
  },
  {
    id: 'detector', name: 'Monster Radar', kind: 'consumable', target: 'self', price: 250, maxStack: 10,
    cooldownMs: 5000, durationMs: 60000, radius: 180,
    color: '#ff9f3a', icon: '📡',
    description: 'Shows rare and hidden monsters on your minimap for one minute.',
  },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
export const HOTBAR_ORDER = ITEMS.map((i) => i.id);
