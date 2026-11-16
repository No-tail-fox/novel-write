# Approved integration QA

Scope: real AppShell + MotionComicPage and actual component interactions against a memory-only Proxy API. No production bootstrap, IPC, database, provider credentials, license overrides, imported files or generation. Default inactive activation remains unchanged. Only fixture task detail, script snapshot, final-film gate and director-batch reads are allowlisted; every other API operation records forbiddenCalls and rejects. Browser requests are restricted to its own ephemeral loopback asset server.

Run from I:/opc:

```powershell
& I:/nodejs/node.exe node_modules/vitest/vitest.mjs run tests/motion-comic-approved-integration.test.ts tests/motion-comic-asset-create-dialog.test.ts tests/motion-comic-reference-adoption-ui.test.ts tests/motion-comic-task-view-model.test.ts tests/motion-comic-video-candidate.test.ts
& vendor/python/python.exe tests/motion-comic-approved-integration.browser.py
```

Optional environment overrides: STORYDREAM_APPROVED_QA_OUTPUT, STORYDREAM_QA_NODE, STORYDREAM_QA_CHROME. Python needs Playwright. Default output: artifacts/approved-integration; viewport sizes 1040×720 and 1600×1000.

Results: 29 unit tests passed (5 files across two bounded runs). Browser 16 named checks passed, covering model inspection while paused with all selects/save disabled; three task sources through the real projection and drawer; script, asset and provider-episode navigation; cancelled asset has no object; reopening clears cancelled values; required-name feedback; successful local asset creation with dirty state and no persistence calls. Eight screenshots cover locked models, tasks, asset form and local dirty asset at both sizes. All measured document widths fit their viewports. forbiddenCalls, blockedNetwork and runtimeErrors were empty.

Candidate imports are tested with the pure attach function for look/scene/prop, preserving adopted reference, existing video binding, provider history and original document. Source-level integration checks verify Page explicitly uses setFixed:false, defaults new videos to candidate, and preserves resume policy. No real image-import operation or video submission was performed.

The overview now also reads snapshots (tasksOpen || overviewOpen), as confirmed with parent; this is intentional and documented rather than claiming reads occur only after drawer opening. A paused task fixture exercises the model lock; it does not impersonate an active license. The fixture has synthetic task metadata but no generated output.

Screenshots await finite browser animations before capture. The initial drawer transparency was an entrance-animation frame, not a persistent visual defect: settled computed background is rgb(21,24,27), opacity 1, and --shell-surface #15181b at both widths. Settled screenshots have been refreshed and inspected.

Parallel implementation briefly produced unresolved CSS imports during build; those were reported to parent without editing business code. Earlier failed screenshots may remain named failure-*.png and are not acceptance evidence. report.json and named screenshots describe the latest successful run.
