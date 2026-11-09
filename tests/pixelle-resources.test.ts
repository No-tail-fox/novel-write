import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIXELLE_REVISION, type PixelleFrameResult, type PixelleRenderFrameRequest, type PixelleTemplateDescriptor } from '../src/shared/pixelle';
import { PixelleWorkerError } from '../src/shared/pixelle-worker';
import { cssResourceUrls, renderPixelleFrameWithResources } from '../src/shared/pixelle-resources';

const css = 'https://fonts.googleapis.com/css2?family=Example';
const font = 'https://fonts.gstatic.com/font.woff2';
const directories: string[] = [];
const ref = { provider: 'pixelle' as const, revision: PIXELLE_REVISION, path: '1080x1920/image_default.html', sha256: 'a'.repeat(64) };
const template: PixelleTemplateDescriptor = { ref, name: 'test', type: 'image', size: '1080x1920', width: 1080, height: 1920, orientation: 'portrait', mediaSize: [1024, 1024], parameters: {}, remoteDependencies: ['https://fonts.googleapis.com', css] };
async function fixture() {
  const cacheDir = await mkdtemp(join(tmpdir(), 'pixelle-resource-test-')); directories.push(cacheDir);
  const request: PixelleRenderFrameRequest = { mode: 'render-frame', workDir: cacheDir, templateRef: ref, title: 'test', text: 'test' };
  const result: PixelleFrameResult = { path: join(cacheDir, 'output.png'), width: 1080, height: 1920, ref, kind: 'frame', requiresVideoComposition: false, paidRequests: 0 };
  return { cacheDir, request, result };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true }))); });
function missing(urls: string[]) { return new PixelleWorkerError('upstream wrapped resource failure', 'PIXELLE_RESOURCE_REQUIRED', urls); }

describe('Pixelle original resource cache', () => {
  it('follows structured dependencies, not the wording of upstream exceptions; reuses locked bytes offline', async () => {
    const { cacheDir, request, result } = await fixture();
    const fetchResource = vi.fn(async (url: string) => url === css ? { bytes: Buffer.from(`@font-face{src:url(${font})}`), contentType: 'text/css' } : { bytes: Buffer.from('font-bytes'), contentType: 'font/woff2' });
    const render = vi.fn(async (input: PixelleRenderFrameRequest) => {
      if (!input.resourceMap?.[css]) throw missing([css]);
      if (!input.resourceMap[font]) throw missing([font]);
      return result;
    });
    const options = { cacheDir, template, render, fetchResource };
    expect(await renderPixelleFrameWithResources(request, options)).toEqual(result);
    expect(fetchResource.mock.calls.map(args => args[0])).toEqual([css, font]);
    expect(render).toHaveBeenCalledTimes(3);
    fetchResource.mockClear(); render.mockClear();
    await renderPixelleFrameWithResources(request, options);
    expect(fetchResource).not.toHaveBeenCalled(); expect(render).toHaveBeenCalledTimes(1);
  });
  it('does not fetch undeclared, local or credentialed resources', async () => {
    const { cacheDir, request } = await fixture();
    const fetchResource = vi.fn();
    for (const url of ['http://127.0.0.1/secret', 'file:///private', 'https://evil.invalid/file']) {
      await expect(renderPixelleFrameWithResources(request, { cacheDir, template, fetchResource, render: async () => { throw missing([url]); } })).rejects.toThrow('原版依赖清单');
    }
    expect(fetchResource).not.toHaveBeenCalled();
    expect(() => cssResourceUrls('url(https://user:password@host/font)', css)).toThrow('无凭据');
  });
  it('does not treat genuine render errors as retryable resource errors', async () => {
    const { cacheDir, request } = await fixture(); const fetchResource = vi.fn();
    await expect(renderPixelleFrameWithResources(request, { cacheDir, template, fetchResource, render: async () => { throw new Error('template JavaScript failed'); } })).rejects.toThrow('JavaScript');
    expect(fetchResource).not.toHaveBeenCalled();
  });
  it('refuses corrupt cached bytes instead of silently downloading a new font version', async () => {
    const { cacheDir, request, result } = await fixture();
    const options = { cacheDir, template, fetchResource: vi.fn(async () => ({ bytes: Buffer.from('stylesheet'), contentType: 'text/css' })), render: async (input: PixelleRenderFrameRequest) => { if (!input.resourceMap?.[css]) throw missing([css]); return result; } };
    await renderPixelleFrameWithResources(request, options);
    const manifest = JSON.parse(await readFile(join(cacheDir, PIXELLE_REVISION, 'resources.json'), 'utf8'));
    expect(manifest.entries[0].url).toBe(css);
    const { createHash } = await import('node:crypto');
    await writeFile(join(cacheDir, PIXELLE_REVISION, createHash('sha256').update(css).digest('hex')), 'corrupt');
    options.fetchResource.mockClear();
    await expect(renderPixelleFrameWithResources(request, options)).rejects.toThrow('缓存校验失败');
    expect(options.fetchResource).not.toHaveBeenCalled();
  });
  it('rejects HTML login/error responses rather than saving them as fonts', async () => {
    const { cacheDir, request } = await fixture();
    await expect(renderPixelleFrameWithResources(request, { cacheDir, template, render: async () => { throw missing([css]); }, fetchResource: async () => ({ bytes: Buffer.from('<html>error</html>'), contentType: 'text/html' }) })).rejects.toThrow('类型不可用');
  });
  it('does no work after cancellation', async () => {
    const { cacheDir, request } = await fixture(); const controller = new AbortController(); controller.abort(); const render = vi.fn();
    await expect(renderPixelleFrameWithResources(request, { cacheDir, template, signal: controller.signal, render })).rejects.toThrow();
    expect(render).not.toHaveBeenCalled();
  });
});