// RealisCraft server: serves the game and hosts a shared multiplayer world.
//
//   npm start                 -> http://localhost:3000
//   PORT=8080 npm start       -> different port
//   SEED=myseed npm start     -> seed for a brand new world
//   RESET=1 npm start         -> start a fresh world (old one is backed up)

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { TerrainGenerator } from '../public/js/engine/terrain.js';
import { isValidBlockId } from '../public/js/engine/blocks.js';
import { WORLD_HEIGHT, DAY_LENGTH_SECONDS } from '../public/js/engine/constants.js';
import { normalizeSeed } from '../public/js/engine/noise.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');

const PROTOCOL_VERSION = 1;
const MAX_SKIN_CHARS = 600 * 1024;
const MAX_REACH = 12;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function sanitizeName(v) {
  return String(v || '').replace(/[^A-Za-z0-9_\- ]/g, '').trim().slice(0, 16);
}

function sanitizeText(v) {
  // eslint-disable-next-line no-control-regex
  return String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

function isInt(v) { return Number.isInteger(v); }

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ---------------------------------------------------------------------------
// World state

export class WorldState {
  constructor(opts = {}) {
    this.file = opts.file || null;
    this.seed = normalizeSeed(opts.seed ?? '');
    this.name = opts.name || 'Server World';
    this.edits = new Map(); // "x,y,z" -> id
    this.time = 0.04;
    this.spawn = null;
    this.created = Date.now();
    this.dirty = false;
    this.gameMode = opts.gameMode === 'survival' ? 'survival' : 'creative';
  }

  async load() {
    if (!this.file) return false;
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      const data = JSON.parse(raw);
      if (typeof data.seed === 'number') this.seed = data.seed >>> 0;
      if (typeof data.name === 'string') this.name = data.name;
      if (typeof data.time === 'number') this.time = ((data.time % 1) + 1) % 1;
      if (data.spawn && [data.spawn.x, data.spawn.y, data.spawn.z].every(Number.isFinite)) this.spawn = data.spawn;
      if (typeof data.created === 'number') this.created = data.created;
      if (data.gameMode === 'survival' || data.gameMode === 'creative') this.gameMode = data.gameMode;
      const e = Array.isArray(data.edits) ? data.edits : [];
      for (let i = 0; i + 3 < e.length; i += 4) {
        if (isInt(e[i]) && isInt(e[i + 1]) && isInt(e[i + 2]) && isValidBlockId(e[i + 3])) {
          this.edits.set(`${e[i]},${e[i + 1]},${e[i + 2]}`, e[i + 3]);
        }
      }
      return true;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('Could not read world file, starting fresh:', err.message);
      return false;
    }
  }

  ensureSpawn() {
    if (!this.spawn) this.spawn = new TerrainGenerator(this.seed).findSpawn();
    return this.spawn;
  }

  flatEdits() {
    const out = [];
    for (const [k, id] of this.edits) {
      const [x, y, z] = k.split(',').map(Number);
      out.push(x, y, z, id);
    }
    return out;
  }

  setBlock(x, y, z, id) {
    this.edits.set(`${x},${y},${z}`, id);
    this.dirty = true;
  }

  async save() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    const data = {
      seed: this.seed, name: this.name, time: this.time, spawn: this.spawn, created: this.created,
      gameMode: this.gameMode, edits: this.flatEdits(),
    };
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data));
    await fsp.rename(tmp, this.file);
  }
}

// ---------------------------------------------------------------------------
// HTTP static server

function resolveStatic(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch (e) { return null; }
  if (p.includes('\0')) return null;
  if (p === '/' || p === '') p = '/index.html';
  if (p.startsWith('/lib/three/')) {
    const rel = p.slice('/lib/three/'.length);
    if (!(rel.startsWith('build/') || rel.startsWith('examples/jsm/'))) return null;
    const full = path.resolve(THREE_DIR, rel);
    return full.startsWith(THREE_DIR + path.sep) ? full : null;
  }
  const full = path.resolve(PUBLIC_DIR, '.' + p);
  return full.startsWith(PUBLIC_DIR + path.sep) ? full : null;
}

function createHttpHandler(getStatus) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(getStatus()));
      return;
    }
    const file = resolveStatic(req.url || '/');
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const st = await fsp.stat(file);
      if (!st.isFile()) throw new Error('not a file');
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  };
}

// ---------------------------------------------------------------------------
// Game server

