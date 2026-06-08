import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { createOpenAiCompatibleJsonLlm } from './llm-provider';
import { resolvePythonCommand } from './python-runtime';
import {
  buildViralBreakdownPrompt,
  buildViralRecreationPrompt,
  type RunViralAnalysisOptions,
  type ViralMediaExtractionResult,
} from './viral-analysis';
import { downloadViralMedia } from './viral-download';
import type { AppConfig, LlmConfig, ViralFrameAnalysis, ViralVideoSource } from './types';

const execFileAsync = promisify(execFile);
export const DEFAULT_WHISPER_HF_MIRROR = 'https://hf-mirror.com';

export function createViralRuntimeProviders(config: AppConfig, _workDir: string): Omit<RunViralAnalysisOptions, 'workDir' | 'emit' | 'signal'> {
  const textLlm = createOpenAiCompatibleJsonLlm(config.llm);
  return {
    download: (record, runDir, signal) => downloadViralMedia({ url: record.url, platform: record.platform, workDir: runDir, config }, signal),
    extract: (videoPath, runDir, signal) => extractViralMedia(videoPath, runDir, config, signal),
    transcribe: (audioPath, signal) => transcribeViralAudio(audioPath, config, signal),
    analyzeFrame: (frame, previousFrame, source, signal) =>
      analyzeViralFrame(frame, previousFrame, source, config.viral.vision.apiKey ? config.viral.vision : config.llm, signal),
    analyzeBreakdown: async (input, signal) => {
      const result = await textLlm({
        step: -1,
        name: 'viral-breakdown',
        signal,
        messages: [
          { role: 'system', content: 'Return strict JSON only.' },
          { role: 'user', content: buildViralBreakdownPrompt(input) },
        ],
      });
      return result.json as ReturnType<RunViralAnalysisOptions['analyzeBreakdown']> extends Promise<infer T> ? T : never;
    },
    createRecreation: async (input, signal) => {
      const result = await textLlm({
        step: -1,
        name: 'viral-recreation',
        signal,
        messages: [
          { role: 'system', content: 'Return strict JSON only.' },
          { role: 'user', content: buildViralRecreationPrompt(input) },
        ],
      });
      return result.json as ReturnType<RunViralAnalysisOptions['createRecreation']> extends Promise<infer T> ? T : never;
    },
  };
}

async function extractViralMedia(videoPath: string, workDir: string, config: AppConfig, signal?: AbortSignal): Promise<ViralMediaExtractionResult> {
  const audioPath = join(workDir, 'audio.wav');
  const framesDir = join(workDir, 'frames');
  await mkdir(framesDir, { recursive: true });
  const ffmpeg = await resolveBundledFfmpeg(signal);
  await runCommand(ffmpeg, ['-y', '-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', audioPath], 120000, signal);
  await runCommand(
    ffmpeg,
    ['-y', '-i', videoPath, '-vf', `fps=1/${config.viral.frameIntervalSeconds},scale=1280:-2`, '-q:v', '2', join(framesDir, 'frame-%04d.jpg')],
    120000,
    signal,
  );
  const files = (await readdir(framesDir)).filter((file) => /\.jpe?g$/i.test(file)).slice(0, config.viral.maxFrames);
  return {
    audioPath,
    frames: files.map((file, index) => ({
      framePath: join(framesDir, file),
      timestamp: index * config.viral.frameIntervalSeconds,
    })),
  };
}

async function resolveBundledFfmpeg(signal?: AbortSignal): Promise<string> {
  try {
    const result = await runCommand(resolvePythonCommand(), ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], 15000, signal);
    return result.stdout.trim() || 'ffmpeg';
  } catch {
    return 'ffmpeg';
  }
}

async function transcribeViralAudio(audioPath: string, config: AppConfig, signal?: AbortSignal) {
  const model = normalizeWhisperModel(config.viral.whisperModel);
  const endpoint = normalizeHuggingFaceEndpoint(config.viral.huggingFaceEndpoint);
  const script = buildViralWhisperTranscribeScript(audioPath, model);
  try {
    const result = await runCommand(resolvePythonCommand(), ['-c', script], 10 * 60 * 1000, signal, buildWhisperEnv(endpoint));
    return parseJsonLoose(result.stdout, []);
  } catch (error) {
    if (!endpoint && !process.env.HF_ENDPOINT && shouldRetryWhisperWithMirror(error)) {
      try {
        const result = await runCommand(resolvePythonCommand(), ['-c', script], 10 * 60 * 1000, signal, buildWhisperEnv(DEFAULT_WHISPER_HF_MIRROR));
        return parseJsonLoose(result.stdout, []);
      } catch (mirrorError) {
        throw new Error(formatViralWhisperError(mirrorError, { model, endpoint: DEFAULT_WHISPER_HF_MIRROR, firstError: error }));
      }
    }
    throw new Error(formatViralWhisperError(error, { model, endpoint }));
  }
}

export function buildViralWhisperTranscribeScript(audioPath: string, model: string): string {
  return [
    'import json',
    'from faster_whisper import WhisperModel',
    `model = WhisperModel(${JSON.stringify(normalizeWhisperModel(model))}, device="cpu", compute_type="int8")`,
    `segments, _ = model.transcribe(${JSON.stringify(audioPath)}, language="zh", word_timestamps=True, vad_filter=True)`,
    'out = []',
    'for s in segments:',
    '    words = [{"word": w.word.strip(), "start": w.start, "end": w.end} for w in (s.words or []) if w.word.strip()]',
    '    out.append({"text": s.text.strip(), "start": s.start, "end": s.end, "words": words})',
    'print(json.dumps(out, ensure_ascii=False))',
  ].join('\n');
}

