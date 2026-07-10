import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { AppConfig, ImagePrompt, StoryboardScene, Task, VoiceLabGenerateInput, VoiceLabRecord } from './types';
import type { SceneAsset } from './draft';
import { fetchWithTimeout } from './http';
import { readJsonBounded, readTextBounded } from './network-policy';
import { buildOpenAiImageGenerationBody, normalizeOpenAiImageBaseUrl } from './openai-image';
import { buildOpenAiImageEditFormData } from './openai-image-edit';
import { isArkModelApiKey, normalizeVolcengineV3Speaker, VOLCENGINE_TTS_ARK_KEY_MESSAGE } from './volcengine-tts';
import { defaultPodcastSpeakersForProvider, normalizeRuntimeTtsProvider, type RuntimeTtsProvider, volcengineResourceIdForTaskSpeaker } from './tts-voices';
import { splitPodcastDialogue, type PodcastDialogueTurn } from './podcast-dialogue';

type ImageGenerator = (scenes: StoryboardScene[], prompts: ImagePrompt[], task: Task, signal?: AbortSignal) => Promise<SceneAsset[]>;
type NarrationSynthesizer = (scenes: StoryboardScene[], task: Task, signal?: AbortSignal) => Promise<SceneAsset[]>;
const PROVIDER_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;

interface TtsTurn {
  scene: StoryboardScene;
  text: string;
  voiceId: string;
  speaker?: 'A' | 'B';
  turnIndex?: number;
}

export function createConfiguredImageGenerator(config: AppConfig, workDir: string): ImageGenerator {
  return async (scenes, prompts, task, signal) => {
    if (config.imageProvider === 'mock') {
      throw new Error('Image provider is set to mock; real image assets are required.');
    }
    if (config.imageProvider === 'jimeng') {
      return generateJimengImages({
        scenes,
        prompts,
        task,
        workDir,
        accessKeyId: config.jimeng.accessKeyId ?? '',
        secretAccessKey: config.jimeng.secretAccessKey ?? '',
        reqKey: config.jimeng.reqKey || config.jimeng.model,
        endpoint: config.jimeng.endpoint || 'https://visual.volcengineapi.com',
        region: config.jimeng.region || 'cn-north-1',
        service: config.jimeng.service || 'cv',
        resolution: config.jimeng.resolution,
        pollIntervalMs: config.jimeng.pollIntervalMs ?? 2000,
        timeoutMs: config.jimeng.timeoutMs ?? 120000,
        signal,
      });
    }
    if (config.imageProvider === 'custom') {
      return generateOpenAiCompatibleImages({
        scenes,
        prompts,
        task,
        workDir,
        baseUrl: config.customImage.baseUrl,
        apiKey: config.customImage.apiKey,
        model: config.customImage.model,
        ratio: config.customImage.ratio || task.ratio,
        resolution: config.customImage.resolution ?? '2K',
        ratioMappingJson: config.customImage.ratioMappingJson,
        timeoutMs: config.customImage.timeoutMs ?? 180_000,
        asyncMode: config.customImage.asyncMode,
        pollIntervalMs: config.customImage.pollIntervalMs ?? 2000,
        signal,
      });
    }
    return generateOpenAiCompatibleImages({
      scenes,
      prompts,
      task,
      workDir,
      baseUrl: config.gptImage.baseUrl || config.image.baseUrl,
      apiKey: config.gptImage.apiKey || config.image.apiKey,
      model: config.gptImage.model || config.image.model,
      ratio: config.gptImage.ratio || config.image.ratio || task.ratio,
      resolution: config.gptImage.resolution ?? config.image.resolution ?? '2K',
      ratioMappingJson: undefined,
      timeoutMs: config.gptImage.timeoutMs ?? config.image.timeoutMs ?? 180_000,
      asyncMode: false,
      pollIntervalMs: 2000,
      signal,
    });
  };
}

export function getConfiguredImageConcurrency(config: AppConfig): number {
  const value =
    config.imageProvider === 'jimeng'
      ? config.jimeng.concurrency
      : config.imageProvider === 'custom'
        ? config.customImage.concurrency
        : config.gptImage.concurrency ?? config.image.concurrency;
  return Math.max(1, Math.min(6, Math.floor(Number.isFinite(value) ? value : 1)));
}

