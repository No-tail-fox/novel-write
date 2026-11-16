import { createHash, randomUUID } from 'node:crypto';
import type { Database, SqlValue } from 'sql.js';
import { parseMotionComicPipelineData, type MotionComicPipelineData } from './motion-comic';
import { assertMotionComicScriptAssets, confirmMotionComicScriptAssets, motionComicScriptAssetIds } from './motion-comic-script-assets';
import { motionComicScriptDraftSchema, splitMotionComicSource, validateMotionComicScriptDraft, collectMotionComicPlanAdjustments, plannedMotionComicSourceEpisodeIds } from './motion-comic-planning';
import {
  MOTION_COMIC_SCRIPT_PROMPT_VERSION, assertMotionComicScriptTransition,
  motionComicScriptTaskSchema, motionComicScriptCandidateSchema, motionComicScriptApprovalSchema,
  motionComicScriptEnqueueSchema, motionComicScriptEditSchema, motionComicScriptApproveSchema,
  type MotionComicScriptTask, type MotionComicScriptSnapshot, type MotionComicScriptCandidate,
  type MotionComicScriptApproval, type MotionComicScriptEnqueueInput, type MotionComicScriptEditInput,
  type MotionComicScriptApproveInput, type MotionComicScriptStatus,
  motionComicScriptRevisionSchema, motionComicScriptStoryboardCandidateSchema,
  type MotionComicScriptRevisionInput, type MotionComicScriptStoryboard,
} from './motion-comic-script-batch';

import { applyMotionComicScriptProposal, motionComicScriptProposalSchema, motionComicScriptOriginalSchema, motionComicScriptProposeSchema, motionComicScriptAdoptSchema, motionComicScriptRevertSchema, type MotionComicScriptRevertInput, type MotionComicScriptProposal, type MotionComicScriptProposeInput, type MotionComicScriptAdoptInput } from './motion-comic-script-proposal';

import { motionComicAssetExtractSchema, motionComicAssetExtractionApplySchema, motionComicAssetExtractionCandidateSchema, validateAssetExtractionOutput, applyAssetExtractionSelections, type MotionComicAssetExtractInput, type MotionComicAssetExtractionApplyInput, type MotionComicAssetExtractionCandidate } from './motion-comic-asset-extraction';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const active = new Set<MotionComicScriptStatus>(['queued', 'running', 'script-ready', 'review', 'approved']);

/** Separate script artifacts and durable jobs; never writes shots or media. */
export class MotionComicScriptStore {
  onChange?: (projectId: string) => void;

  constructor(private readonly database: () => Database, private readonly commit: <T>(mutation: () => T) => Promise<T>, private readonly waitForWrites: () => Promise<void> = async () => {}) {}

  private async commitProject<T>(id: string, mutation: () => T): Promise<T> {
    const result = await this.commit(mutation);
    this.onChange?.(id);
    return result;
  }

