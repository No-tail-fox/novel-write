import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  estimateMusicCost, MUSIC_MEDIA_FORMATS, MUSIC_MODELS, MUSIC_PROVIDER_ID, MUSIC_PROVIDER_NAME, musicLabDownloadInputSchema,
  musicLabGenerateInputSchema, musicLabRecordIdSchema, musicLabTrackInputSchema,
  type MusicBoostStyleInput, type MusicDownloadInput, type MusicGenerateInput,
  type MusicLabRecord, type MusicLyricsInput, type MusicServiceStatus, type MusicTrack, type MusicTrackInput,
} from '../src/shared/music-lab';
import { createMusicProvider, MusicProviderError, normalizeMusicApiBaseUrl, type MusicProvider, type MusicRemoteTrack } from '../src/shared/music-provider';
import {
  estimateMusicOperationCost, MUSIC_OPERATION_LABELS, musicOperationInputSchema, musicUploadSourceInputSchema,
  type MusicHistorySyncResult, type MusicOperationInput, type MusicOperationSource, type MusicUploadSourceInput,
} from '../src/shared/music-operations';
import { managedBgmMaxBytes } from './managed-bgm';

export interface MusicLabRuntimeOptions {
  dataDir: string;
  /** Absolute, main-owned storage root for this saved provider profile. */
  storageDirectory?: string;
  baseUrl?: string;
  resolveApiKey: () => string | Promise<string>;
  createProvider?: (apiKey: string, baseUrl: string) => MusicProvider;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  maxPollingMs?: number;
  autoPoll?: boolean;
  probeDuration?: (audioPath: string, workDirectory: string) => Promise<number>;
}
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const terminal = (track: MusicTrack) => track.status === 'completed' || track.status === 'failed';
function message(error: unknown): string {
  return (error instanceof Error ? error.message : '音乐任务处理失败。').replace(/Bearer\s+[^\s"']+/giu, 'Bearer [已隐藏]').slice(0, 2_000);
}
function assertInside(root: string, path: string): void {
  const child = relative(root, path);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('MUSIC_PATH_INVALID: 音乐素材路径无效。');
}
function updateStatus(record: MusicLabRecord): void {
  if (!record.tracks.length) return;
  if (record.tracks.every(terminal)) {
    const successes = record.tracks.filter((track) => track.status === 'completed').length;
    record.status = successes === record.tracks.length ? 'completed' : successes ? 'partial' : 'failed';
    record.finishedAt ??= new Date().toISOString();
  } else {
    record.status = 'processing'; record.finishedAt = null;
  }
}
function mergeTrack(track: MusicTrack, remote: MusicRemoteTrack): MusicTrack {
  return {
    ...track, ...remote,
    title: remote.title || track.title, lyrics: remote.lyrics || track.lyrics, style: remote.style || track.style,
    audioUrl: remote.audioUrl || track.audioUrl, imageUrl: remote.imageUrl || track.imageUrl,
    durationSec: remote.durationSec ?? track.durationSec,
    status: terminal(track) && !terminal(remote as MusicTrack) ? track.status : remote.status,
  };
}

export function createMusicLabRuntime(options: MusicLabRuntimeOptions) {
  if (options.storageDirectory !== undefined && !isAbsolute(options.storageDirectory)) throw new Error('MUSIC_STORAGE_PATH_INVALID: 音乐存储目录必须为绝对路径。');
  const root = options.storageDirectory === undefined ? resolve(options.dataDir, 'music-lab') : resolve(options.storageDirectory);
  const baseUrl = normalizeMusicApiBaseUrl(options.baseUrl);
  const submitting = new Set<string>();
  const locks = new Map<string, Promise<unknown>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const startedPolling = new Map<string, number>();
  const failures = new Map<string, number>();
  const pausedPolling = new Set<string>();
  let closed = false;
  const interval = Math.max(1000, options.pollIntervalMs ?? 5000);

  async function provider(): Promise<MusicProvider> {
    const apiKey = await options.resolveApiKey();
    return options.createProvider?.(apiKey, baseUrl) ?? createMusicProvider({ apiKey, baseUrl, fetchImpl: options.fetchImpl });
  }
  async function directory(id: string, create = false): Promise<string> {
    musicLabRecordIdSchema.parse(id);
    await mkdir(root, { recursive: true });
    if (create) await mkdir(join(root, id), { recursive: true });
    const [canonicalRoot, candidate] = await Promise.all([realpath(root), realpath(join(root, id))]);
    assertInside(canonicalRoot, candidate);
    return candidate;
  }
  async function save(record: MusicLabRecord): Promise<void> {
    const dir = await directory(record.id);
    record.updatedAt = new Date().toISOString();
    const temporary = join(dir, `record-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, join(dir, 'record.json'));
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }
  async function read(id: string): Promise<MusicLabRecord> {
    const dir = await directory(id);
    const path = await realpath(join(dir, 'record.json'));
    assertInside(dir, path);
    if ((await stat(path)).size > MAX_RECORD_BYTES) throw new Error('MUSIC_RECORD_INVALID: 音乐记录过大。');
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!isRecord(value) || value.id !== id) throw new Error('MUSIC_RECORD_INVALID: 音乐记录损坏。');
    for (const track of value.tracks) {
      for (const file of [track.localMp3Path, track.localWavPath, ...Object.values(track.mediaPaths ?? {})]) {
        if (!file) continue;
        assertInside(dir, resolve(file));
        const canonical = await realpath(file).catch(() => null);
        if (canonical) assertInside(dir, canonical);
      }
    }
    if (value.sourceUpload) {
      assertInside(dir, resolve(value.sourceUpload.localPath));
      const canonical = await realpath(value.sourceUpload.localPath).catch(() => null);
      if (canonical) assertInside(dir, canonical);
    }
    return value;
  }
  async function locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    locks.set(id, next);
    try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
  }
  function schedule(record: MusicLabRecord, delay = interval): void {
    if (closed || options.autoPoll === false || pausedPolling.has(record.id) || timers.has(record.id) || !record.tracks.some((track) => !terminal(track))) return;
    startedPolling.set(record.id, startedPolling.get(record.id) ?? Date.now());
    const timer = setTimeout(() => {
      timers.delete(record.id);
      void refreshInternal(record.id).catch(() => undefined);
    }, delay);
    timer.unref?.(); timers.set(record.id, timer);
  }
  async function refreshInternal(id: string): Promise<MusicLabRecord> {
    return locked(id, async () => {
      const record = await read(id);
      if (!record.tracks.length || record.tracks.every(terminal)) return record;
      const began = startedPolling.get(id) ?? Date.now();
      if (Date.now() - began > (options.maxPollingMs ?? 30 * 60_000)) {
        pausedPolling.add(id);
        record.status = 'needs-recovery'; record.errorMessage = '已暂停自动查询，云端可能仍在生成。点击刷新继续查询，不会再次提交生成。';
        await save(record); return record;
      }
      let nextDelay = interval;
      try {
        const remote = await (await provider()).query(record.tracks.map((track) => track.songId), record.model);
        const byId = new Map(remote.map((track) => [track.songId, track]));
        record.tracks = record.tracks.map((track) => byId.has(track.songId) ? mergeTrack(track, byId.get(track.songId)!) : track);
        record.errorMessage = ''; record.lastPolledAt = new Date().toISOString();
        failures.delete(id); updateStatus(record);
      } catch (error) {
        const count = (failures.get(id) ?? 0) + 1; failures.set(id, count);
        nextDelay = Math.max(Math.min(interval * 2 ** Math.min(count, 4), 60_000), error instanceof MusicProviderError ? error.retryAfterMs ?? 0 : 0);
        record.status = 'needs-recovery'; record.errorMessage = message(error);
      }
      await save(record); schedule(record, nextDelay); return record;
    });
  }

  async function listPersisted(): Promise<MusicLabRecord[]> {
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    const records: MusicLabRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !musicLabRecordIdSchema.safeParse(entry.name).success) continue;
      if (submitting.has(entry.name)) continue;
      records.push(await locked(entry.name, () => read(entry.name)));
    }
    return records;
  }
  async function measureDuration(audioPath: string, workDirectory: string): Promise<number | undefined> {
    try {
      let duration: number;
      if (options.probeDuration) duration = await options.probeDuration(audioPath, workDirectory);
      else {
        const { runStoryboundMediaSidecar } = await import('../src/shared/storybound-sidecar');
        const result = await runStoryboundMediaSidecar({ mode: 'probe_media', media_path: audioPath, work_dir: workDirectory, measure_audio_duration: true });
        duration = Number(result.audio_duration_ms) / 1000 || Number(result.duration);
      }
      return Number.isFinite(duration) && duration > 0 ? duration : undefined;
    } catch { return undefined; }
  }
  async function submitDerived(optionsForJob: {
    input: MusicGenerateInput;
    origin: NonNullable<MusicLabRecord['origin']>;
    estimatedCost: number;
    operation?: MusicOperationInput;
    prepare?: (record: MusicLabRecord, directory: string) => Promise<void>;
    submit: () => Promise<MusicRemoteTrack[]>;
  }): Promise<MusicLabRecord> {
    if (submitting.size >= 5) throw new Error('MUSIC_CONCURRENCY_LIMIT: 请等待当前提交完成。');
    const id = randomUUID(); const now = new Date().toISOString();
    const record: MusicLabRecord = { id, input: optionsForJob.input, origin: optionsForJob.origin,
      operation: optionsForJob.operation, estimatedCost: optionsForJob.estimatedCost,
      model: optionsForJob.input.model, providerId: MUSIC_PROVIDER_ID, providerName: MUSIC_PROVIDER_NAME,
      status: 'submitting', tracks: [], errorMessage: '', createdAt: now, updatedAt: now, finishedAt: null };
    submitting.add(id);
    try {
      const dir = await directory(id, true);
      await save(record);
      try { await optionsForJob.prepare?.(record, dir); await save(record); }
      catch (error) {
        record.status = 'failed'; record.errorMessage = message(error); record.finishedAt = new Date().toISOString(); await save(record); return record;
      }
      try {
        const tracks = await optionsForJob.submit();
        if (!tracks.length) throw new MusicProviderError('MUSIC_SUBMISSION_UNCONFIRMED: 未取得结果编号，请核对云端记录。');
        record.tracks = tracks.map((track) => ({ ...track, id: randomUUID(), downloadStatus: 'none' }));
        if (record.sourceUpload) {
          const duration = await measureDuration(record.sourceUpload.localPath, dir);
          for (const track of record.tracks) {
            track.durationSec ??= duration;
            const extension = extname(record.sourceUpload.localPath).toLowerCase();
            if (extension === '.mp3') track.localMp3Path = record.sourceUpload.localPath;
            if (extension === '.wav') track.localWavPath = record.sourceUpload.localPath;
          }
        }
        updateStatus(record);
      } catch (error) {
        record.status = error instanceof MusicProviderError && error.definitive ? 'failed' : 'needs-recovery';
        record.errorMessage = message(error); if (record.status === 'failed') record.finishedAt = new Date().toISOString();
      }
      await save(record); schedule(record); return record;
    } finally { submitting.delete(id); }
  }

  async function resolveSources(input: MusicOperationInput): Promise<MusicOperationSource[]> {
    const sources: MusicOperationSource[] = [];
    for (const reference of input.sources) {
      const record = await read(reference.recordId);
      const track = record.tracks.find((item) => item.id === reference.trackId);
      if (!track || track.status !== 'completed') throw new Error('MUSIC_SOURCE_NOT_READY: 来源必须是已完成的歌曲或已上传的源音频。');
      let durationSec = track.durationSec;
      const needsDuration = 'endSeconds' in input || input.operation === 'extend' || input.operation === 'fade';
      if (needsDuration && !durationSec) {
        const local = track.localMp3Path || track.localWavPath || record.sourceUpload?.localPath;
        if (local) durationSec = await measureDuration(local, await directory(record.id));
        if (!durationSec) {
          const refreshed = await (await provider()).query([track.songId], record.model);
          durationSec = refreshed.find((item) => item.songId === track.songId)?.durationSec;
        }
      }
      if (needsDuration && !durationSec) throw new Error('MUSIC_DURATION_REQUIRED: 暂时无法确认来源时长，请先下载该歌曲并刷新后重试。');
      if ('endSeconds' in input && durationSec && input.endSeconds > durationSec + 0.001) throw new Error('MUSIC_RANGE_INVALID: 编辑区间超出了来源歌曲时长。');
      if (input.operation === 'extend' && durationSec && input.continueAt >= durationSec) throw new Error('MUSIC_RANGE_INVALID: 续写起点必须早于歌曲结束时间。');
      if (input.operation === 'fade' && durationSec && input.durationSec > durationSec) throw new Error('MUSIC_RANGE_INVALID: 淡化时长不能超过歌曲时长。');
      sources.push({ songId: track.songId, title: track.title, audioUrl: track.audioUrl, durationSec });
    }
    if (new Set(sources.map((source) => source.songId)).size !== sources.length) throw new Error('MUSIC_SOURCE_DUPLICATED: 请选择不同的来源歌曲。');
    return sources;
  }

  return {
    async getServiceStatus(): Promise<MusicServiceStatus> {
      return { configured: Boolean((await options.resolveApiKey()).trim()), providerName: MUSIC_PROVIDER_NAME };
    },
    async getBalance() { return (await provider()).getBalance(); },
    async list(): Promise<MusicLabRecord[]> {
      await mkdir(root, { recursive: true });
      const entries = await readdir(root, { withFileTypes: true });
      const records: MusicLabRecord[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !musicLabRecordIdSchema.safeParse(entry.name).success) continue;
        const record = await locked(entry.name, async () => {
          const loaded = await read(entry.name).catch((error: unknown) => {
            if (submitting.has(entry.name) && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          });
          if (!loaded) return null;
          let changed = false;
          if (loaded.status === 'submitting' && !submitting.has(loaded.id)) {
            loaded.status = 'needs-recovery';
            loaded.errorMessage = '提交期间应用已关闭，无法确认云端是否接收。请核对云端记录后再决定是否创建新任务。'; changed = true;
          }
          for (const track of loaded.tracks) {
            if (track.downloadStatus === 'downloading') {
              track.downloadStatus = 'failed'; track.downloadError = '上次下载被中断，请重新下载，无需重新生成。'; changed = true;
            }
          }
          if (changed) await save(loaded);
          schedule(loaded); return loaded;
        });
        if (record) records.push(record);
      }
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async generate(raw: MusicGenerateInput): Promise<MusicLabRecord> {
      const input = musicLabGenerateInputSchema.parse(raw);
      // Resolve configuration before persisting a job; there is exactly one submission attempt.
      const service = await provider();
      if (submitting.size >= 5) throw new Error('MUSIC_CONCURRENCY_LIMIT: 请等待当前提交完成后再创建音乐。');
      const id = randomUUID(); const now = new Date().toISOString();
      const record: MusicLabRecord = {
        id, input, providerId: MUSIC_PROVIDER_ID, providerName: MUSIC_PROVIDER_NAME, model: input.model,
        status: 'submitting', tracks: [], estimatedCost: estimateMusicCost(input), errorMessage: '',
        createdAt: now, updatedAt: now, finishedAt: null,
      };
      submitting.add(id);
      try {
        await directory(id, true); await save(record);
        try {
          const tracks = await service.generate(input);
          record.tracks = tracks.map((track) => ({ ...track, id: randomUUID(), downloadStatus: 'none',
            title: track.title || (input.mode === 'description' ? '' : input.title ?? ''),
            lyrics: track.lyrics || (input.mode === 'custom' && !input.instrumental ? input.lyrics : ''),
            style: track.style || (input.mode === 'custom' ? input.style : ''),
          }));
          if (!record.tracks.length) throw new MusicProviderError('MUSIC_SUBMISSION_UNCONFIRMED: 未取得歌曲编号，请核对云端任务。');
          updateStatus(record);
        } catch (error) {
          record.status = error instanceof MusicProviderError && error.definitive ? 'failed' : 'needs-recovery';
          record.errorMessage = message(error);
          if (record.status === 'failed') record.finishedAt = new Date().toISOString();
        }
        await save(record); schedule(record); return record;
      } finally { submitting.delete(id); }
    },
    async refresh(id: string): Promise<MusicLabRecord> {
      musicLabRecordIdSchema.parse(id); pausedPolling.delete(id); startedPolling.set(id, Date.now());
      return refreshInternal(id);
    },
    async performOperation(raw: MusicOperationInput): Promise<MusicLabRecord> {
      const input = musicOperationInputSchema.parse(raw);
      const sources = await resolveSources(input); const service = await provider();
      const draft: MusicGenerateInput = { mode: 'description', model: input.model,
        description: `${MUSIC_OPERATION_LABELS[input.operation]}：${sources.map((source) => source.title || source.songId).join('、')}`,
        instrumental: 'instrumental' in input ? input.instrumental ?? false : input.operation === 'add-instrumental',
        maxMode: 'maxMode' in input ? input.maxMode ?? false : false, variety: 'variety' in input ? input.variety ?? 1 : 1,
      };
      return submitDerived({ input: draft, origin: 'operation', operation: input, estimatedCost: estimateMusicOperationCost(input),
        submit: () => service.performOperation(input, sources) });
    },
    async uploadSource(raw: MusicUploadSourceInput): Promise<MusicLabRecord> {
      const input = musicUploadSourceInputSchema.parse(raw);
      const sourcePath = await realpath(input.audioPath);
      const allowed = await Promise.all([root, join(options.dataDir, 'bgm')].map((path) => realpath(path).catch(() => null)));
      if (!allowed.some((base) => {
        if (!base) return false; try { assertInside(base, sourcePath); return true; } catch { return false; }
      })) throw new Error('MUSIC_UPLOAD_PATH_INVALID: 请先通过本地音频选择器导入受管素材。');
      const sourceStat = await stat(sourcePath); const extension = extname(sourcePath).toLowerCase();
      if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > managedBgmMaxBytes
        || !['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(extension)) throw new Error('MUSIC_UPLOAD_FILE_INVALID: 音频须为 256 MB 以内的 MP3、WAV、M4A、AAC、OGG 或 FLAC。');
      const bytes = new Uint8Array(await readFile(sourcePath));
      const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12));
      const valid = header.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
        || header.startsWith('RIFF') && header.slice(8, 12) === 'WAVE' || header.slice(4, 8) === 'ftyp'
        || header.startsWith('OggS') || header.startsWith('fLaC');
      if (!valid || bytes.length !== sourceStat.size) throw new Error('MUSIC_UPLOAD_FILE_INVALID: 无法识别音频内容或读取期间文件发生变化。');
      const title = input.title || basename(sourcePath, extension); const service = await provider();
      return submitDerived({ input: { mode: 'description', model: input.model, description: `上传源音频：${title}`, instrumental: false, maxMode: false, variety: 1 },
        origin: 'upload', estimatedCost: 0,
        prepare: async (record, dir) => {
          const path = join(dir, `source${extension}`); await writeFile(path, bytes, { flag: 'wx' });
          record.sourceUpload = { fileName: basename(sourcePath), localPath: path };
        },
        submit: () => service.uploadSource({ bytes, fileName: basename(sourcePath), title, model: input.model }),
      });
    },
    async syncHistory(): Promise<MusicHistorySyncResult> {
      return locked('history-sync', async () => {
        if (submitting.size > 0) throw new Error('MUSIC_HISTORY_BUSY: 音乐正在提交，请等待提交完成后再同步云端记录。');
        const service = await provider(); const existing = await listPersisted();
        const index = new Map<string, { record: MusicLabRecord; track: MusicTrack }>();
        for (const record of existing) for (const track of record.tracks) index.set(track.songId, { record, track });
        let added = 0; let updated = 0; const touched = new Set<string>();
        for (let page = 1; page <= 100; page += 1) {
          const result = await service.getHistoryPage(page); let unseen = 0;
          for (const track of result.tracks) {
            if (touched.has(track.songId)) continue;
            unseen += 1;
            const found = index.get(track.songId);
            if (found) {
              await locked(found.record.id, async () => {
                const record = await read(found.record.id);
                record.tracks = record.tracks.map((item) => item.songId === track.songId ? mergeTrack(item, track) : item);
                updateStatus(record); await save(record); schedule(record);
              });
              updated += 1;
            } else {
              const id = randomUUID(); const now = new Date().toISOString(); const model = track.model ?? 'suno-v6';
              const record: MusicLabRecord = { id, providerId: MUSIC_PROVIDER_ID, providerName: MUSIC_PROVIDER_NAME, model,
                input: { mode: 'description', model, description: track.title || '云端音乐', instrumental: false, maxMode: false, variety: 1 },
                origin: 'history', status: 'processing', tracks: [{ ...track, id: randomUUID(), downloadStatus: 'none' }], estimatedCost: 0,
                errorMessage: '', createdAt: now, updatedAt: now, finishedAt: null };
              updateStatus(record); await directory(id, true); await save(record); schedule(record);
              index.set(track.songId, { record, track: record.tracks[0] }); added += 1;
            }
            touched.add(track.songId);
          }
          // Stop repeated provider pages even if a server ignores pagination parameters.
          if (!result.hasMore || result.tracks.length === 0 || unseen === 0) break;
        }
        return { records: (await listPersisted()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), added, updated };
      });
    },
    async importSongs(songIds: string[], model: import('../src/shared/music-lab').MusicModel = 'suno-v6'): Promise<void> {
      const remote = await (await provider()).query(songIds, model);
      if (songIds.some((songId) => !remote.some((track) => track.songId === songId))) throw new Error('MUSIC_IMPORT_INCOMPLETE: 部分歌曲仍未就绪，请稍后再次查询以导入完整结果。');
      await locked('history-sync', async () => {
        const existing = await listPersisted();
        const known = new Map(existing.flatMap((record) => record.tracks.map((track) => [track.songId, record.id] as const)));
        for (const track of remote) {
          const existingId = known.get(track.songId);
          if (existingId) {
            await locked(existingId, async () => {
              const record = await read(existingId);
              record.tracks = record.tracks.map((item) => item.songId === track.songId ? mergeTrack(item, track) : item);
              updateStatus(record); await save(record); schedule(record);
            });
            continue;
          }
          const id = randomUUID(); const now = new Date().toISOString();
          const record: MusicLabRecord = { id, providerId: MUSIC_PROVIDER_ID, providerName: MUSIC_PROVIDER_NAME, model,
            input: {mode:'description',model,description:track.title || '导入音乐',instrumental:false,maxMode:false,variety:1},
            origin:'history',status:'processing',tracks:[{...track,id:randomUUID(),downloadStatus:'none'}],estimatedCost:0,errorMessage:'',createdAt:now,updatedAt:now,finishedAt:null };
          updateStatus(record); await directory(id,true); await save(record); schedule(record); known.set(track.songId, id);
        }
      });
    },
    async generateLyrics(input: MusicLyricsInput) { return (await provider()).generateLyrics(input); },
    async boostStyle(input: MusicBoostStyleInput) { return (await provider()).boostStyle(input); },
    async downloadTrack(raw: MusicDownloadInput): Promise<MusicLabRecord> {
      const input = musicLabDownloadInputSchema.parse(raw);
      return locked(input.recordId, async () => {
        const record = await read(input.recordId);
        const track = record.tracks.find((item) => item.id === input.trackId);
        if (!track || track.status !== 'completed') throw new Error('MUSIC_TRACK_NOT_READY: 请选择已完成的歌曲。');
        if (input.format === 'midi' && !track.stemType && !['separate','vocal-removal'].includes(record.operation?.operation ?? '')) throw new Error('MIDI 只能从已完成的分轨轨道导出。');
        const existing = input.format === 'mp3' ? track.localMp3Path : input.format === 'wav' ? track.localWavPath : track.mediaPaths?.[input.format];
        if (existing && await stat(existing).then((item) => item.isFile() && item.size > 0).catch(() => false)) {
          track.downloadStatus = 'completed'; track.downloadError = ''; await save(record); return record;
        }
        track.downloadStatus = 'downloading'; track.downloadError = ''; await save(record);
        const dir = await directory(record.id);
        const extension = {mp3:'mp3',wav:'wav',lyrics:'txt',lrc:'lrc',midi:'mid',cover:'image',mp4:'mp4'}[input.format];
        let path = join(dir, `${track.id}.${extension}`);
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          const bytes = await (await provider()).download(track.songId, input.format, record.model);
          if (input.format === 'cover') { const head = new TextDecoder('ascii').decode(bytes.subarray(0,12)); path = join(dir, `${track.id}.${bytes[0] === 0x89 ? 'png' : head.startsWith('RIFF') ? 'webp' : 'jpg'}`); }
          await writeFile(temporary, bytes, { flag: 'wx' });
          await rename(temporary, path);
          if (input.format === 'mp3') track.localMp3Path = path;
          else if (input.format === 'wav') track.localWavPath = path;
          track.mediaPaths = { ...track.mediaPaths, [input.format]: path };
          track.downloadStatus = 'completed';
        } catch (error) { track.downloadStatus = 'failed'; track.downloadError = message(error); }
        finally { await rm(temporary, { force: true }).catch(() => undefined); }
        await save(record); return record;
      });
    },
    async markTrackAsBgm(raw: MusicTrackInput, bgmId: string): Promise<MusicLabRecord> {
      const input = musicLabTrackInputSchema.parse(raw);
      if (!bgmId.trim() || bgmId.length > 256) throw new Error('MUSIC_BGM_ID_INVALID: 配乐编号无效。');
      return locked(input.recordId, async () => {
        const record = await read(input.recordId); const track = record.tracks.find((item) => item.id === input.trackId);
        if (!track || !track.localMp3Path && !track.localWavPath) throw new Error('MUSIC_TRACK_NOT_LOCAL: 请先下载歌曲。');
        track.bgmId = bgmId; await save(record); return record;
      });
    },
    async getTrackLocalPath(raw: MusicTrackInput): Promise<string> {
      const input = musicLabTrackInputSchema.parse(raw);
      const record = await read(input.recordId);
      const track = record.tracks.find((item) => item.id === input.trackId);
      for (const path of [track?.localMp3Path, track?.localWavPath]) {
        if (path && await stat(path).then((item) => item.isFile() && item.size > 0).catch(() => false)) return path;
      }
      throw new Error('MUSIC_TRACK_NOT_LOCAL: 歌曲尚未下载完成，请先重试下载。');
    },
    async getOutputDirectory(id: string): Promise<string> { await read(id); return directory(id); },
    close(): void { closed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); },
  };
}

function isRecord(value: unknown): value is MusicLabRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<MusicLabRecord>;
  return musicLabRecordIdSchema.safeParse(record.id).success && musicLabGenerateInputSchema.safeParse(record.input).success
    && (record.operation === undefined || musicOperationInputSchema.safeParse(record.operation).success)
    && (record.origin === undefined || ['generated', 'operation', 'upload', 'history'].includes(record.origin))
    && (record.sourceUpload === undefined || Boolean(record.sourceUpload && typeof record.sourceUpload.localPath === 'string' && typeof record.sourceUpload.fileName === 'string'))
    && MUSIC_MODELS.includes(record.model!) && record.providerId === MUSIC_PROVIDER_ID && typeof record.providerName === 'string'
    && (record.finishedAt === null || typeof record.finishedAt === 'string')
    && ['submitting', 'processing', 'completed', 'partial', 'failed', 'needs-recovery'].includes(record.status ?? '')
    && typeof record.createdAt === 'string' && typeof record.updatedAt === 'string' && typeof record.errorMessage === 'string'
    && typeof record.estimatedCost === 'number' && Number.isFinite(record.estimatedCost)
    && Array.isArray(record.tracks) && record.tracks.length <= 100 && record.tracks.every((track) =>
      track && musicLabRecordIdSchema.safeParse(track.id).success && typeof track.songId === 'string' && track.songId.length > 0
      && ['pending', 'processing', 'completed', 'failed'].includes(track.status)
      && ['none', 'downloading', 'completed', 'failed'].includes(track.downloadStatus)
      && [track.title, track.lyrics, track.style, track.providerStatus].every((item) => typeof item === 'string')
      && [track.localMp3Path, track.localWavPath].every((item) => item === undefined || typeof item === 'string')
      && (track.mediaPaths === undefined || track.mediaPaths !== null && typeof track.mediaPaths === 'object' && !Array.isArray(track.mediaPaths)
        && Object.entries(track.mediaPaths).every(([format, path]) => MUSIC_MEDIA_FORMATS.includes(format as typeof MUSIC_MEDIA_FORMATS[number]) && typeof path === 'string' && isAbsolute(path))));
}
