/** Zero-paid official SDK -> Electron review -> voiced MP4 acceptance.
 * The Messages responder is a deterministic local fixture, not a real aesthetic reviewer.
 */
import assert from 'node:assert/strict';
import { app, BrowserWindow, nativeImage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createLemoOfficialOperations } from '../electron/lemo-official-production';
import { officialScenePath } from '../electron/lemo-official-repair';
import { prepareLemoUpstreamPicture } from '../electron/lemo-upstream-picture';
import { createVoxProductionRuntime } from '../electron/vox-production-runtime';
import { VoxProductionService } from '../electron/vox-production-service';
import { renderDirectorVideo } from '../electron/director-renderer';
import { createEditorialCollageDraft, parseEditorialCollagePipelineData, rebuildEditorialTimeline, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { createEditorialMotionLayers } from '../src/shared/editorial-motion';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint, directorNarrationAlignment, directorQualityStatus, directorRenderOutputs, evaluateDirectorQuality, isDirectorQualityBlocker, mergeDirectorRenderCompletion } from '../src/shared/director-render';
import { setGenerationAuthorization } from '../src/shared/generation-authorization';
import { LEMO_AGENT_SDK_VERSION } from '../src/shared/lemo-agent-sdk';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import type { ImageLabRecord, VoiceLabRecord } from '../src/shared/types';
import { voxProductionSettings } from '../src/shared/vox-production';
import { prepareQaNarration } from './qa-animation-media';

