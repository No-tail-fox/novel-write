---
name: storydream-ui
description: Maintain and extend StoryDream's Electron/React desktop interface with its Fluent UI theme, project-owned components, stable authoring workspaces, and visual regression rules. Use when Codex creates, redesigns, reviews, or fixes StoryDream pages, panels, forms, navigation, dialogs, toolbars, inspectors, selection behavior, responsive desktop layouts, or UI styles.
---

# StoryDream UI

Keep StoryDream feeling like one dense desktop creation tool. Preserve workflow and state ownership before changing appearance.

## Work In This Order

1. Read the route, its state owner, nearby shared components, and relevant tests.
2. Identify the page pattern: workspace, library, task operations, settings form, or focused dialog.
3. Reuse `src/ui` components and `src/styles/tokens.css` before adding markup or CSS.
4. Keep selection, inspector, pending edits, focus, and route state synchronized from stable IDs.
5. Add or update focused tests before broad migration.
6. Verify a normal desktop window and a compact desktop window.

Read [references/component-contract.md](references/component-contract.md) when selecting components, composing a page, or migrating old controls.

## Hard Boundaries

- Import StoryDream components from `src/ui` or the nearest valid relative path.
- Do not import `@fluentui/react-components` from feature pages. Fluent details belong inside `src/ui`.
- Do not add raw `<button>`, `<input>`, `<select>`, or `<dialog>` in new or edited feature UI. Do not add raw `<textarea>` either. Extend `src/ui` when a missing capability is genuinely reusable.
- Keep Lucide as the product icon library. Do not add Fluent icons or hand-drawn SVG icons.
- Use semantic tokens. Do not add feature-local copies of shell backgrounds, text colors, focus colors, radii, or control heights.
- Preserve existing route IDs, Electron window controls, IPC ownership, keyboard behavior, and business state unless the request explicitly changes them.
- Do not migrate unrelated pages opportunistically. Replace controls gradually along the requested workflow.

## Product Structure

Treat StoryDream as an operational authoring tool:

- Keep the application shell and global navigation stable.
- Use full-width work regions, panes, dividers, and compact toolbars.
- Use a three-pane workspace for source/list, active canvas, and contextual inspector when the workflow supports it.
- Use cards only for repeated assets or genuinely framed items. Do not nest cards.
- Keep headings compact inside tools. Use one coral brand accent plus semantic status colors.
- Keep pane widths, toolbars, and controls stable while data loads or selection changes.

## Selection Contract

When an explicit selection controls an inspector:

1. Update the canonical selected ID once.
2. Resolve the inspector section from a stable type or capability ID.
3. Expand required ancestors and reveal the section with nearest scrolling.
4. Preserve unsaved edits and ignore stale asynchronous selection work.
5. Move focus for keyboard selection when appropriate; pointer selection must not steal typing focus.
6. Keep source highlight, inspector heading, control values, and deep-link state consistent.

## Validation

- Run the focused UI contract tests and `npm run typecheck`.
- Run the production build when shared components, the provider, or the shell changes.
- Inspect loading, empty, error, disabled, selected, expanded, and unsaved states that the workflow can reach.
- Check keyboard focus, tooltip labels, contrast, clipping, horizontal overflow, sticky content, and scroll ownership.
- Use the project's browser/Electron screenshot QA for the affected workflow. Do not approve a UI from source code alone.
