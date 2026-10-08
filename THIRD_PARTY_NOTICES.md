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
