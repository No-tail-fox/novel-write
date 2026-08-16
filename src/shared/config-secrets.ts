import type { AppConfig, AppState } from './types';

export type SecretId =
  | `llm/${string}/apiKey`
  | `image/${string}/apiKey`
  | `image/${string}/gptImage/apiKey`
  | `image/${string}/jimeng/sessionId`
  | `image/${string}/jimeng/accessKeyId`
  | `image/${string}/jimeng/secretAccessKey`
  | `image/${string}/customImage/apiKey`
  | `video/${string}/apiKey`
  | `tts/${string}/accessKey`
  | `tts/${string}/volcengine/apiKey`
  | `tts/${string}/volcengine/accessKeyId`
  | `tts/${string}/volcengine/secretAccessKey`
  | `tts/${string}/volcengine/accessKey`
  | `tts/${string}/minimax/apiKey`
  | 'speechToText/apiKey'
  | 'ima/apiKey'
  | 'viralVision/apiKey';

export type ConfigSecrets = Partial<Record<SecretId, string>>;
export type SecretStatus = Partial<Record<SecretId, boolean>>;
export type SecretChanges = Partial<Record<SecretId, string | null>>;

export interface SaveConfigInput {
  config: AppConfig;
  secretChanges: SecretChanges;
}

export type PublicAppState = Omit<AppState, 'config'> & {
  config: AppConfig;
  secretStatus: SecretStatus;
};

interface SecretSlot {
  id: SecretId;
  read: () => string | undefined;
  write: (value: string) => void;
}

const SECRET_ID_PATTERN = /^(?:llm\/[^/]+\/apiKey|image\/[^/]+\/(?:apiKey|gptImage\/apiKey|jimeng\/(?:sessionId|accessKeyId|secretAccessKey)|customImage\/apiKey)|video\/[^/]+\/apiKey|tts\/[^/]+\/(?:accessKey|volcengine\/(?:apiKey|accessKeyId|secretAccessKey|accessKey)|minimax\/apiKey)|speechToText\/apiKey|ima\/apiKey|viralVision\/apiKey)$/u;

export function isSecretId(value: string): value is SecretId {
  return value.length <= 1024 && SECRET_ID_PATTERN.test(value);
}

function cloneConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    llm: { ...config.llm },
    llmProfiles: config.llmProfiles.map((profile) => ({ ...profile })),
    image: { ...config.image },
    gptImage: { ...config.gptImage },
    jimeng: { ...config.jimeng },
    customImage: { ...config.customImage },
    imageProfiles: config.imageProfiles.map((profile) => ({
      ...profile,
      gptImage: profile.gptImage ? { ...profile.gptImage } : undefined,
      jimeng: profile.jimeng ? { ...profile.jimeng } : undefined,
      customImage: profile.customImage ? { ...profile.customImage } : undefined,
    })),
    video: {
      ...config.video,
      providers: config.video.providers.map((provider) => ({ ...provider, capabilities: [...provider.capabilities] })),
      automation: { ...config.video.automation, providerWhitelist: [...config.video.automation.providerWhitelist] },
    },
    tts: {
      ...config.tts,
      volcengine: { ...config.tts.volcengine },
      minimax: { ...config.tts.minimax },
    },
    ttsProfiles: config.ttsProfiles.map((profile) => ({
      ...profile,
      volcengine: profile.volcengine ? { ...profile.volcengine } : undefined,
      minimax: profile.minimax ? { ...profile.minimax } : undefined,
    })),
    speechToText: { ...config.speechToText },
    ima: { ...config.ima },
    viral: { ...config.viral, vision: { ...config.viral.vision } },
  };
}

function stableProfileSegment(kind: string, id: string | undefined, used: Set<string>): string {
  const value = id?.trim();
  if (!value) {
    throw new Error(`CONFIG_SECRET_STABLE_PROFILE_ID_REQUIRED: ${kind} profile requires a stable profile id.`);
  }
  if (used.has(value)) {
    throw new Error(`CONFIG_SECRET_DUPLICATE_PROFILE_ID: Duplicate ${kind} profile id.`);
  }
  used.add(value);
  return encodeURIComponent(value);
}

