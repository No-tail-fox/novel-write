# StoryDream Editorial Workbench Fidelity Ledger

Date: 2026-07-30
Branch: `codex/storydream-local-hardening`
Published baseline: `44cfeec fix: harden Windows runtime bootstrap`

## Acceptance Summary

- Canonical native matrix: `67/67 required; 21 supplemental` (`88/88` total).
- Browser path: Browser plugin not available; validation uses the repository's production Electron `capturePage` harness with injected DOM/runtime evidence.
- JavaScript Playwright availability: workspace CLI not installed; the repository Electron `capturePage` path is the recorded fallback.
- Current matrix artifact: `C:\Users\foxnotail\AppData\Local\Temp\storydream-editorial-artifacts-o1yQff`.
- The current matrix artifact is retained. Cleanup of superseded QA directories was blocked by the execution policy before deletion, so those external temp files may remain until normal system cleanup.
- Screenshots and reports are external QA evidence and are not committed.

## Required Evidence

The matrix requires, for every canonical capture: matching route identity, meaningful nonblank DOM, no framework overlay, zero relevant console/page/render errors, zero horizontal overflow, zero clipped controls, zero incoherent interactive overlap, zero unresolved tokens, zero icon-only accessible-name or tooltip gaps, text contrast at least `4.5:1`, focus contrast at least `3:1`, a nonblank correctly sized PNG, and one non-destructive interaction with state proof.

Latest complete report:

| Evidence | Result |
| --- | --- |
| Capture classification | `67 required + 21 supplemental = 88` |
| Completion state | `activeCapture=null` |
| Owned Electron PIDs | 4 recorded |
| Remaining owned PIDs | 0 |
| Relevant runtime errors | 0 |
| Framework overlays | 0 |
| Unresolved tokens | 0 |
| Horizontal overflow / clipped controls / interactive overlaps | 0 gated failures |
| Accessible-name / tooltip gaps | 0 gated failures |
| Text / focus contrast | 0 gated failures |
| Minimum sampled text contrast | `4.77:1` |

## Theme And Media Invariants

- Shell tokens change between light and dark themes; invariant media tokens remain fixed.
- Every paired `[data-media-canvas]` region is compared by exact SHA-256 after a bounded rounded-clip inset; thresholds are not loosened.
- Task Detail uses invariant media accent/background ownership while the scene rail remains shell-themed outside the bitmap crop.
- HTML Video waits for every animation preview image to decode and for all loading placeholders to clear in every QA scope before evidence capture.
- Canonical HTML Video desktop dark/light SHA-256: `c2434b2b1b34f0eb91cd02c12ef246e07d5bfad66a842b9ae619e3c7587f5d9d`; sampled variance is `783.4989` in both themes.
- Ordinary task progress remains `x/7`; HTML Video remains `x/6`; clip-only tasks retain their real terminal-stage semantics.

## Task Detail Viewport Decision

The accepted 1440x900 concept and fresh desktop capture align on the stage strip, action row, tab strip, `542px` media workspace, and fixed scene rail. Scroll ownership is intentional and bounded:

- Desktop: the detail shell clips, `.task-detail-main` owns access to retained artifact/metric/event content below the concept frame, and `.task-scene-rail` owns the 12-scene list.
- At `<=1180px`: the detail shell becomes the content scroll owner and `.task-detail-main` becomes visible, preventing a third nested page scroll.
- At `<=860px`: the scene rail stacks below the canvas and is capped at `280px`.

Removing either scroll owner would make retained functions unreachable or turn the scene list into an unbounded column. No product change is justified; this is an intentional retained-function deviation from the concept's cropped first viewport.

## Concept Pair Review

