import { fetchWithTimeout } from './http';
import type { NetworkFetch } from './network-policy';
import type { ImaConfig, ImaKnowledgeRecord, ImaKnowledgeRequest, ImaKnowledgeResult } from './types';

export const IMA_KNOWLEDGE_ENDPOINT = 'https://ima.qq.com/openapi/wiki/v1/search_knowledge';
const IMA_RESPONSE_MAX_BYTES = 256 * 1024;
const IMA_RECORD_LIMIT = 20;
const IMA_TITLE_LIMIT = 512;
const IMA_SNIPPET_LIMIT = 4_000;
const IMA_URL_LIMIT = 4_096;

export interface ImaKnowledgeDependencies {
  fetchImpl?: NetworkFetch;
  timeoutMs?: number;
  now?: () => number;
  signal?: AbortSignal;
}

export async function fetchImaKnowledge(
  inputConfig: ImaConfig,
  input: ImaKnowledgeRequest,
  dependencies: ImaKnowledgeDependencies = {},
): Promise<ImaKnowledgeResult> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const config = {
    clientId: inputConfig.clientId.trim(),
    apiKey: inputConfig.apiKey.trim(),
    kbId: inputConfig.kbId.trim(),
    kbName: inputConfig.kbName.trim(),
  };
  const knowledgeBaseId = config.kbId || config.kbName;
  const query = input.query.trim();
  const failure = (detail: string, requestId: string | null = null): ImaKnowledgeResult => ({
    status: 'fail',
    detail: redactImaCredentials(detail, config),
    latencyMs: Math.max(0, now() - startedAt),
    endpoint: IMA_KNOWLEDGE_ENDPOINT,
    requestId,
    knowledgeBaseId,
    records: [],
    totalCount: 0,
  });

  if (!config.clientId) return failure('IMA client ID is required.');
  if (!config.apiKey) return failure('IMA API key is required.');
  if (!knowledgeBaseId) return failure('IMA knowledge base ID or name is required.');
  if (!query) return failure('IMA knowledge query is required.');
  if (config.clientId.length > 1_024 || config.apiKey.length > 4_096 || knowledgeBaseId.length > 4_096 || query.length > 1_024) {
    return failure('IMA configuration or query exceeds its allowed length.');
  }
  if (hasControlCharacters(config.clientId) || hasControlCharacters(config.apiKey)) {
    return failure('IMA credentials contain invalid control characters.');
  }

  let requestId: string | null = null;
  try {
    const response = await fetchWithTimeout(IMA_KNOWLEDGE_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'ima-openapi-clientid': config.clientId,
        'ima-openapi-apikey': config.apiKey,
      },
      body: JSON.stringify({ query, cursor: '', knowledge_base_id: knowledgeBaseId }),
      purpose: 'ima-api',
      timeoutMs: dependencies.timeoutMs ?? 20_000,
      timeoutLabel: 'IMA knowledge request',
      maxBytes: IMA_RESPONSE_MAX_BYTES,
      fetchImpl: dependencies.fetchImpl,
      signal: dependencies.signal,
    });
    requestId = boundedString(response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? '', 256) || null;
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return failure('IMA response contains invalid JSON.', requestId);
    }
    if (!isRecord(payload)) return failure('IMA response has an invalid object shape.', requestId);
    const code = payload.code === undefined ? 0 : Number(payload.code);
    if (!response.ok || !Number.isFinite(code) || code !== 0) {
      const providerDetail = firstString(payload, ['message', 'msg', 'error']);
      return failure(`IMA provider rejected the request (${response.status}/${String(payload.code ?? 'unknown')}): ${providerDetail}`, requestId);
    }

    const entries = extractEntries(payload.data ?? payload);
    const records = entries.slice(0, IMA_RECORD_LIMIT).map(toRecord);
    return {
      status: 'pass',
      detail: `IMA knowledge base is reachable; fetched ${records.length} record summaries.`,
      latencyMs: Math.max(0, now() - startedAt),
      endpoint: IMA_KNOWLEDGE_ENDPOINT,
      requestId,
      knowledgeBaseId,
      records,
      totalCount: entries.length,
    };
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error), requestId);
  }
}

function extractEntries(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) return input.filter(isRecord);
  if (!isRecord(input)) return [];
  for (const key of ['list', 'records', 'items', 'knowledge_list', 'knowledgeList', 'results']) {
    const value = input[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function toRecord(entry: Record<string, unknown>, index: number): ImaKnowledgeRecord {
  const id = boundedString(firstString(entry, ['id', 'media_id', 'doc_id', 'target_id']) || `record-${index + 1}`, 256);
  const title = boundedString(firstString(entry, ['title', 'name', 'doc_name', 'knowledge_name']) || `IMA record ${index + 1}`, IMA_TITLE_LIMIT);
  const snippet = boundedString(firstString(entry, ['highlight_content', 'content', 'summary', 'description', 'text']), IMA_SNIPPET_LIMIT);
  const url = boundedString(firstString(entry, ['url', 'doc_url']), IMA_URL_LIMIT);
  return { id, title, snippet, ...(url ? { url } : {}) };
}

function redactImaCredentials(detail: string, config: Pick<ImaConfig, 'clientId' | 'apiKey'>): string {
  let output = boundedString(detail, 2_000);
  for (const secret of [config.apiKey, config.clientId]) {
    if (secret) output = output.split(secret).join('[redacted]');
  }
  return output.replace(/(ima-openapi-(?:apikey|clientid)\s*[:=]\s*)[^\s,;]+/giu, '$1[redacted]');
}

function boundedString(value: string, limit: number): string {
  return value.trim().slice(0, limit);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function firstString(input: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    if (typeof input[key] === 'string') return input[key];
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
