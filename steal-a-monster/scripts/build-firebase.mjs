// Bundles the parts of the Firebase JS SDK the game uses (app, Realtime
// Database for rooms and accounts, Authentication for log-in) into one ES module, public/vendor/firebase.js, so the
// game does not depend on a CDN. Re-run after updating the firebase package:
//   node scripts/build-firebase.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = `
export { initializeApp } from 'firebase/app';
export {
  getDatabase, connectDatabaseEmulator, ref, child, set, update, push, remove, get,
  onChildAdded, onChildRemoved, onValue, onDisconnect, serverTimestamp,
} from 'firebase/database';
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'firebase/auth';
`;
await build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' },
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  platform: 'browser',
  legalComments: 'eof',
  outfile: path.join(root, 'public/vendor/firebase.js'),
});
const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/firebase/package.json'), 'utf8')).version;
const out = path.join(root, 'public/vendor/firebase.js');
fs.writeFileSync(out, `/* Firebase JS SDK ${version} (app + database + auth), bundled by scripts/build-firebase.mjs. Apache-2.0 */\n` + fs.readFileSync(out, 'utf8'));
console.log(`public/vendor/firebase.js: Firebase ${version}, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
