import { createHash } from 'node:crypto';
import type { LlmProtocol } from '../../src/shared/llm-protocol';
import { verifyMessagesReceipt } from './message-receipt';

type Json = Record<string, any>;
const object = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (): never => { throw new Error('LEMO_GATEWAY_INCOMPLETE'); };
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(v);
function args(value: unknown) {
  if (typeof value !== 'string') return fail();
  try { const parsed: unknown = JSON.parse(value); if (object(parsed)) return parsed; } catch { /* Fail closed. */ }
  return fail();
}
function chat(message: Json): Json {
  if (!id(message.id) || message.object !== 'chat.completion' || !Array.isArray(message.choices) || message.choices.length !== 1) return fail();
  const choice = message.choices[0]; const m = choice?.message;
  if (!object(m) || m.role !== 'assistant' || !['stop', 'tool_calls', 'length', 'content_filter'].includes(choice.finish_reason)
    || (m.content != null && typeof m.content !== 'string') || (m.tool_calls !== undefined && !Array.isArray(m.tool_calls))) return fail();
  const calls = m.tool_calls ?? []; const seen = new Set<string>();
  const content: Json[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [];
  for (const call of calls) {
    if (!object(call) || !id(call.id) || seen.has(call.id) || call.type !== 'function' || !id(call.function?.name)) return fail();
    seen.add(call.id); content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: args(call.function.arguments) });
  }
  if ((choice.finish_reason === 'tool_calls') !== (calls.length > 0)) return fail();
  return { id: message.id, content, stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason,
    usage: { input_tokens: message.usage?.prompt_tokens, output_tokens: message.usage?.completion_tokens } };
}
function responses(message: Json): Json {
  if (!id(message.id) || message.object !== 'response' || !['completed', 'incomplete'].includes(message.status)
    || message.error != null || !Array.isArray(message.output)) return fail();
  if (message.status === 'incomplete' && typeof message.incomplete_details?.reason !== 'string') return fail();
  const content: Json[] = []; const seen = new Set<string>();
  for (const item of message.output) {
    if (!object(item) || !id(item.id) || seen.has(item.id)) return fail();
    seen.add(item.id);
    if (message.status === 'completed' && item.status !== undefined && item.status !== 'completed') return fail();
    if (item.type === 'function_call') {
      if (!id(item.call_id) || !id(item.name) || seen.has('call:' + item.call_id)) return fail();
      seen.add('call:' + item.call_id); content.push({ type: 'tool_use', id: item.call_id, name: item.name, input: args(item.arguments) });
    } else if (item.type === 'message') {
      if (item.role !== 'assistant' || !Array.isArray(item.content)) return fail();
      for (const part of item.content) {
        if (part.type === 'output_text' && typeof part.text === 'string') content.push({ type: 'text', text: part.text });
        else if (part.type !== 'refusal' || typeof part.refusal !== 'string') return fail();
      }
    } else if (item.type !== 'reasoning') return fail(); // Only host-owned tools are supported.
  }
  return { id: message.id, content, stop_reason: message.status === 'incomplete' ? 'length' : content.some(p => p.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: message.usage };
}
function frames(bytes: Uint8Array): string[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\r\n', '\n');
  if (!text.endsWith('\n\n')) return fail();
  return text.split('\n\n').flatMap(frame => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    return data ? [data] : [];
  });
}
function streamMessage(protocol: 'openai' | 'responses', bytes: Uint8Array): Json {
  if (protocol === 'responses') {
    let started: string | undefined; let result: Json | undefined; let sequence = -1;
    for (const data of frames(bytes)) {
      const event = JSON.parse(data);
      if (!object(event) || result || event.type === 'error' || event.type === 'response.failed') return fail();
      if (event.sequence_number !== undefined) {
        if (!Number.isSafeInteger(event.sequence_number) || event.sequence_number <= sequence) return fail();
        sequence = event.sequence_number;
      }
      if (!started) {
        if (event.type !== 'response.created' || !id(event.response?.id)) return fail();
        started = event.response.id;
      } else if (event.type === 'response.created') return fail();
      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        if (event.response?.id !== started || event.response.status !== event.type.slice(9)) return fail();
        result = event.response;
      }
    }
    return result ?? fail();
  }
  let messageId: string | undefined; let role = false; let done = false; let finish: string | undefined; let content = ''; let usage: unknown;
  const calls = new Map<number, Json>();
  for (const data of frames(bytes)) {
    if (done) return fail();
    if (data === '[DONE]') { if (!finish) return fail(); done = true; continue; }
    const event = JSON.parse(data);
    if (!object(event) || !id(event.id) || event.object !== 'chat.completion.chunk' || !Array.isArray(event.choices) || event.choices.length > 1) return fail();
    messageId ??= event.id; if (messageId !== event.id) return fail();
    if (event.usage) usage = event.usage;
    const choice = event.choices[0]; if (!choice) { if (!finish || !event.usage) return fail(); continue; }
    if (choice.index !== 0 || !object(choice.delta) || finish) return fail();
    const delta = choice.delta;
    if (delta.role !== undefined) { if (role || delta.role !== 'assistant') return fail(); role = true; }
    if (delta.content != null) { if (typeof delta.content !== 'string') return fail(); content += delta.content; }
    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls)) return fail();
      for (const part of delta.tool_calls) {
        if (!Number.isSafeInteger(part.index) || part.index < 0 || part.index > 100) return fail();
        let call = calls.get(part.index);
        if (!call) { if (!id(part.id) || part.type !== 'function' || !id(part.function?.name)) return fail();
          call = { id: part.id, type: 'function', function: { name: part.function.name, arguments: '' } }; calls.set(part.index, call);
        } else if (part.id !== undefined || part.function?.name !== undefined) return fail();
        if (part.function?.arguments !== undefined) { if (typeof part.function.arguments !== 'string') return fail(); call.function.arguments += part.function.arguments; }
      }
    }
    if (choice.finish_reason != null) finish = choice.finish_reason;
  }
  if (!done || !role || !finish) return fail();
  return { id: messageId, object: 'chat.completion', choices: [{ finish_reason: finish, message: { role: 'assistant', content, tool_calls: [...calls.values()] } }], usage };
}
/** Normalized inspection is for gates only. The original wire bytes remain the authoritative receipt. */
export function inspectLemoProviderResponse(protocol: LlmProtocol, bytes: Uint8Array, stream: boolean): Json {
  try {
    if (protocol === 'anthropic') { verifyMessagesReceipt(bytes, stream); return stream ? {} : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    const value = stream ? streamMessage(protocol, bytes) : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!object(value)) return fail();
    return protocol === 'openai' ? chat(value) : responses(value);
  } catch { return fail(); }
}
export function verifyLemoProviderReceipt(protocol: LlmProtocol, bytes: Uint8Array, stream: boolean) {
  if (protocol === 'anthropic') return verifyMessagesReceipt(bytes, stream);
  const message = inspectLemoProviderResponse(protocol, bytes, stream);
  return { messageId: message.id as string, stopReason: message.stop_reason as string, responseSha256: createHash('sha256').update(bytes).digest('hex') };
}
