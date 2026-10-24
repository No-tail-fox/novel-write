# Third-Party Notices

StoryDream includes modified TypeScript adaptations of selected workflow rules
from the following projects. StoryDream does not bundle either project's
service stack, model weights, sample media, or generated content.

## shuohao-skills

- Project: https://github.com/eternityspring/shuohao-skills
- Source revision: `7ebef4f2f53159ee1eaaec2793271a114a8be8cc`
- License: Apache License 2.0; see `THIRD_PARTY_LICENSES/Apache-2.0.txt`
- Adapted material: structured script/storyboard contracts, ordered beat
  coverage checks, dialogue duration estimation, and reference validation.
- Modifications: rewritten in TypeScript for StoryDream's persistence model,
  remote provider contracts, and non-destructive episode import.

Upstream NOTICE:

> Copyright 2026 烁皓
>
> The bundled sample story `skills/storycast/examples/渡口.txt` is an original
> work written for this project and is covered by the same license.

The sample story is not included in StoryDream.

## Jellyfish

- Project: https://github.com/Forget-C/Jellyfish
- Source revision: `a9678194ddf2d9be3ccbe78d4287d87d5089e123`
- License: Apache License 2.0; see `THIRD_PARTY_LICENSES/Apache-2.0.txt`
- Adapted material: stable entity/variant references, shot readiness checks,
  previous-shot continuity context, and video prompt packing.
- Modifications: rewritten as TypeScript domain functions and integrated with
  StoryDream's Electron persistence, remote video APIs, and renderer.


## BiRefNet Lite (optional local background removal)

- Project: https://github.com/ZhengPeng7/BiRefNet
- ONNX export: https://huggingface.co/onnx-community/BiRefNet_lite-ONNX
- Export revision: `de15b22ba131738a16dff04aab8bdf8dc32e3ac1`
- SHA-256: `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`
- Downloaded on first use, verified before inference; weights are not bundled.
- License: MIT, Copyright (c) 2024 ZhengPeng; see `THIRD_PARTY_LICENSES/BiRefNet-MIT.txt`.
- StoryDream implements its own local ONNX preprocessing and alpha-preserving export.

## Lemo Opuscar

- Project: https://github.com/lemomo-ai/lemo-opuscar
- Revision: `3961ddb3d24d8876e0e2754f7790d66908acee51`
- Code and text references: MIT, Copyright (c) 2026 LemoLab; see `THIRD_PARTY_LICENSES/LemoLab-MIT.txt`.
- Imported: 59 style documents/metadata, directing and technique text; SHA-256 inventory in `vendor/lemo-opuscar/manifest.json`.
- Adaptation: six initial React/Remotion style adapters, selected references loaded on demand, host-managed audio, subtitles and deterministic capture.
- Demo films, images, audio and third-party voice tracks are not bundled. Their separate licenses do not apply to the text-only import.
