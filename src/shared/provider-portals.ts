import type { AppConfig } from './types';

export interface ProviderPortal {
  label: string;
  url: string;
}

export const PROVIDER_KEY_PORTALS = {
  sunoCreate: { label: 'Suno 音乐创作与授权', url: 'https://www.suno-api.io/create/' },
  sunoAccount: { label: 'Suno 服务账户', url: 'https://www.suno-api.io/console' },
  openai: { label: 'OpenAI API Key', url: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Claude API Key', url: 'https://platform.claude.com/settings/keys' },
  minimax: { label: 'MiniMax API Key', url: 'https://platform.minimax.cn/console/access?tab=api-keys' },
  volcSpeech: { label: '火山语音密钥与应用', url: 'https://console.volcengine.com/speech/service/8' },
  volcAccess: { label: '火山 Access Key', url: 'https://console.volcengine.com/iam/keymanage/' },
  volcArk: { label: '火山方舟 API Key', url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
  siliconflow: { label: 'SiliconFlow API Key', url: 'https://cloud.siliconflow.cn/account/ak' },
} as const satisfies Record<string, ProviderPortal>;

const portalsByHost: Record<string, ProviderPortal> = {
  'api.openai.com': PROVIDER_KEY_PORTALS.openai,
  'api.anthropic.com': PROVIDER_KEY_PORTALS.anthropic,
  'api.minimaxi.com': PROVIDER_KEY_PORTALS.minimax,
  'api.siliconflow.cn': PROVIDER_KEY_PORTALS.siliconflow,
  'openspeech.bytedance.com': PROVIDER_KEY_PORTALS.volcSpeech,
  'visual.volcengineapi.com': PROVIDER_KEY_PORTALS.volcAccess,
  'ark.cn-beijing.volces.com': PROVIDER_KEY_PORTALS.volcArk,
};

function publicHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    // Local servers do not have a public credential portal. Main applies network policy too.
    if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    return url;
  } catch {
    return null;
  }
}

export function providerPortalForApi(baseUrl: string): ProviderPortal[] {
  const url = publicHttpsUrl(baseUrl);
  if (!url) return [];
  const known = portalsByHost[url.hostname];
  return [known ?? { label: '服务商网站', url: `${url.origin}/` }];
}

export function isProviderPortalUrl(value: string): boolean {
  const url = publicHttpsUrl(value);
  if (!url) return false;
  return Object.values(PROVIDER_KEY_PORTALS).some((portal) => portal.url === url.href)
    || url.href === `${url.origin}/`;
}

export type ProviderPortalTarget = 'llm' | 'image' | 'video' | 'tts' | 'speechToText';

export function providerKeyPortals(target: ProviderPortalTarget, config: AppConfig): ProviderPortal[] {
  switch (target) {
    case 'llm':
      return providerPortalForApi(config.llm.baseUrl || (config.llm.provider === 'anthropic' ? 'https://api.anthropic.com' : config.llm.provider === 'openai' ? 'https://api.openai.com' : ''));
    case 'image':
      if (config.imageProvider === 'jimeng') return [PROVIDER_KEY_PORTALS.volcAccess];
      return providerPortalForApi(config.imageProvider === 'custom' ? config.customImage.baseUrl : config.gptImage.baseUrl || 'https://api.openai.com');
    case 'video': {
      const selected = config.video.providers.find((provider) => provider.id === config.video.activeProviderId) ?? config.video.providers[0];
      return providerPortalForApi(selected?.baseUrl ?? '');
    }
    case 'tts':
      if (config.tts.provider === 'minimax') return [PROVIDER_KEY_PORTALS.minimax];
      return config.tts.volcengine.apiVersion === 'legacy'
        ? [PROVIDER_KEY_PORTALS.volcSpeech]
        : [PROVIDER_KEY_PORTALS.volcSpeech, PROVIDER_KEY_PORTALS.volcAccess];
    case 'speechToText':
      return providerPortalForApi(config.speechToText.baseUrl || (config.speechToText.provider === 'siliconflow' ? 'https://api.siliconflow.cn' : 'https://api.openai.com'));
  }
}
