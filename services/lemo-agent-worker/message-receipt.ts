import { createHash } from 'node:crypto';
import type { RequestReceipt } from './request-ledger';
const SAFE = /^[A-Za-z0-9_-]{1,160}$/;
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function verifyMessagesReceipt(bytes: Uint8Array, stream: boolean): Pick<RequestReceipt, 'messageId' | 'stopReason' | 'responseSha256'> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let messageId: unknown; let stopReason: unknown;
  if (!stream) {
    const v: unknown = JSON.parse(text);
    if (!object(v) || v.type !== 'message' || v.role !== 'assistant' || !Array.isArray(v.content)) throw new Error('LEMO_GATEWAY_INCOMPLETE');
    messageId = v.id; stopReason = v.stop_reason;
  } else {
    let started = false; let stopped = false; let delta = false;
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
        if (started || !object(v.message) || v.message.type !== 'message' || v.message.role !== 'assistant') throw new Error('LEMO_GATEWAY_INCOMPLETE');
        started = true; messageId = v.message.id;
      } else if (!started) throw new Error('LEMO_GATEWAY_INCOMPLETE');
      else if (event === 'message_delta') {
        if (delta || !object(v.delta)) throw new Error('LEMO_GATEWAY_INCOMPLETE');
        delta = true; stopReason = v.delta.stop_reason;
      } else if (event === 'message_stop') {
        if (!delta) throw new Error('LEMO_GATEWAY_INCOMPLETE'); stopped = true;
      } else if (!['content_block_start','content_block_delta','content_block_stop'].includes(event)) throw new Error('LEMO_GATEWAY_INCOMPLETE');
    }
    if (!started || !stopped) throw new Error('LEMO_GATEWAY_INCOMPLETE');
  }
  if (typeof messageId !== 'string' || !SAFE.test(messageId) || typeof stopReason !== 'string' || !SAFE.test(stopReason)) throw new Error('LEMO_GATEWAY_INCOMPLETE');
  return { messageId, stopReason, responseSha256: createHash('sha256').update(bytes).digest('hex') };
}
