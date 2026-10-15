// Accounts for the Node server (npm start): a name and a password.
//
// Names are unique (shared/names.js nameKey). Passwords are stored as scrypt
// hashes. After a log-in the browser gets a "remember" key so it can log in
// again by itself; only a hash of it is stored. The first account made on a
// device takes over that device's progress (its old player token).
//
// The browser build (GitHub Pages) uses Firebase accounts instead
// (public/client/accounts.js); both end up in Game.join as a checked identity.

import crypto from 'node:crypto';
import { cleanName, nameKey, PASSWORD_MIN } from '#shared/names.js';
import { profileIdFromToken } from './services/playerData.js';
import { fail } from './validate.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const hashPassword = (password, salt) => crypto.scryptSync(String(password), salt, 32).toString('hex');

export class AccountRegistry {
  constructor(store, log = () => {}) {
    this.store = store;
    this.log = log;
    this.accounts = {}; // name key -> { name, pid, salt, hash, remember: [], createdAt }
  }

  async load() {
    this.accounts = (this.store.loadAccounts ? await this.store.loadAccounts() : null) || {};
  }

  async save() {
    if (this.store.saveAccounts) await this.store.saveAccounts(this.accounts);
  }

  taken(name) {
    return !!this.accounts[nameKey(name)];
  }

  // a = { name, password, create } or { name, remember }
  async verify(a, token) {
    const name = cleanName(a.name);
    if (!name) return fail('bad_name', 'A name needs 2–16 letters, numbers or spaces.');
    const key = nameKey(name);
    let rec = this.accounts[key];
    if (a.create === true) {
      if (rec) return fail('name_taken', `The name "${rec.name}" is already taken. Choose another one.`);
      if (typeof a.password !== 'string' || a.password.length < PASSWORD_MIN || a.password.length > 64) {
        return fail('bad_password', `Use a password of at least ${PASSWORD_MIN} characters.`);
      }
      // the progress on this device moves into the new account (once)
      let pid = profileIdFromToken(token);
      if (!pid || Object.values(this.accounts).some((r) => r.pid === pid)) pid = 'p_' + crypto.randomBytes(16).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      rec = { name, pid, salt, hash: hashPassword(a.password, salt), remember: [], createdAt: Date.now() };
      this.accounts[key] = rec;
      this.log(`account created: ${name}`);
    } else {
      if (!rec) return fail('no_account', `There is no account called "${name}". Check the spelling, or create one.`);
      let ok = false;
      if (typeof a.remember === 'string' && a.remember.length >= 16) {
        ok = rec.remember.includes(sha(a.remember));
      } else if (typeof a.password === 'string' && a.password.length <= 64) {
        const h = Buffer.from(hashPassword(a.password, rec.salt), 'hex');
        ok = crypto.timingSafeEqual(h, Buffer.from(rec.hash, 'hex'));
      }
      if (!ok) return fail('bad_login', a.remember ? 'Please log in again.' : 'Wrong password.');
    }
    const remember = crypto.randomBytes(24).toString('base64url');
    rec.remember = [...rec.remember, sha(remember)].slice(-5);
    await this.save();
    return { ok: true, ident: { account: `n:${key}`, pid: rec.pid, name: rec.name, remember } };
  }
}
