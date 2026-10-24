# Pinned, text-only upstream import. Never executes upstream scripts or imports demo media.
param([string]$Revision = '3961ddb3d24d8876e0e2754f7790d66908acee51')
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = Join-Path $repoRoot 'vendor/lemo-opuscar'
$base = "https://raw.githubusercontent.com/lemomo-ai/lemo-opuscar/$Revision"
[IO.Directory]::CreateDirectory($destination) | Out-Null
Invoke-WebRequest "$base/styles/README.md" -OutFile (Join-Path $destination 'STYLE-INDEX.md') -TimeoutSec 45
$index = Get-Content (Join-Path $destination 'STYLE-INDEX.md') -Raw -Encoding UTF8
$slugs = @([regex]::Matches($index, '\]\(([a-z0-9-]+)/STYLE\.md\)') | ForEach-Object { $_.Groups[1].Value })
if ($slugs.Count -ne 59 -or @($slugs | Select-Object -Unique).Count -ne 59) { throw 'Expected exactly 59 unique styles' }
$paths = @('LICENSE', 'README.md', 'DIRECTOR.md', 'TECHNIQUE.md', 'MY-STYLES.md', 'AGENTS.md', 'plugin/skills/lemo-opuscar/SKILL.md')
$paths += @($slugs | ForEach-Object { "styles/$_/style.json"; "styles/$_/STYLE.md" })
$results = $paths | ForEach-Object -Parallel {
    $relative = $_
    $target = Join-Path $using:destination $relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    try {
        Invoke-WebRequest "$using:base/$relative" -OutFile $target -TimeoutSec 45
        @{ path = $relative; sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant(); license = 'MIT' }
    } catch { throw "Import failed: $relative : $_" }
} -ThrottleLimit 4
if (@($results).Count -ne $paths.Count) { throw 'Incomplete upstream import' }
$results += @{ path = 'STYLE-INDEX.md'; sha256 = (Get-FileHash -LiteralPath (Join-Path $destination 'STYLE-INDEX.md') -Algorithm SHA256).Hash.ToLowerInvariant(); license = 'MIT' }
$catalog = @($slugs | ForEach-Object { Get-Content (Join-Path $destination "styles/$_/style.json") -Raw -Encoding UTF8 | ConvertFrom-Json })
$shared = Join-Path $repoRoot 'src/shared/creative-animation'
[IO.Directory]::CreateDirectory($shared) | Out-Null
[IO.File]::WriteAllText((Join-Path $shared 'lemo-catalog.json'), (ConvertTo-Json -InputObject $catalog -Depth 20) + "`n", [Text.UTF8Encoding]::new($false))
$manifest = [ordered]@{ version = 1; repository = 'https://github.com/lemomo-ai/lemo-opuscar'; revision = $Revision; scope = 'text references only; no demo media or third-party voice tracks'; files = @($results | Sort-Object path) }
[IO.File]::WriteAllText((Join-Path $destination 'manifest.json'), (ConvertTo-Json -InputObject $manifest -Depth 20) + "`n", [Text.UTF8Encoding]::new($false))
Write-Output "Imported $($slugs.Count) styles and $($results.Count) text files at $Revision"
