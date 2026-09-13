import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { appendMotionComicEpisode, createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { confirmDirectorQualityReview, directorDocumentRenderFingerprint, directorQualityReview, type DirectorRenderDocument } from '../src/shared/director-render';
import { FileDatabase } from '../src/shared/storage';

const now = '2026-09-09T00:00:00.000Z';
function fixture(kind: 'editorial-collage' | 'motion-comic' = 'editorial-collage') {
  return kind === 'editorial-collage'
    ? createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'project', title: 'Test', now }), 'A story.', now)
    : appendMotionComicEpisode(createMotionComicStarterProject(createMotionComicDraft({ id: 'comic', title: 'Series', premise: 'Test', now }), 'First', now), { id: 'second', title: 'Second', now });
}
function appendReport(document: DirectorRenderDocument, id: string, episodeId?: string, requestedAt = now, createdAt = requestedAt) {
  const renderFingerprint = directorDocumentRenderFingerprint(document, episodeId);
  const providerJobId = `director-render-job-${id}`;
  document.providerJobs.push({ id: providerJobId, workflowKind: document.workflowKind, nodeId: episodeId ?? document.id,
    providerId: 'local', model: 'ffmpeg', capability: 'deterministic-render', status: 'completed', inputHash: renderFingerprint,
    idempotencyKey: id, attempt: document.providerJobs.length + 1, estimatedCost: 0, createdAt: requestedAt, updatedAt: createdAt, episodeId, renderFingerprint });
  document.qualityReports.push({ id: `director-quality-${id}`, workflowKind: document.workflowKind, stage: 'export', status: 'passed', checks: [],
    providerJobId, ...(episodeId ? { episodeId } : {}), renderFingerprint, createdAt });
  return document.qualityReports.at(-1)!;
}

