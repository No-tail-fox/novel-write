import { expect, it } from 'vitest';
import { resolvePiModelConfig } from '../electron/pi-model-config';
const config = { provider: 'openai', apiKey: 'secret', baseUrl: 'https://relay.example/v1', model: 'my-model', proxyUrl: '', fallbackModels: ['do-not-use'] };
const capabilities = { contextWindow: 32000, maxOutputTokens: 8000, images: true, reasoning: false, tools: true };
it('maps explicit protocols without copying credentials into worker model', () => {
  const result = resolvePiModelConfig({ ...config, protocol: 'responses' }, capabilities);
  expect(result.provider.upstreamUrl).toBe('https://relay.example/v1/responses');
  expect(result.workerModel.api).toBe('openai-responses');
  expect(JSON.stringify(result.workerModel)).not.toContain('secret');
  expect(JSON.stringify(result)).not.toContain('do-not-use');
  expect(resolvePiModelConfig({ ...config, provider: 'anthropic' }, capabilities).provider.protocol).toBe('anthropic');
});
it('requires tool capabilities instead of silently downgrading', () => {
  expect(() => resolvePiModelConfig(config, { ...capabilities, tools: false })).toThrow('TOOLS_UNSUPPORTED');
  expect(() => resolvePiModelConfig(config, { ...capabilities, maxOutputTokens: 40000 })).toThrow('CAPABILITIES_INVALID');
});
