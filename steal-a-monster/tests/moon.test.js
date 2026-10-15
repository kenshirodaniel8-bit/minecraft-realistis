// The secret of Cute Monster Island: five moon buttons, the portal they
// open, the four rounds of the Moon Sky Arena and the secret monster.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B } from './helpers.js';
import { REGION_BY_ID, regionIdAt } from '../shared/regions.js';
import { SPECIES_BY_ID } from '../shared/monsters.js';
import { sanitizeProfile } from '../server/services/playerData.js';

async function onCute(h, token, name) {
  const c = await h.join(token, name);
  const g = h.game.world.gate;
  h.place(c, g.x + 2, g.z);
  assert.equal(c.send('travel', { region: 'cute' }).ok, true);
  return c;
}

// Stand somewhere in the arena at a given height (place() would use the
// ground far below the floating platforms).
function stand(h, c, x, y, z) {
  const s = c.s;
  s.pos = { x, y, z };
  s.lastMoveAt = h.clock.t;
  h.game.afterMove(s, regionIdAt(x, z));
}

test('stepping on the five moon buttons lights them up (1/5 ... 5/5) and opens the secret portal', async () => {
  const h = await makeGame();
  const a = await onCute(h, TOKEN_A, 'Alice');
  const moon = h.game.world.moon;
  assert.equal(moon.buttons.length, 5);
  for (const b of moon.buttons) assert.equal(regionIdAt(b.x, b.z), 'cute', 'the buttons are on Cute Monster Island');
  // the portal does nothing yet
  h.place(a, moon.portal.x, moon.portal.z);
  assert.equal(a.s.region, 'cute');
  // first button
  a.clear();
  h.place(a, moon.buttons[2].x + 0.5, moon.buttons[2].z);
  assert.deepEqual(a.profile.moon.found, [2]);
  assert.equal(a.last('moonButton').found, 1);
  assert.match(a.last('toast').text, /1\/5/);
  // standing on it again does not count twice
  h.place(a, moon.buttons[2].x, moon.buttons[2].z);
  assert.equal(a.events('moonButton').length, 1);
  for (const b of moon.buttons) h.place(a, b.x, b.z);
  assert.equal(a.profile.moon.found.length, 5);
  assert.equal(a.last('moonButton').found, 5);
  assert.match(a.last('toast').text, /portal/i);
  // progress is part of the saved profile
  const again = sanitizeProfile(JSON.parse(JSON.stringify(a.profile)), a.profile.id);
  assert.deepEqual(again.moon.found.sort(), [0, 1, 2, 3, 4]);
  assert.deepEqual(sanitizeProfile({ moon: { found: [9, -1, 'x', 1, 1] } }, 'p_x').moon, { found: [1], won: false });
  // the portal now leads to the Moon Sky Arena
  h.advance(3000);
  h.place(a, moon.portal.x, moon.portal.z);
  assert.equal(a.s.region, 'moonsky');
  assert.ok(Math.abs(a.s.pos.y - moon.start.y) < 0.01, 'on the start platform');
  // the arena is not a travel destination
  assert.equal(REGION_BY_ID.moonsky.arena, true);
  h.place(a, h.game.world.gate.x + 2, h.game.world.gate.z);
  assert.equal(a.send('travel', { region: 'moonsky' }).error, 'bad_region');
});

