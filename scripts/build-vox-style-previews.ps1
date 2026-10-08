#Requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('archival-red', 'swiss-signal', 'museum-paper')]
    [string[]]$Styles = @('archival-red', 'swiss-signal', 'museum-paper'),
    [switch]$Generate,
    [string]$ArtifactsDirectory = (Join-Path $PSScriptRoot '../.artifacts/vox-style-samples'),
    [string]$GenerationHelper = (Join-Path $env:USERPROFILE '.codex/skills/image-2-5/scripts/generate.ps1'),
    [string]$Python = (Join-Path $PSScriptRoot '../vendor/python/python.exe')
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactRoot = [IO.Path]::GetFullPath($ArtifactsDirectory)
$assetRoot = Join-Path $projectRoot 'src/assets/vox-style-previews'
$utf8 = [Text.UTF8Encoding]::new($false)
$subject = @'
Create a refined editorial paper collage, landscape 16:9, about urban memory and everyday time. Use the same core objects: one large side-on vintage commuter bicycle in the foreground on the left half, a circular analog clock without numerals in the upper-right, two old European city building facades in the middle distance, and a torn street-map fragment along the bottom. These objects should form one coherent designed composition. Clear silhouette and layered paper shadows; visually compelling at thumbnail size, balanced generous negative space. Tactile paper edges and photographic cutouts, sophisticated documentary art direction. No people, no legible words, no numbers, no letters, no logos, no captions, no watermark. This is a finished style reference artwork, not a screenshot or a UI mockup.
'@
$stylePrompts = @{
    'archival-red' = @'
STYLE: archival paper collage, black ink, restrained red accent, documentary editorial layout. High contrast monochrome halftone photographic cutouts, rough distressed cream archival paper, deep charcoal bicycle and building facades. A single vivid vermilion paper circle behind the bicycle and a short red marker stroke. Crooked torn layers and photographic evidence-card textures, bold investigative documentary atmosphere. Predominantly black, warm white, vermilion. No other saturated colors.
'@
    'swiss-signal' = @'
STYLE: Swiss editorial grid, bold geometric blocks, high contrast photography and signal colors. Precise asymmetric Swiss grid on clean cool white paper; the photographic bicycle and architecture are crisp black-and-white cutouts. Use assertive cobalt blue rectangles and acid yellow geometric planes with one tiny orange accent, an oversized simple blue clock disc. Rigorously aligned edges, sharp circles, thin precise rules, minimal texture, flat confident graphic geometry and large clean negative spaces. Contemporary modernist magazine cover art without any typography. Avoid sepia, distressed vintage paper, and red-dominated palettes.
'@
    'museum-paper' = @'
STYLE: museum catalogue collage, aged paper, precise label-card shapes, quiet neutral photography. Delicate sepia and warm gray photographic cutouts on beautiful cream rag paper, ochre linen textures, desaturated olive paper fragments and faint botanical printing textures. A quiet scholarly still-life composition, thin pale deckled paper edges, subtle soft shadows, small blank specimen cards, ample breathing room, restrained low contrast. Earthy warm neutral museum catalogue aesthetic, gentle analog clock and bicycle, no bright saturated accents, no red or blue.
'@
}

foreach ($style in $Styles) {
    $styleRoot = Join-Path $artifactRoot $style
    $generationRoot = Join-Path $styleRoot 'original'
    if ($Generate) {
        if (-not (Test-Path -LiteralPath $GenerationHelper)) { throw 'The image-2-5 generation helper was not found.' }
        if (Test-Path -LiteralPath $generationRoot) {
            throw "A generation folder already exists for $style. Inspect its saved result first; this script never retries or overwrites a billed request."
        }
        [void][IO.Directory]::CreateDirectory($styleRoot)
        $promptPath = Join-Path $styleRoot 'prompt.txt'
        [IO.File]::WriteAllText($promptPath, "$subject`n`n$($stylePrompts[$style])", $utf8)
        # One explicit call per style. Credentials are handled only by the skill helper.
        # Saved channel price on 2026-09-16: CNY 0.02/image; verify before future runs.
        & $GenerationHelper -PromptFile $promptPath -OutputDirectory $generationRoot -Size '3840x2160' -Quality high
    }
    $metadataPath = Join-Path $generationRoot 'metadata.json'
    if (-not (Test-Path -LiteralPath $metadataPath)) {
        throw "No generated original exists for $style. Generation is opt-in: use -Generate after authorizing the image-model charge."
    }
    [void][IO.Directory]::CreateDirectory($assetRoot)
    $optimizer = @'
import hashlib, json, pathlib, sys
from PIL import Image, ImageOps
style, source_dir, asset_dir = sys.argv[1:]
source_dir, asset_dir = pathlib.Path(source_dir), pathlib.Path(asset_dir)
metadata = json.loads((source_dir / 'metadata.json').read_text(encoding='utf-8-sig'))
original = next((source_dir / filename for filename in ('image.png', 'image.jpg') if (source_dir / filename).is_file()), None)
if original is None:
    raise SystemExit('Saved generation has metadata but no supported original image.')
with Image.open(original) as image:
    original_size = list(image.size)
    preview = ImageOps.fit(image.convert('RGB'), (768, 432), method=Image.Resampling.LANCZOS)
    destination = asset_dir / (style + '.webp')
    preview.save(destination, 'WEBP', quality=86, method=6)
result = {
    'styleId': style,
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
    'note': 'AI-generated style reference; resized locally for hover previews. The provider did not independently verify upstream model identity.'
}
(asset_dir / (style + '.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
'@
    & $Python -c $optimizer $style $generationRoot $assetRoot
    if ($LASTEXITCODE -ne 0) { throw "Failed to optimize the saved $style original." }
}
