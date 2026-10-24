import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchWithTimeout } from '../src/shared/http';
import { type HtmlVideoBackgroundRemovalModel } from '../src/shared/html-video-background-removal';
import { existsSync } from 'node:fs';

/** Fixed ONNX export; metadata verified against the repository's LFS pointer. */
export const DEFAULT_BACKGROUND_REMOVAL_MODEL = {
  file: 'birefnet-lite.onnx',
  kind: 'birefnet',
  revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
  url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model.onnx',
  sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
  bytes: 224005088,
  license: 'MIT',
  source: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX',
} as const;

const installations = new Map<string, Promise<HtmlVideoBackgroundRemovalModel>>();

export async function ensureBackgroundRemovalModel(
  directory: string,
  options: {
    download?: (url: string) => Promise<Uint8Array>;
    descriptor?: Omit<typeof DEFAULT_BACKGROUND_REMOVAL_MODEL, 'sha256' | 'bytes'> & { sha256: string; bytes: number };
  } = {},
): Promise<HtmlVideoBackgroundRemovalModel> {
  const pending = installations.get(directory);
  if (pending) return pending;
  const operation = install();
  installations.set(directory, operation);
  try { return await operation; } finally { installations.delete(directory); }

  async function install(): Promise<HtmlVideoBackgroundRemovalModel> {
    const descriptor = options.descriptor ?? DEFAULT_BACKGROUND_REMOVAL_MODEL;
    await mkdir(directory, { recursive: true });
    const destination = join(directory, descriptor.file);
    if (existsSync(destination)) {
      await verify(await readFile(destination));
      return { path: destination, kind: descriptor.kind, revision: descriptor.revision };
    }
    const temporary = join(directory, `.${descriptor.file}.${randomUUID()}.download`);
    try {
      const bytes = await (options.download ?? download)(descriptor.url);
      await verify(bytes);
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, destination);
      await writeFile(join(directory, `${descriptor.file}.json`), JSON.stringify(descriptor, null, 2), 'utf8');
      return { path: destination, kind: descriptor.kind, revision: descriptor.revision };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('BACKGROUND_REMOVAL_MODEL_')) throw error;
      throw new Error(`BACKGROUND_REMOVAL_MODEL_DOWNLOAD_FAILED: 无法安装本地抠图模型，原图已保留，可重试去底。${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    async function verify(bytes: Uint8Array): Promise<void> {
      if (bytes.byteLength !== descriptor.bytes || createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
        throw new Error('BACKGROUND_REMOVAL_MODEL_INVALID: 抠图模型大小或 SHA-256 校验失败，请检查模型文件后重试。');
      }
    }
  }
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetchWithTimeout(url, {
    purpose: 'public-research', timeoutMs: 600_000,
    maxBytes: DEFAULT_BACKGROUND_REMOVAL_MODEL.bytes, maxRedirects: 5,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
