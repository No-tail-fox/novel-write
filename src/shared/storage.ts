import { mkdir, open as openFile, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import type {
  AccountProfile,
  ActivationState,
  AppConfig,
  AppState,
  BookSelectionInput,
  BookSelectionRecord,
  CreateTaskInput,
  CountedCursorPage,
  CursorPage,
  CursorRequest,
  CreditTransaction,
  CustomCoverTemplate,
  CustomStyle,
  DraftTemplate,
  DraftTemplateSummary,
  HistoryFamily,
  HistoryListInput,
  HistoryPage,
  HtmlVideoConfigChange,
  HtmlVideoCoverAsset,
  ImageLabRecord,
  ImageLabSummary,
  MinimaxCloneVoice,
  PromptTemplate,
  PromptTemplateSummary,
  SequencedTaskEvent,
  Task,
  TaskEvent,
  TaskSummary,
  TaskStatus,
  UiPreferences,
  UiPreferencesUpdate,
  CreateViralAnalysisInput,
  ViralAnalysisEvent,
  ViralAnalysisRecord,
  ViralAnalysisSummary,
  ViralAnalysisStage,
  VoiceLabRecord,
  VoiceLabSummary,
} from './types';
import { applyHtmlVideoConfigChanges, htmlVideoVisibleSteps, invalidateHtmlVideoPipeline, parseHtmlVideoPipelineData } from './html-video-workflow';
import {
  createHtmlVideoCoverAsset,
  htmlVideoCoverDimensions,
  normalizeHtmlVideoCoverMode,
  normalizeHtmlVideoCoverRatio,
  validateHtmlVideoCoverInspection,
  type HtmlVideoCoverImageProcessor,
  type HtmlVideoCoverInspection,
} from './html-video-cover';
import { normalizeAppConfig } from './config-utils';
import { stripConfigSecrets } from './config-secrets';
import {
  canonicalThemePreferencePair,
  migrateThemePreference,
  validTheme,
  type ThemePreferencePair,
} from './theme-preference';
import { normalizeStoryboardSceneCount } from './content-metrics';
import feishuCozeDraftTemplateBundle from '../../data/coze-workflows/feishu-draft-templates.json';
import {
  defaultAccount,
  defaultActivation,
  defaultConfig,
  defaultCreditTransactions,
  defaultCustomCoverTemplates,
  defaultCustomStyles,
  defaultMinimaxCloneVoices,
  defaultUiPreferences,
} from './config';
import { loadDefaultPromptTemplates } from './prompt-template-loader';
import { parseDraftTemplate } from './draft-template-contract';
import { draftTemplates, normalizeDraftTemplate } from './templates';
import { isOrdinaryTask, parseOrdinaryCoverMode, resolveOrdinaryCoverTemplate } from '../features/tasks/task-control-manifest';
export { defaultConfig } from './config';

interface AddEventInput {
  type: string;
  step?: number | null;
  agent?: string | null;
  tool?: string | null;
  detail: string;
  dataJson?: string | null;
  ts?: number;
}

interface AddViralEventInput {
  type: string;
  stage: ViralAnalysisStage | string;
  detail: string;
  dataJson?: string | null;
  ts?: number;
}

export interface HtmlVideoTaskConfigMutationResult {
  task: TaskSummary;
  event: SequencedTaskEvent;
  changedFields: HtmlVideoConfigChange['field'][];
}

export interface HtmlVideoCoverImportOperations {
  prepareImage: HtmlVideoCoverImageProcessor;
  promoteFile: (source: string, target: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  ensureDirectory: (path: string) => Promise<void>;
  now: () => string;
}

export interface HtmlVideoTaskCoverMutationResult {
  task: TaskSummary;
  event: SequencedTaskEvent;
  coverAsset: HtmlVideoCoverAsset;
}

interface HistorySqlFilter {
  sql: string;
  params: SqlValue[];
}

type PromptTemplateInput = Omit<PromptTemplate, 'description' | 'isBuiltin' | 'updatedAt'> &
  Partial<Pick<PromptTemplate, 'description' | 'isBuiltin' | 'updatedAt'>>;
type ImageLabRecordInput = Partial<Omit<ImageLabRecord, 'createdAt' | 'finishedAt' | 'status'>> &
  Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'> & {
    status?: ImageLabRecord['status'];
    createdAt?: string;
    finishedAt?: string | null;
  };
type VoiceLabRecordInput = Partial<Omit<VoiceLabRecord, 'id' | 'createdAt' | 'finishedAt'>> &
  Pick<VoiceLabRecord, 'text' | 'provider' | 'voiceId' | 'speed'> & {
    id?: string;
    createdAt?: string;
    finishedAt?: string | null;
  };

export interface HistoryTombstone {
  family: HistoryFamily;
  id: string;
  managedStorageKey: string | null;
  cleanupState: string;
  quarantineName: string | null;
  quarantineIdentityJson: string;
  diagnostic: string;
  deletedAt: string;
}

export interface HistoryDeletionCleanup {
  cleanupState: 'pending' | 'missing' | 'unmanaged-legacy';
  quarantineName: string | null;
  quarantineIdentityJson: string;
  diagnostic: string;
}

export interface HistoryDeletionTarget {
  family: HistoryFamily;
  id: string;
  managedStorageKey: string | null;
  tombstone: HistoryTombstone | null;
}

function normalizeHistoryDeletionCleanup(
  managedStorageKey: string | null,
  cleanup: HistoryDeletionCleanup | undefined,
): HistoryDeletionCleanup {
  if (managedStorageKey === null) {
    return {
      cleanupState: 'unmanaged-legacy',
      quarantineName: null,
      quarantineIdentityJson: '{}',
      diagnostic: 'Legacy record has no managed storage key; filesystem cleanup was not attempted.',
    };
  }
  if (!cleanup) {
    throw new Error('HISTORY_CLEANUP_METADATA_REQUIRED: Managed history deletion requires quarantine or missing-directory metadata.');
  }
  if (cleanup.cleanupState === 'missing') {
    if (cleanup.quarantineName !== null || cleanup.quarantineIdentityJson !== '{}' || !cleanup.diagnostic.trim()) {
      throw new Error('HISTORY_CLEANUP_METADATA_INVALID: Missing managed data requires a terminal diagnostic and no quarantine identity.');
    }
    return { ...cleanup };
  }
  if (cleanup.cleanupState !== 'pending' || typeof cleanup.quarantineName !== 'string') {
    throw new Error('HISTORY_CLEANUP_METADATA_INVALID: Managed history cleanup must be pending or missing.');
  }
  const prefix = `.history.${createHash('sha256').update(managedStorageKey, 'utf8').digest('hex')}.`;
  const suffix = '.quarantine';
  const token = cleanup.quarantineName.startsWith(prefix) && cleanup.quarantineName.endsWith(suffix)
    ? cleanup.quarantineName.slice(prefix.length, -suffix.length)
    : '';
  if (!/^[a-f0-9]{32}$/u.test(token)) {
    throw new Error('HISTORY_CLEANUP_METADATA_INVALID: Quarantine name does not belong to the managed storage key.');
  }
  let identity: unknown;
  try {
    identity = JSON.parse(cleanup.quarantineIdentityJson);
  } catch {
    throw new Error('HISTORY_CLEANUP_METADATA_INVALID: Quarantine identity is not valid JSON.');
  }
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('HISTORY_CLEANUP_METADATA_INVALID: Quarantine identity is invalid.');
  }
  const value = identity as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3
    || value.version !== 1
    || typeof value.dev !== 'string'
    || !/^\d+$/u.test(value.dev)
    || typeof value.ino !== 'string'
    || !/^\d+$/u.test(value.ino)
  ) {
    throw new Error('HISTORY_CLEANUP_METADATA_INVALID: Quarantine identity must contain decimal dev and ino strings.');
  }
  return { ...cleanup };
}

let sqlPromise: Promise<SqlJsStatic> | null = null;

async function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs();
  return sqlPromise;
}

function getFirstRow<T>(db: Database, sql: string, params: SqlValue[] = []): T | null {
  const stmt = db.prepare(sql, params);
  try {
    if (!stmt.step()) return null;
    return stmt.getAsObject() as T;
  } finally {
    stmt.free();
  }
}

