import { randomBytes } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { HistoryFamily } from '../src/shared/types';

const governanceSafeStorageKeyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/u;
const reservedStorageKeys = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;

const familyDirectoryNames: Record<HistoryFamily, string> = {
  task: 'tasks',
  'viral-analysis': 'viral-analyses',
  'image-lab': 'image-lab',
  'voice-lab': 'voice-lab',
};

export function createManagedStorageKey(): string {
  return randomBytes(24).toString('hex');
}

export function managedHistoryFamilyRoot(appDataDir: string, family: HistoryFamily): string {
  return resolve(appDataDir, familyDirectoryNames[family]);
}

export function resolveManagedHistoryWorkDir(
  appDataDir: string,
  family: HistoryFamily,
  managedStorageKey: string | null | undefined,
): string {
  if (typeof managedStorageKey !== 'string' || !isGovernanceSafeStorageKey(managedStorageKey)) {
    throw new Error('MANAGED_STORAGE_KEY_INVALID: History row has no valid managed storage key.');
  }
  const root = managedHistoryFamilyRoot(appDataDir, family);
  const candidate = resolve(root, managedStorageKey);
  assertContainedChild(root, candidate);
  return candidate;
}

export interface LegacyManagedHistoryRow {
  family: HistoryFamily;
  id: string;
  managedStorageKey?: string | null;
}

export async function backfillLegacyManagedHistoryStorage(
  appDataDir: string,
  rows: readonly LegacyManagedHistoryRow[],
  persist: (family: HistoryFamily, id: string, managedStorageKey: string) => Promise<boolean>,
): Promise<number> {
  let migrated = 0;
  for (const row of rows) {
    if (row.managedStorageKey !== null && row.managedStorageKey !== undefined) continue;
    const legacyWorkDir = await resolveLegacyManagedHistoryWorkDir(appDataDir, row.family, row.id);
    if (!legacyWorkDir) continue;
    resolveManagedHistoryWorkDir(appDataDir, row.family, row.id);
    if (await persist(row.family, row.id, row.id)) migrated += 1;
  }
  return migrated;
}

export async function resolveLegacyManagedHistoryWorkDir(
  appDataDir: string,
  family: HistoryFamily,
  businessId: string,
): Promise<string | null> {
  if (!isGovernanceSafeStorageKey(businessId)) return null;
  const root = managedHistoryFamilyRoot(appDataDir, family);
  const candidate = resolve(root, businessId);
  try {
    assertContainedChild(root, candidate);
    const [rootStat, candidateStat] = await Promise.all([lstat(root), lstat(candidate)]);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
    if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) return null;
    const [canonicalRoot, canonicalCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    assertContainedChild(canonicalRoot, canonicalCandidate);
    return canonicalCandidate;
  } catch {
    return null;
  }
}

function isGovernanceSafeStorageKey(value: string): boolean {
  return governanceSafeStorageKeyPattern.test(value) && !reservedStorageKeys.test(value);
}

function assertContainedChild(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    throw new Error('MANAGED_HISTORY_PATH_INVALID: Work directory must be a child of its managed family root.');
  }
}
