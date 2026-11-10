import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredJsonLlm } from '../src/shared/llm-provider';
import {
  PROVIDER_RESULT_UNKNOWN, createFileLlmReceiptJournal, llmReceiptKey, summarizeLlmReceipts, withLlmReceiptJournal, type LlmReceiptEntry,
} from '../src/shared/llm-receipt-ledger';

const config = { baseUrl: 'https://llm.example', model: 'm1', protocol: 'openai' as const };
const request = { step: 2, name: 'rewrite', messages: [{ role: 'user' as const, content: 'secret prompt text' }] };
const dirs: string[] = [];
async function journalPath() {
  const dir = await mkdtemp(join(tmpdir(), 'llm-receipts-'));
  dirs.push(dir);
  return join(dir, 'llm-receipts.jsonl');
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const fakeLlm = (run: (request: unknown) => Promise<unknown>) => ({ protocol: 'openai', run }) as unknown as ConfiguredJsonLlm;

describe('LLM receipt journal (G-3)', () => {
  it('writes submitted before the call and settled after, without prompt or response text', async () => {
    const path = await journalPath();
    const journal = createFileLlmReceiptJournal(path);
    const seenBeforeCall: LlmReceiptEntry[][] = [];
    const llm = withLlmReceiptJournal(fakeLlm(async () => {
      seenBeforeCall.push(await journal.read());
      return { json: { ok: 1 }, raw: '{"ok":1} response body', requestId: 'req-1', usage: { total_tokens: 42 } };
    }), config, journal);
    await llm.run(request as never);
    expect(seenBeforeCall[0].map((entry) => entry.kind)).toEqual(['submitted']);
    const text = await readFile(path, 'utf8');
    expect(text).not.toContain('secret prompt');
    expect(text).not.toContain('response body');
    const entries = await journal.read();
    expect(entries.map((entry) => entry.kind)).toEqual(['submitted', 'settled']);
    expect(entries[1]).toMatchObject({ outcome: 'received', requestId: 'req-1', usage: { total_tokens: 42 } });
    expect(entries[1].responseSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses once after an orphaned submission (crash mid-request), then lets the user resend', async () => {
    const path = await journalPath();
    const journal = createFileLlmReceiptJournal(path);
    await journal.append({ v: 1, kind: 'submitted', key: llmReceiptKey(config, request), at: '2026-11-10T00:00:00.000Z' });
    const call = vi.fn(async () => ({ json: {}, raw: '{}', requestId: 'r2' }));
    const llm = withLlmReceiptJournal(fakeLlm(call), config, journal);
    await expect(llm.run(request as never)).rejects.toMatchObject({ code: PROVIDER_RESULT_UNKNOWN });
    expect(call).not.toHaveBeenCalled();
    await expect(llm.run(request as never)).resolves.toMatchObject({ requestId: 'r2' });
    expect(call).toHaveBeenCalledOnce();
  });

  it('records rejected / unknown / received-but-unparseable outcomes and does not block manual retry', async () => {
    const path = await journalPath();
    const journal = createFileLlmReceiptJournal(path);
    const errors = [
      Object.assign(new Error('LLM API error (401)'), { status: 401 }),
      new Error('LLM API error (524) at step 2'),
      new Error('LLM_JSON_INVALID: model reply is not JSON'),
    ];
    const llm = withLlmReceiptJournal(fakeLlm(async () => { throw errors.shift(); }), config, journal);
    for (let i = 0; i < 3; i += 1) await expect(llm.run(request as never)).rejects.toThrow();
    const settled = (await journal.read()).filter((entry) => entry.kind === 'settled');
    expect(settled.map((entry) => entry.outcome)).toEqual(['rejected', 'unknown', 'received']);
    expect(summarizeLlmReceipts(await journal.read())).toMatchObject({ requests: 3, rejected: 1, unknown: 1, received: 1, orphaned: 0 });
  });

  it('does not treat a concurrent identical in-flight call as orphaned', async () => {
    const journal = createFileLlmReceiptJournal(await journalPath());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const llm = withLlmReceiptJournal(fakeLlm(async () => { await gate; return { json: {}, raw: '{}', requestId: null }; }), config, journal);
    const first = llm.run(request as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = llm.run(request as never);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('keeps generating when the journal cannot be written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = { read: async () => { throw new Error('EACCES'); }, append: async () => { throw new Error('EACCES'); } };
    const llm = withLlmReceiptJournal(fakeLlm(async () => ({ json: { ok: true }, raw: '{}', requestId: null })), config, broken);
    await expect(llm.run(request as never)).resolves.toMatchObject({ json: { ok: true } });
    warn.mockRestore();
  });

  it('keys ignore the abort signal but change with model and request', () => {
    const a = llmReceiptKey(config, { ...request, signal: new AbortController().signal });
    expect(a).toBe(llmReceiptKey(config, request));
    expect(a).not.toBe(llmReceiptKey({ ...config, model: 'm2' }, request));
    expect(a).not.toBe(llmReceiptKey(config, { ...request, step: 3 }));
  });
});
