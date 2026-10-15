// Generates the 50 species of every monster island (islands.js) from the
// hand-made species: each new species reuses a "template" species' 3D recipe,
// recoloured with the island's palette, with extra features by rarity (marks,
// crests, horns, wings, halos), its own name, stats, attacks, perk and spawn
// rules. Everything is deterministic (seeded), so the server and every client
// build exactly the same 350 species.

import { rngFor } from './rng.js';
import {
  ISLANDS, RARITY_SLOTS, TEMPLATE_STEMS, TEMPLATE_NOUNS, BIG_TEMPLATES, NO_TEMPLATE, NOT_CUTE,
} from './islands.js';

const RARITY_ORDER = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
const ORDER_INDEX = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };

const BASE = {
  common: { hp: 70, atk: 6, def: 3, price: 220, size: 1.0, perk: 0.04, category: 'common' },
  uncommon: { hp: 105, atk: 8, def: 4.5, price: 700, size: 1.06, perk: 0.06, category: 'common' },
  rare: { hp: 190, atk: 11, def: 7, price: 3200, size: 1.2, perk: 0.09, category: 'rare' },
  epic: { hp: 420, atk: 14, def: 9, price: 13000, size: 1.85, perk: 0.13, category: 'elite' },
  legendary: { hp: 800, atk: 18, def: 11, price: 60000, size: 2.2, perk: 0.2, category: 'legendary' },
  mythic: { hp: 1300, atk: 22, def: 14, price: 160000, size: 2.7, perk: 0.28, category: 'mythic' },
};

// ------------------------------------------------------------------ colour

