import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { fetchImaKnowledge } from '../src/shared/ima-knowledge';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { INVOKE_CHANNELS } from '../src/shared/storydream-api';
import type { ImaConfig } from '../src/shared/types';
import type { NetworkFetch } from '../src/shared/network-policy';

const configuredIma: ImaConfig = {
  clientId: 'ima-client',
  apiKey: 'ima-secret-key',
  kbId: 'kb-123',
  kbName: '人物资料库',
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'request-1' },
  });
}

describe('IMA knowledge boundary', () => {
  it.each([
    [{ ...configuredIma, clientId: '' }, 'client'],
    [{ ...configuredIma, apiKey: '' }, 'key'],
    [{ ...configuredIma, kbId: '', kbName: '' }, 'knowledge'],
  ])('rejects missing configuration before HTTP work', async (config, detail) => {
    const fetchImpl = vi.fn<NetworkFetch>();

    const result = await fetchImaKnowledge(config, { query: '测试' }, { fetchImpl });

    expect(result.status).toBe('fail');
    expect(result.detail.toLowerCase()).toContain(detail);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects oversized or control-character input before HTTP work', async () => {
    const fetchImpl = vi.fn<NetworkFetch>();
    const oversized = await fetchImaKnowledge(
      { ...configuredIma, clientId: 'x'.repeat(1_025) },
      { query: '测试' },
      { fetchImpl },
    );
    const invalidHeader = await fetchImaKnowledge(
      { ...configuredIma, apiKey: 'secret\r\ninjected: value' },
      { query: '测试' },
      { fetchImpl },
    );
    const oversizedQuery = await fetchImaKnowledge(
      configuredIma,
      { query: 'q'.repeat(1_025) },
      { fetchImpl },
    );

    expect([oversized.status, invalidHeader.status, oversizedQuery.status]).toEqual(['fail', 'fail', 'fail']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the fixed IMA endpoint and returns bounded record summaries', async () => {
    const fetchImpl = vi.fn<NetworkFetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get('ima-openapi-clientid')).toBe(configuredIma.clientId);
      expect(new Headers(init?.headers).get('ima-openapi-apikey')).toBe(configuredIma.apiKey);
      expect(JSON.parse(String(init?.body))).toEqual({ query: '武则天', cursor: '', knowledge_base_id: 'kb-123' });
      return jsonResponse({
        code: 0,
        data: {
          list: Array.from({ length: 25 }, (_, index) => ({
            id: `doc-${index}`,
            title: index === 0 ? `标题-${index}`.repeat(200) : `标题-${index}`,
            highlight_content: index === 0 ? `摘要-${index}`.repeat(1_100) : `摘要-${index}`,
            url: `https://documents.example/${index}`,
          })),
        },
      });
    });

    const result = await fetchImaKnowledge(configuredIma, { query: '  武则天  ' }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith('https://ima.qq.com/openapi/wiki/v1/search_knowledge', expect.any(Object));
    expect(result).toMatchObject({ status: 'pass', endpoint: 'https://ima.qq.com/openapi/wiki/v1/search_knowledge', requestId: 'request-1', knowledgeBaseId: 'kb-123' });
    expect(result.records).toHaveLength(20);
    expect(result.records[0].title.length).toBeLessThanOrEqual(512);
    expect(result.records[0].snippet.length).toBeLessThanOrEqual(4_000);
  });

  it('returns a redacted failure for malformed or provider-error responses', async () => {
    const malformed = await fetchImaKnowledge(configuredIma, { query: '测试' }, {
      fetchImpl: async () => new Response('{not-json', { status: 200 }),
    });
    expect(malformed.status).toBe('fail');
    expect(malformed.detail).toMatch(/invalid|json|response/i);

    const providerError = await fetchImaKnowledge(configuredIma, { query: '测试' }, {
      fetchImpl: async () => jsonResponse({ code: 401, message: `bad ${configuredIma.apiKey} ${configuredIma.clientId}` }),
    });
    expect(providerError.status).toBe('fail');
    expect(providerError.detail).not.toContain(configuredIma.apiKey);
    expect(providerError.detail).not.toContain(configuredIma.clientId);
  });

  it('aborts a timed-out request and reports no credentials', async () => {
    let aborted = false;
    const fetchImpl: NetworkFetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(init.signal?.reason);
      }, { once: true });
    });

    const result = await fetchImaKnowledge(configuredIma, { query: '测试' }, { fetchImpl, timeoutMs: 5 });

    expect(aborted).toBe(true);
    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/timed out|timeout/i);
    expect(result.detail).not.toContain(configuredIma.apiKey);
  });

  it('honors an already-aborted caller signal before HTTP work', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));
    const fetchImpl = vi.fn<NetworkFetch>();

    const result = await fetchImaKnowledge(configuredIma, { query: '测试' }, { fetchImpl, signal: controller.signal });

    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/cancel|abort/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects oversized responses without returning their body', async () => {
    const result = await fetchImaKnowledge(configuredIma, { query: '测试' }, {
      fetchImpl: async () => new Response('x'.repeat(300_000), { status: 200 }),
    });

    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/byte|large|limit|size/i);
    expect(result.records).toEqual([]);
  });

  it('defines a strict renderer request and a credential-free IPC/API bridge', async () => {
    expect(INVOKE_CHANNELS).toContain('ima:fetch-knowledge');
    const schema = ipcInputSchemas['ima:fetch-knowledge'];
    expect(schema.safeParse({ query: '人物' }).success).toBe(true);
    expect(schema.safeParse({ query: '  ' }).success).toBe(false);
    expect(schema.safeParse({ query: '人物', apiKey: 'must-not-cross' }).success).toBe(false);

    const [api, preload, main] = await Promise.all([
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    ]);
    expect(api).toContain('fetchImaKnowledge: (input: ImaKnowledgeRequest) => Promise<ImaKnowledgeResult>');
    expect(preload).toContain("fetchImaKnowledge: (input: ImaKnowledgeRequest): Promise<ImaKnowledgeResult> => invokeTrusted('ima:fetch-knowledge', input)");
    const handler = main.slice(main.indexOf("trustedHandle('ima:fetch-knowledge'"), main.indexOf("trustedHandle('research:web-search'"));
    expect(handler).toContain('getRuntimeConfig()');
    expect(handler).toContain('fetchImaKnowledge(runtimeConfig.ima, input)');
    expect(handler).not.toMatch(/apiKey\s*:/u);
  });

  it('wires the visible fetch action and governed cleanup navigation without dropping kbId', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const settings = main.slice(main.indexOf('function SettingsPage'), main.indexOf('function LlmProfileManager'));

    expect(settings).toContain('fetchImaKnowledgeFromSettings');
    expect(settings).toContain('await api.fetchImaKnowledge({ query:');
    expect(settings).toContain('imaKnowledgeResult.records.map');
    expect(settings).toContain('知识库 ID');
    expect(settings).toContain('onClick={fetchImaKnowledgeFromSettings}');
    expect(settings).toContain("onClick={() => navigate('history')}");
    expect(settings).not.toMatch(/clear(?:All)?History|\.clear\(\)|tasks:\s*\[\]/u);
  });
});
