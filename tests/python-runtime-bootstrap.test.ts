import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const helper = join(root, 'scripts/runtime-directory-transaction.ps1');
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const powershellAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { windowsHide: true }).status === 0;

describe('Windows Python runtime bootstrap integrity', () => {
  it('pins official bootstrap artifacts and verifies cached and fresh downloads before use', async () => {
    const [script, manifestText, packageLockText] = await Promise.all([
      readFile(join(root, 'scripts/prepare-python-runtime.ps1'), 'utf8'),
      readFile(join(root, 'scripts/runtime-downloads.json'), 'utf8'),
      readFile(join(root, 'scripts/python-runtime-lock.json'), 'utf8'),
    ]);
    const packageLock = JSON.parse(packageLockText);
    expect(packageLock).toMatchObject({
      schema: 1,
      python: '3.12.4',
      platform: 'win_amd64',
      directPackages: {
        pyjianyingdraft: '0.2.6', 'faster-whisper': '1.2.1', playwright: '1.60.0', httpx: '0.28.1',
        'imageio-ffmpeg': '0.6.0', pydub: '0.25.1', jieba: '0.42.1', 'browser-cookie3': '0.20.1',
        pycryptodomex: '3.23.0', pyyaml: '6.0.3', gmssl: '3.2.2', aiofiles: '25.1.0',
      },
      verifiedArtifacts: {
        jiebaSource: {
          url: 'https://files.pythonhosted.org/packages/c6/cb/18eeb235f833b726522d7ebed54f2278ce28ba9438e3135ab0278d9792a2/jieba-0.42.1.tar.gz',
          sha256: '055ca12f62674fafed09427f176506079bc135638a14e23e25be909131928db2',
        },
      },
    });
    expect(packageLock.distributions).toHaveLength(63);
    expect(packageLock.distributions.filter((packageEntry: { sourceArtifact?: string }) => packageEntry.sourceArtifact)).toEqual([
      { name: 'jieba', version: '0.42.1', sourceArtifact: 'jiebaSource' },
    ]);
    expect(JSON.parse(manifestText)).toEqual({
      version: 1,
      artifacts: {
        pythonEmbed: {
          url: 'https://www.python.org/ftp/python/3.12.4/python-3.12.4-embed-amd64.zip',
          sha256: '15fea3c9367653a85086fe37216b4d1a1c78688fa5e1587e1db0b0f658856564',
        },
        getPip: {
          url: 'https://raw.githubusercontent.com/pypa/get-pip/5e84c8360eaf92009551b3eec69d734137f31cec/public/get-pip.py',
          sha256: 'a341e1a43e38001c551a1508a73ff23636a11970b61d901d9a1cad2a18f57055',
        },
      },
    });
    expect(script).toContain('Assert-FileSha256 $Path $expectedSha256');
    expect(script).toContain('Assert-FileSha256 $temporaryPath $expectedSha256');
    expect(script).toContain('Ensure-VerifiedDownload $PackageLock.verifiedArtifacts.jiebaSource $JiebaSourcePath');
    expect(script).toContain('--no-deps --no-build-isolation $JiebaSourcePath');
    expect(script).toContain('manifest_sha256=$ManifestHash');
    expect(script).toContain('package_lock_sha256=$PackageLockHash');
    expect(script).toContain('--require-hashes');
    expect(script.indexOf('Ensure-VerifiedDownload $Downloads.artifacts.getPip $GetPipPath')).toBeLessThan(script.indexOf('Expand-Archive'));
    expect(script).toContain('Invoke-RuntimeDirectoryTransaction');
    expect(script).not.toContain('Remove-Item -LiteralPath $VendorDir');
    expect(script).not.toContain('Repairing existing runtime in place');
    expect(script).toContain('PYTHON_RUNTIME_BROWSER_INSTALL_FAILED');
    expect(script).toContain('page.screenshot()');
    expect(script).toContain('importlib.metadata.version(name) == expected');
    expect(script).toContain('importlib.metadata.version(package[\'name\']) == package[\'version\']');
    expect(script).toContain('--no-deps --only-binary=:all: @PackageSpecs');
    expect(script).not.toContain('--upgrade pip setuptools wheel');
    expect(script).not.toContain('$PackageNames = @(');
  });
});

