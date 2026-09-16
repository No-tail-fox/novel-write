import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMusicLabRuntime } from '../electron/music-lab-runtime';
import { MusicProviderError, type MusicProvider, type MusicRemoteTrack } from '../src/shared/music-provider';
import type { MusicGenerateInput } from '../src/shared/music-lab';

const directories: string[] = [];
const runtimes: ReturnType<typeof createMusicLabRuntime>[] = [];
afterEach(async () => { runtimes.splice(0).forEach((runtime) => runtime.close()); await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const input: MusicGenerateInput = { mode: 'description', model: 'suno-v6', description: '轻柔钢琴', instrumental: true, maxMode: false, variety: 1 };
const remote = (songId: string, status: MusicRemoteTrack['status']): MusicRemoteTrack => ({ songId, status, providerStatus: status, title: '雨夜', lyrics: '', style: 'piano' });
function mockProvider() {
  return {
    generate: vi.fn<MusicProvider['generate']>().mockResolvedValue([remote('first', 'processing'), remote('second', 'pending')]),
    query: vi.fn<MusicProvider['query']>().mockResolvedValue([remote('first', 'completed'), remote('second', 'failed')]),
    getBalance: vi.fn<MusicProvider['getBalance']>().mockResolvedValue({ balance: 30, currency: 'CNY', checkedAt: new Date().toISOString() }),
    generateLyrics: vi.fn<MusicProvider['generateLyrics']>(), boostStyle: vi.fn<MusicProvider['boostStyle']>(),
    download: vi.fn<MusicProvider['download']>().mockResolvedValue(new Uint8Array([1, 2, 3])),
    performOperation: vi.fn<MusicProvider['performOperation']>().mockResolvedValue([remote('operation-one', 'processing')]),
    uploadSource: vi.fn<MusicProvider['uploadSource']>().mockResolvedValue([remote('upload-one', 'completed')]),
    getHistoryPage: vi.fn<MusicProvider['getHistoryPage']>().mockResolvedValue({ tracks: [], hasMore: false }),
  };
}
async function setup(provider = mockProvider()) {
  const dataDir = await mkdtemp(join(tmpdir(), 'storydream-music-lab-')); directories.push(dataDir);
  const options = { dataDir, resolveApiKey: () => 'test-only-key', createProvider: () => provider, autoPoll: false, probeDuration: async () => 45 };
  const runtime = createMusicLabRuntime(options); runtimes.push(runtime); return { dataDir, options, runtime, provider };
}

describe('persistent music lab runtime', () => {
  it('isolates saved profiles and resumes each job at its original service while retaining default storage', async () => {
    const { runtime: legacy, dataDir } = await setup();
    const legacyRecord = await legacy.generate(input);
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(JSON.stringify([
      { id: 'same-cloud-id', status: String(url).endsWith('/query') ? 'completed' : 'processing', audio_url: 'https://media.example/song.mp3' },
    ]), { headers: { 'Content-Type': 'application/json' } }));
    const optionsA = { dataDir, storageDirectory: join(dataDir, 'music-lab', 'profiles', 'profile-a'), baseUrl: 'https://music-a.example/', resolveApiKey: () => 'profile-a-test-key', fetchImpl, autoPoll: false };
    const optionsB = { ...optionsA, storageDirectory: join(dataDir, 'music-lab', 'profiles', 'profile-b'), baseUrl: 'https://music-b.example', resolveApiKey: () => 'profile-b-test-key' };
    const profileA = createMusicLabRuntime(optionsA); const profileB = createMusicLabRuntime(optionsB); runtimes.push(profileA, profileB);
    const recordA = await profileA.generate(input); const recordB = await profileB.generate(input);
    optionsA.baseUrl = 'https://changed.example';
    await profileA.refresh(recordA.id);
    expect(fetchImpl.mock.calls[2][0]).toBe('https://music-a.example/api/music/query');
    expect((await legacy.list()).map((record) => record.id)).toEqual([legacyRecord.id]);
    expect((await profileA.list()).map((record) => record.id)).toEqual([recordA.id]);
    expect((await profileB.list()).map((record) => record.id)).toEqual([recordB.id]);
    await expect(profileB.refresh(recordA.id)).rejects.toThrow();
    profileB.close();
    const restarted = createMusicLabRuntime(optionsB); runtimes.push(restarted);
    await restarted.refresh(recordB.id);
    expect(fetchImpl.mock.calls[3][0]).toBe('https://music-b.example/api/music/query');
    expect(new Headers(fetchImpl.mock.calls[3][1]?.headers).get('Authorization')).toBe('Bearer profile-b-test-key');
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/create'))).toHaveLength(2);
    expect(await profileA.getOutputDirectory(recordA.id)).toBe(await realpath(join(optionsA.storageDirectory, recordA.id)));
    expect(await readFile(join(optionsA.storageDirectory, recordA.id, 'record.json'), 'utf8')).not.toContain('test-key');
    expect(() => createMusicLabRuntime({ ...optionsA, storageDirectory: 'relative/path' })).toThrow('MUSIC_STORAGE_PATH_INVALID');
  });

  it('keeps source uploads inside the shared audio root when profile storage changes', async () => {
    const { dataDir, options, provider } = await setup();
    const audioDirectory = join(dataDir, 'bgm'); await mkdir(audioDirectory);
    const audioPath = join(audioDirectory, 'shared.mp3'); await writeFile(audioPath, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40)]));
    const storageDirectory = join(dataDir, 'music-lab', 'profiles', 'other');
    const runtime = createMusicLabRuntime({ ...options, storageDirectory }); runtimes.push(runtime);
    const uploaded = await runtime.uploadSource({ audioPath, model: 'suno-v6' });
    expect(uploaded.status).toBe('completed');
    expect(uploaded.sourceUpload!.localPath.startsWith(await realpath(storageDirectory))).toBe(true);
    expect(provider.uploadSource).toHaveBeenCalledOnce();
  });

  it('persists both candidates before returning and resumes queries after restart without submitting again', async () => {
    const { runtime, options, provider } = await setup();
    const record = await runtime.generate(input);
    expect(record.status).toBe('processing'); expect(record.tracks).toHaveLength(2);
    const saved = await readFile(join(await runtime.getOutputDirectory(record.id), 'record.json'), 'utf8');
    expect(saved).toContain('first'); expect(saved).toContain('轻柔钢琴'); expect(saved).not.toContain('test-only-key');
    runtime.close();
    const restarted = createMusicLabRuntime(options); runtimes.push(restarted);
    expect((await restarted.list())[0].status).toBe('processing');
    const result = await restarted.refresh(record.id);
    expect(result.status).toBe('partial'); expect(result.tracks.map((track) => track.status)).toEqual(['completed', 'failed']);
    expect(provider.generate).toHaveBeenCalledOnce(); expect(provider.query).toHaveBeenCalledWith(['first', 'second'], 'suno-v6');
  });

  it('keeps an ambiguous paid submission recoverable and never repeats it when refreshed', async () => {
    const { runtime, provider } = await setup();
    provider.generate.mockRejectedValue(new MusicProviderError('connection interrupted'));
    const record = await runtime.generate(input);
    expect(record.status).toBe('needs-recovery'); expect(record.tracks).toEqual([]);
    await runtime.list(); await runtime.refresh(record.id);
    expect(provider.generate).toHaveBeenCalledOnce(); expect(provider.query).not.toHaveBeenCalled();
  });

  it('marks a process interruption without known IDs as uncertain, rather than retrying', async () => {
    const { runtime, options, provider } = await setup();
    const record = await runtime.generate(input);
    record.status = 'submitting'; record.tracks = [];
    await writeFile(join(await runtime.getOutputDirectory(record.id), 'record.json'), JSON.stringify(record), 'utf8');
    const restarted = createMusicLabRuntime(options); runtimes.push(restarted);
    expect((await restarted.list())[0]).toMatchObject({ status: 'needs-recovery', tracks: [] });
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it('retries only the download after failure, preserves downloaded files, and records BGM association', async () => {
    const { runtime, provider } = await setup();
    const generated = await runtime.generate(input); const complete = await runtime.refresh(generated.id);
    const request = { recordId: complete.id, trackId: complete.tracks[0].id, format: 'mp3' as const };
    provider.download.mockRejectedValueOnce(new Error('temporary download failure'));
    expect((await runtime.downloadTrack(request)).tracks[0].downloadStatus).toBe('failed');
    const downloaded = await runtime.downloadTrack(request);
    expect(downloaded.tracks[0].localMp3Path).toBeTruthy();
    expect(await readFile(downloaded.tracks[0].localMp3Path!)).toEqual(Buffer.from([1, 2, 3]));
    await runtime.downloadTrack(request);
    expect(provider.download).toHaveBeenCalledTimes(2); expect(provider.generate).toHaveBeenCalledOnce();
    expect((await runtime.markTrackAsBgm({ recordId: request.recordId, trackId: request.trackId }, 'bgm-one')).tracks[0].bgmId).toBe('bgm-one');
  });

  it('does not mark a job complete when only one candidate has completed', async () => {
    const { runtime, provider } = await setup(); const record = await runtime.generate(input);
    provider.query.mockResolvedValueOnce([remote('first', 'completed')]);
    const next = await runtime.refresh(record.id);
    expect(next.status).toBe('processing'); expect(next.tracks[1].status).toBe('pending');
  });

  it('returns a validated local path only after a successful download', async () => {
    const { runtime } = await setup(); const record = await runtime.generate(input);
    const trackInput = { recordId: record.id, trackId: record.tracks[0].id };
    await expect(runtime.getTrackLocalPath(trackInput)).rejects.toThrow('MUSIC_TRACK_NOT_LOCAL');
    await runtime.refresh(record.id);
    const downloaded = await runtime.downloadTrack({ ...trackInput, format: 'mp3' });
    expect(await runtime.getTrackLocalPath(trackInput)).toBe(downloaded.tracks[0].localMp3Path);
  });

  it('rejects output paths outside the persisted task directory', async () => {
    const { runtime } = await setup(); const record = await runtime.generate(input);
    record.tracks[0].localMp3Path = join(tmpdir(), 'outside.mp3');
    await writeFile(join(await runtime.getOutputDirectory(record.id), 'record.json'), JSON.stringify(record), 'utf8');
    await expect(runtime.getOutputDirectory(record.id)).rejects.toThrow('MUSIC_PATH_INVALID');
    await expect(runtime.getOutputDirectory('../../outside')).rejects.toThrow();
  });

  it('persists extra exports, reuses cached files, and never treats lyrics as playable audio', async () => {
    const { runtime, provider } = await setup(); const generated = await runtime.generate(input); const complete = await runtime.refresh(generated.id);
    const reference = { recordId: complete.id, trackId: complete.tracks[0].id };
    provider.download.mockResolvedValueOnce(Buffer.from('[00:01.20]雨夜', 'utf8'));
    const downloaded = await runtime.downloadTrack({ ...reference, format: 'lrc' });
    expect(downloaded.tracks[0].mediaPaths?.lrc).toMatch(/\.lrc$/u);
    expect(await readFile(downloaded.tracks[0].mediaPaths!.lrc!, 'utf8')).toBe('[00:01.20]雨夜');
    await expect(runtime.getTrackLocalPath(reference)).rejects.toThrow('MUSIC_TRACK_NOT_LOCAL');
    provider.download.mockRejectedValueOnce(new Error('cover is unavailable'));
    expect((await runtime.downloadTrack({ ...reference, format: 'cover' })).tracks[0].downloadStatus).toBe('failed');
    const cached = await runtime.downloadTrack({ ...reference, format: 'lrc' });
    expect(cached.tracks[0]).toMatchObject({ downloadStatus: 'completed', downloadError: '' });
    expect(provider.download).toHaveBeenCalledTimes(2);
  });

  it('rejects escaped and malformed persisted media paths before any download', async () => {
    const { runtime, provider } = await setup(); const record = await runtime.generate(input); const dir = await runtime.getOutputDirectory(record.id);
    record.tracks[0].mediaPaths = { lyrics: join(tmpdir(), 'private.txt') };
    await writeFile(join(dir, 'record.json'), JSON.stringify(record), 'utf8');
    await expect(runtime.getOutputDirectory(record.id)).rejects.toThrow('MUSIC_PATH_INVALID');
    record.tracks[0].mediaPaths = { lyrics: 123 } as never;
    await writeFile(join(dir, 'record.json'), JSON.stringify(record), 'utf8');
    await expect(runtime.getOutputDirectory(record.id)).rejects.toThrow('MUSIC_RECORD_INVALID');
    expect(provider.download).not.toHaveBeenCalled();
  });

  it('requires actual stems for MIDI export before requesting provider media', async () => {
    const { runtime, provider } = await setup(); const generated = await runtime.generate(input); const complete = await runtime.refresh(generated.id);
    await expect(runtime.downloadTrack({ recordId: complete.id, trackId: complete.tracks[0].id, format: 'midi' })).rejects.toThrow('分轨');
    expect(provider.download).not.toHaveBeenCalled();
  });

  it('reports incomplete voice imports and refreshes existing candidates without duplicates', async () => {
    const { runtime, provider } = await setup(); const generated = await runtime.generate(input);
    provider.query.mockResolvedValueOnce([]);
    await expect(runtime.importSongs(['voice-song'])).rejects.toThrow('MUSIC_IMPORT_INCOMPLETE');
    provider.query.mockResolvedValueOnce([remote('first', 'completed')]);
    await runtime.importSongs(['first']);
    const records = await runtime.list();
    expect(records).toHaveLength(1); expect(records[0].id).toBe(generated.id); expect(records[0].tracks[0].status).toBe('completed');
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it('resolves operation sources from persisted tracks, saves lineage, and rejects bounds before submission', async () => {
    const { runtime, provider } = await setup(); const source = await runtime.generate(input);
    provider.query.mockResolvedValueOnce([{ ...remote('first', 'completed'), durationSec: 120 }, remote('second', 'failed')]);
    await runtime.refresh(source.id);
    const operation = { operation: 'replace' as const, model: 'suno-v6' as const, sources: [{ recordId: source.id, trackId: source.tracks[0].id }], startSeconds: 10, endSeconds: 20, lyrics: '新歌词' };
    const edited = await runtime.performOperation(operation);
    expect(edited).toMatchObject({ origin: 'operation', operation, estimatedCost: 0.6, status: 'processing' });
    expect(provider.performOperation).toHaveBeenCalledWith(operation, [expect.objectContaining({ songId: 'first', durationSec: 120 })]);
    await expect(runtime.performOperation({ ...operation, endSeconds: 121 })).rejects.toThrow('MUSIC_RANGE_INVALID');
    expect(provider.performOperation).toHaveBeenCalledOnce();
  });

  it('snapshots uploads from managed audio only and preserves a reusable completed source record', async () => {
    const { runtime, provider, dataDir } = await setup(); const directory = join(dataDir, 'bgm'); await mkdir(directory);
    const file = join(directory, 'source.mp3'); const bytes = Buffer.alloc(24); bytes.write('ID3'); await writeFile(file, bytes);
    const uploaded = await runtime.uploadSource({ audioPath: file, title: '哼唱', model: 'suno-v6' });
    expect(uploaded).toMatchObject({ origin: 'upload', estimatedCost: 0, status: 'completed' });
    expect(uploaded.tracks[0].durationSec).toBe(45);
    expect(await readFile(uploaded.sourceUpload!.localPath)).toEqual(bytes);
    const outside = join(dataDir, 'outside.mp3'); await writeFile(outside, bytes);
    await expect(runtime.uploadSource({ audioPath: outside, model: 'suno-v6' })).rejects.toThrow('MUSIC_UPLOAD_PATH_INVALID');
    expect(provider.uploadSource).toHaveBeenCalledOnce();
  });

  it('synchronizes history without duplicate paid jobs and stops repeated server pages', async () => {
    const { runtime, provider } = await setup(); const existing = await runtime.generate(input);
    provider.getHistoryPage.mockResolvedValue({ tracks: [remote('first', 'completed'), remote('cloud-only', 'completed')], hasMore: true });
    const sync = await runtime.syncHistory();
    expect(sync.added).toBe(1); expect(sync.updated).toBe(1); expect(sync.records).toHaveLength(2);
    expect(sync.records.find((record) => record.id === existing.id)?.tracks[0].status).toBe('completed');
    const again = await runtime.syncHistory(); expect(again.added).toBe(0); expect(again.records).toHaveLength(2);
    expect(provider.generate).toHaveBeenCalledOnce();
  });
});
