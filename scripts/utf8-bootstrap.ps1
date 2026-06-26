function Invoke-Utf8Bootstrap {
  param(
    [Parameter(Mandatory = $true)]
    [string] $ScriptPath,
    [Parameter()]
    [object[]] $ScriptArgs = @()
  )

  if ($IsWindows) {
    try {
      & chcp 65001 | Out-Null
    } catch {
    }
  }

  try {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
  } catch {
  }

  try {
    $PSDefaultParameterValues['*:Encoding'] = 'utf8'
  } catch {
  }

  if ($IsWindows -and $PSVersionTable.PSVersion.Major -lt 7) {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
      & $pwsh.Source -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @ScriptArgs
      return $true
    }
  }

  return $false
}
