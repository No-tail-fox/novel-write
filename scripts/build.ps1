$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "utf8-bootstrap.ps1")
if (Invoke-Utf8Bootstrap -ScriptPath $PSCommandPath -ScriptArgs $args) {
  return
}

Write-Host "[build] Building renderer"
node "scripts/build-renderer.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[build] Building isolated Pi worker"
$Node22 = Get-Command node22 -ErrorAction SilentlyContinue
if ($Node22) { & $Node22.Source "services/pi-agent-worker/build.mjs" }
else { $env:ELECTRON_RUN_AS_NODE = "1"; & (Join-Path $Root "node_modules\electron\dist\electron.exe") "services/pi-agent-worker/build.mjs" }
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath (Join-Path $Root "services\pi-agent-worker\dist\worker.mjs") -PathType Leaf)) { throw "Pi worker build failed or did not emit its entry file; Node >=22.19 is required." }

Write-Host "[build] Building Electron main and preload"
node "scripts/build-electron.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
