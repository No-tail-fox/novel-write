import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { validateLemoSessionRequest } from '../services/lemo-agent-worker/session';
import { lemoSessionFingerprints, type OfficialLemoSessionOptions } from '../electron/lemo-agent-session-runtime';
import type { LemoAgentSessionRequest } from '../src/shared/lemo-agent-session';

function request(): LemoAgentSessionRequest {
  return { version: 1, action: 'start', runId: 'run_original', stageId: 'treatment',
    inputFingerprint: 'a'.repeat(64), configFingerprint: 'b'.repeat(64),
    prompt: 'Write the approved treatment.', model: 'fixture-model', maxTurns: 3, maxOutputTokens: 8192,
    runRoot: resolve('.artifacts/session-contract/run'), upstreamRoot: resolve('vendor/lemo-upstream'),
    gateway: { baseUrl: 'http://127.0.0.1:43123', token: 'c'.repeat(64) } };
}

describe('official Lemo session request boundary', () => {
  it.each(['start', 'resume'] as const)('accepts %s and returns an independent snapshot', action => {
    const value = { ...request(), action };
    const validated = validateLemoSessionRequest(value);
    expect(validated).toEqual(value);
    validated.gateway.token = 'd'.repeat(64);
    expect(value.gateway.token).toBe('c'.repeat(64));
  });

  it.each([
    { action: 'cancel' }, { version: 2 }, { runId: '../run' }, { stageId: '' },
    { inputFingerprint: 'short' }, { configFingerprint: 'A'.repeat(64) },
    { prompt: '  ' }, { prompt: 'x'.repeat(262145) }, { model: 'model\nheader' },
    { maxTurns: 0 }, { maxTurns: 101 }, { maxTurns: 1.5 },
    { maxOutputTokens: 0 }, { maxOutputTokens: 1000001 },
    { apiKey: 'must-never-enter-worker' }, { runRoot: 'relative/run' },
  ])('rejects invalid or extra fields: %j', patch => {
    expect(() => validateLemoSessionRequest({ ...request(), ...patch })).toThrow(/LEMO_(SESSION|SDK)_REQUEST/);
  });

  it.each([
    'https://provider.invalid', 'http://localhost:1234', 'http://127.0.0.2:1234',
    'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:1234/v1',
    'http://user:password@127.0.0.1:1234',
  ])('rejects a noncanonical local gateway: %s', baseUrl => {
    const value = request(); value.gateway.baseUrl = baseUrl;
    expect(() => validateLemoSessionRequest(value)).toThrow(/LEMO_SESSION_GATEWAY/);
  });

  it('rejects the upstream source directory as mutable session state', () => {
    const value = request(); value.runRoot = resolve(value.upstreamRoot, 'session');
    expect(() => validateLemoSessionRequest(value)).toThrow('LEMO_SDK_REQUEST');
  });

  it('rejects missing gateway authentication and injected gateway settings', () => {
    const value = request();
    expect(() => validateLemoSessionRequest({ ...value, gateway: { baseUrl: value.gateway.baseUrl } })).toThrow('LEMO_SESSION_GATEWAY');
    expect(() => validateLemoSessionRequest({ ...value, gateway: { ...value.gateway, apiKey: 'secret' } })).toThrow('LEMO_SESSION_GATEWAY');
  });
});

describe('stage identity and configuration invalidation', () => {
  const options: OfficialLemoSessionOptions = { action: 'start', nodeExecutable: process.execPath,
    workerPath: resolve('.artifacts/worker.mjs'), runRoot: resolve('.artifacts/run'), upstreamRoot: resolve('vendor/lemo-upstream'),
    runId: 'original_run', stageId: 'treatment', prompt: 'Approved brief',
    provider: { protocol: 'anthropic', messagesUrl: 'https://provider.invalid/v1/messages', auth: 'x-api-key', apiKey: 'fixture-only-secret', model: 'fixture-model' },
    maxOutputTokens: 8192, maxTurns: 3, maxRequests: 4, timeoutMs: 30000, requestTimeoutMs: 10000 };

  it('keeps original input/config identities when resuming the same session', () => {
    expect(lemoSessionFingerprints({ ...options, action: 'resume' })).toEqual(lemoSessionFingerprints(options));
  });

  it.each([{ prompt: 'Changed brief' }, { runId: 'different_run' }, { stageId: 'different_stage' }])(
    'invalidates changed stage input: %j', patch => {
      expect(lemoSessionFingerprints({ ...options, ...patch }).inputFingerprint).not.toBe(lemoSessionFingerprints(options).inputFingerprint);
    });

  it.each([{ maxTurns: 4 }, { maxRequests: 5 }, { maxOutputTokens: 16384 },
    { provider: { ...options.provider, model: 'different-model' } },
    { provider: { ...options.provider, apiKey: 'rotated-fixture-secret' } },
    { provider: { ...options.provider, messagesUrl: 'https://other.invalid/v1/messages' } },
  ])('invalidates provider or budget changes without storing credentials: %j', patch => {
    const actual = lemoSessionFingerprints({ ...options, ...patch });
    expect(actual.configFingerprint).not.toBe(lemoSessionFingerprints(options).configFingerprint);
    expect(actual.configFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(actual)).not.toContain(options.provider.apiKey);
  });
});
