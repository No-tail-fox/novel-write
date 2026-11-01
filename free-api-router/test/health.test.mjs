import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { checkProviders } from '../src/health.mjs';
import { ProviderPool } from '../src/providers.mjs';

async function withServer(chatStatus, callback) {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    } else {
      response.statusCode = chatStatus;
      response.end(chatStatus === 200
        ? JSON.stringify({ choices: [{ message: { content: 'OK' } }] })
        : JSON.stringify({ error: { message: 'temporarily unavailable' } }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = {
      id: 'test:openai', sourceId: 'test', protocol: 'openai',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: 'test-key', models: ['test-model'],
    };
    await callback(new ProviderPool([provider]));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('health requires a real successful chat, not just an authenticated model list', async () => {
  await withServer(503, async (pool) => {
    const { providers: [result] } = await checkProviders(pool);
    assert.equal(result.modelsStatus, 200);
    assert.deepEqual(result.models, ['test-model']);
    assert.equal(result.chatStatus, 503);
    assert.equal(result.ok, false);
  });
  await withServer(200, async (pool) => {
    const { providers: [result] } = await checkProviders(pool);
    assert.equal(result.modelsStatus, 200);
    assert.equal(result.chatStatus, 200);
    assert.equal(result.ok, true);
  });
});
