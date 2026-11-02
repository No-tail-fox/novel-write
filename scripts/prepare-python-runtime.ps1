$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "utf8-bootstrap.ps1")
$currentArgs = @($args)
if (Invoke-Utf8Bootstrap -ScriptPath $PSCommandPath -ScriptArgs $currentArgs) { return }
. (Join-Path $PSScriptRoot "runtime-directory-transaction.ps1")
$PythonVersion = "3.12.4"
$PythonTag = "312"
$PipIndexUrl = "https://pypi.org/simple"
$DownloadManifestPath = Join-Path $PSScriptRoot "runtime-downloads.json"
$Downloads = Get-Content -LiteralPath $DownloadManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Downloads.version -ne 1 -or $null -eq $Downloads.artifacts.pythonEmbed -or $null -eq $Downloads.artifacts.getPip) {
  throw "RUNTIME_DOWNLOAD_MANIFEST_INVALID: Expected versioned Python and get-pip artifacts."
}
$ManifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $DownloadManifestPath).Hash.ToLowerInvariant()
$RuntimeId = "python-$PythonVersion-storydream-media-runtime-v9"
$VendorDir = Join-Path $Root "vendor\python"
$CacheDir = Join-Path $Root ".cache\python-runtime"
$ZipPath = Join-Path $CacheDir "python-$PythonVersion-embed-amd64.zip"
$GetPipPath = Join-Path $CacheDir "get-pip.py"
$PixelleRequirementsPath = Join-Path $PSScriptRoot "pixelle-runtime-requirements.txt"
$PackageLockPath = Join-Path $PSScriptRoot "python-runtime-lock.json"
$PackageLock = Get-Content -LiteralPath $PackageLockPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($PackageLock.schema -ne 1 -or $PackageLock.python -ne $PythonVersion -or $PackageLock.platform -ne "win_amd64" -or $PackageLock.distributions.Count -lt 1 -or $null -eq $PackageLock.verifiedArtifacts.jiebaSource) {
  throw "PYTHON_RUNTIME_LOCK_INVALID: Expected the versioned Windows Python package lock."
}
$PackageSpecs = @($PackageLock.distributions | ForEach-Object {
  if (![string]$_.name -or [string]$_.version -notmatch "^\d[\w.+!-]*$") { throw "PYTHON_RUNTIME_LOCK_INVALID: Distribution identity is invalid." }
  if (!$_.sourceArtifact) { "$($_.name)==$($_.version)" }
})
$DirectPackageNames = @("pyJianYingDraft", "faster-whisper", "playwright", "httpx", "imageio-ffmpeg", "pydub", "jieba", "browser-cookie3", "pycryptodomex", "PyYAML", "gmssl", "aiofiles")
foreach ($name in $DirectPackageNames) {
  $normalizedName = ($name -replace '[-_.]+', '-').ToLowerInvariant()
  $locked = @($PackageLock.distributions | Where-Object { (([string]$_.name) -replace '[-_.]+', '-').ToLowerInvariant() -eq $normalizedName })
  $expected = [string]$PackageLock.directPackages.$name
  if ($locked.Count -ne 1 -or $locked[0].version -ne $expected) { throw "PYTHON_RUNTIME_LOCK_INVALID: Direct package version mismatch: $name" }
}
$PackageLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PackageLockPath).Hash.ToLowerInvariant()
$PixelleRequirementsHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PixelleRequirementsPath).Hash.ToLowerInvariant()
$JiebaSourcePath = Join-Path $CacheDir "jieba-0.42.1.tar.gz"

function Get-ExpectedSha256([object]$Artifact) {
  $url = [string]$Artifact.url
  $sha256 = ([string]$Artifact.sha256).ToLowerInvariant()
  $uri = $null
  if (![Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne "https" -or $sha256 -notmatch "^[a-f0-9]{64}$") {
    throw "RUNTIME_DOWNLOAD_MANIFEST_INVALID: Artifact URL or SHA-256 is invalid."
  }
  return $sha256
}

function Assert-FileSha256([string]$Path, [string]$ExpectedSha256) {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedSha256) {
    throw "RUNTIME_DOWNLOAD_INTEGRITY_FAILED: SHA-256 mismatch for $Path."
  }
}

