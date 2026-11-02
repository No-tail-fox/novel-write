function Assert-RuntimeDirectoryPath {
  param([string]$Path, [string]$WorkspaceRoot)
  $rootFull = [IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd([char[]]@('\', '/'))
  $pathFull = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
  $prefix = $rootFull + [IO.Path]::DirectorySeparatorChar
  if (!$pathFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "RUNTIME_DIRECTORY_OUTSIDE_WORKSPACE: $pathFull"
  }
  for ($entry = [IO.DirectoryInfo]::new($pathFull); $null -ne $entry; $entry = $entry.Parent) {
    if ($entry.Exists -and ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "RUNTIME_DIRECTORY_LINK_REJECTED: $($entry.FullName)"
    }
    if ($entry.FullName.TrimEnd([char[]]@('\', '/')) -eq $rootFull) { break }
  }
  return $pathFull
}

function Move-RuntimeDirectory {
  param([string]$Source, [string]$Destination)
  [IO.Directory]::Move($Source, $Destination)
}

function Invoke-RuntimeDirectoryTransaction {
  param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [Parameter(Mandatory = $true)][string]$ActiveDirectory,
    [Parameter(Mandatory = $true)][scriptblock]$Prepare,
    [Parameter(Mandatory = $true)][scriptblock]$Validate,
    [scriptblock]$IsCurrent
  )
  $active = Assert-RuntimeDirectoryPath $ActiveDirectory $WorkspaceRoot
  if ([IO.File]::Exists($active)) { throw "RUNTIME_DIRECTORY_NOT_DIRECTORY: $active" }
  $parent = [IO.Path]::GetDirectoryName($active)
  $name = [IO.Path]::GetFileName($active)
  [IO.Directory]::CreateDirectory($parent) | Out-Null
  $lockPath = Join-Path $parent ".$name.prepare.lock"
  if ((Test-Path -LiteralPath $lockPath) -and ((Get-Item -LiteralPath $lockPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "RUNTIME_DIRECTORY_LOCK_LINK_REJECTED: $lockPath"
  }
  try {
    # The handle owns the lock. A stale file from a dead process is safe to reuse.
    # Never unlink this file on release: doing so races another process's lock.
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch { throw "RUNTIME_DIRECTORY_PREPARATION_LOCKED: $lockPath" }
  $id = [Guid]::NewGuid().ToString('N')
  $staging = Join-Path $parent ".$name.staging-$id"
  $previous = Join-Path $parent ".$name.previous-$id"
  $previousMoved = $false
  $candidateActivated = $false
  $rollbackFailed = $false
  try {
    $lock.SetLength(0)
    $details = [Text.Encoding]::UTF8.GetBytes("pid=$PID;started=$([DateTime]::UtcNow.ToString('o'))")
    $lock.Write($details, 0, $details.Length)
    $lock.Flush()
    if ($IsCurrent -and (& $IsCurrent $active)) {
      return [pscustomobject]@{ ActiveDirectory = $active; BackupDirectory = $null; Reused = $true }
    }
    [IO.Directory]::CreateDirectory($staging) | Out-Null
    & $Prepare $staging | Out-Null
    Assert-RuntimeDirectoryPath $staging $WorkspaceRoot | Out-Null
    & $Validate $staging | Out-Null
    # Both renames remain on one volume. Keep the old directory for rollback;
    # never erase or repair the active runtime during preparation.
    if ([IO.Directory]::Exists($active)) {
      Move-RuntimeDirectory $active $previous
      $previousMoved = $true
    }
    Move-RuntimeDirectory $staging $active
    $candidateActivated = $true
    & $Validate $active | Out-Null
    return [pscustomobject]@{
      ActiveDirectory = $active
      BackupDirectory = $(if ($previousMoved) { $previous } else { $null })
      Reused = $false
    }
  } catch {
    $preparationError = $_
    try {
      if ($candidateActivated) { Move-RuntimeDirectory $active $staging }
      if ($previousMoved) { Move-RuntimeDirectory $previous $active }
    } catch {
      $rollbackFailed = $true
      throw "RUNTIME_DIRECTORY_ROLLBACK_FAILED: Original retained at $previous; candidate at $active or $staging. Cause: $($_.Exception.Message). Preparation: $($preparationError.Exception.Message)"
    }
    throw $preparationError
  } finally {
    try {
      if (!$rollbackFailed -and [IO.Directory]::Exists($staging)) {
        Assert-RuntimeDirectoryPath $staging $WorkspaceRoot | Out-Null
        Remove-Item -LiteralPath $staging -Recurse -Force
      }
    } catch {
      Write-Warning "[runtime] Retained failed staging directory: $staging. $($_.Exception.Message)"
    } finally { $lock.Dispose() }
  }
}
