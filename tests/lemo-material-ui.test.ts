import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CreativeProductionFields } from '../src/features/editorial-collage/CreativeProductionFields';
import { VoxProductionProgress } from '../src/features/editorial-collage/VoxProductionProgress';
import { createEditorialCollageDraft } from '../src/shared/editorial-collage';
import { voxProductionInputErrors, voxProductionSettingsSchema, type VoxProductionSettings } from '../src/shared/vox-production';

// Server rendering cannot follow the Dialog portal; render its body and actions inline for markup checks.
vi.mock('../src/ui', async importOriginal => ({ ...await importOriginal<typeof import('../src/ui')>(),
  Dialog: ({ children, actions }: { children?: ReactNode; actions?: ReactNode }) => createElement('section', null, children, actions) }));

const settings = (styleId: string, patch: Partial<VoxProductionSettings> = {}) => voxProductionSettingsSchema.parse({ version: 1, presetId: 'paper-explainer', presetVersion: 1, authoring: { mode: 'ai-code', styleId }, ...patch });
const document = () => ({ ...createEditorialCollageDraft({ id: 'material-ui', title: '港口', ratio: '16:9' }),
  assets: [{ id: 'clip', assetId: 'clip', kind: 'video' as const, localPath: 'C:/clips/street.mp4', prompt: 'street.mp4', provider: 'local-import', createdAt: '2026-11-10T00:00:00.000Z' }] });
const render = (value: VoxProductionSettings, onImportAsset?: (kind: 'image' | 'video') => Promise<string | undefined>) =>
  renderToStaticMarkup(createElement(CreativeProductionFields, { settings: value, onChange: () => undefined, onOpenUrl: async () => undefined, document: document(), onImportAsset }));

