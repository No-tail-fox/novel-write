# Vox 动画：Vibe-coding 视频 Skill 与模板库调研

- 调研日期：2026-10-23
- 范围：GitHub 上以 Agent Skill、代码生成视频、Vox 风格解说、可复用动效配方或模板市场为核心的项目。
- 方法：读取项目 README、Skill、Gallery 数据、模板/资源格式与许可证；GitHub API 当日受到未认证速率限制，因此不把 Stars 当作成熟度证据，也不在本文引用未经复核的热度数字。
- 限制：仓库自述和作者发布的样片属于一手项目材料，但不能代替对本地完整构建、所有模板和长片渲染的独立验收。

## 结论先行

Vox 更适合定位为 **代码驱动、可编辑、逐镜头生成的 vibe-coding 视频工作台**：Agent 把脚本/语义镜头变成 Remotion 或其他时间确定的代码画面，再由固定渲染器输出，而不是把“Vox”做成一组孤立的 AI 视频模型选项。

GitHub 上没有一个项目同时提供“全片流程 + 很多高质量可选镜头 + 广泛片型 + 可审查的包分发”。最值得组合借鉴的是：

1. **video-shotcraft**：学习最大规模的镜头配方目录、可视化预览和卡片元数据；当前公开索引记录 124 张镜头卡、150 个样式/预览。
2. **iart-ai/motion-skills**：学习如何把专业制作知识拆成可按需装载的 Skill；项目自述为 55 个 Skills、18 个主题 Pack。它不是 55 个成片模板。
3. **VVV**：学习“先看真实短样片、再批准整片渲染”、模板可编辑、模板包自描述和验收证据。其当前公开的 5 个完整片型全是婚礼片，数量多样性不足以直接当 Vox 内容库。
4. **OpenChatCut**：学习模板/转场/效果作为可预览、可安装、注明作者和许可的社区资源目录。项目仍在快速开发；主项目为 AGPL-3.0，不应直接拷贝整套编辑器代码。
5. **code-video**：最贴近“Vibe coding 视频”的 Skill + CLI 路线，覆盖 9 种代码视频技术栈并明确要求逐帧检查；但这是值得评估的年轻项目，不宜仅凭项目自述判定质量已成熟。
6. **Remotion 官方 Skills**：生产集成最稳妥的工程基线，提供 11 个细分 Skills（含最佳实践、创建、字幕、地图、Studio 与渲染）；它教 Agent 正确使用 Remotion，不负责提供海量成片风格。

**对当前 Vox 的关键判断：目录数量已经不是唯一短板。** 此工作区现有动画模板定义约 50 个内置 ID，并包含 6 个 Shotcraft 配方；目录已有预览、分类、搜索和个人模板。生产自动化却主要按少数预设把镜头分流到纸片、数据/地图或档案的几种动画。因此应先提升“每个镜头如何自动选到合适模板、实际渲染是否合格”，再扩大模板数。否则只是更大的人工挑选清单。

## GitHub 候选项目比较

