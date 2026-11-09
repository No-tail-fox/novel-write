import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { createVoxProductionRuntime, type VoxProductionOperations } from '../electron/vox-production-runtime';
import { VoxProductionService } from '../electron/vox-production-service';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { voxProductionSettings, type VoxProductionSettings } from '../src/shared/vox-production';

export const nativeHtml = (durationMs = 3000) => '<!doctype html><html><head><style>html,body{margin:0;overflow:hidden}</style></head><body><canvas id="stage" width="1920" height="1080"></canvas><script type="module">import {clamp} from "./core/lib.js"; const ctx=document.querySelector("canvas").getContext("2d");window.DUR=' + durationMs / 1000 + ';window.render=t=>{ctx.fillStyle="#f0e8d8";ctx.fillRect(0,0,1920,1080);ctx.fillStyle="#182536";ctx.fillRect(100+clamp(t/3)*800,250,400,400);};window.TEXTS=()=>[];window.READY=true;</script></body></html>';
export const nativeSettings = (patch: Partial<VoxProductionSettings> = {}): VoxProductionSettings => ({ ...voxProductionSettings(), generateImages: false, narration: false, authoring: { mode: 'ai-code', styleId: 'watercolor' }, ...patch });
export function nativeDocument() {
  return createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'native-test', title: '城市热岛', ratio: '16:9' }), '道路与建筑吸收阳光。树荫可以降低地表温度。', '2026-10-27T00:00:00.000Z', 15000);
}
export function nativeOperations(overrides: Partial<VoxProductionOperations> = {}): VoxProductionOperations {
  const never = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  return { identity: 'native-offline-test', imageModel: 'image', voiceModel: 'voice', voice: { provider: 'volcengine', voiceId: 'test', voiceLabel: 'test', speed: 1 }, preflight() {}, plan: never, image: never, speech: never, cutout: never, render: never, verifyVideo: never, compileCode: compileVoxCode,
    planFilm: async () => ({ treatment: '以树荫作为城市热岛的视觉论点，先展开吸热的街道，再以连续镜头推至树下，文字和水彩笔触共同呈现降温机制。', fps: 24 }),
    generateFilm: async prompt => nativeHtml(JSON.parse(prompt).durationMs), previewCode: async () => ['offline-review.jpg'], ...overrides };
}
/** An isolated store parses every save exactly as production does; it never opens a database. */
export function nativeHarness(overrides: Partial<VoxProductionOperations> = {}, initial = nativeDocument()) {
  let document = initial, revision = Date.parse(initial.updatedAt);
  const receipts = new Map<string, EditorialCollagePipelineData>();
  const errors: unknown[] = [], calls: string[] = [];
  const runtime = createVoxProductionRuntime(nativeOperations(overrides));
  const execute = runtime.execute;
  runtime.execute = async (d, node) => { calls.push(node.kind); return ['render', 'verify'].includes(node.kind) ? d : execute(d, node); };
  const store = { load: async () => structuredClone(document), save: async (d: EditorialCollagePipelineData) => { document = parseEditorialCollagePipelineData({ ...d, updatedAt: new Date(++revision).toISOString() }); return structuredClone(document); }, projects: async () => [document.id],
    checkpoint: async (_id: string, node: {requestId?:string}, d: EditorialCollagePipelineData) => { receipts.set(node.requestId!, structuredClone(d)); },
    recover: async (_id: string, node: {requestId?:string}) => receipts.get(node.requestId!),
  };
  const service = new VoxProductionService(store, async () => runtime, error => errors.push(error));
  return { service, runtime, store, calls, errors, receipts, get: () => structuredClone(document), set: (d: EditorialCollagePipelineData) => { document = structuredClone(d); },
    start: (settings = nativeSettings()) => service.start({ id: document.id, expectedUpdatedAt: document.updatedAt, settings }), idle: () => service.idle(document.id) };
}