export function createConfiguredNarrationSynthesizer(config: AppConfig, workDir: string): NarrationSynthesizer {
  return async (scenes, task, signal) => {
    const taskProvider = task.ttsProvider && task.ttsProvider !== 'mock' ? normalizeRuntimeTtsProvider(task.ttsProvider) : null;
    const provider = taskProvider ?? normalizeRuntimeTtsProvider(config.tts.provider);
    const providerProfile = config.ttsProfiles.find((profile) => profile.provider === provider && profile.enabled) ?? config.ttsProfiles.find((profile) => profile.provider === provider);
    const profileVolcengine = providerProfile?.volcengine;
    const profileMinimax = providerProfile?.minimax;
    const volcengine = {
      ...config.tts.volcengine,
      apiKey: config.tts.volcengine.apiKey || profileVolcengine?.apiKey,
      accessKeyId: config.tts.volcengine.accessKeyId || profileVolcengine?.accessKeyId,
      secretAccessKey: config.tts.volcengine.secretAccessKey || profileVolcengine?.secretAccessKey,
      appId: config.tts.volcengine.appId || profileVolcengine?.appId || providerProfile?.appId,
      accessKey: config.tts.volcengine.accessKey || profileVolcengine?.accessKey || providerProfile?.accessKey,
      speaker: config.tts.volcengine.speaker || profileVolcengine?.speaker || providerProfile?.speaker,
      cluster: config.tts.volcengine.cluster || profileVolcengine?.cluster,
      endpoint: config.tts.volcengine.endpoint || profileVolcengine?.endpoint,
      resourceId: config.tts.volcengine.resourceId || profileVolcengine?.resourceId,
    };
    const minimax = {
      ...config.tts.minimax,
      apiKey: config.tts.minimax.apiKey || profileMinimax?.apiKey,
      model: config.tts.minimax.model || profileMinimax?.model,
      voiceId: config.tts.minimax.voiceId || profileMinimax?.voiceId,
    };
    if (config.tts.provider === 'mock' && !taskProvider) {
      throw new Error('TTS provider is set to mock; real narration audio is required.');
    }
    if (provider === 'volcengine') {
      const speaker = taskProvider ? task.speaker : volcengine.speaker || providerProfile?.speaker || config.tts.speaker;
      return synthesizeVolcengineNarration({
        scenes,
        task,
        workDir,
        apiKey: volcengine.apiKey ?? '',
        resourceId: taskProvider ? volcengineResourceIdForTaskSpeaker(speaker, volcengine.resourceId || 'seed-tts-2.0') : volcengine.resourceId || 'seed-tts-2.0',
        appId: volcengine.appId || providerProfile?.appId || config.tts.appId,
        accessKey: volcengine.accessKey || providerProfile?.accessKey || config.tts.accessKey,
        speaker,
        cluster: volcengine.cluster || 'volcano_tts',
        endpoint: volcengine.endpoint || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
        signal,
      });
    }
    return synthesizeMiniMaxNarration({
      scenes,
      task,
      workDir,
      apiKey: minimax.apiKey ?? '',
      model: minimax.model ?? '',
      voiceId: taskProvider ? task.speaker : minimax.voiceId ?? '',
      signal,
    });
  };
}

export async function generateConfiguredVoicePreview(config: AppConfig, workDir: string, input: VoiceLabGenerateInput, signal?: AbortSignal): Promise<VoiceLabRecord> {
  const now = input.createdAt ?? new Date().toISOString();
  const task = {
    id: input.id ?? `voice-lab-${randomUUID()}`,
    title: 'Voice Lab Preview',
    ratio: '9:16',
    speaker: input.voiceId,
    ttsProvider: input.provider,
    ttsSpeed: input.speed,
  } as Task;
  const scene: StoryboardScene = {
    id: 1,
    cap: input.text,
    descPrompt: '',
    durationMs: 1200,
  };
  const synthesize = createConfiguredNarrationSynthesizer(config, workDir);
  const assets = await synthesize([scene], task, signal);
  const audioPath = assets[0]?.path ?? '';
  if (!audioPath) {
    throw new Error('Voice lab preview did not produce audio.');
  }
  return {
    id: input.id ?? randomUUID(),
    text: input.text,
    provider: input.provider,
    voiceId: input.voiceId,
    voiceLabel: input.voiceLabel ?? input.voiceId,
    speed: input.speed,
    audioPath,
    status: 'generated',
    errorMessage: '',
    createdAt: now,
    finishedAt: new Date().toISOString(),
  };
}

