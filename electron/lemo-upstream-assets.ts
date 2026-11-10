/**
 * Lemo v3 material channel: host-managed assets inside the agent project.
 *
 *   project/assets/MANIFEST.json      host-written list (marker `storydream: "lemo-assets"`)
 *   project/assets/a01.jpg            imported still (byte copy of the user's file)
 *   project/assets/a02/f00001.jpg …   imported video as a 24 fps JPEG sequence (deterministic seek)
 *   project/assets/generated/g1.png   illustration requested through request_image
 *   <run>/asset-previews/<id>.jpg     small thumbnail for view_asset (outside the served project)
 *
 * The agent can read MANIFEST.json but never write under assets/. Binary files are excluded from the
 * source fingerprint; MANIFEST.json (which carries every sha256) is included, and the binaries are
 * re-verified before export.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { LEMO_ASSET_VIDEO_MAX_SECONDS } from '../src/shared/creative-animation/agent-assets';
import { lemoUpstreamVideoInternals, parseFfmpegProbe } from './lemo-upstream-video';

export const LEMO_ASSET_DIR = 'assets';
export const LEMO_ASSET_MANIFEST = 'assets/MANIFEST.json';
export const LEMO_ASSET_MARKER = 'lemo-assets';
export const LEMO_ASSET_FPS = 24;
export const LEMO_ASSET_IMAGE_MAX_BYTES = 40 * 1024 * 1024;
const IMAGE_EXT: Record<string, string> = { '.png': '.png', '.jpg': '.jpg', '.jpeg': '.jpg', '.webp': '.webp' };
const VIDEO_EXT = /^\.(?:mp4|mov|m4v|webm|mkv)$/i;

export interface LemoAssetInput {
  id: string; kind: 'image' | 'video'; sha256: string;
  description: string; source: string; license: string;
}
export interface LemoAssetEntry {
  id: string; origin: 'imported' | 'generated'; kind: 'image' | 'video';
  /** Image file, relative to the project (served as ./assets/…). */
  file?: string;
  /** Video frame sequence: file names `pattern` with %05d = 1…count. */
  frames?: { pattern: string; count: number; fps: number; durationSeconds: number };
  width: number; height: number;
  /** sha256 of the staged bytes (image) or of the ordered frame hashes (video). */
  sha256: string;
  sourceSha256?: string;
  description: string; source: string; license: string;
  prompt?: string; transparent?: boolean;
}
export interface LemoAssetManifest { storydream: typeof LEMO_ASSET_MARKER; version: 1; fps: number; rules: string[]; assets: LemoAssetEntry[] }

export interface LemoAssetMedia {
  probe(path: string): Promise<{ width: number; height: number; durationSeconds: number | null }>;
  /** Write `<destDir>/f00001.jpg …` at `fps`, scaled to fit inside width×height. Returns the frame count. */
  frames(source: string, destDir: string, options: { fps: number; width: number; height: number }): Promise<number>;
  thumbnail(source: string, dest: string): Promise<void>;
}

export class LemoAssetError extends Error {}
const fail = (code: string, detail: string) => new LemoAssetError(`LEMO_ASSET_${code}: ${detail}`);
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest('hex');
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, path);
}

export const LEMO_ASSET_RULES = [
  'Files under assets/ are host-managed and read-only. Use them by relative URL, e.g. ./assets/a01.jpg; preload before window.READY.',
  'Video assets are JPEG frame sequences at 24 fps. Choose the frame from absolute film time inside render(t); never use <video> playback.',
  'Imported assets are the user\'s real material: do not alter their meaning, do not invent missing evidence, show source tags where the style asks for them.',
  'Generated assets (origin "generated") are illustrations only: never present them as photographs, documents or evidence.',
];

export async function readLemoAssetManifest(projectDir: string): Promise<LemoAssetManifest | undefined> {
  let text: string;
  try { text = await readFile(join(projectDir, ...LEMO_ASSET_MANIFEST.split('/')), 'utf8'); } catch (error) { if (missing(error)) return undefined; throw error; }
  let manifest: LemoAssetManifest;
  try { manifest = JSON.parse(text) as LemoAssetManifest; } catch { return undefined; }
  return manifest?.storydream === LEMO_ASSET_MARKER && manifest.version === 1 && Array.isArray(manifest.assets) ? manifest : undefined;
}
/** True only for a host-written manifest: older agent projects that happen to have assets/ keep their fingerprint. */
export async function hasLemoAssetChannel(projectDir: string) { return !!await readLemoAssetManifest(projectDir); }

async function framesDigest(dir: string, count: number) {
  const names = (await readdir(dir)).filter(name => /^f\d{5}\.jpg$/.test(name)).sort();
  if (names.length !== count) throw fail('INTEGRITY', `视频帧数量与清单不符：${dir}`);
  const hashes: string[] = [];
  for (const name of names) hashes.push(name + ':' + sha(await readFile(join(dir, name))));
  return sha(hashes.join('\n'));
}
async function entryDigest(projectDir: string, entry: LemoAssetEntry) {
  if (entry.frames) return framesDigest(join(projectDir, ...dirname(entry.frames.pattern).split('/')), entry.frames.count);
  if (!entry.file) throw fail('INTEGRITY', `素材 ${entry.id} 缺少文件。`);
  return sha256File(join(projectDir, ...entry.file.split('/')));
}