function Ensure-VerifiedDownload([object]$Artifact, [string]$Path) {
  $expectedSha256 = Get-ExpectedSha256 $Artifact
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    try {
      Assert-FileSha256 $Path $expectedSha256
      return
    } catch { Write-Warning "[python-runtime] Ignoring cached artifact with invalid SHA-256: $Path" }
  }
  $temporaryPath = "$Path.$([Guid]::NewGuid().ToString('N')).part"
  try {
    Write-Host "[python-runtime] Downloading $($Artifact.url)"
    Invoke-WebRequest -Uri $Artifact.url -OutFile $temporaryPath -UseBasicParsing -TimeoutSec 60
    Assert-FileSha256 $temporaryPath $expectedSha256
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
  }
}

function Test-RuntimeMarkerCurrent([string]$Directory) {
  $readyFile = Join-Path $Directory ".storydream-python-runtime"
  if (!(Test-Path -LiteralPath $readyFile -PathType Leaf)) { return $false }
  try {
    $marker = @(Get-Content -LiteralPath $readyFile -Encoding UTF8)
    return ($marker -contains "runtime=$RuntimeId") -and ($marker -contains "manifest_sha256=$ManifestHash") -and ($marker -contains "package_lock_sha256=$PackageLockHash") -and ($marker -contains "pixelle_sha256=$PixelleRequirementsHash")
  } catch { return $false }
}

function Assert-RuntimeReady([string]$Directory) {
  $pythonExe = Join-Path $Directory "python.exe"
  if (!(Test-Path -LiteralPath $pythonExe -PathType Leaf) -or !(Test-RuntimeMarkerCurrent $Directory)) {
    throw "PYTHON_RUNTIME_MARKER_INVALID: $Directory"
  }
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Directory "playwright-browsers"
  $validation = @'
import importlib.metadata, json, pathlib, re, subprocess, sys
import pyJianYingDraft, faster_whisper, playwright, httpx, imageio_ffmpeg, browser_cookie3, yaml, gmssl, aiofiles
import pydub, jieba, Cryptodome, pydantic, loguru, ffmpeg, bs4, av, PIL, numpy
from playwright.sync_api import sync_playwright
assert '.'.join(map(str, sys.version_info[:3])) == sys.argv[2], 'Python version mismatch'
requirements = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
for name, expected in re.findall(r'^([A-Za-z0-9_.-]+)==([^\s\\]+)', requirements, re.M):
    assert importlib.metadata.version(name) == expected, 'Pinned package mismatch: ' + name
lock = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding='utf-8'))
for package in lock['distributions']:
    assert importlib.metadata.version(package['name']) == package['version'], 'Locked runtime package mismatch: ' + package['name']
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-version'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 64, 'height': 64})
    page.set_content('<html><body>StoryDream runtime validation</body></html>')
    assert page.screenshot().startswith(b'\x89PNG'), 'Bundled browser rendering failed'
    browser.close()
print('storydream media runtime ready')
'@
  & $pythonExe -c $validation $PixelleRequirementsPath $PythonVersion $PackageLockPath
  if ($LASTEXITCODE -ne 0) { throw "PYTHON_RUNTIME_VALIDATION_FAILED: $Directory (exit $LASTEXITCODE)" }
}

function Test-RuntimeReady([string]$Directory) {
  if (!(Test-RuntimeMarkerCurrent $Directory)) { return $false }
  try { Assert-RuntimeReady $Directory | Out-Null; return $true } catch { return $false }
}

