param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination, [Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^v22\.\d+\.\d+$') { throw 'LEMO_RELEASE_NODE_VERSION' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Directory]::CreateDirectory($Destination) | Out-Null
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  foreach ($name in @('node.exe', 'LICENSE')) {
    $entry = $zip.GetEntry("node-$Version-win-x64/$name")
    if ($null -eq $entry) { throw "LEMO_RELEASE_NODE_ARCHIVE_INCOMPLETE: $name" }
    $target = Join-Path $Destination $name
    $inputStream = $entry.Open()
    $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew)
    try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
  }
} finally { $zip.Dispose() }
