import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { llmEndpoint, resolveLlmProtocol } from '../src/shared/llm-protocol';
import type { LlmConfig } from '../src/shared/types';
import { lemoCapabilityProfileSchema, type LemoCapabilityProfile } from '../src/shared/lemo-provider-capabilities';

export const capabilityHash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function lemoCapabilityIdentity(config: LlmConfig, allowLoopbackTestProvider = false) {
  let parameters: unknown;
  try { parameters = JSON.parse(config.requestParamsJson?.trim() || '{}'); } catch { throw new Error('LEMO_CAPABILITY_CONFIG_JSON'); }
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('LEMO_CAPABILITY_CONFIG_JSON');
  const endpoint = llmEndpoint(config);
  const url = new URL(endpoint);
  const testLoopback = allowLoopbackTestProvider && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !testLoopback)) throw new Error('LEMO_CAPABILITY_ENDPOINT');
  if (!config.model.trim() || config.model.length > 256 || /[\r\n]/.test(config.model)) throw new Error('LEMO_CAPABILITY_MODEL');
  const protocol = resolveLlmProtocol(config);
  const configurationHash = capabilityHash(canonical({ version: 1, provider: config.provider, profileId: config.id ?? '', protocol, endpoint,
    model: config.model.trim(), parameters, timeoutMs: config.timeoutMs ?? 180000, proxy: config.proxyUrl ?? '', credential: capabilityHash(config.apiKey) }));
  return { fingerprint: configurationHash, configurationHash, endpoint, protocol, model: config.model.trim() };
}
const safeHash = (s: string) => { if (!/^[a-f0-9]{64}$/.test(s)) throw new Error('LEMO_CAPABILITY_FINGERPRINT'); return s; };
const safeId = (s: string) => { if (!/^[A-Za-z0-9_-]{8,100}$/.test(s)) throw new Error('LEMO_CAPABILITY_TEST_ID'); return s; };
async function readJson(path: string) {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw new Error('LEMO_CAPABILITY_STORE_INVALID'); return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
async function atomic(path: string, value: unknown) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, path); } finally { await rm(temporary, { force: true }); }
}
/** Host-owned metadata only: never stores credentials, prompts, images or provider response text. */
export class LemoCapabilityStore {
  constructor(readonly directory: string) {}
  async prepare(fingerprint: string) {
    const directory = join(this.directory, safeHash(fingerprint));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const path of [this.directory, directory]) { const st = await lstat(path); if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('LEMO_CAPABILITY_STORE_INVALID'); }
    return directory;
  }
  async read(fingerprint: string, testId: string): Promise<LemoCapabilityProfile | null> {
    const raw = await readJson(join(this.directory, safeHash(fingerprint), safeId(testId) + '.json'));
    if (!raw) return null;
    const p = lemoCapabilityProfileSchema.parse(raw);
    if (p.fingerprint !== fingerprint || p.testId !== testId) throw new Error('LEMO_CAPABILITY_STORE_INVALID');
    // A sent request left by a crash is never a successful test or permission to resend it.
    if (p.status === 'running') return { ...p, status: 'interrupted' };
    return p;
  }
  async latest(fingerprint: string) {
    const index = await readJson(join(this.directory, safeHash(fingerprint), 'latest.json'));
    if (!index) return null;
    if (typeof index.testId !== 'string') throw new Error('LEMO_CAPABILITY_STORE_INVALID');
    return this.read(fingerprint, index.testId);
  }
  async save(profile: LemoCapabilityProfile) {
    const p = lemoCapabilityProfileSchema.parse(profile);
    const directory = await this.prepare(p.fingerprint);
    await atomic(join(directory, safeId(p.testId) + '.json'), p);
    await atomic(join(directory, 'latest.json'), { testId: p.testId });
  }
  async lock(fingerprint: string) {
    const directory = await this.prepare(fingerprint);
    const path = join(directory, 'active.lock');
    let handle;
    try { handle = await open(path, 'wx', 0o600); } catch {
      // Only release a dead process lock. Interrupted request records remain and are never replayed.
      const owner = await readJson(path);
      if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) throw new Error('LEMO_CAPABILITY_TEST_LOCKED');
      try { process.kill(owner.pid, 0); throw new Error('LEMO_CAPABILITY_TEST_LOCKED'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('LEMO_CAPABILITY_TEST_LOCKED'); }
      await rm(path);
      try { handle = await open(path, 'wx', 0o600); } catch { throw new Error('LEMO_CAPABILITY_TEST_LOCKED'); }
    }
    await handle.writeFile(JSON.stringify({ pid: process.pid }), 'utf8');
    return async () => { await handle.close(); await rm(path, { force: true }); };
  }
}