export function shouldRetryWhisperWithMirror(error: unknown): boolean {
  const message = stringifyError(error).toLowerCase();
  return /huggingface|snapshot_download|localentrynotfound|connecttimeout|timed out|winerror 10060/.test(message);
}

export function formatViralWhisperError(
  error: unknown,
  context: { model: string; endpoint?: string; firstError?: unknown },
): string {
  const detail = compactErrorText([context.firstError, error].filter(Boolean).map(stringifyError).join('\n'));
  if (shouldRetryWhisperWithMirror(error) || (context.firstError && shouldRetryWhisperWithMirror(context.firstError))) {
    const endpointText = context.endpoint ? `端点 ${context.endpoint}` : 'HuggingFace Hub';
    return [
      `本地 Whisper 转写失败：模型 "${context.model}" 没有可用缓存，且无法从 ${endpointText} 下载。`,
      `处理方式：在“爆款拆解”的“转写与 Cookie 兜底设置”里把 HuggingFace 端点填为 ${DEFAULT_WHISPER_HF_MIRROR} 后重试；或者先把 faster-whisper 模型下载到本机，并把 Whisper 模型填成本地模型目录。`,
      `原始错误：${detail}`,
    ].join('\n');
  }
  return `本地 Whisper 转写失败：${detail}`;
}

function normalizeWhisperModel(value: string): string {
  return value.trim() || 'small';
}

function normalizeHuggingFaceEndpoint(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function buildWhisperEnv(endpoint: string): Record<string, string> {
  return {
    PYTHONIOENCODING: 'utf-8',
    HF_HUB_ETAG_TIMEOUT: '20',
    HF_HUB_DOWNLOAD_TIMEOUT: '300',
    ...(endpoint ? { HF_ENDPOINT: endpoint } : {}),
  };
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return `${error.message}\n${error.stack ?? ''}`;
  return String(error);
}

function compactErrorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1000);
}

async function analyzeViralFrame(
  frame: { timestamp: number; framePath: string },
  previousFrame: { timestamp: number; framePath: string } | null,
  source: ViralVideoSource,
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<ViralFrameAnalysis> {
  const images = [
    previousFrame ? { label: '上一帧', path: previousFrame.framePath } : null,
    { label: '当前帧', path: frame.framePath },
  ].filter(Boolean) as Array<{ label: string; path: string }>;
  const content = [
    {
      type: 'text',
      text:
        `分析短视频第 ${frame.timestamp}s 关键帧。标题：${source.title}\n` +
        '返回 JSON: {"shotType":string,"cameraMovement":string,"composition":string,"transition":string,"textOverlay":string|null,"visualDescription":string,"mood":string,"keyElements":string[]}',
    },
    ...(await Promise.all(
      images.map(async (image) => ({
        type: 'image_url',
        image_url: { url: `data:image/${imageExt(image.path)};base64,${(await readFile(image.path)).toString('base64')}` },
      })),
    )),
  ];
  const raw = await runOpenAiCompatibleVision(config, content, signal);
  const parsed = parseJsonLoose<Partial<ViralFrameAnalysis>>(raw, {});
  return {
    timestamp: frame.timestamp,
    framePath: frame.framePath,
    shotType: String(parsed.shotType ?? ''),
    cameraMovement: String(parsed.cameraMovement ?? ''),
    composition: String(parsed.composition ?? ''),
    transition: String(parsed.transition ?? ''),
    textOverlay: parsed.textOverlay === null || parsed.textOverlay === undefined ? null : String(parsed.textOverlay),
    visualDescription: String(parsed.visualDescription ?? raw.slice(0, 200)),
    mood: String(parsed.mood ?? ''),
    keyElements: Array.isArray(parsed.keyElements) ? parsed.keyElements.map(String) : [],
  };
}

async function runOpenAiCompatibleVision(config: LlmConfig, content: unknown[], signal?: AbortSignal): Promise<string> {
  if (!config.apiKey || !config.model) throw new Error('Vision model API key and model are required for viral frame analysis.');
  const endpoint = `${normalizeOpenAiBaseUrl(config.baseUrl || 'https://api.openai.com')}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: 'Return strict JSON only. You are a short-video cinematography analyst.' },
        { role: 'user', content },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) throw new Error(`Vision API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  return body.choices?.[0]?.message?.content ?? '';
}

async function runCommand(command: string, args: string[], timeout: number, signal?: AbortSignal, env?: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  if (signal?.aborted) throw new Error('Command aborted.');
  try {
    return await execFileAsync(command, args, {
      timeout,
      signal,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      env: env ? { ...process.env, ...env } : undefined,
    });
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed. ${detail}`.trim());
  }
}

function normalizeOpenAiBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function parseJsonLoose<T>(raw: string, fallback?: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return JSON.parse(match[1]) as T;
      } catch {
        // fall through
      }
    }
    if (fallback !== undefined) return fallback;
    throw new Error(`Could not parse JSON output: ${raw.slice(0, 200)}`);
  }
}

function imageExt(path: string): string {
  const ext = extname(path).toLowerCase();
  return ext === '.png' ? 'png' : 'jpeg';
}
