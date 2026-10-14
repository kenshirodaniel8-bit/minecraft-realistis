// Monsters, sword combat, monster attacks and defeat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B, FIELD } from './helpers.js';
import { SPECIES, monsterStats } from '../shared/monsters.js';
import { SWORD_BY_ID } from '../shared/weapons.js';
import { CONFIG } from '../shared/config.js';
import { buildMonster, rigSignature } from '../public/client/monsterRenderer.js';
import { MS } from '../server/services/monsterAI.js';

test('5. every species has a real, distinct 3D model and working health', () => {
  assert.ok(SPECIES.length >= 30, `only ${SPECIES.length} species`);
  const signatures = new Map();
  for (const sp of SPECIES) {
    const rig = buildMonster(sp.id);
    const sig = rigSignature(rig);
    assert.ok(sig.meshes >= 15, `${sp.id} has only ${sig.meshes} meshes`);
    assert.ok(rig.eyes.length === 2, `${sp.id} needs two eyes`);
    assert.ok(rig.height > 1 && rig.height < 4.5, `${sp.id} height ${rig.height}`);
    const key = JSON.stringify(sig.parts);
    assert.ok(!signatures.has(key), `${sp.id} is built from the same parts as ${signatures.get(key)}`);
    signatures.set(key, sp.id);
    const st = monsterStats(sp, 5);
    assert.ok(st.maxHp > monsterStats(sp, 1).maxHp, 'health scales with level');
    assert.ok(sp.attacks.length >= 1);
  }
  // several clearly different silhouettes (body proportions)
  const shapes = new Set(SPECIES.map((sp) => sp.model.body.shape));
  assert.ok(shapes.size >= 8, `body shapes: ${[...shapes]}`);
});

test('6. sword attacks deal server-computed damage only to monsters in reach, with cooldowns', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  h.place(a, FIELD.x, FIELD.z, 0);
  h.advance(CONFIG.player.spawnProtectionMs);
  const m = h.spawnMonster('chompkin', 1, FIELD.x, FIELD.z + 3);
  m.stunnedUntil = h.clock.t + 1e6;
  const hp0 = m.hp;
  // facing it (yaw 0 = +z)
  let r = a.send('attack', { yaw: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.hits, 1);
  const dealt = hp0 - m.hp;
  const sword = SWORD_BY_ID.wooden;
  assert.ok(dealt >= 1 && dealt <= sword.damage * CONFIG.combat.critMultiplier * 1.3, `damage ${dealt}`);
  // instantly swinging again is rejected by the cooldown
  r = a.send('attack', { yaw: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'cooldown');
  // facing away misses
  h.advance(sword.cooldownMs + 10);
  const hp1 = m.hp;
  r = a.send('attack', { yaw: Math.PI });
  assert.equal(r.hits, 0);
  assert.equal(m.hp, hp1);
  // out of reach misses even when facing it
  m.z = FIELD.z + 15;
  h.advance(sword.cooldownMs + 10);
  r = a.send('attack', { yaw: 0 });
  assert.equal(r.hits, 0);
  // clients cannot send their own damage numbers
  m.z = FIELD.z + 3;
  h.advance(sword.cooldownMs + 10);
  const hp2 = m.hp;
  r = a.send('attack', { yaw: 0, damage: 99999, crit: true, hits: [{ id: m.id, dmg: 99999 }] });
  assert.ok(hp2 - m.hp <= sword.damage * CONFIG.combat.critMultiplier * 1.3);
  assert.ok(m.hp > 0);
  // garbage input is rejected
  assert.equal(a.send('attack', { yaw: 'north' }).ok, false);
  assert.equal(a.send('attack', null).ok, false);
});

test('7. monsters attack players, can knock them out, and they respawn at their own base', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  h.place(a, FIELD.x, FIELD.z, 0);
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  const m = h.spawnMonster('wolbit', 12, FIELD.x, FIELD.z + 4); // aggressive and strong
  const hp0 = a.s.hp;
  let downAt = null;
  for (let i = 0; i < 1200 && !a.s.dead; i++) {
    a.s.pos.x = FIELD.x;
    a.s.pos.z = FIELD.z;
    h.advance(50);
    if (a.s.dead) downAt = i;
  }
  assert.ok(a.events('hurt').length > 0, 'the monster attacked');
  assert.ok(a.s.dead, `player should be knocked out (hp ${a.s.hp}/${hp0})`);
  assert.ok(downAt !== null);
  assert.ok(a.events('mAttack').length > 0, 'attacks are telegraphed to clients first');
  h.advance(CONFIG.player.respawnMs + 100);
  assert.equal(a.s.dead, false);
  assert.equal(a.s.hp, a.s.maxHp);
  const base = h.game.world.bases[a.s.baseIndex];
  assert.ok(Math.hypot(a.s.pos.x - base.spawn.x, a.s.pos.z - base.spawn.z) < 1, 'respawned at own base');
  void m;
});

test('dodging makes the player briefly immune to monster hits', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  const r = a.send('dodge', {});
  assert.equal(r.ok, true);
  const res = h.game.combat.damagePlayer(a.s, 30, {});
  assert.equal(res.blocked, 'dodge');
  assert.equal(a.send('dodge', {}).error, 'cooldown');
  h.advance(CONFIG.player.dodgeCooldownMs);
  assert.equal(h.game.combat.damagePlayer(a.s, 30, {}).dmg, 30);
});

test('8. a defeated monster enters the recruitment state and only real fighters get an offer', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  h.place(a, FIELD.x, FIELD.z, 0);
  h.place(b, FIELD.x + 30, FIELD.z, 0);
  const m = h.spawnMonster('mossbun', 1, FIELD.x + 2, FIELD.z);
  assert.equal(h.defeat(a, m), true);
  assert.equal(m.state, MS.defeated);
  assert.equal(m.hp, 0);
  const offer = a.last('recruitOffer');
  assert.ok(offer, 'fighter receives a recruit offer');
  assert.equal(offer.monsterId, m.id);
  assert.ok(offer.price > 0);
  assert.equal(b.last('recruitOffer'), undefined, 'bystanders get nothing');
  // defeat gave rewards but no ownership
  assert.equal(a.profile.monsters.length, 0);
  assert.ok(a.profile.xp > 0);
  assert.equal(a.profile.discoveries.species.mossbun > 0, true);
  // further hits on a defeated monster do nothing
  h.advance(1000);
  assert.equal(a.send('attack', { yaw: Math.PI / 2 }).hits, 0);
  // nobody recruits it: it recovers and leaves
  h.advance(CONFIG.combat.defeatedWindowMs + 3500);
  assert.equal(h.game.monsters.get(m.id), undefined);
  assert.ok(a.events('offerGone').some((o) => o.monsterId === m.id));
});

test('monster AI: shy monsters flee, territorial ones defend their home, all stay in their region', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  h.place(a, FIELD.x, FIELD.z, 0);
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  const shy = h.spawnMonster('mossbun', 1, FIELD.x + 6, FIELD.z);
  const d0 = Math.hypot(shy.x - a.s.pos.x, shy.z - a.s.pos.z);
  h.advance(1500);
  assert.equal(shy.state, MS.flee);
  assert.ok(Math.hypot(shy.x - a.s.pos.x, shy.z - a.s.pos.z) > d0, 'it ran away');
  const terr = h.spawnMonster('fennix', 6, FIELD.x - 8, FIELD.z);
  h.advance(1000);
  assert.equal(terr.target, a.s.pn, 'territorial monster targets an intruder');
  for (const m of h.game.monsters.list.values()) assert.equal(m.region, 'plains');
});
