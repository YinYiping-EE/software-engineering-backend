import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createStatusReader} from '../src/system-status.js';
import {createApp} from '../src/app.js';
import {createHistoryStore} from '../src/history-store.js';

test('status measures CPU deltas, memory availability and caches samples', () => {
  let timestamp = 10000;
  let calls = 0;
  const samples = [{cores: 2, idle: 100, total: 200}, {cores: 2, idle: 150, total: 300}, {cores: 2, idle: 250, total: 500}];
  const read = createStatusReader({provider: 'aliyun', now: () => timestamp,
    readCpu: () => { calls++; return samples.shift(); }, readMemory: () => ({total: 1000, available: 400}), readUptime: () => 456.9});
  const first = read();
  assert.deepEqual(first.cpu, {cores: 2, percent: 50});
  assert.deepEqual(first.memory, {totalBytes: 1000, usedBytes: 600, percent: 60});
  assert.equal(first.uptimeSeconds, 456);
  timestamp += 1000;
  assert.equal(read(), first);
  assert.equal(calls, 2);
  timestamp += 5000;
  assert.notEqual(read().sampledAt, first.sampledAt);
  assert.equal(calls, 3);
});

test('unavailable CPU measurements remain unknown; reclaimed memory is bounded', () => {
  const read = createStatusReader({readCpu: () => ({cores: 0, idle: 0, total: 0}),
    readMemory: () => ({total: 100, available: 200}), readUptime: () => 0});
  assert.equal(read().cpu.percent, null);
  assert.deepEqual(read().memory, {totalBytes: 100, usedBytes: 0, percent: 0});
});

test('public status has a minimal schema, checks SQLite and hides errors', async () => {
  const store = createHistoryStore(':memory:');
  const snapshot = {provider: 'aliyun', sampledAt: new Date().toISOString(), cpu: {cores: 2, percent: 12},
    memory: {totalBytes: 2000, usedBytes: 400, percent: 20}, uptimeSeconds: 60};
  const server = createApp(store, {sessionSecret: 'status-test-secret-'.repeat(3), getStatus: () => snapshot}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/status`;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), {success: true, status: 'online', ...snapshot});
    assert.equal(store.list().total, 0);
    assert.equal((await fetch(url, {headers: {Origin: 'https://foreign.example'}})).status, 403);
    store.close();
    const failed = await fetch(url);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), {success: false, message: '服务暂时不可用'});
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('status requests share the existing per-IP rate limit', async () => {
  const store = createHistoryStore(':memory:');
  const server = createApp(store, {sessionSecret: 'status-rate-secret-'.repeat(3), rateLimit: 2}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/status`;
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);
    const limited = await fetch(url);
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
