# Director Desk 可用性与播放修复发现（2026-08-18）

- 已将用户临时截图保全到 `.artifacts/director-defect-audit-2026-08-18/00-user-report.png`。
- 截图中的中文字符本身可读，主要可见缺陷是项目标题被省略、预览字幕分词/断行并遮挡画面、素材搜索浮层压在页签附近；需要以运行态 DOM 和 CSS 继续确认是否还存在真实编码问题。
- `生成服务` 显示为禁用的 `GPT Image · gpt-image-2 · 2K`，与上方“已连接”状态矛盾，属于可用能力被锁死而非服务离线。
- 播放时间显示为 `00:05:00 / 00:30:00`，当前格式包含帧位但界面没有解释，且需继续验证计时、暂停、拖动、镜头边界和渲染视频路径。
- Product Design 用户上下文预检没有已保存条目，本轮不依赖外部设计上下文。
- `DirectorDeskWorkspace` 将“生成服务”写死为唯一选项并显式 `disabled`；页面只拿到当前活动 profile 的扁平状态，既没有候选 profile，也没有选择回调。
- 时间轴 `.director-scrub` 只是 `div`，没有键盘、点击或拖动能力；其可视进度不能被用户控制。
- 播放逻辑使用 100ms interval 推进 React state，并在镜头变化时重建 `<audio key=...>`；音频 effect 每次镜头切换都按旧 state 重新定位，容易在镜头边界暂停、跳动或失步。
- 返回按钮直接 `navigate('new-task')` 并卸载 Director Desk；需要在 Electron 基线中测量点击到目标页稳定之间的空白/中间帧，再决定由壳层过渡还是页面预热修复。
- 当前 Electron 历史副本在 1320x860 成功复现：标题元素可见宽 305px、内容宽 339px，实际被省略；素材搜索区域仅 63px 宽且与 372px 页签竞争 343px 空间。
- 当前“生成服务”只有 `GPT Image · gpt-image-2 · 2K` 一个 option，原生 `disabled=true`；不是接口离线，而是 UI 没有选择能力。
- 当前播放在 1.25 秒内从 `00:00:00` 到 `00:01:07`，暂停保持稳定，但页面没有 seek 控件；`MM:SS:FF` 又未标注帧，使 `00:30:00` 容易被理解成 30 分钟。
- 返回帧序列无黑屏：0-51ms 保留工作台，51ms 出现共享壳“保存中”，65ms 切到新建任务，95ms 恢复“所有改动已保存”；短暂保存状态和错误目的页共同造成回程顿挫感。
- 基线 4 张截图与报告保存在 `.artifacts/director-defect-audit-2026-08-18/before/`，运行时错误和横向溢出均为 0。

---

# VOX / AI 漫剧黑屏复审发现（2026-08-18）

- 用户报告真实点击 VOX / AI 漫剧后出现黑屏，因此此前隔离新建项目的成功截图不再能证明当前用户路径健康。
- 本轮 Product Design 审计只接受当前运行中新捕获、保存并复看的截图；同时记录每步 DOM、路由、根节点尺寸、console error 和 page error。
- 当前没有 Electron/StoryDream 进程，只有 5173、5174、5175 三个 Vite renderer；优先检查 5173 浏览器 fallback，再启动隔离 Electron 覆盖桌面路径。
- Product Design 用户上下文预检未发现已保存上下文；本轮以用户当前反馈、现有 Director Desk 参考和 StoryDream 组件合同为准。
- 5173 的本轮实际点击稳定复现黑屏：VOX 和 AI 漫剧都只有居中的顶部导航与标题，其余约 90% 视口为纯黑。
- DOM 证明不是 renderer 崩溃：VOX / AI 漫剧 route 均正确、根节点 1536x1024、无页面级错误；但 `.director-desk` 只有 1536x106，页面正文虽在 DOM 中却没有可见高度。
- 两条路径截图整体颜色方差仅 257 / 234，远低于首页 2710；问题应归因于创建页高度链路或子元素溢出裁切，而不是接口、懒加载或历史文档解析。
- 精确根因是 `shell.css` 的浏览器提示规则 `.content:has(.page-head .local-note)` 特异性高于 Director Desk 的单行内容规则：隐藏页头仍被 `:has()` 命中，内容网格被切成 `106px + 1fr`，唯一可见 route 因自动放置落入 106px 首行。
- 本轮证据保存在 `.artifacts/black-screen-audit-2026-08-18/`：`01-before.png`、`02-after-vox.png`、`03-before-comic.png`、`04-after-comic.png` 与 `browser-report.json`。
- 修复后同一路径、同一 1536x1024 视口中，两页 `.director-desk` 均恢复为 1024px，`.content` 均为单一 `1024px` 网格行；创建表单完整可见，横向溢出和页面错误均为 0。
- 修复后的 VOX / AI 漫剧截图方差提升为 458 / 485，且实际截图已复看确认表单、标签、输入、画幅选择和主操作都在画面内。
- 浏览器 fallback 已能创建本地 VOX 项目并进入完整三栏工作台；首张工作台截图显示导航、镜头列表、预览、素材和生成检查器都存在，没有再发生整页黑屏。
- 工作台参考 PNG 每张约 1.9-2.3MB，直接 HTTP 请求为 200；首次完整门禁在图片解码完成前读取 `naturalWidth=0`，需等待真实图片就绪而不是取消预览非空检查。
- 最终浏览器 fallback 审计完成 8 个步骤：两个入口创建页、两个本地项目创建、VOX/AI 漫剧桌面工作台与 1040x720 紧凑工作台全部通过。
- 四张完整工作台截图的全屏颜色方差为 4032-6830，预览 PNG 均完成解码；每页 `.director-desk` 等于视口高度，网络错误、运行时错误、route error、横向溢出和固定控件裁切均为 0。
- 实际截图复核确认：VOX 显示 4 镜头、素材缩略图和生成检查器；AI 漫剧显示 6 镜头、角色/场景一致性素材和生成检查器；紧凑布局保留三栏与滚动所有权。
- 本机真实 StoryDream 数据位于 `C:\Users\foxnotail\AppData\Roaming\storydream\storydream\data.db`，同时有真实任务目录；后续只复制到隔离用户目录做兼容复测，不直接打开或修改原库。
- 真实库有 1 个旧版 VOX 项目、0 个 AI 漫剧项目；旧 VOX `pipelineData` 为合法 JSON，但没有新字段 `schemaVersion`，适合作为历史兼容样本。
- 生产构建后的 Electron 已用这个数据库副本完成历史复测：旧 VOX 在桌面/紧凑窗口都直接进入完整工作台，已有生成图与 provider job 状态正常显示，没有 schema 解析异常。
- 同一隔离副本中，AI 漫剧空创建页完整可见，并可新建系列进入桌面/紧凑完整工作台；6 个 Electron 步骤的运行时错误、route error、横向溢出和固定控件裁切均为 0。
- Electron 当前审计证据保存在 `.artifacts/black-screen-audit-2026-08-18/electron/`，隔离数据库副本和进程均已清理，真实数据库未写入。
- 原有 Director Desk 全交互脚本在当前生产构建上重新通过：14 个交互合同全部为真，VOX/AI 漫剧桌面与紧凑工作台均占满视口，预览方差 5960-7476，0 运行时错误、0 横向溢出、0 固定控件裁切。
- 全库回归进一步发现命令所有权库存不完整：`generateImageLab` 未列 VOX/AI 漫剧的 `generateShot`，`generateVoiceLabPreview` 未列两条导演页的生成旁白入口，`renderDirectorProject` 整项缺失；这不是黑屏根因，但会让功能完整性合同漏检真实调用者。
- Product Design 用户上下文用 Codex 随附 Python 重跑后确认 `user-context.md` 不存在；本轮继续以当前 Director Desk 参考、真实屏幕和 StoryDream 组件合同为唯一设计依据。
- 修复后的 Electron after 截图显示 VOX 与 AI 漫剧均为完整三栏工作台；`director-preview-title`、字幕、素材搜索和固定操作均在视口内，三种尺寸的 `horizontalOverflow=0`、固定控件裁切为 0、预览标题与字幕无重叠。
- 生成服务验证使用隔离 profile 的第二项 `QA 第二图片服务 · qa-image-model · 2K`：下拉共有 2 项，第二项 `disabled=false`，刷新后保持选中；假凭证只写入隔离 profile，未触发生图请求。
- 播放验证不再使用帧号时间：进度滑块可播放、暂停、点击拖动和跨第二镜头跳转，时间码为 `00:03 / 00:30`；返回帧 0 次出现“保存中”。
- 确定性本地渲染生成并持久化 1 个 `director-final-video` MP4；原生视频报告为 `readyState=4`、`duration=4.023991s`，连续取样推进到 `0.054772s`，暂停和 seek 到 `2.816793s` 成功。
- 本轮 after 证据目录为 `.artifacts/director-defect-audit-2026-08-18/after/`，包括 9 张逐步截图、`report.json` 和 `director-rendered-video.mp4`；审计临时 profile 已清理。
- 最终代码修改后的浏览器审计于 11:37 重新捕获 8 个步骤：主界面、VOX 创建页/桌面/紧凑工作台、返回主界面、AI 漫剧创建页/桌面/紧凑工作台；两条工作台均显示新的禁用态“打开导出目录”，0 运行时错误、0 网络错误、0 横向溢出、0 固定控件裁切。
- 本轮完整工作台截图方差为 4031-6805，预览均为已解码的 1280x720 真图片；`.director-desk` 在 1536x1024 和 1040x720 都与视口同高，黑屏根因未复发。
- 人工打开浏览器步骤 1-4 后确认：主界面两条入口在左栏和页头都可见；VOX 创建表单完整居中且不再只剩 106px 顶部条；桌面工作台的三栏、预览、胶片、素材、检查器和队列同时可见；紧凑工作台没有重叠，纵向内容由各栏独立滚动。
- 人工打开浏览器步骤 5-8 后确认：返回首页状态稳定；AI 漫剧创建表单完整显示系列、设定、首集与画幅；桌面工作台能同时看到集数/镜头生命周期、角色与场景一致性资产、预览、生成参数和队列；1040x720 仍保持三栏边界、可读字幕和无重叠状态。
- Electron 历史副本 6 张截图已逐张打开：历史首页正常；旧 VOX 的已生成关键帧、完成任务状态和四镜头工作台完整恢复；AI 漫剧空创建页、桌面与紧凑工作台均正常。紧凑胶片条通过明确的横向滚动承载多镜头，三栏、状态栏和主操作没有互相覆盖。
- 最终 4 张交互终态截图也已逐张打开：VOX 播放推进后桌面/紧凑画面一致，AI 漫剧新增到 2 集 8 镜并保存 9:16 画幅后桌面/紧凑画面一致；没有黑屏、错误页、组件重叠或主操作裁切。
- 全库并发 4 个剩余失败均已隔离：HTML 两项在同文件串行 141/141 中通过；runner 恢复测试默认 5 秒约 5.04 秒超时，但 15 秒局部预算下 1.29 秒通过；历史根替换测试在 I 盘会因身份保护提前拒绝，在系统默认临时盘 43ms 通过。没有剩余导演页业务失败。

---

# VOX 与 AI 漫剧功能完成度发现（2026-08-18）

- 用户确认 VOX 视觉可以接受，但实际功能完成度不足；AI 漫剧在真实用户路径中不可见。
- 既有 Electron QA 能通过角色为 `tab`、名称为 `AI 漫剧` 的程序化点击进入工作台，这只能证明 DOM 路径存在，不能证明主导航可发现性和真实用户入口成立。
- 本轮完成标准改为逐控件真实行为、权威状态和重载恢复；空 `onChange`、无动作图标、模拟队列和仅保存当前快照的“版本”都必须修正或诚实改为只读。
- `scripts/qa-director-desk.py` 的 AI 漫剧路径先点击主导航 `editorial-collage`，再点击工作台内部 `AI 漫剧` tab；它没有验证用户从主导航直接发现和进入 `motion-comic`。
- `src/app/navigation.ts` 已声明 `AI 漫剧` 独立导航项，需用实际渲染截图检查该项是否被侧栏可视高度、分组或滚动行为遮蔽。
- 当前 `MotionComicPage` 只暴露系列骨架创建、已有镜头字段编辑、图片/配音生成和整片渲染；领域数据中的多剧集、场景、角色造型与一致性引用没有对应的可操作生命周期 UI。
- `DirectorDeskWorkspace` 的未实现可见控件包括：更多操作、增加集数、画幅按钮、预览设置、镜头搜索、素材搜索、素材选择、版权详情、版式模板、运动控制、画面比例和字幕安全区。
- 当前队列由 `createQueue(shots)` 临时派生，并对 running 项每 850ms 增加 9% 到 88%，这不是 `providerJobs` 权威状态；版本页只显示当前镜头并调用普通保存，没有版本清单或恢复能力。
- 功能补齐已改为由工作流文档提供项目、剧集、素材版本和 `providerJobs`；生成中的本地状态只显示不确定进度，不再伪造百分比。
- VOX 与 AI 漫剧镜头现在持久化版式、运动预设、字幕样式和 Seed 锁定；确定性 MP4 渲染会实际读取版式、运动和字幕样式，而非只改变表单显示。
- AI 漫剧领域新增追加剧集、场景和镜头的引用安全函数，新增后仍通过现有角色/场景/道具/对白/时间线严格校验。
- AI 漫剧导演台设置首次无法保存的根因不是 IPC 或数据库缺失，而是五个镜头字段误挂在严格的 `dialogueCueSchema`；将其移到 `shotSchema` 后，导演台设置能通过同一 `motionComicSaveInputSchema` 并在重载后恢复。
- 项目保存失败原先在沉浸式工作台内不可见；VOX 与 AI 漫剧现在都会把 `projectAction` 错误显示为顶部语义 `alert`，不会留下一个持续可点却没有解释的保存按钮。
- 最终 Electron 功能 QA 从主界面直接看到两条入口，完成 AI 漫剧系列设定、剧集/场景/镜头追加、搜索、一致性绑定、版式和 9:16 画幅保存，再切到 VOX、切回并重载；全部状态保留，运行时错误为 0。
- 最终人工截图复核覆盖入口 1040×720、VOX 1536×1024/1040×720、AI 漫剧 1536×1024/1040×720；集数行、镜头列表、中央预览和右侧生成区均无重叠或裁切，滚动所有权清晰。

---

# VOX 与 AI 漫剧研究发现（2026-08-17）

## Option 2 Director Desk reference findings (2026-08-18)

- The selected visual truth is `I:\opc\.artifacts\product-design-rework\director-desk.png`. It is a dense, full-window director workstation, not a conventional StoryDream shell page.
- Final VOX and AI 漫剧 captures match the selected Director Desk's major proportions and hierarchy, and the visible core controls are backed by real save, image generation, TTS, playback, render and export behavior.
- `ai.input.im` image generation is now routed through the existing managed image-lab API; generated files are attached as production asset versions and every attempt becomes a persisted provider job. The remaining product gap is downstream production, not image request wiring.
- Final design QA must compare the reference and implementation at the same `1536 x 1024` viewport, then separately protect the compact `1040 x 720` workspace.
- Reference viewport is 1536x1024. Final implementation structure is a 56px top bar, 274px left rail, 770px center workspace, 492px right inspector, and 38px status footer.
- Reference hierarchy is media-first: 16:9 preview with safe-area overlay and transport controls; a compact horizontal filmstrip; narrator/material shelf below; right inspector with `模式 / 生成 / 字幕 / 版本` tabs; queue is visible beside the material shelf.
- Functional states to preserve in code: selected shot, selected inspector tab, prompt edits, provider/model selection, aspect ratio, duration, voice, subtitle style, seed lock, estimated cost, provider connection, queue progress, failed-job retry, and save-version feedback.
- Existing `EditorialCollagePage` and `MotionComicPage` currently expose structural create/save flows; route-level IPC and storage already exist and should be extended rather than duplicated.
- Existing product captures confirm the app already has a usable dark shell and real 16:9 media-preview pattern, but the current VOX capture is a portrait placeholder canvas with no shot-level media or queue. The new page must keep the shell while replacing the center work area.
- The selected reference's large preview and filmstrip need real raster assets. Use generated cinematic stills from one consistent documentary/editorial art direction, stored outside source code and referenced by stable asset paths; UI icons stay Lucide.
- Generated asset inspection passed: `preview-city.png`, `shot-alley.png`, `shot-archive.png`, and `shot-rooftop.png` are 1280x720 raster images with consistent documentary lighting and no UI text. The preview asset intentionally reads as an editorial collage, matching VOX's source-driven visual language; the other three cover character, evidence, and establishing shots.
- Final same-canvas evidence is stored in `.artifacts/director-desk-comparison/`: full view, center/preview, final inspector, and an earlier real connected-provider inspector state.
- The final layout measures 274/770/492px columns, preview y=120, filmstrip y=526.64 with 127px height, assets y=653.64, queue y=646, and footer y=986. VOX and AI 漫剧 use the same geometry.
- Product Design QA has no actionable P0-P2 finding. Dynamic differences such as eight reference shots versus four current VOX shots and running versus waiting queue jobs remain truthful project state rather than fake rows.
- The isolated Electron QA reports zero runtime errors, horizontal overflow, grid overflow, and clipped controls at 1536x1024 and 1040x720. Compact queue reachability, stage mapping, playback/pause, safe-area toggling, and settings navigation pass.

- 2026-08-17 最终 Electron QA 首轮复核：1440x900 与 1040x720 的三栏边界、预览画布和时间线均无文档/网格横向溢出，运行时错误为 0，画面方差非零；但 1040x720 的右侧渲染策略分段控件出现内部横向滚动，第三项文本被局部裁切。等分宽度修复已使所有内部溢出归零，但先后出现 `Omni 动态海报` 孤字换行、内容比例分配后“混合模式”选中态换行；新增标签换行门禁准确拦截了后者，最终需要内容比例分配、零项间距和 10px 单行标签共同保证紧凑适配。
- 最终 1440x900 / 1040x720 Electron 报告为 `passed`：运行时错误为 0，文档、工作区网格、渲染策略容器及三个策略 Tab 的溢出均为 0，三个标签均不换行，三栏互不重叠；预览画面方差分别为 14987.61 / 16057.64，隔离 QA 进程和临时配置目录均已清理。
- 第 7 阶段数据边界：standard 的权威场景/字幕/图片/视频/配音来自 `TaskArtifactSnapshot`，HTML 的权威场景/素材/配音/composition/成片来自 `parseHtmlVideoPipelineData()` 返回的 V2 文档；适配器应是纯只读投影，不能回写 `Task.pipelineData`。
- standard 时间线可直接使用 `StoryboardScene.durationMs` 累加，字幕 cue 继续独立保存并按 `sceneId` 或开始时间映射到镜头；同一场景的多个 cue 不得增加图片或镜头数量。
- HTML 场景只有 composition 或 voice 完成后才有可信时长；优先 composition、其次 voice，均不存在时保留 0ms/pending，不能用固定 3 秒之类估算值冒充权威时间。
- 当前共享合同还缺 standard/html 的工作流文档、全局字幕 cue 与只读来源引用；应在 `production-workflow.ts` 补合同，在独立 adapter 文件实现投影，避免让已有 runner 依赖新层。
- standard/html 两个只读适配器已完成：稳定 ID 由任务 scope 与源内容签名生成；standard 的 AI 视频覆盖优先进入 clip，同时保留图片版本与 Provider job；HTML composition 字幕换算到全局毫秒，未渲染场景保留 captionTexts 且时长为 pending/0ms。
- StoryDream 已有可复用底座：`VideoProviderConfig`/能力声明、预算与并发策略、`TaskDagNode`、叙事计划、平台变体、HTML 场景计划、素材/配音/合成快照和输出模型。
- 当前普通 runner 明确拒绝 `taskType === 'html-video'`，说明“共享领域核心 + 独立执行器”符合现有架构，不应把 VOX/漫剧硬塞进普通 runner 的条件分支。
- 现有 `StoryboardScene` 包含内部 `StoryboardSegment[]`，字幕 `SubtitleCue` 用 `sceneId`/`segmentId` 映射；新流程必须保持视觉场景和字幕切分分离。
- `BigBanana-AI-Director` 当前仓库的根 `LICENSE` 是非 OSI、禁止商业使用的 BigBanana Community License 1.0，README 仍写 CC BY-NC-SA 4.0，许可元数据自相矛盾；只能借鉴产品思路，不能作为 StoryDream 商业代码来源。
- 本机没有 `gh` CLI；GitHub 项目核验改走仓库页面、raw 文件、Git 远端和已下载源码，不重复依赖缺失命令。
- 目标仓库已确认：`hassancs91/claude-faceless-shorts-creator`（MIT，133 stars，Remotion/ElevenLabs/逐词字幕/12 个示例）与 `Alisa0808/vox-director`（MIT，1329 stars，Atlas Cloud + FFmpeg 的 agent skill）；数据为 2026-08-17 GitHub API 快照。
- `vox-director` 搜索结果中存在大量同名派生项目，后续分析固定以 `Alisa0808/vox-director` 为主仓；faceless 固定以有 133 stars 的 `hassancs91` 原仓为主，不采用 0-star fork。
- `claude-faceless-shorts-creator` 实际包含三条轨：TSX/Remotion、生成式角色视频、VOX 拼贴；共享骨架是 beats 合同、ElevenLabs 逐词时间戳字幕、SFX/音乐库、手机尺寸逐帧 QA 与无缝循环。其 VOX 轨强调分层素材、抠图/HTML/SVG、`CollageBoard` 确定性运镜。
- `vox-director` 实际支持 B-roll 纯生成、A-roll 真人口播编辑、C-roll 静态人物/产品锚定；核心流程是 beats → 3–4 风格试片 → 拼贴关键帧 → Omni/Kling 动效 → TTS/音乐 → FFmpeg，并有分镜确认、选风格两个检查点。
- 两仓虽然 star 增长快，但都创建于 2026-07，属于新项目而非多年成熟框架：faceless 302 个树节点、12 个完整示例，主分支最后代码推送 2026-07-15；vox-director 52 个树节点、脚本化 skill，最后推送 2026-08-11。推荐其“方法与合同”，不能把 star 数等同于工程成熟度。
- Faceless 仓的 README 说明生成式视频像素不可复现且需提交素材；这支持 StoryDream 把 `AssetVersion + ProviderJob + provenance/cost` 设为一等对象，而不是只保存最终 MP4。
- Faceless 的 VOX 方法要求每个场景先“解剖”为 2–6 个可命名图层，再用全局相机关键帧、局部图层入场、视差深度和持续微动组装；文字/图表用 HTML、箭头/路线用代码矢量，AI 图禁止直接生成文字。这一层非常适合移植到 StoryDream 现有 HTML/Canvas 渲染器。
- Faceless 的质量门禁可直接产品化：关键入场帧、相机到达帧、转场帧、末帧按手机尺度导出 PNG，检查裁切、对比度、抠图边缘、时间同步和首尾循环；语音先取得真实逐词时间戳，再重排字幕与画面。
- Faceless 的生成式轨有三条可靠规则：角色参考只建立一次并锁定、生成前展示本次成本、结尾用首帧作为 end-frame 约束；这些规则同样适用于 AI 漫剧的角色一致性和付费重跑。
- `vox-director` 的示例 `beats.json` 目前把绝对本机路径、供应商 URL、叙事 beat、shot 和成品素材混在一个文件中；StoryDream 不应照搬该 JSON，应拆成稳定领域对象、素材版本和 Provider Job。
- `vox-director` 的可用导演知识包括 14 类叙事弧、≤3 秒钩子、30 秒 6–8 beats、每 3–5 秒视觉变化、受限运镜词表、相邻镜头防重复与 `camera_move`/`element_motion` 两轴分离；这些应做成规则引擎/预设，不应继续藏在 agent 长提示词里。
- `vox-director` 虽有 Provider 抽象，但当前 registry 只有 Atlas Cloud；它的自动重提会把 failed/stalled job 无条件重新提交至上限。StoryDream 应复用现有 Provider/DAG，同时加入幂等键、预算检查、用户许可和单镜头重跑，避免静默重复付费。
- 元素级本地引擎已验证的难点不是渲染，而是拆件和归位；其有效技巧是元素回到原海报 bbox、背景保留原海报、落点区域用局部模糊避免“幽灵副本”。首版应支持 4–6 个预定义图层槽位，不做任意自动分层。
- Remotion 当前不是 MIT：npm `remotion@4.0.512` 标为 `SEE LICENSE IN LICENSE.md`，官方仓库只对个人、非营利或 ≤3 人营利组织免费，更大营利组织需 Company License，且 5.0 许可将变化。StoryDream 应移植其时间轴/图层模式到现有 HTML 渲染器；只有完成主体资格/采购确认后才直接依赖 Remotion。
- AI 漫剧平台层候选的 2026-08-17 快照：`alibaba/lumenx` 1085 stars/MIT，`xuanyustudio/LocalMiniDrama` 1314 stars/MIT，二者都自 2026-02 起持续更新；它们比单一模型仓更适合作为 StoryDream 的产品/数据架构参考。
- `eternityspring/shuohao-skills` 1597 stars/Apache-2.0，但创建于 2026-08-06，成熟度来自严格的角色/大纲/美术/剧本/分镜门禁，而非长期运行历史；适合借鉴生产规范，不适合作为运行时底座。
- `StoryDiffusion` 6446 stars/Apache-2.0，代码最后推送停在 2024-09；可作为角色一致性研究组件，但不能承担完整生产编排。`LatentSync` 5999 stars/Apache-2.0 可作可选口型组件，仍需独立核验模型权重/人物授权和云端 Provider 可用性。
- `LivePortrait` 当前 GitHub 规范仓为 `KlingAIResearch/LivePortrait`（旧 `KwaiVGI` 链接重定向），18.9k stars、仍更新，但 GitHub API 许可证为 NOASSERTION；在读取其具体许可证与模型条款前不进入商业默认清单。
- LumenX 的源码而非 README 证明其可借鉴性：有角色工作台、Consistency Vault、共享资产池、上一集帧引用、I2V/R2V 分镜、候选版本对比、任务队列、视频恢复测试、模型 Catalog、时间线与导出模块。其核心价值是“系列资产和任务可恢复”，不是某个模型名称。
- LumenX 仍是 Python/FastAPI + React/Tauri 的完整独立应用，不能直接嵌入 StoryDream；应抽取对象关系和交互合同，避免把第二套后端/前端框架带进 Electron。
- Shuohao 把角色、大纲、美术设定、剧本、分镜拆成边界清楚的五段技能，每段都有 JSON schema、`validate/checkup`、示例夹具和断点续跑；坏角色卡只重跑该角色，爽点/重大节点不通过就阻断下一阶段。这一“确定性门禁 + 局部返工”比其提示词内容更值得复用。
- 漫剧前期不应让一个大模型一次吐出整季：应先 `Series Bible/Character Bible → Season Outline → Episode Script → Shot Board`，每步持久化、校验并等待所需审批，再进入付费图像/视频生成。
- LumenX 的资产模型值得直接借鉴语义：图片/动态参考各自有候选版本和 `selected_id`，收藏版本不被自动清理；视频任务持久化 provider/task/request ID、I2V/R2V 模式、参考 URL、用户星标和短标签，最终 take 到合成阶段再决定。
- LumenX 用 `persona` 把同一人物的不同年龄/造型视觉单元分组，这比单一 `CharacterCard` 更适合连载漫剧；StoryDream 应采用 `Character → Look/Costume Variant → Reference Asset`，而非每角色只有一张图。
- `LocalMiniDrama` 与 StoryDream 技术栈最接近：Electron + Vue/Node + SQLite，本地项目文件，列表/画布同源数据，项目 ZIP 导入导出、全局素材库、历史版本、尾帧衔接、视频任务恢复、分组重跑和 Windows Release 均已存在；优先借鉴其操作闭环。
- LocalMiniDrama 代码同时暴露维护风险：`FilmCreate.vue` 超过 400 KB、`videoClient.js` 超过 160 KB，属于功能成熟但边界偏重的单体实现。StoryDream 应复用其交互思想，不复制其巨型页面/多供应商条件分支。
- LivePortrait 代码是 MIT，但根许可证明确说明所带 InsightFace 检测模型仅限非商业研究；商业产品必须替换该检测模型。因此只能作为“可选头像运动 Provider”的技术参考，不能原样打包。
- HunyuanVideo-Avatar 使用腾讯社区许可证，不适用于欧盟、英国和韩国，并有 1 亿 MAU 商业条款及用途限制；不适合作为 StoryDream 的默认跨区域底座。
- Wan2.2 的代码/模型为 Apache-2.0，且包含 I2V、S2V、人物动画/替换；但 14B 路线通常要求约 80 GB VRAM，5B TI2V 仍需约 24 GB。应通过云端 Provider 暴露能力，不在 StoryDream 桌面包中捆绑。
- LTX-Video、FramePack、Wan2.2 都是 10k+ stars/Apache-2.0 的通用视频引擎；它们适合作为后端候选，不应改变上层 `i2v/r2v/first-last-frame/speech-to-video/portrait-motion/lip-sync` 能力合同。
- StoryDiffusion 低显存版仍建议 >20 GB GPU，LatentSync 推理/训练也有显著 GPU 需求；StoryDream 当前云 API 路线下，最稳妥的是 Provider 可插拔并保存模型/版本/许可，而不是本地安装模型。
- 最终架构决定：新增共享 `ProductionProject` 层，保留四个独立 `WorkflowSpec`/执行器（standard、html-video、editorial-collage、motion-comic）；不继续给现有巨大 `Task` 接口堆大量可选字段，也不把四条流水线合成条件分支 runner。
- 共享核心对象固定为 `Project/Series/Episode`、`Source/Script/Bible`、`Beat/Segment/Shot/SubtitleCue`、`Asset/AssetVersion`、`ProviderJob`、`TimelineClip`、`QualityReport/Export`。工作流差异放在 discriminated `workflowSpec`，共享对象使用稳定 ID 关联。
- 时间层级建议：漫剧为 `Episode → DramaticScene → Segment(≤15s) → Shot(通常 2–5s) → SubtitleCue`；VOX 为 `Episode/Short → NarrativeBeat → Shot → Layer`。现有 `StoryboardScene` 继续表示产图视觉场景，内部 segment/cue 不改变图片数量。
- VOX 首版只做 B-roll 30 秒 9:16 垂直切片：选题/资料 → 叙事弧与 6–8 beats → 风格试片 → 每镜 2–6 图层 → 逐层生图/抠图 → 确定性相机/入场 → 可选 Omni 活海报 → TTS/字幕/音效 → 帧 QA/导出。A-roll/C-roll 在数据合同稳定后再加。
- VOX 每镜用 `renderStrategy: deterministic-layers | living-poster | hybrid`：文字、数字、图表、地图标注、路线和品牌元素默认确定性渲染；Omni 只动背景/人物/纹理等有机元素，生成后再叠加真实文字。不能把整张含关键文字的海报完全交给视频模型。
- VOX 三个强制门：分镜确认、风格试片确认、付费批量生成前的成本确认；其余可按现有四档自动化策略运行。失败重试必须经过预算和幂等检查，支持按 shot/layer 局部重跑。
- AI 漫剧独立主线从 `Series Bible → Character/Look/Costume/Scene/Prop Bible → Season Outline → Episode Script → Shot Board → Keyframes → I2V/R2V/S2V → Dialogue/TTS → optional lip-sync → Timeline` 展开；每一阶段有 JSON schema、质量门和版本快照。
- 漫剧首版应做 1 集 45–60 秒垂直切片：2–3 个角色、2 个主场景、8–12 镜头；角色参考、造型、场景和道具是 series 级共享资产，镜头只引用被选中的版本。避免第一期就做整季、自动口型和复杂多人同镜。
- 与现有两流程结合的方式是适配器而非迁移：standard 的 `StoryboardScene/Image/Video/Subtitle` 投影到共享 shot/timeline；HTML 的 `HtmlVideoScenePlan/Asset/CompositionSnapshot` 投影到 layer/timeline。之后可从任一任务“创建 VOX/漫剧变体”，原任务保持可读可回退。
- 交付顺序：0 共享 ID/合同和旧数据适配器；1 VOX 独立垂直切片；2 抽出资产版本/Provider Job/时间线公共服务；3 AI 漫剧单集垂直切片；4 标准/HTML 变体互转与同源列表/画布；5 A-roll/C-roll、口型、批量整季。
- 验收重点：稳定 ID 和旧任务兼容；断点恢复；单镜/单层重跑不污染已选资产；费用预估/实际费用可追溯；人物/造型/场景连续；字幕与语音真实时间对齐；关键帧截图无裁切/遮挡/乱码；成片时长、画幅、音轨和首尾连续性合格。
- 实施已新增共享 `ProductionWorkflowKind`、资产版本、Provider Job、时间线、质量报告和 motion-comic 角色造型/镜头引用合同；VOX 文档独立使用 `editorial-collage` discriminant，不扩张旧 `Task` 接口。
- VOX 合同已经编码分镜/风格/成本三类门禁：首 beat ≤3 秒、单 shot ≤15 秒、单 shot ≤6 图层、shot 时长合计等于 beat、关键帧有序且不越界、多字幕 cue 可属于同一视觉 beat、付费生成必须有成本批准时间。

---

# 选品助手最终验收发现（2026-08-17）

- 首轮 Labs Electron QA 的 4 张选品截图都在当当请求尚未返回时拍摄，画面显示“正在连接当当”和“暂无匹配图书”；报告中的交互仅为聚焦“选品助手”导航，因此不能证明核心选品流程。
- 当前页面初次加载直接调用 `discoverBooks()`，但没有把这段请求纳入 `discoveryAction.busy`，导致请求期间错误展示空态；这是需要修复的产品状态问题，不只是 QA 等待问题。
- 最终验收必须在榜单至少出现 1 行后执行：用首行书名验证列表搜索、收藏首行并确认状态持久化、点击“去创作”并确认新建任务处于 AI 模式且带入书名/关键词/商品资料，再返回选品页拍摄普通与紧凑窗口。
- 20/20 Labs QA 通过后的同屏检查确认 24 条均来自当当实时公开搜索；同时发现当当 `<b>` 搜索高亮被标签清洗成标题断词，以及 1440px 含侧栏时操作列进入横向滚动区，均按 P2 在最终截图前修复。
- 最终同屏复核通过：标题高亮合并正确，1500px 以下保留书名、分类、卖点、潜力与操作列；普通/紧凑窗口的收藏、对比和“去创作”都无需横向滚动。
- `design-qa.md` 已记录全屏与表格聚焦对照、三轮修复历史、五项必查视觉面和 20/20 Electron 交互证据，最终结果为 `passed`。

---

# 左侧固定目录恢复发现（2026-08-17）

