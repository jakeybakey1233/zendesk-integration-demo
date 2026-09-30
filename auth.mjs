import { sign, constants } from 'node:crypto';

/**
 * Generate a demonstration PS256 client assertion. A real service must adapt
 * claims, key storage, endpoint URLs and auth flow to the vendor's documentation.
 */
export function createClientAssertion({ privateKey, clientId, audience, keyId = 'ephemeral-demo', now = Math.floor(Date.now() / 1000) }) {
  if (!privateKey || !clientId || !audience) throw new Error('Missing required JWT signing inputs');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'PS256', typ: 'JWT', kid: keyId });
  const payload = encode({ iss: clientId, sub: clientId, aud: audience, scope: 'restlets', iat: now, exp: now + 300 });
  const message = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(message), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32
  }).toString('base64url');
  return `${message}.${signature}`;
}
