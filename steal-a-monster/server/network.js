// HTTP (Express) + real-time networking (Socket.IO) around the Game.

import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as IOServer } from 'socket.io';
import { CONFIG, applyEnvOverrides } from '#shared/config.js';
import { Game } from './game.js';
import { JsonFileStore, MemoryStore } from './storage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

export async function createGameServer(opts = {}) {
  applyEnvOverrides(opts.env || {});
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);
  const store = opts.store || (opts.dataDir ? new JsonFileStore(opts.dataDir) : new MemoryStore());
  const game = new Game({
    store,
    now: opts.now,
    rng: opts.rng,
    log: opts.quiet ? () => {} : (...a) => console.log('[game]', ...a),
    devCommands: !!opts.devCommands,
    expansionThresholds: opts.expansionThresholds,
  });
  await game.init();

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/health', (req, res) => {
    res.json({ ok: true, players: game.players.size, monsters: game.monsters.list.size, world: game.expansion.state(), saveFailures: game.saveFailures });
  });
  const staticOpts = { index: 'index.html', dotfiles: 'deny', fallthrough: true, maxAge: opts.dev ? 0 : '1h' };
  app.use('/shared', express.static(path.join(ROOT, 'shared'), staticOpts));
  app.use('/lib/three/build', express.static(path.join(ROOT, 'node_modules', 'three', 'build'), staticOpts));
  app.use('/lib/three/addons', express.static(path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm'), staticOpts));
  app.use('/', express.static(path.join(ROOT, 'public'), staticOpts));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

  const httpServer = http.createServer(app);
  const io = new IOServer(httpServer, {
    maxHttpBufferSize: 32 * 1024,
    pingInterval: 10000,
    pingTimeout: 8000,
    serveClient: true,
    cors: opts.cors ? { origin: opts.cors } : undefined,
  });

  io.on('connection', (socket) => {
    let joined = false;
    const transport = {
      closed: false,
      send: (event, data) => socket.emit(event, data),
      sendVolatile: (event, data) => socket.volatile.emit(event, data),
      disconnect: () => socket.disconnect(true),
    };
    const helloTimer = setTimeout(() => {
      if (!joined) socket.disconnect(true);
    }, 15000);

    socket.once('hello', async (payload, ack) => {
      const res = await game.join(socket.id, payload, transport);
      if (typeof ack === 'function') ack(res);
      if (res.ok) {
        joined = true;
        clearTimeout(helloTimer);
        const s = game.players.get(socket.id);
        if (s && s.offlineEarned) {
          game.toast(s, `Your monsters earned ${s.offlineEarned} Money while you were away! Collect it at your base.`, 'good');
          s.offlineEarned = 0;
        }
      } else {
        setTimeout(() => socket.disconnect(true), 200);
      }
    });

    // client -> server messages: exactly the ones the game has handlers for
    // (anything else is ignored)
    for (const type of Object.keys(game.handlers)) {
      socket.on(type, (payload, ack) => {
        if (!joined) return;
        const res = game.handle(socket.id, type, payload);
        if (typeof ack === 'function') ack(res || { ok: true });
      });
    }

    socket.on('disconnect', () => {
      transport.closed = true;
      clearTimeout(helloTimer);
      if (joined) game.leave(socket.id);
    });
  });

  let timer = null;
  if (opts.autoTick !== false) {
    const step = 1000 / CONFIG.tickRate;
    let last = Date.now();
    timer = setInterval(() => {
      const t = Date.now();
      const dt = Math.min(200, t - last);
      last = t;
      try {
        game.tick(dt);
      } catch (e) {
        console.error('[game] tick error', e);
      }
    }, step);
  }

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port ?? 3000, opts.host ?? '0.0.0.0', resolve);
  });
  const port = httpServer.address().port;
  log(`STEAL A MONSTER server running on http://localhost:${port}`);
  for (const a of lanAddresses()) log(`  same Wi-Fi: http://${a}:${port}`);

  return {
    app,
    io,
    game,
    httpServer,
    port,
    async close() {
      if (timer) clearInterval(timer);
      io.close();
      await game.shutdown();
      await new Promise((r) => httpServer.close(() => r()));
    },
  };
}