function secretSlots(config: AppConfig): SecretSlot[] {
  const slots: SecretSlot[] = [];
  const ids = new Set<SecretId>();
  const add = (id: SecretId, read: () => string | undefined, write: (value: string) => void) => {
    if (ids.has(id)) throw new Error(`CONFIG_SECRET_DUPLICATE_ID: Duplicate secret id ${id}.`);
    ids.add(id);
    slots.push({ id, read, write });
  };

  add('llm/@active/apiKey', () => config.llm.apiKey, (value) => { config.llm.apiKey = value; });
  add('image/@legacy/apiKey', () => config.image.apiKey, (value) => { config.image.apiKey = value; });
  add('image/@active/gptImage/apiKey', () => config.gptImage.apiKey, (value) => { config.gptImage.apiKey = value; });
  add('image/@active/jimeng/sessionId', () => config.jimeng.sessionId, (value) => { config.jimeng.sessionId = value; });
  add('image/@active/jimeng/accessKeyId', () => config.jimeng.accessKeyId, (value) => { config.jimeng.accessKeyId = value; });
  add('image/@active/jimeng/secretAccessKey', () => config.jimeng.secretAccessKey, (value) => { config.jimeng.secretAccessKey = value; });
  add('image/@active/customImage/apiKey', () => config.customImage.apiKey, (value) => { config.customImage.apiKey = value; });
  add('tts/@active/accessKey', () => config.tts.accessKey, (value) => { config.tts.accessKey = value; });
  add('tts/@active/volcengine/apiKey', () => config.tts.volcengine.apiKey, (value) => { config.tts.volcengine.apiKey = value; });
  add('tts/@active/volcengine/accessKeyId', () => config.tts.volcengine.accessKeyId, (value) => { config.tts.volcengine.accessKeyId = value; });
  add('tts/@active/volcengine/secretAccessKey', () => config.tts.volcengine.secretAccessKey, (value) => { config.tts.volcengine.secretAccessKey = value; });
  add('tts/@active/volcengine/accessKey', () => config.tts.volcengine.accessKey, (value) => { config.tts.volcengine.accessKey = value; });
  add('tts/@active/minimax/apiKey', () => config.tts.minimax.apiKey, (value) => { config.tts.minimax.apiKey = value; });
  add('speechToText/apiKey', () => config.speechToText.apiKey, (value) => { config.speechToText.apiKey = value; });
  add('ima/apiKey', () => config.ima.apiKey, (value) => { config.ima.apiKey = value; });
  add('viralVision/apiKey', () => config.viral.vision.apiKey, (value) => { config.viral.vision.apiKey = value; });

  const llmIds = new Set<string>();
  for (const profile of config.llmProfiles) {
    const segment = stableProfileSegment('LLM', profile.id, llmIds);
    add(`llm/${segment}/apiKey`, () => profile.apiKey, (value) => { profile.apiKey = value; });
  }

  const imageIds = new Set<string>();
  for (const profile of config.imageProfiles) {
    const segment = stableProfileSegment('image', profile.id, imageIds);
    if (profile.gptImage) {
      const target = profile.gptImage;
      add(`image/${segment}/gptImage/apiKey`, () => target.apiKey, (value) => { target.apiKey = value; });
    }
    if (profile.jimeng) {
      const target = profile.jimeng;
      add(`image/${segment}/jimeng/sessionId`, () => target.sessionId, (value) => { target.sessionId = value; });
      add(`image/${segment}/jimeng/accessKeyId`, () => target.accessKeyId, (value) => { target.accessKeyId = value; });
      add(`image/${segment}/jimeng/secretAccessKey`, () => target.secretAccessKey, (value) => { target.secretAccessKey = value; });
    }
    if (profile.customImage) {
      const target = profile.customImage;
      add(`image/${segment}/customImage/apiKey`, () => target.apiKey, (value) => { target.apiKey = value; });
    }
  }

  const videoIds = new Set<string>();
  for (const provider of config.video.providers) {
    const segment = stableProfileSegment('video', provider.id, videoIds);
    add(`video/${segment}/apiKey`, () => provider.apiKey, (value) => { provider.apiKey = value; });
  }

  const ttsIds = new Set<string>();
  for (const profile of config.ttsProfiles) {
    const segment = stableProfileSegment('TTS', profile.id, ttsIds);
    add(`tts/${segment}/accessKey`, () => profile.accessKey, (value) => { profile.accessKey = value; });
    if (profile.volcengine) {
      const target = profile.volcengine;
      add(`tts/${segment}/volcengine/apiKey`, () => target.apiKey, (value) => { target.apiKey = value; });
      add(`tts/${segment}/volcengine/accessKeyId`, () => target.accessKeyId, (value) => { target.accessKeyId = value; });
      add(`tts/${segment}/volcengine/secretAccessKey`, () => target.secretAccessKey, (value) => { target.secretAccessKey = value; });
      add(`tts/${segment}/volcengine/accessKey`, () => target.accessKey, (value) => { target.accessKey = value; });
    }
    if (profile.minimax) {
      const target = profile.minimax;
      add(`tts/${segment}/minimax/apiKey`, () => target.apiKey, (value) => { target.apiKey = value; });
    }
  }

  return slots;
}

export function extractConfigSecrets(config: AppConfig): ConfigSecrets {
  const secrets: ConfigSecrets = {};
  for (const slot of secretSlots(config)) {
    const value = slot.read();
    if (value !== undefined && value.length > 0) secrets[slot.id] = value;
  }
  return secrets;
}

export function stripConfigSecrets(config: AppConfig): AppConfig {
  const stripped = cloneConfig(config);
  for (const slot of secretSlots(stripped)) {
    if (slot.read() !== undefined) slot.write('');
  }
  return stripped;
}

export function applyConfigSecrets(config: AppConfig, secrets: ConfigSecrets): AppConfig {
  for (const [id, value] of Object.entries(secrets)) {
    if (!isSecretId(id) || typeof value !== 'string') {
      throw new Error('CONFIG_SECRET_INVALID_VALUE: Invalid secret map.');
    }
  }
  const applied = cloneConfig(config);
  for (const slot of secretSlots(applied)) {
    if (Object.prototype.hasOwnProperty.call(secrets, slot.id)) slot.write(secrets[slot.id] ?? '');
  }
  return applied;
}

export function secretStatus(secrets: ConfigSecrets): SecretStatus {
  const status: SecretStatus = {};
  for (const [id, value] of Object.entries(secrets)) {
    if (isSecretId(id) && typeof value === 'string') status[id] = value.length > 0;
  }
  return status;
}

export function collectSecretRedactionTokens(secrets: ConfigSecrets): string[] {
  return Array.from(new Set(Object.values(secrets).filter((value): value is string => typeof value === 'string' && value.length > 0))).sort(
    (left, right) => right.length - left.length,
  );
}
