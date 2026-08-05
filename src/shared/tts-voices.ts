import type { AppConfig, MinimaxCloneVoice, PodcastSpeakerPair, TtsProvider, VolcengineSpeaker } from './types';
import { DEFAULT_VOLCENGINE_TTS_V3_SPEAKER, normalizeVolcengineV3Speaker } from './volcengine-tts';

export type RuntimeTtsProvider = Exclude<TtsProvider, 'mock'>;

export interface TtsVoiceOption {
  id: string;
  label: string;
  hint: string;
}

export const VOLCENGINE_TASK_VOICE_OPTIONS: TtsVoiceOption[] = [
  { id: DEFAULT_VOLCENGINE_TTS_V3_SPEAKER, label: '云舟 2.0', hint: '稳重男声' },
  { id: 'zh_female_vv_uranus_bigtts', label: 'Vivi 2.0', hint: '清亮女声' },
  { id: 'zh_male_yuanboxiaoshu_moon_bigtts', label: '渊博小叔', hint: '知识讲述' },
  { id: 'zh_female_wenrouxiaoya_moon_bigtts', label: '温柔小雅', hint: '柔和女声' },
  { id: 'zh_female_shuangkuaisisi_uranus_bigtts', label: '爽快思思 2.0', hint: '爽朗活泼' },
];

export const MINIMAX_TASK_VOICE_OPTIONS: TtsVoiceOption[] = [
  { id: 'male-qn-qingse', label: '青涩青年', hint: '青年男声' },
  { id: 'male-qn-jingying', label: '精英青年', hint: '稳重男声' },
  { id: 'male-qn-badao', label: '霸道青年', hint: '强势男声' },
  { id: 'male-qn-daxuesheng', label: '青年大学生', hint: '阳光男声' },
  { id: 'female-shaonv', label: '少女', hint: '年轻女声' },
  { id: 'female-yujie', label: '御姐', hint: '成熟女声' },
  { id: 'female-chengshu', label: '成熟女性', hint: '沉稳女声' },
  { id: 'female-tianmei', label: '甜美女性', hint: '甜美女声' },
  { id: 'presenter_male', label: '男性主持人', hint: '主持播报' },
  { id: 'presenter_female', label: '女性主持人', hint: '主持播报' },
  { id: 'audiobook_male_1', label: '男性有声书 1', hint: '有声书男声' },
  { id: 'audiobook_male_2', label: '男性有声书 2', hint: '有声书男声' },
  { id: 'audiobook_female_1', label: '女性有声书 1', hint: '有声书女声' },
  { id: 'audiobook_female_2', label: '女性有声书 2', hint: '有声书女声' },
  { id: 'clever_boy', label: '聪明男童', hint: '儿童男声' },
  { id: 'cute_boy', label: '可爱男童', hint: '儿童男声' },
  { id: 'lovely_girl', label: '萌萌女童', hint: '儿童女声' },
  { id: 'cartoon_pig', label: '卡通小猪', hint: '卡通角色' },
];

export function mergeTtsVoiceOptions(...catalogs: readonly (readonly TtsVoiceOption[])[]): TtsVoiceOption[] {
  const options: TtsVoiceOption[] = [];
  const seen = new Set<string>();
  for (const catalog of catalogs) {
    for (const option of catalog) {
      const id = option.id.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      options.push({ ...option, id });
    }
  }
  return options;
}

export function volcengineSpeakersToVoiceOptions(speakers: readonly VolcengineSpeaker[]): TtsVoiceOption[] {
  return mergeTtsVoiceOptions(speakers.map((speaker) => ({
    id: speaker.voiceType,
    label: speaker.name || speaker.voiceType,
    hint: [speaker.gender, speaker.age, ...(speaker.labels ?? []).slice(0, 2)].filter(Boolean).join(' · ') || '豆包音色',
  })));
}

export function filterTtsVoiceOptions(options: readonly TtsVoiceOption[], query: string): TtsVoiceOption[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...options];
  return options.filter((option) => `${option.label}\n${option.id}\n${option.hint}`.toLocaleLowerCase().includes(needle));
}

