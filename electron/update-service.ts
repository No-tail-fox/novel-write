import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { AppError } from '../src/shared/app-error';
import type { ReleaseManifest, SignedEnvelope, UpdateStatus } from '../src/shared/licensing';
import { compareVersions, verifyRelease } from './license-security';
import type { LicenseService } from './license-service';

export async function installerHash(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const block of createReadStream(path)) digest.update(block);
  return digest.digest('hex');
}

export class UpdateService {
  private state: UpdateStatus;
  private busy = false;
  private installationPending = false;
  constructor(private readonly options: { license: LicenseService; version: string; directory: string; canInstall: () => boolean; quit: () => void; packaged: boolean }) {
    this.state = { currentVersion: options.version, phase: 'idle', release: null, downloaded: 0, required: false, message: '' };
  }
  get installing(): boolean { return this.installationPending; }
  status(): UpdateStatus { return structuredClone(this.state); }
  assertVersionAllowed(): void {
    if (this.state.required) throw new AppError('UPDATE_REQUIRED', `请更新到 ${this.state.release?.minimumVersion} 或更高版本后继续生成。`);
  }
  check(): Promise<UpdateStatus> { return this.run(async () => { this.state.phase = 'checking'; await this.latest(); return this.status(); }); }
  download(): Promise<UpdateStatus> {
    return this.run(async () => {
      await this.latest();
      const release = this.state.release;
      if (!release) throw new AppError('UPDATE_UNAVAILABLE', '没有可下载的更新。');
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      if ((await lstat(this.options.directory)).isSymbolicLink()) throw new Error('UNSAFE_UPDATE_DIRECTORY');
      const file = join(this.options.directory, release.filename), partial = `${file}.part`;
      for (const path of [file, partial]) {
        const value = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
        if (value && (!value.isFile() || value.isSymbolicLink())) throw new Error('UNSAFE_UPDATE_FILE');
      }
      if (await this.matches(file, release)) { this.state.phase = 'ready'; this.state.downloaded = release.size; return this.status(); }
      await rm(file, { force: true });
      let offset = (await stat(partial).catch(() => null))?.size ?? 0;
      if (offset >= release.size) { await rm(partial, { force: true }); offset = 0; }
      if (!offset) await rm(partial, { force: true });
      this.state.phase = 'downloading'; this.state.downloaded = offset; this.state.message = '';
      const response = await this.options.license.transport!.open(`/v1/releases/files/${release.filename}`, undefined, offset);
      const length = Number(response.headers['content-length']);
      if (response.statusCode !== (offset ? 206 : 200) || length !== release.size - offset ||
          offset && response.headers['content-range'] !== `bytes ${offset}-${release.size - 1}/${release.size}`) {
        response.destroy(); throw new Error('UPDATE_DOWNLOAD_REJECTED');
      }
      const handle = await open(partial, offset ? 'r+' : 'wx', 0o600);
      try {
        for await (const chunk of response) {
          const block = Buffer.from(chunk);
          if (this.state.downloaded + block.length > release.size) throw new Error('UPDATE_SIZE_MISMATCH');
          let written = 0;
          while (written < block.length) {
            const result = await handle.write(block, written, block.length - written, this.state.downloaded + written);
            if (!result.bytesWritten) throw new Error('UPDATE_WRITE_FAILED');
            written += result.bytesWritten;
          }
          this.state.downloaded += block.length;
        }
        await handle.sync();
      } finally { response.destroy(); await handle.close(); }
      if (!await this.matches(partial, release)) { await rm(partial, { force: true }); throw new AppError('UPDATE_HASH_MISMATCH', '安装包校验失败，请重新下载。'); }
      await rename(partial, file);
      this.state.phase = 'ready'; this.state.message = '安装包已验证。';
      return this.status();
    });
  }
  install(): Promise<UpdateStatus> {
    return this.run(async () => {
      if (!this.options.packaged || process.platform !== 'win32' || process.arch !== 'x64') throw new AppError('UPDATE_INSTALL_UNSUPPORTED', '请在 Windows x64 正式安装版中安装更新。');
      const previous = this.state.release;
      this.installationPending = true;
      this.state.phase = 'installing';
      if (!this.options.canInstall()) throw new AppError('UPDATE_APP_BUSY', '有任务正在运行，请等待完成或暂停后再安装。');
      await this.latest();
      const release = this.state.release;
      this.state.phase = 'installing';
      if (!previous || !release || release.sha256 !== previous.sha256) throw new AppError('UPDATE_CHANGED', '发布版本已变化，请重新检查并下载。');
      const file = join(this.options.directory, release.filename);
      if (!await this.matches(file, release) || !this.options.canInstall()) throw new AppError('UPDATE_NOT_READY', '安装包尚未验证，或仍有任务正在运行。');
      await new Promise<void>((resolve, reject) => {
        const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      this.options.quit();
      return this.status();
    });
  }
  private async latest(): Promise<void> {
    const { license } = this.options;
    if (!license.config || !license.transport) throw new AppError('UPDATE_NOT_CONFIGURED', '更新服务尚未配置。');
    const value = await license.transport.json<{ release: SignedEnvelope | null }>('/v1/releases/latest');
    if (value.release === null) { this.state.release = null; this.state.phase = 'idle'; this.state.required = false; this.state.message = '暂未发布更新。'; return; }
    const release = verifyRelease(value.release, license.config, license.now());
    await license.acceptRelease(release.sequence, release.sha256);
    this.state.required = compareVersions(this.options.version, release.minimumVersion) < 0;
    this.state.release = compareVersions(release.version, this.options.version) > 0 ? release : null;
    const ready = this.state.release && await this.matches(join(this.options.directory, release.filename), release);
    this.state.phase = ready ? 'ready' : this.state.release ? 'available' : 'idle';
    this.state.downloaded = ready ? release.size : 0;
    this.state.message = ready ? '安装包已验证。' : this.state.release ? '发现新版本。' : '当前已是最新版本。';
  }
  private async matches(file: string, release: ReleaseManifest): Promise<boolean> {
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    return !!info && info.isFile() && !info.isSymbolicLink() && info.size === release.size && await installerHash(file) === release.sha256;
  }
  private async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new AppError('UPDATE_BUSY', '更新操作正在进行。');
    this.busy = true;
    try { return await work(); }
    catch (error) {
      this.installationPending = false;
      this.state.phase = 'error';
      this.state.message = error instanceof AppError ? error.message : '更新失败，请检查网络或重试。';
      throw new AppError('UPDATE_FAILED', this.state.message);
    } finally { this.busy = false; }
  }
}
