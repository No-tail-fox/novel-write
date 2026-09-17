import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentSearchMcpService } from '../electron/agent-search';

describe('AgentSearchMcpService', () => {
  let service: AgentSearchMcpService | undefined;
  let dataDirectory = '';

  afterEach(async () => {
    await service?.close();
    if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5 });
  });

  it('uses the persistent MCP transport and bounds arguments before returning structured content', async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'storydream-agent-search-'));
    service = new AgentSearchMcpService({
      dataDirectory: () => dataDirectory,
      executablePath: process.execPath,
      serverPath: fileURLToPath(new URL('./fixtures/agent-search-mcp-stub.mjs', import.meta.url)),
    });

    const first = await service.search({
      query: '  StoryDream Agent Search  ',
      engines: ['bing', 'unsupported', 'bing'],
      count: 99,
    }) as { query: string; engines: string[]; limit: number; results: unknown[] };
    const second = await service.search({ query: 'second request', engines: ['wikipedia'], count: 0 });
    const stderrFlood = await service.search({ query: 'stderr flood', engines: ['bing'], count: 1 });

    expect(first).toMatchObject({
      query: 'StoryDream Agent Search',
      engines: ['bing'],
      limit: 15,
      results: [{ title: 'StoryDream Agent Search', url: 'https://example.test/result', sources: ['bing'] }],
    });
    expect(second).toMatchObject({ query: 'second request', engines: ['wikipedia'], limit: 1 });
    expect(stderrFlood).toMatchObject({ query: 'stderr flood', engines: ['bing'], limit: 1 });

    await service.close();
    await expect(service.search({ query: 'after close', engines: ['bing'], count: 1 })).rejects.toThrow('Agent Search 已停止');
    service = undefined;
  });

  it('recovers concurrent requests from one broken session without closing the replacement', async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'storydream-agent-search-reconnect-'));
    service = new AgentSearchMcpService({
      dataDirectory: () => dataDirectory,
      executablePath: process.execPath,
      serverPath: fileURLToPath(new URL('./fixtures/agent-search-mcp-stub.mjs', import.meta.url)),
    });

    const [first, second] = await Promise.all([
      service.search({ query: 'disconnect-first', engines: ['bing'], count: 2 }),
      service.search({ query: 'disconnect-second', engines: ['wikipedia'], count: 3 }),
    ]);

    expect(first).toMatchObject({ query: 'disconnect-first', engines: ['bing'], limit: 2 });
    expect(second).toMatchObject({ query: 'disconnect-second', engines: ['wikipedia'], limit: 3 });
  });

  it('rejects empty queries and unsupported engines before starting the MCP process', async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'storydream-agent-search-invalid-'));
    service = new AgentSearchMcpService({
      dataDirectory: () => dataDirectory,
      executablePath: process.execPath,
      serverPath: fileURLToPath(new URL('./fixtures/agent-search-mcp-stub.mjs', import.meta.url)),
    });

    await expect(service.search({ query: '   ', engines: ['bing'], count: 1 })).rejects.toThrow('查询不能为空');
    await expect(service.search({ query: 'valid', engines: ['unsupported'], count: 1 })).rejects.toThrow('没有可用的搜索引擎');
  });
});
