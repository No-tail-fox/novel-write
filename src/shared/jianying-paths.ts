import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const legacyDefaultJianyingDraftPath = 'G:/JianyingPro Drafts';

export interface JianyingDraftPathOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
  pathExists?: (path: string) => boolean;
  pathIsDirectory?: (path: string) => boolean;
  pathWritable?: (path: string) => boolean;
  directoryEntries?: (path: string) => JianyingDraftDirectoryEntry[];
  readTextFile?: (path: string) => string | null;
}

export interface JianyingDraftDirectoryEntry {
  name: string;
  isDirectory: boolean;
}

const jianyingAppDirectories = ['JianyingPro', 'CapCut', 'CapCutPro'] as const;
const jianyingUserDataDirectories = ['User Data', 'UserData'] as const;

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const trimmed = path.trim();
    if (!trimmed) return false;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveHomeDir(options: JianyingDraftPathOptions): string {
  const env = options.env ?? process.env;
  return options.homeDir ?? env.USERPROFILE ?? homedir();
}

function localAppDataRoots(options: JianyingDraftPathOptions): string[] {
  const env = options.env ?? process.env;
  const home = resolveHomeDir(options);
  return uniquePaths([
    env.LOCALAPPDATA ?? '',
    env.APPDATA ? join(env.APPDATA, '..', 'Local') : '',
    home ? join(home, 'AppData', 'Local') : '',
  ]);
}

