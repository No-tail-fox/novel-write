# Controls-first UI repair

This batch applies the Impeccable and Interface Design workflow to StoryDream's
existing Fluent UI implementation. The user requested standard library controls
instead of page-specific replacements. This is a verified migration batch, not
an assertion that every route in the application has been audited.

## Direction

- Audience: authors managing scripts, media, model profiles, and production tasks in StoryDream.
- Intent: predictable desktop workflows with standard Fluent UI controls.
- Hierarchy: active workspace first, compact toolbars, supporting settings second.
- Palette: retain the existing coral brand and neutral light/dark themes.
- Depth: pane dividers and Fluent control borders; no added decorative surfaces.
- Typography: retain Segoe UI / Microsoft YaHei UI and Fluent control typography.
- Spacing: existing 4px layout rhythm; use Fluent sizes for controls.

## Ownership

1. `src/ui/theme.ts` owns Fluent theme values and states.
2. `src/ui` adapts the installed Fluent components to project APIs.
3. Page CSS owns layout, not a replacement appearance for standard controls.
4. Legacy controls must migrate by complete workflows. Color and file inputs may
   retain native browser behavior through shared adapters when Fluent has no
   equivalent. Canvas transform handles remain domain-specific primitives.
5. Feature pages import from `src/ui`; no second component framework.

## Progress

- [x] Audit global styles and control inventory.
- [x] Establish controls-first ownership rules.
- [x] Repair shared component and legacy CSS interaction.
- [x] Migrate the workflows listed below to standard controls.
- [x] Verify light/dark screenshots, compact layouts, and interactions in this batch.
- [x] Preserve passing Electron screenshots and reports in the project workspace.
- [ ] Migrate and verify remaining hotspot/news and music MV controls.
- [ ] Systematically audit other routes, including independently modified workbenches.

## Initial Audit

- 537 raw control occurrences across 25 feature files at the initial audit.
- `src/styles.css` contains legacy control appearance rules alongside imported
  shared styles; feature sheets add higher-specificity overrides.
- Settings helpers bypass the installed Fluent Input, Textarea, Select and Button.
- Shared primary-button CSS forces white descendants even while disabled.
- Segmented controls replace Fluent tab appearance and suppress its indicator.

## Completed Workflows

| Area | Scope |
| --- | --- |
| Shared controls | Toggle, range, segmented selection, accordion, confirmation, error details, pagination, color field, grouped selects, tabs, and button refs |
| Settings | Settings forms, provider profiles, model configuration, and clone-voice management |
| Task operations | Queue, history, new-task stages, task detail, artifact controls, and error dialogs |
| Templates | Prompt gallery/editor, draft template controls, and canvas transform handle accessibility |
| Labs | Voice, image, and benchmark import controls and local edit dialogs |
| HTML video | Task creation, studio controls, tabs, authoring workspace, and Storybound configuration panels |
| Account | Shared primary save action and its contrast |

Shared legacy adapters now delegate to `src/ui`. The installed Fluent components
provide the control geometry, borders, indicators, focus, and disabled states.
Global native-control rules exclude Fluent slots, and migrated page CSS handles
layout rather than repainting the controls. Segmented tabs retain Fluent's
indicator and keyboard behavior and can wrap in compact workspaces.

Light-theme secondary text was adjusted centrally in `src/ui/theme.ts` to restore
checkbox label contrast. A computed WCAG contrast test covers neutral foregrounds
on primary and secondary surfaces in both themes.

Draft image handles were moved into a sibling overlay above text layers so all
eight handles remain reachable. Existing drag, resize, keyboard, save, and reopen
behavior is preserved. HTML task-rail commands use Fluent's compact size so the
directory action fits its narrow grid cell.

The UI contract tests prevent raw controls and direct Fluent imports from being
reintroduced in the migrated workflows. The project component contract documents
the division between `src/ui/theme.ts` control themes and CSS shell/media tokens.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Focused UI and draft regression tests | 59 passed, 0 failed | [Vitest report](../../../.artifacts/controls-first-ui/final-focused-tests.json) |
| TypeScript | Renderer, Electron, and scripts configurations passed | `tsc -p <config> --noEmit` |
| Builds | Renderer production build and Electron build passed | Vite and `scripts/build-electron.mjs` |
| Electron system workflows | 20 captures; light/dark, 1440x900 and 1080x720 | [System report](../../../.artifacts/controls-first-ui/electron-system/report.json) |
| Electron task operations | 14 captures across desktop/compact and light/dark scenarios | [Task report](../../../.artifacts/controls-first-ui/electron-task-operations/report.json) |
| Electron HTML studio | 2 captures; light theme, desktop and compact | [HTML report](../../../.artifacts/controls-first-ui/electron-html-video/report.json) |