test('Moon Sky Arena: four rounds (Uncommon, Rare, Epic, Legendary), then the secret monster joins you', async () => {
  const h = await makeGame();
  const a = await onCute(h, TOKEN_A, 'Alice');
  const b = await onCute(h, TOKEN_B, 'Bob');
  const moon = h.game.world.moon;
  a.profile.moon.found = [0, 1, 2, 3, 4];
  a.profile.swords.push('galaxy');
  a.profile.sword = 'galaxy';
  h.advance(3000);
  h.place(a, moon.portal.x, moon.portal.z);
  assert.equal(a.s.region, 'moonsky');
  // Bob has not found the buttons: no portal for him, and no way in
  h.place(b, moon.portal.x, moon.portal.z);
  assert.equal(b.s.region, 'cute');

  // falling off a stone sends you back to the last platform
  stand(h, a, moon.platforms[0].x, 1.5, moon.platforms[0].z + 15);
  assert.ok(Math.abs(a.s.pos.y - moon.start.y) < 0.01 && Math.abs(a.s.pos.z - moon.start.z) < 0.01, 'back at the start');

  const rarities = [];
  for (let k = 0; k < 4; k++) {
    const pl = moon.platforms[k];
    a.clear();
    stand(h, a, pl.x, pl.top, pl.z + pl.half - 1);
    const m = a.s.moonRun.monster;
    assert.ok(m, `round ${k + 1} monster appears`);
    assert.equal(m.species.island, 'cute', 'a cute monster');
    assert.equal(m.challengeFor, a.s.id);
    rarities.push(m.species.rarity);
    assert.ok(Math.abs(m.y - pl.top - (m.hover || 0)) < 0.01, 'it stands on the platform');
    // only the challenger can hit it or be attacked by it
    assert.equal(h.game.monsters.findInArc(m, 0, 50, 360, 5, b.s).length, 0);
    assert.equal(h.game.monsters.playerTargetable(b.s, m), false);
    // it never walks off its platform, even chasing someone off it
    m.stunnedUntil = 0;
    stand(h, a, pl.x + pl.half + 6, pl.top, pl.z);
    h.advance(3000);
    assert.ok(Math.abs(m.x - pl.x) <= pl.half && Math.abs(m.z - pl.z) <= pl.half, 'still on the platform');
    a.s.hp = a.s.maxHp;
    assert.ok(h.defeat(a, m), `round ${k + 1} won`);
    assert.equal(a.events('recruitOffer').length, 0, 'arena monsters are not recruited');
    assert.equal(a.events('reward').length, 1, 'but give the usual rewards');
    h.advance(2000);
    assert.ok(!h.game.monsters.list.has(m.id), 'it fades away');
  }
  assert.deepEqual(rarities, ['uncommon', 'rare', 'epic', 'legendary']);
  const secret = a.profile.monsters.find((o) => o.species === 'cute_lunamochi');
  assert.ok(secret, 'the secret monster is yours');
  assert.equal(SPECIES_BY_ID.cute_lunamochi.rarity, 'secret');
  assert.equal(h.game.ledger.owner(secret.id), a.profile.id);
  assert.equal(a.profile.moon.won, true);
  assert.equal(a.last('moonWin').first, true);
  // and you are sent back to the island
  h.advance(4000);
  assert.equal(a.s.region, 'cute');
  assert.equal(a.s.moonRun, null);

  // a second win pays Money and Gems instead of a second secret
  const money = a.profile.money;
  h.advance(3000);
  h.place(a, moon.portal.x, moon.portal.z);
  assert.equal(a.s.region, 'moonsky');
  for (let k = 0; k < 4; k++) {
    const pl = moon.platforms[k];
    stand(h, a, pl.x, pl.top, pl.z);
    a.s.hp = a.s.maxHp;
    assert.ok(h.defeat(a, a.s.moonRun.monster));
  }
  assert.equal(a.profile.monsters.filter((o) => o.species === 'cute_lunamochi').length, 1);
  assert.ok(a.profile.money > money + 20000);
});

test('the arena needs room in your base, and leaving ends the run', async () => {
  const h = await makeGame();
  const a = await onCute(h, TOKEN_A, 'Alice');
  const moon = h.game.world.moon;
  a.profile.moon.found = [0, 1, 2, 3, 4];
  a.profile.base.slots = 0;
  h.advance(3000);
  h.place(a, moon.portal.x, moon.portal.z);
  assert.equal(a.s.region, 'cute');
  assert.match(a.last('toast').text, /base is full/i);
  a.profile.base.slots = 15;
  h.advance(3000);
  h.place(a, moon.portal.x, moon.portal.z);
  assert.equal(a.s.region, 'moonsky');
  const pl = moon.platforms[0];
  stand(h, a, pl.x, pl.top, pl.z);
  const m = a.s.moonRun.monster;
  assert.ok(m);
  // H (go home) ends the run and the round's monster disappears
  h.advance(60000);
  a.s.hp = a.s.maxHp;
  assert.equal(a.send('home').ok, true);
  h.advance(5000);
  assert.equal(a.s.moonRun, null);
  assert.ok(!h.game.monsters.list.has(m.id));
});
