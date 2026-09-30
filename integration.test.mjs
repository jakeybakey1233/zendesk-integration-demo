import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync, verify, constants } from 'node:crypto';
import { createClientAssertion } from '../src/auth.mjs';
import { mapTicket } from '../src/transform.mjs';
import { fetchTickets, sendTicket, idempotencyKey } from '../src/clients.mjs';
import { requestJSON, HttpError, TransportError } from '../src/http.mjs';
import { runSync, retryAfterMilliseconds, sendWithRetry } from '../src/sync.mjs';
import { startMockServer } from '../mock/server.mjs';
import { createLocalRestlet } from '../mock/netsuite-adapter.mjs';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const ticket = (id = 3001) => ({ id, subject: 'Fictional query', status: 'open', priority: 'normal', updated_at: '2026-09-24T09:00:00Z' });
const config = mock => ({ zendeskBase: mock.base, username: 'demo-user', apiToken: 'demo-token',
  tokenEndpoint: `${mock.base}/services/rest/auth/oauth2/v1/token`, restletEndpoint: `${mock.base}/app/site/hosting/restlet.nl?script=demo&deploy=1`,
  clientId: 'demo-client', keyId: 'demo', privateKey, retry: { sleep: async () => {}, random: () => 0.5 } });
async function withMock(options, fn) { const mock = await startMockServer(publicKey, options); try { return await fn(mock); } finally { await mock.close(); } }
const eventsFor = async (mock, overrides = {}) => {
  const events = [];
  const summary = await runSync({ ...config(mock), ...overrides }, line => events.push(JSON.parse(line)));
  return { summary, events };
};
test('PS256 assertion has a verifiable signature, claims and five-minute expiry', () => {
  const [header, payload, signature] = createClientAssertion({ privateKey, clientId: 'demo-client', audience: 'https://local.invalid/token', now: 1000 }).split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'PS256');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.exp, 1300); assert.equal(claims.iat, 1000); assert.equal(claims.scope, 'restlets');
  assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(signature, 'base64url')));
  assert.equal(verify('sha256', Buffer.from(`${header}.${payload}tampered`), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(signature, 'base64url')), false);
});
test('mapping selects known fields, normalises time and excludes private extras', () => {
  const data = mapTicket({ ...ticket(), requester_email: 'private@example.invalid', internal_note: 'PRIVATE' });
  assert.deepEqual(Object.keys(data), ['zendesk_id', 'subject', 'status', 'priority', 'updated_at']);
  assert.equal(data.updated_at, '2026-09-24T09:00:00.000Z');
  assert.equal(JSON.stringify(data).includes('PRIVATE'), false);
  for (const invalid of [{ ...ticket(), id: -1 }, { ...ticket(), subject: '' }, { ...ticket(), updated_at: 'bad' }, { ...ticket(), status: 'invalid' }]) assert.throws(() => mapTicket(invalid), { code: 'INVALID_TICKET' });
});
test('complete sync paginates, retries 503 and isolates a permanent failure', async () => withMock({}, async mock => {
  const { summary, events } = await eventsFor(mock);
  assert.deepEqual(summary, { fetched: 4, sent: 3, failed: 1 });
  assert.deepEqual(mock.received.map(t => t.zendesk_id), [2001, 2002, 2003]);
  assert.equal(mock.target.writes, 3); assert.equal(mock.attempts.get(2003), 2); assert.equal(mock.attempts.get(2004), 1);
  assert.equal(events.find(e => e.event === 'ticket_failed').error, 'RECORD_NOT_FOUND');
  const logs = JSON.stringify(events);
  for (const secret of ['demo-token', 'local-demo-access-token', 'requester_email', 'DO NOT INCLUDE THIS', 'PRIVATE KEY']) assert.equal(logs.includes(secret), false);
}));
test('replaying a sync does not create records or repeat destination writes', async () => withMock({}, async mock => {
  await eventsFor(mock);
  const { events } = await eventsFor(mock);
  assert.equal(mock.target.records.size, 3); assert.equal(mock.target.writes, 3);
  assert.ok(events.filter(e => e.event === 'ticket_sent').every(e => e.replayed));
}));
test('a response lost after commit is retried without a duplicate write', async () => withMock({ tickets: [ticket()], scenarios: { 3001: 'lost-response' } }, async mock => {
  const { summary, events } = await eventsFor(mock);
  assert.deepEqual(summary, { fetched: 1, sent: 1, failed: 0 });
  assert.equal(mock.attempts.get(3001), 2); assert.equal(mock.target.records.size, 1); assert.equal(mock.target.writes, 1);
  assert.equal(events.find(e => e.event === 'ticket_sent').replayed, true);
  assert.equal(events.find(e => e.event === 'ticket_retry').error, 'NETWORK_ERROR');
}));
test('429 Retry-After is respected using an injected clock-independent wait', async () => withMock({ tickets: [ticket()], scenarios: { 3001: 'rate-limit' } }, async mock => {
  const waits = [];
  await eventsFor(mock, { retry: { sleep: async ms => waits.push(ms), random: () => 0 } });
  assert.deepEqual(waits, [2000]); assert.equal(mock.target.writes, 1);
}));
test('retry exhaustion is bounded and does not prevent the next valid ticket', async () => withMock({ tickets: [ticket(), ticket(3002)], scenarios: { 3001: 'always-fail' } }, async mock => {
  const { summary, events } = await eventsFor(mock);
  assert.deepEqual(summary, { fetched: 2, sent: 1, failed: 1 });
  assert.equal(mock.attempts.get(3001), 3);
  assert.equal(events.find(e => e.event === 'ticket_failed').attempts, 3);
}));
test('malformed successful JSON is reported and not retried as a transient status', async () => withMock({ tickets: [ticket()], scenarios: { 3001: 'invalid-json' } }, async mock => {
  const { events } = await eventsFor(mock);
  assert.equal(events.find(e => e.event === 'ticket_failed').error, 'INVALID_JSON');
  assert.equal(mock.attempts.get(3001), 1);
}));
test('idempotency keys change for a new source version', () => {
  const mapped = mapTicket(ticket());
  assert.equal(idempotencyKey(mapped), idempotencyKey({ ...mapped }));
  assert.notEqual(idempotencyKey(mapped), idempotencyKey({ ...mapped, updated_at: '2026-09-25T09:00:00.000Z' }));
});
test('server rejects a reused idempotency key with a different payload', async () => withMock({ tickets: [], scenarios: {} }, async mock => {
  const data = mapTicket(ticket());
  const options = { method: 'POST', headers: { Authorization: 'Bearer local-demo-access-token', 'Content-Type': 'application/json', 'Idempotency-Key': 'same-key' } };
  await requestJSON(config(mock).restletEndpoint, { ...options, body: JSON.stringify(data) });
  await assert.rejects(requestJSON(config(mock).restletEndpoint, { ...options, body: JSON.stringify({ ...data, subject: 'Changed' }) }), { code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  assert.equal(mock.target.writes, 1);
}));
test('the SuiteScript handler creates, ignores replays and updates the same record', () => {
  const target = createLocalRestlet();
  const mapped = mapTicket(ticket());
  const first = target.post(mapped);
  assert.equal(first.action, 'created');
  assert.equal(target.post(mapped).action, 'unchanged');
  assert.equal(target.writes, 1);
  const updated = target.post({ ...mapped, status: 'solved', updated_at: '2026-09-25T09:00:00.000Z' });
  assert.equal(updated.action, 'updated'); assert.equal(updated.record_id, first.record_id);
  assert.equal(target.records.size, 1); assert.equal(target.writes, 2);
});
test('SuiteScript rejects unexpected fields and conflicting versions; stale events cannot overwrite', () => {
  const target = createLocalRestlet(); const mapped = mapTicket(ticket());
  assert.throws(() => target.post({ ...mapped, private_note: 'SECRET' }), { code: 'UNEXPECTED_FIELD' });
  target.post(mapped);
  assert.throws(() => target.post({ ...mapped, subject: 'Changed without a new timestamp' }), { code: 'VERSION_CONFLICT' });
  assert.equal(target.post({ ...mapped, updated_at: '2026-09-23T09:00:00.000Z' }).action, 'ignored');
  assert.equal(target.writes, 1);
});
test('Retry-After supports seconds and HTTP dates, and ignores malformed values', () => {
  assert.equal(retryAfterMilliseconds('3'), 3000);
  assert.equal(retryAfterMilliseconds('Wed, 30 Sep 2026 12:00:02 GMT', Date.parse('2026-09-30T12:00:00Z')), 2000);
  assert.equal(retryAfterMilliseconds('Wed, 30 Sep 2026 11:00:00 GMT', Date.parse('2026-09-30T12:00:00Z')), 0);
  assert.equal(retryAfterMilliseconds('nonsense'), null);
});
async function withHTTP(handler, fn) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('pagination loops and cross-origin next pages are rejected before following', async () => {
  for (const mode of ['loop', 'cross-origin']) {
    let calls = 0;
    await withHTTP((req, res) => { calls++; const base = `http://127.0.0.1:${req.socket.localPort}`;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ tickets: [], next_page: mode === 'loop' ? `${base}/api/v2/tickets.json?page=1` : 'http://127.0.0.1:1/api/v2/tickets.json?page=2' }));
    }, async base => {
      await assert.rejects(fetchTickets({ zendeskBase: base, username: 'dummy', apiToken: 'dummy' }), { code: mode === 'loop' ? 'PAGINATION_LOOP' : 'UNSAFE_PAGINATION' });
      assert.equal(calls, 1);
    });
  }
});
test('HTTP redirects are rejected, including same-origin redirects', async () => {
  let redirected = 0;
  await withHTTP((req, res) => { if (req.url === '/redirected') { redirected++; res.end('{}'); } else { res.writeHead(302, { Location: '/redirected' }); res.end(); } }, async base => {
    await assert.rejects(requestJSON(base), { code: 'NETWORK_ERROR' }); assert.equal(redirected, 0);
  });
});
test('a timed-out request is classified without logging its raw error', async () => {
  await withHTTP(() => {}, async base => { await assert.rejects(requestJSON(base, { timeoutMs: 15 }), { code: 'TIMEOUT' }); });
});
test('excessive Retry-After stops rather than retrying too early', async () => {
  let calls = 0;
  await withHTTP((req,res) => { calls++; res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }); res.end('{"error":{"code":"RATE_LIMITED"}}'); }, async base => {
    await assert.rejects(sendWithRetry({ restletEndpoint: base, token: 'dummy', data: mapTicket(ticket()) }, { maxDelayMs: 1000, sleep: async () => assert.fail('Should not wait or retry') }), { status: 429 });
    assert.equal(calls, 1);
  });
});
test('non-loopback endpoints are rejected before a network request is made', async () => {
  await assert.rejects(requestJSON('https://example.invalid'), { code: 'NON_LOCAL_ENDPOINT' });
  await assert.rejects(sendTicket({ restletEndpoint: 'https://example.invalid', token: 'dummy', data: mapTicket(ticket()) }), { code: 'NON_LOCAL_ENDPOINT' });
});
