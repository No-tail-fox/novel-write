$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

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

Write-Host "[package] Creating Windows exe package"
node "node_modules/electron-builder/cli.js" --win --x64 --dir --publish=never
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$ExePath = Join-Path $Root "release\win-unpacked\Storybound Replica.exe"
if (!(Test-Path -LiteralPath $ExePath)) {
  Write-Error "Expected packaged exe was not created: $ExePath"
  exit 1
}

Write-Host "[package] Windows exe: $ExePath"
exit 0
