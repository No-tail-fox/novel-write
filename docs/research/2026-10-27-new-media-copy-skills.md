# 新媒体文案提示词：GitHub Skills 调研与适配建议

调研日期：2026-10-27。范围：创意动画六个写作风格，以及“文案创作”页面的赛道选择。已实际读取下列仓库的 SKILL.md 和所列参考文件。前文记录初次调研时的代码状态与适配设计；后续已完成运行时接入和界面修复，详见文末“实现与验收记录”。未安装第三方 skill，未进行真实模型生成对照测试。

## 判断

现有提示词具备准确性、素材约束、口语化和正文格式等基础，但不同类别的表达规则仍然偏薄。应当补充受众的具体处境、内容承诺、开头选择、信息推进、结尾兑现和表达自检。建议先把外部方法改写为应用内的短规则，通过现有 LLM 请求拼装；仅在 Codex 中安装 skill 不会自动改变应用的文案生成。

不应把所有类别都改成带货、强冲突或强行引导互动。文化随笔的余味、纪实解释的可信度、数据解读的口径仍然是各自的价值。

## 调研时确认的代码问题

1. 六个风格定义在 [editorial-writing-styles.ts](../../src/shared/editorial-writing-styles.ts)。每个类别有一段 guidance 和一个示例，但没有受众、目标和平台维度；对钩子的选择、推进方式、结尾兑现也缺少具体规则。
2. [director-copy-assist.ts](../../src/features/director-desk/director-copy-assist.ts) 将六类都约束成“钩子、背景、证据、结论”。这适合解释型视频，但应允许故事、随笔等类别采用不同的修辞推进方式，同时满足后续制作契约。
3. [CopyStudioPage.tsx](../../src/features/copy-studio/CopyStudioPage.tsx) 中，人物故事、好书带货、知识科普、美食探店、自定义赛道只在“赛道强化”时进入 instruction；初稿使用 requirements，没有把所选赛道拼进去。强化阶段也只使用一条通用描述，没有各赛道独立规则。
4. [research.ts](../../src/shared/research.ts) 的 composeCopyFromSources 固定调用 resolveStoryboundTrackInfo('general')。底层实际采用通用故事系统提示词，缺少正式的赛道参数。通用提示词已经要求 3 秒钩子、口语化和正文输出，因此问题并非完全没有新媒体意识，而是缺少可执行的类别差异。

## 候选 Skills 与适配结论

### 1. xianyu110/ecommerce-video-skills：优先吸收开头与短脚本方法

