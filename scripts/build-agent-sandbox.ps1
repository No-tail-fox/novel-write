[CmdletBinding()]
param(
  [string]$Compiler = 'G:\visual studio 2022\VC\Tools\MSVC\14.35.32215\bin\Hostx86\x64\cl.exe',
  [string]$WindowsSdk = 'C:\Program Files (x86)\Windows Kits\10',
  [switch]$Test,
  [switch]$PythonTest
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'services\agent-sandbox\native\sandbox_launcher.cpp'
$outDir = Join-Path $root 'services\agent-sandbox\bin'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (-not (Test-Path -LiteralPath $Compiler)) { throw "cl.exe not found: $Compiler" }
$vcRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $Compiler)))
$sdkVersion = Get-ChildItem -LiteralPath (Join-Path $WindowsSdk 'Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty Name
if (-not $sdkVersion) { throw 'Windows SDK is unavailable' }
$exe = Join-Path $outDir 'sandbox_launcher.exe'
$obj = Join-Path $outDir 'sandbox_launcher.obj'
$oldInclude = $env:INCLUDE
$oldLib = $env:LIB
try {
  $env:INCLUDE = "$vcRoot\include;$WindowsSdk\Include\$sdkVersion\ucrt;$WindowsSdk\Include\$sdkVersion\shared;$WindowsSdk\Include\$sdkVersion\um"
  $env:LIB = "$vcRoot\lib\x64;$WindowsSdk\Lib\$sdkVersion\ucrt\x64;$WindowsSdk\Lib\$sdkVersion\um\x64"
  & $Compiler /nologo /std:c++17 /EHsc /W4 /WX /MT /utf-8 $source "/Fo$obj" /link "/OUT:$exe" userenv.lib advapi32.lib
  if ($LASTEXITCODE -ne 0) { throw "native preflight build failed ($LASTEXITCODE)" }
} finally {
  $env:INCLUDE = $oldInclude
  $env:LIB = $oldLib
}
Write-Output "Built fail-closed sandbox launcher: $exe"
if ($PythonTest) {
  $fixtureParent = Join-Path $root 'services\agent-sandbox\fixtures'
  New-Item -ItemType Directory -Force -Path $fixtureParent | Out-Null
  & $exe --python-self-test $fixtureParent
  if ($LASTEXITCODE -ne 0) { throw "controlled Python confinement gate failed ($LASTEXITCODE); execution remains disabled" }
}
if ($Test) {
  $fixtureParent = Join-Path $root 'services\agent-sandbox\fixtures'
  New-Item -ItemType Directory -Force -Path $fixtureParent | Out-Null
  & $exe --preflight-fixture $fixtureParent
  if ($LASTEXITCODE -ne 0) { throw "native AppContainer preflight failed ($LASTEXITCODE)" }
  & $exe --python 'C:\not-executed.exe'
  if ($LASTEXITCODE -ne 126) { throw 'production execution must fail closed with exit 126' }
}
