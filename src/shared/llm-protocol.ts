import type { LlmConfig } from './types';

export const LLM_PROTOCOLS = ['openai', 'responses', 'anthropic'] as const;
export type LlmProtocol = (typeof LLM_PROTOCOLS)[number];

export const LLM_PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'Chat Completions' },
  { value: 'responses', label: 'Responses' },
  { value: 'anthropic', label: 'Anthropic Messages' },
] as const;

export function resolveLlmProtocol(config: Pick<LlmConfig, 'provider' | 'protocol'>): LlmProtocol {
  if (config.provider === 'anthropic') return 'anthropic';
  return config.protocol === 'responses' || config.protocol === 'anthropic' ? config.protocol : 'openai';
}

export function llmEndpoint(config: Pick<LlmConfig, 'provider' | 'protocol' | 'baseUrl'>): string {
  const protocol = resolveLlmProtocol(config);
  const base = (config.baseUrl || (protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com')).trim().replace(/\/+$/, '');
  const path = protocol === 'anthropic' ? 'messages' : protocol === 'responses' ? 'responses' : 'chat/completions';
  return `${base.endsWith('/v1') ? base : `${base}/v1`}/${path}`;
}
