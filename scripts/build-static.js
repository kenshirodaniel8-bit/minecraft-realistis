// Builds a fully static copy of the game into ./dist (for GitHub Pages or any
// static web host). Singleplayer works everywhere; multiplayer still needs a
// running `npm start` server to connect to.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const three = path.join(root, 'node_modules', 'three');

if (!fs.existsSync(path.join(three, 'build', 'three.module.js'))) {
  console.error('three.js not found. Run "npm install" first.');
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });

const copies = [
  'build/three.module.js',
  'build/three.core.js',
  'examples/jsm/postprocessing',
  'examples/jsm/shaders',
  'LICENSE',
];
for (const rel of copies) {
  const src = path.join(three, rel);
  const dst = path.join(dist, 'lib', 'three', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}
// GitHub Pages: don't run Jekyll over the files.
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('Static build written to', path.relative(process.cwd(), dist) || 'dist');