async function generateJimengImages(input: {
  scenes: StoryboardScene[];
  prompts: ImagePrompt[];
  task: Task;
  workDir: string;
  accessKeyId: string;
  secretAccessKey: string;
  reqKey: string;
  endpoint: string;
  region: string;
  service: string;
  resolution: '1K' | '2K' | '4K';
  pollIntervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<SceneAsset[]> {
  if (!input.accessKeyId || !input.secretAccessKey) {
    throw new Error('Jimeng AccessKey ID and SecretAccessKey are required for real image generation.');
  }
  const outputDir = join(input.workDir, 'provider-images');
  await mkdir(outputDir, { recursive: true });
  const assets: SceneAsset[] = [];

  for (const scene of input.scenes) {
    const prompt = input.prompts.find((item) => item.sceneId === scene.id)?.prompt ?? scene.descPrompt;
    const size = resolveJimengSize(input.task.ratio, input.resolution);
    throwIfAborted(input.signal);
    const taskId = await submitJimengTask({ ...input, prompt, size });
    const bytes = await pollJimengResult({ ...input, taskId });
    const path = join(outputDir, `${String(scene.id).padStart(3, '0')}.png`);
    await writeFile(path, bytes);
    assets.push({ sceneId: scene.id, path });
  }
  return assets;
}

async function submitJimengTask(input: {
  prompt: string;
  size: string;
  reqKey: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  signal?: AbortSignal;
}): Promise<string> {
  const [width, height] = input.size.split('x').map(Number);
  const result = await signedVolcenginePost<{
    code?: number;
    message?: string;
    data?: { task_id?: string };
  }>({
    endpoint: input.endpoint,
    action: 'CVSync2AsyncSubmitTask',
    body: { req_key: input.reqKey, prompt: input.prompt, width, height },
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    region: input.region,
    service: input.service,
    signal: input.signal,
  });
  if (result.code !== 10000 || !result.data?.task_id) {
    throw new Error(`Jimeng submit failed: ${result.message ?? 'missing task id'}`);
  }
  return result.data.task_id;
}

async function pollJimengResult(input: {
  taskId: string;
  reqKey: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  pollIntervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= input.timeoutMs) {
    const result = await signedVolcenginePost<{
      code?: number;
      message?: string;
      data?: { status?: string; image_urls?: string[]; binary_data_base64?: string[] };
    }>({
      endpoint: input.endpoint,
      action: 'CVSync2AsyncGetResult',
      body: { req_key: input.reqKey, task_id: input.taskId },
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      region: input.region,
      service: input.service,
      signal: input.signal,
    });
    if (result.code !== 10000 || !result.data) {
      throw new Error(`Jimeng poll failed: ${result.message ?? 'empty result'}`);
    }
    if (result.data.binary_data_base64?.[0]) {
      return Buffer.from(result.data.binary_data_base64[0], 'base64');
    }
    if (result.data.image_urls?.[0]) {
      const response = await fetchWithTimeout(result.data.image_urls[0], {
        purpose: 'public-research',
        timeoutMs: 60_000,
        timeoutLabel: 'Jimeng image download',
        maxBytes: PROVIDER_RESPONSE_MAX_BYTES,
        signal: input.signal,
      });
      if (!response.ok) throw new Error(`Failed to download Jimeng image (${response.status}).`);
      return Buffer.from(await response.arrayBuffer());
    }
    if (result.data.status === 'fail') {
      throw new Error(`Jimeng task failed: ${result.message ?? input.taskId}`);
    }
    await delay(input.pollIntervalMs, input.signal);
  }
  throw new Error('Jimeng image generation timed out.');
}

async function generateOpenAiCompatibleImages(input: {
  scenes: StoryboardScene[];
  prompts: ImagePrompt[];
  task: Task;
  workDir: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  ratio: string;
  resolution: '1K' | '2K' | '4K';
  ratioMappingJson?: string;
  timeoutMs: number;
  asyncMode: boolean;
  pollIntervalMs: number;
  signal?: AbortSignal;
}): Promise<SceneAsset[]> {
  if (!input.apiKey) {
    throw new Error('Image provider API key is missing; cannot generate real image assets.');
  }
  const baseUrl = normalizeOpenAiImageBaseUrl(input.baseUrl || 'https://api.openai.com');
  const outputDir = join(input.workDir, 'provider-images');
  await mkdir(outputDir, { recursive: true });

  const assets: SceneAsset[] = [];
  for (const scene of input.scenes) {
    const promptItem = input.prompts.find((item) => item.sceneId === scene.id);
    const prompt = promptItem?.prompt ?? scene.descPrompt;
    const referenceImagePaths = promptItem?.referenceImagePaths ?? [];
    const body = referenceImagePaths.length
      ? await generateOpenAiCompatibleImageEdit({ ...input, baseUrl, prompt, referenceImagePaths })
      : input.asyncMode
      ? await generateOpenAiCompatibleImageAsync({ ...input, baseUrl, prompt })
      : await generateOpenAiCompatibleImageSync({ ...input, baseUrl, prompt });
    const bytes = await extractImageBytes(body, input.signal);
    const path = join(outputDir, `${String(scene.id).padStart(3, '0')}.png`);
    await writeFile(path, bytes);
    assets.push({ sceneId: scene.id, path });
  }
  return assets;
}

async function generateOpenAiCompatibleImageSync(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  ratio: string;
  resolution: '1K' | '2K' | '4K';
  ratioMappingJson?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ data?: Array<{ b64_json?: string; url?: string }> }> {
  const response = await fetchWithTimeout(`${input.baseUrl}/images/generations`, {
    method: 'POST',
    timeoutMs: input.timeoutMs,
    timeoutLabel: 'Image provider request',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(buildOpenAiImageGenerationBody({
      model: input.model,
      prompt: input.prompt,
      ratio: input.ratio,
      resolution: input.resolution,
      ratioMappingJson: input.ratioMappingJson,
    })),
  });
  if (!response.ok) {
    throw new Error(`Image provider API error (${response.status}): ${await readTextBounded(response, PROVIDER_RESPONSE_MAX_BYTES)}`);
  }
  return readJsonBounded<{ data?: Array<{ b64_json?: string; url?: string }> }>(response, PROVIDER_RESPONSE_MAX_BYTES);
}

async function generateOpenAiCompatibleImageEdit(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  ratio: string;
  resolution: '1K' | '2K' | '4K';
  referenceImagePaths: string[];
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ data?: Array<{ b64_json?: string; url?: string }> }> {
  const form = await buildOpenAiImageEditFormData({
    model: input.model,
    prompt: input.prompt,
    ratio: input.ratio,
    resolution: input.resolution,
    referenceImagePaths: input.referenceImagePaths,
  });
  const response = await fetchWithTimeout(`${input.baseUrl}/images/edits`, {
    method: 'POST',
    timeoutMs: input.timeoutMs,
    timeoutLabel: 'Image provider edit request',
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Image provider edit API error (${response.status}): ${await readTextBounded(response, PROVIDER_RESPONSE_MAX_BYTES)}`);
  }
  return readJsonBounded<{ data?: Array<{ b64_json?: string; url?: string }> }>(response, PROVIDER_RESPONSE_MAX_BYTES);
}

async function generateOpenAiCompatibleImageAsync(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  ratio: string;
  resolution: '1K' | '2K' | '4K';
  ratioMappingJson?: string;
  timeoutMs: number;
  pollIntervalMs: number;
  signal?: AbortSignal;
}): Promise<{ data?: Array<{ b64_json?: string; url?: string }> }> {
  const response = await fetchWithTimeout(`${input.baseUrl}/images/generations?async=true`, {
    method: 'POST',
    timeoutMs: input.timeoutMs,
    timeoutLabel: 'Image provider async submit',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(buildOpenAiImageGenerationBody({
      model: input.model,
      prompt: input.prompt,
      ratio: input.ratio,
      resolution: input.resolution,
      ratioMappingJson: input.ratioMappingJson,
    })),
  });
  if (!response.ok) {
    throw new Error(`Image provider async submit error (${response.status}): ${await readTextBounded(response, PROVIDER_RESPONSE_MAX_BYTES)}`);
  }
  const submitBody = await readJsonBounded<OpenAiAsyncImageSubmitResponse>(response, PROVIDER_RESPONSE_MAX_BYTES);
  const taskId = resolveOpenAiAsyncTaskId(submitBody);
  if (!taskId) {
    throw new Error('Image provider async submit response did not include a task id.');
  }
  return pollOpenAiCompatibleImageTask({ ...input, taskId });
}

type OpenAiAsyncImageSubmitResponse = {
  id?: string;
  task_id?: string;
  taskId?: string;
  data?: { id?: string; task_id?: string; taskId?: string };
};

type OpenAiAsyncImagePollResponse = {
  status?: string;
  state?: string;
  error?: string | { message?: string };
  data?: Array<{ b64_json?: string; url?: string }>;
  result?: { data?: Array<{ b64_json?: string; url?: string }> };
  output?: Array<{ b64_json?: string; url?: string }>;
};

async function pollOpenAiCompatibleImageTask(input: {
  baseUrl: string;
  apiKey: string;
  taskId: string;
  timeoutMs: number;
  pollIntervalMs: number;
  signal?: AbortSignal;
}): Promise<{ data?: Array<{ b64_json?: string; url?: string }> }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= input.timeoutMs) {
    const response = await fetchWithTimeout(`${input.baseUrl}/images/generations/${encodeURIComponent(input.taskId)}`, {
      method: 'GET',
      timeoutMs: input.timeoutMs,
      timeoutLabel: 'Image provider async poll',
      signal: input.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Image provider async poll error (${response.status}): ${await readTextBounded(response, PROVIDER_RESPONSE_MAX_BYTES)}`);
    }
    const body = await readJsonBounded<OpenAiAsyncImagePollResponse>(response, PROVIDER_RESPONSE_MAX_BYTES);
    const data = body.data ?? body.result?.data ?? body.output;
    if (data?.length) {
      return { data };
    }
    const status = String(body.status ?? body.state ?? '').toLowerCase();
    if (['failed', 'fail', 'error', 'cancelled', 'canceled'].includes(status)) {
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      throw new Error(`Image provider async task failed: ${message ?? input.taskId}`);
    }
    await delay(input.pollIntervalMs, input.signal);
  }
  throw new Error('Image provider async task timed out.');
}

function resolveOpenAiAsyncTaskId(body: OpenAiAsyncImageSubmitResponse): string {
  return body.id ?? body.task_id ?? body.taskId ?? body.data?.id ?? body.data?.task_id ?? body.data?.taskId ?? '';
}

async function synthesizeMiniMaxNarration(input: {
  scenes: StoryboardScene[];
  task: Task;
  workDir: string;
  apiKey: string;
  model: string;
  voiceId: string;
  signal?: AbortSignal;
}): Promise<SceneAsset[]> {
  if (!input.apiKey) {
    throw new Error('MiniMax TTS API key is missing; cannot generate real narration audio.');
  }
  const outputDir = join(input.workDir, 'provider-audio');
  await mkdir(outputDir, { recursive: true });
  const assets: SceneAsset[] = [];

  for (const scene of input.scenes) {
    const turns = narrationTurnsForScene(scene, input.task, input.voiceId, 'minimax');
    for (const turn of turns) {
    const response = await fetchWithTimeout('https://api.minimaxi.com/v1/t2a_v2', {
      method: 'POST',
      timeoutMs: 180_000,
      timeoutLabel: 'MiniMax TTS request',
      signal: input.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        text: turn.text,
        stream: false,
        voice_setting: {
          voice_id: turn.voiceId,
          speed: input.task.ttsSpeed,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`MiniMax TTS API error (${response.status}): ${await readTextBounded(response, PROVIDER_RESPONSE_MAX_BYTES)}`);
    }
    const body = await readJsonBounded<{
      data?: { audio?: string };
      audio_file?: string;
      base_resp?: { status_code?: number; status_msg?: string };
    }>(response, PROVIDER_RESPONSE_MAX_BYTES);
    if (body.base_resp?.status_code && body.base_resp.status_code !== 0) {
      throw new Error(`MiniMax TTS API error: ${body.base_resp.status_msg ?? body.base_resp.status_code}`);
    }
    const audio = body.data?.audio ?? body.audio_file;
    if (!audio) {
      throw new Error('MiniMax TTS response did not include audio data.');
    }
    const bytes = decodeAudioPayload(audio);
      const path = join(outputDir, audioFileName(scene.id, turn, 'mp3'));
    await writeFile(path, bytes);
      assets.push(sceneAssetForTurn(scene.id, path, turn));
    }
  }
  return assets;
}

async function synthesizeVolcengineNarration(input: {
  scenes: StoryboardScene[];
  task: Task;
  workDir: string;
  apiKey?: string;
  resourceId: string;
  appId: string;
  accessKey: string;
  speaker: string;
  cluster: string;
  endpoint: string;
  signal?: AbortSignal;
}): Promise<SceneAsset[]> {
  if (input.apiKey) {
    return synthesizeVolcengineV3Narration(input);
  }
  if (!input.appId || !input.accessKey) {
    throw new Error('Volcengine TTS App ID and access token are required for real narration audio.');
  }
  const outputDir = join(input.workDir, 'provider-audio');
  await mkdir(outputDir, { recursive: true });
  const assets: SceneAsset[] = [];
  const endpoint = input.endpoint.includes('/api/v3/') ? 'https://openspeech.bytedance.com/api/v1/tts' : input.endpoint;

  for (const scene of input.scenes) {
    const turns = narrationTurnsForScene(scene, input.task, input.speaker, 'volcengine');
    for (const turn of turns) {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      timeoutMs: 180_000,
      timeoutLabel: 'Volcengine TTS request',
      signal: input.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.accessKey}`,
      },
      body: JSON.stringify({
        app: { appid: input.appId, token: input.accessKey, cluster: input.cluster },
        user: { uid: input.task.id },
        audio: {
          voice_type: turn.voiceId,
          encoding: 'mp3',
          speed_ratio: input.task.ttsSpeed,
        },
        request: {
          reqid: `${input.task.id}-${scene.id}-${turn.turnIndex ?? 1}`,
          text: turn.text,
          operation: 'query',
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Volcengine TTS API error (${response.status}): ${await readTextBounded(response, PROVIDER_RESPONSE_MAX_BYTES)}`);
    }
    const body = await readJsonBounded<{ code?: number; message?: string; data?: string }>(response, PROVIDER_RESPONSE_MAX_BYTES);
    if (body.code !== 3000 || !body.data) {
      throw new Error(`Volcengine TTS API error: ${body.message ?? body.code ?? 'missing audio data'}`);
    }
      const path = join(outputDir, audioFileName(scene.id, turn, 'mp3'));
    await writeFile(path, Buffer.from(body.data, 'base64'));
      assets.push(sceneAssetForTurn(scene.id, path, turn));
    }
  }
  return assets;
}

