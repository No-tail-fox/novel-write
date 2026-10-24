# 创意动画完整流程：实施与验收

更新：2026-10-24。本轮已接通三种制作入口、Lemo 风格资料与后台逐镜代码创作闭环，产出可播放的真实样片。当前审查为 review v3；最新 23.88 秒模板回退片通过字号、背景、媒体与响度检查，保存的 AI 镜头未通过 v3。**实施接通、组件集成验证和影片质量验收分别记录：当前不具备“全部风格成熟”或“正式产品一键出片已完整验收”的证据。**

## 产品与制作流程

| 入口 | 本轮结果 | 兼容范围 |
| --- | --- | --- |
| 短片生成 | 创建入口说明图文素材、配音和剪辑的工作方式 | 保留现有短片工程与执行链；本轮没有重新验收全部短片能力 |
| HTML 动画 | 明确 HyperFrames 制作方案；Core / Player / Lint 固定 0.8.40，GSAP 3.12.5；加入与安装版本对应的宿主约束和语义模板选择 | 延续现有 HTML 场景编辑、Player、时间轴与自有捕获后端；未全量引入上游最新组件或官方 engine |
| 创意动画 | 原 Vox 入口显示为创意动画；解释叙事为片型，Lemo 为风格与导演方法来源；模板打底、AI 逐镜写代码、检查、有限修复及回退 | 保留 `editorial-collage`、旧 taskType、路由与原生文档；不新增 Lemo 工作台 |

继续使用用户选定的第三张 process-outline：左侧制作与镜头大纲，中央预览和旁白编辑，固定项目主操作，高级风格和制作选项按需展开。新项目默认 AI 代码制作、风格自动匹配；旧项目保存的制作偏好保留。锁定镜头和手动代码不被自动重写。

自动制作链为：

`来源文案/素材 → 计划 → 必要素材/抠图 → 真实配音与句级排时 → 模板打底 → AI 代码 → 编译与浏览器检查 → 必要时修复一次 → 复检或模板回退 → 最终编译 → 渲染 → 媒体门控`

原生 HTML 与 editorial 文档仍各自拥有权威状态。共享工作流是投影和能力复用，不将不同源码格式宣称为无损互转。

## Lemo 收录与适配

- 上游：[lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)，固定提交 `3961ddb3d24d8876e0e2754f7790d66908acee51`。
- 本地 [manifest](I:/opc/vendor/lemo-opuscar/manifest.json) 登记 **59 种风格、126 份文本文件**，含 STYLE、元数据、DIRECTOR、TECHNIQUE、个人风格方法与制作参考；逐文件保留 SHA-256 和 MIT 许可。
- 首批 **6 种已适配**：`halftone-dossier`、`archive-lighttable`、`dataviz`、`swiss-motion`、`dark-keynote`、`paper-popup`。其余 53 种可检索资料、不可作为已适配风格启动。
- 生成前核对固定提交与文件哈希，只加载当前 STYLE 及有长度上限的导演/技术片段。上游 AGENTS / Skill 是参考数据，不作为项目全局指令执行；宿主运行时合同优先。
- 未导入 demo 媒体或第三方语音；许可证见 [LemoLab-MIT.txt](I:/opc/THIRD_PARTY_LICENSES/LemoLab-MIT.txt) 和 [第三方声明](I:/opc/THIRD_PARTY_NOTICES.md)。

**59 是资料数、6 是适配数；本轮收紧提示后的真实 AI 代码只覆盖 dataviz 的一个横屏镜头。该镜头曾通过 v2，现被 v3 拒绝，当前没有通过 v3 的 AI 代码镜头。没有将六种或全部风格标为影片质量已验收。**

## 后台执行、恢复与付费边界

`vox-production-service` 在主进程串行派发持久化节点。离开页面后应用仍打开时可继续；关闭应用不继续派发，重启恢复需要核对保存状态。暂停会阻止派发新节点，在途请求结果先保存。

代码请求前持久化稳定 request ID 与输入指纹；收到源码后先保存，再编译和检查。编译、内容或布局失败最多修复一次，**一个镜头最多两次代码请求**；达到上限后保留原始及修复源码、错误和抽帧路径，回退稳定模板。基础设施故障暂停，不触发付费修复。审查规则升级也不能购买第三次修复。

已完成输入可复用；变更只使受影响的后续节点失效。手动编辑移交作者所有权。未知付费结果不会因恢复、换风格或审查升级而自动重发。

