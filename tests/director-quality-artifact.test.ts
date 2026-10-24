import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewDirectorQualityArtifact } from '../electron/director-quality-review';
import * as directorOutput from '../electron/director-render-output';
import { canConfirmDirectorQualityReport, directorDocumentRenderFingerprint, directorQualityStatus, type DirectorQualityArtifactRequest, type DirectorRenderDocument } from '../src/shared/director-render';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import type { ProductionQualityCheck } from '../src/shared/production-workflow';
import { FileDatabase } from '../src/shared/storage';

const now = '2026-10-21T00:00:00.000Z';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture(kind: 'editorial-collage' | 'motion-comic' = 'editorial-collage') {
  const directory = await mkdtemp(join(tmpdir(), 'director-artifact-')); directories.push(directory);
  const path = join(directory, 'final.mp4');
  const bytes = Buffer.from('final media bytes');
  await writeFile(path, bytes);
  const document: DirectorRenderDocument = kind === 'editorial-collage'
    ? createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'project', title: 'Story', now }), 'Story.', now)
    : createMotionComicStarterProject(createMotionComicDraft({ id: 'comic', title: 'Series', premise: 'Story', now }), 'First', now);
  bind(document, path, bytes);
  let stored = structuredClone(document);
  const store = {
    load: async () => structuredClone(stored),
    save: async (next: DirectorRenderDocument) => { stored = structuredClone({ ...next, updatedAt: new Date().toISOString() }); },
  };
  const request = (action: DirectorQualityArtifactRequest['action'] = 'verify'): DirectorQualityArtifactRequest => ({ id: stored.id, reportId: 'report',
    renderFingerprint: document.qualityReports[0].renderFingerprint!, episodeId: stored.workflowKind === 'motion-comic' ? stored.activeEpisodeId : undefined,
    expectedUpdatedAt: stored.updatedAt, action });
  return { directory, path, bytes, document, store, request, read: () => stored, edit: (edit: (document: DirectorRenderDocument) => void) => edit(stored) };
}
function bind(document: DirectorRenderDocument, path: string, bytes: Buffer) {
  const renderFingerprint = directorDocumentRenderFingerprint(document);
  const episodeId = document.workflowKind === 'motion-comic' ? document.activeEpisodeId : undefined;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  document.providerJobs.push({ id: 'job', workflowKind: document.workflowKind, nodeId: episodeId ?? document.id, providerId: 'local', model: 'ffmpeg',
    capability: 'deterministic-render', status: 'completed', inputHash: renderFingerprint, idempotencyKey: 'job', estimatedCost: 0,
    attempt: 1, createdAt: now, updatedAt: now, episodeId, renderFingerprint });
  document.assets.push({ id: 'output', assetId: 'director-final-video', kind: 'video', localPath: path, sha256, providerJobId: 'job',
    episodeId, renderFingerprint, createdAt: now, selected: true, pinned: true });
  document.qualityReports.push({ id: 'report', workflowKind: document.workflowKind, stage: 'export', providerJobId: 'job', episodeId, renderFingerprint,
    artifactSha256: sha256, status: 'passed', checks: [], createdAt: now });
}

