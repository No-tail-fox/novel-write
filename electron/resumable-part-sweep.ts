/**
 * Bounded cleanup of stale resumable-download leftovers (backlog C-2).
 *
 * `electron/resumable-transfer.ts` keeps `<target>.part` + `<target>.part.json` so an interrupted
 * remote-video download can resume. The video provider stages those as
 * `<task work dir>/generated-videos/.resume-<32 hex>.mp4.part[.json]`. A finished download is renamed
 * away and a permanent failure discards its part, but a task that is never reopened (or was removed
 * outside the normal quarantine flow) would keep its partial bytes forever. This sweep removes them:
 *
 * - only inside `<tasks root>/<managed storage key>/generated-videos/`, matched by exact file name;
 * - never follows links/junctions (lstat everywhere, canonical containment check, `unlink` only);
 * - never touches finished files (`.resume-*.mp4`, normal outputs) or a part that is downloading now;
 * - deletes when older than `maxAgeMs` (default 7 days) or, when `liveStorageKeys` is given, when the
 *   task directory no longer belongs to any task (after a short grace period);
 * - bounded by directory / entry caps; every failure is swallowed per entry.
 */
import { lstat, readdir, realpath, unlink } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { claimResumablePartForCleanup } from './resumable-transfer';
import { managedHistoryFamilyRoot } from './managed-history-paths';

export const RESUMABLE_PART_FILE_PATTERN = /^\.resume-[0-9a-f]{32}\.mp4\.part(?:\.json)?$/u;
export const RESUMABLE_PART_DIRECTORIES = ['generated-videos'] as const;
export const DEFAULT_STALE_RESUMABLE_PART_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Orphan parts younger than this survive, so a task created during the sweep cannot lose a fresh part. */
export const DEFAULT_ORPHAN_RESUMABLE_PART_GRACE_MS = 60 * 60 * 1000;
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/u;

export interface StaleResumablePartSweepOptions {
  /** Managed task family root (`<artifact data>/tasks`). */
  tasksRoot: string;
  /** Restrict the sweep to these task directories (e.g. the task being opened). */
  storageKeys?: readonly string[];
  /** Managed storage keys of every existing task. Directories not listed count as orphaned. */
  liveStorageKeys?: Iterable<string>;
  maxAgeMs?: number;
  orphanGraceMs?: number;
  now?: number;
  maxTaskDirectories?: number;
  maxEntriesPerDirectory?: number;
}

export interface StaleResumablePartSweepResult {
  removed: string[];
  kept: number;
  failed: number;
}

const samePath = (left: string, right: string) => process.platform === 'win32'
  ? left.toLowerCase() === right.toLowerCase()
  : left === right;

async function plainDirectory(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  return Boolean(info?.isDirectory() && !info.isSymbolicLink());
}

export async function sweepStaleResumableParts(options: StaleResumablePartSweepOptions): Promise<StaleResumablePartSweepResult> {
  const result: StaleResumablePartSweepResult = { removed: [], kept: 0, failed: 0 };
  const root = resolve(options.tasksRoot);
  if (!await plainDirectory(root)) return result;
  const canonicalRoot = await realpath(root).catch(() => null);
  if (!canonicalRoot) return result;
  const now = options.now ?? Date.now();
  const maxAgeMs = Math.max(0, options.maxAgeMs ?? DEFAULT_STALE_RESUMABLE_PART_MAX_AGE_MS);
  const orphanGraceMs = Math.max(0, options.orphanGraceMs ?? DEFAULT_ORPHAN_RESUMABLE_PART_GRACE_MS);
  const live = options.liveStorageKeys ? new Set(options.liveStorageKeys) : undefined;
  const maxDirectories = Math.max(1, options.maxTaskDirectories ?? 10_000);
  const maxEntries = Math.max(1, options.maxEntriesPerDirectory ?? 5_000);

  const candidates = options.storageKeys ? [...options.storageKeys] : await readdir(root).catch(() => [] as string[]);
  const keys = candidates.filter((key) => STORAGE_KEY_PATTERN.test(key)).slice(0, maxDirectories);
  for (const key of keys) {
    const taskDir = join(root, key);
    if (!await plainDirectory(taskDir)) continue;
    const orphaned = live ? !live.has(key) : false;
    for (const sub of RESUMABLE_PART_DIRECTORIES) {
      const directory = join(taskDir, sub);
      if (!await plainDirectory(directory)) continue;
      const canonical = await realpath(directory).catch(() => null);
      if (!canonical || !samePath(relative(canonicalRoot, canonical), join(key, sub))) continue;
      const names = (await readdir(directory).catch(() => [] as string[])).slice(0, maxEntries);
      for (const name of names) {
        if (!RESUMABLE_PART_FILE_PATTERN.test(name)) continue;
        const file = join(directory, name);
        const partPath = name.endsWith('.json') ? file.slice(0, -'.json'.length) : file;
        // Claim first (synchronous check-and-reserve against downloads), then stat under the claim so the
        // age decision describes the files as they are now, not as listed earlier. Age is judged per
        // part+record PAIR (newest mtime wins): a record a download just rewrote keeps its old-looking part
        // alive and vice versa, so the sweep never splits a live pair.
        const release = claimResumablePartForCleanup(partPath);
        if (!release) { result.kept += 1; continue; }
        try {
          const info = await lstat(file);
          if (!info.isFile() || info.isSymbolicLink()) continue;
          const sibling = await lstat(file === partPath ? `${partPath}.json` : partPath).catch(() => null);
          const newest = Math.max(info.mtimeMs, sibling?.isFile() && !sibling.isSymbolicLink() ? sibling.mtimeMs : 0);
          const age = now - newest;
          const stale = age > maxAgeMs || (orphaned && age > orphanGraceMs);
          if (!stale) { result.kept += 1; continue; }
          await unlink(file);
          result.removed.push(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') result.failed += 1;
        } finally {
          release();
        }
      }
    }
  }
  return result;
}

/**
 * Startup maintenance entry: sweeps every managed task directory, treating directories that belong to no
 * task row as orphaned. Never rejects (cleanup must not affect startup); returns null on failure.
 */
export async function sweepStaleResumablePartsForAppData(
  appDataDir: string,
  listTaskStorageKeys: () => Promise<Iterable<string>>,
  options: Omit<StaleResumablePartSweepOptions, 'tasksRoot' | 'liveStorageKeys'> = {},
): Promise<StaleResumablePartSweepResult | null> {
  try {
    const liveStorageKeys = await listTaskStorageKeys();
    return await sweepStaleResumableParts({ ...options, tasksRoot: managedHistoryFamilyRoot(appDataDir, 'task'), liveStorageKeys });
  } catch {
    return null;
  }
}
