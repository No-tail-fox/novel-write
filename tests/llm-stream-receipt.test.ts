import { describe, expect, it } from 'vitest';
import { LlmTextInterruptedError, LlmTextStream } from '../src/shared/llm-text-stream';

const response = new Response(null, { headers: { 'content-type': 'text/event-stream' } });
function event(stream: LlmTextStream, value: unknown) {
  stream.accept(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`), response);
}

describe('interrupted stream receipt diagnostics', () => {
  it('distinguishes an Anthropic start receipt from delivered code and final usage', () => {
    const stream = new LlmTextStream('anthropic');
    event(stream, { type: 'message_start', message: {
      id: 'msg_receipt_only', usage: { input_tokens: 2, cache_creation_input_tokens: 69399, output_tokens: 1 },
    } });
    const cause = new Error('ECONNRESET');
    const error = stream.interrupted(cause);
    expect(stream.completed).toBe(false);
    expect(error).toBeInstanceOf(LlmTextInterruptedError);
    expect(error.cause).toBe(cause);
    expect(error.result.text).toBe('');
    expect(error.result.finishReason).toBeUndefined();
    expect(error.result.usage).toEqual({ input_tokens: 2, cache_creation_input_tokens: 69399, output_tokens: 1 });
    expect(error.message).toContain('尚未收到正文');
    expect(error.message).toContain('服务商请求编号：msg_receipt_only');
    expect(error.message).toContain('云端最终结果仍待核对');
    expect(error.message).not.toContain('已保留收到的文本');
    expect(() => stream.finish()).toThrow(LlmTextInterruptedError);
  });

  it('reports received character count without printing partial generated code', () => {
    const stream = new LlmTextStream('anthropic');
    event(stream, { type: 'message_start', message: { id: 'msg_partial' } });
    event(stream, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'const incomplete =' } });
    const error = stream.interrupted(new Error('socket closed'));
    expect(error.result.text).toBe('const incomplete =');
    expect(error.message).toContain(`已保留 ${error.result.text.length} 个正文字符（不代表完整结果）`);
    expect(error.message).not.toContain('const incomplete =');
    expect(error.message).toContain('服务商请求编号：msg_partial');
    expect(stream.completed).toBe(false);
  });

  it('does not invent a provider id when disconnecting before receipt', () => {
    const stream = new LlmTextStream('responses');
    const error = stream.interrupted(new Error('socket closed'));
    expect(error.result.requestId).toBeNull();
    expect(error.message).toContain('未收到服务商请求编号');
    expect(error.message).toContain('尚未收到正文');
    expect(stream.hasEvidence).toBe(false);
  });

  it('still requires the terminal event and does not apply interrupted text as success', () => {
    const stream = new LlmTextStream('anthropic');
    event(stream, { type: 'message_start', message: { id: 'msg_finished' } });
    event(stream, { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"done":true}' } });
    event(stream, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } });
    expect(stream.completed).toBe(false);
    event(stream, { type: 'message_stop' });
    expect(stream.finish()).toMatchObject({ text: '{"done":true}', requestId: 'msg_finished', finishReason: 'end_turn', usage: { output_tokens: 8 } });
  });
});