- 用户截图显示“更多工具”打开后出现覆盖主内容区的深色遮罩，菜单内容贴在左侧但超出原导航区域，造成接近全屏黑屏的观感。
- 现有计划明确记录了上一轮将 16/17 个常驻入口收敛为 6 个主入口，并新增 8 项“更多工具”菜单；用户本轮要求撤销该收敛交互，恢复之前的固定排列。
- 修复应落在共享 `AppShell` 导航层，保留 route ID 和业务页面，不在各功能页另建入口。
- `AppShell.tsx` 当前在 `.sidebar-bottom` 中通过 `Menu` 和 `data-contextual-tools-trigger` 渲染 8 个工具；菜单项仍使用原有 `view`、图标、标签和提示，可直接复用为固定 `NavButton`。
- `product-shell-ui.test.ts`、`renderer-architecture.test.ts` 与 `route-registry.test.ts` 把“6 个主入口 + 上下文工具菜单”锁成合同，需要一起恢复为完整固定目录合同。
- 截图中的弹层从左侧导航内部起始，却用深色层覆盖整个主内容区；即使修复尺寸，仍不符合用户要求的高频固定入口，因此应删除菜单交互而非只改遮罩 CSS。
- Git 历史确认 `410301b` 才引入 `Menu` 与 `contextualToolNavItems` 分流；其父版本的稳定顺序是三组 `6/5/5`，共 16 个固定侧栏入口。
- 恢复时沿用当前“自动化队列 / 素材库 / 模板”等最新命名，但把路由放回旧分组位置；这样保留最新产品语义并满足用户要求的原排列。
- 账户与激活保留旧版固定目录入口，也继续保留侧栏底部的积分、试用和账户快捷操作；两者用途不同，且符合用户要求的历史布局。
- 固定目录实现后的 6 个聚焦测试文件共 232 项全部通过；TypeScript 检查和生产构建通过，renderer 入口为 385322 bytes。
- 首轮紧凑截图中 16 个固定导航图标全部可见，但底部重复快捷区贴近视口下缘；紧凑模式隐藏该重复区，历史、账户和激活仍由固定目录直接访问，桌面模式保持原快捷区。
- 最终 Electron shell 深浅主题 × 普通/紧凑窗口 4 场景，以及 HTML 视频普通/紧凑 2 场景全部通过；实拍无黑屏、菜单遮罩、横向越界或侧栏截断，HTML 视频入口可直接点击并正确高亮。
- 开发服务已在 `http://127.0.0.1:5173/` 返回 HTTP 200，Electron 进程使用当前源码运行。
- 收尾时发现工作区并行出现选品发现/IPC 相关修改；这些文件未被本轮回退，定向测试确认剩余 3 项失败来自该未完成功能线，不属于导航恢复。

---

# 云端 AI 视频、持久化 DAG 与项目变体落地发现（2026-08-17）

- 用户明确不做本地 AI 模型部署，因此上一轮 ComfyUI/Wan 本地 sidecar 只保留架构参考，当前实现必须以可配置云端 API 为唯一 AI 视频执行路径。
- HyperFrames 已经进入现有 HTML 场景源码、Player、时间线和 lint 工作流；优先扩展统一开场 composition 比再引入 Remotion 更符合单一渲染源和可恢复 checkpoint 原则。
- Remotion 当前特殊许可证会对部分营利组织产生 Company License 要求，且 React composition 与现有 HTML/HyperFrames 都会成为画面权威源；首版不引入依赖，只保留未来 RenderProvider 适配可能。
- 视觉验收重点收口为三处：6 个主导航入口、设置页“AI 视频”云端 Provider/调度表单、新建任务四档自动化与五个平台变体；任务详情叙事规划/平台变体由产物夹具和组件合同补充验证。
- 新增页面沿用 `SettingsCard`、`Segmented`、`ToggleField` 和既有任务产物区，没有新增组件库；普通与紧凑桌面重点检查长表单滚动、分段控件文字和五个平台开关换行。
- 生产构建通过，renderer 入口 385271 bytes；仅出现仓库既有 Vite Node 模块浏览器外置提示。
- 隔离 Electron 实拍表明 AI 视频设置在 1440×900 与 1080×720 下均无横向溢出、控件裁切或按钮文字溢出；自动化预算区可滚动到达，四档模式切换正常。
- 新建任务实拍识别到 6 个主导航、4 档自动化、5 个平台和 3 个版本，小红书开关可实际切换；紧凑窗口下平台开关自然换行且不重叠。
- 任务详情旧 QA 暴露未配置 Provider 时仍可点击真实 API 操作；正确合同应为配置未就绪时禁用并指向系统设置，配置就绪后才调用 `task:replace-video` 的 AI 来源。
- HTML 视频/系统分区 QA 进一步证明，仅保留上下文 route ID 但不提供可见入口会让低频工具实际不可达；最终采用“6 个主导航 + 8 项更多工具菜单 + 独立账户/激活快捷入口”，不恢复 16 项长侧栏。
- 紧凑 HTML 视频工作台会在浅色应用主题内使用深色媒体画布，Fluent 内部内容节点不能只依赖父级继承；按钮与场景标签需要在工作台范围内显式使用 `--shell-accent-contrast`、`--shell-muted` 和 `--shell-text`。
- 最终 Electron QA 已覆盖 HTML 视频普通/紧凑窗口、任务操作和系统工具入口；所有对比度、交互遮挡、控件裁切、横向溢出、运行时与媒体证据检查均通过。

---

# 自动化视频产品与开源能力审计发现（2026-08-17）

- 本轮按“现有生产工具的广域审计”处理：先读取实际路由、页面、任务模型与运行器，再用 GitHub 项目补足缺失能力，不从通用 AI 视频产品模板倒推界面。
- 目标用户的核心循环应是“确定选题 -> 建立证据 -> 规划叙事 -> 生成素材 -> 编排预览 -> 局部修订 -> 质量验收 -> 发布复盘”，每一步都需要明确产物和可恢复状态。
- 当前全局导航有 17 个路由，普通任务、HTML 动画、音乐 MV、爆款拆解、图片/配音实验室各自拥有入口；能力丰富，但“项目”不是统一的一等对象，用户要在多个独立页面间手工搬运上下文。
- 普通任务已具备 7 阶段流水线：预审、三轮改写、分镜、角色/提示词、批量生图、配音字幕、剪映草稿；支持步骤重跑、单镜重绘、参考图编辑、本地/素材库视频替换和字幕断句。
- HTML 视频已具备 6 阶段可校验流水线：改写、规划、素材、配音、动画预览、出片；有文件摘要校验、原子 checkpoint、场景模板、前景元素、镜头/转场、字幕布局、封面和本地渲染。
- 普通任务最终产物以剪映草稿为主，HTML 任务可直接渲染视频；两者的场景、素材、字幕和修改能力没有共享统一时间线/项目合同，这是后续丰富能力时最大的架构重复风险。
- 现有真实页面的步骤状态与场景选择清晰，HTML 预览也已形成“任务/步骤 + 画布 + 检查器 + 场景条”工作台；但创建页仍是长表单，实验能力散落在侧栏，成片质量没有统一的验收中心。
- `TaskArtifactPreview` 已预留“AI 生成视频”，但当前明确显示服务尚未配置；现有视频能力主要是导入本地视频或从素材库随机匹配，而不是按镜头自动生成动态素材。
- 视觉实拍表明任务详情与 HTML 视频使用不同的产物编辑模型：普通任务以结果页签和画廊为中心，HTML 视频以场景画布与检查器为中心；长期应收敛到同一个项目工作台，而不是继续复制两套编辑器。
- UI 数据库对当前产品的有效匹配是“Desktop Production / Authoring Tool”：稳定三栏、上下文检查器、中性表面、语义状态色和单一品牌强调；短视频编辑器结果中的玻璃化/营销式动效与 StoryDream 现有工作流冲突，不采用。
- UI 数据库没有提供有价值的长任务审批/重试模式，仅返回通用长文本规则；该部分应以仓库真实 checkpoint、步骤状态、重跑语义和用户恢复路径为权威证据。
- 普通任务已有 `full-auto / semi-auto / clip-only` 和关键/逐步暂停，技术上具备人机协同基础；但门禁仍是粗粒度“步骤暂停”，缺少可配置的质量规则、差异对比、批量通过/驳回和审批后只重跑受影响下游的产品模型。
- 剪映草稿合同已包含逐镜时长、视频入点、字幕 cue、BGM 音量/淡入淡出、转场、滤镜、视频/音频效果；这说明升级重点不是重写草稿导出，而是在其上增加可视时间线、节拍/响度分析和可预览的混音决策。
- 现有诊断主要验证素材文件、场景覆盖和字幕轨等结构正确性；尚未形成对黑帧、静音、响度、字幕遮挡、重复画面、人物一致性、事实引用和节奏密度的成片级质量门禁。
- 代码中没有可用的视频生成 provider；场景画廊的“AI 生成视频”是明确占位。动态内容目前依赖本地导入/素材库匹配或 HTML 动画，因此 AI image-to-video 是确定的能力空洞。
- 未发现面向抖音、视频号、B 站等平台的直接发布、标题/封面/比例变体打包或发布后指标回流；当前 `publishMode` 指文案是否改写，并非发布工作流。
- GitHub 匿名 REST API 已触发共享出口限流，普通 443 连接也间歇失败；后续改用仓库 raw README/许可证镜像和 `git ls-remote` 核验，不重复请求同一失败接口。
- 已通过 `git ls-remote` 确认 FFmpeg、OpenTimelineIO、OpenCut 和 Remotion 默认分支及 HEAD 可达；其余仓库的 README/许可证通过 raw 镜像交叉核验。
- FFmpeg 主体为 LGPL-2.1+，启用部分可选组件后会转为 GPL-2+；适合作为独立进程的最终合成、探测和结构质检底座，但打包时必须固定构建配置并生成第三方许可证清单。
- OpenTimelineIO 为 Apache-2.0，适合做时间线交换和适配边界，但它不是播放器或渲染器；StoryDream 更适合先维护 TypeScript/Zod 的内部 Timeline Manifest，再通过 sidecar 映射 OTIO、剪映和 FFmpeg。
- OpenCut 当前许可证为 MIT，可借鉴浏览器式多轨时间线、轨道选择和非破坏编辑交互；它是完整编辑器产品，不应整仓嵌入 StoryDream 或替换现有 React/Fluent UI 壳。
- Remotion 当前使用分层商业许可证：个人、非营利及不超过 3 人的营利组织可免费，更大营利组织需要 Company License；当前 HTML 渲染器已有稳定资产和 checkpoint，Remotion 只适合作为确定性帧渲染的设计参考或未来明确购证后的可选 RenderProvider。
- ComfyUI 为 GPL-3.0，README 明确提供本地 API、异步队列、部分图重算、工作流 JSON、seed/工作流可恢复以及 Windows 运行支持；最合理的集成是独立本地/远端服务适配器，StoryDream 保存 workflow hash 与参数，不把其 Python 依赖塞进 Electron renderer。
- Wan2.1 与 LTX-Video 仓库代码许可证均核验为 Apache-2.0，但模型权重仍需逐个版本检查模型卡；LTX-Video README 已明确 LTX-2 是后续主开发仓库，因此产品层不能硬编码旧模型名称，应按能力声明选择具体工作流。
- faster-whisper 为 MIT，WhisperX 为 BSD-2-Clause，适合分别承担高效转写和可选词级对齐；Silero VAD 为 MIT，可用于停顿、静音和配音切分检测。
- PySceneDetect 为 BSD-3-Clause，适合做镜头边界、节奏密度和素材切段；VMAF 为 BSD-2-Clause-Patent，只适合有参考源的编码质量回归，不能当成生成视频美观度评分器。
- Demucs 为 MIT 但上游仓库已进入维护风险区，适合可选离线人声/伴奏分离，不宜作为成片主链路硬依赖；MLT 为 LGPL-2.1，但当前再引入完整 MLT 渲染栈会与 FFmpeg、HTML、剪映形成第四套执行模型，第一阶段不采用。
- Wan2.2 README 明确提供 T2V、I2V、TI2V、Speech-to-Video 和人物动画，已进入 ComfyUI/Diffusers；其中 TI2V-5B 支持 720p/24fps，并宣称可在 4090 级消费显卡运行，适合作为首个本地视频 Provider 的验收工作流。14B 路径单卡示例仍要求约 80GB VRAM，不能把“本地支持”误写成所有用户机器都能直接运行。
- LTX-2 当前 README 已以 LTX-2.5 为推荐模型，提供快速、两阶段高质量、关键帧插值、音频驱动、局部 Retake、视频变换和同步音视频管线；这些能力非常适合 StoryDream 的“单镜局部修改”产品目标。
- LTX-2 自 2026-08-11 起使用自定义 Community License，年营收达到 1000 万美元的实体进行商业使用需要付费许可，并有再分发及用途限制；因此只能作为显式带许可证元数据的可选 Provider，不能默认随桌面安装包捆绑。
- OpenCLIP 代码为 MIT，适合给本地图片/视频关键帧建立文本-视觉向量，用于按分镜语义检索素材、检测画面与旁白不匹配以及减少重复镜头；主分支训练栈当前变动较大，产品应固定稳定 3.x 推理版本，并逐个核验预训练权重许可证。
- CosyVoice 代码为 Apache-2.0，当前 README 提供中文、方言、多语零样本音色、情绪/速度/音量控制以及 FastAPI server/client；可作为本地中文 TTS 可选 sidecar，继续与现有豆包/火山、MiniMax Provider 并存，而不是替换云端能力。
- 开源依赖最终分三类：直接底座（FFmpeg、内部 Timeline Manifest、faster-whisper/Silero）、独立服务 Provider（ComfyUI、CosyVoice、可选 WhisperX/OpenCLIP）、只借鉴或可选（OTIO、OpenCut、Remotion、VMAF、PySceneDetect、MLT、Demucs）。
- 目标领域模型应收敛为 `Project -> Version -> Scene -> Timeline -> Asset/Job -> QualityReport -> ExportPackage`；现有 `Task` 先作为 Version 的兼容投影，普通任务和 HTML 数据通过 adapter 渐进迁移，不一次性改写所有持久化数据。
- 统一 `Scene` 至少包含叙事目的、事实/来源引用、旁白、屏幕文字、视觉类型、视觉指令、时长、角色/风格约束和回退策略；这比只保存 `cap/descPrompt/durationMs` 更能保证内容完整和局部重做。
- 内部 `TimelineManifest v1` 应提供视频、覆盖层、标题/字幕、配音、BGM/SFX 多轨 clip，记录入点、时长、层级、效果和来源资产；分别映射现有剪映草稿、HTML composition 和 FFmpeg render plan。
- 持久化 Job DAG 的每个节点记录输入 hash、输出 artifact hash、Provider/模型/版本、prompt、seed、尝试次数、耗时、费用和许可证元数据。修改场景 8 只失效该场景的配音/画面及下游时间线、渲染、质检，不得重跑其他场景。
- 新建任务应从长表单改为四步渐进流程：目标/平台/时长、来源与证据、视觉与声音、自动化/预算/质量策略；创建前显示预计字数、镜头数、耗时、费用和本地显存要求。
- 统一项目工作台采用三栏加底部时间线：左栏场景/资产/任务图，中间预览与 A/B 对比，右栏内容/画面/声音/动效/来源检查器，底部多轨时间线；选择状态由稳定 scene/clip ID 同步四个区域。
- 图片、配音、爆款拆解和 HTML 动画不再长期占据平级生产入口：保留现有 route 兼容，但从项目场景的“替换/生成/分析”动作进入；队列与历史合并为项目中心的运行中/已完成筛选。
- “内容充足”由时长预算、证据覆盖矩阵和镜头职责保证：先生成钩子/论点/证据/反差/结论的节拍表，再生成文案和场景；每个事实性镜头必须有来源，每个场景必须有视觉职责和素材回退。
- “美观”不等于全部使用 AI 视频。默认混合来源截图、授权 B-roll、信息图、AI 图片、AI 视频、HTML 动效和动态排版，并用项目级 style bible 固定色板、字体、人物、镜头语法、动效强度和转场密度。
- 视频 Provider 需要能力声明而非模型名判断：T2V/I2V、首尾帧、参考图/视频、局部重做、音视频同步、最大时长/分辨率、显存、费用、许可证和健康度；调度器按项目策略选本地、云端或安全回退。
- 自动化提供四档策略：全自动、里程碑审批、逐场景审批和手动；另设预算上限、并发数、重试次数、最低质量、允许的 Provider 与失败回退。暂停/继续之外，还需批量通过/驳回和修改前后差异。
- 质量中心区分硬门禁与软评分。硬门禁覆盖缺失/损坏文件、黑帧/冻结、旁白静音、响度、字幕越界、轨道空洞/重叠、时长不一致和许可缺失；软评分覆盖事实来源、画面-旁白匹配、重复镜头、人物一致性、节奏和视觉审美，允许人工覆盖并记录理由。
- 90 天按三阶段推进：第 1-4 周统一 manifest、adapter、DAG 和工作台骨架；第 5-8 周接 ComfyUI/Wan2.2、语义素材、语音对齐和局部重做；第 9-12 周完成质量中心、平台变体、导出包、批量审批和故障恢复验收。
- P0 验收包括进程被杀后任务可恢复、单场景编辑不重做无关资产、三类现有任务可映射到统一工作台；P1 验收包括本地/云端视频 Provider 可替换、自动回退可见、结构质检对合成坏样本全命中；P2 验收包括一项目派生多平台比例/封面/标题/SRT 包且保持来源和资产谱系。
- 明确不做：不新增平行视频页面；不整仓嵌入 OpenCut/ComfyUI；不在第一阶段引入 MLT 或替换现有 HTML/剪映输出；不将 VMAF 当审美分；不把单个模型写死在业务表结构；不在质量门禁和发布包稳定前做无人值守自动发布。

---

# 小红书目标笔记读取发现（2026-08-14）

- 当前 `extractStructuredPageContent()` 会递归扫描整份 hydration state，并把所有 `desc/content/imageList` 加入候选；小红书详情页同时包含推荐流，因此更长的推荐笔记可能胜出，推荐图片也会被统一收集。
- `fetchArticleSnapshot()` 还会合并 Open Graph 与语义 HTML 图片；即使目标 note 不在公开状态中，页面通用封面和页尾推荐图仍可能让结果被误判为可读图文正文。
- 正文 Electron 缓存已支持 30 分钟复用与 `forceRefresh` 绕过；问题不在缓存模型，而在小红书解析缺少按 URL 笔记 ID 的排他边界。
- 用户截图中的小红书条目来自 UAPI 热榜，详情链接可能是笔记页，也可能是搜索/聚合页；后者必须降级为热榜摘要与联网搜索，不能扫描整页推荐内容。
- 正文弹窗目前只在读取报错时显示“重试读取”，导致已缓存的错误推荐内容没有直接刷新入口；应始终显示“重新读取”。
- 专用解析以 URL 中的 `/explore/:id` 或 `/discovery/item/:id` 为边界，先查 `noteDetailMap[id]`，再仅允许 `noteId/id` 精确相等的对象作为兼容回退；因此不会依赖推荐项长度或遍历顺序。
- 小红书分支在进入 JSON-LD、Open Graph、语义 HTML 合并之前返回，目标缺失和非详情页两种情况都能彻底阻止通用图片回退。
- 2026-08-14 实时请求 UAPI 小红书热榜确认 20/20 条均为 `search_result?keyword=...&type=51`，表示热点搜索词而非单篇笔记；不能为这些条目伪造“目标正文”。
- 实测第一条搜索页 HTTP 200、约 855 KB，公开 `window.__INITIAL_STATE__` 中 `note.noteDetailMap` 为空；搜索结果由后续客户端接口加载。该接口涉及平台会话/签名边界，本轮不逆向或绕过，继续使用热榜摘要与公开联网搜索兜底。

---

# 热榜正文弹窗设计发现（2026-08-12）

- 用户截图中每条热点被“来源摘要 / 尚未读取页面内容 / 查看正文”额外撑高，破坏了热榜按标题快速扫读的核心任务。
- 现有 `readItemContent` 把正文读取 warning 写入页面级 `openError`，即使已有摘要降级也会在列表上方显示全局警告；正文状态应归所选条目的弹窗所有。
- 当前列表已拥有稳定操作列，最合适的结构是保留原文图标、“正文”和“去创作”，标题区域使用单行省略并通过正文弹窗提供完整阅读路径。
- 项目已有受控 `Dialog` 和 `Button`，Fluent Dialog 可处理焦点锁定、Escape 关闭与焦点恢复；无需新增原生对话框或弹窗基础设施。
- 正文读取目前只有进程内 30 分钟缓存，浏览器预览直接退回条目摘要；本轮先保证页面正文、摘要降级、不可用和异常都在弹窗中被准确区分。
- 本轮实现后，列表行只保留排名、来源/标题、热度、时间和操作；“正文”打开受控 Dialog，正文区内部滚动，单条读取异常不再占用热榜全局告警区域。
- 读取 API 新增可选 `forceRefresh`，仅“重试读取”绕过 30 分钟进程缓存；普通打开仍复用缓存，符合按需读取和稳定展示预期。
- 提取器先读取 JSON-LD `articleBody`，再对整页及语义内容容器的有效段落量评分，保留段落分隔，避免泛 `.content` 壳覆盖真实正文。

---

# 对标账号同步故障发现（2026-08-12）

- 截图底部明确显示 `0/1 个账号同步成功` 与 `1 个受限或失败`，不是单纯的列表刷新遗漏；当前唯一账号同步报告进入了非 `ready` 状态。
- 既有实现记录确认 B 站空间归档接口曾返回业务码 `-352`，补匿名 `buvid` 后仍可能收到 HTTP 412；当前连接器在 API 失败后回退抓主页，主页没有可解析作品时会合并为 `limited`。
- Electron 登录窗口与同步请求使用相同持久化 session 分区，Cookie 理论上会共享；但界面只把 `errorMessage` 放进账号状态文字的 hover `title`，底部仅显示失败数量，恢复原因不可见。
- 本机 `data.db` 中唯一对标组账号为 B 站空间 `441897078`，持久化状态是 `limited`、`lastSyncedAt: null`，真实错误为 `B站账号作品接口返回 -352。 B站主页已打开，但页面没有公开可解析的作品列表。`
- B 站独立持久化 session 目录已存在；Cookie 数据库正被运行中的 Electron 锁定，本轮遵守只读诊断边界，没有停止应用或读取 Cookie 值。
- 连接器使用带 `StoryDream/1.0` 标识的简化 User-Agent，且请求没有显式 `credentials: 'include'`；这会降低已登录会话在 B 站风控接口上的可靠性。
- `-352` 被归类为 `limited`，而页面只为 `requires-login` 显示登录按钮，因此当前失败状态没有可见恢复入口；这是连接器状态分类与 UI 行为不一致的确定缺陷。
- 已按“爆款拆解”对齐登录闭环：对标登录窗口关闭时从同一持久化 Electron session 导出白名单域名 Cookie 到 `benchmark-cookies/{platform}-cookies.txt`，IPC 只返回文件路径和数量，不返回 Cookie 值。
- 对标连接器请求现在显式使用 `credentials: 'include'`，并使用标准 Chromium User-Agent；登录/验证按钮覆盖 `requires-login`、`limited`、`error` 三种可恢复状态，关闭窗口后自动重试同步。
- 账号卡片直接显示失败摘要，不再只依赖 hover；聚焦回归新增会话凭据断言。

---

# HTML 动画预览清爽化发现

## 2026-08-11 完整预览回归续接

- 保留失败现场重跑 `STORYDREAM_QA_EFFECTS_ONLY` 后，主任务 `html-scenes/scene-001.html` 明确包含 `<img class="clip scene-foreground">`，对应前景 PNG 与 pipeline 资产也存在。
- IPC handler 只按 `pipeline.compositions[].htmlPath` 读取该文件，`prepareCompositionSrcDoc()` 只移除 HyperFrames 外链运行时并改写媒体 URL，不会主动删除前景节点。
- iframe 已就绪、字幕和场景模板均正确；旧诊断只暴露 `previewForegroundVisible: false`，保留现场进一步证明 `.scene-foreground` 节点实际存在但尚未进入可见时段。
- 保留现场进一步确认节点没有被删除：`center-focus` 的前景入场由动效合同规定从 `0.4s` 开始，而 QA 在不可见时反复固定 seek 到 `0.25s`，一直采在前景入场前；应改为场景 60% 的稳定帧并继续严格验证可见性与画布边界。
- 动效选择自动化用原生 setter 同步改两个受控 `<select>` 后，DOM 值会变化，但合成 `change` 没有进入 React 19 的受控状态处理器；即使等待两个绘制帧，保留现场数据库仍为 `auto / fade`。QA 应复用既有 `__reactProps$` 处理器路径并显式断言 React props。
- 精确诊断确认保存按钮已触发、React props 为 `pan_left / wipeleft`、真实前景在 `0.6s` 可见；失败来自 `html-video:update-config` IPC，renderer 目前只显示通用“请求处理失败，请重试”。
- Electron stderr 中的 `ERR_FILE_NOT_FOUND` 来自诊断专用长目录：staging scene 路径为 267 字符；runtime 已按正确顺序先写 HTML 再捕获。默认 `%TEMP%` QA 路径更短，需回到真实路径条件复验，不能把人工长路径误判为产品竞态。
- 默认短路径复验暴露了独立产品问题：编辑动效会通过 `rebuildHtmlVideoEditorialPreviews()` 新建 runtime，而该 runtime 未继承现有 composition 的 `320x568` 画布，回退到默认长边 1280 并生成 `720x1280`；当前屏幕把隐藏 BrowserWindow 限制为 `720x1040` 后捕获必然失败。编辑重建应继承现有 canvas 长边，首次生成和其他 runtime 调用仍保留默认值。
- `applyHtmlVideoConfigChanges()` 在返回前会调用 `invalidateHtmlVideoPipeline(..., 'preview')`，该函数明确清空 `state.compositions`；因此编辑重建不能只看变更后的 pipeline，必须在其 composition 缺失时回退到 `task.pipelineData` 中保存前的权威 canvas。
- 尺寸修复后完整 QA 已证明保存、播放、镜头、转场、终点重播和版式切换全部成立；最终门禁剩余失败来自旧绝对高度 440/300 与版式切换后的 0 秒采样。当前已验收布局实际为 427/287，且 0 秒前景按动效合同本就尚未入场；门禁应使用 400/260 并在切版后 seek 到 60% 稳定帧，不能删除前景可见/边界断言。
- Electron viewport 从 1320×860 改到 920×720 时 iframe 会重新加载并回到 0 秒，因此桌面切版后的稳定采样不会自动延续到紧凑态；两种 viewport 都必须各自在布局稳定后 seek 到 60% 再检查前景。
- 最终完整 `preview-effects` 在当前生产构建通过：编辑保存后仍使用原 `320x568` 长边规格，步骤为 5/6 且可继续重新出片；桌面与紧凑态的前景、单条字幕、画布边界、镜头、转场、版式、滚动、最大化恢复和任务队列均通过，运行时错误为 0。
- 最终原图人工复核确认桌面与 920×720 均保持主画布、下方场景条和单一右侧检查器；没有容器重叠或横向溢出，字幕 cue 与颜色/对齐/样式设置清晰可达。

## 2026-08-11 真实截图复核

- 继续执行后的当前构建完整 `STORYDREAM_QA_EFFECTS_ONLY` 可稳定复现失败：iframe 已 ready、时间为 0.25s、首条字幕可见，但 DOM 中不存在 `.scene-foreground`，因此不是透明度阈值误判。
- QA 夹具已生成前景 PNG、`kind: 'fg'` 资产和 `buildHtmlVideoExportInput.foregroundImages`；前景在 composition 生成后到 renderer 预览源加载之间丢失，需继续追踪 HTML 文件与媒体 URL 替换链路。
- 1320×860 下主画布为 560×526、检查器为 288×652；920×720 下主画布为 328×386、检查器为 288×512，场景条均位于画布下方且主画布宽于检查器。
- 两个尺寸页面与预览工作区横向溢出均为 0，可见控件裁切为 0，Fluent 页签 `innerText` 均为 `版式 / 前景 / 标题 / 字幕 / 提示词`。
- 原始 PNG 显示结构已从多卡片堆叠收敛为单画布、单检查器；但检查器宽度只有 288px，页签同时显示图标和文字时视觉上只剩单字，下一步改为纯文本页签并压缩头部高度。
- 去除图标后的第二轮截图中，前四个双字页签完整显示，但三字“提示词”仍被 Fluent 内部标签省略为“提示…”；继续压缩该局部 TabList 间距并取消标签省略，不增加检查器宽度。
- 最终 Electron 实拍中五个页签和“连播全部”均完整显示；页签内部最大文字宽度 40px、可用宽度 40px，普通与紧凑尺寸均通过内部文字溢出断言。
- 最终结构保持 288px 单一检查器，1320×860 主画布 560×526，920×720 主画布 328×386；两尺寸页面/工作区横向溢出均为 0、可见控件裁切为 0、运行时错误为 0。

## 2026-08-11

- 当前 1320×860 实拍在中央区域连续叠加页面页签、预览边框、播放工具条、场景检查器页签和字幕表单，产生多层框套框；预览内容反而只占工作区很小一块。
- 紧凑窗口中画面本体几乎退出首屏，只剩页签、播放条和检查器；视觉主次与“动画预览”任务相反。
- 左侧任务摘要、统计、任务选择、参数折叠和 6 步流程持续占用 300px 左右宽度，完成态信息重复；应收成窄任务轨，并把低频参数放进折叠区。
- 现有生成稿虽有大画布，但左右两栏和各控件组仍全部使用重边框容器，信息密度偏高；本轮参照要进一步减少容器层级，形成“窄任务轨 + 大预览台 + 单一检查器”。
- 保留式重设计不改变路由、任务状态、场景选择、播放、字幕保存和重新出片合同；仅调整布局语义、命令位置和视觉层级。
- 组件 DOM 当前顺序为：预览标题、镜头/转场 `details`、画布、场景检查器、场景条；CSS 再对这些区块多次覆写，导致普通和紧凑断点下的主次关系不稳定。
- `ScenePreviewEditor` 已拥有版式/前景/标题/字幕/提示词的单一场景检查器状态，适合直接成为右侧稳定 pane；无需再创建新编辑状态。
- 镜头动效与场景转场是当前场景上下文设置，可移动到同一右侧检查器顶部；播放工具条、场景胶片条则应始终留在中央预览台。
- 本轮 `api-image` 的 edit 与 generation 两条路径分别遭遇 SSL EOF 和远端断连，均未产生新文件；现有 `outputs/html-video-animation-preview-redesign.png` 可作为辅助结构参照，但其重边框表单不能直接照搬。
- CSS 中并存三代预览布局：早期 `画布 + 右侧场景栏`、中期 `顶部设置抽屉 + 画布`、当前 `画布 + 下方检查器`；同名选择器在 4266、4813、5241 和 5908 一带重复覆写，是紧凑窗口主画布退场和容器层级失控的主要原因。
- 外层工作室本身是“左侧参数/流程 + 右侧画布”两列；本次不需要改全页数据所有权，只需在预览激活时降低左栏噪音，并让预览内部成为中央画布加右侧检查器。

---

# HTML 动画字幕与重新出片发现

## 2026-08-11

- 用户第一张原始截图显示：场景检查器位于主预览下方，但内容区被窗口底边直接裁切；字幕页只露出“垂直位置”和“场景字号”两个滑块，保存动作也不完整可达，说明该稳定面板没有正确拥有纵向滚动。
- 用户第二张原始截图显示：播放头位于 `0.0s` 时，预览底部同时叠出多条白色字幕，并非单条字幕的行高问题；首帧 cue 激活边界或默认时间归一化需要修正。
- 当前用户要求字幕至少可编辑字体、颜色、位置和字号；已有共享 `captionLayout` 能力需要成为场景检查器的实际控件与权威预览状态，不能继续只暴露两个局部倍率。
- “重新出片”必须消费用户在动画预览中已经保存的 composition/HTML 快照，并只重跑渲染与输出；不得回到文案、素材或 HTML 生成步骤覆盖当前编辑结果。
- 首帧重叠根因位于生成 HTML 的 GSAP 字幕循环：未来 cue 使用 `fromTo` 时未关闭 `immediateRender`，时间线创建阶段就把所有未来字幕从内联 `opacity:0` 改成了半透明可见。
- 场景字幕页当前只有 `captionYOverride` 和 `captionScale`；完整 `HtmlVideoCaptionEditor` 实际藏在上方折叠设置中，已经支持字体、字号、行高、宽度、对齐、字重和四类颜色，应该移动到用户正在编辑的“字幕”页而不是重复实现。
- `prepareHtmlVideoPipelineForRerender` 会保留 compositions 并只置 `render` 为 pending；真正的数据丢失发生在 runner 恢复时：场景/源码编辑更新了 composition HTML，却没有重写 `steps/preview.json` 的文件摘要，`validateCompletedStep('preview')` 因摘要过期而从 preview 重新生成。
- 出片页在配乐或转场有变化时只调用 `updateHtmlVideoConfig`，没有随后调用 `rerenderHtmlVideo` 冻结当前预览快照；应统一为“保存出片参数 → 准备当前预览重新出片 → 启动任务”。
- `immediateRender: false` 能阻止未来 cue 在时间线创建时提前显现，但暂停时间线尚未前进的严格 `0.0s` 不会执行零点 tween；首 cue 还必须在生成 DOM 中拥有可见初始样式，才能同时满足“首帧立即有字”和“只显示一条”。
- 场景字幕页在普通桌面工作台中实际只有约 444px 宽；原 `.hv-scene-caption-editor` 强制 `260px + 300px` 双栏，正好造成约 128px 横向滚动。基于自身宽度的 `auto-fit/minmax` 比 viewport 断点更符合嵌套桌面面板。
- 完整字幕编辑器的内容高度明显超过稳定检查器视口；视觉回归需要分别采集顶部位置/倍率、中段字体/字号/行高/字重、底部颜色/字幕段，单张滚动位置截图不足以证明全部控件可达。
- 最终 Electron 实测在 1320×860 和 920×720 下均为：独立纵向滚动成立、底部可达、body 横向溢出 0、首帧字幕 opacity 为 `["1", "0"]`、运行时错误 0。

# Electron 旧构建页面发现

## 2026-08-09

