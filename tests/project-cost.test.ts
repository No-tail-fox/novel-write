import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig } from '@shared/config-utils';
import { ipcInputSchemas } from '@shared/ipc-contract';
import { INVOKE_CHANNELS } from '@shared/storydream-api';
import { FileDatabase } from '@shared/storage';
import type { LlmReceiptEntry } from '@shared/llm-receipt-ledger';
import {
  costEntriesFromLlmReceipts, formatCostAmount, llmUsageTokens, normalizeCostPriceTable, summarizeProjectCost, type CostLedgerEntry, type CostPriceTable,
} from '@shared/project-cost';
import {
  costEntriesFromHtmlPipeline, costEntriesFromLemoTurns, costEntriesFromVoxDocument, expectedProjectImages, imageBudgetEstimateText, projectCostModelHints, type CostModelHints,
} from '@shared/project-cost-sources';
import { adaptHtmlVideoAssetGenerator } from '@shared/task-runtime-providers';
import type { RunTaskOptions } from '@shared/runner';
import type { SceneAsset } from '@shared/draft';
import type { HtmlVideoScenePlan } from '@shared/types';
import { collectProjectCostReport, readLemoTurnEvidence } from '../electron/project-cost-collector';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), 'opc-project-cost-')); directories.push(dir); return dir; };
const hints: CostModelHints = { llm: { provider: 'openai', model: 'gpt-x' }, image: { provider: 'gpt', model: 'img-1' }, tts: { provider: 'minimax', model: 'speech-1' } };
const at = '2026-11-10T00:00:00.000Z';
const llm = (outcome: CostLedgerEntry['outcome'], extra: Partial<CostLedgerEntry> = {}): CostLedgerEntry => ({ kind: 'llm', provider: 'openai', model: 'gpt-x', outcome, at, ...extra });
const table: CostPriceTable = { currency: 'CNY', rows: [
  { model: 'gpt-x', kind: 'llm', inputPer1M: 2, outputPer1M: 8, cachedPer1M: 0.5 },
  { model: 'img-1', perImage: 0.2 },
  { model: 'speech-1', per1kChars: 2 },
] };

