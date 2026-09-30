import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify, constants } from 'node:crypto';
import { createClientAssertion } from '../src/auth.mjs';
import { mapTicket } from '../src/transform.mjs';
import { startMockServer } from '../mock/server.mjs';
import { runSync } from '../src/sync.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
test('JWT client assertion is correctly signed using PS256 and expires after five minutes', () => {
  const assertion = createClientAssertion({ privateKey, clientId: 'demo-client', audience: 'https://local.invalid/token', now: 1000 });
  const [header, payload, signature] = assertion.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'PS256');
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()).exp, 1300);
  assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(signature, 'base64url')));
});
test('allowlisted mapping discards customer data and internal notes', () => {
  const mapped = mapTicket({ id: 2001, subject: 'Demo', status: 'open', priority: 'normal', requester_email: 'private@example.invalid', internal_note: 'PRIVATE' });
  assert.deepEqual(Object.keys(mapped), ['zendesk_id', 'subject', 'status', 'priority', 'updated_at']);
  assert.ok(!JSON.stringify(mapped).includes('private'));
});
test('end-to-end mock sync supports pagination, retry, and permanent errors', async () => {
  const mock = await startMockServer(publicKey);
  const events = [];
  try {
    const summary = await runSync({ zendeskBase: mock.base, username: 'demo-user', apiToken: 'demo-token', tokenEndpoint: `${mock.base}/oauth2/token`, restletEndpoint: `${mock.base}/netsuite/restlet`, clientId: 'demo-client', keyId: 'demo', privateKey }, line => events.push(JSON.parse(line)));
    assert.deepEqual(summary, { fetched: 4, sent: 3, failed: 1 });
    assert.deepEqual(mock.received.map(t => t.zendesk_id), [2001,2002,2003]);
    assert.equal(mock.attempts.get(2003), 2);
    assert.equal(events.find(e => e.event === 'ticket_failed').error, 'RECORD_NOT_FOUND');
    assert.equal(events.find(e => e.event === 'ticket_sent' && e.zendesk_id === 2003).attempts, 2);
    assert.ok(!events.some(e => JSON.stringify(e).includes('access-token')));
  } finally { await mock.close(); }
});
