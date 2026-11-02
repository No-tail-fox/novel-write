# Third-Party Notices

## Vercel AI SDK (Lemo multi-protocol worker)

- Source: https://github.com/vercel/ai
- Direct dependencies: ai 7.0.159 and @ai-sdk/openai 4.0.106, pinned in the independent worker lockfile.
- Copyright 2023 Vercel, Inc.; Apache License 2.0. See THIRD_PARTY_LICENSES/Apache-2.0.txt and the unmodified package LICENSE files distributed with the worker dependencies.
- StoryDream uses native Chat Completions / Responses conversion and controls each persisted tool turn. Package source is unmodified. This integration does not use the hosted Vercel AI Gateway.

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
- Native path: complete DIRECTOR/TECHNIQUE/STYLE references; original seeded math helpers from core/lib.js (inventory: vendor/lemo-native-core/provenance.json); continuous HTML/Canvas/WebGL/Three films with film-owned typography and host-managed narration/music. Legacy React/Remotion adapters remain available for existing projects.
- Bundled gallery stills: 59 official covers by **LemoLab**, licensed under **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/); see `THIRD_PARTY_LICENSES/CC-BY-4.0.txt`. Source: https://lemomo-ai.github.io/lemo-opuscar/ and https://github.com/lemomo-ai/lemo-opuscar. Changes: resized proportionally to fit 768 x 432 and converted from JPEG to WebP without cropping. Per-image sources, dimensions and SHA-256 hashes: `src/assets/creative-style-previews/manifest.json`. Used for style references, not user production assets.
- The legacy gallery does not bundle demo films, audio or third-party voice tracks. Optional sample playback streams the original gallery video on demand. The separate full-source library is described below.

## Three.js

- Version: 0.170.0 (r170), https://github.com/mrdoob/three.js
- MIT, Copyright © 2010–2024 three.js authors. Original license ships as `dist-electron/electron/THREE_LICENSE.txt`. Used by the isolated native animation runtime.

## Electron differential updater

- Project: https://github.com/electron-userland/electron-builder
- Runtime packages: `electron-updater` 6.8.11 and `builder-util-runtime` 9.7.0 (MIT).
- StoryDream uses the upstream differential download engine with a project-owned,
  CA-pinned HTTPS range adapter. It retains its own signed release protocol,
  activation policy and final installer verification.
- The original license texts for these packages and their bundled dependencies
  are collected from the actual main-process bundle and distributed in
  `dist-electron/electron/MAIN_THIRD_PARTY_NOTICES.txt`.

## Lemo-Opuscar full-source library (native project adapter)

- Source: https://github.com/lemomo-ai/lemo-opuscar, revision `f17136060781a0068a7951245a3aa7835a7230de`.
- All 2,519 tracked upstream files are preserved in `vendor/lemo-upstream`; integrity inventory: `storydream-upstream.json`. No upstream source modifications. Dependencies and release-only media are not part of this Git snapshot.
- Code and documentation: MIT, Copyright 2026 LemoLab; original `LICENSE` retained.
- Included sample stills: CC BY 4.0, attribution **LemoLab**, repository above. Unmodified. Contributors and third-party rights remain as recorded in each demo's `CREDITS`.
- Generated user films are not required by upstream to carry LemoLab attribution. This does not waive third-party asset, font or music licenses.
- The three upstream-excluded voice recordings (Game Show Flat, Paper-cut Lightbox, Broadcast News Package) are not licensed for reuse by this integration. Do not download or reuse them as production assets.
- Local benchmark dependency caches retain source URLs, SHA-256, license identifiers and font OFL texts separately; they never overwrite the immutable source tree.

## Pixelle-Video full-source library

- Source: https://github.com/AIDC-AI/Pixelle-Video, revision `848b054e4fae40dabc62ec58e960b573e83793ac`.
- Complete 313-file upstream Git tree, including all 31 original HTML templates, is preserved byte-for-byte in `vendor/pixelle-upstream`; SHA-256 inventory: `storydream-upstream.json`.
- Apache-2.0, Copyright (C) 2025 AIDC-AI. Original `LICENSE` and `NOTICE` are retained unchanged. StoryDream adapters live outside the upstream tree.
- Third-party fonts and media retain their own licenses. Remote URLs referenced by a template are not bundled resources or proof of redistribution rights.
