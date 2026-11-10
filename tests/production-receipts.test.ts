import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { voxInputHash } from '../electron/vox-production-service';
import { createVoxProductionReceipt, voxReceiptBeforeHash, voxReceiptContentHash } from '../electron/vox-production-receipt';
import { recoverLemoUpstreamAgentTurn, stepLemoUpstreamAgent, type LemoAgentOptions } from '../electron/lemo-upstream-agent';
import { LEMO_UPSTREAM_REVISION } from '../electron/lemo-upstream-source';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const vox = (text = '道路与建筑吸收阳光。树荫可以降低地表温度。') =>
  createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'vox', title: '城市热岛', ratio: '16:9' }), text, '2026-10-23T00:00:00.000Z', 15000);
/** The exact pre-O-1 resume comparison from electron/main.ts (recover). */
const legacyMatches = (receipt: { before: EditorialCollagePipelineData }, current: EditorialCollagePipelineData) => {
  const stripJournal = (d: EditorialCollagePipelineData) => { const { productionRun: _run, updatedAt: _revision, ...content } = d; return content; };
  return voxInputHash(stripJournal(receipt.before)) === voxInputHash(stripJournal(current));
};
/** Mirrors the new main.ts recover: hash check, then parse the stored result. */
const recoverVox = (raw: string, current: EditorialCollagePipelineData) => {
  const receipt = JSON.parse(raw);
  if (voxReceiptBeforeHash(receipt) !== voxReceiptContentHash(current)) return undefined;
  return parseEditorialCollagePipelineData(receipt.result);
};

describe('VOX node receipts without whole-document snapshots (O-1)', () => {
  it('writes only beforeHash + result, never the full pre-node document', () => {
    const before = vox(); const result = { ...before, title: '节点结果' };
    const receipt = createVoxProductionReceipt(before, result);
    const raw = JSON.stringify(receipt);
    expect(receipt).toEqual({ version: 2, beforeHash: voxReceiptContentHash(before), result });
    expect(JSON.parse(raw)).not.toHaveProperty('before');
    expect(raw.length).toBeLessThan(JSON.stringify({ before, result }).length * 0.6);
  });

  it('computes the same input hash as the legacy before-document comparison', () => {
    const before = vox();
    const legacy = JSON.parse(JSON.stringify({ before, result: before }));
    expect(voxReceiptBeforeHash(legacy)).toBe(voxReceiptContentHash(before));
    expect(voxReceiptBeforeHash(JSON.parse(JSON.stringify(createVoxProductionReceipt(before, before))))).toBe(voxReceiptBeforeHash(legacy));
    // Journal/revision churn is ignored exactly like stripJournal; real content changes are not.
    const journalOnly = { ...before, updatedAt: '2030-01-01T00:00:00.000Z', productionRun: undefined };
    const edited = { ...before, sourceText: before.sourceText + '新增一句。' };
    for (const current of [before, journalOnly, edited]) {
      expect(voxReceiptBeforeHash(legacy) === voxReceiptContentHash(current), current.sourceText).toBe(legacyMatches(legacy, current));
    }
    expect(voxReceiptContentHash(journalOnly)).toBe(voxReceiptContentHash(before));
    expect(voxReceiptContentHash(edited)).not.toBe(voxReceiptContentHash(before));
  });

  it('still resumes old receipts that contain a full `before` and new ones identically', () => {
    const before = vox(); const result = { ...before, title: '已完成节点' };
    const legacyRaw = JSON.stringify({ before, result });
    const currentRaw = JSON.stringify(createVoxProductionReceipt(before, result));
    expect(recoverVox(legacyRaw, before)).toEqual(parseEditorialCollagePipelineData(result));
    expect(recoverVox(currentRaw, before)).toEqual(recoverVox(legacyRaw, before));
    const changed = vox('原稿已经被改写。');
    expect(recoverVox(legacyRaw, changed)).toBeUndefined();
    expect(recoverVox(currentRaw, changed)).toBeUndefined();
  });

  it('rejects a receipt with neither beforeHash nor before instead of resuming blindly', () => {
    expect(() => voxReceiptBeforeHash({ result: vox() })).toThrow('VOX_RECEIPT_INVALID');
    expect(() => voxReceiptBeforeHash({ version: 2, result: vox() })).toThrow('VOX_RECEIPT_INVALID');
  });
});

