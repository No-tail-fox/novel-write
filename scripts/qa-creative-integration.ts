/** Component integration acceptance; deliberately does not exercise product IPC/licensing.
 * Reuses a completed real plan/voices and writes an isolated durable production journal.
 * Run once with --start, then a separate Electron process with --resume.
 */
import { app, BrowserWindow, safeStorage } from 'electron';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileDatabase } from '../src/shared/storage';
import { CredentialVault } from '../electron/credential-vault';
import { ConfigService } from '../electron/config-service';
import { VoxProductionService, voxInputHash } from '../electron/vox-production-service';
import { createVoxProductionRuntime } from '../electron/vox-production-runtime';
import { parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { resolveDirectorImageProviderStatus, resolveDirectorVoiceProviderStatus } from '../src/features/director-desk/director-generation';
import { createConfiguredTextLlm } from '../src/shared/llm-provider';
import { voxAnimationMessages } from '../src/shared/vox-animation-prompt';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { loadCreativeStyleReference } from '../electron/creative-style-references';
import { reviewCreativeAnimation } from '../electron/creative-animation-preview';
import { renderDirectorVideo } from '../electron/director-renderer';
import { hashDirectorRenderOutput } from '../electron/director-render-output';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint, directorNarrationAlignment, directorQualityStatus,
  evaluateDirectorQuality, mergeDirectorRenderCompletion, directorRenderOutputs } from '../src/shared/director-render';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';

