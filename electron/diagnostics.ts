// Diagnostics / environment checks and local preview helpers, split out of main.ts (O-5).
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import type { AppConfig, CustomStyle, CustomStyleGenerateInput } from '../src/shared/types';
import { resolveVolcengineTtsApiVersion } from '../src/shared/volcengine-tts';

const execFileAsync = promisify(execFile);

export async function readLocalImageDataUrl(path: string): Promise<string> {
  if (!path || !path.trim()) {
    throw new Error('Preview image path is required.');
  }
  const mime = previewImageMimeType(path);
  if (!mime) {
    throw new Error(`Unsupported preview image extension: ${extname(path) || '(none)'}`);
  }
  const bytes = await readFile(path);
  if (mime.startsWith('image/')) {
    return `data:image/${mime.replace('image/', '')};base64,${bytes.toString('base64')}`;
  }
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export function previewImageMimeType(path: string): string | null {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.m4a') return 'audio/mp4';
  if (extension === '.aac') return 'audio/aac';
  if (extension === '.ogg') return 'audio/ogg';
  if (extension === '.flac') return 'audio/flac';
  return null;
}

export function imageConfigStatus(config: AppConfig): 'pass' | 'warn' | 'fail' {
  if (config.imageProvider === 'mock') return 'fail';
  if (config.imageProvider === 'jimeng') return config.jimeng.accessKeyId && config.jimeng.secretAccessKey && config.jimeng.reqKey ? 'pass' : 'warn';
  if (config.imageProvider === 'custom') return config.customImage.apiKey && config.customImage.baseUrl ? 'pass' : 'warn';
  return config.gptImage.apiKey || config.image.apiKey ? 'pass' : 'warn';
}

export function ttsConfigStatus(config: AppConfig): 'pass' | 'warn' | 'fail' {
  if (config.tts.provider === 'mock') return 'fail';
  if (config.tts.provider === 'minimax') return config.tts.minimax.apiKey ? 'pass' : 'warn';
  if (resolveVolcengineTtsApiVersion(config.tts.volcengine) === 'v3') {
    return config.tts.volcengine.apiKey ? 'pass' : 'warn';
  }
  return (config.tts.volcengine.appId || config.tts.appId) && (config.tts.volcengine.accessKey || config.tts.accessKey) ? 'pass' : 'warn';
}

export async function checkPython(): Promise<{ status: 'pass' | 'warn'; detail: string }> {
  const runtime = resolvePythonRuntimeInfo();
  try {
    const { stdout, stderr } = await execFileAsync(runtime.command, ['--version']);
    const version = (stdout || stderr).trim() || 'python available';
    return { status: 'pass', detail: `${runtime.source} ${version}` };
  } catch (error) {
    return { status: 'warn', detail: error instanceof Error ? error.message : 'python not found' };
  }
}

export function normalizeGeneratedCustomStyle(input: CustomStyleGenerateInput, generated: Partial<CustomStyle>): CustomStyle {
  const now = new Date().toISOString();
  const fallbackName = input.prompt.trim().slice(0, 16) || input.baseStyle.name;
  return {
    id: input.baseStyle.id,
    name: String(generated.name || fallbackName),
    tag: String(generated.tag || input.baseStyle.tag),
    shortName: String(generated.shortName || fallbackName.slice(0, 4)),
    prefix: String(generated.prefix || input.baseStyle.prefix),
    suffix: String(generated.suffix || input.baseStyle.suffix),
    negativePrompt: String(generated.negativePrompt || input.baseStyle.negativePrompt),
    allowColor: typeof generated.allowColor === 'boolean' ? generated.allowColor : input.baseStyle.allowColor,
    description: String(generated.description || input.baseStyle.description),
    createdAt: input.baseStyle.createdAt || now,
    updatedAt: now,
  };
}

export async function checkPyJianYingDraft(): Promise<{ status: 'pass' | 'warn'; detail: string }> {
  const runtime = resolvePythonRuntimeInfo();
  try {
    await execFileAsync(runtime.command, ['-c', 'import pyJianYingDraft; print("pyJianYingDraft installed")']);
    return { status: 'pass', detail: `pyJianYingDraft installed in ${runtime.source} Python` };
  } catch {
    return { status: 'warn', detail: runtime.source === 'bundled' ? 'Bundled pyJianYingDraft is unavailable; rebuild the portable Python runtime.' : '未检测到 pyJianYingDraft；请运行 python -m pip install pyJianYingDraft' };
  }
}

export async function checkStoryboundSidecarDependencies(): Promise<{ status: 'pass' | 'warn'; detail: string }> {
  const runtime = resolvePythonRuntimeInfo();
  try {
    await execFileAsync(runtime.command, ['-c', 'import pyJianYingDraft, imageio_ffmpeg, pydub, jieba; print("Storybound sidecar dependencies installed")']);
    return { status: 'pass', detail: `Storybound sidecar dependencies installed in ${runtime.source} Python` };
  } catch {
    return {
      status: 'warn',
      detail:
        runtime.source === 'bundled'
          ? 'Bundled Storybound sidecar dependencies are unavailable; rebuild the portable Python runtime.'
          : '未检测到 Storybound sidecar 依赖；请安装 pyJianYingDraft、imageio-ffmpeg、pydub、jieba',
    };
  }
}
