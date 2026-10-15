// Builds ONE html file with everything another AI needs to continue the
// game: AI-HANDOFF.md and the other docs first, then every source file as
// plain text (no zip needed). Open it in a browser to read it, or upload it
// to an AI chat. The web build also publishes it as source.html.
//   node scripts/build-handoff-html.mjs [out=steal-a-monster-for-ai.html]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || 'steal-a-monster-for-ai.html');

// the files in git (or, without git, everything under the folder)
function listFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    const all = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(path.join(root, dir))) {
        const p = dir ? `${dir}/${f}` : f;
        if (['node_modules', 'dist-web', 'data', 'test-results', '.git'].includes(f)) continue;
        if (fs.statSync(path.join(root, p)).isDirectory()) walk(p);
        else all.push(p);
      }
    };
    walk('');
    return all;
  }
}

const TEXT = /\.(js|mjs|json|md|html|css|yml|yaml|txt)$|(^|\/)\.gitignore$/;
const SKIP = [/^public\/vendor\//, /package-lock\.json$/, /^docs\/screenshots\//, /^steal-a-monster-for-ai\.html$/];
const FIRST = ['AI-HANDOFF.md', 'AGENTS.md', 'README.md', 'TESTING.md', 'PANDUAN-FIREBASE.md', 'package.json', 'firebase-database.rules.json', 'firebase.json'];
const files = listFiles().filter((f) => TEXT.test(f) && !SKIP.some((r) => r.test(f)) && f !== 'CLAUDE.md');
files.sort((a, b) => {
  const ia = FIRST.indexOf(a);
  const ib = FIRST.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b);
});
// the workflow that publishes the website lives outside this folder
const workflow = path.join(root, '..', '.github', 'workflows', 'steal-a-monster-pages.yml');
const extra = fs.existsSync(workflow) ? [['../.github/workflows/steal-a-monster-pages.yml', fs.readFileSync(workflow, 'utf8')]] : [];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const anchor = (f) => `f-${f.replace(/[^A-Za-z0-9]+/g, '-')}`;
let commit = 'unknown';
try {
  commit = execFileSync('git', ['log', '-1', '--format=%h %cs %s'], { cwd: root, encoding: 'utf8' }).trim();
} catch { /* not a git checkout */ }

const entries = [...files.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]), ...extra];
const totalLines = entries.reduce((n, [, t]) => n + t.split('\n').length, 0);
const toc = entries.map(([f, t]) => `<li><a href="#${anchor(f)}">${esc(f)}</a> <small>${t.split('\n').length} lines</small></li>`).join('\n');
const body = entries.map(([f, t]) => `<section id="${anchor(f)}">
<h2>FILE: ${esc(f)}</h2>
<pre><code>${esc(t)}</code></pre>
</section>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Steal a Monster source</title>
<style>
  :root { --bg: #fbfaf7; --fg: #1d1b26; --muted: #6b6878; --line: #e3dfd6; --code: #f2efe8; --accent: #7a3fd8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16151c; --fg: #ecebf2; --muted: #a09db0; --line: #2e2c38; --code: #1f1d27; --accent: #b48cff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 80px; }
  h1 { margin: 0 0 4px; } h2 { font-size: 16px; margin: 32px 0 8px; padding-top: 12px; border-top: 2px solid var(--line); color: var(--accent); }
  .note { background: var(--code); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin: 16px 0; }
  pre { background: var(--code); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; font: 12.5px/1.45 ui-monospace, Menlo, Consolas, monospace; white-space: pre; }
  a { color: var(--accent); } small { color: var(--muted); }
  ol { columns: 2; column-gap: 32px; font-size: 13px; } @media (max-width: 700px) { ol { columns: 1; } }
</style>
</head>
<body>
<main>
<h1>STEAL A MONSTER — full source for AI</h1>
<p><small>Version: ${esc(commit)} · ${entries.length} files · ${totalLines.toLocaleString('en-US')} lines</small></p>
<div class="note">
<p><b>To the AI reading this:</b> this one file contains the whole game: <code>AI-HANDOFF.md</code> (read it first: what the game is, how it is built and tested, the rules for changing it, the Firebase setup and the current state), the other docs, and every source file of the <code>steal-a-monster/</code> folder as plain text, each under a heading <code>FILE: path</code>. When you change the game, give back complete files with their paths, and update <code>AI-HANDOFF.md</code> (Current state + Change log). Not included: the bundled Firebase SDK (<code>public/vendor/firebase.js</code>, rebuilt with <code>node scripts/build-firebase.mjs</code>), <code>package-lock.json</code> and screenshots.</p>
<p><b>Untuk pemilik game:</b> upload file ini ke AI lain, lalu tulis permintaanmu. Bilang: <i>"Baca AI-HANDOFF.md di dalam file ini dulu. Setelah selesai, berikan file lengkap yang diubah beserta path-nya, dan perbarui AI-HANDOFF.md."</i> Versi terbaru file ini selalu ada di https://kenshirodaniel8-bit.github.io/minecraft-realistis/source.html</p>
</div>
<h2>Files</h2>
<ol>
${toc}
</ol>
${body}
</main>
</body>
</html>
`;
fs.writeFileSync(out, html);
console.log(`handoff html: ${entries.length} files, ${totalLines} lines, ${(html.length / 1024 / 1024).toFixed(2)} MB -> ${path.relative(process.cwd(), out)}`);
