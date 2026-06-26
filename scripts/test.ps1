$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "utf8-bootstrap.ps1")
if (Invoke-Utf8Bootstrap -ScriptPath $PSCommandPath -ScriptArgs $args) {
  return
}

node "node_modules/vitest/vitest.mjs" run --pool=threads --maxWorkers=1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
