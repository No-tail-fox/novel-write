import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactProcessOutput, runBoundedProcess } from './process-runner';
import { buildViralMediaWorkerInvocation, buildViralMediaWorkerRequest } from './viral-media-worker';
import { resolvePythonCommand } from './python-runtime';
import type { AppConfig, ViralPlatform } from './types';
import type { ViralMediaDownloadResult } from './viral-analysis';

const VIRAL_WORKER_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;

export async function downloadViralMedia(
  input: {
    url: string;
    platform: ViralPlatform;
    workDir: string;
    config: AppConfig;
  },
  signal?: AbortSignal,
): Promise<ViralMediaDownloadResult> {
  const request = buildViralMediaWorkerRequest({
    url: input.url,
    platform: input.platform,
    workDir: input.workDir,
    cookieFallbackMode: input.config.viral.cookieFallbackMode,
    browserCookieSource: input.config.viral.browserCookieSource,
    cookieFilePath: input.config.viral.cookieFilePath,
    timeoutMs: input.config.viral.downloadTimeoutMs,
  });
  const requestPath = join(input.workDir, 'viral-media-worker-request.json');
  await writeFile(requestPath, JSON.stringify(request, null, 2), 'utf8');
  const invocation = buildViralMediaWorkerInvocation({
    baseDir: undefined,
    requestPath,
  });
  const python = resolvePythonCommand();
  const result = await runBoundedProcess(python, invocation.args, {
    cwd: input.workDir,
    timeoutMs: input.config.viral.downloadTimeoutMs,
    maxStdoutBytes: VIRAL_WORKER_OUTPUT_MAX_BYTES,
    maxStderrBytes: VIRAL_WORKER_OUTPUT_MAX_BYTES,
    signal,
    env: buildViralMediaWorkerEnv(process.env),
  });
  if (result.code !== 0) {
    const detail = redactProcessOutput(result.stderr || result.stdout).trim().slice(-(64 * 1024));
    throw new Error(`Viral media worker exited with code ${result.code ?? 'unknown'}${detail ? `: ${detail}` : '.'}`);
  }
  return parseWorkerResult(result.stdout);
}

function parseWorkerResult(raw: string): ViralMediaDownloadResult {
  const parsed = JSON.parse(raw) as ViralMediaDownloadResult;
  return parsed;
}

export function buildViralMediaWorkerEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
}
