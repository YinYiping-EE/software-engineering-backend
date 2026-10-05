import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../src/app.js';
import {createHistoryStore} from '../src/history-store.js';

async function fixture(options, run) {
  const store = createHistoryStore(':memory:');
  const server = createApp(store, {sessionSecret: 'isolated-test-secret-'.repeat(3), ...options}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base, store); }
  finally { await new Promise((resolve) => server.close(resolve)); store.close(); }
}
const jsonHeaders = {'Content-Type': 'application/json', 'X-Calculator-Request': '1'};
const post = (base, expression, headers = {}) => fetch(`${base}/api/calculations`, {
  method: 'POST', headers: {...jsonHeaders, ...headers}, body: JSON.stringify({expression}),
});

test('browser histories are isolated; forged sessions and foreign record IDs grant no access', async () => {
  await fixture({secureCookies: true}, async (base, store) => {
    store.save({expression: '3+4', result: '7'}); // Legacy data stays on disk, private from public routes.
    const savedResponse = await post(base, '2+3');
    assert.equal(savedResponse.status, 201);
    const saved = await savedResponse.json();
    const setCookie = savedResponse.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly; SameSite=Strict; Secure/);
    const cookie = setCookie.split(';')[0];
    assert.equal((await (await fetch(`${base}/api/calculations`, {headers: {Cookie: cookie}})).json()).total, 1);
    const stranger = await fetch(`${base}/api/calculations`);
    assert.equal((await stranger.json()).total, 0);
    const foreignCookie = stranger.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/calculations/${saved.id}`, {
      method: 'DELETE', headers: {...jsonHeaders, Cookie: foreignCookie},
    })).status, 404);
    for (const forged of [cookie.slice(0, -1) + '!', cookie.replace(/=[^.]+/, '=00000000-0000-0000-0000-000000000000'),
      cookie.replace(/\.[^.]+$/, '.' + 'é'.repeat(43)), 'calculator_session=broken']) {
      if (forged === cookie) continue;
      assert.equal((await (await fetch(`${base}/api/calculations`, {headers: {Cookie: forged}})).json()).total, 0);
    }
    assert.equal(store.list().total, 2);
    assert.equal((await fetch(`${base}/api/calculations/${saved.id}`, {
      method: 'DELETE', headers: {...jsonHeaders, Cookie: cookie},
    })).status, 204);
    assert.equal(store.list().total, 1);
  });
});

test('cross-site, missing request marker and non-JSON writes are rejected before storage', async () => {
  await fixture({}, async (base, store) => {
    assert.equal((await post(base, '1+1', {Origin: 'https://attacker.invalid'})).status, 403);
    assert.equal((await post(base, '1+1', {'Sec-Fetch-Site': 'cross-site'})).status, 403);
    assert.equal((await post(base, '1+1', {'X-Calculator-Request': ''})).status, 403);
    assert.equal((await post(base, '1+1', {'Content-Type': 'text/plain'})).status, 415);
    const response = await post(base, '1+1', {Origin: base});
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(store.list().total, 1);
  });
});

test('code, SQL, HTML, malformed and excessive bodies cannot enter saved history', async () => {
  await fixture({}, async (base, store) => {
    for (const expression of ['process.exit()', "1; DROP TABLE calculations; --", '<img src=x onerror=alert(1)>',
      '1/0', '9'.repeat(201), '('.repeat(99) + '1' + ')'.repeat(99) + 'x']) {
      const response = await post(base, expression);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).success, false);
    }
    assert.equal((await fetch(`${base}/api/calculations`, {method: 'POST', headers: jsonHeaders, body: '{invalid'})).status, 400);
    assert.equal((await post(base, 'x'.repeat(4096))).status, 413);
    for (const query of ['limit=1&limit=2', 'offset=9007199254740992', 'offset=1000001', 'limit[bad]=1']) {
      assert.equal((await fetch(`${base}/api/calculations?${query}`)).status, 400);
    }
    assert.equal(store.list().total, 0);
    assert.equal((await post(base, '(1+2)*3')).status, 201);
  });
});

test('rate limit cannot be bypassed by changing cookies or spoofing forwarding headers', async () => {
  await fixture({rateLimit: 20, writeLimit: 2}, async (base, store) => {
    assert.equal((await post(base, '1+1')).status, 201);
    assert.equal((await post(base, '2+2', {'X-Forwarded-For': '8.8.8.8'})).status, 201);
    const limited = await post(base, '3+3', {'X-Forwarded-For': '1.1.1.1'});
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal(store.list().total, 2);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});
