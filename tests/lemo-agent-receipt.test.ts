import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyMessagesReceipt } from '../services/lemo-agent-worker/message-receipt';
import { startLemoMessagesGateway } from '../services/lemo-agent-worker/messages-gateway';
import { LemoRequestLedger, requestFingerprint } from '../services/lemo-agent-worker/request-ledger';

type Event = { type: string; [key: string]: unknown };
const event = (type: string, fields: Record<string, unknown> = {}): Event => ({ type, ...fields });
const messageStart = () => event('message_start', { message: {
  id: 'msg_receipt_fixture', type: 'message', role: 'assistant', model: 'offline-model',
  content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 },
} });
const blockStart = (index: unknown, content_block: unknown) => event('content_block_start', { index, content_block });
const blockDelta = (index: unknown, delta: unknown) => event('content_block_delta', { index, delta });
const blockStop = (index: unknown) => event('content_block_stop', { index });
const terminal = (stopReason = 'end_turn'): Event[] => [
  event('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 2 } }),
  event('message_stop'),
];
const textStart = { type: 'text', text: '' };
const toolStart = { type: 'tool_use', id: 'toolu_receipt_fixture', name: 'Skill', input: {} };
const thinkingStart = { type: 'thinking', thinking: '', signature: '' };
const textDelta = { type: 'text_delta', text: '中文正文里的 message_stop 不是事件' };
const toolDelta = { type: 'input_json_delta', partial_json: '{"skill":"lemo-opuscar:lemo-opuscar"}' };
const textBlock = (index = 0) => [blockStart(index, textStart), blockDelta(index, textDelta), blockStop(index)];
const toolBlock = (partialJson: string) => [blockStart(0, toolStart),
  blockDelta(0, { type: 'input_json_delta', partial_json: partialJson }), blockStop(0)];
const complete = (body: Event[], stopReason = 'end_turn') => [messageStart(), ...body, ...terminal(stopReason)];
const wire = (events: Event[]) => Buffer.from(events.map(value =>
  `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join(''), 'utf8');
const verify = (events: Event[]) => verifyMessagesReceipt(wire(events), true);

describe('complete Messages SSE content blocks', () => {
  const toolJson = JSON.stringify({ skill: 'lemo-opuscar:lemo-opuscar', options: { title: '中文 \"引用\"', paths: ['a', 'b'] } });
  const valid: Array<[string, Event[], string]> = [
    ['text fixture used by the gateway', complete(textBlock()), 'end_turn'],
    ['empty text block', complete([blockStart(0, textStart), blockStop(0)]), 'end_turn'],
    ['text already present in the starting block', complete([blockStart(0, { type: 'text', text: 'seed' }), blockStop(0)]), 'end_turn'],
    ['multiple text blocks', complete([...textBlock(0), ...textBlock(1)]), 'end_turn'],
    ['tool fixture used by the offline SDK smoke', complete([blockStart(0, toolStart), blockDelta(0, toolDelta), blockStop(0)], 'tool_use'), 'tool_use'],
    ['fragmented nested tool JSON', complete([blockStart(0, toolStart),
      ...[toolJson.slice(0, 1), toolJson.slice(1, 19), toolJson.slice(19)].map(partial_json =>
        blockDelta(0, { type: 'input_json_delta', partial_json })), blockStop(0)], 'tool_use'), 'tool_use'],
    ['argument-free tool without JSON deltas', complete([blockStart(0, toolStart), blockStop(0)], 'tool_use'), 'tool_use'],
    ['complete tool input in the starting block', complete([blockStart(0, { ...toolStart, input: { skill: 'local' } }), blockStop(0)], 'tool_use'), 'tool_use'],
    ['sequential tool calls', complete([blockStart(0, toolStart), blockDelta(0, toolDelta), blockStop(0),
      blockStart(1, { ...toolStart, id: 'toolu_second' }), blockDelta(1, toolDelta), blockStop(1)], 'tool_use'), 'tool_use'],
    ['thinking with an opaque signature', complete([blockStart(0, thinkingStart),
      blockDelta(0, { type: 'thinking_delta', thinking: 'private reasoning' }),
      blockDelta(0, { type: 'signature_delta', signature: 'opaque-signature' }), blockStop(0), ...textBlock(1)]), 'end_turn'],
    ['redacted thinking followed by text', complete([blockStart(0, { type: 'redacted_thinking', data: 'opaque-data' }), blockStop(0), ...textBlock(1)]), 'end_turn'],
    ['text then tool', complete([...textBlock(0), blockStart(1, toolStart), blockDelta(1, toolDelta), blockStop(1)], 'tool_use'), 'tool_use'],
    ['max_tokens with a complete text block', complete(textBlock(), 'max_tokens'), 'max_tokens'],
    ['empty content at the output limit', complete([], 'max_tokens'), 'max_tokens'],
    ['ping between lifecycle events', [event('ping'), messageStart(), blockStart(0, textStart), event('ping'),
      blockDelta(0, textDelta), blockStop(0), terminal()[0], event('ping'), terminal()[1]], 'end_turn'],
  ];
  it.each(valid)('accepts %s and hashes the original bytes', (_name, events, stopReason) => {
    const bytes = wire(events);
    expect(verifyMessagesReceipt(bytes, true)).toEqual({ messageId: 'msg_receipt_fixture', stopReason,
      responseSha256: createHash('sha256').update(bytes).digest('hex') });
  });
  it('preserves CRLF and UTF-8 bytes in the receipt hash', () => {
    const bytes = Buffer.from(wire(complete(textBlock())).toString('utf8').replace(/\n/g, '\r\n'));
    expect(verifyMessagesReceipt(bytes, true).responseSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
  it('keeps the existing non-streaming receipt contract', () => {
    const bytes = Buffer.from(JSON.stringify({ id: 'msg_json', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: '中文' }], stop_reason: 'end_turn' }));
    expect(verifyMessagesReceipt(bytes, false)).toMatchObject({ messageId: 'msg_json', stopReason: 'end_turn' });
  });
});

describe('Messages SSE block lifecycle rejection', () => {
  const invalidBodies: Array<[string, Event[]]> = [
    ['delta without a started block', [blockDelta(0, textDelta)]],
    ['the original orphaned tool delta', [blockDelta(42, { type: 'input_json_delta', partial_json: '{' })]],
    ['stop without a started block', [blockStop(0)]],
    ['a skipped first index', textBlock(1)],
    ['a skipped later index', [...textBlock(0), ...textBlock(2)]],
    ['a reused completed index', [...textBlock(0), ...textBlock(0)]],
    ['a duplicate active start', [blockStart(0, textStart), blockStart(0, textStart)]],
    ['overlapping blocks', [blockStart(0, textStart), blockStart(1, textStart)]],
    ['delta for a different index', [blockStart(0, textStart), blockDelta(1, textDelta), blockStop(0)]],
    ['stop for a different index', [blockStart(0, textStart), blockStop(1)]],
    ['delta after block stop', [...textBlock(), blockDelta(0, textDelta)]],
    ['a duplicate block stop', [...textBlock(), blockStop(0)]],
    ['terminal receipt while text remains open', [blockStart(0, textStart), blockDelta(0, textDelta)]],
    ['terminal receipt while a tool remains open', [blockStart(0, toolStart), blockDelta(0, toolDelta)]],
  ];
  it.each(invalidBodies)('rejects %s despite a terminal receipt', (_name, body) => {
    expect(() => verify(complete(body))).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
  it.each([-1, 0.5, '0', null, undefined, Number.MAX_SAFE_INTEGER + 1])('rejects invalid index %s on every block event', index => {
    for (const body of [[blockStart(index, textStart), blockStop(0)],
      [blockStart(0, textStart), blockDelta(index, textDelta), blockStop(0)],
      [blockStart(0, textStart), blockStop(index)]]) {
      expect(() => verify(complete(body))).toThrow('LEMO_GATEWAY_INCOMPLETE');
    }
  });
  it.each([blockStart(1, textStart), blockDelta(0, textDelta), blockStop(0)])('rejects $type after message_delta', extra => {
    expect(() => verify([messageStart(), ...textBlock(), terminal()[0], extra, terminal()[1]])).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
  it.each([
    ['content before message_start', [...textBlock(), messageStart(), ...terminal()]],
    ['message_stop before message_delta', [messageStart(), ...textBlock(), event('message_stop')]],
    ['repeated message_delta', [messageStart(), ...textBlock(), terminal()[0], ...terminal()]],
    ['a second message_start', [messageStart(), messageStart(), ...textBlock(), ...terminal()]],
    ['an event after message_stop', [...complete(textBlock()), blockStart(1, textStart)]],
    ['prepopulated message_start content', [event('message_start', { message: { id: 'msg_hidden', type: 'message', role: 'assistant',
      content: [{ type: 'tool_use', input: 'hidden' }] } }), ...terminal()]],
  ] satisfies Array<[string, Event[]]>)('rejects %s', (_name, events) => {
    expect(() => verify(events)).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
});

describe('Messages SSE content payload rejection', () => {
  it.each([null, {}, { type: 'unknown_extension' }, { type: 'text' }, { type: 'text', text: 1 },
    { type: 'thinking', thinking: '', signature: 1 }, { type: 'thinking', signature: '' },
    { type: 'redacted_thinking', data: null }, { ...toolStart, id: '' }, { ...toolStart, name: 5 },
    { ...toolStart, input: null }, { ...toolStart, input: [] }, { ...toolStart, input: '{}' },
  ])('rejects an invalid block payload: %j', contentBlock => {
    expect(() => verify(complete([blockStart(0, contentBlock), blockStop(0)]))).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
  it.each([
    [textStart, null], [textStart, {}], [textStart, { type: 'text_delta', text: 5 }], [textStart, toolDelta],
    [textStart, { type: 'thinking_delta', thinking: 'wrong block' }],
    [thinkingStart, textDelta], [thinkingStart, toolDelta],
    [thinkingStart, { type: 'thinking_delta', thinking: false }],
    [thinkingStart, { type: 'signature_delta', signature: null }],
    [toolStart, textDelta], [toolStart, { type: 'input_json_delta', partial_json: {} }],
    [toolStart, { type: 'future_delta', partial_json: '{}' }],
    [{ type: 'redacted_thinking', data: 'opaque' }, { type: 'thinking_delta', thinking: 'unexpected' }],
  ])('rejects a mismatched or malformed block delta: %j / %j', (contentBlock, delta) => {
    expect(() => verify(complete([blockStart(0, contentBlock), blockDelta(0, delta), blockStop(0)]))).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
  it.each(['', ' ', '{', '{"skill":', '{"skill":"unterminated}', '{"a":1,}', '{}{}', '{} trailing',
    'null', '[]', '[{}]', '1', 'true', '"string"'])('rejects incomplete or non-object tool JSON %j', partialJson => {
    expect(() => verify(complete(toolBlock(partialJson), 'tool_use'))).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
  it('does not disclose private malformed tool arguments in its error', () => {
    expect(() => verify(complete(toolBlock('{"private":"secret-text'), 'tool_use'))).toThrow(/^LEMO_GATEWAY_INCOMPLETE$/);
  });
});

const citations = [
  { type: 'char_location', cited_text: 'quote', document_index: 0, document_title: null, file_id: null, start_char_index: 0, end_char_index: 5 },
  { type: 'page_location', cited_text: 'quote', document_index: 0, document_title: 'PDF', file_id: 'file_example', start_page_number: 1, end_page_number: 2 },
  { type: 'content_block_location', cited_text: 'quote', document_index: 0, document_title: null, file_id: null, start_block_index: 0, end_block_index: 1 },
  { type: 'search_result_location', cited_text: 'quote', search_result_index: 0, source: 'local document', title: null, start_block_index: 0, end_block_index: 1 },
  { type: 'web_search_result_location', cited_text: 'quote', encrypted_index: 'opaque-index', title: null, url: 'https://example.invalid/source' },
];
const completeResultBlocks: Array<Record<string, unknown>> = [
  { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
    { type: 'web_search_result', url: 'https://example.invalid/source', title: 'Source', encrypted_content: 'opaque', page_age: null },
  ] },
  { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } },
  { type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'web_fetch_tool_result_error', error_code: 'unavailable' } },
  { type: 'advisor_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'advisor_tool_result_error', error_code: 'unavailable' } },
  { type: 'code_execution_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'code_execution_tool_result_error', error_code: 'unavailable' } },
  { type: 'bash_code_execution_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'bash_code_execution_tool_result_error', error_code: 'unavailable' } },
  { type: 'text_editor_code_execution_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'text_editor_code_execution_tool_result_error', error_code: 'unavailable', error_message: null } },
  { type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'tool_search_tool_result_error', error_code: 'unavailable', error_message: null } },
  { type: 'mcp_tool_result', tool_use_id: 'mcptoolu_1', is_error: false, content: 'complete result' },
  { type: 'mcp_tool_result', tool_use_id: 'mcptoolu_1', is_error: true, content: [{ type: 'text', text: 'error evidence', citations: null }] },
  { type: 'mcp_tool_listing', mcp_server_name: 'local', tools: [{ name: 'preview', input_schema: { type: 'object' }, description: 'Preview' }] },
  { type: 'container_upload', file_id: 'file_example' },
  { type: 'fallback', from: { model: 'offline-primary' }, to: { model: 'offline-secondary' }, trigger: { type: 'refusal', category: null } },
];
const jsonReceipt = (content: unknown) => verifyMessagesReceipt(Buffer.from(JSON.stringify({
  id: 'msg_json', type: 'message', role: 'assistant', content, stop_reason: 'end_turn',
})), false);

describe('known Anthropic Messages and beta block shapes', () => {
  it.each(citations)('accepts $type citations in both starting text and deltas', citation => {
    expect(() => verify(complete([blockStart(0, { ...textStart, citations: [citation] }),
      blockDelta(0, { type: 'citations_delta', citation }), blockStop(0)]))).not.toThrow();
    expect(() => jsonReceipt([{ ...textStart, citations: [citation] }])).not.toThrow();
  });
  it.each([null, {}, { type: 'unknown_citation', cited_text: 'quote' }, { ...citations[0], document_index: '0' },
    { ...citations[1], start_page_number: -1 }, { ...citations[2], end_block_index: 0.5 },
    { ...citations[3], source: null }, { ...citations[4], encrypted_index: 5 }])('rejects malformed citation %j', citation => {
    expect(() => verify(complete([blockStart(0, textStart), blockDelta(0, { type: 'citations_delta', citation }), blockStop(0)])))
      .toThrow('LEMO_GATEWAY_INCOMPLETE');
    expect(() => jsonReceipt([{ ...textStart, citations: [citation] }])).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
  it.each(completeResultBlocks)('accepts complete $type envelopes without interpreting their results', contentBlock => {
    const events = complete([blockStart(0, contentBlock), blockStop(0), ...textBlock(1)]);
    const bytes = wire(events);
    expect(verifyMessagesReceipt(bytes, true).responseSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(() => jsonReceipt([contentBlock])).not.toThrow();
  });
  it.each(completeResultBlocks)('requires a stop and rejects undeclared deltas for $type', contentBlock => {
    expect(() => verify(complete([blockStart(0, contentBlock)]))).toThrow('LEMO_GATEWAY_INCOMPLETE');
    for (const delta of [textDelta, toolDelta, { type: 'thinking_delta', thinking: 'wrong' },
      { type: 'compaction_delta', content: 'wrong', encrypted_content: null }]) {
      expect(() => verify(complete([blockStart(0, contentBlock), blockDelta(0, delta), blockStop(0)])))
        .toThrow('LEMO_GATEWAY_INCOMPLETE');
    }
  });
  it.each([
    toolStart, { ...toolStart, type: 'server_tool_use', name: 'web_search' },
    { ...toolStart, type: 'mcp_tool_use', server_name: 'local' },
  ])('requires complete JSON objects for $type, including max_tokens', contentBlock => {
    expect(() => verify(complete([blockStart(0, contentBlock), blockDelta(0, toolDelta), blockStop(0)], 'tool_use'))).not.toThrow();
    for (const partial_json of ['{', '[]', 'null', '{}{}']) {
      expect(() => verify(complete([blockStart(0, contentBlock), blockDelta(0, { type: 'input_json_delta', partial_json }), blockStop(0)], 'max_tokens')))
        .toThrow('LEMO_GATEWAY_INCOMPLETE');
    }
    expect(() => jsonReceipt([{ ...contentBlock, input: 'not an input object' }])).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
  it.each([null, 'compact summary'])('accepts the declared beta compaction delta with content %s', content => {
    expect(() => verify(complete([blockStart(0, { type: 'compaction', content: null, encrypted_content: null }),
      blockDelta(0, { type: 'compaction_delta', content, encrypted_content: 'opaque' }), blockStop(0)]))).not.toThrow();
    expect(() => jsonReceipt([{ type: 'compaction', content, encrypted_content: null, signature: null }])).not.toThrow();
  });
  it('accepts beta-gated compaction metadata when omitted, as the SDK accumulator does', () => {
    expect(() => verify(complete([blockStart(0, { type: 'compaction', content: null }),
      blockDelta(0, { type: 'compaction_delta', content: 'summary' }), blockStop(0)]))).not.toThrow();
  });
  it.each([textDelta, toolDelta, { type: 'compaction_delta', content: {} },
    { type: 'compaction_delta', content: 'summary', encrypted_content: 5 }])('rejects invalid compaction delta %j', delta => {
    expect(() => verify(complete([blockStart(0, { type: 'compaction', content: null }), blockDelta(0, delta), blockStop(0)])))
      .toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
  it.each([
    { type: 'unknown_block', content: {} }, { type: 'web_search_tool_result', tool_use_id: 'x', content: [null] },
    { type: 'code_execution_tool_result', tool_use_id: '', content: { type: 'code_execution_result' } },
    { type: 'advisor_tool_result', tool_use_id: 'x', content: null },
    { type: 'mcp_tool_result', tool_use_id: 'x', is_error: false, content: [null] },
    { type: 'mcp_tool_listing', mcp_server_name: 'local', tools: [{ name: 'x', input_schema: null }] },
    { type: 'container_upload', file_id: 5 }, { type: 'compaction', content: {} },
    { type: 'fallback', from: {}, to: {}, trigger: { type: 'unknown' } },
    { ...toolStart, type: 'server_tool_use', name: 'unknown_server_tool' },
    { ...toolStart, type: 'mcp_tool_use' },
  ])('rejects an invalid known-block envelope or unknown extension: %j', contentBlock => {
    expect(() => verify(complete([blockStart(0, contentBlock), blockStop(0)]))).toThrow('LEMO_GATEWAY_INCOMPLETE');
    expect(() => jsonReceipt([contentBlock])).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
});

describe('non-streaming Messages content completeness', () => {
  it.each([[], [textStart], [toolStart], [thinkingStart], [{ type: 'redacted_thinking', data: 'opaque' }],
    [textStart, { ...toolStart, input: { skill: 'local', options: { count: 1 } } }]].map(content => ({ content })))('accepts complete known content $content', ({ content }) => {
    expect(jsonReceipt(content)).toMatchObject({ messageId: 'msg_json', stopReason: 'end_turn' });
  });
  it.each([null, {}, [null], [1], [{}], [{ type: 'text', text: null }], [{ ...toolStart, input: '[' }],
    [{ ...toolStart, input: [] }], [{ ...toolStart, input: null }], [{ ...toolStart, name: '' }],
    [{ type: 'thinking', thinking: 'reasoning', signature: 5 }]].map(content => ({ content })))('rejects malformed complete-message content $content', ({ content }) => {
    expect(() => jsonReceipt(content)).toThrow('LEMO_GATEWAY_INCOMPLETE');
  });
});

describe('gateway rejection of unusable provider content', () => {
  it.each([false, true])('keeps malformed stream=%s unknown without committing a response or retrying', async stream => {
    const directory = await mkdtemp(join(tmpdir(), 'lemo-receipt-rejection-'));
    let calls = 0;
    const upstream = createServer(async (req, res) => {
      for await (const _chunk of req) { /* Drain the local fixture request. */ }
      calls++;
      res.writeHead(200, { 'content-type': stream ? 'text/event-stream' : 'application/json' });
      res.end(stream ? wire(complete(toolBlock('{"private":'), 'max_tokens')) : JSON.stringify({
        id: 'msg_malformed', type: 'message', role: 'assistant', content: [null], stop_reason: 'end_turn',
      }));
    });
    let ledger: LemoRequestLedger | undefined;
    let gateway: Awaited<ReturnType<typeof startLemoMessagesGateway>> | undefined;
    try {
      await new Promise<void>((done, fail) => { upstream.once('error', fail); upstream.listen(0, '127.0.0.1', done); });
      const address = upstream.address();
      if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS');
      const endpoint = `http://127.0.0.1:${address.port}/v1/messages`;
      ledger = await LemoRequestLedger.open(directory, 4);
      gateway = await startLemoMessagesGateway({ ledger, provider: { protocol: 'anthropic', messagesUrl: endpoint,
        apiKey: 'local-fixture-only', auth: 'x-api-key', model: 'offline-model' }, maxOutputTokens: 256, timeoutMs: 3000, allowLoopbackTestProvider: true });
      const body = { model: 'offline-model', max_tokens: 256, stream, messages: [{ role: 'user', content: 'fixture prompt' }] };
      const send = (requestBody: unknown) => fetch(gateway!.baseUrl + '/v1/messages', { method: 'POST',
        headers: { 'x-api-key': gateway!.localToken, 'content-type': 'application/json' }, body: JSON.stringify(requestBody) });
      const response = await send(body);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('LEMO_GATEWAY_INCOMPLETE');
      expect(ledger.summary()).toMatchObject({ received: 0, unknown: 1, blocked: true });
      const entry = ledger.lookup(requestFingerprint({ endpoint, body }));
      expect(entry?.receipt?.outcome).toBe('unknown');
      await expect(stat(join(ledger.responseDirectory, entry!.requestId))).rejects.toMatchObject({ code: 'ENOENT' });
      const retry = await send({ ...body, messages: [{ role: 'user', content: 'different internal retry' }] });
      expect(retry.status).toBe(400);
      expect(await retry.text()).toContain('LEMO_LEDGER_BLOCKED');
      expect(calls).toBe(1);
    } finally {
      await gateway?.close();
      await ledger?.close();
      upstream.closeAllConnections();
      await new Promise<void>(done => upstream.close(() => done()));
      if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('UNSAFE_TEST_CLEANUP');
      await rm(directory, { recursive: true, force: true });
    }
  });
});