describe('director quality report ownership', () => {
  it('isolates reports by episode including an explicit episode after navigation', () => {
    const document = fixture('motion-comic');
    if (document.workflowKind !== 'motion-comic') throw new Error('Expected comic');
    const firstId = document.episodes[0].id;
    const first = appendReport(document, 'first', firstId);
    document.activeEpisodeId = 'second';
    expect(directorQualityReview(document)).toMatchObject({ freshness: 'missing' });
    expect(directorQualityReview(document, firstId)).toMatchObject({ freshness: 'current', report: first });
    const second = appendReport(document, 'second', 'second', '2026-09-09T00:01:00.000Z');
    expect(directorQualityReview(document)).toMatchObject({ freshness: 'current', report: second });
    expect(directorQualityReview(document, firstId).report?.id).toBe(first.id);
    expect(directorQualityReview(document, 'deleted').freshness).toBe('missing');
  });

  it('marks edited inputs stale without changing the saved report and restores the original input verdict', () => {
    const document = fixture();
    const report = appendReport(document, 'original');
    const before = structuredClone(report);
    expect(directorQualityReview(document).freshness).toBe('current');
    const ratio = document.ratio;
    document.ratio = ratio === '1:1' ? '16:9' : '1:1';
    expect(directorQualityReview(document)).toMatchObject({ freshness: 'stale', report: before });
    document.ratio = ratio;
    expect(directorQualityReview(document).freshness).toBe('current');
    expect(report).toEqual(before);
  });

  it('orders by request start and prefers an exact current input over late stale completions', () => {
    const document = fixture();
    const later = appendReport(document, 'later', undefined, '2026-09-09T00:02:00.000Z', '2026-09-09T00:03:00.000Z');
    appendReport(document, 'earlier', undefined, now, '2026-09-09T00:04:00.000Z');
    expect(directorQualityReview(document).report?.id).toBe(later.id);
    document.title = 'Changed';
    const current = appendReport(document, 'current', undefined, '2026-09-09T00:05:00.000Z');
    const stale = appendReport(document, 'stale', undefined, '2026-09-09T00:06:00.000Z');
    stale.renderFingerprint = later.renderFingerprint;
    document.providerJobs.at(-1)!.renderFingerprint = later.renderFingerprint;
    expect(directorQualityReview(document).report?.id).toBe(current.id);
  });

  it('shows the current failed retry instead of an earlier passed report', () => {
    const document = fixture();
    appendReport(document, 'passed');
    const failure = appendReport(document, 'failure', undefined, '2026-09-09T00:01:00.000Z');
    failure.status = 'failed'; document.providerJobs.at(-1)!.status = 'failed';
    expect(directorQualityReview(document)).toMatchObject({ freshness: 'current', report: { id: failure.id, status: 'failed' } });
  });

  it('persists a fingerprint-bound manual review only for the current report', () => {
    const document = fixture();
    const report = appendReport(document, 'confirm');
    const fingerprint = directorDocumentRenderFingerprint(document);
    const confirmed = confirmDirectorQualityReview(document, {
      reportId: report.id,
      renderFingerprint: fingerprint,
      scope: { kind: 'project' },
      confirmedAt: '2026-09-09T00:10:00.000Z',
    });
    expect(confirmed.qualityReports.at(-1)?.manualReview).toMatchObject({ reportId: report.id, renderFingerprint: fingerprint, scope: { kind: 'project' } });
    expect(() => confirmDirectorQualityReview({ ...document, title: 'Changed' }, {
      reportId: report.id, renderFingerprint: fingerprint, scope: { kind: 'project' }, confirmedAt: '2026-09-09T00:11:00.000Z',
    })).toThrow('当前内容已变更');
  });

  it('rejects confirmation for a blocking report', () => {
    const document = fixture();
    const report = appendReport(document, 'blocked');
    report.status = 'failed';
    report.checks = [{ id: 'check', label: '阻断', status: 'failed', severity: 'blocking' }];
    expect(() => confirmDirectorQualityReview(document, {
      reportId: report.id,
      renderFingerprint: report.renderFingerprint!,
      scope: { kind: 'project' },
      confirmedAt: '2026-09-09T00:10:00.000Z',
    })).toThrow('阻断项');
  });

  it.each(['pending', 'failed'] as const)('rejects an unresolved %s blocking check even on a passed report', (status) => {
    const document = fixture();
    const report = appendReport(document, 'unresolved');
    report.checks = [{ id: 'check', label: 'Check', status }];
    expect(() => confirmDirectorQualityReview(document, { reportId: report.id, renderFingerprint: report.renderFingerprint!, scope: { kind: 'project' }, confirmedAt: now })).toThrow('阻断项');
  });

  it('records whole-report scope without changing warning or manual results', () => {
    const document = fixture();
    const report = appendReport(document, 'scopes');
    report.checks = [
      { id: 'audio', label: 'Audio', status: 'failed', severity: 'warning', recheckScope: { kind: 'audio', shotIds: ['first'] } },
      { id: 'subtitle', label: 'Subtitle', status: 'pending', severity: 'manual', recheckScope: { kind: 'subtitle', cueIds: ['last'] } },
    ];
    const confirmed = confirmDirectorQualityReview(document, { reportId: report.id, renderFingerprint: report.renderFingerprint!, scope: { kind: 'audio', shotIds: ['first'] }, confirmedAt: now });
    expect(confirmed.qualityReports[0].manualReview?.scope).toEqual({ kind: 'project' });
    expect(confirmed.qualityReports[0].checks).toEqual(report.checks);
    expect(report.manualReview).toBeUndefined();
  });

  it.each(['editorial-collage', 'motion-comic'] as const)('recovers old %s ownership only from the exact render job', (kind) => {
    const document = fixture(kind);
    const scope = document.workflowKind === 'motion-comic' ? document.activeEpisodeId : undefined;
    const report = appendReport(document, 'legacy', scope);
    delete report.providerJobId; delete report.episodeId; delete report.renderFingerprint;
    expect(directorQualityReview(document).freshness).toBe('current');
    expect(report).not.toHaveProperty('providerJobId');
    document.providerJobs[0].id += '-different';
    expect(directorQualityReview(document).freshness).toBe(kind === 'motion-comic' ? 'missing' : 'unverified');
    expect(directorQualityReview(document).unassignedCount).toBe(kind === 'motion-comic' ? 1 : 0);
  });

  it.each(['missing-job', 'wrong-capability', 'wrong-fingerprint', 'wrong-episode'] as const)('never treats %s metadata as a verified report', (change) => {
    const document = fixture('motion-comic');
    if (document.workflowKind !== 'motion-comic') throw new Error('Expected comic');
    const report = appendReport(document, 'conflict', document.activeEpisodeId);
    if (change === 'missing-job') report.providerJobId = 'missing';
    if (change === 'wrong-capability') document.providerJobs[0].capability = 'text-to-image';
    if (change === 'wrong-fingerprint') report.renderFingerprint = 'different';
    if (change === 'wrong-episode') report.episodeId = document.episodes.find((episode) => episode.id !== document.activeEpisodeId)!.id;
    expect(directorQualityReview(document)).toMatchObject({ freshness: 'missing', unassignedCount: 1 });
  });

  it.each(['editorial-collage', 'motion-comic'] as const)('persists %s report bindings and restores current/stale state after SQLite restart', async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), 'quality-binding-'));
    const path = join(directory, 'data.sqlite');
    let database = await FileDatabase.open(path);
    try {
      const task = kind === 'editorial-collage'
        ? await database.createEditorialCollageTask({ title: 'Quality', sourceText: 'A short story.' })
        : await database.createMotionComicTask({ title: 'Quality', premise: 'A short story.' });
      const document = kind === 'editorial-collage' ? parseEditorialCollagePipelineData(task.pipelineData) : parseMotionComicPipelineData(task.pipelineData);
      const report = appendReport(document, 'persisted', document.workflowKind === 'motion-comic' ? document.activeEpisodeId : undefined);
      report.evidence = { subtitleLayout: { version: 1, measuredAt: now, scenes: [{ status: 'failed', shotId: 'missing-font-scene', error: 'No layout evidence' }] } };
      report.manualReview = { reportId: report.id, renderFingerprint: report.renderFingerprint!, scope: { kind: 'project' }, confirmedAt: '2026-09-09T00:12:00.000Z' };
      if (document.workflowKind === 'motion-comic') await database.saveMotionComicTask({ id: task.id, expectedUpdatedAt: document.updatedAt, document });
      else await database.saveEditorialCollageTask({ id: task.id, expectedUpdatedAt: document.updatedAt, document });
      await database.close();
      database = await FileDatabase.open(path);
      const saved = (await database.getTaskDetail(task.id))!;
      const reopened = kind === 'editorial-collage' ? parseEditorialCollagePipelineData(saved.pipelineData) : parseMotionComicPipelineData(saved.pipelineData);
      expect(directorQualityReview(reopened)).toMatchObject({ freshness: 'current', report });
      expect(directorQualityReview(reopened).report?.manualReview).toMatchObject({ reportId: report.id, renderFingerprint: report.renderFingerprint, confirmedAt: '2026-09-09T00:12:00.000Z' });
      reopened.title += ' Changed';
      expect(directorQualityReview(reopened).freshness).toBe('stale');
    } finally { await database.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
