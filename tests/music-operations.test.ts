import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildMusicOperationRequest, createMusicProvider, normalizeMusicTracks } from '../src/shared/music-provider';
import { estimateMusicOperationCost, musicOperationInputSchema, type MusicOperationInput } from '../src/shared/music-operations';

const reference = { recordId: randomUUID(), trackId: randomUUID() };
const secondReference = { recordId: randomUUID(), trackId: randomUUID() };
const source = { songId: 'real-song-one', title: '原曲', audioUrl: 'https://cdn.example/one.mp3', durationSec: 120 };
const secondSource = { songId: 'real-song-two', title: '第二首', audioUrl: 'https://cdn.example/two.mp3', durationSec: 90 };
const base = { model: 'suno-v6' as const, sources: [reference], title: '新版本' };

describe('advanced music operation contracts', () => {
  it('rejects arbitrary URLs, duplicate sources, out-of-order ranges, and unsupported controls before billing', () => {
    for (const input of [
      { ...base, operation: 'cover', style: 'pop', sourceAudioUrl: 'https://not-persisted.example/audio' },
      { ...base, operation: 'mashup', sources: [reference, reference] },
      { ...base, operation: 'sample', startSeconds: 10, endSeconds: 5 },
      { ...base, operation: 'separate', stemMode: 'two', maxMode: true },
      { ...base, operation: 'crop', startSeconds: 1, endSeconds: 2, variety: 1 },
      { ...base, operation: 'add-stem', stemControlTags: 'add Drums\nadd Bass' },
      { ...base, operation: 'speed', speedMultiplier: 1.12345 },
    ]) expect(musicOperationInputSchema.safeParse(input).success).toBe(false);
  });

  it('maps cover to source reuse with zero-valued weights and authoritative source IDs', () => {
    const input = musicOperationInputSchema.parse({ ...base, operation: 'cover', style: 'jazz', lyrics: '新的歌词', audioWeight: 0, styleWeight: 0, weirdness: 0 });
    const request = buildMusicOperationRequest(input, [source]);
    expect(request.path).toBe('/api/music/generate-from-source');
    expect(request.body).toMatchObject({ sourceClipId: source.songId, sourceAudioUrl: source.audioUrl, prompt: '新的歌词', style: 'jazz', title: '新版本', audio_weight: 0, styleWeight: 0, weirdnessConstraint: 0, customMode: true });
    expect(request.body).not.toHaveProperty('source_clip_id');
  });

  it('maps interval operations to their distinct provider units and field names', () => {
    const inputs: MusicOperationInput[] = [
      { ...base, operation: 'extend', continueAt: 30, lyrics: '下一段' },
      { ...base, operation: 'replace', startSeconds: 10, endSeconds: 20, lyrics: '重写' },
      { ...base, operation: 'sample', startSeconds: 4, endSeconds: 8 },
      { ...base, operation: 'crop', startSeconds: 3, endSeconds: 7 },
      { ...base, operation: 'remove-section', startSeconds: 3, endSeconds: 7 },
    ];
    const mapped = inputs.map((input) => buildMusicOperationRequest(input, [source]));
    expect(mapped[0].body).toMatchObject({ audioId: source.songId, continueAt: 30, prompt: '下一段' });
    expect(mapped[1].body).toMatchObject({ audioId: source.songId, startSeconds: 10, endSeconds: 20, infillLyrics: '重写' });
    expect(mapped[2].body).toMatchObject({ source_clip_id: source.songId, start_seconds: 4, end_seconds: 8, mode: 'chop' });
    for (const request of mapped.slice(3)) {
      expect(request.body).toMatchObject({ crop_start_s: 3, crop_end_s: 7 });
      expect(request.body).not.toHaveProperty('max_mode'); expect(request.body).not.toHaveProperty('variety');
    }
  });

  it('keeps multi-source ordering and separates free and paid split costs', () => {
    const mashup: MusicOperationInput = { ...base, operation: 'mashup', sources: [reference, secondReference], instrumental: true, style: 'ambient' };
    expect(buildMusicOperationRequest(mashup, [source, secondSource]).body).toMatchObject({ mashup_clip_ids: ['real-song-one', 'real-song-two'], style_tags: 'ambient' });
    expect(estimateMusicOperationCost({ ...base, operation: 'separate', stemMode: 'twelve' })).toBe(3);
    expect(estimateMusicOperationCost({ ...base, operation: 'vocal-removal' })).toBe(0);
    const split = buildMusicOperationRequest({ ...base, operation: 'separate', stemMode: 'two' }, [source]);
    expect(split.body).toMatchObject({ song_id: source.songId, stem_mode: 'two' });
    expect(split.body).not.toHaveProperty('model'); expect(split.body).not.toHaveProperty('max_mode');
  });

  it('does not retry a paid operation that returns no recoverable ID', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { headers: { 'Content-Type': 'application/json' } }));
    const provider = createMusicProvider({ apiKey: 'test-only-key', fetchImpl });
    await expect(provider.performOperation({ ...base, operation: 'crop', startSeconds: 1, endSeconds: 8 }, [source])).rejects.toThrow('MUSIC_SUBMISSION_UNCONFIRMED');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('normalizes uploaded clip IDs, provider cover_url, and independent stem metadata', async () => {
    const tracks = normalizeMusicTracks([{ clip_id: 'source-one', status: 'complete', audio_url: source.audioUrl, cover_url: 'https://cdn.example/cover.png', stem_from_id: 'parent', stem_type: 'vocals' }]);
    expect(tracks[0]).toMatchObject({ songId: 'source-one', imageUrl: 'https://cdn.example/cover.png', sourceSongIds: ['parent'], stemType: 'vocals' });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ clip_id: 'uploaded', status: 'uploaded', audio_url: source.audioUrl })));
    const result = await createMusicProvider({ apiKey: 'test-only-key', fetchImpl }).uploadSource({ bytes: new Uint8Array([1, 2]), fileName: 'source.mp3', model: 'suno-v6' });
    expect(result[0].status).toBe('completed');
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({ file_base64: 'AQI=', file_name: 'source.mp3', upload_type: 'file_upload' });
  });
});
