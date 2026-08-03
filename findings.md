# 剪映草稿兼容性发现

## 失败现象

- 失败草稿初始 `duration = 123000000`，包含 17 组图片、音频和文本。
- 剪映尝试读取后把工程改写为 `duration = 0`，音频和文本素材消失。
- 正常剪映工程约 222 KB 且为剪映内部格式；失败草稿仅约 40 KB。

## 根因

- `src/shared/storybound-sidecar.ts` 的 `generate_story()` 只写了通用 `materials` 与 `tracks` JSON，并未使用已导入的 `pyJianYingDraft`。
- `src/shared/runner.ts` 在生产环境拿到 `mediaSidecar` 后，会把它作为草稿写入 fallback。
- `electron/main.ts::buildRunOptions()` 没有注入已有的 `runPyJianYingDraftBridge`。
- `electron/html-video-runtime.ts` 的默认草稿写入同样未注入真实桥接。
- 现有测试大量使用测试版 `fakeBridge`，因此没有覆盖生产接线缺失。

## 修复方向

- 普通任务在 Electron 主进程注入 `draftWriterOptions.runBridge`。
- HTML 视频默认 writer 显式调用 `writeJianyingDraft(..., { runBridge })`。
- 保留依赖注入能力供测试使用，但生产路径不再静默退回伪草稿。
- 音乐 MV 的专用 sidecar 路径另有语义，本次先不改变其媒体合成行为。