const write = (path: string, source: string) => '```json\n' + JSON.stringify({ tool: 'write_file', path }) + '\n```\n```js\n' + source + '\n```';
async function lemoFixture(replies: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'lemo-receipt-')); roots.push(root);
  const model = vi.fn(async () => { const text = replies.shift(); if (!text) throw new Error('no mock replies'); return { text, raw: text, requestId: 'mock', finishReason: 'stop' }; });
  const options: LemoAgentOptions = { root, upstreamRoot: resolve('vendor/lemo-upstream'),
    context: { runId: 'receipt-run', styleId: 'brick-toy', brief: '制作全新中文影片。', durationSeconds: 3, width: 1920, height: 1080 }, model,
    review: vi.fn<LemoAgentOptions['review']>(async (_directory, outputDir, times) => {
      await mkdir(outputDir, { recursive: true });
      const frames = await Promise.all(times.map(async (time, index) => { const path = join(outputDir, index + '.png'); await writeFile(path, Buffer.from('89504e470d0a1a0a', 'hex')); return { time, path }; }));
      return { revision: LEMO_UPSTREAM_REVISION, entry: _directory, width: 1920, height: 1080, frames, errors: [], missingResources: [], failedFonts: [], technicalPassed: true, aestheticReview: false, durationSeconds: 3 };
    }),
  };
  return { root, options, model };
}
const turnFile = (root: string, turn: number) => join(root, `turn-${String(turn).padStart(4, '0')}`, 'result.json');

describe('Lemo per-turn receipts without duplicated film messages (O-1)', () => {
  it('stores a hashed receipt per turn and recovers every turn, including older ones, exactly', async () => {
    const big = 'x'.repeat(20000);
    const { root, options } = await lemoFixture([write('index.html', '<div>原创</div>'), write('scenes/big.js', `export const big = '${big}';`), '{"tool":"read_file","path":"scenes/big.js"}', '{"tool":"review_frames"}']);
    const films = [];
    for (let i = 0; i < 4; i++) films.push(await stepLemoUpstreamAgent(options));
    expect(films[2].message.length).toBeGreaterThan(10000);
    for (const [index, film] of films.entries()) {
      const raw = await readFile(turnFile(root, index + 1), 'utf8');
      const stored = JSON.parse(raw);
      expect(stored).toMatchObject({ receipt: 'lemo-turn', version: 2, turn: index + 1 });
      expect(stored.film.message).toBe('');
      expect(raw).not.toContain(big.slice(0, 1000));
      expect(await recoverLemoUpstreamAgentTurn(root, index + 1)).toEqual(film);
    }
  });

  it('keeps reading legacy turn receipts that contain the whole film', async () => {
    const { root, options } = await lemoFixture([write('index.html', 'a'), write('index.html', 'b')]);
    const first = await stepLemoUpstreamAgent(options);
    await stepLemoUpstreamAgent(options);
    const legacy = { ...first, message: 'legacy full film receipt' };
    await writeFile(turnFile(root, 1), JSON.stringify(legacy, null, 2) + '\n');
    expect(await recoverLemoUpstreamAgentTurn(root, 1)).toEqual(legacy);
  });

  it('does not return a rebuilt film whose hash does not match', async () => {
    const { root, options } = await lemoFixture([write('index.html', 'a'), write('index.html', 'b')]);
    await stepLemoUpstreamAgent(options);
    const latest = await stepLemoUpstreamAgent(options);
    for (const turn of [1, 2]) {
      const stored = JSON.parse(await readFile(turnFile(root, turn), 'utf8'));
      await writeFile(turnFile(root, turn), JSON.stringify({ ...stored, filmHash: '0'.repeat(64) }));
    }
    expect(await recoverLemoUpstreamAgentTurn(root, 1)).toBeUndefined();
    // The latest turn still falls back to journal.json, as before when result.json was missing.
    expect(await recoverLemoUpstreamAgentTurn(root, 2)).toEqual(latest);
  });
});
