import type { LlmTextResult } from './llm-provider';
import type { LlmProtocol } from './llm-protocol';

/** Retain received code without pretending an interrupted paid request has finished. */
export class LlmTextInterruptedError extends Error {
  constructor(readonly result: LlmTextResult, cause: unknown) {
    const received = result.text.length
      ? `已保留 ${result.text.length} 个正文字符（不代表完整结果）`
      : '尚未收到正文，仅保留已收到的回执信息';
    const receipt = result.requestId
      ? `服务商请求编号：${result.requestId}；`
      : '未收到服务商请求编号；';
    super(`LLM_STREAM_INTERRUPTED: 流式回复中断，${received}；${receipt}云端最终结果仍待核对。` + (cause instanceof Error ? ' ' + cause.message : ''), { cause });
    this.name = 'LlmTextInterruptedError';
  }
}

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v && typeof v === 'object' && !Array.isArray(v) ? v as ObjectValue : {};
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const contentText = (v: unknown): string => typeof v === 'string' ? v : Array.isArray(v)
  ? v.map(p => { const part = object(p); return ['text', 'output_text'].includes(text(part.type)) ? text(part.text) : ''; }).join('') : '';

/** SSE framing handles UTF-8 and event boundaries split at arbitrary byte offsets. */
export class LlmTextStream {
  private decoder = new TextDecoder();
  private buffer = '';
  private data: string[] = [];
  private event = '';
  private body = '';
  private id: string | null = null;
  private reason: string | null = null;
  private usage: ObjectValue | undefined;
  private problem: Error | undefined;
  private terminal = false;
  private seen = false;
  active = false;
  constructor(private protocol: LlmProtocol) {}

  accept = (chunk: Uint8Array, response: Response) => {
    if (!response.ok || !/text\/event-stream/i.test(response.headers.get('content-type') ?? '')) return;
    this.active = true;
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.lines(false);
  };
  get hasEvidence() { return this.seen || Boolean(this.id) || Boolean(this.body); }
  get completed() { return this.terminal && !this.problem; }
  snapshot(): LlmTextResult {
    return { text: this.body, raw: this.body, requestId: this.id, ...(this.reason ? { finishReason: this.reason } : {}), ...(this.usage ? { usage: this.usage } : {}) };
  }
  finish(): LlmTextResult {
    this.buffer += this.decoder.decode();
    this.lines(true);
    // An unterminated event may contain useful deltas, but cannot prove completion.
    if (this.data.length) this.dispatch(false);
    if (!this.completed) throw new LlmTextInterruptedError(this.snapshot(), this.problem ?? new Error('未收到模型回复的结束标记。'));
    return this.snapshot();
  }
  interrupted(cause: unknown): LlmTextInterruptedError { return new LlmTextInterruptedError(this.snapshot(), this.problem ?? cause); }

  private lines(final: boolean) {
    while (true) {
      const i = this.buffer.search(/[\r\n]/);
      if (i < 0 || (!final && i === this.buffer.length - 1 && this.buffer[i] === '\r')) break;
      const length = this.buffer[i] === '\r' && this.buffer[i + 1] === '\n' ? 2 : 1;
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + length);
      this.line(line);
    }
    if (final && this.buffer) { this.line(this.buffer); this.buffer = ''; }
  }
  private line(line: string) {
    if (!line) { this.dispatch(true); return; }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
  }
  private dispatch(framed: boolean) {
    const raw = this.data.join('\n'), event = this.event;
    this.data = []; this.event = '';
    if (!raw || this.problem) return;
    if (raw.trim() === '[DONE]') { if (framed && this.protocol === 'openai') this.terminal = true; return; }
    let value: ObjectValue;
    try { value = object(JSON.parse(raw)); }
    catch { this.problem = new Error('流式回复包含损坏的 JSON 事件。'); return; }
    this.seen = true;
    const type = text(value.type) || event;
    if (type === 'error' || value.error) {
      this.problem = new Error(text(object(value.error).message) || text(value.message) || '模型流式服务返回错误。'); return;
    }
    if (this.protocol === 'openai') {
      if (typeof value.id === 'string') this.id = value.id;
      if (value.usage) this.usage = object(value.usage);
      const choice = (Array.isArray(value.choices) ? value.choices : []).map(object).find(c => c.index === undefined || c.index === 0);
      if (!choice) return;
      this.body += contentText(object(choice.delta).content) || text(choice.text);
      if (typeof choice.finish_reason === 'string') { this.reason = choice.finish_reason; if (framed) this.terminal = true; }
    } else if (this.protocol === 'anthropic') {
      if (type === 'message_start') {
        const message = object(value.message);
        if (typeof message.id === 'string') this.id = message.id;
        if (message.usage) this.usage = object(message.usage);
      } else if (type === 'content_block_start') {
        const block = object(value.content_block); if (block.type === 'text') this.body += text(block.text);
      } else if (type === 'content_block_delta') {
        const delta = object(value.delta); if (delta.type === 'text_delta') this.body += text(delta.text);
      } else if (type === 'message_delta') {
        const delta = object(value.delta);
        if (typeof delta.stop_reason === 'string') this.reason = delta.stop_reason;
        if (value.usage) this.usage = { ...this.usage, ...object(value.usage) };
      } else if (type === 'message_stop' && framed) this.terminal = true;
    } else {
      const response = object(value.response);
      if (typeof response.id === 'string') this.id = response.id;
      if (response.usage) this.usage = object(response.usage);
      if (type === 'response.output_text.delta') this.body += text(value.delta);
      if (['response.completed', 'response.incomplete', 'response.failed'].includes(type)) {
        const fullText = (Array.isArray(response.output) ? response.output : []).map(p => contentText(object(p).content)).join('');
        if (fullText) this.body = fullText;
        this.reason = text(object(response.incomplete_details).reason) || text(response.status) || type.slice(9);
        if (type === 'response.failed') this.problem = new Error(text(object(response.error).message) || '模型流式回复失败。');
        else if (framed) this.terminal = true;
      }
    }
  }
}
