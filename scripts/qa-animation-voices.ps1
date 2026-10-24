param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$items = Get-Content -LiteralPath $Manifest -Encoding UTF8 -Raw | ConvertFrom-Json
foreach ($item in $items) {
  $speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
  try {
    $speaker.SelectVoice('Microsoft Huihui Desktop')
    $speaker.Rate = 0
    $speaker.SetOutputToWaveFile($item.path)
    $speaker.Speak($item.text)
  } finally { $speaker.Dispose() }
}