| 项目 | 可核实的规模/形式 | 最值得复刻的成熟做法 | 许可与风险 | 对 Vox 的适配 |
|---|---|---|---|---|
| [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) · [在线 Gallery](https://vincentwei1021.github.io/video-shotcraft/) | Gallery JSON 标记 **124 cards / 150 styles / 150 previews**，覆盖 opening、typography、data、camera、transition、effects、UI entrance 等 10 类。每张卡含用途、建议时长、能量、设计意图、来源和演示实现。 | 照搬其目录行为和配方元数据模式：先看片，再按叙事用途选卡；镜头卡与实现代码一一对应；既可选已验证模板，也可自由创作。比把模板只命名为“纸片/地图”更利于语义路由。 | Apache-2.0。实际合并代码前，仍要逐项检查 Gallery 样片、第三方字体/图片和素材许可。其 `library.json` 的 `generatedAt` 为 2026-07-19，但 newest 卡日期为 2026-10-02，显示索引生成时间落后；报告采用文件自报的数量，不声称它是同日动态统计。 | **首选目录与卡片结构参考**。先挑选、验证并适配适合解释视频的卡片，不建议一次性搬入全部 124 个产品宣传镜头。 |
| [iart-ai/motion-skills](https://github.com/iart-ai/motion-skills) | 项目自述 **55 个 Skills / 18 个 Packs**，覆盖解说、数据动画、地图、动态文字、网页/Three.js/WebGL、Manim、社媒短片等。 | 一个 Skill 对应一个专业工作法，附脚本、参考说明、渲染帧/截图/视频核验闭环；按任务装载，避免把所有制作说明塞进一个大 Prompt。 | MIT。README 数量是 Skill 数量，不是能直接应用的动画模板数；质量仍须按各 Pack 的样例验收。 | **首选制作 Skill 分层参考**，尤其解释、地图、数据、动态文字和逐帧 QA。 |
| [Vibe Vision Video (VVV)](https://github.com/actionow-ai/vvv) · [模板说明](https://github.com/actionow-ai/vvv/blob/HEAD/docs/templates.md) | 当前说明发布 **5 个完整可编辑 Remotion 模板**（Doodle、Album、DV Story、Comedy、Starter），有完整 MP4 预览、输入 JSON、源码和验证记录；另有可复用效果包。 | 模板先产生短样片并检查格式、声音、冻结画面、节拍；用户确认后再长片。模板输入 Schema、格式槽位、每文件许可、预览和渲染 QA 证据随包走。 | MIT。模板全部偏婚礼，适合学习包和验收协议，不适合直接构成 Vox 的通用模板库。 | **首选完整片型、样片门禁和模板质量证据参考**。 |
| [OpenChatCut](https://github.com/0xsline/OpenChatCut) · [资源库](https://openchatcut.com/resources) | 本地优先多轨编辑器；官方文档描述可浏览可预览并安装 MG、转场、视觉效果、音效、缩放和 LUT；支持 `openchatcut-plugin@1` 资源格式与运行时校验。文档未给出可复核的资源总数。 | 把社区资源当作扩展，而不是内置表单选项；卡片展示动效结果、作者、来源和许可证，安装时校验包，Agent 可按需调用。 | 主仓库 AGPL-3.0-or-later；官方资源称 MIT，社区包由作者选择许可证。项目自己说明仍在开发。研究其资源 UX/契约，不直接移植 AGPL 主程序。 | **模板市场/资源库体验参考**，非 Vox 渲染内核参考。 |
| [code-video](https://github.com/dxawdc/code-video) | MIT Skill + `film` CLI；README 列出 Canvas、GLSL、Three.js、p5.brush、HTML/CSS/SVG/GSAP/Lottie、HyperFrames、Remotion、Manim、Blender 共 **9 种技术栈**。 | 每帧作为时间 `t` 的确定性画面；先需求、分镜和时间表，再画面/声音；逐帧审片、编码检查。允许针对效果选择技术栈，而不是所有镜头硬塞入同一做法。 | MIT；项目看起来较新，9 种技术栈是能力范围，不等于每种都经过本项目生产级压力测试。 | **vibe coding 与渲染 QA 补充参考**；适合先挑 Remotion/HTML/Three.js 子流程做 PoC。 |
| [Remotion 官方 Skills](https://github.com/remotion-dev/skills) · [技能说明](https://www.remotion.dev/docs/ai/skills) | 官方仓库当前列出 **12 项技能**：best practices、create、markup、studio、render、maps、captions、SaaS、interactivity、docs、upgrade、multimedia。 | 官方版本、API 与渲染最佳实践；字幕/地图/渲染按需路由；应作为内部 Remotion 代码生成的工程约束，再叠加自己的视觉配方库。 | 工程 Skills 不是动画模板。引用或采用仓库内容前仍需检查其 LICENSE 和各依赖要求。 | **推荐作为渲染实现底座**；模板数量需要由 Shotcraft 式配方目录补足。 |
| [anything2explainer](https://github.com/Vincentwei1021/anything2explainer) | Remotion 全流程 Skill，公开完整 44 镜头参考片和 research、旁白、分镜、逐镜源代码、QC 文档；片型以固定黑底解说为主。 | 有结构地把研究、旁白、分镜、并行镜头实现、QC 和交付连起来；完整项目记录比展示单帧更有参考价值。 | **PolyForm Noncommercial**：商业使用需授权。只学习流程和 QA 思路，不能直接复制代码/素材到商业产品。 | **参考完整生产链，不是多模板目录。** |
| [video-talkcraft](https://github.com/Vincentwei1021/video-talkcraft) | README 自述 108 个口播动效配方、字级对音频同步、SHOTBOOK 时间线。 | 将语义拍、音频词级时序、素材类型和节奏作为检索配方的条件；保留每镜独立复核。 | **PolyForm Noncommercial**：商业使用需授权。口播场景与 Vox 解说相邻，但不等于通用 Vox 片型。 | **口播与旁白同步 UX 参考，不作为直接商用代码来源。** |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | AGPL-3.0 的 Agent 制片系统；README 展示真实素材、生成式视频和代码动效混合的多种成片案例。 | 学习素材研究、镜头资产生成/管理、成本与制作阶段可见性，以及“模板快做 / 重点片定制”的分工。 | AGPL-3.0；整仓引入有许可义务，README 案例是作者自述。 | 可作全制作链旁证；和纯代码动画模板库的目标不完全相同。 |

## 对 StoryDream 当前实现的核对

以下是对本次工作区代码的静态核对，不是干净主分支基线，也没有在本次调研中新增代码：

- `/I:/opc/src/shared/vox-animation.ts` 里已有约 **50 个内置动画 ID**，含纸张拼贴、证据、时间、对比、数据、地图、流程、书籍、文字/图、音频字幕与转场等分类。
- `/I:/opc/src/shared/shotcraft-recipes.ts` 另有 **6 个 Shotcraft 配方**，包括纸胶带、立起纸卡、标题压印、时间轴巡游、来源汇聚、环层注释；记录了推荐/最短时长、支持画幅、文字限制、运动说明和 QA 采样时点。
- `/I:/opc/src/features/vox-animation/VoxTemplateCatalog.tsx` 已有分类/搜索、动态预览、播放/暂停/进度和“我的模板”。因此不应只做另一个模板选择弹窗；应把目录连接到自动分镜与生产工作台，并给更多配方补齐可检索的语义信息与成片级证据。
- `/I:/opc/electron/vox-production-runtime.ts` 的自动模板映射仍较窄：纸类通常落到 `paper-popup`/`paper-actors`，数据类按坐标在 `map-multi-stop`/`data-bars` 之间选，档案走 `paper-polaroids`。现有更广的 catalog 没有同等广度地进入自动制作链。

所以成熟方向应当是：从“有很多手选模板”推进到“有清晰语义、自动路由、可预览、可验收的生产配方库”。

## “模板越多越好”的可扩容目录

不应只增加完整片型（修改成本高、彼此容易重复），而是采用成熟 Gallery 中更可扩展的组合单位：**完整视频风格包 + 镜头配方 + 可叠加效果**。以下是建议的内部目录目标，不是外部仓库已经提供的数量：

| 层 | 建议首期规模 | 主要分组示例 | 用户如何使用 |
|---|---:|---|---|
| 完整片型/视觉方向 | 8–12 套 | Vox 纪录解说、纸张档案、数据新闻、地图旅程、科学原理、人物故事、产品/技术、书籍观点、极简动态图形、社媒竖屏 | 新手挑一套，自动生成全片结构、字体/配色和节奏；也可不挑，让系统推荐 |
| 语义镜头配方 | 100–150 张起步 | 开场钩子、主张/反证、证据截图、引文、人物/地点、时间线、地图路线、数据变化、占比/排名、机制拆解、因果关系、章节过渡、总结回扣 | 按镜头语义、素材类型、画幅、时长、能量筛选；系统先自动匹配，专家可逐镜更换 |
| 效果/组件配方 | 40–80 个起步 | 标题进场、关键词标注、描边/纸胶带、镜头推拉、遮罩揭示、标注线、图表数字、环境纹理、转场、字幕强调、音频反应 | 可叠加在镜头配方上，但应按场景给推荐项，不要求新手理解每个开关 |

每张配方至少有：**真实预览、叙事用途、禁用/适用场景、素材与字段 Schema、建议时长/节奏、支持画幅、许可/来源、QA 状态、可回退替代方案**。没有通过样片验收的卡片可留在“实验室”，不要与“已验证”混在一个选择器里。

规模可以逐步扩到数百项，但“150 张”应指有可预览、可查询的配方记录，不能把 Skill 数、颜色变体、单个转场、完整片型相加后宣传成 150 套成片模板。

## 建议按成熟项目的现成模式落地

这部分是调研建议，不是本轮已实施内容。

### 第一批：复刻 Shotcraft 的镜头目录，不先改底层渲染器

1. 保持完整的可浏览 Gallery：每项都有真实动图/短片预览、适用镜头语义、素材需求、建议时长、画幅、能量/节奏、可编辑字段、实现与许可来源。
2. 沿用成熟分类维度，并贴近解释片内容：开场、文字强调、证据/截图、时间轴、数据、地图、原理流程、图文拼贴、转场、收尾。不要把技术实现（如 React/Canvas）冒充为用户可选的内容片型。
3. 先从现有 50+6 和 Shotcraft Gallery 里选**最适用 Vox 的配方**，让每个配方通过真实文字/图片/数据镜头的预览与渲染检查后再发布；随后按上表扩充到 100–150 张语义镜头配方。不以“仓库里有多少卡”替代成片质量。

### 第二批：复刻 VVV 的样片批准与包质量协议

1. 每个候选模板至少交付一个完整输入样片，而非静态色块/单帧；失败时显示诊断，不进入长片批量渲染。
2. 模板/效果包包含 schema、依赖版本、许可清单、素材来源、支持画幅、预览文件和渲染 QA 记录；安装/载入只解析清单，不先执行不可信模板代码。
3. 验收从单镜扩展至 30–60 秒真实旁白样片，检查文本安全区/可读停留、画面变化、音画同步、长帧冻结、帧率与最终编码。

### 第三批：复刻 Motion Skills / code-video 的按需制作 Skill 与确定性时间线

1. 把解说、地图、数据、动态文字、拼贴、字幕和逐帧审查拆成小型内部 Skill/参考流程，按制作节点加载；新手不看这些选项，由自动生产调用。
2. 镜头定义显式写入开始/结束、入场/主体运动/停留/离场，模板渲染同一输入在同一时间点应可重复得到同一帧。
3. 技术栈只在具体镜头需要时选择：默认 Remotion；HTML/SVG/GSAP 或 Three.js 等作为经过样片验证的专用路线，而不是一次把九种运行时全塞进用户侧栏。

### 第四批：复刻 OpenChatCut 的社区/扩展资源体验

当内部目录的质量门槛稳定后，再考虑用户导入/分享镜头包。包必须标清创建者、许可、脚本能力与外部资源，支持预览、隔离验证、禁用/删除；第三方模板不能静默执行任意网络或文件操作。

## 推荐优先级

| 顺序 | 工作项 | 验收信号 |
|---|---|---|
| P0 | 盘点现有模板的使用场景、数据依赖、真实预览/片段与实际生产路由 | 每个目录项能指出至少一种有效的真实语义镜头；自动生产不再只落到少数几类模板 |
| P1 | 从 Shotcraft 模式扩展可检索配方数据与 Gallery 预览 | 用户能按“讲什么/有什么素材/镜头要做什么”找到并预览，而非靠记模板名 |
| P2 | 以 VVV 方式建立短样片批准和模板级 QA/许可清单 | 至少一条真实旁白样片通过视觉、时序、素材和编码检查后才允许批量出片 |
| P3 | 用语义和素材条件做自动镜头到配方的匹配，专家保留逐镜替换能力 | 默认一键产出完整样片；专家可改单镜/参数但无需重新选择全局技术选项 |
| P4 | 扩展兼容的外部模板包与社区资源 | 能够安全预览、验证许可、安装、停用和回滚模板包 |

## 来源

所有链接均指向 GitHub 项目或其由项目链接的在线 Gallery；数量按 2026-10-23 读取的公开 README/数据文件记录，除非上文明确标成项目自述：

- video-shotcraft：[README](https://github.com/Vincentwei1021/video-shotcraft)、[Skill](https://github.com/Vincentwei1021/video-shotcraft/blob/HEAD/SKILL.md)、[Gallery 数据](https://github.com/Vincentwei1021/video-shotcraft/blob/HEAD/gallery/api/library.json)、[Apache-2.0 License](https://github.com/Vincentwei1021/video-shotcraft/blob/HEAD/LICENSE)
- video-talkcraft：[README](https://github.com/Vincentwei1021/video-talkcraft)、[License](https://github.com/Vincentwei1021/video-talkcraft/blob/HEAD/LICENSE)
- iart-ai/motion-skills：[README](https://github.com/iart-ai/motion-skills)、[MIT License](https://github.com/iart-ai/motion-skills/blob/HEAD/LICENSE)
- VVV：[README](https://github.com/actionow-ai/vvv)、[模板列表与验证记录](https://github.com/actionow-ai/vvv/blob/HEAD/docs/templates.md)、[包格式 1.0](https://github.com/actionow-ai/vvv/blob/HEAD/docs/format/vvv-1.0.md)、[MIT License](https://github.com/actionow-ai/vvv/blob/HEAD/LICENSE)
- code-video：[README](https://github.com/dxawdc/code-video)、[SKILL.md](https://github.com/dxawdc/code-video/blob/HEAD/SKILL.md)、[MIT License](https://github.com/dxawdc/code-video/blob/HEAD/LICENSE)
- Remotion 官方：[Skills 仓库](https://github.com/remotion-dev/skills)、[AI Skills 文档](https://www.remotion.dev/docs/ai/skills)
- anything2explainer：[README](https://github.com/Vincentwei1021/anything2explainer)、[License](https://github.com/Vincentwei1021/anything2explainer/blob/HEAD/LICENSE)
- OpenChatCut：[README 与资源说明](https://github.com/0xsline/OpenChatCut)、[扩展市场](https://openchatcut.com/resources)、[AGPL-3.0-or-later 声明](https://github.com/0xsline/OpenChatCut/blob/HEAD/package.json)
- OpenMontage：[README](https://github.com/calesthio/OpenMontage)、[AGPL-3.0 License](https://github.com/calesthio/OpenMontage/blob/HEAD/LICENSE)