describe('Lemo material controls (导入图片 / 导入视频 / 允许 AI 生成插画)', () => {
  it('offers image and video import plus imported videos for the Lemo route', () => {
    const html = render(settings('brick-toy'), async () => undefined);
    expect(html).toContain('导入图片');
    expect(html).toContain('导入视频');
    expect(html).toContain('引用已导入的素材');
    const withRow = render(settings('brick-toy', { archives: [{ assetVersionId: 'clip', source: '自摄', license: '自有版权' }] }), async () => undefined);
    expect(withRow).toContain('视频 · street.mp4');
    expect(withRow).toContain('画面说明（选填）');
  });
  it('keeps illustrations off by default and locks them for documentary styles', () => {
    expect(render(settings('brick-toy'))).toContain('默认全部用代码绘制，不调用生图');
    expect(render(settings('brick-toy', { agentImages: { enabled: true, maxImages: 4 } }))).toContain('插画数量上限');
    const documentary = render(settings('kino-montage', { agentImages: { enabled: true, maxImages: 4 } }));
    expect(documentary).toContain('纪实/证据类风格只使用导入的真实素材');
    expect(documentary).not.toContain('插画数量上限');
    expect(voxProductionInputErrors({ ...document(), sourceText: '文案' }, settings('kino-montage', { agentImages: { enabled: true, maxImages: 4 } })).join()).toContain('纪实/证据类');
  });
  it('keeps the template route unchanged', () => {
    const html = render(voxProductionSettingsSchema.parse({ version: 1, presetId: 'paper-explainer', presetVersion: 1, authoring: { mode: 'template', styleId: 'auto' } }));
    expect(html).toContain('自动生成图片');
    expect(html).not.toContain('允许 AI 生成插画');
    expect(html).not.toContain('Agent 轮数上限');
  });
  it('shows the Agent turn limit (default 64) and optional token budget, and the documentary credit rule (L-4 / L-2b)', () => {
    const html = render(settings('brick-toy'));
    expect(html).toContain('Agent 轮数上限'); expect(html).toContain('64 轮（默认）'); expect(html).toContain('Token 预算'); expect(html).toContain('不限（仅受轮数上限约束）');
    expect(render(settings('brick-toy', { agentMaxTurns: 72 }))).toContain('72 轮');
    expect(render(settings('kino-montage'))).toContain('片尾列出每份素材的出处与许可');
  });
  it('renders the Agent progress line and the dedicated unknown-illustration recovery (L-4 / L-2b)', () => {
    const now = '2026-11-10T00:00:00.000Z';
    const node = { id: 'upstream-turn:3', kind: 'film-edit' as const, fileId: '3', dependencies: [], status: 'unknown' as const, paid: true, attempt: 1, requestId: 'req-3', error: 'LEMO_IMAGE_REQUEST_UNKNOWN: Agent 申请的插画已提交但结果未知' };
    const run = { version: 1 as const, id: 'run-1', status: 'failed' as const, settings: settings('brick-toy', { agentMaxTurns: 96 }), authoringVersion: 3 as const, sourceHash: 'h', runtimeIdentity: 'i', nodes: [node], createdAt: now, updatedAt: now };
    const html = renderToStaticMarkup(createElement(VoxProductionProgress, { run, busy: false, onClose: () => undefined, onControl: async () => undefined,
      upstreamFilm: { runId: 'run-1', turn: 3, status: 'authoring', usage: { inputTokens: 1200, outputTokens: 300, reportedTurns: 3 } } }));
    expect(html).toContain('原生 Agent 第 3 / 96 轮 · 已用 1,500 tokens');
    expect(html).toContain('可能已经生成并计费。系统不会自动重新提交');
    expect(html).toContain('跳过这张插画'); expect(html).toContain('直接重试此步骤');
    const generic = renderToStaticMarkup(createElement(VoxProductionProgress, { run: { ...run, nodes: [{ ...node, error: 'socket disconnected' }] }, busy: false, onClose: () => undefined, onControl: async () => undefined }));
    expect(generic).not.toContain('跳过这张插画'); expect(generic).toContain('直接重试会重新提交此步骤');
    expect(generic).toContain('原生 Agent 第 0 / 96 轮');
    const piRun = { ...run, status: 'failed' as const, authoringVersion: 4 as const, nodes: [{ ...node, id: 'pi-segment:2', kind: 'agent-segment' as const, status: 'unknown' as const }] };
    const piHtml = renderToStaticMarkup(createElement(VoxProductionProgress, { run: piRun, busy: false, onClose: () => undefined, onControl: async () => undefined }));
    expect(piHtml).toContain('运行段 2 / 1');
    expect(piHtml).toContain('按旁白文本窗口提交模型上下文');
    expect(piHtml).toContain('不是独立秒数章节');
    expect(piHtml).toContain('此片段包含多次模型请求');
    expect(piHtml).toContain('恢复已保存结果');
    expect(piHtml).not.toContain('直接重试此步骤');
    expect(piHtml).not.toContain('记录核对并解锁此步骤');
    expect(piHtml).not.toContain('data-pi-evidence');
    const evidence = { technicalPassed: true, readingPassed: true, audioPassed: true, creditsPassed: true, contactSheetPasses: 2, visuallyReviewed: false, humanReviewed: false };
    const blind = renderToStaticMarkup(createElement(VoxProductionProgress, { run: piRun, piEvidence: evidence, busy: false, onClose: () => undefined, onControl: async () => undefined }));
    expect(blind).toContain('data-pi-evidence');
    expect(blind).toContain('模型未看到画面，仅做了技术检查');
    expect(blind).toContain('宿主检查通过不等于审美验收');
    expect(blind).toContain('待你确认');
    const seen = renderToStaticMarkup(createElement(VoxProductionProgress, { run: piRun, piEvidence: { ...evidence, visuallyReviewed: true, humanReviewed: true }, busy: false, onClose: () => undefined, onControl: async () => undefined }));
    expect(seen).toContain('模型已看到画面');
    expect(seen).toContain('已确认');
    expect(seen).not.toContain('记录我已观看并认可');
    expect(blind).toContain('记录我已观看并认可');
    expect(blind).toContain('我已完整观看预览的画面与声音');
    expect(blind).toMatch(/<button[^>]*disabled=""[^>]*><span class="sd-button__content">记录我已观看并认可/u);
    const v3 = renderToStaticMarkup(createElement(VoxProductionProgress, { run, piEvidence: evidence, busy: false, onClose: () => undefined, onControl: async () => undefined }));
    expect(v3).not.toContain('data-pi-evidence');
  });
});
