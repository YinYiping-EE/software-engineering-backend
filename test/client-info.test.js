import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeIp, locateIp, describeAgent} from '../src/client-info.js';
import {createApp} from '../src/app.js';
import {createHistoryStore} from '../src/history-store.js';

test('normalizes IPv4, IPv6 and rejects invalid addresses', () => {
  assert.equal(normalizeIp('::ffff:192.168.1.8'), '192.168.1.8');
  assert.equal(normalizeIp('2001:4860:4860::8888'), '2001:4860:4860::8888');
  assert.equal(normalizeIp('not-an-ip'), '');
});

test('local and private networks bypass geolocation', () => {
  const noLookup = () => { throw new Error('Local address must not be looked up'); };
  for (const ip of ['127.0.0.1', '127.0.0.2', '::1']) assert.equal(locateIp(ip, noLookup).locationType, 'local');
  for (const ip of ['10.0.0.1', '172.16.1.1', '192.168.1.1', '100.64.1.1', '169.254.1.1', 'fc00::1', 'fe80::1']) {
    assert.equal(locateIp(ip, noLookup).locationType, 'private');
  }
  assert.equal(locateIp('', noLookup).locationType, 'unknown');
});

test('public geolocation is explicitly estimated and missing data is honest', () => {
  assert.deepEqual(locateIp('8.8.8.8', () => ({country: 'US', region: 'CA', city: 'Mountain View'})), {
    location: '美国 · CA · Mountain View', locationType: 'estimated',
  });
  assert.deepEqual(locateIp('8.8.8.8', () => null), {location: '归属地未知', locationType: 'unknown'});
  // Smoke-test bundled offline data without sending any network request.
  const actual = locateIp('8.8.8.8');
  assert.equal(actual.locationType, 'estimated');
  assert.ok(actual.location.includes('美国'));
});

test('browser and device labels cover desktop, mobile, tablet and unknown clients', () => {
  assert.deepEqual(describeAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0'), {
    browser: 'Edge', os: 'Windows', device: '电脑',
  });
  assert.deepEqual(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15 Safari/604.1'), {
    browser: 'Safari', os: 'iOS', device: '手机',
  });
  assert.equal(describeAgent('Mozilla/5.0 (Linux; Android 13) Chrome/130.0 Safari/537.36').device, '平板');
  assert.equal(describeAgent('Mozilla/5.0 (Linux; Android 13) Mobile Chrome/130.0').device, '手机');
  assert.deepEqual(describeAgent(''), {browser: '未知浏览器', os: '未知系统', device: '未知设备'});
});

test('proxy is trusted only when explicitly enabled and selects the nearest untrusted hop', async () => {
  const store = createHistoryStore(':memory:');
  const server = createApp(store, {trustProxy: 'loopback'}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/calculations`, {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-Calculator-Request': '1', 'X-Forwarded-For': '8.8.8.8, 192.168.1.9'},
      body: JSON.stringify({expression: '1+1'}),
    });
    assert.equal(response.status, 201);
    const {client} = await response.json();
    assert.equal(client.ip, '192.168.1.9');
    assert.equal(client.locationType, 'private');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});

test('old SQLite schema migrates in place without fabricating past sources', () => {
  const tempRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(tempRoot, 'calculator-migration-test-'));
  const path = join(directory, 'old.sqlite');
  let store;
  try {
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE calculations (id TEXT PRIMARY KEY, expression TEXT NOT NULL,
      result TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO calculations VALUES ('old-id', '3+4', '7', '2026-10-01T01:00:00.000Z');`);
    old.close();
    store = createHistoryStore(path);
    assert.deepEqual({...store.list().items[0]}, {
      id: 'old-id', expression: '3+4', result: '7', createdAt: '2026-10-01T01:00:00.000Z', client: null,
    });
    const client = {ip: '::1', ...locateIp('::1'), ...describeAgent('')};
    const saved = store.save({expression: '5+6', result: '11'}, client);
    store.close();
    store = createHistoryStore(path);
    assert.equal(store.list().total, 2);
    assert.deepEqual(store.list().items.find((item) => item.id === saved.id).client, client);
    assert.equal(store.list().items.find((item) => item.id === 'old-id').result, '7');
  } finally {
    store?.close();
    const checkedPath = resolve(directory);
    const child = relative(tempRoot, checkedPath);
    if (!child || child === '..' || child.startsWith(`..${sep}`) || child.includes(sep) ||
        !child.startsWith('calculator-migration-test-')) throw new Error('Unsafe cleanup path');
    rmSync(checkedPath, {recursive: true, force: true});
  }
});
