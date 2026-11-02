import { readFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const powershellAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { windowsHide: true }).status === 0;

describe('windows packaging', () => {
  it('defines a one-command Windows exe packaging path', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      build?: Record<string, unknown>;
    };
    const packageScript = await readFile(new URL('../scripts/package-win.ps1', import.meta.url), 'utf8');
    const pythonRuntimeScript = await readFile(new URL('../scripts/prepare-python-runtime.ps1', import.meta.url), 'utf8');
    const pythonRuntimeLock = JSON.parse(await readFile(new URL('../scripts/python-runtime-lock.json', import.meta.url), 'utf8')) as {
      distributions: Array<{ name: string; version: string }>;
      schema: number;
      python: string;
      platform: string;
    };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

    expect(pkg.scripts['package:win']).toContain('scripts/package-win.ps1');
    expect(deps['electron-builder']).toBeDefined();
    expect(pkg.build).toMatchObject({
      electronDist: 'node_modules/electron/dist',
      productName: 'StoryDream',
      directories: { output: 'release' },
      extraResources: expect.arrayContaining([{ from: 'vendor/python', to: 'python' }]),
      asar: true,
      electronFuses: {
        enableEmbeddedAsarIntegrityValidation: true,
        enableNodeCliInspectArguments: false,
        enableNodeOptionsEnvironmentVariable: false,
        onlyLoadAppFromAsar: true,
      },
      win: { target: ['nsis'], signAndEditExecutable: false },
    });
    expect(pkg.scripts.build).toContain('scripts/build.ps1');
    expect(packageScript).toContain('node_modules/electron-builder/cli.js');
    expect(packageScript).toContain('scripts\\prepare-python-runtime.ps1');
    expect(packageScript).toContain('--win');
    expect(packageScript).toContain("$BuilderArgs = @('node_modules/electron-builder/cli.js', '--win')");
    expect(packageScript).toContain('Compress-Archive');
    expect(packageScript).toContain('StoryDream-Portable-${Version}.zip');
    expect(packageScript).toContain("$PortableDir = Join-Path $ReleaseDir 'StoryDream-Portable'");
    expect(packageScript).toContain('node --check');
    for (const dependency of [
      'pyJianYingDraft',
      'faster-whisper',
      'playwright',
      'httpx',
      'imageio-ffmpeg',
      'pydub',
      'jieba',
      'browser-cookie3',
      'pycryptodomex',
      'PyYAML',
      'gmssl',
      'aiofiles',
    ]) {
      expect(pythonRuntimeScript).toContain(dependency);
    }
    expect(pythonRuntimeScript).not.toContain('yt-dlp');
    expect(pythonRuntimeScript).toContain('playwright install chromium');
    expect(pythonRuntimeScript).toContain('storydream-media-runtime-v9');
    expect(pythonRuntimeScript).toContain('manifest_sha256=$ManifestHash');
    expect(pythonRuntimeScript).toContain('package_lock_sha256=$PackageLockHash');
    expect(pythonRuntimeScript).toContain('pixelle_sha256=$PixelleRequirementsHash');
    expect(pythonRuntimeScript).toContain('distribution_count=$($PackageLock.distributions.Count)');
    expect(pythonRuntimeScript).toContain('Test-RuntimeReady');
    expect(pythonRuntimeScript).toContain('import pyJianYingDraft, faster_whisper, playwright, httpx');
    expect(pythonRuntimeScript).toContain('import pydub, jieba');
    expect(pythonRuntimeScript).toContain('--no-deps --only-binary=:all: @PackageSpecs');
    expect(pythonRuntimeScript).toContain('importlib.metadata.version(package[\'name\']) == package[\'version\']');
    expect(pythonRuntimeLock).toMatchObject({ schema: 1, python: '3.12.4', platform: 'win_amd64' });
    expect(pythonRuntimeLock.distributions).toHaveLength(63);
    expect(packageScript).toContain('Invoke-Utf8Bootstrap');
    expect(pythonRuntimeScript).toContain('Invoke-Utf8Bootstrap');
  });
  it.skipIf(!powershellAvailable).each([
    { directoryOnly: false, outputDirectory: '' },
    { directoryOnly: true, outputDirectory: '' },
    { directoryOnly: false, outputDirectory: 'D:/workspace/custom-release' },
    { directoryOnly: true, outputDirectory: 'D:/workspace/custom-release' },
  ])('builds the requested Windows target without publishing: $directoryOnly / $outputDirectory', async ({ directoryOnly, outputDirectory }) => {
    const source = await readFile(new URL('../scripts/package-win.ps1', import.meta.url), 'utf8');
    const construction = source.match(/\$BuilderArgs = @\([\s\S]+?\r?\nnode @BuilderArgs/)?.[0];
    expect(construction).toBeDefined();
    // Execute the real argument-construction block, replacing only the external builder call.
    const command = [
      "$ErrorActionPreference = 'Stop'",
      '$DirectoryOnly = $' + String(directoryOnly),
      "$OutputDirectory = '" + outputDirectory.replaceAll("'", "''") + "'",
      construction!.replace(/node @BuilderArgs$/, 'ConvertTo-Json -InputObject $BuilderArgs -Compress'),
    ].join('\n');
    const args = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    }).trim());
    expect(args).toEqual([
      'node_modules/electron-builder/cli.js', '--win', directoryOnly ? '--dir' : 'nsis', '--x64', '--publish=never',
      ...(outputDirectory ? ['--config.directories.output=' + outputDirectory] : []),
    ]);
  });
});
