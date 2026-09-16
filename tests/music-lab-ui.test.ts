import { describe, expect, it } from 'vitest';
import { defaultMusicDraft, musicDraftInput, musicDraftIssue, musicLibraryRows, musicRecordDraft } from '../src/features/labs/music-lab-helpers';
import { estimateMusicCost, musicLabGenerateInputSchema, type MusicLabRecord } from '../src/shared/music-lab';

describe('music creation workspace', () => {
  it('keeps vocal lyrics in the draft while omitting them from instrumental requests', () => {
    const draft = { ...defaultMusicDraft, mode: 'custom' as const, style: 'folk', lyrics: '保留我的歌词', vocalGender: 'f', instrumental: true };
    const input = musicDraftInput(draft);
    expect(input).toMatchObject({ mode: 'custom', lyrics: '', instrumental: true });
    expect(input).not.toHaveProperty('vocalGender');
    expect(draft.lyrics).toBe('保留我的歌词');
    expect(musicLabGenerateInputSchema.safeParse(input).success).toBe(true);
    expect(musicDraftInput({ ...draft, instrumental: false })).toMatchObject({ lyrics: '保留我的歌词', vocalGender: 'f' });
  });
  it('isolates sound controls and computes the displayed price for the actual request', () => {
    const draft = { ...defaultMusicDraft, mode: 'sounds' as const, soundDescription: '循环雨声', maxMode: true, bpm: '90', loop: true };
    const input = musicDraftInput(draft);
    expect(input).toMatchObject({ mode: 'sounds', bpm: 90, loop: true });
    expect(input).not.toHaveProperty('maxMode');
    expect(estimateMusicCost(input)).toBe(0.6);
    expect(estimateMusicCost(musicDraftInput({ ...draft, mode: 'description', description: 'jazz' }))).toBe(1.2);
    expect(musicDraftIssue({ ...draft, bpm: 'not a number' })).toContain('BPM');
  });
  it('shows both candidates, filters saved audio, and preserves an interrupted submission', () => {
    const record: MusicLabRecord = { id: 'job', providerId: 'suno-api', providerName: 'Suno-API', model: 'suno-v6', input: musicDraftInput({ ...defaultMusicDraft, description: '城市记忆' }), status: 'partial', tracks: [
      { id: 'a', songId: 'remote-a', status: 'completed', providerStatus: 'completed', title: '雨夜', lyrics: '城市记忆', style: '钢琴', downloadStatus: 'completed', localMp3Path: 'C:/music/a.mp3' },
      { id: 'b', songId: 'remote-b', status: 'failed', providerStatus: 'failed', title: '候选二', lyrics: '', style: '', downloadStatus: 'none' },
    ], estimatedCost: 0.6, errorMessage: '', createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z', finishedAt: null };
    const interrupted = { ...record, id: 'interrupted', status: 'needs-recovery' as const, tracks: [] };
    expect(musicLibraryRows([record, interrupted]).map((row) => row.id)).toEqual(['a', 'b', 'interrupted']);
    expect(musicLibraryRows([record], '', 'saved').map((row) => row.id)).toEqual(['a']);
    expect(musicLibraryRows([record], '钢琴').map((row) => row.id)).toEqual(['a']);
    expect(musicLibraryRows([record], '', 'completed')).toHaveLength(1);
  });
  it('restores generation parameters without silently replacing a different mode draft', () => {
    const before = { ...defaultMusicDraft, lyrics: '另一份专业歌词', description: '一首民谣' };
    const next = { ...before, ...musicRecordDraft({ mode: 'sounds', model: 'suno-v6-mini', description: '钟声', loop: false }) };
    expect(next.lyrics).toBe('另一份专业歌词');
    expect(next.description).toBe('一首民谣');
    expect(next.soundDescription).toBe('钟声');
  });
});
