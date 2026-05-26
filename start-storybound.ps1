$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

Write-Host ""
Write-Host "========================================"
Write-Host "  Storybound Replica One-Click Startup"
Write-Host "========================================"
Write-Host ""

function Test-NodeVersionCompatible {
  param(
    [string] $Version
  )

  if ($Version -notmatch '^v?(\d+)\.(\d+)\.(\d+)') {
    return $false
  }

  $major = [int] $Matches[1]
  $minor = [int] $Matches[2]
  $patch = [int] $Matches[3]

  if ($major -eq 20) {
    return ($minor -gt 19) -or (($minor -eq 19) -and ($patch -ge 0))
  }

  if ($major -eq 22) {
    return ($minor -gt 12) -or (($minor -eq 12) -and ($patch -ge 0))
  }

  return $major -gt 22
}

function Find-CompatibleNodePath {
  $candidates = New-Object System.Collections.Generic.List[string]

  foreach ($command in (Get-Command "node.exe" -All -ErrorAction SilentlyContinue)) {
    $candidates.Add($command.Source)
  }

  foreach ($path in @(
    "$env:NVM_SYMLINK\node.exe",
    "$env:NVM_HOME\v22.12.0\node.exe",
    "$env:NVM_HOME\v20.19.0\node.exe",
    "$env:NVM_HOME\v20.19.5\node.exe",
    "I:\nodejs\node.exe",
    "G:\nvm\v20.19.5\node.exe",
    "H:\nvm\v22.12.0\node.exe",
    "C:\Program Files\nodejs\node.exe"
  )) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      $candidates.Add($path)
    }
  }

  if ($env:NVM_HOME -and (Test-Path -LiteralPath $env:NVM_HOME)) {
    foreach ($path in (Get-ChildItem -LiteralPath $env:NVM_HOME -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)) {
      $candidates.Add($path)
    }
  }

  $checked = New-Object System.Collections.Generic.List[string]

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    try {
      $version = & $candidate -v 2>$null
      $checked.Add("$candidate ($version)")

      if (Test-NodeVersionCompatible $version) {
        Write-Host "Using Node.js $version at $candidate"
        return $candidate
      }
    } catch {
      $checked.Add("$candidate (failed to run)")
    }
  }

  throw "Cannot find a compatible Node.js runtime. Vite requires Node.js 20.19.0+ or 22.12.0+. Checked: $($checked -join '; ')"
}

$node = Find-CompatibleNodePath

function Test-DependenciesReady {
  if (-not (Test-Path -LiteralPath "node_modules")) {
    return $false
  }

  foreach ($path in @(
    "node_modules\vite\bin\vite.js",
    "node_modules\electron\install.js",
    "node_modules\@rolldown\binding-win32-x64-msvc"
  )) {
    if (-not (Test-Path -LiteralPath $path)) {
      return $false
    }
  }

  return $true
}

$npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if (-not $npm) {
  $npmPath = "I:\nodejs\npm.cmd"
  if (Test-Path -LiteralPath $npmPath) {
    $npm = [pscustomobject]@{ Source = $npmPath }
  }
}

if (-not (Test-DependenciesReady)) {
  if (-not $npm) {
    throw "Dependencies are missing or incomplete and npm.cmd cannot be found."
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
