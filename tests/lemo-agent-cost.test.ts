import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeHarness, nativeSettings } from './lemo-native.fixture';
import { stepLemoUpstreamAgent, recoverLemoUpstreamAgentTurn, type LemoAgentImages, type LemoAgentOptions } from '../electron/lemo-upstream-agent';
import { createLemoAgentCostControl, estimateLemoAgentRunCost, type LemoAgentCostPricing } from '../electron/lemo-agent-cost';
import { LEMO_UPSTREAM_REVISION } from '../electron/lemo-upstream-source';
import { lemoAgentCostPricingWarning, lemoAgentCostProgressText, lemoAgentCostUnit, lemoAgentMaxCost } from '../src/shared/creative-animation/agent-cost';
import { lemoAgentMaxTurns, lemoAgentProgressText } from '../src/shared/creative-animation/upstream-agent';
import { lemoAgentBudgetResume, voxProductionSettingsSchema, type VoxProductionNode, type VoxProductionSettings } from '../src/shared/vox-production';
import { summarizeErrorMessage } from '../src/components/ErrorDetails';
import { CreativeProductionFields } from '../src/features/editorial-collage/CreativeProductionFields';
import { VoxProductionProgress } from '../src/features/editorial-collage/VoxProductionProgress';
import { createEditorialCollageDraft, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { AppConfig } from '../src/shared/types';

vi.mock('../src/ui', async importOriginal => ({ ...await importOriginal<typeof import('../src/ui')>(),
  Dialog: ({ children, actions }: { children?: ReactNode; actions?: ReactNode }) => createElement('section', null, children, actions) }));

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const source = '```json\n{"tool":"write_file","path":"index.html"}\n```\n```html\n<div>test-only mock</div>\n```';
const finish = '{"tool":"finish","notes":"检查收到的三个真实帧窗口，主体构图和文字位置一致，没有裁切；审美意见独立于技术检查。"}';
const list = '{"tool":"list_files","scope":"project"}';
/** 100k input + 10k output tokens at ¥10 / ¥20 per 1M = ¥1.20 per turn. */
const usage = { prompt_tokens: 100_000, completion_tokens: 10_000 };
const hints = { llm: { provider: 'openai', model: 'mock-llm' }, image: { provider: 'mock', model: 'mock-image' }, tts: { provider: '', model: '' } };
const priced: LemoAgentCostPricing = { hints, priceTable: { currency: 'CNY', rows: [{ model: 'mock-llm', kind: 'llm', inputPer1M: 10, outputPer1M: 20 }, { model: 'mock-image', kind: 'image', perImage: 0.5 }] } };
const unpriced: LemoAgentCostPricing = { hints, priceTable: { currency: 'CNY', rows: [{ model: 'some-other-model', inputPer1M: 1, outputPer1M: 1 }] } };

async function harness(pricing: () => LemoAgentCostPricing) {
  const root = await mkdtemp(join(tmpdir(), 'lemo-cost-')); roots.push(root);
  const model = vi.fn<LemoAgentOptions['model']>(async () => ({ text: list, raw: '', requestId: 'mock', finishReason: 'stop', usage }));
  const contexts: string[] = [];
  const options = (d: EditorialCollagePipelineData, node: VoxProductionNode): LemoAgentOptions => {
    const runRoot = join(root, d.productionRun!.id);
    return { root: runRoot, upstreamRoot: resolve('vendor/lemo-upstream'), turn: Number(node.fileId), requestId: node.requestId, retryOfRequestId: node.retryOfRequestId,
      maxTurns: lemoAgentMaxTurns(d.productionRun!.settings.agentMaxTurns),
      cost: createLemoAgentCostControl(runRoot, lemoAgentMaxCost(d.productionRun!.settings.agentMaxCost), pricing),
      context: { runId: d.productionRun!.id, styleId: 'brick-toy', brief: d.sourceText ?? '', durationSeconds: d.timeline!.durationMs / 1000, width: 1920, height: 1080 }, model,
      review: async (directory, outputDir, times) => {
        await mkdir(outputDir, { recursive: true });
        const frames = await Promise.all(times.map(async (time, i) => { const path = join(outputDir, i + '.png'); await writeFile(path, Buffer.from('89504e470d0a1a0a', 'hex')); return { time, path }; }));
        return { revision: LEMO_UPSTREAM_REVISION, entry: directory, durationSeconds: d.timeline!.durationMs / 1000, width: 1920, height: 1080, frames, errors: [], missingResources: [], failedFonts: [], technicalPassed: true, aestheticReview: false };
      } };
  };
  const h = nativeHarness({ upstreamStep: async (d, n) => { const o = options(d, n); contexts.push(JSON.stringify(o.context)); return { ...d, upstreamFilm: await stepLemoUpstreamAgent(o) }; },
    recoverUpstreamStep: async (d, n) => { const film = await recoverLemoUpstreamAgentTurn(join(root, d.productionRun!.id), Number(n.fileId)); return film ? { ...d, upstreamFilm: film } : undefined; } });
  return { ...h, model, root, contexts };
}
const turnNode = (d: EditorialCollagePipelineData, turn: number) => d.productionRun!.nodes.find(n => n.id === `upstream-turn:${turn}`);

describe('Lemo Agent cost budget (L-4, U-5 price table)', () => {
  it('stops before the paid turn that would exceed the budget, as a resumable failure (never unknown)', async () => {
    const h = await harness(() => priced);
    await h.start(nativeSettings({ agentMaxCost: 3 })); await h.idle();
    // ¥1.20 per turn: 2.40 < 3 allows turn 3; 3.60 >= 3 stops before turn 4 is submitted.
    expect(h.model).toHaveBeenCalledTimes(3);
    const d = h.get();
    expect(d.productionRun?.status).toBe('failed');
    expect(d.productionRun?.message).toMatch(/^LEMO_AGENT_COST_LIMIT: 已达到费用预算 ¥3\.00（已用约 ¥3\.60），调高预算后可“重试失败步骤”续跑/);
    expect(d.productionRun?.message).toContain('不是硬性上限');
    expect(turnNode(d, 4)).toMatchObject({ status: 'failed' });
    expect(turnNode(d, 4)?.error).toMatch(/^LEMO_AGENT_COST_LIMIT:/);
    expect(existsSync(join(h.root, d.productionRun!.id, 'turn-0004', 'submitted.json'))).toBe(false);
    expect(summarizeErrorMessage(d.productionRun!.message!)).toContain('费用预算');
    expect(d.upstreamFilm).toMatchObject({ turn: 3, cost: { currency: 'CNY', spent: 3.6, unpricedCalls: 0, possiblyBilled: 0 } });
    expect(lemoAgentProgressText(d.upstreamFilm, d.productionRun!.settings)).toBe('原生 Agent 第 3 / 64 轮 · 已用 330,000 tokens（输入 300,000 / 输出 30,000） · 约 ¥3.60 / ¥3.00');
    // The budget never reaches the Agent: no message or context mentions it.
    for (const call of h.model.mock.calls) expect(JSON.stringify(call[0].messages)).not.toMatch(/¥|费用预算|agentMaxCost/);
    expect(h.contexts.every(context => !context.includes('agentMaxCost'))).toBe(true);
  });

  it('resumes after the budget is raised without buying completed turns again; input hashes are unchanged', async () => {
    const h = await harness(() => priced);
    const run = await h.start(nativeSettings({ agentMaxCost: 3 })); await h.idle();
    const stopped = h.get();
    const hashes = stopped.productionRun!.nodes.filter(n => n.status === 'completed').map(n => [n.id, n.inputHash]);
    const node = stopped.productionRun!.nodes.find(n => n.status === 'completed' && n.kind === 'film-edit')!;
    const withoutBudget = { ...stopped, productionRun: { ...stopped.productionRun!, settings: { ...stopped.productionRun!.settings, agentMaxCost: undefined } } };
    expect(h.runtime.input(stopped, node)).toEqual(h.runtime.input(withoutBudget, node));
    // The user saves a higher budget in project settings and presses "重试失败步骤".
    h.set({ ...stopped, productionSettings: { ...stopped.productionSettings!, agentMaxCost: 6 } });
    const resumed = await h.service.control({ id: stopped.id, runId: run.id, action: 'resume' });
    expect(resumed.id).toBe(run.id); expect(resumed.settings.agentMaxCost).toBe(6);
    await h.idle();
    // Turns 1–3 are reused; turns 4 and 5 are bought (3.60 → 6.00), then the raised budget stops turn 6.
    expect(h.model).toHaveBeenCalledTimes(5);
    const after = h.get();
    expect(after.upstreamFilm).toMatchObject({ turn: 5, cost: { spent: 6 } });
    expect(after.productionRun?.message).toMatch(/^LEMO_AGENT_COST_LIMIT: 已达到费用预算 ¥6\.00（已用约 ¥6\.00）/);
    for (const [id, hash] of hashes) expect(after.productionRun!.nodes.find(n => n.id === id)?.inputHash).toBe(hash);
    // Clearing the budget (不限) is adopted the same way.
    expect(lemoAgentBudgetResume(after.productionRun!, {}).settings).not.toHaveProperty('agentMaxCost');
  });

  it('never blocks on unpriced models and warns that the budget cannot constrain them', async () => {
    const h = await harness(() => unpriced);
    h.model.mockImplementation(async request => { const text = [source, '{"tool":"review_frames"}', finish][(request.step - 1) % 3]; return { text, raw: text, requestId: 'mock', finishReason: 'stop', usage }; });
    await h.start(nativeSettings({ agentMaxCost: 0.1 })); await h.idle();
    const d = h.get();
    expect(d.productionRun?.status, d.productionRun?.message).toBe('completed');
    expect(h.model).toHaveBeenCalledTimes(3);
    expect(d.upstreamFilm?.cost).toEqual({ currency: 'CNY', spent: null, unpricedCalls: 3, possiblyBilled: 0 });
    const text = lemoAgentProgressText(d.upstreamFilm, d.productionRun!.settings);
    expect(text).toContain('费用预算 ¥0.10（尚无可定价的调用）');
    expect(text).toContain('3 次调用未定价（费用预算无法约束未定价的模型）');
  });

  it('never resends a paid call whose result is unknown, even when the budget is exhausted', async () => {
    const h = await harness(() => priced);
    h.model.mockImplementationOnce(async () => ({ text: list, raw: '', requestId: 'mock', finishReason: 'stop', usage }))
      .mockRejectedValueOnce(new Error('socket disconnected after submit'));
    const run = await h.start(nativeSettings({ agentMaxCost: 50 })); await h.idle();
    expect(turnNode(h.get(), 2)?.status).toBe('unknown');
    // The unknown call is "可能已计费": counted separately, never priced, never a reason to resend.
    expect(await estimateLemoAgentRunCost(join(h.root, run.id), priced)).toEqual({ currency: 'CNY', spent: 1.2, unpricedCalls: 0, possiblyBilled: 1 });
    await expect(h.service.control({ id: h.get().id, runId: run.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
    expect(h.model).toHaveBeenCalledTimes(2);
    // Direct agent call with an exhausted budget: the existing submission wins (unknown), never the budget stop or a resend.
    const model = vi.fn<LemoAgentOptions['model']>();
    const d = h.get();
    await expect(stepLemoUpstreamAgent({ root: join(h.root, run.id), upstreamRoot: resolve('vendor/lemo-upstream'), turn: 2, requestId: 'another', model,
      context: { runId: run.id, styleId: 'brick-toy', brief: d.sourceText ?? '', durationSeconds: d.timeline!.durationMs / 1000, width: 1920, height: 1080 },
      cost: { maxCost: 0.1, estimate: async () => ({ currency: 'CNY', spent: 99, unpricedCalls: 0, possiblyBilled: 1 }) },
      review: async () => { throw new Error('unused'); } })).rejects.toThrow('LEMO_AGENT_REQUEST_UNKNOWN');
    expect(model).not.toHaveBeenCalled();
  });

  it('checks the budget before a priced illustration; the saved reply replays free after raising it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lemo-cost-image-')); roots.push(root);
    const generatedPng = join(root, 'provider-output.png'); await writeFile(generatedPng, 'generated-png-bytes');
    const request = '```json\n' + JSON.stringify({ tool: 'request_image', id: 'g1', prompt: 'a hand-painted lighthouse keeper in warm gouache', transparent: false }) + '\n```';
    const model = vi.fn<LemoAgentOptions['model']>(async () => ({ text: request, raw: request, requestId: 'mock', finishReason: 'stop', usage }));
    const images: LemoAgentImages = { provider: 'mock-image', isRejection: () => false, generate: vi.fn(async () => ({ path: generatedPng })), recover: vi.fn(async () => undefined) };
    const media = { probe: async () => ({ width: 800, height: 600, durationSeconds: null }), frames: async () => 0,
      thumbnail: async (sourcePath: string, dest: string) => { await mkdir(join(dest, '..'), { recursive: true }); await writeFile(dest, await readFile(sourcePath)); } };
    const runRoot = join(root, 'run');
    const base: LemoAgentOptions = { root: runRoot, upstreamRoot: resolve('vendor/lemo-upstream'), model, images, assetHost: { files: {}, media },
      context: { runId: 'image-run', styleId: 'brick-toy', brief: '用插画制作影片。', durationSeconds: 3, width: 1920, height: 1080, imageGeneration: { maxImages: 2 } },
      review: async () => { throw new Error('unused'); } };
    // Turn 1's model call (¥1.20) passes the ¥1 budget check (nothing spent yet); its illustration does not.
    await expect(stepLemoUpstreamAgent({ ...base, requestId: 'n1', cost: createLemoAgentCostControl(runRoot, 1, priced) })).rejects.toThrow(/^LEMO_AGENT_COST_LIMIT: 已达到费用预算 ¥1\.00（已用约 ¥1\.20）/);
    expect(images.generate).not.toHaveBeenCalled();
    expect(existsSync(join(runRoot, 'turn-0001', 'image.json'))).toBe(false);
    expect(await readdir(join(runRoot, 'turn-0001'))).toContain('response.json');
    const film = await stepLemoUpstreamAgent({ ...base, requestId: 'n2', cost: createLemoAgentCostControl(runRoot, 5, priced) });
    expect(model).toHaveBeenCalledTimes(1);
    expect(images.generate).toHaveBeenCalledTimes(1);
    expect(film.message).toContain('"id":"g1"');
    expect(film.cost).toEqual({ currency: 'CNY', spent: 1.7, unpricedCalls: 0, possiblyBilled: 0 });
  });
});

describe('Lemo Agent cost budget helpers and UI (L-4)', () => {
  const settings = (patch: Partial<VoxProductionSettings> = {}) => voxProductionSettingsSchema.parse({ version: 1, presetId: 'paper-explainer', presetVersion: 1, authoring: { mode: 'ai-code', styleId: 'brick-toy' }, ...patch });
  const config = (rows: unknown[]) => ({ llm: { provider: 'openai', model: 'mock-llm' }, imageProvider: 'gpt-image', gptImage: { model: 'mock-image' }, tts: {}, costPriceTable: { currency: 'CNY', rows } }) as unknown as AppConfig;

  it('keeps old settings unlimited and bounds the budget', () => {
    expect(settings()).not.toHaveProperty('agentMaxCost');
    expect(lemoAgentMaxCost(undefined)).toBeUndefined(); expect(lemoAgentMaxCost(0)).toBeUndefined();
    expect(settings({ agentMaxCost: 12.5 }).agentMaxCost).toBe(12.5);
    expect(() => settings({ agentMaxCost: 0.01 })).toThrow(); expect(() => settings({ agentMaxCost: 1_000_000 })).toThrow();
    // No budget and no price: the progress line is unchanged.
    expect(lemoAgentCostProgressText(undefined, undefined)).toBe('');
    expect(lemoAgentCostProgressText({ currency: 'CNY', spent: null, unpricedCalls: 4, possiblyBilled: 0 }, undefined)).toBe('');
    expect(lemoAgentCostProgressText({ currency: 'CNY', spent: 2, unpricedCalls: 1, possiblyBilled: 1 }, undefined)).toBe('约 ¥2.00 · 1 次调用未定价 · 1 次结果未知、可能已计费（未计入）');
    expect(lemoAgentCostPricingWarning(config([{ model: 'mock-llm', inputPer1M: 1, outputPer1M: 2 }]), { images: false })).toBeUndefined();
    expect(lemoAgentCostPricingWarning(config([{ model: 'mock-llm', inputPer1M: 1, outputPer1M: 2 }]), { images: true })).toContain('生图模型 mock-image 未在“成本单价”中定价');
  });

  it('renders the cost budget next to the token budget, with the unpriced warning (SSR)', () => {
    const document = createEditorialCollageDraft({ id: 'cost-ui', title: '港口', ratio: '16:9' });
    const render = (value: VoxProductionSettings, costConfig?: AppConfig) => renderToStaticMarkup(createElement(CreativeProductionFields, { settings: value, onChange: () => undefined, onOpenUrl: async () => undefined, document, costConfig }));
    const html = render(settings());
    expect(html).toContain('费用预算（元）');
    expect(html.indexOf('费用预算（元）')).toBeGreaterThan(html.indexOf('Token 预算'));
    expect(html).toContain('未定价的模型只计次数，不受预算约束');
    expect(html).not.toContain('data-lemo-cost-warning');
    const warned = render(settings({ agentMaxCost: 20 }), config([]));
    expect(warned).toContain('value="20"');
    expect(warned).toContain('费用预算无法完全生效：文本模型 mock-llm 未在“成本单价”中定价');
    expect(render(settings({ agentMaxCost: 20 }), config([{ model: 'mock-llm', inputPer1M: 1, outputPer1M: 2 }]))).not.toContain('data-lemo-cost-warning');
    expect(render(voxProductionSettingsSchema.parse({ version: 1, presetId: 'paper-explainer', presetVersion: 1, authoring: { mode: 'template', styleId: 'auto' } }))).not.toContain('费用预算（元）');
    // Cumulative-estimate stop, not a hard cap: the UI must not promise "never over budget".
    expect(html).toContain('不是硬性费用上限'); expect(html).toContain('最后一次请求可能超出剩余额度');
    expect(html).not.toMatch(/绝不超支|不会超出预算|保证不超/);
  });

  it('labels the budget with the price-table currency (non-CNY SSR)', () => {
    const document = createEditorialCollageDraft({ id: 'cost-ui-usd', title: '港口', ratio: '16:9' });
    const usd = { ...config([{ model: 'mock-llm', inputPer1M: 1, outputPer1M: 2 }]), costPriceTable: { currency: 'usd', rows: [{ model: 'mock-llm', inputPer1M: 1, outputPer1M: 2 }] } } as unknown as AppConfig;
    const html = renderToStaticMarkup(createElement(CreativeProductionFields, { settings: settings({ agentMaxCost: 20 }), onChange: () => undefined, onOpenUrl: async () => undefined, document, costConfig: usd }));
    expect(html).toContain('费用预算（USD）'); expect(html).toContain('data-currency="USD"'); expect(html).toContain('币种（USD）');
    expect(html).not.toContain('费用预算（元）');
    expect(lemoAgentCostUnit(usd)).toEqual({ currency: 'USD', unit: 'USD' });
    expect(lemoAgentCostUnit(undefined)).toEqual({ currency: 'CNY', unit: '元' });
    expect(lemoAgentCostUnit({ costPriceTable: { currency: 'bad!', rows: [] } } as unknown as AppConfig)).toEqual({ currency: 'CNY', unit: '元' });
    // Stop message and progress use the same currency.
    expect(lemoAgentCostProgressText({ currency: 'USD', spent: 2.5, unpricedCalls: 0, possiblyBilled: 0 }, 2)).toBe('约 US$2.50 / US$2.00');
  });

  it('appends "· 约 ¥Y / ¥X" to the progress dialog', () => {
    const now = '2026-11-10T00:00:00.000Z';
    const node = { id: 'upstream-turn:4', kind: 'film-edit' as const, fileId: '4', dependencies: [], status: 'failed' as const, paid: true, attempt: 1, requestId: 'req-4', error: 'LEMO_AGENT_COST_LIMIT: 已达到费用预算 ¥3.00（已用约 ¥3.60）' };
    const run = { version: 1 as const, id: 'run-1', status: 'failed' as const, settings: settings({ agentMaxCost: 3 }), authoringVersion: 3 as const, sourceHash: 'h', runtimeIdentity: 'i', nodes: [node], createdAt: now, updatedAt: now };
    const html = renderToStaticMarkup(createElement(VoxProductionProgress, { run, busy: false, onClose: () => undefined, onControl: async () => undefined,
      upstreamFilm: { runId: 'run-1', turn: 3, status: 'authoring', usage: { inputTokens: 300_000, outputTokens: 30_000, reportedTurns: 3 }, cost: { currency: 'CNY', spent: 3.6, unpricedCalls: 0, possiblyBilled: 0 } } }));
    expect(html).toContain('原生 Agent 第 3 / 64 轮 · 已用 330,000 tokens（输入 300,000 / 输出 30,000） · 约 ¥3.60 / ¥3.00');
  });
});
