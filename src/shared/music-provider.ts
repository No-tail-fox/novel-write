import { fetchWithTimeout } from './http';
import type { MusicMediaFormat } from './music-lab';
import { musicOperationInputSchema, type MusicOperationInput, type MusicOperationSource, type MusicRemoteHistoryPage } from './music-operations';
import {
  MUSIC_MODELS, musicLabBoostStyleInputSchema, musicLabGenerateInputSchema, musicLabLyricsInputSchema,
  type MusicBalance, type MusicBoostStyleInput, type MusicBoostStyleResult, type MusicGenerateInput,
  type MusicLyricsInput, type MusicLyricsResult, type MusicModel, type MusicTrack,
} from './music-lab';

export const SUNO_API_ORIGIN = 'https://www.suno-api.io';
/** Suno-compatible providers expose the same paths from an HTTPS site root. */
export function normalizeMusicApiBaseUrl(value = SUNO_API_ORIGIN): string {
  const candidate = value.trim();
  try {
    if (!/^https:\/\/[^/?#\\@\s]+\/?$/iu.test(candidate)) throw new Error('Invalid site root');
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid site root');
    return url.origin;
  } catch {
    throw new MusicProviderError('MUSIC_API_URL_INVALID: 音乐 API 地址须为 HTTPS 站点根地址，不含账号、路径、查询参数或片段。', true);
  }
}
export const MUSIC_MAX_AUDIO_BYTES = 256 * 1024 * 1024;
export type MusicRemoteTrack = Omit<MusicTrack, 'id' | 'downloadStatus'>;
export interface MusicProvider {
  getBalance(): Promise<MusicBalance>;
  generate(input: MusicGenerateInput): Promise<MusicRemoteTrack[]>;
  query(songIds: string[], model?: MusicModel): Promise<MusicRemoteTrack[]>;
  performOperation(input: MusicOperationInput, sources: MusicOperationSource[]): Promise<MusicRemoteTrack[]>;
  uploadSource(input: { bytes: Uint8Array; fileName: string; title?: string; model: MusicModel }): Promise<MusicRemoteTrack[]>;
  getHistoryPage(page?: number): Promise<MusicRemoteHistoryPage>;
  generateLyrics(input: MusicLyricsInput): Promise<MusicLyricsResult>;
  boostStyle(input: MusicBoostStyleInput): Promise<MusicBoostStyleResult>;
  download(songId: string, format: MusicMediaFormat, model: MusicModel): Promise<Uint8Array>;
}
export class MusicProviderError extends Error {
  constructor(message: string, public readonly definitive = false, public readonly retryAfterMs?: number) {
    super(message); this.name = 'MusicProviderError';
  }
}

/** Reject error documents and mislabeled media before creating a reusable local asset. */
export function isMusicMediaBytes(bytes: Uint8Array, format: MusicMediaFormat, contentType = ''): boolean {
  if (!bytes.length || /(?:\bjson\b|\bhtml\b|\bxml\b)/iu.test(contentType)) return false;
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 12));
  if (format === 'wav') return bytes.length >= 44 && head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE';
  if (format === 'mp3') return bytes.length >= 10 && (head.startsWith('ID3') || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (format === 'midi') return bytes.length >= 14 && head.startsWith('MThd') && bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 6;
  if (format === 'mp4') return bytes.length >= 12 && head.slice(4, 8) === 'ftyp';
  if (format === 'cover') return bytes.length >= 12 && (
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    || [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
    || head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP'
  );
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim(); } catch { return false; }
  if (!text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text) || /^\s*<(?:!doctype|\?xml|html|head|body|script|div|p|error)(?:\s|>|\/)/iu.test(text)) return false;
  try { JSON.parse(text); return false; } catch { /* Lyrics are plain text. */ }
  return format !== 'lrc' || /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/u.test(text);
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function musicErrorMessage(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || depth >= 4) return '';
  const item = object(value);
  for (const key of ['message', 'error', 'detail']) {
    const message = musicErrorMessage(item[key], depth + 1);
    if (message) return message;
  }
  return '';
}
function safeUrl(value: unknown): string | undefined {
  try {
    const url = new URL(string(value));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
function unwrap(value: unknown): unknown {
  const item = object(value);
  return item.data ?? value;
}
function songArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const item = object(value);
  for (const key of ['clips', 'songs', 'results', 'items', 'list', 'data']) {
    if (Array.isArray(item[key])) return item[key] as unknown[];
    if (item[key] && typeof item[key] === 'object') {
      const found = songArray(item[key]);
      if (found.length) return found;
    }
  }
  return item.song_id || item.id || item.clip_id || item.clipId ? [item] : [];
}

export function normalizeMusicTracks(value: unknown): MusicRemoteTrack[] {
  const seen = new Set<string>();
  return songArray(value).flatMap((raw): MusicRemoteTrack[] => {
    const item = object(raw);
    const metadata = object(item.metadata);
    const songId = string(item.song_id ?? item.id ?? item.clip_id ?? item.clipId).trim();
    if (!songId || songId.startsWith('pending:') || songId.length > 256 || seen.has(songId)) return [];
    seen.add(songId);
    const providerStatus = string(item.status ?? item.state).toLowerCase();
    const audioUrl = safeUrl(item.audio_url ?? item.audioUrl);
    const status: MusicTrack['status'] = ['complete', 'completed', 'success', 'succeeded'].includes(providerStatus) ? (audioUrl ? 'completed' : 'processing')
      : ['error', 'failed', 'failure'].includes(providerStatus) ? 'failed'
        : ['processing', 'generating', 'streaming', 'playable'].includes(providerStatus) ? 'processing' : 'pending';
    const duration = Number(item.duration ?? item.duration_seconds ?? metadata.duration);
    return [{
      songId, status, providerStatus, title: string(item.title ?? item.song_title).slice(0, 200),
      lyrics: string(item.lyrics ?? metadata.prompt ?? item.prompt).slice(0, 30_000), style: string(item.style_tags ?? item.tags ?? metadata.tags).slice(0, 5_000),
      ...(Number.isFinite(duration) && duration > 0 ? { durationSec: duration } : {}),
      audioUrl, imageUrl: safeUrl(item.image_url ?? item.imageUrl ?? item.cover_url),
      ...(string(item.stem_type ?? metadata.stem_type) ? { stemType: string(item.stem_type ?? metadata.stem_type).slice(0, 80) } : {}),
      ...(string(item.stem_from_id ?? item.source_clip_id) ? { sourceSongIds: [string(item.stem_from_id ?? item.source_clip_id)] } : {}),
      ...(status === 'failed' ? { errorMessage: string(item.error_message ?? item.error ?? metadata.error_message) || '服务未能生成此候选。' } : {}),
    }];
  });
}

export function createMusicProvider(options: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }): MusicProvider {
  const baseUrl = normalizeMusicApiBaseUrl(options.baseUrl);
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new MusicProviderError('MUSIC_KEY_MISSING: 尚未配置音乐生成服务。', true);
  const redact = (value: string) => value.split(apiKey).join('[已隐藏]').replace(/Bearer\s+[^\s"']+/giu, 'Bearer [已隐藏]').slice(0, 2_000);
  function apiError(path: string, message: string, definitive: boolean, retryAfterMs?: number): MusicProviderError {
    // The upload service reports this explicit rejection using HTTP 500.
    if (path === '/api/music/upload-source' && /this audio matches an existing recording in our catalog/iu.test(message)) {
      return new MusicProviderError('MUSIC_UPLOAD_REJECTED: 这段音频与服务曲库中的现有录音匹配，服务拒绝上传。请更换音频后重试。', true);
    }
    return new MusicProviderError(redact(`MUSIC_API_ERROR: ${message}`), definitive, retryAfterMs);
  }
  async function request(path: string, body?: unknown, binary = false): Promise<Response> {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        timeoutMs: binary || path.endsWith('/wav') ? 150_000 : 120_000,
        maxBytes: binary ? MUSIC_MAX_AUDIO_BYTES : 2 * 1024 * 1024,
        maxRedirects: 0, fetchImpl: options.fetchImpl,
      });
      if (!response.ok) {
        const data = await response.clone().json().catch(() => ({}));
        const message = musicErrorMessage(data) || `服务返回 HTTP ${response.status}`;
        const retryAfter = Number(response.headers.get('retry-after'));
        throw apiError(path, message, response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status),
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined);
      }
      return response;
    } catch (error) {
      if (error instanceof MusicProviderError) throw error;
      throw new MusicProviderError(redact(`MUSIC_NETWORK_ERROR: ${error instanceof Error ? error.message : '音乐服务连接失败。'}`));
    }
  }
  async function json(path: string, body?: unknown): Promise<{ value: unknown; response: Response }> {
    const response = await request(path, body);
    const value: unknown = await response.json().catch(() => { throw new MusicProviderError('MUSIC_RESPONSE_INVALID: 音乐服务未返回有效数据。'); });
    const result = object(value);
    if (result.success === false || result.error || (result.code !== undefined && ![0, 200, '0', '200', 'success'].includes(result.code as string | number))) {
      throw apiError(path, musicErrorMessage(result) || '音乐服务拒绝了请求。', true);
    }
    return { value, response };
  }
  function helperFlag(response: Response): { helperFree?: boolean } {
    const value = response.headers.get('X-Suno-Helper-Free');
    return value === null ? {} : { helperFree: value !== 'false' };
  }
  return {
    async getBalance() {
      const { value } = await json('/api/user/balance');
      const data = object(unwrap(value));
      const balance = Number(data.balance ?? data.available_balance ?? object(value).balance);
      if (!Number.isFinite(balance) || balance < 0) throw new MusicProviderError('MUSIC_BALANCE_INVALID: 无法读取服务余额。');
      return { balance, currency: 'CNY', checkedAt: new Date().toISOString() };
    },
    async generate(raw) {
      const input = musicLabGenerateInputSchema.parse(raw);
      let path: string; let body: JsonObject;
      if (input.mode === 'sounds') {
        path = '/api/music/sounds';
        body = { model: input.model, description: input.description, title: input.title, type: 'one_shot', loop: input.loop, bpm: input.bpm, key: input.key };
      } else {
        body = { model: input.model, instrumental: input.instrumental, wait_completion: false, max_mode: input.maxMode, variety: input.variety };
        if (input.mode === 'description') {
          path = '/api/music/create'; body.description = input.description;
        } else {
          path = '/api/music/create/custom';
          Object.assign(body, { lyrics: input.instrumental ? '' : input.lyrics, song_title: input.title, style_tags: input.style,
            negative_tags: input.negativeStyle, style_weight: input.styleWeight, weirdness_constraint: input.weirdness,
            ...(!input.instrumental && input.vocalGender ? { vocal_gender: input.vocalGender } : {}),
          });
        }
      }
      const { value } = await json(path, body);
      const tracks = normalizeMusicTracks(value).map((track) => ({ ...track, ...(track.errorMessage ? { errorMessage: redact(track.errorMessage) } : {}) }));
      if (!tracks.length) throw new MusicProviderError('MUSIC_SUBMISSION_UNCONFIRMED: 服务未返回可查询的歌曲编号，请核对云端记录，勿重复提交。');
      return tracks;
    },
    async query(songIds, model = 'suno-v6') {
      const ids = [...new Set(songIds)].filter((id) => id && !id.startsWith('pending:'));
      if (!ids.length || ids.length > 100) throw new MusicProviderError('MUSIC_SONG_IDS_INVALID: 歌曲编号无效。', true);
      const { value } = await json('/api/music/query', { model, song_ids: ids.join(',') });
      return normalizeMusicTracks(value).map((track) => ({ ...track, ...(track.errorMessage ? { errorMessage: redact(track.errorMessage) } : {}) }));
    },
    async performOperation(raw, sources) {
      const input = musicOperationInputSchema.parse(raw);
      if (sources.length !== input.sources.length || sources.some((source) => !source.songId || source.songId.startsWith('pending:'))) {
        throw new MusicProviderError('MUSIC_SOURCE_INVALID: 来源歌曲编号无效。', true);
      }
      const { path, body } = buildMusicOperationRequest(input, sources);
      const { value } = await json(path, body);
      const tracks = normalizeMusicTracks(value).map((track) => ({ ...track, sourceSongIds: sources.map((source) => source.songId), ...(track.errorMessage ? { errorMessage: redact(track.errorMessage) } : {}) }));
      if (!tracks.length) throw new MusicProviderError('MUSIC_SUBMISSION_UNCONFIRMED: 服务已响应，但未返回可查询的结果编号。请核对云端记录，不要重复提交。');
      return tracks;
    },
    async uploadSource(input) {
      const { value } = await json('/api/music/upload-source', {
        model: input.model, file_base64: Buffer.from(input.bytes).toString('base64'), file_name: input.fileName, upload_type: 'file_upload',
      });
      const tracks = normalizeMusicTracks(value);
      if (!tracks.length) throw new MusicProviderError('MUSIC_SOURCE_UPLOAD_UNCONFIRMED: 上传未返回有效源音频编号。');
      return tracks.map((track) => ({ ...track, title: input.title || track.title || input.fileName,
        // upload-source returns an immediately reusable clip; some replies label it uploaded.
        status: track.audioUrl && track.status !== 'failed' ? 'completed' : track.status,
      }));
    },
    async getHistoryPage(page = 1) {
      if (!Number.isInteger(page) || page < 1 || page > 100) throw new MusicProviderError('MUSIC_HISTORY_PAGE_INVALID: 歌曲历史页码无效。', true);
      const { value } = await json(`/api/music/songs?page=${page}&page_size=100`);
      const data = object(unwrap(value)); const pagination = object(data.pagination ?? object(value).pagination);
      const tracks = normalizeMusicTracks(value);
      const rawById = new Map(songArray(value).map((item) => {
        const data = object(item); return [string(data.song_id ?? data.id), data] as const;
      }));
      const total = Number(pagination.total ?? data.total ?? object(value).total);
      const rawHasMore = pagination.has_more ?? data.has_more ?? object(value).has_more;
      return { tracks: tracks.map((track) => {
        const model = string(rawById.get(track.songId)?.model);
        return { ...track, ...(MUSIC_MODELS.includes(model as MusicModel) ? { model: model as MusicModel } : {}) };
      }), hasMore: typeof rawHasMore === 'boolean' ? rawHasMore : Number.isFinite(total) ? page * 100 < total : tracks.length >= 100 };
    },
    async generateLyrics(raw) {
      const input = musicLabLyricsInputSchema.parse(raw);
      const { value, response } = await json('/api/lyrics/generate', { ...input, mode: 'apply_user_request' });
      const lyrics = string(object(unwrap(value)).edited_lyrics ?? object(value).edited_lyrics);
      if (!lyrics.trim()) throw new MusicProviderError('MUSIC_LYRICS_EMPTY: 服务未返回歌词，请稍后重试。');
      return { lyrics, ...helperFlag(response) };
    },
    async boostStyle(raw) {
      const input = musicLabBoostStyleInputSchema.parse(raw);
      const { value, response } = await json('/api/music/boost-style', { model: input.model, originalTags: input.style, lyrics: input.lyrics, instrumental: input.instrumental });
      const style = string(object(unwrap(value)).upsampledStyle ?? object(value).upsampledStyle);
      if (!style.trim()) throw new MusicProviderError('MUSIC_STYLE_EMPTY: 服务未返回扩写后的曲风。');
      return { style, ...helperFlag(response) };
    },
    async download(songId, format, model) {
      if (format === 'wav') await json('/api/music/wav', { model, audioId: songId, maxAttempts: 24, intervalSeconds: 5 });
      const response = await request('/api/music/download-file', { song_id: songId, kind: format }, true);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!isMusicMediaBytes(bytes, format, response.headers.get('content-type') ?? '')) throw new MusicProviderError('MUSIC_DOWNLOAD_INVALID: 返回内容不是有效的目标文件，请重试下载。');
      return bytes;
    },
  };
}

