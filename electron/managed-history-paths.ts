import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
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

interface ManagedHistoryStats {
  dev: bigint | number;
  ino: bigint | number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface ManagedHistoryFileOperations {
  lstat: (path: string) => Promise<ManagedHistoryStats>;
  realpath: (path: string) => Promise<string>;
  rename: (source: string, destination: string) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
  unlink: (path: string) => Promise<void>;
  rmdir: (path: string) => Promise<void>;
}

export interface StagedManagedHistoryDirectory {
  family: HistoryFamily;
  managedStorageKey: string;
  appDataDir: string;
  appDataIdentityJson: string;
  familyRoot: string;
  rootIdentityJson: string;
  originalPath: string;
  quarantineName: string;
  quarantinePath: string;
  quarantineIdentityJson: string;
}

export interface ManagedHistoryDeletionCleanup {
  cleanupState: 'pending' | 'missing' | 'unmanaged-legacy';
  quarantineName: string | null;
  quarantineIdentityJson: string;
  diagnostic: string;
}

export interface PendingManagedHistoryTombstone {
  family: HistoryFamily;
  id: string;
  managedStorageKey: string | null;
  cleanupState: string;
  quarantineName: string | null;
  quarantineIdentityJson: string;
  diagnostic: string;
  deletedAt: string;
}

export interface ManagedHistoryQuarantineStore {
  listPendingHistoryTombstones(): Promise<PendingManagedHistoryTombstone[]>;
  updateHistoryTombstoneCleanup(
    family: HistoryFamily,
    id: string,
    cleanupState: 'pending' | 'cleaned' | 'missing',
    diagnostic: string,
  ): Promise<unknown>;
}

interface ManagedHistoryIdentity {
  version: 1;
  dev: string;
  ino: string;
}

export interface ManagedHistoryWorkDirectoryAnchor {
  path: string;
  identityJson: string;
  assertCurrent(): Promise<void>;
}

export interface ManagedHistoryDirectoryCreationOperations {
  lstat: (path: string) => Promise<ManagedHistoryStats>;
  realpath: (path: string) => Promise<string>;
  mkdir: (path: string) => Promise<void>;
}

const quarantineTokenPattern = /^[a-f0-9]{32}$/u;

function managedHistoryFileOperations(
  overrides: Partial<ManagedHistoryFileOperations> = {},
): ManagedHistoryFileOperations {
  return {
    lstat: overrides.lstat ?? ((path) => lstat(path, { bigint: true })),
    realpath: overrides.realpath ?? ((path) => realpath(path)),
    rename: overrides.rename ?? ((source, destination) => rename(source, destination)),
    readdir: overrides.readdir ?? ((path) => readdir(path)),
    unlink: overrides.unlink ?? ((path) => unlink(path)),
    rmdir: overrides.rmdir ?? ((path) => rmdir(path)),
  };
}

function historyIdentity(stat: ManagedHistoryStats): ManagedHistoryIdentity {
  return { version: 1, dev: String(stat.dev), ino: String(stat.ino) };
}

function historyIdentityJson(stat: ManagedHistoryStats): string {
  return JSON.stringify(historyIdentity(stat));
}

function parseHistoryIdentity(value: string): ManagedHistoryIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('MANAGED_HISTORY_IDENTITY_INVALID: Persisted identity is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MANAGED_HISTORY_IDENTITY_INVALID: Persisted identity is invalid.');
  }
  const identity = parsed as Record<string, unknown>;
  if (
    Object.keys(identity).length !== 3
    || identity.version !== 1
    || typeof identity.dev !== 'string'
    || !/^\d+$/u.test(identity.dev)
    || typeof identity.ino !== 'string'
    || !/^\d+$/u.test(identity.ino)
  ) {
    throw new Error('MANAGED_HISTORY_IDENTITY_INVALID: Persisted identity must contain decimal dev and ino strings.');
  }
  return { version: 1, dev: identity.dev, ino: identity.ino };
}

