import http from 'node:http';
import { loadCatalog, loadConfig } from './config.mjs';
import { syncCatalog } from './catalog.mjs';
import { checkProviders } from './health.mjs';
import { ProviderPool, resolveProviders } from './providers.mjs';
import { handleProxyRequest, modelsResponse, providersResponse } from './proxy.mjs';

const config = await loadConfig();
let catalog = await loadCatalog();
if (!catalog) {
  try {
    catalog = await syncCatalog();
  } catch (error) {
    console.warn(`[router] catalog sync failed at startup: ${error instanceof Error ? error.message : String(error)}`);
    catalog = { providers: [], directory: [], sources: [], generatedAt: null };
  }
}

let pool = new ProviderPool(resolveProviders(config, catalog), config.selection);
let lastSyncError = null;

async function refreshCatalog() {
  try {
    catalog = await syncCatalog();
    pool = new ProviderPool(resolveProviders(config, catalog), config.selection);
    lastSyncError = null;
    console.log(`[router] catalog refreshed: ${catalog.providers.length} callable, ${catalog.directory.length} directory entries`);
  } catch (error) {
    lastSyncError = error instanceof Error ? error.message : String(error);
    console.warn(`[router] catalog refresh failed: ${lastSyncError}`);
  }
}

function corsHeaders() {
  return {
    'access-control-allow-origin': process.env.FREE_API_CORS_ORIGIN || '*',
    'access-control-allow-headers': 'authorization, content-type, x-api-key, anthropic-version',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  Object.entries(corsHeaders()).forEach(([key, value]) => response.setHeader(key, value));
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        generatedAt: catalog.generatedAt,
        configuredProviders: pool.providers.length,
        providerIds: pool.providers.map((provider) => provider.id),
        sources: catalog.sources,
        syncError: lastSyncError,
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/providers') {
      sendJson(response, 200, providersResponse(pool));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/catalog') {
      sendJson(response, 200, catalog);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      sendJson(response, 200, modelsResponse(pool));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await handleProxyRequest({ request, response, pool, protocol: 'openai', endpoint: 'chat/completions' });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/messages') {
      await handleProxyRequest({ request, response, pool, protocol: 'anthropic', endpoint: 'messages' });
      return;
    }
    sendJson(response, 404, { error: { message: 'Not found', type: 'invalid_request_error', code: 'not_found' } });
  } catch (error) {
    console.error(`[router] request failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    if (!response.headersSent) sendJson(response, 500, { error: { message: 'Internal router error', type: 'server_error' } });
    else response.end();
  }
});

server.listen(config.listen.port, config.listen.host, () => {
  console.log(`[router] listening at http://${config.listen.host}:${config.listen.port}`);
  console.log(`[router] configured providers: ${pool.providers.length}`);
  console.log('[router] stable endpoints: /v1/chat/completions and /v1/messages');
});

const interval = setInterval(refreshCatalog, config.sync.intervalMs);
interval.unref();

const shutdown = () => {
  clearInterval(interval);
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
