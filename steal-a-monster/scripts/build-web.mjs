// Builds the single-player web version: a folder of static files that runs
// the whole game (including the game server logic) in the browser. Host it
// anywhere that serves static files, e.g. GitHub Pages.
//   node scripts/build-web.mjs [outDir=dist-web]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || 'dist-web');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(out, to));
};
const copyDir = (from, to, filter = () => true) => {
  for (const f of fs.readdirSync(path.join(root, from))) {
    const p = path.join(from, f);
    if (fs.statSync(path.join(root, p)).isDirectory()) copyDir(p, path.join(to, f), filter);
    else if (filter(f)) copy(p, path.join(to, f));
  }
};

// client, shared code and the game server logic (no Node networking/storage)
copyDir('public/client', 'client');
copyDir('shared', 'shared');
copy('public/style.css', 'style.css');
// online rooms: the Firebase config and the bundled Firebase SDK
copy('public/firebase-config.js', 'firebase-config.js');
copyDir('public/vendor', 'vendor');
for (const f of ['game.js', 'validate.js', 'rateLimit.js']) copy(`server/${f}`, `server/${f}`);
copyDir('server/services', 'server/services');
// three.js and the two addons the game uses
const three = 'node_modules/three';
copy(`${three}/build/three.module.js`, 'lib/three/three.module.js');
copy(`${three}/build/three.core.js`, 'lib/three/three.core.js');
copy(`${three}/examples/jsm/utils/BufferGeometryUtils.js`, 'lib/three/addons/utils/BufferGeometryUtils.js');
copy(`${three}/examples/jsm/geometries/RoundedBoxGeometry.js`, 'lib/three/addons/geometries/RoundedBoxGeometry.js');
copy(`${three}/LICENSE`, 'lib/three/LICENSE');

// pages: relative import map (works in any sub-folder) + single-player flag
const importMap = JSON.stringify({
  imports: {
    three: './lib/three/three.module.js',
    'three/addons/': './lib/three/addons/',
    '#shared/': './shared/',
    '#server/': './server/',
  },
}, null, 2);
for (const page of ['index.html', 'gallery.html']) {
  let html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
  html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${importMap}\n</script>`);
  if (page === 'index.html') html = html.replace('<script type="module"', '<script>window.SAM_SOLO = true;</script>\n  <script type="module"');
  // a download link for the one-file source (for other AIs), web build only
  if (page === 'index.html') html = html.replace('<button id="controls-btn"', '<a href="source.html" download="steal-a-monster-for-ai.html">⬇ Download game for AI</a>\n        <button id="controls-btn"');
  fs.writeFileSync(path.join(out, page), html);
}
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// sanity checks: no absolute imports left that a static host can't serve
const bad = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.includes(`${path.sep}lib${path.sep}`) && !p.includes(`${path.sep}vendor${path.sep}`)) {
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/^import [^;]*? from '([^']+)'/gm)) {
        const spec = m[1];
        if (spec.startsWith('node:') || (!spec.startsWith('.') && !spec.startsWith('#') && !spec.startsWith('three'))) bad.push(`${path.relative(out, p)}: ${spec}`);
      }
    }
  }
};
walk(out);
if (bad.length) {
  console.error('Imports a static site cannot load:\n  ' + bad.join('\n  '));
  process.exit(1);
}
// the whole source in one html page for other AIs (source.html)
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-handoff-html.mjs'), path.join(out, 'source.html')], { stdio: 'ignore' });

let files = 0;
let bytes = 0;
const count = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) count(p);
    else {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
};
count(out);
console.log(`web build: ${files} files, ${(bytes / 1048576).toFixed(1)} MB -> ${path.relative(root, out) || out}`);
