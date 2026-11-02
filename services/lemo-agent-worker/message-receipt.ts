import { createHash } from 'node:crypto';
import type { RequestReceipt } from './request-ledger';
const SAFE = /^[A-Za-z0-9_-]{1,160}$/;
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function incomplete(): never { throw new Error('LEMO_GATEWAY_INCOMPLETE'); }
function nullableString(v: unknown): boolean { return v === null || typeof v === 'string'; }
function indexValue(v: unknown): boolean { return Number.isSafeInteger(v) && (v as number) >= 0; }
function citationValid(v: unknown): boolean {
  if (!object(v) || typeof v.cited_text !== 'string') return false;
  if (v.type === 'web_search_result_location') return typeof v.encrypted_index === 'string'
    && nullableString(v.title) && typeof v.url === 'string';
  if (v.type === 'search_result_location') return indexValue(v.search_result_index) && indexValue(v.start_block_index)
    && indexValue(v.end_block_index) && typeof v.source === 'string' && nullableString(v.title);
  if (!indexValue(v.document_index) || !nullableString(v.document_title) || !nullableString(v.file_id)) return false;
  switch (v.type) {
    case 'char_location': return indexValue(v.start_char_index) && indexValue(v.end_char_index);
    case 'page_location': return indexValue(v.start_page_number) && indexValue(v.end_page_number);
    case 'content_block_location': return indexValue(v.start_block_index) && indexValue(v.end_block_index);
    default: return false;
  }
}
function textBlockValid(v: unknown): boolean {
  return object(v) && v.type === 'text' && typeof v.text === 'string' && (v.citations === undefined
    || v.citations === null || (Array.isArray(v.citations) && v.citations.every(citationValid)));
}
interface StreamBlock {
  index: number;
  type: 'text' | 'thinking' | 'redacted_thinking' | 'tool_use' | 'server_tool_use' | 'mcp_tool_use'
    | 'web_search_tool_result' | 'web_fetch_tool_result' | 'advisor_tool_result' | 'code_execution_tool_result'
    | 'bash_code_execution_tool_result' | 'text_editor_code_execution_tool_result' | 'tool_search_tool_result'
    | 'mcp_tool_result' | 'mcp_tool_listing' | 'container_upload' | 'compaction' | 'fallback';
  inputParts: string[];
}
function tracksToolInput(type: StreamBlock['type']): boolean {
  return type === 'tool_use' || type === 'server_tool_use' || type === 'mcp_tool_use';
}
// Shapes follow @anthropic-ai/sdk 1.3.0 Messages/Beta Messages types in the locked
// Agent SDK 0.3.314 install. Complete tool-result payloads stay opaque after their
// envelope checks: receipt validation does not establish tool or stage success.
function startBlock(index: number, value: unknown): StreamBlock {
  if (!object(value)) incomplete();
  switch (value.type) {
    case 'text':
      if (!textBlockValid(value)) incomplete();
      break;
    case 'thinking':
      if (typeof value.thinking !== 'string' || typeof value.signature !== 'string') incomplete();
      break;
    case 'redacted_thinking':
      if (typeof value.data !== 'string') incomplete();
      break;
    case 'tool_use':
    case 'server_tool_use':
    case 'mcp_tool_use':
      if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name || !object(value.input)) incomplete();
      if (value.type === 'mcp_tool_use' && (typeof value.server_name !== 'string' || !value.server_name)) incomplete();
      if (value.type === 'server_tool_use' && !['advisor', 'web_search', 'web_fetch', 'code_execution', 'bash_code_execution',
        'text_editor_code_execution', 'tool_search_tool_regex', 'tool_search_tool_bm25'].includes(value.name)) incomplete();
      break;
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
    case 'advisor_tool_result':
    case 'code_execution_tool_result':
    case 'bash_code_execution_tool_result':
    case 'text_editor_code_execution_tool_result':
    case 'tool_search_tool_result':
      if (typeof value.tool_use_id !== 'string' || !value.tool_use_id) incomplete();
      if (value.type === 'web_search_tool_result' && Array.isArray(value.content)) {
        if (!value.content.every(item => object(item) && item.type === 'web_search_result')) incomplete();
      } else if (!object(value.content) || typeof value.content.type !== 'string') incomplete();
      break;
    case 'mcp_tool_result':
      if (typeof value.tool_use_id !== 'string' || !value.tool_use_id || typeof value.is_error !== 'boolean'
        || !(typeof value.content === 'string' || (Array.isArray(value.content) && value.content.every(textBlockValid)))) incomplete();
      break;
    case 'mcp_tool_listing':
      if (typeof value.mcp_server_name !== 'string' || !Array.isArray(value.tools) || !value.tools.every(tool => object(tool)
        && typeof tool.name === 'string' && object(tool.input_schema) && (tool.description === undefined || typeof tool.description === 'string'))) incomplete();
      break;
    case 'container_upload':
      if (typeof value.file_id !== 'string' || !value.file_id) incomplete();
      break;
    case 'compaction':
      if (!nullableString(value.content) || (value.encrypted_content !== undefined && !nullableString(value.encrypted_content))
        || (value.signature !== undefined && !nullableString(value.signature))
        || (value.tool_changes !== undefined && value.tool_changes !== null && !Array.isArray(value.tool_changes))) incomplete();
      break;
    case 'fallback':
      if (!object(value.from) || typeof value.from.model !== 'string' || !object(value.to) || typeof value.to.model !== 'string'
        || !object(value.trigger) || value.trigger.type !== 'refusal'
        || ![null, 'cyber', 'bio', 'frontier_llm', 'reasoning_extraction', 'general_harms'].includes(value.trigger.category as string | null)) incomplete();
      break;
    default: incomplete();
  }
  return { index, type: value.type, inputParts: [] };
}
function applyBlockDelta(block: StreamBlock, value: unknown): void {
  if (!object(value)) incomplete();
  if (block.type === 'text' && value.type === 'text_delta' && typeof value.text === 'string') return;
  if (block.type === 'text' && value.type === 'citations_delta' && citationValid(value.citation)) return;
  if (block.type === 'thinking' && ((value.type === 'thinking_delta' && typeof value.thinking === 'string')
    || (value.type === 'signature_delta' && typeof value.signature === 'string'))) return;
  if (tracksToolInput(block.type) && value.type === 'input_json_delta' && typeof value.partial_json === 'string') {
    block.inputParts.push(value.partial_json);
    return;
  }
  if (block.type === 'compaction' && value.type === 'compaction_delta' && nullableString(value.content)
    && (value.encrypted_content === undefined || nullableString(value.encrypted_content))) return;
  incomplete();
}
function finishBlock(block: StreamBlock): void {
  // An argument-free tool may start and stop with input: {} and no deltas. Once
  // JSON deltas are present, all their bytes must form exactly one input object.
  if (!tracksToolInput(block.type) || !block.inputParts.length) return;
  let input: unknown;
  try { input = JSON.parse(block.inputParts.join('')); } catch { incomplete(); }
  if (!object(input)) incomplete();
}
export function verifyMessagesReceipt(bytes: Uint8Array, stream: boolean): Pick<RequestReceipt, 'messageId' | 'stopReason' | 'responseSha256'> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let messageId: unknown; let stopReason: unknown;
  if (!stream) {
    const v: unknown = JSON.parse(text);
    if (!object(v) || v.type !== 'message' || v.role !== 'assistant' || !Array.isArray(v.content)) throw new Error('LEMO_GATEWAY_INCOMPLETE');
    v.content.forEach((content, index) => startBlock(index, content));
    messageId = v.id; stopReason = v.stop_reason;
  } else {
    let started = false; let stopped = false; let delta = false;
    let nextIndex = 0; let block: StreamBlock | undefined;
    if (!/\r?\n\r?\n$/.test(text)) throw new Error('LEMO_GATEWAY_INCOMPLETE');
    for (const frame of text.replace(/\r\n/g, '\n').split('\n\n').filter(x => x.trim())) {
      let event = ''; const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      const v: unknown = JSON.parse(data.join('\n'));
      if (!object(v) || v.type !== event || stopped || event === 'error') throw new Error('LEMO_GATEWAY_INCOMPLETE');
      if (event === 'ping') continue;
      if (event === 'message_start') {
        if (started || !object(v.message) || v.message.type !== 'message' || v.message.role !== 'assistant'
          || !Array.isArray(v.message.content) || v.message.content.length) incomplete();
        started = true; messageId = v.message.id;
      } else if (!started) throw new Error('LEMO_GATEWAY_INCOMPLETE');
      else if (event === 'message_delta') {
        if (delta || block || !object(v.delta)) incomplete();
        delta = true; stopReason = v.delta.stop_reason;
      } else if (event === 'message_stop') {
        if (!delta || block) incomplete(); stopped = true;
      } else if (['content_block_start','content_block_delta','content_block_stop'].includes(event)) {
        if (delta || !Number.isSafeInteger(v.index) || (v.index as number) < 0) incomplete();
        if (event === 'content_block_start') {
          if (block || v.index !== nextIndex) incomplete();
          block = startBlock(nextIndex++, v.content_block);
        } else {
          if (!block || v.index !== block.index) incomplete();
          if (event === 'content_block_delta') applyBlockDelta(block, v.delta);
          else { finishBlock(block); block = undefined; }
        }
      } else incomplete();
    }
    if (!started || !stopped) throw new Error('LEMO_GATEWAY_INCOMPLETE');
  }
  if (typeof messageId !== 'string' || !SAFE.test(messageId) || typeof stopReason !== 'string' || !SAFE.test(stopReason)) throw new Error('LEMO_GATEWAY_INCOMPLETE');
  return { messageId, stopReason, responseSha256: createHash('sha256').update(bytes).digest('hex') };
}
