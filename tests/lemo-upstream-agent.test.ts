import { markGenerationNotSubmitted } from '../src/shared/generation-authorization';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseLemoAgentAction } from '../src/shared/creative-animation/upstream-agent';
import { stepLemoUpstreamAgent, recoverLemoUpstreamAgentTurn, lemoAgentPath, type LemoAgentOptions } from '../electron/lemo-upstream-agent';
import { LEMO_UPSTREAM_REVISION } from '../electron/lemo-upstream-source';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const write = (path: string, source: string) => '```json\n' + JSON.stringify({ tool: 'write_file', path }) + '\n```\n```js\n' + source + '\n```';
async function fixture(replies: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'lemo-agent-')); roots.push(root);
  const model = vi.fn(async () => { const text = replies.shift(); if (!text) throw new Error('no mock replies'); return { text, raw: text, requestId: 'mock', finishReason: 'stop' }; });
  const options: LemoAgentOptions = { root, upstreamRoot: resolve('vendor/lemo-upstream'),
    context: { runId: 'test-run', styleId: 'brick-toy', brief: '制作全新中文影片，不复制样片故事。', durationSeconds: 3, width: 1920, height: 1080 }, model,
    review: vi.fn<LemoAgentOptions['review']>(async (directory, outputDir, times) => {
      await mkdir(outputDir, { recursive: true });
      const frames = await Promise.all(times.map(async (time, index) => { const path = join(outputDir, index + '.png'); await writeFile(path, Buffer.from('89504e470d0a1a0a', 'hex')); return { time, path }; }));
      return { revision: LEMO_UPSTREAM_REVISION, entry: directory, width: 1920, height: 1080, frames, errors: [], missingResources: [], failedFonts: [], technicalPassed: true, aestheticReview: false, durationSeconds: 3 };
    }),
  };
  return { root, options, model };
}

