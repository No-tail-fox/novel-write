/** Bounded opt-in live acceptance: one saved-provider image + one saved-provider voice. */
import { app, BrowserWindow, nativeImage, safeStorage } from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileDatabase } from '../src/shared/storage';
import { ConfigService } from '../electron/config-service';
import { CredentialVault } from '../electron/credential-vault';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer } from '../src/shared/media-providers';
import { setGenerationAuthorization } from '../src/shared/generation-authorization';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { prepareShortVideoOutputs, renderShortVideo } from '../electron/short-video-renderer';
import { writeJianyingDraft, type WriteJianyingDraftInput } from '../src/shared/draft';
import { executeTaskOutputs, outputFingerprint } from '../src/shared/task-output-runner';
import { getTemplate } from '../src/shared/templates';
import { normalizeAppError } from '../src/shared/app-error';
import type { ImagePrompt, StoryboardScene, Task } from '../src/shared/types';

const root = resolve('.'), output = resolve(process.env.STORYDREAM_ORDINARY_QA_OUTPUT || '.artifacts/ordinary-live-output-20261102');
const ttsOnly = process.env.STORYDREAM_ORDINARY_QA_MODE === 'tts-only';
const source = process.env.STORYDREAM_QA_CONFIG_DIR;
if (process.env.STORYDREAM_ORDINARY_QA_LIVE !== '1' || !source) throw new Error('LIVE_QA_EXPLICIT_OPT_IN_REQUIRED');
app.setName('storydream'); mkdirSync(join(output, 'profile'), { recursive: true });
copyFileSync(join(source, '..', 'Local State'), join(output, 'profile', 'Local State'));
app.setPath('userData', join(output, 'profile')); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); setDefaultPythonRuntimeAppRoot(root);
const counts = { image: 0, tts: 0, generationAuthorizations: 0 };
const network: Array<{ kind: string; endpointOrigin: string; httpStatus?: number; elapsedMs?: number }> = [];
const report: Record<string, unknown> = { status: 'preparing', startedAt: new Date().toISOString(), limits: { maxImageRequests: ttsOnly ? 0 : 1, maxTtsRequests: 1, automaticRetries: 0 }, counts, network,
  configuration: 'Current saved runtime configuration, read through safeStorage using an isolated Local State copy; original configuration and vault remain read-only.',
  scope: ttsOnly ? 'Independent real TTS only; no image generation and no full-pipeline acceptance.' : 'Real image + real narration + ordinary short-video MP4 and exported draft files. Script text is supplied; no LLM planning, Pexels, Lemo, or Jianying application launch.' };
