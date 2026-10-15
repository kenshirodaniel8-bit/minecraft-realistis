// Accounts, unique names, starting over, progress that travels between
// servers, and the admin account "daniel" (Player panel, return, ban).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, TOKEN_A, TOKEN_B, TOKEN_C, FIELD } from './helpers.js';
import { CONFIG } from '../shared/config.js';
import { MemoryStore } from '../server/storage.js';
import { accountEmail, nameKey, cleanName } from '../shared/names.js';
import { accountProfileId } from '../server/services/playerData.js';

const acct = (name, password, create = false) => ({ account: { name, password, create } });

test('names: spaces are fine, the same name in other letters or spacing is the same name', () => {
  assert.equal(cleanName('  Mira   Fox '), 'Mira Fox');
  assert.equal(nameKey('Mira   FOX'), 'mira fox');
  assert.equal(cleanName('a'), null);
  assert.equal(accountEmail('Mira Fox'), 'mira.fox@players.steal-a-monster.game');
});

test('accounts on the server: create, log in, unique names, remember key, device progress moves in', async () => {
  const h = await makeGame({ accounts: true });
  // some progress on this device before making an account
  const old = await h.join(TOKEN_A, 'Mira');
  old.profile.money = 4321;
  h.game.leave(old.sid);
  await h.game.flushSaves();
  const reg = await h.join(TOKEN_A, 'x', acct('Mira Fox', 'secret1', true));
  assert.equal(reg.res.ok, true, reg.res.message);
  assert.equal(reg.profile.name, 'Mira Fox');
  assert.equal(reg.profile.money, 4321, 'the device progress moved into the account');
  assert.ok(reg.res.remember, 'a remember key for logging in again');
  h.game.leave(reg.sid);
  // the name is taken, whatever the letters or spaces
  const dup = await h.join(TOKEN_B, 'x', acct('mira   FOX', 'other12', true));
  assert.equal(dup.res.error, 'name_taken');
  assert.equal((await h.join(TOKEN_B, 'x', acct('Mira Fox', 'nope123'))).res.error, 'bad_login');
  assert.equal((await h.join(TOKEN_B, 'x', acct('Nobody', 'nope123'))).res.error, 'no_account');
  assert.equal((await h.join(TOKEN_B, 'x', acct('Shorty', '123', true))).res.error, 'bad_password');
  // playing without an account under an account's name is refused
  assert.equal((await h.join(TOKEN_B, 'mira fox')).res.error, 'name_taken');
  // log in from another device: same progress
  const other = await h.join(TOKEN_C, 'x', acct('MIRA FOX', 'secret1'));
  assert.equal(other.res.ok, true);
  assert.equal(other.profile.money, 4321);
  h.game.leave(other.sid);
  const again = await h.join(TOKEN_C, 'x', { account: { name: 'Mira Fox', remember: reg.res.remember } });
  assert.equal(again.res.ok, true, 'the remember key logs in');
  // the accounts survive a restart
  const h2 = await makeGame({ accounts: true, store: h.store });
  assert.equal((await h2.join(TOKEN_B, 'x', acct('Mira Fox', 'secret1'))).res.ok, true);
});

test('two players in one server never share a name', async () => {
  const h = await makeGame();
  await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'aLiCe');
  assert.equal(b.res.error, 'name_taken');
  assert.match(b.res.message, /Alice/);
  assert.equal((await h.join(TOKEN_B, 'Alice Two')).res.ok, true);
});

test('starting over gives a fresh profile; continuing keeps everything', async () => {
  const h = await makeGame({ accounts: true });
  const a = await h.join(TOKEN_A, 'x', acct('Rook', 'secret1', true));
  a.profile.money = 99999;
  a.profile.monsters.push({ id: 'mrook01', species: 'mossbun', level: 3, slot: 0, following: false, origin: 'recruited', obtainedAt: 0 });
  h.game.ledger.set('mrook01', a.profile.id, 'mossbun', 3);
  h.game.leave(a.sid);
  const cont = await h.join(TOKEN_A, 'x', acct('Rook', 'secret1'));
  assert.equal(cont.profile.money, 99999);
  assert.equal(cont.profile.monsters.length, 1);
  h.game.leave(cont.sid);
  const fresh = await h.join(TOKEN_A, 'x', { ...acct('Rook', 'secret1'), fresh: true });
  assert.equal(fresh.res.ok, true);
  assert.equal(fresh.res.isNew, true);
  assert.equal(fresh.profile.money, CONFIG.startingMoney);
  assert.equal(fresh.profile.monsters.length, 0);
  assert.equal(h.game.ledger.owner('mrook01'), null, 'the old monsters were let go');
});

test('an online account brings its monsters to a friend\'s server and saves back to the account', async () => {
  const saved = [];
  // the account's progress, as its owner's browser loaded it
  const profile = { name: 'Kai', money: 5000, monsters: [{ id: 'mkai0001', species: 'voltkit', level: 4, slot: 0, following: false, origin: 'recruited', obtainedAt: 0 }] };
  const ident = { account: 'uid-kai', name: 'Kai', profile, external: true };
  const friend = await makeGame({ store: new MemoryStore(), accountSaver: async (p) => saved.push(JSON.parse(JSON.stringify(p))) });
  const k = await friend.join(TOKEN_B, 'whatever', {}, ident);
  assert.equal(k.res.ok, true);
  assert.equal(k.profile.name, 'Kai', 'the account name, not what the client typed');
  assert.equal(k.profile.id, accountProfileId('uid-kai'));
  assert.equal(k.profile.monsters[0].id, 'mkai0001', 'his monster is in the friend\'s server');
  assert.equal(friend.game.ledger.owner('mkai0001'), k.profile.id);
  k.profile.money += 250;
  friend.game.markSave(k.s);
  await friend.game.flushSaves();
  assert.equal(saved.at(-1).money, 5250, 'saved to the account, not the host\'s storage');
  assert.equal(await friend.store.loadProfile(k.profile.id), null);
  // a brand-new account starts with the usual 1,000
  const n = await friend.join(TOKEN_C, 'x', {}, { account: 'uid-new', name: 'Newbie', profile: null, external: true });
  assert.equal(n.res.isNew, true);
  assert.equal(n.profile.money, CONFIG.startingMoney);
});

