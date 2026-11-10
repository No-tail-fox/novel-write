$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "utf8-bootstrap.ps1")
if (Invoke-Utf8Bootstrap -ScriptPath $PSCommandPath -ScriptArgs $args) {
  return
}

node "scripts/verify.mjs" @args
exit $LASTEXITCODE
