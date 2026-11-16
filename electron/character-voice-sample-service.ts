import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { CHARACTER_VOICE_SAMPLE_ASSET_PREFIX, CHARACTER_VOICE_SAMPLE_MAX_BYTES, CHARACTER_VOICE_SAMPLE_MAX_DURATION_MS, importCharacterVoiceSampleSchema, type ImportCharacterVoiceSampleInput } from '../src/shared/character-voice-sample';
import { parseMotionComicPipelineData, type MotionComicSaveInput } from '../src/shared/motion-comic';
import type { Task } from '../src/shared/types';
import type { ProductionHistoryReservation } from '../src/shared/production-history';
import { resolveFinalFilmFfmpeg } from './final-film-gate-runner';
import { lemoUpstreamVideoInternals, parseFfmpegProbe } from './lemo-upstream-video';

/** Local-only probe and full decode. No provider/config/credentials are involved. */
export async function inspectCharacterVoiceSample(path: string, ffmpegPath?: string): Promise<number> {
  const binaries = await resolveFinalFilmFfmpeg(ffmpegPath ? { ffmpegPath } : {});
  if (!binaries) throw new Error('CHARACTER_VOICE_SAMPLE_RUNTIME: 本地音频解码工具不可用。');
  const run = lemoUpstreamVideoInternals.runProcess;
  const probeResult = await run(binaries.ffmpegPath, ['-hide_banner', '-nostdin', '-i', path], { timeoutMs: 30_000 });
  const probe = parseFfmpegProbe(probeResult.stderr);
  const format = /Input #0, ([^,]+), from/.exec(probeResult.stderr)?.[1];
  if (format !== extname(path).slice(1).toLowerCase() || !['mp3', 'wav'].includes(format ?? '')) {
    throw new Error('CHARACTER_VOICE_SAMPLE_FORMAT: 文件内容与 MP3/WAV 扩展名不匹配。');
  }
  const durationMs = Math.round((probe.durationSeconds ?? 0) * 1000);
  if (!probe.audio || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > CHARACTER_VOICE_SAMPLE_MAX_DURATION_MS) {
    throw new Error('CHARACTER_VOICE_SAMPLE_DURATION: 请选择时长大于 0 且不超过 60 秒的有效音频。');
  }
  const decoded = await run(binaries.ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', path, '-map', '0:a:0', '-vn', '-f', 'null', '-'], { timeoutMs: 60_000 });
  if (decoded.code !== 0) throw new Error('CHARACTER_VOICE_SAMPLE_DECODE: 音频无法完整解码。');
  return durationMs;
}

export interface CharacterVoiceSampleDependencies {
  getTask(id: string): Promise<Task | null>;
  selectFile(): Promise<string | null>;
  workDir(task: Task): string;
  save(input: MotionComicSaveInput): Promise<Task>;
  reserve(document: ReturnType<typeof parseMotionComicPipelineData>): ProductionHistoryReservation;
  beginActivity(id: string): () => void;
  inspect?: (path: string) => Promise<number>;
}

/** Returns the committed task; null means dialog cancellation and has no disk/database writes. */
export async function importCharacterVoiceSample(input: ImportCharacterVoiceSampleInput, deps: CharacterVoiceSampleDependencies): Promise<Task | null> {
  const request = importCharacterVoiceSampleSchema.parse(input);
  const task = await deps.getTask(request.taskId);
  if (!task || task.taskType !== 'motion-comic') throw new Error('CHARACTER_VOICE_SAMPLE_TASK: 漫剧项目不存在。');
  if (task.archivedAt || task.status === 'running' || task.status === 'pending') throw new Error('CHARACTER_VOICE_SAMPLE_READONLY: 当前项目不可编辑。');
  const document = parseMotionComicPipelineData(task.pipelineData);
  if (document.updatedAt !== request.expectedUpdatedAt) throw new Error('MOTION_COMIC_STALE_WRITE: 请保存最新项目后重试。');
  if (!document.characters.some(character => character.id === request.characterId)) throw new Error('CHARACTER_VOICE_SAMPLE_CHARACTER: 角色不存在。');
  const reservation = deps.reserve(document);
  let finish: (() => void) | undefined;
  let temporary: string | undefined;
  let destination: string | undefined;
  let committed = false;
  try {
    finish = deps.beginActivity(task.id);
    const source = await deps.selectFile();
    if (!source) return null;
    const extension = extname(source).toLowerCase();
    if (!isAbsolute(source) || !['.mp3', '.wav'].includes(extension)) throw new Error('CHARACTER_VOICE_SAMPLE_FORMAT: 仅支持 MP3 或 WAV。');
    const info = await stat(source);
    if (!info.isFile() || info.size <= 0 || info.size > CHARACTER_VOICE_SAMPLE_MAX_BYTES) throw new Error('CHARACTER_VOICE_SAMPLE_SIZE: 样本不能为空且不能超过 20 MiB。');
    const directory = join(deps.workDir(task), 'character-voice-samples');
    await mkdir(directory, { recursive: true });
    const id = randomUUID();
    destination = join(directory, `${id}${extension}`);
    temporary = join(directory, `.${id}.tmp${extension}`);
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    const copied = await stat(temporary);
    if (copied.size !== info.size || copied.size > CHARACTER_VOICE_SAMPLE_MAX_BYTES) throw new Error('CHARACTER_VOICE_SAMPLE_COPY: 样本复制不完整。');
    const durationMs = await (deps.inspect ?? inspectCharacterVoiceSample)(temporary);
    const sha256 = createHash('sha256').update(await readFile(temporary)).digest('hex');
    await rename(temporary, destination);
    temporary = undefined;
    const saved = await deps.save({ id: task.id, expectedUpdatedAt: request.expectedUpdatedAt, document: {
      ...document,
      assets: [...document.assets, { id, assetId: `${CHARACTER_VOICE_SAMPLE_ASSET_PREFIX}${request.characterId}`, kind: 'audio', localPath: destination, durationMs, sha256, createdAt: new Date().toISOString() }],
      characters: document.characters.map(character => character.id === request.characterId ? { ...character, voiceSampleAssetVersionId: id } : character),
    } });
    committed = true;
    reservation.consume({ assets: 1 });
    return saved;
  } finally {
    // Paths are generated UUID children of the task-owned sample directory only.
    try {
      if (temporary) await rm(temporary, { force: true });
      if (destination && !committed) await rm(destination, { force: true });
    } finally {
      try { reservation.release(); } finally { finish?.(); }
    }
  }
}