本轮真实组件集成在首个代码请求在途时暂停，保存响应后退出，**由第二个独立进程恢复完成**。复用了原计划和四段旁白，原 request ID 不变；七次原始代码生成/修复请求无重复 ID。收紧提示后另有一次真实单镜请求，本轮合计 **8 次新增代码调用**；后续 v2/v3 重审、模板回退、混合成片、独立镜头导出及最新质量样片均为 0 新增付费请求。

证据：[暂停记录](I:/opc/.artifacts/creative-integration/pause-report.json)、[初始进程日志](I:/opc/.artifacts/creative-integration-start.log)、[恢复进程日志](I:/opc/.artifacts/creative-integration-resume.log)、[七次请求账本](I:/opc/.artifacts/creative-integration/dispatches.json)、[集成报告](I:/opc/.artifacts/creative-integration/report.json)、[新增单镜请求记录](I:/opc/.artifacts/creative-prompt/claim.json)。实际账单金额未取得供应商结算依据，不用估算价冒充实付金额。

### 正式入口的授权阻塞

本轮正式 Electron IPC 在供应商派发前返回：`LICENSE_REQUIRED: 本机尚未绑定授权，或已被远程解绑。` 没有修改或绕过授权。见 [正式入口报告](I:/opc/.artifacts/creative-animation-production/report.json)。

因此，本轮付费链证据来自真实生产 service / runtime、配置模型、浏览器与 FFmpeg 的独立组件集成；**不能替代本轮正式产品 IPC 一键制作验收**。2026-10-23 的正式数据模板链已有独立历史证据，但不覆盖本次新增代码节点。

## 浏览器审查的实际能力

当前 review revision 为 **3**。编译后的镜头在真实 Chromium / 字体环境执行，定位 15%、50%、85% 三个时间点，保存截图，检查执行错误、空画面、可见文字越界及字幕保留区。文字可见性计算包含祖先 opacity / visibility，DOM 文字使用实际 Range 边界。

v3 新增最终画布字体下限 `max(14, min(width,height)/45)`，即 1080p 短边下至少 24px；计算 DOM 实际缩放和 SVG screen CTM，不只读逻辑字号。对无图片素材的图形镜头，还检查覆盖画布的实际不透明背景是否遵循所选风格，RGB 单通道容差 32。带摄影底板的镜头不套用纯色背景检查。失败归为布局问题，沿用有上限的修复/回退流程。

另有少量有界内容模式，阻止在来源文案、数据或档案文本未提供时增加“历史最高”“警戒线”“1951–1980 基准期”等断言。模型生成的画面提示不构成事实依据。**这不是通用事实核查、VLM、完整听审或审美评价；三帧也不能证明每一帧没有遮挡。字幕仍为句级估算，未完成声学词级对齐。**

真实旧四镜在 v2 下全部拒绝：存在截断 TSX、字幕区侵入或增加无依据断言。旧代码和请求全部保留；不能以旧版集成报告中的 completed 将其算作新版画面通过。收紧提示后的一次新请求 `97e0cda5-2b86-48b4-865d-b948cbfb4747` 曾通过 v2 编译与三帧审查，未进行付费修复。

**同一份保存源码在当前 v3 下被拒绝**：13/14px 标签低于 24px，实际背景 `rgb(22,27,34)` 偏离所选 `#f4eedf`。没有新发模型请求来换取通过结果。拒绝记录见 [saved-ai-review.json](I:/opc/.artifacts/creative-quality-v3/saved-ai-review.json)，源码、request ID 与付费账本均保留。

## 转场与最终混音

新建创意自动流程在未保存具体转场时采用直切；原稿或用户显式选择的转场继续保留，包括 200ms 交叉淡化。QA 副本明确选择直切，未改写真实用户工程和历史样片。这样避免图表和标题在默认叠化中短暂出现两套。

创意生产输出在包括背景音乐的最终混音后 opt-in 两遍 FFmpeg loudnorm，目标 −16 LUFS / −1.5 dBTP / LRA 11。视频流复制、音频 48kHz AAC，按原制作时长补齐/截断音轨并限制容器输出，避免处理尾部改变影片时钟。静音内容不强行放大，未 opt-in 的旧合成路径保持原行为。渲染指纹包含本次创意渲染版本，防止误复用旧输出。

## 可播放样片与人工抽帧

素材为已保存的 NASA GISTEMP v4 数据与原四段真实旁白：2000 / 2010 / 2020 / 2024 年分别为 0.39 / 0.72 / 1.01 / 1.28 ℃。没有重新购买计划、图片或语音。

