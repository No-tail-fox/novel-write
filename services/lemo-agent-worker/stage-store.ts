import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { acquireLemoLedgerOwner, inspectLemoLedgerOwner, recoverLemoLedgerOwner, rejectLedgerLinks,
  type LemoLedgerOwnerLease, type LemoLedgerOwnerSnapshot } from './ledger-owner';

export type LemoStageStatus = 'ready' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
export interface LemoStageStoreOptions {
  directory: string; runId: string; stageId: string; inputFingerprint: string; configFingerprint: string;
  projectDirectory?: string;
}
export interface LemoStageArtifact { path: string; sha256: string; byteLength: number }
export interface LemoStageToolEvent {
  version: 1; operationId: string; tool: string; phase: 'started' | 'completed' | 'failed';
  argumentsSha256: string; at: string; resultSha256?: string; resultBytes?: number; errorCode?: string; sideEffectApplied?: boolean;
}
export interface LemoStageSnapshot {
  version: 1; runId: string; stageId: string; inputFingerprint: string; configFingerprint: string;
  projectDirectory: string; status: LemoStageStatus; attempt: number; revision: number;
  sessionId?: string; lastAction?: 'start' | 'resume'; resultSubtype?: string;
  artifacts: LemoStageArtifact[]; toolEvents: LemoStageToolEvent[]; pendingToolOperations: number;
  /** A successful SDK result and file hashes never establish delivery acceptance. */
  deliveryStatus: 'unverified'; createdAt: string; updatedAt: string;
}
export interface LemoStageCompletion {
  status: 'completed' | 'failed' | 'cancelled' | 'unknown'; resultSubtype?: string;
  /** Relative file paths under the immutable projectDirectory, never caller-supplied hashes. */
  artifacts?: string[];
}
export interface LemoStageOwnerInspection {
  owner: LemoLedgerOwnerSnapshot; ownerFingerprint: string; stateFingerprint: string; snapshot: LemoStageSnapshot;
}
type Identity = Pick<LemoStageSnapshot, 'version' | 'runId' | 'stageId' | 'inputFingerprint' | 'configFingerprint' | 'projectDirectory' | 'createdAt'>;
type Prepared = Required<LemoStageStoreOptions>;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const LABEL = /^[A-Za-z0-9_.:-]{1,160}$/;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_EVENTS = 5000;
const RESUMABLE = new Set(['error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries']);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const dateValid = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function fail(reason: string): never { throw new Error('LEMO_STAGE_' + reason); }
function exactKeys(value: object, required: string[], optional: string[] = []) {
  const keys = Object.keys(value);
  return required.every(key => keys.includes(key)) && keys.every(key => required.includes(key) || optional.includes(key));
}
function prepare(options: LemoStageStoreOptions): Prepared {
  if (!options || typeof options.directory !== 'string' || !isAbsolute(options.directory) || /[\x00-\x1f]/.test(options.directory)
    || !ID.test(options.runId) || !ID.test(options.stageId) || !HASH.test(options.inputFingerprint) || !HASH.test(options.configFingerprint)
    || (options.projectDirectory !== undefined && (typeof options.projectDirectory !== 'string'
      || !isAbsolute(options.projectDirectory) || /[\x00-\x1f]/.test(options.projectDirectory)))) fail('OPTIONS');
  return { ...options, directory: resolve(options.directory), projectDirectory: resolve(options.projectDirectory ?? join(options.directory, 'project')) };
}
function artifactPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 2048 && !isAbsolute(path)
    && !/[\\:\x00-\x1f]/.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