type JsonObject = Record<string, unknown>;
interface FilmContext {
  runId: string; styleId: string; width: number; height: number; durationSeconds: number;
  cues: Array<{ text: string; startMs: number; endMs: number }>;
  shots: Array<{ id: string; startMs?: number; durationMs?: number }>;
  materials: Array<{ id: string; path: string; sha256: string; bytes: number; description: string }>;
}
const root = resolve(process.env.STORYDREAM_LEMO_ROOT || process.cwd());
const artifacts = join(root, '.artifacts/lemo-official-production-20261102');
const output = resolve(process.env.STORYDREAM_LEMO_OFFICIAL_QA_OUTPUT || join(artifacts, 'run-' + Date.now()));
app.setPath('userData', join(output, 'electron-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.on('window-all-closed', () => {});
const sentences = ['雨水落进花园。', '树叶慢慢舒展。'];
const report: JsonObject = { version: 1, status: 'running', paidRequests: 0, realProviderVerified: false,
  aestheticReview: 'deterministic offline fixture; no model aesthetic approval claimed',
  scope: 'official SDK, real frame-image round trip, measured SAPI speech, host subtitles, MP4 quality and project registration', output };
const requests: JsonObject[] = [], mediaOperations: JsonObject[] = [];
let context: FilmContext | undefined, fixtureFailure: string | undefined, keepAlive: BrowserWindow | undefined;
let document: EditorialCollagePipelineData, externalFetchAttempts = 0;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const save = (name: string, value: unknown) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', 'utf8');
function objects(value: unknown): JsonObject[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(objects);
  const item = value as JsonObject; return [item, ...Object.values(item).flatMap(objects)];
}
function messageLines(body: JsonObject) {
  const lines = objects(body.messages).flatMap(item => typeof item.text === 'string' ? item.text.split('\n') : []);
  for (const item of objects(body.messages)) if (typeof item.content === 'string') lines.push(...item.content.split('\n'));
  return lines;
}
function readContext(body: JsonObject, stage: string): FilmContext {
  const lines = messageLines(body);
  const marker = lines.reverse().find(line => line.startsWith('STORYDREAM_FILM_CONTEXT='));
  assert(marker, 'Actual provider messages must contain STORYDREAM_FILM_CONTEXT');
  const parsed = JSON.parse(marker.slice('STORYDREAM_FILM_CONTEXT='.length)) as FilmContext;
  assert(Number.isInteger(parsed.width) && parsed.width >= 16 && Number.isInteger(parsed.height) && parsed.height >= 16);
  assert(Number.isFinite(parsed.durationSeconds) && parsed.durationSeconds > 0);
  assert.equal(parsed.shots.length, stage === 'style-frame' ? 1 : 2);
  if (stage === 'style-frame') { assert.equal(parsed.cues.length, 0); assert.equal(parsed.durationSeconds, 3); }
  else assert(parsed.cues.length >= 2 && parsed.cues.every(cue => cue.endMs > cue.startMs));
  assert(parsed.materials.length >= 2, 'Local images must reach the actual SDK prompt');
  for (const material of parsed.materials) {
    assert(/^materials\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp)$/i.test(material.path));
    assert(/^[a-f0-9]{64}$/.test(material.sha256) && material.bytes > 0);
  }
  assert.equal(parsed.runId, document.productionRun!.id);
  if (stage !== 'style-frame') {
    assert(Math.abs(parsed.durationSeconds * 1000 - document.timeline!.durationMs) < 0.001);
    assert.equal(parsed.cues.map(cue => cue.text).join('').replace(/\s/g, ''), sentences.join(''));
  }
  return parsed;
}
function filmHtml(input: FilmContext): string {
  const fixtureInput = { width: input.width, height: input.height, duration: input.durationSeconds,
    shots: input.shots, images: input.materials.slice(0, 2).map(item => './' + item.path) };
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e9f3ee}canvas{display:block;width:100%;height:100%}</style></head><body><canvas></canvas><script type="module">',
    'const input=' + JSON.stringify(fixtureInput) + ';',
    ...input.shots.map((s, i) => 'import { draw as scene' + i + ' } from "./' + officialScenePath(s.id) + '";'),
    'const scenes=[' + input.shots.map((_s, i) => 'scene' + i).join(',') + '];',
    "const canvas=document.querySelector('canvas');canvas.width=input.width;canvas.height=input.height;const ctx=canvas.getContext('2d');const W=input.width,H=input.height;",
    "const images=await Promise.all(input.images.map(src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('QA_MATERIAL_LOAD_FAILED:'+src));image.src=src;})));window.DUR=input.duration;",
    "window.render=t=>{let i=input.shots.findIndex(s=>t*1000>=(s.startMs||0)&&t*1000<(s.startMs||0)+s.durationMs);if(i<0)i=scenes.length-1;scenes[i](ctx,t,W,H,images);};window.render(0);window.READY=true;",
    '</script></body></html>', '',
  ].join('\n');
}
function sceneModule(later: boolean, repaired = false) {
  return [
    'export function draw(ctx,t,W,H,images){const later=' + later + ';',
    "const gradient=ctx.createLinearGradient(0,0,0,H);gradient.addColorStop(0,later?'#dceedd':'#dce9f4');gradient.addColorStop(1,'#f4ead0');ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);ctx.fillStyle='#3d6559';ctx.fillRect(0,H*.7,W,H*.3);ctx.fillStyle='#97b972';ctx.fillRect(0,H*.68,W,H*.04);",
    "const photo=images[later?1:0];const panel=W*.32;const px=W*.08+Math.sin(t*.45)*W*.012;ctx.fillStyle='#fffef7';ctx.fillRect(px-12,H*.13-12,panel+24,H*.47+24);ctx.drawImage(photo,px,H*.13,panel,H*.47);",
    "for(let i=0;i<5;i++){const x=W*(.52+i*.085),grown=later?1:.55,sway=Math.sin(t*1.4+i)*W*.007;ctx.strokeStyle='#397c4f';ctx.lineWidth=W*.009;ctx.beginPath();ctx.moveTo(x,H*.72);ctx.quadraticCurveTo(x+sway,H*.52,x+sway,H*(.67-.25*grown));ctx.stroke();ctx.fillStyle=i%2?'#72ad6a':'#a6cb78';ctx.beginPath();ctx.ellipse(x+sway-W*.018,H*(.63-.19*grown),W*.032,H*.025,-.5,0,Math.PI*2);ctx.ellipse(x+sway+W*.018,H*(.60-.19*grown),W*.032,H*.025,.5,0,Math.PI*2);ctx.fill();}",
    "if(!later){ctx.fillStyle='#4389b8';for(let i=0;i<24;i++){const x=W*(.03+(i*.127)% .94),y=H*((t*.21+i*.073)% .64);ctx.beginPath();ctx.ellipse(x,y,W*.003,H*.015,.2,0,Math.PI*2);ctx.fill();}}else{ctx.fillStyle='#efc56a';ctx.beginPath();ctx.arc(W*.85,H*.17,H*.07,0,Math.PI*2);ctx.fill();}",
    repaired ? "ctx.fillStyle='#d7aa40';ctx.beginPath();ctx.arc(W*.88,H*.38,H*.035,0,Math.PI*2);ctx.fill();" : '',
    '}', '',
  ].join('\n');
}
function frameImages(body: JsonObject) {
  return objects(body.messages).filter(item => item.type === 'image').map(item => {
    const source = item.source as JsonObject | undefined;
    const data = typeof source?.data === 'string' ? source.data : typeof item.data === 'string' ? item.data : '';
    assert(data, 'Review must return actual image bytes');
    const bytes = Buffer.from(data, 'base64'), image = nativeImage.createFromBuffer(bytes); assert(!image.isEmpty());
    const size = image.getSize();
    // The SDK may resize image content before forwarding it to a Messages provider.
    assert(size.width >= 500 && size.height >= 250 && size.width <= context!.width && size.height <= context!.height);
    assert(Math.abs(size.width / size.height - context!.width / context!.height) < 0.01);
    return { sha256: digest(bytes), ...size };
  });
}
const stageTurns = new Map<string, number>();
const fixture = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST'); assert(request.url?.startsWith('/v1/messages'));
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of request) { bytes += chunk.length; assert(bytes <= 32 * 1024 * 1024); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonObject;
    const available = (body.tools as Array<{ name: string }>).map(item => item.name);
    const lines = messageLines(body), stage = lines.find(line => line.startsWith('STORYDREAM_CREATIVE_STAGE='))?.slice('STORYDREAM_CREATIVE_STAGE='.length);
    assert(stage && ['treatment', 'style-frame', 'film', 'repair-shot'].includes(stage), 'Explicit creative stage is required');
    for (const name of stage === 'treatment' ? ['mcp__storydream__write_text'] : ['mcp__storydream__write_text', 'mcp__storydream_film__review_film', 'mcp__storydream_film__finish_film']) assert(available.includes(name), 'Missing tool: ' + name);
    for (const result of objects(body.messages).filter(item => item.type === 'tool_result')) assert.notEqual(result.is_error, true, 'Tool failed: ' + JSON.stringify(result).slice(0, 1200));
    if (stage !== 'treatment') context = readContext(body, stage);
    const turn = (stageTurns.get(stage) ?? 0) + 1; stageTurns.set(stage, turn);
    const writeCount = stage === 'treatment' ? 2 : stage === 'repair-shot' ? 1 : context!.shots.length + 1;
    assert(turn <= writeCount + (stage === 'treatment' ? 1 : 3), 'Unexpected repeated fixture action');
    const images = stage !== 'treatment' && turn > writeCount + 1 ? frameImages(body) : [];
    if (stage !== 'treatment' && turn > writeCount + 1) { assert(images.length >= 3, 'Three real review frames must reach SDK'); assert(new Set(images.map(item => item.sha256)).size > 1, 'Frames must change over time'); }
    requests.push({ stage, turn, available, receivedImageCount: images.length, imageEvidence: images }); await save('provider-requests.json', requests);
    let tool: { name: string; input: JsonObject } | undefined;
    if (stage === 'treatment' && turn <= 2) {
      const marker = lines.find(line => line.startsWith('STORYDREAM_TREATMENT_CONTEXT=')); assert(marker);
      const treatment = JSON.parse(marker.slice('STORYDREAM_TREATMENT_CONTEXT='.length)) as { shotIds: string[] };
      tool = { name: 'mcp__storydream__write_text', input: turn === 1 ? { path: 'TREATMENT.md', content: 'Offline treatment fixture. The garden connects rain, soil and growing leaves in a continuous visual argument. Use a pale blue and warm cream palette, generous picture panels, visible leaf movement and clear foreground hierarchy. The first shot shows measured rainfall and the next shot shows new plant growth. Use the approved source, imported images and exact narration without inventing facts.' } : { path: 'SHOT_PLAN.json', content: JSON.stringify({ version: 1, shots: treatment.shotIds.map((id, i) => ({ id, title: 'Garden shot ' + (i + 1), scenePrompt: 'Use the approved garden image with layered foliage, measured rain movement, clear composition and a calm blue-green color palette.' })) }) } };
    } else if (stage === 'repair-shot' && turn === 1) {
      const marker = lines.find(line => line.startsWith('STORYDREAM_REPAIR_CONTEXT=')); assert(marker);
      const repair = JSON.parse(marker.slice('STORYDREAM_REPAIR_CONTEXT='.length)) as { module: string; shotId: string };
      tool = { name: 'mcp__storydream__write_text', input: { path: repair.module, content: sceneModule(repair.shotId === 'shot-2', true) } };
    } else if (stage !== 'treatment' && turn <= writeCount) {
      tool = { name: 'mcp__storydream__write_text', input: turn === writeCount ? { path: 'index.html', content: filmHtml(context!) } : { path: officialScenePath(context!.shots[turn - 1].id), content: sceneModule(turn === 2) } };
    } else if (stage !== 'treatment' && turn === writeCount + 1) tool = { name: 'mcp__storydream_film__review_film', input: {} };
    else if (stage !== 'treatment' && turn === writeCount + 2) tool = { name: 'mcp__storydream_film__finish_film', input: { notes: 'Offline deterministic fixture received actual current-source frames. Imported panels and changing rain/plants appear at the requested canvas. This exercises the review protocol only; no real model aesthetic approval is claimed.' } };
    const event = (type: string, fields: JsonObject = {}) => 'event: ' + type + '\ndata: ' + JSON.stringify({ type, ...fields }) + '\n\n';
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    response.write(event('message_start', { message: { id: 'msg_official_film_' + turn, type: 'message', role: 'assistant', model: 'offline-official-film', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 40, output_tokens: 0 } } }));
    response.write(event('content_block_start', { index: 0, content_block: tool ? { type: 'tool_use', id: 'toolu_official_' + turn, name: tool.name, input: {} } : { type: 'text', text: '' } }));
    response.write(event('content_block_delta', { index: 0, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } : { type: 'text_delta', text: 'Offline sources and review protocol completed. Host media export and quality verification remain authoritative.' } }));
    response.write(event('content_block_stop', { index: 0 }));
    response.write(event('message_delta', { delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }));
    response.end(event('message_stop'));
  } catch (error) { fixtureFailure = error instanceof Error ? error.stack || error.message : String(error); console.error('LOCAL_FIXTURE_FAILED:', fixtureFailure); response.destroy(); }
});
async function main() {
  await mkdir(output, { recursive: true }); assert(!existsSync(join(output, 'document.json')), 'Do not overwrite previous evidence');
  setDefaultPythonRuntimeAppRoot(root); setGenerationAuthorization(async () => { throw new Error('OFFLINE_QA_EXTERNAL_GENERATION_DENIED'); });
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') { externalFetchAttempts++; throw new Error('OFFLINE_QA_EXTERNAL_FETCH_DENIED'); }
    return originalFetch(input, init);
  };
  await app.whenReady(); keepAlive = new BrowserWindow({ show: false });
  const voices = await prepareQaNarration(join(output, 'voices'), sentences.map(text => [text]));
  const measuredVoices = await Promise.all(voices.map(async (voice, index) => {
    const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: join(output, 'voice-probes', String(index + 1)), media_path: voice.path, measure_audio_duration: true });
    assert(probe.has_audio && Number(probe.audio_duration_ms) > 0);
    assert(Math.abs(Number(probe.audio_duration_ms) - voice.durationMs) <= 2, JSON.stringify({ voice, probe }));
    return { ...voice, durationMs: Number(probe.audio_duration_ms), probe };
  }));
  await save('speech-evidence.json', { provider: 'offline-Windows-SAPI', paidRequests: 0, timing: 'real PCM and independent sidecar measurement', voices: measuredVoices });
  const materialSource = join(root, 'vendor/pixelle-upstream/docs/images/1080x1080/image_minimal_framed_en.jpg');
  const originalImage = await readFile(materialSource); assert(!nativeImage.createFromBuffer(originalImage).isEmpty());
  document = createEditorialCollageDraft({ id: 'lemo-official-offline-' + randomUUID(), title: '雨水花园官方 SDK 离线整片验收', ratio: '16:9' }); document.sourceText = sentences.join('');
  document.beats = sentences.map((text, index) => {
    const shotId = 'shot-' + (index + 1), beatId = 'beat-' + (index + 1), cueId = 'cue-' + (index + 1);
    const layers = createEditorialMotionLayers({ shotId, title: text, narration: text, durationMs: 1000, ratio: document.ratio, index, motionStyle: 'cutout-slide' }).filter(layer => layer.kind === 'background'); assert.equal(layers.length, 1);
    return { id: beatId, index: index + 1, title: text, narration: text, startMs: index * 1000, durationMs: 1000,
      subtitleCues: [{ id: cueId, text, shotId, startMs: index * 1000, endMs: (index + 1) * 1000 }],
      shots: [{ id: shotId, beatId, title: text, durationMs: 1000, renderStrategy: 'deterministic-layers' as const, scenePrompt: '真实本地素材与花园运动画面', motionPrompt: '连续生长和雨滴运动', layers,
        camera: [{ atMs: 0, x: .5, y: .5, zoom: 1 }], subtitleCueIds: [cueId] }] };
  });
  document = rebuildEditorialTimeline(document); let revision = Date.parse(document.updatedAt);
  await new Promise<void>(done => fixture.listen(0, '127.0.0.1', done)); const address = fixture.address(); assert(address && typeof address !== 'string');
  const library = { upstreamRoot: join(root, 'vendor/lemo-upstream'), threeRoot: join(root, 'node_modules/three') };
  const nodeExecutable = process.env.STORYDREAM_LEMO_QA_NODE; assert(nodeExecutable && existsSync(nodeExecutable), 'Runner must provide standalone Node, not Electron');
  const official = createLemoOfficialOperations({ library, work: output, session: { nodeExecutable, workerPath: join(root, 'services/lemo-agent-worker/dist/worker.mjs'),
    provider: { protocol: 'anthropic', messagesUrl: 'http://127.0.0.1:' + address.port + '/v1/messages', apiKey: 'offline-fixture-no-secret', auth: 'bearer', model: 'offline-official-film' },
    maxOutputTokens: 16384, maxRequests: 24, maxTurns: 10, timeoutMs: 600000, requestTimeoutMs: 90000, maxEstimatedCostUsd: 1, maxRepairRounds: 2, allowLoopbackTestProvider: true } });
  const never = async (): Promise<never> => { throw new Error('Unexpected operation outside offline official-film fixture'); };
  const runtime = createVoxProductionRuntime({ ...official, identity: 'official-sdk-offline-film-v1', imageModel: 'offline-local-image-fixture', voiceModel: 'offline-Windows-SAPI',
    voice: { provider: 'volcengine', voiceId: 'offline-sapi-huihui', voiceLabel: '离线 SAPI 夹具', speed: 1 },
    preflight: async () => { await official.preflightOfficial(); }, plan: never, cutout: never, compileCode: () => { throw new Error('Official films must not use legacy compiler'); },
    image: async (input, requestId): Promise<ImageLabRecord> => {
      const imagePath = join(output, 'materials', requestId + '.jpg'); await mkdir(join(output, 'materials'), { recursive: true }); await copyFile(materialSource, imagePath);
      const copied = await readFile(imagePath); assert.equal(digest(copied), digest(originalImage)); const now = new Date().toISOString();
      mediaOperations.push({ kind: 'image', requestId, source: materialSource, imagePath, bytes: copied.length, sha256: digest(copied), paidRequests: 0 });
      return { id: requestId, prompt: input.prompt, ratio: input.ratio, style: 'none', provider: 'offline-local-fixture', imagePath, status: 'generated', errorMessage: '', resolution: '1K',
        smartMode: 'reference-edit', referenceImagePaths: [materialSource], referenceImagePath: materialSource, upstreamTaskId: null, createdAt: now, finishedAt: now };
    },
    speech: async (input, requestId) => {
      const index = sentences.findIndex(text => text === input.text.replace(/\s/g, '')); assert(index >= 0, 'Preserve approved narration');
      const voice = measuredVoices[index], now = new Date().toISOString();
      const record: VoiceLabRecord = { id: requestId, text: input.text, provider: 'volcengine', voiceId: 'offline-sapi-huihui', voiceLabel: 'Offline Windows SAPI fixture', speed: 1,
        audioPath: voice.path, status: 'generated', errorMessage: '', createdAt: now, finishedAt: now };
      mediaOperations.push({ kind: 'voice', requestId, path: voice.path, measuredDurationMs: voice.durationMs, paidRequests: 0 }); return { record, durationMs: voice.durationMs };
    },
    render: async doc => {
      const picturePath = await prepareLemoUpstreamPicture(library, output, doc); assert(picturePath);
      const scenes = buildDirectorRenderScenes(doc, undefined, { upstreamVideoPath: picturePath }); assert.equal(scenes.length, 2);
      assert(scenes.every(scene => scene.preserveSourcePicture && scene.audioClips?.some(clip => clip.trackType === 'narration') && scene.subtitleCues?.length));
      assert.equal(directorNarrationAlignment(doc, scenes).status, 'passed'); const fingerprint = directorDocumentRenderFingerprint(doc);
      const result = await renderDirectorVideo({ workDir: output, ratio: doc.ratio, projectTitle: doc.title, modeLabel: 'Official SDK offline QA', scenes, normalizeAudio: true });
      const checks = evaluateDirectorQuality(doc, scenes, result, fingerprint);
      await save('export.json', { picturePath, result, scenes, checks, narrationAlignment: directorNarrationAlignment(doc, scenes), paidRequests: 0 });
      report.qualityObservations = checks.filter(check => check.status !== 'passed');
      assert.equal(directorQualityStatus(checks), 'passed', checks.filter(isDirectorQualityBlocker).map(check => check.detail || check.label).join('; '));
      assert(result.hasAudio && result.hasVideo); assert.equal(result.subtitleLayout?.scenes.length, 2);
      const sha256 = digest(await readFile(result.outputPath)), now = new Date().toISOString(), id = randomUUID();
      return mergeDirectorRenderCompletion(doc, {
        asset: { id: 'asset-' + id, assetId: 'director-final-video', kind: 'video', localPath: result.outputPath, sha256, providerJobId: id, provider: 'local', model: 'official-sdk-offline-capture', createdAt: now, selected: true, pinned: true, renderFingerprint: fingerprint },
        job: { id, workflowKind: doc.workflowKind, nodeId: doc.id, providerId: 'local-ffmpeg', model: 'official-sdk-offline-capture', capability: 'deterministic-render', status: 'completed', inputHash: fingerprint, idempotencyKey: id, estimatedCost: 0, actualCost: 0, attempt: 1, createdAt: now, updatedAt: now, renderFingerprint: fingerprint },
        report: { id: 'report-' + id, workflowKind: doc.workflowKind, stage: 'export', providerJobId: id, renderFingerprint: fingerprint, artifactSha256: sha256, status: 'passed', checks, evidence: { subtitleLayout: result.subtitleLayout }, createdAt: now },
      }) as EditorialCollagePipelineData;
    },
    verifyVideo: async (path, duration, requireAudio) => {
      assert(requireAudio); const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: output, media_path: path, require_nonblack: true, analyze_quality: true });
      await save('final-media-probe.json', probe); assert(probe.has_video && probe.has_nonblack_video && probe.has_audio); assert(Math.abs(Number(probe.duration) * 1000 - duration) <= 100);
    },
  });
  assert.equal(runtime.nativeWorkflowVersion, 4);
  const service = new VoxProductionService({ projects: async () => [document.id], load: async () => structuredClone(document),
    save: async next => { document = parseEditorialCollagePipelineData({ ...next, updatedAt: new Date(++revision).toISOString() }); await save('document.json', document); return structuredClone(document); },
    checkpoint: async (_id, node, next) => { await mkdir(join(output, 'checkpoints'), { recursive: true }); await writeFile(join(output, 'checkpoints', node.requestId + '.json'), JSON.stringify(next, null, 2), 'utf8'); },
    recover: async (_id, node) => { const path = join(output, 'checkpoints', node.requestId + '.json'); return existsSync(path) ? parseEditorialCollagePipelineData(JSON.parse(await readFile(path, 'utf8'))) : undefined; },
  }, async () => runtime);
  console.log(JSON.stringify({ event: 'official_production_start', output, paidRequests: 0 }));
  await service.start({ id: document.id, expectedUpdatedAt: document.updatedAt, settings: { ...voxProductionSettings(), narration: true, generateImages: true,
    authoring: { mode: 'ai-code', styleId: 'brick-toy', brief: 'OFFLINE_FIXTURE_ONLY: 花园运动测试，使用宿主导入图片，严格遵守真实旁白时长和字幕时间窗；不声称真实模型或审美验收。' } } });
  await service.idle(document.id); assert(!fixtureFailure, fixtureFailure);
  assert.equal(document.productionRun?.status, 'completed', document.productionRun?.message);
  assert(document.productionRun);
  assert.equal(document.productionRun.authoringVersion, 4); assert.equal(document.stage, 'completed'); assert.equal(document.upstreamFilm?.status, 'ready'); assert.equal(requests.length, 14);
  assert.deepEqual(['official-treatment', 'official-style-frame', 'official-voice-lock', 'official-authoring'].map(id => document.productionRun!.nodes.find(n => n.id === id)?.status), ['completed', 'completed', 'completed', 'completed']);
  assert(document.upstreamFilm && document.upstreamFilm.review?.technicalPassed);
  const capturedFrames = document.upstreamFilm.review.frames; assert(capturedFrames.length >= 3);
  for (const frame of capturedFrames) {
    const size = nativeImage.createFromBuffer(await readFile(frame)).getSize();
    assert.equal(size.width, context!.width); assert.equal(size.height, context!.height);
  }
  assert.equal(mediaOperations.filter(item => item.kind === 'image').length, 2); assert.equal(mediaOperations.filter(item => item.kind === 'voice').length, 2);
  let registered = directorRenderOutputs(document).current; assert(registered?.localPath && registered.sha256); assert.equal(digest(await readFile(registered.localPath)), registered.sha256);
  assert(document.qualityReports.some(item => item.stage === 'export' && item.status === 'passed' && item.artifactSha256 === registered!.sha256));
  for (const material of context!.materials) { const bytes: Buffer = await readFile(join(document.upstreamFilm!.directory, material.path)); assert.equal(bytes.length, material.bytes); assert.equal(digest(bytes), material.sha256); }
  const authoring = document.productionRun.nodes.find(node => node.id === 'official-authoring'); assert(authoring);
  const requestsBeforeRecovery = requests.length, recovered = await official.recoverOfficialStep(structuredClone(document), authoring);
  assert.equal(recovered?.upstreamFilm?.sourceHash, document.upstreamFilm!.sourceHash); assert.equal(requests.length, requestsBeforeRecovery, 'Ready recovery must be free');
  await save('media-operations.json', mediaOperations);
  // Read the exact host receipt, never configuration or credentials.
  const filmRoot = join(output, 'lemo-official', document.productionRun.id, 'film');
  const receiptPath = join(filmRoot, 'session-receipt.json');
  const sessionEvidence = JSON.parse(await readFile(receiptPath, 'utf8')) as { receipt: JsonObject; ledger: JsonObject };
  assert.equal(sessionEvidence.receipt.sdkVersion, LEMO_AGENT_SDK_VERSION);
  assert.equal(sessionEvidence.receipt.status, 'completed');
  assert.equal(sessionEvidence.receipt.deliveryStatus, 'unverified');
  assert(typeof sessionEvidence.receipt.estimatedCostUsd === 'number' && sessionEvidence.receipt.estimatedCostUsd >= 0, 'Fresh worker must return the actual SDK estimate');
  assert(/^[a-f0-9-]{36}$/.test(String(sessionEvidence.receipt.sessionId)));
  assert.equal(sessionEvidence.ledger.blocked, false);
  const initialBudget = JSON.parse(await readFile(join(filmRoot, 'execution-budget.json'), 'utf8'));
  assert.equal(initialBudget.pendingStage, undefined); assert.equal(Object.keys(initialBudget.costs).length, 3);
  const tamperChecks: JsonObject[] = [];
  async function rejectsMissingReceipt(label: string, path: string, expected: RegExp) {
    const hidden = path + '.qa-hidden', before = requests.length; let rejection = '';
    assert(!existsSync(hidden)); await rename(path, hidden);
    try {
      await assert.rejects(async () => {
        try { return await official.recoverOfficialStep(structuredClone(document), authoring!); }
        catch (error) { rejection = error instanceof Error ? error.message : String(error); throw error; }
      }, expected);
      assert(!existsSync(path), 'Recovery must not recreate missing execution evidence: ' + label);
      assert.equal(requests.length, before, 'Missing execution evidence must not dispatch another provider request');
    } finally {
      if (existsSync(path)) await rm(path);
      await rename(hidden, path);
    }
    const restored = await official.recoverOfficialStep(structuredClone(document), authoring!);
    assert.equal(restored?.upstreamFilm?.sourceHash, document.upstreamFilm!.sourceHash);
    assert.equal(requests.length, before, 'Restored execution evidence must recover without new requests');
    tamperChecks.push({ label, path, rejected: true, rejection, missingFileNotRecreated: true, restored: true, providerRequestsBefore: before, providerRequestsAfter: requests.length });
  }
  async function rejectsTamper(label: string, path: string, mutate: (original: Buffer) => Buffer, expected: RegExp) {
    const original = await readFile(path), before = requests.length; let rejection = '';
    try {
      await writeFile(path, mutate(original));
      await assert.rejects(async () => {
        try { return await official.recoverOfficialStep(structuredClone(document), authoring!); }
        catch (error) { rejection = error instanceof Error ? error.message : String(error); throw error; }
      }, expected);
      assert.equal(requests.length, before, 'Tamper rejection must not dispatch another provider request');
    } finally { await writeFile(path, original); }
    const restored = await official.recoverOfficialStep(structuredClone(document), authoring!);
    assert.equal(restored?.upstreamFilm?.sourceHash, document.upstreamFilm!.sourceHash);
    assert.equal(requests.length, before, 'Restored ready artifacts must recover without new requests');
    tamperChecks.push({ label, path, rejected: true, rejection, restored: true, providerRequestsBefore: before, providerRequestsAfter: requests.length });
  }
  await rejectsTamper('film source', join(document.upstreamFilm.directory, 'index.html'), bytes => Buffer.concat([bytes, Buffer.from('\n<!-- tamper fixture -->\n')]), /LEMO_.*(?:ARTIFACT|SOURCE|NOT_READY)/);
  await rejectsTamper('material manifest', join(document.upstreamFilm.directory, 'MATERIALS.json'), bytes => Buffer.concat([bytes, Buffer.from('\n')]), /LEMO_OFFICIAL_MATERIAL_MANIFEST_CHANGED/);
  await rejectsTamper('captured review frame', capturedFrames[0], bytes => { const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1; return changed; }, /LEMO_OFFICIAL_REVIEW_CHANGED/);
  await rejectsTamper('finish receipt', join(filmRoot, 'finish.json'), bytes => { const value = JSON.parse(bytes.toString('utf8')); value.filmHash = '0'.repeat(64); return Buffer.from(JSON.stringify(value)); }, /LEMO_OFFICIAL_FINISH_RECEIPT_REQUIRED/);
  await rejectsMissingReceipt('request ledger', join(filmRoot, 'ledger', 'requests.jsonl'), /ENOENT/);
  await rejectsMissingReceipt('stage receipt', join(filmRoot, 'stage', 'stage.json'), /LEMO_OFFICIAL_STAGE_RECEIPT_MISSING/);
  await rejectsMissingReceipt('stage identity', join(filmRoot, 'stage', 'stage-identity.json'), /LEMO_OFFICIAL_STAGE_RECEIPT_MISSING/);
  await rejectsMissingReceipt('shared execution budget', join(filmRoot, 'execution-budget.json'), /LEMO_BUDGET_RECEIPT_MISSING/);
  await save('tamper-recovery-evidence.json', tamperChecks);
  const beforeRepair = { film: structuredClone(document.upstreamFilm), input: await readFile(join(document.upstreamFilm.directory, 'index.html')), operations: mediaOperations.length, runId: document.productionRun.id, requests: requests.length };
  await service.control({ id: document.id, runId: document.productionRun.id, action: 'repair-shot', shotId: 'shot-1', instructions: 'Add a small warm yellow circular highlight to the first garden shot. Preserve all other shots, images, voice and timing.' });
  await service.idle(document.id); assert(!fixtureFailure, fixtureFailure);
  assert.equal(document.productionRun!.status, 'completed', document.productionRun!.message);
  assert.equal(document.productionRun!.id, beforeRepair.runId); assert.equal(mediaOperations.length, beforeRepair.operations);
  assert.equal(requests.length, 18); assert.notEqual(document.upstreamFilm!.sourceHash, beforeRepair.film.sourceHash);
  assert.deepEqual(await readFile(join(beforeRepair.film.directory, 'index.html')), beforeRepair.input);
  assert.deepEqual(await readFile(join(document.upstreamFilm!.directory, 'index.html')), beforeRepair.input);
  const repair = document.productionRun!.nodes.find(n => n.id.startsWith('official-repair:')); assert(repair?.status === 'completed');
  const repairRoot = join(filmRoot, 'stages', repair.id.replace(':', '-'));
  const repairReview = JSON.parse(await readFile(join(repairRoot, 'review.json'), 'utf8'));
  assert.equal(repairReview.preservedFrames.length, 3);
  const repaired = await official.recoverOfficialStep(structuredClone(document), repair);
  assert.equal(repaired?.upstreamFilm?.sourceHash, document.upstreamFilm!.sourceHash); assert.equal(requests.length, 18);
  registered = directorRenderOutputs(document).current; assert(registered?.localPath && registered.sha256); assert.equal(digest(await readFile(registered.localPath)), registered.sha256);
  await save('local-repair-evidence.json', { selectedShot: 'shot-1', originalFilm: beforeRepair.film, repairedFilm: document.upstreamFilm, sameRunId: true, sameLedger: true,
    unchangedMediaOperationCount: mediaOperations.length, providerRequestsBefore: beforeRepair.requests, providerRequestsAfter: requests.length, review: repairReview, outputAsset: registered });
  const executionBudget = JSON.parse(await readFile(join(filmRoot, 'execution-budget.json'), 'utf8'));
  assert.equal(executionBudget.startedAt, initialBudget.startedAt); assert.equal(executionBudget.pendingStage, undefined);
  assert.equal(Object.keys(executionBudget.costs).length, 4);
  assert(Object.values(executionBudget.costs).every(cost => typeof cost === 'number' && cost >= 0));
  await save('execution-budget-evidence.json', { initial: initialBudget, final: executionBudget, sameDeadlineOrigin: true, interpretation: 'Conservative sum of real SDK invocation estimates; no real provider charge occurred in this loopback fixture.' });
  assert.equal(externalFetchAttempts, 0);
  Object.assign(report, { status: 'passed', sdkVersion: LEMO_AGENT_SDK_VERSION, receiptPath, sessionEvidence, requests, mediaOperations, durationMs: document.timeline!.durationMs, context, outputAsset: registered,
    recovery: { readyRecovered: true, providerRequestsBefore: requestsBeforeRecovery, providerRequestsAfter: requestsBeforeRecovery, tamperChecks }, executionBudget, localShotRepair: { requests: 4, unchangedSampledFrames: repairReview.preservedFrames.length, originalFilmPreserved: true }, externalFetchAttempts,
    limits: ['Local deterministic Messages fixture; no live provider acceptance.', 'Repository image and Windows SAPI are local fixtures, not paid generation.', 'Actual frame delivery verified; model aesthetic quality remains unverified.'] });
}
main().catch(error => { report.status = 'failed'; report.error = error instanceof Error ? error.stack || error.message : String(error); report.fixtureFailure = fixtureFailure; report.requests = requests; console.error(report.error); }).finally(async () => {
  await mkdir(output, { recursive: true }); await save('report.json', report); fixture.closeAllConnections(); if (fixture.listening) await new Promise<void>(done => fixture.close(() => done()));
  if (keepAlive && !keepAlive.isDestroyed()) keepAlive.destroy(); console.log(JSON.stringify({ event: 'official_production_complete', output, status: report.status, paidRequests: 0, providerRequests: requests.length })); app.exit(report.status === 'passed' ? 0 : 1);
});
