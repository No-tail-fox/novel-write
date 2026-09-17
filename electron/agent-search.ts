import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AgentSearchExecutor, AgentSearchRequest } from '../src/shared/web-search-backends';

const AGENT_SEARCH_SERVER_FILENAME = 'agent-search-mcp-server.cjs';
const AGENT_SEARCH_TIMEOUT_MS = 18_000;
const AGENT_SEARCH_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const AGENT_SEARCH_DIAGNOSTIC_CHARS = 8_192;
const AGENT_SEARCH_ENGINES = new Set(['bing', 'baidu', 'sogou', 'duckduckgo', 'wikipedia']);

interface AgentSearchSession {
  client: Client;
  transport: StdioClientTransport;
}

export interface AgentSearchMcpOptions {
  dataDirectory: () => string;
  executablePath?: string;
  serverPath?: string;
}

export class AgentSearchMcpService {
  private session: AgentSearchSession | null = null;
  private connecting: Promise<AgentSearchSession> | null = null;
  private recovery: Promise<void> | null = null;
  private closing = false;
  private diagnosticTail = '';

  constructor(private readonly options: AgentSearchMcpOptions) {}

  readonly search: AgentSearchExecutor = async (request) => this.execute(request);

  async close(): Promise<void> {
    this.closing = true;
    const pending = this.connecting;
    if (pending) await pending.catch(() => undefined);
    if (this.recovery) await this.recovery.catch(() => undefined);
    await this.closeCurrentSession();
  }

  private async execute(request: AgentSearchRequest): Promise<unknown> {
    const normalized = normalizeRequest(request);
    let failedSession: AgentSearchSession | null = null;
    try {
      failedSession = await this.getSession();
      return await this.callSearch(failedSession, normalized);
    } catch (error) {
      if (!isTransportFailure(error)) throw error;
      await this.recoverFailedSession(failedSession);
      try {
        const retrySession = await this.getSession();
        return await this.callSearch(retrySession, normalized);
      } catch (retryError) {
        throw this.withDiagnostics(retryError);
      }
    }
  }

  private async callSearch(session: AgentSearchSession, request: AgentSearchRequest): Promise<unknown> {
    const result = await session.client.callTool(
      {
        name: 'free_search',
        arguments: {
          query: request.query,
          limit: request.count,
          engines: request.engines,
        },
      },
      undefined,
      { timeout: AGENT_SEARCH_TIMEOUT_MS, maxTotalTimeout: AGENT_SEARCH_TIMEOUT_MS },
    );
    if (result.isError) throw new Error(agentSearchToolError(result.content));
    if (!result.structuredContent || typeof result.structuredContent !== 'object') {
      throw new Error('Agent Search 没有返回结构化结果。');
    }
    return result.structuredContent;
  }

  private async getSession(): Promise<AgentSearchSession> {
    if (this.closing) throw new Error('Agent Search 已停止。');
    if (this.session) return this.session;
    if (this.connecting) return this.connecting;
    this.connecting = this.createSession();
    try {
      this.session = await this.connecting;
      return this.session;
    } finally {
      this.connecting = null;
    }
  }

  private async createSession(): Promise<AgentSearchSession> {
    const dataDirectory = this.options.dataDirectory();
    await mkdir(dataDirectory, { recursive: true });
    const transport = new StdioClientTransport({
      command: this.options.executablePath ?? process.execPath,
      args: [this.options.serverPath ?? resolveBundledAgentSearchServer()],
      env: {
        ...getDefaultEnvironment(),
        ELECTRON_RUN_AS_NODE: '1',
        MODE: 'stdio',
        LOG_LEVEL: 'error',
        SEARCH_PROVIDER_MODE: 'free_only',
        SEARCH_BUDGET_MAX_ELAPSED_MS: '15000',
        SEARCH_BUDGET_MAX_CALLS: '10',
        SEARCH_BUDGET_MAX_RESULTS: '60',
        SEARCH_CACHE_DIRECTORY: join(dataDirectory, 'cache'),
        PROVIDER_COOLDOWN_STORE_PATH: join(dataDirectory, 'provider-cooldowns.json'),
      },
      stderr: 'pipe',
      maxBufferSize: AGENT_SEARCH_MAX_BUFFER_BYTES,
    });
    const client = new Client({ name: 'storydream', version: '1.0.0' }, { capabilities: {} });
    client.onclose = () => {
      if (this.session?.client === client) this.session = null;
    };
    client.onerror = (error) => this.recordDiagnostic(error instanceof Error ? error.message : String(error));
    transport.stderr?.on('data', (chunk) => this.recordDiagnostic(String(chunk)));
    try {
      await client.connect(transport, { timeout: 8_000 });
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
    return { client, transport };
  }

  private async recoverFailedSession(failedSession: AgentSearchSession | null): Promise<void> {
    if (!failedSession) return;
    if (this.session && this.session !== failedSession) return;
    if (this.recovery) return this.recovery;
    this.recovery = this.closeSession(failedSession).finally(() => {
      this.recovery = null;
    });
    return this.recovery;
  }

  private async closeCurrentSession(): Promise<void> {
    const current = this.session;
    if (current) await this.closeSession(current);
  }

  private async closeSession(session: AgentSearchSession): Promise<void> {
    if (this.session === session) this.session = null;
    await session.client.close().catch(() => undefined);
  }

  private recordDiagnostic(value: string): void {
    const normalized = value.replace(/\u0000/gu, '').trim();
    if (!normalized) return;
    this.diagnosticTail = `${this.diagnosticTail}\n${normalized}`.slice(-AGENT_SEARCH_DIAGNOSTIC_CHARS);
  }

  private withDiagnostics(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = this.diagnosticTail.replace(/\s+/gu, ' ').trim().slice(-800);
    return diagnostic ? new Error(`${message}；服务诊断：${diagnostic}`) : error instanceof Error ? error : new Error(message);
  }
}

function normalizeRequest(request: AgentSearchRequest): AgentSearchRequest {
  const query = request.query.trim();
  if (!query) throw new Error('Agent Search 查询不能为空。');
  const engines = Array.from(new Set(request.engines.filter((engine) => AGENT_SEARCH_ENGINES.has(engine))));
  if (engines.length === 0) throw new Error('Agent Search 没有可用的搜索引擎。');
  const count = Math.max(1, Math.min(15, Math.round(request.count)));
  return { query, engines, count };
}

function resolveBundledAgentSearchServer(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDirectory, AGENT_SEARCH_SERVER_FILENAME),
    join(process.cwd(), 'dist-electron', 'electron', AGENT_SEARCH_SERVER_FILENAME),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) throw new Error('Agent Search 内置服务文件缺失，请重新安装或构建 StoryDream。');
  return resolved;
}

function isTransportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /transport|connection closed|not connected|broken pipe|econnreset|econnrefused|spawn/iu.test(message);
}

function agentSearchToolError(content: unknown): string {
  if (!Array.isArray(content)) return 'Agent Search 执行失败。';
  const text = content
    .filter((item): item is { type: 'text'; text: string } => Boolean(item && typeof item === 'object' && (item as { type?: unknown }).type === 'text' && typeof (item as { text?: unknown }).text === 'string'))
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(' ');
  return text || 'Agent Search 执行失败。';
}
