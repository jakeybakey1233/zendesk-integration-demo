import { createHash } from 'node:crypto';
import { requestJSON, assertLocalEndpoint, ResponseError } from './http.mjs';
import { createClientAssertion } from './auth.mjs';

export async function fetchTickets({ zendeskBase, username, apiToken, timeoutMs }) {
  const origin = assertLocalEndpoint(zendeskBase).origin;
  const header = Buffer.from(`${username}/token:${apiToken}`).toString('base64');
  let next = new URL('/api/v2/tickets.json?page=1', origin).href;
  const tickets = [];
  const visited = new Set();
  while (next) {
    const pageURL = assertLocalEndpoint(next);
    if (pageURL.origin !== origin || pageURL.pathname !== '/api/v2/tickets.json') throw new ResponseError('UNSAFE_PAGINATION');
    if (visited.has(pageURL.href)) throw new ResponseError('PAGINATION_LOOP');
    if (visited.size >= 100) throw new ResponseError('PAGE_LIMIT_EXCEEDED');
    visited.add(pageURL.href);
    const page = await requestJSON(pageURL, { headers: { Authorization: `Basic ${header}` }, timeoutMs });
    if (!Array.isArray(page.tickets) || (page.next_page != null && typeof page.next_page !== 'string')) throw new ResponseError('INVALID_TICKETS');
    tickets.push(...page.tickets);
    next = page.next_page ?? null;
  }
  return tickets;
}
export async function getDemoBearerToken({ tokenEndpoint, privateKey, clientId, keyId, timeoutMs }) {
  assertLocalEndpoint(tokenEndpoint);
  const assertion = createClientAssertion({ privateKey, clientId, audience: tokenEndpoint, keyId });
  const form = new URLSearchParams({ grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion });
  const result = await requestJSON(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, timeoutMs });
  if (typeof result.access_token !== 'string' || !result.access_token) throw new ResponseError('INVALID_TOKEN_RESPONSE');
  return result.access_token;
}
export function idempotencyKey(data) {
  return `demo-${data.zendesk_id}-${createHash('sha256').update(JSON.stringify(data)).digest('hex')}`;
}
export async function sendTicket({ restletEndpoint, token, data, timeoutMs }) {
  return requestJSON(restletEndpoint, { method: 'POST', timeoutMs,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey(data) }, body: JSON.stringify(data) });
}