function assertSameHistoryIdentity(
  stat: ManagedHistoryStats,
  expected: ManagedHistoryIdentity,
  label: string,
): void {
  const actual = historyIdentity(stat);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(`MANAGED_HISTORY_IDENTITY_CHANGED: ${label} identity changed.`);
  }
}

function assertManagedDirectory(stat: ManagedHistoryStats, label: string): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`MANAGED_HISTORY_REPARSE_REJECTED: ${label} must be a directory and not a link, junction, or reparse representation.`);
  }
}

function assertCanonicalDirectChild(root: string, candidate: string): void {
  assertContainedChild(root, candidate);
  const fromRoot = relative(root, candidate);
  if (dirname(fromRoot) !== '.') {
    throw new Error('MANAGED_HISTORY_PATH_INVALID: Managed directory must be a direct child of its family root.');
  }
}

function assertCanonicalContained(root: string, candidate: string, allowRoot = false): void {
  if (allowRoot && resolve(root) === resolve(candidate)) return;
  assertContainedChild(root, candidate);
}

function quarantineNameFor(managedStorageKey: string): string {
  return `.history.${managedStorageKeyHash(managedStorageKey)}.${randomBytes(16).toString('hex')}.quarantine`;
}

function managedStorageKeyHash(managedStorageKey: string): string {
  return createHash('sha256').update(managedStorageKey, 'utf8').digest('hex');
}

function assertQuarantineName(managedStorageKey: string, quarantineName: string): void {
  if (basename(quarantineName) !== quarantineName || quarantineName === '.' || quarantineName === '..') {
    throw new Error('MANAGED_HISTORY_QUARANTINE_INVALID: Quarantine name must be a single path segment.');
  }
  const prefix = `.history.${managedStorageKeyHash(managedStorageKey)}.`;
  const suffix = '.quarantine';
  const token = quarantineName.startsWith(prefix) && quarantineName.endsWith(suffix)
    ? quarantineName.slice(prefix.length, -suffix.length)
    : '';
  if (!quarantineTokenPattern.test(token)) {
    throw new Error('MANAGED_HISTORY_QUARANTINE_INVALID: Quarantine name does not match its managed storage key.');
  }
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === code);
}

function errorDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2048);
}

async function assertUnchangedDirectory(
  path: string,
  expected: ManagedHistoryIdentity,
  label: string,
  operations: Pick<ManagedHistoryFileOperations, 'lstat'>,
): Promise<ManagedHistoryStats> {
  const stat = await operations.lstat(path);
  assertManagedDirectory(stat, label);
  assertSameHistoryIdentity(stat, expected, label);
  return stat;
}

export async function createManagedHistoryWorkDirectory(
  appDataDir: string,
  family: HistoryFamily,
  managedStorageKey: string,
  overrides: Partial<ManagedHistoryDirectoryCreationOperations> = {},
): Promise<ManagedHistoryWorkDirectoryAnchor> {
  const operations: ManagedHistoryDirectoryCreationOperations = {
    lstat: overrides.lstat ?? ((path) => lstat(path, { bigint: true })),
    realpath: overrides.realpath ?? ((path) => realpath(path)),
    mkdir: overrides.mkdir ?? ((path) => mkdir(path)),
  };
  const applicationRoot = resolve(appDataDir);
  const familyRoot = managedHistoryFamilyRoot(applicationRoot, family);
  const workDir = resolveManagedHistoryWorkDir(applicationRoot, family, managedStorageKey);
  const applicationStat = await operations.lstat(applicationRoot);
  assertManagedDirectory(applicationStat, 'Managed app data root');
  const applicationIdentity = historyIdentity(applicationStat);
  try {
    await operations.mkdir(familyRoot);
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error;
  }
  const rootStat = await operations.lstat(familyRoot);
  assertManagedDirectory(rootStat, 'Managed family root');
  const rootIdentity = historyIdentity(rootStat);
  const [canonicalApplication, canonicalRoot] = await Promise.all([
    operations.realpath(applicationRoot),
    operations.realpath(familyRoot),
  ]);
  assertCanonicalDirectChild(canonicalApplication, canonicalRoot);
  await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
  await assertUnchangedDirectory(familyRoot, rootIdentity, 'Managed family root', operations);
  await operations.mkdir(workDir);
  const workDirStat = await operations.lstat(workDir);
  assertManagedDirectory(workDirStat, 'Managed history directory');
  const workDirIdentity = historyIdentity(workDirStat);

  async function assertCurrent(): Promise<void> {
    await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
    await assertUnchangedDirectory(familyRoot, rootIdentity, 'Managed family root', operations);
    await assertUnchangedDirectory(workDir, workDirIdentity, 'Managed history directory', operations);
    const [currentApplication, currentRoot, currentWorkDir] = await Promise.all([
      operations.realpath(applicationRoot),
      operations.realpath(familyRoot),
      operations.realpath(workDir),
    ]);
    assertCanonicalDirectChild(currentApplication, currentRoot);
    assertCanonicalDirectChild(currentRoot, currentWorkDir);
    await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
    await assertUnchangedDirectory(familyRoot, rootIdentity, 'Managed family root', operations);
    await assertUnchangedDirectory(workDir, workDirIdentity, 'Managed history directory', operations);
  }

  await assertCurrent();
  return { path: workDir, identityJson: JSON.stringify(workDirIdentity), assertCurrent };
}

