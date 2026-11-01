import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, HEALTH_PATH } from './config.mjs';
import { endpointFor } from './providers.mjs';

async function checkProvider(provider) {
  const started = Date.now();
  const result = {
    id: provider.id,
    sourceId: provider.sourceId,
    protocol: provider.protocol,
    ok: false,
    authenticated: false,
    models: [],
    model: null,
    modelsStatus: null,
    chatStatus: null,
    latencyMs: null,
    checkedAt: new Date().toISOString(),
  };
  try {
    if (provider.protocol === 'openai') {
      const response = await fetch(endpointFor(provider, 'models'), {
        headers: { accept: 'application/json', authorization: `Bearer ${provider.apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      result.modelsStatus = response.status;
      if (!response.ok) return result;
      const data = await response.json();
      result.models = Array.isArray(data?.data) ? data.data.map((item) => item?.id).filter((id) => typeof id === 'string') : [];
      result.authenticated = true;
      result.model = provider.models.find((model) => result.models.includes(model)) || result.models[0] || null;
      if (!result.model) return result;
      const chat = await fetch(endpointFor(provider, 'chat/completions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ model: result.model, messages: [{ role: 'user', content: 'Reply with exactly OK' }], max_tokens: 8 }),
        signal: AbortSignal.timeout(30000),
      });
      result.chatStatus = chat.status;
      if (chat.ok) {
        const data = await chat.json();
        result.ok = Array.isArray(data?.choices) && data.choices.some((choice) => typeof choice?.message?.content === 'string' && choice.message.content.length > 0);
      }
    } else if (provider.protocol === 'anthropic') {
      result.model = provider.models[0] || null;
      if (!result.model) return result;
      const chat = await fetch(endpointFor(provider, 'messages'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: result.model, messages: [{ role: 'user', content: 'Reply with exactly OK' }], max_tokens: 8 }),
        signal: AbortSignal.timeout(30000),
      });
      result.chatStatus = chat.status;
      result.authenticated = chat.ok;
      if (chat.ok) {
        const data = await chat.json();
        result.ok = Array.isArray(data?.content) && data.content.some((block) => typeof block?.text === 'string' && block.text.length > 0);
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    result.latencyMs = Date.now() - started;
    result.checkedAt = new Date().toISOString();
  }
  return result;
}

export async function checkProviders(pool) {
  const providers = await Promise.all(pool.providers.map(checkProvider));
  const result = { checkedAt: new Date().toISOString(), providers };
  await mkdir(DATA_DIR, { recursive: true });
  const tempPath = path.join(DATA_DIR, `.tmp-health-${process.pid}.json`);
  await writeFile(tempPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await rename(tempPath, HEALTH_PATH);
  return result;
}
