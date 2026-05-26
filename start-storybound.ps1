$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

Write-Host ""
Write-Host "========================================"
Write-Host "  Storybound Replica One-Click Startup"
Write-Host "========================================"
Write-Host ""

function Find-CommandPath {
  param(
    [string] $Name,
    [string[]] $Fallbacks
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  foreach ($fallback in $Fallbacks) {
    if (Test-Path -LiteralPath $fallback) {
      return $fallback
    }
  }

  throw "Cannot find $Name. Install it or add it to PATH."
}

$node = Find-CommandPath "node.exe" @(
  "I:\nodejs\node.exe",
  "G:\nvm\v20.19.5\node.exe",
  "C:\Program Files\nodejs\node.exe"
)

$npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if (-not $npm) {
  $npmPath = "I:\nodejs\npm.cmd"
  if (Test-Path -LiteralPath $npmPath) {
    $npm = [pscustomobject]@{ Source = $npmPath }
  }
}

if (-not (Test-Path -LiteralPath "node_modules")) {
  if (-not $npm) {
    throw "node_modules is missing and npm.cmd cannot be found."
  }

  Write-Host "[1/4] Installing dependencies..."
  & $npm.Source install --ignore-scripts
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
  }
} else {
  Write-Host "[1/4] Dependencies already exist"
}

if (-not (Test-Path -LiteralPath "node_modules\electron\dist\electron.exe")) {
  Write-Host "[2/4] Preparing Electron..."
  & $node "node_modules\electron\install.js"
  if ($LASTEXITCODE -ne 0) {
    throw "Electron install failed with exit code $LASTEXITCODE"
  }
} else {
  Write-Host "[2/4] Electron is ready"
}

Write-Host "[3/4] Building renderer and desktop entry..."
if (Test-Path -LiteralPath "dist-electron") {
  Remove-Item -LiteralPath "dist-electron" -Recurse -Force
}

& $node "node_modules\vite\bin\vite.js" build
if ($LASTEXITCODE -ne 0) {
  throw "Vite build failed with exit code $LASTEXITCODE"
}

& $node "scripts\build-electron.mjs"
if ($LASTEXITCODE -ne 0) {
  throw "Electron build failed with exit code $LASTEXITCODE"
}

Write-Host "[3/4] Checking generated JavaScript with node --check..."
& $node --check "dist-electron\electron\main.js"
if ($LASTEXITCODE -ne 0) {
  throw "Generated main process JavaScript is invalid."
}

& $node --check "dist-electron\electron\preload.js"
if ($LASTEXITCODE -ne 0) {
  throw "Generated preload JavaScript is invalid."
}

Write-Host "[4/4] Launching app..."
& $node "node_modules\electron\cli.js" "."
if ($LASTEXITCODE -ne 0) {
  throw "Electron exited with code $LASTEXITCODE"
}
