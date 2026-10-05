// Persistence: worlds in IndexedDB, profile + settings in localStorage.
// Everything degrades gracefully (in-memory) when storage is unavailable.

const DB_NAME = 'realiscraft';
const DB_VERSION = 1;
const STORE = 'worlds';

let dbPromise = null;
const memoryWorlds = new Map();
let useMemory = false;

function openDB() {
  if (useMemory) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!('indexedDB' in window)) { useMemory = true; resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { useMemory = true; resolve(null); };
      req.onblocked = () => { useMemory = true; resolve(null); };
    } catch (e) {
      useMemory = true;
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    const r = fn(store);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('Storage error'));
    t.onabort = () => reject(t.error || new Error('Storage aborted'));
  });
}

export async function listWorlds() {
  const db = await openDB();
  let all;
  if (!db) all = Array.from(memoryWorlds.values());
  else {
    try { all = await tx(db, 'readonly', (s) => s.getAll()); } catch (e) { all = Array.from(memoryWorlds.values()); }
  }
  return (all || [])
    .map((w) => ({ id: w.id, name: w.name, seed: w.seed, mode: w.mode, created: w.created, lastPlayed: w.lastPlayed }))
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}

export async function loadWorld(id) {
  const db = await openDB();
  if (!db) return memoryWorlds.get(id) || null;
  try { return (await tx(db, 'readonly', (s) => s.get(id))) || null; } catch (e) { return memoryWorlds.get(id) || null; }
}

export async function saveWorld(record) {
  const db = await openDB();
  const copy = Object.assign({}, record);
  if (!db) { memoryWorlds.set(copy.id, copy); return true; }
  try {
    await tx(db, 'readwrite', (s) => s.put(copy));
    return true;
  } catch (e) {
    console.warn('Saving to IndexedDB failed, keeping world in memory', e);
    memoryWorlds.set(copy.id, copy);
    return false;
  }
}

export async function deleteWorld(id) {
  const db = await openDB();
  memoryWorlds.delete(id);
  if (!db) return;
  try { await tx(db, 'readwrite', (s) => s.delete(id)); } catch (e) { /* ignore */ }
}

export function isPersistent() { return !useMemory; }

// --- localStorage helpers ---------------------------------------------------

export function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    const parsed = JSON.parse(v);
    return parsed ?? fallback;
  } catch (e) {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export const DEFAULT_SETTINGS = {
  quality: 'high',
  renderDistance: 8,
  fov: 75,
  sensitivity: 1,
  volume: 0.7,
  invertY: false,
  viewBobbing: true,
  autoJump: true,
  fancyLeaves: true,
  showFps: false,
  autoTuned: false, // set once the automatic quality check has finished (or the user picked a quality)
};

export function loadSettings() {
  const s = Object.assign({}, DEFAULT_SETTINGS, readJSON('rc.settings', {}));
  if (!['low', 'medium', 'high', 'ultra'].includes(s.quality)) s.quality = 'high';
  s.renderDistance = Math.max(2, Math.min(16, Number(s.renderDistance) || 8));
  s.fov = Math.max(50, Math.min(110, Number(s.fov) || 75));
  s.sensitivity = Math.max(0.1, Math.min(3, Number(s.sensitivity) || 1));
  s.volume = Math.max(0, Math.min(1, Number(s.volume)));
  if (!Number.isFinite(s.volume)) s.volume = 0.7;
  return s;
}

export function saveSettings(s) { writeJSON('rc.settings', s); }

export function loadProfile() {
  const p = readJSON('rc.profile', {});
  return {
    name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 16) : 'Player' + Math.floor(100 + Math.random() * 900),
    skin: typeof p.skin === 'string' ? p.skin : null,
    slim: !!p.slim,
    preset: typeof p.preset === 'string' ? p.preset : 'explorer',
    server: typeof p.server === 'string' ? p.server : '',
  };
}

export function saveProfile(p) {
  if (!writeJSON('rc.profile', p)) {
    // Most likely the skin is too big for localStorage; keep everything else.
    writeJSON('rc.profile', Object.assign({}, p, { skin: null }));
  }
}
