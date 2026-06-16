import { describe, expect, it } from 'vitest';
import { defaultPodcastSpeakersForProvider, VOLCENGINE_TASK_VOICE_OPTIONS } from '@shared/tts-voices';

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
});
