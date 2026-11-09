import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { request } from 'node:https';
import type { ClientRequest, IncomingMessage, OutgoingHttpHeaders, RequestOptions } from 'node:http';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CancellationToken, HttpExecutor } from 'builder-util-runtime';
import type { BlockMap } from 'builder-util-runtime/out/blockMapApi';
import { GenericDifferentialDownloader } from 'electron-updater/out/differentialDownloader/GenericDifferentialDownloader';
import type { DifferentialManifest, ReleaseManifest, SignedEnvelope } from '../src/shared/licensing';
import { verifyDifferential, type LicenseTransport } from './license-security';

const MAX_BLOCKMAP = 8 * 1024 ** 2;

export function parseBlockmap(data: Buffer, expectedSize: number): BlockMap {
  if (data.length > MAX_BLOCKMAP) throw new Error('BLOCKMAP_TOO_LARGE');
  const value = JSON.parse(gunzipSync(data, { maxOutputLength: 32 * 1024 ** 2 }).toString('utf8'));
  if (!value || !['1', '2'].includes(value.version) || !Array.isArray(value.files) || !value.files.length || value.files.length > 10000) throw new Error('INVALID_BLOCKMAP');
  let offset = 0, count = 0;
  const names = new Set<string>();
  for (const file of value.files) {
    if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 1024 || names.has(file.name) || file.offset !== offset ||
        !Array.isArray(file.sizes) || !Array.isArray(file.checksums) || !file.sizes.length || file.sizes.length !== file.checksums.length) throw new Error('INVALID_BLOCKMAP');
    names.add(file.name);
    count += file.sizes.length;
    if (count > 262144) throw new Error('BLOCKMAP_TOO_LARGE');
    for (let i = 0; i < file.sizes.length; i++) {
      if (!Number.isSafeInteger(file.sizes[i]) || file.sizes[i] <= 0 || typeof file.checksums[i] !== 'string' ||
          !file.checksums[i].length || file.checksums[i].length > 128) throw new Error('INVALID_BLOCKMAP');
      offset += file.sizes[i];
      if (offset > expectedSize) throw new Error('INVALID_BLOCKMAP_SIZE');
    }
  }
  if (offset !== expectedSize) throw new Error('INVALID_BLOCKMAP_SIZE');
  return value;
}

// Pin electron-updater: this small adapter is the only consumer of its internal engine.
// Never use its Electron transport, default CA store, redirects or multipart ranges.
export class PinnedRangeExecutor extends HttpExecutor<ClientRequest> {
  private readonly active = new Set<ClientRequest>();
  transferred = 0;
  constructor(private readonly transport: LicenseTransport, private readonly filename: string, private readonly size: number,
    private readonly progress: (bytes: number) => void) { super(); }

  createRequest(options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest {
    const url = new URL(`/v1/releases/files/${this.filename}`, this.transport.config.baseUrl);
    const range = /^bytes=(\d+)-(\d+)$/.exec(String((options.headers as OutgoingHttpHeaders | undefined)?.range ?? ''));
    if (options.protocol !== url.protocol || options.hostname !== url.hostname || String(options.port || '443') !== (url.port || '443') ||
        options.path !== url.pathname || !range) throw new Error('INVALID_DIFFERENTIAL_REQUEST');
    const start = Number(range[1]), end = Number(range[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= this.size) throw new Error('INVALID_DIFFERENTIAL_RANGE');
    const req = request(url, {
      method: 'GET', ca: this.transport.config.caPem, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false,
      headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
    }, response => {
      const expected = end - start + 1;
      if (response.statusCode !== 206 || Number(response.headers['content-length']) !== expected ||
          response.headers['content-range'] !== `bytes ${start}-${end}/${this.size}` || response.headers['content-encoding']) {
        req.destroy(new Error('DIFFERENTIAL_RANGE_REJECTED')); return;
      }
      let received = 0;
      response.setTimeout(30000, () => response.destroy(new Error('DIFFERENTIAL_RESPONSE_TIMEOUT')));
      response.on('data', (data: Buffer) => {
        received += data.length;
        if (received > expected) { response.destroy(new Error('DIFFERENTIAL_SIZE_MISMATCH')); return; }
        this.transferred += data.length;
        this.progress(this.transferred);
      });
      callback(response);
    });
    req.setTimeout(15000, () => req.destroy(new Error('DIFFERENTIAL_CONNECTION_TIMEOUT')));
    this.active.add(req);
    req.once('close', () => this.active.delete(req));
    return req;
  }
  close(): void { for (const req of this.active) req.destroy(); this.active.clear(); }
}

async function matches(path: string, manifest: Pick<ReleaseManifest, 'sha256' | 'size'>): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size !== manifest.size) return false;
  const hash = createHash('sha256');
  for await (const data of createReadStream(path)) hash.update(data);
  return hash.digest('hex') === manifest.sha256;
}

