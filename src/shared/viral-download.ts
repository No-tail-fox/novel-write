import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildViralMediaWorkerInvocation, buildViralMediaWorkerRequest } from './viral-media-worker';
import { resolvePythonCommand } from './python-runtime';
import type { AppConfig, ViralPlatform } from './types';
import type { ViralMediaDownloadResult } from './viral-analysis';

const execFileAsync = promisify(execFile);

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
  try {
    const { stdout } = await execFileAsync(python, invocation.args, {
      timeout: input.config.viral.downloadTimeoutMs,
      signal,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return parseWorkerResult(stdout);
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    throw new Error(`${python} ${invocation.args.join(' ')} failed. ${detail}`.trim());
  }
}

function parseWorkerResult(raw: string): ViralMediaDownloadResult {
  const parsed = JSON.parse(raw) as ViralMediaDownloadResult;
  return parsed;
}
