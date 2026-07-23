import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const nodeWrapper = fileURLToPath(new URL('../scripts/run-npm-node.cmd', import.meta.url));
const commandProcessor =
  process.env.ComSpec ?? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\cmd.exe`;

interface WrapperEnvironmentOptions {
  npmNodeExecPath?: string;
  path?: string;
}

function runNodeWrapper(args: string[], options: WrapperEnvironmentOptions = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const name of Object.keys(env)) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === 'npm_node_execpath' || (options.path !== undefined && normalizedName === 'path')) {
      delete env[name];
    }
  }
  if (options.npmNodeExecPath !== undefined) {
    env.npm_node_execpath = options.npmNodeExecPath;
  }
  if (options.path !== undefined) {
    env.Path = options.path;
  }

  return spawnSync(commandProcessor, ['/d', '/s', '/c', nodeWrapper, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
  });
}

describe('Node tool wrapper', () => {
  it('runs Vitest from a PATH-resolvable Node when npm does not inject one', () => {
    const result = runNodeWrapper(['node_modules\\vitest\\vitest.mjs', '--version']);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^vitest\/\d+\.\d+\.\d+/mu);
    expect(result.stderr).toBe('');
  });

  it('uses the npm-injected Node when PATH cannot resolve one', () => {
    const result = runNodeWrapper(['-p', 'process.execPath'], {
      npmNodeExecPath: process.execPath,
      path: '',
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim().toLowerCase()).toBe(process.execPath.toLowerCase());
    expect(result.stderr).toBe('');
  });

  it('emits one bounded diagnostic when neither npm nor PATH provides Node', () => {
    const result = runNodeWrapper(['-e', 'process.exitCode=0'], { path: '' });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^Node executable is not available from npm or PATH\.\r?\n$/u);
    expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThan(96);
  });

  it('preserves the child process exit code', () => {
    const result = runNodeWrapper(['-e', 'process.exitCode=37']);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(37);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});

describe('one-click startup script', () => {
  it('runs npm PowerShell tasks through npm absolute Node executable', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const wrapper = await readFile(new URL('../scripts/run-npm-powershell.cmd', import.meta.url), 'utf8');
    const nodeWrapper = await readFile(new URL('../scripts/run-npm-node.cmd', import.meta.url), 'utf8');

    for (const name of ['build', 'package:win', 'smoke:electron', 'qa:editorial', 'test', 'test:watch', 'typecheck']) {
      expect(packageJson.scripts[name]).toContain('run-npm-powershell.cmd');
      expect(packageJson.scripts[name]).not.toMatch(/^node\s/u);
    }
    for (const command of Object.values(packageJson.scripts)) {
      expect(command).not.toMatch(/(^|[\s"'&])node\s/u);
    }
    expect(wrapper).toContain('%npm_node_execpath%');
    expect(nodeWrapper).toContain('%npm_node_execpath%');
    expect(wrapper).not.toContain('I:\\nodejs');
    expect(nodeWrapper).not.toContain('I:\\nodejs');
  });

  it('typechecks renderer, Electron, and repository TypeScript scripts', async () => {
    const typecheck = await readFile(new URL('../scripts/typecheck.ps1', import.meta.url), 'utf8');
    const scriptsConfig = await readFile(new URL('../tsconfig.scripts.json', import.meta.url), 'utf8').catch(() => '');

    expect(typecheck).toContain('tsconfig.scripts.json');
    expect(scriptsConfig.length).toBeGreaterThan(0);
    expect(scriptsConfig).toContain('scripts/**/*.ts');
  });

  it('cleans stale Electron output and syntax-checks the generated main process before launch', async () => {
    const script = await readFile(new URL('../start-storydream.ps1', import.meta.url), 'utf8');

    expect(script).toContain('Remove-Item -LiteralPath "dist-electron"');
    expect(script).toContain('node --check');
    expect(script).toContain('dist-electron\\electron\\main.js');
    expect(script).toContain('dist-electron\\electron\\preload.js');
  });

  it('selects a Node runtime compatible with the Vite toolchain', async () => {
    const script = await readFile(new URL('../start-storydream.ps1', import.meta.url), 'utf8');

    expect(script).toContain('Test-NodeVersionCompatible');
    expect(script).toContain('Find-CompatibleNodePath');
    expect(script).toContain('20.19.0');
    expect(script).toContain('22.12.0');
    expect(script).toContain('$node = Find-CompatibleNodePath');
  });

  it('reinstalls dependencies when the native Vite/Vitest binding is missing', async () => {
    const script = await readFile(new URL('../start-storydream.ps1', import.meta.url), 'utf8');

    expect(script).toContain('Test-DependenciesReady');
    expect(script).toContain('@rolldown\\binding-win32-x64-msvc');
    expect(script).toContain('Installing dependencies');
  });

  it('boots through the UTF-8 helper and prefers pwsh when available', async () => {
    const script = await readFile(new URL('../start-storydream.ps1', import.meta.url), 'utf8');
    const helper = await readFile(new URL('../scripts/utf8-bootstrap.ps1', import.meta.url), 'utf8');
    const launcher = await readFile(new URL('../启动 StoryDream.bat', import.meta.url), 'utf8');

    expect(script).toContain('Invoke-Utf8Bootstrap');
    expect(script).toContain('$PSCommandPath');
    expect(helper).toContain('chcp 65001');
    expect(helper).toContain('UTF8Encoding');
    expect(helper).toContain('Get-Command pwsh');
    expect(launcher).toContain('where pwsh');
    expect(launcher).toContain('PS_EXE=pwsh');
  });
});
