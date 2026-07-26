import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfigFromFileStrict, saveConfigToFile } from '../src/shared/config-file';
import { normalizeAppConfig } from '../src/shared/config-utils';
import {
  applyConfigSecrets,
  extractConfigSecrets,
  isSecretId,
  secretStatus,
  stripConfigSecrets,
  type ConfigSecrets,
  type PublicAppState,
  type SaveConfigInput,
  type SecretChanges,
  type SecretId,
} from '../src/shared/config-secrets';
import type {
  AppConfig,
  AppState,
  BootstrapState,
  CursorPage,
  CursorRequest,
  DraftTemplateSummary,
  HistoryListInput,
  HistoryPage,
  ImageLabSummary,
  PromptTemplateSummary,
  TaskSummary,
  ViralAnalysisSummary,
  VoiceLabSummary,
} from '../src/shared/types';
import type { ThemePreferencePair } from '../src/shared/theme-preference';

const MIGRATION_MARKER = 'config-secrets.v1.migrated';

export interface ConfigDatabase {
  getState: () => Promise<AppState>;
  getBootstrapMetadata: () => Promise<Pick<AppState, 'config' | 'customStyles' | 'customCoverTemplates' | 'creditTransactions' | 'minimaxCloneVoices' | 'account' | 'activation' | 'ui'>>;
  listTaskSummaries: (request?: HistoryListInput<'task'>) => Promise<HistoryPage<'task', TaskSummary>>;
  listViralAnalyses: (request?: HistoryListInput<'viral-analysis'>) => Promise<HistoryPage<'viral-analysis', ViralAnalysisSummary>>;
  listImageLabRecords: (request?: HistoryListInput<'image-lab'>) => Promise<HistoryPage<'image-lab', ImageLabSummary>>;
  listVoiceLabRecords: (request?: HistoryListInput<'voice-lab'>) => Promise<HistoryPage<'voice-lab', VoiceLabSummary>>;
  listPromptTemplateSummaries: (request?: CursorRequest) => Promise<CursorPage<PromptTemplateSummary>>;
  listDraftTemplateSummaries: (request?: CursorRequest) => Promise<CursorPage<DraftTemplateSummary>>;
  upsertConfig: (
    config: AppConfig,
    options?: { legacyThemeCandidate?: boolean },
  ) => Promise<ThemePreferencePair>;
}

export interface ConfigVault {
  load: () => Promise<ConfigSecrets>;
  save: (secrets: ConfigSecrets) => Promise<void>;
}

export interface ConfigServiceOptions {
  database: ConfigDatabase;
  dataDir: string;
  vault: ConfigVault;
}

export interface PublicConfigState {
  config: AppConfig;
  secretStatus: Partial<Record<string, boolean>>;
}

export function configMigrationMarkerPath(dataDir: string): string {
  return join(dataDir, MIGRATION_MARKER);
}

function hasSecrets(secrets: ConfigSecrets): boolean {
  return Object.keys(secrets).length > 0;
}

function mergeSecretChanges(current: ConfigSecrets, changes: SecretChanges): ConfigSecrets {
  const next: ConfigSecrets = { ...current };
  for (const [id, value] of Object.entries(changes)) {
    if (!isSecretId(id) || (value !== null && (typeof value !== 'string' || value.length === 0))) {
      throw new Error('CONFIG_SECRET_CHANGE_INVALID: Secret changes must be non-empty strings or null.');
    }
    if (value === null) delete next[id];
    else next[id] = value;
  }
  return next;
}

function synchronizeSecret(
  secrets: ConfigSecrets,
  profileId: SecretId | null,
  activeId: SecretId,
  preferActiveWhenProfileMissing: boolean,
): void {
  if (!profileId) return;
  const profileValue = secrets[profileId];
  const activeValue = secrets[activeId];
  if (profileValue !== undefined) {
    secrets[activeId] = profileValue;
  } else if (preferActiveWhenProfileMissing && activeValue !== undefined) {
    secrets[profileId] = activeValue;
  } else {
    delete secrets[activeId];
  }
}

