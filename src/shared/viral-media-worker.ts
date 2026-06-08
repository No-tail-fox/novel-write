import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ViralAnalyzerConfig, ViralBrowserCookieSource, ViralCookieFallbackMode, ViralPlatform } from './types';

export interface ViralMediaWorkerRequest {
  url: string;
  platform: ViralPlatform;
  workDir: string;
  cookieFallbackMode: ViralCookieFallbackMode;
  browserCookieSource: ViralBrowserCookieSource;
  cookieFilePath: string;
  timeoutMs: number;
}

export interface ViralMediaWorkerInvocation {
  workerScriptPath: string;
  args: [string, 'download', string];
}

export interface ViralMediaWorkerPathOptions {
  baseDir?: string;
}

export function resolveViralMediaWorkerScriptPath(options: ViralMediaWorkerPathOptions = {}): string {
  const baseDir = options.baseDir ?? dirname(fileURLToPath(import.meta.url));
  return join(baseDir, 'viral-media-worker.py');
}

export function buildViralMediaWorkerRequest(input: {
  url: string;
  platform: ViralPlatform;
  workDir: string;
  cookieFallbackMode: ViralAnalyzerConfig['cookieFallbackMode'];
  browserCookieSource: ViralAnalyzerConfig['browserCookieSource'];
  cookieFilePath: string;
  timeoutMs: number;
}): ViralMediaWorkerRequest {
  return {
    url: input.url,
    platform: input.platform,
    workDir: input.workDir,
    cookieFallbackMode: input.cookieFallbackMode,
    browserCookieSource: input.browserCookieSource,
    cookieFilePath: input.cookieFilePath,
    timeoutMs: input.timeoutMs,
  };
}

export function buildViralMediaWorkerInvocation(input: {
  baseDir?: string;
  requestPath: string;
}): ViralMediaWorkerInvocation {
  const workerScriptPath = resolveViralMediaWorkerScriptPath({ baseDir: input.baseDir });
  return {
    workerScriptPath,
    args: [workerScriptPath, 'download', input.requestPath],
  };
}
