import { randomUUID } from 'node:crypto';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import type { Database } from 'sql.js';
import type { ProjectActivity, TaskSummary } from './types';

export interface ProjectSummaryCacheEntry {
  revision: string;
  checkedAt: number;
  cover: TaskSummary['projectCover'];
  activity?: ProjectActivity;
  hints: { covers: unknown[]; videos: unknown[]; images: unknown[]; sceneVideos: unknown[] };
}

/** Revision changes participate in the same transaction/rollback as project mutations. */
export function migrateProjectSummaryVersions(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS project_summary_versions (task_id TEXT PRIMARY KEY, revision TEXT NOT NULL);
    INSERT OR IGNORE INTO project_summary_versions SELECT id, lower(hex(randomblob(16))) FROM tasks;
    CREATE TRIGGER IF NOT EXISTS project_summary_task_insert AFTER INSERT ON tasks BEGIN
      INSERT OR REPLACE INTO project_summary_versions VALUES (NEW.id, lower(hex(randomblob(16))));
    END;
    CREATE TRIGGER IF NOT EXISTS project_summary_task_update AFTER UPDATE OF
      pipeline_data, status, task_type, managed_storage_key, project_cover_override_path,
      ordinary_cover_asset_json, reference_image_path, artifact_state_path ON tasks BEGIN
      INSERT OR REPLACE INTO project_summary_versions VALUES (NEW.id, lower(hex(randomblob(16))));
    END;
    CREATE TRIGGER IF NOT EXISTS project_summary_task_delete AFTER DELETE ON tasks BEGIN
      DELETE FROM project_summary_versions WHERE task_id = OLD.id;
    END;`);
  // These are the durable tables read by the activity summary; cover metadata lives on tasks.
  for (const table of ['director_batches', 'motion_comic_script_tasks', 'motion_comic_script_controls']) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const refs = operation === 'UPDATE' ? ['OLD', 'NEW'] : [operation === 'DELETE' ? 'OLD' : 'NEW'];
      db.run(`CREATE TRIGGER IF NOT EXISTS project_summary_${table}_${operation.toLowerCase()}
        AFTER ${operation} ON ${table} BEGIN
        ${refs.map((ref) => `UPDATE project_summary_versions SET revision = lower(hex(randomblob(16)))
          WHERE task_id = ${ref}.project_id;`).join('\n')}
        END;`);
    }
  }
}

const FORMAT = 1;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const activityStatuses = new Set(['draft', 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled']);
function validEntry(value: unknown): value is ProjectSummaryCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as ProjectSummaryCacheEntry;
  return typeof entry.revision === 'string' && typeof entry.checkedAt === 'number'
    && (entry.cover === null || (!!entry.cover && typeof entry.cover.path === 'string' && typeof entry.cover.revision === 'string'))
    && (!entry.activity || (activityStatuses.has(entry.activity.status) && typeof entry.activity.label === 'string' && typeof entry.activity.detail === 'string'))
    && !!entry.hints && ['covers', 'videos', 'images', 'sceneVideos'].every((key) => Array.isArray(entry.hints[key as keyof typeof entry.hints]));
}

/** Disposable, small sidecar: never export the full project database just to refresh a card. */
export class ProjectSummaryCache {
  readonly entries = new Map<string, ProjectSummaryCacheEntry>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writeTail: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private readonly file: string) {}

  async load(validIds: Set<string>): Promise<void> {
    try {
      const handle = await open(this.file, 'r');
      let source: string;
      try {
        if ((await handle.stat()).size > MAX_CACHE_BYTES) return;
        source = await handle.readFile('utf8');
      } finally { await handle.close(); }
      const parsed = JSON.parse(source);
      if (parsed.format !== FORMAT || !Array.isArray(parsed.entries)) return;
      for (const pair of parsed.entries) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [id, entry] = pair;
        if (typeof id === 'string' && validIds.has(id) && validEntry(entry)) {
          // Revalidate external files once in the background after each app launch.
          this.entries.set(id, { ...entry, checkedAt: 0 });
        }
      }
    } catch {
      // Missing/corrupt caches are rebuilt without affecting project data.
    }
  }

  set(id: string, entry: ProjectSummaryCacheEntry): void {
    this.entries.set(id, entry);
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 250);
  }

  delete(id: string): void {
    if (this.entries.delete(id)) {
      this.dirty = true;
    }
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.dirty) {
      this.dirty = false;
      const source = JSON.stringify({ format: FORMAT, entries: [...this.entries] });
      this.writeTail = this.writeTail.then(async () => {
        const temp = `${this.file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temp, source, 'utf8');
          await rename(temp, this.file);
        } catch {
          // Cache persistence is best effort; the in-memory summary remains usable.
          this.dirty = true;
        } finally { await rm(temp, { force: true }).catch(() => undefined); }
      });
    }
    await this.writeTail;
  }
}