| 产物 | 媒体证据 | 画面结论 |
| --- | --- | --- |
| **[当前 v3 质量样片](I:/opc/.artifacts/creative-quality-v3/creative-nasa-quality-v3.mp4)** | **23.88 秒，1920×1080，878,634 字节；完整音视频解码通过，−16 LUFS / −1.4 dBTP，非静音、未检测到长黑帧** | 四镜均为稳定模板，全部通过 v3 三帧检查；统一浅纸色、直切；不算 AI 代码画面或全片审美验收 |
| [历史完整模板回退片](I:/opc/.artifacts/creative-saved-review/creative-nasa-reviewed.mp4) | 23.88 秒，1920×1080，有声，完整解码通过 | 四镜均为模板；验证问题代码能回退成片，保留原样 |
| [历史 AI 代码 + 模板混合片（v2）](I:/opc/.artifacts/creative-reviewed-render/creative-nasa-mixed-reviewed.mp4) | 23.88 秒，1920×1080，1,169,768 字节；完整音视频解码通过、无检测到的长黑帧、非静音 | 首镜为 AI 代码，后三镜为安全模板；风格一致性未通过，首镜现在不满足 v3 |
| [历史独立 AI 镜头（v2）](I:/opc/.artifacts/creative-reviewed-render/creative-nasa-ai-shot.mp4) | 从混合片精确重编码导出约 8.83 秒，1920×1080，822,084 字节；完整解码通过 | 供观察保存的模型动画，不能作为当前 v3 通过证据 |

当前 v3 样片 SHA-256：`5e5989f0705f965d6ceda02defe39c323dc741c9e23ce780f2ab1b8f50a5b80e`。制作时间轴 23,874ms，容器 23,880ms，差 6ms。四镜 v3 抽帧、九句字幕字体/安全区/边界可见性及媒体门控通过；这些检查不等于声学词级对齐。

人工查看 [当前 12 帧联系表](I:/opc/.artifacts/creative-quality-v3/contact-sheet.jpg)：四个来源值一致，浅纸色连续，图表/标题没有交叉淡化双影，字幕可读；后续镜头按估算句级时间高亮年份。该片仍是重复图表的基础呈现，没有完成整片听审、VLM 或创意表现成熟度评价。

最新证据：[质量报告](I:/opc/.artifacts/creative-quality-v3/report.json)、[媒体探测](I:/opc/.artifacts/creative-quality-v3/probe.json)、[四镜 v3 检查](I:/opc/.artifacts/creative-quality-v3/template-reviews.json)、[完整解码记录](I:/opc/.artifacts/creative-quality-v3/media-verification.json)、[解码日志](I:/opc/.artifacts/creative-quality-v3/decode.log)。无 provider 脚本见 [qa-creative-quality-v3.ts](I:/opc/scripts/qa-creative-quality-v3.ts)：检查账本与单镜 claim 未变化。初次打包失败的 bootstrap 日志保留为历史，成功以本目录 report / decode 记录为准。

以下为原样保留的 v2 历史证据与当时发现的问题：

混合片 SHA-256：`a0fb3e77b8e6cf1d8048b43f7de791768c35012e4a996c9ef5671fcf82c8c844`。

独立镜头 SHA-256：`f7b2cbfaea674b06b21a0da2c35928ab32ad5e05ecc8bc2fe9131e68d24e8628`。

人工检查 [历史 12 帧联系表](I:/opc/.artifacts/creative-reviewed-render/contact-sheet.jpg)，覆盖首中末、字幕句中及三个切点：四个来源值一致、主体和字幕可见。当时发现以下问题：

1. AI 镜头坐标和来源字号偏小，低分辨率观看吃力。
2. 模型使用深色网格，模板为浅纸色；首个转场明显变色，并在交叉淡化中叠出两套图表/标题。v2 像素连续性检查没有阻止这种风格不一致。
3. 综合响度 −20.7 LUFS，低于质量门建议的 −20 至 −14 LUFS；峰值 −5.3 dB。媒体有效性通过，但响度 warning 保留，不能写成全部质量项通过。
4. 只做抽帧，未完成独立审片人的整片观看和听审。

