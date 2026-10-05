import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {mkdirSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createApp} from './app.js';
import {createHistoryStore} from './history-store.js';
import {createStatusReader} from './system-status.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const databasePath = process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH) :
    fileURLToPath(new URL('../.local/calculator.sqlite', import.meta.url));
const store = createHistoryStore(databasePath);
const production = process.env.NODE_ENV === 'production';
let sessionSecret = process.env.SESSION_SECRET;
if (production && (!sessionSecret || !process.env.PUBLIC_ORIGIN)) {
  throw new Error('Production requires SESSION_SECRET and PUBLIC_ORIGIN');
}
if (!sessionSecret) {
  const localDirectory = fileURLToPath(new URL('../.local/', import.meta.url));
  const secretPath = resolve(localDirectory, 'session-secret');
  mkdirSync(localDirectory, {recursive: true});
  if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString('hex'), {mode: 0o600, flag: 'wx'});
  sessionSecret = readFileSync(secretPath, 'utf8').trim();
}
const app = createApp(store, {trustProxy: process.env.TRUST_PROXY === 'loopback' ? 'loopback' : false,
  getStatus: createStatusReader({provider: production ? 'aliyun' : 'local'}),
  sessionSecret, secureCookies: production, publicOrigin: process.env.PUBLIC_ORIGIN});

const server = app.listen(port, host, () => {
  console.log(`API ready: http://${host}:${port}/api/health`);
});

server.on('error', (error) => {
  store.close();
  console.error(`API startup failed: ${error.code || error.message}`);
  process.exitCode = 1;
});

function shutdown() {
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
