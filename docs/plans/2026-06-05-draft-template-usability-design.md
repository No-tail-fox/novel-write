# Draft Template Usability Completion Design

## Goal

Complete the draft template editor so each functional area is clearly grouped and fully editable. Users should be able to tune canvas, image, text overlays, subtitles, disclaimer, and audio settings without guessing which fields affect the final Jianying draft.

## Recommended Approach

Keep the current preview-plus-accordion editor, and make every accordion represent one output layer:

- Canvas settings.
- Image area.
- Main title.
- Subtitle.
- Captions.
- Disclaimer.
- Audio settings.

This preserves the existing editor flow while adding the missing controls. A selected-layer-only inspector would be more compact, but it would require a larger interaction redesign. Adding fields without regrouping would be faster, but it would not solve the usability issue.

## UI Design

The editor remains split into a live canvas preview and a right-side property panel.

Canvas controls include ratio, computed size, background color, background image path, image picker, and clear action.

Image area controls include visibility, image ratio, fit mode, vertical position, height, and animation.

Main title controls include visibility, text, coordinate readout, font size, color picker plus hex input, opacity, and bold.

Subtitle controls include visibility, preview/default text if supported by the data model, coordinate readout, font size, color picker plus hex input, opacity, and bold.

Caption controls include visibility, coordinate readout, font size, color picker plus hex input, opacity, bold, underline, alignment, letter spacing, line spacing, max characters per line, background color, background opacity, and background radius.

Disclaimer controls include visibility, text, coordinate readout, font size, color picker plus hex input, and opacity.

Audio controls keep the existing volume, transition, fade, filter, video effect, and audio effect fields.

## Data Model

Extend `DraftTemplate` only where fields are missing:

- Add opacity and bold fields for title and subtitle.
- Add optional subtitle text only if the current exporter can use it cleanly.
- Add font size, color, and opacity fields for disclaimer.
- Keep existing caption styling fields and expose all of them in the editor.
- Keep image and canvas fields backward-compatible.

`normalizeDraftTemplate` fills defaults for old saved templates so existing local data continues to load.

## Export Flow

The draft writer and Python bridge payload should preserve all template styling that affects output:

- Canvas background color and image.
- Image visibility and geometry if supported.
- Title and subtitle color, font size, opacity, bold, text, and coordinates.
- Caption color, font size, opacity, alignment, spacing, max line length, and background styling.
- Disclaimer text, coordinates, font size, color, and opacity.

If the current Python bridge cannot apply a style yet, the payload should still carry it so the bridge can evolve without changing the app contract again.

## Testing

Add focused tests for:

- Legacy draft template normalization fills all new fields.
- The draft template editor source exposes the expected controls and color swatches for each layer.
- The bridge payload preserves the new style fields.
- Existing draft template drag behavior remains intact.

Run targeted Vitest suites first, then typecheck and the full build after implementation.
