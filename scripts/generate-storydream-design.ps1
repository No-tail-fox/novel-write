[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('projects', 'workspace')][string]$View,
  [string]$BaseUrl = 'https://ai.input.im',
  [ValidatePattern('^\d+x\d+$')][string]$Size = '3840x2160'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$promptPath = Join-Path $projectRoot "docs/design/storydream-web-redesign/$View-prompt.txt"
$outputPath = Join-Path $projectRoot ".artifacts/storydream-web-redesign/$View-$Size.png"
[string]$promptText = Get-Content -LiteralPath $promptPath -Raw -Encoding UTF8

if (-not $env:INPUT_IM_API_KEY) { throw 'INPUT_IM_API_KEY is required in the current process environment.' }
# Send bytes so Windows PowerShell cannot reinterpret Chinese as a legacy code page.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
try {
  if ($BaseUrl -notin @('https://ai.input.im', 'https://input.codes')) {
    throw 'Only the configured Input IM endpoints are supported.'
  }
  $request = @{
    model = 'gpt-image-2'
    prompt = $promptText
    size = $Size
    quality = 'high'
    output_format = 'png'
  } | ConvertTo-Json -Depth 4
  $response = Invoke-RestMethod -Method Post -Uri "$BaseUrl/v1/images/generations" `
    -Headers @{ Authorization = "Bearer $env:INPUT_IM_API_KEY" } `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($request)) -TimeoutSec 300
  $item = @($response.data)[0]
  if (-not $item.b64_json) { throw 'The response did not include inline image data.' }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null
  [System.IO.File]::WriteAllBytes($outputPath, [Convert]::FromBase64String($item.b64_json))
  Add-Type -AssemblyName System.Drawing
  $bitmap = [System.Drawing.Image]::FromFile($outputPath)
  try {
    @{ ok = $true; file = $outputPath; width = $bitmap.Width; height = $bitmap.Height;
      provider = $BaseUrl; requestedSize = $Size; upscaled = $false } | ConvertTo-Json
  } finally { $bitmap.Dispose() }
} catch {
  $detail = "$($_.Exception.Message) $($_.ErrorDetails.Message)"
  $detail = $detail.Replace($env:INPUT_IM_API_KEY, '[REDACTED]')
  @{ ok = $false; error = $detail } | ConvertTo-Json
  exit 1
}
