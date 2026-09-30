import http from 'node:http';
import { verify, constants } from 'node:crypto';

/** Fake tickets, fake auth server, fake RESTlet. It never contacts real services. */
const tickets = [
  { id: 2001, subject: 'Example scheduling query', status: 'open', priority: 'normal', updated_at: '2026-09-16T09:00:00Z', requester_email: 'dummy@example.invalid' },
  { id: 2002, subject: 'Example knowledge-base update', status: 'pending', priority: 'low', updated_at: '2026-09-16T10:00:00Z', internal_note: 'DO NOT INCLUDE THIS' },
  { id: 2003, subject: 'Example transient server response', status: 'open', priority: 'high', updated_at: '2026-09-16T11:00:00Z' },
  { id: 2004, subject: 'Example missing destination record', status: 'open', priority: 'normal', updated_at: '2026-09-16T12:00:00Z' }
];
function respond(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
async function readRequest(req) { let body = ''; for await (const part of req) body += part; return body; }
export async function startMockServer(publicKey) {
  const attempts = new Map();
  const received = [];
  let base = '';
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, base);
      if (req.method === 'GET' && path.pathname === '/zendesk/api/v2/tickets.json') {
        const expected = `Basic ${Buffer.from('demo-user/token:demo-token').toString('base64')}`;
        if (req.headers.authorization !== expected) return respond(res, 401, { error: { code: 'UNAUTHORISED' } });
        const page = Number(path.searchParams.get('page') || 1);
        return respond(res, 200, { tickets: page === 1 ? tickets.slice(0, 2) : page === 2 ? tickets.slice(2) : [], next_page: page === 1 ? `${base}/zendesk/api/v2/tickets.json?page=2` : null });
      }
      if (req.method === 'POST' && path.pathname === '/oauth2/token') {
        const form = new URLSearchParams(await readRequest(req));
        const jwt = form.get('client_assertion') || '';
        const parts = jwt.split('.');
        if (parts.length !== 3) return respond(res, 401, { error: { code: 'BAD_ASSERTION' } });
        const signedMessage = Buffer.from(`${parts[0]}.${parts[1]}`);
        const valid = verify('sha256', signedMessage, { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(parts[2], 'base64url'));
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!valid || claims.aud !== `${base}/oauth2/token` || claims.iss !== 'demo-client' || claims.exp < Date.now() / 1000 || form.get('grant_type') !== 'client_credentials') return respond(res, 401, { error: { code: 'BAD_ASSERTION' } });
        return respond(res, 200, { access_token: 'local-demo-access-token', token_type: 'Bearer', expires_in: 300 });
      }
      if (req.method === 'POST' && path.pathname === '/netsuite/restlet') {
        if (req.headers.authorization !== 'Bearer local-demo-access-token') return respond(res, 401, { error: { code: 'UNAUTHORISED' } });
        const data = JSON.parse(await readRequest(req));
        if (Object.keys(data).some(key => !['zendesk_id','subject','status','priority','updated_at'].includes(key))) return respond(res, 400, { error: { code: 'UNEXPECTED_FIELD' } });
        const count = (attempts.get(data.zendesk_id) ?? 0) + 1;
        attempts.set(data.zendesk_id, count);
        if (data.zendesk_id === 2003 && count === 1) return respond(res, 503, { error: { code: 'TEMPORARY_FAILURE' } });
        if (data.zendesk_id === 2004) return respond(res, 400, { error: { code: 'RECORD_NOT_FOUND' } });
        received.push(data);
        return respond(res, 200, { success: true, record_id: `EXAMPLE-${data.zendesk_id}` });
      }
      return respond(res, 404, { error: { code: 'NOT_FOUND' } });
    } catch { return respond(res, 400, { error: { code: 'BAD_REQUEST' } }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, received, attempts, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