function assertEvent(value: LemoStageToolEvent) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !ID.test(value.operationId) || !LABEL.test(value.tool)
    || !['started', 'completed', 'failed'].includes(value.phase) || !HASH.test(value.argumentsSha256) || !dateValid(value.at)
    || (value.resultSha256 !== undefined && !HASH.test(value.resultSha256))
    || (value.resultBytes !== undefined && (!Number.isSafeInteger(value.resultBytes) || value.resultBytes < 0))
    || (value.errorCode !== undefined && !LABEL.test(value.errorCode))
    || (value.sideEffectApplied !== undefined && typeof value.sideEffectApplied !== 'boolean')
    || !exactKeys(value, ['version', 'operationId', 'tool', 'phase', 'argumentsSha256', 'at'], ['resultSha256', 'resultBytes', 'errorCode', 'sideEffectApplied'])
    || (value.phase === 'started' && (value.resultSha256 !== undefined || value.resultBytes !== undefined || value.errorCode !== undefined || value.sideEffectApplied !== undefined))
    || (value.phase === 'completed' && value.errorCode !== undefined)) fail('TOOL_EVENT');
}
function pendingOperations(events: LemoStageToolEvent[]) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) fail('TOOL_EVENTS');
  const operations = new Map<string, { start: LemoStageToolEvent; terminal?: LemoStageToolEvent }>();
  for (const event of events) {
    assertEvent(event);
    const previous = operations.get(event.operationId);
    if (event.phase === 'started') {
      if (previous) fail('TOOL_REPLAY');
      operations.set(event.operationId, { start: event });
    } else {
      if (!previous || previous.terminal || previous.start.tool !== event.tool
        || previous.start.argumentsSha256 !== event.argumentsSha256 || Date.parse(event.at) < Date.parse(previous.start.at)) fail('TOOL_TRANSITION');
      previous.terminal = event;
    }
  }
  return [...operations.values()].filter(({ terminal }) => !terminal || (terminal.phase === 'failed' && terminal.sideEffectApplied)).length;
}
function assertIdentity(identity: Identity, options?: Prepared) {
  if (!identity || typeof identity !== 'object' || identity.version !== 1 || !ID.test(identity.runId) || !ID.test(identity.stageId)
    || !HASH.test(identity.inputFingerprint) || !HASH.test(identity.configFingerprint) || !dateValid(identity.createdAt)
    || typeof identity.projectDirectory !== 'string' || !isAbsolute(identity.projectDirectory)
    || !exactKeys(identity, ['version', 'runId', 'stageId', 'inputFingerprint', 'configFingerprint', 'projectDirectory', 'createdAt'])) fail('IDENTITY');
  if (options && ['runId', 'stageId', 'inputFingerprint', 'configFingerprint', 'projectDirectory'].some(
    key => identity[key as keyof Identity] !== options[key as keyof Prepared])) fail('IDENTITY_CONFLICT');
}
function assertSnapshot(value: LemoStageSnapshot, identity: Identity) {
  if (!value || typeof value !== 'object' || !exactKeys(value,
    ['version', 'runId', 'stageId', 'inputFingerprint', 'configFingerprint', 'projectDirectory', 'status', 'attempt', 'revision',
      'artifacts', 'toolEvents', 'pendingToolOperations', 'deliveryStatus', 'createdAt', 'updatedAt'], ['sessionId', 'lastAction', 'resultSubtype'])
    || Object.keys(identity).some(key => value[key as keyof LemoStageSnapshot] !== identity[key as keyof Identity])
    || !['ready', 'running', 'completed', 'failed', 'cancelled', 'unknown'].includes(value.status)
    || !Number.isSafeInteger(value.attempt) || value.attempt < 0 || !Number.isSafeInteger(value.revision) || value.revision < value.attempt
    || !dateValid(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    || (value.sessionId !== undefined && !ID.test(value.sessionId))
    || (value.resultSubtype !== undefined && !LABEL.test(value.resultSubtype))
    || (value.attempt === 0 ? value.status !== 'ready' || value.lastAction !== undefined
      : value.status === 'ready' || !['start', 'resume'].includes(value.lastAction ?? ''))
    || (value.status === 'running' && value.resultSubtype !== undefined)
    || (value.status === 'completed' && !value.sessionId) || value.deliveryStatus !== 'unverified'
    || !Array.isArray(value.artifacts) || value.artifacts.length > 256) fail('CORRUPT');
  const paths = new Set<string>();
  for (const artifact of value.artifacts) {
    if (!artifact || !artifactPath(artifact.path) || !HASH.test(artifact.sha256) || !Number.isSafeInteger(artifact.byteLength)
      || artifact.byteLength < 0 || !exactKeys(artifact, ['path', 'sha256', 'byteLength']) || paths.has(artifact.path)) fail('CORRUPT');
    paths.add(artifact.path);
  }
  if (pendingOperations(value.toolEvents) !== value.pendingToolOperations
    || (value.pendingToolOperations > 0 && !['running', 'unknown'].includes(value.status))) fail('CORRUPT');
}
async function readRegular(path: string, maximum: number): Promise<Buffer> {
  await rejectLedgerLinks(path);
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maximum) fail('FILE');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev) fail('FILE');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.nlink !== 1) fail('CHANGED');
    return bytes;
  } finally { await handle.close(); }
}
function parseJson<T>(bytes: Buffer): T {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T; }
  catch { return fail('CORRUPT'); }
}
async function readState(directory: string, options?: Prepared) {
  const identityBytes = await readRegular(join(directory, 'stage-identity.json'), 8192);
  const identity = parseJson<Identity>(identityBytes); assertIdentity(identity, options);
  const stateBytes = await readRegular(join(directory, 'stage.json'), MAX_STATE_BYTES);
  const snapshot = parseJson<LemoStageSnapshot>(stateBytes); assertSnapshot(snapshot, identity);
  return { snapshot, identity, identityFingerprint: digest(identityBytes), stateFingerprint: digest(stateBytes) };
}
async function syncDirectory(directory: string) {
  let handle;
  try { handle = await open(directory, 'r'); await handle.sync(); }
  catch (error) {
    // Windows does not expose directory fsync through Node; each data file is
    // still flushed before the same-directory atomic rename.
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  } finally { await handle?.close(); }
}
async function assertMissing(path: string) {
  await rejectLedgerLinks(path);
  try { await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  fail('EXISTS');
}
async function atomicWrite(directory: string, name: string, bytes: Buffer, assertCurrent: () => Promise<void>) {
  if (bytes.length > MAX_STATE_BYTES) fail('STATE_LIMIT');
  await assertCurrent();
  const pending = join(directory, '.' + name + '-' + randomUUID() + '.pending');
  const handle = await open(pending, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await assertCurrent();
  await rename(pending, join(directory, name));
  await syncDirectory(directory);
}
async function collectArtifacts(projectDirectory: string, paths: string[]): Promise<LemoStageArtifact[]> {
  if (!Array.isArray(paths) || paths.length > 256 || new Set(paths).size !== paths.length) fail('ARTIFACTS');
  await rejectLedgerLinks(projectDirectory);
  if (!(await lstat(projectDirectory)).isDirectory()) fail('PROJECT_DIRECTORY');
  const artifacts: LemoStageArtifact[] = [];
  for (const path of paths) {
    if (!artifactPath(path)) fail('ARTIFACT_PATH');
    const absolute = resolve(projectDirectory, path);
    const part = relative(projectDirectory, absolute);
    if (!part || isAbsolute(part) || part === '..' || part.startsWith('..' + sep)) fail('ARTIFACT_PATH');
    await rejectLedgerLinks(absolute);
    const before = await lstat(absolute);
    if (!before.isFile() || before.nlink !== 1) fail('ARTIFACT_FILE');
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev) fail('ARTIFACT_FILE');
      const hash = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024); let byteLength = 0;
      for (;;) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); byteLength += bytesRead; }
      const after = await handle.stat(); const named = await lstat(absolute);
      if (byteLength !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.nlink !== 1
        || named.ino !== before.ino || named.dev !== before.dev || !named.isFile() || named.nlink !== 1) fail('ARTIFACT_CHANGED');
      artifacts.push({ path, sha256: hash.digest('hex'), byteLength });
    } finally { await handle.close(); }
  }
  return artifacts;
}