async function theft(h, a, b) {
  const mon = { id: 'mvictim01', species: 'mossbun', level: 2, slot: 0, following: false, origin: 'recruited', obtainedAt: 0 };
  a.profile.monsters.push(mon);
  h.game.ledger.set(mon.id, a.profile.id, mon.species, mon.level);
  const baseA = h.game.world.bases[a.s.baseIndex];
  h.advance(CONFIG.player.spawnProtectionMs + 100);
  h.place(a, FIELD.x, FIELD.z);
  h.place(b, baseA.outside.x, baseA.outside.z);
  h.walk(b, baseA.slots[0].x + 1.5, baseA.slots[0].z);
  assert.equal(b.send('stealBegin', { ownedId: mon.id }).ok, true);
  h.advance(CONFIG.stealing.holdMs + 50);
  assert.equal(b.send('stealConfirm', { ownedId: mon.id }).ok, true);
  assert.equal(h.game.stealing.completeTheft(b.s), true);
  return mon;
}

test('admin "daniel": sees who stole what from whom, returns it to the owner, bans the thief', async () => {
  const h = await makeGame({ accounts: true });
  const d = await h.join('test-token-daniel-0004', 'x', acct('Daniel', 'admin12', true));
  assert.equal(d.res.ok, true);
  assert.equal(d.res.admin, true, 'the account named daniel is the admin');
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  assert.equal(a.res.admin, false);
  const mon = await theft(h, a, b);
  assert.equal(b.profile.monsters[0].stolenFrom, 'Alice');
  // only the admin may look
  assert.equal(b.send('adminPlayers').error, 'not_admin');
  assert.equal(b.send('adminReturn', { pn: b.s.pn, ownedId: mon.id }).error, 'not_admin');
  assert.equal(a.send('adminBan', { pn: b.s.pn }).error, 'not_admin');
  const list = d.send('adminPlayers');
  assert.equal(list.ok, true);
  const bob = list.players.find((p) => p.name === 'Bob');
  assert.equal(bob.stolen.length, 1);
  assert.equal(bob.stolen[0].from, 'Alice');
  assert.equal(bob.stolen[0].species, 'mossbun');
  // give it back (Alice is here)
  const r = d.send('adminReturn', { pn: b.s.pn, ownedId: mon.id });
  assert.equal(r.ok, true);
  assert.equal(r.delivered, true);
  assert.equal(b.profile.monsters.length, 0);
  assert.equal(a.profile.monsters.length, 1);
  assert.equal(h.game.ledger.owner(mon.id), a.profile.id);
  assert.ok(a.events('toast').some((t) => /returned/.test(t.text)));
  // ban: Bob is kicked and can't come back; the admin can't be banned
  assert.equal(d.send('adminBan', { pn: d.s.pn }).error, 'no');
  const ban = d.send('adminBan', { pn: b.s.pn });
  assert.equal(ban.ok, true);
  assert.ok(b.events('kicked').some((k) => /banned/.test(k.reason)));
  assert.ok(!h.game.players.has(b.sid));
  const back = await h.join(TOKEN_B, 'Bob');
  assert.equal(back.res.error, 'banned');
  // the ban is saved with the server
  const h2 = await makeGame({ accounts: true, store: h.store });
  assert.equal((await h2.join(TOKEN_B, 'Bob')).res.error, 'banned');
});

test('a stolen monster goes back to an owner who is offline the next time they play', async () => {
  const h = await makeGame({ accounts: true });
  const d = await h.join('test-token-daniel-0004', 'x', acct('daniel', 'admin12', true));
  const a = await h.join(TOKEN_A, 'Alice');
  const b = await h.join(TOKEN_B, 'Bob');
  const mon = await theft(h, a, b);
  h.game.leave(a.sid);
  await h.game.flushSaves();
  const r = d.send('adminReturn', { pn: b.s.pn, ownedId: mon.id });
  assert.equal(r.ok, true);
  assert.equal(r.delivered, false);
  await h.game.flushSaves();
  await new Promise((res) => setTimeout(res, 10));
  const a2 = await h.join(TOKEN_A, 'Alice');
  assert.ok(a2.profile.monsters.some((m) => m.id === mon.id), 'Alice has it back');
  assert.equal(b.profile.monsters.length, 0);
});

test('only a real account can be the admin: typing "daniel" as a name is not enough', async () => {
  const h = await makeGame({ accounts: true });
  const fake = await h.join(TOKEN_A, 'Daniel');
  assert.equal(fake.res.ok, true);
  assert.equal(fake.res.admin, false);
  assert.equal(fake.send('adminPlayers').error, 'not_admin');
  // and once the account exists, the name is reserved
  h.game.leave(fake.sid);
  await h.join('test-token-daniel-0004', 'x', acct('Daniel', 'admin12', true));
  assert.equal((await h.join(TOKEN_B, 'daniel')).res.error, 'name_taken');
});
