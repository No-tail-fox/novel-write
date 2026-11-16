import { createHash } from 'node:crypto';
export type PiProtocol = 'anthropic' | 'openai-chat' | 'openai-responses';
export interface PiReceipt {
  outcome: 'received' | 'rejected' | 'unknown';
  httpStatus?: number;
  protocol?: PiProtocol;
  messageId?: string;
  stopReason?: string;
  terminalEvidence?: string;
  usage?: Record<string, unknown>;
  usageStatus?: 'known' | 'unknown';
  responseSha256?: string;
}
export function object(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function fail(): never { throw new Error('PI_GATEWAY_INCOMPLETE'); }
function usage(v: unknown): Record<string, unknown> | undefined {
  if (!object(v)) return undefined;
  // Retain provider usage details (including cached/reasoning tokens) without normalization loss.
  const check = (x: unknown): boolean => typeof x === 'number' ? Number.isFinite(x) && x >= 0
    : object(x) ? Object.values(x).every(check) : x === null;
  if (!Object.keys(v).length || !check(v)) return undefined;
  return v;
}
export function verifyPiReceipt(bytes: Uint8Array, protocol: PiProtocol, stream: boolean): PiReceipt {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let id: unknown; let reason: unknown; let tokens: Record<string, unknown> | undefined; let terminal = '';
  const response = (v: any) => {
    if (!object(v) || v.object !== 'response' || !['completed', 'incomplete', 'failed'].includes(v.status) || !Array.isArray(v.output)) fail();
    id = v.id; reason = v.status === 'incomplete' && object(v.incomplete_details) && typeof v.incomplete_details.reason === 'string'
      ? v.incomplete_details.reason : v.status;
    terminal = `response.${v.status}`; tokens = usage(v.usage);
  };
  if (!stream) {
    const v = JSON.parse(text);
    if (!object(v) || (v.error && protocol !== 'openai-responses')) fail();
    if (protocol === 'anthropic') {
      if (v.type !== 'message' || v.role !== 'assistant' || !Array.isArray(v.content)) fail();
      id = v.id; reason = v.stop_reason; tokens = usage(v.usage); terminal = 'message.stop_reason';
    } else if (protocol === 'openai-chat') {
      if (v.object !== 'chat.completion' || !Array.isArray(v.choices) || !v.choices.length
        || v.choices.some((c: any) => !object(c) || !object(c.message) || c.message.role !== 'assistant' || typeof c.finish_reason !== 'string' || !c.finish_reason)) fail();
      id = v.id; reason = v.choices.map((c: any) => c.finish_reason).join(','); tokens = usage(v.usage); terminal = 'choices.finish_reason';
    } else { response(v); }
  } else {
    if (!/\r?\n\r?\n$/.test(text)) fail();
    let started = false; let finished = false; let delta = false;
    const choices = new Map<number, boolean>();
    for (const frame of text.replace(/\r\n/g, '\n').split('\n\n')) {
      let event = ''; const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      if (finished) fail();
      const raw = data.join('\n');
      if (protocol === 'openai-chat' && raw === '[DONE]') {
        if (!started || !choices.size || [...choices.values()].some(x => !x)) fail();
        finished = true; terminal = '[DONE]+choices.finish_reason'; continue;
      }
      const v = JSON.parse(raw);
      if (!object(v) || v.error || event === 'error') fail();
      if (protocol === 'anthropic') {
        if (event && event !== v.type) fail();
        if (v.type === 'ping') continue;
        if (v.type === 'message_start') {
          if (started || !object(v.message) || v.message.type !== 'message' || v.message.role !== 'assistant') fail();
          started = true; id = v.message.id; tokens = usage(v.message.usage);
        } else if (!started) fail();
        else if (v.type === 'message_delta') {
          if (delta || !object(v.delta)) fail();
          delta = true; reason = v.delta.stop_reason; tokens = { ...tokens, ...usage(v.usage) };
        } else if (v.type === 'message_stop') {
          if (!delta) fail(); finished = true; terminal = 'message_stop';
        } else if (!['content_block_start', 'content_block_delta', 'content_block_stop'].includes(v.type)) fail();
      } else if (protocol === 'openai-chat') {
        if (v.object !== 'chat.completion.chunk' || !Array.isArray(v.choices) || (started && v.id !== id)) fail();
        started = true; id = v.id;
        for (const c of v.choices) {
          if (!object(c) || !Number.isInteger(c.index) || choices.get(c.index)) fail();
          const done = typeof c.finish_reason === 'string' && !!c.finish_reason;
          choices.set(c.index, done); if (done) reason = reason ? `${reason},${c.finish_reason}` : c.finish_reason;
        }
        if (v.usage != null) tokens = usage(v.usage);
      } else {
        if (event && event !== v.type) fail();
        if (typeof v.type !== 'string' || !v.type.startsWith('response.')) fail();
        if (v.type === 'response.error') fail();
        if (['response.completed', 'response.incomplete', 'response.failed'].includes(v.type)) {
          response(v.response); if (terminal !== v.type) fail(); finished = true;
        }
      }
    }
    if (!finished) fail();
  }
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || typeof reason !== 'string' || !reason) fail();
  const requiredTokens = protocol === 'openai-chat' ? ['prompt_tokens', 'completion_tokens'] : ['input_tokens', 'output_tokens'];
  const known = !!tokens && requiredTokens.every(key => typeof tokens![key] === 'number' && Number.isSafeInteger(tokens![key]));
  return { outcome: 'received', httpStatus: 200, protocol, messageId: id, stopReason: reason,
    terminalEvidence: terminal, usageStatus: known ? 'known' : 'unknown', ...(tokens ? { usage: tokens } : {}),
    responseSha256: createHash('sha256').update(bytes).digest('hex') };
}