export async function createServer(opts = {}) {
  const port = opts.port ?? Number(process.env.PORT || 3000);
  const host = opts.host ?? (process.env.HOST || '0.0.0.0');
  const maxPlayers = opts.maxPlayers ?? Number(process.env.MAX_PLAYERS || 20);
  const quiet = !!opts.quiet;
  const log = (...a) => { if (!quiet) console.log(...a); };

  const world = new WorldState({
    file: opts.worldFile === undefined ? path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'world.json') : opts.worldFile,
    seed: opts.seed ?? process.env.SEED,
    gameMode: opts.gameMode ?? process.env.GAMEMODE,
  });
  if (process.env.RESET === '1' && world.file && fs.existsSync(world.file)) {
    fs.renameSync(world.file, world.file + '.backup-' + Date.now());
  }
  const loaded = await world.load();
  world.ensureSpawn();
  log(loaded ? `Loaded world (seed ${world.seed}, ${world.edits.size} edits)` : `Created new world with seed ${world.seed}`);

  const players = new Map();
  let nextId = 1;

  const status = () => ({ name: world.name, seed: world.seed, players: Array.from(players.values()).map((p) => p.name), maxPlayers });
  const server = http.createServer(createHttpHandler(status));
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 1024 });

  function send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  function broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const p of players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(s);
  }
  function publicInfo(p) {
    return { id: p.id, name: p.name, skin: p.skin, slim: p.slim, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
  }
  function systemChat(text, ws) {
    const msg = { t: 'chat', text };
    if (ws) send(ws, msg); else broadcast(msg);
  }

  wss.on('connection', (ws, req) => {
    let player = null;
    let msgCount = 0;
    let setCount = 0;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const rateTimer = setInterval(() => { msgCount = 0; setCount = 0; }, 1000);
    const helloTimer = setTimeout(() => { if (!player) ws.close(4000, 'No hello'); }, 10000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (++msgCount > 250) { ws.close(4008, 'Too many messages'); return; }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (!player) {
        if (msg.t !== 'hello') return;
        if (msg.v !== PROTOCOL_VERSION) { send(ws, { t: 'error', message: 'Version mismatch: please reload the page.' }); ws.close(); return; }
        if (players.size >= maxPlayers) { send(ws, { t: 'error', message: 'Server is full.' }); ws.close(); return; }
        let name = sanitizeName(msg.name) || 'Player';
        const taken = new Set(Array.from(players.values()).map((p) => p.name.toLowerCase()));
        if (taken.has(name.toLowerCase())) {
          let i = 2;
          while (taken.has((name.slice(0, 13) + i).toLowerCase())) i++;
          name = name.slice(0, 13) + i;
        }
        const skin = typeof msg.skin === 'string' && msg.skin.startsWith('data:image/png;base64,') && msg.skin.length <= MAX_SKIN_CHARS ? msg.skin : null;
        const sp = world.spawn;
        player = {
          id: nextId++, ws, name, skin, slim: !!msg.slim,
          x: sp.x, y: sp.y, z: sp.z, yaw: 0, pitch: 0, f: 0, h: 0, moved: true,
        };
        clearTimeout(helloTimer);
        send(ws, {
          t: 'welcome', id: player.id, seed: world.seed, name: world.name, time: world.time,
          spawn: world.spawn, gameMode: world.gameMode, edits: world.flatEdits(),
          players: Array.from(players.values()).map(publicInfo),
        });
        players.set(player.id, player);
        broadcast({ t: 'join', player: publicInfo(player) }, ws);
        systemChat(`Welcome, ${name}! ${players.size} player(s) online. Type /help for commands.`, ws);
        log(`${name} joined from ${req.socket.remoteAddress} (${players.size} online)`);
        return;
      }

      switch (msg.t) {
        case 'move': {
          const { x, y, z, yaw, pitch } = msg;
          if (![x, y, z, yaw, pitch].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
          player.x = Math.max(-3e7, Math.min(3e7, x));
          player.y = Math.max(-100, Math.min(WORLD_HEIGHT + 100, y));
          player.z = Math.max(-3e7, Math.min(3e7, z));
          player.yaw = yaw;
          player.pitch = Math.max(-1.6, Math.min(1.6, pitch));
          player.f = isInt(msg.f) ? msg.f & 7 : 0;
          player.h = isInt(msg.h) && isValidBlockId(msg.h) ? msg.h : 0;
          player.moved = true;
          break;
        }
        case 'set': {
          const { x, y, z, id } = msg;
          if (!isInt(x) || !isInt(y) || !isInt(z) || !isValidBlockId(id)) return;
          if (y < 0 || y >= WORLD_HEIGHT) return;
          if (++setCount > 60) return;
          const d = Math.hypot(x + 0.5 - player.x, y + 0.5 - (player.y + 1.6), z + 0.5 - player.z);
          if (d > MAX_REACH) return;
          world.setBlock(x, y, z, id);
          broadcast({ t: 'set', x, y, z, id, by: player.id }, ws);
          break;
        }
        case 'chat': {
          const text = sanitizeText(msg.text);
          if (!text) return;
          if (text.startsWith('/')) { handleCommand(player, text); return; }
          broadcast({ t: 'chat', from: player.name, text });
          log(`<${player.name}> ${text}`);
          break;
        }
        case 'cmd': {
          if (msg.cmd === 'time' && typeof msg.value === 'number' && Number.isFinite(msg.value)) {
            world.time = ((msg.value % 1) + 1) % 1;
            world.dirty = true;
            broadcast({ t: 'time', time: world.time });
            systemChat(`${player.name} changed the time.`);
          }
          break;
        }
        case 'skin': {
          const skin = typeof msg.skin === 'string' && msg.skin.startsWith('data:image/png;base64,') && msg.skin.length <= MAX_SKIN_CHARS ? msg.skin : null;
          player.skin = skin;
          player.slim = !!msg.slim;
          broadcast({ t: 'skin', id: player.id, skin, slim: player.slim }, ws);
          break;
        }
        case 'ping':
          send(ws, { t: 'pong', ts: msg.ts });
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      clearInterval(rateTimer);
      clearTimeout(helloTimer);
      if (player && players.get(player.id) === player) {
        players.delete(player.id);
        broadcast({ t: 'leave', id: player.id });
        log(`${player.name} left (${players.size} online)`);
      }
    });
    ws.on('error', () => { /* socket errors end in 'close' */ });
  });

  function handleCommand(player, text) {
    const [cmd] = text.slice(1).split(/\s+/);
    switch ((cmd || '').toLowerCase()) {
      case 'list':
        systemChat(`Online (${players.size}): ${Array.from(players.values()).map((p) => p.name).join(', ')}`, player.ws);
        break;
      case 'help':
        systemChat('Server commands: /list, /time set <day|night|...>. Local: /gamemode, /tp, /spawn, /seed, /fly', player.ws);
        break;
      default:
        systemChat(`Unknown command: /${cmd}`, player.ws);
    }
  }

  // 20 Hz position broadcast + world clock.
  const TICK = 50;
  let tickCount = 0;
  const tickTimer = setInterval(() => {
    world.time = (world.time + TICK / 1000 / DAY_LENGTH_SECONDS) % 1;
    const list = [];
    for (const p of players.values()) {
      if (!p.moved) continue;
      p.moved = false;
      list.push([p.id, +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.f, p.h]);
    }
    if (list.length) broadcast({ t: 'moves', list });
    tickCount++;
    if (tickCount % 200 === 0) broadcast({ t: 'time', time: world.time });
  }, TICK);

  // Drop dead connections.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* ignore */ }
    }
  }, 30000);

  const saveTimer = setInterval(() => {
    world.dirty = world.dirty || players.size > 0;
    world.save().catch((e) => console.error('Save failed:', e.message));
  }, 30000);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;

  async function close() {
    clearInterval(tickTimer);
    clearInterval(heartbeat);
    clearInterval(saveTimer);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise((r) => server.close(r));
    world.dirty = true;
    await world.save().catch(() => {});
  }

  return { server, wss, world, players, port: actualPort, close };
}

// Run directly: `node server/server.js`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(path.join(THREE_DIR, 'build', 'three.module.js'))) {
    console.error('Missing dependencies. Run "npm install" first.');
    process.exit(1);
  }
  createServer().then((s) => {
    console.log('');
    console.log('  RealisCraft server is running!');
    console.log(`  Play here:        http://localhost:${s.port}`);
    for (const ip of lanAddresses()) console.log(`  Friends (LAN):    http://${ip}:${s.port}`);
    console.log('');
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      console.log('Saving world and shutting down…');
      await s.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${process.env.PORT || 3000} is already in use. Try: PORT=3001 npm start`);
    else console.error(err);
    process.exit(1);
  });
}
