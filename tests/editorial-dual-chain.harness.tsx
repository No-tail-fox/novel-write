import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorialCollagePage } from '../src/features/editorial-collage/EditorialCollagePage';
import { WorkspaceLeaveDialog, WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { StoryDreamProvider } from '../src/ui';
import { defaultConfig } from '../src/shared/config';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, editorialCollageSaveInputSchema, insertEditorialShot, parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { RendererAppState } from '../src/app/route-types';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import type { AppDelta, ImageLabGenerateInput, ImageLabRecord, Task, TaskSummary } from '../src/shared/types';
import { buildEditorialShotVideoRequest } from '../src/shared/editorial-media';
import { buildVoxProductionNodes, voxProductionSettings, type VoxProductionControl } from '../src/shared/vox-production';
import '../src/styles.css';
import '../src/styles/features/editorial-collage.css';

const storageKey = 'storydream-qa-editorial-dual-chain';
const seedTime = '2026-09-14T00:00:00.000Z';
const createSeed = () => createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'qa-vox-dual-chain', title: 'VOX 双链路集成验收', ratio: '16:9', now: seedTime }), '纸片人物走进草原，文字标签随后出现。', seedTime, 'auto');
type Snapshot = { document: EditorialCollagePipelineData; requests: ImageLabGenerateInput[]; records: ImageLabRecord[]; saveCount: number; blockedCalls: string[]; videoRequests: ReturnType<typeof buildEditorialShotVideoRequest>[] };
const emptySnapshot = (): Snapshot => ({ document: createSeed(), requests: [], records: [], saveCount: 0, blockedCalls: [], videoRequests: [] });
let snapshot: Snapshot = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') ?? emptySnapshot();
let deltaRevision = 0;
const appDeltaListeners = new Set<(delta: AppDelta) => void>();
const store = () => sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
const clone = <T,>(value: T): T => structuredClone(value);
const svgUrl = (content: string) => `data:image/svg+xml,${encodeURIComponent(content)}`;
const background = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#e9ddbd"/><path d="M0 850 Q500 600 980 850 T1920 800 V1080 H0Z" fill="#527861"/><path d="M0 970 Q600 680 1300 1010 T1920 920 V1080 H0Z" fill="#324f48"/></svg>');
const subject = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="650"><circle cx="250" cy="160" r="95" fill="#db9672"/><path d="M95 620V350Q100 255 250 265Q400 255 405 350V620Z" fill="#bd543d"/><path d="M164 155Q158 60 245 55Q344 40 348 145L314 118L285 150L225 114L170 166Z" fill="#302e28"/></svg>');
const keyframe = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#dcc999"/><path d="M0 790Q500 570 960 790T1920 760V1080H0Z" fill="#47745e"/><circle cx="750" cy="420" r="100" fill="#db9672"/><path d="M590 980V630Q580 520 750 530Q920 520 910 630V980Z" fill="#bd543d"/></svg>');
const controls = {
  productionCalls: [] as VoxProductionControl[],
  holdProduction: false,
  finishProductionControl: () => {},
  productionFixture(scenario: 'rejected' | 'legacy' | 'unknown' | 'paused' | 'running' | 'completed') {
    snapshot = emptySnapshot();
    controls.productionCalls = []; controls.holdProduction = false;
    const document = snapshot.document, settings = voxProductionSettings();
    const nodes = buildVoxProductionNodes(document, settings);
    const images = nodes.filter(n => n.kind === 'image');
    const failed = images[1] ?? images[0];
    for (const node of nodes.slice(0, nodes.indexOf(failed))) { node.status = 'completed'; node.attempt = 1; }
    failed.status = scenario === 'legacy' || scenario === 'unknown' ? 'unknown' : 'failed';
    failed.error = scenario === 'unknown' ? 'network closed after submit' : 'Image provider API error (400): I can create the bedroom background in the requested wax-crayon children’s picture-book style, but the image generation did not complete successfully. Please send the request again, and I’ll generate the 1536 × 1024 background-only illustration with warm paper texture, deep navy shadows, sparse coral accents, and generous empty space—without people, phones, text, or watermarks.';
    failed.attempt = 1; failed.requestId = '8ce55c93-d9a4-4244-afa2-5b5c19dc7495';
    if (scenario === 'completed') for (const node of nodes) { node.status = 'completed'; node.error = undefined; }
    if (scenario === 'running') { failed.status = 'running'; failed.error = undefined; }
    const status = ['paused', 'running', 'completed'].includes(scenario) ? scenario as 'paused' | 'running' | 'completed' : 'failed';
    document.productionRun = { version: 1, id: 'qa-retry-run', status, settings, nodes, sourceHash: 'qa', runtimeIdentity: 'qa', createdAt: seedTime, updatedAt: seedTime, message: status === 'failed' ? failed.error : undefined };
    store(); controls.remount();
  },
  advanceProduction() {
    const run = snapshot.document.productionRun;
    if (!run) throw new Error('QA_PRODUCTION_MISSING');
    const current = run.nodes.find(node => node.status === 'running') ?? run.nodes.find(node => node.status === 'pending');
    if (!current) throw new Error('QA_PRODUCTION_NO_ACTIVE_STEP');
    current.status = 'completed'; current.attempt = Math.max(1, current.attempt);
    const next = run.nodes.find(node => node.status === 'pending' && node.dependencies.every(dependency => run.nodes.some(parent => parent.id === dependency && parent.status === 'completed')));
    if (next) { next.status = 'running'; next.attempt = Math.max(1, next.attempt); }
    run.status = 'running';
    const updatedAt = new Date(Date.parse(snapshot.document.updatedAt) + 1).toISOString();
    snapshot.document.updatedAt = updatedAt; run.updatedAt = updatedAt;
    store();
    const task = { ...taskDetail(), inputPreview: (snapshot.document.sourceText ?? '').slice(0, 200) } as TaskSummary;
    for (const listener of appDeltaListeners) listener({ kind: 'task-upsert', task, revision: ++deltaRevision });
  },
  failNextSubject: false,
  remount: () => {},
  reset() { snapshot = emptySnapshot(); controls.failNextSubject = false; store(); controls.remount(); },
  snapshot() { return clone(snapshot); },
  recipeFixture() {
    snapshot = emptySnapshot();
    snapshot.document.assets.push({ id: 'qa-first', assetId: 'qa-first', kind: 'image', localPath: keyframe, prompt: '首帧测试图片', provider: 'local-import', createdAt: seedTime }, { id: 'qa-last', assetId: 'qa-last', kind: 'image', localPath: background, prompt: '尾帧测试图片', provider: 'local-import', createdAt: seedTime });
    const beat = snapshot.document.beats[0];
    snapshot.document = insertEditorialShot(snapshot.document, beat.id, 1, beat.shots[0].id, 3000);
    snapshot.document.beats[0].shots[1].keyframeAssetVersionId = 'qa-last';
    store(); controls.remount();
  },
};
Object.assign(window, { editorialDualChainQA: controls });
store();

