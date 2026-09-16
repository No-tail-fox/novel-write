import { describe, expect, it } from 'vitest';
import { buildMusicSourceOperation, defaultMusicSourceDraft, musicOperationGroups, musicSourceCandidates, type MusicSourceDraft } from '../src/features/labs/MusicSourceTools';
import { estimateMusicOperationCost, MUSIC_OPERATIONS, musicOperationInputSchema } from '../src/shared/music-operations';
import type { MusicLabRecord } from '../src/shared/music-lab';

const firstId = '0af1f96d-b0d0-43cf-b473-c573e1075ef1';
const secondId = 'a4139a42-ae89-47f4-b214-b811ed17d07d';
const firstTrackId = 'b9ee8e64-ce08-45ad-a759-4a1f2b2b9e4c';
const secondTrackId = '9ba49db0-b80c-46c7-8d77-238ed43a20fa';
const records: MusicLabRecord[] = [firstId, secondId].map((id, index) => ({
  id, providerId: 'suno-api', providerName: 'Suno-API', model: 'suno-v6',
  input: { mode: 'description', description: 'A piano song', model: 'suno-v6', instrumental: true, maxMode: false, variety: 0 },
  status: 'completed', estimatedCost: 0.6, errorMessage: '', createdAt: '2026-09-16T10:00:00Z', updatedAt: '2026-09-16T10:01:00Z', finishedAt: '2026-09-16T10:01:00Z',
  tracks: [{ id: index ? secondTrackId : firstTrackId, songId: `source-${index}`, status: 'completed', providerStatus: 'complete', title: `Song ${index}`, lyrics: '', style: 'piano', durationSec: 120, downloadStatus: 'none' }],
}));
const validDraft: MusicSourceDraft = {
  ...defaultMusicSourceDraft, source: `${firstId}/${firstTrackId}`, secondSource: `${secondId}/${secondTrackId}`,
  style: 'cinematic piano', lyrics: 'A new verse', startSeconds: '10', endSeconds: '20', continueAt: '60', durationSec: '5', stemControlTags: 'gentle strings',
};

describe('music source operations', () => {
  it('offers every supported operation exactly once in the tool groups', () => {
    expect(musicOperationGroups.flatMap((group) => [...group.operations]).sort()).toEqual([...MUSIC_OPERATIONS].sort());
  });

  it.each(MUSIC_OPERATIONS)('builds a valid %s request from owned track IDs', (operation) => {
    const result = buildMusicSourceOperation({ ...validDraft, operation }, records);
    expect(result.issue).toBe('');
    expect(result.input).toBeDefined();
    expect(musicOperationInputSchema.safeParse(result.input).success).toBe(true);
    expect(result.input?.sources[0]).toEqual({ recordId: firstId, trackId: firstTrackId });
    expect(result.input).not.toHaveProperty('audioUrl');
    expect(result.input).not.toHaveProperty('songId');
  });

  it('rejects unavailable, repeated and overlong source selections before a paid request', () => {
    expect(buildMusicSourceOperation({ ...validDraft, source: 'missing' }, records).input).toBeUndefined();
    expect(buildMusicSourceOperation({ ...validDraft, operation: 'mashup', secondSource: validDraft.source }, records).input).toBeUndefined();
    expect(buildMusicSourceOperation({ ...validDraft, operation: 'crop', endSeconds: '121' }, records).input).toBeUndefined();
    expect(buildMusicSourceOperation({ ...validDraft, operation: 'extend', continueAt: '121' }, records).input).toBeUndefined();
    const aliasRecords = structuredClone(records);
    aliasRecords[1].tracks[0].songId = aliasRecords[0].tracks[0].songId;
    expect(buildMusicSourceOperation({ ...validDraft, operation: 'mashup' }, aliasRecords).input).toBeUndefined();
  });

  it('does not use unfinished or placeholder tracks as source audio', () => {
    const unfinished = structuredClone(records);
    unfinished[0].tracks[0].status = 'processing';
    unfinished[1].tracks[0].songId = 'pending:upstream';
    expect(musicSourceCandidates(unfinished)).toHaveLength(0);
  });

  it('does not leak settings from a previous operation into an editing request', () => {
    const result = buildMusicSourceOperation({ ...validDraft, operation: 'reverse', maxMode: true, contextLyrics: 'old context' }, records);
    expect(result.input).toEqual({ operation: 'reverse', model: 'suno-v6', sources: [{ recordId: firstId, trackId: firstTrackId }] });
    expect(estimateMusicOperationCost(result.input!)).toBe(0.6);
  });

  it('validates numeric editor fields and prices multi-stem and free separation distinctly', () => {
    expect(buildMusicSourceOperation({ ...validDraft, operation: 'fade', durationSec: '' }, records).input).toBeUndefined();
    expect(buildMusicSourceOperation({ ...validDraft, operation: 'speed', speedMultiplier: '1.23456' }, records).input).toBeUndefined();
    expect(buildMusicSourceOperation({ ...validDraft, operation: 'add-instrumental', durationSec: '1.2' }, records).input).toBeUndefined();
    expect(estimateMusicOperationCost(buildMusicSourceOperation({ ...validDraft, operation: 'separate', stemMode: 'twelve' }, records).input!)).toBe(3);
    expect(estimateMusicOperationCost(buildMusicSourceOperation({ ...validDraft, operation: 'vocal-removal' }, records).input!)).toBe(0);
  });
});
