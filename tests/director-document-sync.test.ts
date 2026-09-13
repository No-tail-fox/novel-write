import { describe, expect, it } from 'vitest';
import { mergeDirectorSavedDocument } from '../src/shared/director-document-sync';
import { createEditorialCollageDraft, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { ProductionAssetVersion, ProductionProviderJob, ProductionQualityReport } from '../src/shared/production-workflow';

const now = '2026-09-06T00:00:00.000Z';
const asset = (id: string): ProductionAssetVersion => ({ id, assetId: id, kind: 'video', selected: true, localPath: `E:/fixture/${id}.mp4`, createdAt: now });
const job: ProductionProviderJob = { id: 'job', nodeId: 'project', workflowKind: 'editorial-collage', providerId: 'local', model: 'ffmpeg', capability: 'deterministic-render', status: 'running', inputHash: 'input', idempotencyKey: 'render', estimatedCost: 0, attempt: 1, createdAt: now, updatedAt: now };
const draft = () => createEditorialCollageDraft({ id: 'project', title: 'Original', now });

describe('director document response reconciliation', () => {
  it('accepts the saved object when no editing followed the submitted snapshot', () => {
    const submitted = draft();
    const saved = { ...submitted, assets: [asset('render')] };
    expect(mergeDirectorSavedDocument(submitted, submitted, saved)).toBe(saved);
  });

  it('retains new editing and server artifacts through strict save/reopen', () => {
    const submitted = { ...draft(), providerJobs: [job] };
    const live = { ...submitted, title: 'New draft', assets: [asset('local-import')] };
    const saved = { ...submitted, updatedAt: '2026-09-06T00:01:00.000Z', assets: [{ ...asset('render'), providerJobId: job.id }], providerJobs: [{ ...job, status: 'completed' as const }] };
    const merged = mergeDirectorSavedDocument(live, submitted, saved);
    expect(merged.title).toBe('New draft');
    expect(merged.assets.map((item) => [item.id, item.selected])).toEqual([['local-import', true], ['render', false]]);
    expect(merged.providerJobs[0].status).toBe('completed');
    expect(merged.updatedAt).toBe(saved.updatedAt);
    expect(parseEditorialCollagePipelineData(JSON.stringify(merged)).assets).toEqual(merged.assets);
  });

  it('preserves local selections, deletions, and additions without duplicates', () => {
    const submitted = { ...draft(), assets: [asset('removed'), asset('edited'), asset('same')] };
    const live = { ...submitted, assets: [{ ...asset('edited'), selected: false }, asset('same'), asset('new')] };
    const saved = { ...submitted, assets: [...submitted.assets, asset('new'), asset('remote')] };
    const merged = mergeDirectorSavedDocument(live, submitted, saved);
    expect(merged.assets.map((item) => item.id)).toEqual(['edited', 'same', 'new', 'remote']);
    expect(merged.assets[0].selected).toBe(false);
    expect(merged.assets.at(-1)?.selected).toBe(false);
  });

  it('never merges a response into another project', () => {
    const submitted = draft();
    const live = { ...submitted, id: 'other-project' };
    expect(mergeDirectorSavedDocument(live, submitted, submitted)).toBe(live);
  });

  it('accepts a persisted review against the pre-save baseline while preserving newer edits', () => {
    const report: ProductionQualityReport = { id: 'review', workflowKind: 'editorial-collage', stage: 'export', status: 'passed', checks: [], createdAt: now };
    const baseline = { ...draft(), qualityReports: [report] };
    const manualReview = { reportId: report.id, renderFingerprint: 'fingerprint', scope: { kind: 'project' as const }, confirmedAt: now };
    const saved = { ...baseline, updatedAt: '2026-09-06T00:01:00.000Z', qualityReports: [{ ...report, manualReview }] };
    expect(mergeDirectorSavedDocument(baseline, baseline, saved)).toBe(saved);
    const edited = { ...baseline, title: 'Typed while saving' };
    const merged = mergeDirectorSavedDocument(edited, baseline, saved);
    expect(merged.title).toBe(edited.title);
    expect(merged.qualityReports[0].manualReview).toEqual(manualReview);
    expect(baseline.qualityReports[0]).not.toHaveProperty('manualReview');
  });
});
