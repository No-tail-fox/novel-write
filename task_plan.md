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
| Coze CLI npm smoke lost the `--out` flag under PowerShell/npm argument forwarding. | Ran `npm run convert:coze -- --out <output> <fixture>`, and the script treated the output path as an input file. | Added positional output path support and a CLI regression test, so `npm run convert:coze -- <output.json> <workflow.json>` works. |
| PowerShell expanded or stripped Node template-string and quote characters during Feishu asset inspection. | Tried `node -e` snippets with backticks and `${...}`. | Use plain string concatenation in double-quoted PowerShell commands, or use dedicated script files when code grows. |
| Feishu fetch CLI called `CdpPage` before the class declaration initialized. | First real `node scripts\fetch-feishu-coze-workflows.mjs ...` run failed with `Cannot access 'CdpPage' before initialization`. | Move the top-level CLI invocation to the bottom of the module after all declarations. |
| Feishu fetch CLI parsed hydrated DOM HTML instead of the original Document response body. | Second real run failed with `No Feishu .txt workflow attachment sources were found in the page HTML`. | Capture the initial wiki Document response through CDP `Network.responseReceived` and read it with `Network.getResponseBody`. |
| Feishu single-pass scrolling only captured a subset of virtualized file blocks. | Runs alternated between the page-top 64 sources and partial page-bottom captures. | Use hydrated React `blockManager`, audit record seeds, and HTML document record seeds; use stable record-id filenames so repeated runs accumulate a de-duplicated source set. |
| Some Coze video-generation workflows had no Jianying `create_draft` plugin node. | Batch conversion failed with `Coze workflow does not contain a create_draft node`. | Generate a reusable 9:16 Storybound draft-template shell and preserve the missing `create_draft` condition as a warning diagnostic. |
| PowerShell parsed unquoted `stash@{0}` oddly during stash apply. | `git stash apply stash@{0}` failed with `unknown switch e`. | Retry with the stash ref quoted as `'stash@{0}'`; the stash was not dropped. |
| PowerShell collapsed `git show` line output while rebuilding `tests/storage.test.ts`. | Assigned `git show ':2:tests/storage.test.ts'` to a variable and wrote it back as a single line. | Restore the conflict side from Git with a line-preserving command, then reapply the Music MV storage regression test. |
| Targeted tests failed after conflict resolution because `createTask` inserted 39 SQL placeholders for 40 columns. | Ran the 9-file Vitest target set after typecheck. | Counted columns/placeholders, added the missing placeholder, and reran the target tests successfully. |
| Two runner tests reached draft writing without configuring a Jianying draft path. | Target set narrowed failures to `tests/runner.test.ts`. | Added `draftRootDir` config setup to those test fixtures; runner and target tests passed. |

## 2026-06-08 Coze Workflow Converter Addendum

- [x] Add pure Coze clipboard parser and diagnostics.
- [x] Convert Coze Jianying workflow nodes into reusable Storybound `DraftTemplate` presets.
- [x] Add real pasted workflow fixture coverage.
- [x] Add draft-template page import UI with preview, single import, and batch import.
- [x] Add storage persistence coverage for converted templates.
- [x] Add CLI batch converter and `npm run convert:coze` entrypoint.
- [x] Verify targeted tests, typecheck, full tests, CLI smoke, and browser UI smoke.

## 2026-06-08 Feishu Workflow Source Batch Addendum

- [x] Audit the Feishu wiki page and count available workflow source attachments.
- [x] Stabilize a browser/CDP download or direct API extraction path for `.txt` attachments.
- [x] Download all available Coze workflow source `.txt` files from the Feishu page.
- [x] Batch-convert every downloaded workflow into Storybound draft templates.
- [x] Install/generated templates into a reusable Storybound template store or a project bundle the app can import.
- [x] Seed the generated Feishu Coze templates into normal Storybound app databases as draft-template presets.
- [x] Verify source count, conversion count, failures, typecheck, and relevant tests before calling the batch complete.

## 2026-06-12 Main Reference Branch Restore Addendum

- [x] Fetch latest remote refs and fast-forward `main` to `origin/codex/storybound-reference-parity`.
- [x] Protect pre-merge local MV/runtime work in `stash@{0}`.
- [x] Apply `stash@{0}` onto updated `main` without dropping it.
- [x] Resolve conflicts while preserving reference branch features and restored MV/runtime work.
- [x] Run typecheck, targeted tests, and browser smoke for affected runtime/UI surfaces.
- [ ] Decide whether it is safe to drop `stash@{0}` after verification.
