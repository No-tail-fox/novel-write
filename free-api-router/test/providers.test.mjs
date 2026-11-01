import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ProviderPool, endpointFor, resolveProviders } from '../src/providers.mjs';
import { handleProxyRequest } from '../src/proxy.mjs';

const catalog = {
  providers: [{
    sourceId: 'demo',
    name: 'Demo',
    endpoints: { openai: 'https://demo.example/v1', anthropic: 'https://demo.example' },
    models: [{ name: 'demo-model', protocols: ['openai', 'anthropic'] }],
    online: true,
  }],
};

test('resolves keys from environment variable names only', () => {
  const config = { providers: [{ sourceId: 'demo', protocols: ['openai'], apiKeyEnv: 'DEMO_KEY' }] };
  const providers = resolveProviders(config, catalog, { DEMO_KEY: 'secret' });
  assert.equal(providers.length, 1);
  assert.equal(providers[0].apiKey, 'secret');
  assert.equal(providers[0].apiKeyEnv, 'DEMO_KEY');
  assert.equal(resolveProviders(config, catalog, {}).length, 0);
});

test('builds protocol-specific endpoints', () => {
  const config = { providers: [{ sourceId: 'demo', protocols: ['openai', 'anthropic'], apiKeyEnv: 'DEMO_KEY' }] };
  const [openai, anthropic] = resolveProviders(config, catalog, { DEMO_KEY: 'secret' });
  assert.equal(endpointFor(openai, 'chat/completions'), 'https://demo.example/v1/chat/completions');
  assert.equal(endpointFor(anthropic, 'messages'), 'https://demo.example/v1/messages');
});

test('rotates eligible providers and observes cooldowns', () => {
  const config = { providers: [{ sourceId: 'demo', protocol: 'openai', apiKeyEnv: 'DEMO_KEY' }] };
  const pool = new ProviderPool(resolveProviders(config, catalog, { DEMO_KEY: 'secret' }), { cooldownMs: 60000 });
  assert.equal(pool.candidates('openai', 'demo-model').length, 1);
  pool.markFailure(pool.providers[0], 503);
  assert.equal(pool.candidates('openai', 'demo-model').length, 0);
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function address(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('forwards to the next provider after an upstream failure', async () => {
  let firstCalls = 0;
  let secondCalls = 0;
  const first = await listen((_request, response) => {
    firstCalls += 1;
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'temporary outage' } }));
  });
  const second = await listen((_request, response) => {
    secondCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'ok', choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
  });
  const catalogWithLocalProviders = {
    providers: [
      { sourceId: 'first', name: 'First', endpoints: { openai: `${address(first)}/v1` }, models: [], online: true },
      { sourceId: 'second', name: 'Second', endpoints: { openai: `${address(second)}/v1` }, models: [], online: true },
    ],
  };
  const config = {
    providers: [
      { sourceId: 'first', protocol: 'openai', apiKeyEnv: 'FIRST_KEY' },
      { sourceId: 'second', protocol: 'openai', apiKeyEnv: 'SECOND_KEY' },
    ],
  };
  const pool = new ProviderPool(resolveProviders(config, catalogWithLocalProviders, { FIRST_KEY: 'one', SECOND_KEY: 'two' }), {
    maxAttempts: 2,
    cooldownMs: 60000,
  });
  const router = await listen((request, response) => handleProxyRequest({
    request,
    response,
    pool,
    protocol: 'openai',
    endpoint: 'chat/completions',
  }));
  try {
    const result = await fetch(`${address(router)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'any-model', messages: [{ role: 'user', content: 'ping' }] }),
    });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).choices[0].message.content, 'OK');
    assert.equal(firstCalls, 1);
    assert.equal(secondCalls, 1);
  } finally {
    await Promise.all([close(first), close(second), close(router)]);
  }
});