- 本轮再次按原始分辨率复核：第一张仍是旧版“镜头预览 / 转场预览”大卡片结构；第二张精确请求已过期的 `QueuePage-N1L2e8RT.js`，两项现象继续指向同一个旧 renderer 会话。
- 两张用户截图属于同一版本错代：第一张是凌晨启动的旧 HTML 动画 renderer，第二张是旧 renderer 在磁盘资源被上午新构建替换后继续请求旧懒加载块。
- 当前进程命令为 `D:\opc\novel-write\node_modules\electron\dist\electron.exe .`，主进程 PID 30820，创建时间 01:15:54；当前 `dist-renderer` 资源修改时间为 09:38。
- 当前 manifest 将任务队列映射到 `assets/QueuePage-CwYNVZma.js`，用户错误中的 `QueuePage-N1L2e8RT.js` 已不存在，排除“新版代码没有构建”的可能。
- 当前 `HtmlVideoPage-BRAy7VlW.js` 已包含“字幕、镜头与转场设置”和“真实画布预览”，说明新版功能已经进入生产构建，只是旧窗口没有加载它。
- Vite 对动态导入预加载失败提供 `vite:preloadError` 事件；应用需要在入口监听并对同一错误签名只自动刷新一次，避免永久缺块时形成刷新循环。
- 路由错误页的“重新加载页面”应调用真实页面刷新；仅清空 ErrorBoundary 状态无法重建 React.lazy 已缓存的失败模块 Promise。
- 首轮续接 Electron 验收已证明当前任务队列可真实打开：`activeView=queue`、队列表可见、`.route-error-state` 不存在；同一验收也确认新版动画页的顶部折叠设置存在且旧 `.hv-preview-inspector` 不存在。
- 保存镜头/转场后立即点击播放仍存在换代竞态：旧 iframe 曾满足播放前进条件，随后新 composition 加载并把最终采样重置到 0 秒；这会造成用户可见的“播放没效果”，需要在产品层同步新预览 ready 后再允许播放。
- 稳定源键修复后同一 Electron QA 通过：队列页 `activeView=queue`、队列表可见、路由错误不存在；动画播放采样到 `0.3666667s`，镜头矩阵变化，连续播放捕获转场，版式切换改变标题几何，运行时错误为 0。
- 人工检查 1320×860 与 920×720 原图：旧右侧大预览卡已消失；桌面设置区、主画布、场景列与底部动作完整，紧凑窗口设置自动收起且字幕、画布、场景轨道完整，无重叠或横向溢出。

# HTML 动画场景编辑与播放发现

## 2026-08-09

- 用户截图显示当前为桌面创作工具：中央 9:16 预览、右侧 5 个场景、底部播放工具栏，上方另有折叠的“字幕、镜头与转场设置”。
- 当前交互割裂：场景画面和场景卡片可见，但版式、前景、标题、提示词没有紧邻当前画面，用户无法确认编辑项究竟属于哪个场景。
- 版式选择字号过小，需要在不改变现有深色设计语言的前提下提高可读性、选中态和点击目标稳定性。
- 用户报告播放异常，并指出背景已出现而前景未出现；必须分别追踪播放器状态协议、HTML 合成输入、素材 URL/层级/透明度和预览副本。
- 仓库已有 StoryBound 提示词审计和 JSON 转储，可作为生成提示词修订证据，无需猜测外部实现。
- `ui-ux-pro-max` 将本轮归类为现有桌面生产工具的工作流修复；交互合同要求当前场景选择同步中央预览与对应检查器内容。
- 项目是 React 19 + Electron 41 + TypeScript，已有 `lucide-react` 和独立 HTML 动画样式文件，不应引入新组件库或视觉语言。
- 核心 UI 位于 `src/features/html-video/HtmlVideoStoryboundPanels.tsx`，页面/状态分别涉及 `HtmlVideoPage.tsx`、`HtmlVideoAuthoringWorkspace.tsx`；生成与合成涉及 `src/shared/html-video*.ts` 和 `electron/html-video-*.ts`。
- UI 数据库明确把“只高亮场景但不揭示对应编辑控件”列为 Critical；建议以稳定场景 ID 同步选中态与检查器，并且鼠标选择不抢夺文本输入焦点。
- 产品匹配桌面创作工具的三分区工作台模式，应使用中性表面、语义状态色和克制强调色；不适合做独立营销式或卡片堆叠式重设计。
- `HtmlVideoStoryboundPreviewPanel` 目前把当前场景存为组件内 `active` 数组索引，中央预览和右侧场景条由它驱动；版式弹窗、前景/标题显隐按钮位于场景条底部的迷你操作区。
- 场景标题正文在“文案”标签页的 `SceneTextEditor`，背景/前景及各自提示词在“素材”标签页的 `SceneAssets`/`AssetCard`；动画预览页没有当前场景的完整编辑上下文。
- 播放器已有 iframe 消息协议、运行时就绪标志、待发命令、进度引用、转场锁、watchdog 和连播引用，播放异常需按这套状态机逐段验证，不能另造第二套播放器。
- 前景开关支持场景级 `foregroundHidden` 和元素级隐藏；预览 srcDoc 会重写背景、缩略图和 composition element 的资源路径，下一步需验证 HTML 输出中的前景节点和替换输入是否一致。
- 现有界面结构确认：预览工作台后才渲染 `InlineActionFeedback` 和全屏版式弹窗；当前画面下没有逐场景设置容器，右侧只用 12px 图标和短标签操作。
- `requestPlayback` 把命令写入 `pendingCommand` 并启动 1.8 秒 watchdog；watchdog 仅以 `progressRef <= 0.0005` 判定失败，未记录命令发出时的基准进度，可能误判非零进度或结尾状态。
- 场景切换先设置待发 `restart` 再更换 iframe；运行时 `ready` 时才消费命令。快速操作、拖动后播放和结尾再播放需要针对协议测试。
- HTML 合成确实会把未隐藏前景生成 `<img class="scene-foreground">`，默认 `z-index: 2`，高于背景与遮罩；前景动画也会进入 GSAP 时间线，因此缺失更可能在资产映射、HTML 预览资源替换、透明度/版式或运行时加载，而非完全没写前景节点。
- 资产校验只要求“场景至少有一张前景”，而场景规划可包含多个元素；需要检查资产按 slot 的完备性和 composition 的 `elements` 是否与实际资产对应。
- iframe runtime 用 33ms 定时器推进 GSAP `seek`，`hvruntime: playing` 只是启动确认，父页面直到收到“进度向前”的 `hvtick` 才将 UI 标为播放。
- 多数版式的前景入场从 0.18-0.8 秒开始，GSAP `fromTo` 会让前景在 0 秒代表帧处为透明；现有静止海报只补了字幕，没有补前景，因此默认/暂停首帧可能表现为“背景有了、前景没出现”，即便前景节点和素材都存在。
- `prepareCompositionSrcDoc` 会遍历 source 中所有 `[src]`，以 `data.assets`/`data.voices` 的路径别名替换为 renderer 可用 URL；未匹配项相对 composition 源地址解析。
- 确定的播放 bug：时间线结束后父层按钮恢复为“播放”，`play()` 仍发送 `hvplay`；runtime 对已在终点的 `tl.play()` 不会回到 0，进度也不会前进。watchdog 又只在进度接近 0 时才报错，因此这个无响应会被静默吞掉。
- runtime 的 `hvrestart` 会明确 `seek(0).play()`，因此父层在 `progress >= 0.995` 时应发送 restart；watchdog 应记录命令基准进度或以收到 playing/tick 的确认序号判断启动。
- 旧的 2026-06-24 StoryBound 审计没有覆盖到 HTML 动画生成 prompt，但用户明确确认当前 `E:\Storybound` 存在该能力；撤销“没有独立 HTML 动画步骤”的结论，必须重新对当前安装版本做只读逆向。
- StoryBound 的相关通用约束包括：从当前字幕提取具体动作/主体、明确环境与构图、避免元描述空话、保持跨分镜一致、禁止画面可读文字污染，并要求严格结构化输出。
- 当前 `buildHtmlVideoPlanningSystemPrompt` 已要求 LLM 输出标题、字幕、版式、背景 prompt 和前景 elements，并用 JSON Schema + 二次合同校验保证素材槽数量；但它对“叙事意图 → 版式选择 → 背景/前景分工”的决策规则仍较粗。
- 现有修复器会在 LLM 选择的版式槽位数不匹配时，直接改成第一个槽数相同的版式；这保证合同却可能牺牲语义版式，提示词需先降低不匹配概率并要求逐场景自检。
- 旧 prompt dump 只检出绘图语境中的“前景/动画”，这只能说明旧转储不完整或范围不符，不能用于否定当前版本的 HTML 动画 prompt。
- 仓库 `.reverse/storybound-1.17-assets/HtmlVideoPage-1jcx2WCs.pretty.js` 已明确存在新版 HTML 视频页面拆包结果，用户纠正成立；逆向目标切换到 1.17 chunk 及其依赖。
- StoryBound 1.17 HTML chunk 内嵌 GSAP 3.15.0，并由 `zn(...)`/`Ws(...)` 生成完整场景 HTML；场景包含背景、0-4 个前景槽、标题、逐句字幕和时间线动画。
- 已定位 `Hs(copy, ratio, maxScenes, foreground)` 为 HTML 动画“场景规划” system prompt 构造器；它输出 `videoTitle/frameMainTitle/frameSubTitle/scenes[]`，场景字段含 `sceneTemplate/title/captions/background/elements`。
- StoryBound prompt 明确规定：旁白原文逐句切分、背景只写环境与情绪、前景严格匹配版式槽位、提示词不含风格词/透明背景说明、场景版式多样，并给出 JSON-only 输出合同。
- 1.17 还存在独立“AI 补充一个不重复前景主体”的 prompt，要求 10-20 字、只写人物/物件/动作、无风格词和透明背景说明。
- `Ys()` 的真实调用参数为 `system=Hs(...)`、`user=规范化直引号后的完整文案`、`temperature=0.6`、`maxTokens=min(24000, 2500 + maxScenes*700)`、`maxRetries=4`，再以 Zod schema 解析并重新连续编号。
- StoryBound schema 比本项目多 `videoTitle/frameMainTitle/frameSubTitle` 与逐场景 `emphasis: none|circle|sparkle`；prompt 要求强调场景不超过全片 1/3。
- StoryBound 1.17 预览 `To` 组件的版式选择、前景/标题显隐仍放在右侧场景缩略卡中，相关 `.hv-thumb-tmpl/.hv-fg-toggle` 字号只有 9.5px；用户指出的可读性与交互问题源于参考实现本身，不能继续照搬。
- `To` 的播放逻辑同样在终点再次点击普通播放时只发 `hvplay`，没有自动 restart；本项目已定位的终点播放 bug与参考实现一致，需要主动修正。
- 用户明确要求的目标交互高于参考实现：当前画面下方集中提供版式、前景、标题、提示词，右侧场景条只负责选场景与概览。
- 版式库共有 25 种、素材槽数为 0-4；当前弹窗把所有版式平铺且不兼容项禁用。更合适的场景内选择器应优先只展示与当前前景数量兼容的版式，并用较大标签、说明和当前场景画面/素材预览表达效果。
- 当前 HTML 规划 prompt 已写“不要把前景主体重复画进背景”，但缺少按版式明确构图留白、主体动作/朝向/完整轮廓、跨场景主体一致性以及输出前逐场景核对槽数与语义的步骤。
- CSS 末尾有效覆盖把预览工作台定为中央画布 + 190-224px 场景条，中央列只有一行；新增画面下编辑器需要重新分配中央列的稳定高度并兼顾 920x720 紧凑窗口。
- 旧检查器样式使用 8-10px 标签和 9-10px 控件，确实低于桌面创作工具的可读水平；本轮目标至少提升主要选择/标签至 12-14px，并保留紧凑密度。
- 续接后的真实 Electron 失败只发生在“连播全部”切到下一场景之后；首个场景的单独播放已能前进并显示字幕，故不能把问题归因于所有 iframe 播放命令失效。
- `changeScene()` 切场时没有重置父层 `progress/progressRef`，新场景最早的 tick 会先与旧场景 100% 基准比较；虽然后续 tick 理应恢复，但该状态会制造错误的启动判定和 UI 瞬时不一致。
- 新场景 `ready` 分支会把转场从 `running=false` 改为 `true`，而消息监听 effect 依赖整个 `transitionFrame`，因此 ready 期间会重建 window message 监听；第一批同步 tick/playing 存在落入监听空窗的可能。
- iframe 的 `startPlaybackTicker()` 在创建 33ms interval 后会同步调用一次 `tickPlaybackClock()`；若 iframe 自身逻辑正常，`window.__tl.time()` 应立即至少为 `1/30` 秒。实机仍为 0，必须用直接命令和内部时钟诊断区分父层漏消息与 iframe seek 未生效。
- 失败分支直接向同一 iframe 发送 seek/restart 后，120ms 采样仍为 0，但约 620ms 后时间线推进到 `0.667s`、字幕与镜头动画同步变化；iframe 不是永久损坏，重发 restart 可以恢复。
- 现有父层看门狗在任意一次大于 `0.0005` 的 tick 后就调用 `acknowledgePlayback()` 并永久撤销。连播场景可能曾短暂推进一个 tick 后再次归零，因此 5 秒后仍保持 `playing` 且看门狗不再介入；启动确认需要相对本次请求基准达到稳定阈值，切场必须把基准和显示进度归零。
- effects-only 在开始播放前明确等待并通过 `previewForegroundVisible=true`；失败终态的前景海报因播放态被隐藏，不能据此判定前景修复失败。后续仍需截图检查初始帧和前景页签。
- 用户原图显示旧界面只有画布、播放控制和右侧场景卡底部的小号版式/前景/标题动作，确实缺少画面下方的一一对应设置区。
- 新版模板证据图中，1320x860 的四页签编辑区紧邻画布下方，13px 页签与版式卡标题清楚；920x720 中画布、编辑区和场景横轨均可见，没有互相覆盖。
- 但上述模板证据图的顶部设置为折叠态；effects-only 会展开“字幕、镜头与转场设置”。桌面 `.hv-preview-workspace` 当前强制 `overflow: hidden`，展开后 workbench 的画布+编辑器最小高度可能超过剩余网格高度，底部不可达是实际滚动所有权问题而非只需放宽 QA 数值。
- 第三轮消息追踪显示同一 iframe 持续回传交替序列：正常 GSAP/native 或 `hv*` 时钟推进到 `0.016/0.033/0.066...`，另一驱动紧接着回传 `0`；直接 restart 后仍出现相同交替，证明不是父层命令丢失。
- composition HTML 同时加载 `gsap.min.js`、`hyperframe.runtime.gsap.iife.js` 和自有 `hv*` 播放时钟；HyperFrames runtime 会发现 `window.__timelines` 并通过 GSAP adapter seek/pause，同一 plain iframe 中两套控制器争用 timeline。
- 可视编排与最终逐帧渲染必须保留 HyperFrames runtime；动画预览使用 plain iframe 和自有协议。因此正确边界是在 `prepareCompositionSrcDoc()` 创建的编辑器副本中移除 HyperFrames runtime script，原始/导出 composition 不变。
- 最终 effects 桌面图在顶部设置展开时显示右侧单一纵向滚动条，画布完整、前景人物可见，画布下编辑器页签仍紧邻播放区；紧凑图同样没有场景轨道覆盖编辑器，向下滚动即可访问内容。
- 两种窗口的页签标签均未截断，版式为 13px 明确选中态；下一步需让 QA 逐一切换前景、标题、提示词并核对真实输入/状态，而不是只依赖页签文本存在。
- 用户否决最终 effects 截图的页面层级，判断成立：顶部全局设置、画布、当前场景编辑器正文和右侧场景列表同时展开，滚动可达不等于布局合理；顶部设置被滚动裁成半截尤其不可接受。
- 新交互合同：顶部字幕/镜头/转场设置与当前场景编辑器正文互斥；全局设置展开时保留画布和四页签栏用于切换，隐藏场景编辑正文；点击任一场景页签、播放、切场或保存动效后收起全局设置并恢复正文。
- 互斥修正版 Electron 原图确认：全局设置展开态不再出现被滚动切半的编辑器正文，设置表单、画布和右侧场景列表形成三段清晰层级；保存动效后的默认桌面恢复画布上、当前场景编辑器下、场景列表右的稳定布局。
- 920x720 默认态中画布与四页签栏完整可见，下方内容由单一工作区滚动继续访问，无相互覆盖；这是桌面工具的紧凑布局，不再同时展开全局设置和场景正文。

---

# HTML 动画预览工作区整理发现

## 用户截图证据（2026-08-06）

- 当前预览页把字幕设置固定在左列，把镜头/转场设置、孤立场景缩略图和主 WebView 依次堆在右列，主预览直到首屏底部才出现且被截断。
- 左侧字幕区在大面积空白中占据约三分之一内容宽度，右侧真正的预览任务反而只有较窄列宽。
- 场景缩略图没有列表上下文，单张透明人物图独占一行，用户无法快速判断当前场景、切换顺序或版式状态。
- 右侧页面本身滚动、任务步骤栏滚动和内容列滚动同时存在，滚动所有权不清晰。
- 本轮按桌面生产工具处理：主画布居中、属性检查器靠右、场景胶片条靠下，保留现有深色视觉语言。

---

# HTML 动画 Storybound 对齐发现

## 2026-08-09

- 上一轮 Electron QA 只证明静态预览层可见，没有执行主画面播放、跨场景转场或版式切换后的几何差异验证，不能覆盖用户这次指出的功能问题。
- 设计技能将本轮归类为保留式桌面生产工具重构；工作流正确性优先于装饰，小缩略图不能代替主预览真实效果。
- 用户第二张实图中播放按钮已切到暂停态，但进度仍为 `0.0s / 5.4s`，React 海报字幕已经隐藏，说明父层播放状态与 iframe 实际时间线不同步；这直接造成“播放无效果”和字幕消失。
- 第一张实图中右侧检查器把镜头、转场各用一张大预览图纵向堆叠，内部滚动条很长；场景条与底部动作贴近窗口底边，信息密度高但层级低效。
- 左侧真实错误明确包含 `scenes[0].elements[0].slot must be a non-negative number`，当前场景规划结果没有满足版式元素合同，随后使用本地分镜规划；版式失效必须同时排查规划归一化与渲染器，而不能只改选择器。
- 本机已有 Storybound 1.17 的 `HtmlVideoPage` pretty bundle、最新版多份 `HtmlVideoPage` bundle、真实播放截图和已有逆向审计文档，可直接对照运行时协议、UI 结构与提示词，不需要凭视觉猜测。
- Storybound 1.17 的动画预览把“字幕、标题、草稿模板设置”放在顶部单一折叠条；主工作区是居中的输出画布和右侧纵向场景列表，没有把镜头/转场各自的大预览图常驻堆叠在检查器里。
- Storybound 播放实图在 `2.3s / 12.9s` 同时显示标题、透明前景主体和底部字幕，证明版式/元素时间线直接作用于主画布；静止 0 秒只显示背景是时间线真实状态。
- Storybound 场景列表卡直接展示版式标签（如“中心爆发”“左右对比”“上物下字”）和背景/标题显隐动作，场景选择、版式语义与主画布处于同一工作流。
- Storybound 素材实图的背景提示词是“深夜办公室里灯光昏暗，桌面堆着文件和电脑，地面出现醒目的边界线，空间纵深明显”，不描述主体人物；前景提示词是“疲惫的上班族站在办公桌前，身边出现清晰的红色边界线”，只描述可分离主体及必要视觉标记。
- Storybound 1.17 iframe 同样使用 `hvplay/hvpause/hvseek/hvrestart` 和 33ms `hvtick`，因此协议名称不是差异点；需要继续对照它的 iframe `onLoad`、状态确认和我们 srcDoc 加载时序。
- Storybound 逆向提示词把版式目录及素材槽数直接写给模型：有 N 个槽时 `elements` 只能使用 `slot: 0..N-1`，无素材槽时必须为 `[]`，并要求不同场景尽量选不同版式。
- Storybound 要求 `background.prompt` 只描述有空间感、契合旁白情绪且无文字的背景；背景与前景 prompt 都不写画风词，前景也不写“透明背景/无背景”，这些由系统在图像请求层统一注入。
- Storybound 的前景 `elements.prompt` 是“主体内容描述”，不是完整场景复述；这一分层是后续修正 StoryDream 前后景提示词的直接依据。
- StoryDream 当前 AI 分镜提示词其实已经基本复制上述 Storybound 规则，并在 Provider 返回后严格校验版式的完整槽位数组；真实问题是单个 `slot=-1` 会让整次 AI 规划失败并退回本地规划，没有做安全修复或二次纠错。
- StoryDream 本地规划仍把“透明 PNG 前景素材”直接拼进 `elements.prompt`，与 Storybound 的“透明由生成阶段统一注入”相冲突，也会让素材页提示词显得不自然。
- `updateHtmlVideoScene` 对版式等预览字段会调用 `rebuildHtmlVideoEditorialPreviews`，因此版式选择理论上可立即生效；需验证重建后的 source、资产槽数和 CSS 几何，而不能假设选择器本身已足够。
- `updateHtmlVideoConfig` 走通用失效策略，镜头/转场保存会从 preview 步骤清空 compositions；当前界面仍展示选择控件和小预览，却不能在主画布即时验证，工作流合同不完整。
- Storybound 父层也会在发送 `hvplay` 后乐观切换播放按钮，`onLoad` 只处理跨场景自动续播；协议外形相同，播放卡 0 秒需要从 StoryDream iframe runtime/加载内容本身复现，而不是仅复制父层代码。
- StoryDream 最终合成 payload 已包含 `sceneMotion` 和 `{ transition: { type, duration: 0.3 } }`，最终出片路径并非完全缺失；当前缺口集中在编辑器主预览、配置重建反馈和真实播放验收。
- `planHtmlVideoScenes` 本地回退仍交替使用旧 ID `cinematic-title` 和当前别名表不存在的 `foreground-card`；同时每个场景都塞 `slot:0`，导致映射成零槽“全屏大图”的场景仍携带前景，版式与素材合同自相矛盾。
- StoryDream 当前有 29 个版式，素材槽从 0 到 4；本地回退应从当前目录选择与 `foreground` 开关匹配的模板并精确生成槽位，而不是遗留两种旧模板。
- 场景修改后的 `rebuildHtmlVideoEditorialPreviews` 会在背景和配音齐全时直接重建全部 composition、递增 rev 并回到 render 待完成状态；因此版式即时更新可以沿用现有后端，不需要新增渲染协议。
- 当前 `updateHtmlVideoConfig` 仍由数据库通用更新直接失效 preview，未调用上述重建；镜头/转场需要专门的“已有素材时立即重建预览”路径。
- 当前 `updateHtmlVideoTaskConfig` 在存储层统一把任务设为 paused 并按 manifest 失效；可以在 IPC 层对 `invalidateFrom === 'preview'` 的纯预览配置复用 `applyHtmlVideoConfigChanges + rebuildHtmlVideoEditorialPreviews + persistHtmlVideoEditorialMutation`，保留其他配置原行为。
- 29 个版式都进入共享 HTML 生成器，但若干多槽版式（尤其 `split-compare`、`diagonal-flow`、`parallax-focus`）缺少完整的逐槽几何/错峰定义，多个前景会叠在同一区域，视觉差异被抵消。
- 用户手动切版式目前不校验现有 `scene.elements` 数量是否匹配目标 `materialSlots`；编辑器会显示选择成功，但没有对应数量的素材可填充版式。应把兼容性作为选择器的禁用和说明状态，而不是静默接受。
- Electron 实机复现确认 iframe 内 GSAP 时间线即使收到 `hvplay` 仍可能停在 0 秒；最终运行时增加独立 33ms 定时驱动，以 30fps 固定步进主动 `seek`，因此不依赖 iframe 的 GSAP ticker 是否被 Electron 调度，也不引入逐帧渲染禁止的非确定性时钟。
- 父层现在通过 `hvruntime` 的 ready/playing/paused/ended 状态与 `hvtick` 的实际时间增量确认播放；按钮只有在时间真正前进后才显示暂停态，启动失败会给出明确错误。
- 镜头预览不再是右侧孤立小样，`hvpreviewmotion` 直接驱动主画布的 `.scene-image-region`；转场使用上一场景真实画面覆盖层，在切换边界执行与最终输出一致的 0.3 秒效果。
- 版式选择器按当前场景前景素材数禁用不兼容项；`split-compare`、`diagonal-flow`、`parallax-focus` 已补齐逐槽几何与错峰动画，避免多个素材叠在同一区域。
- AI 场景规划中的负数或乱序槽位会归一化为 `0..N-1`，并切换到相同素材槽数的有效版式；关闭前景时强制零素材版式。确定性回退也使用当前版式 ID、精确槽位数和职责分离的前后景提示词。
- Electron `preview-effects` 最终实景验收通过：播放时间由 `0.099s` 前进到 `0.465s`，镜头变换矩阵发生变化，连续播放捕获到转场覆盖层，切换“满屏金句”后标题几何发生变化。
- 1320×860 与 920×720 两种窗口均无页面横向溢出、控件裁切或运行时错误；竖屏画布、字幕和底部控制完整可见，紧凑模式自动把场景列表变为横向轨道。

---

# 草稿模板双层自由裁切编辑发现

## 2026-08-08

- 用户明确否定九宫格预设，要求展示框和实际图片成为两个可独立选中的画布对象，均具备整体拖动、四边和四角缩放。
- 最终可见结果由展示框裁切实际图片得到；任务预览只读展示该结果，编辑能力不能重新进入任务详情或 HTML 动画链路。
- 这是桌面生产工具中的画布与检查器联动功能：选中态、控制点、检查器对象和持久化数据必须来自同一权威状态。
- `cover` 需要保证实际图片始终覆盖展示框，避免拖动或缩放后露出模板底色；`contain` 与自由裁切语义冲突，继续保持完整居中显示。
- 当前工作区包含多条已完成但未提交的功能改动，本轮必须在重叠文件中做增量修改，不能回退字体、视频替换、AI 补全或 HTML 路由工作。
- `ui-ux-pro-max` 的定向检索把“画布选择必须同步并揭示对应检查器”列为最高优先级，同时要求鼠标选择不抢输入焦点、所有功能可由键盘到达；实现需使用稳定对象 ID，而不是按可见文案映射。
- 项目是 React 19 + TypeScript + Electron，已有 `lucide-react`，本轮应复用现有组件和样式变量，不引入画布或组件库。
- 当前 `EditableDraftCanvas` 只有单一 `image` 层，图片只能整体上下移动；文本层只有一个横向宽度手柄。双层裁切需要扩展选择类型和拖拽快照，不能把现有 `focusX/focusY` 九宫格继续当作画布对象。
- 现有画布坐标同时使用图片的 `top/height`（0..1 顶部原点）和文本的 `x/y`（-1..1 中心原点）；新图片几何必须集中到纯函数换算，避免指针事件、预览和剪映分别手写不同公式。
- `DraftTemplatePreview`、`EditableDraftCanvas` 和 `DraftFrameChrome` 都直接假设图片展示框全宽，仅以 `top/height` 描述；要支持展示框横向移动和缩放，必须新增 `left/width` 并让 frame chrome 的上下带逻辑不再隐式代表完整矩形边界。
- 画布指针增量当前把横纵都换成 `-1..1` 文本坐标；双层图片几何应改用相对画布的 `0..1` 增量，减少 `/2` 往返和边界错误。
- 最小兼容模型确定为展示框 `left/top/width/height`、实际图片 `focusX/focusY/mediaScale`。`focusX/focusY` 从九宫格值升级为连续 0..1 平移，旧值保持可读；`mediaScale=1` 表示刚好 cover 展示框。
- 画布根据模板图片比例与画布像素比例算出实际图片矩形；展示框变换后反算 `mediaScale/focus`，尽量保持图片绝对位置，只有无法继续覆盖新框时才补足缩放并夹紧边界。
- 剪映可直接推广现有公式：展示框中心进入片段 `transform`，图片相对展示框的位移反向进入矩形蒙版中心；蒙版宽高继续由展示框与缩放后素材尺寸之比得到。
- 当前 `.draft-preview-*` 本身 `overflow:hidden`，可以允许实际图片选择框越过展示框但仍限制在画布内；渲染层需要单独的 `overflow:hidden` 裁切容器，控制框则作为画布直接子层避免被展示框裁掉。
- 任务预览复用 `DraftTemplatePreview`，因此只需在共享预览组件实现新几何即可自然同步普通视频；`TaskArtifactPreview` 的封面专用模板明确覆盖为全屏居中，需同时补 `left/width/mediaScale` 避免继承正文裁切。
- 现有真实桥接测试已经验证 `focus` 和矩形蒙版，新增回归应在同一测试中加入非全宽展示框和额外缩放，核对 `transform_x/y` 及 mask，而不是另建平行导出实现。
- 现有 `SegmentedControl` 只支持整组禁用，图片对象切换应在 `contain` 模式下仅提供“展示框”，在 `cover` 模式下稳定提供“展示框 / 实际图片”，并由选择状态同步画布。
- 图片比例过去会自动重算展示框高度；双层模型下它应描述实际图片的自然比例，展示框几何不再随比例变化，否则用户刚调整的裁切框会被比例按钮覆盖。
- 剪映的 `create_frame_overlay_png` 也假设图片全宽：横向边框铺满整行、纵向边框贴画布两侧。展示框支持 `left/width` 后，边框像素必须改为展示框左右边界，否则编辑器与最终成片不一致。
- CSS 中没有 `--focus-ring` 变量；新控制点焦点样式应复用已存在的 `--shell-accent`，避免无效自定义属性让键盘焦点不可见。
- Electron `system` QA 仍会主动操作旧九宫格 select，并把 `focusX/focusY=1` 作为持久化证据；必须替换为真实点击“展示框 / 实际图片”、检查两个 8 控制点对象、调整连续缩放/取景并保存重开。
- 现有假 `pyJianYingDraft.VideoSegment.add_mask()` 不记录蒙版参数，因此快速桥接测试可以精确断言 clip transform；蒙版宽高与中心需要通过生成脚本文本合同或真实内置 Python 草稿验证。
- Electron QA 已有向画布派发 `PointerEvent` 的做法，可复用来验证展示框/实际图片选中和拖动；新的场景证据字段应改为 `draftImageTransformReady`，不继续沿用九宫格含义的 `draftImageCropReady`。

---

# HTML 动画任务入口路由发现

- 最近任务条、任务队列和历史任务行均复用 `App.openTaskDetail(taskId)`，错误不在各列表组件，而在公共入口无条件导航到 `task-detail`。
- HTML 动画任务的权威类型字段是 `taskType === 'html-video'`；`TaskSummary` 未省略该字段，因此列表数据可直接判别。
- 对不在当前快照中的历史分页任务，需要先通过 `api.getTaskDetail(taskId)` 获取权威类型，避免将未命中缓存误当普通任务。
- `HtmlVideoPage` 需要接收一次性目标任务 ID：外部入口指定任务后进入现有 workspace，页面内部的任务下拉和“新建动画”行为继续保持原状态所有权。

---

# HTML 动态版式与预览发现

## 实施结果（2026-08-06）

- 17 个版式现已全部声明 `choreography`，覆盖背景、标题、前景素材数组、字幕和错峰开始时间。
- 动画原子共 21 种；选择器预演直接读取 cue 名称与 `startSec`，没有另建第二套版式配置。
- 场景 HTML 通过 `applySceneAnimation` 将同一 cue 编译到共享 GSAP 时间线；旧任务仍只保存版式 ID，刷新后可自动获得新动画。
- 显式镜头运动继续覆盖版式背景动画，`none` 继续禁用背景运动；没有显式/草稿运镜时使用版式背景 cue。
- 标题与字幕已拆成 `#scene-title` 和 `#scene-captions`，避免字幕容器动画遮住标题。
- Electron 实景验证桌面与紧凑窗口均显示 17 个版式、21 种动画原子；悬停“三元素漂浮”时 6 个动画图层运行，两帧局部截图哈希不同，证明不是只挂 CSS 类名。

## 用户追加（2026-08-06）

- 用户确认继续增加预设。本轮从 17 个扩到 24 个，新增双人对话、纵向时间轴、层叠卡片、动态大字、产品展台、分屏推进和电影片尾。
- 新预设继续消费现有 21 种 cue，不扩持久化字段；差异来自素材槽位、画面结构和错峰组合。

## 用户校正

- 用户指出真正差距是 Storybound 版式卡片描述的动画效果，并明确要求能够看到预览。
- 当前 StoryDream 虽然已有同名 17 个版式，但目录只保存 `titleTop`、`captionY`、静态示意与描述，没有背景、标题、素材、字幕动画或素材错峰时间。
- 当前 HTML 生成器对所有前景统一使用左右轻移、下移和 `0.98 -> 1` 缩放，全部从 `0s` 开始；标题没有独立动画，字幕只有 `none/fade-up/pop` 三档全局配置。
- Storybound 对同一批版式保存 `bgAnim`、`title.anim`、`elementSlots[].anim/startSec`、`caption.anim` 和横屏覆盖；实际使用约 21 个动画原子。
- 因此本轮必须补的是“版式级编排引擎 + 可见预演”，不是再增加 17 个名称，也不能只给选择器加与成片无关的 CSS 动画。

## 实现边界

- 旧任务只持久化 `sceneTemplate` ID，适合让动态编排由目录派生，保持数据兼容。
- 现有 GSAP `window.__tl` 已同时服务 WebView 播放、seek 和逐帧截图，可继续作为唯一成片时间轴。
- 版式选择器预演应复用动画原子的名称与时序元数据，以 CSS 变量/数据属性呈现轻量示意；真实媒体预览仍由主 WebView 承担。
- 现有弹窗已经有 17 张稳定卡片与静态 swatch，适合在卡片内部增加标题、1~4 个素材和字幕层；悬停与 `:focus-visible` 可直接触发，不需要新增全局状态。
- 当前测试只验证 17 个 ID、静态模板归一化和通用前景 selector，没有任何版式专属动画或错峰时间断言，这是此前功能看似存在但成片仍同质化的原因。
- UI 数据库建议悬停反馈只使用 transform/opacity、快速离开时可逆且遵守 reduced-motion；本轮不使用磁吸、阴影放大或改变卡片尺寸。

---

# 普通视频独立封面页发现

## 初步审计

- 普通任务已经具备 `coverImageMode`、`coverTemplateId`、`manualCoverAssetId` 与任务托管的 `covers/cover-manual.png`，自动/手动封面资产入口可以复用。
- 当前 `artifact.cover` 保存标题、副标题等发布文案元数据，草稿桥接层也接受 `coverImagePath`，但这不等同于一个有独立时长的首段封面页。
- 现有剪映桥接层会将模板的 `title`、`subtitle` 叠加到 `total_duration`，这正是需要隔离的边界：新增封面文字必须只覆盖封面片段，不能进入正文总时长。
- HTML 动画已有独立封面流程，但本次明确是普通视频，不能复用 HTML 任务路由或状态。

## 时间线与预览边界

- `writeJianyingDraft` 当前按正文分镜计算总时长，`coverImagePath` 只用于 `draft_meta_info.json` 的 `draft_cover`，没有成为视频轨片段。
- pyJianYingDraft 桥接层从 0 开始重算正文场景时间线，并由这条时间线生成字幕，因此可以通过 2 秒封面偏移统一移动图片、配音和字幕，无需手工改 SRT 字符串。
- 当前 `add_overlay_text` 固定从 0 覆盖总时长；需要支持 `startUs` / `durationUs`，封面文字单独使用 `0..coverDuration`，正文模板文字使用 `coverDuration..end`。
- 任务产物状态已经单独保存 `assets.cover`，任务详情只缺封面资产读取、00 项选择和专属预览状态。
- 普通任务由 `isOrdinaryTask` 限定为 story，音乐 MV 走独立页面和 sidecar，本轮不改变音乐 MV 行为。

## 兼容策略

- 仅凭旧 `coverImageMode=auto/manual` 不能推断用户希望插入片头，否则旧任务重新打包会改变视频；必须增加显式 `coverPageEnabled`，数据库默认 `0`。
- 新任务开启封面页时仍沿用 `coverImageMode` 选择自动或手动图片，关闭时不生成首段封面。

## 已实现契约