/** Re-hash every staged binary against the manifest. Throws LEMO_ASSET_INTEGRITY / LEMO_ASSET_MISSING. */
export async function verifyLemoAssets(projectDir: string): Promise<LemoAssetManifest | undefined> {
  const manifest = await readLemoAssetManifest(projectDir);
  if (!manifest) return undefined;
  for (const entry of manifest.assets) {
    let digest: string;
    try { digest = await entryDigest(projectDir, entry); } catch (error) {
      if (missing(error)) throw fail('MISSING', `已暂存的素材 ${entry.id} 文件丢失，请重新开始制作。`);
      throw error;
    }
    if (digest !== entry.sha256) throw fail('INTEGRITY', `已暂存的素材 ${entry.id} 被修改，请重新开始制作。`);
  }
  return manifest;
}

function sameImports(manifest: LemoAssetManifest, inputs: readonly LemoAssetInput[]) {
  const imported = manifest.assets.filter(entry => entry.origin === 'imported');
  return imported.length === inputs.length && inputs.every((input, index) => imported[index].id === input.id && imported[index].sourceSha256 === input.sha256);
}

export interface StageLemoAssetsOptions {
  projectDir: string; previewDir: string; inputs: readonly LemoAssetInput[];
  /** Absolute source path per input id (not part of the context hash: files may be moved; content is). */
  files: Readonly<Record<string, string>>;
  media: LemoAssetMedia; canvas: { width: number; height: number };
}

/** Idempotent. First call copies/extracts every input and writes MANIFEST.json last; later calls verify. */
export async function stageLemoAssets(options: StageLemoAssetsOptions): Promise<LemoAssetManifest> {
  const existing = await readLemoAssetManifest(options.projectDir);
  if (existing) {
    if (!sameImports(existing, options.inputs)) throw fail('CHANGED', '导入素材已变化；本次制作的回执作废，请重新开始制作。');
    return (await verifyLemoAssets(options.projectDir))!;
  }
  const root = join(options.projectDir, LEMO_ASSET_DIR);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await mkdir(options.previewDir, { recursive: true });
  const assets: LemoAssetEntry[] = [];
  for (const input of options.inputs) {
    if (!/^a\d{2}$/.test(input.id)) throw fail('ID', input.id);
    const source = options.files[input.id];
    let info;
    try { info = await stat(source); } catch { throw fail('MISSING', `找不到素材文件：${source ?? input.id}`); }
    if (!info.isFile()) throw fail('MISSING', `素材不是文件：${source}`);
    if (await sha256File(source) !== input.sha256) throw fail('CHANGED', `素材文件内容已变化：${source}`);
    const ext = extname(source).toLowerCase();
    const meta = { id: input.id, origin: 'imported' as const, kind: input.kind, sourceSha256: input.sha256, description: input.description, source: input.source, license: input.license };
    if (input.kind === 'image') {
      if (!IMAGE_EXT[ext]) throw fail('UNSUPPORTED', `图片格式不支持（仅 png / jpg / webp）：${source}`);
      if (info.size > LEMO_ASSET_IMAGE_MAX_BYTES) throw fail('TOO_LARGE', `图片超过 40 MB：${source}`);
      const file = `${LEMO_ASSET_DIR}/${input.id}${IMAGE_EXT[ext]}`;
      const target = join(options.projectDir, ...file.split('/'));
      await copyFile(source, target);
      const probe = await options.media.probe(target).catch(() => undefined);
      if (!probe?.width || !probe.height) throw fail('CORRUPT', `图片无法解码：${source}`);
      await options.media.thumbnail(target, join(options.previewDir, `${input.id}.jpg`));
      assets.push({ ...meta, file, width: probe.width, height: probe.height, sha256: input.sha256 });
    } else {
      if (!VIDEO_EXT.test(ext)) throw fail('UNSUPPORTED', `视频格式不支持（mp4 / mov / m4v / webm / mkv）：${source}`);
      const probe = await options.media.probe(source).catch(() => undefined);
      if (!probe?.width || !probe.height || !probe.durationSeconds) throw fail('CORRUPT', `视频无法解码：${source}`);
      if (probe.durationSeconds > LEMO_ASSET_VIDEO_MAX_SECONDS + 0.05) throw fail('TOO_LONG', `视频超过 ${LEMO_ASSET_VIDEO_MAX_SECONDS} 秒，请先剪短：${source}`);
      const dir = join(root, input.id);
      await mkdir(dir, { recursive: true });
      const count = await options.media.frames(source, dir, { fps: LEMO_ASSET_FPS, ...options.canvas });
      if (!count) throw fail('CORRUPT', `视频没有可用画面：${source}`);
      const first = join(dir, 'f00001.jpg');
      const still = await options.media.probe(first).catch(() => undefined);
      if (!still?.width || !still.height) throw fail('CORRUPT', `视频抽帧失败：${source}`);
      await options.media.thumbnail(join(dir, `f${String(Math.max(1, Math.ceil(count / 2))).padStart(5, '0')}.jpg`), join(options.previewDir, `${input.id}.jpg`));
      assets.push({ ...meta, frames: { pattern: `${LEMO_ASSET_DIR}/${input.id}/f%05d.jpg`, count, fps: LEMO_ASSET_FPS, durationSeconds: count / LEMO_ASSET_FPS },
        width: still.width, height: still.height, sha256: await framesDigest(dir, count) });
    }
  }
  const manifest: LemoAssetManifest = { storydream: LEMO_ASSET_MARKER, version: 1, fps: LEMO_ASSET_FPS, rules: LEMO_ASSET_RULES, assets };
  await atomicJson(join(options.projectDir, ...LEMO_ASSET_MANIFEST.split('/')), manifest);
  return manifest;
}

