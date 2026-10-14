// New players, reconnects, persistence, schema migration and save safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeGame, TOKEN_A, TOKEN_B } from './helpers.js';
import { JsonFileStore, MemoryStore } from '../server/storage.js';
import { profileIdFromToken, sanitizeProfile, migrateProfile } from '../server/services/playerData.js';
import { CONFIG } from '../shared/config.js';

test('1. a brand-new player starts with exactly 1,000 Money and the starter kit', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  assert.equal(a.res.ok, true);
  assert.equal(a.res.isNew, true);
  assert.equal(a.res.profile.money, 1000);
  assert.equal(CONFIG.startingMoney, 1000);
  assert.equal(a.profile.sword, 'wooden');
  assert.deepEqual(a.profile.swords, ['wooden']);
  assert.equal(a.profile.base.slots, CONFIG.startingSlots);
  assert.equal(a.profile.monsters.length, 0);
  assert.equal(a.profile.level, 1);
});

test('2. reconnecting, refreshing or respawning never grants the starting bonus again', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  // spend some money so a second bonus would be visible
  a.profile.money = 350;
  h.game.leave(a.sid);
  await new Promise((r) => setTimeout(r, 10));
  const again = await h.join(TOKEN_A, 'Alice');
  assert.equal(again.res.ok, true);
  assert.equal(again.res.isNew, false);
  assert.equal(again.res.profile.money, 350);
  // dying and respawning does not add money either (after spawn protection ends)
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  h.game.combat.damagePlayer(again.s, 99999, {});
  assert.equal(again.s.dead, true);
  h.advance(CONFIG.player.respawnMs + 200);
  assert.equal(again.s.dead, false);
  assert.equal(again.profile.money, 350);
  // a second simultaneous login of the same profile kicks the old session but keeps the money
  const third = await h.join(TOKEN_A, 'Alice');
  assert.equal(third.res.profile.money, 350);
  assert.equal(again.transport.closed, true);
  assert.equal(h.game.players.size, 1);
});

test('different tokens get different profiles; tokens are never stored', async () => {
  const h = await makeGame();
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  assert.notEqual(a.profile.id, b.profile.id);
  assert.equal(a.profile.id, profileIdFromToken(TOKEN_A));
  const saved = [...h.store.profiles.values()].join('\n');
  assert.ok(!saved.includes(TOKEN_A), 'raw token must not be saved');
  assert.equal(profileIdFromToken('short'), null);
  assert.equal(profileIdFromToken('../../etc/passwd/xxxxxxxxx'), null);
});