const root = resolve('.'), work = join(root, '.artifacts/creative-integration');
const profile = join(work, 'profile'), dataDir = join(profile, 'storydream');
const journal = join(work, 'document.json'), ledger = join(work, 'dispatches.json');
const runtimePath = join(root, 'dist-electron/electron/vox-animation-runtime.js');
const resume = process.argv.includes('--resume');
if (process.env.VOX_QA_PAID !== '1') throw new Error('Explicit paid opt-in required after cost announcement.');
await mkdir(dataDir, { recursive: true });
if (!resume) {
  // Existing journals must be resumed/inspected, never silently replaced.
  try { await readFile(journal); throw new Error('Existing journal; inspect it and use --resume.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const live = join(process.env.APPDATA!, 'storydream');
  await copyFile(join(live, 'Local State'), join(profile, 'Local State'));
  for (const file of ['config.json', 'secrets.v1.json']) await copyFile(join(live, 'storydream', file), join(dataDir, file));
}
if (!app.isReady()) app.disableHardwareAcceleration();
app.setPath('userData', profile);
setDefaultPythonRuntimeAppRoot(root);
app.on('window-all-closed', () => {});

async function json(path: string) { return JSON.parse(await readFile(path, 'utf8')); }
async function persist(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, path);
}
const forbidden = async (): Promise<never> => { throw new Error('QA_UNEXPECTED_PAID_ASSET: Approved plan and real voices must be reused.'); };

await app.whenReady();
const keep = new BrowserWindow({ show: false });
let database: FileDatabase | undefined;
try {
  database = await FileDatabase.open(join(dataDir, 'data.db'));
  const configService = new ConfigService({ database, dataDir, vault: new CredentialVault(join(dataDir, 'secrets.v1.json'), {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: value => safeStorage.encryptString(value), decryptString: value => safeStorage.decryptString(value),
  }) });
  const config = await configService.getRuntimeConfig();
  const { secretStatus } = await configService.getPublicState();
  const image = resolveDirectorImageProviderStatus(config, secretStatus), voice = resolveDirectorVoiceProviderStatus(config, secretStatus);
  const identity = voxInputHash({ llm: { provider: config.llm.provider, baseUrl: config.llm.baseUrl, model: config.llm.model }, image, voice,
    imageEndpoint: image.provider === 'gpt_image' ? config.gptImage.baseUrl : image.provider === 'custom' ? config.customImage.baseUrl : 'jimeng',
    voiceEndpoint: voice.provider === 'minimax' ? 'https://api.minimaxi.com/v1/t2a_v2' : config.tts.volcengine.endpoint,
  });
  const original = parseEditorialCollagePipelineData(await json(join(root, '.artifacts/vox-production-data/document.json')));
  if (original.productionRun?.status !== 'completed' || original.productionRun.nodes.some(n => n.status !== 'completed')) throw new Error('Only a fully completed source is allowed.');
  if (original.productionRun.runtimeIdentity !== identity) throw new Error('QA_CONFIG_CHANGED: Restore the original model/voice configuration before reusing paid nodes.');
  if (!resume) {
    await persist(journal, original);
    await persist(ledger, []);
  }
  const paidBefore = Object.fromEntries(original.productionRun.nodes.filter(n => n.paid).map(n => [n.id, n.requestId]));
  let clock = Math.max(Date.now(), Date.parse((await json(journal)).updatedAt));
  const load = async () => parseEditorialCollagePipelineData(await json(journal));
  const save = async (document: EditorialCollagePipelineData) => {
    const next = { ...document, updatedAt: new Date(++clock).toISOString() };
    await persist(journal, next); return next;
  };
  let pauseRequested = false;
  let service: VoxProductionService;
  const reference = await loadCreativeStyleReference(join(root, 'vendor/lemo-opuscar'), 'dataviz');
  const runtime = createVoxProductionRuntime({
    identity, imageModel: image.model, voiceModel: voice.model, voice,
    preflight: async (_document, _settings, pending = []) => {
      if (!config.llm.apiKey) throw new Error('Text model credential is missing.');
      if (pending.some(n => ['plan', 'voice', 'image', 'cutout'].includes(n.kind))) throw new Error('QA_REUSE_FAILED: Preflight refused additional paid asset/plan calls.');
    },
    plan: forbidden, image: forbidden, speech: forbidden, cutout: forbidden,
    compileCode: compileVoxCode,
    generateCode: async (input, _style, requestId) => {
      const dispatches = await json(ledger) as { requestId: string; completed?: boolean }[];
      if (dispatches.length >= 8 || dispatches.some(d => d.requestId === requestId)) throw new Error('QA_DISPATCH_BOUND: No duplicate or speculative paid resubmission.');
      dispatches.push({ requestId }); await persist(ledger, dispatches);
      if (!resume && !pauseRequested) {
        pauseRequested = true;
        const d = await load();
        await service.control({ id: d.id, runId: d.productionRun!.id, action: 'pause' });
        console.log('Pause requested during first paid code node; its result must persist before exit.');
      }
      const messages = voxAnimationMessages(input); messages[0].content += `\n${reference}`;
      console.log('Dispatch code', requestId, 'model', config.llm.model);
      const result = await createConfiguredTextLlm(config.llm).run({ step: 1, name: '创意动画组件集成验收', messages, maxTokens: 10000, maxRetries: 0, timeoutMs: 180000 });
      // Save the returned provider response before the runtime/service performs compilation.
      await mkdir(join(work, requestId), { recursive: true });
      await persist(join(work, requestId, 'response.json'), { requestId, providerRequestId: result.requestId, source: result.text });
      dispatches.at(-1)!.completed = true; await persist(ledger, dispatches);
      return result.text;
    },
    previewCode: (d, shot, request) => reviewCreativeAnimation(d, shot, join(work, request), runtimePath),
    render: async d => {
      console.log('Rendering all actual code/template shots with reused real narration.');
      const scenes = buildDirectorRenderScenes(d), fingerprint = directorDocumentRenderFingerprint(d), startedAt = new Date().toISOString();
      const result = await renderDirectorVideo({ workDir: work, projectTitle: 'NASA 温度记录 · 创意动画', modeLabel: '创意动画', ratio: d.ratio, scenes, animationRuntimePath: runtimePath });
      const sha = await hashDirectorRenderOutput(result.outputPath, result.sizeBytes), now = new Date().toISOString(), id = randomUUID();
      const checks = evaluateDirectorQuality(d, scenes, result, fingerprint);
      const job = { id: `director-render-job-${id}`, workflowKind: d.workflowKind, nodeId: d.id, providerId: 'local-ffmpeg', model: 'StoryDream HTML capture + FFmpeg',
        capability: 'deterministic-render', status: 'completed' as const, inputHash: fingerprint, idempotencyKey: `${d.id}:render:${id}`, estimatedCost: 0, actualCost: 0, attempt: 1, createdAt: startedAt, updatedAt: now, renderFingerprint: fingerprint };
      const report = { id: `director-quality-${id}`, workflowKind: d.workflowKind, stage: 'export', providerJobId: job.id, renderFingerprint: fingerprint, artifactSha256: sha,
        status: directorQualityStatus(checks), checks, evidence: { subtitleLayout: result.subtitleLayout, audioMeanVolumeDb: result.audioMeanVolumeDb, audioPeakDb: result.audioPeakDb,
          audioLufs: result.audioLufs, audioTruePeakDb: result.audioTruePeakDb, audioIsSilent: result.audioIsSilent, blackIntervalsMs: result.blackIntervalsMs,
          visualContinuity: result.visualContinuity, audioQualityStatus: result.audioQualityStatus, audioQualityError: result.audioQualityError,
          blackDetectionStatus: result.blackDetectionStatus, blackDetectionError: result.blackDetectionError, narrationAlignment: directorNarrationAlignment(d, scenes, undefined, now) }, createdAt: now };
      await persist(join(work, 'render-report.json'), { result, report });
      if (report.status !== 'passed') throw new Error(`QA_QUALITY_GATE: ${JSON.stringify(checks.filter(c => c.status !== 'passed'))}`);
      const asset = { id: `director-export-${id}`, assetId: 'director-final-video', kind: 'video' as const, localPath: result.outputPath, sha256: sha,
        providerJobId: job.id, provider: 'local', model: job.model, createdAt: now, selected: true, pinned: true, renderFingerprint: fingerprint };
      return mergeDirectorRenderCompletion(d, { asset, job, report }) as EditorialCollagePipelineData;
    },
    verifyVideo: async (path, expected, narration) => {
      const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: work, media_path: path, require_nonblack: true, analyze_quality: true });
      await persist(join(work, 'probe.json'), probe);
      if (!probe.has_video || !probe.has_nonblack_video || narration && (!probe.has_audio || probe.audio_is_silent) || Math.abs(Number(probe.duration) * 1000 - expected) > 750) throw new Error('QA_MEDIA_VERIFY_FAILED');
    },
  });
  service = new VoxProductionService({ load, save, projects: async () => [original.id], checkpoint: async (_id, node, d) => {
    await mkdir(join(work, 'receipts'), { recursive: true });
    await persist(join(work, 'receipts', `${node.requestId}.json`), d);
  } }, async () => runtime);
  let d = await load();
  if (resume) {
    await service.restore(); d = await load();
    if (d.productionRun?.status !== 'completed') await service.control({ id: d.id, runId: d.productionRun!.id, action: 'resume' });
  } else {
    await service.start({ id: d.id, expectedUpdatedAt: d.updatedAt, settings: { ...original.productionRun.settings, authoring: { mode: 'ai-code', styleId: 'dataviz' } } });
  }
  await service.idle(d.id); d = await load();
  for (const [id, request] of Object.entries(paidBefore)) {
    if (d.productionRun!.nodes.find(n => n.id === id)?.requestId !== request) throw new Error(`QA_PAID_REUSE_FAILED: ${id}`);
  }
  const dispatches = await json(ledger);
  const output = directorRenderOutputs(d).current;
  const report = { status: d.productionRun!.status, surface: 'independent real production service/runtime + configured model + Electron browser capture + FFmpeg',
    productIpcAcceptance: 'blocked: LICENSE_REQUIRED in the production application; this harness is component integration only', source: '.artifacts/vox-production-data/document.json',
    phase: resume ? 'separate-process-resume' : 'pause-after-first-code', model: config.llm.model, paidPlanAndVoiceRequestsReused: paidBefore, dispatches,
    shots: d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, mode: s.animation?.mode, authoring: s.animation?.authoring }))), output,
    limitations: ['No VLM aesthetic review', 'Sentence-level timing; no word alignment claim', 'dataviz style only; remaining styles not cloud-validated'],
    message: d.productionRun!.message, nodes: d.productionRun!.nodes };
  await persist(join(work, resume ? 'report.json' : 'pause-report.json'), report);
  if (resume ? d.productionRun!.status !== 'completed' : d.productionRun!.status !== 'paused' || dispatches.length !== 1 || !dispatches[0].completed) throw new Error(`QA_RUN_${d.productionRun!.status}: ${d.productionRun!.message}`);
  if (resume && output?.localPath) await copyFile(output.localPath, join(work, 'creative-nasa.mp4'));
  console.log(JSON.stringify({ status: report.status, paidCodeCalls: dispatches.length, output: output?.localPath }));
  await database.close(); keep.destroy(); app.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message); await writeFile(join(work, 'error.txt'), message, 'utf8');
  await database?.close(); keep.destroy(); app.exit(1);
}