原文：[hook-3s-script](https://github.com/xianyu110/ecommerce-video-skills/blob/main/skills/hook-3s-script/SKILL.md)、[selling-point-storyboard](https://github.com/xianyu110/ecommerce-video-skills/blob/main/skills/selling-point-storyboard/SKILL.md)。[许可证：MIT](https://github.com/xianyu110/ecommerce-video-skills/blob/main/LICENSE)。

已核实能力：以受众场景和真实卖点作为输入，提供不同类型的开头候选；脚本按时长组织信息，并要求展示卖点证据。

建议吸收：创作时先比较少量不同开头，选一个与素材匹配的开头进入正文；每一段都推进信息；带货卖点与可用证据对应。最适合好书带货，也能帮助知识科普、人物故事改进开场。

需要改造：商品、分镜表、花字和 storyboard.json 属于原项目流程，不能加入应用现有的纯旁白输出。原文提供的字数和时长经验不能直接覆盖应用的配音预算。第一人称测评、购买经历、收益和数字都必须由输入事实支持。

### 2. coreyhaines31/marketingskills：优先吸收通用写作与修改规则

原文：[social](https://github.com/coreyhaines31/marketingskills/blob/main/skills/social/SKILL.md)、[短视频参考](https://github.com/coreyhaines31/marketingskills/blob/main/skills/social/references/short-form-video.md)、[copywriting](https://github.com/coreyhaines31/marketingskills/blob/main/skills/copywriting/SKILL.md)、[copy-editing](https://github.com/coreyhaines31/marketingskills/blob/main/skills/copy-editing/SKILL.md)。[许可证：MIT](https://github.com/coreyhaines31/marketingskills/blob/main/LICENSE)。

已核实能力：先明确受众、目标和声音；区分从零创作、保留原稿声音的改写与局部修改；检查表达是否具体、观点是否有证据。social 的参考文件包括开头和短视频结构。

建议吸收：成为共用写作底层，处理“写给谁、为什么值得继续看、看完得到什么”；修改时保留原稿已有判断和措辞；把空泛结论换成具体观察。

需要改造：营销落地页结构和海外平台习惯不直接移植到中文旁白；互动或转化引导按目标启用。核查时现行目录为 skills/social；旧的 skills/social-content 路径返回 404，README 列有迁移映射。

### 3. aiworkskills/wechat-article-skills：优先吸收中文读者定位和表达自检

原文：[writing](https://github.com/aiworkskills/wechat-article-skills/blob/main/skills/aws-wechat-article-writing/SKILL.md)、[topics](https://github.com/aiworkskills/wechat-article-skills/blob/main/skills/aws-wechat-article-topics/SKILL.md)、[review](https://github.com/aiworkskills/wechat-article-skills/blob/main/skills/aws-wechat-article-review/SKILL.md)、[中文 AI 味诊断参考](https://github.com/aiworkskills/wechat-article-skills/blob/main/skills/aws-wechat-article-review/references/ai-flavor-check.md)。[许可证：Apache-2.0](https://github.com/aiworkskills/wechat-article-skills/blob/main/LICENSE)。

已核实能力：将目标读者、调性、写作风格分别配置；包含选题、写稿与审稿流程；中文参考文件检查套话开头、过度整齐、概念堆叠和强行升华等表达现象。

建议吸收：中文表达检查及“读者、调性、结构”分开描述的方式，适合六个类别共用，尤其适合观点评论、文化随笔。

需要改造：公众号长文的配图占位、文章文件、发布设置和审批步骤不进入旁白请求。其表达检查是编辑建议，不是能可靠识别机器作者的检测器。

### 4. hongfamonvAI/hook-lab：用于参考内容拆解

原文：[SKILL.md](https://github.com/hongfamonvAI/hook-lab/blob/main/SKILL.md)。[许可证：MIT](https://github.com/hongfamonvAI/hook-lab/blob/main/LICENSE)。

已核实能力：对提供的视频字幕和元数据分析开头、内容结构、节奏与可借鉴角度；字幕缺失时会降级并注明依据不足。

建议吸收：用户提供参考稿时，提取它的开头方式、信息转折和结尾处理，再用自己的事实重写。适合后续扩展参考稿分析。

需要改造：它主要是分析器，不能单独替代写作提示词。没有字幕和互动数据时，不对传播原因作确定判断；不能仅凭标题断言某种写法带来高完播。

### 5. mikiarlo3/ai-copywriter：作为声音校准的补充

原文：[SKILL.md](https://github.com/mikiarlo3/ai-copywriter/blob/main/SKILL.md)。[许可证：MIT](https://github.com/mikiarlo3/ai-copywriter/blob/main/LICENSE)。

已核实能力：先从作者样稿分析句长、词汇、标点和转折，再匹配声音；包含营销创作与表达清理，并要求不为增加个性而添加事实。

建议吸收：让“精修”保留作者原来的说话方式，检查模板化表达与空泛修饰。

需要改造：原文很长，以英语为主要语境；抽取少量与中文有关的规则即可。不能照搬英语大小写、引号等习惯，也不以某个词命中作为质量判决。

### 额外候选：Xiangyu-CAS/xiaohongshu-ops-skill

已读 [SKILL.md](https://github.com/Xiangyu-CAS/xiaohongshu-ops-skill/blob/main/SKILL.md)。其中的账号定位、内容角度和互动提问可作为未来小红书图文模式的参考；现有应用以纯旁白为主，整套运营和发布流程适配度较低，本轮不优先引入。仓库搜索返回的许可字段为空，本次没有据此认定它可直接复制。

## 六个现有类别如何增强

以下为结合应用现状提出的改写方向，不是对外部 skill 的逐字搬运。

| 类别 | 开头切入 | 中段推进 | 结尾处理 |
| --- | --- | --- | --- |
| 纪实解释 | 先给出一个可观察的异常或反差 | 带着一个核心问题追原因，只交代理解证据所需的背景 | 回答开头，让观众修正一个认识 |
| 故事叙事 | 从人物困境、决定或后果进入 | 用选择和代价推动变化，事实支撑的转折才出现 | 兑现悬念，落到人物变化 |
| 观点评论 | 直说与观众有关的争议和判断 | 用证据支撑判断，在需要时回应关键反对理由 | 给出有边界、能被复述的结论 |
| 轻松科普 | 从日常现象或具体误解提问 | 一次解释一个概念，用合适类比或事实例子帮助理解 | 给出能带走的判断或做法 |
| 数据解读 | 先呈现一个有意义的差异及它与生活的关系 | 用明确的来源、时间和口径支撑比较，再讲数字意味着什么 | 交代能得出什么，以及不能得出什么 |
| 文化随笔 | 用具体物件、动作或生活场景引发情绪 | 让细节和观察承载感受，避免连续抽象抒情 | 回到开头意象，允许留白，不强塞互动口令 |

建议将现有 guidance 改写成“开头选择 + 推进规则 + 收束方式 + 事实边界”，同时更新示例，避免六个类别只改变形容词。

### “文案创作”页的四个具体赛道

| 赛道 | 应补充的规则 |
| --- | --- |
| 人物故事 | 一个关键困境贯穿全文，靠行动与选择而非履历堆叠讲人物；不虚构心理和对话 |
| 好书带货 | 从读者遇到的问题切入，讲书能提供的具体认识或方法，再给适合人群；不虚构阅读体验和效果 |
| 知识科普 | 围绕一个问题解释，一个例子帮助理解，带走一个可用结论 |
| 美食探店 | 先明确消费场景与判断标准，以已提供的菜品、价格、环境等资料支撑建议；没有实访资料就不写成亲身探店 |

## 建议的提示词组成

平台与目标、内容赛道、创作风格是不同维度。例如“视频号 + 知识科普 + 故事叙事”可以同时成立。最小版本可先采用默认平台和目标，保留现有界面，只增强后台提示词；后续再决定是否暴露选项。

下列为初次调研时的规则草案，后续按应用契约进行了适配，实际接入范围见文末：

~~~text
你为指定读者写一段可以直接朗读的新媒体文案。

读者与场景：{受众在什么情况下会关心这个主题}
发布语境：{平台；未指定时按中文解释型短视频处理}
内容目标：{理解一个问题／产生共鸣／参与讨论／了解产品}
内容赛道：{track 的独立规则}
创作风格：{style 的开头、推进和结尾规则}
篇幅与时长：{现有应用计算的预算}
事实材料：{本次允许使用的资料}
用户要求：{用户的明确偏好}

先确定本段只回答的一个问题，以及观众听完得到的一个具体认识。
根据资料比较少量不同开头，选择与内容最贴切的一种，开头承诺必须在后文兑现。
正文每推进一步都增加信息。短句和长句按朗读需要变化，避免反复解释同一个判断。
具体观察优先于空泛修饰；不靠虚构经历、数据、引语或冲突制造吸引力。
按目标选择收束：回答问题、兑现悬念、回扣细节或提出具体问题；不强制添加关注和购买口令。
输出前检查开头、推进、事实依据、口语节奏和结尾，保留原稿已有声音及用户的具体要求。
最终仅输出旁白正文，不输出开头候选、选择说明、自检过程、标题、表格或分镜。
~~~

## 接入建议与验收

第一步：让初稿也接收所选赛道，并将各赛道规则集中定义。避免前端选了赛道，后端仍固定使用通用故事。

第二步：增强六类 guidance 和示例；在 buildDirectorCopyAssistRequest 中组合通用新媒体规则、类别规则、用户要求与现有字数预算。用户具体要求优先，事实和输出契约继续约束。

第三步：确定四段制作结构与类别写法的关系。不要未经验证就改动 editorial-script 的分段、字幕、时长和镜头契约；先验证是否能在现有契约内表达类别差异，再决定是否解耦。

第四步：用同一份事实材料做改写前后对照，至少包含知识解释、人物故事、文化观察三组。关注开头是否具体、类别差异是否明显、中段是否推进、是否新增无依据事实、是否满足预算、结尾是否兑现。评价使用编辑维度，不把生成模型的自评分当作传播效果证据。

第五步：若实现，更新现有 director-copy-assist 和 research 等有意义的请求测试，检查赛道进入初稿、用户要求优先、修改保留事实、正文无标签。字幕和时长契约有改动时才扩大相应验证。

调研阶段没有效果实测，以上为基于源码和规则的适配判断。优先组合建议：短视频钩子方法 + 通用写作规则 + 中文表达自检；参考稿拆解与作者语气校准作为增强项。

## 检索记录

GitHub CLI 未登录后，使用 GitHub 公开仓库搜索发现来源；公开 API 随后限流，切换到 raw.githubusercontent.com 逐项读取原文。未要求用户提供凭据，未执行候选仓库脚本。

Agent Reach 更新检查：本机 v1.5.0，检查报告存在 v1.6.0。本次未更新；需要时可说“帮我更新 Agent Reach”，更新说明见 [项目文档](https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/update.md)。


## 实现与验收记录（2026-10-27）

已将方法改写为应用内规则，接入实际请求，不依赖安装 Codex skill。

- 新增共享内容赛道：人物故事、民间故事、电商带货、好书带货、知识科普、文化科普、绘本故事、健康图书、情感共鸣、美食探店、通用故事。文案创作保留自定义赛道及旧草稿兼容。
- 初稿、精修、赛道强化均传递所选赛道与修改意图；创意动画将内容赛道与六种写作风格分别组合。制作链的改写步骤也使用同一套赛道规则。
- 针对电商增加使用场景、证据与适用边界；人物故事强调选择、行动与后果；民间故事与绘本允许合理虚构，同时区分传说、原创与史实。素材整理不会把必要的虚构设定当作未经核实的事实删除。
- 修改文案保留完整现稿和用户要求；从好书带货等细分赛道转入制作模板时保留细分规则，现有输出格式、字幕和分镜契约不变。
- 模板列表为缩略图预留实际列宽，使用 contain 展示完整图片，说明可换行，紧凑窗口下操作移至下一行。
- 新建项目下拉框改用短名称并单独展示说明；“预审改写／直接复用”改为“整理并改写／使用原文”，解释实际行为。文案创作回传默认使用定稿，并保存用户选择。

验证结果：

- 类型检查与生产构建通过。
- 10 个相关测试文件共 218 项通过；另有 20 项新建项目与模板界面契约检查通过。
- 实际 Electron 窗口在 1440×900、1040×720 下完成截图检查；故事与图像模板各 14 行均无图文重叠、文字裁切和按钮溢出，列表末项可达。确认查看后返回保留标签、11 类赛道进入实际请求、定稿回传，以及输入变化后忽略过期修改结果。另已确认键盘聚焦可打开完整图片预览，Escape 关闭、Enter 进入详情。共生成 14 张验收截图，未记录渲染异常。
- 界面生成使用本地模拟结果，没有调用付费 API；这些验证覆盖请求与交互，不代表已验证真实模型的文案质量或传播效果。
- 扩大运行旧 shell 断言时，另有 4 项与本次修改无关的断言失败，涉及激活反馈、导航、草稿库与命令归属；未改动这些工作。

本地记录：`.artifacts/copywriting-templates/report.json`、`.artifacts/copy-studio/report.json`、`.artifacts/copywriting-templates/shell-contract.json`。
