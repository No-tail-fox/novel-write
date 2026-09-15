# VOX 两条视频链路实施与验收

日期：2026-09-14。用户决定保留图生视频与不使用视频模型两条链路；新项目默认本地拼贴动画，本轮只完成实现及本地验收。

## 最终行为

| 链路 | 素材及动作 | 调用 |
| --- | --- | --- |
| 本地拼贴动画（默认） | 独立环境底板、透明主体、准确文字；按镜头时长错峰入场、落定、停留、离场，附带辅助相机运动 | 背景/主体分别调用图片服务；抠图、文字、动画及合成本地执行，不调用视频模型 |
| 图生视频 | 生成完整构图关键帧，再按元素动作与相机动作调用视频服务；旁白/字幕最终合成 | 图片服务及配置的视频生成模型 |

镜头可分别选择模式，在同一项目中混用两种镜头。完整关键帧使用独立资产引用，不替换本地背景与主体；切换模式、恢复历史和重开项目保留各自素材。单镜头 hybrid 引擎仍不支持，入口不会为其提交收费视频任务。

旧项目打开后不会自动调用模型。点击“补齐分层素材”时，旧单张扁平图保留为图生视频关键帧，并建立独立本地图层；已有多素材场景保留布局，只补旧原生文字占位和缺失素材。主体失败后已成功的背景会即时保存，重试只补缺失图层。素材不足或同一海报被复用于名义上的背景/主体时阻止作为完整分层动画交付。

图生视频请求将元素动作和相机动作分开描述。收到结果时校验当前任务、模式、关键帧、提示词、时长和画幅，防止覆盖编辑后的镜头；视频时长不足明确失败。关键帧完成时，视频预览继续显示等待视频生成，不再显示镜头已生成。已有预算、模型路由、失败状态和不自动重复提交付费请求的策略保留。

透明前景方案适用于按要求生成的纯 #00FF00 背景素材，含边缘羽化、去绿边、透明面积及主体有效性校验。它不等同于任意图片语义分割；主体应避免绿色，输出不合格时明确失败并允许重试。

## 验收证据

- 最终聚焦套件：19 文件、176 项测试通过，覆盖双链路、旧项目升级、分层生成/恢复、过期结果、抠图、动画导出、指纹、批次容量及视频合同。
- 生产构建：renderer 和 Electron 均通过，日志位于 `.artifacts/vox-final-build.log`。
- 双主题/双尺寸预览：1536×1024 与 1040×720，共 8 组检查，0 页面错误；`.artifacts/vox-preview/result.json`。
- 真实 EditorialCollagePage 集成验收：独立背景/主体请求、主体失败后仅补齐主体、独立视频关键帧、保存及两次完整刷新，共 4 组通过；`.artifacts/editorial-dual-chain/result.json`。
- 真正本地导出：4 秒、1920×1080、24 fps，607154 字节，含音轨；透明主体进入/离开位移约 469/977 像素，中文字形完整，标签分行自然，无黑帧或静音。样片、抽帧与报告位于 `.artifacts/vox-local-motion-qa/run-XHrtFB/`。

验收使用本地合成素材和隔离 API 模拟，外部生成调用 0 次；未改写实际《撒日朗》项目，未验证付费视频服务的实际生成质量。两条链路的实现及本地可测部分已完成。

全局类型检查仍存在本次改动前已报告的问题：`src/app/browser-fallback.ts` 缺少 `updateHtmlVideoSceneStructure` / `updateMusicMvTask`；`tests/storage.test.ts` 引用缺失的 `FileDatabase.updateMusicMvTask`；`electron/main.ts` 其他任务更新逻辑的 `ratio` 类型不匹配。未将这些既有错误记为 VOX 测试通过。

单独检查脚本配置还发现三个其他 QA 种子脚本的 `ThemeName` 类型错误：`qa-hover-seed.ts`、`qa-project-cover-seed.ts`、`qa-workspace-back-seed.ts`；新增 VOX 脚本没有报错。

复现入口：

```powershell
node node_modules/tsx/dist/cli.mjs scripts/qa-vox-local-motion.ts
vendor/python/python.exe tests/editorial-dual-chain.browser.py
vendor/python/python.exe tests/director-vox-preview.browser.py
npm run build
```

GitHub 技术方案与修复前根因见 [调研报告](2026-09-14-vox-motion-skill-research.md)。
