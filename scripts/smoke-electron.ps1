$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "utf8-bootstrap.ps1")
if (Invoke-Utf8Bootstrap -ScriptPath $PSCommandPath -ScriptArgs $args) {
  return
}

& (Join-Path $PSScriptRoot "run-npm-node.cmd") "scripts/smoke-electron.cjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
