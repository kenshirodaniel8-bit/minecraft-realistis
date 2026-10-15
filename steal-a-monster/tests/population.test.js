// Wild monster population: 50 on every island while a player is there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A } from './helpers.js';
import { CONFIG } from '../shared/config.js';
import { REGIONS, REGION_BY_ID, regionCenter } from '../shared/regions.js';

const wild = (h, id) => [...h.game.monsters.list.values()].filter((m) => m.region === id && !m.spot && !m.event);

// stand somewhere for a while without getting knocked out
function stay(h, a, ms) {
  for (let t = 0; t < ms; t += 250) {
    h.advance(250, 50);
    a.s.hp = a.s.maxHp;
  }
}

test('an island fills up to 50 wild monsters while a player is on it, spread over it, and empties after they leave', async () => {
  const h = await makeGame({ spawning: true });
  const a = await h.join(TOKEN_A, 'Alice');
  a.profile.level = 30;
  const desert = regionCenter(REGION_BY_ID.desert);
  h.place(a, desert.x, desert.z);
  stay(h, a, 15000);
  const list = wild(h, 'desert');
  assert.equal(list.length, CONFIG.monsters.perRegion, 'the desert has its 50');
  // spread out: not all of them crowd around the player
  const far = list.filter((m) => Math.hypot(m.x - a.s.pos.x, m.z - a.s.pos.z) > 90).length;
  assert.ok(far >= 5, `${far} of them are more than 90 m away`);
  // regions she is only close to get a smaller group
  for (const r of REGIONS) {
    if (r.id !== 'desert') assert.ok(wild(h, r.id).length <= CONFIG.monsters.neighbourRegion, `${r.id}: ${wild(h, r.id).length}`);
  }
  assert.ok(h.game.monsters.list.size <= h.game.monsters.cap());
  // they stay while she is there
  stay(h, a, 60000);
  assert.ok(wild(h, 'desert').length >= CONFIG.monsters.perRegion - 2);
  // she goes to the far side of the jungle: the desert empties, the jungle fills
  const jungle = REGION_BY_ID.jungle.shape;
  h.place(a, 0, jungle.r2 - 15);
  stay(h, a, CONFIG.monsters.dormantAfterMs + 20000);
  assert.equal(wild(h, 'desert').length, 0, 'nobody near the desert: its monsters are gone');
  assert.equal(wild(h, 'jungle').length, CONFIG.monsters.perRegion);
});
