param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$items = Get-Content -LiteralPath $Manifest -Encoding UTF8 -Raw | ConvertFrom-Json
foreach ($item in $items) {
  $speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
  $events = [System.Collections.Generic.List[object]]::new()
  try {
    $speaker.SelectVoice('Microsoft Huihui Desktop')
    $speaker.Rate = 0
    $speaker.add_SpeakProgress({ param($sender, $eventArgs) $events.Add(@{ charIndex=$eventArgs.CharacterPosition; audioMs=$eventArgs.AudioPosition.TotalMilliseconds }) })
    $speaker.SetOutputToWaveFile($item.path)
    $speaker.Speak($item.text)
    [System.IO.File]::WriteAllText($item.eventsPath, (ConvertTo-Json -InputObject @($events) -Compress), [System.Text.UTF8Encoding]::new($false))
  } finally { $speaker.Dispose() }
}