function profileSecretId(domain: 'llm' | 'image' | 'tts', profileId: string, suffix: string): SecretId | null {
  const encodedProfileId = encodeURIComponent(profileId.trim());
  if (!encodedProfileId) return null;
  const id = `${domain}/${encodedProfileId}/${suffix}`;
  return isSecretId(id) ? id : null;
}

function canonicalizeActiveSecrets(config: AppConfig, input: ConfigSecrets, preferActiveWhenProfileMissing: boolean): ConfigSecrets {
  const secrets: ConfigSecrets = { ...input };
  synchronizeSecret(secrets, profileSecretId('llm', config.activeLlmProfileId, 'apiKey'), 'llm/@active/apiKey', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('image', config.activeImageProfileId, 'gptImage/apiKey'), 'image/@active/gptImage/apiKey', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('image', config.activeImageProfileId, 'jimeng/sessionId'), 'image/@active/jimeng/sessionId', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('image', config.activeImageProfileId, 'jimeng/accessKeyId'), 'image/@active/jimeng/accessKeyId', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('image', config.activeImageProfileId, 'jimeng/secretAccessKey'), 'image/@active/jimeng/secretAccessKey', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('image', config.activeImageProfileId, 'customImage/apiKey'), 'image/@active/customImage/apiKey', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('tts', config.activeTtsProfileId, 'accessKey'), 'tts/@active/accessKey', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('tts', config.activeTtsProfileId, 'volcengine/apiKey'), 'tts/@active/volcengine/apiKey', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('tts', config.activeTtsProfileId, 'volcengine/accessKeyId'), 'tts/@active/volcengine/accessKeyId', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('tts', config.activeTtsProfileId, 'volcengine/secretAccessKey'), 'tts/@active/volcengine/secretAccessKey', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('tts', config.activeTtsProfileId, 'volcengine/accessKey'), 'tts/@active/volcengine/accessKey', preferActiveWhenProfileMissing);
  synchronizeSecret(secrets, profileSecretId('tts', config.activeTtsProfileId, 'minimax/apiKey'), 'tts/@active/minimax/apiKey', preferActiveWhenProfileMissing);
  return secrets;
}

function normalizeConfigWithSecrets(config: AppConfig, secrets: ConfigSecrets): AppConfig {
  const normalized = normalizeAppConfig(config);
  return normalizeAppConfig(applyConfigSecrets(
    normalized,
    canonicalizeActiveSecrets(normalized, secrets, false),
  ));
}