- 创建任务新增 `coverPageEnabled` 与 `coverPageText`，IPC 将文字限制为 80 字；数据库迁移新增 `cover_page_enabled` 和 `cover_page_text`，默认关闭且为空。
- 新建任务输出设置将封面页收拢为单一区块，开启后选择“AI 单独生成 / 本地导入”，封面文字留空即纯图片。
- `writeJianyingDraft` 新增独立 `coverPage` 载荷；pyJianYingDraft 将封面图片写入 `images` 轨首段，并为封面文字创建 `cover_title` 轨。
- 正文 overlay 增加 `startUs` / `durationUs`，从封面结束点开始；桥接字幕由偏移后的正文 timeline 生成。
- 任务详情预览新增 `00 封面`，使用全画布封面图片并隐藏正文字幕、副标题和免责声明。

## 聚焦验证

- 9 个测试文件、124 项测试通过。
- 真实 Python 桥接测试确认：封面图片与 `cover_title` 为 `0..2s`，正文图片、配音、字幕和正文标题从 `2s` 开始，总时长正确增加 2 秒。

## 实景加固

- 首次 Electron 封面截图发现 `00` 编号颜色被普通场景轮换色覆盖，对比度仅 `1.48:1`；调整 CSS 顺序后通过跨页面对比度检查。
- 首次截图还发现封面文字沿用正文标题的底部坐标，长文案贴近画布下沿；封面标题现使用独立安全区，并按画布比例、字数和显式换行数缩放字号。
- Electron 专用场景现在要求标题矩形完整落在封面画布内，且正文副标题、字幕和免责声明节点不得存在。
- 剪映正文边框覆盖层原先仍从 `0s` 开始，可能污染封面；现改为从 `cover_page_duration` 开始，只覆盖正文时长。
- 本地人物素材分支原先会在自动封面生成前提前返回；自动封面现先独立生成，本地任务测试确认供应商只收到 `sceneId: 0`，正文图片仍来自素材库。

---

# Storybound 与 StoryDream HTML 动画最终逐页对比

## 截图证据

- Storybound 1.17.0 的新建任务、文案、素材、配音、动画预览、封面、出片截图已保存到 `.artifacts/storybound-html-compare-20260806`。
- StoryDream 当前创建、自动制作、可视编排、字幕、封面、完成和失败状态截图位于 `.artifacts/html-video-ui-current`。
- Storybound 的 HTML 创建表单受授权路由保护，直接访问只显示“授权校验中”；本轮只比较已实拍的新建任务入口，不推断其未显示的表单字段。

## 逐页矩阵

| 页面 | Storybound 1.17.0 | StoryDream 当前实现 | 判断 |
|---|---|---|---|
| 新建任务入口 | 图文、HTML、MV 三种任务卡片与最近任务同屏；HTML 卡片直接说明 16 种版式和全后期可改 | 进入 HTML 模块后直接展示文案、画面、封面、配音、预设的完整长表单，并可打开已有任务 | StoryDream 配置更完整，但首屏信息负担更重；Storybound 更适合第一次选任务，StoryDream 更适合熟练用户重复生产 |
| 任务总览 | 左栏永久保留最近任务；中栏显示任务 ID、标题、总时长、步骤、场景、打开成片、目录、删除、返回与逐阶段重跑 | 左栏是模块导航；中栏显示标题、步骤、场景、总时长、任务下拉、参数和六步进度，底部有暂停/继续/取消/重试/预览/目录 | 核心三栏结构已经等价；StoryDream 弱在最近任务扫描、重命名/删除和逐阶段重跑动作不够直达 |
| 文案与场景规划 | 成稿、版式、标题、字幕、背景词和前景词在同一场景块里扫描；标题/字幕可快速改、标题可隐藏 | 口播、标题、字幕和 17 种画面预设可直接编辑；改口播后自动重配该场景，素材提示词在素材页编辑 | StoryDream 编辑能力更强；Storybound 的全场景语义总览更紧凑，减少跨页核对提示词 |
| 素材 | 背景和透明前景大图卡片、手动加前景、全局“全部去背景” | 背景/前景提示词编辑、预览、重画、本地替换、隐藏/显示、最多四个前景、手动添加 | 大部分等价；StoryDream 缺少批量去背景，图标工具的可发现性也弱于 Storybound 的直接动作 |
| 配音 | 豆包/MiniMax、语速、音色快捷选择、更多音色、逐场景播放器和重配 | 豆包/MiniMax、0.5x-2.0x、完整音色列表、应用并重配全部、逐场景播放器、编辑口播后重配 | 生成后能力等价；StoryDream 音色按钮只选择不试听，长目录也没有任务内搜索/“更多音色”收纳 |
| 动画预览 | WebView 实渲染、连播全部、场景列表、逐场景版式、隐藏背景/标题 | WebView 实渲染、拖动进度、播放/暂停、上下场景、重播、最大化、连播、17 种版式、隐藏前景/标题；另有 8 种镜头运动、6 种转场及转场示意 | StoryDream 功能明显更强，不是动画能力不足；差距主要是控件密度和“自动制作/可视编排”切换后工作流上下文被割开 |
| 字幕样式 | 动画预览页有“字幕·标题·草稿模板设置”折叠入口 | 独立字幕编辑区支持预设、字幕动画、文字/强调/底色/阴影四组颜色和保存 | StoryDream 更显式、更可控；需要保证字幕编辑与当前场景预览同屏反馈，而不是只靠长面板滚动 |
| 可视编排 | 当前实拍任务页未见独立源码/时间线编排器 | 场景切换、HTML 源码、属性、检查、渲染队列、播放画布、分轨时间线和片段时长/层级编辑 | StoryDream 独有优势；问题是切换到编排模式后六阶段标签消失，用户难确认自己仍处于哪个生产阶段 |
| 封面 | 成品预览、模板、构图方向、标题方式、比例、重画、下载、放大、编辑/复制提示词 | 关闭/自动/手动、比例、模板、提示词、重画、本地导入、保存、打开目录和独立预览 | 核心能力等价；StoryDream 缺少大图查看与直接下载，完成态也不如 Storybound 一屏可核验 |
| 出片 | 成片状态、内嵌播放、完整路径、打开成片、调整 BGM、重新出片 | 内嵌播放、文件信息/路径、BGM、音量、转场、保存设置、打开目录、重新出片 | StoryDream 参数更细；Storybound 的交付主动作更集中，StoryDream 的“打开成片”不够突出 |
| 失败与恢复 | 中栏每个阶段常驻状态，并在对应节点暴露“从头重跑/重出图片/重配音/重新出片” | 错误横幅、失败步骤、从失败阶段重试，同时支持运行中暂停/取消/继续 | StoryDream 控制更完整；恢复动作分散在错误页、阶段页和底部控制区，定位成本更高 |
| 配置准备度 | 系统设置中 LLM、绘图、TTS、识别、剪映等“已配置/待配置”一眼可见，最近任务仍固定可达 | 系统设置是独立模块；HTML 页顶部主要显示草稿目录和保存状态 | StoryDream 缺少创建前的依赖就绪摘要，但不必复制积分、账号或云端市场 |

## 核心判断

- 当前差距不是“StoryDream 没有 Storybound 的 HTML 动画功能”。六阶段工作流、WebView 实渲染、场景素材、配音、封面和出片已经基本对齐，可视编排、字幕样式和转场示意甚至更强。
- 真正差距是工作流表达：Storybound 把最近任务、任务摘要、阶段状态、阶段恢复和当前编辑固定在稳定坐标；StoryDream 的能力分散在长创建页、任务参数折叠区、六标签页、错误横幅和独立编排模式中。
- StoryDream 当前最值得改的是“少找入口、少切上下文、完成态一眼核验”，不是继续增加动画种类。

## 优先级

1. P0：在全局左栏增加可扫描的最近 HTML 任务，或提供常驻最近任务抽屉；中栏补重命名、删除、打开成片和逐阶段重跑。
2. P0：可视编排模式继续保留六阶段标签与当前阶段标识，避免从自动工作流切换后丢失位置。
3. P1：创建页把高频项与高级项分层，首屏只保留文案、比例、画面风格、配音和开始生成；封面、BGM、转场、动效、画面预设放入可展开高级区。
4. P1：素材页补“全部去背景”；配音页补任务内音色搜索和选择前试听；封面页补大图与直接下载；出片页突出“打开成片”。
5. P2：统一深浅主题下自动制作与可视编排的表面层级、工具栏高度和选择态，减少混合主题与重复顶栏造成的画布损失。

---

# 任务详情草稿交付区视觉强化发现

## 用户参考

- 用户希望底部“剪映草稿已生成”区域像参考图一样被单独括起来，方便识别状态和后续操作。
- 现有 `TaskDraftDelivery` 已有完整状态和操作结构，外层使用 `.task-draft-delivery`，并通过 `data-draft-status` 区分 `ready`、`pending`、`running` 等状态。
- 因此只强化 `ready` 完成态的边界和层级，不改业务状态、按钮行为或未完成状态的中性语义。
- Electron 浅色、深色实拍确认双层渐变可以建立独立完成态边界，同时不会遮盖底部草稿操作或造成按钮裁切。
- 原“打开剪映”浅色按钮前景与品牌底色对比度仅 `3.94:1`；改用主题聚焦前景色后满足正文按钮的可读性要求。

---

# 普通任务图片卡片等高修复发现

## 用户截图

- 问题位于普通任务详情的“图片”标签，约五列素材卡片布局。
- 同一行图片高度基本一致，但标题和提示词长度不同会把整卡撑成不同高度，底边明显参差。
- 修复应限制文字轨道并让网格项拉伸，不能通过改变图片比例来补齐。
- 根因是 `.image-preview-grid` 显式设置了 `align-items: start`，同时卡片正文轨道使用独立的 `auto` 高度；网格因此不会把同一行的短卡片拉伸到该行最高卡片。
- 使用网格行拉伸并让正文 `1fr` 吸收余量，可以保留现有 `9:16` 图片比例和文字展示规则。

---

# HTML 动画 AI 创作真实检索发现

## 用户反馈

- 用户确认 HTML 动画的“AI 创作”没有真正实现检索功能。
- 现有代码虽然声明了搜索与研究文案 API，但模拟测试不能证明创建页真实调用了检索。
- 本轮必须以实际按钮动作、IPC 请求、提供方结果和文案合成输入为证据。

## 初步判断

- 重点核对 AI 模式默认状态、按钮参数、搜索结果筛选、静默降级和来源是否被页面丢弃。
- 检索是 AI 创作的必要阶段；启用后无有效正文必须阻止创建任务。
- 已确认主进程 `research:web-search` 会调用 `searchWebSourcesDetailed`，并行搜索必应、百度、搜狗、头条，再抓取候选网页正文、去重、相关性筛选和渠道多样化；后端不是空壳。
- HTML 页面当前把搜索与文案合成塞进最终“搜索并生成”按钮内部，用户无法看到渠道状态、来源标题、网址、正文摘要，也无法选择或重试来源。
- HTML 页面提供“自动检索”关闭开关；关闭后 `searchEnabled: false` 会跳过搜索并直接把主题交给 LLM，且任务仍可创建。这是与“AI 创作自然带检索”要求冲突的真实旁路。
- 普通任务已经实现完整检索交互：渠道选择、独立搜索、查询一致性、渠道状态、来源勾选、结合所选页面生成可编辑文案。HTML 页面应复用其交互语义，而非继续隐藏调用。
- UI/UX 数据库对桌面创作工具建议紧凑工作流、清晰状态与语义错误色；错误必须用 `role=alert` 宣告，来源选择保持稳定 ID 和当前输入同步。

## 交互契约

- AI 创作固定包含网页检索，不再提供关闭检索或直接生成旁路。
- 关键词或搜索渠道变化后，旧检索结果、来源选择和已生成文案立即失效。
- 搜索完成后显示实际查询、四渠道状态、警告、来源标题、网址和正文摘要。
- 用户明确勾选至少一个来源后才能生成文案；来源选择变化后旧文案失效。
- 生成文案保持可编辑；最终创建按钮只提交当前文案和实际采用的来源。

## 真实检索证据

- 直接调用与 Electron 主进程相同的 `searchWebSourcesDetailed`，查询“钱学森回国”并启用四个渠道。
- 必应返回 6 条精准正文、百度 4 条、头条 3 条，搜狗为无精准结果；无渠道错误警告。
- 最终筛出 10 条可用来源，包括人民日报、中央纪委国家监委网站、新华网、清华大学等页面。
- 抓取内容不是仅有标题：中央纪委页面正文 2257 字、清华大学页面正文 1393 字、新华网页面正文 841 字。

---

# 草稿模板关闭下划线黑屏发现

## 用户截图

- 截图尺寸为 1320×860，整个 Electron 内容区接近纯黑。
- 顶栏、侧栏、模板控制区和预览画布均不可见，因此不是单个文字层隐藏或画布背景色变化。
- 触发动作是关闭草稿模板中的下划线开关，优先排查 renderer 未捕获异常、开关提交行为和模板状态更新。

## 初步代码发现

- 标题、副标题、字幕和免责声明各有一个下划线开关，均直接把布尔值传给对应的局部更新函数。
- 模板契约与归一化代码明确支持 `underline: false`，内置模板也普遍使用关闭状态。
- 画布样式在关闭时写入 `textDecoration: 'none'`，并把粗细和偏移恢复为 `undefined`；单从样式值看不应让整个应用壳层消失。
- 需要继续捕获真实 Electron 切换瞬间的异常，并核对 `ToggleField` 是否在表单环境中产生意外提交。
- `ToggleField` 使用原生 checkbox，并不存在按钮默认提交；开关回调只读取 `event.target.checked`。
- 四个局部更新函数均通过函数式 `setDraft` 只替换对应文字层，没有自动保存、导航或异步副作用。
- 当前最需要验证的是画布动态样式移除：开启时设置 `textDecorationThickness` / `textUnderlineOffset`，关闭时把二者切成 `undefined`。
- 已把“启用再关闭主标题下划线”加入真实 Electron 系统 QA；深浅主题与 1440×900、1080×720 四种场景均保持壳层、画布和其他图层，当前测试模板不能复现黑屏。
- 因此不能把 `underline: false` 或通用开关回调直接认定为根因，需要检查用户实际模板数据和系统崩溃记录。
- 截图五个采样点均为 `#101214`，与 CSS 的 `--shell-bg` 完全一致，而 BrowserWindow 原生背景是 `#101114`；渲染文档仍在，黑屏来自 React 根内容不可见或为空，不是画布背景。
- 实际用户数据库可正常打开，当前视图为深色草稿模板页；最近使用的“标准模板”标题确实是 `underline: true`，其他字段均在合同范围内，数据库没有损坏。
- 根节点在 `data-theme-ready` 不为 `true` 时被全局 CSS 隐藏，而该标志只在异步 bootstrap 成功或失败后设置；bootstrap 长时间 pending 会留下永久纯色窗口。
- 当前只有路由内部错误边界，无法承接 `App`/壳层级渲染异常；需要根错误边界并在捕获时强制显示主题内容。
- 最终修复同时收紧触发点与黑屏后果：文本装饰用稳定长属性切换，根错误有可见恢复页，bootstrap pending 有有界显示兜底。

---

# 已完成：HTML 动画 AI 创作与任务同步发现

## 用户截图与现状

- HTML 动画创建页文案区只有一个大文本框，当前只能粘贴完整口播稿。
- 用户要求与普通任务一致：可选择 AI 创作，并自然包含搜索资料阶段。
- 右上角已有任务下拉显示内容与现有任务状态不一致，需要以全局任务状态为权威来源。
- 本次是桌面生产工具的窄范围工作流修复，保留现有 HTML 动画编辑器视觉和参数区。

## 初步代码发现

- HTML 动画由独立 `html-video` 流水线处理，不能直接复用普通 `runner.ts`。
- 现有 HTML 创建入口是 `HtmlVideoPage.tsx` 的 `createHtmlVideoTask`，输入通过 `createHtmlVideoTaskInput` 直接生成流水线数据。
- 普通任务已具备 AI 创作、检索关键词和搜索资料产物，可复用其输入语义与现有研究模块，但必须接入 HTML 独立流水线。
- 创建页已有任务下拉被硬编码为 `value=""`，不会显示任何当前任务选择。
- `activeTaskId` 只在页面内部创建/切换时更新，没有在 `state.tasks` 新增、删除或替换后做选择校正。
- 页面直接用 `state.tasks.filter(isHtmlVideoTask)`，需要继续确认 bootstrap/reconcile 是否保证完整 HTML 任务集合。
- `loadCompleteBootstrap` 只补全提示词模板和草稿模板，不会补全任务；启动快照里的 `state.tasks` 只代表任务历史首屏，不能作为“全部 HTML 任务”的唯一列表来源。
- `isHtmlVideoTask` 严格判断 `task.taskType === 'html-video'`，截图中的日期标题可能是旧 HTML 动画任务沿用了输入标题，不能仅凭标题判断为普通任务。
- 普通任务的研究链路已经提供 `searchWebSources` 和 `composeResearchCopy` 两个正式 API；HTML 动画应复用这两个调用，在 AI 模式点击“开始生成”时自动搜索、选取有效来源并生成文案，再交给独立 HTML 流水线。
- 当前普通任务要求用户手动勾选搜索来源。HTML 动画本次需求强调“自然带着搜索”，创建动作应自动使用搜索返回的有效前若干来源；无搜索结果时必须明确阻止创建，不能把关键词直接伪装成成片文案。
- 创建页下拉写死 `value=""`，而 `activeTask` 又只在工作区模式解析；修复时需要独立的创建页选择值，并在任务集合变更时校正 `activeTaskId/pageMode`。
- 已有 `api.listTasks({ taskType: 'html-video' })` 支持任务类型过滤和游标分页。HTML 页应自行分页加载完整 HTML 任务摘要；切换到不在启动快照中的旧任务时调用 `refreshTaskDetail` 拉取完整详情后再进入工作区。
- 最终 AI 创建交互只暴露“创作主题”和可选“创作要求”，搜索渠道固定复用普通任务的必应、百度、搜狗、头条，不把手动资料勾选流程复制到 HTML 创建页。
- AI 创建按钮按“搜索资料 → 创作文案 → 创建任务”反馈真实阶段；研究文案、关键词、要求和选中的网页来源会写入 HTML 任务元数据。
- Electron 实图确认桌面粘贴模式与紧凑 AI 模式均无横向溢出、裁切和重叠；右上角显示完整活动 HTML 任务数量，任务选项按创建时间稳定倒序。

---

# 已完成：普通任务分镜编辑与剪映交付工作台发现

## 参考截图

- 参考产品把“字幕断句”作为普通任务的独立生产视图。
- 每个分镜采用双栏：左侧只读分镜原文，右侧是带行号的可编辑字幕行。
- 顶部提供 AI 重新解析、复制文案、重新切分和时间轴异常修复。
- 底部使用高识别度完成状态栏承接剪映交付操作，而不是把草稿路径作为主要界面。
- 原图为纵向长列表，分镜行之间仅使用轻边界分隔；右栏字幕编辑区有稳定行号列，长短内容不会改变双栏基线。
- 草稿交付条固定承接后续操作，但普通任务必须保留“打开草稿目录”和“启动剪映”两个语义不同的命令。

## 当前产品

- 普通任务详情已有“分镜”标签，但目前只渲染只读 `ArtifactSceneList`。
- 已有任务模板切换，完成任务应用模板时会重新执行草稿导出步骤。
- 已有全局剪映背景音乐库，但尚需确认是否支持任务级选择与持久化。
- 当前“打开剪映草稿”调用 `openTaskOutputDirectory`，需要核对它实际是打开目录还是启动剪映。

## 设计方向

- 保持现有 StoryDream 浅色桌面生产工具样式，采用紧凑工具栏和连续分镜行，不做营销式卡片布局。
- 草稿完成状态与后续动作放在同一交付栏，减少用户在模板栏、结果区和目录路径之间来回寻找。
- UI Pro Max 的本地产品检索命中桌面生产/创作工具，建议三栏工作区、上下文检查器、紧凑层级和克制状态色；与当前 StoryDream 壳层一致，不引入参考图的纯黑视觉主题。

## 初步代码发现

- `Task` 已有 `bgmId`，新建任务也会保存背景音乐选择，任务级音乐能力不需要新增数据库字段。
- 普通任务运行器通过 `task.bgmId` 从全局音乐库解析 BGM；修改任务音乐后重跑草稿导出即可生效。
- 当前渲染层只有 `updateTaskTemplate`，需要补任务音乐更新和字幕断句持久化 API。
- 当前“打开剪映草稿”仍需继续追踪 Electron handler，界面调用的是 `openTaskOutputDirectory`。
- 模板更新 handler 只写入 `templateId`；现有 `rerunTaskStep(6)` 会把任务置为待运行并从草稿导出步骤继续，适合“重新打包”。
- `task:open-output-directory` 最终只调用 `shell.openPath(directory)`，现在的“打开剪映草稿”文案不准确，实际只是打开资源管理器。
- `ArtifactSceneList` 仅显示分镜、提示词和图片路径，没有编辑状态、字幕行或保存动作。
- 普通任务 API 需要新增：保存字幕断句、更新任务音乐、启动剪映；打开目录保留为独立动作。
- 产物 JSON 的受控写入集中在 `src/shared/pipeline-cache.ts`，字幕断句保存应复用其路径校验、文件锁和原子写入模式。
- 项目尚无剪映可执行文件发现/启动逻辑，只有草稿目录自动探测；需要新增独立、可测试的 Windows 应用定位器。
- Runner 在步骤 6 开始时重新读取最新模板，但 BGM 仍取启动时的任务快照；需一并改成读取最新 `bgmId`，保证“改音乐后立即重新打包”可靠。
- `markTaskStepForRerun(6)` 会删除状态里的草稿记录；设置或字幕保存阶段应只把步骤 6 标为待重新打包并保留旧草稿，真正开始重打包时再清理。
- 字幕轨道可由现有场景时长重新分配时间；需要在 `story.ts` 增加“按用户给定字幕行构建轨道”的纯函数，确保 SRT、预览和剪映输入一致。
- `TaskDetailPage` 已有 `artifactRefreshTick`，新保存动作完成后可显式刷新 snapshot，无需增加轮询。
- 当前应用模板会自动重跑步骤 6；为配合独立“重新打包”动作，应改为只保存设置并标记待打包。
- IPC 白名单和 Zod 请求校验集中在 `storydream-api.ts` 与 `ipc-contract.ts`，新增通道必须同时补 preload、browser fallback 和契约测试。
- 当前机器存在 `%LOCALAPPDATA%/JianyingPro/Apps/JianyingPro.exe`，同时有版本目录 `Apps/8.9.0.13361/JianyingPro.exe`；应用定位器优先稳定入口，再回退版本目录和 Program Files。

## 最终实现结论

- 手动字幕断句直接写入普通任务产物的字幕轨道，保留用户标点和分行；重打包不会再次自动切句。
- 预览、SRT 和剪映桥接共用同一字幕文本与微秒时长，解决应用预览与实际草稿字幕不一致。
- 模板、音乐和字幕调整只把草稿导出步骤标为待执行，并保留旧草稿；用户明确点击“重新打包”后才重跑步骤 6。
- 生成期间可以预设模板和音乐，Runner 在打包前读取最新任务设置；当前流水线运行期间仍禁止并发重新打包。
- “草稿目录”只打开文件夹，“打开剪映”单独探测并启动剪映专业版，界面不再混淆两种动作。
- 底部交付区使用文档流布局，不覆盖分镜列表；桌面和紧凑窗口均通过真实 Electron 遮挡、裁切和对比度检查。

---

# Storybound 最近版本差异审查发现

## 取证基线

- 审查日期：2026-08-05。
- 当前 StoryDream 分支：`codex/storydream-local-hardening`，远端已同步至 `0c09e67`。
- 本地已有 Storybound 静态资源快照位于 `.reverse/storybound-latest-assets`，文件时间主要为 2026-07-09；该目录仅作为历史基线，不直接纳入提交。
- 仓库已有普通视频分镜与剪映交付、HTML 动画真实检索、素材编辑、画面预设、成片预览和独立封面页等近期补全，后续比对必须识别这些等价能力。

## 待验证候选

- 当前线上资源指纹是否晚于 2026-07-09 基线。
- 最近版本是否新增页面、任务步骤、模型参数、素材操作或成片交付动作。
- 更新是完整可用能力、灰度入口，还是仅资源重打包与文案变化。

## 已定位的版本线索

- 2026-07-09 设计记录明确对应一版 Storybound 最新包，入口为 `/assets/index-BFrn3lR6.js`，当时已移植固定开头、结尾引导、锁定开头句、商品信息、人物素材、选品和对标导入等实用能力。
- 仓库还存在 2026-07-30 的 `Storybound 1.16.1 Runtime Parity Matrix`，说明在 7 月 9 日静态快照之后已经做过一次更晚的已安装版本审查；本轮应以该矩阵和当前安装包为主要历史基线。
- 本地 7 月 9 日快照入口、manifest 和全部资源均在 `.reverse/storybound-latest-assets`，可用于哈希级比较，但其文件数量中包含多个历史同名 chunk，不能仅凭目录内出现某个文件判断当时主入口实际引用了它。

## 当前安装确认

- 当前实际安装目录为 `E:\Storybound`；旧矩阵记录的 `G:\Storybound` 已不存在，应视为路径迁移或旧盘符记录。
- 当前 `storybound.exe` 修改时间为 2026-07-31 01:32，SHA-256 为 `437B489473C1A6A0004CD9279F20846C055F9462BCB23A59048E86F4F87723B0`；与 2026-06-24 记录的 `9BDC43B...` 不同，确认程序主体发生过更新。
- 当前 `draft-generator.exe` 修改时间为 2026-07-31 01:30，SHA-256 为 `D7F984A6F160645456E7F842E6161D235CD3594645B60791EC0A5EF03078A3F0`；与 2026-06-24 记录的 `CF271ACF...` 不同，原生草稿侧车也发生过更新。
- 安装资源目录只有 2026-07-11 的 `default-bgm.mp3`，前端资源仍嵌入 Tauri 主二进制，需要通过当前页面、字符串或资源提取取证。
- Storybound 用户数据候选同时存在于 Roaming/Local 的 `com.dudumd.storybound` 和 Local 的 `Storybound`，后续以数据库内容和更新时间确认权威目录。

## 当前运行数据

- 权威数据库为 `C:\Users\Administrator\AppData\Local\com.dudumd.storybound\data.db`，最后写入时间为 2026-08-03 20:23，晚于 7 月 31 日安装包时间。
- `C:\Users\Administrator\AppData\Local\Storybound\crash.log` 记录当前程序路径为 `E:\Storybound\storybound.exe`；多次 `sqlx-sqlite` 越界的行长度依次从 38、42、48 增长到 53，侧面证明近期版本持续增加任务查询字段，同时存在迁移后读取列数不匹配的上游崩溃风险。
- StoryDream 已依赖 `sql.js`，可对 Storybound SQLite 做只读结构化查询，无需临时字符串解析或引入新工具。

## 数据库 31 版差异

- 当前数据库 `PRAGMA user_version = 31`，高于 2026-07-30 矩阵记录的版本 30；这是本轮已确认的最近一次结构更新。
- `tasks` 当前共有 53 个字段，尾部新增序列为 `uploaded_voice_path`、`is_favorite`、`cover_local_path`、`cover_custom_text`。结合迁移顺序，`cover_custom_text` 是版本 31 的最强新增候选。
- `playground_jobs` 已有 `resolution` 与 `sub_dir`；`user_prompt_templates` 已有角色卡、分镜骨架、参考类型和市场元数据；这些能力需要与 7 月 9 日快照及 StoryDream 现状比较后再判断新旧。
- 数据库只读查询没有访问或输出 API 密钥、账号数据与用户正文。

## 三方字段初筛

- 7 月 9 日旧快照已经包含 `needs_character_card`、`step3_skeleton_modules_json`、`reference_kind` 和模板市场字段，因此它们不是 7 月 31 日后的新功能。
- StoryDream 已有角色卡/分镜骨架/参考类型的数据契约，也已有图像实验室 1K/2K/4K、按任务 low/medium/high 质量覆盖、历史记录和批处理，相关能力不需要重复移植。
- StoryDream 新增的 `coverPageText` 已经实现“仅封面页显示、正文不延续”的用户需求，功能范围比只存 `cover_custom_text` 更明确；但仍需通过 Storybound 当前界面确认 `cover_custom_text` 是否还有不同的交互语义。
- 当前 Tauri 二进制内前端资源并非可由简单 ASCII 字段搜索完整恢复；直接二进制关键词只命中 `resolution`，不能据此否定数据库中其他功能，下一步改用实际 WebView 页面取证。

## 页面取证准备

- 项目依赖中未安装 Playwright，不为本次审查新增依赖。
- Codex 工作区运行时已随附 `playwright` 与 `playwright-core`，可通过 WebView2 本地调试端口只读采集当前 Storybound 的页面文字、控件和截图。

## 当前 WebView

- 7 月 31 日 Storybound 已成功通过本地 WebView2 调试端口启动，当前恢复路由为 `http://tauri.localhost/settings`。
- 页面标题仍是脚手架默认值 `Tauri + React + Typescript`，版本识别不能依赖窗口标题；后续以页面控件、路由和数据库结构为准。
- 调试端口只监听 localhost，页面采集报告和截图写入 `C:\tmp\storybound-current-audit`，不进入仓库提交。

## 1.17.0 页面确认

- 当前设置页品牌区明确显示 `v1.17.0 · beta`，因此本轮对比基线从文档中的 1.16.1 更新为实际运行的 1.17.0。
- 设置导航显示独立的“AI 创作 / IMA 知识库”配置项，当前为待配置；需要通过公告和创建页判断其是最近更新还是旧入口。
- 左侧显示“全能绘图积分”及按 1K 档估算可生成张数，这是 Storybound 服务端积分能力；StoryDream 使用用户自有 Provider，不应伪造同一余额体系。
- 当前页面公告按钮显示 8 条未读公告，是获取官方最近几次更新内容的优先证据入口。

## 公告摘要（当前页面实测）

| 版本 | 日期 | 页面摘要 | 初步与 StoryDream 的关系 |
|---|---|---|---|
| 1.17.0 | 2026-07-31 | RunningHub 国内站 API 停用，出图/动态分镜切换国际站 | Provider/服务端迁移；不复制私有端点，检查本地 Provider 配置是否需要兼容提示 |
| 1.16.1 | 2026-07-26 | 字幕行号；对标监控账号名称搜索 | 普通任务分镜编辑已覆盖字幕行；对标导入是本地版，需看是否缺少账号筛选交互 |
| 1.16.0 | 2026-07-23 | 字幕智能断行；字幕与语音精准同步；任务详情字幕调整 | StoryDream 已有统一字幕轨道、手动断句和预览/剪映同步，重点做回归而非重复实现 |
| 1.15.0 | 2026-07-20 | 站内买卡/充值、邀请码分销、封面本地上传 | 计费/分销属于服务端边界；封面本地上传已扩展为普通视频独立封面页，可复用已有能力 |
| 1.14.0 | 2026-07-16 | 旧图历史版本、封面查图、一键预设 | 旧图版本和任务预设需检查当前素材/画廊是否缺口；封面查图依赖远程任务状态，不能伪造 |

- 页面还列出 1.13.0 创作市场、1.12.1 上传配音、1.12.0 文案把控、1.11.x 真图分镜/出图稳定性；这些已在 7 月 30 日矩阵和 StoryDream 近期提交中逐项处理或明确延后。

## 1.17.0 完整公告

- RunningHub 变化只是国内站停用、国际站迁移和余额同步，属于第三方服务端迁移；StoryDream 不绑定 RunningHub 私有余额，不需要改动现有自有 Provider 架构。
- 新增“创建任务时自定义封面主/副标题”。StoryDream 已有封面页开关、独立封面图和单段封面文字，但尚未确认是否支持独立主/副标题两层排版，属于真实候选差异。
- 新增“字幕断行所见即所得，超宽行同屏折行不再乱切”。StoryDream 已统一手动字幕、SRT、预览和剪映时间线，但需要检查超宽行的预览折行是否与导出完全一致。
- 新增“配音字幕一键补对时”。StoryDream 目前重打包会共用字幕文本和既有场景时长，尚未看到单独的音频重新对齐操作，属于候选差异。
- 新增“重跑配音可切换本地上传”。这与 1.16.1 矩阵中已延后的任务级上传配音相同，需要真实 STT/场景对齐设计，不应只加入口。
- 新增“画图实验室提示词模板”。Storybound 数据库已存在 `playground_prompt_templates`；StoryDream 需要检查 Image Lab 是否已有等价的保存、应用、编辑和删除能力。

## 1.16.x 完整公告

- 1.16.1 字幕页为每行显示序号，超过字数限制时序号直接标红；StoryDream 已有编号字幕行，但需检查是否有明确的超长诊断和定位。
- 1.16.1 创建页增加吸底操作栏与 `Ctrl+Enter` 提交；StoryDream 当前创建页需要检查键盘提交与长表单主动作可达性。
- 1.16.1 画图实验室切换页面后保留表单参数；StoryDream 的 Image Lab 当前参数主要在页面组件状态中，需要确认路由卸载后是否丢失。
- 1.16.1 的对标账号搜索、批量提取进度和 Storybound 远程账号监控绑定；StoryDream 采用本地对标导入，不复制远程账号列表。
- 1.16.0 字幕按语义断行并与语音精准同步，提供逐句编辑、一键修复问题句、复制全文到剪映“文稿匹配”；StoryDream 已有逐句编辑和统一时间线，但问题句诊断/修复与全文复制仍是候选增强。
- 1.16.0 生图步骤重跑时可补/换主角参考图；StoryDream 有任务参考图和单图重生，需要检查重生动作是否能临时覆盖参考图。
- 1.16.0 积分抵扣属于 Storybound 计费；侧栏折叠和任务治理在 StoryDream 已有更完整实现。

## 1.14-1.15 完整公告

- 1.15.0 的本地封面上传覆盖普通图文、音乐 MV、HTML 视频，并提供封面模板 hover 预览。StoryDream 当前独立封面页按前序约定只属于普通视频；不应未经确认把封面时间线语义扩散到另外两种模式。
- 1.15.0 明确优化 HTTP 402 等欠费错误为可读提示，这与用户此前遇到的远程生图金币不足直接相关；需检查 StoryDream 是否仍把上游原文简单透传。
- 1.15.0 创建页参考图支持拖拽；StoryDream 已有受管导入，需要检查是否只有文件选择动作。
- 1.14.0 在重画、重跑、替换前备份旧图并可从历史版本恢复。StoryDream 有安全替换和再生成，但是否保留版本需要代码核对。
- 1.14.0 封面查图和积分免费补捞依赖 Storybound 远程任务系统；“跳过封面先打包”在 StoryDream 可由封面页关闭状态表达，不复制远程查图。
- 1.14.0 Image Lab 单项/批量失败重试以及创建参数预设，StoryDream 在 1.16.1 矩阵审查后已经实现等价能力。

## 初步移植边界

