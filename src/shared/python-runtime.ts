import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PythonRuntimeSource = 'bundled' | 'system';

export interface PythonRuntimeInfo {
  command: string;
  source: PythonRuntimeSource;
}

export interface PythonRuntimeResolveOptions {
  resourcesPath?: string;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}

export function resolvePythonCommand(options: PythonRuntimeResolveOptions = {}): string {
  return resolvePythonRuntimeInfo(options).command;
}

export function resolvePythonRuntimeInfo(options: PythonRuntimeResolveOptions = {}): PythonRuntimeInfo {
  const platform = options.platform ?? process.platform;
  const resourcesPath = options.resourcesPath ?? defaultResourcesPath();
  const exists = options.exists ?? existsSync;
  if (platform === 'win32' && resourcesPath) {
    const bundledPython = join(resourcesPath, 'python', 'python.exe');
    if (exists(bundledPython)) {
      return { command: bundledPython, source: 'bundled' };
    }
  }
  return { command: 'python', source: 'system' };
}

function defaultResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}
