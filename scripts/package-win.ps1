$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "utf8-bootstrap.ps1")
if (Invoke-Utf8Bootstrap -ScriptPath $PSCommandPath -ScriptArgs $args) {
  return
}

Write-Host "[package] Building renderer"
node "scripts/check-license-config.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node "scripts/build-renderer.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[package] Building isolated Pi worker"
$Node22 = Get-Command node22 -ErrorAction SilentlyContinue
if ($Node22) { & $Node22.Source "services/pi-agent-worker/build.mjs" }
else {
  $PreviousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = "1"
    & (Join-Path $Root "node_modules\electron\dist\electron.exe") "services/pi-agent-worker/build.mjs"
  } finally {
    if ($null -eq $PreviousElectronRunAsNode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $PreviousElectronRunAsNode }
  }
}
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath (Join-Path $Root "services\pi-agent-worker\dist\worker.mjs") -PathType Leaf)) { throw "Pi worker build failed or did not emit its entry file; Node >=22.19 is required." }

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

$IntegrityManifest = Join-Path $Root (".tmp\package-integrity-" + [guid]::NewGuid().ToString('N') + ".json")
Write-Host "[package] Verifying inputs and recording build-file hashes"
node "scripts/verify-package-integrity.mjs" before $IntegrityManifest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[package] Creating Windows installer and unpacked package"
node "node_modules/electron-builder/cli.js" --win nsis --x64 --publish=never
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[package] Verifying packaged files before accepting this release"
node "scripts/verify-package-integrity.mjs" after $IntegrityManifest (Join-Path $Root "release\win-unpacked")
if ($LASTEXITCODE -ne 0) { throw 'Package integrity failed. Do not distribute these output files.' }

$Version = (Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$ReleaseDir = Join-Path $Root "release"
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
$PortableDir = Join-Path $Root "release\StoryDream-Portable"
$ZipPath = Join-Path $ReleaseDir "StoryDream-Portable-${Version}.zip"

if (!(Test-Path -LiteralPath (Join-Path $UnpackedDir "StoryDream.exe"))) {
  Write-Error "Expected unpacked app was not created: $UnpackedDir"
  exit 1
}

if (Test-Path -LiteralPath $PortableDir) {
  if ([IO.Path]::GetFullPath($PortableDir) -ne (Join-Path ([IO.Path]::GetFullPath($Root)) 'release\StoryDream-Portable')) { throw 'Unsafe portable directory.' }
  Remove-Item -LiteralPath $PortableDir -Recurse -Force
}
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
Get-ChildItem -LiteralPath $ReleaseDir -Filter "StoryDream-Portable-*.exe" | Remove-Item -Force

if ([IO.Path]::GetFullPath($UnpackedDir) -ne (Join-Path ([IO.Path]::GetFullPath($Root)) 'release\win-unpacked')) { throw 'Unsafe unpacked directory.' }
Move-Item -LiteralPath $UnpackedDir -Destination $PortableDir

Write-Host "[package] Creating portable zip"
Compress-Archive -LiteralPath $PortableDir -DestinationPath $ZipPath -Force

Write-Host "[package] Windows portable zip: $ZipPath"
exit 0