/** Map normalized controls to each documented endpoint's distinct field names. */
export function buildMusicOperationRequest(input: MusicOperationInput, sources: MusicOperationSource[]): { path: string; body: JsonObject } {
  const source = sources[0];
  const title = input.title || source.title;
  const base: JsonObject = { model: input.model, source_clip_id: source.songId, song_title: title };
  const creative: JsonObject = {
    lyrics: 'lyrics' in input ? input.lyrics : undefined, style_tags: 'style' in input ? input.style : undefined,
    negative_tags: 'negativeStyle' in input ? input.negativeStyle : undefined, wait_completion: false,
    max_mode: 'maxMode' in input ? input.maxMode ?? false : false, variety: 'variety' in input ? input.variety ?? 1 : 1,
  };
  const maxControls = { max_mode: 'maxMode' in input ? input.maxMode ?? false : false, variety: 'variety' in input ? input.variety ?? 1 : 1 };
  switch (input.operation) {
    case 'cover': return { path: '/api/music/generate-from-source', body: {
      model: input.model, sourceClipId: source.songId, sourceAudioUrl: source.audioUrl, sourceTitle: source.title,
      customMode: true, prompt: input.lyrics ?? '', style: input.style, title, negativeTags: input.negativeStyle,
      instrumental: input.instrumental ?? false, waitAudio: false, audio_weight: input.audioWeight,
      styleWeight: input.styleWeight, weirdnessConstraint: input.weirdness, ...maxControls,
    } };
    case 'extend': return { path: '/api/music/extend', body: {
      model: input.model, audioId: source.songId, prompt: input.lyrics ?? '', continueAt: input.continueAt,
      style: input.style, negativeTags: input.negativeStyle, title, sourceAudioUrl: source.audioUrl, waitAudio: false, ...maxControls,
    } };
    case 'replace': return { path: '/api/music/replace-section', body: {
      model: input.model, audioId: source.songId, startSeconds: input.startSeconds, endSeconds: input.endSeconds,
      infillLyrics: input.lyrics, contextLyrics: input.contextLyrics, contextWindowLyrics: input.contextWindowLyrics,
      style: input.style, title, negativeTags: input.negativeStyle, ...maxControls,
    } };
    case 'add-instrumental': return { path: '/api/music/add-instrumental', body: { ...base, ...creative, audio_weight: input.audioWeight ?? 1, duration: input.durationSec } };
    case 'add-vocal': return { path: '/api/music/add-vocal', body: { ...base, ...creative, instrumental: false } };
    case 'add-stem': return { path: '/api/music/add-stem', body: { ...base, ...creative, stem_control_tags: input.stemControlTags } };
    case 'mashup': return { path: '/api/music/mashup', body: { model: input.model, song_title: title, ...creative, mashup_clip_ids: sources.map((item) => item.songId), instrumental: input.instrumental ?? false } };
    case 'inspo': return { path: '/api/music/inspo', body: { model: input.model, song_title: title, ...creative, playlist_clip_ids: sources.map((item) => item.songId), instrumental: input.instrumental ?? false } };
    case 'sample': return { path: '/api/music/sample', body: { ...base, ...creative, mode: 'chop', start_seconds: input.startSeconds, end_seconds: input.endSeconds } };
    case 'crop': case 'remove-section': return { path: `/api/music/${input.operation}`, body: { ...base, crop_start_s: input.startSeconds, crop_end_s: input.endSeconds } };
    case 'fade': return { path: '/api/music/fade', body: { ...base, direction: input.direction, duration_seconds: input.durationSec } };
    case 'reverse': return { path: '/api/music/reverse', body: base };
    case 'speed': return { path: '/api/music/speed', body: { ...base, speed_multiplier: input.speedMultiplier, keep_pitch: input.keepPitch ?? false } };
    case 'separate': return { path: '/api/music/separate', body: { song_id: source.songId, stem_mode: input.stemMode, source_audio_url: source.audioUrl, source_title: source.title } };
    case 'vocal-removal': return { path: '/api/music/vocal-removal', body: { model: input.model, source_clip_id: source.songId } };
  }
}