  static migrate(db: Database): void {
    db.run(`CREATE TABLE IF NOT EXISTS motion_comic_script_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_comic_script_project ON motion_comic_script_tasks(project_id);
      CREATE TABLE IF NOT EXISTS motion_comic_script_candidates (task_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS motion_comic_script_approvals (project_id TEXT NOT NULL, source_episode_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id, source_episode_id));
      CREATE TABLE IF NOT EXISTS motion_comic_script_controls (project_id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0);`);
    db.run('CREATE TABLE IF NOT EXISTS motion_comic_script_storyboards (task_id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    db.run(`CREATE TABLE IF NOT EXISTS motion_comic_script_originals (task_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS motion_comic_script_proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, request_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(project_id, request_id));
      CREATE INDEX IF NOT EXISTS idx_comic_proposals_project ON motion_comic_script_proposals(project_id);`);
    db.run('CREATE TABLE IF NOT EXISTS motion_comic_asset_extractions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(project_id, request_id))');
    const store = new MotionComicScriptStore(() => db, async (mutation) => mutation());
    for (const row of store.rows('SELECT data FROM motion_comic_asset_extractions')) {
      const candidate = motionComicAssetExtractionCandidateSchema.parse(JSON.parse(String(row.data)));
      if (candidate.status === 'running') store.putAssetExtraction({ ...candidate, status: 'unknown', dispatchState: 'unknown', error: '上次请求执行结果未知；没有可查询回执，不会自动重放。', updatedAt: now() });
    }
    for (const row of store.rows('SELECT data FROM motion_comic_script_proposals')) {
      const proposal = motionComicScriptProposalSchema.parse(JSON.parse(String(row.data)));
      if (proposal.status === 'running') store.putProposal({ ...proposal, status: 'failed', error: '上次执行中断；不会自动重提，请使用新请求生成。' });
    }
    for (const row of store.rows('SELECT data FROM motion_comic_script_tasks')) {
      const task = motionComicScriptTaskSchema.parse(JSON.parse(String(row.data)));
      if (task.status === 'running') store.putTask({ ...task, status: 'queued', error: '上次执行中断，等待后台恢复。', updatedAt: now() });
      else if (task.storyboardStatus === 'running') store.putTask({ ...task, storyboardStatus: 'failed', storyboardError: '上次分镜生成中断，可重试；已批准剧本保留。', updatedAt: now() });
    }
  }

  private rows(sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
    const stmt = this.database().prepare(sql);
    try { stmt.bind(params); const rows: Record<string, SqlValue>[] = []; while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }
    finally { stmt.free(); }
  }

  private project(id: string): MotionComicPipelineData {
    const row = this.rows('SELECT task_type, status, archived_at, pipeline_data FROM tasks WHERE id = ?', [id])[0];
    if (!row || row.task_type !== 'motion-comic') throw new Error('MOTION_COMIC_NOT_FOUND: 项目不存在。');
    if (row.archived_at) throw new Error('HISTORY_ARCHIVED: 已归档项目只读。');
    if (row.status === 'running' || row.status === 'pending') throw new Error('MOTION_COMIC_ACTIVE: 项目正在运行。');
    return parseMotionComicPipelineData(String(row.pipeline_data));
  }

  async readProject(id: string): Promise<MotionComicPipelineData> { await this.waitForWrites(); return this.project(id); }

  async snapshot(id: string): Promise<MotionComicScriptSnapshot> { await this.waitForWrites(); return this.snapshotNow(id); }

  private snapshotNow(id: string): MotionComicScriptSnapshot {
    this.project(id);
    return {
      assetExtractions: this.rows('SELECT data FROM motion_comic_asset_extractions WHERE project_id = ? ORDER BY rowid', [id]).map(row => motionComicAssetExtractionCandidateSchema.parse(JSON.parse(String(row.data)))),
      originals: this.rows('SELECT c.data FROM motion_comic_script_originals c JOIN motion_comic_script_tasks t ON t.id = c.task_id WHERE t.project_id = ?', [id]).map(row => motionComicScriptOriginalSchema.parse(JSON.parse(String(row.data)))),
      proposals: this.rows('SELECT data FROM motion_comic_script_proposals WHERE project_id = ? ORDER BY rowid', [id]).map(row => motionComicScriptProposalSchema.parse(JSON.parse(String(row.data)))),
      projectId: id, paused: Boolean(this.rows('SELECT paused FROM motion_comic_script_controls WHERE project_id = ?', [id])[0]?.paused),
      tasks: this.rows('SELECT data FROM motion_comic_script_tasks WHERE project_id = ? ORDER BY rowid', [id]).map((row) => motionComicScriptTaskSchema.parse(JSON.parse(String(row.data)))),
      candidates: this.rows('SELECT c.data FROM motion_comic_script_candidates c JOIN motion_comic_script_tasks t ON t.id = c.task_id WHERE t.project_id = ?', [id]).map((row) => motionComicScriptCandidateSchema.parse(JSON.parse(String(row.data)))),
      approvals: this.rows('SELECT data FROM motion_comic_script_approvals WHERE project_id = ?', [id]).map((row) => motionComicScriptApprovalSchema.parse(JSON.parse(String(row.data)))),
      storyboards: this.rows('SELECT c.data FROM motion_comic_script_storyboards c JOIN motion_comic_script_tasks t ON t.id = c.task_id WHERE t.project_id = ?', [id]).map((row) => motionComicScriptStoryboardCandidateSchema.parse(JSON.parse(String(row.data)))),
    };
  }

  private putAssetExtraction(value: MotionComicAssetExtractionCandidate): void {
    const item = motionComicAssetExtractionCandidateSchema.parse(value);
    this.database().run('INSERT INTO motion_comic_asset_extractions(id, project_id, request_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', [item.id, item.projectId, item.requestId, JSON.stringify(item)]);
  }

  private assetExtractionContext(document: MotionComicPipelineData, sourceEpisodeId: string) {
    const source = document.sourceDocument?.episodes.find(item => item.id === sourceEpisodeId);
    if (!source?.sourceText.trim()) throw new Error('ASSET_EXTRACTION_SOURCE_REQUIRED');
    const definitions = {
      characters: document.characters.map(item => ({ id: item.id, name: item.name, aliases: item.aliases, role: item.role, identityPrompt: item.identityPrompt, personality: item.personality, voiceNotes: item.voiceNotes, looks: item.looks.map(look => ({ id: look.id, label: look.label, appearancePrompt: look.appearancePrompt, wardrobe: look.wardrobe, continuityNotes: look.continuityNotes })) })),
      sceneAssets: document.sceneAssets.map(item => ({ id: item.id, label: item.label, description: item.description, prompt: item.prompt, continuityNotes: item.continuityNotes })),
      props: document.props.map(item => ({ id: item.id, label: item.label, description: item.description, prompt: item.prompt })),
    };
    return { sourceText: source.sourceText, definitions, sourceFingerprint: hash(source), projectFingerprint: hash(definitions) };
  }

  beginAssetExtraction(raw: MotionComicAssetExtractInput, config: { provider: string; model: string }) {
    const input = motionComicAssetExtractSchema.parse(raw);
    return this.commitProject(input.id, () => {
      const document = this.project(input.id);
      const requestFingerprint = hash(input);
      const previous = this.snapshotNow(input.id).assetExtractions?.find(item => item.requestId === input.requestId);
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) throw new Error('ASSET_EXTRACTION_REQUEST_CONFLICT');
        return { claimed: false as const, candidate: previous };
      }
      if (document.updatedAt !== input.expectedUpdatedAt) throw new Error('MOTION_COMIC_STALE_WRITE');
      if (this.snapshotNow(input.id).tasks.some(task => task.status === 'running' || task.status === 'queued' || task.storyboardStatus === 'running')) throw new Error('ASSET_EXTRACTION_PROJECT_BUSY');
      const context = this.assetExtractionContext(document, input.sourceEpisodeId);
      const candidate: MotionComicAssetExtractionCandidate = { id: randomUUID(), projectId: input.id, sourceEpisodeId: input.sourceEpisodeId, category: input.category, requestId: input.requestId, requestFingerprint,
        sourceFingerprint: context.sourceFingerprint, projectFingerprint: context.projectFingerprint,
        inputFingerprint: hash({ source: context.sourceFingerprint, project: context.projectFingerprint, category: input.category, ...config, prompt: 'category-v1' }),
        revision: 1, status: 'running', dispatchState: 'prepared', provider: config.provider, model: config.model, createdAt: now(), updatedAt: now() };
      this.putAssetExtraction(candidate);
      return { claimed: true as const, candidate, context };
    });
  }

  markAssetExtractionDispatched(id: string, candidateId: string) {
    return this.commitProject(id, () => {
      const candidate = this.snapshotNow(id).assetExtractions?.find(item => item.id === candidateId);
      if (!candidate || candidate.status !== 'running' || candidate.dispatchState !== 'prepared') throw new Error('ASSET_EXTRACTION_NOT_DISPATCHABLE');
      this.putAssetExtraction({ ...candidate, dispatchState: 'dispatched', updatedAt: now() });
    });
  }

  finishAssetExtraction(id: string, candidateId: string, output?: unknown, error?: string, unknown = false) {
    return this.commitProject(id, () => {
      const candidate = this.snapshotNow(id).assetExtractions?.find(item => item.id === candidateId);
      if (!candidate || candidate.status !== 'running') return this.snapshotNow(id);
      if (error) this.putAssetExtraction({ ...candidate, ...(output === undefined ? {} : { output: validateAssetExtractionOutput(candidate.category, output) }), status: unknown ? 'unknown' : 'failed', dispatchState: unknown ? 'unknown' : 'settled', error: error.slice(0, 8000), updatedAt: now() });
      else {
        const parsed = validateAssetExtractionOutput(candidate.category, output);
        let stale = true;
        try {
          const context = this.assetExtractionContext(this.project(id), candidate.sourceEpisodeId);
          stale = context.sourceFingerprint !== candidate.sourceFingerprint || context.projectFingerprint !== candidate.projectFingerprint;
        } catch { /* A removed source retains the response as stale evidence. */ }
        this.putAssetExtraction({ ...candidate, output: parsed, status: stale ? 'stale' : 'ready', dispatchState: 'settled', updatedAt: now() });
      }
      return this.snapshotNow(id);
    });
  }

  applyAssetExtraction(raw: MotionComicAssetExtractionApplyInput) {
    const input = motionComicAssetExtractionApplySchema.parse(raw);
    return this.commitProject(input.id, () => {
      const candidate = this.snapshotNow(input.id).assetExtractions?.find(item => item.id === input.candidateId);
      if (!candidate || candidate.revision !== input.revision || candidate.inputFingerprint !== input.inputFingerprint) throw new Error('ASSET_EXTRACTION_REVISION');
      if (candidate.status === 'applied') return this.snapshotNow(input.id);
      if (candidate.status !== 'ready') throw new Error('ASSET_EXTRACTION_NOT_READY');
      if (this.snapshotNow(input.id).tasks.some(task => task.status === 'running' || task.status === 'queued' || task.storyboardStatus === 'running')) throw new Error('ASSET_EXTRACTION_PROJECT_BUSY');
      const document = this.project(input.id);
      if (document.updatedAt !== input.expectedUpdatedAt) throw new Error('MOTION_COMIC_STALE_WRITE');
      let inputChanged = true;
      try {
        const context = this.assetExtractionContext(document, candidate.sourceEpisodeId);
        inputChanged = context.sourceFingerprint !== candidate.sourceFingerprint || context.projectFingerprint !== candidate.projectFingerprint;
      } catch { /* Missing source invalidates the candidate without modifying the project. */ }
      if (inputChanged) {
        this.putAssetExtraction({ ...candidate, status: 'stale', error: 'ASSET_EXTRACTION_INPUT_CHANGED: 源分集或项目资产定义已变化，请重新提取候选。', updatedAt: now() });
        return this.snapshotNow(input.id);
      }
      const next = applyAssetExtractionSelections(document, candidate, input.selections, randomUUID);
      next.updatedAt = new Date(Math.max(Date.now(), Date.parse(document.updatedAt) + 1)).toISOString();
      this.database().run('UPDATE tasks SET pipeline_data = ? WHERE id = ?', [JSON.stringify(next), input.id]);
      this.putAssetExtraction({ ...candidate, status: 'applied', updatedAt: now() });
      return this.snapshotNow(input.id);
    });
  }

  async pendingProjects(): Promise<string[]> {
    await this.waitForWrites();
    return [...new Set(this.rows(`SELECT s.project_id, s.data FROM motion_comic_script_tasks s JOIN tasks t ON t.id = s.project_id
      WHERE t.archived_at IS NULL AND t.status NOT IN ('running', 'pending')`).filter((row) => JSON.parse(String(row.data)).status === 'queued').map((row) => String(row.project_id)))];
  }

  private putTask(task: MotionComicScriptTask): void {
    const parsed = motionComicScriptTaskSchema.parse(task);
    this.database().run('INSERT INTO motion_comic_script_tasks(id, project_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', [parsed.id, parsed.projectId, JSON.stringify(parsed)]);
  }

  private putCandidate(candidate: MotionComicScriptCandidate): void {
    const parsed = motionComicScriptCandidateSchema.parse(candidate);
    this.database().run('INSERT OR REPLACE INTO motion_comic_script_candidates(task_id, data) VALUES (?, ?)', [parsed.taskId, JSON.stringify(parsed)]);
  }

  dependencies(document: MotionComicPipelineData, task: MotionComicScriptTask, snapshot = this.snapshotNow(document.id)) {
    const episodes = document.sourceDocument?.episodes ?? [];
    const index = episodes.findIndex((episode) => episode.id === task.sourceEpisodeId);
    if (index < 0) throw new Error('MOTION_COMIC_SCRIPT_SOURCE: 源分集已不存在。');
    const preceding = new Set(episodes.slice(0, index).map((episode) => episode.id));
    const prior = episodes.slice(0, index).flatMap((episode) => {
      const latest = snapshot.tasks.filter((item) => item.sourceEpisodeId === episode.id).at(-1);
      const candidate = latest && snapshot.candidates.find((item) => item.taskId === latest.id);
      return candidate && latest && !candidate.issues.length && ['script-ready', 'review', 'approved'].includes(latest.status)
        ? [{ sourceEpisodeId: episode.id, taskId: latest.id, revision: candidate.outputRevision, script: candidate.script }] : [];
    });
    const previousStateVersion = hash(prior.map(({ sourceEpisodeId, taskId, revision }) => ({ sourceEpisodeId, taskId, revision })));
    // Bind the existing creative assets, not reference images or assets appended by storyboard import.
    const ids = task.bibleAssetIds ?? this.bibleAssetIds(document);
    const { characterIds: _characters, sceneAssetIds: _scenes, propAssetIds: _props, ...series } = document.series;
    const seriesBibleVersion = hash({ series,
      characters: document.characters.filter((item) => ids.characters.includes(item.id)).map(({ voiceProvider: _provider, voiceId: _voice, voiceSpeed: _speed, voiceSampleAssetVersionId: _sample, looks, ...character }) => ({ ...character, looks: looks.filter((look) => !ids.looks || ids.looks.includes(look.id)).map(({ referenceAssetVersionIds: _refs, pinned: _pinned, ...look }) => look) })),
      sceneAssets: document.sceneAssets.filter((item) => ids.sceneAssets.includes(item.id)).map(({ referenceAssetVersionIds: _refs, ...item }) => item),
      props: document.props.filter((item) => ids.props.includes(item.id)).map(({ referenceAssetVersionIds: _refs, ...item }) => item) });
    const inputFingerprint = hash({ source: episodes[index], seriesBibleVersion, previousStateVersion,
      instructions: task.instructions, duration: task.targetDurationSec, provider: task.provider, model: task.model, prompt: task.promptVersion });
    return { inputFingerprint, seriesBibleVersion, previousStateVersion, prior, preceding };
  }

  enqueue(raw: MotionComicScriptEnqueueInput, config: { provider: string; model: string }): Promise<MotionComicScriptSnapshot> {
    const input = motionComicScriptEnqueueSchema.parse(raw);
    return this.commitProject(input.id, () => {
      const document = this.project(input.id);
      if (document.updatedAt !== input.expectedUpdatedAt) throw new Error('MOTION_COMIC_STALE_WRITE: 项目已变化，请保存后重试。');
      this.invalidate(input.id);
      const snapshot = this.snapshotNow(input.id);
      const episodes = document.sourceDocument?.episodes ?? [];
      if (!episodes.length) throw new Error('MOTION_COMIC_SCRIPT_SOURCE: 请先导入并保存源分集。');
      if (input.sourceEpisodeIds?.some((id) => !episodes.some((episode) => episode.id === id))) throw new Error('MOTION_COMIC_SCRIPT_SOURCE: 包含无效源分集。');
      for (const episode of episodes) {
        if (input.scope === 'selected' && !input.sourceEpisodeIds?.includes(episode.id)) continue;
        const latest = snapshot.tasks.filter((task) => task.sourceEpisodeId === episode.id).at(-1);
        if (latest && active.has(latest.status)) continue;
        if (snapshot.approvals.some((approval) => approval.sourceEpisodeId === episode.id && !approval.stale)) continue;
        if (plannedMotionComicSourceEpisodeIds(document).has(episode.id)) continue;
        if (input.scope === 'failed' && latest?.status !== 'failed') continue;
        const task: MotionComicScriptTask = { id: randomUUID(), projectId: input.id, sourceEpisodeId: episode.id, status: 'queued',
          inputFingerprint: 'pending', seriesBibleVersion: 'pending', previousStateVersion: 'pending',
          provider: config.provider, model: config.model, promptVersion: MOTION_COMIC_SCRIPT_PROMPT_VERSION,
          bibleAssetIds: this.bibleAssetIds(document),
          instructions: input.instructions, targetDurationSec: input.targetDurationSec, outputRevision: 0, attempt: 0,
          progress: 0, checkpoint: 'source', createdAt: now(), updatedAt: now() };
        this.putTask({ ...task, ...this.fingerprint(document, task) });
      }
      return this.snapshotNow(input.id);
    });
  }

  private fingerprint(document: MotionComicPipelineData, task: MotionComicScriptTask) {
    const { inputFingerprint, seriesBibleVersion, previousStateVersion } = this.dependencies(document, task);
    return { inputFingerprint, seriesBibleVersion, previousStateVersion };
  }

  private bibleAssetIds(document: MotionComicPipelineData) {
    return { characters: document.characters.map((item) => item.id), looks: document.characters.flatMap((item) => item.looks.map((look) => look.id)), sceneAssets: document.sceneAssets.map((item) => item.id), props: document.props.map((item) => item.id) };
  }

  claim(id: string): Promise<MotionComicScriptTask | null> {
    return this.commitProject(id, () => {
      const document = this.project(id);
      this.invalidate(id);
      const snapshot = this.snapshotNow(id);
      if (snapshot.paused) return null;
      if (snapshot.tasks.some((item) => item.status === 'running')) return null;
      const order = document.sourceDocument?.episodes.map((item) => item.id) ?? [];
      for (const item of snapshot.tasks.filter((item) => item.status === 'queued' && !order.includes(item.sourceEpisodeId))) {
        this.putTask({ ...item, status: 'stale', error: '源分集已删除。', updatedAt: now() });
      }
      const task = snapshot.tasks.filter((item) => item.status === 'queued' && order.includes(item.sourceEpisodeId)).sort((a, b) => order.indexOf(a.sourceEpisodeId) - order.indexOf(b.sourceEpisodeId))[0];
      if (!task) return null;
      const bound = { ...task, bibleAssetIds: this.bibleAssetIds(document) };
      const running = { ...bound, ...this.fingerprint(document, bound), status: 'running' as const, progress: 15, attempt: task.attempt + 1, updatedAt: now(), error: undefined };
      this.putTask(running);
      return running;
    });
  }

  finish(task: MotionComicScriptTask, result: { script: MotionComicScriptCandidate['script']; adjustments: MotionComicScriptCandidate['adjustments']; issues: MotionComicScriptCandidate['issues'] }): Promise<void> {
    return this.commitProject(task.projectId, () => {
      const document = this.project(task.projectId);
      const current = this.snapshotNow(task.projectId).tasks.find((item) => item.id === task.id);
      if (!current || current.status !== 'running' || current.attempt !== task.attempt) return;
      if (this.dependencies(document, task).inputFingerprint !== task.inputFingerprint) {
        this.putTask({ ...current, status: 'stale', error: '生成期间输入或前情发生变化，请重新提交。', updatedAt: now() }); return;
      }
      const revision = current.outputRevision + 1;
      const original = motionComicScriptOriginalSchema.parse({ taskId: current.id, outputRevision: revision, script: result.script, createdAt: now(), provenance: 'first-model-finish' });
      this.database().run('INSERT OR IGNORE INTO motion_comic_script_originals(task_id, data) VALUES (?, ?)', [current.id, JSON.stringify(original)]);
      this.putCandidate({ script: result.script, adjustments: result.adjustments, issues: result.issues, taskId: current.id, outputRevision: revision, origin: 'model', createdAt: now() });
      this.putTask({ ...current, outputRevision: revision, status: result.issues.length ? 'review' : 'script-ready', progress: 100, checkpoint: 'validate', updatedAt: now() });
      this.invalidate(task.projectId);
    });
  }

  fail(task: MotionComicScriptTask, error: string, interrupted = false): Promise<void> {
    return this.commitProject(task.projectId, () => {
      const row = this.rows('SELECT data FROM motion_comic_script_tasks WHERE id = ? AND project_id = ?', [task.id, task.projectId])[0];
      const current = row && motionComicScriptTaskSchema.parse(JSON.parse(String(row.data)));
      if (current?.status === 'running' && current.attempt === task.attempt) this.putTask({ ...current, status: interrupted ? 'queued' : 'failed', error: error.slice(0, 8000), updatedAt: now() });
    });
  }

  control(id: string, action: 'pause' | 'resume' | 'cancel', taskId?: string): Promise<MotionComicScriptSnapshot> {
    return this.commitProject(id, () => {
      const snapshot = this.snapshotNow(id);
      if (action === 'cancel') {
        const task = snapshot.tasks.find((item) => item.id === taskId);
        if (!task) throw new Error('MOTION_COMIC_SCRIPT_NOT_FOUND');
        assertMotionComicScriptTransition(task.status, 'cancelled');
        this.putTask({ ...task, status: 'cancelled', updatedAt: now() });
      } else this.database().run('INSERT OR REPLACE INTO motion_comic_script_controls(project_id, paused) VALUES (?, ?)', [id, action === 'pause' ? 1 : 0]);
      this.invalidate(id);
      return this.snapshotNow(id);
    });
  }

  edit(raw: MotionComicScriptEditInput): Promise<MotionComicScriptSnapshot> {
    const input = motionComicScriptEditSchema.parse(raw);
    return this.commitProject(input.id, () => {
      const document = this.project(input.id);
      if (document.updatedAt !== input.expectedUpdatedAt) throw new Error('MOTION_COMIC_STALE_WRITE');
      this.invalidate(input.id);
      const snapshot = this.snapshotNow(input.id);
      const task = snapshot.tasks.find((item) => item.id === input.taskId);
      const candidate = snapshot.candidates.find((item) => item.taskId === input.taskId);
      const legacyApproval = task?.status === 'approved' && snapshot.approvals.some((item) => item.taskId === task.id && !item.assetsConfirmedAt);
      if (!task || !candidate || task.outputRevision !== input.outputRevision || (!['script-ready', 'review'].includes(task.status) && !legacyApproval)) throw new Error('MOTION_COMIC_SCRIPT_REVISION: 剧本版本已变化。');
      const source = document.sourceDocument!.episodes.find((item) => item.id === task.sourceEpisodeId)!;
      const issues = validateMotionComicScriptDraft(input.script, splitMotionComicSource(source.sourceText), document, task.instructions);
      this.putCandidate({ ...candidate, script: input.script, outputRevision: candidate.outputRevision + 1, issues, origin: 'human', createdAt: now(),
        adjustments: [...candidate.adjustments, ...collectMotionComicPlanAdjustments(candidate.script, input.script, 'script').map((item) => ({ ...item, kind: 'manual' as const }))] });
      this.putTask({ ...task, status: 'review', outputRevision: candidate.outputRevision + 1, updatedAt: now() });
      if (legacyApproval) this.database().run('DELETE FROM motion_comic_script_storyboards WHERE task_id = ?', [task.id]);
      this.invalidate(input.id);
      return this.snapshotNow(input.id);
    });
  }

  private putProposal(value: MotionComicScriptProposal): void {
    const p = motionComicScriptProposalSchema.parse(value);
    this.database().run('INSERT INTO motion_comic_script_proposals(id, project_id, task_id, request_id, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', [p.id, p.projectId, p.taskId, p.requestId, JSON.stringify(p)]);
  }

  private proposalBaseline(input: { id: string; taskId: string; outputRevision: number; expectedUpdatedAt: string }) {
    const document = this.project(input.id);
    if (document.updatedAt !== input.expectedUpdatedAt) throw new Error('MOTION_COMIC_STALE_WRITE: 项目已变化。');
    const snapshot = this.snapshotNow(input.id);
    const task = snapshot.tasks.find(t => t.id === input.taskId);
    const candidate = snapshot.candidates.find(c => c.taskId === input.taskId);
    const approval = snapshot.approvals.find(a => a.taskId === input.taskId);
    if (!task || !candidate || task.outputRevision !== input.outputRevision || candidate.outputRevision !== input.outputRevision
      || (!['script-ready', 'review'].includes(task.status) && !(task.status === 'approved' && approval && !approval.assetsConfirmedAt))
      || this.dependencies(document, task, snapshot).inputFingerprint !== task.inputFingerprint) throw new Error('SCRIPT_PROPOSAL_STALE: 剧本基准已变化。');
    if (approval?.assetsConfirmedAt || plannedMotionComicSourceEpisodeIds(document).has(task.sourceEpisodeId)) throw new Error('MOTION_COMIC_SCRIPT_PROTECTED: 已确认资产或已进入制作的剧本不可修改。');
    return { document, snapshot, task, candidate };
  }

  beginProposal(raw: MotionComicScriptProposeInput, config: { provider: string; model: string }) {
    const input = motionComicScriptProposeSchema.parse(raw);
    return this.commitProject(input.id, () => {
      const existing = this.snapshotNow(input.id).proposals!.find(p => p.requestId === input.requestId);
      if (existing) {
        if (existing.requestFingerprint !== hash(input)) throw new Error('SCRIPT_PROPOSAL_REQUEST_CONFLICT: 请求编号已用于不同参数。');
        return { proposal: existing, claimed: false, script: undefined };
      }
      const { task, candidate } = this.proposalBaseline(input);
      const scenes = candidate.script.scenes.filter(s => s.key === input.sceneKey);
      const beats = scenes.flatMap(s => s.beats.filter(b => b.key === input.beatKey));
      if (scenes.length !== 1 || beats.length !== 1) throw new Error('SCRIPT_PROPOSAL_TARGET_CHANGED: 目标必须是唯一稳定段落。');
      const proposal = motionComicScriptProposalSchema.parse({ id: randomUUID(), projectId: input.id, taskId: task.id,
        baseRevision: input.outputRevision, inputFingerprint: task.inputFingerprint, baseProjectUpdatedAt: input.expectedUpdatedAt,
        baseScriptHash: hash(candidate.script), sceneKey: input.sceneKey, beatKey: input.beatKey, originalText: beats[0].text,
        instruction: input.instruction, requestId: input.requestId, requestFingerprint: hash(input), status: 'running',
        provider: config.provider, model: config.model, promptVersion: 'single-beat-text-v1', createdAt: now() });
      this.putProposal(proposal);
      return { proposal, claimed: true, script: structuredClone(candidate.script) };
    });
  }

  finishProposal(projectId: string, proposalId: string, proposedText?: string, error?: string): Promise<MotionComicScriptSnapshot> {
    return this.commitProject(projectId, () => {
      const p = this.snapshotNow(projectId).proposals!.find(p => p.id === proposalId);
      if (!p || (p.status !== 'running' && !(p.status === 'stale' && p.proposedText === undefined && p.error === undefined))) return this.snapshotNow(projectId);
      let next: MotionComicScriptProposal = { ...p, proposedText, status: error ? 'failed' : 'ready', error: error?.slice(0, 8000) };
      try {
        const { document, task, candidate } = this.proposalBaseline({ id: projectId, taskId: p.taskId, outputRevision: p.baseRevision, expectedUpdatedAt: p.baseProjectUpdatedAt });
        if (hash(candidate.script) !== p.baseScriptHash || task.inputFingerprint !== p.inputFingerprint) throw new Error('SCRIPT_PROPOSAL_STALE');
        if (!error) {
          const script = applyMotionComicScriptProposal(candidate.script, next, { projectId, taskId: task.id, revision: task.outputRevision, inputFingerprint: task.inputFingerprint });
          const source = document.sourceDocument!.episodes.find(s => s.id === task.sourceEpisodeId)!;
          if (validateMotionComicScriptDraft(script, splitMotionComicSource(source.sourceText), document, task.instructions).length) next = { ...next, status: 'failed', error: 'MOTION_COMIC_SCRIPT_INVALID: 修改后的剧本未通过校验。' };
        }
      } catch (failure) {
        next = { ...next, status: 'stale', error: failure instanceof Error ? failure.message.slice(0, 8000) : 'SCRIPT_PROPOSAL_STALE' };
      }
      this.putProposal(next);
      return this.snapshotNow(projectId);
    });
  }

  adoptProposal(raw: MotionComicScriptAdoptInput): Promise<MotionComicScriptSnapshot> {
    const input = motionComicScriptAdoptSchema.parse(raw);
    return this.commitProject(input.id, () => {
      const { document, snapshot, task, candidate } = this.proposalBaseline(input);
      const p = snapshot.proposals!.find(p => p.id === input.proposalId);
      if (!p || p.baseProjectUpdatedAt !== input.expectedUpdatedAt || hash(candidate.script) !== p.baseScriptHash) throw new Error('SCRIPT_PROPOSAL_STALE: 候选基准已变化。');
      const script = applyMotionComicScriptProposal(candidate.script, p, { projectId: input.id, taskId: task.id, revision: task.outputRevision, inputFingerprint: task.inputFingerprint });
      const source = document.sourceDocument!.episodes.find(s => s.id === task.sourceEpisodeId)!;
      const issues = validateMotionComicScriptDraft(script, splitMotionComicSource(source.sourceText), document, task.instructions);
      if (issues.length) throw new Error('MOTION_COMIC_SCRIPT_INVALID: 修改后的剧本未通过校验。');
      const revision = task.outputRevision + 1;
      // origin=human means an explicit user adoption; AI provenance is retained in the proposal ledger.
      this.putCandidate({ ...candidate, script, issues, outputRevision: revision, origin: 'human', createdAt: now() });
      this.putTask({ ...task, outputRevision: revision, status: 'review', updatedAt: now() });
      this.putProposal({ ...p, status: 'applied', appliedRevision: revision, appliedScriptHash: hash(script) });
      this.invalidateProposalChange(input.id, snapshot, task, p, p.baseRevision);
      return this.snapshotNow(input.id);
    });
  }

  private invalidateProposalChange(id: string, snapshot: MotionComicScriptSnapshot, task: MotionComicScriptTask, proposal: MotionComicScriptProposal, baseRevision: number): void {
    const approval = snapshot.approvals.find(a => a.taskId === task.id);
    if (approval) this.database().run('UPDATE motion_comic_script_approvals SET data = ? WHERE project_id = ? AND source_episode_id = ?', [JSON.stringify({ ...approval, stale: true }), id, task.sourceEpisodeId]);
    for (const other of snapshot.proposals ?? []) if (other.id !== proposal.id && other.taskId === task.id && other.baseRevision === baseRevision && ['ready', 'running'].includes(other.status)) this.putProposal({ ...other, status: 'stale' });
    this.database().run('DELETE FROM motion_comic_script_storyboards WHERE task_id = ?', [task.id]);
    this.invalidate(id);
  }

  revertProposal(raw: MotionComicScriptRevertInput): Promise<MotionComicScriptSnapshot> {
    const input = motionComicScriptRevertSchema.parse(raw);
    return this.commitProject(input.id, () => {
      const { document, snapshot, task, candidate } = this.proposalBaseline(input);
      const p = snapshot.proposals!.find(p => p.id === input.proposalId && p.taskId === task.id && p.projectId === input.id);
      if (!p || p.status !== 'applied' || p.revertedRevision !== undefined) throw new Error('SCRIPT_PROPOSAL_NOT_APPLIED: 候选未采用或已撤销。');
      if (!p.appliedScriptHash) throw new Error('SCRIPT_PROPOSAL_REVERT_UNAVAILABLE: 历史候选缺少采用后全文基准，无法安全撤销。');
      if (p.appliedRevision !== candidate.outputRevision || p.inputFingerprint !== task.inputFingerprint || hash(candidate.script) !== p.appliedScriptHash) {
        throw new Error('SCRIPT_PROPOSAL_STALE: 采用后剧本已变化，无法撤销。');
      }
      const scenes = candidate.script.scenes.filter(s => s.key === p.sceneKey);
      const beats = scenes.flatMap(s => s.beats.filter(b => b.key === p.beatKey));
      if (scenes.length !== 1 || beats.length !== 1 || beats[0].text !== p.proposedText) throw new Error('SCRIPT_PROPOSAL_TARGET_CHANGED: 目标段落已变化，无法撤销。');
      const next = structuredClone(candidate.script);
      next.scenes.find(s => s.key === p.sceneKey)!.beats.find(b => b.key === p.beatKey)!.text = p.originalText;
      const script = motionComicScriptDraftSchema.parse(next);
      const source = document.sourceDocument!.episodes.find(s => s.id === task.sourceEpisodeId)!;
      const issues = validateMotionComicScriptDraft(script, splitMotionComicSource(source.sourceText), document, task.instructions);
      if (issues.length) throw new Error('MOTION_COMIC_SCRIPT_INVALID: 撤销后的剧本未通过校验。');
      const revision = candidate.outputRevision + 1;
      this.putCandidate({ ...candidate, script, issues, outputRevision: revision, origin: 'human', createdAt: now() });
      this.putTask({ ...task, outputRevision: revision, status: 'review', updatedAt: now() });
      this.putProposal({ ...p, status: 'reverted', revertedRevision: revision });
      this.invalidateProposalChange(input.id, snapshot, task, p, candidate.outputRevision);
      return this.snapshotNow(input.id);
    });
  }

  approve(raw: MotionComicScriptApproveInput): Promise<MotionComicScriptSnapshot> {
    const input = motionComicScriptApproveSchema.parse(raw);
    return this.commitProject(input.id, () => {
      let document = this.project(input.id);
      if (document.updatedAt !== input.expectedUpdatedAt) throw new Error('MOTION_COMIC_STALE_WRITE');
      this.invalidate(input.id);
      const snapshot = this.snapshotNow(input.id);
      const seen = new Set<string>();
      for (const revision of input.revisions) {
        const task = snapshot.tasks.find((item) => item.id === revision.taskId);
        const candidate = snapshot.candidates.find((item) => item.taskId === revision.taskId);
        if (!task || !candidate || seen.has(task.sourceEpisodeId) || task.outputRevision !== revision.outputRevision || candidate.outputRevision !== revision.outputRevision
          || !['script-ready', 'review', 'approved'].includes(task.status) || (task.status === 'approved' && snapshot.approvals.some((item) => item.taskId === task.id && item.assetsConfirmedAt))) throw new Error('MOTION_COMIC_SCRIPT_REVISION: 待批准版本已变化，请刷新。');
        seen.add(task.sourceEpisodeId);
        const source = document.sourceDocument!.episodes.find((item) => item.id === task.sourceEpisodeId)!;
        if (validateMotionComicScriptDraft(candidate.script, splitMotionComicSource(source.sourceText), document, task.instructions).length) throw new Error('MOTION_COMIC_SCRIPT_INVALID: 剧本仍有校验问题。');
        if (plannedMotionComicSourceEpisodeIds(document).has(source.id)) throw new Error('MOTION_COMIC_SCRIPT_PROTECTED: 本集已有分镜，不覆盖现有制作。');
        const confirmed = confirmMotionComicScriptAssets(document, candidate.script, randomUUID);
        if (validateMotionComicScriptDraft(confirmed.script, splitMotionComicSource(source.sourceText), confirmed.document, task.instructions).length) throw new Error('MOTION_COMIC_ASSET_BINDING: 本集存在重复资产，请核对人物、地点、道具及造型的归属。');
        document = confirmed.document;
        const ids = motionComicScriptAssetIds(confirmed.script);
        const originalIds = task.bibleAssetIds ?? this.bibleAssetIds(document);
        const bound = { ...task, bibleAssetIds: { characters: [...new Set([...originalIds.characters, ...ids.characters])], looks: [...new Set([...(originalIds.looks ?? document.characters.filter((item) => originalIds.characters.includes(item.id)).flatMap((item) => item.looks.map((look) => look.id))), ...ids.looks])], sceneAssets: [...new Set([...originalIds.sceneAssets, ...ids.sceneAssets])], props: [...new Set([...originalIds.props, ...ids.props])] } };
        const fingerprint = this.fingerprint(document, bound);
        const approval: MotionComicScriptApproval = { sourceEpisodeId: source.id, taskId: task.id, outputRevision: candidate.outputRevision,
          inputFingerprint: fingerprint.inputFingerprint, script: confirmed.script, model: task.model, instructions: task.instructions,
          targetDurationSec: task.targetDurationSec, approvedAt: now(), assetsConfirmedAt: now(), stale: false };
        this.database().run('INSERT OR REPLACE INTO motion_comic_script_approvals(project_id, source_episode_id, data) VALUES (?, ?, ?)', [input.id, source.id, JSON.stringify(approval)]);
        this.database().run('DELETE FROM motion_comic_script_storyboards WHERE task_id = ?', [task.id]);
        this.putTask({ ...bound, ...fingerprint, status: 'approved', storyboardStatus: undefined, storyboardError: undefined, updatedAt: now() });
      }
      document.updatedAt = new Date(Math.max(Date.now(), Date.parse(document.updatedAt) + 1)).toISOString();
      this.database().run('UPDATE tasks SET pipeline_data = ? WHERE id = ?', [JSON.stringify(document), input.id]);
      return this.snapshotNow(input.id);
    });
  }

  /** Rechecked inside the project save transaction, not only before model execution. */
  assertApprovedRevision(raw: MotionComicScriptRevisionInput, allowProjectTimestampChange = false) {
    const input = motionComicScriptRevisionSchema.parse(raw);
    const document = this.project(input.id);
    if (!allowProjectTimestampChange && document.updatedAt !== input.expectedUpdatedAt) throw new Error('MOTION_COMIC_STALE_WRITE: 项目已变化，请刷新。');
    const snapshot = this.snapshotNow(input.id);
    const task = snapshot.tasks.find((item) => item.id === input.taskId);
    const approval = snapshot.approvals.find((item) => item.taskId === input.taskId);
    if (!task || task.status !== 'approved' || !approval || approval.stale || task.outputRevision !== input.outputRevision || approval.outputRevision !== input.outputRevision
      || this.dependencies(document, task, snapshot).inputFingerprint !== task.inputFingerprint) {
      throw new Error('MOTION_COMIC_SCRIPT_APPROVAL_REQUIRED: 请先批准当前版本剧本。');
    }
    if (plannedMotionComicSourceEpisodeIds(document).has(task.sourceEpisodeId)) throw new Error('MOTION_COMIC_SCRIPT_PROTECTED: 本集已有分镜，不覆盖现有制作。');
    if (!approval.assetsConfirmedAt) throw new Error('MOTION_COMIC_ASSETS_REQUIRED: 请先在剧本工作台确认本集人物、地点和道具到项目资产库。');
    assertMotionComicScriptAssets(document, approval.script);
    return { document, task, approval, storyboard: snapshot.storyboards.find((item) => item.taskId === task.id && item.outputRevision === input.outputRevision) };
  }

  async approvedRevision(input: MotionComicScriptRevisionInput, allowProjectTimestampChange = false) {
    await this.refresh(input.id);
    return this.assertApprovedRevision(input, allowProjectTimestampChange);
  }

  beginStoryboard(input: MotionComicScriptRevisionInput): Promise<MotionComicScriptSnapshot> {
    return this.commitProject(input.id, () => {
      const { task, storyboard } = this.assertApprovedRevision(input);
      if (task.storyboardStatus === 'running') throw new Error('MOTION_COMIC_STORYBOARD_BUSY: 本集分镜正在后台生成。');
      if (storyboard) return this.snapshotNow(input.id);
      this.putTask({ ...task, storyboardStatus: 'running', storyboardError: undefined, updatedAt: now() });
      return this.snapshotNow(input.id);
    });
  }

  failStoryboard(input: MotionComicScriptRevisionInput, error: string): Promise<void> {
    return this.commitProject(input.id, () => {
      const row = this.rows('SELECT data FROM motion_comic_script_tasks WHERE id = ? AND project_id = ?', [input.taskId, input.id])[0];
      if (!row) return;
      const task = motionComicScriptTaskSchema.parse(JSON.parse(String(row.data)));
      if (task.outputRevision === input.outputRevision && task.storyboardStatus === 'running') {
        this.putTask({ ...task, storyboardStatus: 'failed', storyboardError: error.slice(0, 8_000), updatedAt: now() });
      }
    });
  }

  saveStoryboard(input: MotionComicScriptRevisionInput, value: MotionComicScriptStoryboard): Promise<MotionComicScriptSnapshot> {
    return this.commitProject(input.id, () => {
      // Long-running background work binds to content/revision, not unrelated UI saves.
      const { task, approval } = this.assertApprovedRevision(input, true);
      const storyboard = motionComicScriptStoryboardCandidateSchema.parse(value);
      if (storyboard.taskId !== input.taskId || storyboard.outputRevision !== input.outputRevision || JSON.stringify(storyboard.plan.script) !== JSON.stringify(approval.script)) {
        throw new Error('MOTION_COMIC_SCRIPT_REVISION: 分镜与已批准剧本不一致。');
      }
      this.database().run('INSERT OR REPLACE INTO motion_comic_script_storyboards(task_id, data) VALUES (?, ?)', [input.taskId, JSON.stringify(storyboard)]);
      this.putTask({ ...task, storyboardStatus: 'ready', storyboardError: undefined, updatedAt: now() });
      return this.snapshotNow(input.id);
    });
  }

  /** Dependency changes are explicit; queued jobs bind the latest prior script when claimed. */
  private invalidate(id: string): void {
    const document = this.project(id);
    const snapshot = this.snapshotNow(id);
    const order = document.sourceDocument?.episodes.map((item) => item.id) ?? [];
    for (const task of [...snapshot.tasks].sort((a, b) => order.indexOf(a.sourceEpisodeId) - order.indexOf(b.sourceEpisodeId))) {
      if (!['script-ready', 'review', 'approved'].includes(task.status)) continue;
      let stale = false;
      try { stale = this.dependencies(document, task, snapshot).inputFingerprint !== task.inputFingerprint; } catch { stale = true; }
      if (!stale) continue;
      this.putTask({ ...task, status: 'stale', updatedAt: now() });
      task.status = 'stale';
      const approval = snapshot.approvals.find((item) => item.taskId === task.id);
      if (approval) this.database().run('UPDATE motion_comic_script_approvals SET data = ? WHERE project_id = ? AND source_episode_id = ?', [JSON.stringify({ ...approval, stale: true }), id, task.sourceEpisodeId]);
    }
    for (const proposal of snapshot.proposals ?? []) {
      if (proposal.status !== 'ready') continue;
      try {
        const { task, candidate } = this.proposalBaseline({ id, taskId: proposal.taskId, outputRevision: proposal.baseRevision, expectedUpdatedAt: proposal.baseProjectUpdatedAt });
        if (task.inputFingerprint !== proposal.inputFingerprint || hash(candidate.script) !== proposal.baseScriptHash) throw new Error('SCRIPT_PROPOSAL_STALE');
      } catch { this.putProposal({ ...proposal, status: 'stale' }); }
    }
  }

  async refresh(id: string): Promise<MotionComicScriptSnapshot> {
    await this.waitForWrites();
    const document = this.project(id);
    const snapshot = this.snapshotNow(id);
    const changed = snapshot.tasks.some((task) => {
      if (!['script-ready', 'review', 'approved'].includes(task.status)) return false;
      try { return this.dependencies(document, task, snapshot).inputFingerprint !== task.inputFingerprint; } catch { return true; }
    });
    const proposalChanged = (snapshot.proposals ?? []).some(p => {
      if (p.status !== 'ready') return false;
      try {
        const { task, candidate } = this.proposalBaseline({ id, taskId: p.taskId, outputRevision: p.baseRevision, expectedUpdatedAt: p.baseProjectUpdatedAt });
        return task.inputFingerprint !== p.inputFingerprint || hash(candidate.script) !== p.baseScriptHash;
      } catch { return true; }
    });
    if (!changed && !proposalChanged) return snapshot;
    return this.commitProject(id, () => { this.invalidate(id); return this.snapshotNow(id); });
  }
}
