import { join } from 'node:path';

/** A separate process and cwd are not an OS sandbox. Never forward all user secrets. */
export function lemoWorkerEnvironment(source: NodeJS.ProcessEnv, stateRoot: string): NodeJS.ProcessEnv {
  const allow = new Set(['systemroot', 'windir', 'comspec', 'path', 'pathext', 'systemdrive']);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) if (allow.has(key.toLowerCase()) && value) env[key] = value;
  return { ...env, HOME: join(stateRoot, 'home'), USERPROFILE: join(stateRoot, 'home'),
    APPDATA: join(stateRoot, 'appdata'), LOCALAPPDATA: join(stateRoot, 'localappdata'),
    TEMP: join(stateRoot, 'temp'), TMP: join(stateRoot, 'temp'), TMPDIR: join(stateRoot, 'temp'),
    CLAUDE_CONFIG_DIR: join(stateRoot, 'claude'), DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(stateRoot, 'empty-gitconfig'),
  };
}