- 优先核对：Image Lab 提示词模板、切页参数记忆、字幕问题行诊断/全文复制、`Ctrl+Enter`、HTTP 402 可读错误、素材历史版本。
- 需要更强运行时设计后再做：任务级本地配音重跑与 STT 补对时、重生时临时参考图覆盖。
- 不移植：RunningHub 私有迁移、余额/积分/买卡/分销、创作市场和远程对标账号监控。

## 源码核对初见

- StoryDream 普通任务已经通过 `task:update-subtitle-lines` 持久化逐场景字幕行，并在剪映桥接中显式携带 `captions` 与 `captionDurationsUs`；1.16.0 的“逐句编辑 + 精准时间线”核心不是缺口。
- 剪映桥接按模板 `maxCharsPerLine`、画布宽度、字号和字距计算实际每行字符上限，并对导出字幕换行；需要确认任务详情编辑器是否复用了同一上限做问题行提示，否则仍存在 UI/导出认知差异。

## 最终源码结论

- Image Lab 所有表单状态目前由 `useState` 独占，路由卸载后会丢失；页面没有提示词模板。采用与新建任务预设相同的版本化 `localStorage` 模式最符合现有架构，无需新增 IPC/数据库表。
- Image Lab 模板只保存 `mode + body + name`，应用模板不会覆盖用户已选择的比例、风格、Provider、分辨率或质量，避免一个轻量提示词模板意外改动成本参数。
- 字幕编辑器已具备行号、全文复制、重新切分和保存；当前只把空行视为错误，未标出超过 `maxCharsPerLine` 的行。新增诊断与定向修复即可补齐 1.16.x 的实用部分。
- 新建任务页没有 `Ctrl+Enter`，但所有创建动作已经汇聚到 `run()`，可在页面根节点增加键盘处理并继续复用完整校验。
- `formatOpenAiImageProviderError` 已对 HTTP 402 返回中文余额/套餐解释，明确错误来自供应商、降低质量不能绕过并建议充值或切换服务；该项已覆盖，无需改动。
- 旧图历史版本、任务级上传配音和 STT 补对时涉及资产版本治理或音频对齐运行时，本轮保持延后，不以表面按钮代替真实能力。

---

# 视觉分镜收敛与剪映路径迁移发现

- 当前 `normalizeStoryboardSceneLengths` 会把超长文本继续拆成多个 `StoryboardScene`，`isStoryboardSceneCountAcceptable` 又直接用 `scenes.length` 审核，因此镜内文本拆分被误算成新的视觉分镜。
- 当前修复链最多重试两次 LLM，返回仍超过上限时直接抛出 `Storyboard target scene count not met after automatic repair`，没有本地归并途径。
- 当前字幕链已支持一个视觉镜头拆成多个 cue，可在 `StoryboardScene` 中保留有序 `segments` 并继续复用现有 `captions` / `captionDurationsUs` 剪映桥接，无需重写 Python 导出。
- 草稿目录候选已基于当前机器的 `LOCALAPPDATA`、`USERPROFILE`、Documents 和 Videos，默认配置也已为空；但 `resolveRuntimeJianyingDraftPath` 会无条件保留任意非历史路径，即使它是从另一台电脑迁移来且本机不存在。
- 剪映程序启动路径每次都从当前机器的 `LOCALAPPDATA` / `ProgramFiles` 候选实时查找，没有持久化旧电脑绝对路径，这一部分本身具备迁移性。
- 现有 `buildSubtitleTrack` 已可在单个场景内生成多个 cue，但 cue 只从 `scene.cap` 重新语义切分；需让归并时保留的原始文本块优先作为 cue 边界。
- 路径迁移规则应区分“本机仍存在的显式路径”与“已失效的旧机路径”：前者保留，后者优先替换为新机检测值，只在无检测值时保留原文供用户修正。
- 仓库 `scripts/test.ps1` 固定执行全量 Vitest 且不转发命令行参数；聚焦验证需直接调用仓库 Vitest CLI，最终再用 `npm test` 跑全量。
- 最终差异复查确认 Python 桥接无需新增第二套片段合同：`buildSubtitleTrack` 会把 `segments` 变为带 `sceneId` 的 cue，现有 `draft.ts` 再将它转为 `captions` 与精确时长，能直接导出一镜多字幕。
- `git diff --check` 已通过；差异只涉及分镜/字幕数据合同、运行器收敛、剪映路径迁移、对应测试和本轮记录。

---

# AI 封面标题默认值发现

- 用户截图指向新建普通视频的“封面文字可选·仅显示在封面页”文本框；当前占位文字“留空则只显示封面图”与期望的 AI 标题默认行为冲突。
- `ui-ux-pro-max` 将本轮定义为桌面生产工具的窄修复：保留现有控件与密度，只修正空值语义、同步导出默认值和对应反馈文案。
- 创建页当前将 `coverPageText` 初始化为空字符串，原样写入创建请求与本地草稿；界面明示承诺“留空则只显示封面图”。
- 草稿导出链已同时拥有 AI 创作封面元数据 `input.cover.title` 和用户可选封面文字，因此默认值应在 AI 标题已生成的运行/导出边界解析，不能在创建页伪造尚未生成的标题。
- 新增共享解析合同后，空 `coverPageText` 会取实际生成的 `cover.title`，显式文字仍优先；AI 返回异常长标题时会按既有 80 字上限截断，避免草稿导出因外部响应失控。
- 任务产物预览与剪映草稿写入共用同一解析语义，旧任务只要保留空文本也会在读取已有 AI 产物时自动显示标题，无需数据库迁移。
- 创建页提示、占位符和右侧摘要已同步改为“默认使用 AI 创作标题 / AI 标题”，不再把空值描述成纯图片。
- 聚焦测试、全量 113 个测试文件共 1687 项、类型检查、生产构建和 `git diff --check` 全部通过。

---

# AI 封面重复叠字修正发现

- 用户新截图中的 AI 封面原图已经包含白色主标题和底部说明；黄色“卢武铉的一生”是应用追加的标题层，位于人物面部，构成重复信息和遮挡。
- 该封面纵向上方、人物主体和底部都已有有效内容，单纯移动黄色标题无法稳定避开不同生成图的构图，因此 AI 自动封面空值时不叠加比固定换位更可靠。
- 本地导入封面不保证自带标题，仍需要保留上一轮确认的“空值默认 AI 创作标题”语义。
- 任务模型已持久化 `coverImageMode`，创建页、产物预览和运行器都能读取，无需新增数据库字段或推断图片内容。
- 当前 React/Electron 桌面生产工具已有紧凑的封面设置区；本轮只需动态提示和状态摘要，不应增加新的开关或版式。
- `writeJianyingDraft` 是封面标题进入剪映桥接的统一边界，但目前不知道封面来源；给其现有 `coverPage` 输入增加一个可选的 AI 标题回退标记即可保持调用边界清晰。
- 产物预览直接持有完整 `Task`，可依据 `task.coverImageMode === 'auto'` 禁止空值回退；显式 `coverPageText` 仍由共享解析器优先返回。
- 创建页可在现有计算区派生提示、占位符和摘要标签，无需新状态，也不会改变表单保存合同。
- 仓库 Electron QA 提供独立 `new-task` scope，包含输出阶段桌面截图和紧凑窗口检查；输出阶段会自动启用封面页，可直接覆盖本轮动态提示所在区域。
- `new-task` Electron QA 已通过 4 个真实页面状态，报告无运行错误、对比度失败、交互重叠或裁切；输出页截图保持既有紧凑布局。
- 当前输出页 QA 在启用封面后会切换到“本地导入”验证必填态，适合在切换前追加自动封面空值提示的真实 DOM 断言。
- 已在同一 Electron 输出页流程中断言两个真实状态：自动模式为空时“不叠加文字”，切换本地导入后为空时使用“AI 标题”；QA 二次运行通过。
- 最终规则会直接作用于已有 `coverImageMode: auto` 且 `coverPageText` 为空的任务预览；重新打包草稿即可移除既有黄色覆盖层，不需要重新生成封面图片。

---

# 草稿模板数值范围与动画预览审计发现

- 用户取消底部交付栏浅色修改，本轮不改 `TaskDetailPage` 或对应 CSS。
- 上一轮共享 `RangeField` 已解决非法值归一化和原生轨道零值伪进度，但还需要审计每个调用方传入的 `min` 与默认模板值；组件正确不代表业务范围都正确。
- 动画预览已建立名称到语义族的分类，但用户要求进一步检查贴合度，需要枚举全部预设并验证方向、入场/出场和相似词的分类，而不是只测少量代表名称。
- 右侧面板共有 29 个 `RangeField`：明确允许归零的描边、透明度、字/行间距、圆角和图片边框已经传入 `min={0}`；非零下限集中在图片高度、运镜强度、四类文本框宽度、四类字号与每行字数。
- 图片高度、文本框宽度、字号和每行字数为零会产生不可见元素或无效排版，应保留正数业务下限；“运镜强度”为零具有明确语义（关闭运动幅度），是当前最需要贯通修正的非零下限。
- 运镜强度 `0.5` 下限同时存在于编辑器、模板 Zod 合同、模板归一化、画布预览、剪映桥接与 HTML 视频导出，必须统一修改，避免 UI 显示为零但保存或导出又被夹回 `0.5`。
- 完整动画预览分类函数目前按方向词、翻转、分割、弹动、形变、缩小、旋转等关键词返回有限预览族；需继续读取剩余分支、完整 `imageAnimations` 列表和 CSS 关键帧才能判断覆盖与贴合度。
- 模板校验合同允许图片高度 `0..2`，UI 却限制为 `0.1..1`；将 UI 最小值改为 `0` 与既有数据合同一致，也能明确表达高度归零。
- 文本样式合同允许字号最小 `1`，但 UI 分别硬编码 `12/10/8/8`；横屏内置模板实际含副标题 `8` 和免责声明 `5`，导致控件打开时显示值被夹高。四类字号滑块应统一最小 `1`，不是 `0`。
- 字幕每行字数合同允许最小 `1`，UI 目前最小 `4`；应统一为 `1`。零字符没有有效排版语义，不能设为 `0`。
- 文本框宽度合同与归一化都明确为最小 `0.1`，零宽会让文本层不可见且难以重新选中，应保留该下限。
- 当前动画分类顺序会丢失组合语义：`向左缩小` 只变成左滑，`向左下降` 只变成下降，`旋转上升` 只变成上升，`旋转缩小` 只变成缩小；需要新增组合预览族。
- 当前关键词还会误配或漏配：`四格转动` 被“ 四格 ”先归为分割，`魔方/坠落/跳跳糖/转入转出/波动滑出/相框滑动` 退回通用缩放，和名称不贴合。
- 现有 11 组 CSS 关键帧可作为基础，但要增加斜向下降、侧向缩小、旋转上升/下降/缩小及摇晃/波动等组合关键帧；减少动效规则已经能统一关闭新增预览。
- 当前完整分组统计显示 39 个名称回退到通用 `zoom`，其中多项名称已经明确包含坠落、翻转、波动、旋转或滑动语义；需要先处理高置信度名称，保留真正无法判断的供应商专有名称使用中性缩放回退。
- 组合预览族拟覆盖：侧向缩小、斜向下降、旋转上升、旋转下降、旋转缩小、摇晃和波动；普通方向和单一族继续复用已有关键帧。
- 第一轮实现后仅 7 个供应商专有/泛化名称继续使用中性 `zoom`，39 个通用回退已大幅收敛；组合方向和特殊高置信度名称均进入独立或更贴合的预览族。
- 剪映桥接适合把图片高度 `0` 解释为“不创建图片段”，而不是把零尺寸遮罩夹成 5%；这与右侧“显示”开关语义一致且避免底层库非法比例。
- HTML 视频当前在 `motion === ''` 时仍生成默认轻微缩放，与“关闭运镜”文案冲突；修复后无运镜或强度 `0` 都不生成背景 tween。
- 现有 `system` Electron QA 会打开模板编辑器、验证画布选层联动和四类下划线开关，但没有操作任何 RangeField，也没有触发动画按钮的 hover/focus 预览，因此此前只靠源码合同无法发现调用方非零下限或组合词误配。
- 为保持截图稳定，实景 QA 应把高度/运镜强度临时设为 `0`，同时断言滑块、数值框和 `--range-progress` 后再恢复原值；动画用键盘 focus 触发并在 blur 后确认恢复，不持久化临时预览。

---

# 背景音乐选择诊断发现

- 背景音乐有两个导入入口：系统设置中的“BGM 库”，以及新建任务输出设置“背景音乐”行末的“添加”。
- 新建任务可选项来自 `state.config.jianying.bgmLibrary`，只过滤掉空 ID 或空路径；库为空时页面只显示“无 BGM”和“添加”。
- 默认配置的 `bgmLibrary` 就是空数组，不内置示例音乐，因此首次使用必须先添加本地音频。
- 初步代码显示 BGM 条目保存的是本地音频绝对路径；需继续确认是否有受管复制，以及本机实际配置是否为空或路径失效。
- 新建任务“添加”会调用系统文件选择器，生成全局 BGM 条目，立即 `saveConfig` 并把新 ID 设为当前选择；系统设置“+ 添加 BGM 文件”也会立即持久化。
- 文件选择器支持 `mp3`、`wav`、`m4a`、`aac`、`ogg`、`flac`。
- BGM 条目只有 `id/title/path/durationMs/volume`，`path` 直接等于所选文件的原始绝对路径，没有受管复制步骤。
- 已存在的音乐按钮本身没有禁用条件；只有“添加”按钮会在任务异步操作忙碌时暂时禁用。
- 应用数据库位于 Electron `userData/storydream/data.db`；本机 Electron `userData` 目录是 `%APPDATA%\storydream`，预计完整路径为 `C:\Users\Administrator\AppData\Roaming\storydream\storydream\data.db`。
- BGM 的元数据随全局配置存入该数据库，但音频二进制未进入应用数据目录，仍依赖导入时的原始绝对路径。
- 已只读核对本机 `config.json` 和当前 `data.db/config`：两处 `bgmLibrary` 都为空数组，`defaultBgmId` 为空，当前没有任何 BGM 条目可供选择。
- 因此当前现象不是已有按钮点击失效，而是库为空时按设计只渲染“无 BGM”和“添加”。

---

# BGM 独立受管存储发现

- 用户确认希望将 BGM 放入独立文件夹，目标按应用受管复制并支持跨电脑迁移理解。
- 上一轮已证实当前配置只保存源文件绝对路径；受管复制必须覆盖系统设置和新建任务两个导入入口，并保持旧记录兼容。
- 实际 BGM 导入消费者有三个：系统设置、新建普通任务和音乐 MV；此外声音克隆也复用 `local-audio:select`，因此不能把通用文件选择器直接改成 BGM 复制。
- 当前 `BgmItem.path` 被普通剪映草稿和 HTML 动画运行时当作可直接读取的绝对路径；跨电脑方案需要保存受管文件身份，并在主进程运行时解析到当前 `userData`，不能只复制后继续永久保存旧电脑绝对路径。
- 受管目录应位于 Electron `userData/storydream` 下，与数据库同一可迁移数据根；文件名必须由稳定随机 ID 与经过白名单验证的扩展名构成，避免同名覆盖和路径穿越。
- `ConfigService` 已明确区分公开配置与 `getRuntimeConfig()`；数据库和 renderer 可保留便携的 `managed-bgm:` 路径，运行时配置再解析成当前电脑 `dataDir/bgm` 的绝对路径，避免旧用户名和盘符进入长期配置。
- 为避免新增 IPC 通道和影响命令清单，可让现有 `local-audio:select` 接受可选的 `managed-bgm` 用途：声音克隆无参数仍返回原始绝对路径，BGM 页面通过新增 API 包装获得结构化受管导入结果。
- 普通任务运行器在第 6 步会重新从数据库读取 `state.config.jianying.bgmLibrary`，不会使用 `ConfigService.getRuntimeConfig()` 中派生的路径；只在运行时配置层解析便携标识会漏掉普通剪映导出。
- 最终采用 `BgmItem.managedFileName` 作为便携身份、`path` 作为当前机器可直接使用的绝对路径；应用启动时按 `managedFileName` 重写 `path` 到当前 `dataDir/bgm`，与剪映目录跨机重检策略一致。旧条目没有该字段时保持原绝对路径。
- 当前设置页“移除”最终仍通过统一 `ConfigService.save` 落库；在该保存边界对比前后受管文件名，可做到配置成功后只清理不再被任何条目引用的应用自有文件，同时绝不删除旧条目的用户源文件。
- 全量测试确认新增 `managedFileName` 不影响普通剪映草稿、HTML 视频任务、运行器和旧绝对路径配置；三个入口的命令所有权也已从通用选择器迁到受管导入。

---

# 模板与配音交互修复发现

- 草稿模板启动快照只加载 `DraftTemplateSummary`，只含名称、画布尺寸和时间戳；`bootstrapToState` 用内置模板补齐其他字段。
- 模板编辑器打开后会调用 `getDraftTemplateDetail`，因此内部显示完整持久化数据；列表卡片直接渲染摘要补齐值，造成“内部已修改，外部仍是默认样式”。
- 任务详情已有按选中模板懒加载完整详情的模式；模板管理页缺少对等的列表详情缓存。
- Electron 下保存模板会返回并广播带修订号的 `draft-template-upsert`，全局状态合并逻辑本身能正确替换同 ID 模板。
- 共享 `RangeField` 目前直接使用 Chromium 原生 `input[type=range]` 和 `accent-color`；原生轨道在最小值时仍会从起点绘制到拇指中心，因此数值为 0 仍可见一小段蓝色。
- `RangeField` 没有对非有限值、超出 `min/max` 的旧模板值或 number 输入的临时空值做视图归一化，这会让个别滑块由受控值卡在边界或变成无效状态。
- 草稿画布目前只预览 `image.motion` 运镜动画，`image.animation` 的剪映入场效果只作为按钮选项保存，没有任何画布预览样式。
- 通用 `SegmentedControl` 只暴露选择回调，为一处增加悬停预览会扩大共享 API；更合适的窄修复是为动画效果单独封装预设选择器。
- 用户最新 BGM 截图显示深色任务交付栏中的原生 `select` 展开后，未选项是浅色背景配浅色文字；根因是应用主题与系统下拉菜单的 `color-scheme`/`option` 前景背景未同步，不涉及 BGM 数据或选择状态。
- `ui-ux-pro-max` 将这些改动归类为桌面生产工具的窄 UI 修复：保留现有控件、密度和主题 token，只补齐加载/错误/选择/试听状态、键盘焦点、减少动效和深浅主题可读性。
- `VoiceLabPage` 已通过 `generateVoiceLabPreview` 生成真实音频，历史记录也已有原生播放器；“能试听”无需新增后端，只需让扩展后的音色选择继续进入同一生成接口。
- 豆包完整音色分页加载已在设置页实现，依赖 AK/SK 的安全引用；配音实验室当前没有接入该动态列表，也没有搜索、加载或错误状态。
- MiniMax 当前静态目录只有 4 个内置音色，克隆音色会从 `state.minimaxCloneVoices` 合并，需扩展内置目录同时保留克隆去重逻辑。
- BGM 控件是 `TaskDetailPage` 内原生 `select`，现有 CSS 只设置了关闭态文本色和透明背景；应在该任务交付作用域内设置 `color-scheme`，并显式给 `option` 使用 shell 表面与文字 token。
- 动画预览分类中的多个正则使用字符类，导致只要名称包含“转”“方”等任一字符就可能误归类；应改为完整词组交替并补充防误命中测试。
- `volcengine:speakers:list` IPC 会在主进程用 `accessKeyIdSecretId` 和 `secretAccessKeySecretId` 解析安全存储；配音实验室只需根据当前 TTS 档案传稳定的密钥引用 ID，无需读取或复制明文密钥。
- 豆包加载失败时不应清空目录：动态分页结果与内置兜底音色按 `voiceType` 去重合并，用户仍可试听已知音色；页面显示加载错误并允许重试。
- renderer 的 `state.secretStatus` 可判断当前 TTS 档案 AK/SK 是否存在；`config-secrets.ts` 已定义稳定的 `tts/{profileId}/volcengine/...` ID，配音页可在请求前给出“到设置配置”的明确状态而不接触密钥值。
- 本地实验室现有布局是左侧控制、右侧历史记录；完整音色目录应继续留在左栏内部，采用搜索 + 计数 + 有界滚动网格，紧凑窗口改单列，避免大量 chip 把生成按钮挤出可视区。
- 现有 UI 测试主要做源码合同断言；需增加纯函数测试覆盖动态豆包合并、MiniMax 目录扩展和搜索过滤，再更新页面合同断言。
- 2026-08-06 尝试访问 MiniMax 官方文档检索入口时本机无法连接外网；本轮采用项目当前同体系的 MiniMax T2A 经典 18 个系统音色清单，并通过集中常量和克隆音色动态合并保持可维护性，不声称覆盖供应商未来新增项。
- 豆包 `ListSpeakers` 按 `ResourceIDs` 返回资源内音色；配音实验室应加载 `seed-tts-2.0` 与 `seed-tts-1.0` 两个当前生成链已支持的资源目录，再分页去重合并。
- 仓库 Electron QA 的 `labs`、`system`、`task-operations` 三个 scope 分别覆盖配音实验室、草稿模板和任务交付区，并包含深浅主题与紧凑窗口证据。
- Chromium/Electron 的原生 `select` 弹出菜单不属于页面位图合成层，自动截图通常只能验证关闭态；打开菜单可读性以作用域内 `color-scheme` 加显式 `option` 前景/背景合同为主要回归证据。
- `labs` Electron QA 首轮通过，配音页四张深浅/桌面/紧凑截图均为 0 对比度失败、0 交互重叠；未配置豆包列表 AK/SK 时提示与 5 个兜底音色可读。
- 首轮 `voice-lab` QA 停留在默认豆包状态，尚未把 MiniMax 18 项目录的有界滚动布局纳入位图证据；需在该视图的 QA 交互中切换 MiniMax 后复跑。
- 补强后的 `labs` QA 会切换 MiniMax、验证 18 项、搜索“有声书”得到 4 项并清空恢复 18 项；二次 QA 全部通过。
- MiniMax 深色桌面与浅色紧凑截图显示 `18/18`，音色网格使用独立滚动区，卡片与文字无溢出，语速区仍可通过左栏滚动到达。
- `system` Electron QA 通过，草稿模板编辑器的画布、滑块和动画预设区在深浅/桌面/紧凑状态均无运行、对比度或布局失败。
- `task-operations` Electron QA 通过，BGM 关闭态在深浅主题下前景、边界和应用状态清晰；打开态由 `color-scheme`/`option` 合同覆盖。
# Storybound 与 StoryDream HTML 动画逐页差异审查发现

## 2026-08-06 基线

- 当前 StoryDream 分支为 `codex/storydream-local-hardening`，HEAD 为 `7dc287e fix: repair HTML video effects and diagnostics`。
- StoryDream 已有 `.artifacts/html-video-ui-current`，包含创建、编排、封面、字幕、成功、失败、桌面和紧凑窗口截图，可作为当前实现的真实渲染证据。
- Storybound 既有审查确认本机 1.17.0 beta，历史静态资源位于 `.reverse/storybound-latest-assets`，其中包含多版 `HtmlVideoPage` chunk；需以当前入口或已运行页面截图筛选，不能把目录内所有历史 chunk 当成当前功能。
- 这次审查属于桌面生产工具诊断：评价主轴是 `orient -> select -> inspect -> edit -> verify -> continue`，视觉密度、固定工作区和状态连续性优先于装饰性。

## Storybound 1.17.0 壳层截图证据

- 真正的 Storybound 当前截图为 `C:\tmp\storybound-current-audit\page-1.png`；`.artifacts/html-video-storybound` 是 StoryDream 历史 QA 目录，不能作为竞品截图。
- Storybound 使用稳定三栏：左栏品牌、创建入口、最近任务和积分；中栏当前模块导航与配置状态；右栏当前配置详情。最近的 `[HTML]` 任务在任意系统设置子页仍可直接进入。
- 顶部只保留当前页面标题、保存状态和系统窗口控制，任务入口与配置入口不争抢同一工具栏；“已配置/待配置/使用中”状态通过紧凑语义色直接扫描。
- 这种壳层对 HTML 动画的实际价值是任务连续性：用户从配置 API、创建 HTML 任务、回到最近任务的路径始终在同一视觉坐标。StoryDream 需重点比较任务选择器是否提供同等连续性，而不是照搬暗色或绿色描边。

## 当前采集条件

- `E:\Storybound\storybound.exe` 存在，修改时间为 2026-07-31；当前没有 Storybound 进程，也没有 9220-9230 范围的调试端口监听。
- 前次 WebView2 采集的一次性脚本已清理，只保留设置页和公告审查 JSON；需要重新用本地调试端口启动应用并重建只读页面遍历。
- 采集范围限定为打开现有 `[HTML]20260622 · 职场红线` 任务、HTML 新建任务入口和可见子页；不点击生成、重跑、购买、删除或保存动作。

---

# 草稿模板与图片实验室交互修复发现

## 2026-08-06 用户补充症状

- 图片复制操作无法得到可粘贴的图片。
- 图片页某些下拉选择会在选择后自动恢复旧值，需检查异步草稿恢复、Provider/模型联动和持久化写回顺序。
- “参考图编辑”弹窗缺少参考图选择位置，现有工作流无法在弹窗内补选或替换输入图。
- UI 交互合同：显式用户选择优先于后台恢复；参考图选择与编辑提交必须使用同一个权威引用；复制成功必须以真实剪贴板写入为准。

## 图片页面范围确认

- `ImageLabPage` 最近生成卡片只有“复制任务 ID”，实现为 `navigator.clipboard.writeText(taskId)`；这不是用户所说的“复制图”。
- 仓库现有任务图片工作流明确包含“参考图编辑 / 复制图 / 粘贴图”，用户的三个新增症状应定位到普通任务详情的图片标签与其 IPC，而不是 Image Lab 最近生成卡片。

## 任务图片工作流根因

- `TaskArtifactPreview` 的“复制图”只执行 `setCopiedSceneId(scene.id)`，没有调用 Web 或 Electron 剪贴板；它实际上只是页面内“借用另一分镜图片”的源选择器，按钮文案与用户预期不一致。
- 参考图编辑弹窗的 `editor` 状态只有 `sceneId/mode/text`，UI 仅渲染提示词 textarea；补充参考图由主进程在用户点击“开始编辑”后才弹系统文件选择器，弹窗内看不到当前参考图，也没有选择/移除位置。
- 修复方向：新增主进程图片剪贴板命令，复制成功后再设置页内粘贴源；参考图编辑状态显式持有补充图路径，弹窗显示当前分镜图并提供添加/移除入口，提交时一并传给主进程。
- 普通桌面下 `.task-detail-main` 是图片标签的实际滚动容器；运行中任务每 1.5 秒刷新产物快照，当前没有记录/恢复该容器的 `scrollTop`。快照导致内容短暂收缩时，浏览器会夹低滚动位置，后续内容恢复也不会回到用户位置。
- 滚动修复应只围绕后台 snapshot 提交保存与恢复 `.task-detail-main.scrollTop`，不能在用户主动切标签、选场景或打开弹窗时强制滚动。

## 图片工作流实景验收设计

- 现有 `task-detail-borrowed-image-desktop` 已有 12 个分镜、8 张真实临时 PNG 和一个借图状态，适合在隔离 userData 中完成复制/粘贴/弹窗/滚动联合回归。
- 场景需先暂停运行任务解除图片编辑锁；复制第 1 张成功后再粘贴到第 3 张，等待快照刷新为“借 #1”，此时检查 `.task-detail-main.scrollTop` 才能证明轮询/变更后不回跳。
- `copyTaskImage` 只有在主进程写入并回读非空 Electron `NativeImage` 后才 resolve，因此渲染层成功通知可以作为真实图片剪贴板证据，而非仅验证按钮点击。
- 现有场景只展示第 2 张借图卡片和操作浮层，没有点击“复制图”、没有验证通知或第 3 张粘贴结果，也没有打开参考图编辑弹窗。
- 参考图弹窗无需触发系统文件选择框即可验收入口：检查 `.image-gallery-reference-editor`、`img[alt="当前分镜参考图"]` 和可用的“添加参考图”按钮，然后关闭弹窗，避免 QA 依赖外部文件选择交互。
- 首轮 Electron 联合场景已越过 `taskImageWorkflowReady` 强制断言，证明复制、粘贴、滚动和弹窗动作全部完成；随后仅在通用截图证据阶段发现粘性任务工具栏遮住已滚出视区的图片工具按钮。
- 场景证据应把“动作过程状态”和“最终截图状态”分开：先在非零滚动位置完成误差断言，再把容器归位到顶部并用 `focus({ preventScroll: true })` 展示借图卡片操作面板，避免制造与产品无关的遮挡失败。
- 图片卡片等高计算原先先经过 `visibleElement`，这会把视口外但正常参与网格布局的卡片排除；滚动位置变化后可能没有两张当前可见卡片共享一行，得到 0 行。改为以 `offsetParent !== null` 判断挂载与布局，行高证据不再依赖截图滚动位置。

## 草稿模板 Electron QA 定位

- QA 当前连续给“高度占比”和“运镜强度”两个 React 受控滑块派发 `input`，中间未等待第一个状态提交；第二次事件可能从旧模板闭包计算并覆盖第一个值。
- QA 把 `--range-progress` 严格比较为字符串 `0%`，应改为 `Number.parseFloat(...) === 0`，避免计算样式序列化差异造成假失败。
- 修复策略是逐个设置、逐个等待滑块与数值框同步，再统一恢复原值；若仍失败，再把各控件实值写入 QA 错误证据。
- `RangeField` 对传入值先执行有限数与上下限归一化，目标“高度占比”和“运镜强度”的 UI 下限都已经是 `0`，因此没有发现产品组件把零值夹回正数的路径。
- Electron 注入此前只派发 `input`；将范围控件改为同时派发 `input` 和 `change`，并记录每一步的 `min/range/number/--range-progress`，用于区分 React 事件未触发与组件值错误。
- 第三次 QA 的诊断数组为空；检查 `Accordion` 后确认关闭状态直接卸载 children，而“运镜”默认关闭，因此 `运镜强度滑块` 在 QA 查询时不存在。实景脚本必须先显式点击展开“运镜”，再验证零值。

---

# HTML 动画预览工作台重设计发现

## 2026-08-06 API Image 设计稿

- 设计稿输出为 `outputs/html-video-animation-preview-redesign.png`，输入图只作为现状与构图参考，没有作为逐像素编辑目标。
- 可落地的核心结构是“中央实时预览 + 右侧紧凑属性检查器 + 底部横向场景胶片条”；它让首屏同时容纳预览结果、当前参数和场景顺序。
- 字幕、镜头和转场保持同一检查器内的分组，保存动作靠近各自设置；不再让字幕设置占用独立大列。
- 主预览只保留一套播放与显隐控制，场景缩略图承担选择、顺序、时长和完成状态，避免单张缩略图悬在参数区与主预览之间。
- 滚动合同：工作台主体固定在可用高度内，右侧检查器在内容超高时独立滚动，底部胶片条只横向滚动；页面不产生第二条纵向滚动条。
- 图片模型生成的少量中文存在失真，只采纳布局、密度和层级，不采纳其文案或虚构按钮；实际实现继续使用现有 React 状态、标签和设计 token。
- 实际 Electron 验收表明 1320x860 与 920x720 下主 WebView 都完整位于首屏，检查器与胶片条位置关系正确，document、工作台和动效区横向溢出均为 0。
- 右侧检查器是本页唯一纵向内容滚动区；桌面溢出 108px、紧凑窗口溢出 248px，主预览和胶片条不随参数滚动消失。
- 桌面宽度可直接容纳 QA 的全部场景时胶片条无需滚动；紧凑窗口产生 41px 横向溢出并由胶片条自身承接，不扩大页面宽度。
- 镜头小样使用当前场景真实缩略图，并按 `auto/none/zoom_in/zoom_out/zoom_pan_up/zoom_pan_down/pan_left/pan_right` 映射 CSS 动画；转场仍用两个不同真实缩略图。
- 24 个版式弹窗回归继续通过，双人对话示例的 5 层动画在桌面和紧凑窗口均运行且像素帧发生变化。

---

# HTML 动画前后景提示词复刻发现

- Storybound 逆向规划函数会把横/竖屏方向、全部版式说明和各版式 `elementSlots` 数量注入 system prompt；当前 StoryDream 只有一句泛化要求，没有合法版式清单或槽位约束。
- 逆向合同要求 `background.prompt` 描述氛围背景、空间感和旁白情绪且不写文字；`background/elements` 都不能写画面风格，`elements` 也不能写透明背景说明。
- Storybound 前景生成阶段才追加“纯透明背景 PNG，主体居中，无背景”，并固定用 `1:1`；背景使用任务横竖画幅。
- Storybound 背景提示词为 `style.prefix + 内容 + style.suffix`，前景为 `style.prefix + 主体 + 透明 PNG 运行时后缀`；干净内容提示词留在场景数据中供编辑和重生。
- Storybound 提供单张和批量 `remove_background`；支持 BiRefNet、ISNet、U2Net，本地会检查透明通道并跳过已经透明的前景。
- 当前 StoryDream 让 LLM 主动把“透明背景 PNG”写入 `elements[].prompt`，同时在适配器再次补后缀，职责重复且污染用户可编辑提示词。
- 当前 StoryDream 背景和前景放在同一批通用出图请求里，共用任务画幅；前景不是 `1:1`。
- 当前图片 Provider 只发送 `ImagePrompt.prompt`，虽然 HTML 适配器构造了 `negativePrompt` 和 style ID，但没有把选中风格的 prefix/suffix 注入实际请求。
- 当前仓库没有前景 Alpha 通道检查或去背景实现，因此提示词声称“透明 PNG”不等于素材真的透明。
- 当前 24 个 HTML 场景模板的 `choreography.elements.length` 已是可复用的素材槽合同；规划 prompt 可直接列出模板 id、中文说明和 slot 0..N-1，无需维护第二份手写数量表。
- 当前 `createConfiguredImageGenerator` 每次调用只接收一个任务画幅，OpenAI 兼容和即梦路径都从该画幅计算尺寸；要复刻前景 `1:1`，资产适配器必须按背景/前景分成两次 Provider 调用，再按 synthetic id 合并结果。
- 当前 Electron 安装包没有 Sharp、PNGJS、ONNX Runtime 或背景移除依赖；抠图不能通过已有包实现，需要引入受控依赖/模型或做参照软件同样的“模型可用性检测 + 明确配置入口”。
- 素材页已有每张资产的操作栏和 checkerboard 前景容器，适合加入真实透明状态及单张去背景按钮；现有主进程已有替换、重生和预览重建边界，可在同一治理事务中原子替换抠图结果。
- 逆向版式把素材槽定义为独立 `elementSlots`；“满屏金句”和“全屏大图”明确为 `[]`。当前本地模板的 `choreography.elements` 是动画 cue，不能直接等同于素材槽，需新增独立 `materialSlots` 元数据。
- 默认 `modern-film` 等风格已完整保存 prefix/suffix/negativePrompt；自定义风格也在 `custom_styles` 表中，但 FileDatabase 尚无按 ID 读取方法。增加只读详情方法并传入 HTML runtime 可覆盖默认与用户自定义风格。
- 当前素材编辑的重生路径会重新走 `createHtmlVideoRuntimeProviders`，因此一旦风格和前景画幅在该边界统一修正，首次批量生成与单张重生可以保持同一合同。
- 逆向素材页会在用户数据 `models` 目录依次识别 `birefnet-lite.onnx`、`BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx`、`isnet-general-use.onnx`、`isnet-anime.onnx`、`u2net.onnx`、`silueta.onnx`、`u2netp.onnx`，并映射到 BiRefNet、ISNet、U2Net 三种推理预处理。
- 进一步检查发现项目 `vendor/python` 已包含 Python、Pillow、NumPy 与 ONNX Runtime；此前“安装包没有 ONNX Runtime”的判断只检查了 Node 依赖，结论不完整，现可直接复用现有 Python 运行时实现本地抠图。
- 现有前景生成会把透明后缀写入 `HtmlVideoAsset.prompt`，导致编辑/重生使用被污染的运行时提示词；资产应只保存规划阶段的干净主体描述。