describe('U-5 project cost summary (pure)', () => {
  it('prices received LLM calls per 1M tokens and prices cached input separately', () => {
    const summary = summarizeProjectCost([llm('received', { inputTokens: 1_000_000, cachedTokens: 400_000, outputTokens: 500_000 })], table);
    const kind = summary.kinds.find(item => item.kind === 'llm')!;
    // 600k uncached * 2 + 400k cached * 0.5 + 500k output * 8 = 1.2 + 0.2 + 4
    expect(kind.cost).toBeCloseTo(5.4);
    expect(summary.estimatedCost).toBeCloseTo(5.4);
    expect(summary.totals).toMatchObject({ calls: 1, received: 1, inputTokens: 1_000_000, outputTokens: 500_000, cachedTokens: 400_000 });
  });

  it('falls back to the input price for cached tokens when no cached price is set', () => {
    const summary = summarizeProjectCost([llm('received', { inputTokens: 1_000_000, cachedTokens: 400_000, outputTokens: 0 })], { currency: 'CNY', rows: [{ model: 'gpt-x', inputPer1M: 2, outputPer1M: 8 }] });
    expect(summary.estimatedCost).toBeCloseTo(2);
  });

  it('counts unknown outcomes as possibly billed and never prices rejected / unknown / not-sent calls', () => {
    const summary = summarizeProjectCost([llm('unknown'), llm('unknown'), llm('rejected'), llm('not-sent'), llm('received', { inputTokens: 1000, outputTokens: 1000 })], table);
    expect(summary.possiblyBilled).toBe(2);
    expect(summary.kinds.find(item => item.kind === 'llm')).toMatchObject({ calls: 5, received: 1, rejected: 1, unknown: 2, notSent: 1 });
    expect(summary.estimatedCost).toBeCloseTo((1000 * 2 + 1000 * 8) / 1_000_000);
  });

  it('shows the count only (未定价) when a model has no price, and counts image / TTS units', () => {
    const entries: CostLedgerEntry[] = [
      llm('received', { model: 'mystery', inputTokens: 10, outputTokens: 10 }),
      { kind: 'image', provider: 'gpt', model: 'img-1', outcome: 'received', images: 1, at },
      { kind: 'image', provider: 'gpt', model: 'img-1', outcome: 'received', images: 1, at },
      { kind: 'tts', provider: 'minimax', model: 'speech-1', outcome: 'received', characters: 500, at },
      { kind: 'tts', provider: 'minimax', model: 'speech-1', outcome: 'received', at },
    ];
    const summary = summarizeProjectCost(entries, table);
    const byKind = Object.fromEntries(summary.kinds.map(kind => [kind.kind, kind]));
    expect(byKind.llm).toMatchObject({ calls: 1, cost: null, unpricedReceived: 1 });
    expect(byKind.image).toMatchObject({ calls: 2, images: 2 });
    expect(byKind.image.cost).toBeCloseTo(0.4);
    expect(byKind.tts).toMatchObject({ calls: 2, characters: 500, unpricedReceived: 1 });
    expect(byKind.tts.cost).toBeCloseTo(1);
    expect(summary.unpricedReceived).toBe(2);
    expect(summary.estimatedCost).toBeCloseTo(1.4);
    expect(formatCostAmount(byKind.llm.cost)).toBe('未定价');
    expect(summarizeProjectCost(entries).estimatedCost).toBeNull();
  });

  it('accepts absent / legacy / malformed price tables (old configs load unchanged)', () => {
    expect(normalizeCostPriceTable(undefined)).toEqual({ currency: 'CNY', rows: [] });
    expect(normalizeCostPriceTable({ currency: 'usd', rows: [{ model: ' a ', inputPer1M: '1.5', perImage: -1 }, { model: '' }, null] })).toEqual({ currency: 'USD', rows: [{ model: 'a', inputPer1M: 1.5 }] });
    const legacy = normalizeAppConfig(defaultConfig);
    expect(legacy.costPriceTable).toBeUndefined();
    expect(normalizeAppConfig({ ...legacy, costPriceTable: table }).costPriceTable).toEqual(table);
  });

  it('normalizes OpenAI, Responses and Anthropic usage including cache tokens', () => {
    expect(llmUsageTokens({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } })).toEqual({ inputTokens: 100, outputTokens: 20, cachedTokens: 60 });
    expect(llmUsageTokens({ input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 30 } })).toEqual({ inputTokens: 100, outputTokens: 20, cachedTokens: 30 });
    expect(llmUsageTokens({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 })).toEqual({ inputTokens: 100, outputTokens: 5, cachedTokens: 90 });
    expect(llmUsageTokens({})).toBeUndefined();
  });

  it('maps the G-3 receipt journal: orphaned submissions stay possibly billed even after acknowledgement', () => {
    const entries: LlmReceiptEntry[] = [
      { v: 1, kind: 'submitted', key: 'a', at, model: 'gpt-x' },
      { v: 1, kind: 'settled', key: 'a', at, model: 'gpt-x', outcome: 'received', usage: { prompt_tokens: 10, completion_tokens: 5 } },
      { v: 1, kind: 'submitted', key: 'b', at, model: 'gpt-x' },
      { v: 1, kind: 'settled', key: 'b', at, model: 'gpt-x', outcome: 'rejected' },
      { v: 1, kind: 'submitted', key: 'c', at, model: 'gpt-x' },
      { v: 1, kind: 'acknowledged', key: 'c', at },
      { v: 1, kind: 'submitted', key: 'd', at, model: 'gpt-x' },
    ];
    const ledger = costEntriesFromLlmReceipts(entries, 'openai');
    expect(ledger.map(entry => entry.outcome).sort()).toEqual(['received', 'rejected', 'unknown', 'unknown']);
    expect(ledger.find(entry => entry.outcome === 'received')).toMatchObject({ inputTokens: 10, outputTokens: 5, model: 'gpt-x' });
  });
});

