import { nativeImage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { VoxProductionNode } from '../src/shared/vox-production';
import { lemoUpstreamFilmSchema, type LemoUpstreamFilm } from '../src/shared/creative-animation/upstream-agent';
import { type LemoAgentHostToolRequest, type LemoAgentHostToolResult } from '../src/shared/lemo-agent-session';
import { LemoRequestLedger } from '../services/lemo-agent-worker/request-ledger';
import { LemoStageStore } from '../services/lemo-agent-worker/stage-store';
import { rejectLedgerLinks } from '../services/lemo-agent-worker/ledger-owner';
import { prepareLemoStateDirectory } from '../services/lemo-agent-worker/paths';
import { verifyPinnedLemoPlugin } from '../services/lemo-agent-worker/policy';
import { assertLemoUpstreamFilmCurrent, lemoProjectFingerprint } from './lemo-upstream-agent';
import { lemoProductionContext, preflightLemoUpstream, type LemoProductionLibrary } from './lemo-upstream-production';
import { reviewLemoUpstreamProject } from './lemo-upstream-renderer';
import { probeOfficialLemoAgentRuntime } from './lemo-agent-runtime';
import { lemoSessionFingerprints, runOfficialLemoAgentSession, type OfficialLemoSessionOptions } from './lemo-agent-session-runtime';
import { assertOfficialSharedLedger, ensureOfficialCreativeWorkflow, officialRepairBudgetUsage, officialTreatment, officialTreatmentInput, officialVoiceLock, readOfficialStageFile } from './lemo-official-stages';
import { assertOfficialSceneModules, officialScenePath, officialScenesManifest, prepareOfficialRepairBoundary } from './lemo-official-repair';

export interface LemoOfficialProductionOptions {
  library: LemoProductionLibrary; work: string;
  session: Pick<OfficialLemoSessionOptions, 'nodeExecutable' | 'workerPath' | 'provider' | 'maxOutputTokens' | 'maxRequests' | 'maxTurns' | 'timeoutMs' | 'requestTimeoutMs' | 'allowLoopbackTestProvider' | 'maxEstimatedCostUsd' | 'maxRepairRounds'>;
}
interface Material { id: string; path: string; sha256: string; bytes: number; description: string; sourceSha256: string }
interface Inputs { version: 1; contextHash: string; materials: Material[]; materialManifest: string; prompt: string; sceneManifest?: string }
interface PreservedFrame { time: number; beforePath: string; afterPath: string; pixelHash: string }
interface ReviewEvidence { version: 1; sourceHash: string; technicalPassed: boolean; durationSeconds?: number; frames: Array<{ path: string; sha256: string }>; operationId: string; preservedFrames?: PreservedFrame[]; targetBeforeFrames?: Array<{ path: string; pixelHash: string }> }
interface FinishEvidence { version: 1; operationId: string; reviewOperationId: string; sourceHash: string; filmHash: string }
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
async function readJson<T>(path: string): Promise<T | undefined> {
  await rejectLedgerLinks(path);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || info.size > 4 * 1024 * 1024) throw new Error('LEMO_OFFICIAL_STATE_FILE');
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (e) { if (missing(e)) return; throw e; }
}
async function atomic(path: string, value: unknown) {
  await rejectLedgerLinks(path); await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  await rename(temp, path);
}
async function writeMaterial(path: string, data: Buffer | string) {
  await rejectLedgerLinks(path);
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  try { await writeFile(path, bytes, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || info.size !== bytes.length || hash(await readFile(path)) !== hash(bytes)) throw new Error('LEMO_OFFICIAL_MATERIAL_CONFLICT');
  }
}
export function lemoOfficialRunRoot(work: string, runId: string) {
  if (!isAbsolute(work) || !/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error('LEMO_OFFICIAL_RUN_PATH');
  return join(work, 'lemo-official', runId, 'film');
}
function activeContext(d: EditorialCollagePipelineData) {
  if (d.productionRun?.authoringVersion !== 4) throw new Error('LEMO_OFFICIAL_VERSION_REQUIRED');
  const context = lemoProductionContext(d);
  if (!(context.durationSeconds > 0)) throw new Error('LEMO_OFFICIAL_TIMING_REQUIRED');
  return { ...context, cues: d.beats.flatMap(b => b.subtitleCues), shots: d.beats.flatMap(b => b.shots.map(s => ({
    id: s.id, title: s.title, direction: s.scenePrompt, durationMs: s.durationMs,
    startMs: d.timeline?.clips.find(c => c.shotId === s.id)?.startMs,
    materialIds: [...new Set([s.keyframeAssetVersionId, ...s.layers.filter(l => l.visible !== false).map(l => l.assetVersionId)].filter((id): id is string => !!id))],
  }))) };
}
async function sources(d: EditorialCollagePipelineData) {
  const ids = new Set(d.beats.flatMap(b => b.shots.flatMap(s => [s.keyframeAssetVersionId, ...s.layers.filter(l => l.visible !== false).map(l => l.assetVersionId)])).filter(Boolean));
  const assets = d.assets.filter(a => ids.has(a.id) && a.kind === 'image');
  if ([...ids].some(id => !d.assets.some(a => a.id === id))) throw new Error('LEMO_OFFICIAL_MATERIAL_MISSING');
  if (assets.length > 96) throw new Error('LEMO_OFFICIAL_MATERIAL_COUNT');
  return Promise.all(assets.map(async a => {
    if (!a.localPath || !isAbsolute(a.localPath)) throw new Error('LEMO_OFFICIAL_MATERIAL_MISSING');
    await rejectLedgerLinks(a.localPath); const info = await lstat(a.localPath);
    if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024 * 1024) throw new Error('LEMO_OFFICIAL_MATERIAL_FILE');
    const data = await readFile(a.localPath);
    return { id: a.id, data, sourceSha256: hash(data), description: (a.prompt ?? a.assetId).slice(0, 2000) };
  }));
}
function normalizedImage(data: Buffer) {
  let image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) throw new Error('LEMO_OFFICIAL_MATERIAL_DECODE');
  const size = image.getSize();
  if (Math.max(size.width, size.height) > 2048) image = image.resize({ width: Math.max(1, Math.round(size.width * 2048 / Math.max(size.width, size.height))) });
  // Preserve alpha while respecting the existing bounded project budget.
  for (let n = 0; n < 8; n++) {
    const png = image.toPNG();
    if (png.length <= 1024 * 1024) return png;
    image = image.resize({ width: Math.max(16, Math.floor(image.getSize().width * .75)) });
  }
  throw new Error('LEMO_OFFICIAL_MATERIAL_BUDGET');
}
function promptFor(context: ReturnType<typeof activeContext>, materials: Material[]) {
  const exposed = materials.map(({ sourceSha256: _source, ...m }) => m);
  return [
    'Create an original native HTML/ESM film with the fixed Lemo library. Read DIRECTOR.md, TECHNIQUE.md and styles/' + context.styleId + '/STYLE.md through mcp__storydream_film__read_library.',
    'Write index.html and separate modules with the audited project file tools. Expose window.READY=true after assets load, window.DUR=' + context.durationSeconds + ', and deterministic window.render(t). Exact canvas: ' + context.width + 'x' + context.height + '.',
    'Read-only /core/, /styles/, /node_modules/three/build/three.module.js and /node_modules/three/examples/jsm/ are served; your files are under /@film/. Local materials are listed in MATERIALS.json. Preserve this manifest and these image files. Do not request network URLs, run setup, use shell, install packages or execute OS programs.',
    'The host owns narration, ordinary subtitles, music and final mixing. Do not play or generate audio or duplicate ordinary subtitles. Preserve approved narration and absolute millisecond cue/shot timing. In-scene labels are allowed.',
    'Call mcp__storydream_film__review_film after writing. Inspect the actual returned frame images in a subsequent model turn, repair defects, and review again. Only then call mcp__storydream_film__finish_film with concrete notes about composition, scale, text and defects. SDK completion alone does not deliver a film.',
    context.brief,
    'STORYDREAM_FILM_CONTEXT=' + JSON.stringify({ ...context, materials: exposed }),
  ].join('\n');
}
async function prepareInputs(options: LemoOfficialProductionOptions, d: EditorialCollagePipelineData, create: boolean, stage: 'film' | 'style-frame' = 'film') {
  const active = activeContext(d), executionRoot = lemoOfficialRunRoot(options.work, active.runId);
  const phased = d.productionRun!.nodes.some(n => n.id === 'official-treatment');
  const context = stage === 'style-frame' ? { ...active, durationSeconds: 3, cues: [],
    brief: 'Create a three-second visual style sample before narration production. ' + JSON.stringify(officialTreatmentInput(d)),
    shots: active.shots.slice(0, 1).map(s => ({ ...s, durationMs: 3000, startMs: 0 })) } : active;
  const root = stage === 'film' ? executionRoot : join(executionRoot, 'stages', stage);
  if (phased) {
    await ensureOfficialCreativeWorkflow(executionRoot, active.runId, options.session);
    const treatment = await officialTreatment(d, { executionRoot, upstreamRoot: options.library.upstreamRoot, session: options.session }, false);
    if (!treatment) throw new Error('LEMO_TREATMENT_NOT_READY');
    if (stage === 'film' && !await officialVoiceLock(d, executionRoot, false)) throw new Error('LEMO_VOICE_LOCK_REQUIRED');
  }
  const old = await readJson<Inputs>(join(root, 'inputs.json'));
  if (!old && !create) return;
  if (create) await prepareLemoStateDirectory({ version: 1, action: 'probe', runRoot: root, upstreamRoot: options.library.upstreamRoot }, 'sdk-state');
  const project = join(root, 'sdk-state', 'project');
  const source = await sources(d);
  const sceneManifest = phased && stage === 'film' ? officialScenesManifest(context.shots) : undefined;
  let creativeInstructions = '';
  if (phased) {
    creativeInstructions = 'Approved treatment:\n' + (await readOfficialStageFile(join(executionRoot, 'stages', 'treatment', 'sdk-state', 'project', 'TREATMENT.md'), 256 * 1024)).toString('utf8');
    if (stage === 'film') {
      const sample = await prepareInputs(options, d, false, 'style-frame');
      const approved = sample && await readyFilm(sample);
      if (!approved?.review?.frames[0]) throw new Error('LEMO_STYLE_FRAME_REQUIRED');
      const data = await readOfficialStageFile(approved.review.frames[0], 32 * 1024 * 1024);
      source.push({ id: 'official-style-reference', data, sourceSha256: hash(data), description: 'Approved real style-frame capture. Match its visual direction and material language.' });
      creativeInstructions += '\nRead the official-style-reference image through the audited image tool and preserve the approved visual style. SCENES.json is a host-owned immutable manifest. Read it and implement every exact scene module path; index.html must import and route these modules by the supplied timeline. Keep each module self-contained and free of cross-shot side effects so a targeted repair can preserve all other files.';
    }
  }
  const contextHash = hash(JSON.stringify({ context, sources: source.map(({ data: _data, ...s }) => s) }));
  let inputs = old;
  if (inputs) {
    if (inputs.version !== 1 || inputs.contextHash !== contextHash) throw new Error('LEMO_OFFICIAL_INPUT_CHANGED');
  } else {
    if (existsSync(join(root, 'stage', 'stage.json'))) throw new Error('LEMO_OFFICIAL_INPUT_RECEIPT_MISSING');
    await mkdir(join(project, 'materials'), { recursive: true });
    const materials: Material[] = []; let total = 0;
    for (const s of source) {
      const data = normalizedImage(s.data); total += data.length;
      if (total > 12 * 1024 * 1024) throw new Error('LEMO_OFFICIAL_MATERIAL_BUDGET');
      const path = 'materials/' + hash(s.id).slice(0, 24) + '.png';
      await rejectLedgerLinks(join(project, path));
      await writeMaterial(join(project, path), data);
      materials.push({ id: s.id, path, bytes: data.length, sha256: hash(data), description: s.description, sourceSha256: s.sourceSha256 });
    }
    const materialManifest = JSON.stringify(materials.map(({ sourceSha256: _source, ...m }) => m), null, 2) + '\n';
    await writeMaterial(join(project, 'MATERIALS.json'), materialManifest);
    if (sceneManifest) await writeMaterial(join(project, 'SCENES.json'), sceneManifest);
    inputs = { version: 1, contextHash, materials, materialManifest, ...(sceneManifest ? { sceneManifest } : {}), prompt: (phased ? 'STORYDREAM_CREATIVE_STAGE=' + stage + '\n' + creativeInstructions + '\n' : '') + promptFor(context, materials) };
    await atomic(join(root, 'inputs.json'), inputs);
  }
  const validateMaterials = async () => {
    if (sceneManifest && (inputs.sceneManifest !== sceneManifest || (await readOfficialStageFile(join(project, 'SCENES.json'))).toString('utf8') !== sceneManifest)) throw new Error('LEMO_SCENE_MANIFEST_CHANGED');
    await rejectLedgerLinks(join(project, 'MATERIALS.json'));
    const manifestInfo = await lstat(join(project, 'MATERIALS.json'));
    if (!manifestInfo.isFile() || manifestInfo.nlink !== 1 || manifestInfo.size !== Buffer.byteLength(inputs.materialManifest)) throw new Error('LEMO_OFFICIAL_MATERIAL_MANIFEST_CHANGED');
    if (await readFile(join(project, 'MATERIALS.json'), 'utf8') !== inputs.materialManifest) throw new Error('LEMO_OFFICIAL_MATERIAL_MANIFEST_CHANGED');
    for (const m of inputs.materials) {
      if (!/^materials\/[a-f0-9]{24}\.png$/.test(m.path)) throw new Error('LEMO_OFFICIAL_MATERIAL_PATH');
      const path = join(project, m.path); await rejectLedgerLinks(path);
      const info = await lstat(path);
      if (!info.isFile() || info.nlink !== 1 || info.size !== m.bytes || info.size > 1024 * 1024) throw new Error('LEMO_OFFICIAL_MATERIAL_CHANGED');
      const bytes = await readFile(path);
      if (bytes.length !== m.bytes || hash(bytes) !== m.sha256) throw new Error('LEMO_OFFICIAL_MATERIAL_CHANGED');
    }
  };
  await validateMaterials();
  const session: OfficialLemoSessionOptions = { ...options.session, action: 'start', capability: 'film-authoring-v1',
    ...(phased ? { executionRoot } : {}), upstreamRoot: options.library.upstreamRoot, runRoot: root, runId: context.runId, stageId: stage, prompt: inputs.prompt };
  return { root, executionRoot, phased, project, context, inputs, session, validateMaterials };
}
type Prepared = NonNullable<Awaited<ReturnType<typeof prepareInputs>>> & {
  repair?: { baseProject: string; targetShot: string; sampleTimes: number[]; validate(requireChange?: boolean): Promise<void> };
};
async function prepareOfficialNode(options: LemoOfficialProductionOptions, d: EditorialCollagePipelineData, node: VoxProductionNode, create: boolean): Promise<Prepared | undefined> {
  if (!node.id.startsWith('official-repair:')) return prepareInputs(options, d, create, node.id === 'official-style-frame' ? 'style-frame' : 'film');
  let previous: Prepared | undefined = await prepareInputs(options, d, false);
  if (!previous?.phased || !previous.inputs.sceneManifest) throw new Error('LEMO_REPAIR_PHASED_FILM_REQUIRED');
  const repairs = d.productionRun!.nodes.filter(n => n.id.startsWith('official-repair:'));
  for (const repair of repairs) {
    const base = await readyFilm(previous);
    if (!base || base.sourceHash !== repair.repairSourceHash || !repair.shotId || !repair.repairInstructions || !/^official-repair:[a-f0-9-]{36}$/.test(repair.id)) throw new Error('LEMO_REPAIR_BASE_CHANGED');
    const stageId = repair.id.replace(':', '-'), root = join(previous.executionRoot, 'stages', stageId);
    const isTarget = repair.id === node.id, stageCreate = isTarget && create;
    const context: ReturnType<typeof activeContext> = previous.context;
    const target = context.shots.find(s => s.id === repair.shotId); if (!target) throw new Error('LEMO_REPAIR_SHOT_REQUIRED');
    if (stageCreate) await prepareLemoStateDirectory({ version: 1, action: 'probe', runRoot: root, upstreamRoot: options.library.upstreamRoot }, 'sdk-state');
    const boundary = await prepareOfficialRepairBoundary(root, base.directory, officialScenePath(repair.shotId), stageCreate);
    if (!boundary) return;
    const contextHash = hash(JSON.stringify({ base: base.sourceHash, shotId: repair.shotId, instructions: repair.repairInstructions, context }));
    const prompt = ['STORYDREAM_CREATIVE_STAGE=repair-shot', 'Repair exactly one approved scene module in this copied project: ' + boundary.boundary.target,
      'Only this existing module may change. Do not add, remove, rename or edit any other file, including index.html, SCENES.json, materials and other scenes. Preserve all narration, subtitles and timing. The host rejects any out-of-scope change and compares actual non-target shot frames.',
      'Read the current scene and implement this user request: ' + repair.repairInstructions,
      'Review the actual frames; only finish after the repaired scene is acceptable. All original execution budgets still apply.',
      'STORYDREAM_REPAIR_CONTEXT=' + JSON.stringify({ shotId: repair.shotId, module: boundary.boundary.target, startMs: target.startMs, durationMs: target.durationMs }),
      promptFor(context, previous.inputs.materials)].join('\n');
    const inputs: Inputs = { ...previous.inputs, contextHash, prompt };
    const saved = await readJson<Inputs>(join(root, 'inputs.json'));
    if (saved && JSON.stringify(saved) !== JSON.stringify(inputs)) throw new Error('LEMO_REPAIR_INPUT_CHANGED');
    if (!saved) { if (!stageCreate) return; if (existsSync(join(root, 'execution-intent.json')) || existsSync(join(root, 'stage', 'stage.json'))) throw new Error('LEMO_OFFICIAL_INPUT_RECEIPT_MISSING'); await atomic(join(root, 'inputs.json'), inputs); }
    const sampleTimes = context.shots.filter(s => s.id !== repair.shotId).flatMap(s => [0.08, .45, .86].map(t => ((s.startMs ?? 0) + t * s.durationMs) / 1000));
    previous = { root, executionRoot: previous.executionRoot, phased: true, project: boundary.project, context, inputs,
      session: { ...options.session, action: 'start', capability: 'film-authoring-v1', executionRoot: previous.executionRoot, upstreamRoot: options.library.upstreamRoot,
        runRoot: root, runId: context.runId, stageId, prompt }, validateMaterials: () => boundary.validate(),
      repair: { baseProject: base.directory, targetShot: repair.shotId, sampleTimes, validate: boundary.validate } };
    if (isTarget) return previous;
  }
  throw new Error('LEMO_REPAIR_NODE_REQUIRED');
}
async function validateCreative(p: Prepared, requireChange = false) {
  if (p.inputs.sceneManifest) await assertOfficialSceneModules(p.project, p.inputs.sceneManifest);
  await p.repair?.validate(requireChange);
}
async function pixelHash(path: string) {
  const frame = nativeImage.createFromBuffer(await readOfficialStageFile(path, 32 * 1024 * 1024));
  if (frame.isEmpty()) throw new Error('LEMO_REPAIR_FRAME_DECODE');
  return hash(Buffer.concat([Buffer.from(JSON.stringify(frame.getSize())), frame.toBitmap()]));
}
async function stageSnapshot(p: Prepared) {
  if ((existsSync(join(p.root, 'execution-intent.json')) || !p.phased && existsSync(join(p.root, 'ledger', 'requests.jsonl')))
    && (!existsSync(join(p.root, 'stage', 'stage-identity.json')) || !existsSync(join(p.root, 'stage', 'stage.json')))) throw new Error('LEMO_OFFICIAL_STAGE_RECEIPT_MISSING');
  const store = await LemoStageStore.open({ directory: join(p.root, 'stage'), projectDirectory: p.project,
    runId: p.context.runId, stageId: p.session.stageId, ...lemoSessionFingerprints(p.session) });
  try { return store.snapshot(); } finally { await store.close(); }
}
async function readyFilm(p: Prepared) {
  const stage = await stageSnapshot(p);
  const ledger = await LemoRequestLedger.open(join(p.executionRoot, 'ledger'), p.session.maxRequests, { existingOnly: p.phased || stage.attempt > 0 });
  try { if (ledger.summary().blocked) throw new Error('LEMO_LEDGER_BLOCKED'); } finally { await ledger.close(); }
  if (stage.status === 'unknown' || stage.pendingToolOperations) throw new Error('LEMO_OFFICIAL_STAGE_UNKNOWN');
  const raw = await readJson<LemoUpstreamFilm>(join(p.root, 'film.json'));
  if (stage.status !== 'completed') return;
  if (!raw) throw new Error('LEMO_OFFICIAL_FINISH_REQUIRED');
  const film = lemoUpstreamFilmSchema.parse(raw);
  if (film.runId !== p.context.runId || film.directory !== p.project || film.styleId !== p.context.styleId) throw new Error('LEMO_OFFICIAL_FILM_IDENTITY');
  const evidence = await readJson<ReviewEvidence>(join(p.root, 'review.json'));
  if (!evidence?.technicalPassed || evidence.sourceHash !== film.sourceHash || evidence.frames.length !== 3) throw new Error('LEMO_OFFICIAL_REVIEW_REQUIRED');
  const finish = await readJson<FinishEvidence>(join(p.root, 'finish.json'));
  const completed = (operationId: string, tool: string) => stage.toolEvents.some(e => e.operationId === operationId && e.tool === tool && e.phase === 'completed');
  if (!finish || finish.sourceHash !== film.sourceHash || finish.filmHash !== hash(JSON.stringify(raw)) || finish.reviewOperationId !== evidence.operationId
    || !completed(finish.operationId, 'mcp__storydream_film__finish_film') || !completed(evidence.operationId, 'mcp__storydream_film__review_film')) throw new Error('LEMO_OFFICIAL_FINISH_RECEIPT_REQUIRED');
  for (const frame of evidence.frames) {
    await rejectLedgerLinks(frame.path);
    if (hash(await readFile(frame.path)) !== frame.sha256) throw new Error('LEMO_OFFICIAL_REVIEW_CHANGED');
  }
  await validateCreative(p, !!p.repair);
  if (p.repair) {
    if (JSON.stringify(evidence.preservedFrames?.map(f => f.time)) !== JSON.stringify(p.repair.sampleTimes)) throw new Error('LEMO_REPAIR_COMPARISON_REQUIRED');
    for (const frame of evidence.preservedFrames ?? []) if (await pixelHash(frame.beforePath) !== frame.pixelHash || await pixelHash(frame.afterPath) !== frame.pixelHash) throw new Error('LEMO_REPAIR_UNTOUCHED_FRAMES_CHANGED');
    if (evidence.targetBeforeFrames?.length !== evidence.frames.length) throw new Error('LEMO_REPAIR_COMPARISON_REQUIRED');
    let changed = 0;
    for (let i = 0; i < evidence.frames.length; i++) {
      const before = evidence.targetBeforeFrames[i];
      if (await pixelHash(before.path) !== before.pixelHash) throw new Error('LEMO_REPAIR_COMPARISON_CHANGED');
      if (await pixelHash(evidence.frames[i].path) !== before.pixelHash) changed++;
    }
    if (!changed) throw new Error('LEMO_REPAIR_NO_VISUAL_CHANGE');
  }
  await p.validateMaterials(); await assertLemoUpstreamFilmCurrent(film, p.context.durationSeconds);
  return film;
}
export function createLemoOfficialOperations(options: LemoOfficialProductionOptions) {
  const preflightOfficial = async (styleId?: string) => {
    const s = options.session;
    if (s.provider.protocol !== 'anthropic') throw new Error('LEMO_SDK_PROTOCOL: 请为创意动画选择 Anthropic Messages 文本模型。');
    const url = new URL(s.provider.messagesUrl);
    if ((url.protocol !== 'https:' && !(s.allowLoopbackTestProvider && url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.search || url.hash || url.username || url.password || !url.pathname.endsWith('/messages')
      || !s.provider.apiKey || !s.provider.model) throw new Error('LEMO_OFFICIAL_PROVIDER_CONFIG');
    for (const path of [s.nodeExecutable, s.workerPath]) if (!isAbsolute(path) || !existsSync(path)) throw new Error('LEMO_OFFICIAL_RUNTIME_MISSING: 请安装 Node.js 20+ 并构建官方 SDK worker。');
    await verifyPinnedLemoPlugin(options.library.upstreamRoot);
    if (styleId) await preflightLemoUpstream(options.library, styleId);
    await probeOfficialLemoAgentRuntime({ ...s, upstreamRoot: options.library.upstreamRoot, runRoot: join(options.work, 'lemo-official', 'preflight'), timeoutMs: 60000 });
  };
  const recoverOfficialStep = async (d: EditorialCollagePipelineData, _node: VoxProductionNode) => {
    const executionRoot = lemoOfficialRunRoot(options.work, d.productionRun!.id);
    if (_node.id === 'official-treatment') return officialTreatment(d, { executionRoot, upstreamRoot: options.library.upstreamRoot, session: options.session }, false);
    if (_node.id === 'official-voice-lock') { await assertOfficialSharedLedger(executionRoot, options.session.maxRequests); return officialVoiceLock(d, executionRoot, false); }
    const p = await prepareOfficialNode(options, d, _node, false); if (!p) return;
    const film = await readyFilm(p); return film ? _node.id === 'official-style-frame' ? d : { ...d, upstreamFilm: film } : undefined;
  };
  const officialStep = async (d: EditorialCollagePipelineData, _node: VoxProductionNode, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const executionRoot = lemoOfficialRunRoot(options.work, d.productionRun!.id);
    if (_node.id === 'official-treatment') return (await officialTreatment(d, { executionRoot, upstreamRoot: options.library.upstreamRoot, session: options.session }, true, signal))!;
    if (_node.id === 'official-voice-lock') { await assertOfficialSharedLedger(executionRoot, options.session.maxRequests); return (await officialVoiceLock(d, executionRoot, true))!; }
    const p = (await prepareOfficialNode(options, d, _node, true))!;
    const recovered = await readyFilm(p); if (recovered) return _node.id === 'official-style-frame' ? d : { ...d, upstreamFilm: recovered };
    const snapshot = await stageSnapshot(p);
    const action = snapshot.attempt === 0 ? 'start' : 'resume';
    let reviewAttempts = snapshot.toolEvents.filter(e => e.tool === 'mcp__storydream_film__review_film' && e.phase === 'started').length;
    const allowance = options.session.maxRepairRounds ?? 3;
    const consumed = await officialRepairBudgetUsage(p.executionRoot, p.root, p.context.runId, d.productionRun!.nodes.filter(n => n.id.startsWith('official-repair:')).map(n => n.id));
    if (p.repair && consumed.otherReviewRounds + consumed.repairSessions + Math.max(0, reviewAttempts - 1) > allowance) throw new Error('LEMO_REPAIR_BUDGET_EXHAUSTED');
    const invokeHostTool = async (request: LemoAgentHostToolRequest, hostSignal: AbortSignal): Promise<LemoAgentHostToolResult> => {
      hostSignal.throwIfAborted(); await p.validateMaterials(); await validateCreative(p, !!p.repair);
      const sourceHash = await lemoProjectFingerprint(p.project);
      if (request.tool === 'review_film') {
        if (consumed.otherReviewRounds + consumed.repairSessions + Math.max(0, reviewAttempts++) > allowance) return { isError: true, sideEffectApplied: false, content: [{ type: 'text', text: 'LEMO_REPAIR_BUDGET_EXHAUSTED: The original run allowance for extra reviews and selected-shot repairs has been used. Stop; preserve the current project for explicit review.' }] };
        const selected = p.repair && p.context.shots.find(s => s.id === p.repair!.targetShot);
        const times = [0.08, .45, .86].map(t => selected ? ((selected.startMs ?? 0) + t * selected.durationMs) / 1000 : t * p.context.durationSeconds);
        const receipt = await reviewLemoUpstreamProject({ ...options.library, filmDir: p.project,
          outputDir: join(p.root, 'reviews', request.operationId), times,
          width: p.context.width, height: p.context.height, signal: hostSignal });
        hostSignal.throwIfAborted(); await p.validateMaterials();
        if (await lemoProjectFingerprint(p.project) !== sourceHash) throw new Error('LEMO_OFFICIAL_SOURCE_CHANGED');
        const frames = await Promise.all(receipt.frames.map(async f => ({ path: f.path, data: await readFile(f.path) })));
        const durationMatches = typeof receipt.durationSeconds === 'number' && Math.abs(receipt.durationSeconds - p.context.durationSeconds) <= 1 / 30;
        const evidence: ReviewEvidence = { version: 1, sourceHash, technicalPassed: receipt.technicalPassed && durationMatches && frames.length === 3,
          durationSeconds: receipt.durationSeconds, operationId: request.operationId, frames: frames.map(f => ({ path: f.path, sha256: hash(f.data) })) };
        if (p.repair) {
          const preserved: PreservedFrame[] = [];
          const baseline = await reviewLemoUpstreamProject({ ...options.library, filmDir: p.repair.baseProject,
            outputDir: join(p.root, 'reviews', request.operationId, 'target-before'), times, width: p.context.width, height: p.context.height, signal: hostSignal });
          if (!baseline.technicalPassed || baseline.frames.length !== frames.length) throw new Error('LEMO_REPAIR_COMPARISON_REQUIRED');
          evidence.targetBeforeFrames = await Promise.all(baseline.frames.map(async f => ({ path: f.path, pixelHash: await pixelHash(f.path) })));
          if (!(await Promise.all(frames.map(async (f, i) => await pixelHash(f.path) !== evidence.targetBeforeFrames![i].pixelHash))).some(Boolean)) throw new Error('LEMO_REPAIR_NO_VISUAL_CHANGE');
          if (p.repair.sampleTimes.length) {
            const capture = (filmDir: string, suffix: string) => reviewLemoUpstreamProject({ ...options.library, filmDir,
              outputDir: join(p.root, 'reviews', request.operationId, suffix), times: p.repair!.sampleTimes, width: p.context.width, height: p.context.height, signal: hostSignal });
            const before = await capture(p.repair.baseProject, 'unchanged-before'), after = await capture(p.project, 'unchanged-after');
            if (!before.technicalPassed || !after.technicalPassed || before.frames.length !== p.repair.sampleTimes.length || after.frames.length !== before.frames.length) throw new Error('LEMO_REPAIR_COMPARISON_REQUIRED');
            for (let i = 0; i < before.frames.length; i++) {
              const pixels = await pixelHash(before.frames[i].path);
              if (await pixelHash(after.frames[i].path) !== pixels) throw new Error('LEMO_REPAIR_UNTOUCHED_FRAMES_CHANGED');
              preserved.push({ time: p.repair.sampleTimes[i], beforePath: before.frames[i].path, afterPath: after.frames[i].path, pixelHash: pixels });
            }
          }
          await p.repair.validate(true); evidence.preservedFrames = preserved;
        }
        await atomic(join(p.root, 'review.json'), evidence);
        return { content: [{ type: 'text', text: JSON.stringify({ ...receipt, entry: 'index.html', frames: receipt.frames.map(f => ({ time: f.time })), sourceHash, durationMatches, technicalPassed: evidence.technicalPassed }) },
          ...frames.map(f => ({ type: 'image' as const, data: f.data.toString('base64'), mimeType: 'image/png' as const }))] };
      }
      const review = await readJson<ReviewEvidence>(join(p.root, 'review.json'));
      if (!review?.technicalPassed || review.sourceHash !== sourceHash || !request.input.notes || request.input.notes.trim().length < 20) {
        return { isError: true, sideEffectApplied: false, content: [{ type: 'text', text: 'LEMO_OFFICIAL_REVIEW_REQUIRED: Review current sources and inspect the frames before finishing.' }] };
      }
      const film: LemoUpstreamFilm = { version: 1, runId: p.context.runId, styleId: p.context.styleId, directory: p.project, turn: 1, status: 'ready', sourceHash,
        lastTool: 'finish_film', message: '官方 SDK 已完成当前源码审片，等待本机整片导出与音画验收。',
        review: { sourceHash, technicalPassed: true, durationSeconds: review.durationSeconds, frames: review.frames.map(f => f.path) },
        visualReview: { sourceHash, notes: request.input.notes, turn: 1 } };
      await assertLemoUpstreamFilmCurrent(film, p.context.durationSeconds); hostSignal.throwIfAborted();
      await atomic(join(p.root, 'film.json'), film);
      await atomic(join(p.root, 'finish.json'), { version: 1, operationId: request.operationId, reviewOperationId: review.operationId, sourceHash, filmHash: hash(JSON.stringify(film)) } satisfies FinishEvidence);
      return { content: [{ type: 'text', text: 'Current film sources and model visual notes saved. Host audiovisual export and final quality checks are still required.' }] };
    };
    await writeMaterial(join(p.root, 'execution-intent.json'), JSON.stringify({ version: 1, runId: p.context.runId, stageId: p.session.stageId, ...lemoSessionFingerprints(p.session) }));
    const result = await runOfficialLemoAgentSession({ ...p.session, action, signal, invokeHostTool });
    await atomic(join(p.root, 'session-receipt.json'), result);
    if (result.receipt.status !== 'completed') throw new Error('LEMO_OFFICIAL_SESSION_' + result.receipt.status.toUpperCase());
    const film = await readyFilm(p);
    if (!film) throw new Error('LEMO_OFFICIAL_FINISH_REQUIRED');
    return _node.id === 'official-style-frame' ? d : { ...d, upstreamFilm: film };
  };
  return { officialStep, recoverOfficialStep, preflightOfficial };
}
