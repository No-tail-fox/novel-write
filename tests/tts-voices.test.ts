import { describe, expect, it } from 'vitest';
import {
  defaultPodcastSpeakersForProvider,
  filterTtsVoiceOptions,
  MINIMAX_TASK_VOICE_OPTIONS,
  ttsVoiceOptionsForProvider,
  VOLCENGINE_TASK_VOICE_OPTIONS,
  volcengineSpeakersToVoiceOptions,
} from '@shared/tts-voices';

describe('task tts voice options', () => {
  it('labels Volcengine task voices with the actual voice identity', () => {
    expect(VOLCENGINE_TASK_VOICE_OPTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'zh_male_m191_uranus_bigtts', label: '云舟 2.0' }),
        expect.objectContaining({ id: 'zh_male_yuanboxiaoshu_moon_bigtts', label: '渊博小叔' }),
      ]),
    );
    expect(VOLCENGINE_TASK_VOICE_OPTIONS.find((voice) => voice.id === 'zh_female_vv_uranus_bigtts')?.label).toBe('Vivi 2.0');
  });

  it('resolves true dual-host podcast voices from the selected provider and speaker pair', () => {
    expect(defaultPodcastSpeakersForProvider('volcengine', 'kazai-dayi')).toEqual({
      podcastSpeakerA: 'zh_male_m191_uranus_bigtts',
      podcastSpeakerB: 'zh_female_vv_uranus_bigtts',
    });
    expect(defaultPodcastSpeakersForProvider('minimax', 'liufei-xiaolei')).toEqual({
      podcastSpeakerA: 'male-qn-jingying',
      podcastSpeakerB: 'female-shaonv',
    });
    expect(defaultPodcastSpeakersForProvider('volcengine', 'unknown-pair')).toEqual(defaultPodcastSpeakersForProvider('volcengine', 'kazai-dayi'));
  });

  it('exposes the complete built-in MiniMax catalog and appends clone voices once', () => {
    expect(MINIMAX_TASK_VOICE_OPTIONS).toHaveLength(18);
    expect(MINIMAX_TASK_VOICE_OPTIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'presenter_male' }),
      expect.objectContaining({ id: 'audiobook_female_2' }),
      expect.objectContaining({ id: 'cartoon_pig' }),
    ]));
    const options = ttsVoiceOptionsForProvider('minimax', [
      { voiceId: 'female-shaonv', displayName: '重复项', sourceAudioPath: 'duplicate.wav', createdAt: 1, lastUsedAt: 1 },
      { voiceId: 'my-clone', displayName: '我的克隆', sourceAudioPath: 'clone.wav', createdAt: 1, lastUsedAt: 1 },
    ]);
    expect(options.filter((option) => option.id === 'female-shaonv')).toHaveLength(1);
    expect(options.find((option) => option.id === 'my-clone')).toMatchObject({ label: '我的克隆', hint: '克隆音色' });
  });

  it('maps, deduplicates, and searches provider speaker results', () => {
    const options = volcengineSpeakersToVoiceOptions([
      { voiceType: 'voice-a', name: '讲述男声', gender: '男', labels: ['纪录片'] },
      { voiceType: 'voice-a', name: '重复音色' },
      { voiceType: 'voice-b', name: '温柔女声', age: '青年' },
    ]);
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({ id: 'voice-a', hint: '男 · 纪录片' });
    expect(filterTtsVoiceOptions(options, 'voice-b')).toEqual([options[1]]);
    expect(filterTtsVoiceOptions(options, '纪录片')).toEqual([options[0]]);
  });
});
