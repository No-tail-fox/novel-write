import { describe, expect, it } from 'vitest';
import { applyEditorialVoiceRecord, editorialVoiceInput, editorialVoiceInputMatches } from '../src/features/director-desk/director-generation';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, editorialShotVoiceProvider, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { VoiceLabRecord } from '../src/shared/types';

const now = '2026-09-06T00:00:00.000Z';
const fixture = () => createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'voice-provider', title: '音色', ratio: '16:9', now }), '第一句旁白。第二句旁白。', now);
const defaults = { provider: 'minimax' as const, voiceId: 'default-mini', voiceLabel: '默认音色', speed: 1 };

describe('editorial voice supplier ownership', () => {
  it('preserves custom and cloned voices through save and reload without a catalog whitelist', () => {
    const document = fixture(), shot = document.beats[0].shots[0];
    Object.assign(shot, { voiceId: 'private-clone-123', voiceLabel: '自定义克隆', voiceProvider: 'minimax' });
    const reopened = parseEditorialCollagePipelineData(JSON.stringify(document));
    expect(editorialVoiceInput(reopened, shot.id, defaults)).toMatchObject({ voiceId: 'private-clone-123', voiceLabel: '自定义克隆', provider: 'minimax' });
  });

  it.each(['minimax', 'volcengine'] as const)('uses new supplier defaults when switching from %s', provider => {
    const document = fixture(), shot = document.beats[0].shots[0];
    Object.assign(shot, { voiceId: 'old-private-voice', voiceLabel: '旧音色', voiceProvider: provider, voiceSpeed: 1.05 });
    const target = { ...defaults, provider: provider === 'minimax' ? 'volcengine' as const : 'minimax' as const };
    expect(editorialVoiceInput(document, shot.id, target)).toMatchObject({ provider: target.provider, voiceId: target.voiceId, voiceLabel: target.voiceLabel, speed: 1.05 });
    expect(shot.voiceId).toBe('old-private-voice');
  });

  it('infers old generated voices from audio assets and lets explicit manual ownership override an old asset', () => {
    const document = fixture(), shot = document.beats[0].shots[0];
    Object.assign(shot, { voiceId: 'old-custom', voiceLabel: '旧克隆音色', voiceAssetVersionId: 'old-audio' });
    document.assets.push({ id: 'old-audio', assetId: 'audio', kind: 'audio', provider: 'minimax', localPath: 'test.wav', createdAt: now });
    expect(editorialShotVoiceProvider(document, shot)).toBe('minimax');
    expect(editorialVoiceInput(document, shot.id, defaults).voiceId).toBe('old-custom');
    expect(editorialVoiceInput(document, shot.id, { ...defaults, provider: 'volcengine' }).voiceId).toBe(defaults.voiceId);
    shot.voiceProvider = 'volcengine';
    expect(editorialShotVoiceProvider(document, shot)).toBe('volcengine');
    expect(editorialVoiceInput(document, shot.id, defaults).voiceId).toBe(defaults.voiceId);
  });

  it('falls back for legacy voices with unknown ownership rather than sending an unbound ID', () => {
    const document = fixture(), shot = document.beats[0].shots[0];
    Object.assign(shot, { voiceId: 'unknown-private', voiceLabel: '未知供应商' });
    expect(editorialVoiceInput(document, shot.id, defaults)).toMatchObject({ voiceId: defaults.voiceId, voiceLabel: defaults.voiceLabel });
  });

  it('binds generated provider ownership to source and narration continuations and rejects stale ownership changes', () => {
    const document = fixture(), beat = document.beats[0], shot = beat.shots[0];
    const continuation = { ...shot, id: 'continuation', narrationSplit: { sourceShotId: shot.id, sourceStartMs: 1000, sourceDurationMs: shot.durationMs } };
    beat.shots.push(continuation);
    const input = editorialVoiceInput(document, shot.id, defaults);
    const record: VoiceLabRecord = { id: 'generated', text: input.text, provider: input.provider, voiceId: input.voiceId, voiceLabel: input.voiceLabel, speed: input.speed, audioPath: 'test.wav', status: 'generated', errorMessage: '', createdAt: now, finishedAt: now };
    const result = applyEditorialVoiceRecord(document, shot.id, record, 'speech', input);
    expect(result.beats[0].shots.filter(s => s.id === shot.id || s.id === continuation.id).map(s => s.voiceProvider)).toEqual(['minimax', 'minimax']);
    const selected = result.beats[0].shots[0];
    selected.voiceId = 'selected-private';
    const nextInput = editorialVoiceInput(result, selected.id, defaults);
    selected.voiceProvider = 'volcengine';
    selected.voiceId = 'other-private';
    const lateRecord = { ...record, id: 'late', voiceId: nextInput.voiceId, voiceLabel: nextInput.voiceLabel };
    const stale = applyEditorialVoiceRecord(result, selected.id, lateRecord, 'speech', nextInput);
    expect(stale.beats[0].shots[0].voiceProvider).toBe('volcengine');
    expect(stale.assets.at(-1)).toMatchObject({ id: 'voice-asset-late', selected: false });
    // Changing supplier defaults changes request ownership even when the old ID is unavailable.
    expect(editorialVoiceInputMatches(result, { ...nextInput, defaults: { ...defaults, provider: 'volcengine' } })).toBe(false);
  });
});