async function synthesizeVolcengineV3Narration(input: {
  scenes: StoryboardScene[];
  task: Task;
  workDir: string;
  apiKey?: string;
  resourceId: string;
  speaker: string;
  endpoint: string;
  signal?: AbortSignal;
}): Promise<SceneAsset[]> {
  if (!input.apiKey) {
    throw new Error('Volcengine TTS API key is required for V3 narration audio.');
  }
  if (isArkModelApiKey(input.apiKey)) {
    throw new Error(VOLCENGINE_TTS_ARK_KEY_MESSAGE);
  }
  const outputDir = join(input.workDir, 'provider-audio');
  await mkdir(outputDir, { recursive: true });
  const assets: SceneAsset[] = [];

  for (const scene of input.scenes) {
    const turns = narrationTurnsForScene(scene, input.task, input.speaker, 'volcengine');
    for (const turn of turns) {
    const requestId = randomUUID();
      const speaker = normalizeVolcengineV3Speaker(turn.voiceId);
    const response = await fetchWithTimeout(input.endpoint || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST',
      timeoutMs: 180_000,
      timeoutLabel: 'Volcengine TTS V3 request',
      signal: input.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': input.apiKey,
        'X-Api-Resource-Id': input.resourceId || 'seed-tts-2.0',
        'X-Api-Request-Id': requestId,
      },
      body: JSON.stringify({
        user: { uid: input.task.id },
        req_params: {
          text: turn.text,
          speaker,
          audio_params: {
            format: 'mp3',
            sample_rate: 24000,
            speech_rate: volcengineSpeechRate(input.task.ttsSpeed),
          },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Volcengine TTS V3 API error (${response.status}): ${await readTextBounded(response, PROVIDER_RESPONSE_MAX_BYTES)}`);
    }
    const bytes = await decodeVolcengineV3Audio(response);
      const path = join(outputDir, audioFileName(scene.id, turn, 'mp3'));
    await writeFile(path, bytes);
      assets.push(sceneAssetForTurn(scene.id, path, turn));
    }
  }
  return assets;
}

async function decodeVolcengineV3Audio(response: Response): Promise<Buffer> {
  if (!response.body) {
    return parseVolcengineV3AudioLines(await readTextBounded(response, PROVIDER_RESPONSE_MAX_BYTES));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let done = false;
  const chunks: Buffer[] = [];

  while (!done) {
    const result = await reader.read();
    done = result.done;
    pending += decoder.decode(result.value ?? new Uint8Array(), { stream: !done });
    let lineBreak = pending.indexOf('\n');
    while (lineBreak >= 0) {
      consumeVolcengineV3Line(pending.slice(0, lineBreak), chunks);
      pending = pending.slice(lineBreak + 1);
      lineBreak = pending.indexOf('\n');
    }
  }
  consumeVolcengineV3Line(pending, chunks);
  if (!chunks.length) {
    throw new Error('Volcengine TTS V3 response did not include audio data.');
  }
  return Buffer.concat(chunks);
}

function parseVolcengineV3AudioLines(text: string): Buffer {
  const chunks: Buffer[] = [];
  for (const line of text.split(/\r?\n/)) {
    consumeVolcengineV3Line(line, chunks);
  }
  if (!chunks.length) {
    throw new Error('Volcengine TTS V3 response did not include audio data.');
  }
  return Buffer.concat(chunks);
}

function consumeVolcengineV3Line(line: string, chunks: Buffer[]): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  const jsonText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  const body = JSON.parse(jsonText) as { code?: number; message?: string; data?: string | null };
  if (body.code === 0 && body.data) {
    chunks.push(Buffer.from(body.data, 'base64'));
    return;
  }
  if (body.code === 20000000) return;
  if (body.code && body.code !== 0) {
    throw new Error(`Volcengine TTS V3 API error: ${body.message ?? body.code}`);
  }
}

function volcengineSpeechRate(speed: number): number {
  const ratio = Number.isFinite(speed) ? speed : 1;
  return Math.max(-50, Math.min(100, Math.round((ratio - 1) * 100)));
}

function narrationTurnsForScene(scene: StoryboardScene, task: Task, defaultVoiceId: string, provider: RuntimeTtsProvider): TtsTurn[] {
  if (task.videoForm !== 'two-host-podcast') {
    return [{ scene, text: scene.cap, voiceId: defaultVoiceId }];
  }
  const defaults = defaultPodcastSpeakersForProvider(provider, task.podcastSpeakers);
  const voiceA = task.podcastSpeakerA?.trim() || defaults.podcastSpeakerA;
  const voiceB = task.podcastSpeakerB?.trim() || defaults.podcastSpeakerB;

  return splitPodcastDialogue(scene).map((turn) => ({
    scene,
    text: turn.text,
    voiceId: turn.speaker === 'A' ? voiceA : voiceB,
    speaker: turn.speaker,
    turnIndex: turn.turnIndex,
  }));
}

function audioFileName(sceneId: number, turn: TtsTurn, extension: string): string {
  const scenePart = String(sceneId).padStart(3, '0');
  if (!turn.speaker || !turn.turnIndex) return `${scenePart}.${extension}`;
  return `${scenePart}-turn-${String(turn.turnIndex).padStart(3, '0')}-${turn.speaker}.${extension}`;
}

function sceneAssetForTurn(sceneId: number, path: string, turn: TtsTurn): SceneAsset {
  return {
    sceneId,
    path,
    ...(turn.speaker ? { speaker: turn.speaker } : {}),
    ...(turn.turnIndex ? { turnIndex: turn.turnIndex } : {}),
    ...(turn.speaker ? { text: turn.text } : {}),
  };
}

async function extractImageBytes(body: { data?: Array<{ b64_json?: string; url?: string }> }, signal?: AbortSignal): Promise<Buffer> {
  const image = body.data?.[0];
  if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
  if (image?.url) {
    const response = await fetchWithTimeout(image.url, {
      purpose: 'public-research',
      timeoutMs: 60_000,
      timeoutLabel: 'Generated image download',
      maxBytes: PROVIDER_RESPONSE_MAX_BYTES,
      signal,
    });
    if (!response.ok) throw new Error(`Failed to download generated image (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('Image provider response did not include image data.');
}

function decodeAudioPayload(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, 'hex');
  }
  return Buffer.from(trimmed, 'base64');
}

async function signedVolcenginePost<T>(input: {
  endpoint: string;
  action: string;
  body: Record<string, unknown>;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  signal?: AbortSignal;
}): Promise<T> {
  const query = { Action: input.action, Version: '2022-08-31' };
  const url = new URL(input.endpoint);
  url.search = '';
  for (const [key, value] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) {
    url.searchParams.set(key, value);
  }
  const body = JSON.stringify(input.body);
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const headers = {
    'Content-Type': 'application/json',
    'X-Date': timestamp,
    Host: url.host,
  };
  const authorization = generateVolcengineSignature({
    method: 'POST',
    canonicalUri: url.pathname || '/',
    query,
    headers,
    body,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    region: input.region,
    service: input.service,
  });
  const response = await fetchWithTimeout(url.toString(), {
    method: 'POST',
    timeoutMs: 180_000,
    timeoutLabel: `Volcengine ${input.action} request`,
    signal: input.signal,
    headers: { ...headers, Authorization: authorization },
    body,
  });
  if (!response.ok) {
    throw new Error(`Volcengine ${input.action} API error (${response.status}): ${await readTextBounded(response, PROVIDER_RESPONSE_MAX_BYTES)}`);
  }
  return readJsonBounded<T>(response, PROVIDER_RESPONSE_MAX_BYTES);
}

function generateVolcengineSignature(input: {
  method: string;
  canonicalUri: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}): string {
  const sortedQuery = Object.entries(input.query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const sortedHeaderEntries = Object.entries(input.headers).sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const canonicalHeaders = sortedHeaderEntries.map(([key, value]) => `${key.toLowerCase()}:${value.trim()}\n`).join('');
  const signedHeaders = sortedHeaderEntries.map(([key]) => key.toLowerCase()).join(';');
  const hashedPayload = createHash('sha256').update(input.body, 'utf8').digest('hex');
  const canonicalRequest = [input.method, input.canonicalUri, sortedQuery, canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const hashedCanonicalRequest = createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const dateStamp = input.headers['X-Date'].slice(0, 8);
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/request`;
  const stringToSign = ['HMAC-SHA256', input.headers['X-Date'], credentialScope, hashedCanonicalRequest].join('\n');
  const kDate = createHmac('sha256', input.secretAccessKey).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(input.region).digest();
  const kService = createHmac('sha256', kRegion).update(input.service).digest();
  const kSigning = createHmac('sha256', kService).update('request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(typeof reason === 'string' ? reason : 'Request aborted.');
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timeout);
      const reason = signal?.reason;
      reject(reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Request aborted.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function resolveJimengSize(ratio: string, resolution: '1K' | '2K' | '4K'): string {
  const presets: Record<'1K' | '2K' | '4K', Record<string, string>> = {
    '1K': { '1:1': '1024x1024', '4:3': '1360x1020', '16:9': '1536x864', '9:16': '864x1536', '3:2': '1440x960', '2:3': '960x1440' },
    '2K': { '1:1': '2048x2048', '4:3': '2304x1728', '16:9': '2560x1440', '9:16': '1440x2560', '3:2': '2496x1664', '2:3': '1664x2496' },
    '4K': { '1:1': '4096x4096', '4:3': '4694x3520', '16:9': '5404x3040', '9:16': '3040x5404', '3:2': '4992x3328', '2:3': '3328x4992' },
  };
  return presets[resolution][ratio] ?? presets[resolution]['1:1'];
}
