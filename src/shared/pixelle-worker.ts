import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { runBoundedProcess } from './process-runner';
import { resolvePythonRuntimeInfo } from './python-runtime';
import type { PixelleCatalog, PixelleFrameResult, PixelleRenderFrameRequest, PixelleRenderClipRequest, PixelleClipResult, PixelleVideoProbeRequest, PixelleVideoProbe } from './pixelle';

type CatalogRequest = { mode: 'catalog'; workDir: string };
interface WorkerOptions { appRoot: string; resourcesPath?: string; signal?: AbortSignal }
const permittedEnvironment = new Set(['path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'home', 'userprofile', 'localappdata', 'appdata', 'lang']);

export class PixelleWorkerError extends Error {
  constructor(message: string, public readonly code?: string, public readonly missingResources: string[] = []) {
    super(message); this.name = 'PixelleWorkerError';
  }
}

/** Deliberately excludes model credentials, NODE_OPTIONS and Python injection hooks. */
export function pixelleWorkerEnvironment(parent: NodeJS.ProcessEnv, browserDirectory?: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(parent).filter(([name]) => permittedEnvironment.has(name.toLowerCase())));
  return { ...env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', ...(browserDirectory ? { PLAYWRIGHT_BROWSERS_PATH: browserDirectory } : {}) };
}
export function runPixelleWorker(request: CatalogRequest, options: WorkerOptions): Promise<PixelleCatalog>;
export function runPixelleWorker(request: PixelleRenderFrameRequest, options: WorkerOptions): Promise<PixelleFrameResult>;
export function runPixelleWorker(request: PixelleRenderClipRequest, options: WorkerOptions): Promise<PixelleClipResult>;
export function runPixelleWorker(request: PixelleVideoProbeRequest, options: WorkerOptions): Promise<PixelleVideoProbe>;
export async function runPixelleWorker(request: CatalogRequest | PixelleRenderFrameRequest | PixelleRenderClipRequest | PixelleVideoProbeRequest, options: WorkerOptions): Promise<PixelleCatalog | PixelleFrameResult | PixelleClipResult | PixelleVideoProbe> {
  options.signal?.throwIfAborted();
  const base = options.resourcesPath ? resolve(options.resourcesPath) : resolve(options.appRoot);
  const upstreamDir = join(base, ...(options.resourcesPath ? [] : ['vendor']), 'pixelle-upstream');
  const worker = join(base, ...(options.resourcesPath ? [] : ['services']), 'pixelle-worker', 'worker.py');
  if (!existsSync(worker) || !existsSync(join(upstreamDir, 'storydream-upstream.json'))) throw new Error('Pixelle 原模板或运行器未安装完整');
  const runtime = resolvePythonRuntimeInfo(options);
  const browserDirectory = join(dirname(runtime.command), 'playwright-browsers');
  const workDir = resolve(request.workDir);
  await mkdir(workDir, { recursive: true });
  const requestPath = join(workDir, `pixelle-request-${randomUUID()}.json`);
  await writeFile(requestPath, JSON.stringify({ ...request, workDir, upstreamDir }), { encoding: 'utf8', flag: 'wx' });
  try {
    const result = await runBoundedProcess(runtime.command, [worker, '--request', requestPath], {
      cwd: workDir, timeoutMs: request.mode === 'render-clip' ? 900_000 : 120_000, maxStdoutBytes: 2 * 1024 * 1024, maxStderrBytes: 1024 * 1024,
      signal: options.signal, env: pixelleWorkerEnvironment(process.env, existsSync(browserDirectory) ? browserDirectory : undefined),
    });
    let response: { ok?: boolean; error?: string; code?: string; missingResources?: string[]; result?: PixelleCatalog | PixelleFrameResult | PixelleClipResult | PixelleVideoProbe };
    try { response = JSON.parse(result.stdout); } catch { throw new Error(`Pixelle 运行器未返回有效结果（退出码 ${result.code}）`); }
    if (result.code !== 0 || response.ok !== true || !response.result) throw new PixelleWorkerError(response.error || 'Pixelle 渲染失败', response.code, response.missingResources);
    return response.result;
  } finally { await rm(requestPath, { force: true }); }
}
