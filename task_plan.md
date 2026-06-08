# Task Plan

Goal: study `G:\Storybound` as the reference app and implement scoped feature additions for the current app around voice lab, prompt content, and draft template content.

## Phases

- [x] Confirm current branch and working-tree constraints.
- [x] Reset planning files for this reference-replication task.
- [x] Inventory current app features related to voice lab, prompt templates, and draft templates.
- [x] Inspect `G:\Storybound` artifacts for comparable UI, config, data, and bundled resources.
- [x] Capture findings and gaps in `findings.md`.
- [x] Propose implementation approach and record design/implementation plans.
- [x] Add data model, storage, provider helper, and IPC for voice lab.
- [x] Add standalone voice lab UI with provider, voice, speed, preview, and history.
- [x] Add reference-style prompt content fields and image seed pool JSON editing.
- [x] Add draft text border defaults, controls, preview stroke, and bridge payload support.
- [x] Run targeted tests, typecheck, browser smoke verification, and full test suite.
- [x] Replace built-in draft presets with exact Storybound `draft_templates` values and carry Storybound text style fields through UI/storage/bridge/export.

## Boundaries

- Preserve existing user changes in the dirty working tree.
- Do not implement feature changes until the design is approved.
- Prefer focused parity with the reference app over broad rewrites.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Existing planning files described an older prompt-template verification task. | Checked planning files at task start. | Replaced them with this reference-replication plan. |
| Electron postinstall failed during dependency repair. | `npm install` hit Electron postinstall permissions. | Used `npm install --ignore-scripts`, then verified with targeted tests. |
| Browser skill path from session metadata was stale. | Tried reading `26.602.30954` browser skill path. | Located current `26.602.40724` path and verified local app through in-app browser. |
| PowerShell rejected Bash-style heredoc syntax while inspecting files. | Tried `node - <<'NODE'`. | Re-ran with PowerShell-safe `node -e` commands. |
| Full test suite caught old draft-template hydration expectations. | `npm test` still expected pre-Storybound fallback coordinates. | Updated the storage test to assert the exact Storybound defaults and text style fields. |