---
# 草稿字体样式选择发现

## 用户要求

- 草稿里的字体样式不能只有默认值，需要提供可选项。
- 选择必须真实影响草稿，而不只是增加一个无效下拉框。

## 已确定范围

- 产品模式：桌面内容生产工具。
- 变更类型：现有草稿工作流中的窄功能增强。
- 设计证据优先级：用户要求、现有草稿状态与控件、现有主题和测试合同。
- 待定位：字体字段现状、普通任务草稿调整区、任务预览、剪映文本片段写入边界。

## 第一轮源码发现

- 技术栈为 React 19 + Electron 41 + TypeScript，现有图标库为 `lucide-react`。
- 草稿排版的共享模型是 `DraftTemplate`，内置模板和向后兼容归一化集中在 `src/shared/templates.ts`。
- 普通任务运行器按任务 `templateId` 查找并归一化模板，再把模板交给草稿导出链；因此字体选择应落在模板/任务草稿设置，而不能只停留在页面局部状态。
- 大型 Coze JSON 样本会污染全文字体检索，后续只检索 `.ts`/`.tsx`/`.css` 和聚焦测试。

## 草稿界面链路

- 普通任务详情 `TaskDetailPage.tsx` 只维护候选/已应用模板 ID，并通过 `api.updateTaskTemplate` 保存。
- 任务产物预览 `TaskArtifactPreview.tsx` 复用草稿模板画布 `DraftTemplatePreview`，不是独立的文字渲染实现。
- 草稿模板编辑器位于 `src/features/templates/DraftTemplatesPage.tsx`，画布渲染位于 `DraftCanvas.tsx`；字体控件应复用这套属性编辑器，避免在任务详情创建第二套模板状态。
- 仍需确认 `DraftTemplate` 是否已有字体字段，以及剪映导出是否读取该字段。

## 字体合同初步证据

- `task-operations-ui` 中的 `titleFontFamily` 是 Electron QA 对应用壳层字体的检查，不代表草稿模板已支持字体选择。
- 现有草稿归一化、草稿生成和剪映桥接测试只断言 `fontSize`、颜色、粗体、下划线、间距、描边等字段，尚未出现草稿 `fontFamily` 合同。
- 仓库不存在假定的 `tests/draft-templates.test.ts`；后续从实际测试文件列表选择模板页面与归一化测试。

## 根因与模型边界

- `DraftTemplate` 的标题、副标题、字幕、免责声明是四份独立文字样式，当前都没有字体字段。
- 模板属性栏为四个文字区分别提供字号、颜色、粗体、下划线、对齐、字距、行距和描边，因此字体也应按文字区独立选择，符合现有编辑模型。
- `DraftTemplatePreview` 的文字样式辅助函数没有输出 CSS `fontFamily`，所以当前预览始终依赖应用默认字体。
- `draft.ts` 生成的覆盖层和 `jianying-bridge.ts` 的 Python `TextStyle` 目前只传字号等属性，字体选择尚未进入最终剪映草稿。
- 兼容方向：四个文字样式新增受控字体 ID/名称，归一化为旧模板填入当前默认值；画布用 CSS 字体栈，剪映写入对应字体名称。

## 数据合同细节

- `draft-template-contract.ts` 使用严格 Zod 对象，新增字段必须进入 `textStyleShape`，否则模板保存时会被 `.strict()` 拒绝。
- `normalizeDraftTemplate` 已按四个文字区逐层归一化，适合在这里把旧模板缺失字体字段回退到内置默认。
- 内置四个基础文字样式集中在 `templates.ts` 顶部，可统一赋予兼容默认字体，避免每个模板重复配置。
- 剪映脚本当前构造 `draft.TextStyle(size=...)`，仓库内未直接发现字体参数用法；需要继续读取本地 Python 依赖或库签名后再接入。

## 属性面板位置

- `DraftTemplatesPage.tsx` 的主标题、副标题、字幕、免责声明分别位于可折叠属性面板，已有一致的 `<Field><select>` 控件模式。
- 字体选择放在各面板“字号”之前，可与文字排版属性就近排列，不新增页面层级或浮动容器。
- 四个面板已经通过各自 `updateDraftTitle/Subtitle/Caption/Disclaimer` 更新权威 `draft` 状态；字体字段可沿用相同更新路径，未保存编辑的保护逻辑保持不变。
- 项目内置 Python 运行时和 site-packages，可通过本地反射确认 `pyJianYingDraft.TextStyle`，无需猜测外部 API。

## 剪映字体 API

- `pyJianYingDraft 0.2.6` 的 `TextStyle` 不接收字体参数；字体属于 `TextSegment(font: Optional[FontType])`。
- `TextSegment` 会把 `FontType` 对应资源 ID 写入草稿文字素材；因此 Python 桥接必须在创建标题、字幕等片段时传 `font=`，而不是塞进 `TextStyle`。
- 桥接应按受控字体 ID 从 `draft.FontType` 查找枚举；缺失或未知值返回 `None`，对应剪映系统字体并兼容旧草稿。
- 前端需要一份稳定的字体目录：显示名、CSS 字体栈、剪映 `FontType` 枚举名三者一一对应。

## 字体目录决策

- 首版提供 6 个用途明确的选项：系统默认、现代黑体、经典宋体、温润圆体、文艺楷体、醒目标题。
- 剪映免费资源映射候选：`HarmonyOS_Sans_SC_Regular`、`宋体`、`圆体`、`LXGWWenKai_Regular`、`得意黑`；这些 `FontType` 元数据均标记为非会员资源。
- CSS 预览使用 Windows/macOS 常见中文字体栈近似对应；选中后画布立即变化，最终剪映使用精确资源 ID。
- `system` 保持 `TextSegment.font=None` 和当前应用默认 CSS 字体，是旧模板与旧成片的兼容值。

## 实现契约

- 字段命名为 `fontFamily`，值是受控 `DraftFontFamily`；`system` 表示沿用系统字体，其余值直接对应 `pyJianYingDraft.FontType` 枚举名。
- 标题、副标题、字幕和免责声明分别保存 `fontFamily`；封面标题从主标题样式派生，应继承主标题字体。
- 画布样式由共享字体目录解析 CSS 字体栈；保存合同由 Zod 枚举限制；Python 对未知值仍防御性回退系统字体。
- 字幕无论是否启用背景/描边，都应通过 `TextSegment` 样式模板导入，才能复制 `font` 资源。

## 最终核对

- `ScriptFile.import_srt(style_reference=...)` 内部调用 `TextSegment.create_from_template`，会深拷贝模板的 `font`，字体可覆盖全部字幕片段。
- `resolveOrdinaryTaskCoverTitle` 展开 `template.title` 后只覆盖位置、字号等字段，因此新增 `fontFamily` 会自然继承到封面标题。
- `draftTextLayerStyle` 只有画布与一个聚焦单测调用；扩展其 Pick 和返回 CSS 字体族影响面可控。
- 源码中没有其他直接构造完整 `DraftTemplate` 的生产对象，内置模板基类加默认值即可覆盖主要生产路径；类型检查负责捕获测试夹具遗漏。
- 字体字段随现有 `DraftTemplate` JSON 进入数据库，无需新增表列、任务字段或 IPC；模板保存和任务应用流程保持原样。

## 首轮实现反馈

- 生产 TypeScript 未报错；错误集中在直接构造 `PyJianYingBridgeInput` 的旧测试载荷和画布样式测试夹具。
- `DraftTemplate.fontFamily` 保持必填，保证保存后的模板完整；`PyJianYingBridgeInput.fontFamily` 设为可选，允许旧桥接 JSON 继续由 Python 回退到系统字体。

## 测试策略

- 字体目录测试验证 6 个唯一受控值、CSS 字体栈和四层属性面板入口。
- 归一化/合同测试验证旧模板缺字段回退、有效字体保留、非法值回退或保存拒绝。
- 画布测试验证非默认字体确实生成对应 CSS `font-family`。
- 剪映桥接测试验证载荷保留四层字体，并生成 `font_from_config`、`TextSegment(font=...)` 与字幕 `style_reference` 路径。

## 实景验收复用

- `electron/editorial-qa.ts` 的 `system` 范围已覆盖草稿模板编辑器的桌面/紧凑窗口、画布选层、下划线、零值滑块、保存与重新打开。
- 字体验收将加入同一草稿场景：切换主标题和字幕字体，读取对应 `<select>` 值与画布计算 `fontFamily`，保存后重新打开再核对持久化值。
- 现有 QA 会同时检查横向溢出、主控件裁切、交互遮挡、对比度和截图媒体区域，适合验证新增下拉未破坏紧凑布局。

## 实景验收结果

- `system` Electron QA 四个草稿模板场景全部通过：深色/浅色 × 1440×900/1080×720。
- 四个场景的 `draftFontSelectionReady`、选层、下划线、零值滑块和动画预览状态均为 `true`。
- 原始截图检查未发现文字重叠、控件裁切、横向溢出或检查器挤压；主标题与字幕在画布上呈现不同字体特征。
- QA 产物位于 `C:\Windows\TEMP\storydream-editorial-artifacts-lMtlFA`。

## 首轮全量测试反馈

- 118 个测试文件中 116 个通过；8 个桥接失败来自测试注入的精简 `pyJianYingDraft` 没有 `FontType`，提示桥接还需兼容旧模块能力缺失。
- 另一个运行器失败表现为自定义模板未被采用并回落默认模板，正在核对其保存夹具是否缺少必填字体字段。

## 兼容修正结论

- 精简/旧版剪映模块不仅可能没有 `FontType`，其 `TextSegment` 也可能不接受 `font` 关键字；桥接仅在成功解析字体资源时动态加入该关键字。
- 运行器失败不是字体保存问题：测试创建的任务默认比例为 `9:16`，自定义模板图片比例为 `4:3`；最新上游 `draftTemplateMatchesRatio` 会按设计回退默认模板。测试应明确任务为 `4:3`。

## 剪映成片链路复核

- HTML 动画是独立链路，不属于草稿字体功能范围；复核期间未对 `src/shared/html-video.ts` 或其测试留下改动。
- `TextSegment.export_material()` 会把 `FontType` 的 `resource_id` 写入 `draft_content.json` 的 `materials.texts[].content.styles[0].font.id`，轨道片段引用该文字素材；这是剪映预览与最终导出视频读取的字体字段。
- 使用仓库内置 `pyJianYingDraft 0.2.6` 生成真实临时草稿后，5 个非默认字体均写入有效资源 ID；通过 `style_reference` 导入的 SRT 字幕同样继承了宋体资源 ID `6740513279296147982`。
- 聚焦 3 个测试文件、36 项测试与 `npm run typecheck` 通过，`git diff --check` 通过。

---
# 普通视频多源素材工作流设计发现

## 2026-08-08

- `ui-ux-pro-max` 适用于本轮桌面生产工具设计，要求先映射完整工作流、状态所有权和同步关系，再讨论视觉样式。
- `design-taste-frontend` 明确不适合作为多步骤产品 UI 的主方法；本轮只采用其审计现有品牌、保持形状/颜色一致、补齐加载/空/错/禁用状态以及避免模板化装饰等约束。
- 初步设计方向是稳定的场景素材工作区，而不是单独增加三个入口卡片；图片、上传视频、素材库视频和 AI 视频应在同一场景级素材模型下被选择、替换和验证。
- 新建任务当前只有 `materialSource = ai | local`，界面语义是“AI 生图 / 本地人物素材”，执行摘要和服务就绪检查也只覆盖图片服务。
- 普通任务 `PipelineArtifact` 与 `TaskArtifactSnapshot` 只有 `assets.images`，`StoryboardScene` 只定义文案、提示词和目标时长，没有媒体类型、来源、片段入点或裁切策略。
- Runner Step 4 目前在 AI 生图和本地人物图片复制之间二选一；失败补位也只会借用相邻图片。
- 任务详情的场景图片卡片已预留“生成视频”按钮，但被禁用并提示需要独立图生视频服务；这是场景级视频替换入口的现有产品证据。
- 单纯点亮“生成视频”按钮不够，底层必须先把 `assets.images` 提升为统一场景媒体资产，否则本地视频、随机视频、AI 视频无法共享选择、预览和剪映导出合同。
- 当前配置与 IPC 中没有普通任务视频生成 Provider；视频生成需要独立能力状态、模型配置、费用/耗时反馈和失败语义，不能伪装为图片服务的一个按钮动作。
- 剪映草稿输入当前是 `generatedImages` / `images`，场景时长取计划时长与旁白时长的较大值；接入视频后必须明确源视频时长不足时的循环/补帧/回退，以及源视频更长时的入点和裁切策略。
- 人物素材库当前只接受图片，仓库没有普通任务本地视频导入 IPC；视频素材应建立独立“视频素材库”，不要把视频塞进人物图片目录。
- UI 数据库对桌面创作工具的首选是三栏工作区、上下文检查器、克制中性色和语义状态色，和现有产品结构一致。
- 数据库同时给出短视频编辑器的暗色高动效方案，但它与用户现有产品行为和视觉体系冲突，按证据优先级舍弃，不为新能力切换整页视觉语言。
- 场景选择必须从稳定 ID 同步媒体预览、来源状态和检查器；鼠标选择不抢输入焦点，生成/导入错误在对应场景就地显示并提供重试或更换来源。
- 现有任务详情“图片”标签在 1440×900 下已经是 4 列高卡片，每卡拥有重新生成、改提示词、参考图编辑、替换、素材库、复制/粘贴、预览等动作；继续追加视频操作会造成动作面板过载。
- “图片”标签应升级为“画面”，保留场景概览和批量工具，但单场景视频来源、预览、裁切、生成状态与错误恢复应进入稳定的场景检查器。
- 当前浅色任务页中的媒体卡使用深色预览面板，这是现有视觉语言的一部分；新设计应复用其媒体预览对比，不把整页改成暗色编辑器。
- 现有主题已经提供 `--shell-*` 语义变量、红色品牌强调和以 4-6px 为主的桌面控件圆角；新方案不需要引入新组件库或新 token 体系。
- 最终方案采用任务级默认策略和场景级权威媒体两层结构，避免把任务创建页变成逐镜头编辑器。
- 本地视频随机分配使用合格候选过滤、任务内去重和持久化随机种子；AI 视频采用候选后确认，任何失败都保留当前图片或视频。
- 剪映交付在导出时冻结素材快照，场景媒体变更后把已有草稿标为需要重新生成，保证预览和最终草稿一致。

---
# 普通视频场景媒体设计图生成发现

## 2026-08-08

- 参考截图为 1440×900 的 StoryDream 任务详情，左侧约 235px 固定导航，顶部任务标题、任务操作和 7 步流程条是必须保留的产品识别结构。
- 当前“图片”标签下直接显示 4 列深色媒体卡；设计图将保留浅色壳层和深色媒体对比，只把该区域替换为场景列表、视频预览和来源检查器。
- `API_IMAGE_BASE_URL`、`API_IMAGE_API_KEY`、Codex root 配置和参考图均已确认存在，不需要写入或修改任何密钥配置。
- 最终图片为 2048×1152 PNG、2,410,414 字节，像素检查非空。
- 设计稿保留 StoryDream 左侧导航、顶部任务头、流程条、浅色壳层和红色强调，并把“画面”区域实现为场景列表、真实视频预览和来源检查器三栏结构。
- 本地视频、生成中 64%、视频已就绪、待分配、候选素材、随机换一个、从电脑导入、裁切与适配、原声静音等关键状态均在首屏可见。
- 图片没有布局重叠、横向裁切、卡片嵌套、整页暗色或营销式装饰；少量顶部小字号文字存在生成模型字形漂移，但核心界面文案与工作流清晰。

---

# 普通视频分镜画面就地替换设计发现

## 2026-08-08

- 用户最新产品语义高于先前推导：任务级图片/混合/视频策略和三栏场景媒体工作区均废弃，不能作为后续实现依据。
- 权威流程是“正常生成图片 -> 单分镜替换画面 -> 当前图片或视频进入剪映草稿”。视频不是任务类型，也不是需要用户预先选择的链路。
- 现有深色分镜卡片已经提供最自然的上下文入口；在“重新生成”旁增加“替换画面”，比改造全页信息架构更符合现有操作习惯。
- 替换菜单应只包含上传本地视频、从视频素材库选择、随机匹配视频和 AI 生成视频；高级裁切、模型和生成进度仅在选择相应动作后渐进展开。
- 原图片是持久回退，不因视频上传、生成、失败或采用而删除；“恢复图片”不重新调用图片服务。
- 新设计图为 2048×1152 PNG、2,367,423 字节、SHA256 `C1E977FDFED1C48993AEB09372867565587C55B84F92370BC8197B6F809B597F`。
- 原始分辨率检查确认页面仍位于“生成图片”步骤，图片与视频卡片同列共存，替换菜单锚定单张分镜卡片，核心中文操作可读且没有布局重叠。

## 实现与真实界面验收补充

- 真实 Electron 桌面场景已完成 H.264 素材入库、采用、900ms 入点保存、恢复原图与随机再次采用，`sceneVideoWorkflowReady=true`。
- 通用对比度扫描原先把无文字的 `input[type="range"]` 当作文本输入，产生 1.08:1 伪失败；扫描现只覆盖真正显示文字的表单控件。
- 桌面场景最后一次 `scrollIntoView({ block: 'center' })` 会让图片批量工具条停在粘性任务工具条下方；最终截图状态需要把视频卡片定位到粘性工具条下方，而不是简单滚到顶部或中间。
- 紧凑视频素材库的深色弹窗受到浅色任务页 `.artifact-preview strong` 覆盖，标题和文件名曾降到约 1:1；显式媒体前景色后已恢复清晰可读。
- 最终紧凑截图无裁切、无横向溢出，搜索、导入、素材状态和关闭按钮均完整；桌面截图已把视频卡片定位到粘性工具条下方，替换菜单、视频来源、入点滑杆与应用按钮同时可见。

---

# 普通任务 AI 创作自主补全发现

## 2026-08-08

- 用户指向普通任务创建页中与“全网搜索”并列的 AI 自主补全能力。
- 当前 `NewTaskPage` 已渲染“AI 内置知识补全”，并把 `aiSources` 保存到草稿，但搜索按钮和文案生成仍以网页渠道、搜索结果和所选网页为硬前置条件。
- 现状导致 AI 补全选项无法单独生成，属于已展示但未闭环的功能缺口。
- 保留现有复选来源模型最符合当前页面，不需要新增任务模式或平行创建页。
- 底层 `composeCopyFromSources` 已有无参考素材提示词，但 `ResearchCopyComposeInput` 没有传递 AI 知识开关，且函数始终以 `useAiKnowledge: false` 构造提示词；因此组合模式也没有按界面选择生效。
- 最小且明确的兼容方案是在生成合同中增加 `useBuiltinKnowledge`：无网页资料时只有显式开启 AI 知识才允许生成，有网页资料时该字段决定严格依据网页或允许可靠知识补足。
- HTML 动画创作继续显式传 `useBuiltinKnowledge: false`，保持其现有“先搜索并选择网页”的独立链路不变。
- 创建页不需要新样式体系：来源状态决定网页检索区域是否渲染，生成操作保持在同一 AI 创作面板中并根据单源/组合模式显示对应命令文案。
- 实际网页来源是否有效必须按正文或摘要判断，不能只按数组长度判断；底层现已过滤空内容来源，防止网页专用模式退化成未授权的模型自由生成。
- Electron 原始分辨率截图确认 AI-only 状态在 1440×900 和 1080×720 都保持现有创建页结构，来源选择、关键词、要求和主操作均完整可见，无需新增 CSS。
- QA 报告中两个素材输入场景 `aiBuiltinComposeReady=true`，搜索面板不可见、生成按钮可用；文字/焦点对比度、交互遮挡、运行时错误和媒体失败均为 0。

---

# 草稿常用字体扩充发现

## 2026-08-08

- 内置 `FontType` 同时提供鸿蒙黑体、思源黑体/宋体、资源圆体、霞鹜文楷以及多种标题字体，选入的 27 个非默认字体均标记为免费资源。
- 最终目录共 28 项：系统默认 1 项、黑体 7 项、宋体 5 项、圆体 5 项、楷体与手写 4 项、标题设计 6 项。
- 原生 `select + optgroup` 与现有检查器的键盘、焦点和紧凑窗口行为一致，无需引入自定义弹层；当前选中项继续使用对应 CSS 回退栈做画布近似预览。
- CSS 预览只负责编辑器反馈，最终成片字体由 `TextSegment(font=FontType.<value>)` 决定；`export_material()` 会把资源 ID 写入文字素材的 `styles[0].font.id`。
- 27 项运行时导出全部得到非空且匹配的资源 ID，因此新增目录不存在“界面能选、剪映成片回退默认”的选项。
- `system` 保持默认值，严格合同只接受目录值，旧模板或非法值仍由归一化逻辑回退系统默认。
- Electron 四个草稿场景确认每个字体选择器均包含 28 个 option、6 个 optgroup 和跨分类代表字体，保存重开及画布应用继续通过。

---

# 草稿图片显示方式发现

## 2026-08-08

- 模板合同已有 `image.fit: 'cover' | 'contain'`，且严格 Zod 合同、归一化、保存和剪映输入均保留该值，缺口不是数据模型。
- 编辑器当前把内部值直接显示成英文 `cover / contain`，模板卡片也显示内部值，用户无法自然识别“裁切或完整缩放”的现有能力。
- 画布预览对 `contain` 使用 `object-fit: contain` 和受区域限制的等比尺寸；`cover` 使用铺满区域的尺寸和 `object-fit: cover`。
- 剪映桥接对 `contain` 取横纵缩放较小值，对 `cover` 取较大值；裁切模式另加矩形蒙版，完整缩放模式不会触发裁切蒙版。
- `image.fit` 已由 `writeJianyingDraft` 原样传入 `imageArea.fit`，因此中文化选择器后无需新增 IPC 或存储迁移。
- 真实桥接回归用同一张 1080×1920 图片放入 1080×960 区域：`cover` 生成 `scale_x/scale_y = 1`，`contain` 生成 `scale_x/scale_y = 0.5`，证明两种方式会实际改变剪映成片布局。
- Electron 4 个草稿模板场景均成功选择“完整缩放”、保存为 `contain` 并在重开后恢复；模板卡片也显示中文方式，不再泄漏内部值。
- 原始桌面和紧凑截图确认两项选择在“图片显示”分组中自然出现，右侧检查器、画布和保存操作没有裁切、重叠或不可读文本。

---

# 草稿模板统一裁切位置发现

## 2026-08-08

- 用户最终确认不在任务预览里调整，裁切位置属于草稿模板，而不是逐分镜图片资产；因此不需要新增任务 mutation、IPC 或状态文件迁移。
- 九宫格预设足以覆盖常用构图，使用原生 `select` 与现有检查器密度、键盘路径和紧凑窗口行为一致。
- 模板以归一化 `focusX/focusY` 保存，中心为 `0.5/0.5`；缺失值在严格解析和模板归一化两处都回退居中。
- 浏览器 `object-position` 与剪映 transform 使用同一焦点语义：焦点越靠上，素材在裁切框内越向下偏移，以保留上部内容。
- 剪映裁切不能只移动素材；矩形蒙版中心必须按素材缩放反向补偿，否则蒙版会跟着素材移动并露出错误区域。
- 模板焦点只应用于图片场景；视频替换拥有独立 `fit` 并保持居中，封面页也保持居中，避免预览与剪映封面行为不一致。
- 相机运镜继续以焦点后的 `transform_x/transform_y` 为基础，因此推近和平移不会在第一帧跳回中心。
- 真实 `pyJianYingDraft` 输出中图片片段同时包含非零 transform 和 mask material reference，矩形蒙版资源被写入 `materials.masks`，最终剪映草稿链路成立。

---

# 草稿模板图片双层自由变换发现

## 2026-08-08

- 九宫格无法满足用户对 Photoshop 式自由取景的要求，最终权威模型是“展示框 + 实际图片”两个可编辑矩形，而不是逐分镜预览裁切。
- 展示框使用 `left/top/width/height`；实际图片继续使用连续 `focusX/focusY`，并新增相对 cover 基准的 `mediaScale`，因此无需保存依赖素材像素尺寸的绝对坐标。
- 画布中两个对象均支持整体拖动；当前对象提供四边、四角共 8 个控制点和键盘移动。未选对象仍可鼠标直接命中，键盘切换由检查器分段控件承担。
- 实际图片矩形由展示框、素材比例和 cover 基准推导，移动被限制为不露出展示框；缩放保持等比且限定 `1..8`。
- 普通任务预览直接复用 `DraftTemplatePreview`，因此模板画布与普通视频预览保持一致；视频替换只复用展示框并保持自身居中，HTML 动画链路未改。
- 剪映片段 transform 表达实际图片位置和缩放，矩形 mask 表达展示框；蒙版中心按焦点位移反向补偿，避免素材移动时可见窗口一起漂移。
- 真实内置 `pyJianYingDraft` 产物确认 `extra_material_refs` 同时关联 speed 与矩形 mask，`materials.masks` 中写入宽高和中心偏移，不是仅在 fake 测试中成立。
- Electron 四个草稿场景和桌面/紧凑原始截图确认双层边框、控制点、检查器及保存重开无交互遮挡或布局回归。

---

# HTML 动画预览竖屏裁切发现

## 2026-08-09

- 用户截图中的当前素材为 9:16，但中央预览只露出上半到中部，底部字幕安全区完全不可见。
- 画面列同时承载预览、时间轴、播放工具栏和场景胶片条；当前固定预览几何没有按剩余高度完整适配。
- 需要区分“舞台可用区域”和“输出画布”：输出画布保持原始宽高比，整体 `contain`，字幕必须作为输出画布内部叠层同步缩放。
- 本轮属于现有桌面生产工具的窄 UI 修复，保留深色工作区、右侧检查器和下方场景条结构。
- React 预览使用 `.hv-reference-phone` 内嵌完整场景 `iframe`；字幕由 `src/shared/html-video.ts` 生成在 iframe 内部，并按 `captionY` 百分比定位。
- 因此不应修改字幕样式或输出 HTML，只需修正 `.hv-preview-workbench`、舞台与 phone 的可用高度约束，让 iframe 画布整体缩放。
- 现有 Electron QA 已检查 `previewAboveFold`、检查器在右和胶片条在下，但还没有断言竖屏画布的完整比例、底边可见以及字幕元素位于 iframe 视口内。
- iframe 的 `fitScene()` 已使用宽高比例中的较小值，外层 phone 在截图中也完整呈现 9:16 边框；没有真实几何裁切。
- 场景在 `DOMContentLoaded` 时执行 `window.__tl.seek(0)` 并暂停，而每条字幕在 0 秒显式设为 `opacity: 0`，所以初始静止预览必然没有字幕。
- 修复应是预览播放器的代表帧状态，不应改变 `src/shared/html-video.ts` 的 0 秒画面，否则会直接改变最终导出视频的字幕入场效果。
- 第一次真实 Electron QA 证明父层 iframe `onLoad` 发送 `hvseek` 存在竞争：内部时间线仍为 0；子场景随后会明确发送带协议标记的 `hf-preview ready`，这是可靠同步点。
- 动效保存会按产品逻辑使动画预览失效并回到“继续生成”状态，所以 QA 的画布/字幕几何必须检查保存前的 `initial` 快照，而不能检查保存后的空预览。
- 字幕可见性还需同时检查 `.captions` 容器和具体 `.caption` 的 opacity，不能只看子元素自身样式。
- 第三轮诊断值为 `previewRuntimeReady=true / previewTime=0 / captionLayerOpacity=0 / captionOpacity=0.72`：运行时已经完成初始化，但父层的 seek 分支从未执行；问题不是代表帧时间选错。
- QA 能从父页面直接读取 iframe 的 `contentWindow.__ready` 与 `__tl.time()`，证明 srcDoc 同源；父层 effect 可安全轮询该就绪标志并在确认消息监听器安装后发送 seek。
- 父层轮询方案在 1320×860 实机中成立：`previewTime=0.75`、字幕层 opacity `0.9709`、文字 opacity `1`，画布和字幕均完整可见。
- 切换到 920×720 后 iframe 时间线回到 0，`fitScene` 结果也不再匹配新视口；预览需要同时响应 iframe 重载与容器尺寸变化，不能只在 `source` 变化时初始化。
- 给父层增加 iframe load 修订和 `ResizeObserver` 后，下一轮桌面初始化也出现回到 0 秒，说明父层驱动仍会与 srcDoc 自身加载/React 重渲染竞争。
- `prepareCompositionSrcDoc` 本来就是只供编辑器 iframe 使用的 HTML 副本；在副本末尾注入带现有 CSP nonce 的 bootstrap，可在场景自身 DOMContentLoaded 初始化完成后 seek，且不会修改保存到磁盘或送去导出的原始 HTML。
- 独立 bootstrap 节点方案实机仍为 `__ready=true / previewTime=0`，说明新节点没有执行；原运行时脚本执行正常，因此最稳妥的 CSP 兼容方式是直接向该已授权脚本文本追加预览初始化代码。
- 向原脚本文本追加 bootstrap 后实机仍未改变时间线，说明经 `DOMParser -> outerHTML -> srcDoc` 的预览副本不适合承担新的运行时代码。
- 最稳定的产品方案是静止海报字幕层：iframe 继续展示完整 0 秒输出画布，React 根据同一 `activeScene`、模板 `captionY` 和已解析字幕颜色绘制第一条字幕；播放、重播、拖动时隐藏，成片时间线零改动。
- Electron QA 应从父页面检查 `.hv-preview-poster-caption`，并以 `.hv-reference-phone` 为可见边界；iframe 内的 `previewTime` 与字幕 opacity 仅保留为诊断字段，不能再作为静止预览通过条件。
- 双窗口 Electron 结果证明该分层合同成立：父层字幕完整可见且在画布内，而 iframe 内字幕容器仍为 `opacity: 0`、时间线仍为 `0`，因此编辑器静止态可读性与最终动画语义已经解耦。
- 原图人工检查确认桌面和紧凑窗口均完整显示竖屏画布的顶边、底边和底部字幕，时间轴、场景条、检查器没有遮挡字幕或裁掉画布。
- 最终源码复核确认海报字幕和输出 HTML 都以同一 `captionYOverride ?? template.captionY` 语义定位，并共享 `resolveHtmlVideoCaptionStyle` 颜色；`src/shared/html-video.ts` 没有修改，成片动画继续使用原时间线。

---

# 草稿模板实际图片拖动与双向缩放发现

## 2026-08-09

- 用户原始截图中已选择“实际图片”，但画布只看到展示框的虚线边界与控制点，没有可辨识的图片变换边界，且直接拖动画面无效。
- 右侧“图片缩放”滑杆停在最左端，数值为 `1`；上一轮实现文档也明确把 `mediaScale` 限制为 `1..8`，与用户要求的可缩小行为冲突。
- 本轮属于高密度桌面内容生产工具的窄 UI 修复，应保留现有画布、检查器和双对象模型，仅调整实际图片的命中/拖动合同及缩放范围。
- 缩小仍须遵守“不露出展示框”的视觉约束；最终下限需从现有几何计算确认，不能简单把滑杆最小值改成更小而忽略画布覆盖关系。
- 用户进一步明确实际图片不只需要整体拖动，还必须支持四角与四边共 8 个控制点缩放；边缘控制点也应执行等比缩放，而不是单轴拉伸图片。
- 源码已渲染 `nw/n/ne/e/se/s/sw/w` 8 个控制点，且角点与边点均调用等比 `resizeDraftImageMedia`；失败来自几何和命中合同，而非缺少按钮。
- `draftImageMediaRect`、`resizeDraftImageMedia`、`updateDraftImageMediaScale` 与 `applyDraftImageMediaRect` 均把比例下限钳制为 `1`；模板 Zod 合同、模板归一化及剪映 Python 桥接同样写死 `1..8`。
- 当前图片位置由 `max(0, mediaSize - frameSize)` 的溢出量映射 `focusX/focusY`；图片缩到展示框以内时溢出量归零，拖动坐标必然丢失。需要让位置映射使用有符号的尺寸差，使放大裁切与缩小留白都能用同一 `focusX/focusY` 表达。
- 展示框和实际图片各有覆盖整个矩形的透明命中层；重叠区域中非当前对象仍可截获指针。当前编辑对象应拥有内部拖动命中，非当前对象只保留可辨识边界/显式切换路径。
- 用户明确要求缩小，优先级高于上一轮“不露出展示框”的实现假设；缩小后展示框允许显示模板底色或背景。
- 最终范围选择 `0.1..8`：`1` 保持历史模板的默认裁切填满比例，`0.1` 为可恢复的编辑下限；旧模板缺失字段仍回退到 `1`。
- 放大和缩小统一使用 `mediaSize - frameSize` 的有符号差值映射焦点：正值表示裁切溢出，负值表示展示框内留白，因此同一 `focusX/focusY` 可以保存两种状态的位置。
- 控制点仍属于实际变换框，但其命中中心会投影到画布 `2.5%..97.5%` 的可见范围；实际图片超出画布时仍可从四角/四边缩放，不需要放开输出画布的裁切边界。

---

# 对标监控与选品助手设计发现

## 2026-08-09

