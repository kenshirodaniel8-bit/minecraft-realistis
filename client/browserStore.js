// Save storage for the in-browser game (single-player): profiles and the
// ownership ledger in localStorage, with the previous copy kept as a backup.
// Same interface as server/storage.js.

const PREFIX = 'sam_save_';

function read(key) {
  const raw = localStorage.getItem(PREFIX + key);
  return raw === null ? null : JSON.parse(raw);
}

function write(key, data) {
  const k = PREFIX + key;
  const prev = localStorage.getItem(k);
  if (prev !== null) localStorage.setItem(`${k}.bak`, prev);
  localStorage.setItem(k, JSON.stringify(data));
}

export class BrowserStore {
  async loadProfile(id) {
    try {
      return read(`profile_${id}`);
    } catch {
      // damaged save: fall back to the previous copy
      const bak = localStorage.getItem(`${PREFIX}profile_${id}.bak`);
      if (bak === null) throw new Error('Your saved progress could not be loaded.');
      return JSON.parse(bak);
    }
  }

  async saveProfile(id, data) {
    write(`profile_${id}`, data);
  }

  async loadLedger() {
    try {
      return read('ledger') || {};
    } catch {
      return {};
    }
  }

  async saveLedger(data) {
    write('ledger', data);
  }
}
