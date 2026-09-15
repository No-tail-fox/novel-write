# VOX animation sources

The original 49 built-in templates are StoryDream parameterized compositions,
informed by the component research in docs/research/remotion-templates-2026-09-15.
They do not embed third-party sample photographs, book text, or noncommercial templates.

## ShotCraft additions (revision 1)

Six separately identified `shotcraft-*` templates adapt motion implementations
and recipe timing from Vincentwei1021/video-shotcraft, commit
5e71af35a2daee492dd3ea93e5e8903f32dcd13c (Apache License 2.0).
Repository: https://github.com/Vincentwei1021/video-shotcraft
The complete license is retained in `shotcraft/LICENSE`.

Adapted sources:
- demos/ui-entrance/paper-craft-moves/MaskingTapeSlap.tsx
- demos/ui-entrance/paper-craft-moves/PopupBookRise.tsx
- demos/typography/paper-title-card/PaperTitleCard.tsx
- demos/data/timeline-travel/TimelineTravel.tsx
- demos/ui-entrance/bezier-source-converge-merge/BezierSourceConvergeMerge.tsx
- demos/data/ring-diagram-annotation-reveal/RingDiagramAnnotationReveal.tsx
- Shared easing/segment/Bézier calculations and the matching recipe documents.

StoryDream adaptations: user-supplied content and image assets, Chinese text
layout, separate horizontal/vertical geometry, host frame-rate and duration
mapping, validation limits and independent template IDs. These adaptations
preserve characteristic motion; they are not pixel-identical demo copies.
No upstream sample screenshots, brands, fonts, SFX or BGM are distributed.
Recipe source URLs, version and editable fields are in src/shared/shotcraft-recipes.ts.

world-map.json contains reduced-coordinate polygon outlines from Natural Earth
1:110m Admin 0 Countries. Natural Earth data is in the public domain.
Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson
Terms: https://www.naturalearthdata.com/about/terms-of-use/
Retrieved 2026-09-15. Coordinates were rounded to two decimals; only exterior rings retained.
This overview map is not a source of historical borders. User supplied GeoJSON and
historical routes retain their own source and attribution.

Remotion, @remotion/player and @remotion/media-utils 4.0.524 retain their own
Remotion license. React and React DOM retain their MIT licenses.
