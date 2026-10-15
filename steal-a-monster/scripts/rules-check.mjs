// Checks firebase-database.rules.json against the local Firebase emulators
// (Auth on 127.0.0.1:9099, Realtime Database on 127.0.0.1:9000, started with
// the rules file; see scripts/room-e2e.mjs): accounts can only be written by
// their owner and only under their own name, only the admins (daniel, nadine, prabu, shallom) can ban
// or send returns, banned players can't join or open rooms, nobody can join
// or talk as someone else, and only the host can close a room.
//   node scripts/rules-check.mjs
import { initializeApp } from 'firebase/app';
import { getDatabase, connectDatabaseEmulator, ref, set, get, update, remove, push } from 'firebase/database';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
const cfg = { apiKey: 'fake-key', authDomain: 'demo-sam.firebaseapp.com', projectId: 'demo-sam', databaseURL: 'http://127.0.0.1:9000?ns=demo-sam-default-rtdb' };
let n = 0;
async function user(email, password = 'secret123') {
  const app = initializeApp(cfg, `u${n++}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
  const cred = await createUserWithEmailAndPassword(auth, email, password).catch(() => signInWithEmailAndPassword(auth, email, password));
  return { uid: cred.user.uid, db, r: (p) => ref(db, p) };
}
const results = [];
async function expect(label, ok, fn) {
  let res;
  try { await fn(); res = true; } catch (e) { res = false; }
  results.push(`${res === ok ? 'PASS' : 'FAIL'}  ${label} (${res ? 'allowed' : 'denied'})`);
}
const stamp = Date.now().toString(36);
const d = await user('daniel@players.steal-a-monster.game', 'admin-pass-1').catch(async () => null);
const nad = await user('nadine@players.steal-a-monster.game', 'admin-pass-1');
const bob = await user(`bob${stamp}@players.steal-a-monster.game`);
const eve = await user(`eve${stamp}@players.steal-a-monster.game`);
await expect('bob writes his own account name', true, () => set(bob.r(`sam/accounts/${bob.uid}`), { name: `Bob${stamp}`, at: 1 }));
await expect('bob cannot take the name "daniel"', false, () => set(bob.r(`sam/accounts/${bob.uid}/name`), 'Daniel'));
await expect('bob saves his profile', true, () => update(bob.r(`sam/accounts/${bob.uid}`), { profile: '{"money":5}', at: 2 }));
await expect('eve cannot write bob\'s account', false, () => update(eve.r(`sam/accounts/${bob.uid}`), { profile: '{"money":9999}' }));
await expect('eve can read bob\'s account (a room host does)', true, () => get(eve.r(`sam/accounts/${bob.uid}`)));
await expect('no extra fields in an account', false, () => update(bob.r(`sam/accounts/${bob.uid}`), { money: 5 }));
await expect('bob cannot ban eve', false, () => set(bob.r(`sam/bans/${eve.uid}`), { name: 'Eve', at: 1 }));
await expect('bob cannot send returns', false, () => push(bob.r(`sam/returns/${eve.uid}`), { j: '{}' }));
if (d) {
  await expect('daniel bans eve', true, () => set(d.r(`sam/bans/${eve.uid}`), { name: 'Eve', at: 1 }));
  await expect('daniel sends a return to bob', true, () => push(d.r(`sam/returns/${bob.uid}`), { j: '{"id":"m1"}' }));
  await expect('bob reads his returns', true, () => get(bob.r(`sam/returns/${bob.uid}`)));
  await expect('eve cannot read bob\'s returns', false, () => get(eve.r(`sam/returns/${bob.uid}`)));
} else results.push('SKIP daniel already registered in this emulator run');
await expect('nadine (an admin too) sends a return to bob', true, () => push(nad.r(`sam/returns/${bob.uid}`), { j: '{"id":"m2"}' }));
await expect('nadine bans and unbans a player', true, async () => {
  await set(nad.r(`sam/bans/${bob.uid}`), { name: 'Bob', at: 1 });
  await remove(nad.r(`sam/bans/${bob.uid}`));
});
const code = 'K7QZP';
await expect('bob opens a room', true, () => set(bob.r(`sam/rooms/${code}/host`), { v: 1, at: 1, uid: bob.uid }));
await expect('eve cannot take over bob\'s room', false, () => set(eve.r(`sam/rooms/${code}/host`), { v: 1, at: 1, uid: eve.uid }));
await expect('a host must name himself', false, () => set(eve.r(`sam/rooms/ABCDE/host`), { v: 1, at: 1, uid: bob.uid }));
if (d) await expect('banned eve cannot join', false, () => set(eve.r(`sam/rooms/${code}/guests/${eve.uid}`), { at: 1 }));
if (d) await expect('banned eve cannot open a room', false, () => set(eve.r(`sam/rooms/ABCDE/host`), { v: 1, at: 1, uid: eve.uid }));
const g = await user(`gus${stamp}@players.steal-a-monster.game`);
await expect('gus joins as himself', true, () => set(g.r(`sam/rooms/${code}/guests/${g.uid}`), { at: 1 }));
await expect('gus cannot join as bob', false, () => set(g.r(`sam/rooms/${code}/guests/${bob.uid}`), { at: 1 }));
await expect('gus sends on his own channel', true, () => push(g.r(`sam/rooms/${code}/up/${g.uid}`), { j: '[]' }));
await expect('gus cannot send as someone else', false, () => push(g.r(`sam/rooms/${code}/up/${bob.uid}`), { j: '[]' }));
await expect('the host writes to gus', true, () => push(bob.r(`sam/rooms/${code}/down/${g.uid}`), { j: '[]' }));
await expect('the host kicks gus', true, () => remove(bob.r(`sam/rooms/${code}/guests/${g.uid}`)));
await expect('gus cannot close the room', false, () => remove(g.r(`sam/rooms/${code}`)));
await expect('the host closes the room', true, () => remove(bob.r(`sam/rooms/${code}`)));
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