- 用户提供的 Storybound 截图采用稳定三栏工作区：全局侧栏、监控账号栏、内容结果主栏；顶部固定平台切换、单视频解析和添加账号。
- 截图中的核心任务是从账号池扫描视频，按互动指标筛选排序，批量选择后提取文案或进入创作；列表项同时显示封面、标题、日期、赞/转发/喜欢/评论和快捷动作。
- StoryDream 已是高密度中文桌面生产工具，本轮属于现有产品中的新功能设计，应复用现有导航、深色主题、紧凑控件和任务状态模型，不另起营销式视觉语言。
- `ui-ux-pro-max` 的工作流合同要求将“选择对标账号/作品”视为权威状态变化，并同步列表、详情和进入选品/创作的上下文；后台刷新不得抢焦点或强制滚动。
- 仓库已有未提交用户改动和其他在途任务；本轮必须使用独立文档与资源文件，避免改写现有功能代码或完成状态。
- 原始参考图分辨率为 1254×813，主内容密度较高；平台切换只展示“视频号 / 抖音（即将）”，说明本轮的抖音、视频号、B 站三平台能力必须在信息架构上正式建模，而不是只换标签。
- 项目技术栈是 React 19 + Electron 41 + TypeScript + sql.js，已使用 `lucide-react`，设计应直接复用现有图标、桌面窗体和本地持久化能力。
- 现有路由已经包含 `book-selection`（选品助手）与 `benchmark`（对标导入）；旧设计明确把对标页限制为本地粘贴链接/文案，不连接 Storybound 的私有 feed API。
- 因此本轮建议按“升级既有页面”设计：`benchmark` 升级为对标监控工作台，`book-selection` 升级为选题/选品决策台，两者共享候选内容与商品/选题资料，不新增重复侧栏入口。
- 现有 Storybound 移植文档已经支持把 `productInfo` 从选品助手带到对标导入或新建任务，这可以作为新闭环的最低兼容合同。
- 当前侧栏 `production` 分组顺序为任务队列、历史任务、选品助手、对标导入、人物素材库；对标页的副标题仍是“导入对标文案，本地二改后直接创建带货任务”，命名和功能都需要升级。
- 应保留现有 `ShellView` 的 `benchmark` 与 `book-selection` 稳定 ID，仅修改呈现和内部子视图，避免破坏路由、主题偏好和懒加载合同。
- `BookSelectionPage` 当前已经支持选择记录、编辑、删除、带入新建任务、去对标导入；数据字段包括主题、名称、作者、分类、关键词、价格、目标人群、人物、年代/场景、链接、核心卖点和备注。
- 选品页现有权威选择由 `selectedIdentity={theme, bookId}` 表达，升级后应继续用稳定记录 ID 驱动详情、证据和动作，不能按名称匹配。
- 产品使用 236px 宽侧栏，1120px 以下收为 68px 图标轨；主题令牌为中性深色表面、珊瑚红主操作、蓝/琥珀数据辅助色和绿色成功色，概念设计应复用而非照搬 Storybound 的绿色主色。
- 当前页面头部默认高 86px并承载标题、副标题、全局通知、保存状态和主题切换；新增工作台局部工具栏应位于页面正文，不与全局页头抢占层级。
- 本地 UI 数据库对桌面生产工具的匹配是“三栏工作区 + 上下文检查器 + 中性表面/语义状态/克制品牌色”，与现有外壳一致。
- 列表选择必须保留 pointer/keyboard/programmatic 来源；鼠标选择更新详情但不抢输入焦点，键盘选择才按可访问性需要移动焦点，后台刷新不能触发自动滚动。
- 异常表现适合用带异常点的短趋势线；所有图形必须同时显示数值、相对基线和原因标签。对单项作品使用小型趋势线/倍率比大仪表盘更高效。
- 选品多维评价需要精确比较，数据库也提示雷达图不适合精读；方案应使用可排序评分列、加权总分和证据详情，必要时再提供分组条形对比。
- `BenchmarkImportPage` 当前只有来源链接、标题、关键词、产品信息和文案 textarea，真正创建任务时来源链接并未持久化；升级需要正式的账号、作品、快照和来源证据模型。
- 现有“爆款拆解”已经支持抖音、快手、B 站链接，并具备下载、抽帧、转写、结构拆解、复刻和生成任务能力；对标监控应复用它作为单作品深度处理，而不是复制同一套解析 UI。
- 当前爆款平台枚举不包含视频号；视频号适配必须作为新增能力设计，并有“需登录 / 解析受限 / 手工补录”状态，不应隐藏失败或沿用快手标识。
- 最新 Electron 实机截图显示外壳和内容区已稳定使用无装饰深色工作台、细分隔线、4–6px 圆角、紧凑标题和珊瑚红选中/主操作；概念图应把 Storybound 只当作结构参考，不复制其绿色品牌色。
- 用户提出的“三个链接”适合建模为一个“跨平台对标组”：抖音主页链接、视频号主页/可识别作品入口、B 站空间链接分别保存、分别验证、分别显示同步状态；同一组内允许某平台暂缺，但 UI 永远明确三种平台位置。
- 单作品链接与账号主页链接应分开：前者进入现有“爆款拆解”，后者建立长期监控；自动识别失败时必须让用户手动选择链接类型和平台。
- 对标监控概念图采用全局侧栏、对标组栏、作品列表和作品详情检查器四个稳定区域；三平台状态、爆发趋势、批量动作和候选交接均可在 1536×1024 内完整呈现。
- 选品助手概念图采用候选表格 + 固定详情检查器，评分使用精确水平条和文字证据，不使用雷达图；证据列表明确标注抖音、视频号、B 站来源。
- 两张概念图均成功延续 StoryDream 的珊瑚红、深色中性表面、紧凑字号和细分隔线；图像模型少数字形不准确，正式实现必须使用真实 React 文本与组件。

---

# HTML 动画预览缩放状态恢复发现

## 2026-08-11

- 应用内的预览“最大化”使用 `.hv-reference-preview.maxed { position: fixed; }`，但组件只切换布尔状态，没有保存或恢复 `.hv-preview-workspace` 的滚动位置。
- 当前场景编辑改造使预览子树高度明显增长；最大化切换前后父滚动区的 scroll extent 变化，退出时焦点仍留在重排后的底部按钮，可将工作区停在看似只剩预览/空白的位置。
- 现有 Electron QA 会点击“最大化”再点击“退出最大化”，但退出后立即返回，没有断言 `maxed` 状态已清理、三栏外壳仍可见或滚动位置已恢复。
- 新增的 maximize-restore Electron 验收在 1320×860 与 920×720 两种桌面尺寸都证实：进入时为固定视口覆盖，退出后 scrollTop 从 180 精确恢复为 180，焦点回到缩放按钮，参数/画布/流程三区均保持可见，运行时错误为 0。
- 完整 preview-effects 范围仍会在执行缩放断言前因既有前景素材不可见而失败；本轮保留了该严格断言，通过隔离入口验证缩放修复，没有将无关失败误标为通过。

---

# 对标监控与选品助手实现发现

## 2026-08-09

- 当前工作树已有实时热榜功能在途实现，已修改 `electron/main.ts`、`electron/preload.ts`、`src/app/AppRoutes.tsx`、`src/app/navigation.ts`、`src/app/route-registry.ts`、`src/shared/ipc-contract.ts`、`src/shared/storydream-api.ts`、`src/shared/types.ts` 与相关测试；本轮必须在这些新增内容上集成。
- 现有 `BookSelectionRecord` 与 `BenchmarkImportPage` 可以作为兼容入口，但前者只有商品资料 JSON，后者没有持久化来源链接、账号、作品或指标快照。
- 产品模式继续是高密度桌面生产工具；实施必须复用现有 shell、主题令牌、Lucide 图标和本地 sql.js，不引入新组件库或第二套视觉系统。
- `storage.ts` 通过启动时 `CREATE TABLE IF NOT EXISTS` 进行兼容迁移，现有 `book_selection` 也是独立表；对标组、作品和证据适合用新增表实现，无需破坏旧选品表。
- 现有爆款平台枚举为抖音、快手、B 站、未知；浏览器和共享检测均不包含视频号，Python 媒体工作器也只实现抖音/快手/B 站。
- 抖音/B 站媒体工作器已经能从作品页或公开接口获得标题、作者、封面和部分原始元数据，可在后续把完成的拆解结果回填对标作品；它没有账号 feed 扫描能力。
- 首期真实可用边界应是：三平台账号链接正式保存、作品/指标手工或单链接解析导入、爆发分/证据/选品工作流完整；账号自动同步由显式连接器状态表示，不得显示伪造完成时间或演示作品。
- 新增数据合同采用 `benchmark_groups(id,data,updated_at)` 和 `benchmark_posts(id,group_id,data,updated_at)`；账号随组 JSON 保存、指标快照随作品 JSON 保存，便于后续连接器写入且保持删除级联简单可靠。
- 旧选品表继续保存 `BookProductInfo` JSON，新增状态、机会评分、证据、决策/风险备注和创作简报字段不会要求 SQL 迁移，也不会破坏旧记录。
- 爆发分在无指标时返回 `null` 而不是 0；有数据时提供账号百分位、增长速度、深互动、主题热度和跨平台信号分项，并按样本/快照数量降低置信度。
- 当前实现进度已超过单纯设计：`BenchmarkImportPage`、`benchmark-monitoring.ts`、两张数据表、浏览器回退、preload/main IPC 和聚焦测试均存在；后续不能重新起一套页面或接口，应以现有实现为基线做缺口审阅。
- `book-selection` 页面文件本身尚未出现在本轮修改列表中，虽然 `BookProductInfo` 类型已扩展机会评分与证据字段；选品 UI 很可能仍是旧资料表，这是当前最主要的功能缺口。
- 进一步源码核对确认 `BookSelectionPage` 完全仍是旧版两栏资料表，只读写基础商品字段；新增的 `selectionStatus`、`opportunityScore`、`evidence`、风险和创作简报均未进入 UI。
- `BenchmarkImportPage` 已具备三链接对标组、作品手工导入、指标快照、筛选、多选、加入候选、详情备注、爆款拆解与创建任务逻辑，但新 JSX 使用的 `benchmark-group-rail`、`benchmark-results-panel`、`benchmark-inspector`、列表行和弹窗类没有对应样式。
- 旧 `.benchmark-import-layout` 仍是 320px + 主区两栏网格；当前 JSX 实际有三块顶级区域，若不补 CSS，详情检查器会换行或挤压，无法达到稳定三栏状态合同。
- 对标页“深度拆解”写入 `benchmark_viral_url` / `benchmark_viral_platform` 后跳转 `viral-analyzer`，但 `ViralAnalyzerPage` 当前没有读取这两个 session key，交接实际未完成。
- `BookProductInfo` 已兼容持久化 `selectionStatus`、五维 `opportunityScore`、`evidence`、`decisionNote`、`riskNote` 和 `creativeBrief`；选品升级可以继续复用现有 `book_selection` JSON 表和 IPC，无需新增表。
- 选品证据带稳定 `postId`，可以通过写入 `benchmark_focus_post` 后导航回 `benchmark`，让证据列表与对标详情形成可逆上下文。



---

# HTML 动画场景编辑器最终视觉复核

## 2026-08-09

- 用户否决的旧截图中，顶部设置、画布、场景列表和播放工具栏同时占据首屏，设置区域只露出标题行，确实属于信息层级冲突，不是单纯的滚动问题。
- 最新 1320x860 默认态已稳定为三个工作区：中央画布、画布下方当前场景编辑器、右侧场景列表；没有嵌套卡片堆叠、控件遮挡或横向溢出。
- 全局“字幕、镜头与转场设置”与下方场景编辑正文采用互斥展开；设置展开时完整占据画布上方工作区，收起后恢复场景编辑，避免两个属性面板同时争抢高度。
- 920x720 紧凑窗口保留同一信息架构，右侧主工作区承担纵向滚动；画布、播放栏和场景编辑页签均可见，场景编辑正文位于其后续滚动位置，没有改造成不适合桌面工具的移动端堆叠。
- 产品模式为高密度桌面内容生产工具；当前选择的场景 ID 仍是画布、场景列表、版式、前景、标题和提示词的共同权威状态。
- `effects-foreground.png` 中前景缩略图、显示状态、单项/全部显隐动作均完整，并且前景首帧真实出现在中央画布内；`effects-title.png` 和 `effects-prompt.png` 的输入、保存动作及双提示词列也都在固定编辑区内完整呈现。
- 六张最新原始截图未发现控件重叠、文字裁切、嵌套卡片、异常空白或场景选择不同步；无需再引入新的设计系统或数据库样式建议。

---

# 实时热榜来源评估

## 2026-08-09

- `UAPI / 全网热榜` 提供无需登录的 JSON 接口 `https://uapis.cn/api/v1/misc/hotboard?type=...`，实测微博、抖音、知乎、B 站、头条、小红书、澎湃和百度均能返回排名、标题、链接、热度与更新时间，适合作为主数据源。
- `Techmeme` 当前可访问且有稳定公开 RSS，适合作为科技与 AI 的补充源；英文标题应保留原文，不在抓取层自动改写。
- `AnyKnew` 当前可访问，覆盖面适合作为人工交叉核验，但首页是前端应用且未确认稳定公开接口，不纳入自动抓取。
- `今日热榜 tophub.today` 本机核验返回 503；内容覆盖合适但直连稳定性不足，归为备用核验。
- `NewsNow` 本机核验返回 403；聚合逻辑合适但不应绕过访问控制，归为备用核验。
- `SoPilot` 页面可访问，但聚焦 X 单平台、核心数据依赖登录/动态请求，和中文综合选题覆盖不匹配，暂不直连。
- `全站热榜 rebang.today` 与 `即时热点 nowhots.com` 当前可访问，但未确认公开稳定 JSON/RSS，保留为人工核验入口。
- `TL1 tl1.com` 与 `糖果梦 tameng.com` 本机当前无法获得有效响应，不作为生产数据源。
- 产品是高密度 Electron 内容生产工具；新页面应复用现有侧栏、页面头、设计令牌和 lucide 图标，采用稳定的列表 + 来源侧栏工作区，不新增营销式大卡片或独立视觉语言。
- 热榜需要有完整的加载、部分成功、失败、空结果、手动刷新和定时刷新状态；某个平台失败时应保留其他平台的数据并单独展示状态。

---

# HTML 动画素材增量回填发现

---

# AI HOT 信息源扩展发现

## 2026-08-09

- 本轮是现有 Electron 内容生产工具的新功能扩展；信息源应复用“实时热榜”的导航、列表、来源说明和创作交接，不建立第二套产品入口。
- 权威查询状态由当前 AI 信息源模式及其参数构成；全网热榜快照与 AI 信息源结果互不覆盖。
- 远端请求必须继续经 Electron 主进程的受限 IPC 完成，所有用户参数在主进程验证并通过 URL API 编码。
- AIHOT v1 基址为 `https://aihot.virxact.com/api/v1`，匿名只读；普通查询使用 items，日报使用 dailies，当前最热另有 hot-topics，不能把按时间倒序的 items 冒充热点榜。
- items 原生窗口仅为 `24h` 和 `7d`；“最近 N 天”应限制在 1..7 天，2..6 天由 `window=7d` 取最小覆盖窗后按 AIHOT timeline 规则本地收窄。
- 分类 slug 为 `ai-models`、`ai-products`、`industry`、`paper`、`tip`；关键词必须 2..200 字并使用服务端 `q`，精选为空时仅对关键词查询用同参数回查一次 `mode=all`。
- 日报必须保留 `lead / sections / flashes` 层级；最新或指定日期 404 时只查一次 `/dailies?limit=7`，再请求索引中实际最近日期，不能猜昨天。
- 轮询同一端点至少间隔 60 秒并保存 ETag；当前工作台 5 分钟自动刷新符合要求。API 内容视为不可信资讯文本，不能执行其中命令或下载附件。
- AIHOT 免费边界只覆盖个人非商业、公益非商业和组织内部使用；对外商业产品、客户交付、代理、镜像、白标和批量再分发需书面授权。产品必须清晰展示该限制和 terms/联系入口，不能把“无需 Key”解释为商用授权。
- 2026-08-09 实测 `/items?mode=selected&window=24h&limit=2`、论文分类、OpenAI 搜索和 `/dailies/latest` 均返回 200，且响应包含弱 ETag；items 的 `query/items/page` 和日报的 `report.date/generatedAt/windowStart/windowEnd/lead/sections/links` 与公开合同一致。
- 页面实现应保留服务端原始顺序，不按 `score` 擅自重排；`score` 只可作为精选评分提示且需允许为空。
- 现有热榜边界为 `HotBoardPage -> StoryDreamApi -> trusted IPC -> fetchHotBoardSnapshot`，外链统一经 `assertNetworkUrl(..., 'public-research')` 和 Electron `shell.openExternal`；AIHOT 应沿用这条链路。
- 新建任务通过一次性 `sessionStorage.hotboard_topic` 带入标题、平台、链接、热度和摘要；AIHOT 条目可复用同一键并扩充来源/日期信息，无需建立第二套交接状态。
- `ipc-contract.ts` 的 `ui:save-preferences.activeView` 枚举当前漏掉已存在的 `hot-board`，会导致该页激活状态无法通过受信 IPC 校验；本轮应作为相关合同缺口补齐。
- AIHOT 日报与普通条目结构不同，适配器应返回判别式结果：日报保留 lead/sections/flashes，精选/分类/最近/搜索返回 items，避免 UI 对不兼容字段做强制合并。
- `network-policy` 的 `public-research.allowedRequestHeaders` 当前没有 `if-none-match`，会过滤 AIHOT 官方建议的条件请求头；需把该标准头加入受控白名单并测试，不放宽 cookie、authorization 等敏感头。

## 2026-08-09

- 用户新截图显示素材步骤处于“运行中”，多个场景仍只有透明棋盘占位；这不是素材服务没有返回，而是 UI 只能消费完整资产数组。
- `adaptHtmlVideoAssetGenerator` 当前先收集全部背景和前景请求，再一次性返回 `HtmlVideoAsset[]`；`validateHtmlVideoAssets` 也要求资产数量等于完整期望集合，因此生成期间没有可持久化的部分结果。
- 正确合同应保留资产稳定键 `sceneIndex + kind + slot`，允许运行态保存已完成的部分资产；只有步骤完成时才执行完整集合校验，失败或取消时保留已生成素材并展示状态。
- 画面层已经按场景和素材类型渲染卡片，增量改动应优先接入现有管线状态与 IPC，不新增独立缓存或第二套素材模型。
- `runHtmlVideoPipeline` 目前只在素材步骤开始与结束持久化 checkpoint，`executeStep('assets')` 直到完整生成结果返回才赋值 `state.assets`；因此单改 React 卡片不能实现逐张显示。
- 增量事件必须从实际图片生成完成点上报到 runner，由 runner 按稳定键合并到 `state.assets` 并调用现有 `persistCheckpoint`，这样数据库任务状态与页面现有刷新机制能自然接收同一份权威状态。
- 配置的 OpenAI-compatible 与即梦图片生成器面对数组输入时内部也是逐场景循环；HTML 适配器可以改为单素材调用并使用已有 `imageConcurrency` 建立受控 worker 队列，每个文件写盘后即可回调，不会丢失并发配置。
- 多张图片可能同时完成，增量 checkpoint 必须通过单一 Promise 链串行化；否则旧快照的数据库更新可能晚于新快照完成，造成 UI 短暂回退或覆盖。
- V2 管线解析应仅在 `steps.assets.status === 'completed'` 时要求完整资产集合；`running/failed/cancelled` 可接受无重复、键合法的部分集合。最终 `validateAssets` 继续使用严格完整校验，防止下游配音、预览或出片消费残缺素材。
- `buildHtmlAssetRequests` 已为所有背景和前景分配跨场景唯一的 `syntheticId`，同时保留真实 `sceneIndex/kind/slot`；可直接用于单请求 Provider 文件命名和回填定位。
- Electron 的 `onCheckpoint` 会更新数据库并立即 `publishTaskUpsert`，页面已订阅 `onAppDelta`；增量 checkpoint 不需要新增 IPC 或轮询接口。
- 现有 `qa-html-video-ui.mjs` 已能以隔离用户目录启动真实生产 Electron、写入真实任务数据库、提供本地媒体并保存桌面/紧凑截图；新增独立 `asset-progress` 分支即可验证部分素材快照的真实渲染，无需引入新的 QA 框架。
- QA 将先生成包含两场景、背景和前景的完整本地媒体，再把数据库主任务转换为 `assets: running` 且只保留第一张的部分快照；任务状态设为暂停，避免启动时自动调用 Provider，同时保留与真实增量 checkpoint 相同的管线数据形状。
- Electron `asset-progress` 实机结果在 1320x860 和 920x720 均为：4 个预期素材槽、1 张真实图片已加载、3 个槽显示“正在生成”、标题显示“已生成 1/4 张”，横向溢出和控件裁切为 0，运行时错误为空。
- 两张原始截图人工复核确认首张背景已真实落卡，未完成前景使用加载图标与状态文字，紧凑窗口仍保持可读层级和单一纵向滚动。

---

# AI 信息源最终验收续接

## 2026-08-09

- 重新查看用户原始截图，确认其中 10 个候选站点依次为 AnyKnew、TL1、今日热榜、NewsNow、SoPilot、全网热榜、全站热榜、糖果梦热榜、即时热点和 Techmeme。
- 当前实现把这 10 个候选逐项保留在“来源接入评估”，只把已验证的结构化全网热榜接口与 Techmeme 标为首期稳定接入；AIHOT 作为同一路由中的独立 AI 垂类信息源，不会把无法稳定直连的站点冒充为实时数据源。
- 最终视觉验收按桌面生产工具标准执行：1440x900 与 920x720，检查页签、模式筛选、查询控件、来源栏、空态/错误态、横向溢出和遮挡。
- 隔离 Edge 实拍已验证 6 个模式均能切换到正确权威状态；日报、精选、全部、分类、最近和搜索所需控件均完整呈现，控件内部溢出为 0。
- 1440x900 与 920x720 的文档、body 和 AI 信息源根节点横向溢出均为 0；可见控件裁切与视口外元素均为 0。
- 1440x900 采用结果列表 + 330px 来源栏；920x720 自动转为单栏，812px 来源栏接续在结果区下方。两张原图人工检查未见页签、日期查询、错误态或授权说明重叠。
- 浏览器预览按安全边界展示“请在 Electron 桌面端使用”的受控错误态；真实匿名 AIHOT 请求已由主进程适配器测试与在线请求验证，不为预览放宽网络权限。
- 920x720 的实际滚动容器是 `.hot-board-workbench`，可从 `scrollTop=0` 滚到 277；到底后来源栏位于视口 `top=400`、高 301px，全部授权与来源内容完整可见。
- 最终 AIHOT 六文件回归为 120/120 通过；23 个范围文件严格 UTF-8 解码且不含 U+FFFD，范围内 `git diff --check` 无错误。
- 扩大到共享库存的 10 文件回归中 8 个文件通过，6 项失败只来自同期对标监控/选品助手对图书与人物资产合同的未同步修改；AIHOT 查询、热榜 UI、IPC、网络策略和路由测试全部通过。
- 当前全局类型检查错误仅位于 `AppRoutes.tsx`、`BenchmarkImportPage.tsx`、`BookSelectionPage.tsx`；生产构建在 `BenchmarkImportPage.tsx:321` 的 `??`/`||` 混用处停止。上述均不属于本轮 AIHOT 范围。

---

# 热榜工作台问题审计

## 2026-08-09

- 用户反馈“没设计、bug 多”后重新按 `ui-ux-pro-max` 审计：当前页面属于高密度运营/编辑工具，应优先保证扫描、比较、筛选、确认来源和继续创作的连续路径。
- UX 数据库检索支持“扁平极简 + 高对比状态色 + 数据密度”方向；现有页面的结构基础可复用，但异常态大面积占位、指标栏与来源栏层级重复，不能作为最终视觉方案。
- 下一步实拍全网热榜实际状态并逐项检查：默认视图、平台滚动、筛选、空态、行操作、来源评估和紧凑窗口的滚动/遮挡。

---

# 对标监控与选品助手实现发现

## 2026-08-09

- 最终产品模式保持为 StoryDream 现有高密度桌面运营工具：对标监控是三栏主从工作台，选品助手是候选表格加右侧检查器，没有引入独立设计系统或营销式页面结构。
- 抖音、视频号和 B 站账号链接以同一对标组中的三个独立位置保存；真实账号 feed 连接器尚未实现，界面明确显示“手工导入/待接入”，不会伪装实时同步。
- 作品指标空值以 `{ value: null, reason }` 保存；爆发分只消费有效指标，并同时给出账号内百分位、增长速度、深互动质量和置信度说明。
- 选品证据使用稳定 `postId`，从选品点击来源会同时恢复正确对标组和作品高亮；平台筛选后检查器只引用当前可见作品，避免主列表与详情不一致。
- 对标作品进入选品时同时写入证据、机会分草稿和 `shortlisted` 状态；批量操作只有整批成功后才显示成功并清空选择。
- `book_product_info` 只在进入新建任务时写入，去对标监控只传搜索词，避免未来新任务误消费过期商品资料。
- 现有爆款拆解只支持抖音、快手和 B 站；对标页复用抖音/B 站入口，视频号明确禁用并解释连接器边界。
- 视觉 QA 使用真实浏览器预览、本地样本和稳定 viewport：1440×900 与 1080×720 共 4 个场景无横向溢出、分栏重叠或非预期控件裁切；选品证据回跳命中“ 三分钟讲透苏东坡为何一生豁达 ”对应作品。

---

# 热榜视觉重构续接发现

## 2026-08-10

- 产品模式是现有桌面内容生产工具中的高频资讯扫描终端；变更范围是热榜与 AI 信息源的宽范围页面重构，不另建组件库或视觉语言。
- `ui-ux-pro-max` 本地产品库把最接近的模式归为“实时监测 + 时间线 + 数据密度 + 权威状态”，推荐语义状态绿、故障红、维护/警告琥珀和中性深色表面；这与现有珊瑚红品牌强调色兼容。
- UX 证据要求空态提供明确解释与可执行下一步，错误使用 `role=alert` 或等价语义，并保证所有按钮和筛选可键盘到达。
- 当前实现已把热榜状态收敛为 `refreshing / preview / unavailable / partial / ready`，避免浏览器预览、全源失败和筛选无结果互相冒充。
- AI 信息源切换模式时会清理不兼容结果和旧请求；无效搜索会清空刷新目标，避免刷新旧关键词；浏览器预览来源状态改为“预览受限”。
- `api-image` 生成的 `.artifacts/hotboard-redesign-concept.png` 只作为布局参考；生产界面继续使用真实代码、现有图标和数据，不引入概念图中的生成文字或装饰图片。
- 1440×900 全网热榜实拍确认：浏览器说明完整位于页头，信号条、筛选条、榜单表头和右侧来源栏形成稳定层级，按钮无浏览器默认白底。
- 920×720 实拍确认：页面转为单列滚动，平台筛选、搜索、领域选择、预览空态和来源监测依次排列，无横向溢出或控件重叠。
- 1440×900 AI 信息源实拍确认：模式栏、日期/查询控件、结果区和 330px 来源栏层级稳定，浏览器受限态没有默认白底按钮或页头遮挡。
- 920×720 来源栏到底态完整显示“接口已配置 / 预览受限 / 5 分钟 / 无需 Key”及用途授权，状态一致且内容没有裁切。
- 生产 Electron 实时聚合返回 95 条热榜、5/9 来源可用；警告正确摘要为前两项并显示“另有 2 个来源异常”，五列行、来源健康栏和长英文标题均正常渲染。
- 实时热榜有数据态自动指标为 0 文档/根横向溢出、0 控件裁切、0 默认白底按钮，样例同时覆盖中文短标题、中文长标题和 Techmeme 英文长标题。
- Electron AIHOT 真实失败态暴露新缺陷：界面直接显示内部 `STORYDREAM_*_APP_ERROR_V1` 编码串，且结果区出现横向滚动条；必须修复后再验收。
- renderer 现统一使用 normalizeAppError 与 formatAppErrorMessage 解码 IPC 错误，警告文本允许收缩换行；AIHOT 内部桥接编码和横向溢出均已消失。
- 最终生产 Electron 实测返回 120 条全网热点、9/9 来源在线和 10 条 AIHOT 数据；两页文档与根节点横向溢出均为 0，控件裁切为 0。
- 全网热榜和 AIHOT 的行内“去创作”已脱离全局主按钮，统一使用 118px 操作列中的低权重描边动作；人工截图确认单行且无实心珊瑚色重复块。

---

# HTML 动画字幕与渲染一致性初步发现

## 2026-08-10

- 用户截图为 9:16 动画预览、场景 2/8；字幕位于画布底部但字号极小，多条文本在同一基线压叠，肉眼近乎不可读。
- 同一截图中的标题可见，说明 iframe/画布整体并非空白；问题集中在字幕层的几何、字号、透明度或时间轴状态。
- 当前 `HtmlVideoCaptionEditor` 只提供字幕预设、动画和颜色，没有区域、字体、字号、行高等控制，无法达到草稿模板字幕编辑能力。
- 现有场景文本编辑器以 `scene.captions.join('\n')` 编辑字幕数组，但仍需核实 HTML 生成器是否把数组一次性渲染，而非转换成场景内分时 cue。
- 本轮必须追踪编辑器 iframe `srcDoc`、独立 Electron 预览、逐帧导出/成片三条路径，禁止只修 React 海报层后宣称成片一致。
- 根因之一是旧 HTML 为所有 `.caption` 添加同一 0 秒动画，导致场景内多条字幕同时叠放；现在逐节点读取 `data-start/data-duration`，结束点立即归零透明度。
- 根因之二是主预览在真实 iframe 上叠加 React 海报字幕和前景，视觉结果与逐帧导出的 HTML 天然分叉；删除覆盖层后静止态、播放态和成片只剩一个权威渲染器。
- `buildHtmlVideoCaptionCues()` 使用整数毫秒切分，最后一个 cue 精确落在场景末尾，避免浮点累计造成空帧或重叠。
- 字幕字号按画布短边归一化，文本框按百分比宽度与区域 Y 定位；横竖屏不再共享固定 9:16 像素值。
- HyperFrames 源码编辑会直接改变 clip 时间；若不把 DOM cue 写回 pipeline 快照，主预览检查器会显示旧时段。存储层现在保存前解析、排序并验证 cue，重叠则保持文件和修订号不变。
- 支持的草稿字体链都在场景 HTML 中有显式本地 `@font-face` 声明，官方 HyperFrames lint 不再把系统中文字体判为不可复现字体。
- 实机证明最终 iframe 在 0.25s 显示“第一条”、0.75s 显示“第二条”，两个时间点可见数都为 1；配置保存、重建预览和最终 render 使用同一 HTML 合同。
- 并行 Fluent UI 迁移新增生产依赖并改写共享 UI 包装，造成旧 `electron-build` 精确依赖清单和 renderer 类型检查失败；这些错误与字幕文件无调用关系，未在本轮越界修复。

---

# 热榜按日归档与显示问题初步发现

## 2026-08-10

- 用户明确要求当天首次进入刷新并后端保存；同一天后续进入不得再次请求，除非点击“立即刷新”。
- 用户要求保存日期并查看过往日期，因此历史不能只保存在 React 状态或浏览器 localStorage；Electron 后端需要可迁移的持久化表/记录。
- 截图中原生分类下拉使用系统白色选项面板，但非选中项文字接近白色，形成严重对比度缺陷。
- 当前宽度下左侧结果表与右侧来源详情采用固定分栏，右栏内容和操作图标被挤压，长标题/摘要也有截断迹象。
- 顶部显示“每 5 分钟”与用户的新刷新合同冲突，需改成明确的“今日已更新/尚未归档”和具体时间，不再暗示后台轮询。
- 产品模式仍是高密度桌面生产工具；本轮保留现有深色设计系统和双视图结构，只调整状态权威、日期工作流和响应式分栏。
- `HotBoardPage` 首次激活直接执行 `api.fetchHotBoard()`，并在 renderer 内用 5 分钟 `setInterval` 重复抓取。
- `AiHotSourceView` 同样首次激活直接查精选流，并对最后一次请求做 5 分钟轮询；切换模式还会立即发起网络查询。
- Electron 的 `hotboard:fetch` 和 `aihot:query` 当前直接调用共享网络函数，没有经过 `FileDatabase`，因此重启应用后所有结果和更新时间都会丢失。
- 现有 `FileDatabase` 已使用 sql.js 并通过 `CREATE TABLE IF NOT EXISTS` 做无损迁移，适合新增独立快照表，不需要另建 JSON 文件或 renderer 旁路缓存。
- 存储层已经提供 `enqueueCommit`、`waitForWrites` 和原子文件落盘；新增 `hotboard_snapshots`、`aihot_snapshots` 两表即可复用现有可靠性合同。
- 热榜适合以 `archive_date` 为唯一键；AIHOT 必须以 `archive_date + 稳定查询键` 为联合键，避免“模型分类”和“OpenAI 搜索”等不同结果互相覆盖。
- 页面日期将提升为全网热榜与 AI 信息源共享状态；AIHOT 日报直接使用该归档日期，不再保留第二个独立“日报日期”。
- renderer 只提交 `{ date, forceRefresh }` 或 `{ date, query, forceRefresh }`；后端负责判断缓存命中、当天缺失自动抓取、历史缺失只读空态。
- 现有 `FileDatabase` 已有针对重启持久化的测试范式，可直接增加“保存后关闭并重新打开仍可读取”的快照回归。
- 两份功能 CSS 都存在后追加的“Dense editorial trend terminal”覆盖层；主体分栏在宽布局下固定保留约 330px 来源栏。
- 当前响应式只使用 viewport `@media`，但应用还有全局侧栏，真实内容区可能已很窄而窗口宽度仍大于 980px，导致截图中的双栏继续挤压。
- 修复应使用工作区 `container-type: inline-size` 与 `@container`，按内容区宽度切换为单列；不能继续追加更大的全局窗口断点。
- AIHOT 来源链接标题/说明使用 `white-space: nowrap + ellipsis`，会把邮箱、说明和长来源名截掉；应允许安全换行并保持图标列稳定。
- 所有功能内 `select` 需要显式 `color-scheme: dark`，并为 `option` 设置深色背景和浅色文字，修复 Windows 原生白底弹层不可读。
- AIHOT 的可用日期是所有查询键的日期并集，不能仅凭“该日期存在任意快照”把当前分类/搜索误标为已保存；当前查询的保存状态必须以 `origin=cache|network` 为准。
- AI 日报摘要前部虽曾取消截断，但文件后段旧规则重新设置了 `-webkit-line-clamp: 2`；最终规则已移除该覆盖，并同时取消热榜摘要、平台名和候选来源名的省略号截断。
- 隔离 Electron 数据证实后端缓存合同有效：首次网络抓取后重新进入返回相同 `fetchedAt`，切换到未归档历史日期不会调用实时接口，手动刷新按钮保持只读禁用。
- 工作区容器宽 822px 时，AIHOT 15 条真实长文本的 `scrollWidth` 与 `clientWidth` 一致，所有非滚动容器的横向溢出检查为 0。

---

# Fluent UI 组件层初步发现

## 2026-08-10

