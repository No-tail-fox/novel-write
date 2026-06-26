$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "utf8-bootstrap.ps1")
if (Invoke-Utf8Bootstrap -ScriptPath $PSCommandPath -ScriptArgs $args) {
  return
}

Write-Host "[package] Building renderer"
node "node_modules/vite/bin/vite.js" build
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

Write-Host "[package] Creating Windows unpacked package"
node "node_modules/electron-builder/cli.js" --win --x64 --dir --publish=never
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Version = (Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
$ReleaseDir = Join-Path $Root "release"
$UnpackedDir = Join-Path $ReleaseDir "win-unpacked"
$PortableDir = Join-Path $Root "release\StoryDream-Portable"
$ZipPath = Join-Path $ReleaseDir "StoryDream-Portable-${Version}.zip"

if (!(Test-Path -LiteralPath (Join-Path $UnpackedDir "StoryDream.exe"))) {
  Write-Error "Expected unpacked app was not created: $UnpackedDir"
  exit 1
}

if (Test-Path -LiteralPath $PortableDir) {
  Remove-Item -LiteralPath $PortableDir -Recurse -Force
}
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
Get-ChildItem -LiteralPath $ReleaseDir -Filter "StoryDream-Portable-*.exe" | Remove-Item -Force

Move-Item -LiteralPath $UnpackedDir -Destination $PortableDir

Write-Host "[package] Creating portable zip"
Compress-Archive -LiteralPath $PortableDir -DestinationPath $ZipPath -Force

Write-Host "[package] Windows portable zip: $ZipPath"
exit 0
