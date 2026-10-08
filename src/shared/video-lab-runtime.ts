import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { normalizeAppError } from './app-error';
import type { AppConfig } from './types';
import { createConfiguredVideoProvider, requiredVideoCapabilities, validateVideoGenerationRequest } from './video-provider';
import { isRemoteVideoReference, videoLabGenerateInputSchema, videoLabProviderConfig, videoLabRecordIdSchema, type VideoLabGenerateInput, type VideoLabRecord } from './video-lab';

const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;
const MAX_INLINE_REFERENCE_BYTES = 45 * 1024 * 1024;
const MAX_RECORD_BYTES = 512 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export interface VideoLabRuntimeOptions {
  rootDirectory: string;
  getConfig: () => Promise<AppConfig>;
  createProvider?: typeof createConfiguredVideoProvider;
  normalizeVideo?: (sourcePath: string, outputPath: string) => Promise<unknown>;
}

export function createVideoLabRuntime(options: VideoLabRuntimeOptions) {
  const root = resolve(options.rootDirectory);
  const active = new Set<string>();
  const createdThisSession = new Set<string>();

  async function directory(id: string, create = false): Promise<string> {
    videoLabRecordIdSchema.parse(id);
    if (create) await mkdir(join(root, id), { recursive: true });
    const canonicalRoot = await realpath(root);
    const candidate = await realpath(join(root, id));
    assertInside(canonicalRoot, candidate);
    return candidate;
  }

  async function save(record: VideoLabRecord): Promise<void> {
    const dir = await directory(record.id);
    const temporary = join(dir, `record-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, join(dir, 'record.json'));
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async function read(id: string): Promise<VideoLabRecord> {
    const dir = await directory(id);
    const recordPath = await realpath(join(dir, 'record.json'));
    assertInside(dir, recordPath);
    if ((await stat(recordPath)).size > MAX_RECORD_BYTES) throw new Error('VIDEO_LAB_RECORD_INVALID: 视频生成记录过大。');
    const value: unknown = JSON.parse(await readFile(recordPath, 'utf8'));
    if (!isVideoLabRecord(value) || value.id !== id) throw new Error('VIDEO_LAB_RECORD_INVALID: 视频生成记录损坏。');
    if (value.videoPath) {
      assertInside(dir, resolve(value.videoPath));
      const canonicalVideo = await realpath(value.videoPath).catch(() => null);
      if (canonicalVideo) assertInside(dir, canonicalVideo);
    }
    return value;
  }

  return {
    async listRecords(): Promise<VideoLabRecord[]> {
      await mkdir(root, { recursive: true });
      const entries = await readdir(root, { withFileTypes: true });
      const records: VideoLabRecord[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !videoLabRecordIdSchema.safeParse(entry.name).success) continue;
        const record = await read(entry.name).catch((error: unknown) => {
          if (active.has(entry.name) && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        });
        if (!record) continue;
        if (record.status === 'running' && !createdThisSession.has(record.id)) {
          record.status = 'failed';
          record.errorMessage = '应用关闭前未能确认生成结果，请检查服务端任务状态后再手动重试。';
          record.finishedAt = new Date().toISOString();
          await save(record);
        }
        records.push(record);
      }
      return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    async generate(raw: VideoLabGenerateInput): Promise<VideoLabRecord> {
      const input = videoLabGenerateInputSchema.parse(raw);
      const id = randomUUID();
      active.add(id);
      createdThisSession.add(id);
      const record: VideoLabRecord = {
        ...input, id, status: 'running', providerId: input.providerId ?? '', providerName: '', model: '',
        videoPath: '', errorMessage: '', createdAt: new Date().toISOString(), finishedAt: null, estimatedCost: 0,
      };
      try {
        const dir = await directory(id, true);
        await save(record);
        try {
          const originalConfig = await options.getConfig();
          const selected = originalConfig.video.providers.find((provider) => provider.id === (input.providerId ?? originalConfig.video.activeProviderId));
          record.providerId = selected?.id ?? input.providerId ?? '';
          record.providerName = selected?.name ?? '';
          record.model = selected?.model ?? '';
          const config = videoLabProviderConfig(originalConfig, input.providerId);
          validateVideoGenerationRequest(config.video.providers[0], input);
          const ownedReferences = new Map<string, string>();
          let referenceBytes = 0;
          const snapshotReference = async (source: string, kind: 'image' | 'video' | 'audio') => {
            if (isRemoteVideoReference(source)) return source;
            const existing = ownedReferences.get(source);
            if (existing) return existing;
            const copied = await copyReferenceMedia(source, dir, ownedReferences.size, kind);
            referenceBytes += (await stat(copied)).size;
            if (referenceBytes > MAX_INLINE_REFERENCE_BYTES) throw new Error('VIDEO_LAB_REFERENCE_INVALID: 本地参考素材合计不能超过 45 MB。');
            ownedReferences.set(source, copied);
            return copied;
          };
          const legacyImages = input.referenceImagePaths ?? [];
          const referenceImages = input.referenceImages ?? legacyImages.map((path) => ({ path, kind: 'style' as const, description: '' }));
          const ownedImages = [];
          for (const reference of referenceImages) ownedImages.push({ ...reference, path: await snapshotReference(reference.path, 'image') });
          const referenceVideoPaths = [];
          for (const source of input.referenceVideoPaths ?? []) referenceVideoPaths.push(await snapshotReference(source, 'video'));
          const referenceAudioPaths = [];
          for (const source of input.referenceAudioPaths ?? []) referenceAudioPaths.push(await snapshotReference(source, 'audio'));
          const request = {
            prompt: input.prompt, durationSec: input.durationSec, ratio: input.ratio,
            ...(input.resolution ? { resolution: input.resolution } : {}),
            ...(input.generateAudio !== undefined ? { generateAudio: input.generateAudio } : {}),
            ...(input.firstFramePath ? { firstFramePath: await snapshotReference(input.firstFramePath, 'image') } : {}),
            ...(input.lastFramePath ? { lastFramePath: await snapshotReference(input.lastFramePath, 'image') } : {}),
            ...(legacyImages.length ? { referenceImagePaths: ownedImages.map((reference) => reference.path) } : {}),
            ...(ownedImages.length ? { referenceImages: ownedImages } : {}),
            ...(referenceVideoPaths.length ? { referenceVideoPaths } : {}),
            ...(referenceAudioPaths.length ? { referenceAudioPaths } : {}),
          };
          Object.assign(record, request);
          const provider = (options.createProvider ?? createConfiguredVideoProvider)(config, dir, {
            durationSec: input.durationSec, requiredCapabilities: requiredVideoCapabilities(request),
            remainingBudget: config.video.automation.budgetLimit,
          }, { submitRetryCount: 0 });
          record.estimatedCost = provider.estimateCost(input.durationSec);
          await save(record);
          const generated = await provider.generate(request);
          const generatedPath = await realpath(generated.path);
          assertInside(dir, generatedPath);
          if (!(await stat(generatedPath)).isFile() || (await stat(generatedPath)).size <= 0) {
            throw new Error('VIDEO_LAB_OUTPUT_INVALID: 视频文件不存在或为空。');
          }
          let videoPath = generatedPath;
          if (options.normalizeVideo) {
            videoPath = join(dir, 'video.mp4');
            await options.normalizeVideo(generatedPath, videoPath);
          }
          Object.assign(record, {
            status: 'completed', videoPath, providerId: generated.providerId, providerName: generated.providerName,
            model: generated.model, estimatedCost: generated.estimatedCost, remoteTaskId: generated.remoteTaskId,
            finishedAt: new Date().toISOString(),
          });
        } catch (error) {
          record.status = 'failed';
          record.errorMessage = normalizeAppError(error, { message: '视频生成失败，请检查服务配置后重试。' }).message.slice(0, 8192);
          record.finishedAt = new Date().toISOString();
        }
        await save(record);
        return record;
      } finally {
        active.delete(id);
      }
    },

    async outputDirectory(id: string): Promise<string> {
      await read(id);
      return directory(id);
    },
  };
}

function assertInside(root: string, path: string): void {
  const child = relative(root, path);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error('VIDEO_LAB_PATH_INVALID: 视频文件必须保存在当前生成记录的目录内。');
  }
}

async function copyReferenceMedia(source: string, dir: string, index: number, kind: 'image' | 'video' | 'audio'): Promise<string> {
  if (!isAbsolute(source)) throw new Error('VIDEO_LAB_REFERENCE_INVALID: 请选择本地参考素材。');
  const path = await realpath(source);
  const extension = extname(path).toLowerCase();
  const info = await stat(path);
  const allowed = kind === 'image' ? IMAGE_EXTENSIONS : kind === 'video' ? new Set(['.mp4', '.mov']) : new Set(['.wav', '.mp3']);
  if (!allowed.has(extension) || !info.isFile() || info.size <= 0 || info.size > MAX_REFERENCE_BYTES) throw new Error('VIDEO_LAB_REFERENCE_INVALID: 参考素材格式或大小不符合要求。');
  const bytes = await readFile(path);
  const detectedExtension = kind === 'image'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? '.png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? '.jpg'
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? '.webp' : ''
    : kind === 'video' ? bytes.subarray(4, 8).toString('ascii') === 'ftyp' ? extension : ''
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE' ? '.wav'
        : bytes.subarray(0, 3).toString('ascii') === 'ID3' || bytes[0] === 0xff ? '.mp3' : '';
  if (!detectedExtension || bytes.length > MAX_REFERENCE_BYTES) throw new Error(kind === 'image'
    ? 'VIDEO_LAB_REFERENCE_INVALID: 无法识别参考图文件。'
    : 'VIDEO_LAB_REFERENCE_INVALID: 无法识别参考媒体文件。');
  const target = join(dir, `reference-${index}${detectedExtension}`);
  await writeFile(target, bytes, { flag: 'wx' });
  return target;
}

function isVideoLabRecord(value: unknown): value is VideoLabRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<VideoLabRecord>;
  return videoLabRecordIdSchema.safeParse(record.id).success
    && ['running', 'completed', 'failed'].includes(record.status ?? '')
    && typeof record.prompt === 'string' && typeof record.durationSec === 'number'
    && typeof record.ratio === 'string' && typeof record.providerId === 'string'
    && typeof record.providerName === 'string' && typeof record.model === 'string'
    && typeof record.videoPath === 'string' && typeof record.errorMessage === 'string'
    && typeof record.createdAt === 'string' && (record.finishedAt === null || typeof record.finishedAt === 'string')
    && typeof record.estimatedCost === 'number';
}
