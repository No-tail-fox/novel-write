import { directorDocumentRenderFingerprint, evaluateDirectorQuality, type DirectorRenderResult, type DirectorRenderScene } from '../src/shared/director-render';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { measureProductionNarrationAlignment, type ProductionNarrationAlignmentEvidence } from '../src/shared/production-audio-alignment';
import type { ProductionQualityCheck, ProductionTimeline } from '../src/shared/production-workflow';
import { piFilmReadyErrors } from '../src/shared/creative-animation/pi-film';
import type { PiNarrationTimelineResult } from './pi-narration-timeline';

const positive = (n: number | undefined): n is number => Number.isFinite(n) && n! > 0;
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Speech evidence uses staged source trims, never the music-bearing master duration. */
export function piFilmNarrationAlignment(document: EditorialCollagePipelineData, timeline: PiNarrationTimelineResult, measuredAt = new Date().toISOString()): ProductionNarrationAlignmentEvidence {
  const assets = new Map(document.assets.map(asset => [asset.id, asset]));
  const issues: string[] = [];
  if (!positive(timeline.durationMs)) issues.push('Invalid authoritative timeline duration');
  const cueIds = new Set<string>();
  for (const cue of timeline.cues) {
    if (!cue.id || cueIds.has(cue.id) || !cue.text.trim() || !time(cue.startMs) || !time(cue.endMs) || cue.endMs <= cue.startMs || cue.endMs > timeline.durationMs) issues.push(`Invalid narration cue ${cue.id}`);
    cueIds.add(cue.id);
  }
  const materials = new Map<string, PiNarrationTimelineResult['materials'][number]>();
  for (const material of timeline.materials) {
    if (!material.path.trim() || !/^[a-f0-9]{64}$/i.test(material.sha256) || materials.has(material.path) || assets.get(material.assetVersionId)?.kind !== 'audio') issues.push(`Invalid narration material ${material.assetVersionId}`);
    materials.set(material.path, material);
  }
  let previousEnd = 0;
  const samples = timeline.audioSlices.map((slice, index) => {
    const material = materials.get(slice.path), asset = material && assets.get(material.assetVersionId);
    const offset = slice.sourceStartMs ?? 0;
    const valid = time(slice.startMs) && time(offset) && time(slice.durationMs) && slice.durationMs > 0 && slice.startMs >= previousEnd && slice.startMs + slice.durationMs <= timeline.durationMs;
    if (!valid || !material || !asset || (positive(asset.durationMs) && offset + slice.durationMs > asset.durationMs)) issues.push(`Invalid speech slice ${index}: timing, material or source trim exceeds measured source`);
    previousEnd = slice.startMs + slice.durationMs;
    const cues = timeline.cues.filter(cue => cue.startMs < previousEnd && cue.endMs > slice.startMs);
    if (!cues.length) issues.push(`Speech slice ${index} has no narration cues`);
    return { id: `pi-speech-${index}`, durationMs: positive(slice.durationMs) ? slice.durationMs : 1, audioAssetVersionIds: material ? [material.assetVersionId] : [],
      audioDurationsMs: [asset && positive(asset.durationMs) ? slice.durationMs : undefined],
      subtitleCues: cues.map(cue => ({ ...cue, startMs: Math.max(cue.startMs, slice.startMs) - slice.startMs, endMs: Math.min(cue.endMs, previousEnd) - slice.startMs })) };
  });
  for (const cue of timeline.cues) {
    const coveredMs = timeline.audioSlices.reduce((sum, slice) => sum + Math.max(0, Math.min(cue.endMs, slice.startMs + slice.durationMs) - Math.max(cue.startMs, slice.startMs)), 0);
    if (coveredMs <= 0 || cue.endMs - cue.startMs - coveredMs > 250) issues.push(`Narration cue ${cue.id} is not covered by speech sources`);
  }
  const evidence = measureProductionNarrationAlignment(samples, assets, measuredAt);
  if (issues.length) {
    evidence.status = 'failed';
    evidence.samples.push({ shotId: 'pi-narration-contract', plannedDurationMs: positive(timeline.durationMs) ? timeline.durationMs : 1,
      graphemeCount: 0, status: 'mismatch', audioAssetVersionIds: [], detail: issues.join('; ').slice(0, 2000) });
  }
  return evidence;
}

/** Called after preparePiFilmExport has verified current source, timeline, asset and master hashes.
 * Only the legacy timeline/dialogue/alignment contracts are adapted; all actual media checks survive.
 */
