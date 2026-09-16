import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/app/app-state';
import { ViralAnalyzerPage } from '../src/features/viral/ViralAnalyzerPage';
import { ViralReport } from '../src/features/viral/ViralReport';
import { ReferenceCoverageOverview, ReferenceGlobalSummary, referenceObservations, referenceTimeLabel, ViralReferenceReport } from '../src/features/viral/ViralReferenceReport';
import { ReferenceCapabilityFields, ViralReferenceRunSettings } from '../src/features/viral/ViralReferenceRunSettings';
import { REFERENCE_TRACKS, REFERENCE_TRACK_LABELS, type ReferenceManifest, type ReferenceObservation, type ReferencePart } from '../src/shared/viral-reference';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import type { ViralAnalysisResult } from '../src/shared/types';
import { StoryDreamProvider } from '../src/ui';

function render(element: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(StoryDreamProvider, { theme: 'light', children: element }));
}

function coverageFixture(): ReferenceManifest {
  return {
    schemaVersion: 1, revision: 3, basedOnRunGeneration: 1, sourceMediaId: 'source', sourceMediaSha256: 'a'.repeat(64),
    durationMs: 150000, scope: 'whole-video', scanPlanHash: 'b'.repeat(64), parts: [],
    coverageSummary: REFERENCE_TRACKS.map((track) => ({ track, observedMs: track === 'shot' ? 150000 : 0, inferredMs: track === 'narrative' ? 30000 : 0, notAnalyzedMs: track === 'shot' ? 0 : track === 'narrative' ? 120000 : 150000, presentMs: track === 'shot' ? 150000 : 0, absentMs: 0, unknownMs: track === 'shot' ? 0 : 150000 })),
    coverageState: 'partial', totals: { shots: 5, evidence: 15, observations: 12 }, createdAt: '2026-09-16T00:00:00.000Z',
  };
}

describe('whole-video reference report', () => {
  it('defaults to whole-video input without starting a model call or forcing a short-video duration', () => {
    const api = { createAndRunViralAnalysis: vi.fn(), importLocalViralAnalysis: vi.fn() } as unknown as StoryDreamApi;
    const html = render(createElement(ViralAnalyzerPage, { api, state: initialState, applyState: vi.fn(), refreshViralEvents: vi.fn(), onActiveAnalysisChange: vi.fn(), openTaskDetail: vi.fn(), isBrowserPreview: false }));
    expect(html).toContain('整体拆解');
    expect(html).toContain('本地视频');
    expect(html).toContain('本次模型调用上限');
    expect(html).toContain('不限制原片时长');
    expect(html).not.toContain('关键帧数量');
    expect(api.createAndRunViralAnalysis).not.toHaveBeenCalled();
    expect(api.importLocalViralAnalysis).not.toHaveBeenCalled();
  });

  it('keeps unknown tracks visible instead of equating unavailable audio with no music', () => {
    const html = render(createElement(ReferenceCoverageOverview, { manifest: coverageFixture() }));
    for (const track of REFERENCE_TRACKS) expect(html).toContain(REFERENCE_TRACK_LABELS[track]);
    expect(html).toContain('有证据观察');
    expect(html).toContain('推断 / 待复核');
    expect(html).toContain('未分析');
    expect(html).toContain('80.0%');
    expect(html).not.toContain('未发现配乐');
  });

  it('shows a pending report independently of completion and disables exports before an index exists', () => {
    const api = {} as StoryDreamApi;
    const html = render(createElement(ViralReferenceReport, { api, analysisId: 'pending-analysis', readOnly: false, refreshKey: 'paused:1' }));
    expect(html).toContain('正在读取拆解索引');
    expect(html).toContain('视听时间线');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Markdown<\/span><\/button>/u);
    expect(html).not.toContain('整体拆解完成');
  });

  it('combines shot and cross-shot observations in source order using stable IDs', () => {
    const observation = (id: string, startMs: number): ReferenceObservation => ({ id, range: { startMs, endMs: startMs + 100 }, text: id, track: 'shot', state: 'inferred', presence: 'unknown', evidenceIds: ['frame'], confidence: 'low', origin: 'model' });
    const later = observation('later', 2000);
    const first = observation('first', 0);
    const part = { observations: [later], shots: [{ observations: [first, later] }] } as unknown as ReferencePart;
    expect(referenceObservations(part).map((item) => item.id)).toEqual(['first', 'later']);
    expect(referenceTimeLabel(151250)).toBe('02:31.3');
  });

  it('does not offer old generation actions for a decomposition with no recreation', () => {
    const result = {
      source: { title: '整片分析' }, transcript: [], frames: [], recreationState: 'not-requested',
      contentBreakdown: { topic: '', title: { original: '', pattern: '' }, opening: { type: '', analysis: '' }, structure: { type: '', analysis: '' }, ending: { type: '', analysis: '' }, viralPoint: { summary: '', reusablePattern: '' } },
    } as unknown as ViralAnalysisResult;
    const html = render(createElement(ViralReport, { result, readOnly: false, createProductionTask: vi.fn(), saveTemplates: vi.fn() }));
    expect(html).not.toContain('生成新任务');
    expect(html).not.toContain('保存为模板');
  });

  it('shows global narrative and rules without upgrading partial coverage', () => {
    const manifest = coverageFixture();
    manifest.summary = { overview: '全片围绕对照实验展开。', narrative: '问题—实验—结果', rhythm: '前段快切，中段长镜演示。', productionRules: ['用结果特写承接提问。'], limitations: ['原片混合音轨无法可靠分轨。'] };
    const overview = render(createElement(ReferenceGlobalSummary, { manifest, view: 'overview' }));
    const blueprint = render(createElement(ReferenceGlobalSummary, { manifest, view: 'blueprint' }));
    expect(overview).toContain('问题—实验—结果');
    expect(overview).toContain('原片混合音轨无法可靠分轨');
    expect(blueprint).toContain('用结果特写承接提问');
    expect(blueprint).toContain('尚未生成可直接执行的制作工程');
    expect(overview).not.toContain('整体拆解完成');
  });

  it('requires an explicit provider capability choice and keeps failed request resubmission off by default', () => {
    const onConfigure = vi.fn();
    const html = render(createElement(ViralReferenceRunSettings, { analysisId: 'paused', settings: { track: '', style: '', ratio: '9:16', templateId: '', maxAnalysisRequests: 64 }, busy: false, onConfigure }));
    expect(html).toContain('新的累计调用上限');
    expect(html).toContain('默认不会自动重新发送');
    expect(html).toContain('重复计费');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?允许重新提交已核对的请求<\/span><\/button>/u);
    expect(onConfigure).not.toHaveBeenCalled();
    const capabilities = render(createElement(ReferenceCapabilityFields, { visualInput: 'video', audioInput: true, onVisualChange: vi.fn(), onAudioChange: vi.fn() }));
    expect(capabilities).toContain('video_url');
    expect(capabilities).toContain('input_audio');
  });
});
