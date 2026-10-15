// The Firebase connection used by online accounts (accounts.js) and online
// rooms (rooms.js). Loaded only when needed.

import { FIREBASE_CONFIG } from '../firebase-config.js';

// The config from firebase-config.js, or one saved in this browser (used by
// the automated tests to point at the local Firebase emulators).
export function firebaseConfig() {
  try {
    const o = JSON.parse(localStorage.getItem('sam_firebase') || 'null');
    if (o && o.databaseURL) return o;
  } catch { /* ignore */ }
  return FIREBASE_CONFIG && FIREBASE_CONFIG.databaseURL ? FIREBASE_CONFIG : null;
}

let fbPromise = null;
export function firebase() {
  if (!fbPromise) {
    fbPromise = (async () => {
      const cfg = firebaseConfig();
      if (!cfg) throw new Error('Online play is not set up yet (firebase-config.js is empty).');
      const fb = await import('../vendor/firebase.js');
      const app = fb.initializeApp(cfg, 'steal-a-monster');
      const db = fb.getDatabase(app);
      const auth = fb.initializeAuth(app, { persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence] });
      if (cfg.emulator) {
        const [host, port] = String(cfg.emulator).split(':');
        fb.connectDatabaseEmulator(db, host, Number(port));
      }
      if (cfg.authEmulator) fb.connectAuthEmulator(auth, `http://${cfg.authEmulator}`, { disableWarnings: true });
      // wait until a saved log-in (if any) is restored
      await new Promise((resolve) => {
        const stop = fb.onAuthStateChanged(auth, () => {
          stop();
          resolve();
        });
      });
      return { fb, db, auth };
    })();
    fbPromise.catch(() => { fbPromise = null; });
  }
  return fbPromise;
}