/** Append (idempotently) one generated illustration and return its manifest entry. */
export async function addGeneratedLemoAsset(options: { projectDir: string; previewDir: string; media: LemoAssetMedia;
  id: string; sourcePath: string; prompt: string; transparent: boolean; provider: string }): Promise<LemoAssetEntry> {
  const manifest = await readLemoAssetManifest(options.projectDir);
  if (!manifest) throw fail('CHANNEL', '素材通道未初始化。');
  const found = manifest.assets.find(entry => entry.id === options.id);
  // Replaying a received receipt must not depend on the provider's temporary file still existing.
  if (found?.origin === 'generated' && found.prompt === options.prompt) return found;
  if (found) throw fail('ID', `素材编号 ${options.id} 已被占用，请换一个。`);
  const bytes = await readFile(options.sourcePath);
  if (!bytes.length) throw fail('CORRUPT', '生成的图片为空。');
  const digest = sha(bytes);
  const file = `${LEMO_ASSET_DIR}/generated/${options.id}.png`;
  const target = join(options.projectDir, ...file.split('/'));
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, bytes); await rename(temp, target);
  const probe = await options.media.probe(target).catch(() => undefined);
  if (!probe?.width || !probe.height) throw fail('CORRUPT', '生成的图片无法解码。');
  await mkdir(options.previewDir, { recursive: true });
  await options.media.thumbnail(target, join(options.previewDir, `${options.id}.jpg`));
  const entry: LemoAssetEntry = { id: options.id, origin: 'generated', kind: 'image', file, width: probe.width, height: probe.height, sha256: digest,
    description: options.prompt.slice(0, 400), source: `AI generated · ${options.provider}`, license: 'Generated for this project', prompt: options.prompt, transparent: options.transparent };
  await atomicJson(join(options.projectDir, ...LEMO_ASSET_MANIFEST.split('/')), { ...manifest, assets: [...manifest.assets, entry] });
  return entry;
}

/** ffmpeg-only implementation (the bundled imageio ffmpeg; no ffprobe). */
export function createFfmpegLemoAssetMedia(ffmpegPath: string, signal?: AbortSignal): LemoAssetMedia {
  const { runProcess, tail } = lemoUpstreamVideoInternals;
  const run = async (args: string[], what: string) => {
    const result = await runProcess(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { signal, timeoutMs: 10 * 60_000 });
    if (result.code !== 0) throw fail('CORRUPT', `${what}失败：${tail(result.stderr, 3)}`);
  };
  return {
    async probe(path) {
      const result = await runProcess(ffmpegPath, ['-hide_banner', '-i', path], { signal, timeoutMs: 60_000 });
      const probe = parseFfmpegProbe(result.stderr);
      if (!probe.video) throw fail('CORRUPT', `无法读取画面：${path}`);
      return { width: probe.video.width, height: probe.video.height, durationSeconds: probe.durationSeconds };
    },
    async frames(source, destDir, options) {
      // Downscale only: small clips keep their native size (the film scales them as it likes).
      await run(['-i', source, '-an', '-vf', `fps=${options.fps},scale=w='min(iw,${options.width})':h='min(ih,${options.height})':force_original_aspect_ratio=decrease:flags=lanczos`,
        '-q:v', '3', '-start_number', '1', join(destDir, 'f%05d.jpg')], '视频抽帧');
      return (await readdir(destDir)).filter(name => /^f\d{5}\.jpg$/.test(name)).length;
    },
    async thumbnail(source, dest) {
      await mkdir(dirname(dest), { recursive: true });
      await run(['-i', source, '-frames:v', '1', '-vf', "scale='min(768,iw)':-2:flags=lanczos", '-q:v', '4', dest], '生成缩略图');
    },
  };
}
