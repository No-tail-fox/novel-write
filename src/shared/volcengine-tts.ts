import type { VolcengineTtsApiVersion } from './types';

export const VOLCENGINE_TTS_ARK_KEY_MESSAGE =
  'Volcengine TTS V3 API Key cannot be an Ark model key; create a TTS API Key in the Volcengine voice console.';
export const DEFAULT_VOLCENGINE_TTS_V3_SPEAKER = 'zh_male_m191_uranus_bigtts';
export const DEFAULT_VOLCENGINE_TTS_V3_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
export const DEFAULT_VOLCENGINE_TTS_LEGACY_ENDPOINT = 'https://openspeech.bytedance.com/api/v1/tts';

type VolcengineTtsApiSettingsInput = {
  apiVersion?: unknown;
  apiVersionExplicit?: unknown;
  apiKey?: unknown;
  endpoint?: unknown;
  v3Endpoint?: unknown;
  legacyEndpoint?: unknown;
};

export function resolveVolcengineTtsApiVersion(input: VolcengineTtsApiSettingsInput): VolcengineTtsApiVersion {
  if (input.apiVersionExplicit !== false && (input.apiVersion === 'v3' || input.apiVersion === 'legacy')) return input.apiVersion;
  return String(input.apiKey ?? '').trim() ? 'v3' : 'legacy';
}

export function normalizeVolcengineTtsApiSettings(input: VolcengineTtsApiSettingsInput): {
  apiVersion: VolcengineTtsApiVersion;
  apiVersionExplicit: boolean;
  endpoint: string;
  v3Endpoint: string;
  legacyEndpoint: string;
} {
  const apiVersionExplicit = input.apiVersionExplicit !== false
    && (input.apiVersion === 'v3' || input.apiVersion === 'legacy');
  const apiVersion = resolveVolcengineTtsApiVersion(input);
  const compatibilityEndpoint = String(input.endpoint ?? '').trim();
  const v3Endpoint = String(input.v3Endpoint ?? '').trim()
    || (apiVersion === 'v3' ? compatibilityEndpoint : '')
    || DEFAULT_VOLCENGINE_TTS_V3_ENDPOINT;
  const legacyEndpoint = String(input.legacyEndpoint ?? '').trim()
    || (apiVersion === 'legacy' ? compatibilityEndpoint : '')
    || DEFAULT_VOLCENGINE_TTS_LEGACY_ENDPOINT;
  return {
    apiVersion,
    apiVersionExplicit,
    endpoint: apiVersion === 'v3' ? v3Endpoint : legacyEndpoint,
    v3Endpoint,
    legacyEndpoint,
  };
}

export function resolveVolcengineTtsEndpoint(input: VolcengineTtsApiSettingsInput): string {
  return normalizeVolcengineTtsApiSettings(input).endpoint;
}

const legacySpeakerToV3: Record<string, string> = {
  '灿博小叔': 'zh_male_yuanboxiaoshu_moon_bigtts',
  '东方浩然': DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
  '渊博小叔': 'zh_male_yuanboxiaoshu_moon_bigtts',
  '温柔小雅': 'zh_female_wenrouxiaoya_moon_bigtts',
  '爽快思思': 'zh_female_shuangkuaisisi_uranus_bigtts',
};

export function isArkModelApiKey(value: string | null | undefined): boolean {
  return /^ark-/i.test(String(value ?? '').trim());
}

export function normalizeVolcengineV3Speaker(value: string | null | undefined): string {
  const speaker = String(value ?? '').trim();
  return legacySpeakerToV3[speaker] ?? speaker;
}