function assertVaultRoundTrip(expected: ConfigSecrets, actual: ConfigSecrets): void {
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(expectedEntries) !== JSON.stringify(actualEntries)) {
    throw new Error('CREDENTIAL_VAULT_VERIFY_FAILED: Encrypted credentials did not round-trip.');
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export class ConfigService {
  private migrationComplete = false;
  private migrationPromise: Promise<void> | null = null;

  constructor(private readonly options: ConfigServiceOptions) {}

  async migrateLegacySecrets(): Promise<void> {
    if (this.migrationComplete) return;
    this.migrationPromise ??= this.performMigration();
    try {
      await this.migrationPromise;
      this.migrationComplete = true;
    } catch (error) {
      this.migrationPromise = null;
      throw error;
    }
  }

  async getPublicState(): Promise<PublicAppState> {
    await this.migrateLegacySecrets();
    const [state, secrets] = await Promise.all([this.options.database.getState(), this.options.vault.load()]);
    return {
      ...state,
      config: stripConfigSecrets(normalizeConfigWithSecrets(state.config, secrets)),
      secretStatus: secretStatus(secrets),
    };
  }

  async getBootstrapState(revision: number): Promise<BootstrapState> {
    await this.migrateLegacySecrets();
    const [metadata, tasks, viralAnalyses, imageLabRecords, voiceLabRecords, promptTemplates, draftTemplates, secrets] = await Promise.all([
      this.options.database.getBootstrapMetadata(),
      this.options.database.listTaskSummaries({ filter: 'active' }),
      this.options.database.listViralAnalyses({ filter: 'active' }),
      this.options.database.listImageLabRecords({ filter: 'active' }),
      this.options.database.listVoiceLabRecords({ filter: 'active' }),
      this.options.database.listPromptTemplateSummaries(),
      this.options.database.listDraftTemplateSummaries(),
      this.options.vault.load(),
    ]);
    return {
      ...metadata,
      revision,
      config: stripConfigSecrets(normalizeConfigWithSecrets(metadata.config, secrets)),
      secretStatus: secretStatus(secrets),
      tasks,
      viralAnalyses,
      imageLabRecords,
      voiceLabRecords,
      promptTemplates,
      draftTemplates,
    };
  }

  async getRuntimeConfig(): Promise<AppConfig> {
    await this.migrateLegacySecrets();
    const [metadata, secrets] = await Promise.all([this.options.database.getBootstrapMetadata(), this.options.vault.load()]);
    return normalizeConfigWithSecrets(metadata.config, secrets);
  }

  async getRuntimeConfigFor(input: SaveConfigInput): Promise<AppConfig> {
    await this.migrateLegacySecrets();
    const stored = await this.options.vault.load();
    return normalizeConfigWithSecrets(input.config, mergeSecretChanges(stored, input.secretChanges));
  }

  async resolveSecret(secretId: string | undefined, candidate: string): Promise<string> {
    if (candidate.length > 0 || !secretId || !isSecretId(secretId)) return candidate;
    await this.migrateLegacySecrets();
    return (await this.options.vault.load())[secretId] ?? '';
  }

  async save(input: SaveConfigInput): Promise<PublicConfigState> {
    await this.migrateLegacySecrets();
    const storedSecrets = await this.options.vault.load();
    const normalizedInput = normalizeAppConfig(input.config);
    const nextSecrets = canonicalizeActiveSecrets(
      normalizedInput,
      mergeSecretChanges(storedSecrets, input.secretChanges),
      false,
    );
    const sanitized = stripConfigSecrets(normalizeConfigWithSecrets(normalizedInput, nextSecrets));
    if (Object.keys(input.secretChanges).length > 0) {
      await this.options.vault.save(nextSecrets);
      assertVaultRoundTrip(nextSecrets, await this.options.vault.load());
    }
    const persisted = await this.options.database.upsertConfig(sanitized);
    await saveConfigToFile(this.options.dataDir, persisted.config);
    return { config: persisted.config, secretStatus: secretStatus(await this.options.vault.load()) };
  }

  private async performMigration(): Promise<void> {
    const state = await this.options.database.getBootstrapMetadata();
    const externalConfig = await loadConfigFromFileStrict(this.options.dataDir);
    const sourceConfig = normalizeAppConfig(externalConfig ?? state.config);
    const legacySecrets: ConfigSecrets = {
      ...extractConfigSecrets(state.config),
      ...(externalConfig ? extractConfigSecrets(externalConfig) : {}),
    };
    const storedSecrets = await this.options.vault.load();

    if (hasSecrets(legacySecrets)) {
      const mergedSecrets = canonicalizeActiveSecrets(sourceConfig, { ...legacySecrets, ...storedSecrets }, true);
      await this.options.vault.save(mergedSecrets);
      assertVaultRoundTrip(mergedSecrets, await this.options.vault.load());
      const sanitized = stripConfigSecrets(sourceConfig);
      const persisted = await this.options.database.upsertConfig(sanitized, { legacyThemeCandidate: Boolean(externalConfig) });
      if (externalConfig) await saveConfigToFile(this.options.dataDir, persisted.config);
    } else if (externalConfig && JSON.stringify(stripConfigSecrets(state.config)) !== JSON.stringify(stripConfigSecrets(externalConfig))) {
      const persisted = await this.options.database.upsertConfig(stripConfigSecrets(externalConfig), { legacyThemeCandidate: true });
      await saveConfigToFile(this.options.dataDir, persisted.config);
    }

    const markerPath = configMigrationMarkerPath(this.options.dataDir);
    if (!(await fileExists(markerPath))) {
      await mkdir(this.options.dataDir, { recursive: true });
      await writeFile(markerPath, '1\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
  }
}
