import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { createOpenAiCompatibleJsonLlm } from './llm-provider';
import { resolvePythonCommand } from './python-runtime';
import {
  buildViralBreakdownPrompt,
  buildViralRecreationPrompt,
  normalizeViralSourceUrl,
  type RunViralAnalysisOptions,
  type ViralMediaDownloadResult,
  type ViralMediaExtractionResult,
} from './viral-analysis';
import type { AppConfig, LlmConfig, ViralFrameAnalysis, ViralPlatform, ViralVideoSource } from './types';

const execFileAsync = promisify(execFile);

export function createViralRuntimeProviders(config: AppConfig, workDir: string): Omit<RunViralAnalysisOptions, 'workDir' | 'emit' | 'signal'> {
  const textLlm = createOpenAiCompatibleJsonLlm(config.llm);
  return {
    download: (record, runDir, signal) => downloadViralVideo(record.url, record.platform, config, runDir, signal),
    extract: (videoPath, runDir, signal) => extractViralMedia(videoPath, runDir, config, signal),
    transcribe: (audioPath, signal) => transcribeViralAudio(audioPath, config, signal),
    analyzeFrame: (frame, previousFrame, source, signal) => analyzeViralFrame(frame, previousFrame, source, config.viral.vision.apiKey ? config.viral.vision : config.llm, signal),
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

async function downloadViralVideo(url: string, platform: string, config: AppConfig, workDir: string, signal?: AbortSignal): Promise<ViralMediaDownloadResult> {
  const normalizedUrl = normalizeViralSourceUrl(url, platform as ViralPlatform);
  if (platform === 'kuaishou') {
    try {
      return await downloadKuaishouWithPlaywright(normalizedUrl, workDir, config, signal);
    } catch {
      // Fall back to yt-dlp below; public page structures change often.
    }
  }
  const python = resolvePythonCommand();
  const commonArgs = ['-m', 'yt_dlp', '--no-playlist'];
  const cookieArgs = config.viral.cookieFilePath ? ['--cookies', config.viral.cookieFilePath] : [];
  try {
    const metadata = await runCommand(
      python,
      [...commonArgs, ...cookieArgs, '--dump-json', '--skip-download', normalizedUrl],
      config.viral.downloadTimeoutMs,
      signal,
    );
    await runCommand(
      python,
      [...commonArgs, ...cookieArgs, '-o', join(workDir, 'video.%(ext)s'), '--merge-output-format', 'mp4', normalizedUrl],
      config.viral.downloadTimeoutMs,
      signal,
    );
    const files = await readdir(workDir);
    const videoFile = files.find((file) => /^video\.(mp4|m4v|mov|webm|mkv)$/i.test(file)) ?? '';
    if (!videoFile) throw new Error('yt-dlp completed but no video file was written.');
    const raw = parseJsonLoose<Record<string, unknown>>(metadata.stdout);
    const videoPath = join(workDir, videoFile);
    return {
      videoPath,
      source: {
        platform: platform as ViralVideoSource['platform'],
        url: normalizedUrl,
        videoPath,
        coverPath: '',
        title: String(raw.title ?? raw.fulltitle ?? ''),
        author: String(raw.uploader ?? raw.channel ?? raw.creator ?? ''),
        duration: Number(raw.duration ?? 0),
        stats: {
          likes: nullableNumber(raw.like_count),
          comments: nullableNumber(raw.comment_count),
          shares: nullableNumber(raw.repost_count),
        },
      },
    };
  } catch (error) {
    throw new Error(`视频下载失败：${error instanceof Error ? error.message : String(error)}。仅支持用户可访问的公开${platform}视频。`);
  }
}

async function downloadKuaishouWithPlaywright(url: string, workDir: string, config: AppConfig, signal?: AbortSignal): Promise<ViralMediaDownloadResult> {
  const videoPath = join(workDir, 'video.mp4');
  const script = String.raw`
import asyncio, json, re, sys
import httpx
from playwright.async_api import async_playwright

url = sys.argv[1]
video_path = sys.argv[2]

async def main():
    media_urls = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36")
        async def on_response(resp):
            content_type = resp.headers.get("content-type", "")
            if "video" in content_type or re.search(r"\.(mp4|m3u8)(\?|$)", resp.url):
                media_urls.append(resp.url)
        page.on("response", on_response)
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(8000)
        title = await page.title()
        await browser.close()
    media_url = next((item for item in media_urls if ".mp4" in item or "video" in item), "")
    if not media_url:
        raise RuntimeError("No public Kuaishou mp4 resource was detected.")
    async with httpx.AsyncClient(follow_redirects=True, timeout=120) as client:
        response = await client.get(media_url)
        response.raise_for_status()
        with open(video_path, "wb") as f:
            f.write(response.content)
    print(json.dumps({"title": title, "videoPath": video_path}, ensure_ascii=False))

asyncio.run(main())
`;
  try {
    const output = await runCommand(resolvePythonCommand(), ['-c', script, url, videoPath], config.viral.downloadTimeoutMs, signal);
    const payload = parseJsonLoose<{ title?: string; videoPath?: string }>(output.stdout, {});
    return {
      videoPath: payload.videoPath || videoPath,
      source: {
        platform: 'kuaishou',
        url,
        videoPath: payload.videoPath || videoPath,
        coverPath: '',
        title: payload.title ?? '',
        author: '',
        duration: 0,
        stats: { likes: null, comments: null, shares: null },
      },
    };
  } catch (error) {
    throw new Error(`快手公开视频下载失败：${error instanceof Error ? error.message : String(error)}`);
  }
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
  const script = [
    'import json',
    'from faster_whisper import WhisperModel',
    `model = WhisperModel(${JSON.stringify(config.viral.whisperModel)}, device="cpu", compute_type="int8")`,
    `segments, _ = model.transcribe(${JSON.stringify(audioPath)}, language="zh", word_timestamps=True, vad_filter=True)`,
    'out = []',
    'for s in segments:',
    '    words = [{"word": w.word.strip(), "start": w.start, "end": w.end} for w in (s.words or []) if w.word.strip()]',
    '    out.append({"text": s.text.strip(), "start": s.start, "end": s.end, "words": words})',
    'print(json.dumps(out, ensure_ascii=False))',
  ].join('\n');
  const result = await runCommand(resolvePythonCommand(), ['-c', script], 10 * 60 * 1000, signal);
  return parseJsonLoose(result.stdout, []);
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
    ...(await Promise.all(images.map(async (image) => ({
      type: 'image_url',
      image_url: { url: `data:image/${imageExt(image.path)};base64,${(await readFile(image.path)).toString('base64')}` },
    })))),
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

async function runCommand(command: string, args: string[], timeout: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  if (signal?.aborted) throw new Error('Command aborted.');
  try {
    return await execFileAsync(command, args, { timeout, signal, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
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

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function imageExt(path: string): string {
  const ext = extname(path).toLowerCase();
  return ext === '.png' ? 'png' : 'jpeg';
}