let stage = 'configuration', configDb: FileDatabase | undefined, taskDb: FileDatabase | undefined;
const save = () => writeFile(join(output, 'report.json'), JSON.stringify({ ...report, stage, counts, network, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
app.whenReady().then(async () => {
  const keep = new BrowserWindow({ show: false });
  const fetchOriginal = globalThis.fetch;
  try {
    await mkdir(output, { recursive: true });
    const configDirectory = join(output, 'config-snapshot'); await mkdir(configDirectory, { recursive: true });
    await copyFile(join(source!, 'data.db'), join(configDirectory, 'data.db'));
    for (const name of ['config-secrets.v1.migrated', 'config-model-profile-secrets.v1.migrated']) await copyFile(join(source!, name), join(configDirectory, name));
    configDb = await FileDatabase.open(join(configDirectory, 'data.db'));
    const vault = new CredentialVault(join(source!, 'secrets.v1.json'), safeStorage);
    const configService = new ConfigService({ database: configDb, dataDir: configDirectory, vault: { load: () => vault.load(), save: async () => { throw new Error('QA_CONFIG_WRITE_DENIED'); } } });
    const config = structuredClone(await configService.getRuntimeConfig());
    await configDb.close(); configDb = undefined;
    if (!ttsOnly) {
      assert.equal(config.imageProvider, 'gpt_image', 'Expected the current saved GPT image provider');
      assert(config.gptImage.apiKey && config.gptImage.baseUrl && config.gptImage.model, 'Saved image provider must be complete');
    }
    assert.equal(config.tts.provider, 'volcengine', 'Expected the current saved Volcengine voice provider');
    assert(config.tts.volcengine.apiKey, 'Saved V3 voice credential is required');
    // Only request-specific cost/shape controls change in this isolated in-memory copy.
    config.gptImage.resolution = '1K'; config.gptImage.quality = 'low'; config.gptImage.ratio = '9:16';
    const imageOrigin = new URL(config.gptImage.baseUrl).origin;
    const ttsOrigin = new URL(config.tts.volcengine.endpoint || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional').origin;
    report.providers = { ...(!ttsOnly ? { image: { provider: config.imageProvider, model: config.gptImage.model, origin: imageOrigin, resolution: '1K', quality: 'low', ratio: '9:16' } } : {}), tts: { provider: 'volcengine', apiVersion: 'v3', origin: ttsOrigin } };
    setGenerationAuthorization(async () => {
      assert(process.env.STORYDREAM_ORDINARY_QA_LIVE === '1', 'Live authorization was withdrawn');
      counts.generationAuthorizations++; assert(counts.generationAuthorizations <= (ttsOnly ? 1 : 2), 'Generation authorization budget exhausted');
    });
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') {
        const kind = url.origin === imageOrigin && url.pathname.endsWith('/images/generations') ? 'image'
          : url.origin === ttsOrigin && url.pathname.includes('/tts/') ? 'tts' : null;
        assert(kind, 'Unexpected POST blocked by live QA request budget');
        assert(!(ttsOnly && kind === 'image'), 'Independent TTS QA forbids image generation');
        assert(counts[kind] < 1, 'Duplicate submission/retry blocked by live QA request budget');
        counts[kind]++;
        const event = { kind, endpointOrigin: url.origin, httpStatus: undefined as number | undefined, elapsedMs: undefined as number | undefined }; network.push(event);
        const started = Date.now(); await save();
        try { const response = await fetchOriginal(input, init); event.httpStatus = response.status; return response; }
        finally { event.elapsedMs = Date.now() - started; await save(); }
      }
      assert(method === 'GET' || method === 'HEAD', 'Unexpected network method blocked');
      return fetchOriginal(input, init);
    };
    // This exclusive receipt forbids rerunning a live job after an uncertain request.
    await writeFile(join(output, 'live-started.json'), JSON.stringify({ startedAt: new Date().toISOString(), imageLimit: ttsOnly ? 0 : 1, ttsLimit: 1 }), { encoding: 'utf8', flag: 'wx' });
    taskDb = await FileDatabase.open(join(output, 'acceptance.sqlite'));
    const narration = ttsOnly ? '你好，世界。' : '清晨的阳光洒进庭院，一杯热茶开启新的一天。';
    const prompt = 'A calm sunlit Chinese courtyard at dawn, a simple ceramic cup of warm tea on a wooden table in the foreground, soft natural light and quiet greenery, editorial photographic composition, no people, no text, no logos, vertical 9:16 frame.';
    const task: Task = await taskDb.createTask({ inputText: narration, ratio: '9:16', imageQuality: 'low', ttsProvider: 'volcengine', speaker: config.tts.volcengine.speaker || config.tts.speaker, outputTargets: ['mp4', 'jianying-draft'] });
    const scenes: StoryboardScene[] = [{ id: 1, cap: narration, descPrompt: prompt, durationMs: 5000 }];
    const prompts: ImagePrompt[] = [{ sceneId: 1, prompt, cap: narration, negativePrompt: 'text, logos, people', style: 'photo-real', ratio: '9:16', characterProfile: '' }];
    if (ttsOnly) {
      stage = 'voice-generation'; report.status = 'running'; await save();
      const assets = await createConfiguredNarrationSynthesizer(config, output)(scenes, task, AbortSignal.timeout(180000));
      assert.equal(assets.length, 1);
      const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: output, media_path: assets[0].path });
      assert(probe.has_audio && probe.duration && probe.duration > 0 && probe.duration < 15, 'Independent TTS must be bounded audio');
      const execute = promisify(execFile), python = join(root, 'vendor/python/python.exe');
      const ffmpeg = (await execute(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true })).stdout.trim();
      const wav = join(output, 'decoded-voice.wav');
      await execute(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', assets[0].path, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wav], { windowsHide: true, timeout: 30000 });
      const decoded = JSON.parse((await execute(python, ['-c', 'import wave,array,math,json,sys; w=wave.open(sys.argv[1],"rb"); samples=array.array("h",w.readframes(w.getnframes())); print(json.dumps({"duration":w.getnframes()/w.getframerate(),"sampleRate":w.getframerate(),"channels":w.getnchannels(),"rms":math.sqrt(sum(x*x for x in samples)/len(samples)),"peak":max(abs(x) for x in samples)}))', wav], { windowsHide: true })).stdout);
      assert(decoded.rms > 1 && decoded.peak > 1, 'Decoded speech must not be digital silence');
      assert(Math.abs(decoded.duration - probe.duration) < 0.2); assert.equal(counts.image, 0); assert.equal(counts.tts, 1);
      report.voice = { path: assets[0].path, bytes: (await stat(assets[0].path)).size, sha256: createHash('sha256').update(await readFile(assets[0].path)).digest('hex'), wav, decoded };
      report.probe = probe; report.fullPipelineVerified = false; report.status = 'passed'; stage = 'complete'; await save();
      await taskDb.close(); taskDb = undefined; globalThis.fetch = fetchOriginal; keep.destroy(); app.exit(0); return;
    }
    stage = 'image-generation'; report.status = 'running'; await save();
    const images = await createConfiguredImageGenerator(config, output)(scenes, prompts, task, AbortSignal.timeout(config.gptImage.timeoutMs ?? 300000));
    assert.equal(images.length, 1); assert(!nativeImage.createFromPath(images[0].path).isEmpty(), 'Generated image must decode');
    report.image = { path: images[0].path, bytes: (await stat(images[0].path)).size, dimensions: nativeImage.createFromPath(images[0].path).getSize(), sha256: createHash('sha256').update(await readFile(images[0].path)).digest('hex') };
    stage = 'voice-generation'; await save();
    const voice = await createConfiguredNarrationSynthesizer(config, output)(scenes, task, AbortSignal.timeout(180000));
    assert.equal(voice.length, 1);
    const voiceProbe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: output, media_path: voice[0].path });
    assert(voiceProbe.has_audio && voiceProbe.duration && voiceProbe.duration > 0.5 && voiceProbe.duration < 30, 'Voice must be a bounded decoded audio file');
    scenes[0].durationMs = Math.round(voiceProbe.duration * 1000);
    voice[0].captionCues = [{ text: narration, startSec: 0, endSec: voiceProbe.duration, source: 'tts', confidence: 1 }];
    report.voice = { path: voice[0].path, bytes: (await stat(voice[0].path)).size, duration: voiceProbe.duration, sha256: createHash('sha256').update(await readFile(voice[0].path)).digest('hex') };
    stage = 'dual-output'; await save();
    const base: WriteJianyingDraftInput = { workDir: output, draftRootDir: join(output, 'drafts'), title: 'Ordinary-live-acceptance', ratio: '9:16', template: structuredClone(getTemplate('default-portrait-9-16')),
      cover: { title: '清晨一杯茶', subtitle: [], summary: '', tags: [], comments: [] }, reviewedText: narration, rewrittenCopy: narration, scenes,
      imagePrompts: prompts, generatedImages: images, generatedVideos: [], narrationAudio: voice, bgm: null };
    const prepared = await prepareShortVideoOutputs(base);
    const fingerprint = await outputFingerprint(prepared, [...images, ...voice].map(asset => asset.path));
    const outputs = await executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], fingerprint,
      produce: target => target === 'mp4' ? renderShortVideo(prepared) : writeJianyingDraft(prepared).then(result => result.draftDir),
      onUpdate: async deliverables => { await taskDb!.updateTask(task.id, { deliverables }); } });
    const mp4 = outputs.mp4?.path, draftDir = outputs['jianying-draft']?.path; assert(mp4 && draftDir);
    const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: output, media_path: mp4, require_nonblack: true });
    assert(probe.has_audio && probe.has_video && probe.has_nonblack_video); assert.equal(probe.width, 1080); assert.equal(probe.height, 1920);
    assert(Math.abs(probe.duration! - voiceProbe.duration) <= 0.2, 'Final video must follow actual voice duration');
    const draft = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8'));
    assert(Math.abs(draft.duration / 1000000 - probe.duration!) <= 0.2, 'Draft and MP4 duration must agree');
    const execute = promisify(execFile);
    const ffmpeg = (await execute(join(root, 'vendor/python/python.exe'), ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true })).stdout.trim();
    await execute(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', mp4, '-frames:v', '1', join(output, 'frame.png')], { windowsHide: true, timeout: 30000 });
    await taskDb.close(); taskDb = undefined;
    const reopened = await FileDatabase.open(join(output, 'acceptance.sqlite')); const saved = await reopened.getTaskDetail(task.id); await reopened.close();
    assert(saved?.deliverables?.mp4?.status === 'completed' && saved.deliverables['jianying-draft']?.status === 'completed');
    assert.equal(counts.image, 1); assert.equal(counts.tts, 1);
    report.outputs = outputs; report.probe = probe; report.projectReopened = true; report.jianyingApplicationVerified = false;
    report.status = 'passed'; stage = 'complete'; await save();
    globalThis.fetch = fetchOriginal; keep.destroy(); app.exit(0);
  } catch (error) {
    globalThis.fetch = fetchOriginal;
    const normalized = normalizeAppError(error), httpStatus = network.at(-1)?.httpStatus;
    report.status = 'failed'; report.failure = { stage, name: error instanceof Error ? error.name : 'UnknownError', code: normalized.code, diagnosticId: normalized.diagnosticId,
      summary: httpStatus && httpStatus >= 400 ? 'Provider rejected the request with HTTP ' + httpStatus + '; no automatic retry.' : 'Acceptance did not complete at this stage; no automatic retry.',
      sensitiveDataRecorded: false };
    await save(); await configDb?.close(); await taskDb?.close(); keep.destroy(); app.exit(1);
  }
});
