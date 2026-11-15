import { createHash } from 'node:crypto';
import { DIRECTOR_VISUAL_FPS } from '../src/shared/production-visual-continuity';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { EditorialCollagePipelineData as Document } from '../src/shared/editorial-collage';
import { buildPiGlobalPlan, buildPiSegmentPrompt, parsePiSegmentHandoff, splitPiNarration } from '../src/shared/pi-film-context';
import type { VoxProductionNode } from '../src/shared/vox-production';
import type { LlmConfig } from '../src/shared/types';
import { piFilmReadyErrors, piFilmStateSchema, type PiFilmState } from '../src/shared/creative-animation/pi-film';
import { lemoAudioMixSchema, validateLemoAgentAudio } from '../src/shared/creative-animation/agent-audio';
import { narrationPausesSchema } from '../src/shared/creative-animation/narration-pauses';
import { resolveCreativeStyle } from '../src/shared/creative-animation/styles';
import { lemoMissingAttributions } from '../src/shared/creative-animation/agent-assets';
import { openPiFilmSession } from './pi-agent-session';
import type { PiHostOperation } from './pi-agent-tool-router';
import type { PiModelCapabilities } from './pi-model-config';
import { piMeasureFrameFiles } from './pi-film-frame-metrics';
import type { PiBudgetLimits } from './pi-agent-budget';
import { piProductionPaths } from './pi-production-paths';
import { piFilmCheckpoints } from './pi-film-checkpoint';
import { piDataHash, piFilmSourceHash } from './pi-film-fingerprint';
import { stagePiNarrationTimeline, requestPiNarrationPauses, type StagePiNarrationTimelineInput } from './pi-narration-timeline';
import { inspectPiTreatment } from './pi-film-treatment';
import { reviewPiFilm } from './pi-film-review';
import { runPiFilmReadcheck } from './pi-film-readcheck';
import { masterPiAudio } from './pi-audio-master';
import { piScoreSchema, piFoleySchema, type renderPiScore } from './pi-score-renderer';
import { stageAudioRuntime, listInstalledInstruments } from '../services/lemo-audio/starter-pack';
import { resolveLemoUpstreamRenderRuntime, stageLemoUpstreamRenderRoot } from './lemo-upstream-video';
import { verifyLemoAssets } from './lemo-upstream-assets';
import { stagePiFilmAssets, piViewAssetOperation } from './pi-film-assets';
import { lemoProductionContext, lemoMaterialContext, type LemoUpstreamMaterialHost } from './lemo-upstream-production';
import { loadOpuscar98StyleReference, opuscar98Number } from './lemo-opuscar98';
import type { exportLemoUpstreamProject } from './lemo-upstream-renderer';

export interface PiFilmOperationsOptions {
  library: { upstreamRoot: string; threeRoot: string; pythonRoot: string; cacheDir: string };
  work: string; workerPath: string; starterPackRoot: string; trustedMasterScriptPath?: string;
  config: LlmConfig; capabilities: PiModelCapabilities; pricing: { inputPerMillion: number; outputPerMillion: number };
  resolveAudioPath: StagePiNarrationTimelineInput['resolveAudioPath'];
  limits?: PiBudgetLimits; promptTimeoutMs?: number; materialHost?: LemoUpstreamMaterialHost;
  /** Trusted data-only renderer. Omitted means render_score is unavailable; never executes authored Python. */
  renderScore?: typeof renderPiScore;
  sessionFactory?: typeof openPiFilmSession;
  hostServices?: Partial<{
    review: typeof reviewPiFilm; readcheck: typeof runPiFilmReadcheck; master: typeof masterPiAudio;
    preview: typeof exportLemoUpstreamProject; runtime: typeof resolveLemoUpstreamRenderRuntime;
    stageRenderRoot: typeof stageLemoUpstreamRenderRoot; stageAudio: typeof stageAudioRuntime;
  }>;
}
const empty = z.object({}).strict();
const segmentNumber = (node: VoxProductionNode) => {
  const match = /^pi-segment:([1-9]\d*)$/.exec(node.id);
  if (!match || Number(match[1]) > 1000) throw new Error('PI_SEGMENT_NUMBER');
  return Number(match[1]);
};
function ref(root: string, path: string) {
  const value = relative(resolve(root), resolve(path));
  if (!value || isAbsolute(value) || value === '..' || value.startsWith('..' + sep)) throw new Error('PI_ARTIFACT_OUTSIDE_RUN');
  return value.split(sep).join('/');
}
const fileHash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');

