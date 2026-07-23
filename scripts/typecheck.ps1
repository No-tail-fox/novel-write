$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "utf8-bootstrap.ps1")
if (Invoke-Utf8Bootstrap -ScriptPath $PSCommandPath -ScriptArgs $args) {
  return
}

node "node_modules/typescript/bin/tsc" -p tsconfig.json --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node "node_modules/typescript/bin/tsc" -p tsconfig.electron.json --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node "node_modules/typescript/bin/tsc" -p tsconfig.scripts.json --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
