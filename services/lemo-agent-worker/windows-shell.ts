import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

/** Controlled MCP tools require no Bash. Prevent automatic discovery of a machine-wide Git shell. */
export async function disableLemoGlobalGitBash(environment: NodeJS.ProcessEnv, stateRoot: string, platform = process.platform): Promise<void> {
  if (platform !== 'win32') return;
  const unavailable = join(stateRoot, 'shell-unavailable', 'bash.exe');
  try { await lstat(unavailable); throw new Error('LEMO_SDK_SHELL_PATH_OCCUPIED'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  environment.CLAUDE_CODE_GIT_BASH_PATH = unavailable;
}