describe('U-5 cost collection from existing records', () => {
  it('maps VOX production nodes and director video jobs without counting pending work', () => {
    const document = {
      beats: [{ subtitleCues: [{ id: 'c1', text: '你好 世界' }], shots: [{ id: 's1', subtitleCueIds: ['c1'] }] }],
      productionRun: { updatedAt: at, nodes: [
        { id: 'plan', kind: 'plan', status: 'completed', paid: true, llmResponse: { usage: { prompt_tokens: 100, completion_tokens: 50 } } },
        { id: 'image:s1', kind: 'image', status: 'failed', paid: true, error: 'provider refused' },
        { id: 'voice:s1', kind: 'voice', shotId: 's1', status: 'completed', paid: true },
        { id: 'code', kind: 'code', status: 'unknown', paid: true },
        { id: 'pending', kind: 'animation', status: 'pending', paid: true },
        { id: 'render', kind: 'render', status: 'completed', paid: false },
      ] },
      providerJobs: [{ capability: 'image-to-video', status: 'completed', providerId: 'kling', model: 'k1', updatedAt: at }, { capability: 'deterministic-render', status: 'completed' }],
    };
    const entries = costEntriesFromVoxDocument(document, hints);
    expect(entries.map(entry => `${entry.kind}:${entry.outcome}`)).toEqual(['llm:received', 'image:rejected', 'tts:received', 'llm:unknown', 'video:received']);
    expect(entries[0]).toMatchObject({ inputTokens: 100, outputTokens: 50, model: 'gpt-x' });
    expect(entries[2]).toMatchObject({ characters: 4 });
    expect(costEntriesFromVoxDocument({ ...document }, hints, { lemoTurnsCounted: true })).toHaveLength(5);
  });

  it('reads Lemo v3 turn receipts (usage, interrupted, rejected, images) from the work directory', async () => {
    const work = await temp();
    const run = join(work, 'vox-production', 'lemo-agent', 'run-1');
    const turn = async (name: string, files: Record<string, unknown>) => {
      await mkdir(join(run, name), { recursive: true });
      for (const [file, value] of Object.entries(files)) await writeFile(join(run, name, file), JSON.stringify(value));
    };
    await turn('turn-0001', { 'submitted.json': { at, requestId: 'r1' }, 'response.json': { text: 'x', usage: { input_tokens: 1000, output_tokens: 100 } }, 'image.json': { status: 'received' } });
    await turn('turn-0002', { 'submitted.json': { at, requestId: 'r2' }, 'interrupted.json': {} });
    await turn('turn-0003', { 'submitted.json': { at, requestId: 'r4' }, 'rejected.json': { requestId: 'r3' }, 'rejected-submission-x.json': { requestId: 'r3' }, 'image-abandoned-y.json': {}, 'image.json': { status: 'submitted' } });
    await turn('turn-0004', { 'submitted.json': { at, requestId: 'r5' }, 'rejected.json': { requestId: 'r5', reason: 'local-authorization-before-dispatch' } });
    const evidence = await readLemoTurnEvidence(work);
    expect(evidence).toHaveLength(4);
    const entries = costEntriesFromLemoTurns(evidence, hints);
    expect(entries.map(entry => `${entry.kind}:${entry.outcome}`)).toEqual([
      'llm:received', 'image:received',
      'llm:unknown',
      'llm:rejected', 'llm:unknown', 'image:rejected', 'image:unknown',
      'llm:not-sent',
    ]);
    expect(entries[0]).toMatchObject({ inputTokens: 1000, outputTokens: 100 });
  });

  it('counts HTML pipeline assets and voices, skipping reused (deduplicated) copies', () => {
    const entries = costEntriesFromHtmlPipeline({
      version: 2, steps: {}, scenes: [], config: {},
      assets: [{ kind: 'bg', src: 'C:/w/provider-images/001.png' }, { kind: 'bg', src: 'C:/w/provider-images/001.reuse-002.png' }, { kind: 'fg', src: 'C:/w/provider-images/003.png' }],
      voices: [{ text: '第一 幕' }, { text: '' }],
      coverAsset: { mode: 'auto', createdAt: at },
    }, hints);
    expect(entries.filter(entry => entry.kind === 'image')).toHaveLength(3);
    expect(entries.filter(entry => entry.kind === 'tts').map(entry => entry.characters)).toEqual([3, undefined]);
  });

  it('collects a template project report from the receipt journal and provider output files, read-only', async () => {
    const work = await temp();
    await writeFile(join(work, 'llm-receipts.jsonl'), [
      { v: 1, kind: 'submitted', key: 'k', at, model: 'gpt-x' },
      { v: 1, kind: 'settled', key: 'k', at, model: 'gpt-x', outcome: 'received', usage: { prompt_tokens: 2000, completion_tokens: 1000 } },
      { v: 1, kind: 'submitted', key: 'k2', at, model: 'gpt-x' },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    await mkdir(join(work, 'provider-images'));
    await mkdir(join(work, 'provider-audio'));
    for (const name of ['001.png', '002.png', '001.response.json']) await writeFile(join(work, 'provider-images', name), 'x');
    await writeFile(join(work, 'provider-audio', '001.mp3'), 'x');
    const config = normalizeAppConfig({ ...normalizeAppConfig(defaultConfig), costPriceTable: table });
    const report = await collectProjectCostReport({ task: { id: 'task-1', storyboardSceneCount: 9 }, workDir: work, config: { ...config, llm: { ...config.llm, model: 'gpt-x' } }, now: () => new Date(at) });
    const byKind = Object.fromEntries(report.summary.kinds.map(kind => [kind.kind, kind]));
    expect(report.taskId).toBe('task-1');
    expect(byKind.llm).toMatchObject({ calls: 2, received: 1, unknown: 1, inputTokens: 2000, outputTokens: 1000 });
    expect(byKind.image).toMatchObject({ calls: 2, images: 2 });
    expect(byKind.tts).toMatchObject({ calls: 1 });
    expect(report.summary.possiblyBilled).toBe(1);
    expect(report.expectedImages).toMatchObject({ count: 9, label: '预计生图 9 张（每个分镜 1 张）' });
    expect(report.notes.join('\n')).toContain('覆盖');
  });

  it('H-5: estimates expected images from the HTML plan, the VOX graph and the Lemo image budget', () => {
    const html = { version: 2, steps: {}, assets: [], voices: [], config: { foreground: true, coverImageMode: 'auto' }, scenes: [
      { background: { prompt: '城市夜景' }, elements: [{ prompt: '人物' }, { prompt: '人物' }] },
      { background: { prompt: '城市夜景' }, elements: [] },
    ] };
    expect(expectedProjectImages({}, html)).toMatchObject({ count: 5, unique: 3, label: '预计生图 5 张（相同提示词去重后 3 张）' });
    expect(expectedProjectImages({}, { ...html, config: { foreground: false } })).toMatchObject({ count: 2, unique: 1 });
    const vox = { beats: [], productionRun: { nodes: [{ kind: 'image', paid: true }, { kind: 'film-material', paid: true }, { kind: 'voice', paid: true }] } };
    expect(expectedProjectImages({}, vox)).toMatchObject({ count: 2, basis: 'plan' });
    expect(expectedProjectImages({}, { beats: [], productionRun: { authoringVersion: 3, nodes: [] } }, 6)).toMatchObject({ count: 6, basis: 'upper-bound' });
    expect(expectedProjectImages({ targetScenes: 0 }, undefined)).toBeUndefined();
  });

  it('H-5 follow-up: the expected image count follows the image budget plan on both routes', () => {
    const scenes = Array.from({ length: 6 }, (_, index) => ({ index: index + 1, background: { prompt: `背景 ${index + 1}` }, elements: [{ slot: 0, prompt: `主体 ${index + 1}` }] }));
    const html = (imageBudget?: unknown) => ({ version: 2, steps: {}, assets: [], voices: [], scenes, config: { foreground: true, coverImageMode: 'auto', ...(imageBudget ? { imageBudget } : {}) } });
    expect(expectedProjectImages({}, html())).toMatchObject({ count: 13, label: '预计生图 13 张' });
    expect(expectedProjectImages({}, html({ mode: 'standard' }))).toMatchObject({ count: 13, label: '预计生图 13 张' });
    expect(expectedProjectImages({}, html({ mode: 'economy' }))).toMatchObject({ count: 6, label: '预计生图 6 张（省图（每个分镜 1 张，封面复用））' });
    expect(expectedProjectImages({}, html({ mode: 'minimal' }))).toMatchObject({ count: 2 });
    expect(expectedProjectImages({}, html({ mode: 'standard', maxImages: 4 }))).toMatchObject({ count: 4 });

    const ordinary = (imageBudget?: unknown) => JSON.parse(JSON.stringify({ version: 1, platformVariants: ['douyin'], ...(imageBudget ? { imageBudget } : {}) }));
    expect(expectedProjectImages({ storyboardSceneCount: 9, coverImageMode: 'auto' }, ordinary())).toMatchObject({ count: 9, label: '预计生图 9 张（每个分镜 1 张）' });
    expect(expectedProjectImages({ storyboardSceneCount: 9, coverImageMode: 'auto' }, ordinary({ mode: 'minimal' }))).toMatchObject({ count: 3 });
    expect(expectedProjectImages({ storyboardSceneCount: 9 }, ordinary({ mode: 'economy', maxImages: 5 }))).toMatchObject({ count: 5 });
    expect(expectedProjectImages({ storyboardSceneCount: 9, coverImageMode: 'auto' }, ordinary({ mode: 'standard', maxImages: 20 }))).toMatchObject({ count: 10 });
  });

  it('H-5 follow-up: the live estimate prices images with the user price table', () => {
    const config = normalizeAppConfig(defaultConfig);
    const priced = { ...config, imageProvider: 'custom' as const, customImage: { ...config.customImage, model: 'img-1' }, costPriceTable: table };
    expect(imageBudgetEstimateText(6, priced)).toBe(`预计生图 6 张（约 ${formatCostAmount(1.2, 'CNY')}）`);
    expect(imageBudgetEstimateText(6, { ...priced, costPriceTable: { currency: 'CNY', rows: [] } })).toBe('预计生图 6 张');
    expect(imageBudgetEstimateText(0, undefined)).toBe('预计生图 0 张');
  });

  it('H-5 follow-up: reused images (.reuse-) are not counted as paid image calls', async () => {
    const work = await temp();
    await mkdir(join(work, 'provider-images'));
    for (const name of ['001.png', '004.png', '002.reuse-001.png', '003.reuse-001.png']) await writeFile(join(work, 'provider-images', name), 'x');
    const report = await collectProjectCostReport({ task: { id: 'task-reuse', storyboardSceneCount: 4 }, workDir: work, config: normalizeAppConfig(defaultConfig), now: () => new Date(at) });
    expect(report.summary.kinds.find(kind => kind.kind === 'image')).toMatchObject({ calls: 2, images: 2 });
    const pipeline = { version: 2, steps: {}, voices: [], scenes: [], config: {}, assets: [
      { sceneIndex: 1, kind: 'bg', slot: 0, src: 'provider-images/001.png', prompt: 'a' },
      { sceneIndex: 2, kind: 'bg', slot: 0, src: 'provider-images/001.reuse-002.png', prompt: 'a' },
    ], coverAsset: { mode: 'auto', path: 'covers/cover-auto-r1.reuse-scene.png', revision: 1 } };
    expect(costEntriesFromHtmlPipeline(pipeline, hints).filter(entry => entry.kind === 'image').reduce((sum, entry) => sum + (entry.images ?? 0), 0)).toBe(1);
  });

  it('derives model hints from the active image / TTS provider config', () => {
    const config = normalizeAppConfig(defaultConfig);
    const result = projectCostModelHints({ ...config, imageProvider: 'custom', customImage: { ...config.customImage, model: 'my-image' } });
    expect(result.image).toEqual({ provider: 'custom', model: 'my-image' });
  });
});

describe('H-5 identical prompt dedupe in one HTML asset run', () => {
  const scene = (index: number): HtmlVideoScenePlan => ({
    index, narration: `第${index}幕。`, title: `第${index}幕`, captions: [`第${index}幕。`], sceneTemplate: 'center-focus',
    background: { prompt: '同一个城市夜景' }, elements: [{ slot: 0, prompt: index === 1 ? '人物 A' : '人物 B' }],
  });
  async function withTask(run: (task: Awaited<ReturnType<FileDatabase['createTask']>>, dir: string) => Promise<void>) {
    const dir = await temp();
    const db = await FileDatabase.open(join(dir, 'app.db'));
    try { await run(await db.createTask({ title: 'dedupe', inputText: '第一幕。', taskType: 'html-video', style: 'modern-film', ratio: '9:16', speaker: 'voice' }), dir); }
    finally { await db.close(); }
  }
  const generatorFor = (dir: string, calls: string[]): NonNullable<RunTaskOptions['generateImages']> => async (scenes, prompts) => {
    const assets: SceneAsset[] = [];
    for (const [index, item] of scenes.entries()) {
      calls.push(prompts[index].prompt);
      const path = join(dir, `${String(item.id).padStart(3, '0')}.png`);
      await writeFile(path, `image-${item.id}`);
      assets.push({ sceneId: item.id, path });
    }
    return assets;
  };

  it('reuses the first result for identical prompts via a private copy when enabled', async () => {
    await withTask(async (task, dir) => {
      const calls: string[] = [];
      const assets = await adaptHtmlVideoAssetGenerator(generatorFor(dir, calls), task, { dedupeIdenticalPrompts: true, inspectAssetTransparency: async () => true })({
        scenes: [scene(1), scene(2)], config: { ratio: '9:16', foreground: true },
      });
      expect(calls).toHaveLength(3);
      const backgrounds = assets.filter(asset => asset.kind === 'bg');
      expect(backgrounds).toHaveLength(2);
      expect(backgrounds[1].src).not.toBe(backgrounds[0].src);
      expect(backgrounds[1].src).toContain('.reuse-');
      expect(await readFile(backgrounds[1].src, 'utf8')).toBe(await readFile(backgrounds[0].src, 'utf8'));
    });
  });

  it('keeps one provider call per slot when dedupe is off (default for direct callers)', async () => {
    await withTask(async (task, dir) => {
      const calls: string[] = [];
      await adaptHtmlVideoAssetGenerator(generatorFor(dir, calls), task, { inspectAssetTransparency: async () => true })({
        scenes: [scene(1), scene(2)], config: { ratio: '9:16', foreground: true },
      });
      expect(calls).toHaveLength(4);
    });
  });

  it('is enabled for the HTML runtime providers', async () => {
    expect(await source('src/shared/task-runtime-providers.ts')).toContain('dedupeIdenticalPrompts: true,');
  });
});

describe('U-5 IPC and UI contract', () => {
  it('registers project:cost-summary end to end with an id-only input', async () => {
    expect(INVOKE_CHANNELS).toContain('project:cost-summary');
    expect(ipcInputSchemas['project:cost-summary'].safeParse('task-1').success).toBe(true);
    expect(ipcInputSchemas['project:cost-summary'].safeParse({ id: 'task-1', extra: 1 }).success).toBe(false);
    expect(await source('electron/preload.ts')).toContain("getProjectCostSummary: (id) => invokeTrusted('project:cost-summary', id),");
    const main = await source('electron/main.ts');
    expect(main).toContain("trustedHandle('project:cost-summary'");
    expect(main).toContain('collectProjectCostReport({ task, workDir: taskWorkDir(task)');
  });

  it('shows the cost panel from the project card and the price editor in settings', async () => {
    const [panel, home, settings, editor] = await Promise.all([
      source('src/features/projects/ProjectCostPanel.tsx'), source('src/features/projects/ProjectHomePage.tsx'),
      source('src/features/settings/SettingsPage.tsx'), source('src/features/settings/CostPriceTableFields.tsx'),
    ]);
    expect(panel).toContain('api.getProjectCostSummary(task.id)');
    expect(panel).toContain('onClick={() => void loadCost()}');
    expect(panel).toContain('重新统计');
    expect(panel).toContain('disabled={busy}');
    expect(panel).toContain('role="alert"');
    expect(panel).toContain('可能已计费 {summary.possiblyBilled} 次');
    expect(panel).toContain('report.expectedImages.label');
    expect(panel).toContain('aria-label="成本"');
    expect(home).toContain('<IconButton label="项目成本"');
    expect(home).toContain('<ProjectCostDialog key={costTask.id}');
    expect(settings).toContain('<CostPriceTableFields config={draft} onChange={(costPriceTable) => setSettingsDraft({ ...draft, costPriceTable })} />');
    expect(editor).toContain('添加单价');
    expect(editor).toContain('每千字配音');
  });
});
