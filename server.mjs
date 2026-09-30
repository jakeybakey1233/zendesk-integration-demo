import http from 'node:http';
import { verify, constants, createHash } from 'node:crypto';
import { createLocalRestlet } from './netsuite-adapter.mjs';
export const exampleTickets = [
  { id: 2001, subject: 'Example scheduling query', status: 'open', priority: 'normal', updated_at: '2026-09-16T09:00:00Z', requester_email: 'dummy@example.invalid' },
  { id: 2002, subject: 'Example knowledge-base update', status: 'pending', priority: 'low', updated_at: '2026-09-16T10:00:00Z', internal_note: 'DO NOT INCLUDE THIS' },
  { id: 2003, subject: 'Example transient server response', status: 'open', priority: 'high', updated_at: '2026-09-16T11:00:00Z' },
  { id: 2004, subject: 'Example permanent destination failure', status: 'open', priority: 'normal', updated_at: '2026-09-16T12:00:00Z' }
];
function respond(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(data)); }
async function readRequest(req) {
  let body = '';
  for await (const part of req) { body += part; if (Buffer.byteLength(body) > 65536) throw Object.assign(new Error('Too large'), { code: 'PAYLOAD_TOO_LARGE' }); }
  return body;
}
export async function startMockServer(publicKey, { tickets = exampleTickets, scenarios = { 2003: 'transient', 2004: 'permanent' } } = {}) {
  const attempts = new Map();
  const receipts = new Map();
  const received = [];
  const target = createLocalRestlet();
  let base = '';
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base);
      if (req.method === 'GET' && url.pathname === '/api/v2/tickets.json') {
        const expected = `Basic ${Buffer.from('demo-user/token:demo-token').toString('base64')}`;
        if (req.headers.authorization !== expected) return respond(res, 401, { error: { code: 'UNAUTHORISED' } });
        const page = Number(url.searchParams.get('page') || 1);
        const start = (page - 1) * 2;
        return respond(res, 200, { tickets: tickets.slice(start, start + 2), next_page: start + 2 < tickets.length ? `${base}/api/v2/tickets.json?page=${page + 1}` : null });
      }
      if (req.method === 'POST' && url.pathname === '/services/rest/auth/oauth2/v1/token') {
        const form = new URLSearchParams(await readRequest(req));
        const parts = (form.get('client_assertion') || '').split('.');
        if (parts.length !== 3) return respond(res, 401, { error: { code: 'BAD_ASSERTION' } });
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        const valid = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(parts[2], 'base64url'));
        const now = Date.now() / 1000;
        if (!valid || header.alg !== 'PS256' || header.typ !== 'JWT' || !header.kid || claims.aud !== `${base}/services/rest/auth/oauth2/v1/token` || claims.iss !== 'demo-client' || claims.scope !== 'restlets' || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) || claims.exp <= now || claims.iat > now + 60 || claims.exp <= claims.iat || claims.exp - claims.iat > 300 || form.get('grant_type') !== 'client_credentials' || form.get('client_assertion_type') !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') {
          return respond(res, 401, { error: { code: 'BAD_ASSERTION' } });
        }
        return respond(res, 200, { access_token: 'local-demo-access-token', token_type: 'Bearer', expires_in: 300 });
      }
      if (req.method === 'POST' && url.pathname === '/app/site/hosting/restlet.nl') {
        if (req.headers.authorization !== 'Bearer local-demo-access-token') return respond(res, 401, { error: { code: 'UNAUTHORISED' } });
        const data = JSON.parse(await readRequest(req));
        const count = (attempts.get(data.zendesk_id) ?? 0) + 1;
        attempts.set(data.zendesk_id, count);
        const key = req.headers['idempotency-key'];
        if (!key || key.length > 150) return respond(res, 400, { error: { code: 'MISSING_IDEMPOTENCY_KEY' } });
        const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex');
        const prior = receipts.get(key);
        if (prior) {
          if (prior.digest !== digest) return respond(res, 409, { error: { code: 'IDEMPOTENCY_CONFLICT' } });
          return respond(res, 200, { ...prior.result, replayed: true });
        }
        const scenario = scenarios[data.zendesk_id];
        if (scenario === 'always-fail' || (scenario === 'transient' && count === 1)) return respond(res, 503, { error: { code: 'TEMPORARY_FAILURE' } });
        if (scenario === 'rate-limit' && count === 1) return respond(res, 429, { error: { code: 'RATE_LIMITED' } }, { 'Retry-After': '2' });
        if (scenario === 'permanent') return respond(res, 400, { error: { code: 'RECORD_NOT_FOUND' } });
        if (scenario === 'invalid-json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{broken'); }
        const result = JSON.parse(JSON.stringify(target.post(data)));
        receipts.set(key, { digest, result });
        received.push(data);
        if (scenario === 'lost-response' && count === 1) return req.socket.destroy();
        return respond(res, 200, result);
      }
      return respond(res, 404, { error: { code: 'NOT_FOUND' } });
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]{0,59}$/.test(error.code ?? '') ? error.code : 'BAD_REQUEST';
      return respond(res, code === 'VERSION_CONFLICT' ? 409 : 400, { error: { code } });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, received, attempts, target, receipts,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
