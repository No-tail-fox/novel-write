import type { AppConfig, TtsProvider } from './types';
import { DEFAULT_VOLCENGINE_TTS_V3_SPEAKER, normalizeVolcengineV3Speaker } from './volcengine-tts';

export type RuntimeTtsProvider = Exclude<TtsProvider, 'mock'>;

export interface TtsVoiceOption {
  id: string;
  label: string;
  hint: string;
}

export const VOLCENGINE_TASK_VOICE_OPTIONS: TtsVoiceOption[] = [
  { id: DEFAULT_VOLCENGINE_TTS_V3_SPEAKER, label: '东方浩然', hint: '豆包默认叙事声' },
  { id: 'zh_male_yuanboxiaoshu_moon_bigtts', label: '渊博小叔', hint: '知识讲述' },
  { id: 'zh_female_wenrouxiaoya_moon_bigtts', label: '温柔小雅', hint: '柔和女声' },
  { id: 'zh_female_shuangkuaisisi_uranus_bigtts', label: '爽快思思', hint: '爽朗活泼' },
];

export const MINIMAX_TASK_VOICE_OPTIONS: TtsVoiceOption[] = [
  { id: 'male-qn-qingse', label: '青涩青年', hint: '青年男声' },
  { id: 'male-qn-jingying', label: '精英青年', hint: '稳重男声' },
  { id: 'female-shaonv', label: '少女', hint: '年轻女声' },
  { id: 'female-yujie', label: '御姐', hint: '成熟女声' },
];

export function normalizeRuntimeTtsProvider(provider: TtsProvider | string | null | undefined): RuntimeTtsProvider {
  return provider === 'minimax' ? 'minimax' : 'volcengine';
}

export function ttsVoiceOptionsForProvider(provider: TtsProvider | string | null | undefined): TtsVoiceOption[] {
  return normalizeRuntimeTtsProvider(provider) === 'minimax' ? MINIMAX_TASK_VOICE_OPTIONS : VOLCENGINE_TASK_VOICE_OPTIONS;
}

export function defaultTaskSpeakerForProvider(provider: TtsProvider | string | null | undefined, config: AppConfig): string {
  const runtimeProvider = normalizeRuntimeTtsProvider(provider);
  if (runtimeProvider === 'minimax') {
    return config.tts.minimax.voiceId || MINIMAX_TASK_VOICE_OPTIONS[0].id;
  }
  return normalizeVolcengineV3Speaker(config.tts.volcengine.speaker || config.tts.speaker || VOLCENGINE_TASK_VOICE_OPTIONS[0].id);
}

export function taskSpeakerLabel(provider: TtsProvider | string | null | undefined, speaker: string): string {
  return ttsVoiceOptionsForProvider(provider).find((option) => option.id === speaker)?.label ?? speaker;
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
