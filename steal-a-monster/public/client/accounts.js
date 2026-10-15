// Accounts in the browser.
//
// OnlineAccounts (the web build, GitHub Pages): Firebase Authentication with
// an email made from the name (shared/names.js), and the saved progress in
// the Realtime Database at sam/accounts/{uid}:
//   name     the display name (the database rules check it matches the log-in)
//   profile  the whole profile as JSON text
//   online   {room, at} while playing somewhere (one place at a time)
// The same account works in every room and on every device: your monsters go
// with you to a friend's room, and what happens there is saved back here.
// Also: sam/bans/{uid} (written by the admin) and sam/returns/{uid}/{id}
// (stolen monsters the admin gave back while you were away).
//
// ServerAccounts (npm start): the Node server checks the name and password
// (server/accounts.js); this browser only keeps a "remember" key.

import { cleanName, accountEmail, nameKey, isAdminName, PASSWORD_MIN } from '#shared/names.js';
import { firebase, firebaseConfig } from './fb.js';

const SAVE_EVERY_MS = 10000; // account saves are batched (they go over the internet)

function friendlyAuthError(e) {
  const code = e?.code || '';
  if (code.includes('email-already-in-use')) return 'That name is already taken. Choose another one.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-login')) return 'Wrong name or password.';
  if (code.includes('weak-password')) return `Use a password of at least ${PASSWORD_MIN} characters.`;
  if (code.includes('operation-not-allowed') || code.includes('configuration-not-found')) return 'Accounts are not switched on yet: the game owner has to enable Email/Password sign-in in Firebase (see PANDUAN-FIREBASE.md).';
  if (code.includes('too-many-requests')) return 'Too many tries. Wait a minute and try again.';
  if (code.includes('network')) return 'No connection to the account server. Check your internet.';
  if (code.includes('PERMISSION_DENIED') || /permission/i.test(e?.message || '')) return 'The account database refused this (are the Firebase rules from firebase-database.rules.json published?).';
  return e?.message || 'Something went wrong.';
}

export class OnlineAccounts {
  constructor() {
    this.kind = 'online';
    this.available = !!firebaseConfig();
    this.name = null;
    this.pending = null;     // newest profile waiting to be saved
    this.saveTimer = null;
    this.saving = null;
  }

  async init() {
    if (!this.available) return false;
    const { fb, db, auth } = await firebase();
    this.fb = fb;
    this.db = db;
    this.auth = auth;
    if (auth.currentUser) await this.loadName();
    addEventListener('pagehide', () => this.flush());
    return true;
  }

  get uid() {
    return this.auth?.currentUser?.uid || null;
  }

  get loggedIn() {
    return !!(this.uid && this.name);
  }

  get admin() {
    return this.loggedIn && isAdminName(this.name);
  }

  ref(path) {
    return this.fb.ref(this.db, path);
  }

  async loadName() {
    const snap = await this.fb.get(this.ref(`sam/accounts/${this.uid}/name`));
    this.name = snap.exists() ? snap.val() : null;
    // (an account whose name write failed: take it from the log-in email)
    if (!this.name && this.auth.currentUser?.email) {
      const local = this.auth.currentUser.email.split('@')[0].replace(/\./g, ' ');
      this.name = cleanName(local);
      if (this.name) await this.fb.update(this.ref(`sam/accounts/${this.uid}`), { name: this.name, at: Date.now() }).catch(() => {});
    }
  }

  async register(nameIn, password) {
    const name = cleanName(nameIn);
    if (!name) throw new Error('A name needs 2–16 letters, numbers or spaces.');
    if (String(password || '').length < PASSWORD_MIN) throw new Error(`Use a password of at least ${PASSWORD_MIN} characters.`);
    try {
      await this.fb.createUserWithEmailAndPassword(this.auth, accountEmail(name), password);
      await this.fb.update(this.ref(`sam/accounts/${this.uid}`), { name, at: Date.now() });
    } catch (e) {
      throw new Error(friendlyAuthError(e));
    }
    this.name = name;
    return name;
  }

  async login(nameIn, password) {
    const name = cleanName(nameIn);
    if (!name) throw new Error('Type your account name.');
    try {
      await this.fb.signInWithEmailAndPassword(this.auth, accountEmail(name), String(password || ''));
      await this.loadName();
    } catch (e) {
      throw new Error(friendlyAuthError(e));
    }
    return this.name;
  }

  async logout() {
    await this.flush();
    await this.fb.signOut(this.auth);
    this.name = null;
  }

  async loadProfile() {
    const snap = await this.fb.get(this.ref(`sam/accounts/${this.uid}/profile`));
    if (!snap.exists()) return null;
    try {
      return JSON.parse(snap.val());
    } catch {
      return null;
    }
  }

