param([switch]$DirectoryOnly, [string]$OutputDirectory = '')
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "utf8-bootstrap.ps1")
$bootstrapArgs = @()
if ($DirectoryOnly) { $bootstrapArgs += '-DirectoryOnly' }
if ($OutputDirectory) { $bootstrapArgs += @('-OutputDirectory', $OutputDirectory) }
$bootstrapArgs += $args
if (Invoke-Utf8Bootstrap -ScriptPath $PSCommandPath -ScriptArgs $bootstrapArgs) {
  return
}

$BuildCache = Join-Path $Root '.cache\windows-package'
New-Item -ItemType Directory -Path (Join-Path $BuildCache 'temp') -Force | Out-Null
$env:TEMP = Join-Path $BuildCache 'temp'
$env:TMP = $env:TEMP
$env:npm_config_cache = Join-Path $BuildCache 'npm'
$env:ELECTRON_CACHE = Join-Path $BuildCache 'electron'
$env:ELECTRON_BUILDER_CACHE = Join-Path $BuildCache 'electron-builder'
$DiskRoot = [IO.Path]::GetPathRoot($Root)
$Disk = [IO.DriveInfo]::new($DiskRoot)
if ($Disk.AvailableFreeSpace -lt 8GB) { throw 'WINDOWS_PACKAGE_DISK_SPACE: At least 8 GiB of free workspace is required.' }
if ($OutputDirectory) {
  $OutputDirectory = [IO.Path]::GetFullPath((Join-Path $Root $OutputDirectory))
  if (!$OutputDirectory.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'WINDOWS_PACKAGE_OUTPUT_OUTSIDE_WORKSPACE' }
}

Write-Host '[package] Preparing verified official SDK, CLI and standalone Node resources'
node 'scripts/prepare-lemo-release.mjs'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[package] Building renderer"
node "scripts/check-license-config.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node "scripts/build-renderer.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[package] Building Electron main and preload"
node "scripts/build-electron.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[package] Checking generated Electron syntax"
node --check "dist-electron/electron/main.js"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --check "dist-electron/electron/preload.js"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[package] Preparing bundled Python runtime"
& (Join-Path $Root "scripts\prepare-python-runtime.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[package] Creating Windows installer and unpacked package"
$BuilderArgs = @('node_modules/electron-builder/cli.js', '--win')
if ($DirectoryOnly) { $BuilderArgs += '--dir' } else { $BuilderArgs += 'nsis' }
$BuilderArgs += @('--x64', '--publish=never')
if ($OutputDirectory) { $BuilderArgs += "--config.directories.output=$OutputDirectory" }
node @BuilderArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$ReleaseDir = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $Root 'release' }
Write-Host '[package] Probing packaged resources with the bundled Node and locked official SDK'
node 'scripts/qa-lemo-package.mjs' '--resources' (Join-Path $ReleaseDir 'win-unpacked\resources') '--output' (Join-Path $ReleaseDir 'lemo-resource-verification')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($DirectoryOnly) { exit 0 }

$Version = (Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$InstallerPath = Join-Path $ReleaseDir "StoryDream-Setup-${Version}.exe"
$BlockmapPath = "$InstallerPath.blockmap"
foreach ($Artifact in @($InstallerPath, $BlockmapPath)) {
  if (!(Test-Path -LiteralPath $Artifact -PathType Leaf) -or (Get-Item -LiteralPath $Artifact).Length -eq 0) {
    throw "Expected update artifact was not created: $Artifact"
  }
}
Write-Host "[package] Update installer: $InstallerPath"
Write-Host "[package] Matching differential blockmap: $BlockmapPath"
$UnpackedDir = Join-Path $ReleaseDir "win-unpacked"
$PortableDir = Join-Path $ReleaseDir 'StoryDream-Portable'
$ZipPath = Join-Path $ReleaseDir "StoryDream-Portable-${Version}.zip"

if (!(Test-Path -LiteralPath (Join-Path $UnpackedDir "StoryDream.exe"))) {
  Write-Error "Expected unpacked app was not created: $UnpackedDir"
  exit 1
}

if (Test-Path -LiteralPath $PortableDir) {
  if ([IO.Path]::GetFullPath($PortableDir) -ne (Join-Path ([IO.Path]::GetFullPath($ReleaseDir)) 'StoryDream-Portable')) { throw 'Unsafe portable directory.' }
  Remove-Item -LiteralPath $PortableDir -Recurse -Force
}
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
Get-ChildItem -LiteralPath $ReleaseDir -Filter "StoryDream-Portable-*.exe" | Remove-Item -Force

if ([IO.Path]::GetFullPath($UnpackedDir) -ne (Join-Path ([IO.Path]::GetFullPath($ReleaseDir)) 'win-unpacked')) { throw 'Unsafe unpacked directory.' }
Move-Item -LiteralPath $UnpackedDir -Destination $PortableDir

Write-Host "[package] Creating portable zip"
Compress-Archive -LiteralPath $PortableDir -DestinationPath $ZipPath -Force

Write-Host "[package] Windows portable zip: $ZipPath"
exit 0
