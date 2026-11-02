import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { LlmConfig } from '../src/shared/types';
import { lemoProductionBudgetSchema, type LemoProductionBudget } from '../src/shared/lemo-production-budget';
import { probeLemoRelease, resolvePackagedLemoRelease, type VerifiedLemoRelease } from './lemo-official-release';

const runFile = promisify(execFile);
export interface LemoOfficialRuntimeLocation {
  isPackaged: boolean; appPath: string; resourcesPath: string; electronExecutable: string;
  environment?: NodeJS.ProcessEnv; platform?: NodeJS.Platform;
}
export interface LemoOfficialRuntimeDependencies {
  isFile(path: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
  execute(path: string, args: string[], environment: NodeJS.ProcessEnv): Promise<string>;
  resolvePackagedRelease(resourcesPath: string): Promise<VerifiedLemoRelease>;
  probePackagedRelease(release: VerifiedLemoRelease): Promise<void>;
}
const defaults: LemoOfficialRuntimeDependencies = {
  isFile: async path => { try { return (await stat(path)).isFile(); } catch { return false; } },
  realpath,
  execute: async (path, args, env) => (await runFile(path, args, { env, windowsHide: true, timeout: 5000, maxBuffer: 4096, encoding: 'utf8' })).stdout,
  resolvePackagedRelease: resolvePackagedLemoRelease,
  probePackagedRelease: probeLemoRelease,
};

/** Resolve an external Node host. Electron's executable is never a Node fallback. */
export async function resolveLemoOfficialRuntimeConfig(input: LemoOfficialRuntimeLocation, overrides: Partial<LemoOfficialRuntimeDependencies> = {}) {
  const dependencies = { ...defaults, ...overrides }, env = { ...(input.environment ?? process.env) };
  if (![input.appPath, input.resourcesPath, input.electronExecutable].every(isAbsolute)) throw new Error('LEMO_OFFICIAL_RUNTIME_PATH');
  if (input.isPackaged) {
    // An installed application must be self-contained: never fall back to a developer/global runtime.
    const release = await dependencies.resolvePackagedRelease(input.resourcesPath);
    await dependencies.probePackagedRelease(release);
    return { nodeExecutable: release.nodeExecutable, workerPath: release.workerPath, nodeVersion: release.nodeVersion };
  }
  const workerPath = join(input.appPath, 'services', 'lemo-agent-worker', 'dist', 'worker.mjs');
  if (!await dependencies.isFile(workerPath)) throw new Error('LEMO_OFFICIAL_WORKER_MISSING: 官方 SDK worker 尚未构建，请运行 scripts/build-lemo-agent-worker.mjs。');
  const windows = (input.platform ?? process.platform) === 'win32', executable = windows ? 'node.exe' : 'node';
  const installed = windows ? [env.ProgramFiles && join(env.ProgramFiles, 'nodejs', executable),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)']!, 'nodejs', executable),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'nodejs', executable), env.NVM_SYMLINK && join(env.NVM_SYMLINK, executable)] : ['/usr/local/bin/node', '/usr/bin/node'];
  const pathValue = env.PATH ?? env.Path ?? env.path ?? '';
  const candidates = [...new Set([env.STORYDREAM_NODE_EXECUTABLE,
    join(input.resourcesPath, 'node', executable), join(input.appPath, 'vendor', 'node', executable), ...installed,
    ...pathValue.split(windows ? ';' : delimiter).map(value => value.trim().replace(/^"|"$/g, '')).filter(value => value && isAbsolute(value)).map(value => join(value, executable)),
  ].filter((value): value is string => !!value && isAbsolute(value)))];
  const normalize = (value: string) => windows ? resolve(value).toLowerCase() : resolve(value);
  let electron = normalize(input.electronExecutable);
  try { electron = normalize(await dependencies.realpath(input.electronExecutable)); } catch { /* The supplied exact executable remains excluded. */ }
  // A version probe cannot inherit executable hooks or pretend Electron is Node.
  for (const key of Object.keys(env)) if (['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key.toUpperCase())) delete env[key];
  for (const candidate of candidates) {
    if (normalize(candidate) === electron || !await dependencies.isFile(candidate)) continue;
    try {
      const canonical = await dependencies.realpath(candidate);
      if (normalize(canonical) === electron) continue;
      const version = (await dependencies.execute(canonical, ['--version'], env)).trim();
      const match = /^v(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.-]+)?$/.exec(version);
      if (!match || Number(match[1]) < 22) continue;
      const runtime = JSON.parse(await dependencies.execute(canonical, ['-p', 'JSON.stringify({name:process.release.name,node:process.versions.node,electron:process.versions.electron||null})'], env));
      if (runtime.name !== 'node' || runtime.electron !== null || runtime.node !== version.slice(1)) continue;
      return { nodeExecutable: canonical, workerPath: await dependencies.realpath(workerPath), nodeVersion: version };
    } catch { /* Try another installed genuine Node runtime; never dispatch a worker here. */ }
  }
  throw new Error('LEMO_OFFICIAL_NODE_REQUIRED: 未找到可用的独立 Node.js 22+。请安装 Node.js 22 或更新版本并加入 PATH；Electron 不能替代此运行时。');
}

export function lemoOfficialSessionLimits(config: Pick<LlmConfig, 'requestParamsJson' | 'timeoutMs'>, budget?: LemoProductionBudget) {
  let parameters: unknown;
  try { parameters = JSON.parse(config.requestParamsJson?.trim() || '{}'); } catch { throw new Error('LEMO_OFFICIAL_REQUEST_PARAMS: 模型请求参数不是有效 JSON。'); }
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('LEMO_OFFICIAL_REQUEST_PARAMS: 模型请求参数必须是对象。');
  const parsedBudget = budget ? lemoProductionBudgetSchema.parse(budget) : undefined;
  const maxOutputTokens = parsedBudget?.maxOutputTokens ?? (parameters as Record<string, unknown>).max_tokens ?? 16384;
  if (!Number.isSafeInteger(maxOutputTokens) || Number(maxOutputTokens) < 1 || Number(maxOutputTokens) > 1000000) throw new Error('LEMO_OFFICIAL_TOKEN_LIMIT: max_tokens 必须是 1 到 1000000 的整数。');
  const requestTimeoutMs = config.timeoutMs ?? 180000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new Error('LEMO_OFFICIAL_TIMEOUT: 模型请求超时必须是正整数。');
  return { maxOutputTokens: Number(maxOutputTokens), maxRequests: parsedBudget?.maxRequests ?? 64,
    maxTurns: parsedBudget?.maxTurns ?? 64, timeoutMs: (parsedBudget?.maxMinutes ?? 30) * 60 * 1000, requestTimeoutMs,
    ...(parsedBudget ? { maxEstimatedCostUsd: parsedBudget.maxEstimatedCostUsd, maxRepairRounds: parsedBudget.maxRepairRounds } : {}) };
}
