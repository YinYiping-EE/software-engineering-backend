import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createApp} from '../src/app.js';
import {createHistoryStore} from '../src/history-store.js';

test('HTTP calculation, database persistence, pagination and deletion', async () => {
  const tempRoot = resolve(tmpdir());
  const testDirectory = mkdtempSync(join(tempRoot, 'calculator-api-test-'));
  const databasePath = join(testDirectory, 'history.sqlite');
  let store = createHistoryStore(databasePath);
  let server;
  let cookie = '';
  async function request(url, options = {}) {
    const response = await fetch(url, {...options,
      headers: {'X-Calculator-Request': '1', Cookie: cookie, ...options.headers}});
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  }
  async function start() {
    server = createApp(store, {sessionSecret: 'test-only-secret-'.repeat(4)}).listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server = null;
    store.close();
  }
  try {
    let base = await start();
    const response = await request(`${base}/api/calculations`, {
      method: 'POST', headers: {'Content-Type': 'application/json',
        'X-Forwarded-For': '8.8.8.8', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36'},
      body: JSON.stringify({expression: '(2+3)*4', client: {ip: '1.1.1.1', location: '伪造位置'}}),
    });
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.equal(saved.success, true);
    assert.equal(saved.result, '20');
    assert.ok(saved.id && saved.createdAt);
    assert.deepEqual(saved.client, {
      ip: '127.0.0.1', location: '本机访问', locationType: 'local',
      browser: 'Chrome', os: 'Windows', device: '电脑',
    });
    const invalid = await request(`${base}/api/calculations`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({expression: '1/0', result: '999'}),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).success, false);
    const malformed = await request(`${base}/api/calculations`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{broken',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await request(`${base}/api/calculations?limit=-1`)).status, 400);
    const history = await (await request(`${base}/api/calculations`)).json();
    assert.equal(history.total, 1);
    assert.equal(history.items[0].id, saved.id);
    await stop();
    store = createHistoryStore(databasePath);
    base = await start();
    const reopened = await (await request(`${base}/api/calculations`)).json();
    assert.equal(reopened.items[0].id, saved.id);
    assert.deepEqual(reopened.items[0].client, saved.client);
    assert.equal((await (await request(`${base}/api/calculations?limit=1&offset=1`)).json()).items.length, 0);
    assert.equal((await request(`${base}/api/calculations/${saved.id}`, {method: 'DELETE'})).status, 204);
    assert.equal((await request(`${base}/api/calculations/${saved.id}`, {method: 'DELETE'})).status, 404);
    assert.equal((await (await request(`${base}/api/calculations`)).json()).total, 0);
    await stop();
    store = createHistoryStore(databasePath);
    assert.equal(store.list().total, 0);
    store.close();
    store = null;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (store) store.close();
    // Only remove this test's freshly created directory, strictly inside the OS temp directory.
    const checkedPath = resolve(testDirectory);
    const child = relative(tempRoot, checkedPath);
    if (!child || child === '..' || child.startsWith(`..${sep}`) || child.includes(sep) ||
        !child.startsWith('calculator-api-test-')) throw new Error('Unsafe cleanup path');
    rmSync(checkedPath, {recursive: true, force: true});
  }
});
