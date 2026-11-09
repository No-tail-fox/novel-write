# Lemo 原生工程接入决策与验收（2026-10-30）

> 状态说明（2026-10-30 晚）：下文保留最初引入阶段的历史记录，早期“未改默认/未接任务服务”不再代表当前状态。最新实施、回归和未完成项见 `lemo-agent-integration-2026-10-30.md`。真实 AI 新片仍未完成验收。


## 决策

采纳用户建议：**完整引入 Lemo 上游工程，以原生工程为制作基础，在外围做 StoryDream 本地适配**。
不再继续用自研 shared/scene/director factory 契约逐项模仿 Lemo。已完成的旧项目不迁移、不自动重跑。

上游：lemomo-ai/lemo-opuscar，固定 revision `f17136060781a0068a7951245a3aa7835a7230de`。
完整 Git 树 2,519 文件，原始字节 113,695,894；源码位于 `vendor/lemo-upstream`，不包含嵌套 .git。
导入使用 Git blob，不受 Windows checkout 换行转换影响；逐文件 SHA-256，专用 .gitattributes 保留上游原字节。
代码/文档 MIT；样片静帧/视频 CC BY 4.0；各样片 CREDITS、OFL 和三段排除配音遵守上游声明。

## 为什么改变路线

上游是供编码 Agent 使用的制作工程，不是单次请求的视频服务。原生多文件 ESM、Three.js addons、摄影后处理、声音工具与导演/审片方法是整体能力。
旧路径只加载风格文本，却约束 Canvas2D、factory 文件结构和严格长 JSON，这不是等价接入。
复制源码也不能自动复制示例质量：上游强调以 Claude Opus 5.5 调试，模型能力、素材依赖、工具闭环、视觉审片仍需验收。

## 保持与适配的边界

| 层 | 原样保持 | 本地适配 |
| --- | --- | --- |
| 导演与风格 | DIRECTOR/TECHNIQUE/STYLE、先构思后参考 demo 技法 | 中文用户 brief、任务状态、批准文案、预算与断点 |
| 影片工程 | index.html、多 JS/ESM、Three addons、core 库 | 每任务独立可写目录；上游库只读；不压回旧 factory |
| 工具闭环 | 构思 → 风格帧 → 实现 → 抽帧 → 修复 → 导出 | 限定目录文件工具、受控渲染/素材/配音工具、错误回执；不开放任意系统 shell |
| 模型 | 以实际请求能力运行 Agent | Chat / Responses / Anthropic 显式协议适配；工具/视觉/输出容量单独探测；不按模型名猜接口 |
| 声音与字幕 | 编排、音效事件、画面内标题 | 宿主 TTS、ASR 对齐、普通字幕轨和最终混音；画面内字体属于设计，不与普通字幕混淆 |
| 验收 | 真实随机时刻 render(t)、确定性画面 | 技术检查与视觉模型审片分开，不能以“渲染成功”证明“效果合格” |

普通字幕/配音由程序执行不代表完全取消 AI 的声音设计：AI 可以规划节奏、音效和音乐，宿主负责可靠地产出与合成。

## 已落地

- [x] 原样导入完整固定版本上游树；可复现导入和完整性验证脚本。
- [x] 撤下本轮未验证的 studio/factory 扩张接线，原型留档在 `I:/StoryDreamLemoUpstream-20261030/previous-studio-prototype`；不回滚其他工作。
- [x] 原生多文件本地 HTTP 模块服务器：每会话独立影片目录，Three addons，UTF-8，loopback，阻止路径穿越、junction 逃逸和跨站访问。
- [x] Electron 原生抽帧适配：使用内置 Chromium，沙箱、无 Node 权限、禁止外网/窗口/下载，真实 READY/render/DUR 协议，资源错误回执。
- [x] 三协议本地样帧消息适配及 mock 请求体回归。此项不是对三个外部渠道的付费实测。
- [x] 打包声明保留完整原库及 Three 模块，独立原生 runner 构建；未将未完成路径切换为 UI 默认。

## 当前实测记录

- 完整性：2,519 原文件 SHA-256 通过。
- 初次原版 Memphis Diorama：5 个未跟踪字体缺失，READY 失败，回执正确失败。
- 初次原版 Brick Toy：共享 Poly Haven HDRI 不在 Git 树中，加载失败，回执正确失败。
- 已添加独立资源缓存（来源/许可/SHA-256）、两个 benchmark 的依赖安装脚本；不改 vendor 或示例故事/镜头/代码。
- 依赖补齐后的实测和回归结果写入本文件后续记录。

## 仍未完成；不得标记端到端完成

- [ ] 正式任务服务接入新的原生工程文件工具循环、持久化回执和断点恢复；不是只在 QA 脚本运行。
- [ ] 正式 UI、预览、导出统一使用原生工程，兼容旧项目且不静默迁移。
- [ ] 声音生成、真实词级对齐、宿主字幕与最终混音接入新路径。
- [ ] 视觉审片模型实际接收样帧、提出修改并由正式 Agent 修复，持久化结果。
- [ ] 所选风格的离线依赖预检与安装管理；当前两个 benchmark 不代表 66 风格全覆盖。
- [ ] 用新正式路径从中文需求生成一条全新短片，检查成片、声音、字幕、节奏；原版示例仅验证运行环境，不冒充新片。

## 验收命令与证据

- `node scripts/import-lemo-upstream.mjs --verify`
- `python scripts/prepare-lemo-benchmark-assets.py`（公开依赖下载，单独缓存，不读 API key）
- `scripts/qa-lemo-upstream.ts` 编译为 CJS 后由 Electron 运行；环境变量 `STORYDREAM_LEMO_DEMO` 指定 `brick-toy` 或 `memphis-diorama`。
- 输出 `.artifacts/lemo-upstream/<style>/review.json` 和实际抽帧；该目录不入 Git。
- `tests/lemo-upstream.test.ts`、`tests/llm-multimodal.test.ts` 与原 provider/原生流程回归、typecheck、build。

## 本轮验证结果

- 2026-10-30：原版 Brick Toy 和 Memphis Diorama 各在 1/15/32 秒抽取 1920×1080 图像，均零脚本错误、零缺失资源，原生技术协议通过。片长元数据分别 54s/45s；仅抽帧，未渲染完整视频或音轨。
- 两个基准的源代码未改；独立依赖缓存补齐上游指定字体和 HDRI，并记录来源、许可和 SHA-256。完整上游 2,519 文件仍全部哈希一致。
- 8 个针对性回归文件共 188 测试通过；完整 TypeScript 检查与生产构建通过（`npm run typecheck`、`npm run build`，exit 0）。包括旧原生制作、分阶段规划、增量创作、修复续跑、三协议消息与新源服务。
- 打包增加上游完整工程与 Three ESM 的外置资源声明；构建在执行前验证上游完整性。未执行安装包验收。
- 明确区别：上游原版抽帧运行成功 ≠ 新任务生成成功 ≠ 全片音画导出成功 ≠ 自动视觉审片合格。

- Git 可见性复核：2,519 个上游原文件及 1 个来源清单全部可纳入版本控制，忽略文件数为 0；已为上游原本跟踪的 voice/out JSON 添加窄范围例外。
