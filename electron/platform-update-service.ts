import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { PlatformUpdateState, UpdateManifest } from '../src/shared/commercial-contract';

export function canonicalDocument(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDocument).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalDocument(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
function compareVersion(a: string, b: string): number {
  const left = versionPattern.exec(a), right = versionPattern.exec(b);
  if (!left || !right) throw new Error('UPDATE_VERSION_INVALID');
  for (let i = 1; i <= 3; i++) { const l = BigInt(left[i]), r = BigInt(right[i]); if (l !== r) return l > r ? 1 : -1; }
  if (!left[4] && !right[4]) return 0;
  if (!left[4]) return 1;
  if (!right[4]) return -1;
  const l = left[4].split('.'), r = right[4].split('.');
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    if (l[i] === undefined) return -1; if (r[i] === undefined) return 1; if (l[i] === r[i]) continue;
    const ln = /^\d+$/.test(l[i]), rn = /^\d+$/.test(r[i]);
    if (ln && rn) return BigInt(l[i]) > BigInt(r[i]) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return l[i] > r[i] ? 1 : -1;
  }
  return 0;
}
const manifestSchema = z.object({ version: z.string().regex(versionPattern), platform: z.enum(['win32', 'darwin', 'linux']), arch: z.enum(['x64', 'arm64']), channel: z.enum(['stable', 'beta']), publishedAt: z.string().datetime({ offset: true }), releaseNotes: z.string().max(50000), url: z.string().url().max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().positive().max(8 * 1024 ** 3), minAppVersion: z.string().regex(versionPattern), keyId: z.string().min(1).max(128), signature: z.string().min(1).max(256) }).strict();

