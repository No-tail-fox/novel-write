import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const legacyDefaultJianyingDraftPath = 'G:/JianyingPro Drafts';

export interface JianyingDraftPathOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
  pathExists?: (path: string) => boolean;
}

export function candidateJianyingDraftPaths(options: JianyingDraftPathOptions = {}): string[] {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? env.USERPROFILE ?? homedir();
  const localAppData = env.LOCALAPPDATA ?? '';
  const candidates: string[] = [];

  if (localAppData) {
    for (const appDir of ['JianyingPro', 'CapCut', 'CapCutPro']) {
      candidates.push(join(localAppData, appDir, 'User Data', 'Projects', 'com.lveditor.draft'));
      candidates.push(join(localAppData, appDir, 'UserData', 'Projects', 'com.lveditor.draft'));
    }
  }

  if (home) {
    candidates.push(join(home, 'Documents', 'JianyingPro Drafts'));
    candidates.push(join(home, 'Documents', 'CapCut Drafts'));
    candidates.push(join(home, 'Videos', 'JianyingPro Drafts'));
  }

  candidates.push(legacyDefaultJianyingDraftPath);
  return [...new Set(candidates.map((path) => path.trim()).filter(Boolean))];
}

export function detectJianyingDraftPath(options: JianyingDraftPathOptions = {}): string {
  const pathExists = options.pathExists ?? existsSync;
  return candidateJianyingDraftPaths(options).find((path) => pathExists(path)) ?? '';
}

export function resolveRuntimeJianyingDraftPath(currentPath: string, options: JianyingDraftPathOptions = {}): string {
  const current = currentPath.trim();
  const pathExists = options.pathExists ?? existsSync;
  if (current && pathExists(current)) return current;
  const detected = detectJianyingDraftPath(options);
  if (detected) return detected;
  return current === legacyDefaultJianyingDraftPath ? '' : current;
}
