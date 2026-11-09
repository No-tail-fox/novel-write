/** Isolated production-chain QA. fixture = no paid calls; live requires an explicit flag and environment key. */
import { app } from 'electron';
import { setGenerationAuthorization } from '../src/shared/generation-authorization';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { createConfiguredTextLlm } from '../src/shared/llm-provider';
import { createVoxProductionRuntime } from '../electron/vox-production-runtime';
import { VoxProductionService } from '../electron/vox-production-service';
import { createLemoUpstreamOperations, lemoProductionContext, preflightLemoUpstream } from '../electron/lemo-upstream-production';
import { prepareLemoUpstreamPicture } from '../electron/lemo-upstream-picture';
import { renderDirectorVideo } from '../electron/director-renderer';
import { buildDirectorRenderScenes, directorCanvasForRatio, directorDocumentRenderFingerprint, evaluateDirectorQuality, directorQualityStatus, mergeDirectorRenderCompletion, isDirectorQualityBlocker } from '../src/shared/director-render';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { voxProductionSettings } from '../src/shared/vox-production';
import { evaluateDirectorSubtitleLayout } from '../src/shared/production-subtitle-layout';

const root = resolve(process.env.STORYDREAM_LEMO_ROOT || process.cwd());
const live = process.env.STORYDREAM_LEMO_QA_LIVE === '1';
const output = resolve(process.env.STORYDREAM_LEMO_QA_OUTPUT || join(root, '.artifacts/lemo-upstream-production', (live ? 'live-' : 'fixture-') + Date.now()));
const resume = process.env.STORYDREAM_LEMO_QA_RESUME === '1';
const modelName = process.env.STORYDREAM_LEMO_QA_MODEL || 'gemini-3.1-pro-high';
const budget = Number(process.env.STORYDREAM_LEMO_QA_ROUNDS || '16');
// Offscreen review windows are transient; keep the QA coordinator alive between turns.
app.on('window-all-closed', () => {});
app.setPath('userData', join(output, 'electron-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('disable-background-timer-throttling');
async function main() {
  await app.whenReady(); await mkdir(output, { recursive: true });
  if (live && !process.env.MOE_API_KEY) throw new Error('MOE_API_KEY missing; no model request submitted');
  if (existsSync(join(output, 'document.json')) && !resume) throw new Error('QA_EXISTS: explicitly resume saved receipts instead of creating another paid run');
  // Isolated QA uses the user's own provider key with explicit opt-in, not desktop IPC.
  // Never alter the desktop licensing hook or reuse a production userData directory.
  setGenerationAuthorization(async () => {
    if (!live || !process.env.MOE_API_KEY) throw new Error('QA_GENERATION_NOT_AUTHORIZED');
  });
  const library = { upstreamRoot: join(root, 'vendor/lemo-upstream'), threeRoot: join(root, 'node_modules/three'),
    ...(existsSync(join(root, '.artifacts/lemo-upstream/resources/resources.json')) ? { resourceRoot: join(root, '.artifacts/lemo-upstream/resources') } : {}) };
  let d = resume ? parseEditorialCollagePipelineData(JSON.parse(await readFile(join(output, 'document.json'), 'utf8'))) : createEditorialCollageStarterPlan(
    createEditorialCollageDraft({ id: 'lemo-upstream-qa-' + randomUUID(), title: '一滴雨水的花园旅程', ratio: '16:9' }),
    '雨水落在城市路面。流入雨水花园后，土壤留住水分，植物重新舒展。', new Date().toISOString(), 15000);
  let revision = Date.parse(d.updatedAt), requests = 0;
  const model = createConfiguredTextLlm({ provider: 'custom', protocol: 'openai', apiKey: process.env.MOE_API_KEY || '', baseUrl: 'https://moeapi.cloud', model: modelName, proxyUrl: '', requestParamsJson: '{}' });
  const write = (path: string, body: string) => '```json\n' + JSON.stringify({ tool: 'write_file', path }) + '\n```\n```html\n' + body + '\n```';
  const upstream = createLemoUpstreamOperations(library, output, async request => {
    requests++;
    console.log(JSON.stringify({ event: 'model_request', live, call: requests, turn: request.step }));
    if (live) return model.run(request);
    const context = lemoProductionContext(d);
    const html = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#faf1df;overflow:hidden}canvas{display:block}</style></head><body><canvas width="1920" height="1080"></canvas><script type="module">const c=document.querySelector("canvas").getContext("2d");window.DUR=' + context.durationSeconds + ';window.render=t=>{c.fillStyle="#faf1df";c.fillRect(0,0,1920,1080);c.fillStyle="#263a56";c.fillRect(0,750,1920,330);c.fillStyle="#6ab38c";c.fillRect(1100,640,700,120);for(let i=0;i<12;i++){c.fillStyle="#427fde";c.beginPath();c.arc(100+i*145,100+(t*115+i*80)%560,18,0,7);c.fill();}c.fillStyle="#457f50";c.fillRect(1400,420,22,250);c.beginPath();c.ellipse(1400,440,120+30*Math.sin(t),90,0,0,7);c.fill();};window.READY=true;</script></body></html>';
    const text = request.step === 1 ? write('index.html', html) : request.step === 2 ? '{"tool":"review_frames"}' : '{"tool":"finish","notes":"Offline test fixture only: actual Electron frames were captured; mock review is not AI generation or aesthetic approval."}';
    return { text, raw: text, requestId: 'offline-fixture', finishReason: 'stop' };
  });
  const never = async (): Promise<never> => { throw new Error('Unexpected provider operation in this QA'); };
  let lastReceipt: unknown;
  const runtime = createVoxProductionRuntime({ ...upstream, identity: 'lemo-production-qa-' + (live ? modelName : 'fixture'), imageModel: 'unused', voiceModel: 'unused', voice: { provider: 'volcengine', voiceId: 'unused', voiceLabel: 'unused', speed: 1 },
    upstreamStep: async (doc, node) => { const next = await upstream.upstreamStep(doc, node); if (requests >= budget && next.upstreamFilm?.status !== 'ready') await service.control({ id: doc.id, runId: doc.productionRun!.id, action: 'pause' }); return next; },
    preflight: async () => { await preflightLemoUpstream(library, 'brick-toy'); }, plan: never, image: never, speech: never, cutout: never, compileCode: () => ({ compiled: '' }),
    render: async doc => {
      const durationSeconds = doc.timeline!.durationMs / 1000;
      console.log(JSON.stringify({ event: 'native_export', durationSeconds }));
      const picturePath = await prepareLemoUpstreamPicture(library, output, doc);
      if (!picturePath) throw new Error('QA_MISSING_NATIVE_PICTURE');
      const scenes = buildDirectorRenderScenes(doc, undefined, { upstreamVideoPath: picturePath });
      const fingerprint = directorDocumentRenderFingerprint(doc);
      console.log(JSON.stringify({ event: 'compose_subtitles', scenes: scenes.length }));
      const result = await renderDirectorVideo({ workDir: output, ratio: doc.ratio, projectTitle: doc.title, modeLabel: 'Lemo QA', scenes });
      const checks = evaluateDirectorQuality(doc, scenes, result, fingerprint);
      const sha = createHash('sha256').update(await readFile(result.outputPath)).digest('hex');
      const now = new Date().toISOString(), id = randomUUID();
      lastReceipt = { mode: live ? 'live-generated-picture-with-host-subtitles-no-speech' : 'offline-fixture', model: live ? modelName : null, requests, picture: picturePath, outputPath: result.outputPath, result, checks, sha256: sha };
      await writeFile(join(output, 'export.json'), JSON.stringify(lastReceipt, null, 2), 'utf8');
      if (directorQualityStatus(checks) !== 'passed') throw new Error('QA_QUALITY_GATE: ' + checks.filter(isDirectorQualityBlocker).map(c => c.detail || c.label).join('; '));
      return mergeDirectorRenderCompletion(doc, {
        asset: { id: 'asset-' + id, assetId: 'director-final-video', kind: 'video', localPath: result.outputPath, sha256: sha, providerJobId: id, provider: 'local', model: 'native-upstream-qa', createdAt: now, selected: true, pinned: true, renderFingerprint: fingerprint },
        job: { id, workflowKind: doc.workflowKind, nodeId: doc.id, providerId: 'local-ffmpeg', model: 'native-upstream-qa', capability: 'deterministic-render', status: 'completed', inputHash: fingerprint, idempotencyKey: id, estimatedCost: 0, actualCost: 0, attempt: 1, createdAt: now, updatedAt: now, renderFingerprint: fingerprint },
        report: { id: 'report-' + id, workflowKind: doc.workflowKind, stage: 'export', providerJobId: id, renderFingerprint: fingerprint, artifactSha256: sha, status: 'passed', checks, evidence: { subtitleLayout: result.subtitleLayout }, createdAt: now },
      }) as EditorialCollagePipelineData;
    },
    verifyVideo: async (path, duration, requireAudio) => { const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: output, media_path: path, require_nonblack: true, analyze_quality: true }); if (!probe.has_video || !probe.has_nonblack_video || requireAudio && !probe.has_audio || Math.abs((probe.duration ?? 0) * 1000 - duration) > 100) throw new Error('QA_MEDIA_CHECK: ' + JSON.stringify(probe)); },
  });
  const service = new VoxProductionService({ projects: async () => [d.id], load: async () => structuredClone(d),
    save: async next => { d = parseEditorialCollagePipelineData({ ...next, updatedAt: new Date(++revision).toISOString() }); await writeFile(join(output, 'document.json'), JSON.stringify(d, null, 2), 'utf8'); return structuredClone(d); },
    checkpoint: async (_id, node, next) => { await mkdir(join(output, 'checkpoints'), { recursive: true }); await writeFile(join(output, 'checkpoints', node.requestId + '.json'), JSON.stringify(next), 'utf8'); },
    recover: async (_id, node) => { const path = join(output, 'checkpoints', node.requestId + '.json'); return existsSync(path) ? parseEditorialCollagePipelineData(JSON.parse(await readFile(path, 'utf8'))) : undefined; },
  }, async () => runtime);
  console.log(JSON.stringify({ event: 'start', output, live, model: live ? modelName : 'fixture' }));
  const confirmedNotSubmitted = process.env.STORYDREAM_LEMO_QA_CONFIRM_NOT_SUBMITTED;
  const retryUnknownRequest = process.env.STORYDREAM_LEMO_QA_RETRY_UNKNOWN_REQUEST;
  const retryNode = retryUnknownRequest ? d.productionRun?.nodes.find(n => n.requestId === retryUnknownRequest && n.status === 'unknown') : undefined;
  if (retryUnknownRequest && (!live || !resume || confirmedNotSubmitted || !retryNode)) throw new Error('QA_RETRY_UNKNOWN_REQUEST_MISMATCH');
  if (confirmedNotSubmitted) {
    const node = d.productionRun?.nodes.find(n => n.requestId === confirmedNotSubmitted && n.status === 'unknown');
    if (!resume || !node || node.error !== '授权服务尚未就绪，无法调用生成服务。') throw new Error('QA_NOT_SUBMITTED_EVIDENCE_MISMATCH');
    await service.control({ id: d.id, runId: d.productionRun!.id, action: 'confirm-no-result', nodeId: node.id,
      evidence: 'QA startup guard raised LICENSE_NOT_READY before fetchWithNetworkPolicy; provider request was never dispatched. Verified http.ts call order.' });
  }
  if (retryUnknownRequest && retryNode) {
    // Explicit operator consent is scoped to this exact request, not future unknown outcomes.
    await writeFile(join(output, 'retry-authorized-' + retryUnknownRequest + '.json'), JSON.stringify({
      at: new Date().toISOString(), runId: d.productionRun!.id, nodeId: retryNode.id,
      requestId: retryUnknownRequest, possibleDuplicateChargeAccepted: true,
    }, null, 2), { encoding: 'utf8', flag: 'wx' });
    await service.control({ id: d.id, runId: d.productionRun!.id, action: 'retry-unknown', nodeId: retryNode.id });
  } else if (resume) await service.control({ id: d.id, runId: d.productionRun!.id, action: 'resume' });
  else await service.start({ id: d.id, expectedUpdatedAt: d.updatedAt, settings: { ...voxProductionSettings(), narration: false, generateImages: false, authoring: { mode: 'ai-code', styleId: 'brick-toy', brief: '原创立体积木雨水花园，雨滴经过城市路面流入有土壤与植物的花园；镜头和主体有连续空间变化，不做字幕卡。禁止复用示例故事。' } } });
  await service.idle(d.id);
  if (!live && process.env.STORYDREAM_LEMO_QA_LOCAL_PATHS === '1' && d.productionRun?.status === 'completed') {
    const picture = await prepareLemoUpstreamPicture(library, output, d);
    if (!picture || await prepareLemoUpstreamPicture(library, output, d) !== picture) throw new Error('QA_CACHE_MISS');
    const clip = d.timeline!.clips.at(-1)!;
    const selected = buildDirectorRenderScenes(d, undefined, { shotIds: [clip.shotId], upstreamVideoPath: picture });
    if (selected.length !== 1 || selected[0].videoStartMs !== clip.startMs) throw new Error('QA_SHOT_WINDOW');
    const shot = await renderDirectorVideo({ workDir: output, ratio: d.ratio, projectTitle: d.title, modeLabel: 'native-shot-local-QA', scenes: selected });
    if (Math.abs(shot.durationMs - selected[0].durationMs) > 1000 / 24) throw new Error('QA_SHOT_DURATION');
    const starts = new Map([[clip.shotId, clip.startMs]]);
    const recheck = await renderDirectorVideo({ workDir: output, ratio: d.ratio, projectTitle: d.title, modeLabel: 'native-subtitle-recheck-QA', scenes: selected, sceneStarts: starts });
    const checks = evaluateDirectorSubtitleLayout(selected, recheck.subtitleLayout, directorCanvasForRatio(d.ratio), starts);
    await writeFile(join(output, 'local-paths.json'), JSON.stringify({ paidCalls: 0, picture, cacheReused: true,
      shot: { id: clip.shotId, startMs: clip.startMs, outputPath: shot.outputPath, durationMs: shot.durationMs },
      recheck: { outputPath: recheck.outputPath, checks, evidence: recheck.subtitleLayout } }, null, 2), 'utf8');
    if (checks.some(check => check.status !== 'passed')) throw new Error('QA_SUBTITLE_RECHECK_GATE');
    console.log(JSON.stringify({ event: 'local_paths_verified', shotId: clip.shotId, startMs: clip.startMs, paidCalls: 0 }));
  }
  console.log(JSON.stringify({ event: 'complete', output, status: d.productionRun?.status, message: d.productionRun?.message, requests, turn: d.upstreamFilm?.turn }));
  app.exit(d.productionRun?.status === 'completed' ? 0 : 1);
}
main().catch(async error => { console.error(error); await mkdir(output, { recursive: true }); await writeFile(join(output, 'fatal.txt'), String(error), 'utf8'); app.exit(1); });