历史混合片 [渲染/质量报告](I:/opc/.artifacts/creative-reviewed-render/report.json)、[媒体探测](I:/opc/.artifacts/creative-reviewed-render/probe.json)、[完整解码及导出记录](I:/opc/.artifacts/creative-reviewed-render/media-verification.json)、[解码日志](I:/opc/.artifacts/creative-reviewed-render/decode.log)。旧 [混合片脚本](I:/opc/scripts/qa-creative-reviewed-render.ts) 要求审查版本一致，不能用其历史 v2 报告绕过当前 v3。

v3 样片通过拒绝问题源码、模板回退、直切和最终混音解决了本次样例的背景跳变、叠图与低响度；**没有证明模型已能稳定生成符合 v3 的镜头**，也没有覆盖所有风格或摄影素材下的连续性。

## 测试与界面证据

| 检查 | 本轮结果 | 说明 |
| --- | --- | --- |
| 最新质量与核心聚焦回归 | **5 文件 / 168 项通过** | creative-animation、director-render、vox-production、html-video、storybound-sidecar；包含真实 FFmpeg 低响度合成、opt-out、时长保持及旧转场保留 |
| 最新兼容回归 | **6 文件 / 52 项通过** | task-runtime-providers、html-video-composition、hyperframes-studio、vox-animation、vox-data-chart、vox-project-action |
| `npm run typecheck` | 通过 | renderer / Electron / scripts，包含新增无付费 v3 QA 脚本 |
| `npm run build` | 通过 | 保留已有 Node 模块 browser externalization 警告；不是安装包验收 |
| 第三张工作台真实页面 QA | 97 项检查 / 32 张截图通过 | 真实 React + runtime，隔离 Electron，API / 持久化模拟；深浅色、正常/紧凑/窄窗口、200% 缩放、100 镜头、抽屉焦点及高级风格状态 |
| 独立生产组件真实链 | 完成并跨进程恢复 | 配置中的 `gemini-3.7-flash-high`、已有真实旁白、实际浏览器、FFmpeg；正式 IPC 未通过，见授权阻塞 |
| 额外 shell/产品源码合同 | **168 项中 160 通过、8 失败** | 独立的历史检查集合，未计入上述 168 + 52 项通过结论；不宣称全仓测试通过 |

八项额外失败：`director-product-flow.test.ts` 的创建 preflight、绘画设置返回链接、系列 bible 页面、风格基准选择；`product-shell-ui.test.ts` 的激活反馈、侧栏/版本文案、HTML 增量媒体依赖、renderer command owner。它们是源码结构/字符串断言，当前仍失败，本轮未用更新快照将其消除。

最新日志：[168 项质量回归](I:/opc/.artifacts/creative-quality-tests.log)、[52 项兼容回归](I:/opc/.artifacts/creative-quality-compat-tests.log)、[三套类型检查](I:/opc/.artifacts/creative-quality-typecheck.log)、[构建](I:/opc/.artifacts/creative-quality-build.log)、[97 项界面原始报告](I:/opc/docs/design/2026-10-22-vox-generation-simplification/implementation-evidence/report.json)、[168 项额外报告](I:/opc/.artifacts/creative-shell-tests.json)。界面检查来自本轮较早的页面改动；v3 质量收尾未修改页面布局。此前 72 / 15 项日志保留为历史，不重复累加进最新 220 项。

## 未关闭的验收项与后续顺序

本次 dataviz 安全模板片的字体、背景、直切和响度已有独立验证；AI 代码镜头仍未满足 v3，应先取得符合当前合同的真实代码样片和完整观看/听审证据。在有效产品授权下补本次新增节点的正式入口验证。接着完成同一份 30–60 秒文案/素材的短片、HyperFrames HTML、创意动画对比，以及六种适配风格的完整横竖屏样片。当前 NASA 23.88 秒模板片和历史混合片均不满足这组对比验收。

VLM、声学词级时间、其余 53 风格适配、长片/并发、新安装包与更多供应商恢复，均为后续有独立证据的项目。HTML 的历史 1080p 基准和 4K 中止也不能扩大为新链的长片能力证明。

历史范围保持准确：HTML 已有两次 **48.78 秒、六镜、1920×1080、24fps** 基准通过，耗时约 303 / 366 秒，进程树私有内存峰值约 2.70 / 1.56 GB；4K 在 3.5 GiB 保护线上中止，无通过成片。24 镜、并发和新组件链未测。详见 [定位报告证据](I:/opc/docs/research/2026-10-24-ai-filmmaking-positioning/README.md)。

AI 漫剧远程角色连续性、口型、参考素材实际接收和完整上传/下载断点恢复仍未验证。风格库和入口重命名不改变这些结论。