function taskDetail(): Task {
  const document = snapshot.document;
  return {
    id: document.id, title: document.title, taskType: 'editorial-collage', status: 'draft', createdAt: document.createdAt,
    pipelineStep: document.stage, pipelineData: JSON.stringify(document), ratio: document.ratio, archivedAt: null,
  } as Task;
}

const localApi = {
  onAppDelta(callback: (delta: AppDelta) => void) {
    appDeltaListeners.add(callback);
    return () => appDeltaListeners.delete(callback);
  },
  async controlVoxProduction(input: VoxProductionControl) {
    controls.productionCalls.push(clone(input));
    if (controls.holdProduction) await new Promise<void>(resolve => { controls.finishProductionControl = resolve; });
    const run = snapshot.document.productionRun!;
    run.status = input.action === 'resume' ? 'running' : 'paused';
    run.message = undefined;
    store();
    return clone(run);
  },
  async getTaskDetail(id: string) { return id === snapshot.document.id ? taskDetail() : null; },
  async saveEditorialCollage(input: Parameters<StoryDreamApi['saveEditorialCollage']>[0]) {
    const request = editorialCollageSaveInputSchema.parse(input);
    if (request.expectedUpdatedAt !== snapshot.document.updatedAt) throw new Error('QA_STALE_WRITE: Expected the latest saved revision');
    snapshot.saveCount += 1;
    const updatedAt = new Date(Date.parse(snapshot.document.updatedAt) + 1).toISOString();
    snapshot.document = parseEditorialCollagePipelineData({ ...request.document, updatedAt });
    store();
    return null;
  },
  async generateImageLab(input: ImageLabGenerateInput) {
    snapshot.requests.push(clone(input));
    const fail = input.cutout === 'green' && controls.failNextSubject;
    if (fail) controls.failNextSubject = false;
    const now = new Date(Date.parse(seedTime) + snapshot.requests.length * 1000).toISOString();
    const record: ImageLabRecord = {
      id: input.id!, prompt: input.prompt, ratio: input.ratio, style: input.style, provider: input.provider ?? 'gpt_image',
      imagePath: fail ? '' : input.cutout === 'green' ? subject : input.prompt.includes('OUTPUT TARGET — COMPLETE COMPOSED KEYFRAME') ? keyframe : background,
      status: fail ? 'failed' : 'generated', errorMessage: fail ? 'QA 主体素材生成失败' : '',
      resolution: input.resolution ?? '2K', quality: input.quality ?? 'medium', smartMode: input.smartMode ?? 'text-to-image',
      referenceImagePaths: [], referenceImagePath: '', upstreamTaskId: null, createdAt: now, finishedAt: now,
    };
    snapshot.records.push(record);
    store();
    if (fail) throw new Error(record.errorMessage);
    return null;
  },
  async getImageLabRecordDetail(id: string) { return clone(snapshot.records.find((record) => record.id === id) ?? null); },
  async selectLocalImage() { return subject; },
  async readVoxAnimationAsset(path: string) { return path; },
  async listVoxTemplates() { return []; },
  async getVoxAnimationRuntime() { return await (await fetch('/runtime.js')).text(); },
  async generateDirectorShotVideo(input: Parameters<StoryDreamApi['generateDirectorShotVideo']>[0]) {
    const shot = snapshot.document.beats.flatMap(beat => beat.shots).find(shot => shot.id === input.shotId)!;
    snapshot.videoRequests.push(buildEditorialShotVideoRequest(snapshot.document, shot));
    store();
    throw new Error('QA_VIDEO_REQUEST_CAPTURED: 首尾帧已传递，未调用付费服务');
  },
  async listDirectorBatches() { return []; },
};
// Every unimplemented API fails loudly so this harness cannot reach a provider or a user project.
const api = new Proxy(localApi, {
  get(target, property) {
    if (property in target) return target[property as keyof typeof target];
    return async () => { snapshot.blockedCalls.push(String(property)); store(); throw new Error(`QA_BLOCKED_API: ${String(property)}`); };
  },
}) as unknown as StoryDreamApi;
const imageSettings = { ...defaultConfig.gptImage, baseUrl: 'https://qa.invalid', model: 'qa-image-model' };
const state = {
  config: { ...defaultConfig, imageProvider: 'gpt_image', activeImageProfileId: 'qa-image', gptImage: imageSettings, imageProfiles: [{ id: 'qa-image', name: '本地测试图片服务', enabled: true, provider: 'gpt_image', gptImage: imageSettings }],
    video: { ...defaultConfig.video, providers: [{ ...defaultConfig.video.providers[0], id: 'qa-video', enabled: true, baseUrl: 'https://qa.invalid', model: 'qa-video', capabilities: ['i2v', 'first-last-frame'], maxDurationSec: 15 }], automation: { ...defaultConfig.video.automation, providerWhitelist: ['qa-video'] }, activeProviderId: 'qa-video' } },
  secretStatus: { 'image/qa-image/gptImage/apiKey': true, 'video/qa-video/apiKey': true }, tasks: [taskDetail()],
} as unknown as RendererAppState;
const onRequestedTaskHandled = () => {};
const applyState = () => {};
function Host() {
  const [revision, setRevision] = useState(0);
  controls.remount = () => setRevision((current) => current + 1);
  return <EditorialCollagePage key={revision} api={api} state={state} applyState={applyState} requestedTaskId={snapshot.document.id} onRequestedTaskHandled={onRequestedTaskHandled} />;
}

createRoot(document.getElementById('root')!).render(<StoryDreamProvider theme="dark"><WorkspaceNavigationProvider><Host /><WorkspaceLeaveDialog /></WorkspaceNavigationProvider></StoryDreamProvider>);
