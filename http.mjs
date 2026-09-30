/** The portfolio runner enforces loopback endpoints and never follows redirects. */
export function assertLocalEndpoint(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw Object.assign(new Error('Only loopback demo endpoints are permitted'), { code: 'NON_LOCAL_ENDPOINT' });
  }
  return url;
}
export class HttpError extends Error {
  constructor(status, body, retryAfter) {
    super(`HTTP ${status}`);
    this.name = 'HttpError'; this.status = status;
    this.code = /^[A-Z][A-Z0-9_]{0,59}$/.test(body?.error?.code ?? '') ? body.error.code : `HTTP_${status}`;
    this.retryAfter = retryAfter;
  }
}
export class TransportError extends Error {
  constructor(code) { super(code); this.name = 'TransportError'; this.code = code; }
}
export class ResponseError extends Error {
  constructor(code) { super(code); this.name = 'ResponseError'; this.code = code; }
}
const transportError = error => new TransportError(['TimeoutError', 'AbortError'].includes(error?.name) ? 'TIMEOUT' : 'NETWORK_ERROR');
export function safeErrorCode(error) {
  return /^[A-Z][A-Z0-9_]{0,59}$/.test(error?.code ?? '') ? error.code : 'UNEXPECTED_ERROR';
}
export async function requestJSON(value, { timeoutMs = 10000, ...options } = {}) {
  const url = assertLocalEndpoint(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new RangeError('Invalid demo timeout');
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw transportError(error); }
  let body;
  try { body = await response.json(); }
  catch (error) {
    if (!response.ok) throw new HttpError(response.status, null, response.headers.get('retry-after'));
    if (error.name === 'SyntaxError') throw new ResponseError('INVALID_JSON');
    throw transportError(error);
  }
  if (!response.ok) throw new HttpError(response.status, body, response.headers.get('retry-after'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ResponseError('INVALID_RESPONSE');
  return body;
}
