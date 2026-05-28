export const VOLCENGINE_TTS_ARK_KEY_MESSAGE =
  'Volcengine TTS V3 API Key cannot be an Ark model key; create a TTS API Key in the Volcengine voice console.';
export const DEFAULT_VOLCENGINE_TTS_V3_SPEAKER = 'zh_female_vv_uranus_bigtts';

const legacySpeakerToV3: Record<string, string> = {
  '灿博小叔': DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
  '东方浩然': DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
  '温柔小雅': DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
  '爽快思思': 'zh_female_shuangkuaisisi_uranus_bigtts',
  '更多音色...': DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
};

export function isArkModelApiKey(value: string | null | undefined): boolean {
  return /^ark-/i.test(String(value ?? '').trim());
}

export function normalizeVolcengineV3Speaker(value: string | null | undefined): string {
  const speaker = String(value ?? '').trim();
  return legacySpeakerToV3[speaker] ?? speaker;
}