function hexToHsl(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

function jitter(hex, rng, dh = 0.03, ds = 0.08, dl = 0.06) {
  const [h, s, l] = hexToHsl(hex);
  const c = (v) => Math.min(1, Math.max(0, v));
  return hslToHex((h + (rng() - 0.5) * 2 * dh + 1) % 1, c(s + (rng() - 0.5) * 2 * ds), c(l + (rng() - 0.5) * 2 * dl));
}

function mix(a, b, t) {
  const ch = (x, sh) => (x >> sh) & 255;
  const m = (sh) => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

const hexStr = (n) => `#${n.toString(16).padStart(6, '0')}`;
const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const clone = (o) => JSON.parse(JSON.stringify(o));
const niceNumber = (v) => {
  const p = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
};

// ------------------------------------------------------------------ models

const SWAP_EYES = new Set(['gloss', 'gloss-white', 'sparkle', 'lashes', 'happy', 'fierce', 'fierce-white', 'liner', 'sleepy', 'glow', 'cat']);
const SCARY_MOUTHS = new Set(['fangs', 'chomp', 'croc', 'grin']);
const BACK_SHAPES = new Set(['ellipsoid', 'egg', 'pear', 'bean', 'roundbox']);
const BACK_COUNT = { spikes: 5, stars: 7, spots: 4, stripes: 3, crystals: 5, scutes: 5, fur: 4, armor: 4, runes: 4, cracks: 4, quills: 18, ribs: 4, elytra: 2 };

function recolor(model, isl, rng) {
  const pal = isl.palette;
  const main = jitter(pick(rng, pal.main), rng);
  let second = jitter(pick(rng, pal.second), rng);
  if (second === main) second = mix(main, 0x000000, 0.3);
  const c = model.colors;
  const out = { ...c };
  out.body = main;
  out.belly = mix(main, 0xffffff, isl.cute ? 0.65 : 0.55);
  out.accent = second;
  out.accent2 = mix(second, 0xffffff, 0.35);
  out.inner = mix(second, 0xffc8d8, 0.6);
  out.cheek = pal.cheek;
  out.glow = pal.glow;
  if ('wing' in c) out.wing = mix(second, 0xffffff, 0.45);
  if ('face' in c) out.face = mix(main, 0xffffff, 0.4);
  if ('horn' in c) out.horn = mix(second, 0x202020, 0.25);
  if ('shell' in c) out.shell = mix(second, 0xffffff, 0.2);
  model.colors = out;
  if (model.face?.eyes?.color !== undefined) model.face.eyes.color = pal.eye;
}

function mutate(model, isl, rarity, rng) {
  const order = ORDER_INDEX[rarity];
  const face = model.face || (model.face = {});
  // eyes and (on Cute Monster Island) a friendly mouth
  if (face.eyes && SWAP_EYES.has(face.eyes.style) && (isl.cute || rng() < 0.5)) face.eyes.style = pick(rng, isl.eyes);
  if (isl.cute && face.mouth && SCARY_MOUTHS.has(face.mouth.style)) {
    face.mouth = { style: pick(rng, ['smile', 'cat']), size: Math.min(0.14, face.mouth.size || 0.12), y: face.mouth.y ?? -0.2 };
  }
  if (isl.cute && !face.cheeks && face.eyes) face.cheeks = { size: 0.12, gap: (face.eyes.gap || 0.35) + 0.12, y: (face.eyes.y || 0) - 0.18 };
  // a mark on the forehead
  if (order >= 1 && face.eyes && rng() < 0.55 + order * 0.08) {
    const kind = pick(rng, isl.marks);
    face.mark = face.mark
      ? { ...face.mark, kind, color: 'glow', glow: order >= 3 }
      : { kind, color: 'glow', y: (face.eyes.y || 0.1) + 0.33, size: 0.12 + order * 0.01, glow: order >= 3 };
  }
  // back decoration
  if (order >= 1 && BACK_SHAPES.has(model.body?.shape) && rng() < 0.35 + order * 0.1) {
    const style = pick(rng, isl.backs);
    model.back = { style, color: 'accent', color2: 'accent2', count: BACK_COUNT[style] || 4 };
  }
  // crest (Epic and up always, sometimes for Rare)
  if (order >= 3 || (order === 2 && rng() < 0.4)) {
    const style = order >= 4 && rng() < 0.6 ? 'crown' : pick(rng, isl.crests);
    model.crest = { style, color: order >= 4 ? 'glow' : 'accent', tip: 'glow', size: style === 'crown' ? 0.5 : 0.6 };
  }
  // horns
  if (order >= 2 && !model.horns && rng() < 0.3 + order * 0.08) {
    const style = pick(rng, isl.horns);
    model.horns = { style, size: style === 'unicorn' ? 0.55 : 0.5, color: 'accent2', gap: 0.34, tilt: -0.35, count: 2 };
  }
  // wings for the legends
  if (order >= 4 && !model.wings) {
    model.wings = { style: pick(rng, isl.wings), size: order === 5 ? 1.0 : 0.85, color: 'accent', color2: 'accent2', y: (model.body?.y || 1) + 0.1, z: -0.2 };
  }
  const extras = model.extras || [];
  const has = (k) => extras.some((e) => e.kind === k);
  if (order === 5 || (order === 4 && rng() < 0.5)) if (!has('halo')) extras.push({ kind: 'halo', color: 'glow' });
  if (order === 5 && rng() < 0.6 && !has('satellites')) extras.push({ kind: 'satellites', color: 'glow', count: 3 });
  if (extras.length) model.extras = extras;
  model.aura = { kind: pick(rng, isl.auras), color: isl.palette.glow };
}

// Every generated species must look different from all others, not only in
// colour: the combination of template and features (the parts the renderer
// builds) is kept unique, adding variations until it is.
const MARK_KINDS = ['star', 'diamond', 'gem', 'crescent', 'rune', 'dots', 'clover', 'freckles', 'bolt'];
const BACK_STYLES = ['spots', 'stripes', 'stars', 'spikes', 'crystals', 'scutes', 'fur', 'runes', 'cracks', 'quills'];
const EYE_STYLES = ['gloss', 'sparkle', 'lashes', 'happy', 'gloss-white', 'liner', 'glow', 'cat', 'fierce', 'sleepy'];
const CUTE_EYES = ['gloss', 'sparkle', 'lashes', 'happy', 'gloss-white', 'liner'];

function featureKey(templateId, m) {
  const f = m.face || {};
  return [
    templateId, f.eyes?.style, f.mouth?.style, f.cheeks ? 1 : 0, f.mark?.kind, m.back?.style, m.crest?.style,
    m.horns?.style, m.wings?.style, (m.extras || []).map((e) => e.kind).sort().join('+'),
  ].join('|');
}

function applyVariant(model, i, isl) {
  const step = Math.floor(i / 4);
  const face = model.face || {};
  switch (i % 4) {
    case 0:
      if (face.eyes) {
        const kind = MARK_KINDS[step % MARK_KINDS.length];
        face.mark = face.mark ? { ...face.mark, kind } : { kind, color: 'glow', y: (face.eyes.y || 0.1) + 0.33, size: 0.13 };
      }
      break;
    case 1:
      if (BACK_SHAPES.has(model.body?.shape)) {
        const style = BACK_STYLES[step % BACK_STYLES.length];
        model.back = { style, color: 'accent', color2: 'accent2', count: BACK_COUNT[style] || 4 };
      }
      break;
    case 2:
      if (face.eyes && SWAP_EYES.has(face.eyes.style)) {
        const list = isl.cute ? CUTE_EYES : EYE_STYLES;
        face.eyes.style = list[step % list.length];
      }
      break;
    default: {
      const extras = model.extras || (model.extras = []);
      const kind = ['medallion', 'collar'][step % 2];
      if (!extras.some((e) => e.kind === kind)) extras.push({ kind, color: 'accent2', gem: 'glow' });
    }
  }
}

function makeUnique(templateId, model, keys, isl) {
  let key = featureKey(templateId, model);
  for (let i = 0; keys.has(key) && i < 200; i++) {
    applyVariant(model, i, isl);
    key = featureKey(templateId, model);
  }
  keys.add(key);
}

// ------------------------------------------------------------------ species

function attacksFor(template, isl, rarity, rng) {
  const order = ORDER_INDEX[rarity];
  const color = hexStr(mix(isl.palette.glow, isl.palette.second[0], 0.35));
  const list = clone(template.attacks).map((a) => {
    const words = isl.attackWords[a.kind] || isl.attackWords.melee;
    const out = { ...a, name: pick(rng, words), color };
    if (isl.effect && !a.effect && (a.kind === 'projectile' || a.kind === 'breath' || a.kind === 'slam') && rng() < 0.6) out.effect = isl.effect;
    return out;
  });
  if (order >= 4 && !list.some((a) => a.kind === 'slam')) {
    list.push({ kind: 'slam', name: pick(rng, isl.attackWords.slam), range: 3.5, radius: order === 5 ? 8 : 6.5, power: 1.6, windupMs: 1000, cooldownMs: 5600, knockback: 16, color, ...(isl.effect ? { effect: isl.effect } : {}) });
  }
  // names must differ within one monster
  const seen = new Set();
  for (const a of list) {
    if (seen.has(a.name)) a.name = `${a.name} II`;
    seen.add(a.name);
  }
  return list;
}

function temperFor(isl, rarity, rng) {
  const order = ORDER_INDEX[rarity];
  if (order >= 4) return 'territorial';
  if (isl.cute) return order >= 3 ? 'territorial' : order >= 2 ? pick(rng, ['neutral', 'territorial']) : pick(rng, ['shy', 'neutral', 'shy']);
  if (order === 3) return pick(rng, ['aggressive', 'territorial']);
  if (order === 2) return pick(rng, ['aggressive', 'territorial', 'neutral']);
  return pick(rng, ['neutral', 'shy', 'neutral', 'aggressive']);
}

function makeSpecies(isl, template, rarity, name, rng, usedIds, keys) {
  const order = ORDER_INDEX[rarity];
  const B = BASE[rarity];
  const T = 1 + 0.35 * isl.tier;
  const j = () => 0.9 + rng() * 0.2;
  let id = `${isl.id}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
  while (usedIds.has(id)) id += 'x';
  usedIds.add(id);
  const noun = TEMPLATE_NOUNS[template.id] || 'Monster';
  const adj = pick(rng, isl.adjectives);
  const price = niceNumber(B.price * T * T * (0.9 + rng() * 0.25));
  const model = clone(template.model);
  recolor(model, isl, rng);
  mutate(model, isl, rarity, rng);
  makeUnique(template.id, model, keys, isl);
  const ai = { ...clone(template.ai), temper: temperFor(isl, rarity, rng) };
  if (order >= 4) ai.boss = true;
  else delete ai.boss;
  ai.detect = Math.max(ai.detect || 12, 12 + order);
  const spawn = order === 5
    ? { regions: [isl.id], spot: `${isl.id}_shrine`, chance: 0.6, respawnMs: 300000, weight: 0 }
    : order === 4
      ? { regions: [isl.id], spot: `${isl.id}_lair`, chance: 0.7, respawnMs: 150000, weight: 0 }
      : { regions: [isl.id], weight: [10, 5, 2.2, 0.8][order], group: order === 0 ? [1, 3] : order === 1 ? [1, 2] : [1, 1] };
  if (template.spawn.water && order <= 3) spawn.water = true;
  const element = pick(rng, isl.elements);
  const rarityWord = rarity[0].toUpperCase() + rarity.slice(1);
  const trait = pick(rng, isl.traits);
  return {
    id,
    name,
    title: order >= 4 ? `${rarityWord} ${noun} of ${isl.name}` : `${adj} ${noun}`,
    element,
    rarity,
    category: B.category,
    island: isl.id,
    template: template.id,
    description: order >= 4
      ? `One of the ${rarityWord} monsters of ${isl.name}. It ${trait}, and it does not let just anyone recruit it.`
      : `A ${adj.toLowerCase()} ${noun.toLowerCase()} from ${isl.name}. It ${trait}.`,
    spawn,
    stats: {
      hp: Math.round(B.hp * T ** 0.8 * j()),
      atk: Math.round(B.atk * T ** 0.5 * j()),
      def: Math.round(B.def * T ** 0.5 * j()),
      speed: Math.round((template.stats.speed + order * 0.4) * 10) / 10,
    },
    size: Math.round(B.size * (0.95 + rng() * 0.1) * 100) / 100,
    ai,
    attacks: attacksFor(template, isl, rarity, rng),
    price,
    income: Math.round((price / (90 + 35 * order)) * 10) / 10,
    perk: { kind: pick(rng, isl.perks), value: B.perk },
    personality: clone(template.personality),
    model,
  };
}

// Deal the remaining templates over the rarities so that every rarity gets
// some of the island's most typical monsters.
function dealSlots(templates, counts) {
  const left = { ...counts };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const out = [];
  for (const t of templates) {
    if (out.length >= total) break;
    let best = null;
    for (const r of Object.keys(left)) {
      if (left[r] <= 0) continue;
      const share = left[r] / counts[r];
      if (!best || share > best.share) best = { r, share };
    }
    left[best.r]--;
    out.push([t, best.r]);
  }
  return out;
}

export function generateIslandSpecies(baseSpecies) {
  const byId = Object.fromEntries(baseSpecies.map((s) => [s.id, s]));
  const usedIds = new Set(baseSpecies.map((s) => s.id));
  const usedNames = new Set(baseSpecies.map((s) => s.name.toLowerCase()));
  const keys = new Set(baseSpecies.map((s) => featureKey(s.id, s.model)));
  const all = [];
  for (const isl of ISLANDS) {
    const rng = rngFor('island-species', isl.id);
    const prefixes = [...isl.prefixes];
    for (let i = prefixes.length - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1));
      [prefixes[i], prefixes[k]] = [prefixes[k], prefixes[i]];
    }
    let pi = 0;
    const nameFor = (template) => {
      for (let tries = 0; tries < prefixes.length * 2; tries++) {
        const p = prefixes[pi++ % prefixes.length];
        const n = p + TEMPLATE_STEMS[template];
        if (!usedNames.has(n.toLowerCase())) return n;
      }
      return `${prefixes[0]}${TEMPLATE_STEMS[template]}${all.length}`;
    };
    const take = (name) => usedNames.add(name.toLowerCase());
    const used = new Map(); // template -> times used on this island
    const use = (t) => used.set(t, (used.get(t) || 0) + 1);
    const list = [];
    for (const r of ['mythic', 'legendary']) {
      for (const [t, name] of isl.top[r]) {
        take(name);
        use(t);
        list.push(makeSpecies(isl, byId[t], r, name, rng, usedIds, keys));
      }
    }
    for (const t of isl.top.epic) {
      const name = nameFor(t);
      take(name);
      use(t);
      list.push(makeSpecies(isl, byId[t], 'epic', name, rng, usedIds, keys));
    }
    // the rest: Rare, Uncommon and Common from the island's template list
    const counts = { rare: RARITY_SLOTS.rare, uncommon: RARITY_SLOTS.uncommon, common: RARITY_SLOTS.common };
    const need = counts.rare + counts.uncommon + counts.common;
    const ok = (t) => byId[t] && !BIG_TEMPLATES.has(t) && !NO_TEMPLATE.has(t) && !(isl.cute && NOT_CUTE.has(t));
    const pool = [];
    for (let round = 0; pool.length < need && round < 3; round++) {
      for (const t of isl.templates) {
        if (pool.length >= need) break;
        if (!ok(t) || (used.get(t) || 0) > round) continue;
        use(t);
        pool.push(t);
      }
    }
    for (const [t, r] of dealSlots(pool, counts)) {
      const name = nameFor(t);
      take(name);
      list.push(makeSpecies(isl, byId[t], r, name, rng, usedIds, keys));
    }
    // strongest first within the island, like the Monsterdex shows them
    list.sort((a, b) => ORDER_INDEX[b.rarity] - ORDER_INDEX[a.rarity]);
    all.push(...list);
  }
  return all;
}

export { RARITY_ORDER };
