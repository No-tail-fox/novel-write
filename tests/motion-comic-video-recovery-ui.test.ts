import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DirectorDeskWorkspace, type DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';
import { assertMotionComicVideoRecovery } from '../src/features/motion-comic/MotionComicPage';
import { MotionComicVideoReadiness } from '../src/features/motion-comic/MotionComicVideoReadiness';
import type { MotionComicPipelineData } from '../src/shared/motion-comic';

vi.mock('../src/ui', async importOriginal => ({
  ...await importOriginal<typeof import('../src/ui')>(),
  Drawer: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}));
function markup(patch: Partial<DirectorShot>) {
  const props: ComponentProps<typeof DirectorDeskWorkspace> = {
    mode: 'motion-comic', projectTitle: '恢复测试', projectMeta: '', episodeTitle: '第一集', stageLabel: '镜头生成',
    selectedShotId: 'shot', dirty: false, providerConnected: true, videoProviderConnected: false,
    shots: [{ id: 'shot', index: 1, title: '镜头', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '', renderStrategy: 'living-poster', videoInputReady: false, ...patch }],
    onSelectShot: () => {}, onUpdateShot: () => {}, onSave: () => {},
    onResumeVideo: async () => {}, onGenerateVideo: async () => ({ videoUrl: 'fake', provider: 'fake', model: 'fake', estimatedCost: 0, jobId: 'fake' }),
  };
  return renderToStaticMarkup(createElement(DirectorDeskWorkspace, props));
}
function action(html: string, label: string) {
  return (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find(button => button.includes(label));
}
describe('motion-comic recovery actions', () => {
  it('exposes recovery in the compact make inspector without requiring current input readiness', () => {
    const html = renderToStaticMarkup(createElement(MotionComicVideoReadiness, {
      compact: true, remoteOnly: true, connected: false, busy: false,
      providerLabel: '', providerModel: '', providerOptions: [],
      onStrategyChange: () => {}, onResumeVideo: async () => {},
      shot: { id: 'shot', index: 1, title: '镜头', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '', renderStrategy: 'living-poster', videoInputReady: false, videoRecovery: 'resume', videoJobStatus: 'running' },
    }));
    expect(action(html, '恢复查询原视频任务')).toBeDefined();
    expect(action(html, '恢复查询原视频任务')).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });
  it.each(['running', 'failed'] as const)('allows query-only recovery of a known %s remote task', status => {
    const original = { id: 'job', status: 'running', remoteTaskId: 'remote' } as MotionComicPipelineData['providerJobs'][number];
    const current = { ...original, status };
    const query = vi.fn();
    expect(() => { assertMotionComicVideoRecovery(current, original); query(); }).not.toThrow();
    expect(query).toHaveBeenCalledOnce();
    const html = markup({ videoRecovery: 'resume', videoJobStatus: status, videoHasAttempt: true });
    expect(action(html, '恢复查询')).toBeDefined();
    expect(action(html, '恢复查询')).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(html).toContain('只查询原云端任务并取回结果，不重新提交生成');
    expect(html).not.toContain('重试会新建视频任务');
  });
  it.each(['completed', 'cancelled', 'missing-id', 'different-id', 'different-job'])('rejects a changed persisted task before API submission (%s)', change => {
    const original = { id: 'job', status: 'running', remoteTaskId: 'remote' } as MotionComicPipelineData['providerJobs'][number];
    const current = { ...original };
    if (change === 'missing-id') delete current.remoteTaskId;
    else if (change === 'different-id') current.remoteTaskId = 'other';
    else if (change === 'different-job') current.id = 'other';
    else current.status = change as typeof current.status;
    const api = vi.fn();
    expect(() => { assertMotionComicVideoRecovery(current, original); api(); }).toThrow('不会重新提交生成');
    expect(api).not.toHaveBeenCalled();
    expect(() => assertMotionComicVideoRecovery(original, original)).not.toThrow();
  });
  it('enables original task query even if current inputs and provider are unavailable', () => {
    const html = markup({ videoRecovery: 'resume', videoJobStatus: 'running', videoHasAttempt: true });
    expect(action(html, '恢复查询')).toBeDefined();
    expect(action(html, '恢复查询')).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(html).toContain('不重新提交生成');
  });
  it('blocks unknown submission with a visible reconciliation explanation', () => {
    const html = markup({ videoRecovery: 'unknown', videoJobStatus: 'running', videoHasAttempt: true });
    expect(action(html, '提交状态待核对')).toMatch(/\sdisabled(?:=|\s|>)/);
    expect(html).toContain('不会自动重新提交');
    expect(action(html, '恢复查询')).toBeUndefined();
  });
  it('explains a terminal task retry creates a new billable attempt', () => {
    const html = markup({ videoJobStatus: 'failed', videoHasAttempt: true });
    expect(action(html, '重新生成')).toBeDefined();
    expect(html).toContain('可能产生新的生成费用');
    expect(html).not.toContain('重试视频生成');
  });
  it('keeps a pending candidate recoverable when an adopted video exists', () => {
    const html = markup({ videoUrl: 'fake.mp4', videoRecovery: 'resume', videoJobStatus: 'running', videoHasAttempt: true });
    expect(action(html, '恢复查询')).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(html).toContain('沿用原任务的版本采纳方式');
  });
});
