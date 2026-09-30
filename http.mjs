export class HttpError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status}${body?.error?.code ? `: ${body.error.code}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.code = body?.error?.code ?? null;
    this.url = url;
  }
}
export async function requestJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new HttpError(response.status, body, new URL(url).pathname);
  if (body === null) throw new Error('API returned invalid JSON');
  return body;
}
