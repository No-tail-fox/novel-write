import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
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
import type { AppConfig, LlmConfig, SpeechToTextConfig, ViralFrameAnalysis, ViralTranscriptSegment, ViralVideoSource } from './types';

const execFileAsync = promisify(execFile);
export const DEFAULT_WHISPER_HF_MIRROR = 'https://hf-mirror.com';
const SPEECH_TO_TEXT_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

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
  const audioPath = join(workDir, 'audio.m4a');
  const framesDir = join(workDir, 'frames');
  await mkdir(framesDir, { recursive: true });
  const ffmpeg = await resolveBundledFfmpeg(signal);
  await runCommand(ffmpeg, ['-y', '-i', videoPath, '-vn', '-c:a', 'aac', '-b:a', '96k', '-ar', '16000', '-ac', '1', audioPath], 120000, signal);
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
  try {
    return await transcribeViralAudioWithOpenAiApi(audioPath, config, signal);
  } catch (error) {
    throw new Error(formatOpenAiTranscriptionError(error, config.speechToText));
  }
}

async function transcribeViralAudioWithOpenAiApi(audioPath: string, config: AppConfig, signal?: AbortSignal): Promise<ViralTranscriptSegment[]> {
  const request = buildOpenAiTranscriptionRequest(config);
  if (!request.apiKey.trim() || !config.speechToText.model.trim()) {
    throw new Error('语音转文字 API 未配置：请在系统设置 > 语音转文字 填写 API Key 和转写模型。');
  }

  const audioStats = await stat(audioPath);
  if (audioStats.size > SPEECH_TO_TEXT_UPLOAD_LIMIT_BYTES) {
    throw new Error(`音频文件 ${(audioStats.size / 1024 / 1024).toFixed(1)}MB 超过语音转文字 API 常见 25MB 上传限制，请缩短视频或先压缩音频。`);
  }

  const bytes = await readFile(audioPath);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: audioMimeType(audioPath) }), basename(audioPath));
  for (const [key, value] of request.fields) {
    form.append(key, value);
  }

  const response = await fetchWithTimeout(
    request.endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: form,
    },
    request.timeoutMs,
    signal,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload =
    contentType.includes('application/json') || request.responseFormat === 'json' || request.responseFormat === 'verbose_json'
      ? await response.json()
      : await response.text();
  return parseOpenAiTranscriptionResult(payload);
}

export interface OpenAiTranscriptionRequest {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
  responseFormat: SpeechToTextConfig['responseFormat'];
  fields: Array<[string, string]>;
}

export function buildOpenAiTranscriptionRequest(config: AppConfig): OpenAiTranscriptionRequest {
  const stt = config.speechToText;
  const fields: Array<[string, string]> = [
    ['model', stt.model],
  ];
  if (stt.language.trim()) fields.push(['language', stt.language.trim()]);
  if (stt.prompt.trim()) fields.push(['prompt', stt.prompt.trim()]);
  fields.push(['response_format', stt.responseFormat]);
  fields.push(['temperature', String(stt.temperature)]);
  if (stt.responseFormat === 'verbose_json') {
    for (const granularity of stt.timestampGranularities) {
      fields.push(['timestamp_granularities[]', granularity]);
    }
  }
  if (stt.chunkingStrategy === 'auto') {
    fields.push(['chunking_strategy', 'auto']);
  }
  return {
    endpoint: `${normalizeOpenAiBaseUrl(stt.baseUrl || 'https://api.openai.com')}/audio/transcriptions`,
    apiKey: stt.apiKey,
    timeoutMs: stt.timeoutMs,
    responseFormat: stt.responseFormat,
    fields,
  };
}

export function parseOpenAiTranscriptionResult(payload: unknown): ViralTranscriptSegment[] {
  if (typeof payload === 'string') return plainTranscriptSegment(payload);
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as {
    text?: unknown;
    segments?: unknown;
    words?: unknown;
  };
  if (Array.isArray(body.segments) && body.segments.length) {
    return body.segments
      .map((segment): ViralTranscriptSegment => {
        const source = segment && typeof segment === 'object' ? (segment as Record<string, unknown>) : {};
        return {
          text: String(source.text ?? '').trim(),
          start: normalizeTimestamp(source.start),
          end: normalizeTimestamp(source.end),
          words: normalizeTranscriptWords(source.words),
        };
      })
      .filter((segment) => segment.text || segment.words.length);
  }

  const topLevelWords = normalizeTranscriptWords(body.words);
  const text = String(body.text ?? '').trim();
  if (topLevelWords.length) {
    return [
      {
        text,
        start: topLevelWords[0]?.start ?? 0,
        end: topLevelWords[topLevelWords.length - 1]?.end ?? 0,
        words: topLevelWords,
      },
    ];
  }
  return plainTranscriptSegment(text);
}

function plainTranscriptSegment(text: string): ViralTranscriptSegment[] {
  const normalized = text.trim();
  return normalized ? [{ text: normalized, start: 0, end: 0, words: [] }] : [];
}

function normalizeTranscriptWords(value: unknown): ViralTranscriptSegment['words'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((word) => {
      const source = word && typeof word === 'object' ? (word as Record<string, unknown>) : {};
      return {
        word: String(source.word ?? source.text ?? '').trim(),
        start: normalizeTimestamp(source.start),
        end: normalizeTimestamp(source.end),
      };
    })
    .filter((word) => word.word);
}

function normalizeTimestamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  if (signal?.aborted) throw new Error('语音转文字请求已取消。');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`语音转文字请求超过 ${Math.round(timeoutMs / 1000)} 秒。`)), timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function audioMimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3' || ext === '.mpeg' || ext === '.mpga') return 'audio/mpeg';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.flac') return 'audio/flac';
  return 'application/octet-stream';
}

function formatOpenAiTranscriptionError(error: unknown, config: SpeechToTextConfig): string {
  const detail = compactErrorText(stringifyError(error));
  if (/未配置/.test(detail)) return detail;
  const endpoint = `${normalizeOpenAiBaseUrl(config.baseUrl || 'https://api.openai.com')}/audio/transcriptions`;
  return [
    `语音转文字 API 调用失败：${detail}`,
    `当前端点：${endpoint}`,
    '请在“系统设置 > 语音转文字”检查 Base URL、API Key、转写模型、响应格式、时间戳和请求超时。',
  ].join('\n');
}

async function transcribeViralAudioWithLocalWhisper(audioPath: string, config: AppConfig, signal?: AbortSignal) {
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
