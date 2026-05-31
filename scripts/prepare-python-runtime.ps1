$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$PythonVersion = "3.12.4"
$PythonTag = "312"
$PackageName = "pyJianYingDraft"
$PipIndexUrl = "https://pypi.org/simple"
$RuntimeId = "python-$PythonVersion-$PackageName-isolated-v1"
$VendorDir = Join-Path $Root "vendor\python"
$CacheDir = Join-Path $Root ".cache\python-runtime"
$ZipPath = Join-Path $CacheDir "python-$PythonVersion-embed-amd64.zip"
$GetPipPath = Join-Path $CacheDir "get-pip.py"
$ReadyFile = Join-Path $VendorDir ".storybound-python-runtime"
$PythonExe = Join-Path $VendorDir "python.exe"

function Assert-UnderRoot([string]$Path) {
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $pathFull = [System.IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
  if (!$pathFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside project root: $Path"
  }
}

function Test-RuntimeReady {
  if (!(Test-Path -LiteralPath $PythonExe) -or !(Test-Path -LiteralPath $ReadyFile)) {
    return $false
  }
  $marker = Get-Content -LiteralPath $ReadyFile -Raw
  if (!$marker.Contains("runtime=$RuntimeId")) {
    return $false
  }
  try {
    & $PythonExe -c "import pyJianYingDraft; print('pyJianYingDraft ready')" | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

if (Test-RuntimeReady) {
  Write-Host "[python-runtime] Reusing $VendorDir"
  exit 0
}

Assert-UnderRoot $VendorDir
Assert-UnderRoot $CacheDir

if (Test-Path -LiteralPath $VendorDir) {
  Write-Host "[python-runtime] Removing incomplete runtime: $VendorDir"
  Remove-Item -LiteralPath $VendorDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

if (!(Test-Path -LiteralPath $ZipPath)) {
  $pythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
  Write-Host "[python-runtime] Downloading $pythonUrl"
  Invoke-WebRequest -Uri $pythonUrl -OutFile $ZipPath -UseBasicParsing
}

Write-Host "[python-runtime] Expanding embedded Python $PythonVersion"
Expand-Archive -LiteralPath $ZipPath -DestinationPath $VendorDir -Force

$PthPath = Join-Path $VendorDir "python$PythonTag._pth"
if (Test-Path -LiteralPath $PthPath) {
  $pth = Get-Content -LiteralPath $PthPath -Raw
  $pth = $pth -replace "#import site", "import site"
  Set-Content -LiteralPath $PthPath -Value $pth -Encoding ASCII
}

$env:PYTHONNOUSERSITE = "1"
$env:PYTHONPATH = ""

if (!(Test-Path -LiteralPath $GetPipPath)) {
  Write-Host "[python-runtime] Downloading get-pip.py"
  Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $GetPipPath -UseBasicParsing
}

Write-Host "[python-runtime] Installing pip"
& $PythonExe $GetPipPath --no-warn-script-location --index-url $PipIndexUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[python-runtime] Installing $PackageName"
& $PythonExe -m pip install --no-warn-script-location --upgrade pip --index-url $PipIndexUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $PythonExe -m pip install --no-warn-script-location $PackageName --index-url $PipIndexUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Test-Path -LiteralPath $PthPath) {
  Set-Content -LiteralPath $PthPath -Value "python$PythonTag.zip`r`n.`r`nLib\site-packages" -Encoding ASCII
}

& $PythonExe -c "import pyJianYingDraft; print('pyJianYingDraft ready')"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Set-Content -LiteralPath $ReadyFile -Value "runtime=$RuntimeId`npython=$PythonVersion`npackage=$PackageName" -Encoding ASCII
Write-Host "[python-runtime] Ready: $VendorDir"
