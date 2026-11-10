import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { formatRelayProbeResult, idleCutoffCheck, parseSseJson, probeRelayCapabilities } from '@shared/relay-capability-probe';
import type { LlmConfig } from '@shared/types';
import { sseData, startMockRelay, type MockRelay } from './helpers/mock-relay';

// G-9: relay capability probe, against the Q-4 local relay (real sockets, no fetch stubs).
let relay: MockRelay;
beforeAll(async () => { relay = await startMockRelay(); });
afterAll(async () => { await relay?.close(); });
beforeEach(() => relay.reset());

const config = (protocol: 'openai' | 'anthropic'): LlmConfig => ({
  id: 'probe', provider: protocol === 'anthropic' ? 'anthropic' : 'custom', protocol,
  baseUrl: `${relay.origin}/v1`, apiKey: 'test-only', model: protocol === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-5.5',
} as LlmConfig);

const status = (result: Awaited<ReturnType<typeof probeRelayCapabilities>>, id: string) => result.checks.find(check => check.id === id)?.status;

describe('relay capability probe (G-9)', () => {
  it('detects stream usage, reasoning acceptance and cached-token reporting on an OpenAI-compatible relay', async () => {
    relay.enqueue(
      { kind: 'sse', headers: { 'cf-ray': 'abc-HKG' }, events: [
        sseData({ id: 'c1', choices: [{ index: 0, delta: { content: 'ok' } }] }),
        sseData({ id: 'c1', choices: [], usage: { prompt_tokens: 12, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } } }),
        sseData('[DONE]'),
      ] },
      { kind: 'json', body: { id: 'c2', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] } },
    );
    const result = await probeRelayCapabilities(config('openai'));
    expect(relay.requests).toHaveLength(2);
    expect(relay.requests[0].json).toMatchObject({ stream: true, stream_options: { include_usage: true }, max_tokens: 16 });
    expect(relay.requests[1].json).toMatchObject({ reasoning_effort: 'low' });
    expect(status(result, 'stream-usage')).toBe('supported');
    expect(status(result, 'reasoning')).toBe('supported');
    expect(status(result, 'prompt-cache')).toBe('supported');
    expect(status(result, 'idle-cutoff')).toBe('unknown');
    expect(result.summary).toContain('共 2 个极小请求');
  });

  it('reports rejected parameters as unsupported and never resends', async () => {
    relay.enqueue(
      { kind: 'text', status: 400, body: '{"error":{"message":"Unrecognized request argument supplied: stream_options"}}' },
      { kind: 'text', status: 400, body: '{"error":{"message":"Unknown parameter: reasoning_effort"}}', headers: { server: 'cloudflare' } },
    );
    const result = await probeRelayCapabilities(config('openai'));
    expect(relay.requests).toHaveLength(2);
    expect(status(result, 'stream-usage')).toBe('unsupported');
    expect(status(result, 'reasoning')).toBe('unsupported');
    expect(status(result, 'prompt-cache')).toBe('unknown');
    expect(status(result, 'idle-cutoff')).toBe('supported');
    expect(formatRelayProbeResult(result)).toContain('Cloudflare');
  });

  it('treats a silently ignored stream_options (no usage block) as unsupported and gateway errors as unknown', async () => {
    relay.enqueue(
      { kind: 'sse', events: [sseData({ id: 'c1', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }), sseData('[DONE]')] },
      { kind: 'cloudflare', status: 524 },
    );
    const result = await probeRelayCapabilities(config('openai'));
    expect(status(result, 'stream-usage')).toBe('unsupported');
    expect(status(result, 'reasoning')).toBe('unknown');
    expect(relay.requests).toHaveLength(2);
  });

  it('probes Anthropic relays with cache_control and thinking', async () => {
    relay.enqueue(
      { kind: 'sse', events: [
        sseData({ type: 'message_start', message: { id: 'm1', usage: { input_tokens: 9, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }, 'message_start'),
        sseData({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }, 'message_delta'),
        sseData({ type: 'message_stop' }, 'message_stop'),
      ] },
      { kind: 'text', status: 400, body: '{"type":"error","error":{"message":"thinking is not supported for this model"}}' },
    );
    const result = await probeRelayCapabilities(config('anthropic'));
    expect(relay.requests).toHaveLength(2);
    expect(relay.requests[0].url).toMatch(/\/v1\/messages$/u);
    expect(relay.requests[0].json).toMatchObject({ system: [{ cache_control: { type: 'ephemeral' } }] });
    expect(relay.requests[1].json).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 1024 } });
    expect(status(result, 'stream-usage')).toBe('supported');
    expect(status(result, 'prompt-cache')).toBe('supported');
    expect(status(result, 'reasoning')).toBe('unsupported');
  });

  it('refuses to probe without a key or model and parses SSE defensively', async () => {
    await expect(probeRelayCapabilities({ ...config('openai'), apiKey: ' ' })).rejects.toThrow('RELAY_PROBE_KEY_MISSING');
    await expect(probeRelayCapabilities({ ...config('openai'), model: '' })).rejects.toThrow('RELAY_PROBE_MODEL_MISSING');
    expect(relay.requests).toHaveLength(0);
    expect(parseSseJson('data: {"a":1}\ndata: [DONE]\ndata: {broken\n: comment')).toEqual([{ a: 1 }]);
    expect(idleCutoffCheck(new Headers({ 'cf-ray': 'x' })).status).toBe('supported');
  });

  it('is exposed only as an explicit settings action (探测中转站能力)', () => {
    expect(readFileSync('src/shared/storydream-api.ts', 'utf8')).toContain('probeLlmCapabilities: (config: LlmConfig) => Promise<RelayProbeResult>;');
    expect(readFileSync('src/features/settings/SettingsPage.tsx', 'utf8')).toContain('onClick={probeSelectedLlmRelay}');
    expect(readFileSync('electron/preload.ts', 'utf8')).toContain("invokeTrusted('llm:probe-capabilities', config)");
    expect(readFileSync('src/shared/ipc-contract.ts', 'utf8')).toContain("'llm:probe-capabilities': llmConfigSchema");
  });
});
