const DEFAULT_OPENAI_IMAGE_BASE_URL = 'https://api.openai.com';

export function normalizeOpenAiImageBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  const base = trimmed || DEFAULT_OPENAI_IMAGE_BASE_URL;
  return base.endsWith('/v1') ? base : `${base}/v1`;
}