  // Saves are batched: the newest profile is written at most every 10 s
  // (and right away when the page is closed or flush() is called).
  saveProfile(profile) {
    if (!this.loggedIn || profile.account !== this.uid) return Promise.resolve();
    this.pending = JSON.stringify(profile);
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.flush(), SAVE_EVERY_MS);
    return Promise.resolve();
  }

  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.saving) await this.saving.catch(() => {});
    if (!this.pending || !this.uid) return;
    const json = this.pending;
    this.pending = null;
    this.saving = this.fb.update(this.ref(`sam/accounts/${this.uid}`), { profile: json, at: Date.now() });
    try {
      await this.saving;
    } catch (e) {
      console.error('account save failed', e);
      if (!this.pending) this.pending = json; // try again with the next save
    } finally {
      this.saving = null;
    }
  }

  async resetProfile() {
    this.pending = null;
    await this.fb.update(this.ref(`sam/accounts/${this.uid}`), { profile: null, at: Date.now() });
  }

  async isBanned() {
    const snap = await this.fb.get(this.ref(`sam/bans/${this.uid}`));
    return snap.exists();
  }

  // Monsters the admin gave back while we were away go into the profile.
  async claimReturns(profile) {
    const snap = await this.fb.get(this.ref(`sam/returns/${this.uid}`));
    if (!snap.exists() || !profile) return [];
    const got = [];
    for (const [rid, v] of Object.entries(snap.val() || {})) {
      try {
        const m = JSON.parse(v.j);
        if (m && typeof m.id === 'string' && !profile.monsters.some((x) => x.id === m.id)) {
          profile.monsters.push({ ...m, slot: null, following: false, origin: 'returned' });
          got.push(m.species);
        }
      } catch { /* ignore a broken entry */ }
      await this.fb.remove(this.ref(`sam/returns/${this.uid}/${rid}`)).catch(() => {});
    }
    if (got.length) {
      profile.account = this.uid;
      this.pending = JSON.stringify(profile);
      await this.flush();
    }
    return got;
  }

  // One place at a time: refuse if this account is playing somewhere else.
  async claimPresence(where) {
    const me = this.ref(`sam/accounts/${this.uid}/online`);
    const snap = await this.fb.get(me);
    const v = snap.val();
    if (v && v.tab !== this.tabId() && Date.now() - (v.at || 0) < 6 * 3600 * 1000) {
      throw new Error(`This account is already playing (${v.room === 'solo' ? 'alone' : `in room ${v.room}`}). Close the game there first.`);
    }
    await this.fb.onDisconnect(me).remove();
    await this.fb.set(me, { room: where, at: Date.now(), tab: this.tabId() });
  }

  tabId() {
    if (!this.tab) this.tab = Math.random().toString(36).slice(2, 10);
    return this.tab;
  }

  // ---- admin (the database rules only allow these for the "daniel" account)

  async ban(account, name) {
    if (!account) return;
    await this.fb.set(this.ref(`sam/bans/${account}`), { name: String(name || '?').slice(0, 16), at: Date.now() });
  }

  async deliverReturn(account, monster) {
    if (!account) return;
    await this.fb.push(this.ref(`sam/returns/${account}`), { j: JSON.stringify(monster) });
  }

  // The name and progress of another player's account (for a room host).
  async readAccount(uid) {
    const [acct, ban] = await Promise.all([
      this.fb.get(this.ref(`sam/accounts/${uid}`)),
      this.fb.get(this.ref(`sam/bans/${uid}`)),
    ]);
    const v = acct.val() || {};
    let profile = null;
    try {
      profile = typeof v.profile === 'string' ? JSON.parse(v.profile) : null;
    } catch { /* a broken save starts fresh */ }
    return { name: cleanName(v.name), profile, banned: ban.exists() };
  }
}

// Node server accounts: the server checks everything; we remember a key.
export class ServerAccounts {
  constructor() {
    this.kind = 'server';
    this.available = true;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('sam_account') || 'null');
    } catch { /* ignore */ }
    this.name = saved?.name || null;
    this.remember = saved?.remember || null;
    this.pendingLogin = null;
  }

  async init() {
    return true;
  }

  get loggedIn() {
    return !!(this.name && (this.remember || this.pendingLogin));
  }

  get admin() {
    return this.loggedIn && isAdminName(this.name);
  }

  // checked by the server when joining (hello.account)
  async register(nameIn, password) {
    const name = cleanName(nameIn);
    if (!name) throw new Error('A name needs 2–16 letters, numbers or spaces.');
    if (String(password || '').length < PASSWORD_MIN) throw new Error(`Use a password of at least ${PASSWORD_MIN} characters.`);
    this.name = name;
    this.pendingLogin = { name, password, create: true };
    return name;
  }

  async login(nameIn, password) {
    const name = cleanName(nameIn);
    if (!name) throw new Error('Type your account name.');
    this.name = name;
    this.pendingLogin = { name, password };
    return name;
  }

  helloAccount() {
    if (this.pendingLogin) return this.pendingLogin;
    if (this.name && this.remember) return { name: this.name, remember: this.remember };
    return null;
  }

  joined(res) {
    if (res && res.ok && res.remember) {
      this.remember = res.remember;
      this.name = res.profile?.name || this.name;
      this.pendingLogin = null;
      try {
        localStorage.setItem('sam_account', JSON.stringify({ name: this.name, remember: this.remember }));
      } catch { /* ignore */ }
    } else if (res && !res.ok && ['bad_login', 'no_account'].includes(res.error)) {
      this.logout();
    }
  }

  async logout() {
    this.name = null;
    this.remember = null;
    this.pendingLogin = null;
    try {
      localStorage.removeItem('sam_account');
    } catch { /* ignore */ }
  }
}

export { nameKey };
