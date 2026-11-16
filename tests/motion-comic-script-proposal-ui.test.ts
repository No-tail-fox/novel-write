import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MotionComicScriptProposal, scriptProposalAdoptionReason } from '../src/features/motion-comic/MotionComicScriptProposal';
import { MotionComicScriptReview } from '../src/features/motion-comic/MotionComicScriptReview';
import type { MotionComicScriptDraft, MotionComicPlanRecovery } from '../src/shared/motion-comic-planning';
import type { MotionComicScriptProposal as Proposal } from '../src/shared/motion-comic-script-proposal';

const script: MotionComicScriptDraft = { title: '来信', logline: '收到来信', characters: [], sceneAssets: [], props: [], scenes: [{ key: 'room', title: '来信', actIndex: 1, actTitle: '开端', actBoundaryReason: '来信', summary: '收到信', locationKey: 'room', beats: [{ key: 'one', kind: 'action', text: '开门', sourceUnitIds: ['S1'] }] }] };
const proposal: Proposal = { id: 'p', projectId: 'project', taskId: 'task', baseRevision: 3, inputFingerprint: 'input', sceneKey: 'room', beatKey: 'one', instruction: '加强悬念', originalText: '开门', proposedText: '缓缓推开门', status: 'ready', requestId: 'request', requestFingerprint: 'fingerprint', baseProjectUpdatedAt: '2026-01-01T00:00:00Z', baseScriptHash: 'hash', promptVersion: 'v1', provider: 'mock', model: 'mock', createdAt: '2026-01-01T00:00:00Z' };
const panel = (proposals: Proposal[], disabledReason = '') => renderToStaticMarkup(createElement(MotionComicScriptProposal, { script, revision: 3, proposals, disabledReason, onPropose: vi.fn(), onAdopt: vi.fn() }));

describe('single beat proposal UI safety', () => {
  it('allows adoption only for an exact ready saved baseline', () => {
    expect(scriptProposalAdoptionReason(proposal, script, 3, '')).toBe('');
    expect(scriptProposalAdoptionReason(proposal, script, 4, '')).toContain('过期');
    expect(scriptProposalAdoptionReason(proposal, script, 3, '请先保存')).toBe('请先保存');
    for (const status of ['running', 'failed', 'stale', 'applied', 'dismissed'] as const) expect(scriptProposalAdoptionReason({ ...proposal, status }, script, 3, '')).toContain('不能采用');
    expect(scriptProposalAdoptionReason({ ...proposal, originalText: '不同正文' }, script, 3, '')).toContain('目标段落');
    expect(scriptProposalAdoptionReason({ ...proposal, proposedText: undefined }, script, 3, '')).toContain('不可用');
  });
  it('renders explicit scope, before/after, baseline and disabled explanation without invoking APIs', () => {
    const html = panel([proposal], '当前有未保存改稿，请先保存修改并校验。');
    expect(html).toContain('仅修改所选段落的正文');
    expect(html).toContain('基准 r3');
    expect(html).toContain('修改前'); expect(html).toContain('候选修改后'); expect(html).toContain('缓缓推开门');
    expect(html).toContain('请先保存修改并校验');
    expect(html).toMatch(/disabled=""[^>]*>.*?采用此段候选/s);
  });
  it('renders running, failed and absent candidate text safely', () => {
    expect(panel([{ ...proposal, status: 'running', proposedText: undefined }])).toContain('不要重复提交');
    expect(panel([{ ...proposal, status: 'failed', proposedText: undefined, error: '模拟失败' }])).toContain('模拟失败');
    expect(panel([])).toContain('尚无局部候选');
  });
  it('keeps immutable original distinct from current saved draft, and reports legacy absence', () => {
    const recovery = { token: 'task', script, sourceText: '开门', adjustments: [], needsValidation: false } as unknown as MotionComicPlanRecovery;
    const render = (originalScript?: MotionComicScriptDraft) => renderToStaticMarkup(createElement(MotionComicScriptReview, { recovery, savedScript: script, savedRevision: 3, originalScript, originalRevision: originalScript ? 1 : undefined, episodeNumber: 1, locked: false, reviewed: false, onReviewed: vi.fn() }));
    expect(render()).toContain('原稿不可用');
    const html = render({ ...script, title: '首次模型标题' });
    expect(html).toContain('首次模型标题'); expect(html).toContain('服务器当前稿'); expect(html).toContain('r1'); expect(html).toContain('r3');
  });
});
