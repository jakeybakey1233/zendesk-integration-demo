import { fetchTickets, getDemoBearerToken, sendTicket } from './clients.mjs';
import { mapTicket } from './transform.mjs';
import { HttpError } from './http.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function sendWithRetry(params, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return { result: await sendTicket(params), attempts: attempt }; }
    catch (error) {
      const retryable = error instanceof HttpError ? [429, 500, 502, 503, 504].includes(error.status) : false;
      if (!retryable || attempt === maxAttempts) throw error;
      await sleep(attempt * 40); // Short delay for local mock; use exponential backoff + jitter in production.
    }
  }
}

/** In this demo, all URLs are local. Never log auth tokens or raw ticket payloads. */
export async function runSync(config, log = console.log) {
  const logEvent = (event, details) => log(JSON.stringify({ event, ...details }));
  const tickets = await fetchTickets(config);
  logEvent('tickets_fetched', { count: tickets.length });
  const token = await getDemoBearerToken(config);
  logEvent('authenticated', { token_received: Boolean(token) });
  const summary = { fetched: tickets.length, sent: 0, failed: 0 };
  for (const raw of tickets) {
    try {
      const mapped = mapTicket(raw);
      const { result, attempts } = await sendWithRetry({ restletEndpoint: config.restletEndpoint, token, data: mapped });
      if (!result.success) throw new Error('Unexpected target response');
      summary.sent++;
      logEvent('ticket_sent', { zendesk_id: mapped.zendesk_id, destination_record_id: result.record_id, attempts });
    } catch (error) {
      summary.failed++;
      logEvent('ticket_failed', { zendesk_id: raw?.id ?? null, status: error.status ?? null, error: error.code ?? error.message });
    }
  }
  logEvent('sync_complete', summary);
  return summary;
}
