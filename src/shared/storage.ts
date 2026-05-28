import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import type {
  AccountProfile,
  ActivationState,
  AppConfig,
  AppState,
  CreateTaskInput,
  CreditTransaction,
  CustomStyle,
  DraftTemplate,
  ImageLabRecord,
  MinimaxCloneVoice,
  PromptTemplate,
  Task,
  TaskEvent,
  TaskStatus,
  UiPreferences,
} from './types';
import { normalizeAppConfig } from './config-utils';
import {
  defaultAccount,
  defaultActivation,
  defaultConfig,
  defaultCreditTransactions,
  defaultCustomStyles,
  defaultMinimaxCloneVoices,
  defaultPromptTemplates,
  defaultUiPreferences,
} from './config';
import { draftTemplates, normalizeDraftTemplate } from './templates';
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

type PromptTemplateInput = Omit<PromptTemplate, 'description' | 'isBuiltin' | 'updatedAt'> &
  Partial<Pick<PromptTemplate, 'description' | 'isBuiltin' | 'updatedAt'>>;
type ImageLabRecordInput = Partial<Omit<ImageLabRecord, 'createdAt' | 'finishedAt' | 'status'>> &
  Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'> & {
    status?: ImageLabRecord['status'];
    createdAt?: string;
    finishedAt?: string | null;
  };

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

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function writeFileWithRetry(path: string, data: Uint8Array, attempts = 8): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await writeFile(path, data);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'EBUSY' && code !== 'EPERM') || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

function mergeConfig(input: unknown): AppConfig {
  return normalizeAppConfig(input);
}

export class FileDatabase {
  private constructor(
    private readonly file: string,
    private readonly db: Database,
  ) {}

