// Companions: bring up to five of your monsters along; they follow you,
// pop back when they fall behind, fight what attacks you, and X calls them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B, FIELD } from './helpers.js';
import { newOwnedMonster } from '../server/services/playerData.js';
import { ALLY_FLAG, COMPANION, MAX_COMPANIONS } from '../server/services/companions.js';
import { CONFIG } from '../shared/config.js';

function give(h, c, species, level = 5) {
  const o = newOwnedMonster(species, level, 'recruited', h.clock.t);
  c.profile.monsters.push(o);
  h.game.ledger.set(o.id, c.profile.id, o.species, o.level);
  return o;
}

const allyRows = (c) => (c.last('snap')?.m || []).filter((r) => r[9] & ALLY_FLAG);

test('up to five monsters come along, follow you and pop back when more than 9 feet away', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  const mine = ['chompkin', 'mossbun', 'voltkit', 'chompkin', 'mossbun', 'voltkit'].map((sp) => give(h, a, sp));
  h.place(a, FIELD.x, FIELD.z);
  for (let i = 0; i < MAX_COMPANIONS; i++) assert.equal(a.send('follow', { ownedId: mine[i].id, follow: true }).ok, true);
  assert.equal(a.send('follow', { ownedId: mine[5].id, follow: true }).error, 'too_many');
  h.advance(300);
  const rows = allyRows(a);
  assert.equal(rows.length, 5, 'five companions in the snapshot');
  for (const r of rows) {
    assert.equal(r[11], a.s.pn, 'with their owner');
    assert.ok(Math.hypot(r[2] - a.s.pos.x, r[4] - a.s.pos.z) < 7, 'close by');
  }
  // other players see them too
  h.place(b, FIELD.x + 6, FIELD.z);
  h.advance(200);
  assert.equal(allyRows(b).length, 5);

  // walk away: they keep up, and if they fall behind more than 9 feet they pop back
  a.clear();
  h.place(a, FIELD.x + 40, FIELD.z + 10);
  h.advance(1500);
  for (const al of a.s.allies.values()) {
    assert.ok(Math.hypot(al.x - a.s.pos.x, al.z - a.s.pos.z) <= COMPANION.teleportDist, 'back at your side');
  }
  assert.ok(a.events('allyPoof').length >= 1, 'with a poof');

  // send one home: it leaves the team
  assert.equal(a.send('follow', { ownedId: mine[0].id, follow: false }).ok, true);
  h.advance(300);
  assert.equal(allyRows(a).length, 4);
});

test('companions attack a wild monster that attacks you (or that you attack)', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const team = ['chompkin', 'voltkit', 'mossbun'].map((sp) => give(h, a, sp, 8));
  for (const o of team) a.send('follow', { ownedId: o.id, follow: true });
  h.place(a, FIELD.x, FIELD.z);
  h.advance(CONFIG.player.spawnProtectionMs);
  const m = h.spawnMonster('chompkin', 3, FIELD.x + 6, FIELD.z + 6);
  m.stunnedUntil = h.clock.t + 1e6; // keep it in place
  h.advance(1000);
  assert.equal(m.hp, m.maxHp, 'peaceful while nobody fights');
  // it bites Alice
  h.game.combat.damagePlayer(a.s, 3, { from: m.id });
  a.clear();
  h.advance(3000);
  assert.ok(m.hp < m.maxHp, 'the companions fought back');
  assert.ok(m.damageBy.get(a.s.id) > 0, 'their damage counts for their owner');
  const hits = a.events('hits').filter((e) => e.ally);
  assert.ok(hits.length >= 2, 'several companion hits');
  assert.ok(a.events('mAttack').some((e) => e.ally), 'with attack animations');
  // they never get hurt: wild monsters only target players
  for (let i = 0; i < 40 && m.state !== 7; i++) h.advance(500);
  assert.equal(m.state, 7, 'defeated by the team');
  assert.ok(a.events('recruitOffer').length >= 1, 'and Alice may recruit it');
});

test('X calls every companion to your side; your team stays with you at home', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const team = ['chompkin', 'voltkit'].map((sp) => give(h, a, sp));
  assert.equal(a.send('callAllies').error, 'none');
  for (const o of team) a.send('follow', { ownedId: o.id, follow: true });
  h.place(a, FIELD.x, FIELD.z);
  h.advance(300);
  for (const al of a.s.allies.values()) {
    al.x += 5;
    al.target = { id: -1 };
  }
  a.clear();
  const res = a.send('callAllies');
  assert.equal(res.ok, true);
  assert.equal(res.count, 2);
  assert.equal(a.events('allyPoof').length, 2);
  for (const al of a.s.allies.values()) assert.ok(Math.hypot(al.x - a.s.pos.x, al.z - a.s.pos.z) < 6);
  assert.equal(a.send('callAllies').error, 'cooldown');
  // going home: team members stay out of the pads, a fresh recruit moves in
  const fresh = give(h, a, 'mossbun');
  fresh.following = true;
  h.advance(60000);
  a.s.hp = a.s.maxHp;
  const home = a.send('home');
  assert.equal(home.ok, true, JSON.stringify(home));
  h.advance(4000);
  const base = h.game.world.bases[a.s.baseIndex];
  h.place(a, base.spawn.x, base.spawn.z);
  h.advance(500);
  assert.ok(team.every((o) => o.slot === null && o.following), 'the team still follows');
  assert.notEqual(fresh.slot, null, 'the fresh recruit moved into the base');
  assert.equal(a.s.allies.size, 2);
});
