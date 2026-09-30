import { fetchTickets, getDemoBearerToken, sendTicket } from './clients.mjs';
import { mapTicket } from './transform.mjs';
import { HttpError, TransportError, ResponseError, assertLocalEndpoint, safeErrorCode } from './http.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function retryAfterMilliseconds(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}
export async function sendWithRetry(params, {
  maxAttempts = 3, baseDelayMs = 40, maxDelayMs = 30000,
  sleep = wait, random = Math.random, now = Date.now, onRetry = () => {}
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || baseDelayMs < 0 || maxDelayMs < baseDelayMs) throw new RangeError('Invalid retry policy');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return { result: await sendTicket(params), attempts: attempt }; }
    catch (error) {
      error.attempts = attempt;
      const retryable = error instanceof TransportError || (error instanceof HttpError && [429, 500, 502, 503, 504].includes(error.status));
      if (!retryable || attempt === maxAttempts) throw error;
      const serverDelay = error instanceof HttpError ? retryAfterMilliseconds(error.retryAfter, now()) : null;
      const delay = serverDelay ?? Math.floor(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * random());
      // Do not retry sooner than Retry-After. Surface waits outside the demo budget instead.
      if (delay > maxDelayMs) throw error;
      onRetry({ attempt, delay_ms: delay, status: error.status ?? null, error: safeErrorCode(error) });
      await sleep(delay);
    }
  }
}
export async function runSync(config, log = console.log) {
  const origins = [config.zendeskBase, config.tokenEndpoint, config.restletEndpoint].map(value => assertLocalEndpoint(value).origin);
  if (new Set(origins).size !== 1) throw Object.assign(new Error('Use a single local mock server'), { code: 'MIXED_DEMO_ORIGINS' });
  const logEvent = (event, details) => log(JSON.stringify({ event, ...details }));
  const tickets = await fetchTickets(config);
  logEvent('tickets_fetched', { count: tickets.length });
  const token = await getDemoBearerToken(config);
  logEvent('authenticated', { token_received: true });
  const summary = { fetched: tickets.length, sent: 0, failed: 0 };
  for (const raw of tickets) {
    try {
      const data = mapTicket(raw);
      const { result, attempts } = await sendWithRetry({ restletEndpoint: config.restletEndpoint, token, data, timeoutMs: config.timeoutMs },
        { ...config.retry, onRetry: details => logEvent('ticket_retry', { zendesk_id: data.zendesk_id, ...details }) });
      if (result.success !== true || typeof result.record_id !== 'string') throw new ResponseError('INVALID_TARGET_RESPONSE');
      summary.sent++;
      logEvent('ticket_sent', { zendesk_id: data.zendesk_id, destination_record_id: result.record_id, action: result.action, replayed: result.replayed === true, attempts });
    } catch (error) {
      summary.failed++;
      logEvent('ticket_failed', { zendesk_id: Number.isSafeInteger(raw?.id) ? raw.id : null, status: error.status ?? null,
        error: safeErrorCode(error), attempts: error.attempts ?? 0 });
    }
  }
  logEvent('sync_complete', summary);
  return summary;
}
