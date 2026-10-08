#Requires -Version 7.0
[CmdletBinding()]
param(
    [string[]]$Styles = @(),
    [switch]$Generate,
    [ValidateRange(1, 3)][int]$Concurrency = 3,
    [string]$ArtifactsDirectory = (Join-Path $PSScriptRoot '../.artifacts/image-style-samples'),
    [string]$GenerationHelper = (Join-Path $env:USERPROFILE '.codex/skills/image-2-5/scripts/generate.ps1'),
    [string]$Node = 'I:/nodejs/node.exe',
    [string]$Python = (Join-Path $PSScriptRoot '../vendor/python/python.exe')
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactRoot = [IO.Path]::GetFullPath($ArtifactsDirectory)
$assetRoot = Join-Path $projectRoot 'src/assets/drawing-style-previews'
$utf8 = [Text.UTF8Encoding]::new($false)
[void][IO.Directory]::CreateDirectory($artifactRoot)

# Read the actual built-in styles, instead of maintaining another copy of their prompts.
$exportStyles = @'
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { defaultCustomStyles } = await import(pathToFileURL(process.argv[1]));
writeFileSync(process.argv[2], JSON.stringify(defaultCustomStyles, null, 2) + '\n', 'utf8');
'@
Push-Location $projectRoot
try {
    & $Node --import tsx --input-type=module -e $exportStyles (Join-Path $projectRoot 'src/shared/config.ts') (Join-Path $artifactRoot 'styles.json')
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the built-in drawing styles.' }
} finally { Pop-Location }
$allStyles = @(Get-Content -LiteralPath (Join-Path $artifactRoot 'styles.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
$selectedStyles = if ($Styles.Count) {
    foreach ($id in $Styles) {
        $matchingStyle = $allStyles | Where-Object id -EQ $id
        if (-not $matchingStyle) { throw "Unknown built-in style: $id" }
        $matchingStyle
    }
} else { $allStyles }

$subject = @'
Create one finished artwork serving as a drawing-style reference. Same subject across the style collection: a quiet traditional riverside bookshop in a Chinese water town, an adult bookbinder sitting on the left at a wooden desk repairing a plain cloth-bound book, a small clay teapot and cup in the right foreground, a window and open doorway revealing a stone bridge over the river in the middle distance. The person wears simple timeless cotton clothing; the shop contains wooden shelves and a few neatly stacked unmarked books. Three-quarter view from inside the shop, clear readable silhouette of the person, desk in the lower third, rich depth from foreground cup to bookbinder to riverside bridge, clean visual hierarchy, calm human warmth. Landscape 16:9 framing. Render the entire scene in the specified style, not a photograph of artwork, not a split screen, not a UI mockup. No visible writing, no lettering, no captions, no logos, no watermark. Let the style specification control lighting, palette, texture, level of realism, historical atmosphere and brushwork. Preserve the described subject and relative arrangement while adapting the treatment to the style.
'@

$jobs = foreach ($style in $selectedStyles) {
    $styleRoot = Join-Path $artifactRoot $style.id
    $generationRoot = Join-Path $styleRoot 'original'
    $metadataPath = Join-Path $generationRoot 'metadata.json'
    if (Test-Path -LiteralPath $metadataPath) {
        Write-Host "Reusing saved original: $($style.id)"
        continue
    }
    if (-not $Generate) { throw "No original for $($style.id). Use -Generate only after authorizing its model charge." }
    if (Test-Path -LiteralPath $generationRoot) {
        throw "An incomplete billed request may exist for $($style.id). Inspect it first; this script never retries automatically."
    }
    if (-not (Test-Path -LiteralPath $GenerationHelper)) { throw 'The image-2-5 generation helper was not found.' }
    [void][IO.Directory]::CreateDirectory($styleRoot)
    $promptPath = Join-Path $styleRoot 'prompt.txt'
    $colorRule = if ($style.allowColor) { 'Use the palette appropriate to the exact style above.' } else { 'Strictly monochrome black-and-white grayscale only; no color accents or sepia tint.' }
    $prompt = "$($style.prefix)`n`n$subject`n`n$($style.suffix)`n`nColor rule: $colorRule`nAvoid: $($style.negativePrompt)"
    [IO.File]::WriteAllText($promptPath, $prompt, $utf8)
    [IO.File]::WriteAllText((Join-Path $styleRoot 'source-style.json'), ($style | ConvertTo-Json -Depth 8), $utf8)
    [PSCustomObject]@{ Id = $style.id; PromptPath = $promptPath; OutputDirectory = $generationRoot }
}

if ($jobs) {
    # Each item submits exactly one image. Failed/timed-out requests are never retried.
    # Registered channel estimate: CNY 0.02/request; actual billing belongs to the provider.
    $results = @($jobs | ForEach-Object -Parallel {
        $ErrorActionPreference = 'Stop'
        try {
            $null = & $using:GenerationHelper -PromptFile $_.PromptPath -OutputDirectory $_.OutputDirectory -Size '3840x2160' -Quality high
            [PSCustomObject]@{ Id = $_.Id; Success = $true }
        } catch {
            [PSCustomObject]@{ Id = $_.Id; Success = $false; Message = $_.Exception.Message }
        }
    } -ThrottleLimit $Concurrency)
    foreach ($result in $results) {
        if ($result.Success) { Write-Host "Generated: $($result.Id)" }
        else { Write-Warning "Failed without retry: $($result.Id): $($result.Message)" }
    }
}

[void][IO.Directory]::CreateDirectory($assetRoot)
$optimizer = @'
import hashlib, json, pathlib, sys
from PIL import Image, ImageDraw, ImageFont, ImageOps
artifact_dir, asset_dir = map(pathlib.Path, sys.argv[1:3])
styles = json.loads((artifact_dir / 'styles.json').read_text(encoding='utf-8-sig'))
requested_ids = json.loads(sys.argv[3])
manifest_path = asset_dir / 'manifest.json'
previous = {item['id']: item for item in json.loads(manifest_path.read_text(encoding='utf-8'))} if manifest_path.exists() else {}
missing = []
for style in styles:
    style_id = style['id']
    if requested_ids and style_id not in requested_ids:
        continue
    style_dir = artifact_dir / style_id
    source_dir = style_dir / 'original'
    metadata_path = source_dir / 'metadata.json'
    if not metadata_path.exists():
        missing.append(style_id)
        continue
    saved_style = json.loads((style_dir / 'source-style.json').read_text(encoding='utf-8-sig'))
    style_fields = ('prefix', 'suffix', 'negativePrompt', 'allowColor')
    if any(saved_style[field] != style[field] for field in style_fields):
        raise SystemExit(f'Style definition changed since generation: {style_id}; original is retained, no automatic paid regeneration.')
    metadata = json.loads(metadata_path.read_text(encoding='utf-8-sig'))
    original = next((source_dir / name for name in ('image.png', 'image.jpg') if (source_dir / name).is_file()), None)
    if original is None:
        raise SystemExit(f'Metadata exists but original is missing: {style_id}')
    with Image.open(original) as image:
        original_size = list(image.size)
        if original_size != [3840, 2160] or not metadata['matchesRequestedSize']:
            raise SystemExit(f'Unexpected original dimensions for {style_id}: {original_size}')
        preview = ImageOps.fit(image.convert('RGB'), (768, 432), method=Image.Resampling.LANCZOS)
        destination = asset_dir / f'{style_id}.webp'
        preview.save(destination, 'WEBP', quality=86, method=6)
    entry = {
        'id': style_id,
        'name': style['name'],
        'description': style['description'],
        **{field: saved_style[field] for field in style_fields},
        'styleSignature': json.dumps([saved_style[field] for field in style_fields], ensure_ascii=False, separators=(',', ':')),
        'file': f'{style_id}.webp',
        'prompt': (style_dir / 'prompt.txt').read_text(encoding='utf-8-sig'),
        'provider': 'VllmProxy',
        'endpoint': metadata['endpoint'],
        'requestedModel': metadata['requestedModel'],
        'returnedModel': metadata.get('returnedModel'),
        'requestedSize': metadata['requestedSize'],
        'actualOriginalSize': original_size,
        'previewSize': [768, 432],
        'completedAt': metadata['completedAt'],
        'originalSha256': hashlib.sha256(original.read_bytes()).hexdigest(),
        'previewSha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        'previewBytes': destination.stat().st_size,
    }
    previous[style_id] = entry
manifest = [previous[style['id']] for style in styles if style['id'] in previous]
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
font_path = pathlib.Path('C:/Windows/Fonts/msyh.ttc')
font = ImageFont.truetype(str(font_path), 22) if font_path.exists() else ImageFont.load_default()
sheet = Image.new('RGB', (4 * 384, 4 * 258), '#f0eee8')
draw = ImageDraw.Draw(sheet)
for index, entry in enumerate(manifest):
    x, y = (index % 4) * 384, (index // 4) * 258
    with Image.open(asset_dir / entry['file']) as image:
        sheet.paste(image.resize((384, 216), Image.Resampling.LANCZOS), (x, y))
    draw.text((x + 12, y + 225), entry['name'], font=font, fill='#222222')
sheet.save(artifact_dir / 'contact-sheet.jpg', quality=92)
report = {'completed': len(manifest), 'missing': missing, 'previewBytes': sum(entry['previewBytes'] for entry in manifest), 'originalDimensions': [3840, 2160], 'previewDimensions': [768, 432]}
(artifact_dir / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
if missing:
    raise SystemExit('Some samples failed; saved successful images were retained and no requests were retried.')
'@
$selectedIdsJson = ConvertTo-Json -InputObject @($selectedStyles | ForEach-Object id) -Compress
& $Python -c $optimizer $artifactRoot $assetRoot $selectedIdsJson
if ($LASTEXITCODE -ne 0) { throw 'Could not complete all drawing-style preview assets. Inspect the report and saved requests.' }
