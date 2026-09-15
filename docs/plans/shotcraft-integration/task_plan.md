# ShotCraft 精选镜头接入

- [x] 此前项目备份：234 文件，提交 78c6c52，已推送 origin/codex/storydream-fluent-ui-system。
- [x] 建立隔离分支 codex/shotcraft-motion-library，保留旧模板 ID 与效果。
- [x] 接入五类配方六个新模板：胶带定妆、纸卡立起、纸张标题、时间轴巡游、多源汇聚、环层注释。
- [x] 保存上游来源/版本/依赖/比例与参数约束，复用当前 props 和项目资产。
- [x] 接入精简配方提示，验证参数保存、24/30 fps 与画幅适配。
- [x] 运行聚焦测试、类型检查、构建、浏览器画面与本地成片验证。
- [x] 独立审查并修正来源覆盖、多行文案与纸卡图片挤压，完成验收记录。

不调用付费模型。源码来自此前已核验的本地上游副本 5e71af35；不合并上游 Workbench。

## 验证基线

此前 typecheck 已存在 browser-fallback 缺失 updateHtmlVideoSceneStructure/updateMusicMvTask、FileDatabase 缺失 updateMusicMvTask。全量测试已在备份前启动，结果单独记录。

2026-09-16 完成，具体结果见 README.md。最终聚焦测试 31/31 通过，生产构建通过；全项目类型检查仍保留上述既有问题。