describe('final MP4 review binding', () => {
  it.each(['editorial-collage', 'motion-comic'] as const)('verifies and confirms the exact persisted %s artifact', async (kind) => {
    const f = await fixture(kind);
    expect(await reviewDirectorQualityArtifact(f.request(), f.store)).toMatchObject({ status: 'verified', confirmed: false });
    const result = await reviewDirectorQualityArtifact(f.request('confirm'), f.store);
    expect(result).toMatchObject({ status: 'verified', confirmed: true });
    expect(f.read().qualityReports[0].manualReview).toMatchObject({ artifactSha256: f.document.qualityReports[0].artifactSha256, scope: { kind: 'project' } });
    expect(await reviewDirectorQualityArtifact(f.request(), f.store)).toMatchObject({ status: 'verified', confirmed: true });
  });

  it.each(['missing', 'same-size-change', 'report-hash', 'legacy', 'wrong-job', 'wrong-episode', 'duplicate-output'] as const)('revokes confirmation for %s without substituting another output', async (change) => {
    const f = await fixture();
    await reviewDirectorQualityArtifact(f.request('confirm'), f.store);
    if (change === 'missing') await rm(f.path);
    if (change === 'same-size-change') await writeFile(f.path, Buffer.alloc(f.bytes.length, 65));
    f.edit((document) => {
      if (change === 'report-hash') document.qualityReports[0].artifactSha256 = 'b'.repeat(64);
      if (change === 'legacy') delete document.qualityReports[0].artifactSha256;
      if (change === 'wrong-job') document.assets[0].providerJobId = 'other-job';
      if (change === 'wrong-episode') document.assets[0].episodeId = 'other';
      if (change === 'duplicate-output') document.assets.push({ ...document.assets[0], id: 'duplicate' });
    });
    const result = await reviewDirectorQualityArtifact(f.request('confirm'), f.store);
    expect(result.status).toBe(change === 'missing' ? 'missing' : ['same-size-change', 'report-hash'].includes(change) ? 'changed' : 'unverified');
    expect(result.confirmed).toBe(false);
    expect(f.read().qualityReports[0].manualReview).toBeUndefined();
  });

  it.each(['P0', 'P1'] as const)('blocks pending and failed %s checks regardless of severity, with explicit waivers allowed', async (priority) => {
    const f = await fixture();
    await reviewDirectorQualityArtifact(f.request('confirm'), f.store);
    for (const severity of ['warning', 'manual', 'blocking'] as const) for (const status of ['pending', 'failed', 'waived'] as const) {
      const check: ProductionQualityCheck = { id: 'check', label: 'Check', priority, severity, status };
      f.edit((document) => { document.qualityReports[0].checks = [check]; });
      expect(directorQualityStatus([check])).toBe(status === 'waived' ? 'passed' : status);
      expect(canConfirmDirectorQualityReport(f.read().qualityReports[0])).toBe(status === 'waived');
      const result = await reviewDirectorQualityArtifact(f.request('confirm'), f.store);
      expect(result.confirmed).toBe(status === 'waived');
      expect(Boolean(f.read().qualityReports[0].manualReview)).toBe(status === 'waived');
    }
  });

  it('revokes persisted confirmation when the final MP4 becomes unreadable', async () => {
    const f = await fixture();
    await reviewDirectorQualityArtifact(f.request('confirm'), f.store);
    const hash = vi.spyOn(directorOutput, 'hashDirectorRenderOutput')
      .mockRejectedValueOnce(Object.assign(new Error('File cannot be read'), { code: 'EACCES' }));
    try {
      expect(await reviewDirectorQualityArtifact(f.request(), f.store)).toMatchObject({ status: 'unavailable', confirmed: false });
      expect(f.read().qualityReports[0].manualReview).toBeUndefined();
    } finally { hash.mockRestore(); }
  });

  it('rejects stale revisions and changes during hashing without overwriting edits', async () => {
    const f = await fixture();
    await expect(reviewDirectorQualityArtifact({ ...f.request(), expectedUpdatedAt: now.replace('00:00', '01:00') }, f.store)).rejects.toThrow('DIRECTOR_REVIEW_STALE');
    let reads = 0;
    const store = { ...f.store, load: async () => {
      if (++reads === 2) f.edit((document) => { document.title = 'Edited during hash'; });
      return f.store.load();
    } };
    await expect(reviewDirectorQualityArtifact(f.request('confirm'), store)).rejects.toThrow('DIRECTOR_REVIEW_STALE');
    expect(f.read().title).toBe('Edited during hash');
    expect(f.read().qualityReports[0].manualReview).toBeUndefined();
  });

  it.each(['editorial-collage', 'motion-comic'] as const)('persists %s revocation across SQLite restarts', async (kind) => {
    const f = await fixture(kind);
    const databasePath = join(f.directory, 'database.sqlite');
    let database = await FileDatabase.open(databasePath);
    try {
      const task = kind === 'editorial-collage' ? await database.createEditorialCollageTask({ title: 'Story', sourceText: 'Story.' })
        : await database.createMotionComicTask({ title: 'Story', premise: 'Story.' });
      const parse = (text: unknown) => kind === 'editorial-collage' ? parseEditorialCollagePipelineData(text) : parseMotionComicPipelineData(text);
      const document = parse(task.pipelineData);
      bind(document, f.path, f.bytes);
      const store = {
        load: async () => parse((await database.getTaskDetail(task.id))!.pipelineData),
        save: async (next: DirectorRenderDocument) => next.workflowKind === 'editorial-collage'
          ? database.saveEditorialCollageTask({ id: task.id, expectedUpdatedAt: next.updatedAt, document: next })
          : database.saveMotionComicTask({ id: task.id, expectedUpdatedAt: next.updatedAt, document: next }),
      };
      await store.save(document);
      const request = async (action: DirectorQualityArtifactRequest['action']): Promise<DirectorQualityArtifactRequest> => {
        const current = await store.load();
        return { id: task.id, reportId: 'report', renderFingerprint: current.qualityReports[0].renderFingerprint!,
          episodeId: current.workflowKind === 'motion-comic' ? current.activeEpisodeId : undefined, expectedUpdatedAt: current.updatedAt, action };
      };
      expect((await reviewDirectorQualityArtifact(await request('confirm'), store)).confirmed).toBe(true);
      await database.close(); database = await FileDatabase.open(databasePath);
      expect((await store.load()).qualityReports[0].manualReview?.artifactSha256).toHaveLength(64);
      await rm(f.path);
      expect((await reviewDirectorQualityArtifact(await request('verify'), store)).status).toBe('missing');
      await database.close(); database = await FileDatabase.open(databasePath);
      expect((await store.load()).qualityReports[0].manualReview).toBeUndefined();
    } finally { await database.close(); }
  });
});
