import { findProvider } from './catalog.mjs';

function normalizeProtocols(providerConfig) {
  if (Array.isArray(providerConfig.protocols)) return providerConfig.protocols;
  if (providerConfig.protocol) return [providerConfig.protocol];
  return ['openai'];
}

function modelsFor(provider, protocol, configuredModels) {
  if (Array.isArray(configuredModels) && configuredModels.length > 0) return configuredModels;
  return (provider.models || [])
    .filter((model) => model.protocols.length === 0 || model.protocols.includes(protocol))
    .map((model) => model.name)
    .filter(Boolean);
}

export function resolveProviders(config, catalog, env = process.env) {
  const resolved = [];
  for (const providerConfig of config.providers || []) {
    if (providerConfig.enabled === false) continue;
    const source = findProvider(catalog, providerConfig.sourceId);
    if (!source) continue;
    const apiKeyEnv = providerConfig.apiKeyEnv || '';
    const apiKey = apiKeyEnv ? String(env[apiKeyEnv] || '') : '';
    if (!apiKey && providerConfig.allowAnonymous !== true) continue;
    for (const protocol of normalizeProtocols(providerConfig)) {
      const baseUrl = source.endpoints?.[protocol];
      if (!baseUrl) continue;
      resolved.push({
        id: `${source.sourceId || source.id}:${protocol}`,
        sourceId: source.sourceId || source.id,
        name: source.name,
        protocol,
        baseUrl: baseUrl.replace(/\/$/, ''),
        apiKey,
        apiKeyEnv,
        weight: Math.max(1, Number(providerConfig.weight || 1)),
        models: modelsFor(source, protocol, providerConfig.models),
        online: source.online,
        latencyMs: source.latencyMs,
        signupUrl: source.signupUrl,
      });
    }
  }
  return resolved;
}

export function joinUrl(baseUrl, suffix) {
  return `${baseUrl.replace(/\/$/, '')}/${suffix.replace(/^\//, '')}`;
}

export function endpointFor(provider, endpoint) {
  if (provider.protocol === 'openai') return joinUrl(provider.baseUrl, endpoint);
  if (endpoint === 'messages') {
    return provider.baseUrl.endsWith('/v1')
      ? joinUrl(provider.baseUrl, 'messages')
      : joinUrl(provider.baseUrl, 'v1/messages');
  }
  return joinUrl(provider.baseUrl, endpoint);
}

export function publicProvider(provider, pool) {
  return {
    id: provider.id,
    name: provider.name,
    sourceId: provider.sourceId,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKeyEnv: provider.apiKeyEnv,
    configured: Boolean(provider.apiKey),
    models: provider.models,
    online: provider.online,
    latencyMs: provider.latencyMs,
    cooldownUntil: pool.cooldowns.get(provider.id) || null,
    signupUrl: provider.signupUrl,
  };
}

export class ProviderPool {
  constructor(providers, { cooldownMs = 30000, maxAttempts = 3 } = {}) {
    this.providers = providers;
    this.cooldownMs = cooldownMs;
    this.maxAttempts = maxAttempts;
    this.cooldowns = new Map();
    this.cursor = new Map();
  }

  list(protocol) {
    return this.providers.filter((provider) => provider.protocol === protocol);
  }

  candidates(protocol, model) {
    const now = Date.now();
    const all = this.list(protocol).filter((provider) => {
      const cooldownUntil = this.cooldowns.get(provider.id) || 0;
      const modelMatches = !model || provider.models.length === 0 || provider.models.includes(model);
      return modelMatches && cooldownUntil <= now;
    });
    if (all.length === 0) return [];
    const weighted = all.flatMap((provider) => Array.from({ length: provider.weight }, () => provider));
    const cursor = this.cursor.get(protocol) || 0;
    const ordered = weighted.slice(cursor % weighted.length).concat(weighted.slice(0, cursor % weighted.length));
    this.cursor.set(protocol, cursor + 1);
    return [...new Map(ordered.map((provider) => [provider.id, provider])).values()];
  }

  markFailure(provider, status) {
    if (status === 400 || status === 404) return;
    this.cooldowns.set(provider.id, Date.now() + this.cooldownMs);
  }

  markSuccess(provider) {
    this.cooldowns.delete(provider.id);
  }
}