- 当前技术栈为 Electron 41 + React 19 + Vite 8，适合直接采用 Fluent UI React v9，无需迁移 Tauri、Qt 或其他桌面框架。
- 51 个 TSX 文件中约有 410 个原生按钮、132 个输入框和 67 个下拉框；现有 14 个共享组件没有覆盖最常用的 Button、Input、Select、Tabs、Toolbar、Pane 和 Inspector 契约。
- `src/styles.css` 与拆分样式合计约 16,593 行；浅色任务工作区与深色 HTML 视频工作台存在控件高度、表面层级、边框和选择态不一致。
- `src/styles/tokens.css` 已有深浅主题与珊瑚红品牌令牌，应映射为 Fluent UI theme，而不是用默认 Fluent 蓝色覆盖产品身份。
- `AppShell` 已集中处理窗口控制、导航、最近任务、授权入口、保存状态和主题切换，是首轮迁移的正确边界。
- `ui-ux-pro-max` 的产品匹配为桌面生产/创作工具：稳定三栏工作区、上下文检查器、中性表面、语义状态色和克制品牌强调色；不采用后台卡片瀑布或装饰性玻璃风格。
- Fluent UI 组件实现只对 React 可复用；真正跨页面、跨未来框架的资产应是语义令牌、组件契约、页面模板和 `storydream-ui` Skill，而不是直接复制 JSX。
- npm 当前解析到 `@fluentui/react-components@9.74.5`，peer 范围为 React/ReactDOM `>=16.14 <20`，与项目 React 19.2.6 兼容。
- FluentProvider 需要读取运行时 `state.ui.theme`，应在 `App` 返回区域包住 `AppShell`，继续由现有 `applyStoredTheme` 负责 document 级主题属性与首屏 reveal；不把 Provider 固定在 `main.tsx`。
- 现有 shell 静态测试约束窗口按钮、导航顺序、侧栏压缩、最近任务、主题切换和品牌强调色；迁移只能替换组件实现，不能删除这些 DOM 文案、className 与行为入口。
- Fluent UI 聚合包声明 `main` 为 CommonJS、`module` 为 ESM，并提供条件导出；Node `--input-type=module` 在当前环境命中 `node` 条件后只暴露 default，但 Vite/TypeScript 可按 `module`/`types` 正常使用命名导出。
- 当前网络访问 OpenAI 官方 `https://developers.openai.com/codex/skills/` 连续返回 403，无法从在线页确认项目目录；结合用户明确要求“项目专用”和 Agent Skills 仓库约定，采用仓库内 `.agents/skills/storydream-ui`，并使用 `skill-creator` 的初始化器与校验器验证。

# 热榜归档上传记录

- 本地提交 `66b9e55` 已创建独立分支 `codex/hotboard-daily-archive`；HTTPS GitHub 推送两次分别返回 connection reset 与 port 443 unreachable，等待外部网络恢复后再上传。

---

# Fluent UI 组件层最终发现

## 2026-08-11

- `StoryDreamProvider` 由运行时 `state.ui.theme` 驱动 FluentProvider，同时保留 document 级主题防闪烁；深浅主题继续映射项目珊瑚红品牌、语义状态和中性表面令牌。
- `src/ui` 已形成 15 个项目所有的核心组件，功能页后续只依赖 StoryDream 契约；Fluent slots、样式细节与第三方类型留在组件层内部。
- AppShell 已迁移为 `Button`、`IconButton`、`Toolbar` 和 `Tooltip`，原有窗口控制、拖拽区、导航、预加载、最近任务、忙碌态和主题切换行为保持不变。
- Fluent Button 的内部 DOM 不能作为项目 CSS 的稳定锚点；新增 `.sd-button__content` slot 后，紧凑侧栏可稳定隐藏文字并保留图标，避免空按钮、竖排文字和升级后 selector 漂移。
- `SliderField` 的 `valueLabel` 必须显式判断 `undefined`，不能依赖 truthy，否则合法值 `0` 会消失。
- Fluent UI 进入 renderer 入口后最初触发 500 KB budget；独立 `fluent-ui` vendor chunk 后，入口稳定为 375,270 bytes，Fluent chunk 为 215.61 kB。
- Fluent/Tabster 会生成 `[data-tabster-dummy]` 焦点哨兵；视觉 QA 必须排除这类框架节点，但仍检查所有真实业务控件的名称、tooltip、对比度、重叠与裁切。
- 项目 Skill 位于 `.agents/skills/storydream-ui`，用临时隔离 venv 的 PyYAML 运行官方 `quick_validate.py` 后得到 `Skill is valid!`。
- 最终全库 128 个测试文件、1819 项用例全部通过；类型检查、生产构建和 `git diff --check` 通过，相关中文文件严格 UTF-8 解码无替换字符。
- 四场景 Electron 主题 smoke 无 console/page/render 错误、无未解析 token、无可访问名称或 tooltip 缺口、无对比度失败和真实交互控件重叠；证据已归档到 `.artifacts/storydream-fluent-ui-system/`。

---

# 浅色主题持续闪屏初步发现

## 2026-08-11

- `App.toggleTheme()` 直接调用 `applyStoredTheme(nextTheme)`，但 `StoryDreamProvider`、主题图标和按钮标签继续读取尚未更新的 `state.ui.theme`；Electron mutation delta 到达前，页面同时存在浅色 document 令牌与深色 Fluent 主题。
- 设置页另行调用 `changeRuntimeTheme()`，共享壳则绕过该控制器，形成两个主题入口；两者都没有在即时 DOM 预览时同步更新 Provider 的 React 权威状态。
- `applyState()` 在 Electron 下依赖异步 `app:delta`，不会立即消费 IPC 返回的 theme patch；正常数据一致性成立，但无法保证主题这种全屏视觉状态的同帧一致性。
- 修复需要 App 级唯一主题动作：乐观更新 React `ui/config` 与 document，持久化成功接收 canonical patch，失败时条件回滚；共享壳和设置页都调用该入口。

---

# 对标同步与热榜正文交接续接发现

## 2026-08-11

- 已恢复上轮实现和测试状态，工作区存在大量用户在途修改，本轮只继续验收对标同步及热榜正文交接相关文件。
- `HotBoardPage` 与 `AiHotSourceView` 的“去创作”都会先读取来源页内容，再把 `sourceContent`、内容类型和降级警告写入 `hotboard_topic`；标题仅用于任务命名。
- 新建任务侧已存在 `selectedSources` 交接入口，后续运行态验收必须确认该网页资料默认选中，且浏览器预览明确使用归档摘要、不会伪装成实时正文抓取。
- 当前 `http://127.0.0.1:5173/` 服务已停止；浏览器 fallback 即使重新启动也固定返回 0 条热榜，因此只能看到空态，无法验收正文展开和创作交接。
- 浏览器预览应提供明确标注为“本地预览归档”的摘要条目，并保持实时抓取按钮禁用；Electron 仍是唯一真实联网抓取入口。
- 真实 B 站空间 `https://space.bilibili.com/546195` 初次在 WBI 归档接口触发 `-352/412`；补齐网页端 `platform`、`web_location`、`tid`、`keyword` 和 `order_avoided` 签名字段后成功读取 20 条作品。
- 首条真实作品包含 BVID、封面以及播放、点赞、评论、收藏、分享、投币、弹幕指标；真实封面 URL 为 `http://i2.hdslb.com/...`，需升级到 HTTPS 才能稳定通过 Electron 图片 CSP。


---
# 热榜正文联网兜底与悬停闪屏发现（2026-08-13）

- 热榜行内“打开原文”当前同时包裹项目 `Tooltip`，且 `IconButton` 默认根据 `label` 设置 `title`；Fluent Tooltip 与原生 title 存在重复 hover 触发，优先移除外层 Tooltip。
- `StoryDreamApi.searchWebSources` 接受字符串或 `WebSearchRequest`，Electron 端调用 `searchWebSourcesDetailed`，走 Bing、中文 Bing、搜狗、百度、头条等公开页面并尝试抓取目标页；不依赖 API Key。
- `AiSourceSection` 已包含 `source/provider/title/url/snippet/content`，可直接作为正文搜索结果展示。
- `HotBoardSourceContent` 只描述原页面读取结果；搜索结果应单独保存在 reader 状态，避免将搜索摘要伪装成来源正文。
- 搜索兜底在页面读取完成后按条目去重，关闭弹窗不会重复请求；手动“重试读取”会清理该条目的搜索缓存并重新读取/搜索。
- 匿名 GitHub API code search 需要认证，网页搜索受速率限制；没有把第三方仓库代码直接复制进项目，继续复用本地已有的公开搜索适配器和抓取器。
# 联网搜索源 GitHub 方案发现（2026-08-13）

- 当前 `searchWebSources` 直接抓取 Bing、搜狗、百度、头条 HTML，再用正则/结构解析器抽结果；没有稳定的官方搜索协议，易受页面结构、验证码和反爬策略影响。
- 搜索命中后立即并发抓取最多 20 个候选页面，并把抓取正文作为精排输入；搜索可用性与目标站正文可读性耦合，任何一层失败都会让可见结果减少。
- 当前只支持四个固定 provider union，没有可配置的远端搜索服务、健康度熔断、按源缓存或 managed API fallback。
- [SearXNG](https://github.com/searxng/searxng) 提供 `/search?q=...&format=json` 的稳定 HTTP 合同，可聚合多个搜索引擎且不需要上游 API Key；但 JSON 输出需在自建实例 `settings.yml` 中启用，许多公共实例会禁用格式或限流，因此生产环境应自建。
- [Tavily JS](https://github.com/tavily-ai/tavily-js) 同时提供 search 与 extract。官方 README 当前说明省略 API Key 可进入共享限流的 keyless mode，适合开箱试用/末级兜底；独占配额及 crawl/research 仍需要 Key。
- [Exa JS](https://github.com/exa-labs/exa-js) 提供自然语言搜索、域名/发布日期过滤和 `getContents` 干净正文，适合 AI 研究型查询，但官方 SDK需要 `EXA_API_KEY`。
- [Firecrawl](https://github.com/firecrawl/firecrawl) 同时支持 search、scrape、crawl，正文抓取能力强且可自建；服务端为 AGPL，完整自建比 SearXNG 重，托管版需要 Key，宜作为正文增强层而非唯一搜索源。
- [DDGS](https://github.com/deedy5/ddgs) 可免 Key 本地运行 FastAPI，聚合 Bing/Brave/DuckDuckGo/Google 等并提供 extract；但 README 明示 educational purpose，底层仍依赖搜索服务非官方入口，稳定性风险与当前 HTML 适配器同类。
- [Mozilla Readability](https://github.com/mozilla/readability) 只负责从已取得的 HTML 提取正文，不是联网搜索源；适合加强当前 `readPublicSourceContent`，不能替换搜索 provider。
- [Open WebUI](https://github.com/open-webui/open-webui) 将 SearXNG、Brave、Tavily 实现为独立 provider，统一归一化为 `link/title/snippet`；Brave 适配器明确处理免费层每秒 1 次和 429 重试。这比在业务函数内硬编码多个 HTML parser 更适合 StoryDream。
- [Vane（原 Perplexica）](https://github.com/ItzCrazyKns/Vane) 仓库直接附带 SearXNG 配置，TypeScript 端调用 `search?format=json`，并把查询规划、搜索、抓取 URL、重排和写作拆成不同阶段，是与当前 Electron/TypeScript 架构最接近的参考。
- [YaCy](https://github.com/yacy/yacy_search_server) 是真正自建索引/爬虫而非元搜索，支持 HTTP JSON/XML API；但需要 Java、持续爬取和索引维护，适合内网/垂直资料库，不适合作为桌面应用默认全网搜索源。
- Jina Reader `r.jina.ai/<url>` 本机匿名实测 HTTP 200，可返回 Markdown；Jina Search `s.jina.ai/<query>` 匿名实测 401，因此只能把 Reader 视为可选正文兜底，不能承诺 Jina Search 零 Key。
- Tavily 直接 REST 匿名实测 401；官方 JS SDK README 所述 keyless mode 是 SDK 提供的共享限流模式，不等同于任意 REST 请求免鉴权，也不宜作为唯一生产通道。
- 国内候选中，智谱 Search Pro 有域名/时间过滤、1-50 条结果和可控摘要长度，要求 API Key；LangSearch 提供 Web Search 与 Rerank、免费额度但同样要求 Key，GitHub 项目体量和维护活跃度明显弱于前述核心候选。
# 联网搜索 Provider 实施判断（2026-08-13）

- 正式首选采用用户自有/本地 SearXNG JSON API；桌面应用只保存服务地址，不负责捆绑容器。
- 零配置备用采用 Tavily Keyless 协议：`POST https://api.tavily.com/search`，请求头携带 `X-Tavily-Access-Mode: keyless` 和 `X-Client-Source: tavily-js-keyless`。
- 现有 HTML 搜索适配器继续保留为末级兼容，避免托管服务临时不可用时完全失去联网能力。
- 当前 `searchWebSourcesDetailed` 在搜索后立即抓最多 20 个目标网页，正文失败会吞掉搜索结果；实施中应把“发现结果”和“读取正文”解耦。
- SearXNG 的 `engines` 参数可承接现有用户选择的 Bing/百度/搜狗/头条渠道；Tavily 不支持该筛选，降级时应保留结果但标记真实后端。
- SearXNG 地址采用相对 `search` 拼接，保留用户配置的子路径；所有托管请求继续走 `provider-api` 网络策略，Tavily Keyless 所需自定义 header 已加入允许列表。
- 真实设置页专用脚本两次因壳层导航选择器与当前页面入口不同步超时；现有热榜 Electron/浏览器 QA 与设置合同测试通过，问题属于 QA 导航脚本而非功能运行时。

---
# 热榜跨平台图文正文阅读发现（2026-08-14）

- 用户截图确认热榜主列表已可用，当前问题不是入口布局，而是“正文”弹窗只有文本，尤其小红书图文笔记缺少图片。
- 现有 `HotBoardSourceContent` 只含 `content/excerpt/kind`；Electron 的 `hotBoardSourceCache` 会缓存整个返回值 30 分钟，扩展可选媒体即可复用既有后台缓存。
- 现有 `readPublicSourceContent()` 仅从 `fetchArticleSnapshot()` 取得文本，媒体应由同一次有界 HTML 抓取解析，避免弹窗再发第二次请求。
- 安全策略：优先公开页面的 JSON-LD、内嵌 hydration state、Open Graph 和语义 HTML；不引入登录 Cookie 窃取、逆向签名或验证码绕过。
- Electron renderer CSP 已允许 `https:` 图片；UI 仍需为远端图片设置 `referrerPolicy="no-referrer"`、懒加载和局部失败占位，以兼容常见 CDN 防盗链。
- 仓库现有爆款拆解解析器已验证 B 站页面的 `window.__INITIAL_STATE__`（`videoData.desc/pic`）与公开 view API；热榜正文只需复用公开页面状态，不需要音视频下载链路。
- 平台结构化状态兼容目标：小红书 `noteDetailMap -> note -> desc/imageList`，抖音 URI 编码的 `script#RENDER_DATA`，知乎/头条常见 `__NEXT_DATA__`，微博/B 站常见初始状态；统一递归提取受控文本键与图片键。
- 图片过滤应拒绝非 HTTP(S)、data/blob、1x1/小尺寸跟踪图，以及 URL 中的 avatar/logo/icon/favicon/emoji/qrcode/sprite/badge/profile/广告标记；最后按规范化 URL 去重并限制数量。
- GitHub 对比：[`yt-dlp/yt_dlp/extractor/xiaohongshu.py`](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/xiaohongshu.py) 同样从 `noteInfo.desc` 与 `imageList.urlDefault/urlPre/width/height` 读取小红书图文，验证本轮字段合同与主流维护实现一致。
- [`DIYgod/RSSHub/lib/routes/xiaohongshu`](https://github.com/DIYgod/RSSHub/tree/master/lib/routes/xiaohongshu) 仍包含 `check-cookie.ts` 和专用请求工具；自建 RSSHub 并不能消除小红书登录/风控边界，因此不作为热榜正文的硬依赖。
- RSSHub 的 B 站 `article.ts/dynamic.ts` 与知乎 `question.ts/zhuanlan.ts` 表明两平台可通过特定公开接口进一步补强，但接口频繁变化且部分路径需要 Cookie；当前先采用页面结构化状态 + 语义 HTML，避免把单平台接口故障扩散到所有来源。
- 首轮人工截图发现嵌套 Fluent Dialog 会叠加遮罩并压暗大图；已改为同一“热点正文”Dialog 内的图文/大图阅读模式切换，避免双焦点层和布局跳变。
- 修正后 1440×900、920×720 实拍中，大图、标题、前后翻页、返回图文和底部正文操作均清晰可达；画廊与查看器均无横向溢出或真实裁切。
- 后续平台兼容补强点：微博公开页常见 `$render_data -> text_raw/pic_infos`，头条常见 `_SSR_HYDRATED_DATA`，知乎 SSR 的 `content` 字段可能把 `<img>` 包在 HTML 字符串中。

---
# 右上角主题按钮悬停闪屏修复发现（2026-08-17）

- 壳层测试确认右上角主题按钮使用 `Tooltip` 包裹 `IconButton`，主题切换回调应由点击触发。
- `IconButton` 已默认写入 `aria-label` 和原生 `title`；外层 Fluent `Tooltip` 使同一个主题按钮同时拥有原生提示与 Portal 提示，这是 hover 时唯一新增的整窗层级和重复提示机制。
- 修复只移除主题按钮的 Fluent `Tooltip` 包装，保留原生 `title`、可访问名称、图标、禁用态和 `onClick={toggleTheme}`；最小化、最大化、关闭按钮的既有 Tooltip 不受影响。
- Electron QA 使用 `webContents.sendInputEvent` 真实移动鼠标，覆盖深色/浅色主题与 1440x900、1080x720 两种内容区尺寸；每场景连续采样 6 帧，并执行移入、移出、再次移入。
- 4 个场景的 document 与 StoryDream Provider 主题始终一致，壳层持续可见，按钮边界稳定；`blankFrameCount=0`、`roleTooltipCount=0`、`tooltipMechanismCount=1`。
- 4 张悬停状态截图人工复核无黑屏、跳位、遮挡或对比度问题，报告与截图位于 `.artifacts/theme-hover-stability-2026-08-17/`。
- Windows `rg` 不展开 `src/styles*.css` 路径通配符；后续改为显式文件或目录配合 `-g`，不重复该命令。
- PowerShell `Copy-Item -LiteralPath` 不展开 `*`；截图归档改为从已确认的 captures 目录枚举文件并逐个复制。
- PowerShell 双引号会改变内嵌 `rg` 正则；收尾行号定位改用 `Select-String -SimpleMatch`，生产文件未受影响。

---

# AI 与全网搜索组合模式按钮解锁发现（2026-08-17）

- 用户截图中“全网搜索”和“AI 内置知识补全”同时开启，但尚未执行搜索、没有网页来源，生成按钮被禁用。
- 根因是 `canComposeResearchCopy` 仍以 `webSearchEnabled` 强制要求 `selectedSources.length > 0`，没有让 AI 内置知识成为组合模式下的独立兜底来源。
- 正确合同是按实际可用来源判断：AI 开启即可生成；仅网页模式才要求选中网页；组合模式无网页时按 AI-only 生成，有网页时再结合网页。

---

# 选品助手榜单、搜索与带货创作闭环发现（2026-08-17）

- 用户给出的 StoryBound 参考图是桌面高密度表格工作台：顶部主题搜索与“生成书单”，中部赛道快捷入口和高级筛选，主体按当当榜排名展示书籍、AI 细分类/卖点、销量级、带货潜力、视频号关键词、创作状态及行内操作。
- 当前工作树已有未提交的壳层/导航改动，且现有计划正在恢复固定“选品助手”入口；本轮必须在这些差异上增量实现并保留其他改动。
- 本轮会把截图作为信息架构与交互参考，同时遵守 StoryDream 既有 Fluent UI、珊瑚色品牌强调和桌面工作区密度，不机械复制截图的绿色/暗黑品牌外观。
- 原始参考图为 1693×943。首屏约 190px 用于搜索、快捷赛道和筛选，余下区域由带 sticky 表头的单一纵向表格占据；榜单排名、40px 左右书封、书名/作者/价格、AI 标签、卖点、销量级、星级潜力、视频号潜力、关键词、创作状态与操作均保持稳定列宽。
- Product Design saved context preflight 返回 `user-context.md` 不存在；本轮设计依据使用用户当前截图、StoryDream 源码、语义 token 与项目组件合同，不依赖未验证的历史设计来源。
- 视觉转译决策：复刻信息架构、密度、sticky 表头和工作流，不复刻 StoryBound 的绿色主品牌；StoryDream 的珊瑚主操作与语义状态色继续作为权威主题。
- `BookSelectionPage.tsx` 已有本地 `BookSelectionRecord[]`、稳定 `{theme, bookId}` 选择、最多 4 项对比、五维机会评分、对标证据、创作简报和删除/保存能力；不能用纯新表格覆盖这些状态与数据。
- 现有创作交接通过 `sessionStorage.book_product_info` 进入 `new-task`，对标交接通过 `benchmark_search`；这是本轮“去创作”应复用的既有合同。
- 旧候选页仍使用大量原生 button/input/select/textarea，属于被改工作流中的遗留实现；本轮应逐步换成 `src/ui` 组件，至少保证新增搜索、筛选、快捷赛道、收藏和行内命令不引入新的原生控件。
- `NewTaskPage` 当前读取 `sessionStorage.book_product_info` 后直接把 JSON 字符串写入 `productInfo` 并启用 `keepPromotion`；新交接应改为人可读且可直接进入 prompt 的图书资料，同时兼容旧 JSON 值。
- 项目 UI 层已提供 `Button`、`IconButton`、`TextField`、`TextAreaField`、`SelectField`、`CheckboxField`、`Tabs`、`SegmentedControl`、`Dialog`、`Tooltip` 等足够组件，无需新增第三方 UI 依赖。
- 2026-08-17 对 `https://search.dangdang.com/?key=抗衰养生&act=input` 实测返回 HTTP 200、约 315 KB、GB2312 HTML；公开结果项含顺序位置、产品 ID/链接、封面、标题、现价、作者、出版日期和出版社，足以形成“当当搜索榜”。
- 当当搜索结果顺序是相关度/站内排序证据，不等于可验证的销量榜；UI 应写“当当搜索榜/相关度排序”，评论量或销售级仅在公开结果确有字段时显示，不能从排名推导销量。
- `public-research` 网络策略允许公开 HTTP(S)、限制重定向/体积/超时与危险头，可直接复用；当当 GB2312 响应需要按 charset 解码，不能直接使用默认 UTF-8 `readTextBounded()`。
- 项目没有声明生产 HTML DOM 解析依赖；`linkedom/htmlparser2` 只出现在开发依赖的传递锁项且不会被现有 electron-builder 文件白名单打包。实现应使用严格限定在当当结果项结构的解析器并用完整夹具回归，避免引入与本功能不成比例的新运行时依赖。

---
# AI 漫剧 Phase 8 实施发现（2026-08-17）

- 采用“一个 StoryDream 任务保存一个系列项目”的所有权：Series Bible、角色身份与造型、场景和道具在系列级共享；`episodes[]` 各自拥有戏剧场景、镜头、对白和时间线。
- 角色身份与造型必须是两个稳定实体；镜头引用 `characterLookIds`、`sceneAssetId`、`propAssetIds`，不复制提示词快照来冒充一致性。
- 首版仅创建和编辑结构草案，API 只包含 `motion-comic:create` 与 `motion-comic:save`，不暴露生成、运行或 Provider 命令。
- `pipeline_data` 继续承载严格版本化文档；保存沿用 VOX 的 `expectedUpdatedAt` 乐观并发、身份字段不可变、归档/运行中只读约束。
- 独立工作台沿用三栏作者工具模式：系列树与稳定 ID 选择、当前镜头画布/时间线、按实体类型切换的检查器；普通和紧凑桌面都必须验收。
- 最终实现把共享制片合同中的 motion-comic 占位类型替换为真实领域类型别名，同时保持普通视频、HTML 视频、VOX 与 AI 漫剧四个 runner 独立。
- Electron 实测创建“雨夜来信”、选择第二镜、把景别改为“特写反应”并保存成功；保存后按钮回到禁用态，证明乐观并发和脏状态回收正常。
- 1440x900 与 1040x720 报告均为 `timelineShots=6`、`treeShots=6`、横向溢出 0、运行时错误 0，且 `providerJobs=0`；首版结构编辑边界没有被生成命令突破。
- 原始截图人工复核确认：桌面三栏宽度稳定；紧凑窗口收起全局导航文字后，项目树、画布和检查器仍保持独立滚动，没有面板重叠、空白画布或关键控件裁切。

## 上传范围判断

- 当前分支为 `codex/storydream-fluent-ui-system`，跟踪 GitHub `origin/codex/storydream-fluent-ui-system`；上传前必须重新 fetch 并验证远端重叠。
- 提交范围包含已完成的源码、测试、QA 脚本和项目记录；`.artifacts/` 含浏览器 profile，`.codex-audit-temp/` 为运行缓存，两者只留本机并加入忽略规则。
- 不使用 `git add .`；按明确路径暂存后检查 staged 清单，避免把本地 QA 数据或未知文件带入提交。
- Git smart HTTP 两种传输均被连接重置，但使用本机已存凭据的 GitHub REST API成功确认远端分支头为 `410301bce82eb5b4c7e2cc9adfb7dda277881e03`，与本地 tracking ref 一致。
- 上传前全量回归两次分别为 1872/1878、1873/1878；库存缺口已修正，剩余失败均在 Windows 临时目录或默认 5 秒边界，逐项串行聚焦全部通过。类型检查与生产构建通过。
- 功能提交 `fa25607` 已通过标准 Git push 发布到 `origin/codex/storydream-fluent-ui-system`；此前 fetch 连接重置未影响最终 push。

---

# VOX / AI 漫剧端到端修复发现（2026-08-18）

- 本轮隔离 Electron 已证明底层不是空壳：图片档案切换可持久化，本地成片生成、原生视频播放/暂停/拖动和返回均通过。
- 两条页面在没有请求项目时通过 effect 自动打开 `projects[0]`；首次 render 会先进入 `!document` 创建页，随后再切工作台，媒体图片又直接渲染，无统一 ready gate，形成创建页/黑框闪现。
- VOX 创建页只收集标题、原文和画幅；AI 漫剧只收集系列名、核心设定、首集标题和画幅，创建前缺少服务、结构、视觉、一致性、声音、字幕、输出和费用预检。
- 工作台“项目设置”与 AI 系列设定内“模型设置”都只导航到 `settings`；设置页 `section` 固定初始化为 `llm`，没有分区深链或返回上下文。
- AI 系列、世界、视觉、负面提示词和角色编辑全部塞入 Dialog，1536x1024 已出现横向滚动和角色区不可见，应改为常驻全页工作区。
- 制作轨道前三步按 `index < 3` 固定显示完成，底部“系统状态：正常”也是硬编码，与图片/旁白未连接状态冲突。
- 1040x720 下仍保持三列，阶段降到 8px、多个辅助文字为 9-10px；项目名和服务名明显截断，需要显式折叠面板而不是继续压缩文字。
- 镜头列表、队列和素材小圆点部分依赖颜色；需要可见或可访问的状态文字，并验证键盘焦点与 200% 放大风险。
- `App.navigate` 当前只接受 `ShellView`，最小兼容改法是在 App 层新增一次性 `settingsEntry`（section、returnView），继续保留所有既有 `navigate(view)` 调用；`SettingsPage` 接收 `initialSection/onReturn`，避免扩散路由类型或破坏持久化 activeView。
- 现有工作台测试以源码合同为主，适合先新增失败断言锁定项目首页、三步向导、`initialSection="image"`、非 Dialog 系列圣经、动态阶段和媒体状态，再配合 Electron 脚本做真实交互证明。
- 现有版本化文档已经能承载向导选择：VOX 有 `selectedStyleId`、shot layout/motion/voice/subtitle/seed；AI 漫剧有完整 series/characters/sceneAssets/props 和 shot 同类字段。因此创建基础文档后立即应用向导 preset 并走现有 save，可避免新增 IPC 或无效展示字段。
- VOX starter 固定四段 30 秒，AI starter 固定三场六镜 40 秒；首轮向导应如实展示并允许选择现有可表达的模板/画幅/声音/字幕，而不是承诺当前领域模型尚不能安全表达的任意镜头数。
# VOX / AI 漫剧统一任务体系重构发现（2026-08-18）

- 用户截图为 1320×860：页面脱离主应用壳层，重复提供“返回首页”、VOX/AI 漫剧切换、继续项目、新建项目和项目库，形成第二套信息架构。
- 截图中的项目卡信息被挤在大面积空白中，字段断裂为多行；页面强调产品介绍而非继续创作，不符合桌面生产工具的高频任务路径。
- 用户明确要求：任务继续属于当前软件；点击任务进入新工作区；新建任务可以选择目前已有的几个主题；整体页面、功能和逻辑要整理成一套软件。
- `frontend-design` 约束要求先确定具体受众、单一页面任务与视觉系统；本轮选择“统一任务入口”而非再设计一个 VOX 营销首页。
- `storydream-ui` 与 `ui-ux-pro-max` 共同要求保留主壳层、复用 `src/ui` 和语义 tokens、保持稳定工作区，并覆盖真实状态与普通/紧凑桌面截图。
- 项目是 Electron 41 + React 19 + TypeScript + Fluent UI 封装，现有主任务体系为 `new-task / queue / history / task-detail`。
- `src/app/navigation.ts` 已有 `taskWorkspaceView(taskType)`，可把普通任务、VOX (`editorial-collage`) 和 AI 漫剧 (`motion-comic`) 映射到各自工作区；无需发明第二套路由模型。
- `AppShell.tsx` 在壳层中直接放置 VOX/AI 漫剧按钮，但两条功能页又复用 `DirectorProjectLibrary`，造成壳层入口之后再次进入项目库。
- `DirectorProjectStart.tsx` 同时拥有项目库、创建向导、模式切换与恢复状态；应保留创建预检/恢复组件，停止让 VOX/AI 路由渲染独立项目库。
- 新建任务页面已有完整三阶段内容创作流程，不能粗暴替换；需要在它之前增加轻量且可恢复的任务主题选择，或用带上下文的入口直接选中主题。
- `AppShell.tsx` 目前在所有内容页的 `page-head` 内再渲染一组 VOX/AI 快捷按钮，同时侧栏已有同名入口；这是第二处重复导航，应由统一任务/创建上下文替代。
- 现有侧栏把 VOX/AI 漫剧归在“素材与实验”，但二者实际创建、持久化、生成、渲染、导出完整项目，产品归属应是“创作生产”或统一新建任务类型，而不是实验室。
- `DirectorProjectLibrary` 本身包含返回首页、跨模式切换、产品介绍、继续项目、新建项目和项目列表，几乎完整复制应用壳层；该组件应退出正常路由，只保留创建向导和加载状态。
- `DirectorCreateWizard` 的三步预检、服务状态和不付费创建说明是有效功能，应保留，但返回文案/目标要从“项目库”改为统一任务视图。
- `App.openTaskDetail(taskId)` 已实现统一直达：普通任务进入 `task-detail`，VOX 进入 `editorial-collage`，AI 漫剧进入 `motion-comic`，HTML 视频进入 `html-video`，并传递 requested task ID。
- 两个导演页在没有活动文档时硬编码渲染 `DirectorProjectLibrary`；把该分支替换为创建预检，已有任务仍可由历史/最近任务经 `openTaskDetail()` 直接恢复。
- 两个导演工作区的“返回项目库”目前调用 `showLibrary()` 清空活动文档；应改为返回统一历史任务视图，同时保留未保存状态处理的现有语义。
- `HistoryPage` 已用 `api.listTasks()` 读取统一 Task 表，并显示标题、类型、状态、进度、更新时间；整行和“打开”操作都调用 `openTaskDetail(record.id)`，可直接承接全部项目库职责。
- VOX/AI 漫剧的浏览器 fallback 与 Electron handler 都创建标准 `Task`，分别写入 `taskType: editorial-collage` 和 `taskType: motion-comic`；持久化已经统一，当前割裂纯属 UI/路由问题。
- 当前可稳定映射到独立任务工作区的创建类型为：普通智能成片、VOX 视频、AI 漫剧、HTML 动画；音乐 MV、画图、配音等仍是专项工具/记录，不应混入项目类型选择。
- `HistoryPage` 现有加载、空、归档、收藏、搜索、状态过滤和分页已覆盖统一项目管理需要，本轮无需建立新 dashboard 或复制任务卡列表。
- `director-desk.css` 当前按 `data-shell-view` 无条件隐藏 `.window-line`、`.sidebar` 和 `.page-head`，因此项目库和创建向导也脱离主软件；这与用户截图完全一致，是主要视觉根因。
- 正确的沉浸条件应是页面内真实存在 `.director-desk` 工作区，而不是仅凭 VOX/AI 漫剧路由；创建向导应保留主壳层，具体任务工作区才可全屏沉浸。
- 浏览器预览提示的 CSS 也按路由排除了 VOX/AI 漫剧，需要同步改为仅在真实导演工作区排除，否则创建页提示会占用错误网格高度。
- 新建任务现有工作区宽度与语义 tokens 可复用；任务类型选择应是紧凑横向工具带，放在三阶段步骤前，不增加营销 hero 或嵌套卡片。
- 导演工作区头部目前仍有 VOX/AI 漫剧 `SegmentedControl`；项目类型是持久化文档属性，不应在已打开项目里作为临时视图模式切换，统一导航应由主壳层承担。
- 导演工作区已有项目下拉菜单，可以在同类型项目间直接切换；返回按钮因此只需回到“全部任务”，不需要再打开类型专属项目库。
- Requested task 打开失败时不能静默落入空页或独立库；需要显示同壳层恢复状态，提供“返回全部任务”和“新建当前类型”两个明确动作。
- 项目现有 `scripts/qa-director-desk.py` 可在隔离 Electron profile 中做普通/紧凑窗口、布局、媒体像素和交互验证，但入口脚本仍依赖已删除的 `.director-quick-launch`、旧“VOX 视觉导演”名称和旧创建按钮，需要随产品合同更新。
- 当前 5173 没有监听；最终需在实现和 QA 完成后启动最新 Vite renderer，供用户直接复测。
- Codex 随附 Python 环境没有 `playwright`；旧 `qa-director-desk.py` 后半段也依赖已淘汰的弹窗式系列设定，不能作为本轮直接门禁。
- 本轮将复用项目 Electron + CDP 的证据方式，以随附 Node Playwright 创建范围明确的统一任务 QA，不安装或修改项目依赖。
- Electron 专项 QA 证明统一链路成立：新建任务显示智能成片、VOX 视频、AI 漫剧、HTML 动画四类；VOX/AI 创建页仍显示主壳层；具体 VOX 项目才进入沉浸 Director Desk。
- 隔离 profile 创建“统一任务系统 QA VOX”后，历史任务表将其显示为 `VOX 视频`，从导演台返回历史再点击该行可直接恢复工作区，不经过类型专属项目库。
- 首轮截图门禁发现所有主壳层页面的关闭按钮命中框右侧越界 6px；根因是 `src/styles.css` 的旧 `margin-right: -20px` 与 `shell.css` 新 14px 标题栏 padding 不一致，覆盖为 `-14px` 后消除。
- 最终 7 张 Electron 截图逐张复核：创建类型带、VOX 创建页、AI 漫剧创建页、导演台和统一历史表信息层级一致，没有重复模式页签、独立项目库、文字重叠或不可达主操作。
- 最终专项报告为 `status=passed`，全部状态 `horizontalOverflow=0`、`clippedControls=[]`、`runtimeErrors=[]`；全库回归 146 文件、1905/1905 通过。

---