function readTextFile(path: string, options: JianyingDraftPathOptions): string | null {
  try {
    return options.readTextFile ? options.readTextFile(path) : readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function expandWindowsEnvironmentVariables(value: string, env: Record<string, string | undefined>): string {
  const entries = Object.entries(env);
  return value.replace(/%([^%]+)%/gu, (token, name: string) => {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1] ?? token;
  });
}

function configuredJianyingDraftPaths(options: JianyingDraftPathOptions): string[] {
  const env = options.env ?? process.env;
  const paths: string[] = [];

  for (const localAppData of localAppDataRoots(options)) {
    for (const appDir of jianyingAppDirectories) {
      for (const userDataDir of jianyingUserDataDirectories) {
        const configPath = join(localAppData, appDir, userDataDir, 'Config', 'globalSetting');
        const config = readTextFile(configPath, options);
        const match = config?.match(/^\s*currentCustomDraftPath\s*=\s*(.*?)\s*$/imu);
        if (!match?.[1]) continue;
        const unquoted = match[1].trim().replace(/^"(.*)"$/u, '$1');
        const expanded = expandWindowsEnvironmentVariables(unquoted.replace(/\\\\/gu, '\\'), env);
        if (isAbsolute(expanded)) paths.push(expanded);
      }
    }
  }

  return uniquePaths(paths);
}

export type JianyingDraftPathDetectionReason = 'detected' | 'missing-draft-directory' | 'unusable-draft-directory' | 'not-found';

export interface JianyingDraftPathDetection {
  status: 'pass' | 'warn';
  reason: JianyingDraftPathDetectionReason;
  path: string;
  detail: string;
  installationDetected: boolean;
  candidatesChecked: number;
  draftCount: number;
  checks: {
    isDirectory: boolean;
    writable: boolean;
    hasJianyingMetadata: boolean;
  };
}

export function candidateJianyingDraftPaths(options: JianyingDraftPathOptions = {}): string[] {
  const home = resolveHomeDir(options);
  const candidates = configuredJianyingDraftPaths(options);

  for (const localAppData of localAppDataRoots(options)) {
    for (const appDir of jianyingAppDirectories) {
      for (const userDataDir of jianyingUserDataDirectories) {
        candidates.push(join(localAppData, appDir, userDataDir, 'Projects', 'com.lveditor.draft'));
      }
    }
  }

  if (home) {
    candidates.push(join(home, 'Documents', 'JianyingPro Drafts'));
    candidates.push(join(home, 'Documents', 'CapCut Drafts'));
    candidates.push(join(home, 'Videos', 'JianyingPro Drafts'));
  }

  return uniquePaths(candidates);
}

function candidateJianyingInstallationPaths(options: JianyingDraftPathOptions): string[] {
  return uniquePaths(localAppDataRoots(options).flatMap((localAppData) =>
    jianyingAppDirectories.flatMap((appDir) => [
      join(localAppData, appDir),
      ...jianyingUserDataDirectories.map((userDataDir) => join(localAppData, appDir, userDataDir)),
    ])));
}

function isDirectory(path: string, options: JianyingDraftPathOptions): boolean {
  if (options.pathIsDirectory) return options.pathIsDirectory(path);
  if (options.pathExists) return true;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isWritable(path: string, options: JianyingDraftPathOptions): boolean {
  if (options.pathWritable) return options.pathWritable(path);
  if (options.pathExists) return true;
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function readDirectoryEntries(path: string, options: JianyingDraftPathOptions): JianyingDraftDirectoryEntry[] {
  if (options.directoryEntries) return options.directoryEntries(path);
  if (options.pathExists) return [];
  try {
    return readdirSync(path, { withFileTypes: true }).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  } catch {
    return [];
  }
}

export function detectJianyingDraftPathResult(options: JianyingDraftPathOptions = {}): JianyingDraftPathDetection {
  const pathExists = options.pathExists ?? existsSync;
  const candidates = candidateJianyingDraftPaths(options);
  let rejectedChecks: JianyingDraftPathDetection['checks'] | null = null;

  for (const path of candidates) {
    if (!pathExists(path)) continue;
    const directory = isDirectory(path, options);
    const writable = directory && isWritable(path, options);
    if (!directory || !writable) {
      rejectedChecks ??= { isDirectory: directory, writable, hasJianyingMetadata: false };
      continue;
    }
    const entries = readDirectoryEntries(path, options);
    const draftCount = entries.filter((entry) => entry.isDirectory && !entry.name.startsWith('.')).length;
    const hasJianyingMetadata = entries.some((entry) => entry.name.toLowerCase() === 'root_meta_info.json');
    return {
      status: 'pass',
      reason: 'detected',
      path,
      detail: `目录有效且可写，发现 ${draftCount} 个本地草稿。`,
      installationDetected: true,
      candidatesChecked: candidates.length,
      draftCount,
      checks: { isDirectory: true, writable: true, hasJianyingMetadata },
    };
  }

  const installationDetected = candidateJianyingInstallationPaths(options).some((path) => pathExists(path));
  if (rejectedChecks) {
    return {
      status: 'warn',
      reason: 'unusable-draft-directory',
      path: '',
      detail: rejectedChecks.isDirectory
        ? '检测到剪映草稿目录，但当前账户没有写入权限。请检查目录权限或手动选择其他目录。'
        : '检测到剪映草稿候选，但它不是文件夹。请清理无效路径后重试或手动选择目录。',
      installationDetected,
      candidatesChecked: candidates.length,
      draftCount: 0,
      checks: rejectedChecks,
    };
  }
  if (installationDetected) {
    return {
      status: 'warn',
      reason: 'missing-draft-directory',
      path: '',
      detail: '已找到剪映本地数据，但草稿目录尚未建立。请先在剪映中新建并保存一个草稿，再重新检测。',
      installationDetected: true,
      candidatesChecked: candidates.length,
      draftCount: 0,
      checks: { isDirectory: false, writable: false, hasJianyingMetadata: false },
    };
  }
  return {
    status: 'warn',
    reason: 'not-found',
    path: '',
    detail: '未找到剪映专业版或 CapCut 的本地草稿目录，请确认已安装并至少保存过一个草稿。',
    installationDetected: false,
    candidatesChecked: candidates.length,
    draftCount: 0,
    checks: { isDirectory: false, writable: false, hasJianyingMetadata: false },
  };
}

export function detectJianyingDraftPath(options: JianyingDraftPathOptions = {}): string {
  return detectJianyingDraftPathResult(options).path;
}

export function resolveRuntimeJianyingDraftPath(currentPath: string, options: JianyingDraftPathOptions = {}): string {
  const current = currentPath.trim();
  const pathExists = options.pathExists ?? existsSync;
  if (current && current !== legacyDefaultJianyingDraftPath && pathExists(current)) return current;
  const detected = detectJianyingDraftPath(options);
  if (detected) return detected;
  if (current && pathExists(current)) return current;
  return current === legacyDefaultJianyingDraftPath ? '' : current;
}
