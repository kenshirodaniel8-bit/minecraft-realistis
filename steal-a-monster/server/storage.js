// Persistent storage.
//
// JsonFileStore is the DEVELOPMENT storage: one JSON file per player plus an
// ownership ledger, written atomically (write to a temp file, keep the
// previous version as .bak, then rename). It is safe against crashes in the
// middle of a write, but it is a single-process store: run one server per
// data directory. For production, implement the same four methods on top of
// a database (see README "Durable storage").
//
// Store interface:
//   async loadProfile(id)        -> object | null (null = no such profile)
//                                    throws ProfileLoadError if it exists but is unreadable
//   async saveProfile(id, data)
//   async loadLedger()           -> { [monsterId]: { owner, species, level } }
//   async saveLedger(data)

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export class ProfileLoadError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ProfileLoadError';
    this.cause = cause;
  }
}

const SAFE_ID = /^[a-z0-9_]{4,64}$/;

async function readJson(file) {
  const text = await fsp.readFile(file, 'utf8');
  return JSON.parse(text);
}

async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const text = JSON.stringify(data);
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(text, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fsp.copyFile(file, `${file}.bak`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  await fsp.rename(tmp, file);
}

async function readWithBackup(file) {
  let primaryError = null;
  try {
    return await readJson(file);
  } catch (e) {
    if (e.code === 'ENOENT') {
      // fall through to the backup (a crash between copy and rename)
      try {
        return await readJson(`${file}.bak`);
      } catch (e2) {
        if (e2.code === 'ENOENT') return null;
        throw new ProfileLoadError(`Could not read ${path.basename(file)} or its backup`, e2);
      }
    }
    primaryError = e;
  }
  try {
    const data = await readJson(`${file}.bak`);
    try {
      await fsp.rename(file, `${file}.corrupt-${Date.now()}`);
    } catch { /* keep going */ }
    return data;
  } catch (e2) {
    throw new ProfileLoadError(`Profile file ${path.basename(file)} is unreadable`, primaryError || e2);
  }
}

export class JsonFileStore {
  constructor(dir) {
    this.dir = dir;
    this.playersDir = path.join(dir, 'players');
    fs.mkdirSync(this.playersDir, { recursive: true });
    this.queues = new Map(); // serialize writes per file
  }

  fileFor(id) {
    if (!SAFE_ID.test(id)) throw new Error('invalid profile id');
    return path.join(this.playersDir, `${id}.json`);
  }

  serial(key, fn) {
    const prev = this.queues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(key, next.catch(() => {}));
    return next;
  }

  async loadProfile(id) {
    return readWithBackup(this.fileFor(id));
  }

  async saveProfile(id, data) {
    const file = this.fileFor(id);
    const snapshot = JSON.parse(JSON.stringify(data));
    return this.serial(file, () => atomicWrite(file, snapshot));
  }

  async loadLedger() {
    const file = path.join(this.dir, 'ownership.json');
    const data = await readWithBackup(file);
    return data && typeof data === 'object' ? data : {};
  }

  async saveLedger(data) {
    const file = path.join(this.dir, 'ownership.json');
    const snapshot = JSON.parse(JSON.stringify(data));
    return this.serial(file, () => atomicWrite(file, snapshot));
  }

  // accounts (server/accounts.js) and bans (the admin's)
  async loadAccounts() {
    return (await readWithBackup(path.join(this.dir, 'accounts.json'))) || {};
  }

  async saveAccounts(data) {
    const file = path.join(this.dir, 'accounts.json');
    const snapshot = JSON.parse(JSON.stringify(data));
    return this.serial(file, () => atomicWrite(file, snapshot));
  }

  async loadBans() {
    return (await readWithBackup(path.join(this.dir, 'bans.json'))) || {};
  }

  async saveBans(data) {
    const file = path.join(this.dir, 'bans.json');
    const snapshot = JSON.parse(JSON.stringify(data));
    return this.serial(file, () => atomicWrite(file, snapshot));
  }
}

// In-memory store for tests and throwaway servers.
export class MemoryStore {
  constructor() {
    this.profiles = new Map();
    this.ledger = {};
    this.failSaves = false;
    this.saveCount = 0;
  }

  async loadProfile(id) {
    const p = this.profiles.get(id);
    if (p === 'CORRUPT') throw new ProfileLoadError('corrupt (test)');
    return p ? JSON.parse(p) : null;
  }

  async saveProfile(id, data) {
    if (this.failSaves) throw new Error('simulated save failure');
    this.saveCount++;
    this.profiles.set(id, JSON.stringify(data));
  }

  async loadLedger() {
    return JSON.parse(JSON.stringify(this.ledger));
  }

  async saveLedger(data) {
    if (this.failSaves) throw new Error('simulated save failure');
    this.ledger = JSON.parse(JSON.stringify(data));
  }

  async loadAccounts() {
    return JSON.parse(JSON.stringify(this.accounts || {}));
  }

  async saveAccounts(data) {
    this.accounts = JSON.parse(JSON.stringify(data));
  }

  async loadBans() {
    return JSON.parse(JSON.stringify(this.bans || {}));
  }

  async saveBans(data) {
    this.bans = JSON.parse(JSON.stringify(data));
  }
}