function getRows<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const stmt = db.prepare(sql, params);
  const rows: T[] = [];
  try {
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

function tableColumns(db: Database, table: string): Set<string> {
  const rows = db.exec(`PRAGMA table_info(${JSON.stringify(table)})`)[0]?.values ?? [];
  return new Set(rows.map((row) => String(row[1])));
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string): void {
  if (!tableColumns(db, table).has(column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function json<T>(value: T): string {
  return JSON.stringify(value);
}

function toNullableSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : String(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const MAX_STORAGE_PAGE_LIMIT = 100;
const DEFAULT_STORAGE_PAGE_LIMIT = 50;
const TASK_INPUT_PREVIEW_LIMIT = 160;
const RECORD_TEXT_PREVIEW_LIMIT = 160;
const taskSummaryColumns = `
  id, archived_at, managed_storage_key, title, task_kind, processing_mode, publish_mode, status, current_step,
  track, style, speaker, ratio, template_id, bgm_id, output_dir, error_message,
  created_at, completed_at, started_at, last_heartbeat_at, mode, ai_keyword,
  prompt_template_id, prompt_template_type, reference_image_path, rewrite_intensity,
  narrative_pov, keep_promotion, tts_provider, tts_speed, storyboard_scene_count,
  failed_step, retry_from_step, artifact_state_path, video_form, llm_profile_id,
  material_source, draft_dir,
  lock_intro_sentences, task_type, pipeline_step, target_length, target_scenes,
  script_format, podcast_image_mode, podcast_speaker_a,
  podcast_speaker_b, cover_image_mode, cover_template_id, html_video_foreground,
  substr(input_text, 1, ${TASK_INPUT_PREVIEW_LIMIT}) AS input_preview
`;
const viralAnalysisSummaryColumns = `
  id, archived_at, managed_storage_key, url, platform, title, status, current_stage, progress,
  substr(error_message, 1, 1024) AS error_message,
  created_at, started_at, completed_at, last_heartbeat_at
`;
const imageLabSummaryColumns = `
  id, archived_at, managed_storage_key, substr(prompt, 1, ${RECORD_TEXT_PREVIEW_LIMIT}) AS prompt_preview,
  ratio, style, provider, image_path, status, substr(error_msg, 1, 1024) AS error_msg,
  resolution, smart_mode, upstream_task_id, created_at, finished_at
`;
const voiceLabSummaryColumns = `
  id, archived_at, managed_storage_key, substr(text, 1, ${RECORD_TEXT_PREVIEW_LIMIT}) AS text_preview,
  provider, voice_id, voice_label, speed, audio_path, status,
  substr(error_msg, 1, 1024) AS error_msg, created_at, finished_at
`;

const historyTableByFamily: Record<HistoryFamily, 'tasks' | 'viral_analyses' | 'image_lab_records' | 'voice_lab_records'> = {
  task: 'tasks',
  'viral-analysis': 'viral_analyses',
  'image-lab': 'image_lab_records',
  'voice-lab': 'voice_lab_records',
};

function clampPageLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_STORAGE_PAGE_LIMIT;
  return Math.min(MAX_STORAGE_PAGE_LIMIT, Math.max(1, Math.trunc(limit ?? DEFAULT_STORAGE_PAGE_LIMIT)));
}

function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

const taskStatusOrder: TaskStatus[] = ['draft', 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled'];

interface HistoryCursorBinding {
  version: 1;
  family: HistoryFamily;
  filter: 'active' | 'archived';
  status: string;
  statuses: string;
  taskType: string;
  queryHash: string;
}

interface HistorySortCursor {
  sort: string;
  id: string;
}

function createManagedStorageKey(): string {
  return randomBytes(24).toString('hex');
}

function normalizeHistoryQuery(query: string | undefined): string {
  return query?.trim() ?? '';
}

function historyQueryHash(query: string): string {
  return createHash('sha256').update(query, 'utf8').digest('base64url');
}

function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function canonicalTaskStatuses(request: HistoryListInput<'task'>): TaskStatus[] {
  const requested = request.statuses ?? (request.status ? [request.status] : []);
  const statusSet = new Set(requested);
  return taskStatusOrder.filter((status) => statusSet.has(status));
}

function historyCursorBinding(input: {
  family: HistoryFamily;
  filter?: 'active' | 'archived';
  status?: string;
  statuses?: readonly string[];
  taskType?: string;
  query?: string;
}): HistoryCursorBinding {
  return {
    version: 1,
    family: input.family,
    filter: input.filter ?? 'active',
    status: input.status ?? '',
    statuses: input.statuses?.join(',') ?? '',
    taskType: input.taskType ?? '',
    queryHash: historyQueryHash(normalizeHistoryQuery(input.query)),
  };
}

function parseHistoryCursor(
  cursor: string | null | undefined,
  expected: HistoryCursorBinding,
): HistorySortCursor | null {
  const parsed = decodeCursor(cursor);
  if (!parsed) return null;
  const expectedKeys = ['family', 'filter', 'id', 'queryHash', 'sort', 'status', 'statuses', 'taskType', 'version'];
  if (
    Object.keys(parsed).sort().join(',') !== expectedKeys.join(',')
    || parsed.version !== expected.version
    || parsed.family !== expected.family
    || parsed.filter !== expected.filter
    || parsed.status !== expected.status
    || parsed.statuses !== expected.statuses
    || parsed.taskType !== expected.taskType
    || parsed.queryHash !== expected.queryHash
    || typeof parsed.sort !== 'string'
    || typeof parsed.id !== 'string'
  ) {
    throw new Error('CURSOR_INVALID: Cursor does not match the requested history view.');
  }
  return { sort: parsed.sort, id: parsed.id };
}

function encodeHistoryCursor(binding: HistoryCursorBinding, cursor: HistorySortCursor): string {
  return Buffer.from(JSON.stringify({ ...binding, ...cursor }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): Record<string, unknown> | null {
  if (cursor === null || cursor === undefined) return null;
  if (typeof cursor !== 'string' || cursor.trim().length === 0) {
    throw new Error('CURSOR_INVALID: Cursor must be a non-empty string.');
  }
  if (cursor.length > 4096) throw new Error('CURSOR_INVALID: Cursor is too long.');
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('CURSOR_INVALID: Cursor is malformed.');
  }
}

function createdIdCursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
  const parsed = decodeCursor(cursor);
  if (!parsed) return null;
  if (Object.keys(parsed).length !== 2 || typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
    throw new Error('CURSOR_INVALID: Expected a created-at cursor.');
  }
  return { createdAt: parsed.createdAt, id: parsed.id };
}

function cloneVoiceCursor(cursor: string | null | undefined): { lastUsedAt: number; voiceId: string } | null {
  const parsed = decodeCursor(cursor);
  if (!parsed) return null;
  if (Object.keys(parsed).length !== 2
    || typeof parsed.lastUsedAt !== 'number'
    || !Number.isSafeInteger(parsed.lastUsedAt)
    || typeof parsed.voiceId !== 'string') {
    throw new Error('CURSOR_INVALID: Expected a clone-voice cursor.');
  }
  return { lastUsedAt: parsed.lastUsedAt, voiceId: parsed.voiceId };
}

function sequenceCursor(cursor: string | null | undefined): number | null {
  const parsed = decodeCursor(cursor);
  if (!parsed) return null;
  if (Object.keys(parsed).length !== 1 || !Number.isSafeInteger(parsed.seq) || Number(parsed.seq) < 0) {
    throw new Error('CURSOR_INVALID: Expected an event sequence cursor.');
  }
  return Number(parsed.seq);
}

export interface FileDatabaseDependencies {
  readFile: (path: string) => Promise<Uint8Array>;
  writeTempFile: (path: string, data: Uint8Array) => Promise<void>;
  replaceFile: (source: string, target: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  ensureDirectory: (path: string) => Promise<void>;
  readDirectory: (path: string) => Promise<string[]>;
  delay: (milliseconds: number) => Promise<void>;
  createTempSuffix: () => string;
}

const atomicReplaceAttempts = 8;

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === code);
}

function resolveFileDatabaseDependencies(overrides: Partial<FileDatabaseDependencies> = {}): FileDatabaseDependencies {
  return {
    readFile: overrides.readFile ?? ((path) => readFile(path)),
    writeTempFile:
      overrides.writeTempFile ??
      (async (path, data) => {
        const handle = await openFile(path, 'wx', 0o600);
        try {
          await handle.writeFile(data);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }),
    replaceFile: overrides.replaceFile ?? ((source, target) => rename(source, target)),
    removeFile: overrides.removeFile ?? (async (path) => { await rm(path, { force: true }); }),
    ensureDirectory: overrides.ensureDirectory ?? (async (path) => { await mkdir(path, { recursive: true }); }),
    readDirectory: overrides.readDirectory ?? ((path) => readdir(path)),
    delay: overrides.delay ?? (async (milliseconds) => { await new Promise((resolve) => setTimeout(resolve, milliseconds)); }),
    createTempSuffix: overrides.createTempSuffix ?? (() => `${Date.now()}-${randomUUID()}`),
  };
}

export async function atomicWriteDatabase(
  file: string,
  data: Uint8Array,
  overrides?: Partial<FileDatabaseDependencies>,
): Promise<void> {
  const dependencies = resolveFileDatabaseDependencies(overrides);
  const suffix = dependencies.createTempSuffix().replace(/[^a-zA-Z0-9_-]/gu, '') || randomUUID();
  const tempFile = `${file}.${suffix}.tmp`;
  await dependencies.ensureDirectory(dirname(file));
  try {
    await dependencies.writeTempFile(tempFile, data);
    for (let attempt = 0; attempt < atomicReplaceAttempts; attempt += 1) {
      try {
        await dependencies.replaceFile(tempFile, file);
        return;
      } catch (error) {
        const retryable = isErrno(error, 'EBUSY') || isErrno(error, 'EPERM');
        if (!retryable || attempt === atomicReplaceAttempts - 1) throw error;
        await dependencies.delay(40 * (attempt + 1));
      }
    }
  } catch (error) {
    try {
      await dependencies.removeFile(tempFile);
    } catch {
      // Preserve the primary persistence error.
    }
    throw error;
  }
}

async function listDatabaseTempFiles(file: string, dependencies: FileDatabaseDependencies): Promise<string[]> {
  let names: string[];
  try {
    names = await dependencies.readDirectory(dirname(file));
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return [];
    throw error;
  }
  const prefix = `${basename(file)}.`;
  return names
    .filter((name) => name.startsWith(prefix) && name.endsWith('.tmp'))
    .sort((left, right) => right.localeCompare(left))
    .map((name) => join(dirname(file), name));
}

function openValidatedDatabase(SQL: SqlJsStatic, bytes: Uint8Array): Database {
  if (bytes.byteLength === 0) throw new Error('SQLITE_MALFORMED: Database file is empty.');
  const database = new SQL.Database(bytes);
  try {
    const integrity = database.exec('PRAGMA integrity_check')[0]?.values[0]?.[0];
    if (integrity !== 'ok') throw new Error('SQLITE_MALFORMED: Database integrity check failed.');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

async function recoverDatabaseTemp(
  file: string,
  SQL: SqlJsStatic,
  dependencies: FileDatabaseDependencies,
): Promise<Database | null> {
  for (const tempFile of await listDatabaseTempFiles(file, dependencies)) {
    let bytes: Uint8Array;
    try {
      bytes = await dependencies.readFile(tempFile);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) continue;
      throw error;
    }

    let database: Database;
    try {
      database = openValidatedDatabase(SQL, bytes);
    } catch {
      try {
        await dependencies.removeFile(tempFile);
      } catch {
        // Continue to the next recoverable candidate.
      }
      continue;
    }

    try {
      await dependencies.replaceFile(tempFile, file);
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }
  return null;
}

async function removeStaleDatabaseTemps(file: string, dependencies: FileDatabaseDependencies): Promise<void> {
  for (const tempFile of await listDatabaseTempFiles(file, dependencies)) {
    try {
      await dependencies.removeFile(tempFile);
    } catch {
      // A stale temp never takes precedence over a validated primary database.
    }
  }
}

async function quarantineMalformedDatabase(file: string, dependencies: FileDatabaseDependencies): Promise<void> {
  const suffix = `${Date.now()}-${randomUUID()}.malformed`;
  await dependencies.replaceFile(file, `${file}.${suffix}`);
}

function mergeConfig(input: unknown): AppConfig {
  return normalizeAppConfig(input);
}

const legacyBundledCozeDraftTemplates = new Map(
  ((feishuCozeDraftTemplateBundle as { templates?: Array<{ id?: string }> }).templates ?? [])
    .map((template) => [template.id, (template as { name?: string }).name] as const)
    .filter((entry): entry is readonly [string, string | undefined] => Boolean(entry[0])),
);

export class FileDatabase {
  private writeTail: Promise<void> = Promise.resolve();
  private closing = false;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private themePreferenceUnversionedAtOpen = false;

  private constructor(
    private readonly file: string,
    private db: Database,
    private readonly SQL: SqlJsStatic,
    private readonly dependencies: FileDatabaseDependencies,
    private readonly defaultPromptTemplates: readonly PromptTemplate[],
  ) {}

  static async open(file: string, overrides?: Partial<FileDatabaseDependencies>): Promise<FileDatabase> {
    const [SQL, defaultPromptTemplates] = await Promise.all([loadSql(), loadDefaultPromptTemplates()]);
    const dependencies = resolveFileDatabaseDependencies(overrides);
    let database: Database | null = null;
    let primaryExists = true;
    try {
      database = openValidatedDatabase(SQL, await dependencies.readFile(file));
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        primaryExists = false;
      } else if (error && typeof error === 'object' && 'code' in error) {
        throw error;
      } else {
        await quarantineMalformedDatabase(file, dependencies);
        primaryExists = false;
      }
    }

    if (!database && !primaryExists) {
      database = await recoverDatabaseTemp(file, SQL, dependencies);
    }
    database ??= new SQL.Database();

    const instance = new FileDatabase(file, database, SQL, dependencies, defaultPromptTemplates);
    try {
      instance.migrate();
      await instance.persist();
      await removeStaleDatabaseTemps(file, dependencies);
      return instance;
    } catch (error) {
      instance.db.close();
      throw error;
    }
  }

  private enqueueCommit<T>(mutation: () => T): Promise<T> {
    if (this.closing || this.closed) {
      return Promise.reject(new Error(this.closed ? 'Database is closed.' : 'Database is closing.'));
    }
    const operation = this.writeTail.then(async () => {
      const previous = this.db.export();
      try {
        const value = mutation();
        const next = this.db.export();
        await atomicWriteDatabase(this.file, next, this.dependencies);
        return value;
      } catch (error) {
        this.db.close();
        this.db = new this.SQL.Database(previous);
        throw error;
      }
    });
    this.writeTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private enqueueAsyncCommit<T>(mutation: () => Promise<T>): Promise<T> {
    if (this.closing || this.closed) {
      return Promise.reject(new Error(this.closed ? 'Database is closed.' : 'Database is closing.'));
    }
    const operation = this.writeTail.then(async () => {
      const previous = this.db.export();
      try {
        const value = await mutation();
        const next = this.db.export();
        await atomicWriteDatabase(this.file, next, this.dependencies);
        return value;
      } catch (error) {
        this.db.close();
        this.db = new this.SQL.Database(previous);
        throw error;
      }
    });
    this.writeTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async waitForWrites(): Promise<void> {
    await this.writeTail;
    if (this.closed) throw new Error('Database is closed.');
  }

  private getHistoryTombstone(family: HistoryFamily, id: string): HistoryTombstone | null {
    const row = getFirstRow<Record<string, unknown>>(
      this.db,
      'SELECT * FROM history_tombstones WHERE family = ? AND entity_id = ?',
      [family, id],
    );
    return row ? rowToHistoryTombstone(row) : null;
  }

  private assertHistoryWritable(
    family: HistoryFamily,
    id: string,
    options: { allowArchived?: boolean } = {},
  ): void {
    if (this.getHistoryTombstone(family, id)) {
      throw new Error(`HISTORY_DELETED: ${family} ${id} is tombstoned and cannot be changed.`);
    }
    if (options.allowArchived) return;
    const row = getFirstRow<{ archived_at: string | null }>(
      this.db,
      `SELECT archived_at FROM ${historyTableByFamily[family]} WHERE id = ?`,
      [id],
    );
    if (row?.archived_at) {
      throw new Error(`HISTORY_ARCHIVED: ${family} ${id} is archived and read-only.`);
    }
  }

  private getHistorySummary<T>(
    family: HistoryFamily,
    id: string,
    columns: string,
    mapRow: (row: Record<string, unknown>) => T,
  ): T {
    const row = getFirstRow<Record<string, unknown>>(
      this.db,
      `SELECT ${columns} FROM ${historyTableByFamily[family]} WHERE id = ?`,
      [id],
    );
    if (!row) throw new Error(`HISTORY_NOT_FOUND: ${family} ${id} does not exist.`);
    return mapRow(row);
  }

  private archiveHistoryRecord<T>(
    family: HistoryFamily,
    id: string,
    columns: string,
    mapRow: (row: Record<string, unknown>) => T,
    rejectActiveStatus: boolean,
  ): T {
    if (this.getHistoryTombstone(family, id)) {
      throw new Error(`HISTORY_DELETED: ${family} ${id} is tombstoned and cannot be archived.`);
    }
    const table = historyTableByFamily[family];
    const row = getFirstRow<Record<string, unknown>>(this.db, `SELECT archived_at, status FROM ${table} WHERE id = ?`, [id]);
    if (!row) throw new Error(`HISTORY_NOT_FOUND: ${family} ${id} does not exist.`);
    if (row.archived_at) return this.getHistorySummary(family, id, columns, mapRow);
    const status = String(row.status ?? '');
    if (rejectActiveStatus && (status === 'pending' || status === 'running')) {
      throw new Error(`HISTORY_ACTIVE: ${family} ${id} has ${status} status and cannot be archived or deleted.`);
    }
    this.db.run(`UPDATE ${table} SET archived_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
    return this.getHistorySummary(family, id, columns, mapRow);
  }

  private restoreHistoryRecord<T>(
    family: HistoryFamily,
    id: string,
    columns: string,
    mapRow: (row: Record<string, unknown>) => T,
  ): T {
    if (this.getHistoryTombstone(family, id)) {
      throw new Error(`HISTORY_DELETED: ${family} ${id} is tombstoned and cannot be restored.`);
    }
    const table = historyTableByFamily[family];
    const row = getFirstRow<{ archived_at: string | null }>(this.db, `SELECT archived_at FROM ${table} WHERE id = ?`, [id]);
    if (!row) throw new Error(`HISTORY_NOT_FOUND: ${family} ${id} does not exist.`);
    if (row.archived_at) this.db.run(`UPDATE ${table} SET archived_at = NULL WHERE id = ?`, [id]);
    return this.getHistorySummary(family, id, columns, mapRow);
  }

  private deleteHistoryRecordPermanently(
    family: HistoryFamily,
    id: string,
    rejectActiveStatus: boolean,
    cleanup?: HistoryDeletionCleanup,
  ): HistoryTombstone {
    const existing = this.getHistoryTombstone(family, id);
    if (existing) return existing;
    const table = historyTableByFamily[family];
    const row = getFirstRow<Record<string, unknown>>(
      this.db,
      `SELECT archived_at, managed_storage_key, status FROM ${table} WHERE id = ?`,
      [id],
    );
    if (!row) throw new Error(`HISTORY_NOT_FOUND: ${family} ${id} does not exist.`);
    const status = String(row.status ?? '');
    if (rejectActiveStatus && (status === 'pending' || status === 'running')) {
      throw new Error(`HISTORY_ACTIVE: ${family} ${id} has ${status} status and cannot be archived or deleted.`);
    }
    if (!row.archived_at) {
      throw new Error(`HISTORY_NOT_ARCHIVED: ${family} ${id} must be archived before permanent deletion.`);
    }

    const managedStorageKey = row.managed_storage_key === null || row.managed_storage_key === undefined
      ? null
      : String(row.managed_storage_key);
    const deletionCleanup = normalizeHistoryDeletionCleanup(managedStorageKey, cleanup);
    const tombstone: HistoryTombstone = {
      family,
      id,
      managedStorageKey,
      ...deletionCleanup,
      deletedAt: new Date().toISOString(),
    };
    this.db.run(
      `INSERT INTO history_tombstones
       (family, entity_id, managed_storage_key, cleanup_state, quarantine_name, quarantine_identity_json, diagnostic, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tombstone.family,
        tombstone.id,
        tombstone.managedStorageKey,
        tombstone.cleanupState,
        tombstone.quarantineName,
        tombstone.quarantineIdentityJson,
        tombstone.diagnostic,
        tombstone.deletedAt,
      ],
    );
    if (family === 'task') this.db.run('DELETE FROM task_events WHERE task_id = ?', [id]);
    if (family === 'viral-analysis') this.db.run('DELETE FROM viral_analysis_events WHERE analysis_id = ?', [id]);
    if (family === 'image-lab') this.db.run('DELETE FROM playground_jobs WHERE id = ?', [id]);
    this.db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    if (this.db.getRowsModified() !== 1) {
      throw new Error(`HISTORY_DELETE_FAILED: ${family} ${id} was not deleted.`);
    }
    return tombstone;
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        archived_at TEXT,
        managed_storage_key TEXT,
        title TEXT DEFAULT '',
        input_text TEXT NOT NULL,
        task_kind TEXT DEFAULT 'story',
        processing_mode TEXT DEFAULT 'full-auto',
        status TEXT DEFAULT 'pending',
        current_step INTEGER DEFAULT 0,
        track TEXT DEFAULT 'character-story',
        style TEXT DEFAULT 'photo-real',
        speaker TEXT DEFAULT '灿博小叔',
        ratio TEXT DEFAULT '9:16',
        template_id TEXT DEFAULT 'default-portrait-9-16',
        bgm_id TEXT DEFAULT '',
        pause_points TEXT DEFAULT '[]',
        output_dir TEXT DEFAULT '',
        error_message TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        completed_at TEXT,
        started_at TEXT,
        last_heartbeat_at TEXT,
        mode TEXT NOT NULL DEFAULT 'paste',
        publish_mode TEXT DEFAULT 'review-rewrite',
        ai_keyword TEXT DEFAULT '',
        ai_sources TEXT DEFAULT '[]',
        selected_sources TEXT DEFAULT '[]',
        extra_requirements TEXT DEFAULT '',
        image_prompt_reference TEXT DEFAULT '',
        prompt_template_id TEXT,
        prompt_template_type TEXT,
        reference_image_path TEXT DEFAULT '',
        rewrite_intensity TEXT DEFAULT 'standard',
        narrative_pov TEXT DEFAULT 'keep-original',
        keep_promotion INTEGER DEFAULT 0,
        tts_provider TEXT DEFAULT 'volcengine',
        tts_speed REAL DEFAULT 1,
        storyboard_scene_count INTEGER DEFAULT NULL,
        step3_prompt_snapshot TEXT DEFAULT '',
        music_mv_json TEXT DEFAULT '{}',
        failed_step INTEGER,
        retry_from_step INTEGER,
        artifact_state_path TEXT DEFAULT '',
        video_form TEXT DEFAULT 'narration',
        llm_profile_id TEXT,
        material_source TEXT DEFAULT 'ai',
        product_info TEXT DEFAULT NULL,
        material_person TEXT DEFAULT NULL,
        draft_dir TEXT DEFAULT NULL,
        fixed_intro TEXT DEFAULT NULL,
        outro_cta TEXT DEFAULT NULL,
        lock_intro_sentences INTEGER DEFAULT 0,
        task_type TEXT DEFAULT 'story',
        pipeline_step TEXT DEFAULT 'new',
        pipeline_data TEXT DEFAULT '{}',
        target_length INTEGER DEFAULT 1500,
        target_scenes INTEGER DEFAULT NULL,
        script_format TEXT DEFAULT 'narration',
        podcast_image_mode TEXT DEFAULT 'multi',
        podcast_speakers TEXT DEFAULT NULL,
        podcast_speaker_a TEXT DEFAULT NULL,
        podcast_speaker_b TEXT DEFAULT NULL,
        video_intro INTEGER DEFAULT 0,
        video_intro_duration INTEGER DEFAULT 0,
        cover_image_mode TEXT DEFAULT 'off',
        cover_template_id TEXT DEFAULT 'cinematic-poster',
        html_video_foreground INTEGER DEFAULT NULL
      );
      CREATE TABLE IF NOT EXISTS book_selection (
        theme TEXT NOT NULL,
        book_id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(theme, book_id)
      );
      CREATE TABLE IF NOT EXISTS task_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        step INTEGER,
        agent TEXT,
        tool TEXT,
        detail TEXT,
        data_json TEXT,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id, seq);
      CREATE TABLE IF NOT EXISTS viral_analyses (
        id TEXT PRIMARY KEY,
        archived_at TEXT,
        managed_storage_key TEXT,
        url TEXT NOT NULL,
        platform TEXT NOT NULL,
        title TEXT DEFAULT '',
        status TEXT NOT NULL,
        current_stage TEXT NOT NULL,
        progress REAL DEFAULT 0,
        settings_json TEXT NOT NULL,
        result_path TEXT DEFAULT '',
        video_path TEXT DEFAULT '',
        error_message TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        last_heartbeat_at TEXT
      );
      CREATE TABLE IF NOT EXISTS viral_analysis_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id TEXT NOT NULL,
        type TEXT NOT NULL,
        stage TEXT NOT NULL,
        detail TEXT NOT NULL,
        data_json TEXT,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_viral_analysis_events_analysis_id ON viral_analysis_events(analysis_id, seq);
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT DEFAULT '',
        content TEXT NOT NULL,
        is_builtin INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL,
        data_json TEXT DEFAULT '{}',
        summary_json TEXT DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS user_prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        base_track TEXT DEFAULT '',
        base_template_id TEXT,
        step1_rewrite_system_prompt TEXT DEFAULT '',
        step1_metadata_system_prompt TEXT DEFAULT '',
        step3_system_prompt TEXT DEFAULT '',
        style_id TEXT DEFAULT '',
        image_seed_pools_json TEXT DEFAULT '',
        origin TEXT DEFAULT 'system',
        created_at INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0,
        last_used_at INTEGER DEFAULT 0,
        used_count INTEGER DEFAULT 0,
        source_market_id TEXT,
        source_author TEXT,
        source_version TEXT,
        is_shared INTEGER DEFAULT 0,
        shared_at INTEGER,
        share_visibility TEXT DEFAULT 'private',
        market_title TEXT DEFAULT '',
        market_summary TEXT DEFAULT '',
        market_cover_url TEXT DEFAULT '',
        market_tags_json TEXT DEFAULT '[]',
        market_price_credits INTEGER DEFAULT 0,
        download_count INTEGER DEFAULT 0,
        use_count_total INTEGER DEFAULT 0,
        rating_avg REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        content_hash TEXT DEFAULT '',
        needs_character_card INTEGER DEFAULT 1,
        step3_skeleton_modules_json TEXT DEFAULT '[]',
        reference_kind TEXT DEFAULT 'none'
      );
      CREATE TABLE IF NOT EXISTS draft_templates (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        is_builtin INTEGER DEFAULT 0,
        name TEXT DEFAULT '',
        canvas_width INTEGER DEFAULT 1080,
        canvas_height INTEGER DEFAULT 1920,
        canvas_ratio TEXT DEFAULT '9:16',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS custom_cover_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        directions TEXT DEFAULT '',
        composition_rule TEXT DEFAULT '',
        title_layout TEXT DEFAULT '',
        subtitle_layout TEXT DEFAULT '',
        plain_hint TEXT DEFAULT '',
        created_at TEXT DEFAULT '',
        updated_at TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS image_lab_records (
        id TEXT PRIMARY KEY,
        archived_at TEXT,
        managed_storage_key TEXT,
        prompt TEXT NOT NULL,
        ratio TEXT NOT NULL,
        style TEXT NOT NULL,
        provider TEXT NOT NULL,
        image_path TEXT DEFAULT '',
        status TEXT NOT NULL,
        error_msg TEXT DEFAULT '',
        resolution TEXT DEFAULT '2K',
        smart_mode TEXT DEFAULT 'text-to-image',
        reference_image_paths_json TEXT DEFAULT '[]',
        reference_image_path TEXT DEFAULT '',
        upstream_task_id TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS playground_jobs (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        style_id TEXT DEFAULT '',
        style_name TEXT DEFAULT '',
        provider TEXT DEFAULT '',
        ratio TEXT DEFAULT '9:16',
        image_path TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        error_msg TEXT DEFAULT '',
        created_at INTEGER DEFAULT 0,
        finished_at INTEGER,
        reference_image_path TEXT DEFAULT '',
        upstream_task_id TEXT,
        model TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS voice_lab_records (
        id TEXT PRIMARY KEY,
        archived_at TEXT,
        managed_storage_key TEXT,
        text TEXT NOT NULL,
        provider TEXT NOT NULL,
        voice_id TEXT NOT NULL,
        voice_label TEXT DEFAULT '',
        speed REAL NOT NULL,
        audio_path TEXT DEFAULT '',
        status TEXT NOT NULL,
        error_msg TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS history_tombstones (
        family TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        managed_storage_key TEXT,
        cleanup_state TEXT NOT NULL DEFAULT 'pending',
        quarantine_name TEXT,
        quarantine_identity_json TEXT NOT NULL DEFAULT '{}',
        diagnostic TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL,
        PRIMARY KEY (family, entity_id)
      );
      CREATE TABLE IF NOT EXISTS account_profile (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activation_state (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ui_preferences (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS custom_styles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tag TEXT NOT NULL,
        short_name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        suffix TEXT NOT NULL,
        negative_prompt TEXT NOT NULL,
        allow_color INTEGER NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        balance REAL NOT NULL,
        task_id TEXT,
        description TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credits_transactions (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        balance REAL NOT NULL,
        task_id TEXT,
        description TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS minimax_clone_voices (
        voice_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        source_audio_path TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );
    `);

    for (const [column, definition] of [
      ['speaker', "TEXT DEFAULT '灿博小叔'"],
      ['task_kind', "TEXT DEFAULT 'story'"],
      ['processing_mode', "TEXT DEFAULT 'full-auto'"],
      ['publish_mode', "TEXT DEFAULT 'review-rewrite'"],
      ['ai_keyword', "TEXT DEFAULT ''"],
      ['ai_sources', "TEXT DEFAULT '[]'"],
      ['selected_sources', "TEXT DEFAULT '[]'"],
      ['extra_requirements', "TEXT DEFAULT ''"],
      ['image_prompt_reference', "TEXT DEFAULT ''"],
      ['reference_image_path', "TEXT DEFAULT ''"],
      ['rewrite_intensity', "TEXT DEFAULT 'standard'"],
      ['narrative_pov', "TEXT DEFAULT 'keep-original'"],
      ['keep_promotion', 'INTEGER DEFAULT 0'],
      ['tts_provider', "TEXT DEFAULT 'volcengine'"],
      ['tts_speed', 'REAL DEFAULT 1'],
      ['storyboard_scene_count', 'INTEGER DEFAULT NULL'],
      ['step3_prompt_snapshot', "TEXT DEFAULT ''"],
      ['music_mv_json', "TEXT DEFAULT '{}'"],
      ['failed_step', 'INTEGER'],
      ['retry_from_step', 'INTEGER'],
      ['artifact_state_path', "TEXT DEFAULT ''"],
      ['video_form', "TEXT DEFAULT 'narration'"],
      ['llm_profile_id', 'TEXT'],
      ['started_at', 'TEXT'],
      ['last_heartbeat_at', 'TEXT'],
      ['material_source', "TEXT DEFAULT 'ai'"],
      ['product_info', 'TEXT DEFAULT NULL'],
      ['material_person', 'TEXT DEFAULT NULL'],
      ['draft_dir', 'TEXT DEFAULT NULL'],
      ['fixed_intro', 'TEXT DEFAULT NULL'],
      ['outro_cta', 'TEXT DEFAULT NULL'],
      ['lock_intro_sentences', 'INTEGER DEFAULT 0'],
      ['task_type', "TEXT DEFAULT 'story'"],
      ['pipeline_step', "TEXT DEFAULT 'new'"],
      ['pipeline_data', "TEXT DEFAULT '{}'"],
      ['target_length', 'INTEGER DEFAULT 1500'],
      ['target_scenes', 'INTEGER DEFAULT NULL'],
      ['script_format', "TEXT DEFAULT 'narration'"],
      ['podcast_image_mode', "TEXT DEFAULT 'multi'"],
      ['podcast_speakers', 'TEXT DEFAULT NULL'],
      ['podcast_speaker_a', 'TEXT DEFAULT NULL'],
      ['podcast_speaker_b', 'TEXT DEFAULT NULL'],
      ['video_intro', 'INTEGER DEFAULT 0'],
      ['video_intro_duration', 'INTEGER DEFAULT 0'],
      ['cover_image_mode', "TEXT DEFAULT 'off'"],
      ['cover_template_id', "TEXT DEFAULT 'cinematic-poster'"],
      ['html_video_foreground', 'INTEGER DEFAULT NULL'],
      ['archived_at', 'TEXT DEFAULT NULL'],
      ['managed_storage_key', 'TEXT DEFAULT NULL'],
    ] as const) {
      addColumnIfMissing(this.db, 'tasks', column, definition);
    }
    addColumnIfMissing(this.db, 'prompt_templates', 'data_json', "TEXT DEFAULT '{}'");
    addColumnIfMissing(this.db, 'prompt_templates', 'summary_json', "TEXT DEFAULT '{}'");
    this.backfillPromptTemplateSummaries();
    for (const [column, definition] of [
      ['name', "TEXT DEFAULT ''"],
      ['canvas_width', 'INTEGER DEFAULT 1080'],
      ['canvas_height', 'INTEGER DEFAULT 1920'],
      ['canvas_ratio', "TEXT DEFAULT '9:16'"],
    ] as const) {
      addColumnIfMissing(this.db, 'draft_templates', column, definition);
    }
    this.backfillDraftTemplateSummaries();
    for (const [column, definition] of [
      ['error_msg', "TEXT DEFAULT ''"],
      ['resolution', "TEXT DEFAULT '2K'"],
      ['smart_mode', "TEXT DEFAULT 'text-to-image'"],
      ['reference_image_paths_json', "TEXT DEFAULT '[]'"],
      ['reference_image_path', "TEXT DEFAULT ''"],
      ['upstream_task_id', 'TEXT'],
      ['finished_at', 'TEXT'],
      ['archived_at', 'TEXT DEFAULT NULL'],
      ['managed_storage_key', 'TEXT DEFAULT NULL'],
    ] as const) {
      addColumnIfMissing(this.db, 'image_lab_records', column, definition);
    }
    for (const table of ['viral_analyses', 'voice_lab_records'] as const) {
      addColumnIfMissing(this.db, table, 'archived_at', 'TEXT DEFAULT NULL');
      addColumnIfMissing(this.db, table, 'managed_storage_key', 'TEXT DEFAULT NULL');
    }
    for (const [column, definition] of [
      ['cleanup_state', "TEXT NOT NULL DEFAULT 'pending'"],
      ['quarantine_name', 'TEXT DEFAULT NULL'],
      ['quarantine_identity_json', "TEXT NOT NULL DEFAULT '{}'"],
      ['diagnostic', "TEXT NOT NULL DEFAULT ''"],
    ] as const) {
      addColumnIfMissing(this.db, 'history_tombstones', column, definition);
    }
    this.db.run(
      `UPDATE history_tombstones
       SET cleanup_state = 'unmanaged-legacy',
           diagnostic = CASE
             WHEN trim(coalesce(diagnostic, '')) = ''
               THEN 'Legacy record has no managed storage key; filesystem cleanup was not attempted.'
             ELSE diagnostic
           END
       WHERE managed_storage_key IS NULL
         AND (cleanup_state IS NULL OR trim(cleanup_state) IN ('', 'pending'))`,
    );
    for (const table of Object.values(historyTableByFamily)) {
      this.db.run(
        `UPDATE ${table}
         SET managed_storage_key = NULL
         WHERE managed_storage_key IS NOT NULL
           AND managed_storage_key COLLATE NOCASE IN (
             SELECT managed_storage_key
             FROM ${table}
             WHERE managed_storage_key IS NOT NULL
             GROUP BY managed_storage_key COLLATE NOCASE
             HAVING COUNT(*) > 1
           )`,
      );
    }
    this.db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_managed_storage_key
        ON tasks(managed_storage_key COLLATE NOCASE) WHERE managed_storage_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_viral_analyses_managed_storage_key
        ON viral_analyses(managed_storage_key COLLATE NOCASE) WHERE managed_storage_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_image_lab_records_managed_storage_key
        ON image_lab_records(managed_storage_key COLLATE NOCASE) WHERE managed_storage_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_lab_records_managed_storage_key
        ON voice_lab_records(managed_storage_key COLLATE NOCASE) WHERE managed_storage_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_tasks_active_history
        ON tasks(created_at DESC, id DESC) WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_tasks_archived_history
        ON tasks(archived_at DESC, id DESC) WHERE archived_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_viral_analyses_active_history
        ON viral_analyses(created_at DESC, id DESC) WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_viral_analyses_archived_history
        ON viral_analyses(archived_at DESC, id DESC) WHERE archived_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_image_lab_records_active_history
        ON image_lab_records(created_at DESC, id DESC) WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_image_lab_records_archived_history
        ON image_lab_records(archived_at DESC, id DESC) WHERE archived_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_voice_lab_records_active_history
        ON voice_lab_records(created_at DESC, id DESC) WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_voice_lab_records_archived_history
        ON voice_lab_records(archived_at DESC, id DESC) WHERE archived_at IS NOT NULL;
    `);

    const config = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM config WHERE id = 1');
    const rawConfig = config ? parseJson<unknown>(config.data, {}) : defaultConfig;
    const ui = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM ui_preferences WHERE id = 1');
    const rawUi = ui ? parseJson<unknown>(ui.data, {}) : {};
    this.themePreferenceUnversionedAtOpen = !rawUi
      || typeof rawUi !== 'object'
      || Array.isArray(rawUi)
      || (rawUi as Record<string, unknown>).themePreferenceVersion !== 1;
    const canonicalUi = migrateThemePreference(rawUi, rawConfig);
    const normalizedConfig = mergeConfig(rawConfig);
    const pair = canonicalThemePreferencePair(normalizedConfig, canonicalUi);
    this.db.run('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)', [json(pair.config)]);
    this.db.run('INSERT OR REPLACE INTO ui_preferences (id, data) VALUES (1, ?)', [json(pair.ui)]);
    this.recoverInterruptedTasks();
    this.seedShellDefaults();
  }

  private recoverInterruptedTasks(): void {
    this.db.run(`
      UPDATE tasks
      SET
        status = 'paused',
        failed_step = COALESCE(failed_step, current_step),
        retry_from_step = COALESCE(retry_from_step, current_step),
        error_message = CASE
          WHEN error_message IS NULL OR error_message = '' THEN '任务在上次运行时中断，请重试。'
          ELSE error_message
        END
      WHERE status = 'running' AND archived_at IS NULL
    `);
  }

  private seedShellDefaults(): void {
    this.syncBuiltinPromptTemplates();

    const draftCount = getFirstRow<{ count: number }>(this.db, 'SELECT COUNT(*) AS count FROM draft_templates')?.count ?? 0;
    if (draftCount === 0) {
      for (const template of draftTemplates) {
        this.db.run('INSERT INTO draft_templates (id, data, is_builtin, name, canvas_width, canvas_height, canvas_ratio, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          template.id,
          json(template),
          template.isDefault ? 1 : 0,
          template.name,
          template.canvas.width,
          template.canvas.height,
          template.canvas.ratio,
          '2026-05-26T00:00:00.000Z',
        ]);
      }
    }
    this.removeLegacyBundledCozeDraftTemplates();

    this.syncDefaultCustomStyles();
    this.syncDefaultCustomCoverTemplates();

    const creditCount = getFirstRow<{ count: number }>(this.db, 'SELECT COUNT(*) AS count FROM credit_transactions')?.count ?? 0;
    if (creditCount === 0) {
      for (const item of defaultCreditTransactions) {
        this.db.run(
          `INSERT INTO credit_transactions (id, type, amount, balance, task_id, description, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [item.id, item.type, item.amount, item.balance, item.taskId, item.description, item.createdAt],
        );
      }
    }

    for (const [table, value] of [
      ['account_profile', defaultAccount],
      ['activation_state', defaultActivation],
      ['ui_preferences', defaultUiPreferences],
    ] as const) {
      const row = getFirstRow<{ data: string }>(this.db, `SELECT data FROM ${table} WHERE id = 1`);
      if (!row) this.db.run(`INSERT INTO ${table} (id, data) VALUES (1, ?)`, [json(value)]);
    }

    const voiceCount = getFirstRow<{ count: number }>(this.db, 'SELECT COUNT(*) AS count FROM minimax_clone_voices')?.count ?? 0;
    if (voiceCount === 0) {
      for (const voice of defaultMinimaxCloneVoices) {
        this.db.run(
          `INSERT INTO minimax_clone_voices (voice_id, display_name, source_audio_path, created_at, last_used_at)
           VALUES (?, ?, ?, ?, ?)`,
          [voice.voiceId, voice.displayName, voice.sourceAudioPath, voice.createdAt, voice.lastUsedAt],
        );
      }
    }
  }

  private backfillDraftTemplateSummaries(): void {
    const rows = getRows<{ id: string; data: string; name: string }>(
      this.db,
      "SELECT id, data, name FROM draft_templates WHERE name IS NULL OR name = ''",
    );
    for (const row of rows) {
      const template = normalizeDraftTemplate(parseJson(row.data, draftTemplates[0]));
      this.db.run(
        'UPDATE draft_templates SET name = ?, is_builtin = ?, canvas_width = ?, canvas_height = ?, canvas_ratio = ? WHERE id = ?',
        [template.name, template.isDefault ? 1 : 0, template.canvas.width, template.canvas.height, template.canvas.ratio, row.id],
      );
    }
  }

  private backfillPromptTemplateSummaries(): void {
    const rows = getRows<Record<string, unknown>>(
      this.db,
      "SELECT id, name, type, description, is_builtin, updated_at, data_json FROM prompt_templates WHERE summary_json IS NULL OR summary_json = '{}'",
    );
    for (const row of rows) {
      const stored = parseJson<Partial<PromptTemplate>>(row.data_json, {});
      const template = {
        ...stored,
        id: String(row.id),
        name: String(row.name ?? ''),
        type: String(row.type ?? 'task') as PromptTemplate['type'],
        description: String(row.description ?? ''),
        content: String(stored.content ?? ''),
        isBuiltin: Number(row.is_builtin ?? 0) === 1,
        updatedAt: String(row.updated_at ?? ''),
      } as PromptTemplate;
      this.db.run('UPDATE prompt_templates SET summary_json = ? WHERE id = ?', [json(promptTemplateSummary(template)), template.id]);
    }
  }

  private syncBuiltinPromptTemplates(): void {
    const defaultIds = new Set(this.defaultPromptTemplates.map((template) => template.id));
    const existingIds = new Set(getRows<{ id: string }>(this.db, 'SELECT id FROM prompt_templates').map((row) => row.id));
    for (const existingId of existingIds) {
      if (!defaultIds.has(existingId)) {
        this.db.run('DELETE FROM prompt_templates WHERE id = ? AND is_builtin = 1', [existingId]);
      }
    }
    for (const template of this.defaultPromptTemplates) {
      this.insertPromptTemplate(template);
    }
  }

  private removeLegacyBundledCozeDraftTemplates(): void {
    for (const [id, legacyName] of legacyBundledCozeDraftTemplates) {
      const row = getFirstRow<{ data: string; is_builtin: number }>(this.db, 'SELECT data, is_builtin FROM draft_templates WHERE id = ?', [id]);
      if (!row) continue;
      const stored = parseJson<Partial<DraftTemplate>>(row.data, {});
      const isLegacyBundledTemplate =
        Number(row.is_builtin ?? 0) === 1 ||
        stored.name === legacyName ||
        stored.name === 'Bundled Coze preset';
      if (isLegacyBundledTemplate) {
        this.db.run('DELETE FROM draft_templates WHERE id = ?', [id]);
      }
    }
  }

  private insertPromptTemplate(template: PromptTemplate): void {
    this.db.run(
      `INSERT OR REPLACE INTO prompt_templates (id, name, type, description, content, is_builtin, updated_at, data_json, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [template.id, template.name, template.type, template.description, template.content, template.isBuiltin ? 1 : 0, template.updatedAt, json(template), json(promptTemplateSummary(template))],
    );
  }

  private insertCustomStyle(style: CustomStyle): void {
    this.db.run(
      `INSERT OR REPLACE INTO custom_styles
       (id, name, tag, short_name, prefix, suffix, negative_prompt, allow_color, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        style.id,
        style.name,
        style.tag,
        style.shortName,
        style.prefix,
        style.suffix,
        style.negativePrompt,
        style.allowColor ? 1 : 0,
        style.description,
        style.createdAt,
        style.updatedAt,
      ],
    );
  }

  async persist(): Promise<void> {
    await this.enqueueCommit(() => undefined);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const acceptedWrites = this.writeTail;
    this.closePromise = (async () => {
      await acceptedWrites;
      await atomicWriteDatabase(this.file, this.db.export(), this.dependencies);
      this.db.close();
      this.closed = true;
    })();
    return this.closePromise;
  }

  async upsertConfig(
    config: AppConfig,
    options: { legacyThemeCandidate?: boolean } = {},
  ): Promise<ThemePreferencePair> {
    const persisted = await this.enqueueCommit(() => {
      const current = this.readThemePreferencePair();
      const requested = stripConfigSecrets(mergeConfig(config));
      const { themePreferenceVersion: _version, ...unversionedUi } = current.ui;
      const ui = options.legacyThemeCandidate && this.themePreferenceUnversionedAtOpen
        ? migrateThemePreference(unversionedUi, requested)
        : current.ui;
      const pair = canonicalThemePreferencePair(requested, ui);
      this.writeThemePreferencePair(pair);
      return pair;
    });
    if (options.legacyThemeCandidate) this.themePreferenceUnversionedAtOpen = false;
    return persisted;
  }

  async upsertPromptTemplate(input: PromptTemplateInput): Promise<PromptTemplate> {
    return this.enqueueCommit(() => {
      const template: PromptTemplate = {
        ...input,
        description: input.description ?? '',
        isBuiltin: input.isBuiltin ?? false,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };
      this.insertPromptTemplate(template);
      return template;
    });
  }

  private syncDefaultCustomStyles(): void {
    for (const style of defaultCustomStyles) {
      const existing = getFirstRow<{ id: string }>(this.db, 'SELECT id FROM custom_styles WHERE id = ?', [style.id]);
      if (!existing) this.insertCustomStyle(style);
    }
  }

  private syncDefaultCustomCoverTemplates(): void {
    for (const template of defaultCustomCoverTemplates) {
      const existing = getFirstRow<{ id: string }>(this.db, 'SELECT id FROM custom_cover_templates WHERE id = ?', [template.id]);
      if (existing) continue;
      this.db.run(
        `INSERT INTO custom_cover_templates
         (id, name, description, directions, composition_rule, title_layout, subtitle_layout, plain_hint, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          template.id,
          template.name,
          template.description,
          template.directions,
          template.compositionRule,
          template.titleLayout,
          template.subtitleLayout,
          template.plainHint,
          template.createdAt,
          template.updatedAt,
        ],
      );
    }
  }

  async upsertCustomStyle(input: CustomStyle): Promise<CustomStyle> {
    return this.enqueueCommit(() => {
      const now = new Date().toISOString();
      const style: CustomStyle = {
        ...input,
        createdAt: input.createdAt || now,
        updatedAt: input.updatedAt || now,
      };
      this.insertCustomStyle(style);
      return style;
    });
  }

  async upsertCustomCoverTemplate(template: CustomCoverTemplate): Promise<CustomCoverTemplate> {
    return this.enqueueCommit(() => {
      this.db.run(
        `INSERT OR REPLACE INTO custom_cover_templates
         (id, name, description, directions, composition_rule, title_layout, subtitle_layout, plain_hint, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          template.id,
          template.name,
          template.description,
          template.directions,
          template.compositionRule,
          template.titleLayout,
          template.subtitleLayout,
          template.plainHint,
          template.createdAt,
          template.updatedAt,
        ],
      );
      return template;
    });
  }

  async upsertMinimaxCloneVoice(voice: MinimaxCloneVoice): Promise<MinimaxCloneVoice> {
    return this.enqueueCommit(() => {
      this.db.run(
        `INSERT OR REPLACE INTO minimax_clone_voices
         (voice_id, display_name, source_audio_path, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?)`,
        [voice.voiceId, voice.displayName, voice.sourceAudioPath, voice.createdAt, voice.lastUsedAt],
      );
      return voice;
    });
  }

  async resetPromptTemplates(): Promise<void> {
    const defaultPromptTemplates = await loadDefaultPromptTemplates();
    await this.enqueueCommit(() => {
      this.db.run('DELETE FROM prompt_templates WHERE is_builtin = 1');
      for (const template of defaultPromptTemplates) this.insertPromptTemplate({ ...template, updatedAt: new Date().toISOString() });
    });
  }

  async upsertDraftTemplate(template: DraftTemplate): Promise<DraftTemplate> {
    const canonicalTemplate = parseDraftTemplate(template);
    return this.enqueueCommit(() => {
      const updatedAt = new Date().toISOString();
      const storedTemplate = { ...canonicalTemplate, updatedAt };
      this.db.run('INSERT OR REPLACE INTO draft_templates (id, data, is_builtin, name, canvas_width, canvas_height, canvas_ratio, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        canonicalTemplate.id,
        json(storedTemplate),
        canonicalTemplate.isDefault ? 1 : 0,
        canonicalTemplate.name,
        canonicalTemplate.canvas.width,
        canonicalTemplate.canvas.height,
        canonicalTemplate.canvas.ratio,
        updatedAt,
      ]);
      return storedTemplate;
    });
  }

  async addImageLabRecord(input: ImageLabRecordInput): Promise<ImageLabRecord> {
    return this.enqueueCommit(() => {
      const now = input.createdAt ?? new Date().toISOString();
      const record: ImageLabRecord = {
        id: input.id ?? randomUUID(),
        archivedAt: null,
        managedStorageKey: createManagedStorageKey(),
        prompt: input.prompt,
        ratio: input.ratio,
        style: input.style,
        provider: input.provider,
        imagePath: input.imagePath ?? '',
        status: input.status ?? 'mock',
        errorMessage: input.errorMessage ?? '',
        resolution: input.resolution ?? '2K',
        smartMode: input.smartMode ?? 'text-to-image',
        referenceImagePaths: input.referenceImagePaths ?? (input.referenceImagePath ? [input.referenceImagePath] : []),
        referenceImagePath: input.referenceImagePath ?? '',
        upstreamTaskId: input.upstreamTaskId ?? null,
        createdAt: now,
        finishedAt: input.finishedAt ?? (input.status === 'generated' ? now : null),
      };
      this.assertHistoryWritable('image-lab', record.id);
      this.db.run(
        `INSERT INTO image_lab_records
         (id, archived_at, managed_storage_key, prompt, ratio, style, provider, image_path, status, error_msg, resolution, smart_mode, reference_image_paths_json, reference_image_path, upstream_task_id, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
         [
           record.id,
           record.archivedAt ?? null,
           record.managedStorageKey ?? null,
           record.prompt,
          record.ratio,
          record.style,
          record.provider,
          record.imagePath,
          record.status,
          record.errorMessage,
          record.resolution,
          record.smartMode,
          json(record.referenceImagePaths),
          record.referenceImagePath,
          record.upstreamTaskId,
          record.createdAt,
          record.finishedAt,
        ],
      );
      this.db.run(
        `INSERT OR REPLACE INTO playground_jobs
         (id, prompt, style_id, provider, ratio, image_path, status, error_msg, created_at, finished_at, reference_image_path, upstream_task_id, model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.prompt,
          record.style,
          record.provider,
          record.ratio,
          record.imagePath,
          record.status,
          record.errorMessage,
          Date.parse(record.createdAt) || Date.now(),
          record.finishedAt ? Date.parse(record.finishedAt) || Date.now() : null,
          record.referenceImagePaths[0] ?? record.referenceImagePath,
          record.upstreamTaskId,
          record.smartMode,
        ],
      );
      return record;
    });
  }

  async updateImageLabRecord(
    id: string,
    patch: Partial<
      Pick<
        ImageLabRecord,
        | 'provider'
        | 'imagePath'
        | 'status'
        | 'errorMessage'
        | 'resolution'
        | 'smartMode'
        | 'referenceImagePaths'
        | 'referenceImagePath'
        | 'upstreamTaskId'
        | 'finishedAt'
      >
    >,
  ): Promise<ImageLabRecord> {
    return this.enqueueCommit(() => {
      this.assertHistoryWritable('image-lab', id);
      const mapping: Array<[keyof typeof patch, string, (value: unknown) => SqlValue]> = [
        ['provider', 'provider', toNullableSqlValue],
        ['imagePath', 'image_path', toNullableSqlValue],
        ['status', 'status', toNullableSqlValue],
        ['errorMessage', 'error_msg', toNullableSqlValue],
        ['resolution', 'resolution', toNullableSqlValue],
        ['smartMode', 'smart_mode', toNullableSqlValue],
        ['referenceImagePaths', 'reference_image_paths_json', (value) => json(value ?? [])],
        ['referenceImagePath', 'reference_image_path', toNullableSqlValue],
        ['upstreamTaskId', 'upstream_task_id', toNullableSqlValue],
        ['finishedAt', 'finished_at', toNullableSqlValue],
      ];
      const entries = mapping.filter(([key]) => key in patch);
      if (entries.length > 0) {
        const values = entries.map(([key, , serialize]) => serialize(patch[key]));
        values.push(id);
        this.db.run(`UPDATE image_lab_records SET ${entries.map(([, column]) => `${column} = ?`).join(', ')} WHERE id = ?`, values);
        this.db.run(
          `UPDATE playground_jobs SET
           style_id = (SELECT style FROM image_lab_records WHERE id = ?),
           provider = (SELECT provider FROM image_lab_records WHERE id = ?),
           ratio = (SELECT ratio FROM image_lab_records WHERE id = ?),
           image_path = (SELECT image_path FROM image_lab_records WHERE id = ?),
           status = (SELECT status FROM image_lab_records WHERE id = ?),
           error_msg = (SELECT error_msg FROM image_lab_records WHERE id = ?),
           reference_image_path = (SELECT reference_image_path FROM image_lab_records WHERE id = ?),
           upstream_task_id = (SELECT upstream_task_id FROM image_lab_records WHERE id = ?),
           model = (SELECT smart_mode FROM image_lab_records WHERE id = ?),
           finished_at = (SELECT CASE WHEN finished_at IS NULL THEN NULL ELSE CAST(strftime('%s', finished_at) AS INTEGER) * 1000 END FROM image_lab_records WHERE id = ?)
           WHERE id = ?`,
          [id, id, id, id, id, id, id, id, id, id, id],
        );
      }
      const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT * FROM image_lab_records WHERE id = ?', [id]);
      if (!row) throw new Error(`IMAGE_LAB_RECORD_NOT_FOUND: ${id}`);
      return rowToImageLabRecord(row);
    });
  }

  async upsertAccount(account: AccountProfile): Promise<void> {
    await this.enqueueCommit(() => {
      this.db.run('INSERT OR REPLACE INTO account_profile (id, data) VALUES (1, ?)', [json({ ...defaultAccount, ...account })]);
    });
  }

  async upsertActivation(activation: ActivationState): Promise<void> {
    await this.enqueueCommit(() => {
      this.db.run('INSERT OR REPLACE INTO activation_state (id, data) VALUES (1, ?)', [json({ ...defaultActivation, ...activation })]);
    });
  }

  async upsertUiPreferences(update: UiPreferencesUpdate): Promise<ThemePreferencePair> {
    const persisted = await this.enqueueCommit(() => {
      const current = this.readThemePreferencePair();
      const nextUi: UiPreferences = {
        activeView: update.activeView ?? current.ui.activeView,
        theme: validTheme(update.theme) ?? current.ui.theme,
        themePreferenceVersion: 1,
      };
      const pair = canonicalThemePreferencePair(current.config, nextUi);
      this.writeThemePreferencePair(pair);
      return pair;
    });
    this.themePreferenceUnversionedAtOpen = false;
    return persisted;
  }

  private readThemePreferencePair(): ThemePreferencePair {
    const configRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM config WHERE id = 1');
    const uiRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM ui_preferences WHERE id = 1');
    const config = configRow ? mergeConfig(parseJson(configRow.data, defaultConfig)) : defaultConfig;
    const ui = migrateThemePreference(uiRow ? parseJson(uiRow.data, {}) : {}, config);
    return canonicalThemePreferencePair(config, ui);
  }

  private writeThemePreferencePair(pair: ThemePreferencePair): void {
    this.db.run('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)', [json(stripConfigSecrets(pair.config))]);
    this.db.run('INSERT OR REPLACE INTO ui_preferences (id, data) VALUES (1, ?)', [json(pair.ui)]);
  }

  async listBookSelections(theme?: string): Promise<BookSelectionRecord[]> {
    await this.waitForWrites();
    const rows =
      theme === undefined
        ? getRows<Record<string, unknown>>(this.db, 'SELECT theme, book_id, data, updated_at FROM book_selection ORDER BY updated_at DESC, theme ASC, book_id ASC')
        : getRows<Record<string, unknown>>(this.db, 'SELECT theme, book_id, data, updated_at FROM book_selection WHERE theme = ? ORDER BY updated_at DESC, book_id ASC', [theme]);
    return rows.map(rowToBookSelectionRecord);
  }

  async upsertBookSelection(input: BookSelectionInput): Promise<BookSelectionRecord> {
    return this.enqueueCommit(() => {
      const theme = input.theme.trim();
      const bookId = input.bookId?.trim() || randomUUID();
      const previousIdentity = input.previousIdentity
        ? { theme: input.previousIdentity.theme.trim(), bookId: input.previousIdentity.bookId.trim() }
        : null;
      const record: BookSelectionRecord = {
        theme,
        bookId,
        data: input.data,
        updatedAt: Date.now(),
      };
      const destination = getFirstRow<Record<string, unknown>>(this.db, 'SELECT theme, book_id FROM book_selection WHERE theme = ? AND book_id = ?', [theme, bookId]);
      if (previousIdentity) {
        const previous = getFirstRow<Record<string, unknown>>(this.db, 'SELECT theme, book_id FROM book_selection WHERE theme = ? AND book_id = ?', [previousIdentity.theme, previousIdentity.bookId]);
        if (!previous) throw new Error('BOOK_SELECTION_STALE_IDENTITY: The selected book record no longer exists.');
        const sameIdentity = previousIdentity.theme === theme && previousIdentity.bookId === bookId;
        if (!sameIdentity && destination) throw new Error('BOOK_SELECTION_DESTINATION_CONFLICT: Another book selection already uses this theme and ID.');
        if (sameIdentity) {
          this.db.run('UPDATE book_selection SET data = ?, updated_at = ? WHERE theme = ? AND book_id = ?', [json(record.data), record.updatedAt, theme, bookId]);
        } else {
          this.db.run('DELETE FROM book_selection WHERE theme = ? AND book_id = ?', [previousIdentity.theme, previousIdentity.bookId]);
          this.db.run('INSERT INTO book_selection (theme, book_id, data, updated_at) VALUES (?, ?, ?, ?)', [theme, bookId, json(record.data), record.updatedAt]);
        }
      } else {
        if (destination) throw new Error('BOOK_SELECTION_DESTINATION_CONFLICT: Another book selection already uses this theme and ID.');
        this.db.run('INSERT INTO book_selection (theme, book_id, data, updated_at) VALUES (?, ?, ?, ?)', [theme, bookId, json(record.data), record.updatedAt]);
      }
      return record;
    });
  }

  async deleteBookSelection(theme: string, bookId: string): Promise<void> {
    await this.enqueueCommit(() => {
      this.db.run('DELETE FROM book_selection WHERE theme = ? AND book_id = ?', [theme, bookId]);
    });
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.enqueueCommit(() => this.insertTask(input));
  }

  private insertTask(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const configRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM config WHERE id = 1');
    const config = configRow ? mergeConfig(parseJson(configRow.data, defaultConfig)) : defaultConfig;
    const explicitStoryboardSceneCount = normalizeStoryboardSceneCount(input.targetScenes ?? input.storyboardSceneCount) ?? undefined;
    const taskIdentity = {
      taskKind: input.taskKind ?? 'story',
      taskType: normalizeLegacyTaskType(input.taskType, input.taskKind),
    };
    const coverImageMode = parseOrdinaryCoverMode(input.coverImageMode ?? 'off');
    if (isOrdinaryTask(taskIdentity)) {
      const templates = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM custom_cover_templates ORDER BY created_at ASC')
        .map(rowToCustomCoverTemplate);
      resolveOrdinaryCoverTemplate(coverImageMode, input.coverTemplateId ?? 'cinematic-poster', templates);
    }
      const task: Task = {
        id: randomUUID(),
        archivedAt: null,
        managedStorageKey: createManagedStorageKey(),
        title: input.title ?? '',
      inputText: input.inputText,
      taskKind: taskIdentity.taskKind,
      processingMode: input.processingMode ?? 'full-auto',
      status: 'pending',
      currentStep: 0,
      track: input.track ?? 'character-story',
      style: input.style ?? 'photo-real',
      speaker: input.speaker ?? defaultConfig.tts.speaker,
      ratio: input.ratio ?? '9:16',
      templateId: input.templateId ?? 'default-portrait-9-16',
      bgmId: input.bgmId ?? config.jianying.defaultBgmId ?? '',
      pausePoints: input.pausePoints ?? [],
      outputDir: '',
      errorMessage: '',
      createdAt: now,
      completedAt: null,
      startedAt: null,
      lastHeartbeatAt: null,
      mode: input.mode ?? 'paste',
      publishMode: input.publishMode ?? 'review-rewrite',
      aiKeyword: input.aiKeyword ?? '',
      aiSources: input.aiSources ?? ['web'],
      selectedSources: input.selectedSources ?? [],
      extraRequirements: input.extraRequirements ?? '',
      imagePromptReference: input.imagePromptReference ?? '',
      promptTemplateId: input.promptTemplateId ?? null,
      promptTemplateType: input.promptTemplateType ?? null,
      referenceImagePath: input.referenceImagePath ?? '',
      rewriteIntensity: input.rewriteIntensity ?? 'standard',
      narrativePov: input.narrativePov ?? 'keep-original',
      keepPromotion: input.keepPromotion ?? false,
      ttsProvider: input.ttsProvider ?? defaultConfig.tts.provider,
      ttsSpeed: input.ttsSpeed ?? 1,
      storyboardSceneCount: explicitStoryboardSceneCount,
      step3PromptSnapshot: input.step3PromptSnapshot ?? '',
      musicMv: normalizeMusicMvSettings(input.musicMv),
      failedStep: null,
      retryFromStep: null,
      artifactStatePath: '',
      videoForm: input.videoForm ?? 'narration',
      llmProfileId: input.llmProfileId ?? null,
      materialSource: input.materialSource ?? 'ai',
      productInfo: input.productInfo ?? null,
      materialPerson: input.materialPerson ?? null,
      draftDir: input.draftDir ?? null,
      fixedIntro: input.fixedIntro ?? null,
      outroCta: input.outroCta ?? null,
      lockIntroSentences: normalizeLockIntroSentences(input.lockIntroSentences),
      taskType: taskIdentity.taskType,
      pipelineStep: input.pipelineStep ?? 'new',
      pipelineData: input.pipelineData ?? '{}',
      targetLength: input.targetLength,
      targetScenes: explicitStoryboardSceneCount,
      scriptFormat: input.scriptFormat ?? (input.videoForm === 'two-host-podcast' ? 'dialogue' : 'narration'),
      podcastImageMode: input.podcastImageMode ?? 'multi',
      podcastSpeakers: input.podcastSpeakers ?? (input.videoForm === 'two-host-podcast' ? 'kazai-dayi' : null),
      podcastSpeakerA: input.podcastSpeakerA ?? null,
      podcastSpeakerB: input.podcastSpeakerB ?? null,
      coverImageMode,
      coverTemplateId: input.coverTemplateId ?? 'cinematic-poster',
      htmlVideoForeground: input.htmlVideoForeground,
    };
    this.assertHistoryWritable('task', task.id);
    this.db.run(
      `INSERT INTO tasks (
        id, archived_at, managed_storage_key, title, input_text, task_kind, processing_mode, publish_mode, status, current_step, track, style, speaker, ratio, template_id,
        bgm_id, pause_points, output_dir, error_message, created_at, completed_at, started_at, last_heartbeat_at,
        mode, ai_keyword, ai_sources, selected_sources, extra_requirements, prompt_template_id, prompt_template_type,
        image_prompt_reference, reference_image_path, rewrite_intensity, narrative_pov, keep_promotion, tts_provider,
        tts_speed, storyboard_scene_count, step3_prompt_snapshot, music_mv_json, failed_step, retry_from_step, artifact_state_path,
        video_form, llm_profile_id, material_source, product_info, material_person, draft_dir, fixed_intro, outro_cta, lock_intro_sentences,
        task_type, pipeline_step, pipeline_data, target_length, target_scenes, script_format,
        podcast_image_mode, podcast_speakers, podcast_speaker_a, podcast_speaker_b, cover_image_mode, cover_template_id,
        html_video_foreground
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.archivedAt ?? null,
        task.managedStorageKey ?? null,
        task.title,
        task.inputText,
        task.taskKind,
        task.processingMode,
        task.publishMode,
        task.status,
        task.currentStep,
        task.track,
        task.style,
        task.speaker,
        task.ratio,
        task.templateId,
        task.bgmId,
        json(task.pausePoints),
        task.outputDir,
        task.errorMessage,
        task.createdAt,
        task.completedAt,
        task.startedAt,
        task.lastHeartbeatAt,
        task.mode,
        task.aiKeyword,
        json(task.aiSources),
        json(task.selectedSources),
        task.extraRequirements,
        task.promptTemplateId,
        task.promptTemplateType,
        task.imagePromptReference,
        task.referenceImagePath,
        task.rewriteIntensity,
        task.narrativePov,
        task.keepPromotion ? 1 : 0,
        task.ttsProvider,
        task.ttsSpeed,
        task.storyboardSceneCount ?? null,
        task.step3PromptSnapshot,
        json(task.musicMv),
        task.failedStep,
        task.retryFromStep,
        task.artifactStatePath,
        task.videoForm ?? 'narration',
        task.llmProfileId ?? null,
        task.materialSource ?? 'ai',
        task.productInfo ?? null,
        task.materialPerson ?? null,
        task.draftDir ?? null,
        task.fixedIntro ?? null,
        task.outroCta ?? null,
        task.lockIntroSentences ?? 0,
        task.taskType ?? task.taskKind,
        task.pipelineStep ?? 'new',
        task.pipelineData ?? '{}',
        task.targetLength ?? null,
        task.targetScenes ?? null,
        task.scriptFormat ?? 'narration',
        task.podcastImageMode ?? 'multi',
        task.podcastSpeakers ?? null,
        task.podcastSpeakerA ?? null,
        task.podcastSpeakerB ?? null,
        task.coverImageMode ?? 'off',
        task.coverTemplateId ?? 'cinematic-poster',
        task.htmlVideoForeground === undefined ? null : task.htmlVideoForeground ? 1 : 0,
      ],
    );
    return task;
  }

  async createViralAnalysis(input: CreateViralAnalysisInput): Promise<ViralAnalysisRecord> {
    return this.enqueueCommit(() => {
      const now = new Date().toISOString();
      const record: ViralAnalysisRecord = {
        id: randomUUID(),
        archivedAt: null,
        managedStorageKey: createManagedStorageKey(),
        url: input.url.trim(),
        platform: input.platform ?? 'unknown',
        title: input.title ?? '',
        status: 'pending',
        currentStage: 'queued',
        progress: 0,
        settings: input.settings,
        resultPath: '',
        videoPath: '',
        errorMessage: '',
        createdAt: now,
        startedAt: null,
        completedAt: null,
        lastHeartbeatAt: null,
      };
      this.assertHistoryWritable('viral-analysis', record.id);
      this.db.run(
        `INSERT INTO viral_analyses (
          id, archived_at, managed_storage_key, url, platform, title, status, current_stage, progress, settings_json,
          result_path, video_path, error_message, created_at, started_at, completed_at, last_heartbeat_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.archivedAt ?? null,
          record.managedStorageKey ?? null,
          record.url,
          record.platform,
          record.title,
          record.status,
          record.currentStage,
          record.progress,
          json(record.settings),
          record.resultPath,
          record.videoPath,
          record.errorMessage,
          record.createdAt,
          record.startedAt,
          record.completedAt,
          record.lastHeartbeatAt,
        ],
      );
      return record;
    });
  }

  async addVoiceLabRecord(input: VoiceLabRecordInput): Promise<VoiceLabRecord> {
    return this.enqueueCommit(() => {
      const now = input.createdAt ?? new Date().toISOString();
      const status = input.status ?? 'generated';
      const record: VoiceLabRecord = {
        id: input.id ?? randomUUID(),
        archivedAt: null,
        managedStorageKey: createManagedStorageKey(),
        text: input.text,
        provider: input.provider,
        voiceId: input.voiceId,
        voiceLabel: input.voiceLabel ?? input.voiceId,
        speed: input.speed,
        audioPath: input.audioPath ?? '',
        status,
        errorMessage: input.errorMessage ?? '',
        createdAt: now,
        finishedAt: input.finishedAt ?? (status === 'generated' ? now : null),
      };
      this.assertHistoryWritable('voice-lab', record.id);
      this.db.run(
        `INSERT INTO voice_lab_records
         (id, archived_at, managed_storage_key, text, provider, voice_id, voice_label, speed, audio_path, status, error_msg, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.archivedAt ?? null,
          record.managedStorageKey ?? null,
          record.text,
          record.provider,
          record.voiceId,
          record.voiceLabel,
          record.speed,
          record.audioPath,
          record.status,
          record.errorMessage,
          record.createdAt,
          record.finishedAt,
        ],
      );
      return record;
    });
  }

  async updateVoiceLabRecord(
    id: string,
    patch: Partial<Pick<VoiceLabRecord, 'provider' | 'voiceLabel' | 'audioPath' | 'status' | 'errorMessage' | 'finishedAt'>>,
  ): Promise<VoiceLabRecord> {
    return this.enqueueCommit(() => {
      this.assertHistoryWritable('voice-lab', id);
      const mapping: Array<[keyof typeof patch, string]> = [
        ['provider', 'provider'],
        ['voiceLabel', 'voice_label'],
        ['audioPath', 'audio_path'],
        ['status', 'status'],
        ['errorMessage', 'error_msg'],
        ['finishedAt', 'finished_at'],
      ];
      const entries = mapping.filter(([key]) => key in patch);
      if (entries.length > 0) {
        const values = entries.map(([key]) => patch[key] ?? null) as SqlValue[];
        values.push(id);
        this.db.run(`UPDATE voice_lab_records SET ${entries.map(([, column]) => `${column} = ?`).join(', ')} WHERE id = ?`, values);
      }
      const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT * FROM voice_lab_records WHERE id = ?', [id]);
      if (!row) throw new Error(`VOICE_LAB_RECORD_NOT_FOUND: ${id}`);
      return rowToVoiceLabRecord(row);
    });
  }

  async backfillManagedStorageKey(family: HistoryFamily, id: string, managedStorageKey: string): Promise<boolean> {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/u.test(managedStorageKey)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu.test(managedStorageKey)
    ) {
      throw new Error('MANAGED_STORAGE_KEY_INVALID: Cannot persist an invalid managed storage key.');
    }
    return this.enqueueCommit(() => {
      this.assertHistoryWritable(family, id, { allowArchived: true });
      const table = historyTableByFamily[family];
      const idCollision = getFirstRow<{ id: string }>(
        this.db,
        `SELECT id FROM ${table}
         WHERE id COLLATE NOCASE = ? COLLATE NOCASE AND id <> ?
         LIMIT 1`,
        [id, id],
      );
      if (idCollision) return false;
      const collision = getFirstRow<{ id: string }>(
        this.db,
        `SELECT id FROM ${table}
         WHERE managed_storage_key COLLATE NOCASE = ? COLLATE NOCASE AND id <> ?
         LIMIT 1`,
        [managedStorageKey, id],
      );
      if (collision) return false;
      this.db.run(
        `UPDATE ${table} SET managed_storage_key = ? WHERE id = ? AND managed_storage_key IS NULL`,
        [managedStorageKey, id],
      );
      return this.db.getRowsModified() === 1;
    });
  }

  async listMissingManagedStorageKeys(): Promise<
    Array<{ family: HistoryFamily; id: string; managedStorageKey: null }>
  > {
    await this.waitForWrites();
    return getRows<{ family: string; id: string; managed_storage_key: null }>(
      this.db,
      `SELECT 'task' AS family, id, managed_storage_key FROM tasks WHERE managed_storage_key IS NULL
       UNION ALL
       SELECT 'viral-analysis' AS family, id, managed_storage_key FROM viral_analyses WHERE managed_storage_key IS NULL
       UNION ALL
       SELECT 'image-lab' AS family, id, managed_storage_key FROM image_lab_records WHERE managed_storage_key IS NULL
       UNION ALL
       SELECT 'voice-lab' AS family, id, managed_storage_key FROM voice_lab_records WHERE managed_storage_key IS NULL
       ORDER BY family ASC, id ASC`,
    ).map((row) => ({ family: row.family as HistoryFamily, id: String(row.id), managedStorageKey: null }));
  }

  async archiveTask(id: string): Promise<TaskSummary> {
    return this.enqueueCommit(() => this.archiveHistoryRecord('task', id, taskSummaryColumns, rowToTaskSummary, true));
  }

  async restoreTask(id: string): Promise<TaskSummary> {
    return this.enqueueCommit(() => this.restoreHistoryRecord('task', id, taskSummaryColumns, rowToTaskSummary));
  }

  async getHistoryDeletionTarget(family: HistoryFamily, id: string): Promise<HistoryDeletionTarget> {
    await this.waitForWrites();
    const tombstone = this.getHistoryTombstone(family, id);
    if (tombstone) {
      return { family, id, managedStorageKey: tombstone.managedStorageKey, tombstone };
    }
    const row = getFirstRow<Record<string, unknown>>(
      this.db,
      `SELECT archived_at, managed_storage_key, status FROM ${historyTableByFamily[family]} WHERE id = ?`,
      [id],
    );
    if (!row) throw new Error(`HISTORY_NOT_FOUND: ${family} ${id} does not exist.`);
    const status = String(row.status ?? '');
    if ((family === 'task' || family === 'viral-analysis') && (status === 'pending' || status === 'running')) {
      throw new Error(`HISTORY_ACTIVE: ${family} ${id} has ${status} status and cannot be archived or deleted.`);
    }
    if (!row.archived_at) {
      throw new Error(`HISTORY_NOT_ARCHIVED: ${family} ${id} must be archived before permanent deletion.`);
    }
    return {
      family,
      id,
      managedStorageKey: row.managed_storage_key === null || row.managed_storage_key === undefined
        ? null
        : String(row.managed_storage_key),
      tombstone: null,
    };
  }

  async listPendingHistoryTombstones(): Promise<HistoryTombstone[]> {
    await this.waitForWrites();
    return getRows<Record<string, unknown>>(
      this.db,
      `SELECT * FROM history_tombstones
       WHERE cleanup_state = 'pending' AND managed_storage_key IS NOT NULL
       ORDER BY deleted_at ASC, family ASC, entity_id ASC`,
    ).map(rowToHistoryTombstone);
  }

  async updateHistoryTombstoneCleanup(
    family: HistoryFamily,
    id: string,
    cleanupState: 'pending' | 'cleaned' | 'missing',
    diagnostic: string,
  ): Promise<HistoryTombstone> {
    return this.enqueueCommit(() => {
      const existing = this.getHistoryTombstone(family, id);
      if (!existing) throw new Error(`HISTORY_TOMBSTONE_NOT_FOUND: ${family} ${id} does not have a tombstone.`);
      if (existing.cleanupState !== 'pending') {
        if (existing.cleanupState === cleanupState && existing.diagnostic === diagnostic) return existing;
        throw new Error(`HISTORY_CLEANUP_TERMINAL: ${family} ${id} cleanup is already ${existing.cleanupState}.`);
      }
      this.db.run(
        'UPDATE history_tombstones SET cleanup_state = ?, diagnostic = ? WHERE family = ? AND entity_id = ?',
        [cleanupState, diagnostic, family, id],
      );
      const updated = this.getHistoryTombstone(family, id);
      if (!updated) throw new Error(`HISTORY_TOMBSTONE_NOT_FOUND: ${family} ${id} does not have a tombstone.`);
      return updated;
    });
  }

  async deleteTaskPermanently(id: string, cleanup?: HistoryDeletionCleanup): Promise<HistoryTombstone> {
    return this.enqueueCommit(() => this.deleteHistoryRecordPermanently('task', id, true, cleanup));
  }

  async archiveViralAnalysis(id: string): Promise<ViralAnalysisSummary> {
    return this.enqueueCommit(() => this.archiveHistoryRecord(
      'viral-analysis',
      id,
      viralAnalysisSummaryColumns,
      rowToViralAnalysisSummary,
      true,
    ));
  }

  async restoreViralAnalysis(id: string): Promise<ViralAnalysisSummary> {
    return this.enqueueCommit(() => this.restoreHistoryRecord(
      'viral-analysis',
      id,
      viralAnalysisSummaryColumns,
      rowToViralAnalysisSummary,
    ));
  }

  async deleteViralAnalysisPermanently(id: string, cleanup?: HistoryDeletionCleanup): Promise<HistoryTombstone> {
    return this.enqueueCommit(() => this.deleteHistoryRecordPermanently('viral-analysis', id, true, cleanup));
  }

  async archiveImageLabRecord(id: string): Promise<ImageLabSummary> {
    return this.enqueueCommit(() => this.archiveHistoryRecord(
      'image-lab',
      id,
      imageLabSummaryColumns,
      rowToImageLabSummary,
      false,
    ));
  }

  async restoreImageLabRecord(id: string): Promise<ImageLabSummary> {
    return this.enqueueCommit(() => this.restoreHistoryRecord(
      'image-lab',
      id,
      imageLabSummaryColumns,
      rowToImageLabSummary,
    ));
  }

  async deleteImageLabRecordPermanently(id: string, cleanup?: HistoryDeletionCleanup): Promise<HistoryTombstone> {
    return this.enqueueCommit(() => this.deleteHistoryRecordPermanently('image-lab', id, false, cleanup));
  }

  async archiveVoiceLabRecord(id: string): Promise<VoiceLabSummary> {
    return this.enqueueCommit(() => this.archiveHistoryRecord(
      'voice-lab',
      id,
      voiceLabSummaryColumns,
      rowToVoiceLabSummary,
      false,
    ));
  }

  async restoreVoiceLabRecord(id: string): Promise<VoiceLabSummary> {
    return this.enqueueCommit(() => this.restoreHistoryRecord(
      'voice-lab',
      id,
      voiceLabSummaryColumns,
      rowToVoiceLabSummary,
    ));
  }

  async deleteVoiceLabRecordPermanently(id: string, cleanup?: HistoryDeletionCleanup): Promise<HistoryTombstone> {
    return this.enqueueCommit(() => this.deleteHistoryRecordPermanently('voice-lab', id, false, cleanup));
  }

  async updateViralAnalysis(
    id: string,
    patch: Partial<Pick<ViralAnalysisRecord, 'status' | 'currentStage' | 'progress' | 'title' | 'resultPath' | 'videoPath' | 'errorMessage' | 'startedAt' | 'completedAt' | 'lastHeartbeatAt'>>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: SqlValue[] = [];
    const map: Record<string, string> = {
      status: 'status',
      currentStage: 'current_stage',
      progress: 'progress',
      title: 'title',
      resultPath: 'result_path',
      videoPath: 'video_path',
      errorMessage: 'error_message',
      startedAt: 'started_at',
      completedAt: 'completed_at',
      lastHeartbeatAt: 'last_heartbeat_at',
    };
    for (const [key, column] of Object.entries(map)) {
      if (key in patch) {
        sets.push(`${column} = ?`);
        const value = patch[key as keyof typeof patch];
        values.push(value === null || value === undefined ? null : typeof value === 'number' ? value : String(value));
      }
    }
    if (sets.length > 0) values.push(id);
    await this.enqueueCommit(() => {
      this.assertHistoryWritable('viral-analysis', id);
      if (sets.length > 0) this.db.run(`UPDATE viral_analyses SET ${sets.join(', ')} WHERE id = ?`, values);
    });
  }

  async addViralAnalysisEvent(analysisId: string, input: AddViralEventInput): Promise<ViralAnalysisEvent> {
    const event: ViralAnalysisEvent = {
      analysisId,
      type: input.type,
      stage: input.stage,
      detail: input.detail,
      dataJson: input.dataJson ?? null,
      ts: input.ts ?? Date.now(),
    };
    return this.enqueueCommit(() => {
      this.assertHistoryWritable('viral-analysis', analysisId);
      this.db.run(
        `INSERT INTO viral_analysis_events (analysis_id, type, stage, detail, data_json, ts)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [event.analysisId, event.type, event.stage, event.detail, event.dataJson, event.ts],
      );
      const seq = getFirstRow<{ seq: number }>(this.db, 'SELECT last_insert_rowid() AS seq')?.seq;
      return { ...event, seq };
    });
  }

  async updateTask(
    id: string,
    patch: Partial<
      Pick<
        Task,
        | 'status'
        | 'currentStep'
        | 'outputDir'
        | 'errorMessage'
        | 'completedAt'
        | 'failedStep'
        | 'retryFromStep'
        | 'artifactStatePath'
        | 'startedAt'
        | 'lastHeartbeatAt'
        | 'step3PromptSnapshot'
        | 'podcastSpeakerA'
        | 'podcastSpeakerB'
        | 'pipelineStep'
        | 'pipelineData'
      >
    >,
  ): Promise<void> {
    const sets: string[] = [];
    const values: SqlValue[] = [];
    const map: Record<string, string> = {
      status: 'status',
      currentStep: 'current_step',
      outputDir: 'output_dir',
      errorMessage: 'error_message',
      completedAt: 'completed_at',
      failedStep: 'failed_step',
      retryFromStep: 'retry_from_step',
      artifactStatePath: 'artifact_state_path',
      llmProfileId: 'llm_profile_id',
      videoForm: 'video_form',
      startedAt: 'started_at',
      lastHeartbeatAt: 'last_heartbeat_at',
      step3PromptSnapshot: 'step3_prompt_snapshot',
      podcastSpeakerA: 'podcast_speaker_a',
      podcastSpeakerB: 'podcast_speaker_b',
      pipelineStep: 'pipeline_step',
      pipelineData: 'pipeline_data',
    };
    for (const [key, column] of Object.entries(map)) {
      if (key in patch) {
        sets.push(`${column} = ?`);
        const value = patch[key as keyof typeof patch];
        values.push(value === null || value === undefined ? null : String(value));
      }
    }
    if (sets.length > 0) values.push(id);
    await this.enqueueCommit(() => {
      this.assertHistoryWritable('task', id);
      if (sets.length > 0) this.db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, values);
    });
  }

  async updateHtmlVideoTaskConfig(
    id: string,
    changes: readonly HtmlVideoConfigChange[],
  ): Promise<HtmlVideoTaskConfigMutationResult> {
    return this.enqueueCommit(() => {
      this.assertHistoryWritable('task', id);
      const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT * FROM tasks WHERE id = ?', [id]);
      if (!row) throw new Error(`HTML_VIDEO_TASK_NOT_FOUND: ${id}`);
      const task = rowToTask(row);
      if (task.taskType !== 'html-video') {
        throw new Error(`HTML_VIDEO_TASK_INVALID: ${id} is not an HTML video task.`);
      }
      if (task.status === 'pending' || task.status === 'running') {
        throw new Error(`HTML_VIDEO_CONFIG_ACTIVE: ${id} is ${task.status} and cannot be edited.`);
      }

      const applied = applyHtmlVideoConfigChanges(
        parseHtmlVideoPipelineData(task.pipelineData),
        changes,
      );
      const currentStep = htmlVideoVisibleSteps.indexOf(applied.invalidateFrom);
      const now = new Date().toISOString();
      const nextTask: Task = {
        ...task,
        ...applied.legacyMirrors,
        status: 'paused',
        currentStep,
        pipelineStep: applied.invalidateFrom,
        pipelineData: JSON.stringify(applied.pipeline),
        errorMessage: '',
        completedAt: null,
        failedStep: null,
        retryFromStep: null,
        lastHeartbeatAt: now,
      };
      this.db.run(
        `UPDATE tasks SET
          status = ?, current_step = ?, pipeline_step = ?, pipeline_data = ?, error_message = ?, completed_at = ?,
          failed_step = ?, retry_from_step = ?, last_heartbeat_at = ?, style = ?, speaker = ?, tts_provider = ?,
          tts_speed = ?, bgm_id = ?, html_video_foreground = ?, target_scenes = ?, storyboard_scene_count = ?, ratio = ?,
          cover_image_mode = ?, cover_template_id = ?
         WHERE id = ?`,
        [
          nextTask.status,
          nextTask.currentStep,
          nextTask.pipelineStep ?? 'rewrite',
          nextTask.pipelineData ?? '{}',
          nextTask.errorMessage,
          nextTask.completedAt,
          nextTask.failedStep,
          nextTask.retryFromStep,
          nextTask.lastHeartbeatAt,
          nextTask.style,
          nextTask.speaker,
          nextTask.ttsProvider,
          nextTask.ttsSpeed,
          nextTask.bgmId,
          nextTask.htmlVideoForeground === undefined ? null : nextTask.htmlVideoForeground ? 1 : 0,
          nextTask.targetScenes ?? null,
          nextTask.storyboardSceneCount ?? null,
          nextTask.ratio,
          nextTask.coverImageMode ?? null,
          nextTask.coverTemplateId ?? null,
          id,
        ],
      );

      const event: TaskEvent = {
        taskId: id,
        type: 'config_update',
        step: currentStep,
        agent: 'HTML Video',
        tool: null,
        detail: `已更新 HTML 视频参数，从${applied.invalidateFrom}阶段继续。`,
        dataJson: JSON.stringify({
          changedFields: applied.changedFields,
          invalidateFrom: applied.invalidateFrom,
        }),
        ts: Date.now(),
      };
      this.db.run(
        `INSERT INTO task_events (task_id, type, step, agent, tool, detail, data_json, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [event.taskId, event.type, event.step, event.agent, event.tool, event.detail, event.dataJson, event.ts],
      );
      const seq = getFirstRow<{ seq: number }>(this.db, 'SELECT last_insert_rowid() AS seq')?.seq;
      if (!Number.isSafeInteger(seq)) throw new Error('TASK_EVENT_SEQUENCE_MISSING: Event was not assigned a sequence.');
      const updatedRow = getFirstRow<Record<string, unknown>>(
        this.db,
        `SELECT ${taskSummaryColumns} FROM tasks WHERE id = ?`,
        [id],
      );
      if (!updatedRow) throw new Error(`HTML_VIDEO_TASK_NOT_FOUND: ${id}`);
      return {
        task: rowToTaskSummary(updatedRow),
        event: { ...event, seq: Number(seq) },
        changedFields: [...applied.changedFields],
      };
    });
  }

  async importHtmlVideoCover(
    id: string,
    source: HtmlVideoCoverInspection,
    operations: HtmlVideoCoverImportOperations,
  ): Promise<HtmlVideoTaskCoverMutationResult> {
    const importPaths: { staged: string | null; promoted: string | null } = {
      staged: null,
      promoted: null,
    };
    try {
      return await this.enqueueAsyncCommit(async () => {
        this.assertHistoryWritable('task', id);
        const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT * FROM tasks WHERE id = ?', [id]);
        if (!row) throw new Error(`HTML_VIDEO_TASK_NOT_FOUND: ${id}`);
        const task = rowToTask(row);
        if (task.taskType !== 'html-video') {
          throw new Error(`HTML_VIDEO_TASK_INVALID: ${id} is not an HTML video task.`);
        }
        if (task.status === 'pending' || task.status === 'running') {
          throw new Error(`HTML_VIDEO_COVER_ACTIVE: ${id} is ${task.status} and cannot import a cover.`);
        }
        if (!task.managedStorageKey || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/u.test(task.managedStorageKey)) {
          throw new Error(`HTML_VIDEO_COVER_STORAGE_INVALID: ${id} has no managed storage key.`);
        }

        const pipeline = parseHtmlVideoPipelineData(task.pipelineData);
        const mode = normalizeHtmlVideoCoverMode(pipeline.config.coverImageMode ?? 'off');
        if (mode !== 'manual') {
          throw new Error('HTML_VIDEO_COVER_MODE_INVALID: Select manual cover mode before importing an image.');
        }
        const ratio = normalizeHtmlVideoCoverRatio(pipeline.config.coverRatio ?? '3:4');
        validateHtmlVideoCoverInspection(source, ratio);

        const coverDirectory = join(dirname(this.file), 'tasks', task.managedStorageKey, 'covers');
        await operations.ensureDirectory(coverDirectory);
        const revision = (pipeline.coverAsset?.revision ?? 0) + 1;
        const relativePath = `covers/cover-manual-r${revision}.png`;
        const finalPath = join(dirname(this.file), 'tasks', task.managedStorageKey, relativePath);
        importPaths.staged = join(coverDirectory, `.cover-manual-r${revision}-${randomUUID()}.tmp`);
        const prepared = await operations.prepareImage({
          sourcePath: source.sourcePath,
          destinationPath: importPaths.staged,
          dimensions: htmlVideoCoverDimensions(ratio),
        });
        const coverAsset = createHtmlVideoCoverAsset({
          revision,
          mode: 'manual',
          path: relativePath,
          ...prepared,
          ratio,
          createdAt: operations.now(),
        });
        await operations.promoteFile(importPaths.staged, finalPath);
        importPaths.staged = null;
        importPaths.promoted = finalPath;

        const invalidated = invalidateHtmlVideoPipeline(pipeline, 'render');
        invalidated.coverAsset = coverAsset;
        invalidated.config = { ...invalidated.config, coverImageMode: 'manual' };
        invalidated.revision = pipeline.revision + 1;
        delete invalidated.configSnapshotHash;
        const now = operations.now();
        this.db.run(
          `UPDATE tasks SET
            status = 'paused', current_step = 5, pipeline_step = 'render', pipeline_data = ?, error_message = '',
            completed_at = NULL, failed_step = NULL, retry_from_step = NULL, last_heartbeat_at = ?, cover_image_mode = 'manual'
           WHERE id = ?`,
          [JSON.stringify(invalidated), now, id],
        );
        const event: TaskEvent = {
          taskId: id,
          type: 'cover_import',
          step: 5,
          agent: 'HTML Video',
          tool: null,
          detail: '已导入手动封面，从出片阶段继续。',
          dataJson: JSON.stringify({
            coverAsset: {
              version: coverAsset.version,
              revision: coverAsset.revision,
              path: coverAsset.path,
              ratio: coverAsset.ratio,
              width: coverAsset.width,
              height: coverAsset.height,
              sizeBytes: coverAsset.sizeBytes,
              sha256: coverAsset.sha256,
            },
            invalidateFrom: 'render',
          }),
          ts: Date.parse(now) || Date.now(),
        };
        this.db.run(
          `INSERT INTO task_events (task_id, type, step, agent, tool, detail, data_json, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [event.taskId, event.type, event.step, event.agent, event.tool, event.detail, event.dataJson, event.ts],
        );
        const seq = getFirstRow<{ seq: number }>(this.db, 'SELECT last_insert_rowid() AS seq')?.seq;
        if (!Number.isSafeInteger(seq)) throw new Error('TASK_EVENT_SEQUENCE_MISSING: Event was not assigned a sequence.');
        const updatedRow = getFirstRow<Record<string, unknown>>(
          this.db,
          `SELECT ${taskSummaryColumns} FROM tasks WHERE id = ?`,
          [id],
        );
        if (!updatedRow) throw new Error(`HTML_VIDEO_TASK_NOT_FOUND: ${id}`);
        return {
          task: rowToTaskSummary(updatedRow),
          event: { ...event, seq: Number(seq) },
          coverAsset,
        };
      });
    } catch (error) {
      const cleanup = [importPaths.staged, importPaths.promoted].filter((path): path is string => Boolean(path));
      for (const path of cleanup) {
        try {
          await operations.removeFile(path);
        } catch {
          // Preserve the transaction or persistence error.
        }
      }
      throw error;
    }
  }

  async listTaskSummaries(request: HistoryListInput<'task'> = {}): Promise<HistoryPage<'task', TaskSummary>> {
    const statuses = canonicalTaskStatuses(request);
    const filters: HistorySqlFilter[] = [];
    if (statuses.length > 0) {
      filters.push({ sql: `status IN (${statuses.map(() => '?').join(', ')})`, params: statuses });
    }
    if (request.taskType) {
      filters.push({
        sql: `${normalizedTaskTypeSql()} = ?`,
        params: [request.taskType],
      });
    }
    return this.listHistoryRecords({
      family: 'task',
      table: 'tasks',
      columns: taskSummaryColumns,
      searchColumns: ['title', 'input_text', 'ai_keyword'],
      mapRow: rowToTaskSummary,
      request,
      binding: historyCursorBinding({
        family: 'task',
        filter: request.filter,
        status: request.status,
        statuses: request.statuses ? statuses : undefined,
        taskType: request.taskType,
        query: request.query,
      }),
      filters,
    });
  }

  async getTaskSummary(id: string): Promise<TaskSummary | null> {
    await this.waitForWrites();
    const row = getFirstRow<Record<string, unknown>>(this.db, `SELECT ${taskSummaryColumns} FROM tasks WHERE id = ?`, [id]);
    return row ? rowToTaskSummary(row) : null;
  }

  async getTaskDetail(id: string): Promise<Task | null> {
    await this.waitForWrites();
    const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT * FROM tasks WHERE id = ?', [id]);
    return row ? rowToTask(row) : null;
  }

  async listTaskEvents(taskId: string, request: CursorRequest = {}): Promise<CursorPage<SequencedTaskEvent>> {
    await this.waitForWrites();
    const limit = clampPageLimit(request.limit);
    const cursor = sequenceCursor(request.cursor);
    const rows = getRows<Record<string, unknown>>(
      this.db,
      `SELECT * FROM task_events WHERE task_id = ? ${cursor === null ? '' : 'AND seq < ?'} ORDER BY seq DESC LIMIT ?`,
      cursor === null ? [taskId, limit + 1] : [taskId, cursor, limit + 1],
    );
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(rowToSequencedTaskEvent).reverse();
    return { items, nextCursor: hasMore && items.length > 0 ? encodeCursor({ seq: items[0].seq }) : null };
  }

  async listViralAnalyses(request: HistoryListInput<'viral-analysis'> = {}): Promise<HistoryPage<'viral-analysis', ViralAnalysisSummary>> {
    const filters = request.status ? [{ sql: 'status = ?', params: [request.status] }] : [];
    return this.listHistoryRecords({
      family: 'viral-analysis',
      table: 'viral_analyses',
      columns: viralAnalysisSummaryColumns,
      searchColumns: ['title', 'url', 'platform'],
      mapRow: rowToViralAnalysisSummary,
      request,
      binding: historyCursorBinding({ family: 'viral-analysis', filter: request.filter, status: request.status, query: request.query }),
      filters,
    });
  }

  async getViralAnalysisSummary(id: string): Promise<ViralAnalysisSummary | null> {
    await this.waitForWrites();
    const row = getFirstRow<Record<string, unknown>>(
      this.db,
      `SELECT ${viralAnalysisSummaryColumns} FROM viral_analyses WHERE id = ?`,
      [id],
    );
    return row ? rowToViralAnalysisSummary(row) : null;
  }

  async getViralAnalysisDetail(id: string): Promise<ViralAnalysisRecord | null> {
    await this.waitForWrites();
    const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT * FROM viral_analyses WHERE id = ?', [id]);
    return row ? rowToViralAnalysis(row) : null;
  }

  async listViralAnalysisEvents(analysisId: string, request: CursorRequest = {}): Promise<CursorPage<ViralAnalysisEvent>> {
    await this.waitForWrites();
    const limit = clampPageLimit(request.limit);
    const cursor = sequenceCursor(request.cursor);
    const rows = getRows<Record<string, unknown>>(
      this.db,
      `SELECT * FROM viral_analysis_events WHERE analysis_id = ? ${cursor === null ? '' : 'AND seq < ?'} ORDER BY seq DESC LIMIT ?`,
      cursor === null ? [analysisId, limit + 1] : [analysisId, cursor, limit + 1],
    );
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(rowToViralEvent).reverse();
    const oldestSeq = Number(pageRows.at(-1)?.seq);
    return { items, nextCursor: hasMore && Number.isSafeInteger(oldestSeq) ? encodeCursor({ seq: oldestSeq }) : null };
  }

  async listImageLabRecords(request: HistoryListInput<'image-lab'> = {}): Promise<HistoryPage<'image-lab', ImageLabSummary>> {
    const filters = request.status ? [{ sql: 'status = ?', params: [request.status] }] : [];
    return this.listHistoryRecords({
      family: 'image-lab',
      table: 'image_lab_records',
      columns: imageLabSummaryColumns,
      searchColumns: ['prompt', 'provider', 'style'],
      mapRow: rowToImageLabSummary,
      request,
      binding: historyCursorBinding({ family: 'image-lab', filter: request.filter, status: request.status, query: request.query }),
      filters,
    });
  }

  async getImageLabRecordDetail(id: string): Promise<ImageLabRecord | null> {
    await this.waitForWrites();
    const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT * FROM image_lab_records WHERE id = ?', [id]);
    return row ? rowToImageLabRecord(row) : null;
  }

  async listVoiceLabRecords(request: HistoryListInput<'voice-lab'> = {}): Promise<HistoryPage<'voice-lab', VoiceLabSummary>> {
    const filters = request.status ? [{ sql: 'status = ?', params: [request.status] }] : [];
    return this.listHistoryRecords({
      family: 'voice-lab',
      table: 'voice_lab_records',
      columns: voiceLabSummaryColumns,
      searchColumns: ['text', 'voice_label', 'provider'],
      mapRow: rowToVoiceLabSummary,
      request,
      binding: historyCursorBinding({ family: 'voice-lab', filter: request.filter, status: request.status, query: request.query }),
      filters,
    });
  }

  async getVoiceLabRecordDetail(id: string): Promise<VoiceLabRecord | null> {
    await this.waitForWrites();
    const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT * FROM voice_lab_records WHERE id = ?', [id]);
    return row ? rowToVoiceLabRecord(row) : null;
  }

  async listPromptTemplateSummaries(request: CursorRequest = {}): Promise<CursorPage<PromptTemplateSummary>> {
    await this.waitForWrites();
    const limit = clampPageLimit(request.limit);
    const cursor = createdIdCursor(request.cursor);
    const where = cursor ? 'WHERE updated_at < ? OR (updated_at = ? AND id < ?)' : '';
    const params: SqlValue[] = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [limit + 1];
    const rows = getRows<Record<string, unknown>>(
      this.db,
      `SELECT id, name, type, description, is_builtin, updated_at, summary_json FROM prompt_templates ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`,
      params,
    );
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(rowToPromptTemplateSummary),
      nextCursor: hasMore && last ? encodeCursor({ createdAt: String(last.updated_at), id: String(last.id) }) : null,
    };
  }

  async getPromptTemplateDetail(id: string): Promise<PromptTemplate | null> {
    await this.waitForWrites();
    const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT * FROM prompt_templates WHERE id = ?', [id]);
    return row ? rowToPromptTemplate(row) : null;
  }

  async listBuiltinPromptTemplateSummaries(): Promise<PromptTemplateSummary[]> {
    await this.waitForWrites();
    return getRows<Record<string, unknown>>(
      this.db,
      `SELECT id, name, type, description, is_builtin, updated_at, summary_json
       FROM prompt_templates WHERE is_builtin = 1 ORDER BY updated_at DESC, id DESC`,
    ).map(rowToPromptTemplateSummary);
  }

  async listDraftTemplateSummaries(request: CursorRequest = {}): Promise<CursorPage<DraftTemplateSummary>> {
    await this.waitForWrites();
    const limit = clampPageLimit(request.limit);
    const parsed = decodeCursor(request.cursor);
    const id = parsed && Object.keys(parsed).length === 1 && typeof parsed.id === 'string' && parsed.id.trim().length > 0
      ? parsed.id
      : null;
    if (parsed && !id) throw new Error('CURSOR_INVALID: Expected a draft template cursor.');
    const rows = getRows<Record<string, unknown>>(
      this.db,
      `SELECT id, name, is_builtin, canvas_width, canvas_height, canvas_ratio, updated_at
       FROM draft_templates ${id ? 'WHERE id > ?' : ''} ORDER BY id ASC LIMIT ?`,
      id ? [id, limit + 1] : [limit + 1],
    );
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(rowToDraftTemplateSummary),
      nextCursor: hasMore && last ? encodeCursor({ id: String(last.id) }) : null,
    };
  }

  async getDraftTemplateDetail(id: string): Promise<DraftTemplate | null> {
    await this.waitForWrites();
    const row = getFirstRow<Record<string, unknown>>(this.db, 'SELECT data, updated_at FROM draft_templates WHERE id = ?', [id]);
    return row ? rowToDraftTemplate(row) : null;
  }

  async getCustomCoverTemplateDetail(id: string): Promise<CustomCoverTemplate | null> {
    await this.waitForWrites();
    const row = getFirstRow<Record<string, unknown>>(
      this.db,
      'SELECT * FROM custom_cover_templates WHERE id = ?',
      [id],
    );
    return row ? rowToCustomCoverTemplate(row) : null;
  }

  async listMinimaxCloneVoices(request: CursorRequest = {}): Promise<CountedCursorPage<MinimaxCloneVoice>> {
    await this.waitForWrites();
    const limit = clampPageLimit(request.limit);
    const cursor = cloneVoiceCursor(request.cursor);
    const where = cursor ? 'WHERE last_used_at < ? OR (last_used_at = ? AND voice_id < ?)' : '';
    const params: SqlValue[] = cursor
      ? [cursor.lastUsedAt, cursor.lastUsedAt, cursor.voiceId, limit + 1]
      : [limit + 1];
    const rows = getRows<Record<string, unknown>>(
      this.db,
      `SELECT * FROM minimax_clone_voices ${where} ORDER BY last_used_at DESC, voice_id DESC LIMIT ?`,
      params,
    );
    const totalCount = Number(
      getFirstRow<{ count: number }>(this.db, 'SELECT COUNT(*) AS count FROM minimax_clone_voices')?.count ?? 0,
    );
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(rowToMinimaxCloneVoice),
      totalCount,
      nextCursor: hasMore && last
        ? encodeCursor({ lastUsedAt: Number(last.last_used_at), voiceId: String(last.voice_id) })
        : null,
    };
  }

  async getBootstrapMetadata(): Promise<
    Pick<AppState, 'config' | 'customStyles' | 'customCoverTemplates' | 'creditTransactions' | 'minimaxCloneVoices' | 'account' | 'activation' | 'ui'>
  > {
    await this.waitForWrites();
    const configRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM config WHERE id = 1');
    const accountRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM account_profile WHERE id = 1');
    const activationRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM activation_state WHERE id = 1');
    const uiRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM ui_preferences WHERE id = 1');
    return {
      config: configRow ? mergeConfig(parseJson(configRow.data, defaultConfig)) : defaultConfig,
      customStyles: getRows<Record<string, unknown>>(this.db, 'SELECT * FROM custom_styles ORDER BY name ASC').map(rowToCustomStyle),
      customCoverTemplates: getRows<Record<string, unknown>>(this.db, 'SELECT * FROM custom_cover_templates ORDER BY created_at ASC').map(rowToCustomCoverTemplate),
      creditTransactions: getRows<Record<string, unknown>>(this.db, 'SELECT * FROM credit_transactions ORDER BY id DESC LIMIT 100').map(rowToCreditTransaction),
      minimaxCloneVoices: getRows<Record<string, unknown>>(this.db, 'SELECT * FROM minimax_clone_voices ORDER BY last_used_at DESC LIMIT 100').map(rowToMinimaxCloneVoice),
      account: accountRow ? ({ ...defaultAccount, ...parseJson(accountRow.data, defaultAccount) } as AccountProfile) : defaultAccount,
      activation: activationRow ? ({ ...defaultActivation, ...parseJson(activationRow.data, defaultActivation) } as ActivationState) : defaultActivation,
      ui: migrateThemePreference(uiRow ? parseJson(uiRow.data, {}) : {}, configRow ? parseJson(configRow.data, {}) : defaultConfig),
    };
  }

  private async listHistoryRecords<F extends HistoryFamily, T>(input: {
    family: F;
    table: 'tasks' | 'viral_analyses' | 'image_lab_records' | 'voice_lab_records';
    columns: string;
    searchColumns: string[];
    mapRow: (row: Record<string, unknown>) => T;
    request: { filter?: 'active' | 'archived'; query?: string; cursor?: string | null; limit?: number };
    binding: HistoryCursorBinding;
    filters: HistorySqlFilter[];
  }): Promise<HistoryPage<F, T>> {
    await this.waitForWrites();
    const limit = clampPageLimit(input.request.limit);
    const filter = input.request.filter ?? 'active';
    const sortColumn = filter === 'archived' ? 'archived_at' : 'created_at';
    const clauses = [filter === 'archived' ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'];
    const params: SqlValue[] = [];
    for (const sqlFilter of input.filters) {
      clauses.push(sqlFilter.sql);
      params.push(...sqlFilter.params);
    }
    const query = normalizeHistoryQuery(input.request.query);
    if (query) {
      clauses.push(`(${input.searchColumns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      const pattern = `%${escapeLikeLiteral(query)}%`;
      params.push(...input.searchColumns.map(() => pattern));
    }
    const baseWhere = `WHERE ${clauses.join(' AND ')}`;
    const totalCount = Number(
      getFirstRow<{ total_count: number }>(this.db, `SELECT COUNT(*) AS total_count FROM ${input.table} ${baseWhere}`, params)?.total_count ?? 0,
    );
    const cursor = parseHistoryCursor(input.request.cursor, input.binding);
    const pageClauses = [...clauses];
    const pageParams = [...params];
    if (cursor) {
      pageClauses.push(`(${sortColumn} < ? OR (${sortColumn} = ? AND id < ?))`);
      pageParams.push(cursor.sort, cursor.sort, cursor.id);
    }
    pageParams.push(limit + 1);
    const rows = getRows<Record<string, unknown>>(
      this.db,
      `SELECT ${input.columns} FROM ${input.table} WHERE ${pageClauses.join(' AND ')} ORDER BY ${sortColumn} DESC, id DESC LIMIT ?`,
      pageParams,
    );
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    const nextCursor = hasMore && last
      ? encodeHistoryCursor(input.binding, { sort: String(last[sortColumn]), id: String(last.id) })
      : null;
    return {
      family: input.family,
      items: pageRows.map(input.mapRow),
      totalCount,
      hasMore: nextCursor !== null,
      nextCursor,
    };
  }

  async addTaskEvent(taskId: string, input: AddEventInput): Promise<SequencedTaskEvent> {
    const event: TaskEvent = {
      taskId,
      type: input.type,
      step: input.step ?? null,
      agent: input.agent ?? null,
      tool: input.tool ?? null,
      detail: input.detail,
      dataJson: input.dataJson ?? null,
      ts: input.ts ?? Date.now(),
    };
    return this.enqueueCommit(() => {
      this.assertHistoryWritable('task', taskId);
      this.db.run(
        `INSERT INTO task_events (task_id, type, step, agent, tool, detail, data_json, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [event.taskId, event.type, event.step, event.agent, event.tool, event.detail, event.dataJson, event.ts],
      );
      const seq = getFirstRow<{ seq: number }>(this.db, 'SELECT last_insert_rowid() AS seq')?.seq;
      if (!Number.isSafeInteger(seq)) throw new Error('TASK_EVENT_SEQUENCE_MISSING: Event was not assigned a sequence.');
      return { ...event, seq: Number(seq) };
    });
  }

  async getState(): Promise<AppState> {
    await this.waitForWrites();
    const configRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM config WHERE id = 1');
    const taskRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM tasks ORDER BY created_at DESC');
    const eventRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM task_events ORDER BY seq ASC');
    const viralRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM viral_analyses ORDER BY created_at DESC');
    const viralEventRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM viral_analysis_events ORDER BY seq ASC');
    const promptRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM prompt_templates ORDER BY is_builtin DESC, updated_at DESC');
    const draftRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM draft_templates ORDER BY is_builtin DESC, id ASC');
    const imageRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM image_lab_records ORDER BY created_at DESC');
    const voiceLabRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM voice_lab_records ORDER BY created_at DESC');
    const styleRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM custom_styles ORDER BY name ASC');
    const coverTemplateRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM custom_cover_templates ORDER BY created_at ASC');
    const creditRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM credit_transactions ORDER BY id DESC');
    const voiceRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM minimax_clone_voices ORDER BY last_used_at DESC');
    const accountRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM account_profile WHERE id = 1');
    const activationRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM activation_state WHERE id = 1');
    const uiRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM ui_preferences WHERE id = 1');
    return {
      config: configRow ? mergeConfig(parseJson(configRow.data, defaultConfig)) : defaultConfig,
      tasks: taskRows.map(rowToTask),
      events: eventRows.map(rowToEvent),
      viralAnalyses: viralRows.map(rowToViralAnalysis),
      viralEvents: viralEventRows.map(rowToViralEvent),
      promptTemplates: promptRows.map(rowToPromptTemplate),
      draftTemplates: draftRows.map(rowToDraftTemplate),
      imageLabRecords: imageRows.map(rowToImageLabRecord),
      voiceLabRecords: voiceLabRows.map(rowToVoiceLabRecord),
      customStyles: styleRows.map(rowToCustomStyle),
      customCoverTemplates: coverTemplateRows.map(rowToCustomCoverTemplate),
      creditTransactions: creditRows.map(rowToCreditTransaction),
      minimaxCloneVoices: voiceRows.map(rowToMinimaxCloneVoice),
      account: accountRow ? ({ ...defaultAccount, ...parseJson(accountRow.data, defaultAccount) } as AccountProfile) : defaultAccount,
      activation: activationRow ? ({ ...defaultActivation, ...parseJson(activationRow.data, defaultActivation) } as ActivationState) : defaultActivation,
      ui: migrateThemePreference(uiRow ? parseJson(uiRow.data, {}) : {}, configRow ? parseJson(configRow.data, {}) : defaultConfig),
    };
  }
}

function rowToTaskSummary(row: Record<string, unknown>): TaskSummary {
  const task = rowToTask(row);
  const {
    inputText,
    pausePoints: _pausePoints,
    aiSources: _aiSources,
    selectedSources: _selectedSources,
    extraRequirements: _extraRequirements,
    imagePromptReference: _imagePromptReference,
    step3PromptSnapshot: _step3PromptSnapshot,
    musicMv: _musicMv,
    pipelineData: _pipelineData,
    productInfo: _productInfo,
    materialPerson: _materialPerson,
    fixedIntro: _fixedIntro,
    outroCta: _outroCta,
    podcastSpeakers: _podcastSpeakers,
    ...summary
  } = task;
  return {
    ...summary,
    inputPreview: String(row.input_preview ?? inputText).replace(/\s+/gu, ' ').trim().slice(0, TASK_INPUT_PREVIEW_LIMIT),
  };
}

function rowToSequencedTaskEvent(row: Record<string, unknown>): SequencedTaskEvent {
  const event = rowToEvent(row);
  if (!Number.isSafeInteger(event.seq)) throw new Error('TASK_EVENT_SEQUENCE_INVALID: Persisted event has no sequence.');
  return { ...event, seq: Number(event.seq) };
}

function rowToPromptTemplateSummary(row: Record<string, unknown>): PromptTemplateSummary {
  const stored = parseJson<Partial<PromptTemplateSummary>>(row.summary_json, {});
  return {
    ...stored,
    id: String(row.id),
    name: String(row.name ?? ''),
    type: String(row.type ?? 'task') as PromptTemplate['type'],
    description: String(row.description ?? ''),
    isBuiltin: Number(row.is_builtin) === 1,
    updatedAt: String(row.updated_at ?? ''),
  };
}

function promptTemplateSummary(template: PromptTemplate): PromptTemplateSummary {
  const {
    content: _content,
    stepPrompts: _stepPrompts,
    imageSeedPoolsJson: _imageSeedPoolsJson,
    ...summary
  } = template;
  return summary;
}

function rowToDraftTemplateSummary(row: Record<string, unknown>): DraftTemplateSummary {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    isDefault: Number(row.is_builtin ?? 0) === 1,
    canvas: {
      width: Number(row.canvas_width ?? 1080),
      height: Number(row.canvas_height ?? 1920),
      ratio: String(row.canvas_ratio ?? '9:16'),
    },
    updatedAt: String(row.updated_at ?? ''),
  };
}

function rowToBookSelectionRecord(row: Record<string, unknown>): BookSelectionRecord {
  return {
    theme: String(row.theme ?? ''),
    bookId: String(row.book_id ?? ''),
    data: parseJson<BookSelectionRecord['data']>(row.data, { name: '' }),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    title: String(row.title ?? ''),
    inputText: String(row.input_text ?? ''),
    taskKind: normalizeTaskKind(row.task_kind),
    processingMode: normalizeProcessingMode(row.processing_mode),
    status: String(row.status ?? 'pending') as TaskStatus,
    currentStep: Number(row.current_step ?? 0),
    track: String(row.track ?? 'character-story'),
    style: String(row.style ?? 'photo-real'),
    speaker: String(row.speaker ?? '灿博小叔'),
    ratio: String(row.ratio ?? '9:16'),
    templateId: String(row.template_id ?? 'default-portrait-9-16'),
    bgmId: String(row.bgm_id ?? ''),
    pausePoints: parseJson(String(row.pause_points ?? '[]'), []),
    outputDir: String(row.output_dir ?? ''),
    errorMessage: String(row.error_message ?? ''),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
    mode: String(row.mode ?? 'paste') as Task['mode'],
    aiKeyword: String(row.ai_keyword ?? ''),
    aiSources: parseJson(String(row.ai_sources ?? '[]'), []),
    selectedSources: parseJson(String(row.selected_sources ?? '[]'), []),
    extraRequirements: String(row.extra_requirements ?? ''),
    imagePromptReference: String(row.image_prompt_reference ?? ''),
    promptTemplateId: row.prompt_template_id ? String(row.prompt_template_id) : null,
    promptTemplateType: row.prompt_template_type ? String(row.prompt_template_type) : null,
    referenceImagePath: String(row.reference_image_path ?? ''),
    rewriteIntensity: String(row.rewrite_intensity ?? 'standard') as Task['rewriteIntensity'],
    narrativePov: String(row.narrative_pov ?? 'keep-original') as Task['narrativePov'],
    keepPromotion: Number(row.keep_promotion ?? 0) === 1,
    ttsProvider: String(row.tts_provider ?? 'volcengine') as Task['ttsProvider'],
    ttsSpeed: Number(row.tts_speed ?? 1),
    storyboardSceneCount: row.storyboard_scene_count === null || row.storyboard_scene_count === undefined ? undefined : Number(row.storyboard_scene_count),
    step3PromptSnapshot: String(row.step3_prompt_snapshot ?? ''),
    musicMv: normalizeMusicMvSettings(parseJson(String(row.music_mv_json ?? '{}'), {})),
    failedStep: row.failed_step === null || row.failed_step === undefined ? null : Number(row.failed_step),
    retryFromStep: row.retry_from_step === null || row.retry_from_step === undefined ? null : Number(row.retry_from_step),
    artifactStatePath: String(row.artifact_state_path ?? ''),
    videoForm: normalizeVideoForm(row.video_form),
    llmProfileId: row.llm_profile_id === null || row.llm_profile_id === undefined || row.llm_profile_id === '' ? null : String(row.llm_profile_id),
    materialSource: String(row.material_source ?? 'ai'),
    productInfo: row.product_info === null || row.product_info === undefined ? null : String(row.product_info),
    materialPerson: row.material_person === null || row.material_person === undefined ? null : String(row.material_person),
    draftDir: row.draft_dir === null || row.draft_dir === undefined ? null : String(row.draft_dir),
    fixedIntro: row.fixed_intro === null || row.fixed_intro === undefined ? null : String(row.fixed_intro),
    outroCta: row.outro_cta === null || row.outro_cta === undefined ? null : String(row.outro_cta),
    lockIntroSentences: normalizeLockIntroSentences(row.lock_intro_sentences),
    taskType: normalizeLegacyTaskType(row.task_type, row.task_kind),
    pipelineStep: String(row.pipeline_step ?? 'new'),
    pipelineData: String(row.pipeline_data ?? '{}'),
    targetLength: row.target_length === null || row.target_length === undefined ? undefined : Number(row.target_length),
    targetScenes: row.target_scenes === null || row.target_scenes === undefined ? undefined : Number(row.target_scenes),
    publishMode: String(row.publish_mode ?? 'review-rewrite') as Task['publishMode'],
    scriptFormat: String(row.script_format ?? 'narration'),
    podcastImageMode: String(row.podcast_image_mode ?? 'multi'),
    podcastSpeakers: row.podcast_speakers === null || row.podcast_speakers === undefined ? null : String(row.podcast_speakers),
    podcastSpeakerA: row.podcast_speaker_a === null || row.podcast_speaker_a === undefined ? null : String(row.podcast_speaker_a),
    podcastSpeakerB: row.podcast_speaker_b === null || row.podcast_speaker_b === undefined ? null : String(row.podcast_speaker_b),
    coverImageMode: String(row.cover_image_mode ?? 'off'),
    coverTemplateId: String(row.cover_template_id ?? 'cinematic-poster'),
    htmlVideoForeground: row.html_video_foreground === null || row.html_video_foreground === undefined
      ? undefined
      : Number(row.html_video_foreground) === 1,
  };
}

function normalizedTaskTypeSql(): string {
  return `CASE
    WHEN trim(coalesce(task_type, '')) = '' THEN CASE WHEN task_kind = 'music-mv' THEN 'music-mv' ELSE 'story' END
    ELSE trim(task_type)
  END`;
}

function normalizeLegacyTaskType(value: unknown, taskKind: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || normalizeTaskKind(taskKind);
}

function normalizeTaskKind(value: unknown): Task['taskKind'] {
  return value === 'music-mv' ? value : 'story';
}

function normalizeVideoForm(value: unknown): Task['videoForm'] {
  return value === 'two-host-podcast' ? 'two-host-podcast' : 'narration';
}

function normalizeProcessingMode(value: unknown): Task['processingMode'] {
  return value === 'semi-auto' || value === 'clip-only' ? value : 'full-auto';
}

function normalizeLockIntroSentences(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : 0;
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(20, Math.max(0, Math.trunc(numericValue)));
}

function normalizeMusicMvSettings(value: unknown): Task['musicMv'] {
  const input = value && typeof value === 'object' ? (value as Partial<Task['musicMv']>) : {};
  const rhythmMode =
    input.rhythmMode === 'fast-cut' || input.rhythmMode === 'slow-cinematic' || input.rhythmMode === 'lyric-sync'
      ? input.rhythmMode
      : 'lyric-sync';
  const captionStyle = input.captionStyle === 'minimal' || input.captionStyle === 'none' || input.captionStyle === 'karaoke' ? input.captionStyle : 'karaoke';
  return {
    rhythmMode,
    captionStyle,
    visualMotif: String(input.visualMotif ?? ''),
    audioPath: String(input.audioPath ?? ''),
  };
}

function rowToEvent(row: Record<string, unknown>): TaskEvent {
  return {
    seq: Number(row.seq),
    taskId: String(row.task_id),
    type: String(row.type),
    step: row.step === null || row.step === undefined ? null : Number(row.step),
    agent: row.agent === null || row.agent === undefined ? null : String(row.agent),
    tool: row.tool === null || row.tool === undefined ? null : String(row.tool),
    detail: String(row.detail ?? ''),
    dataJson: row.data_json === null || row.data_json === undefined ? null : String(row.data_json),
    ts: Number(row.ts),
  };
}

function rowToViralAnalysis(row: Record<string, unknown>): ViralAnalysisRecord {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    url: String(row.url ?? ''),
    platform: String(row.platform ?? 'unknown') as ViralAnalysisRecord['platform'],
    title: String(row.title ?? ''),
    status: String(row.status ?? 'pending') as ViralAnalysisRecord['status'],
    currentStage: String(row.current_stage ?? 'queued') as ViralAnalysisRecord['currentStage'],
    progress: Number(row.progress ?? 0),
    settings: parseJson(String(row.settings_json ?? '{}'), {
      track: 'general-story',
      style: 'photo-real',
      ratio: '9:16',
      templateId: 'default-portrait-9-16',
    }),
    resultPath: String(row.result_path ?? ''),
    videoPath: String(row.video_path ?? ''),
    errorMessage: String(row.error_message ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
  };
}

function rowToViralAnalysisSummary(row: Record<string, unknown>): ViralAnalysisSummary {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    url: String(row.url ?? ''),
    platform: String(row.platform ?? 'unknown') as ViralAnalysisRecord['platform'],
    title: String(row.title ?? ''),
    status: String(row.status ?? 'pending') as ViralAnalysisRecord['status'],
    currentStage: String(row.current_stage ?? 'queued') as ViralAnalysisRecord['currentStage'],
    progress: Number(row.progress ?? 0),
    errorMessage: String(row.error_message ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
  };
}

function rowToViralEvent(row: Record<string, unknown>): ViralAnalysisEvent {
  return {
    seq: Number(row.seq),
    analysisId: String(row.analysis_id),
    type: String(row.type),
    stage: String(row.stage),
    detail: String(row.detail ?? ''),
    dataJson: row.data_json === null || row.data_json === undefined ? null : String(row.data_json),
    ts: Number(row.ts),
  };
}

function rowToPromptTemplate(row: Record<string, unknown>): PromptTemplate {
  const stored = parseJson<Partial<PromptTemplate>>(row.data_json, {});
  const template: PromptTemplate = {
    id: String(row.id),
    name: String(row.name ?? ''),
    type: String(row.type ?? 'rewrite') as PromptTemplate['type'],
    description: String(row.description ?? ''),
    content: String(row.content ?? ''),
    isBuiltin: Number(row.is_builtin ?? 0) === 1,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    ...stored,
    imageSeedPoolsJson: stored.imageSeedPoolsJson ?? '',
  };
  return withBuiltinPromptTemplateMigrations(template);
}

function withBuiltinPromptTemplateMigrations(template: PromptTemplate): PromptTemplate {
  if (template.id !== 'builtin-image-prompt' || template.content.includes('{{imagePromptReference}}')) return template;
  return {
    ...template,
    content: `${template.content}\n\n爆款复刻画面提示词参考：{{imagePromptReference}}`,
  };
}

function rowToDraftTemplate(row: Record<string, unknown>): DraftTemplate {
  const template = normalizeDraftTemplate(parseJson(String(row.data), draftTemplates[0]));
  return { ...template, updatedAt: String(row.updated_at ?? template.updatedAt ?? '') };
}

function rowToImageLabRecord(row: Record<string, unknown>): ImageLabRecord {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    prompt: String(row.prompt ?? ''),
    ratio: String(row.ratio ?? '9:16'),
    style: String(row.style ?? 'photo-real'),
    provider: String(row.provider ?? 'mock'),
    imagePath: String(row.image_path ?? ''),
    status: String(row.status ?? 'mock') as ImageLabRecord['status'],
    errorMessage: String(row.error_msg ?? ''),
    resolution: String(row.resolution ?? '2K') as ImageLabRecord['resolution'],
    smartMode: String(row.smart_mode ?? 'text-to-image') as ImageLabRecord['smartMode'],
    referenceImagePaths: parseJson(row.reference_image_paths_json, [] as string[]),
    referenceImagePath: String(row.reference_image_path ?? ''),
    upstreamTaskId: row.upstream_task_id ? String(row.upstream_task_id) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

function rowToImageLabSummary(row: Record<string, unknown>): ImageLabSummary {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    promptPreview: String(row.prompt_preview ?? ''),
    ratio: String(row.ratio ?? '9:16'),
    style: String(row.style ?? 'photo-real'),
    provider: String(row.provider ?? 'mock'),
    imagePath: String(row.image_path ?? ''),
    status: String(row.status ?? 'mock') as ImageLabRecord['status'],
    errorMessage: String(row.error_msg ?? ''),
    resolution: String(row.resolution ?? '2K') as ImageLabRecord['resolution'],
    smartMode: String(row.smart_mode ?? 'text-to-image') as ImageLabRecord['smartMode'],
    upstreamTaskId: row.upstream_task_id ? String(row.upstream_task_id) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

function rowToVoiceLabRecord(row: Record<string, unknown>): VoiceLabRecord {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    text: String(row.text ?? ''),
    provider: String(row.provider ?? 'volcengine') as VoiceLabRecord['provider'],
    voiceId: String(row.voice_id ?? ''),
    voiceLabel: String(row.voice_label ?? row.voice_id ?? ''),
    speed: Number(row.speed ?? 1),
    audioPath: String(row.audio_path ?? ''),
    status: String(row.status ?? 'generated') as VoiceLabRecord['status'],
    errorMessage: String(row.error_msg ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

function rowToVoiceLabSummary(row: Record<string, unknown>): VoiceLabSummary {
  return {
    id: String(row.id),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    managedStorageKey: row.managed_storage_key ? String(row.managed_storage_key) : null,
    textPreview: String(row.text_preview ?? ''),
    provider: String(row.provider ?? 'volcengine') as VoiceLabRecord['provider'],
    voiceId: String(row.voice_id ?? ''),
    voiceLabel: String(row.voice_label ?? row.voice_id ?? ''),
    speed: Number(row.speed ?? 1),
    audioPath: String(row.audio_path ?? ''),
    status: String(row.status ?? 'generated') as VoiceLabRecord['status'],
    errorMessage: String(row.error_msg ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

function rowToHistoryTombstone(row: Record<string, unknown>): HistoryTombstone {
  return {
    family: String(row.family) as HistoryFamily,
    id: String(row.entity_id),
    managedStorageKey: row.managed_storage_key === null || row.managed_storage_key === undefined
      ? null
      : String(row.managed_storage_key),
    cleanupState: String(row.cleanup_state ?? 'pending'),
    quarantineName: row.quarantine_name === null || row.quarantine_name === undefined
      ? null
      : String(row.quarantine_name),
    quarantineIdentityJson: String(row.quarantine_identity_json ?? '{}'),
    diagnostic: String(row.diagnostic ?? ''),
    deletedAt: String(row.deleted_at),
  };
}

function rowToCustomStyle(row: Record<string, unknown>): CustomStyle {
  return {
    id: String(row.id),
    name: String(row.name),
    tag: String(row.tag),
    shortName: String(row.short_name),
    prefix: String(row.prefix),
    suffix: String(row.suffix),
    negativePrompt: String(row.negative_prompt),
    allowColor: Number(row.allow_color) === 1,
    description: String(row.description ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToCustomCoverTemplate(row: Record<string, unknown>): CustomCoverTemplate {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    directions: String(row.directions ?? ''),
    compositionRule: String(row.composition_rule ?? ''),
    titleLayout: String(row.title_layout ?? ''),
    subtitleLayout: String(row.subtitle_layout ?? ''),
    plainHint: String(row.plain_hint ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function rowToCreditTransaction(row: Record<string, unknown>): CreditTransaction {
  return {
    id: Number(row.id),
    type: String(row.type),
    amount: Number(row.amount),
    balance: Number(row.balance),
    taskId: row.task_id ? String(row.task_id) : null,
    description: String(row.description ?? ''),
    createdAt: String(row.created_at),
  };
}

function rowToMinimaxCloneVoice(row: Record<string, unknown>): MinimaxCloneVoice {
  return {
    voiceId: String(row.voice_id),
    displayName: String(row.display_name),
    sourceAudioPath: String(row.source_audio_path ?? ''),
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at),
  };
}