async function assertRollbackTargetMissing(
  path: string,
  operations: ManagedHistoryFileOperations,
): Promise<void> {
  try {
    await operations.lstat(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return;
    throw error;
  }
  throw new Error('MANAGED_HISTORY_ROLLBACK_TARGET_EXISTS: Original managed directory was recreated; rollback refused.');
}

export async function stageManagedHistoryDirectory(
  appDataDir: string,
  family: HistoryFamily,
  managedStorageKey: string,
  overrides: Partial<ManagedHistoryFileOperations> = {},
  expectedIdentityJson?: string,
): Promise<StagedManagedHistoryDirectory | null> {
  const applicationRoot = resolve(appDataDir);
  const originalPath = resolveManagedHistoryWorkDir(applicationRoot, family, managedStorageKey);
  const familyRoot = managedHistoryFamilyRoot(applicationRoot, family);
  const operations = managedHistoryFileOperations(overrides);
  let applicationStat: ManagedHistoryStats;
  try {
    applicationStat = await operations.lstat(applicationRoot);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
  assertManagedDirectory(applicationStat, 'Managed app data root');
  let rootStat: ManagedHistoryStats;
  try {
    rootStat = await operations.lstat(familyRoot);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
  assertManagedDirectory(rootStat, 'Managed family root');
  let originalStat: ManagedHistoryStats;
  try {
    originalStat = await operations.lstat(originalPath);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
  assertManagedDirectory(originalStat, 'Managed history directory');
  if (expectedIdentityJson) {
    assertSameHistoryIdentity(originalStat, parseHistoryIdentity(expectedIdentityJson), 'Managed history directory');
  }
  const applicationIdentity = historyIdentity(applicationStat);
  const rootIdentity = historyIdentity(rootStat);
  const originalIdentity = historyIdentity(originalStat);
  const [canonicalApplication, canonicalRoot, canonicalOriginal] = await Promise.all([
    operations.realpath(applicationRoot),
    operations.realpath(familyRoot),
    operations.realpath(originalPath),
  ]);
  assertCanonicalDirectChild(canonicalApplication, canonicalRoot);
  assertCanonicalDirectChild(canonicalRoot, canonicalOriginal);
  await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
  await assertUnchangedDirectory(familyRoot, rootIdentity, 'Managed family root', operations);
  await assertUnchangedDirectory(originalPath, originalIdentity, 'Managed history directory', operations);

  const quarantineName = quarantineNameFor(managedStorageKey);
  assertQuarantineName(managedStorageKey, quarantineName);
  const quarantinePath = resolve(familyRoot, quarantineName);
  assertCanonicalDirectChild(familyRoot, quarantinePath);
  try {
    await operations.rename(originalPath, quarantinePath);
  } catch (error) {
    throw new Error(`MANAGED_HISTORY_STAGE_FAILED: Managed directory changed or could not be renamed safely: ${errorDiagnostic(error)}`);
  }

  try {
    await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
    await assertUnchangedDirectory(familyRoot, rootIdentity, 'Managed family root', operations);
    const quarantineStat = await assertUnchangedDirectory(
      quarantinePath,
      originalIdentity,
      'Managed quarantine directory',
      operations,
    );
    const [canonicalApplicationAfter, canonicalRootAfter, canonicalQuarantine] = await Promise.all([
      operations.realpath(applicationRoot),
      operations.realpath(familyRoot),
      operations.realpath(quarantinePath),
    ]);
    assertCanonicalDirectChild(canonicalApplicationAfter, canonicalRootAfter);
    assertCanonicalDirectChild(canonicalRootAfter, canonicalQuarantine);
    await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
    await assertUnchangedDirectory(familyRoot, rootIdentity, 'Managed family root', operations);
    await assertUnchangedDirectory(quarantinePath, originalIdentity, 'Managed quarantine directory', operations);
    return {
      family,
      managedStorageKey,
      appDataDir: applicationRoot,
      appDataIdentityJson: JSON.stringify(applicationIdentity),
      familyRoot,
      rootIdentityJson: JSON.stringify(rootIdentity),
      originalPath,
      quarantineName,
      quarantinePath,
      quarantineIdentityJson: historyIdentityJson(quarantineStat),
    };
  } catch (error) {
    throw new Error(`MANAGED_HISTORY_STAGE_IDENTITY_CHANGED: Post-rename identity validation failed: ${errorDiagnostic(error)}`);
  }
}

function assertStagedPaths(staged: StagedManagedHistoryDirectory): void {
  const expectedRoot = managedHistoryFamilyRoot(staged.appDataDir, staged.family);
  if (resolve(expectedRoot) !== resolve(staged.familyRoot)) {
    throw new Error('MANAGED_HISTORY_PATH_INVALID: Staged family root is inconsistent.');
  }
  const expectedOriginal = resolveManagedHistoryWorkDir(staged.appDataDir, staged.family, staged.managedStorageKey);
  if (resolve(expectedOriginal) !== resolve(staged.originalPath)) {
    throw new Error('MANAGED_HISTORY_PATH_INVALID: Staged original path is inconsistent.');
  }
  assertQuarantineName(staged.managedStorageKey, staged.quarantineName);
  const expectedQuarantine = resolve(staged.familyRoot, staged.quarantineName);
  if (resolve(expectedQuarantine) !== resolve(staged.quarantinePath)) {
    throw new Error('MANAGED_HISTORY_PATH_INVALID: Staged quarantine path is inconsistent.');
  }
  assertCanonicalDirectChild(staged.appDataDir, staged.familyRoot);
  assertCanonicalDirectChild(staged.familyRoot, staged.originalPath);
  assertCanonicalDirectChild(staged.familyRoot, staged.quarantinePath);
}

async function validateStagedQuarantine(
  staged: StagedManagedHistoryDirectory,
  operations: ManagedHistoryFileOperations,
): Promise<{ canonicalRoot: string; canonicalQuarantine: string }> {
  assertStagedPaths(staged);
  const applicationIdentity = parseHistoryIdentity(staged.appDataIdentityJson);
  const rootIdentity = parseHistoryIdentity(staged.rootIdentityJson);
  const quarantineIdentity = parseHistoryIdentity(staged.quarantineIdentityJson);
  await assertUnchangedDirectory(staged.appDataDir, applicationIdentity, 'Managed app data root', operations);
  await assertUnchangedDirectory(staged.familyRoot, rootIdentity, 'Managed family root', operations);
  await assertUnchangedDirectory(staged.quarantinePath, quarantineIdentity, 'Managed quarantine directory', operations);
  const [canonicalApplication, canonicalRoot, canonicalQuarantine] = await Promise.all([
    operations.realpath(staged.appDataDir),
    operations.realpath(staged.familyRoot),
    operations.realpath(staged.quarantinePath),
  ]);
  assertCanonicalDirectChild(canonicalApplication, canonicalRoot);
  assertCanonicalDirectChild(canonicalRoot, canonicalQuarantine);
  await assertUnchangedDirectory(staged.appDataDir, applicationIdentity, 'Managed app data root', operations);
  await assertUnchangedDirectory(staged.familyRoot, rootIdentity, 'Managed family root', operations);
  await assertUnchangedDirectory(staged.quarantinePath, quarantineIdentity, 'Managed quarantine directory', operations);
  return { canonicalRoot, canonicalQuarantine };
}

export async function rollbackManagedHistoryDirectory(
  staged: StagedManagedHistoryDirectory,
  overrides: Partial<ManagedHistoryFileOperations> = {},
): Promise<void> {
  const operations = managedHistoryFileOperations(overrides);
  await validateStagedQuarantine(staged, operations);
  await assertRollbackTargetMissing(staged.originalPath, operations);
  const applicationIdentity = parseHistoryIdentity(staged.appDataIdentityJson);
  const rootIdentity = parseHistoryIdentity(staged.rootIdentityJson);
  const quarantineIdentity = parseHistoryIdentity(staged.quarantineIdentityJson);
  await assertUnchangedDirectory(staged.appDataDir, applicationIdentity, 'Managed app data root', operations);
  await assertUnchangedDirectory(staged.familyRoot, rootIdentity, 'Managed family root', operations);
  await assertUnchangedDirectory(staged.quarantinePath, quarantineIdentity, 'Managed quarantine directory', operations);
  await assertRollbackTargetMissing(staged.originalPath, operations);
  try {
    await operations.rename(staged.quarantinePath, staged.originalPath);
  } catch (error) {
    throw new Error(`MANAGED_HISTORY_ROLLBACK_FAILED: Quarantine rollback failed safely: ${errorDiagnostic(error)}`);
  }
  await assertUnchangedDirectory(staged.appDataDir, applicationIdentity, 'Managed app data root', operations);
  await assertUnchangedDirectory(staged.familyRoot, rootIdentity, 'Managed family root', operations);
  await assertUnchangedDirectory(staged.originalPath, quarantineIdentity, 'Restored managed directory', operations);
  const [canonicalRoot, canonicalOriginal] = await Promise.all([
    operations.realpath(staged.familyRoot),
    operations.realpath(staged.originalPath),
  ]);
  assertCanonicalDirectChild(canonicalRoot, canonicalOriginal);
}

async function removeDirectoryTreeNoFollow(
  path: string,
  canonicalQuarantine: string,
  expectedIdentity: ManagedHistoryIdentity,
  anchor: {
    appDataDir: string;
    appDataIdentity: ManagedHistoryIdentity;
    familyRoot: string;
    rootIdentity: ManagedHistoryIdentity;
    quarantinePath: string;
    quarantineIdentity: ManagedHistoryIdentity;
  },
  operations: ManagedHistoryFileOperations,
): Promise<void> {
  await assertRemovalAnchor(anchor, operations);
  await assertUnchangedDirectory(path, expectedIdentity, 'Quarantine tree directory', operations);
  const canonicalPath = await operations.realpath(path);
  assertCanonicalContained(canonicalQuarantine, canonicalPath, true);
  await assertRemovalAnchor(anchor, operations);
  await assertUnchangedDirectory(path, expectedIdentity, 'Quarantine tree directory', operations);
  for (const name of await operations.readdir(path)) {
    if (!name || name === '.' || name === '..' || basename(name) !== name) {
      throw new Error('MANAGED_HISTORY_PATH_INVALID: Directory entry name is unsafe.');
    }
    const child = resolve(path, name);
    assertCanonicalDirectChild(path, child);
    await assertRemovalAnchor(anchor, operations);
    const childStat = await operations.lstat(child);
    const childIdentity = historyIdentity(childStat);
    if (childStat.isSymbolicLink()) {
      await assertRemovalAnchor(anchor, operations);
      const unchangedLink = await operations.lstat(child);
      assertSameHistoryIdentity(unchangedLink, childIdentity, 'Quarantine link');
      if (!unchangedLink.isSymbolicLink()) {
        throw new Error('MANAGED_HISTORY_IDENTITY_CHANGED: Quarantine link type changed.');
      }
      await operations.unlink(child);
      continue;
    }
    if (childIdentity.dev !== anchor.quarantineIdentity.dev) {
      throw new Error('MANAGED_HISTORY_REPARSE_REJECTED: Quarantine entry crosses a filesystem or mount boundary.');
    }
    if (childStat.isDirectory()) {
      await removeDirectoryTreeNoFollow(child, canonicalQuarantine, childIdentity, anchor, operations);
      continue;
    }
    await assertRemovalAnchor(anchor, operations);
    const canonicalChild = await operations.realpath(child);
    assertCanonicalContained(canonicalQuarantine, canonicalChild);
    await assertRemovalAnchor(anchor, operations);
    const unchangedChild = await operations.lstat(child);
    assertSameHistoryIdentity(unchangedChild, childIdentity, 'Quarantine file');
    if (unchangedChild.isSymbolicLink() || unchangedChild.isDirectory()) {
      throw new Error('MANAGED_HISTORY_IDENTITY_CHANGED: Quarantine file type changed.');
    }
    await assertRemovalAnchor(anchor, operations);
    await operations.unlink(child);
  }
  await assertRemovalAnchor(anchor, operations);
  await assertUnchangedDirectory(path, expectedIdentity, 'Quarantine tree directory', operations);
  await operations.rmdir(path);
}

async function assertRemovalAnchor(
  anchor: {
    appDataDir: string;
    appDataIdentity: ManagedHistoryIdentity;
    familyRoot: string;
    rootIdentity: ManagedHistoryIdentity;
    quarantinePath: string;
    quarantineIdentity: ManagedHistoryIdentity;
  },
  operations: ManagedHistoryFileOperations,
): Promise<void> {
  await assertUnchangedDirectory(anchor.appDataDir, anchor.appDataIdentity, 'Managed app data root', operations);
  await assertUnchangedDirectory(anchor.familyRoot, anchor.rootIdentity, 'Managed family root', operations);
  await assertUnchangedDirectory(
    anchor.quarantinePath,
    anchor.quarantineIdentity,
    'Managed quarantine directory',
    operations,
  );
}

export async function removeQuarantineTreeNoFollow(
  staged: StagedManagedHistoryDirectory,
  overrides: Partial<ManagedHistoryFileOperations> = {},
): Promise<void> {
  const operations = managedHistoryFileOperations(overrides);
  const { canonicalQuarantine } = await validateStagedQuarantine(staged, operations);
  const anchor = {
    appDataDir: staged.appDataDir,
    appDataIdentity: parseHistoryIdentity(staged.appDataIdentityJson),
    familyRoot: staged.familyRoot,
    rootIdentity: parseHistoryIdentity(staged.rootIdentityJson),
    quarantinePath: staged.quarantinePath,
    quarantineIdentity: parseHistoryIdentity(staged.quarantineIdentityJson),
  };
  await removeDirectoryTreeNoFollow(
    staged.quarantinePath,
    canonicalQuarantine,
    anchor.quarantineIdentity,
    anchor,
    operations,
  );
}

export async function deleteManagedHistoryWithQuarantine<T>(
  appDataDir: string,
  family: HistoryFamily,
  managedStorageKey: string | null,
  callbacks: {
    commit: (cleanup: ManagedHistoryDeletionCleanup) => Promise<T>;
    updateCleanup: (cleanupState: 'pending' | 'cleaned' | 'missing', diagnostic: string) => Promise<T>;
  },
  overrides: Partial<ManagedHistoryFileOperations> = {},
): Promise<T> {
  if (managedStorageKey === null) {
    return callbacks.commit({
      cleanupState: 'unmanaged-legacy',
      quarantineName: null,
      quarantineIdentityJson: '{}',
      diagnostic: 'Legacy record has no managed storage key; filesystem cleanup was not attempted.',
    });
  }
  const staged = await stageManagedHistoryDirectory(appDataDir, family, managedStorageKey, overrides);
  if (!staged) {
    return callbacks.commit({
      cleanupState: 'missing',
      quarantineName: null,
      quarantineIdentityJson: '{}',
      diagnostic: 'Managed history directory was already missing; no filesystem cleanup was required.',
    });
  }
  try {
    await callbacks.commit({
      cleanupState: 'pending',
      quarantineName: staged.quarantineName,
      quarantineIdentityJson: staged.quarantineIdentityJson,
      diagnostic: '',
    });
  } catch (error) {
    try {
      await rollbackManagedHistoryDirectory(staged, overrides);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Managed history database commit failed and guarded rollback was refused: ${errorDiagnostic(error)}`,
      );
    }
    throw error;
  }
  try {
    await removeQuarantineTreeNoFollow(staged, overrides);
    return await callbacks.updateCleanup('cleaned', '');
  } catch (error) {
    return callbacks.updateCleanup('pending', `Managed quarantine cleanup failed: ${errorDiagnostic(error)}`);
  }
}

export async function reapHistoryQuarantines(
  appDataDir: string,
  store: ManagedHistoryQuarantineStore,
  overrides: Partial<ManagedHistoryFileOperations> = {},
): Promise<void> {
  const operations = managedHistoryFileOperations(overrides);
  for (const tombstone of await store.listPendingHistoryTombstones()) {
    try {
      if (tombstone.cleanupState !== 'pending' || tombstone.managedStorageKey === null || tombstone.quarantineName === null) {
        throw new Error('MANAGED_HISTORY_QUARANTINE_INVALID: Pending tombstone has no complete managed quarantine metadata.');
      }
      const applicationRoot = resolve(appDataDir);
      const originalPath = resolveManagedHistoryWorkDir(applicationRoot, tombstone.family, tombstone.managedStorageKey);
      const familyRoot = managedHistoryFamilyRoot(applicationRoot, tombstone.family);
      assertQuarantineName(tombstone.managedStorageKey, tombstone.quarantineName);
      const quarantinePath = resolve(familyRoot, tombstone.quarantineName);
      assertCanonicalDirectChild(familyRoot, quarantinePath);
      let applicationStat: ManagedHistoryStats;
      let rootStat: ManagedHistoryStats;
      let applicationIdentity: ManagedHistoryIdentity;
      let rootIdentity: ManagedHistoryIdentity;
      try {
        applicationStat = await operations.lstat(applicationRoot);
        rootStat = await operations.lstat(familyRoot);
        assertManagedDirectory(applicationStat, 'Managed app data root');
        assertManagedDirectory(rootStat, 'Managed family root');
        applicationIdentity = historyIdentity(applicationStat);
        rootIdentity = historyIdentity(rootStat);
        const [canonicalApplication, canonicalRoot] = await Promise.all([
          operations.realpath(applicationRoot),
          operations.realpath(familyRoot),
        ]);
        assertCanonicalDirectChild(canonicalApplication, canonicalRoot);
        await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
        await assertUnchangedDirectory(familyRoot, rootIdentity, 'Managed family root', operations);
      } catch (error) {
        if (isErrno(error, 'ENOENT')) {
          throw new Error('MANAGED_HISTORY_ROOT_UNAVAILABLE: Managed app data or family root is missing; cleanup remains pending.');
        }
        throw error;
      }
      let quarantineStat: ManagedHistoryStats;
      try {
        quarantineStat = await operations.lstat(quarantinePath);
      } catch (error) {
        if (isErrno(error, 'ENOENT')) {
          try {
            await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
            await assertUnchangedDirectory(familyRoot, rootIdentity, 'Managed family root', operations);
            const [canonicalApplication, canonicalRoot] = await Promise.all([
              operations.realpath(applicationRoot),
              operations.realpath(familyRoot),
            ]);
            assertCanonicalDirectChild(canonicalApplication, canonicalRoot);
            await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
            await assertUnchangedDirectory(familyRoot, rootIdentity, 'Managed family root', operations);
          } catch (anchorError) {
            if (isErrno(anchorError, 'ENOENT')) {
              throw new Error('MANAGED_HISTORY_ROOT_UNAVAILABLE: Managed app data or family root disappeared; cleanup remains pending.');
            }
            throw anchorError;
          }
          await store.updateHistoryTombstoneCleanup(
            tombstone.family,
            tombstone.id,
            'missing',
            'Managed quarantine directory is missing; cleanup is terminal.',
          );
          continue;
        }
        throw error;
      }
      assertManagedDirectory(quarantineStat, 'Managed quarantine directory');
      const staged: StagedManagedHistoryDirectory = {
        family: tombstone.family,
        managedStorageKey: tombstone.managedStorageKey,
        appDataDir: applicationRoot,
        appDataIdentityJson: JSON.stringify(applicationIdentity),
        familyRoot,
        rootIdentityJson: JSON.stringify(rootIdentity),
        originalPath,
        quarantineName: tombstone.quarantineName,
        quarantinePath,
        quarantineIdentityJson: tombstone.quarantineIdentityJson,
      };
      await removeQuarantineTreeNoFollow(staged, overrides);
      await store.updateHistoryTombstoneCleanup(tombstone.family, tombstone.id, 'cleaned', '');
    } catch (error) {
      await store.updateHistoryTombstoneCleanup(
        tombstone.family,
        tombstone.id,
        'pending',
        `Managed quarantine reaper refused cleanup: ${errorDiagnostic(error)}`,
      );
    }
  }
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
  const candidateCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.managedStorageKey !== null && row.managedStorageKey !== undefined) continue;
    const candidateKey = `${row.family}\0${sqliteNoCaseFold(row.id)}`;
    candidateCounts.set(candidateKey, (candidateCounts.get(candidateKey) ?? 0) + 1);
  }
  let migrated = 0;
  for (const row of rows) {
    if (row.managedStorageKey !== null && row.managedStorageKey !== undefined) continue;
    if (candidateCounts.get(`${row.family}\0${sqliteNoCaseFold(row.id)}`) !== 1) continue;
    const legacyWorkDir = await resolveLegacyManagedHistoryWorkDir(appDataDir, row.family, row.id);
    if (!legacyWorkDir) continue;
    resolveManagedHistoryWorkDir(appDataDir, row.family, row.id);
    if (await persist(row.family, row.id, row.id)) migrated += 1;
  }
  return migrated;
}

function sqliteNoCaseFold(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

export async function resolveLegacyManagedHistoryWorkDir(
  appDataDir: string,
  family: HistoryFamily,
  businessId: string,
): Promise<string | null> {
  if (!isGovernanceSafeStorageKey(businessId)) return null;
  const applicationRoot = resolve(appDataDir);
  const root = managedHistoryFamilyRoot(applicationRoot, family);
  const candidate = resolve(root, businessId);
  const operations = managedHistoryFileOperations();
  try {
    assertContainedChild(root, candidate);
    const [applicationStat, rootStat, candidateStat] = await Promise.all([
      operations.lstat(applicationRoot),
      operations.lstat(root),
      operations.lstat(candidate),
    ]);
    assertManagedDirectory(applicationStat, 'Managed app data root');
    assertManagedDirectory(rootStat, 'Managed family root');
    assertManagedDirectory(candidateStat, 'Legacy managed history directory');
    const applicationIdentity = historyIdentity(applicationStat);
    const rootIdentity = historyIdentity(rootStat);
    const candidateIdentity = historyIdentity(candidateStat);
    const [canonicalApplication, canonicalRoot, canonicalCandidate] = await Promise.all([
      operations.realpath(applicationRoot),
      operations.realpath(root),
      operations.realpath(candidate),
    ]);
    assertCanonicalDirectChild(canonicalApplication, canonicalRoot);
    assertCanonicalDirectChild(canonicalRoot, canonicalCandidate);
    await assertUnchangedDirectory(applicationRoot, applicationIdentity, 'Managed app data root', operations);
    await assertUnchangedDirectory(root, rootIdentity, 'Managed family root', operations);
    await assertUnchangedDirectory(candidate, candidateIdentity, 'Legacy managed history directory', operations);
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