export interface PodcastSpeakerDefaults {
  podcastSpeakerA: string;
  podcastSpeakerB: string;
}

const VOLCENGINE_PODCAST_SPEAKER_DEFAULTS: Record<PodcastSpeakerPair, PodcastSpeakerDefaults> = {
  'kazai-dayi': {
    podcastSpeakerA: DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
    podcastSpeakerB: 'zh_female_vv_uranus_bigtts',
  },
  'liufei-xiaolei': {
    podcastSpeakerA: 'zh_male_ruyaqingnian_uranus_bigtts',
    podcastSpeakerB: 'zh_female_shuangkuaisisi_uranus_bigtts',
  },
};

const MINIMAX_PODCAST_SPEAKER_DEFAULTS: Record<PodcastSpeakerPair, PodcastSpeakerDefaults> = {
  'kazai-dayi': {
    podcastSpeakerA: 'male-qn-qingse',
    podcastSpeakerB: 'female-yujie',
  },
  'liufei-xiaolei': {
    podcastSpeakerA: 'male-qn-jingying',
    podcastSpeakerB: 'female-shaonv',
  },
};

export function normalizeRuntimeTtsProvider(provider: TtsProvider | string | null | undefined): RuntimeTtsProvider {
  return provider === 'minimax' ? 'minimax' : 'volcengine';
}

export function ttsVoiceOptionsForProvider(
  provider: TtsProvider | string | null | undefined,
  cloneVoices: readonly MinimaxCloneVoice[] = [],
): TtsVoiceOption[] {
  if (normalizeRuntimeTtsProvider(provider) !== 'minimax') return VOLCENGINE_TASK_VOICE_OPTIONS;
  return mergeTtsVoiceOptions(
    MINIMAX_TASK_VOICE_OPTIONS,
    cloneVoices.map((voice) => ({ id: voice.voiceId, label: voice.displayName || voice.voiceId, hint: '克隆音色' })),
  );
}

export function defaultTaskSpeakerForProvider(provider: TtsProvider | string | null | undefined, config: AppConfig): string {
  const runtimeProvider = normalizeRuntimeTtsProvider(provider);
  if (runtimeProvider === 'minimax') {
    return config.tts.minimax.voiceId || MINIMAX_TASK_VOICE_OPTIONS[0].id;
  }
  return normalizeVolcengineV3Speaker(config.tts.volcengine.speaker || config.tts.speaker || VOLCENGINE_TASK_VOICE_OPTIONS[0].id);
}

export function taskSpeakerLabel(
  provider: TtsProvider | string | null | undefined,
  speaker: string,
  cloneVoices: readonly MinimaxCloneVoice[] = [],
): string {
  return ttsVoiceOptionsForProvider(provider, cloneVoices).find((option) => option.id === speaker)?.label ?? speaker;
}

export function defaultPodcastSpeakersForProvider(provider: TtsProvider | string | null | undefined, pair: string | null | undefined): PodcastSpeakerDefaults {
  const speakerPair: PodcastSpeakerPair = pair === 'liufei-xiaolei' ? 'liufei-xiaolei' : 'kazai-dayi';
  const defaults = normalizeRuntimeTtsProvider(provider) === 'minimax' ? MINIMAX_PODCAST_SPEAKER_DEFAULTS : VOLCENGINE_PODCAST_SPEAKER_DEFAULTS;
  return defaults[speakerPair];
}

export function volcengineResourceIdForTaskSpeaker(speaker: string, fallback: string): string {
  const voiceId = normalizeVolcengineV3Speaker(speaker);
  if (/_moon_bigtts$/i.test(voiceId) || /_mars_bigtts$/i.test(voiceId)) {
    return 'seed-tts-1.0';
  }
  if (/_uranus_bigtts$/i.test(voiceId)) {
    return 'seed-tts-2.0';
  }
  return fallback;
}