  static async open(file: string): Promise<FileDatabase> {
    const SQL = await loadSql();
    let db: Database;
    try {
      const bytes = await readFile(file);
      db = new SQL.Database(bytes);
    } catch {
      db = new SQL.Database();
    }
    const instance = new FileDatabase(file, db);
    instance.migrate();
    await instance.persist();
    return instance;
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT '',
        input_text TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        current_step INTEGER DEFAULT 0,
        track TEXT DEFAULT 'character-story',
        style TEXT DEFAULT 'photo-real',
        speaker TEXT DEFAULT '灿博小叔',
        ratio TEXT DEFAULT '9:16',
        template_id TEXT DEFAULT 'default-portrait-9-16',
        bgm_id TEXT DEFAULT '__builtin__',
        pause_points TEXT DEFAULT '[]',
        output_dir TEXT DEFAULT '',
        error_message TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        completed_at TEXT,
        started_at TEXT,
        last_heartbeat_at TEXT,
        mode TEXT NOT NULL DEFAULT 'paste',
        ai_keyword TEXT DEFAULT '',
        ai_sources TEXT DEFAULT '[]',
        selected_sources TEXT DEFAULT '[]',
        extra_requirements TEXT DEFAULT '',
        prompt_template_id TEXT,
        prompt_template_type TEXT,
        reference_image_path TEXT DEFAULT '',
        rewrite_intensity TEXT DEFAULT 'standard',
        narrative_pov TEXT DEFAULT 'keep-original',
        keep_promotion INTEGER DEFAULT 0,
        tts_provider TEXT DEFAULT 'volcengine',
        tts_speed REAL DEFAULT 1,
        step3_prompt_snapshot TEXT DEFAULT '',
        failed_step INTEGER,
        retry_from_step INTEGER,
        artifact_state_path TEXT DEFAULT ''
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
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT DEFAULT '',
        content TEXT NOT NULL,
        is_builtin INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL,
        data_json TEXT DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS draft_templates (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        is_builtin INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS image_lab_records (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        ratio TEXT NOT NULL,
        style TEXT NOT NULL,
        provider TEXT NOT NULL,
        image_path TEXT DEFAULT '',
        status TEXT NOT NULL,
        error_msg TEXT DEFAULT '',
        resolution TEXT DEFAULT '2K',
        reference_image_path TEXT DEFAULT '',
        upstream_task_id TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
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
      ['ai_keyword', "TEXT DEFAULT ''"],
      ['ai_sources', "TEXT DEFAULT '[]'"],
      ['selected_sources', "TEXT DEFAULT '[]'"],
      ['extra_requirements', "TEXT DEFAULT ''"],
      ['reference_image_path', "TEXT DEFAULT ''"],
      ['rewrite_intensity', "TEXT DEFAULT 'standard'"],
      ['narrative_pov', "TEXT DEFAULT 'keep-original'"],
      ['keep_promotion', 'INTEGER DEFAULT 0'],
      ['tts_provider', "TEXT DEFAULT 'volcengine'"],
      ['tts_speed', 'REAL DEFAULT 1'],
      ['step3_prompt_snapshot', "TEXT DEFAULT ''"],
      ['failed_step', 'INTEGER'],
      ['retry_from_step', 'INTEGER'],
      ['artifact_state_path', "TEXT DEFAULT ''"],
      ['started_at', 'TEXT'],
      ['last_heartbeat_at', 'TEXT'],
    ] as const) {
      addColumnIfMissing(this.db, 'tasks', column, definition);
    }
    addColumnIfMissing(this.db, 'prompt_templates', 'data_json', "TEXT DEFAULT '{}'");
    for (const [column, definition] of [
      ['error_msg', "TEXT DEFAULT ''"],
      ['resolution', "TEXT DEFAULT '2K'"],
      ['reference_image_path', "TEXT DEFAULT ''"],
      ['upstream_task_id', 'TEXT'],
      ['finished_at', 'TEXT'],
    ] as const) {
      addColumnIfMissing(this.db, 'image_lab_records', column, definition);
    }

    const config = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM config WHERE id = 1');
    if (!config) {
      this.db.run('INSERT INTO config (id, data) VALUES (1, ?)', [json(defaultConfig)]);
    } else {
      this.db.run('UPDATE config SET data = ? WHERE id = 1', [json(mergeConfig(parseJson(config.data, defaultConfig)))]);
    }
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
      WHERE status = 'running'
    `);
  }

  private seedShellDefaults(): void {
    const promptCount = getFirstRow<{ count: number }>(this.db, 'SELECT COUNT(*) AS count FROM prompt_templates')?.count ?? 0;
    if (promptCount === 0) {
      for (const template of defaultPromptTemplates) {
        this.insertPromptTemplate(template);
      }
    }

    const draftCount = getFirstRow<{ count: number }>(this.db, 'SELECT COUNT(*) AS count FROM draft_templates')?.count ?? 0;
    if (draftCount === 0) {
      for (const template of draftTemplates) {
        this.db.run('INSERT INTO draft_templates (id, data, is_builtin, updated_at) VALUES (?, ?, ?, ?)', [
          template.id,
          json(template),
          template.isDefault ? 1 : 0,
          '2026-05-26T00:00:00.000Z',
        ]);
      }
    }

    const styleCount = getFirstRow<{ count: number }>(this.db, 'SELECT COUNT(*) AS count FROM custom_styles')?.count ?? 0;
    if (styleCount === 0) {
      for (const style of defaultCustomStyles) this.insertCustomStyle(style);
    }

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

  private insertPromptTemplate(template: PromptTemplate): void {
    this.db.run(
      `INSERT OR REPLACE INTO prompt_templates (id, name, type, description, content, is_builtin, updated_at, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [template.id, template.name, template.type, template.description, template.content, template.isBuiltin ? 1 : 0, template.updatedAt, json(template)],
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
    await mkdir(dirname(this.file), { recursive: true });
    const data = this.db.export();
    await writeFileWithRetry(this.file, data);
  }

  async close(): Promise<void> {
    await this.persist();
    this.db.close();
  }

  async upsertConfig(config: AppConfig): Promise<void> {
    this.db.run('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)', [json(mergeConfig(config))]);
    await this.persist();
  }

  async upsertPromptTemplate(input: PromptTemplateInput): Promise<PromptTemplate> {
    const template: PromptTemplate = {
      ...input,
      description: input.description ?? '',
      isBuiltin: input.isBuiltin ?? false,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    this.insertPromptTemplate(template);
    await this.persist();
    return template;
  }

  async resetPromptTemplates(): Promise<void> {
    this.db.run('DELETE FROM prompt_templates WHERE is_builtin = 1');
    for (const template of defaultPromptTemplates) this.insertPromptTemplate({ ...template, updatedAt: new Date().toISOString() });
    await this.persist();
  }

  async upsertDraftTemplate(template: DraftTemplate): Promise<DraftTemplate> {
    this.db.run('INSERT OR REPLACE INTO draft_templates (id, data, is_builtin, updated_at) VALUES (?, ?, ?, ?)', [
      template.id,
      json(template),
      template.isDefault ? 1 : 0,
      new Date().toISOString(),
    ]);
    await this.persist();
    return template;
  }

  async addImageLabRecord(input: ImageLabRecordInput): Promise<ImageLabRecord> {
    const now = input.createdAt ?? new Date().toISOString();
    const record: ImageLabRecord = {
      id: input.id ?? randomUUID(),
      prompt: input.prompt,
      ratio: input.ratio,
      style: input.style,
      provider: input.provider,
      imagePath: input.imagePath ?? '',
      status: input.status ?? 'mock',
      errorMessage: input.errorMessage ?? '',
      resolution: input.resolution ?? '2K',
      referenceImagePath: input.referenceImagePath ?? '',
      upstreamTaskId: input.upstreamTaskId ?? null,
      createdAt: now,
      finishedAt: input.finishedAt ?? (input.status === 'generated' ? now : null),
    };
    this.db.run(
      `INSERT INTO image_lab_records
       (id, prompt, ratio, style, provider, image_path, status, error_msg, resolution, reference_image_path, upstream_task_id, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.prompt,
        record.ratio,
        record.style,
        record.provider,
        record.imagePath,
        record.status,
        record.errorMessage,
        record.resolution,
        record.referenceImagePath,
        record.upstreamTaskId,
        record.createdAt,
        record.finishedAt,
      ],
    );
    await this.persist();
    return record;
  }

  async upsertAccount(account: AccountProfile): Promise<void> {
    this.db.run('INSERT OR REPLACE INTO account_profile (id, data) VALUES (1, ?)', [json({ ...defaultAccount, ...account })]);
    await this.persist();
  }

  async upsertActivation(activation: ActivationState): Promise<void> {
    this.db.run('INSERT OR REPLACE INTO activation_state (id, data) VALUES (1, ?)', [json({ ...defaultActivation, ...activation })]);
    await this.persist();
  }

  async upsertUiPreferences(ui: UiPreferences): Promise<void> {
    this.db.run('INSERT OR REPLACE INTO ui_preferences (id, data) VALUES (1, ?)', [json({ ...defaultUiPreferences, ...ui })]);
    await this.persist();
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      title: input.title ?? '',
      inputText: input.inputText,
      status: 'pending',
      currentStep: 0,
      track: input.track ?? 'character-story',
      style: input.style ?? 'photo-real',
      speaker: input.speaker ?? defaultConfig.tts.speaker,
      ratio: input.ratio ?? '9:16',
      templateId: input.templateId ?? 'default-portrait-9-16',
      bgmId: input.bgmId ?? '__builtin__',
      pausePoints: input.pausePoints ?? [],
      outputDir: '',
      errorMessage: '',
      createdAt: now,
      completedAt: null,
      startedAt: null,
      lastHeartbeatAt: null,
      mode: input.mode ?? 'paste',
      aiKeyword: input.aiKeyword ?? '',
      aiSources: input.aiSources ?? ['web'],
      selectedSources: input.selectedSources ?? [],
      extraRequirements: input.extraRequirements ?? '',
      promptTemplateId: input.promptTemplateId ?? null,
      promptTemplateType: input.promptTemplateType ?? null,
      referenceImagePath: input.referenceImagePath ?? '',
      rewriteIntensity: input.rewriteIntensity ?? 'standard',
      narrativePov: input.narrativePov ?? 'keep-original',
      keepPromotion: input.keepPromotion ?? false,
      ttsProvider: input.ttsProvider ?? defaultConfig.tts.provider,
      ttsSpeed: input.ttsSpeed ?? 1,
      step3PromptSnapshot: input.step3PromptSnapshot ?? '',
      failedStep: null,
      retryFromStep: null,
      artifactStatePath: '',
    };
    this.db.run(
      `INSERT INTO tasks (
        id, title, input_text, status, current_step, track, style, speaker, ratio, template_id,
        bgm_id, pause_points, output_dir, error_message, created_at, completed_at, started_at, last_heartbeat_at,
        mode, ai_keyword, ai_sources, selected_sources, extra_requirements, prompt_template_id, prompt_template_type,
        reference_image_path, rewrite_intensity, narrative_pov, keep_promotion, tts_provider,
        tts_speed, step3_prompt_snapshot, failed_step, retry_from_step, artifact_state_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.title,
        task.inputText,
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
        task.referenceImagePath,
        task.rewriteIntensity,
        task.narrativePov,
        task.keepPromotion ? 1 : 0,
        task.ttsProvider,
        task.ttsSpeed,
        task.step3PromptSnapshot,
        task.failedStep,
        task.retryFromStep,
        task.artifactStatePath,
      ],
    );
    await this.persist();
    return task;
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
      startedAt: 'started_at',
      lastHeartbeatAt: 'last_heartbeat_at',
    };
    for (const [key, column] of Object.entries(map)) {
      if (key in patch) {
        sets.push(`${column} = ?`);
        const value = patch[key as keyof typeof patch];
        values.push(value === null || value === undefined ? null : String(value));
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, values);
    await this.persist();
  }

  async addTaskEvent(taskId: string, input: AddEventInput): Promise<TaskEvent> {
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
    this.db.run(
      `INSERT INTO task_events (task_id, type, step, agent, tool, detail, data_json, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.taskId, event.type, event.step, event.agent, event.tool, event.detail, event.dataJson, event.ts],
    );
    const seq = getFirstRow<{ seq: number }>(this.db, 'SELECT last_insert_rowid() AS seq')?.seq;
    await this.persist();
    return { ...event, seq };
  }

  async getState(): Promise<AppState> {
    const configRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM config WHERE id = 1');
    const taskRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM tasks ORDER BY created_at DESC');
    const eventRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM task_events ORDER BY seq ASC');
    const promptRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM prompt_templates ORDER BY is_builtin DESC, updated_at DESC');
    const draftRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM draft_templates ORDER BY is_builtin DESC, id ASC');
    const imageRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM image_lab_records ORDER BY created_at DESC');
    const styleRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM custom_styles ORDER BY name ASC');
    const creditRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM credit_transactions ORDER BY id DESC');
    const voiceRows = getRows<Record<string, unknown>>(this.db, 'SELECT * FROM minimax_clone_voices ORDER BY last_used_at DESC');
    const accountRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM account_profile WHERE id = 1');
    const activationRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM activation_state WHERE id = 1');
    const uiRow = getFirstRow<{ data: string }>(this.db, 'SELECT data FROM ui_preferences WHERE id = 1');
    return {
      config: configRow ? mergeConfig(parseJson(configRow.data, defaultConfig)) : defaultConfig,
      tasks: taskRows.map(rowToTask),
      events: eventRows.map(rowToEvent),
      promptTemplates: promptRows.map(rowToPromptTemplate),
      draftTemplates: draftRows.map(rowToDraftTemplate),
      imageLabRecords: imageRows.map(rowToImageLabRecord),
      customStyles: styleRows.map(rowToCustomStyle),
      creditTransactions: creditRows.map(rowToCreditTransaction),
      minimaxCloneVoices: voiceRows.map(rowToMinimaxCloneVoice),
      account: accountRow ? ({ ...defaultAccount, ...parseJson(accountRow.data, defaultAccount) } as AccountProfile) : defaultAccount,
      activation: activationRow ? ({ ...defaultActivation, ...parseJson(activationRow.data, defaultActivation) } as ActivationState) : defaultActivation,
      ui: uiRow ? ({ ...defaultUiPreferences, ...parseJson(uiRow.data, defaultUiPreferences) } as UiPreferences) : defaultUiPreferences,
    };
  }
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    inputText: String(row.input_text ?? ''),
    status: String(row.status ?? 'pending') as TaskStatus,
    currentStep: Number(row.current_step ?? 0),
    track: String(row.track ?? 'character-story'),
    style: String(row.style ?? 'photo-real'),
    speaker: String(row.speaker ?? '灿博小叔'),
    ratio: String(row.ratio ?? '9:16'),
    templateId: String(row.template_id ?? 'default-portrait-9-16'),
    bgmId: String(row.bgm_id ?? '__builtin__'),
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
    promptTemplateId: row.prompt_template_id ? String(row.prompt_template_id) : null,
    promptTemplateType: row.prompt_template_type ? String(row.prompt_template_type) : null,
    referenceImagePath: String(row.reference_image_path ?? ''),
    rewriteIntensity: String(row.rewrite_intensity ?? 'standard') as Task['rewriteIntensity'],
    narrativePov: String(row.narrative_pov ?? 'keep-original') as Task['narrativePov'],
    keepPromotion: Number(row.keep_promotion ?? 0) === 1,
    ttsProvider: String(row.tts_provider ?? 'volcengine') as Task['ttsProvider'],
    ttsSpeed: Number(row.tts_speed ?? 1),
    step3PromptSnapshot: String(row.step3_prompt_snapshot ?? ''),
    failedStep: row.failed_step === null || row.failed_step === undefined ? null : Number(row.failed_step),
    retryFromStep: row.retry_from_step === null || row.retry_from_step === undefined ? null : Number(row.retry_from_step),
    artifactStatePath: String(row.artifact_state_path ?? ''),
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

function rowToPromptTemplate(row: Record<string, unknown>): PromptTemplate {
  const stored = parseJson<Partial<PromptTemplate>>(row.data_json, {});
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    type: String(row.type ?? 'rewrite') as PromptTemplate['type'],
    description: String(row.description ?? ''),
    content: String(row.content ?? ''),
    isBuiltin: Number(row.is_builtin ?? 0) === 1,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    ...stored,
  };
}

function rowToDraftTemplate(row: Record<string, unknown>): DraftTemplate {
  return normalizeDraftTemplate(parseJson(String(row.data), draftTemplates[0]));
}

function rowToImageLabRecord(row: Record<string, unknown>): ImageLabRecord {
  return {
    id: String(row.id),
    prompt: String(row.prompt ?? ''),
    ratio: String(row.ratio ?? '9:16'),
    style: String(row.style ?? 'photo-real'),
    provider: String(row.provider ?? 'mock'),
    imagePath: String(row.image_path ?? ''),
    status: String(row.status ?? 'mock') as ImageLabRecord['status'],
    errorMessage: String(row.error_msg ?? ''),
    resolution: String(row.resolution ?? '2K') as ImageLabRecord['resolution'],
    referenceImagePath: String(row.reference_image_path ?? ''),
    upstreamTaskId: row.upstream_task_id ? String(row.upstream_task_id) : null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
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