test('23. saved progression survives a full server restart (JSON file storage)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-test-'));
  try {
    const store1 = new JsonFileStore(dir);
    const h1 = await makeGame({ store: store1 });
    const a = await h1.join(TOKEN_A, 'Alice');
    a.profile.money = 4321;
    a.profile.xp = 500;
    a.profile.swords.push('stone');
    a.profile.sword = 'stone';
    a.profile.monsters.push({ id: 'mtestabc123', species: 'mossbun', level: 3, obtainedAt: 1, origin: 'recruited', slot: 0, following: false });
    h1.game.ledger.set('mtestabc123', a.profile.id, 'mossbun', 3);
    await h1.game.shutdown();

    const store2 = new JsonFileStore(dir);
    const h2 = await makeGame({ store: store2 });
    const back = await h2.join(TOKEN_A, 'Alice');
    assert.equal(back.res.isNew, false);
    assert.equal(back.profile.money, 4321);
    assert.equal(back.profile.sword, 'stone');
    assert.equal(back.profile.monsters.length, 1);
    assert.equal(back.profile.monsters[0].species, 'mossbun');
    assert.equal(back.profile.monsters[0].slot, 0);
    assert.ok(back.profile.level > 1);
    // a backup of the previous save is kept
    const files = fs.readdirSync(path.join(dir, 'players'));
    assert.ok(files.some((f) => f.endsWith('.json.bak')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt save file is restored from its backup; if both are broken the login is refused (no fresh 1,000 Money)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-test-'));
  try {
    const store = new JsonFileStore(dir);
    const h = await makeGame({ store });
    const a = await h.join(TOKEN_A, 'Alice');
    a.profile.money = 777;
    await h.game.saveNow(a);
    a.profile.money = 888;
    await h.game.saveNow(a); // previous version (777) is now the .bak
    h.game.leave(a.sid);
    await h.game.flushSaves();
    await new Promise((r) => setTimeout(r, 30));
    const file = path.join(dir, 'players', `${profileIdFromToken(TOKEN_A)}.json`);
    fs.writeFileSync(file, '{ this is not json');
    const h2 = await makeGame({ store: new JsonFileStore(dir) });
    const back = await h2.join(TOKEN_A, 'Alice');
    assert.equal(back.res.ok, true);
    assert.ok([777, 888].includes(back.profile.money), `restored money ${back.profile.money}`);
    // now break both copies
    h2.game.leave(back.sid);
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(file, 'garbage');
    fs.writeFileSync(`${file}.bak`, 'garbage');
    const h3 = await makeGame({ store: new JsonFileStore(dir) });
    const refused = await h3.join(TOKEN_A, 'Alice');
    assert.equal(refused.res.ok, false);
    assert.equal(refused.res.error, 'load_failed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('save failures are retried and never lose the in-memory progress', async () => {
  const store = new MemoryStore();
  const h = await makeGame({ store });
  const a = await h.join(TOKEN_A, 'Alice');
  store.failSaves = true;
  a.profile.money = 1234;
  h.game.markProfile(a.s);
  h.advance(6000);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(h.game.saveFailures >= 1);
  assert.equal(a.s.saveDirty, true, 'still marked dirty for retry');
  store.failSaves = false;
  h.advance(6000);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(JSON.parse(store.profiles.get(a.profile.id)).money, 1234);
});

test('old saves are migrated and forged/invalid data is repaired on load', () => {
  const raw = {
    name: 'Old',
    money: -50,
    xp: 10,
    swords: ['wooden', 'not-a-sword', 'iron'],
    sword: 'excalibur',
    items: { knockback: 99, fake: 3 },
    monsters: [
      { id: 'm1', species: 'chompkin', level: 2, slot: 0 },
      { id: 'm1', species: 'chompkin', level: 2, slot: 1 },        // duplicate id
      { id: 'm2', species: 'unicorn-dragon', level: 9, slot: 2 },   // unknown species
      { id: 'm3', species: 'mossbun', level: 1, slot: 0 },          // slot already used
      { id: 'm4', species: 'voltkit', level: 1, slot: 40 },         // slot out of range
    ],
    base: { slots: 99 },
  };
  const p = sanitizeProfile(migrateProfile(structuredClone(raw)), 'p_test');
  assert.equal(p.schemaVersion, 2);
  assert.equal(p.gems, 0, 'schema 2 adds Monster Gems');
  assert.deepEqual(p.base.decor, new Array(8).fill(null), 'and empty decoration spots');
  assert.equal(p.money, 0);
  assert.deepEqual(p.swords, ['wooden', 'iron']);
  assert.equal(p.sword, 'wooden');
  assert.deepEqual(p.items, { knockback: 1 });
  assert.equal(p.monsters.length, 3);
  assert.equal(new Set(p.monsters.map((m) => m.id)).size, 3);
  const slots = p.monsters.map((m) => m.slot).filter((s) => s !== null);
  assert.equal(new Set(slots).size, slots.length, 'no monster shares a pad');
  assert.equal(p.base.slots, CONFIG.bases.maxSlots);
  // a schema 1 save gets gems and decorations; forged values are clamped
  const v1 = migrateProfile({ schemaVersion: 1, name: 'V1', money: 10, base: { slots: 4 } });
  assert.equal(v1.schemaVersion, 2);
  assert.equal(v1.gems, 0);
  const forged = sanitizeProfile({ ...v1, gems: 1e15, decor: { owned: { fountain: 1, fake: 3, lantern: 99 } }, base: { slots: 4, decor: ['fountain', 'fountain', 'trophy_gold', 'nope'] } }, 'p_forged');
  assert.equal(forged.gems, CONFIG.gems.max);
  assert.deepEqual(forged.decor.owned, { fountain: 1, lantern: 8 });
  assert.deepEqual(forged.base.decor.slice(0, 4), ['fountain', null, null, null], 'never more placed than owned');
});
