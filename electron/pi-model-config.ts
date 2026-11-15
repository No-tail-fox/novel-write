import { llmEndpoint, resolveLlmProtocol } from '../src/shared/llm-protocol';
import type { LlmConfig } from '../src/shared/types';

export interface PiModelCapabilities { contextWindow: number; maxOutputTokens: number; images: boolean; reasoning: boolean; tools: boolean }
/** Native protocols only. Never feed Pi calls through the text-only adapter or its fallback list. */
export function resolvePiModelConfig(config: LlmConfig, capabilities: PiModelCapabilities) {
  if (!config.model.trim() || !config.apiKey.trim()) throw new Error('PI_MODEL_CONFIG_MISSING');
  if (!capabilities.tools) throw new Error('PI_MODEL_TOOLS_UNSUPPORTED');
  if (!Number.isSafeInteger(capabilities.contextWindow) || !Number.isSafeInteger(capabilities.maxOutputTokens)
    || capabilities.maxOutputTokens < 1 || capabilities.contextWindow <= capabilities.maxOutputTokens) throw new Error('PI_MODEL_CAPABILITIES_INVALID');
  const protocol = resolveLlmProtocol(config);
  return {
    provider: { protocol: protocol === 'openai' ? 'openai-chat' as const : protocol === 'responses' ? 'openai-responses' as const : 'anthropic' as const,
      upstreamUrl: llmEndpoint(config), apiKey: config.apiKey,
      auth: protocol === 'anthropic' ? 'x-api-key' as const : 'bearer' as const, model: config.model },
    workerModel: { id: config.model, api: protocol === 'openai' ? 'openai-completions' as const : protocol === 'responses' ? 'openai-responses' as const : 'anthropic-messages' as const,
      contextWindow: capabilities.contextWindow, maxTokens: capabilities.maxOutputTokens, reasoning: capabilities.reasoning,
      input: capabilities.images ? ['text', 'image'] as const : ['text'] as const },
    // Proxy is host-only; it must be applied to gateway transport, not inherited by the worker.
    proxyUrl: config.proxyUrl,
    timeoutMs: config.timeoutMs ?? 240_000,
  };
}