export function evaluatePiFilmQuality(document: EditorialCollagePipelineData, scenes: readonly DirectorRenderScene[], result: DirectorRenderResult, fingerprint: string, timeline: PiNarrationTimelineResult): ProductionQualityCheck[] {
  const original = evaluateDirectorQuality(document, scenes, result, fingerprint);
  const film = document.piFilm, master = film?.audioMaster;
  const issues: string[] = [];
  if (!film || film.runId !== document.productionRun?.id) issues.push('Pi film does not belong to the current run');
  if (!master || !positive(master.durationSeconds) || Math.abs(master.durationSeconds * 1000 - timeline.durationMs) > 1 || master.sourceHash !== film?.sourceHash || master.timelineHash !== film?.timelineHash) issues.push('Missing, stale or incorrectly measured audio master');
  if (!positive(timeline.durationMs) || !film || Math.abs(film.actualDurationSeconds * 1000 - timeline.durationMs) > 1 || !scenes.length) issues.push('Invalid film duration or empty scene assembly');
  const renderTimeline: ProductionTimeline = { durationMs: timeline.durationMs, clips: [], audioAssetVersionIds: ['pi-master'], audioClips: [] };
  const masterPath = scenes[0]?.audioClips?.[0]?.path;
  let start = 0;
  for (const scene of scenes) {
    const clips = scene.audioClips;
    if (clips?.length !== 1) issues.push(`Scene ${scene.id} must consume exactly one master slice`);
    const clip = clips?.[0];
    if (!clip || clip.assetVersionId !== 'pi-master' || !clip.path.trim() || clip.path !== masterPath || clip.startMs !== 0 || clip.durationMs !== scene.durationMs || clip.sourceStartMs !== start || clip.sourceDurationMs !== scene.durationMs || clip.sourceMediaDurationMs !== timeline.durationMs || clip.muted || (clip.gainDb ?? 0) !== 0 || clip.fadeInMs || clip.fadeOutMs || clip.fadeEnvelope) issues.push(`Scene ${scene.id} has invalid master source offsets or mix settings`);
    if (scene.id.startsWith('pi-film-') && scene.videoStartMs !== start) issues.push(`Scene ${scene.id} has invalid picture offset`);
    renderTimeline.clips.push({ id: `pi-render-${scene.index}`, shotId: scene.id, startMs: start, durationMs: scene.durationMs, assetVersionIds: [], subtitleCueIds: (scene.subtitleCues ?? []).map(cue => cue.id), source: 'local' });
    for (const audio of clips ?? []) renderTimeline.audioClips!.push({ ...audio, shotId: scene.id, startMs: start + audio.startMs });
    start += scene.durationMs;
  }
  const derived: EditorialCollagePipelineData = { ...document, timeline: renderTimeline, assets: [...document.assets.filter(asset => asset.id !== 'pi-master'),
    { id: 'pi-master', assetId: 'pi-master', kind: 'audio', localPath: masterPath, durationMs: master ? master.durationSeconds * 1000 : undefined, createdAt: document.createdAt }] };
  const continuity = evaluateDirectorQuality(derived, scenes, result, directorDocumentRenderFingerprint(derived)).find(check => check.id === 'timeline-continuity')!;
  if (continuity.status !== 'passed') issues.push(continuity.detail ?? 'Invalid render timeline');
  const coverageIssues: string[] = [];
  if (!timeline.cues.length || !timeline.audioSlices.length) coverageIssues.push('Caption coverage requires nonempty authoritative narration cues and speech slices');
  if (film?.policy.captionMode === 'film') {
    const evidenceErrors = piFilmReadyErrors(film);
    if (evidenceErrors.length) coverageIssues.push(...evidenceErrors);
  } else if (film?.policy.captionMode === 'host') {
    let cursor = 0;
    for (const scene of scenes) {
      const end = cursor + scene.durationMs;
      const expected = timeline.cues.filter(cue => cue.startMs < end && cue.endMs > cursor).map(cue => ({ id: cue.id, text: cue.text, startMs: Math.max(cursor, cue.startMs) - cursor, endMs: Math.min(end, cue.endMs) - cursor }));
      const actual = (scene.subtitleCues ?? []).map(({ id, text, startMs, endMs }) => ({ id, text, startMs, endMs }));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) coverageIssues.push(`Scene ${scene.id} host captions do not match the authoritative cues`);
      cursor = end;
    }
  } else coverageIssues.push('Missing caption ownership policy');
  const alignment = piFilmNarrationAlignment(document, timeline);
  return original.map(check => {
    if (check.id === 'timeline-continuity') return { ...check, status: issues.length ? 'failed' : 'passed', detail: issues.join('; ') || 'Exact Pi render scene and full-duration master timeline validated' };
    if (check.id === 'dialogue-coverage') return { ...check, status: coverageIssues.length ? 'failed' : 'passed', detail: coverageIssues.join('; ') || (film?.policy.captionMode === 'film' ? 'Current hash-bound film reading and technical evidence covers authoritative cues' : 'Host captions match authoritative cues') };
    if (check.id === 'narration-alignment') return { ...check, status: alignment.status, severity: alignment.status === 'failed' ? 'blocking' : 'manual', detail: alignment.samples.filter(sample => sample.detail).map(sample => sample.detail).join('; ') || 'Measured staged speech source trims aligned with authoritative cues' };
    return check;
  });
}
