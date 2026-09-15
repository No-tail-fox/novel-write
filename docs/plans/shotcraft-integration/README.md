# ShotCraft 精选镜头接入记录

完成日期：2026-09-16。先前项目工作已提交为 `78c6c52b86806d9a9b4c8fee2fc01a0828d31701`，并在开始本轮前上传至 `origin/codex/storydream-fluent-ui-system`；随后从该提交创建 `codex/shotcraft-motion-library`。

## 使用入口与行为

在分镜中选择镜头，进入右侧「画面 → 动画 → 动画模板 → 选择模板」。本次新增六个独立模板，原 49 个模板继续使用原来的 ID 和实现。

| 模板 | 分类 | 图片 / 条目上限 | 建议时长 |
| --- | --- | --- | --- |
| 纸胶带定妆 | 纸张拼贴 | 1 张图片 | 4.7 秒 |
| 折页纸卡立起 | 纸张拼贴 | 3 张图片、3 张纸卡 | 5.4 秒 |
| 逐词纸面压印 | 纸张拼贴 | 标题、副标题和一个强调词 | 3.5 秒 |
| 刻度时间轴巡游 | 时间叙事 | 5 张图片、5 个事件 | 6 秒 |
| 来源汇聚成一体 | 原理流程 | 6 个来源 | 5.6 秒 |
| 环层结构注释 | 原理流程 | 1 张图片、4 条注释 | 6.4 秒 |

支持 16:9、9:16、1:1、4:3。文字、颜色、图片、条目继续由现有编辑器修改；来源和字幕分别保留空间。切换模板保留先前参数，仅加载当前模板需要的素材。超出文案或数量限制会提示修改，不截断保存内容；粘贴的换行在新模板画面中自动重排，原文保存在参数中。AI 生成请求只增加所选镜头的简短配方，本次验收未调用模型。

## 来源与实现

上游固定为 `Vincentwei1021/video-shotcraft` 的 `5e71af35a2daee492dd3ea93e5e8903f32dcd13c`。采用五种配方中的六个动画变体，按宿主时长和帧率适配，并重新处理中文、画幅和用户素材。来源、版本、文案约束和可编辑字段见 `src/shared/shotcraft-recipes.ts`。

Apache-2.0 全文保存在 `src/features/vox-animation/shotcraft/LICENSE`，构建时复制到 Electron 输出；改编说明见相邻 `THIRD_PARTY_NOTICES.md`。不包含上游样例品牌、照片、音乐或字体，也未引入上游 Workbench。

## 验证结果

- 聚焦 5 文件、31 项测试通过；覆盖模板兼容、真实个人模板存储、素材选择、参数校验、提示内容、动画停稳与 24/30 fps。
- `npm run build` 通过。
- 六模板 × 四比例 × 24/30 fps 共 48 组、288 张关键帧通过；重复定位同帧的 DOM、文字和样式完全一致。26 组 PNG 字节一致，其余只有最大 2/255 的 Chromium RGB 栅格舍入。
- 深色 / 浅色 × 1536×1024 / 1040×720 共 4 组编辑器交互通过：选择模板、中文编辑、图片替换、切换保留草稿、保存个人模板、保存后刷新恢复。
- 各模板文案达到限制的四比例画面另行检查；结构解释两模板还以四比例和两种帧率独立测量 64 个时刻，修复后无文字越界或来源覆盖。
- 生产 `renderDirectorVideo` 与隔离 Electron 环境导出六个新模板和一个旧模板：26 秒、1920×1080、24 fps、624 帧完整解码，字幕布局与镜头连接检查通过。

浏览器与成片共用运行时 SHA-256：`052f5a1e7b73ac737d05d1c3110f73a256a3718202a83d03a5cee68728392d46`。

本地样片：`.artifacts/shotcraft-qa/shotcraft-integration.mp4`。完整验收和截图：`.artifacts/shotcraft-qa/README.md`；最大文本证据：`.artifacts/shotcraft-boundary/` 与 `.artifacts/shotcraft-flow-boundary/`。产物保持本地，未纳入源码提交。

使用已有依赖可复现主要验收：

```powershell
vendor/python/python.exe scripts/qa-shotcraft.py
node node_modules/tsx/dist/cli.mjs scripts/qa-shotcraft-render.ts
vendor/python/python.exe scripts/qa-shotcraft.py --media-only
```

## 既有问题与验证边界

备份前全量测试为 2674 项中的 17 项失败（14 个文件），日志 `.tmp/shotcraft-before-tests.log`。本轮聚焦测试通过，不代表这些旧问题已解决。主类型检查仍报告 `browser-fallback.ts` 缺少 `updateHtmlVideoSceneStructure` / `updateMusicMvTask`，以及 `tests/storage.test.ts` 调用尚未实现的 `FileDatabase.updateMusicMvTask`，与备份前相同。

工作台验收使用真实组件和隔离 localStorage 保存夹具，不代替应用数据库 IPC 的持久化验收；个人模板另有真实存储往返测试。实际导出为 24 fps，30 fps 验证覆盖同一生产运行时。样片使用本地绘制图片和空音轨，网络和付费模型调用均为零。
