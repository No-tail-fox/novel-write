import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import type { AppConfig, ImagePrompt, StoryboardScene, Task } from './types';
import type { SceneAsset } from './draft';
import { buildOpenAiImageGenerationBody, normalizeOpenAiImageBaseUrl } from './openai-image';

type ImageGenerator = (scenes: StoryboardScene[], prompts: ImagePrompt[], task: Task) => Promise<SceneAsset[]>;
type NarrationSynthesizer = (scenes: StoryboardScene[], task: Task) => Promise<SceneAsset[]>;

export function createConfiguredImageGenerator(config: AppConfig, workDir: string): ImageGenerator {
  return async (scenes, prompts, task) => {
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
    });
  };
}

export function createConfiguredNarrationSynthesizer(config: AppConfig, workDir: string): NarrationSynthesizer {
  return async (scenes, task) => {
    if (config.tts.provider === 'mock') {
      throw new Error('TTS provider is set to mock; real narration audio is required.');
    }
    if (config.tts.provider === 'volcengine') {
      return synthesizeVolcengineNarration({
        scenes,
        task,
        workDir,
        appId: config.tts.volcengine.appId || config.tts.appId,
        accessKey: config.tts.volcengine.accessKey || config.tts.accessKey,
        speaker: config.tts.volcengine.speaker || config.tts.speaker || task.speaker,
        cluster: config.tts.volcengine.cluster || 'volcano_tts',
        endpoint: config.tts.volcengine.endpoint || 'https://openspeech.bytedance.com/api/v1/tts',
      });
    }
    return synthesizeMiniMaxNarration({
      scenes,
      task,
      workDir,
      apiKey: config.tts.minimax.apiKey,
      model: config.tts.minimax.model,
      voiceId: config.tts.minimax.voiceId || task.speaker,
    });
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
    });
    if (result.code !== 10000 || !result.data) {
      throw new Error(`Jimeng poll failed: ${result.message ?? 'empty result'}`);
    }
    if (result.data.binary_data_base64?.[0]) {
      return Buffer.from(result.data.binary_data_base64[0], 'base64');
    }
    if (result.data.image_urls?.[0]) {
      const response = await fetch(result.data.image_urls[0]);
      if (!response.ok) throw new Error(`Failed to download Jimeng image (${response.status}).`);
      return Buffer.from(await response.arrayBuffer());
    }
    if (result.data.status === 'fail') {
      throw new Error(`Jimeng task failed: ${result.message ?? input.taskId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs));
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
}): Promise<SceneAsset[]> {
  if (!input.apiKey) {
    throw new Error('Image provider API key is missing; cannot generate real image assets.');
  }
  const baseUrl = normalizeOpenAiImageBaseUrl(input.baseUrl || 'https://api.openai.com');
  const outputDir = join(input.workDir, 'provider-images');
  await mkdir(outputDir, { recursive: true });

  const assets: SceneAsset[] = [];
  for (const scene of input.scenes) {
    const prompt = input.prompts.find((item) => item.sceneId === scene.id)?.prompt ?? scene.descPrompt;
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(buildOpenAiImageGenerationBody({
        model: input.model,
        prompt,
        ratio: input.ratio,
        resolution: input.resolution,
      })),
    });
    if (!response.ok) {
      throw new Error(`Image provider API error (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const bytes = await extractImageBytes(body);
    const path = join(outputDir, `${String(scene.id).padStart(3, '0')}.png`);
    await writeFile(path, bytes);
    assets.push({ sceneId: scene.id, path });
  }
  return assets;
}

async function synthesizeMiniMaxNarration(input: {
  scenes: StoryboardScene[];
  task: Task;
  workDir: string;
  apiKey: string;
  model: string;
  voiceId: string;
}): Promise<SceneAsset[]> {
  if (!input.apiKey) {
    throw new Error('MiniMax TTS API key is missing; cannot generate real narration audio.');
  }
  const outputDir = join(input.workDir, 'provider-audio');
  await mkdir(outputDir, { recursive: true });
  const assets: SceneAsset[] = [];

  for (const scene of input.scenes) {
    const response = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        text: scene.cap,
        stream: false,
        voice_setting: {
          voice_id: input.voiceId,
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
      throw new Error(`MiniMax TTS API error (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as {
      data?: { audio?: string };
      audio_file?: string;
      base_resp?: { status_code?: number; status_msg?: string };
    };
    if (body.base_resp?.status_code && body.base_resp.status_code !== 0) {
      throw new Error(`MiniMax TTS API error: ${body.base_resp.status_msg ?? body.base_resp.status_code}`);
    }
    const audio = body.data?.audio ?? body.audio_file;
    if (!audio) {
      throw new Error('MiniMax TTS response did not include audio data.');
    }
    const bytes = decodeAudioPayload(audio);
    const path = join(outputDir, `${String(scene.id).padStart(3, '0')}.mp3`);
    await writeFile(path, bytes);
    assets.push({ sceneId: scene.id, path });
  }
  return assets;
}

async function synthesizeVolcengineNarration(input: {
  scenes: StoryboardScene[];
  task: Task;
  workDir: string;
  appId: string;
  accessKey: string;
  speaker: string;
  cluster: string;
  endpoint: string;
}): Promise<SceneAsset[]> {
  if (!input.appId || !input.accessKey) {
    throw new Error('Volcengine TTS App ID and access token are required for real narration audio.');
  }
  const outputDir = join(input.workDir, 'provider-audio');
  await mkdir(outputDir, { recursive: true });
  const assets: SceneAsset[] = [];

  for (const scene of input.scenes) {
    const response = await fetch(input.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.accessKey}`,
      },
      body: JSON.stringify({
        app: { appid: input.appId, token: input.accessKey, cluster: input.cluster },
        user: { uid: input.task.id },
        audio: {
          voice_type: input.speaker,
          encoding: 'mp3',
          speed_ratio: input.task.ttsSpeed,
        },
        request: {
          reqid: `${input.task.id}-${scene.id}`,
          text: scene.cap,
          operation: 'query',
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Volcengine TTS API error (${response.status}): ${await response.text()}`);
    }
    const body = (await response.json()) as { code?: number; message?: string; data?: string };
    if (body.code !== 3000 || !body.data) {
      throw new Error(`Volcengine TTS API error: ${body.message ?? body.code ?? 'missing audio data'}`);
    }
    const path = join(outputDir, `${String(scene.id).padStart(3, '0')}.mp3`);
    await writeFile(path, Buffer.from(body.data, 'base64'));
    assets.push({ sceneId: scene.id, path });
  }
  return assets;
}

async function extractImageBytes(body: { data?: Array<{ b64_json?: string; url?: string }> }): Promise<Buffer> {
  const image = body.data?.[0];
  if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
  if (image?.url) {
    const response = await fetch(image.url);
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
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { ...headers, Authorization: authorization },
    body,
  });
  if (!response.ok) {
    throw new Error(`Volcengine ${input.action} API error (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as T;
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

function resolveJimengSize(ratio: string, resolution: '1K' | '2K' | '4K'): string {
  const presets: Record<'1K' | '2K' | '4K', Record<string, string>> = {
    '1K': { '1:1': '1024x1024', '4:3': '1360x1020', '16:9': '1536x864', '9:16': '864x1536', '3:2': '1440x960', '2:3': '960x1440' },
    '2K': { '1:1': '2048x2048', '4:3': '2304x1728', '16:9': '2560x1440', '9:16': '1440x2560', '3:2': '2496x1664', '2:3': '1664x2496' },
    '4K': { '1:1': '4096x4096', '4:3': '4694x3520', '16:9': '5404x3040', '9:16': '3040x5404', '3:2': '4992x3328', '2:3': '3328x4992' },
  };
  return presets[resolution][ratio] ?? presets[resolution]['1:1'];
}