The 36 retained Electron captures have no reported runtime errors, text/focus
contrast failures, interactive overlaps, inaccessible icon controls, or media
failures. Required interactions passed and no owned QA processes remained alive.
These results apply to the captured states, not all possible application states.

Electron verification covers real draft edits, saving and reopening, canvas
transforms, task detail menus, error dialogs, borrowed images, subtitle controls,
scene video controls, draft delivery, and the loaded HTML studio fixture. Route
readiness checks now reject the lazy-route loading screen and wait for rendered
template rows before capturing or opening an editor.

Browser preview checks used isolated local fixtures at widths 1440, 1024, and 390
in both themes. Reports check overflow, clipped controls, standard controls, and
workflow interactions without submitting paid generation requests:

| Workflow | Retained report captures | Evidence |
| --- | --- | --- |
| History | 10 | [Report](../../../.artifacts/controls-first-ui/report-history.json) |
| New task | 30 | [Report](../../../.artifacts/controls-first-ui/report-new-task.json) |
| HTML video creation/studio | 18 | [Report](../../../.artifacts/controls-first-ui/report-html.json) |
| Prompt templates, voice, and image labs | 48 | [Report](../../../.artifacts/controls-first-ui/report-templates-labs.json) |
| Benchmark import | 6, plus 4 dialog screenshots | [Report](../../../.artifacts/controls-first-ui/report-benchmark.json) |

Settings and queue screenshots also remain in `.artifacts/controls-first-ui/`.
The generic `report.json` duplicates the templates/labs report and is not counted
again. Historical intermediate failure screenshots in that directory are not
passing evidence; the named reports and retained Electron folders above identify
the accepted runs.

## Representative Screenshots

- [Light HTML studio with compact task controls](../../../.artifacts/controls-first-ui/electron-html-video/captures/html-video-studio-light-desktop.png)
- [Dark prompt template gallery](../../../.artifacts/controls-first-ui/electron-system/captures/prompt-templates-dark-desktop.png)
- [Light draft template editor](../../../.artifacts/controls-first-ui/electron-system/captures/draft-templates-light-desktop.png)
- [Compact HTML studio](../../../.artifacts/controls-first-ui/electron-html-video/captures/html-video-studio-light-compact.png)

## Reproduction

Run from the repository root with the configured Node runtime on `PATH`:

```powershell
node node_modules/vitest/vitest.mjs run tests/draft-canvas-style.test.ts tests/draft-landscape-selection.test.ts tests/editorial-qa.test.ts tests/storydream-ui-system.test.ts tests/html-video-studio-ui.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.scripts.json --noEmit
node node_modules/vite/bin/vite.js build
node scripts/build-electron.mjs
node node_modules/tsx/dist/cli.mjs scripts/editorial-qa-electron.ts --scope=system
node node_modules/tsx/dist/cli.mjs scripts/editorial-qa-electron.ts --scope=task-operations
node node_modules/tsx/dist/cli.mjs scripts/editorial-qa-electron.ts --scope=html-video
```

The production-renderer preview is available at <http://127.0.0.1:5207/> while
the local preview process is running. It serves `dist-renderer`; rebuild that
directory after source changes. The browser suite is
`scripts/qa-controls-first-ui.py`; it uses this preview and isolated fixtures.

## Limits And Remaining Work

An earlier broader source-contract run reported 213 passed and 5 failed in
[source-tests.json](../../../.artifacts/controls-first-ui/source-tests.json).
The failures concern concurrent licensing/navigation changes:

1. Activation page no longer matches the old inline-feedback assertion.
2. Dynamic shell version no longer matches a hardcoded `V1.0` assertion.
3. Server licensing no longer matches the renderer `api.saveActivation` assertion.
4. Sidebar inventory expects 22 entries and receives 23 after the conversation route addition.
5. Lazy route inventory expects 24 entries and receives 25.

Those unrelated contracts were not changed to make this batch green. The legacy
`scripts/qa-html-video-ui.mjs` run is blocked at `Settings navigation button was
not found` after the licensing change. Real-template animation/pixel QA has not
passed in this batch. The passing editorial HTML checks validate the loaded
fixture and controls, not real generation, paid APIs, or production video quality.

The remaining raw-control inventory points to `HotBoardPage.tsx`,
`AiHotSourceView.tsx`, `ArchiveDateControl.tsx`, and `MusicMvPage.tsx`.
`DraftCanvas.tsx` also contains deliberate canvas manipulation primitives; those
must keep domain-specific pointer and keyboard behavior. Absence of raw markup
elsewhere does not establish that a route's layout or styles have been verified.

Continue by complete workflow: hotspot/news, then music MV, followed by a
systematic visual audit of the remaining workbenches. Keep Fluent control
appearance inside the shared layer and verify both themes before accepting each
subsequent migration.
