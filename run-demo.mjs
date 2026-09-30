import { generateKeyPairSync } from 'node:crypto';
import { startMockServer } from '../mock/server.mjs';
import { runSync } from '../src/sync.mjs';

// Generate a throwaway signing key in memory; nothing is written to disk.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const mock = await startMockServer(publicKey);
try {
  await runSync({
    zendeskBase: mock.base,
    username: 'demo-user',
    apiToken: 'demo-token',
    tokenEndpoint: `${mock.base}/oauth2/token`,
    restletEndpoint: `${mock.base}/netsuite/restlet`,
    clientId: 'demo-client',
    keyId: 'ephemeral-demo',
    privateKey
  });
  console.log('Demonstration finished. All requests remained on this computer.');
} finally { await mock.close(); }