describe.skipIf(!powershellAvailable)('runtime directory preparation and rollback on the filesystem', () => {
  let fixture: string;
  let active: string;
  beforeEach(async () => {
    const base = join(root, '.artifacts/python-runtime-tests');
    await mkdir(base, { recursive: true });
    fixture = await mkdtemp(join(base, 'case-'));
    active = join(fixture, 'vendor/python');
    await mkdir(join(active, 'nested'), { recursive: true });
    await writeFile(join(active, 'identity.txt'), 'original-runtime', 'utf8');
    await writeFile(join(active, 'nested/sidecar.txt'), 'original-sidecar', 'utf8');
  });
  afterEach(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }); });

  async function run(body: string) {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      '. ' + quote(helper),
      '$arguments = @{',
      '  WorkspaceRoot = ' + quote(fixture),
      '  ActiveDirectory = ' + quote(active),
      "  Prepare = { param($candidate) [IO.File]::WriteAllText((Join-Path $candidate 'identity.txt'), 'replacement-runtime') }",
      "  Validate = { param($candidate) if ([IO.File]::ReadAllText((Join-Path $candidate 'identity.txt')) -ne 'replacement-runtime') { throw 'INVALID_CANDIDATE' } }",
      '}',
      body,
    ].join('\n');
    const scriptPath = join(fixture, 'test.ps1');
    await writeFile(scriptPath, script, 'utf8');
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, TEMP: fixture, TMP: fixture },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const json = result.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
    return json ? JSON.parse(json.slice(7)) : undefined;
  }

  async function expectOriginal() {
    expect(await readFile(join(active, 'identity.txt'), 'utf8')).toBe('original-runtime');
    expect(await readFile(join(active, 'nested/sidecar.txt'), 'utf8')).toBe('original-sidecar');
    expect((await readdir(join(fixture, 'vendor'))).filter(name => name.includes('.staging-'))).toEqual([]);
  }

  it('preserves every original file when preparation fails', async () => {
    await run([
      "$arguments.Prepare = { param($candidate) [IO.File]::WriteAllText((Join-Path $candidate 'partial.txt'), 'partial'); throw 'PREPARE_FAILED' }",
      "try { Invoke-RuntimeDirectoryTransaction @arguments; throw 'EXPECTED_FAILURE' } catch { if ($_.Exception.Message -ne 'PREPARE_FAILED') { throw } }",
    ].join('\n'));
    await expectOriginal();
  });

  it('preserves the original runtime when candidate validation fails', async () => {
    await run([
      "$arguments.Validate = { throw 'VALIDATION_FAILED' }",
      "try { Invoke-RuntimeDirectoryTransaction @arguments; throw 'EXPECTED_FAILURE' } catch { if ($_.Exception.Message -ne 'VALIDATION_FAILED') { throw } }",
    ].join('\n'));
    await expectOriginal();
  });

  it('activates only a validated candidate, checks its final path, and retains the original backup', async () => {
    const result = await run([
      '$script:visits = @()',
      '$arguments.Validate = { param($candidate) $script:visits += $candidate }',
      '$result = Invoke-RuntimeDirectoryTransaction @arguments',
      "Write-Output ('RESULT:' + (@{result=$result;visits=$script:visits} | ConvertTo-Json -Compress))",
    ].join('\n'));
    expect(result.visits).toHaveLength(2);
    expect(result.visits[0]).toContain('.python.staging-');
    expect(resolve(result.visits[1])).toBe(resolve(active));
    expect(await readFile(join(active, 'identity.txt'), 'utf8')).toBe('replacement-runtime');
    expect(await readFile(join(result.result.BackupDirectory, 'identity.txt'), 'utf8')).toBe('original-runtime');
    expect(await readFile(join(result.result.BackupDirectory, 'nested/sidecar.txt'), 'utf8')).toBe('original-sidecar');
  });

  it('rolls back the real directory swap if final-path validation fails', async () => {
    await run([
      '$script:visits = 0',
      "$arguments.Validate = { $script:visits++; if ($script:visits -eq 2) { throw 'RELOCATION_FAILED' } }",
      "try { Invoke-RuntimeDirectoryTransaction @arguments; throw 'EXPECTED_FAILURE' } catch { if ($_.Exception.Message -ne 'RELOCATION_FAILED') { throw } }",
    ].join('\n'));
    await expectOriginal();
  });

  it('restores the original after an injected activation rename failure', async () => {
    await run([
      '$script:moves = 0',
      'function Move-RuntimeDirectory {',
      '  param([string]$Source, [string]$Destination)',
      '  $script:moves++',
      "  if ($script:moves -eq 2) { throw 'RENAME_LOCKED' }",
      '  [IO.Directory]::Move($Source, $Destination)',
      '}',
      "try { Invoke-RuntimeDirectoryTransaction @arguments; throw 'EXPECTED_FAILURE' } catch { if ($_.Exception.Message -ne 'RENAME_LOCKED') { throw } }",
      "if ($script:moves -ne 3) { throw 'ROLLBACK_WAS_NOT_ATTEMPTED' }",
    ].join('\n'));
    await expectOriginal();
  });

  it('rejects a live lock, then safely reuses its stale file after the owner exits', async () => {
    const result = await run([
      '$lockPath = Join-Path (Split-Path -Parent $arguments.ActiveDirectory) \'.python.prepare.lock\'',
      '$lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)',
      'try {',
      "  try { Invoke-RuntimeDirectoryTransaction @arguments; throw 'EXPECTED_LOCK_FAILURE' } catch { if ($_.Exception.Message -notlike 'RUNTIME_DIRECTORY_PREPARATION_LOCKED:*') { throw } }",
      '} finally { $lock.Dispose() }',
      '$result = Invoke-RuntimeDirectoryTransaction @arguments',
      "Write-Output ('RESULT:' + ($result | ConvertTo-Json -Compress))",
    ].join('\n'));
    expect(result.Reused).toBe(false);
    expect(await readFile(join(active, 'identity.txt'), 'utf8')).toBe('replacement-runtime');
  });

  it('reuses a current runtime without touching its files or preparing a replacement', async () => {
    const result = await run([
      '$arguments.IsCurrent = { $true }',
      "$arguments.Prepare = { throw 'UNEXPECTED_PREPARATION' }",
      '$result = Invoke-RuntimeDirectoryTransaction @arguments',
      "Write-Output ('RESULT:' + ($result | ConvertTo-Json -Compress))",
    ].join('\n'));
    expect(result.Reused).toBe(true);
    await expectOriginal();
  });

  it('rejects runtime targets outside the workspace', async () => {
    await run([
      '$arguments.ActiveDirectory = Join-Path (Split-Path -Parent $arguments.WorkspaceRoot) \'outside-python\'',
      "try { Invoke-RuntimeDirectoryTransaction @arguments; throw 'EXPECTED_PATH_FAILURE' } catch { if ($_.Exception.Message -notlike 'RUNTIME_DIRECTORY_OUTSIDE_WORKSPACE:*') { throw } }",
    ].join('\n'));
    await expectOriginal();
  });

  it.skipIf(process.platform !== 'win32')('rejects directory junctions before any runtime mutation', async () => {
    const link = join(fixture, 'linked-runtime');
    await symlink(active, link, 'junction');
    await run([
      '$arguments.ActiveDirectory = ' + quote(link),
      "try { Invoke-RuntimeDirectoryTransaction @arguments; throw 'EXPECTED_LINK_FAILURE' } catch { if ($_.Exception.Message -notlike 'RUNTIME_DIRECTORY_LINK_REJECTED:*') { throw } }",
    ].join('\n'));
    await expectOriginal();
  });

  it('runs the real preparer against a bad bootstrap download and keeps the old runtime and environment', async () => {
    const scriptDirectory = join(fixture, 'scripts');
    const cache = join(fixture, '.cache/python-runtime');
    await mkdir(scriptDirectory, { recursive: true });
    await mkdir(cache, { recursive: true });
    for (const name of ['prepare-python-runtime.ps1', 'runtime-directory-transaction.ps1', 'utf8-bootstrap.ps1', 'pixelle-runtime-requirements.txt', 'python-runtime-lock.json']) {
      await copyFile(join(root, 'scripts', name), join(scriptDirectory, name));
    }
    const manifest = JSON.parse(await readFile(join(root, 'scripts/runtime-downloads.json'), 'utf8'));
    const verifiedFixtureArchive = Buffer.from('a verified fixture archive that must never be extracted');
    manifest.artifacts.pythonEmbed.sha256 = createHash('sha256').update(verifiedFixtureArchive).digest('hex');
    await writeFile(join(cache, 'python-3.12.4-embed-amd64.zip'), verifiedFixtureArchive);
    await writeFile(join(scriptDirectory, 'runtime-downloads.json'), JSON.stringify(manifest), 'utf8');
    await writeFile(join(active, 'python.exe'), 'prior-python-executable', 'utf8');
    await writeFile(join(active, '.storydream-python-runtime'), 'runtime=old-marker', 'utf8');
    await run([
      'function Invoke-WebRequest {',
      '  param($Uri, [string]$OutFile, [switch]$UseBasicParsing, [int]$TimeoutSec)',
      "  [IO.File]::WriteAllText($OutFile, 'untrusted fixture bootstrap')",
      '}',
      '$beforeTemp = $env:TEMP',
      'try {',
      '  & ' + quote(join(scriptDirectory, 'prepare-python-runtime.ps1')),
      "  throw 'EXPECTED_SHA_FAILURE'",
      "} catch { if ($_.Exception.Message -notlike 'RUNTIME_DOWNLOAD_INTEGRITY_FAILED:*') { throw } }",
      "if ($env:TEMP -ne $beforeTemp) { throw 'ENVIRONMENT_NOT_RESTORED' }",
    ].join('\n'));
    await expectOriginal();
    expect(await readFile(join(active, 'python.exe'), 'utf8')).toBe('prior-python-executable');
    expect(await readFile(join(active, '.storydream-python-runtime'), 'utf8')).toBe('runtime=old-marker');
    expect((await readdir(cache)).filter(name => name.endsWith('.part'))).toEqual([]);
  });
});
