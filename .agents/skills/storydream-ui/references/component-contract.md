# StoryDream Component Contract

## Core Components

Import these from `src/ui`.

| Component | Use for | Important contract |
|---|---|---|
| `Button` | Text or icon-and-text commands | Choose `primary`, `secondary`, `subtle`, or `danger`; use one primary action per local region |
| `IconButton` | Familiar compact commands | Always provide `label`; wrap unfamiliar actions in `Tooltip` |
| `TextField` | Single-line text | Supply a visible label; use validation message for errors |
| `TextAreaField` | Long text and prompts | Keep resizing vertical and preserve draft state |
| `SelectField` | Native option sets | Pass stable values and a visible label |
| `CheckboxField` | Independent boolean or multi-select | Use for additive choices, not exclusive modes |
| `SwitchField` | Immediate on/off setting | Avoid when saving is deferred behind a submit action |
| `SliderField` | Bounded continuous value | Show the current `valueLabel` and preserve keyboard stepping |
| `Tabs` | Views of the same object | Keep selected value in the route or feature state when restoration matters |
| `SegmentedControl` | Small exclusive mode set | Keep labels short; do not use for commands |
| `Tooltip` | Name an icon or clarify a terse control | Do not hide required workflow instructions in tooltips |
| `Menu` | Secondary command set | Use stable item IDs and explicit callbacks |
| `Dialog` | Focused confirmation or bounded edit | Keep destructive and cancel actions visibly distinct |
| `Toolbar` | Repeated local commands | Use stable geometry and an accessible label |
| `Pane` | Base, subtle, or raised work region | Do not turn every section into a floating card |

## Page Patterns

### Authoring Workspace

Use for video, template, asset, and scene editing.

```text
workspace header
toolbar
list/tree | canvas/preview | inspector
optional timeline or asset strip
```

- Keep one canonical selection shared by the list, canvas, and inspector.
- Let each stable pane own its scroll area.
- Collapse or stack panes only when the content region is compact, not from mobile-first assumptions.

### Library

Use for reusable assets, people, prompts, and templates.

```text
filter/search toolbar
collection list or grid | detail inspector
```

- Preserve filtering while inspecting an item.
- Use repeated cards only for inspectable assets with real preview media.

### Task Operations

Use for queues, history, and task details.

```text
compact context header
stage/status strip
active result region
event or artifact detail
```

- Keep task commands in a stable location.
- Never replace authoritative task state with optimistic decorative progress.

### Settings Form

Use a narrow navigation column and one unframed form region. Group related fields with headings and dividers; do not place every field in a card.

## Tokens

Source of truth: `src/styles/tokens.css`.

- Shell surfaces: `--shell-bg`, `--shell-surface`, `--shell-surface-raised`.
- Text and boundaries: `--shell-text`, `--shell-muted`, `--shell-border`.
- Brand and focus: `--shell-accent`, `--shell-accent-strong`, `--shell-focus`.
- Status: `--danger`, `--warn`, `--ok`.
- Media workspaces may use the corresponding `--media-*` tokens.

If a reusable semantic value is missing, add it to both dark and light token sets before using it. Do not encode a new theme in a feature stylesheet.

## Migration

Use a gradual replacement strategy:

1. Keep existing class names and behavior tests.
2. Replace the underlying raw control with the matching `src/ui` component.
3. Adapt Fluent slots in shared CSS when existing layout depends on direct children.
4. Verify focus, disabled, hover, pressed, selected, and high-contrast states.
5. Remove obsolete page CSS only after all consumers have migrated and visual QA confirms parity.

Do not mechanically replace all raw controls in one change. Migrate one complete user workflow at a time.
