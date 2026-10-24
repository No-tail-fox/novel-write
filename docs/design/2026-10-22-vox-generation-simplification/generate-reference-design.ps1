param(
  [Parameter(Mandatory)][string]$PromptFile,
  [Parameter(Mandatory)][string]$OutputName
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if ($OutputName -notmatch '^[a-z][a-z0-9-]+$') { throw 'OutputName must be a simple lowercase name.' }
$destination = Join-Path $root "concepts/$OutputName"
if (Test-Path -LiteralPath $destination) { throw 'Output folder already exists; do not retry a paid request automatically.' }
New-Item -ItemType Directory -Path $destination | Out-Null
$reference = Join-Path $root 'evidence/desktop-current.png'
$prompt = Get-Content -LiteralPath $PromptFile -Raw -Encoding UTF8
$key = [Environment]::GetEnvironmentVariable('VLLMPROXY_API_KEY', 'Process')
if (-not $key) { $key = [Environment]::GetEnvironmentVariable('VLLMPROXY_API_KEY', 'User') }
if (-not $key) { throw 'VLLMPROXY_API_KEY is not configured.' }
$request = [ordered]@{
  endpoint = 'https://api.vllmproxy.com/v1/images/edits'
  model = 'gpt-image-2'
  prompt = $prompt
  size = '1536x1024'
  quality = 'high'
  output_format = 'png'
  n = 1
  referenceImage = $reference
  automaticRetries = 0
}
$request | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'request.json') -Encoding utf8
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromMinutes(6)
$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $key)
$form = [System.Net.Http.MultipartFormDataContent]::new()
foreach ($name in @('model','prompt','size','quality','output_format','n')) {
  $form.Add([System.Net.Http.StringContent]::new([string]$request[$name], [Text.Encoding]::UTF8), $name)
}
$bytes = [IO.File]::ReadAllBytes($reference)
$image = [System.Net.Http.ByteArrayContent]::new($bytes)
$image.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('image/png')
$form.Add($image, 'image', 'storydream-vox-current.png')
$watch = [Diagnostics.Stopwatch]::StartNew()
try {
  $response = $client.PostAsync($request.endpoint, $form).GetAwaiter().GetResult()
  $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if (-not $response.IsSuccessStatusCode) {
    [ordered]@{status='failed';httpStatus=[int]$response.StatusCode;elapsedSeconds=$watch.Elapsed.TotalSeconds;chargeUnknown=$true;automaticRetries=0} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'metadata.json') -Encoding utf8
    throw "Image edit returned HTTP $([int]$response.StatusCode). No retry submitted; charge state unknown."
  }
  $payload = $body | ConvertFrom-Json
  $item = $payload.data | Select-Object -First 1
  if ($item.b64_json) {
    [IO.File]::WriteAllBytes((Join-Path $destination 'design.png'), [Convert]::FromBase64String($item.b64_json))
  } elseif ($item.url) {
    # Image storage URLs must not receive the API Authorization header.
    $downloadClient = [System.Net.Http.HttpClient]::new()
    $downloadClient.Timeout = [TimeSpan]::FromMinutes(2)
    try {
      $file = $downloadClient.GetByteArrayAsync([string]$item.url).GetAwaiter().GetResult()
      [IO.File]::WriteAllBytes((Join-Path $destination 'design.png'), $file)
    } finally { $downloadClient.Dispose() }
  } else { throw 'The provider returned no usable image; do not retry automatically.' }
  Add-Type -AssemblyName System.Drawing
  $bitmap = [Drawing.Image]::FromFile((Join-Path $destination 'design.png'))
  $metadata = [ordered]@{status='success';modelRequested=$request.model;modelReturned=$payload.model;width=$bitmap.Width;height=$bitmap.Height;matchesRequestedSize=($bitmap.Width -eq 1536 -and $bitmap.Height -eq 1024);locallyUpscaled=$false;referenceImageAttached=$true;elapsedSeconds=[Math]::Round($watch.Elapsed.TotalSeconds,2);automaticRetries=0;output=(Join-Path $destination 'design.png')}
  $bitmap.Dispose()
  $metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'metadata.json') -Encoding utf8
  $metadata | ConvertTo-Json
} finally {
  $form.Dispose()
  $client.Dispose()
  $key = $null
}
