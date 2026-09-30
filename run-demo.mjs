import { generateKeyPairSync } from 'node:crypto';
import { startMockServer } from '../mock/server.mjs';
import { runSync } from '../src/sync.mjs';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const mock = await startMockServer(publicKey);
try {
  const config = { zendeskBase: mock.base, username: 'demo-user', apiToken: 'demo-token',
    tokenEndpoint: `${mock.base}/services/rest/auth/oauth2/v1/token`, restletEndpoint: `${mock.base}/app/site/hosting/restlet.nl?script=demo&deploy=1`,
    clientId: 'demo-client', keyId: 'ephemeral-demo', privateKey };
  console.log('FIRST SYNC: pagination, a transient retry and a permanent error');
  await runSync(config);
  console.log('REPLAY: the same successful records must not be written twice');
  await runSync(config);
  console.log(JSON.stringify({ event: 'destination_state', records: mock.target.records.size, writes: mock.target.writes }));
  if (mock.target.records.size !== 3 || mock.target.writes !== 3) throw new Error('Unexpected duplicate destination writes');
  console.log('Demo complete. Requests and disposable signing keys stayed local.');
} finally { await mock.close(); }