/** Private stage state, separate from model billing receipts. File modes require
 * caller-enforced Windows ACLs. Hashing artifacts records evidence, never acceptance.
 * Unknown executions/tool effects require external reconciliation and cannot resume.
 */
export class LemoStageStore {
  private queue: Promise<void> = Promise.resolve();
  private poisoned = false;
  private closing = false;
  private closed = false;
  private closePromise?: Promise<void>;
  private constructor(private readonly options: Prepared, private readonly owner: LemoLedgerOwnerLease,
    private state: LemoStageSnapshot, private stateFingerprint: string, private readonly identityFingerprint: string) {}

  static async open(input: LemoStageStoreOptions): Promise<LemoStageStore> {
    const options = prepare(input);
    await rejectLedgerLinks(options.directory); await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const owners = join(options.directory, 'stage-owner'); await rejectLedgerLinks(owners); await mkdir(owners, { recursive: true, mode: 0o700 });
    const owner = await acquireLemoLedgerOwner(owners);
    try {
      let exists = true;
      try { await lstat(join(options.directory, 'stage-identity.json')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false; }
      if (!exists) {
        await assertMissing(join(options.directory, 'stage.json'));
        const createdAt = new Date().toISOString();
        const identity: Identity = { version: 1, runId: options.runId, stageId: options.stageId,
          inputFingerprint: options.inputFingerprint, configFingerprint: options.configFingerprint, projectDirectory: options.projectDirectory, createdAt };
        await atomicWrite(options.directory, 'stage-identity.json', Buffer.from(JSON.stringify(identity)), async () => {
          await owner.assertOwned(); await assertMissing(join(options.directory, 'stage-identity.json'));
        });
        const snapshot: LemoStageSnapshot = { ...identity, status: 'ready', attempt: 0, revision: 0, artifacts: [],
          toolEvents: [], pendingToolOperations: 0, deliveryStatus: 'unverified', updatedAt: createdAt };
        await atomicWrite(options.directory, 'stage.json', Buffer.from(JSON.stringify(snapshot)), async () => {
          await owner.assertOwned(); await assertMissing(join(options.directory, 'stage.json'));
        });
      }
      return await this.loadOwned(options, owner);
    } catch (error) { await owner.release().catch(() => undefined); throw error; }
  }
  static async inspectInterruptedOwner(directory: string): Promise<LemoStageOwnerInspection> {
    if (!isAbsolute(directory)) fail('OPTIONS');
    const owner = await inspectLemoLedgerOwner(join(directory, 'stage-owner'));
    const { snapshot, stateFingerprint } = await readState(directory);
    return { owner, ownerFingerprint: owner.fingerprint, stateFingerprint, snapshot };
  }
  static async recoverInterruptedOwner(input: LemoStageStoreOptions, expected: { ownerFingerprint: string; stateFingerprint: string }): Promise<LemoStageStore> {
    const options = prepare(input);
    if (!expected || !HASH.test(expected.ownerFingerprint) || !HASH.test(expected.stateFingerprint)) fail('RECOVERY_OPTIONS');
    const owner = await recoverLemoLedgerOwner(join(options.directory, 'stage-owner'), expected.ownerFingerprint, async () => {
      const state = await readState(options.directory, options);
      if (state.stateFingerprint !== expected.stateFingerprint) fail('CHANGED');
    });
    try { return await this.loadOwned(options, owner); }
    catch (error) { await owner.release().catch(() => undefined); throw error; }
  }
  private static async loadOwned(options: Prepared, owner: LemoLedgerOwnerLease) {
    const loaded = await readState(options.directory, options);
    const store = new LemoStageStore(options, owner, loaded.snapshot, loaded.stateFingerprint, loaded.identityFingerprint);
    if (loaded.snapshot.status === 'running') await store.persist(store.next({ status: 'unknown', resultSubtype: 'interrupted_owner' }));
    return store;
  }
  snapshot(): LemoStageSnapshot { return structuredClone(this.state); }
  private next(changes: Partial<LemoStageSnapshot>): LemoStageSnapshot {
    return { ...this.snapshot(), ...changes, revision: this.state.revision + 1, updatedAt: new Date().toISOString() };
  }
  private async assertDisk() {
    await this.owner.assertOwned();
    if (digest(await readRegular(join(this.options.directory, 'stage-identity.json'), 8192)) !== this.identityFingerprint
      || digest(await readRegular(join(this.options.directory, 'stage.json'), MAX_STATE_BYTES)) !== this.stateFingerprint) fail('CHANGED');
  }
  private async persist(next: LemoStageSnapshot) {
    const bytes = Buffer.from(JSON.stringify(next), 'utf8');
    try { await atomicWrite(this.options.directory, 'stage.json', bytes, () => this.assertDisk()); }
    catch (error) { this.poisoned = true; throw error; }
    this.state = next; this.stateFingerprint = digest(bytes);
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing || this.closed) return Promise.reject(new Error('LEMO_STAGE_UNAVAILABLE'));
    const result = this.queue.then(async () => { if (this.poisoned) fail('UNAVAILABLE'); return action(); });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  startAttempt(action: 'start' | 'resume'): Promise<LemoStageSnapshot> {
    return this.enqueue(async () => {
      if (action !== 'start' && action !== 'resume') fail('ACTION');
      if (action === 'start') {
        if (this.state.status !== 'ready' || this.state.attempt !== 0) fail('START_ALREADY_ATTEMPTED');
      } else if (!this.state.sessionId || this.state.pendingToolOperations > 0
        || !(this.state.status === 'cancelled' || (this.state.status === 'failed' && RESUMABLE.has(this.state.resultSubtype ?? '')))) fail('RESUME_BLOCKED');
      const next = this.next({ status: 'running', attempt: this.state.attempt + 1, lastAction: action, artifacts: [] });
      delete next.resultSubtype;
      await this.persist(next); return this.snapshot();
    });
  }
  recordSession(sessionId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!ID.test(sessionId)) fail('SESSION_ID');
      if (this.state.sessionId && this.state.sessionId !== sessionId) fail('SESSION_CHANGED');
      if (this.state.sessionId === sessionId) return;
      if (!['ready', 'running'].includes(this.state.status)) fail('SESSION_STATE');
      await this.persist(this.next({ sessionId }));
    });
  }
  recordToolEvent(event: LemoStageToolEvent): Promise<void> {
    const copy = structuredClone(event);
    return this.enqueue(async () => {
      assertEvent(copy);
      if (this.state.status !== 'running' && !(this.state.status === 'unknown' && copy.phase !== 'started')) fail('TOOL_STATE');
      const toolEvents = [...this.state.toolEvents, copy]; const pendingToolOperations = pendingOperations(toolEvents);
      const changes: Partial<LemoStageSnapshot> = { toolEvents, pendingToolOperations };
      if (copy.phase === 'failed' && copy.sideEffectApplied) Object.assign(changes, { status: 'unknown', resultSubtype: 'tool_side_effect_unconfirmed' });
      await this.persist(this.next(changes));
    }).catch(error => { this.poisoned = true; throw error; });
  }
  complete(input: LemoStageCompletion): Promise<LemoStageSnapshot> {
    const completion = structuredClone(input);
    return this.enqueue(async () => {
      if (!completion || !['completed', 'failed', 'cancelled', 'unknown'].includes(completion.status)
        || (completion.resultSubtype !== undefined && !LABEL.test(completion.resultSubtype))
        || !exactKeys(completion, ['status'], ['resultSubtype', 'artifacts'])) fail('COMPLETION');
      if (this.state.status !== 'running' && !(this.state.status === 'unknown' && completion.status === 'unknown')) fail('COMPLETION_STATE');
      if (this.state.pendingToolOperations > 0 && completion.status !== 'unknown') fail('TOOL_UNRESOLVED');
      if (completion.status === 'completed' && !this.state.sessionId) fail('SESSION_REQUIRED');
      const artifacts = completion.artifacts === undefined ? [] : await collectArtifacts(this.options.projectDirectory, completion.artifacts);
      const next = this.next({ status: completion.status, artifacts });
      if (completion.resultSubtype !== undefined) next.resultSubtype = completion.resultSubtype;
      else delete next.resultSubtype;
      await this.persist(next); return this.snapshot();
    });
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      await this.queue;
      try {
        if (!this.poisoned && this.state.status === 'running') await this.persist(this.next({ status: 'unknown', resultSubtype: 'interrupted_close' }));
      } finally { this.closed = true; await this.owner.release(); }
    })();
    return this.closePromise;
  }
}
