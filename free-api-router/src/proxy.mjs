import { endpointFor, publicProvider } from './providers.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function writeJson(response, status, body) {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

function errorBody(message, type = 'server_error', code = null) {
  return { error: { message, type, code } };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Request body must be valid JSON');
  }
}

function providerHeaders(provider, protocol, requestBody) {
  const headers = {
    'content-type': 'application/json',
    accept: requestBody.stream ? 'text/event-stream' : 'application/json',
  };
  if (protocol === 'openai') headers.authorization = `Bearer ${provider.apiKey}`;
  if (protocol === 'anthropic') {
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }
  return headers;
}

async function forward(request, response, provider, protocol, endpoint, body) {
  const upstream = await fetch(endpointFor(provider, endpoint), {
    method: 'POST',
    headers: providerHeaders(provider, protocol, body),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!upstream.ok) {
    const text = await upstream.text();
    return { ok: false, status: upstream.status, text };
  }
  response.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') || 'application/json',
    ...(upstream.headers.get('cache-control') ? { 'cache-control': upstream.headers.get('cache-control') } : {}),
    ...(upstream.headers.get('x-request-id') ? { 'x-request-id': upstream.headers.get('x-request-id') } : {}),
  });
  if (upstream.body) {
    for await (const chunk of upstream.body) response.write(chunk);
  }
  response.end();
  return { ok: true, status: upstream.status };
}

async function routeRequest({ request, response, pool, protocol, endpoint }) {
  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    return writeJson(response, 400, errorBody(error.message, 'invalid_request_error'));
  }
  const candidates = pool.candidates(protocol, body.model);
  if (candidates.length === 0) {
    const configured = pool.list(protocol).length;
    const message = configured === 0
      ? `No configured ${protocol} provider is available. Copy config/providers.example.json to config/providers.json and set the provider API key environment variable.`
      : `No ${protocol} provider is available for model ${body.model || '(unspecified)'}.`;
    return writeJson(response, 503, errorBody(message, 'service_unavailable'));
  }
  const attempts = candidates.slice(0, pool.maxAttempts);
  let lastFailure = null;
  for (const provider of attempts) {
    try {
      const result = await forward(request, response, provider, protocol, endpoint, body);
      if (result.ok) {
        pool.markSuccess(provider);
        return;
      }
      lastFailure = result;
      pool.markFailure(provider, result.status);
      console.warn(`[router] ${provider.id} returned ${result.status}; trying another provider`);
    } catch (error) {
      lastFailure = { status: 502, text: error instanceof Error ? error.message : String(error) };
      pool.markFailure(provider, 502);
      console.warn(`[router] ${provider.id} failed: ${lastFailure.text}`);
    }
  }
  const status = lastFailure?.status >= 400 && lastFailure.status < 600 ? lastFailure.status : 502;
  return writeJson(response, status, errorBody(`All selected providers failed after ${attempts.length} attempt(s).`, 'upstream_error', status));
}

export async function handleProxyRequest({ request, response, pool, protocol, endpoint }) {
  return routeRequest({ request, response, pool, protocol, endpoint });
}

export function modelsResponse(pool) {
  const models = new Map();
  for (const provider of pool.providers.filter((item) => item.protocol === 'openai')) {
    for (const model of provider.models) {
      if (!models.has(model)) models.set(model, { id: model, object: 'model', owned_by: provider.sourceId });
    }
  }
  return { object: 'list', data: [...models.values()] };
}

export function providersResponse(pool) {
  return { object: 'list', data: pool.providers.map((provider) => publicProvider(provider, pool)) };
}