/** Production assembly; gateway/session and all evidence remain outside model-writable source. */
export function createPiFilmOperations(options: PiFilmOperationsOptions) {
  const services = options.hostServices ?? {};
  let active: Awaited<ReturnType<typeof openPiFilmSession>> | undefined;
  let controller: AbortController | undefined;
  let busy = false;
  const recoverPiSegment = async (d: Document, node: VoxProductionNode): Promise<Document | undefined> => {
    if (!d.productionRun) throw new Error('PI_RUN_REQUIRED');
    const film = await piFilmCheckpoints(piProductionPaths(options.work, d.productionRun.id).state).load(segmentNumber(node), d.productionRun.id);
    return film ? { ...d, piFilm: film } : undefined;
  };
  const piSegment = async (d: Document, node: VoxProductionNode): Promise<Document> => {
    if (busy) throw new Error('PI_SEGMENT_BUSY');
    busy = true; controller = new AbortController();
    const signal = controller.signal;
    try {
      const run = d.productionRun;
      if (!run || run.authoringVersion !== 4 || !run.settings.codeVideo) throw new Error('PI_RUN_POLICY_REQUIRED');
      const segment = segmentNumber(node), paths = piProductionPaths(options.work, run.id);
      const saved = await recoverPiSegment(d, node); if (saved) return saved;
      if (segment !== (d.piFilm?.segment ?? 0) + 1) throw new Error('PI_SEGMENT_SEQUENCE');
      if (d.piFilm && (d.piFilm.runId !== run.id || d.piFilm.phase === 'reconciliation-required')) throw new Error('PI_RECONCILIATION_REQUIRED');
      await Promise.all([paths.project, paths.state, paths.reviews, paths.audio].map(p => mkdir(p, { recursive: true })));
      const style = resolveCreativeStyle(run.settings.authoring?.styleId, run.settings.presetId);
      if (!style) throw new Error('PI_STYLE_REQUIRED');
      const styleReference = opuscar98Number(style.slug) !== undefined ? await loadOpuscar98StyleReference(options.library.upstreamRoot, style.slug) : undefined;
      const context = lemoProductionContext(d, styleReference), policy = run.settings.codeVideo;
      let timeline = await stagePiNarrationTimeline({ document: d, resolveAudioPath: options.resolveAudioPath,
        outputDirectory: paths.narration, stateRoot: paths.narrationState, allowNarrationPauses: policy.allowNarrationPauses,
        targetDurationSeconds: policy.targetDurationSeconds });
      if (timeline.durationMs > policy.targetDurationSeconds * 1100) throw new Error('PI_NARRATION_OVER_TARGET: 实测旁白超过目标时长容差，请提高目标时长或编辑原文后重新制作。');
      const narrationText = timeline.cues.length ? timeline.cues.map(cue => cue.text).join(' ') : (d.sourceText ?? '');
       const narrationWindows = splitPiNarration(narrationText);
       const segmentCount = Math.max(narrationWindows.length, (d.piFilm?.segment ?? 0) + 1);
       if (!segmentCount || segment > segmentCount) throw new Error('PI_SEGMENT_NARRATION_RANGE');
       if (segment !== 1 && !d.piFilm) throw new Error('PI_SEGMENT_HANDOFF_REQUIRED');
       if (d.piFilm && d.piFilm.segment + 1 !== segment) throw new Error('PI_SEGMENT_SEQUENCE');
       const narrationWindowText = narrationWindows[segment - 1] ?? (segment === 1 ? d.sourceText ?? '' : 'Continuation window; use the authoritative cue file and do not repeat prior narration.');
       const globalPlan = buildPiGlobalPlan(d, timeline.durationMs, segmentCount, policy);
       const previousSummary = d.piFilm?.segmentHandoff;
       const segmentContext = buildPiSegmentPrompt({ globalPlan, narration: narrationWindowText, segment, segmentCount, previousSummary });
       if (!segmentContext.includes(`CURRENT NARRATION WINDOW ${segment}/${segmentCount}:`)) throw new Error('PI_SEGMENT_CONTEXT_INVALID');
       const publishTimeline = () => writeFile(join(paths.narration, 'cues.json'), JSON.stringify(timeline, null, 2), 'utf8');
      await publishTimeline();
      let assetMedia: Awaited<ReturnType<typeof lemoMaterialContext>>['assetHost'] | undefined;
      if (run.settings.archives.length) {
        const material = await lemoMaterialContext(d, options.materialHost);
        if (!material.assetHost) throw new Error('PI_MATERIAL_HOST_REQUIRED');
        assetMedia = material.assetHost;
        await stagePiFilmAssets({ projectRoot: paths.project, previewRoot: paths.previews, assets: material.context.assets ?? [],
          files: material.assetHost.files, media: material.assetHost.media, canvas: context });
      }
      let identity = { sourceHash: '', timelineHash: '', assetHash: '' }, key = '';
      let contacts = 0, visualContacts = 0, technical = false, reading = false, credits = false;
      let previewRef: string | undefined, audioMaster: PiFilmState['audioMaster'];
      let lookProofs = 0; // process record: deliberately not reset by source edits
      let score: { key: string; result: Awaited<ReturnType<typeof renderPiScore>> } | undefined;
      let accepted = false, acceptedKey = '';
      const refresh = async () => {
        signal.throwIfAborted();
        const manifest = await verifyLemoAssets(paths.project);
        const next = { sourceHash: await piFilmSourceHash(paths.project), timelineHash: piDataHash(timeline), assetHash: piDataHash(manifest ?? []) };
        const nextKey = piDataHash(next);
        if (key !== nextKey) { contacts = 0; visualContacts = 0; technical = reading = credits = false; previewRef = undefined; audioMaster = undefined; accepted = false; }
        identity = next; key = nextKey; return manifest;
      };
      let renderEnvironment: Promise<{ runtime: Awaited<ReturnType<typeof resolveLemoUpstreamRenderRuntime>>; upstreamRoot: string; browserVersion: string }> | undefined;
      const environment = () => renderEnvironment ??= (async () => {
        const runtime = await (services.runtime ?? resolveLemoUpstreamRenderRuntime)(options.library);
        const upstreamRoot = await (services.stageRenderRoot ?? stageLemoUpstreamRenderRoot)({ ...options.library, playwrightCorePath: runtime.playwrightCorePath });
        const browser = JSON.parse(await readFile(join(runtime.playwrightCorePath, 'browsers.json'), 'utf8')) as { browsers: { name: string; revision: string }[] };
        const revision = browser.browsers.find(b => b.name === 'chromium-headless-shell')?.revision;
        if (!revision) throw new Error('PI_BROWSER_IDENTITY_REQUIRED');
        return { runtime, upstreamRoot, browserVersion: 'chromium-headless-shell-' + revision };
      })();
      let audioRuntime: ReturnType<typeof stageAudioRuntime> | undefined;
      const instruments = () => audioRuntime ??= (services.stageAudio ?? stageAudioRuntime)({ upstreamRoot: options.library.upstreamRoot,
        starterRoot: options.starterPackRoot, runtimeRoot: join(paths.state, 'audio-runtime-' + segment) });
      const renderOptions = async () => ({ ...await environment(), filmDir: paths.project, durationSeconds: timeline.durationMs / 1000,
        fps: DIRECTOR_VISUAL_FPS, width: context.width, height: context.height, captionMode: policy.captionMode, signal });
      const operations: Record<string, PiHostOperation> = {};
      if (assetMedia && options.capabilities.images) operations.view_asset = piViewAssetOperation({ projectRoot: paths.project, previewRoot: paths.previews, media: assetMedia.media });
      function tool<T extends z.ZodType>(name: string, schema: T, description: string, execute: (input: z.output<T>) => Promise<unknown>, mutates = true) {
        operations[name] = { description, parameters: z.toJSONSchema(schema), mutates,
          execute: async input => { await refresh(); if (accepted) throw new Error('PI_FINISH_ACCEPTED'); return execute(schema.parse(input)); } };
      }
      tool('inspect_treatment', empty, 'Check required treatment sections.', () => inspectPiTreatment(paths.project), false);
      tool('list_instruments', empty, 'List installed, verified instruments only.', async () => listInstalledInstruments((await instruments()).instrumentsRoot), false);
      tool('request_narration_pause', z.object({ pauses: narrationPausesSchema }).strict(), 'Replace the approved pause set; read authoritative material/narration/cues.json afterward.', async ({ pauses }) => {
        timeline = await requestPiNarrationPauses({ stateRoot: paths.narrationState, document: d, requested: pauses });
        await publishTimeline(); await refresh(); return timeline;
      });
      if (options.renderScore) tool('render_score', z.object({ score: piScoreSchema, foley: piFoleySchema }).strict(), 'Render data-only score and Foley with trusted host code. No Python or executable paths accepted.', async input => {
        await mkdir(join(paths.project, 'audio'), { recursive: true });
        await writeFile(join(paths.project, 'audio', 'score.json'), JSON.stringify(input.score), 'utf8');
        await writeFile(join(paths.project, 'audio', 'foley.json'), JSON.stringify(input.foley), 'utf8');
        await refresh(); audioMaster = undefined;
        const before = key;
        const result = await options.renderScore!({ ...input, durationSeconds: timeline.durationMs / 1000 }, {
          pythonRoot: options.library.pythonRoot, instrumentsRoot: (await instruments()).instrumentsRoot, outputDir: join(paths.project, 'out', 'audio'), signal });
        await refresh(); if (before !== key) throw new Error('PI_SCORE_SOURCE_CHANGED');
        score = { key, result }; return result;
      });
      tool('look_proof', empty, 'Render three host-selected frames (early, middle, late) to prove the visual look before writing the rest of the film. Required once in the first segment; it is not a substitute for review_frames.', async () => {
        const before = key, duration = timeline.durationMs / 1000, last = Math.max(0, duration - 1 / DIRECTOR_VISUAL_FPS);
        const times = [0.12, 0.5, 0.88].map(fraction => fraction * last);
        const outputDir = join(paths.reviews, key, 'look-' + (lookProofs + 1));
        const receipt = await (services.review ?? reviewPiFilm)({ ...await renderOptions(), outputDir, times });
        await refresh(); if (before !== key) throw new Error('PI_REVIEW_SOURCE_CHANGED');
        const complete = receipt.technicalPassed && times.every(t => receipt.stills.frames.some(f => Math.abs(f.time - t) < 0.001));
        if (complete) lookProofs++;
        const shown = options.capabilities.images ? receipt.stills.frames.length : 0;
        const measured = await piMeasureFrameFiles(receipt.stills.frames);
        const content = [{ type: 'text', text: JSON.stringify({ ...receipt, lookProofRecorded: complete, framesShownToModel: shown, note: shown >= 3 ? 'Three style frames are attached. Judge palette, type, composition and whether the look is distinct from the demo before continuing.' : 'No frames were shown to the model (image input unavailable). This is a technical render only; it proves nothing about the look.', ...(measured ? { frameMetrics: measured.metrics, advisories: measured.advisories } : {}) }) }] as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
        if (options.capabilities.images) for (const frame of receipt.stills.frames) content.push({ type: 'image', data: (await readFile(frame.path)).toString('base64'), mimeType: 'image/jpeg' });
        return { content };
      });
      tool('review_frames', empty, 'Review eight host-selected frames spanning the full film; two passes required on unchanged source.', async () => {
        const before = key, duration = timeline.durationMs / 1000;
        const times = Array.from({ length: 8 }, (_, i) => i * Math.max(0, duration - 1 / DIRECTOR_VISUAL_FPS) / 7);
        const outputDir = join(paths.reviews, key, 'contact-' + (contacts + 1));
        const receipt = await (services.review ?? reviewPiFilm)({ ...await renderOptions(), outputDir, times });
        await refresh(); if (before !== key) throw new Error('PI_REVIEW_SOURCE_CHANGED');
        if (receipt.technicalPassed && receipt.stills.frames.length >= 8 && times.every(t => receipt.stills.frames.some(f => Math.abs(f.time - t) < 0.001))) { technical = true; contacts++; }
        const shown = options.capabilities.images ? receipt.stills.frames.length : 0;
        if (technical && shown >= 8) visualContacts++;
        const note = shown >= 8 ? 'Frames are attached for visual review.' : 'No frames were shown to the model in this review (image input unavailable). This is a technical check only, not a visual or aesthetic review.';
        const measured = await piMeasureFrameFiles(receipt.stills.frames);
        const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [{ type: 'text', text: JSON.stringify({ ...receipt, framesShownToModel: shown, note, ...(measured ? { frameMetrics: measured.metrics, advisories: measured.advisories, advisoryNote: 'Advisory host measurements only. They never fail a review; a deliberate style may legitimately trigger them.' } : {}) }) }];
        if (options.capabilities.images) for (const frame of receipt.stills.frames) content.push({ type: 'image', data: (await readFile(frame.path)).toString('base64'), mimeType: 'image/jpeg' });
        return { content };
      });
      tool('reading_check', empty, 'Observe every rendered frame for reading time and caption safety.', async () => {
        const before = key;
        const receipt = await (services.readcheck ?? runPiFilmReadcheck)({ ...await renderOptions(), cues: timeline.cues.map(c => ({ id: c.id, text: c.text, startSeconds: c.startMs / 1000, endSeconds: c.endMs / 1000 })) });
        await refresh(); if (before !== key) throw new Error('PI_REVIEW_SOURCE_CHANGED');
        reading = receipt.readingPassed;
        const manifest = await verifyLemoAssets(paths.project);
        credits = lemoMissingAttributions(manifest?.assets ?? [], receipt.modes.flatMap(m => m.texts.filter(t => t.fullyVisibleFrames > 0).map(t => t.text))).length === 0;
        await writeFile(join(paths.reviews, key + '-reading.json'), JSON.stringify(receipt), 'utf8'); return receipt;
      });
      tool('audio_check', empty, 'Master and validate declared stems using host-measured audio; reads audio/mix.json.', async () => {
        const before = key, mix = lemoAudioMixSchema.parse(JSON.parse(await readFile(join(paths.project, 'audio', 'mix.json'), 'utf8')));
        const stems: Record<string, string> = {};
        for (const name of Object.keys(mix.stems) as Array<keyof typeof mix.stems>) {
          if (!score || score.key !== key) throw new Error('PI_SCORE_RENDER_REQUIRED');
          stems[name] = score.result.stems[name];
        }
        const approvedPauses = timeline.pauses.map(p => { const start = p.afterCueId === null ? 0 : timeline.cues.find(c => c.id === p.afterCueId)!.endMs / 1000; return { t0: start, t1: start + p.ms / 1000 }; });
        const result = await (services.master ?? masterPiAudio)({ durationSeconds: timeline.durationMs / 1000, mix, stems, approvedPauses,
          narration: timeline.audioSlices.map(s => ({ path: s.path, sourceStartSeconds: (s.sourceStartMs ?? 0) / 1000, t0: s.startMs / 1000, t1: (s.startMs + s.durationMs) / 1000 })) },
        { pythonRoot: options.library.pythonRoot, outputDir: paths.audio, trustedScriptPath: options.trustedMasterScriptPath, signal });
        const issues = validateLemoAgentAudio({ durationSeconds: timeline.durationMs / 1000, fps: DIRECTOR_VISUAL_FPS, mix, stems: result.stems, events: [], onsets: result.onsets, narration: result.narration, silenceMeasurements: result.silenceMeasurements });
        await refresh(); if (before !== key) throw new Error('PI_REVIEW_SOURCE_CHANGED');
        const m = result.master;
        if (!issues.some(i => i.severity === 'failure') && m.sampleRate === 48000 && m.channels === 2 && m.nonFiniteSamples === 0 && m.peakAmplitude <= 1 && Math.abs(m.durationSeconds - timeline.durationMs / 1000) <= 1 / DIRECTOR_VISUAL_FPS) {
          audioMaster = { path: ref(paths.root, result.outputPath), sha256: await fileHash(result.outputPath), sourceHash: identity.sourceHash, timelineHash: identity.timelineHash, durationSeconds: m.durationSeconds, sampleRate: 48000, channels: 2 };
        } else audioMaster = undefined;
        return { result, issues, audioPassed: !!audioMaster };
      });
      tool('render_preview', empty, 'Export a full upstream-engine picture preview.', async () => {
        const before = key;
        const preview = services.preview ?? (await import('./lemo-upstream-renderer')).exportLemoUpstreamProject;
        const result = await preview({ ...options.library, filmDir: paths.project, outputDir: join(paths.reviews, key, 'preview'), durationSeconds: timeline.durationMs / 1000,
          fps: DIRECTOR_VISUAL_FPS, width: context.width, height: context.height, engine: 'upstream', captions: policy.captionMode === 'film' ? 1 : 0, signal });
        await refresh(); if (before !== key) throw new Error('PI_REVIEW_SOURCE_CHANGED');
        if (!result.receipt.technicalPassed || result.receipt.engine !== 'upstream-video.mjs' || !(await stat(result.outputPath)).size) throw new Error('PI_PREVIEW_FAILED');
        previewRef = ref(paths.root, result.outputPath); return result;
      });
      tool('finish', empty, 'Accept only current host evidence, treatment, credits, two contact reviews, audio and preview.', async () => {
        if (!(await inspectPiTreatment(paths.project)).structuralPassed || !technical || !reading || !credits || contacts < 2 || (segment === 1 && lookProofs < 1) || !previewRef || !audioMaster) throw new Error('PI_FINISH_EVIDENCE_REQUIRED');
        if (await fileHash(join(paths.root, audioMaster.path)) !== audioMaster.sha256) throw new Error('PI_AUDIO_MASTER_CHANGED');
        accepted = true; acceptedKey = key; return { accepted: true, visuallyReviewed: visualContacts >= 2, humanReviewed: false };
      });
      await refresh();
      active = await (options.sessionFactory ?? openPiFilmSession)({ workerPath: options.workerPath, projectRoot: paths.project, libraryRoot: options.library.upstreamRoot,
        stateRoot: paths.state, styleSlug: style.slug, config: options.config, capabilities: options.capabilities, policy,
        limits: options.limits ?? { maxRequests: run.settings.piMaxRequests ?? 120, maxTokens: run.settings.agentMaxTokens, maxCost: run.settings.agentMaxCost }, pricing: options.pricing,
        sessionFile: d.piFilm ? join(paths.state, d.piFilm.sessionRef) : undefined, operations,
        beforeTool: () => { if (acceptedKey) throw new Error('PI_FINISH_ACCEPTED'); },
        beforeSubmit: async () => { if (acceptedKey) throw new Error('PI_FINISH_ACCEPTED'); await refresh(); } });
      const globalPlanHash = createHash('sha256').update(globalPlan).digest('hex');
       await active.prompt([`SEGMENT ${segment}/${segmentCount}; GLOBAL PLAN SHA-256 ${globalPlanHash}. This is a runtime segment, not an independently timed video chapter.`, segmentContext, `STYLE REFERENCE: ${context.styleId}; canvas ${context.width}x${context.height}; duration ${context.durationSeconds}s.`,
         'TREATMENT.md must end with a concise ## Segment handoff section containing visual grammar, established facts/assets already introduced, transition motif and open setup for the next window; max 4000 characters.',
         'The complete authoritative narration clock is material/narration/cues.json; this segment may read it for timing, but may author visuals only for its supplied narration window.',
        'Create TREATMENT.md, index.html and film source. Audio mix is audio/mix.json. Only render_score executes trusted data-only synthesis; authored code cannot run.',
        'Use host tools for evidence. In segment 1, call look_proof once the visual system exists. Call review_frames twice, reading_check, audio_check and render_preview before finish. Self-reported flags are not accepted.',
        `Authoritative duration: ${timeline.durationMs / 1000}s. Caption mode: ${policy.captionMode}.`, styleReference ?? ''].join('\n'), options.promptTimeoutMs ?? 1_800_000);
      const summary = active.summary();
      if (summary.blocked || summary.unknown || summary.rejected || summary.usageUnknown) throw new Error('PI_RECONCILIATION_REQUIRED');
       const treatmentPath = join(paths.project, 'TREATMENT.md');
       let segmentHandoff: string | undefined;
       try { segmentHandoff = parsePiSegmentHandoff(await readFile(treatmentPath, 'utf8')); }
       catch (error) {
         if (segment < segmentCount) throw error;
         if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof Error && error.message === 'PI_SEGMENT_HANDOFF_REQUIRED')) throw error;
       }
      await refresh();
      const sessionFile = active.sessionFile;
      if (typeof sessionFile !== 'string' || !(await stat(sessionFile)).isFile() || !(await stat(sessionFile)).size) throw new Error('PI_SESSION_NOT_DURABLE');
      const sessionRef = ref(paths.state, sessionFile);
      if (!sessionRef.startsWith('sessions/')) throw new Error('PI_SESSION_NOT_DURABLE');
      const film: PiFilmState = { version: 1, authoringVersion: 4, runId: run.id, styleId: style.slug, policy, sessionRef,
        phase: accepted && acceptedKey === key ? 'ready' : 'paused', segment, segmentHandoff, completedModelRequests: summary.received,
        ...identity, actualDurationSeconds: timeline.durationMs / 1000, narrationPauses: timeline.pauses, acceptedPauseChanges: timeline.acceptedChanges,
        message: accepted ? 'Host evidence accepted; human review remains outstanding.' : 'SDK segment stopped; continue explicitly.', ...(audioMaster ? { audioMaster } : {}) };
      if (film.phase === 'ready') film.evidence = { ...identity, renderIdentity: { ...identity, engine: 'lemo-upstream', browserVersion: (await environment()).browserVersion,
        width: context.width, height: context.height, fps: DIRECTOR_VISUAL_FPS, captionMode: policy.captionMode }, technicalPassed: technical, readingPassed: reading, audioPassed: !!audioMaster,
        contactSheetPasses: contacts, previewRef, creditsPassed: credits, visuallyReviewed: visualContacts >= 2, humanReviewed: false };
      await active.close(); active = undefined;
      await piFilmCheckpoints(paths.state).save(piFilmStateSchema.parse(film));
      return { ...d, piFilm: film };
    } finally { try { await active?.close(); } finally { active = undefined; controller = undefined; busy = false; } }
  };
  return { piSegment, recoverPiSegment,
    piAudioMaster: async (d: Document, _node: VoxProductionNode): Promise<Document> => {
      const film = d.piFilm;
      if (!film || !d.productionRun || film.runId !== d.productionRun.id || piFilmReadyErrors(film).length || !film.audioMaster) throw new Error('PI_AUDIO_MASTER_NOT_READY');
      const paths = piProductionPaths(options.work, film.runId);
      const timeline = await stagePiNarrationTimeline({ document: d, resolveAudioPath: options.resolveAudioPath, outputDirectory: paths.narration,
        stateRoot: paths.narrationState, allowNarrationPauses: film.policy.allowNarrationPauses, targetDurationSeconds: film.policy.targetDurationSeconds });
      if (await piFilmSourceHash(paths.project) !== film.sourceHash || piDataHash(timeline) !== film.timelineHash
        || piDataHash(await verifyLemoAssets(paths.project) ?? []) !== film.assetHash
        || await fileHash(join(paths.root, film.audioMaster.path)) !== film.audioMaster.sha256) throw new Error('PI_AUDIO_MASTER_STALE');
      return d;
    },
    interrupt: async (reason: unknown) => { controller?.abort(reason); await active?.abort(); },
  };
}
