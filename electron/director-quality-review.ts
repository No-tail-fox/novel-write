import { stat } from 'node:fs/promises';
import { canConfirmDirectorQualityReport, confirmDirectorQualityReview, directorDocumentRenderFingerprint, directorQualityReview, type DirectorQualityArtifactRequest, type DirectorQualityArtifactResult, type DirectorRenderDocument } from '../src/shared/director-render';
import { hashDirectorRenderOutput } from './director-render-output';

interface QualityReviewStore {
  load(): Promise<DirectorRenderDocument>;
  save(document: DirectorRenderDocument): Promise<unknown>;
}

/** The store must reject archived tasks and use expectedUpdatedAt for every write. */
export async function reviewDirectorQualityArtifact(input: DirectorQualityArtifactRequest, store: QualityReviewStore): Promise<DirectorQualityArtifactResult> {
  const document = await store.load();
  const scope = document.workflowKind === 'motion-comic' ? input.episodeId ?? document.activeEpisodeId : undefined;
  const review = directorQualityReview(document, scope);
  const report = review.report;
  if (document.id !== input.id || document.updatedAt !== input.expectedUpdatedAt || review.freshness !== 'current'
    || report?.id !== input.reportId || report.renderFingerprint !== input.renderFingerprint
    || directorDocumentRenderFingerprint(document, scope) !== input.renderFingerprint
    || (document.workflowKind !== 'motion-comic' && input.episodeId !== undefined)) {
    throw new Error('DIRECTOR_REVIEW_STALE: 项目或审片报告已变化，请重新打开当前报告。');
  }
  let status: DirectorQualityArtifactResult['status'] = 'unverified';
  let detail = '历史报告缺少成片 SHA-256 绑定，请重新导出并审片。';
  let artifactSha256: string | undefined;
  const job = document.providerJobs.find((candidate) => candidate.id === report.providerJobId
    && candidate.workflowKind === document.workflowKind && candidate.capability === 'deterministic-render'
    && candidate.status === 'completed' && candidate.episodeId === scope && candidate.renderFingerprint === input.renderFingerprint);
  const assets = document.assets.filter((asset) => asset.providerJobId === job?.id && job
    && asset.assetId === 'director-final-video' && asset.kind === 'video'
    && asset.episodeId === scope && asset.renderFingerprint === input.renderFingerprint);
  const asset = assets.length === 1 ? assets[0] : undefined;
  if (report.artifactSha256 && /^[a-f0-9]{64}$/i.test(report.artifactSha256)) {
    if (!job || !asset?.localPath || !asset.sha256) {
      detail = '无法核对这份报告对应的唯一最终成片，请重新导出。';
    } else if (asset.sha256 !== report.artifactSha256) {
      status = 'changed'; detail = '资产与报告的 SHA-256 不一致，人工确认已撤销。';
    } else {
      try {
        const size = (await stat(asset.localPath)).size;
        artifactSha256 = await hashDirectorRenderOutput(asset.localPath, size);
        status = artifactSha256 === report.artifactSha256 ? 'verified' : 'changed';
        detail = status === 'verified' ? '最终 MP4 已核验，与审片报告一致。' : '最终 MP4 内容已变化，人工确认已撤销，请重新导出并审片。';
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        status = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : code === 'DIRECTOR_RENDER_OUTPUT_CHANGED' ? 'changed' : 'unavailable';
        detail = status === 'missing' ? '最终 MP4 文件已丢失，人工确认已撤销。'
          : status === 'changed' ? '最终 MP4 在核验期间发生变化，人工确认已撤销。' : '最终 MP4 无法读取，人工确认已撤销，请检查文件后重试。';
      }
    }
  }
  // Do not overwrite edits made while the potentially long streaming hash was running.
  const latest = await store.load();
  if (JSON.stringify(latest) !== JSON.stringify(document)) throw new Error('DIRECTOR_REVIEW_STALE: 项目在成片核验期间已变化，结果未保存，请重试。');
  const valid = status === 'verified' && canConfirmDirectorQualityReport(report);
  const manual = report.manualReview;
  const bound = Boolean(valid && manual?.reportId === report.id && manual.renderFingerprint === input.renderFingerprint
    && manual.artifactSha256 === artifactSha256 && manual.scope.kind === 'project');
  let next = latest;
  if (manual && !bound) next = { ...latest, qualityReports: latest.qualityReports.map((candidate) => candidate.id === report.id ? { ...candidate, manualReview: undefined } : candidate) } as DirectorRenderDocument;
  if (input.action === 'confirm' && valid) {
    next = confirmDirectorQualityReview(next, { reportId: report.id, renderFingerprint: input.renderFingerprint,
      artifactSha256, scope: { kind: 'project' }, confirmedAt: new Date().toISOString() }, scope);
  } else if (input.action === 'confirm' && status === 'verified') {
    detail = '报告仍有未解决的阻断项（含 P0/P1），修复并重新审片后才能确认。';
  }
  if (next !== latest) {
    await store.save(next);
    next = await store.load();
  }
  return { reportId: report.id, renderFingerprint: input.renderFingerprint, status, detail, artifactSha256,
    confirmed: valid && (input.action === 'confirm' || bound), document: next };
}