export interface VerifiedDownloadInput { response: Response; destination: string; size: number; sha256: string; assertCurrent?: () => void }
/** Stream into a private temp file, verify exact byte count and digest, then publish atomically. */
export async function saveVerifiedDownload(input: VerifiedDownloadInput): Promise<void> {
  const { response, destination, size, sha256 } = input;
  if (!response.ok || !response.body) throw new Error('DOWNLOAD_FAILED: 下载失败。');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== size)) throw new Error('DOWNLOAD_SIZE_MISMATCH: 文件长度不匹配。');
  const temp = `${destination}.${randomUUID()}.part`;
  const output = await open(temp, 'wx', 0o600);
  const reader = response.body.getReader();
  const digest = createHash('sha256'); let written = 0;
  try {
    while (true) {
      input.assertCurrent?.();
      const part = await reader.read();
      if (part.done) break;
      written += part.value.byteLength;
      if (written > size) throw new Error('DOWNLOAD_SIZE_MISMATCH: 文件超出声明大小。');
      digest.update(part.value); await output.writeFile(part.value);
    }
    input.assertCurrent?.();
    if (written !== size || digest.digest('hex') !== sha256) throw new Error('DOWNLOAD_HASH_MISMATCH: 文件完整性校验失败。');
    await output.sync(); await output.close();
    input.assertCurrent?.(); await rename(temp, destination);
  } catch (error) { await reader.cancel().catch(() => {}); await output.close().catch(() => {}); await rm(temp, { force: true }).catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
async function verifyFile(path: string, manifest: UpdateManifest): Promise<void> {
  const file = await stat(path);
  if (!file.isFile() || file.size !== manifest.size) throw new Error('UPDATE_FILE_INVALID: 下载文件已改变，请重新下载。');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  if (hash.digest('hex') !== manifest.sha256) throw new Error('UPDATE_FILE_INVALID: 下载文件已改变，请重新下载。');
}
export interface PlatformUpdateDependencies {
  dataDir: string; appVersion: string; platform?: string; arch?: string;
  fetchImpl?: typeof fetch; getManifest(channel: 'stable' | 'beta'): Promise<unknown>;
  updatePublicKeys?: Record<string, string>; allowedDownloadOrigins?: string[];
  allowInsecureLoopback?: boolean; getActiveTaskCount?: () => number | Promise<number>;
  openPath?: (path: string) => Promise<string | void>;
}
export function createPlatformUpdateService(options: PlatformUpdateDependencies) {
  const downloadDir = join(options.dataDir, 'updates');
  const knownFile = join(downloadDir, 'known-releases.v1.json');
  const platform = options.platform ?? process.platform, arch = options.arch ?? process.arch;
  let selected: UpdateManifest | undefined;
  let downloaded: string | undefined;
  let known: Partial<Record<'stable' | 'beta', UpdateManifest>> = {};
  let initialized: Promise<void> | undefined;
  let busy: Promise<PlatformUpdateState> | undefined;
  let checks: Promise<unknown> = Promise.resolve();
  const taskCount = async () => Math.max(0, await options.getActiveTaskCount?.() ?? 0);
  const state = async (status: PlatformUpdateState['status'], message: string): Promise<PlatformUpdateState> => ({ status, currentVersion: options.appVersion, manifest: selected, downloadedPath: downloaded, activeTasks: await taskCount(), message });
  const configured = () => Object.keys(options.updatePublicKeys ?? {}).length > 0 && (options.allowedDownloadOrigins?.length ?? 0) > 0;
  function validate(value: unknown, channel: 'stable' | 'beta'): UpdateManifest {
    const manifest = manifestSchema.parse(value);
    if (manifest.platform !== platform || manifest.arch !== arch || manifest.channel !== channel) throw new Error('UPDATE_INCOMPATIBLE: 更新包不适用于当前系统。');
    if (channel === 'stable' && manifest.version.includes('-')) throw new Error('UPDATE_INCOMPATIBLE: 正式通道不能安装预览版本。');
    const key = options.updatePublicKeys?.[manifest.keyId];
    if (!key || createPublicKey(key).asymmetricKeyType !== 'ed25519') throw new Error('UPDATE_KEY_UNKNOWN: 未配置可信更新签名公钥。');
    const { signature, ...payload } = manifest;
    if (!verify(null, Buffer.from(canonicalDocument(payload)), key, Buffer.from(signature, 'base64'))) throw new Error('UPDATE_SIGNATURE_INVALID: 更新签名无效。');
    const url = new URL(manifest.url);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(options.allowInsecureLoopback && loopback && url.protocol === 'http:')) || !options.allowedDownloadOrigins?.includes(url.origin)) throw new Error('UPDATE_ORIGIN_REJECTED: 更新下载来源不受信任。');
    if (compareVersion(options.appVersion, manifest.minAppVersion) < 0) throw new Error('UPDATE_INCOMPATIBLE: 请按发布说明升级到所需基础版本。');
    if (Date.parse(manifest.publishedAt) > Date.now() + 120000) throw new Error('UPDATE_FUTURE_RELEASE');
    return manifest;
  }
  function init(): Promise<void> {
    return initialized ??= (async () => {
      await mkdir(downloadDir, { recursive: true });
      try {
        const stored = z.object({ stable: manifestSchema.optional(), beta: manifestSchema.optional() }).strict().parse(JSON.parse(await readFile(knownFile, 'utf8')));
        for (const channel of ['stable', 'beta'] as const) if (stored[channel]) known[channel] = validate(stored[channel], channel);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('UPDATE_HISTORY_INVALID: 更新记录校验失败。'); }
    })();
  }
  async function performCheck(channel: 'stable' | 'beta'): Promise<PlatformUpdateState> {
    if (!configured()) return state('unconfigured', '尚未配置可信更新签名和下载来源。');
    await init();
    const response = await options.getManifest(channel);
    if (response === null) { selected = undefined; downloaded = undefined; return state('current', '当前没有可用更新。'); }
    const manifest = validate(response, channel);
    if (compareVersion(manifest.version, options.appVersion) <= 0) throw new Error('UPDATE_DOWNGRADE_REJECTED: 拒绝旧版本或重放更新。');
    const previous = known[channel];
    if (previous && (compareVersion(manifest.version, previous.version) < 0 || Date.parse(manifest.publishedAt) < Date.parse(previous.publishedAt) || (manifest.version === previous.version && canonicalDocument(manifest) !== canonicalDocument(previous)))) throw new Error('UPDATE_REPLAY_REJECTED: 更新清单已回退或发生修改。');
    const next = { ...known, [channel]: manifest };
    const temp = `${knownFile}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(next), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await rename(temp, knownFile); }
    catch (error) { await rm(temp, { force: true }).catch(() => {}); throw error; }
    known = next;
    if (selected?.sha256 !== manifest.sha256) downloaded = undefined;
    selected = manifest;
    return state(downloaded ? 'downloaded' : 'available', downloaded ? '完整包已校验，任务完成后可打开所在文件夹。' : '发现已签名更新，可下载完整包后手动升级。');
  }
  function checkUpdate(channel: 'stable' | 'beta'): Promise<PlatformUpdateState> {
    const check = checks.catch(() => {}).then(() => performCheck(channel));
    checks = check; return check;
  }
  async function downloadUpdate(): Promise<PlatformUpdateState> {
    if (busy) return busy;
    busy = (async () => {
      if (!selected) throw new Error('UPDATE_CHECK_REQUIRED: 请先检查更新。');
      const manifest = selected;
      // Recheck withdrawal and signature before each download; caller cannot provide a URL.
      await checkUpdate(manifest.channel);
      if (!selected || canonicalDocument(selected) !== canonicalDocument(manifest)) throw new Error('UPDATE_CHANGED: 更新清单已改变，请重新确认。');
      const url = new URL(manifest.url);
      const extension = url.pathname.toLowerCase().endsWith('.zip') ? '.zip' : '.package';
      const destination = join(downloadDir, `StoryDream-${manifest.version}-${manifest.sha256.slice(0, 16)}${extension}`);
      const response = await (options.fetchImpl ?? fetch)(manifest.url, { redirect: 'error', signal: AbortSignal.timeout(30 * 60 * 1000), headers: { 'Accept-Encoding': 'identity' } });
      await saveVerifiedDownload({ response, destination, size: manifest.size, sha256: manifest.sha256 });
      if (selected?.sha256 !== manifest.sha256) throw new Error('UPDATE_CHANGED');
      downloaded = destination; return state('downloaded', '完整包签名与 SHA-256 已校验；完成当前任务后可打开文件夹手动升级。');
    })();
    try { return await busy; } finally { busy = undefined; }
  }
  async function openUpdateFolder(): Promise<PlatformUpdateState> {
    if (!selected || !downloaded) throw new Error('UPDATE_DOWNLOAD_REQUIRED: 请先下载并校验更新包。');
    if (await taskCount() > 0) return state('blocked', '生成、渲染或导出任务仍在运行，请完成任务后升级。');
    const manifest = selected, path = downloaded;
    await checkUpdate(manifest.channel);
    if (!selected || canonicalDocument(manifest) !== canonicalDocument(selected)) throw new Error('UPDATE_WITHDRAWN: 此更新已撤回或改变。');
    await verifyFile(path, manifest);
    if (await taskCount() > 0) return state('blocked', '任务仍在运行，请完成任务后升级。');
    if (!options.openPath) throw new Error('UPDATE_OPEN_UNAVAILABLE');
    const error = await options.openPath(downloadDir);
    if (error) throw new Error('UPDATE_OPEN_FAILED: 无法打开更新文件夹。');
    return state('downloaded', '已打开更新包文件夹。备份项目后退出软件，再手动升级。');
  }
  return { checkUpdate, downloadUpdate, openUpdateFolder };
}
