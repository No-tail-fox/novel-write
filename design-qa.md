# Director Desk Design QA

## 对照证据

- Source visual truth: `I:\opc\.artifacts\product-design-rework\director-desk.png`
- Final implementation: `I:\opc\.artifacts\director-desk-qa\vox-desktop-1536x1024.png`
- AI 漫剧 implementation: `I:\opc\.artifacts\director-desk-qa\comic-desktop-1536x1024.png`
- Full-view comparison: `I:\opc\.artifacts\director-desk-comparison\comparison-full-final-1536x1024.png`
- Center/preview comparison: `I:\opc\.artifacts\director-desk-comparison\comparison-center-preview-final.png`
- Inspector comparison: `I:\opc\.artifacts\director-desk-comparison\comparison-right-inspector-final.png`
- Real connected-provider evidence: `I:\opc\.artifacts\director-desk-comparison\comparison-right-inspector-connected-evidence.png`
- Viewport: Electron `1536 x 1024`; compact verification at `1040 x 720`.
- State: VOX project, shot 02 selected, Generate inspector active, safe area visible, queue present. The final isolated QA profile intentionally has no credential; the earlier isolated live capture proves the real `ai.input.im` connected state without retaining the credential.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- Information architecture: the implementation uses the reference's 56px header, 274px left rail, 770px center, 492px inspector, 38px footer, four inspector tabs (`模式 / 生成 / 字幕 / 版本`), generation queue, narrator/material region, and staged production rail.
- Fonts and typography: StoryDream's existing Chinese system-font and Fluent optical weights are preserved. Sizes, line heights, wrapping, truncation, and letter spacing remain stable; the generated reference is slightly softer than the live Electron text, which is an expected rasterization difference rather than an implementation defect.
- Spacing and layout rhythm: desktop region boundaries match the source; preview starts at y=120, filmstrip at y=526.64, assets at y=653.64, queue at y=646, and footer at y=986. Selected rows and thumbnails use thin coral outlines instead of solid fills.
- Colors and tokens: dark neutral surfaces, coral primary action/selection, blue tab emphasis, green connected state, amber source warning, and restrained borders map to StoryDream semantic tokens. No one-hue wash or decorative gradient was introduced.
- Image quality and asset fidelity: preview, filmstrip, narrator crop, and material thumbnails use real raster assets. The live provider image is 2,158,232 bytes and remains available as generation evidence; no CSS/SVG placeholder imagery is used.
- Copy and content: generation labels and order match the source. VOX and AI 漫剧 retain mode-specific project, shot, subtitle, duration, and queue content instead of hard-coded reference data.
- Icons and affordances: project Lucide/Fluent controls are used consistently. Stage navigation, mode switch, inspector tabs, safe-area toggle, playback, mute, save, generation, render, retry, settings, and compact scrolling have accessible names and working handlers.
- Responsiveness and accessibility: `1536 x 1024` and `1040 x 720` have zero horizontal overflow, zero clipped controls, and zero runtime errors. The compact inspector remains scrollable and the queue is reachable; the core action footer remains visible.
- Dynamic-state differences are accepted: the reference has eight shots and mixed running/failed jobs, while the verified VOX project has four shots and waiting jobs. These are project data differences and were not replaced with fake rows. Connected-provider appearance is covered by the separate live evidence capture.

## Interaction Evidence

- Electron QA passed for VOX and AI 漫剧 at desktop and compact sizes.
- Verified stage navigation and inspector mapping, preview playback progress and pause, safe-area hide/show, settings navigation, and compact queue reachability.
- Verified the user-visible shell launchers, AI 漫剧 series settings, episode/scene/shot creation, shot search, consistency binding, 9:16 ratio and layout persistence, VOX round-trip, and project reload.
- Runtime errors: 0. Horizontal overflow: 0. Clipped controls: 0.
- Real image generation, TTS persistence, MP4 rendering, export directory, project reload, asset/job persistence, and quality-report persistence were verified in the focused smoke runs.

## Comparison History

1. Initial build had a solid coral filmstrip selection, an underspecified lower-center asset list, and no same-canvas comparison. Replaced the selection with a thin outline and rebuilt the lower center as reference-style category tabs, narrator card, waveform, image grid, and rights warning.
2. First visual pass placed the asset region about 40px too low because filmstrip cards included a title row. Removed that redundant row, reduced cards to the source density, and moved assets to y=653.64.
3. Inspector labels were `画面 / 动效 / 旁白 / 字幕`, unlike the source. Reorganized them to `模式 / 生成 / 字幕 / 版本` while preserving real motion editing, TTS generation/playback, subtitle editing, and version saving.
4. The complete generation form pushed its primary action below the visible area. Added a sticky Seed/generate/preview/save/render footer and verified it in both window sizes.
5. A redundant mirror heading consumed 49px above the inspector and hid the provider row. Removed it, reordered fields to match the source, and re-captured full and focused comparisons.
6. Post-fix comparison found no remaining actionable P0-P2 issue. P3 differences are limited to dynamic project data and rasterization softness.

## Follow-up Polish

- P3: a future seeded eight-shot demo can make the filmstrip density identical to the reference during presentations; production projects correctly render their actual shot count.

final result: passed

---

# 2026-08-18 端到端流程修复复验

- 实现状态：passed。项目库、三步创建预检、设置深链返回、系列圣经全页、真实阶段/健康状态、媒体恢复态和紧凑面板折叠已完成。
- 自动化状态：passed。导演聚焦合同、命令库存、TypeScript、生产构建、UTF-8 和差异检查通过；全库并发的 3 项失败均在串行复测中通过。
- 视觉状态：blocked。本轮新启动 Electron/Chromium 在进入 React 前被本机 GPU/网络服务阻断，内置 smoke 为 `mainLoaded=false`、`shellRendered=false`，因此不复用上方旧截图冒充本轮视觉通过。
- 可复测入口：`http://127.0.0.1:5173/`，Vite 已启动并保持运行。

current result: implementation passed; fresh visual QA blocked by local Chromium startup