describe('native upstream Agent', () => {
  it.each(['', '  ', '\r\n'])('identifies an empty provider reply instead of a JSON contract error (%j)', text => {
    expect(() => parseLemoAgentAction(text)).toThrow('LEMO_AGENT_EMPTY_RESPONSE');
  });
  it('keeps a complete empty paid receipt without altering source or resending on recovery', async () => {
    const { root, options, model } = await fixture([]);
    const receipt = { text: '', raw: '', requestId: 'empty-paid', finishReason: 'stop', usage: { completion_tokens: 10539 } };
    model.mockResolvedValueOnce(receipt);
    const film = await stepLemoUpstreamAgent(options);
    expect(film).toMatchObject({ turn: 1, status: 'authoring', lastTool: 'invalid_reply' });
    expect(film.message).toContain('LEMO_AGENT_EMPTY_RESPONSE');
    expect(JSON.parse(await readFile(join(root, 'turn-0001/response.json'), 'utf8'))).toEqual(receipt);
    await expect(readFile(join(root, 'project/index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await recoverLemoUpstreamAgentTurn(root, 1)).toEqual(film);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it('distinguishes a locally denied request from an unknown provider result', async () => {
    const { options, model } = await fixture([write('index.html', 'new')]);
    model.mockRejectedValueOnce(markGenerationNotSubmitted(new Error('LICENSE_NOT_READY')));
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'denied' })).rejects.toThrow('LLM_NOT_SUBMITTED');
    expect(JSON.parse(await readFile(join(options.root, 'turn-0001/rejected.json'), 'utf8')).requestId).toBe('denied');
    await stepLemoUpstreamAgent({ ...options, requestId: 'authorized' });
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('consumes explicit unknown-request retry authority only once', async () => {
    const { options, model } = await fixture([]);
    model.mockRejectedValue(new Error('socket disconnected'));
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'first' })).rejects.toThrow('socket');
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'second', retryOfRequestId: 'first' })).rejects.toThrow('socket');
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'third', retryOfRequestId: 'first' })).rejects.toThrow('UNKNOWN');
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('replays a saved response after host IO failure without buying another turn', async () => {
    const { options, model } = await fixture([write('index.html', 'picture'), '{"tool":"review_frames"}']);
    await stepLemoUpstreamAgent(options);
    vi.mocked(options.review).mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    await expect(stepLemoUpstreamAgent(options)).rejects.toThrow('disk full');
    const film = await stepLemoUpstreamAgent(options);
    expect(film.turn).toBe(2);
    expect(film.review?.technicalPassed).toBe(true);
    expect(model).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an old definitive rejection to resend a later unknown request', async () => {
    const { options, model } = await fixture([]);
    model.mockRejectedValueOnce(new Error('LLM API error (400) at step 1 test: Bad Request'));
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'rejected' })).rejects.toThrow('400');
    expect(JSON.parse(await readFile(join(options.root, 'turn-0001/rejected.json'), 'utf8')).requestId).toBe('rejected');
    model.mockRejectedValueOnce(new Error('socket disconnected'));
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'explicit-retry' })).rejects.toThrow('socket');
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'explicit-retry' })).rejects.toThrow(/UNKNOWN/);
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'another-retry' })).rejects.toThrow(/UNKNOWN/);
    expect(model).toHaveBeenCalledTimes(2);
  });

  it('keeps source outside the small JSON tool header, preserving Chinese and embedded backticks', () => {
    const source = 'const text = `中文 ${1}`;\n// ``` inline is source';
    expect(parseLemoAgentAction(write('scenes/a.js', source))).toMatchObject({ tool: 'write_file', body: source + '\n' });
    expect(() => parseLemoAgentAction(write('a.js', source).slice(0, -3))).toThrow(/incomplete/);
  });
  it('creates real multi-file sources, feeds actual frame images to the next turn, and records model review separately', async () => {
    const { options, model } = await fixture([write('index.html', '<div>原创新片</div>'), write('scenes/rain.js', 'export const rain = 1;'), '{"tool":"review_frames"}', '{"tool":"finish","notes":"已检查三张实际样帧，主体构图清晰、镜头有变化、文字未遮挡，未发现空白或裁切。"}']);
    let film;
    for (let i = 0; i < 4; i++) film = await stepLemoUpstreamAgent(options);
    expect(film?.status).toBe('ready'); expect(film?.visualReview?.turn).toBe(4);
    expect(await readFile(join(options.root, 'project/scenes/rain.js'), 'utf8')).toContain('export const rain');
    const call = model.mock.calls as unknown as Array<[Parameters<LemoAgentOptions['model']>[0]]>;
    expect(call[3][0].messages.at(-1)?.images).toHaveLength(3);
    expect(call[3][0]).toMatchObject({ maxRetries: 0, captureIncomplete: true, defaultMaxTokens: 16384 });
    expect(await recoverLemoUpstreamAgentTurn(options.root, 4)).toEqual(film);
    expect(model).toHaveBeenCalledTimes(4);
  });
  it.each(['../escape.js', 'C:/escape.js', 'a\\b.js', 'foo:bar.js', '/escape.js', 'NUL.js', 'a/../b.js', 'foo./bar.js'])('rejects path %s without altering files outside the project', async path => {
    const { options } = await fixture([write(path, 'throw 1')]);
    const film = await stepLemoUpstreamAgent(options);
    expect(film.message).toMatch(/LEMO_AGENT_PATH/);
    expect(film.status).toBe('authoring');
  });
  it('denies junction escape', async () => {
    const { root } = await fixture([]);
    const project = join(root, 'project'), outside = join(root, 'outside'); await mkdir(project); await mkdir(outside);
    await symlink(outside, join(project, 'escape'), 'junction');
    try { await expect(lemoAgentPath(project, 'escape/source.js')).rejects.toThrow(/junction/); } finally { await unlink(join(project, 'escape')); }
  });
  it('does not mutate library files', async () => {
    expect(() => parseLemoAgentAction('```json\n{"tool":"write_file","scope":"library","path":"DIRECTOR.md"}\n```\n```md\nchanged\n```')).toThrow();
  });
  it('never applies truncated source, saves the full receipt, and asks for a smaller module', async () => {
    const { options, model } = await fixture([]);
    model.mockResolvedValueOnce({ text: write('index.html', 'incomplete'), raw: 'raw', requestId: 'r', finishReason: 'length' });
    const film = await stepLemoUpstreamAgent(options);
    expect(film.message).toContain('TRUNCATED');
    await expect(readFile(join(options.root, 'project/index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(options.root, 'turn-0001/response.json'), 'utf8')).finishReason).toBe('length');
  });
  it('does not resend an unknown paid request', async () => {
    const { options, model } = await fixture([]);
    model.mockRejectedValueOnce(new Error('connection lost after submit'));
    await expect(stepLemoUpstreamAgent(options)).rejects.toThrow('connection lost');
    await expect(stepLemoUpstreamAgent(options)).rejects.toThrow('REQUEST_UNKNOWN');
    expect(model).toHaveBeenCalledTimes(1);
  });
  it('replays a saved model receipt after a crash without making another paid request', async () => {
    const { options, model, root } = await fixture([write('index.html', 'new')]);
    await stepLemoUpstreamAgent(options);
    const journalPath = join(root, 'journal.json'); const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.turns = []; journal.film.turn = 0; journal.film.status = 'authoring';
    await writeFile(journalPath, JSON.stringify(journal));
    await stepLemoUpstreamAgent(options);
    expect(model).toHaveBeenCalledTimes(1);
    expect(await readFile(join(root, 'project/index.html'), 'utf8')).toBe('new\n');
  });
  it('requires unique patches and invalidates old visual approval after edits', async () => {
    const { options } = await fixture([write('index.html', 'a a'), '{"tool":"replace_text","path":"index.html","before":"a","after":"b"}', '{"tool":"review_frames"}', write('index.html', 'new picture'), '{"tool":"finish","notes":"Pretend a previous picture proves that the changed source is ready."}']);
    await stepLemoUpstreamAgent(options);
    expect((await stepLemoUpstreamAgent(options)).message).toContain('PATCH_MISMATCH');
    await stepLemoUpstreamAgent(options); await stepLemoUpstreamAgent(options);
    const film = await stepLemoUpstreamAgent(options);
    expect(film.status).toBe('authoring'); expect(film.message).toContain('REVIEW_REQUIRED');
  });
  it('refuses finish without browser evidence', async () => {
    const { options } = await fixture(['{"tool":"finish","notes":"Everything looks excellent without actually reviewing any generated images."}']);
    const film = await stepLemoUpstreamAgent(options);
    expect(film.status).toBe('authoring'); expect(film.message).toContain('REVIEW_REQUIRED');
  });
  it('locks brief, style and measured duration across recovery', async () => {
    const { options } = await fixture([write('index.html', 'new')]); await stepLemoUpstreamAgent(options);
    await expect(stepLemoUpstreamAgent({ ...options, context: { ...options.context, brief: 'changed' } })).rejects.toThrow('CONTEXT_CHANGED');
  });
});