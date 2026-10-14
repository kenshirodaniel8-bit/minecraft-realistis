// STEAL A MONSTER — server entry point.
//
//   npm start                        -> http://localhost:3000
//   PORT=8080 npm start              -> another port
//   DATA_DIR=/var/lib/sam npm start  -> where player saves go (default ./data)
//   DEV_COMMANDS=1 npm start         -> enable /lucky, /money, /level, /night chat commands
//   EXPANSION_THRESHOLDS=2,4         -> players needed to open Bloomveil / Starfall Isle

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './server/network.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const thresholds = env.EXPANSION_THRESHOLDS ? env.EXPANSION_THRESHOLDS.split(',').map((v) => Number(v.trim())) : undefined;

const srv = await createGameServer({
  port: Number(env.PORT) || 3000,
  host: env.HOST || '0.0.0.0',
  dataDir: env.DATA_DIR || path.join(root, 'data'),
  devCommands: env.DEV_COMMANDS === '1',
  dev: env.NODE_ENV !== 'production',
  expansionThresholds: thresholds,
  env,
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal}: saving all players...`);
  try {
    await srv.close();
    console.log('Saved. Bye!');
    process.exit(0);
  } catch (e) {
    console.error('Error while shutting down', e);
    process.exit(1);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
