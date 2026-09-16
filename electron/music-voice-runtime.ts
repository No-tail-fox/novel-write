import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fetchWithTimeout } from '../src/shared/http';
import { musicVoiceRequestSchema, type MusicVoiceRequest, type MusicVoiceState, type MusicVoiceTask } from '../src/shared/music-voice';
import { MUSIC_MODELS, type MusicModel } from '../src/shared/music-lab';
import { normalizeMusicApiBaseUrl } from '../src/shared/music-provider';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
export function normalizeMusicVoice(value: unknown): MusicVoiceTask {
  const result = object(value); const data = object(result.data ?? value); const voice = object(data.voice ?? data.task ?? data);
  const id = Number(voice.voice_task_id ?? voice.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('服务未返回有效的人声任务编号。');
  return { id, name: text(voice.voice_name), description: text(voice.description), style: text(voice.style), language: text(voice.language), status: text(voice.status ?? voice.voice_status ?? voice.validate_status), validationText: text(voice.validate_info), available: voice.is_available === true, voiceId: text(voice.voice_id), error: text(voice.error_message), updatedAt: new Date().toISOString() };
}
export function createMusicVoiceRuntime(options: { dataDir: string; storageDirectory?: string; baseUrl?: string; resolveApiKey: () => Promise<string>; onSongsReady: (songIds: string[], model: MusicModel) => Promise<unknown>; fetchImpl?: typeof fetch }) {
  if (options.storageDirectory !== undefined && !isAbsolute(options.storageDirectory)) throw new Error('MUSIC_STORAGE_PATH_INVALID: 人声存储目录必须为绝对路径。');
  const root = options.storageDirectory === undefined ? resolve(options.dataDir, 'music-voices') : resolve(options.storageDirectory);
  const baseUrl = normalizeMusicApiBaseUrl(options.baseUrl);
  const file = join(root, 'voices.json');
  let queue: Promise<unknown> = Promise.resolve();
  async function load(): Promise<MusicVoiceState> {
    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as MusicVoiceState;
      if (!Array.isArray(value.voices) || !Array.isArray(value.jobs)) throw new Error('人声记录格式损坏。');
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { voices: [], jobs: [] }; throw error; }
  }
  async function save(state: MusicVoiceState) {
    await mkdir(root, { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8'); await rename(tmp, file);
  }
  async function audio(audioPath: string) {
    const path = await realpath(audioPath);
    const bgmRoot = await realpath(join(options.dataDir, 'bgm'));
    const rel = relative(bgmRoot, path);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('请使用“选择录音”导入受管音频。');
    if (!['.mp3','.wav','.m4a','.aac','.ogg','.flac'].includes(extname(path).toLowerCase())) throw new Error('请选择有效的音频文件。');
    const info = await stat(path); if (!info.isFile() || info.size < 16 || info.size > 80 * 1024 * 1024) throw new Error('录音需大于 16 字节且不超过 80 MB。');
    const bytes = await readFile(path); const head = bytes.subarray(0, 12).toString('ascii');
    const valid = head.startsWith('ID3') || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
      || head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE' || head.slice(4, 8) === 'ftyp' || head.startsWith('OggS') || head.startsWith('fLaC');
    if (!valid || bytes.length !== info.size) throw new Error('录音内容无法识别或读取时发生变化，请重新选择音频。');
    return { file_base64: bytes.toString('base64'), file_name: basename(path) };
  }
  async function execute(input: MusicVoiceRequest): Promise<MusicVoiceState> {
    input = musicVoiceRequestSchema.parse(input);
    const state = await load();
    if (input.action === 'list') {
      let changed = false;
      for (const job of state.jobs) if (job.status === 'submitting') { job.status = 'needs-recovery'; job.error = '应用在提交期间关闭，请在网站核对本次任务，勿重复提交。'; changed = true; }
      if (changed) await save(state);
      return state;
    }
    const apiKey = (await options.resolveApiKey()).trim(); if (!apiKey) throw new Error('尚未配置音乐服务。');
    const redact = (value: string) => value.split(apiKey).join('[已隐藏]').slice(0, 2000);
    async function request(path: string, method = 'GET', body?: unknown, idempotencyKey?: string) {
      try {
        const response = await fetchWithTimeout(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), timeoutMs: 120000, maxBytes: 4 * 1024 * 1024, maxRedirects: 0, fetchImpl: options.fetchImpl });
        const value: unknown = await response.json(); const result = object(value);
        if (!response.ok || result.success === false || result.error || (result.code !== undefined && ![0,200,'0','200'].includes(result.code as number | string))) throw new Error(text(result.message ?? result.error) || `服务请求失败（${response.status}）`);
        return value;
      } catch (error) { throw new Error(redact(error instanceof Error ? error.message : String(error))); }
    }
    const merge = (voice: MusicVoiceTask) => { const previous = state.voices.find((item) => item.id === voice.id); state.voices = [{ ...previous, ...voice, error: redact(voice.error), name: voice.name || previous?.name || `人声 ${voice.id}` }, ...state.voices.filter((item) => item.id !== voice.id)]; };
    if (input.action === 'validate') {
      const value = await request('/api/voice/clone/validate', 'POST', { ...await audio(input.audioPath), voice_name: input.name, description: input.description, style: input.style, language: input.language, vocal_start_s: input.start, vocal_end_s: input.end });
      merge({ ...normalizeMusicVoice(value), name: input.name, description: input.description, style: input.style, language: input.language });
    } else if (input.action === 'poll') {
      const job = state.jobs.find((item) => item.id === input.jobId); if (!job || !job.requestId) throw new Error('此任务尚未取得查询编号，请在服务网站核对，勿重复提交。');
      const value = await request(`/api/music/generate-with-voice/results?client_request_id=${encodeURIComponent(job.requestId)}`);
      const envelope = object(value); const data = object(envelope.data ?? value);
      job.status = text(data.status) || 'processing'; job.error = redact(text(data.error_message ?? data.message));
      const clips = Array.isArray(data.items) ? data.items : Array.isArray(data.clips) ? data.clips : Array.isArray(data.songs) ? data.songs : Array.isArray(data.results) ? data.results : [];
      job.songIds = [...new Set([...job.songIds, ...clips.map((clip) => text(object(clip).song_id ?? object(clip).id)).filter((id) => id && !id.startsWith('pending:'))])];
      if (job.status === 'completed' && !job.songIds.length) { job.status = 'processing'; job.error = '正在等待最终歌曲编号，请稍后继续查询。'; }
      if (job.songIds.length) await options.onSongsReady(job.songIds, job.model && MUSIC_MODELS.includes(job.model) ? job.model : 'suno-v6').catch(() => { job.error = '歌曲已生成，请再次查询歌曲以导入作品库。'; });
    } else if (input.action === 'generate') {
      const voice = normalizeMusicVoice(await request(`/api/voice/clone/tasks/${input.taskId}/check`, 'POST', {})); merge(voice);
      if (!voice.available) { await save(state); throw new Error('此人声尚不可用，请先完成校验或重新克隆。'); }
      const job = { id: randomUUID(), requestId: '', voiceTaskId: input.taskId, model: input.model, title: input.title || '人声歌曲', status: 'submitting', songIds: [] as string[], error: '', createdAt: new Date().toISOString() };
      state.jobs.unshift(job); await save(state);
      try {
        const value = await request('/api/music/generate-with-voice', 'POST', { voice_task_id: input.taskId, voice_id: voice.voiceId, prompt: input.prompt, customMode: input.custom, model: input.model, style: input.style, title: input.title, max_mode: input.maxMode, variety: input.variety, styleWeight: input.styleWeight, weirdnessConstraint: input.weirdness }, job.id);
        const envelope = object(value); const data = object(envelope.data ?? value);
        job.requestId = text(data.client_request_id ?? envelope.client_request_id);
        job.status = job.requestId ? 'processing' : 'needs-recovery';
        if (!job.requestId) job.error = '未返回查询编号，请在网站核对本次提交。';
      } catch (error) { job.status = 'needs-recovery'; job.error = error instanceof Error ? error.message : String(error); }
    } else {
      const voice = state.voices.find((item) => item.id === input.taskId); if (!voice) throw new Error('找不到本地人声任务。');
      if (input.action === 'delete') { await request(`/api/voice/clone/voices/${input.taskId}`, 'DELETE'); state.voices = state.voices.filter((item) => item.id !== input.taskId); }
      else {
        const suffix = input.action === 'refresh' ? '' : input.action === 'verify' ? '/generate' : `/${input.action}`;
        const value = await request(`/api/voice/clone/tasks/${input.taskId}${suffix}`, input.action === 'refresh' ? 'GET' : 'POST', input.action === 'verify' ? await audio(input.audioPath) : input.action === 'refresh' ? undefined : {});
        merge(normalizeMusicVoice(value));
      }
    }
    await save(state); return state;
  }
  return { execute(input: MusicVoiceRequest) { const operation = queue.catch(() => undefined).then(() => execute(input)); queue = operation; return operation; } };
}
