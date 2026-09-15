# VOX 视频技能安装与工作台接入

完成日期：2026-09-15。

已安装五个用户技能，并在 StoryDream 的 **VOX → 分镜 → 画面 → 制作方式** 中接入四种镜头制作方式。选择会随项目保存，重开后恢复；使用现有图片、视频和 Remotion 服务。

## 已安装的技能

安装位置：`C:/Users/foxnotail/.codex/skills/`。使用官方 skill-installer 安装脚本，逐项确认 `SKILL.md` 存在。Codex 下一轮对话可发现这些技能。

| 本机目录 | 上游来源 | 用途 |
| --- | --- | --- |
| `paper-cut` | [aijiduonadegou/Paper-Cut](https://github.com/aijiduonadegou/Paper-Cut) | 原画、分层纸片与动画制作流程 |
| `vox-skill` | [jaredcassoutt/vox-editorial / skills/vox-skill](https://github.com/jaredcassoutt/vox-editorial/tree/main/skills/vox-skill) | 旁白时间轴与编辑式拼贴制作 |
| `vox-editorial` | [jaredcassoutt/vox-editorial / skills/vox-editorial](https://github.com/jaredcassoutt/vox-editorial/tree/main/skills/vox-editorial) | VOX 编辑表达与视觉编排 |
| `gbro-collage-broll` | [pyang5166/gbro-collage-broll](https://github.com/pyang5166/gbro-collage-broll) | 口播视觉隐喻与拼贴 B-roll |
| `vox-collage-art-animation-nantian` | [nantian721/vox-collage-art-animation-nantian](https://github.com/nantian721/vox-collage-art-animation-nantian) | 拼贴艺术动画与镜头衔接 |

本机 `vox-skill/scripts/sync_timing.py` 已补充 Unicode 词匹配和显式 UTF-8 文件读写。中文测试“城市”与“桥梁”分别解析到第 15 和第 45 帧，生成的 TypeScript 保留中文。适配记录位于技能目录的 `LOCAL_ADAPTATION.md`。

## 工作台中的实际功能

| 制作方式 | 执行路径 | 使用方法 |
| --- | --- | --- |
| 原画参考分层 · Paper Cut | 先生成构图原画，再将原画作为实际参考图片提交给背景和主体生成请求；主体走本地绿幕抠像，分层由本地时间线编排 | 选择或导入原画，也可直接生成；图片服务需要支持参考图 |
| 旁白拼贴动画 · VOX | 切换到 Remotion；首次使用纸片主体模板，保留已有素材。AI 代码提示会要求读取真实旁白时间戳安排动作 | 选择模板或 AI 代码模式，沿用已有预览、个人模板与视频导出 |
| 口播配画面 · gbro | 当前口播进入关键帧与图生视频提示，加入单一视觉隐喻、半调纸片和最多四组物件的依次组装要求 | 生成或选择首帧，再生成图生视频 |
| 拼贴艺术动画 · Nantian | 首帧和尾帧同时传入视频供应商，提示要求纸片逐件展开并连续落到尾帧构图 | 选择或导入两张图片；可点击“使用下一镜头关键帧”；视频服务需要支持首尾帧 |

Nantian 缺少尾帧时禁止提交生成。桌面主进程再次检查首尾帧文件存在且非空，并按 `i2v` + `first-last-frame` 能力选择服务。修改尾帧或制作方式会解除旧视频的当前选择，保留历史资产；生成期间改变输入不会让旧结果覆盖当前镜头。

Paper Cut 的原画和衍生图层均计入现有生成数量预留。更换参考原画会解除衍生生成图层的绑定，保留原始历史与手动导入素材。

## 实现边界

- 工作台使用本项目编写的适配代码，不直接执行所安装技能的 Python/Swift 脚本。没有将许可未确认的 Nantian 源码复制进产品。
- Paper Cut 是参考图驱动的背景与主体再生成，不保证逐像素精确拆层；上游完整 HyperFrames 流程没有作为黑盒嵌入。
- VOX 模板正常播放确定性动画；按词触发的动作通过 AI 代码模式读取真实时间戳实现，不把普通模板宣称为自动逐词编舞。
- 上游 `vox-skill` 的 `cutout.swift` 依赖 macOS Vision，不能在 Windows 原样运行。工作台使用自己的图片导入、参考图生成和本地绿幕抠像路径。上游 Edge TTS 实时出片未测试。
- 本轮没有调用付费图片、文本或视频模型。请求参数和供应商适配器已验证，真实模型出片质量仍需实际生成检验。

## 验证结果

- 新增 `tests/editorial-recipes.test.ts`：7 项通过，覆盖四种制作方式持久化、原画参考请求、旁白提示、尾帧守卫、视频失效、供应商能力和真实适配器的首尾帧字节传递。
- 相关回归首次运行 14 文件 / 133 项：131 项通过；一个大图调度测试在并发构建期间超时，单独重跑 `director-batch.test.ts` 后 21 项全部通过；剩余一项是旧导航数量断言（预期 21，现有入口 23），与本轮制作方式无关。
- 完整 VOX 页面在 1536×1024 和 1040×720 下通过原画→参考背景→透明主体、缺尾帧禁用、实际双帧请求、使用下一镜头关键帧、保存重载、B-roll 提示和 Remotion 播放检查；没有横向溢出或运行时错误。
- 既有双链路浏览器回归通过 5 个流程，覆盖独立图层、部分失败重试、图生视频关键帧及保存重载。
- `npm run build` 通过。
- `npm run smoke:electron` 通过全部 6 个断言：主进程、preload、IPC 状态、preload 操作、窗口策略和页面渲染。
- `git diff --check` 通过，仅存在既有 CRLF 提示。

全项目类型检查尚未通过，记录如下；本轮接入文件没有新增类型错误：

| 检查 | 工作区既有阻塞 |
| --- | --- |
| Renderer / tests | `browser-fallback.ts` 缺 `updateHtmlVideoSceneStructure` / `updateMusicMvTask`；`storage.test.ts` 调用缺失的 `FileDatabase.updateMusicMvTask` |
| Electron | Music MV 更新逻辑向 `updateTask` 传入其类型未包含的 `ratio` |
| Scripts | 三个既有 QA seed 的字符串 `theme` 类型；`qa-vox-animation-render.ts` 的环境对象未声明 `ELECTRON_RUN_AS_NODE` |

页面报告和截图：`.artifacts/editorial-recipes/report.json`、`nantian-1536.png`、`nantian-1040.png`、`paper-cut-*.png`、`narrated-*.png`。已实看正常与紧凑窗口：右侧检查器独立滚动，底部主要操作保持可访问。测试图是本地夹具，不是 AI 出片样片。

既有双链路回归报告：`.artifacts/editorial-dual-chain/result.json`。