Assert-RuntimeDirectoryPath $CacheDir $Root | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $CacheDir 'temp') | Out-Null
$environment = @{}
foreach ($key in @('PYTHONNOUSERSITE', 'PYTHONPATH', 'PYTHONDONTWRITEBYTECODE', 'PLAYWRIGHT_BROWSERS_PATH', 'PIP_CACHE_DIR', 'TEMP', 'TMP', 'TMPDIR')) {
  $environment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
try {
  $env:PYTHONNOUSERSITE = '1'
  $env:PYTHONPATH = ''
  $env:PYTHONDONTWRITEBYTECODE = '1'
  $env:PIP_CACHE_DIR = Join-Path $CacheDir 'pip'
  $env:TEMP = Join-Path $CacheDir 'temp'
  $env:TMP = $env:TEMP
  $env:TMPDIR = $env:TEMP
  $result = Invoke-RuntimeDirectoryTransaction -WorkspaceRoot $Root -ActiveDirectory $VendorDir -IsCurrent {
    param($Directory)
    Test-RuntimeReady $Directory
  } -Prepare {
    param($CandidateDir)
    # Both trusted bootstrap downloads must pass before extraction or installation.
    Ensure-VerifiedDownload $Downloads.artifacts.pythonEmbed $ZipPath
    Ensure-VerifiedDownload $Downloads.artifacts.getPip $GetPipPath
    Ensure-VerifiedDownload $PackageLock.verifiedArtifacts.jiebaSource $JiebaSourcePath
    $pythonExe = Join-Path $CandidateDir 'python.exe'
    $pthPath = Join-Path $CandidateDir "python$PythonTag._pth"
    Write-Host "[python-runtime] Preparing embedded Python $PythonVersion in $CandidateDir"
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $CandidateDir -Force
    if (Test-Path -LiteralPath $pthPath) {
      $pth = (Get-Content -LiteralPath $pthPath -Raw -Encoding UTF8) -replace '#import site', 'import site'
      Set-Content -LiteralPath $pthPath -Value $pth -Encoding ASCII
    }
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $CandidateDir 'playwright-browsers'
    & $pythonExe $GetPipPath --no-warn-script-location --index-url $PipIndexUrl
    if ($LASTEXITCODE -ne 0) { throw "PYTHON_RUNTIME_PIP_BOOTSTRAP_FAILED: $LASTEXITCODE" }
    & $pythonExe -m pip install --no-warn-script-location --no-deps --only-binary=:all: @PackageSpecs --index-url $PipIndexUrl
    if ($LASTEXITCODE -ne 0) { throw "PYTHON_RUNTIME_PACKAGES_FAILED: $LASTEXITCODE" }
    & $pythonExe -m pip install --no-warn-script-location --no-deps --no-build-isolation $JiebaSourcePath
    if ($LASTEXITCODE -ne 0) { throw "PYTHON_RUNTIME_SOURCE_PACKAGE_FAILED: jieba 0.42.1 ($LASTEXITCODE)" }
    & $pythonExe -m pip install --no-warn-script-location --only-binary=:all: --require-hashes -r $PixelleRequirementsPath --index-url $PipIndexUrl
    if ($LASTEXITCODE -ne 0) { throw "PYTHON_RUNTIME_PINNED_PACKAGES_FAILED: $LASTEXITCODE" }
    & $pythonExe -m playwright install chromium --only-shell
    if ($LASTEXITCODE -ne 0) { throw "PYTHON_RUNTIME_BROWSER_INSTALL_FAILED: $LASTEXITCODE" }
    if (Test-Path -LiteralPath $pthPath) {
      Set-Content -LiteralPath $pthPath -Value @("python$PythonTag.zip", '.', 'Lib\site-packages') -Encoding ASCII
    }
    $marker = @("runtime=$RuntimeId", "python=$PythonVersion", "manifest_sha256=$ManifestHash", "package_lock_sha256=$PackageLockHash", "pixelle_sha256=$PixelleRequirementsHash", "distribution_count=$($PackageLock.distributions.Count)")
    Set-Content -LiteralPath (Join-Path $CandidateDir '.storydream-python-runtime') -Value $marker -Encoding ASCII
  } -Validate {
    param($Directory)
    Assert-RuntimeReady $Directory
  }
  if ($result.Reused) { Write-Host "[python-runtime] Reusing $VendorDir" }
  else {
    Write-Host "[python-runtime] Ready: $VendorDir"
    if ($result.BackupDirectory) { Write-Host "[python-runtime] Previous runtime retained: $($result.BackupDirectory)" }
  }
} finally {
  foreach ($key in $environment.Keys) { [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process') }
}
exit 0
