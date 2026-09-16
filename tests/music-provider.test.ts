import { describe, expect, it, vi } from 'vitest';
import { createMusicProvider, normalizeMusicApiBaseUrl, normalizeMusicTracks, SUNO_API_ORIGIN } from '../src/shared/music-provider';
import { musicLabGenerateInputSchema, type MusicGenerateInput, type MusicMediaFormat } from '../src/shared/music-lab';

const basic: MusicGenerateInput = { mode: 'description', model: 'suno-v6', description: '雨夜的钢琴配乐', instrumental: true, maxMode: false, variety: 1 };
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...headers } });

describe('Suno music provider', () => {
  it('normalizes a configured HTTPS site and uses it for authenticated provider requests', async () => {
    expect(normalizeMusicApiBaseUrl()).toBe(SUNO_API_ORIGIN);
    expect(normalizeMusicApiBaseUrl(' https://MUSIC.EXAMPLE:443/ ')).toBe('https://music.example');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ data: { balance: 12 } }));
    const options = { apiKey: 'configured-test-key', baseUrl: 'https://music.example/', fetchImpl };
    const provider = createMusicProvider(options);
    options.baseUrl = 'https://changed.example';
    expect((await provider.getBalance()).balance).toBe(12);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://music.example/api/user/balance');
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer configured-test-key');
  });

  it.each([
    '', 'http://music.example', 'file:///music', '//music.example', 'https://music.example/api',
    'https://music.example/?token=hidden', 'https://music.example/#settings', 'https://music.example?',
    'https://music.example#', 'https://user:password@music.example', 'https://@music.example',
    'https://music.example\\other', 'https://music.\nexample', 'https://music.example/../',
  ])('rejects a malformed or non-root music URL before making a request: %s', (baseUrl) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => createMusicProvider({ apiKey: 'test-only-key', baseUrl, fetchImpl })).toThrow('MUSIC_API_URL_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each<[MusicMediaFormat, Uint8Array]>([
    ['lyrics', Buffer.from('[Verse]\n雨落在窗外', 'utf8')],
    ['lrc', Buffer.from('[ti:雨夜]\n[00:12.30]雨落在窗外', 'utf8')],
    ['midi', Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0, 96])],
    ['cover', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    ['mp4', Uint8Array.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])],
  ])('exports documented %s files through the authenticated endpoint', async (format, bytes) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(bytes)));
    const exported = await createMusicProvider({ apiKey: 'test-only-key', fetchImpl }).download('song-one', format, 'suno-v6');
    expect([...exported]).toEqual([...bytes]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ song_id: 'song-one', kind: format });
  });

  it.each<[MusicMediaFormat, BodyInit, string]>([
    ['lyrics', '{"error":"not ready"}', 'text/plain'],
    ['lyrics', '<div>Service unavailable</div>', 'text/plain'],
    ['lyrics', new Uint8Array([0xff, 0xfe, 0, 1]), 'application/octet-stream'],
    ['lyrics', 'Service unavailable', 'application/problem+json'],
    ['lrc', '[Verse]\nThis has no timing', 'text/plain'],
    ['midi', 'MThd', 'audio/midi'],
    ['cover', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png'],
  ])('rejects %s error documents or truncated files instead of saving them', async (format, body, contentType) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'content-type': contentType } }));
    await expect(createMusicProvider({ apiKey: 'test-only-key', fetchImpl }).download('song-one', format, 'suno-v6')).rejects.toThrow('MUSIC_DOWNLOAD_INVALID');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('uses the documented fixed endpoint and retains both asynchronous candidates', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([{ id: 'first', status: 'submitted' }, { song_id: 'second', status: 'processing' }]));
    const result = await createMusicProvider({ apiKey: 'test-only-key', fetchImpl }).generate(basic);
    expect(result.map((track) => track.songId)).toEqual(['first', 'second']);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://www.suno-api.io/api/music/create');
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer test-only-key');
    expect(JSON.parse(String(request?.body))).toEqual({ model: 'suno-v6', description: basic.description, instrumental: true, wait_completion: false, max_mode: false, variety: 1 });
  });

  it('preserves zero-valued controls and omits vocals for instrumental custom songs', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([{ id: 'first', status: 'processing' }]));
    await createMusicProvider({ apiKey: 'test-only-key', fetchImpl }).generate({
      mode: 'custom', model: 'suno-v6-mini', title: '夜雨', style: 'piano', lyrics: '不用提交的人声词', instrumental: true,
      maxMode: false, variety: 0, styleWeight: 0, weirdness: 0, vocalGender: 'f',
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ lyrics: '', style_weight: 0, weirdness_constraint: 0, variety: 0 });
    expect(body).not.toHaveProperty('vocal_gender');
  });

  it('never sends unsupported max/variety to sounds', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ code: 200, data: { clips: [{ id: 'loop', status: 'processing' }] } }));
    await createMusicProvider({ apiKey: 'test-only-key', fetchImpl }).generate({ mode: 'sounds', model: 'suno-v6', description: '轻柔鼓点', loop: true, bpm: 90, key: 'C Major' });
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ loop: true, bpm: 90, key: 'C Major' });
    expect(body).not.toHaveProperty('max_mode'); expect(body).not.toHaveProperty('variety');
    expect(musicLabGenerateInputSchema.safeParse({ ...basic, apiKey: 'secret' }).success).toBe(false);
    expect(musicLabGenerateInputSchema.safeParse({ ...basic, variety: 1.2 }).success).toBe(false);
  });

  it('normalizes independent results and keeps playable results processing', async () => {
    const tracks = normalizeMusicTracks({ data: { clips: [
      { id: 'first', status: 'playable', audio_url: 'https://media.example/song.mp3' },
      { id: 'second', status: 'complete', audio_url: 'https://media.example/second.mp3', metadata: { duration: 31, prompt: '完整歌词', tags: 'piano' } },
      { id: 'pending:not-a-real-song', status: 'pending' },
    ] } });
    expect(tracks).toHaveLength(2); expect(tracks[0].status).toBe('processing');
    expect(tracks[1]).toMatchObject({ status: 'completed', durationSec: 31, lyrics: '完整歌词', style: 'piano' });
    expect(normalizeMusicTracks([{ id: 'still-preparing', status: 'complete', audio_url: '' }])[0].status).toBe('processing');
  });

  it('exposes only HTTPS media without embedded credentials to renderer playback', () => {
    const tracks = normalizeMusicTracks([
      { id: 'plain-http', status: 'complete', audio_url: 'http://media.example/audio.mp3' },
      { id: 'credential-url', status: 'complete', audio_url: 'https://user:pass@media.example/audio.mp3' },
      { id: 'local-url', status: 'complete', audio_url: 'file:///private/audio.mp3' },
      { id: 'valid-cdn', status: 'complete', audio_url: 'https://media.example/audio.mp3?signature=valid' },
    ]);
    expect(tracks.slice(0, 3).every((track) => track.audioUrl === undefined && track.status === 'processing')).toBe(true);
    expect(tracks[3]).toMatchObject({ status: 'completed', audioUrl: 'https://media.example/audio.mp3?signature=valid' });
  });

  it('detects HTTP 200 business failures, redacts the key and does not retry', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ success: false, message: 'invalid test-only-key' }));
    await expect(createMusicProvider({ apiKey: 'test-only-key', fetchImpl }).generate(basic)).rejects.toThrow('已隐藏');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('queries all IDs with the documented comma-separated string', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json([]));
    await createMusicProvider({ apiKey: 'test-only-key', fetchImpl }).query(['first', 'second']);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ model: 'suno-v6', song_ids: 'first,second' });
  });

  it('reads helper result fields and exposes quota billing information', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: { edited_lyrics: '[Verse]\n窗外的雨' } }, { 'X-Suno-Helper-Free': 'false' }))
      .mockResolvedValueOnce(json({ upsampledStyle: 'Warm piano, intimate atmosphere' }));
    const provider = createMusicProvider({ apiKey: 'test-only-key', fetchImpl });
    expect(await provider.generateLyrics({ model: 'suno-v6', instruction: '写雨夜' })).toEqual({ lyrics: '[Verse]\n窗外的雨', helperFree: false });
    expect(await provider.boostStyle({ model: 'suno-v6', style: '钢琴', instrumental: true })).toEqual({ style: 'Warm piano, intimate atmosphere' });
  });

  it('prepares WAV before authenticated binary download and rejects HTML masquerading as audio', async () => {
    const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8);
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: { wavUrl: 'https://media.example/song.wav' } }))
      .mockResolvedValueOnce(new Response(wav, { headers: { 'Content-Type': 'audio/wav' } }))
      .mockResolvedValueOnce(new Response('<html>error page</html>', { headers: { 'Content-Type': 'text/html' } }));
    const provider = createMusicProvider({ apiKey: 'test-only-key', fetchImpl });
    expect((await provider.download('first', 'wav', 'suno-v6')).length).toBe(44);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['https://www.suno-api.io/api/music/wav', 'https://www.suno-api.io/api/music/download-file']);
    await expect(provider.download('first', 'mp3', 'suno-v6')).rejects.toThrow('MUSIC_DOWNLOAD_INVALID');
  });

  it('does not forward credentials across a redirect', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://other.example/steal' } }));
    await expect(createMusicProvider({ apiKey: 'test-only-key', fetchImpl }).getBalance()).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
