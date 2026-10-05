// Builds a fully static copy of the game (for GitHub Pages or any static web
// host). Singleplayer works everywhere; multiplayer still needs a running
// `npm start` server to connect to.
//
//   node scripts/build-static.js              -> ./dist
//   node scripts/build-static.js --embedded   -> ./dist-embedded, for hosts that
//                                                wrap the page in their own
//                                                <html>/<head>/<body> skeleton
//                                                and load libraries from a CDN
//   --three-url <url>   load three.module.js from this URL instead of a local copy
//                       (--embedded defaults to the jsDelivr CDN)
//
// Bare `three` imports are rewritten to relative paths (or the CDN URL), so the
// build does not depend on import maps, and only the three.js add-ons the game
// uses are copied.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const embedded = process.argv.includes('--embedded');
const dist = path.join(root, embedded ? 'dist-embedded' : 'dist');
const three = path.join(root, 'node_modules', 'three');
const jsm = path.join(three, 'examples', 'jsm');

if (!fs.existsSync(path.join(three, 'build', 'three.module.js'))) {
  console.error('three.js not found. Run "npm install" first.');
  process.exit(1);
}
const threeVersion = JSON.parse(fs.readFileSync(path.join(three, 'package.json'), 'utf8')).version;
const urlArg = process.argv.indexOf('--three-url');
const threeUrl = urlArg > 0 ? process.argv[urlArg + 1]
  : embedded ? `https://cdn.jsdelivr.net/npm/three@${threeVersion}/build/three.module.js` : null;

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });

const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\2/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Collect the add-on files the game imports (and their own relative imports).
const addons = new Set();
function addAddon(rel) {
  if (addons.has(rel)) return;
  addons.add(rel);
  const src = fs.readFileSync(path.join(jsm, rel), 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[3];
    if (spec.startsWith('.')) addAddon(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
  }
}
for (const file of walk(path.join(dist, 'js'))) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
    if (m[3].startsWith('three/addons/')) addAddon(m[3].slice('three/addons/'.length));
  }
}

const libDir = path.join(dist, 'lib', 'three');
for (const rel of threeUrl ? ['LICENSE'] : ['build/three.module.js', 'build/three.core.js', 'LICENSE']) {
  fs.mkdirSync(path.dirname(path.join(libDir, rel)), { recursive: true });
  fs.copyFileSync(path.join(three, rel), path.join(libDir, rel));
}
for (const rel of addons) {
  const dst = path.join(libDir, 'examples', 'jsm', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(jsm, rel), dst);
}

// Rewrite bare specifiers to paths relative to each file.
const threeEntry = path.join(libDir, 'build', 'three.module.js');
const addonRoot = path.join(libDir, 'examples', 'jsm');
function relSpec(from, target) {
  let r = path.relative(path.dirname(from), target).split(path.sep).join('/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
}
for (const file of walk(dist)) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(IMPORT_RE, (all, pre, q, spec) => {
    if (spec === 'three') return pre + q + (threeUrl || relSpec(file, threeEntry)) + q;
    if (spec.startsWith('three/addons/')) return pre + q + relSpec(file, path.join(addonRoot, spec.slice(13))) + q;
    return all;
  });
  if (out !== src) fs.writeFileSync(file, out);
}

// Page: drop the import map and mark the build so the game knows there is no
// game server behind this page.
const indexPath = path.join(dist, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace('<title>', `<meta name="realistis-build" content="${embedded ? 'embedded' : 'static'}">\n  <title>`);
if (embedded) {
  // The host provides the document skeleton: keep the head's contents and the body.
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/\s*<meta charset[^>]*>/, '')
    .replace(/\s*<meta name="viewport"[^>]*>/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
  html = title + '\n' + head.replace(title, '').trim() + '\n' + body.trim() + '\n';
}
fs.writeFileSync(indexPath, html);
// GitHub Pages: don't run Jekyll over the files.
if (!embedded) fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`Static build written to ${path.relative(process.cwd(), dist) || dist} (three.js ${threeUrl || threeVersion + ' local'}, ${addons.size} add-on files)`);
