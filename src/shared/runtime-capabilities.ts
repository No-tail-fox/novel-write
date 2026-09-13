import type { StoryDreamApi } from './storydream-api';

export type StoryDreamRuntimeKind = 'electron' | 'browser-fallback' | 'browser-companion';

export interface StoryDreamRuntimeCapabilities {
  kind: StoryDreamRuntimeKind;
  label: string;
  canReadLocalFiles: boolean;
  canWriteJianyingDraft: boolean;
  canLaunchJianying: boolean;
  canRunLocalPipelines: boolean;
  api: StoryDreamApi | null;
}

export interface BrowserCompanionConfig {
  origin: string;
  pairingToken?: string;
}

export interface StoryDreamWindowBindings {
  storydream?: StoryDreamApi;
  storybound?: StoryDreamApi;
}

function isStoryDreamApi(value: unknown): value is StoryDreamApi {
  return Boolean(value && typeof value === 'object' && typeof (value as StoryDreamApi).getBootstrap === 'function');
}

export function detectStoryDreamRuntime(
  windowValue: StoryDreamWindowBindings,
  companion?: BrowserCompanionConfig | null,
): StoryDreamRuntimeCapabilities {
  const electronApi = windowValue.storydream ?? windowValue.storybound;
  if (isStoryDreamApi(electronApi)) {
    return {
      kind: 'electron',
      label: '桌面应用',
      canReadLocalFiles: true,
      canWriteJianyingDraft: true,
      canLaunchJianying: true,
      canRunLocalPipelines: true,
      api: electronApi,
    };
  }

  // Configuration alone is not a connection. A verified transport is not implemented yet.
  return {
    kind: 'browser-fallback',
    label: companion?.origin ? '本机未连接' : '浏览器预览',
    canReadLocalFiles: false,
    canWriteJianyingDraft: false,
    canLaunchJianying: false,
    canRunLocalPipelines: false,
    api: null,
  };
}

export function parseBrowserCompanionConfig(raw: string | null): BrowserCompanionConfig | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const config = parsed as Partial<BrowserCompanionConfig>;
    if (typeof config.origin !== 'string') return null;
    const url = new URL(config.origin);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname !== '127.0.0.1'
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (config.pairingToken !== undefined && (typeof config.pairingToken !== 'string' || config.pairingToken.length > 512)) return null;
    return {
      origin: url.origin,
      ...(config.pairingToken ? { pairingToken: config.pairingToken } : {}),
    };
  } catch {
    return null;
  }
}