| Concept | Fresh capture | Copy | Layout | Type / palette / icons | Spacing / responsive / media / state | Result |
| --- | --- | --- | --- | --- | --- | --- |
| New Task material | `new-task-material-desktop` | Accepted labels and fixture copy render; summary adds retained cover/draft fields | Three-stage header, editor/summary split, source controls, and first viewport align | Neutral editorial type, vermillion active/actions, Lucide controls align | Retained material-source, draft save/restore, prev/next, and fuller summary remain visible without clipping | Pass; retained-function additions |
| New Task creative | `new-task-creative-desktop` | Accepted channel/template/mode labels render; fixture summary is current | Three-stage header and editor/summary split align; full channel matrix expands the simplified concept | Editorial type, vermillion selection tint, neutral inputs, and Lucide controls align | All creative parameters remain in the scrollable editor; summary stays fixed and unclipped | Pass; complete parameter expansion |
| New Task output | `new-task-output-desktop` | Accepted output labels render with full provider/voice/cover copy | Three-stage header and editor/summary split align; governed output controls expand below fold | Editorial type, true-ratio swatches, vermillion selections, and Lucide controls align | Manual-cover-required state correctly disables create until trusted import; all output parameters remain reachable | Pass; complete parameter and required-state expansion |
| Queue | `workflow-queue-light-desktop` | Status/progress/action copy is current; newest HTML fixture has a valid empty event state | Flat queue table plus fixed event rail align | Neutral table, vermillion active filter/status, compact Lucide actions align | Four real fixtures replace the concept's three; event rail binds to the actual newest task rather than fixture order | Pass; live fixture-state difference |
| History | `history-operations-desktop` | Six-column task copy is preserved; the HTML fixture now correctly reads `HTML 动画` with `5/6` progress | Flat table, range/status/search controls, and pagination geometry align | Neutral editorial table, vermillion active range/status, and Lucide row actions align | Four real fixtures, refresh pagination, complete governance, and account/trial shell controls are retained additions; desktop/compact remain unclipped | Pass; corrected specialized type and retained governance |
| Task Detail | `workflow-task-detail-light-desktop` | Core copy preserved | Stage/media/rail geometry aligned | Neutral shell, vermillion actions, Lucide controls aligned | Retained below-frame content remains reachable; intentional scroll ownership documented | Pass |
| HTML Video Studio | `html-video-studio-light-desktop` | Six tab labels, active task copy, and six-stage lifecycle are preserved | Parameter rail, invariant media canvas, run rail, and bottom timeline align with the accepted three-column concept | Editorial shell type, vermillion active tab/progress, Lucide commands, and dark media palette align | Live preview state exposes all three decoded previews and the complete 17-field contract in a bounded parameter rail; no parameter or action is omitted | Pass; complete parameters and live media state |
| Prompt Templates | `system-prompt-templates-light-desktop` (`storydream-editorial-artifacts-o1yQff`) | Accepted editor labels render with complete template metadata, settings, and authored variable syntax | Selected `人物故事` editor is deterministic; production expands the concept's abbreviated list/editor/variable composition into the complete scrollable editor | True-white shell, vermillion actions/selections, restrained borders, editorial type, and Lucide commands align | Clone/import/export/save, default styles/draft, governance, seed pools, and every pipeline-step prompt remain reachable; variable chips and variable-aware textareas retain authored `{{...}}` syntax without false QA failures | Pass; complete editor and parameter expansion |
| Compact New Task | `new-task-material-compact` | Accepted stage/material copy and current fixture render with complete source controls | Approved 68px icon rail and editor-first stacking replace the initial concept's full rail/right summary at 1080x720 | True-white shell, vermillion active stage/actions, neutral inputs, and compact Lucide rail align | All fifteen routes remain tooltip-accessible; the full editor precedes the below-fold summary so no parameters are squeezed or removed | Pass; approved compact-responsive deviation |

Pages without a dedicated accepted concept are classified as `spec/token/component-derived`, not pixel parity.

## Final Release Gate

| Gate | Result |
| --- | --- |
| Focused regression | `3/3` files, `37/37` tests passed |
| TypeScript | Passed all three projects |
| Full Vitest | `103/103` files, `1534/1534` tests passed |
| Production build | Passed; renderer entry `340507` bytes |
| Electron smoke | Passed all six runtime assertions |
| HTML Video smoke | Passed; `42577`-byte 320x568 MP4, audio/video, two nonempty previews, frame cleanup |
| Native Editorial QA | Passed `88/88` (`67 required + 21 supplemental`); zero gated failures and remaining processes |
| Playwright availability | Browser plugin absent; workspace Playwright CLI not installed, so repository Electron `capturePage` fallback is authoritative |
| `git diff --check` | Passed |

## Residual Risk

- Production dependency audit is clean. The development/build graph still contains the recorded upstream Electron packaging advisory chain; unsafe `npm audit fix --force` downgrades and API-breaking global overrides remain rejected.
- A reviewed complete Python wheel hash closure is deferred because the packaged Python target differs from the host interpreter and the repository has no complete transitive lock input yet. Official CPython and `get-pip.py` bootstrap artifacts are SHA-256 pinned.