async function metadata(transport: LicenseTransport, filename: string, now: number): Promise<DifferentialManifest> {
  const value = await transport.json<{ differential: SignedEnvelope }>(`/v1/releases/differential/${filename}`);
  const result = verifyDifferential(value.differential, transport.config, now);
  if (result.filename !== filename) throw new Error('DIFFERENTIAL_FILENAME_MISMATCH');
  return result;
}

async function blockmap(transport: LicenseTransport, manifest: DifferentialManifest): Promise<BlockMap> {
  const response = await transport.open(`/v1/releases/files/${manifest.filename}.blockmap`);
  try {
    if (response.statusCode !== 200 || Number(response.headers['content-length']) !== manifest.blockmap.size) throw new Error('BLOCKMAP_DOWNLOAD_REJECTED');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const data of response) {
      length += data.length;
      if (length > manifest.blockmap.size) throw new Error('BLOCKMAP_TOO_LARGE');
      chunks.push(Buffer.from(data));
    }
    const buffer = Buffer.concat(chunks);
    if (length !== manifest.blockmap.size || createHash('sha256').update(buffer).digest('hex') !== manifest.blockmap.sha256) throw new Error('BLOCKMAP_HASH_MISMATCH');
    return parseBlockmap(buffer, manifest.size);
  } finally { response.destroy(); }
}

export async function tryDifferentialUpdate(options: {
  transport: LicenseTransport; directory: string; currentVersion: string; release: ReleaseManifest;
  now: number; progress: (bytes: number) => void;
}): Promise<{ transferred: number; reused: number } | null> {
  let temporary: string | undefined;
  let executor: PinnedRangeExecutor | undefined;
  try {
    const { transport, directory, currentVersion, release, now } = options;
    const candidates = (await readdir(directory)).filter(name => name.startsWith(`StoryDream-Setup-${currentVersion}-`) &&
      /^StoryDream-Setup-[0-9.]+-[a-f0-9]{12}\.exe$/.test(name)).sort().slice(0, 4);
    if (!candidates.length) return null;
    const target = await metadata(transport, release.filename, now);
    if (target.sha256 !== release.sha256 || target.size !== release.size || target.version !== release.version || target.sequence !== release.sequence) throw new Error('DIFFERENTIAL_RELEASE_MISMATCH');
    let base: DifferentialManifest | undefined;
    for (const name of candidates) {
      try {
        const candidate = await metadata(transport, name, now);
        if (candidate.version === currentVersion && candidate.sequence < target.sequence && await matches(join(directory, name), candidate)) { base = candidate; break; }
      } catch { /* Missing, withdrawn or altered bases cannot be reused. */ }
    }
    if (!base) return null;
    const oldMap = await blockmap(transport, base), newMap = await blockmap(transport, target);
    temporary = await mkdtemp(join(directory, '.differential-'));
    const output = join(temporary, 'installer.exe');
    executor = new PinnedRangeExecutor(transport, release.filename, release.size, options.progress);
    await new GenericDifferentialDownloader({ size: release.size, sha512: target.sha512 }, executor, {
      oldFile: join(directory, base.filename), newFile: output, newUrl: new URL(`/v1/releases/files/${release.filename}`, transport.config.baseUrl),
      requestHeaders: null, isUseMultipleRangeRequest: false, cancellationToken: new CancellationToken(),
      logger: { info() {}, warn() {}, error() {} },
    }).download(oldMap, newMap);
    if (!await matches(output, release)) throw new Error('DIFFERENTIAL_HASH_MISMATCH');
    await rename(output, join(directory, release.filename));
    return { transferred: executor.transferred, reused: release.size - executor.transferred };
  } catch { return null; }
  finally {
    executor?.close();
    // A scanner holding the temporary file must not prevent verified full fallback.
    if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 3 }).catch((error: NodeJS.ErrnoException) => {
      console.warn('[updates] Differential temporary cleanup failed:', error.code);
    });
  }
}
