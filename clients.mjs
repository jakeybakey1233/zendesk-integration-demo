import { requestJSON } from './http.mjs';
import { createClientAssertion } from './auth.mjs';

/** Mock-compatible Zendesk pagination client; accepts only pages on original host. */
export async function fetchTickets({ zendeskBase, username, apiToken }) {
  const origin = new URL(zendeskBase).origin;
  const header = Buffer.from(`${username}/token:${apiToken}`).toString('base64');
  let next = new URL('/zendesk/api/v2/tickets.json?page=1', origin).href;
  const tickets = [];
  const visited = new Set();
  while (next) {
    if (new URL(next).origin !== origin) throw new Error('Rejected cross-origin pagination URL');
    if (visited.has(next)) throw new Error('Detected pagination loop');
    visited.add(next);
    const page = await requestJSON(next, { headers: { Authorization: `Basic ${header}` } });
    if (!Array.isArray(page.tickets)) throw new Error('Invalid tickets response');
    tickets.push(...page.tickets);
    next = page.next_page;
  }
  return tickets;
}

/** Demonstration only; real provider credentials and scopes require adaptation. */
export async function getDemoBearerToken({ tokenEndpoint, privateKey, clientId, keyId }) {
  const assertion = createClientAssertion({ privateKey, clientId, audience: tokenEndpoint, keyId });
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion
  });
  const result = await requestJSON(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  if (!result.access_token) throw new Error('Authentication response had no access token');
  return result.access_token;
}

export async function sendTicket({ restletEndpoint, token, data }) {
  return requestJSON(restletEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `demo-${data.zendesk_id}` },
    body: JSON.stringify(data)
  });
}
