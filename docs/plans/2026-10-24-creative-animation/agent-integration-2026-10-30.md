# 创意动画：将 Lemo 式创作循环接入现有生产系统

日期：2026-10-30
状态：架构建议，尚未整体实现；已落地创意文本软约束与完整回执保存，不代表本次实测已通过。

## 结论

不重写整个产品，也不把 JSON 全部取消。保留现有生产 DAG、素材管理、模型配置、语音时间线、渲染导出、付费回执和断点恢复，在创作节点内部增加受控的 Agent 工作区。

原则：创作过程允许草稿，工具入口必须明确，进入可执行版本与最终交付必须严格验收。

## 现有实现与真实证据

- 已有大纲、素材规划、分段导演、shared/scene/director 文件、增量修改、浏览器抽样、修复及最终渲染；不是从零开始接 Agent。
- 当前 executeLemoEdit 每一批要求带 baseHash 的 JSON search/replace，而且每个成功批次必须立即成为可编译的完整 factory。增量拆分已经存在，但草稿存储、动作协议和可执行提交仍耦合。
- 当前默认预算包括每文件创作会话 16 轮、单处替换 16000 字符、合计 search+replace 24000 字符。它们不是上游模型的能力上限，也不能仅靠把它们全部调大解决问题。
- 本次 Opus + paper-popup 真实响应以 end_turn 完成，只因 JSON 代码块前带说明文字被旧解析器拒收；不是这一次发生了 token 截断。
- 已实现唯一完整 JSON fence 的提取，并复用已保存且完整的拒收回执。真实 edit1 复用已核验：rawResponse SHA256 为 93a393bf5dec777f8e226f6545b26cb389f74f9fd9bb8bde8de856d306722e7f，applied=true，reusedFromRequestId=002f8cab-f702-42b1-905d-c74f5e38581c。未改原始响应。
- 原稿未改。最新真实实测停止于 shared 第十二批：模型以 end_turn 结束，但只返回行动说明，没有代码补丁；任务为 failed，已完成 75/120 个节点。原始回执和上一个可用源码保留，尚无最终 MP4 验收。格式修复不等于整片成功。

本地依据：electron/lemo-incremental-authoring.ts、electron/lemo-project-runtime.ts、electron/lemo-file-validation.ts、src/shared/creative-animation/lemo-edits.ts、src/shared/creative-animation/native-project.ts。

Lemo 参考边界：使用仓库内 vendor/lemo-opuscar/DIRECTOR.md 与 TECHNIQUE.md 的工作流作为设计参考，不声称其线上版本已重新核验。DIRECTOR.md 强调先证明视觉效果，以及联系表、关键动作帧序列、带声音观看；它也明确限制修订范围，并非无限重试。不要把外部 Agent 的能力误当成一个模型请求自带的能力。

## 建议架构

用户项目与任务面板
  -> 现有生产调度与持久化 DAG
    -> 受控创作会话：计划 -> 动作 -> 工具观察 -> 修订
      -> 隔离工作区与草稿版本
      -> 预览、编译、素材和配音工具
      -> 阶段验收并晋升可执行版本
    -> 最终渲染、音画质量检查、交付

### 1. 风格包是创作指导，不是固定内容槽位

保留既有风格选择与目录。向创作会话提供 STYLE/导演指导、示例的技术方法、合法素材引用和宿主运行契约，让新主题重新构图与编排。复用公共绘图能力，但不把每种风格压成同一套画面。

先为原片中的代表性段落做小规模效果验证，建议覆盖约 8–12 秒并包括关键动作或转场；这只是内部预览范围，不缩短交付片长、不改文稿、不换样例。通过后再批量扩展其余段落和非必要素材，避免所有素材生成完才发现视觉方案不可用。画面、动作与声音均须验证，不能只凭一张静帧。

### 2. 将草稿和已验收版本分开

- draft：模型可以分多步搭建函数、写文件、调整依赖；不完整内容可以保存，但不得进入渲染执行。
- candidate：形成一次可验证事务；由宿主完成语法、依赖、接口与安全检查，再在隔离预览环境执行。
- accepted：通过本阶段检查的不可变快照；后续失败保留上一可用版本。
- delivered：整片通过最终验收，存在可定位的真实输出文件。

语法错误仍是错误，但应优先成为同一会话下一步的反馈，而不是立即把整片变成用户必须手动处理的失败。对语义性修改不使用正则猜修或拼接残缺响应。

### 3. 工具动作小而明确，源码不嵌进巨型 JSON

建议的宿主能力：读取项目片段、读取风格说明、写入指定草稿文件、对指定版本应用补丁、编译检查、预览指定时间窗、读取截图/诊断、请求素材、提议阶段完成。

- 初次生成可交付独立源码文件或一个无歧义的代码 artifact；已有大文件优先增量修改。避免要求模型把几万字符源码重新转义成嵌套 JSON。
- 文件路径、素材 ID、任务版本由宿主限定。版本前提绑定模型开始本次动作时的快照，不能在收到结果后悄悄绑定最新版本。
- 补丁基准哈希、唯一匹配、路径白名单、权限和原子提交继续严格执行。版本漂移应要求重新读取，不能模糊匹配到任意代码段。
- 原始响应、解析方式、动作、诊断与 usage 全部留存；解释文字可以保留，不要求其充当可执行协议。
- 不把通用 shell、用户目录、网络凭据交给生成的影片代码；生成素材和联网仍经宿主已授权接口。

### 4. 三种模型接口与能力分离

OpenAI Chat、OpenAI Responses、Anthropic 是传输适配方式；是否支持强制工具调用、特定 JSON schema、图片输入及输出预算，是另一组能力，不能仅凭模型名称推断。

- 支持可靠原生工具调用：使用小参数、明确 schema 的动作。
- 不支持原生工具：进入显式文本动作/artifact 模式，解析一个无歧义动作后仍走同一工具校验。不能把任意说明文字当作执行指令。
- 只有收到明确的“不支持参数/能力”响应且可确认未产出结果时，才允许可见、可审计的兼容降级；连接超时或结果未知不得自动重发付费调用。
- 能力记录按渠道端点、模型、协议、配置版本隔离；不能把一个中转站的能力套到同名模型的所有渠道。
- 视觉审查要求模型确实收到截图且支持视觉。文本可用不代表视觉可用；否则暂停该验收或明确使用另一个已配置的视觉模型，不能冒充视觉验收。

### 5. 把无害格式差异与真实错误分开

| 情况 | 建议处理 |
| --- | --- |
| 唯一完整 JSON/源码块前后有解释 | 确定性提取，保留原文，不额外调用模型 |
| 创意说明略超建议字数 | 软提示，按用途加载摘要或局部上下文；不静默裁掉保存的原文 |
| 缺失关键动作字段、多个冲突块 | 返回具体诊断，要求重交该动作；不猜选一个 |
| 模型输出被截断 | 保存原始回执，调整本阶段预算或缩小动作，从已保存版本续作；不执行残片 |
| 代码编译/浏览器运行错误 | 返回文件、位置、调用栈、相关源片段，修复该依赖范围 |
| 字幕溢出、黑帧、动作/风格问题 | 返回时间戳、截图和明确的失败项，局部修订并再预览 |
| 语音与原稿不符、时长异常 | 回到语音节点核验，不能靠删文稿、拉画面或改字幕蒙混通过 |
| 已付费且成功的素材或响应 | 使用输入指纹和版本复用；更换真实输入时不可误用旧结果 |
| 付费任务结果未知 | 保持 unknown，先查询/对账，不能当成普通错误自动重买 |

### 6. 预算改为分层，而不是无限放开

- 单次请求：根据实际端点支持、当前阶段和可见输出需求配置；分别记录推理用量与可见文本，避免仍由统一小值截断。
- 创作阶段：允许自适应的小动作；观察验证结果或诊断是否推进，不能只因 diff 有变化就认定有进展。
- 整体任务：保留用户可理解的金额/调用次数/时间上限，达到后暂停并可续作；费用未知时标明未知，不能伪造金额。
- 同一错误连续出现、诊断无改善、反复覆盖已通过部分时停止自动修复，显示当前版本与阻塞原因。
- 单一源码文件、动作大小、安全资源上限继续存在；可调整、可解释，不能用它们替代阶段设计。

## 界面结合

不新增另一个聊天软件，不改变既有任务 ID 或素材/时间线归属。主工作区保留预览与时间线，侧栏显示导演摘要、当前动作、正在处理的反馈、已通过阶段、最近可用版本和预算状态。

用户默认只需“开始制作 / 暂停 / 继续 / 调整这一段”。常见可恢复校验问题显示“正在修复”，并可展开查看；授权、不可用渠道、余额或预算、未知付费结果等才进入明确的“需要处理”。内部自动继续与额外付费仍必须可见。

## 实施顺序

1. 保持当前真实任务和旧路径继续运行；先补齐本轮修复回归与成片验收，不热切换正在执行的付费步骤。
2. 新增可开关的创作会话与 draft/candidate/accepted 状态，优先只接入 shared + 一个 scene 的效果验证；不重建整个生产引擎。
3. 接入受控源码工具、模型能力适配、带时间戳的预览反馈、修复进展判定及预算暂停。
4. 用同一文稿、同一风格、同一模型对照旧路径，衡量成功率、人工介入次数、调用/时长/可见成本和成片质量；通过后才扩展并替换默认路径。

## 验收条件

- 三类协议均有离线契约测试；用户已配置的渠道做最小必要真实测试，不为凑覆盖盲目购买多次生成。
- 单一完整 artifact 可带说明；歧义、多动作冲突、残片、过期版本、路径越界与恶意调用明确拒绝。
- 断流、进程重启、校验升级不丢已验收版本，不重复购买未知结果；已保存回执可安全重验。
- 注入可恢复编译/运行错误后能局部修复；重复错误触发停止；上游接口变更会重验受影响下游，不重跑无关付费节点。
- UI 可以区分创作中、修复中、预算暂停、待对账、真实失败和完成；各按钮及其 IPC 契约保持测试覆盖。
- 最终必须检查真实 MP4 的全片播放、音频完整性、字幕、多个时间点、关键动作连续性、画面/人物/风格一致性和文件可打开性。示例图漂亮或编译成功不能替代验收。

## 本轮尚未解决的事项

- 目前真实实测在 shared 第十二批失败，模型只有行动说明、没有可执行补丁。此回执不能因放宽字数而被当成成功；未取得最终 MP4，也未完成完整听看验收。
- 命令清单测试尚有未解决项，不得声明全局界面契约已全部通过。
- 首镜头语音时长和 Markdown 字符只是待核验线索，尚不能认定配音被截断。
## 2026-10-30 已落地：创意文本软约束

- 新增共享创意文本策略，取消大纲、导演摘要/镜头方向、素材描述/提示词、修改说明的固定字数硬拒收；建议长度只保留在提示词中。空创意内容仍拒收，合法文本不 trim、不截断、不改写。
- 新分阶段规划、两条旧规划入口、素材和 film/project 持久化同步采用该策略，避免在下游保存时重新触发旧上限。历史可选空摘要/空 prompt 仍可读取。
- 完整保存增量回执，不再 slice(0, 90000)。回执超过资源预算报告 LEMO_RESOURCE_LIMIT，不伪装成 JSON 格式错误。
- 复用原 provider 8 MiB UTF-8 响应资源保护，并校验规划 JSON 的聚合体积；这是资源安全边界，不是创作目标字数。代码补丁大小、源码版本哈希、唯一匹配、结构/素材 ID/镜头归属/帧率和轮次检查保持不变。
- 相关离线回归：10 个测试文件、249 项通过（含超过 60000 字的大纲、超过 90000 字的回执、UTF-8 字节与聚合边界、旧入口、原文和补丁安全）。这些测试使用 fixture，并不代表真实全片通过。
- 本次没有修改真实文稿、模型原始响应或媒体，也没有触发新的付费模型调用。完整 Agent 草稿/候选/验收状态机仍是后续工作。

### 构建与隔离实例验证

- 最终策略测试 12/12 通过；全部相关回归 249/249 通过。三套 TypeScript 检查通过，renderer + Electron production 构建成功（已有包体积警告，不影响构建）。
- 已正常关闭并重启本任务隔离实例，未关闭用户正常实例。新实例 PID 34408；主进程构建 SHA256：2D5D31A4E9E3C8B47457F34F346EF793605D3FE47DE47B5887032DF978DBDDE2。
- 重启前后核对 task/run ID、原文哈希、时间线哈希、规划哈希、所有文件源码/最后回执哈希、attempt 数量及进度，完全一致；仍为 75/120、failed、无活动生成请求。此次没有点击续作或重发模型请求。
- 验证证据：E:/StoryDreamCreativeAudit-20261029-opus-paper/creative-text-full-regression.log、creative-text-final-policy.log、typecheck-creative-text-final.log、build-creative-text.log、restart-creative-text.json、checkpoint-before-creative-text.json、checkpoint-after-creative-text.json。


## 2026-10-30 真实续跑：配音与校时通过，Opus 断连待核对

- 验收仍未完成：尚无最终 MP4，不能宣称创意动画全流程已跑通。当前 task=a9986333-3365-421d-b5d6-eb45ad509473，run=ae7650fa-9e4a-483a-a358-facb3d1aa70e。
- 已修程序而非样片：Volcengine V3 必须收到完成帧且有音频；朗读入口转换 Markdown 而不改原稿/字幕；拆镜重配使用完整组旁白，持久化新回执后统一重绑音源切片与校时；增量创作输入变化时保留源码、旧回执和 revision history。人工音轨编辑不自动覆盖。
- 实测新生成 10 条必要替换配音，未重购图片。首轨由原 4.032 秒变为 11.232 秒。本地 small ASR 已核对 10 条替换录音，正文大体对应，有同音字/英文识别误差，不能当作逐字及全片听看验收。原首轨缺原始流证据，不能断言由缺少完成帧造成。
- verify-narration-live.mts 检查通过：正式 schema 有效；原稿、cue ID/文本、图片资产、既有影片源码不变；22 镜头、时间线 202908ms；20 条在用录音的 source 切片无缝覆盖各自媒体时长，包含上述 10 条替换录音。证据 E:/StoryDreamCreativeAudit-20261029-opus-paper/narration-live-verification.json。
- 配音/增量恢复相关 10 文件回归初次 211/213，通过修复测试 VM 的真实 canvas 依赖后受影响文件 14/14 通过；其余 9 文件此前通过。三套 typecheck 与 production build 通过。这不是一次完整全局全绿运行。
- 当前外部阻塞：film-code:shared:revision:1:edit:1 使用既有 Anthropic 配置 claude-opus-5-5 请求 cf.hetune.top，报 UND_ERR_SOCKET；本地 requestId=38621b15-a9b9-4fc1-9f14-6af0c3c8f480，paid=true、attempt=1、resultReceived=false、status=unknown，没有 provider request ID 或完整回执。该错误不能据此判定为协议不兼容或 token 超限。
- 已执行正式 reconcile：本地无可恢复回执，run 暂停，完成 64/109 节点，无活动请求。只读服务商日志查询返回 401，无法证明云端无结果。未重发 unknown、未伪造 confirm-no-result 证据、未改用其他模型。若无服务商可核对结果，需要用户明确允许该请求重试一次并接受可能重复计费。
- 后续仍需时序相关源码修订、场景/导演代码、浏览器采样、渲染、最终画面/音频/字幕/时间线验收。全局 UI 命令契约仍有未解决失败，不在本次配音回归通过声明内。

## 2026-10-30 用户授权重试：shared 成功，scene-1 新请求断流

- 用户本轮“接受”仅用于上一笔 unknown 请求重试一次并接受重复计费。已通过正式 controlVoxProduction(retry-unknown) 执行；原 shared 请求重试返回 end_turn，合法空 edits，确认公共绘图代码无需随新时序改写。该授权已使用，不能扩展为之后所有 unknown 请求的无限重试。
- 实际进度从 64/109 到 66/109。随后正常续作的 scene-1 新请求发生 ECONNRESET，节点 film-scene:scene-1:revision:1:edit:1；本地 requestId=5af96a50-b742-4161-839e-0a19e9cb0ad9，服务商 requestId=msg_011CgIfoC1EkLgmALRRd8L6P，attempt=1、resultReceived=false、status=unknown。
- 只收到 message_start 等回执信息，rawResponse 正文为 0 字符；没有可恢复、可应用的完整补丁。message_start 的 input/cache/output token 字段不是最终消耗账单；不能将 output_tokens=1 解释为生成完成。没有伪造源码、修改原稿、重购成功图片或再次重发这笔 unknown。
- 已执行正式 reconcile：本机无已保存结果，保持 paused、66/109；不以“本地没结果”推断“服务商没计费”。最终 MP4 仍未产生，scene-2、scene-3、director、浏览器采样、渲染及全片音画字幕验收仍未完成。
- 用失败后快照离线运行生产请求构造函数（含本次失败诊断，未联网，不是原始网络请求抓包）：scene-1 payload 89217 字符，完整 technique/style 资料 25313 字符；各部分明细见 request-context-audit.json。当前默认输出额度 65536（可由项目配置覆盖），请求超时 600000ms。这次是断流，无 max_tokens 结束标记，不能归因于旧 4096 截断；上下文规模只是诊断线索，未证明是断连原因，未据此裁剪原稿或风格资料。
- 修正程序诊断：LlmTextInterruptedError 不再把零正文回执描述为“已保留收到的文本”。明确区分零正文和部分正文，显示服务商请求编号、缺失编号状态和待核对状态；部分代码不写入错误提示，不作为成功结果应用。新增 tests/llm-stream-receipt.test.ts 覆盖四种回执/终止状态。
- 全局 UI 契约仍有未完成问题：最新 renderer-command-inventory.test.ts 为 4/7 通过、3 项失败。已校正 generateImageLab/generateDirectorShotVideo 的实际调用 owner，移除不再调用 saveConfig/saveMotionComic 的旧 owner；未放宽断言，不能宣称全局全绿。最新逐 owner 审计见 inventory-live-audit.json。
- 证据目录：E:/StoryDreamCreativeAudit-20261029-opus-paper/；关键记录 retry-authorization-20261030.json、retry-authorized-result-20261030.json、document.after-authorized-retry.json、request-context-audit.json、inventory-patch-tests.json。
### 本轮收尾核验：诊断与真实界面缺口（2026-10-30）

- 串行 forks 回归：`llm-stream-receipt`、`lemo-incremental`、`lemo-incremental-resume`、`vox-production`、`director-subtitle-import-ui`、`creative-error-summary` 共 **106/106 通过**。三套 TypeScript 检查（renderer/electron/scripts）和 renderer/electron 生产构建均成功。证据：`verified-receipt-ui-regression.json`、`verified-receipt-ui-typecheck.log`、`verified-receipt-ui-build.log`。
- 实机额外发现 ErrorDetails 摘要绕过了底层回执细节，依然笼统显示“已保留收到的内容”。已改为中性且真实的“文本接收中断，云端结果待核对”；覆盖零正文、部分正文、旧格式回执。旧请求回执本身没有改写。新摘要已在重载后的真实隔离实例中检查，误导摘要不再显示。
- 恢复 DirectorSubtitleInspector 实际缺失的“导入识别时间戳”按钮；每句绑定自己的 cue ID，忙碌或空文本时禁用，没有导入能力时隐藏，不调用生成模型。补 4 项组件行为测试，更新两个使用方的准确绑定、跨组件传递链和测试引用。
- 已在真实项目正常窗口 1320×860 与紧凑窗口 1024×768 检查新增按钮：5 条字幕入口均存在，首条滚动后可见、无横向溢出。未点击导入、未改字幕或样片；截图 `subtitle-import-normal.png`、`subtitle-import-compact.png`，结构证据 `subtitle-import-ui-qa.json`。
- 全局命令契约单独复测仍为 **4/7 通过、3 项失败**，不能合并进上述 106 项通过声明。失败覆盖未登记的新 API、遗漏/过期的真实调用 owner、已不存在的旧授权入口等；仍需逐项修复，未通过删断言或把变更 API 伪装成查询来绕过。
- 只正常关闭并重新启动所属隔离实例（旧主进程 53812，新主进程 15640）；其他 Electron 未关闭。后续只重载该实例 renderer 以应用摘要修复。共享后端构建 SHA256 保持 `A8E507DC546D6DBB96E548469F85F01043A1F501C5C842CF012458282E667D17`；部署记录 `receipt-subtitle-restart.json`。
- 最终读取真实存储：`paused`、66/109、活动请求 0；scene-1 unknown 仍为同一个本地 requestId，attempt=1，正文=0，服务商编号 `msg_011CgIfoC1EkLgmALRRd8L6P`。原稿、beats、assets、timeline、creativeFilms 与授权重试后快照 deepEqual。**没有最终 MP4；没有擅自重发这笔新 unknown。** 后续需要合法核对到服务商结果，或者用户重新明确授权该笔请求重试一次并接受可能重复计费，再继续其余场景、导演、渲染及全片视听验收。

## 2026-10-30 磁盘写满的真实根因与续跑准备

- 实例 96/128 暂停，三段场景、shared、director 源码均 valid；整片字幕边界审查在 7729ms 不一致，shared 自动修复回执已保存，其后免费验证发生 ENOSPC。尚无最终 MP4，不得认定全流程通过。
- 主进程 PID 14600 未重启。此前 worker catch 错用重启恢复文案，现按真实磁盘/执行异常归因，保留成功节点和 unknown 请求的安全处理。
- 每次审片重复复制整部片图片导致 E 盘写满。修复为内容寻址的私有快照池及跨验证硬链接，不链接可变用户原图，不缩图、不改字节；校验缓存 SHA256，不支持硬链接的文件系统才回退复制。
- 现有任务内 885 个逐字节相同 PNG 仅做路径不变的硬链接去重，释放约 5.43GB；原稿、原始图片、生成源码及历史 HTML 保留。证据：I:/opc/creative-asset-dedup-evidence.json；去重后完整项目快照：E:/StoryDreamCreativeAudit-20261029-opus-paper/document.after-storage-pause.json。
- 存储/恢复测试 73/73 通过；界面契约 7 文件 53/53 通过（30s 单测预算）。另优化真实源码依赖遍历的快照级缓存，避免相同共享模块重复 AST 解析；未削减任何业务契约断言，待默认时间预算复测。
- 当前正在类型检查及生产构建，之后仅在精确任务/run/paused 且无 running/unknown 守卫通过时有序重启隔离实例并 resume 一次；不重建计划、不替换模板、不人工改写样片。
## 2026-10-30 真实续跑：存储修复部署与字幕时钟回归

- 私有内容寻址素材池修复已部署；原任务由 96/128 推进到 103/129。场景 2 字幕和场景 3 的 18px 文字问题均由原正式模型修复流程处理，未人工编辑模型源码、原稿或样片。
- 全局界面契约按默认 5000ms 单测预算复测：9 文件、211/211 通过。源码依赖快照缓存只消除重复 AST 解析，未删减契约断言；详见 ui-contract-default-timeout-20261030.log。正常/紧凑 CDP 视口无横向溢出，证据 storage-ui-normal.png、storage-ui-compact.png。
- 新增真实 runtime 回归复现字幕边界错误：129.974 秒转回毫秒为 129973.99999999999，导致旧 cue 多占一个采样点。修复仅纠正整数毫秒的浮点表示下偏，保留原微秒精度，不放宽字幕窗口、24px 字号或可见性验收。
- 修复前 3 项回归失败；修复后扩展到亚毫秒、倍速重定时、非单调 seek、跨片长和长时间线边界、首尾钳制，7 文件 108/108 通过（native-clock-full-regression.log）。
- 已请求在当前付费步骤保存结果后暂停；103/129、无 running/unknown 节点时完成原稿/规划/源码/回执哈希快照并有序关闭本任务隔离实例，正在构建运行时修复版。没有中断或重复发送付费请求。尚未生成最终 MP4，全流程仍未完成。

## 2026-10-30 字幕时钟部署与残留问题自动续修

- 时钟修复已构建部署，重启前后原稿、时间线、规划、模型源码与回执哈希一致。原实例仅恢复一次；此前字幕边界错误没有再次出现，正式浏览器审片发现 scene-3 另一行文字缩放后仅17px。未降低24px验收，未人工修改生成源码。
- 新根因：模型返回 done 后，即便浏览器复查发现同文件残留问题，原流程也不再调度下一批；此外全片诊断可误触发已经通过的样片修复。新增有实际源码变化且回执明确成功时的有界续批；无效空改动、未决/中断请求、耗尽16批不自动循环。使用当前阶段调度修复，保留已接受批次。
- 初轮定向回归 132/132通过。新增样片/全片残留问题、跨阶段隔离、无变化不循环、16批硬止回归；正在更大范围回归、类型检查和构建。此时正式实例仍 failed，无活动/unknown请求；尚无最终MP4，不能宣称全流程完成。

## 2026-10-30 15:23 图形捕获恢复部署与继续实测

- 自动续修扩展回归 9 文件 212/212 通过，Electron/Renderer 类型检查与完整构建通过；部署后 scene-3 edit:2 的正式模型补丁已成功保存。
- 15:15 免费审片时 Chromium GPU 进程两次退出（exit_code=34/3，CopyOutputResultSender 反序列化失败），捕获报 UnknownVizError。不是模型接口失败；内存紧张是观测事实，尚不能认定唯一根因。任务103/131失败，无 running/unknown 请求。
- 新增 html-video-capture-recovery.ts：仅对 UnknownVizError 有界重建捕获窗口两次，不重试内容/字幕/布局错误、超时、磁盘错误或取消。预览与审片重建当前窗口；导出保留已写帧序号，从失败帧继续，再次就绪检查和审片，保持画布、帧率与编码质量。没有禁用GPU、降低字号门槛或修改生成源码。
- 集成测试最初7项失败均为旧的逐镜头ceil帧数预期：1.2s+1.6s在1fps全局时钟应分配[1,2]共3帧，而非[2,2]共4帧。仅修正测试预期，并增强精确帧文件列表、编码帧数和跨镜头清理顺序断言；帧时钟独立测试一并通过。4文件103/103通过（graphics-recovery-integration.log），Electron类型检查与生产构建通过。
- 在failed、无活动或unknown请求守卫下有序关闭旧隔离PID32828，启动PID10512。重启前后原稿、时间线、规划、模型源码、回执、attempts以及节点状态deepStrictEqual（只排除updatedAt）。15:23:09仅resume一次；不重发成功scene-3 edit:2。
- 证据目录 E:/StoryDreamCreativeAudit-20261029-opus-paper：checkpoint-before-graphics-recovery.json、checkpoint-after-graphics-recovery.json、graphics-recovery-launch.json、resume-graphics-recovery-result.json。当前继续正式免费审片，尚无最终MP4，不能宣称全流程完成。

## 2026-10-30 129/131 导出磁盘阻断与流式编码修复

- 正式实例已完成浏览器全片审查、自动修复、finalize、22镜头编译，film=reviewed；15:30 导出被磁盘预检阻断，129/131、无活动或 unknown 请求。不是模型生成失败，尚无最终 MP4。
- 根因：15张native素材被22镜头重复计入2,173,685,184字节（唯一98,803,872字节）；实际22镜头合并为202.908秒stage，旧帧目录策略会积攒整片JPEG。不能只调低预算放行。
- 实现32帧有界原子JPEG队列，生产端背压、严格顺序/完整帧数检查，消费端image2pipe流式libx264/AAC编码。保留1920×1080、60fps、JPEG质量92与原音频时钟；捕获/取消失败终止并等待编码器，GPU恢复继续未完成帧。
- 合成仅在全部路径校验通过且_source成功生成后消费本次render-segments-*根下segment-N.mp4，保留用户素材、封面输入与复用source；重复segment去重删除。审片窗口恢复时替换本stage旧字幕证据，不重复累积。
- 新路径真实短片测试发现image2pipe必须显式声明mjpeg，且MP4输出必须声明目标帧率，否则97帧虽编码完成，最后样本时长为0，播放器只能读出96帧。已修复并用97帧/60fps、异色末帧、解码像素和音频时长验收，不能靠放宽帧数断言通过。
- 正式项目重新实算：保守预算5,127,293,162字节（含20%余量与64MiB保留），当前可用5,178,286,080字节；帧目录预算29,859,840字节。不降低磁盘安全余量，不降低画质，只对native硬链接池去重，普通复制图层仍逐镜头计入。
- 第一轮完整回归156/157通过，唯一失败为Windows拒绝测试创建junction（EPERM），不涉及编码结果；改为模拟lstat重解析点的确定性拒绝测试，仍验证生产端/编码器均不触碰外部目录。正在重跑完整回归、类型检查和生产构建，部署后仍需原任务真实导出与verify。

- 15:50 续测：完整回归9文件157/157通过，Electron tsc和生产构建成功。隔离实例已安全重启为PID22932，重启前后原稿/时间线/规划/源码及付费回执哈希完全一致（仅排除updatedAt），仅resume原run一次。render正在执行，尚未完成最终验收；部署证据streaming-deployment.json。

## 2026-10-30 正式流式导出的 Windows 文件争用修复
- 15:52 首次流式正式导出到frame_0486时出现Permission denied，129/131失败，原稿/规划/时间线/源码/回执哈希复核均未变。不是模型请求失败。
- 对原子帧读取和释放分别增加10秒有界访问冲突重试；释放失败只重试删除、不重发已送入编码器的帧，取消和磁盘满/缺文件仍立即失败。测试覆盖97帧字节完整性、持续拒绝、取消和永久错误。
- 回归中另实测到Windows CreateProcess短暂WinError 5，补最多5次且只在未创建PID前重试；不重启已运行的编码器。
- 原片实测约6.3帧/秒，固定30分钟会不足；改为按帧数预算（每帧250ms、预检10分钟、短片至少30分钟），逐帧15秒和队列120秒停滞限制不变，编码器及外层进程时限同步。
- 续跑磁盘预算只扣除哈希一致且已有硬链接的本地快照；新/变更/损坏/仅复制缓存仍计费，20%和64MiB安全余量不变。完整回归10文件169/169通过，Electron tsc与生产构建成功；16:01部署至隔离实例PID55812，仅resume原run一次。重启前后原稿、规划、时间线、源码与回执哈希保持一致；16:39原任务完成131/131节点并生成MP4；独立复核与仍未解决的画面质量问题见下节。

## 2026-10-30 16:46 原实例技术闭环完成，画面质量仍未最终验收
- 原task a9986333-3365-421d-b5d6-eb45ad509473、run ae7650fa-9e4a-483a-a358-facb3d1aa70e于16:39完成131/131节点，render和verify均completed，无running/unknown/failed节点。仍为原Opus/paper-popup实例，不代表所有模板通过。
- 最终文件：E:/StoryDreamCreativeAudit-20261029-opus-paper/userData/storydream/tasks/3dd20493a024c05401424bdf22ba49bf54f8afca668dcf19/director-renders/d660a559-0073-4b9b-8d72-e472e242efa2/exports/director-1793347292969-c84d6124-34f9-4057-9d49-f92c47391f2c.mp4；16483315 bytes；SHA-256 80cfbc9272a703f9acb6db809923a83c09a62d1e50a7ffad10c009660a2ba081，与产物登记和质量报告一致。
- 独立严格解码（FFmpeg -xerror）通过：1920×1080、60fps、有AAC音频、显示总时长202.92秒（原时间线202.908秒）。捕获12174帧；最终合成按已有tpad/-t策略覆盖完整音频时间，封装12175帧，末尾多一帧保持画面。捕获帧数和最终封装帧数必须区分，不再把二者强行写成同一数值；未改变成片或验收阈值。
- 最终14项自动检查全部通过：90句字幕排版/字形/时间线，素材、旁白对齐、媒体、响度、黑帧、21个切点等。整合响度-16 LUFS，真峰值-1.2 dBTP，无静音、无黑帧区间。
- 单独检查脚本最初把完整解码和稀疏抽帧放到同一split图，造成检查进程缓存积压/get_buffer失败；已改为先完整解码、再独立抽帧的串行检查。失败日志保留，未将检查工具问题当作成片损坏，也未重做正式导出。
- 已实际查看111帧抽样对应的5张联系表：22个镜头中点、21个切点四帧、首/中/尾。画面质量发现两项未解决问题：约101.45秒标题牌右侧文字裁切/牌层重叠；约145秒后的主体偏小、画面留白过多，结尾主体缩到近乎不可读。现有字幕/非黑/切点检查不能替代生成场景内部文字与主体可读性审查；不得据14项自动检查就宣称画面最终合格，也未在产品中执行人工确认。
- 仅完成抽帧视觉复核和自动音频测量，并未宣称人工完整听看。应从程序审片覆盖与Agent修复闭环继续改进，而不是手工修改这份样片。
- 最终前后原稿、时间线、规划、生成文件及全部模型回执历史哈希一致；本次resume后观测模型/媒体网络请求0条，没有重发付费请求。原视频检查前后SHA-256一致。
- 证据：E:/StoryDreamCreativeAudit-20261029-opus-paper/final-audit-conclusion.json；final-independent-verification-finished/verification.json；document.stream-access-completed.json；checkpoint-stream-access-completed.json。全部位于同一证据目录。
## 2026-10-30 17:41 视觉漏检修复与原实例正式复查
- 根因：离屏画布源区域裁掉文字后，glyph tracker 丢弃了整个证据，导致章标题裁切漏检；原非纯色判断又将平滑渐变当成有效主体。独立抽帧发现的缺陷是真实生成代码问题。
- 程序修复：保留部分可见文字并传播 clipped 标记；字幕完整性不再采信裁切片段；实际浏览器布局审查报告 LEMO_TEXT_CLIPPED 并去重；共享标题错误会路由到 shared 修复。纸片边框 source-in 着色按实际 alpha 判断是否抹平文字，保留透明字形重新着色的证据，像素回读失败时不丢证据。
- 新增保守构图检查：排除字幕带、边缘与平滑渐变，三个稳定采样细节占用均低于4%或收尾两个采样均低于1%时报 LEMO_COMPOSITION，允许短暂稀疏入场/淡出。它不是审美评分或主体识别，报告继续标 aestheticReview:false，仍需人工复核。
- 未改原实例源码/素材实测：两章标题镜头均报裁切；shot-3-4 三个稳定时刻均3.2%；shot-4-4尾段两个时刻均0.8%。诊断 runner 在最后一镜前挂起，已关闭且只单独重跑未完成镜头，四项证据齐全；不能把检查脚本挂起说成原正式导出失败。
- 定向9文件131/131通过。扩展6文件初次165/167，失败为 electron-ipc-contract 两条旧直接写帧断言；更新为验证现行流式模块的顺序、原子写入、命名及先seek后送帧，并连同真实帧流测试复测3文件70/70通过。Electron类型检查及生产构建成功。
- 隔离应用 PID23276 于17:40部署。复查前原稿、beats、时间线、素材、全部影片及providerJobs哈希与技术完成快照相同。显式 recheck-code 正确拒绝原片章标题；17:41:11只resume原run一次，正式Agent已开始 shared第2轮增量修复。未手工替换生成源码，原1080p/60fps保留，成功回执仍保留；旧MP4仅作为修复前证据，不是新画面的验收结果。
- 本轮新增源码文件与变化：native-canvas-text.ts / native-canvas-text-tracker.ts / native-subtitles.ts / layout-review.ts / composition-review.ts / review.ts；electron/html-video-renderer.ts / lemo-project-runtime.ts；相关测试。native缓存输入版本尚未更动，本次使用显式复查避免全局失效重放成功工作。
- 证据目录 E:/StoryDreamCreativeAudit-20261029-opus-paper/：visual-program-review-results.json、visual-program-review/*/review.json、visual-fix-tests.log、visual-fix-expanded-tests.log、visual-fix-contract-tests.log、visual-fix-typecheck.log、visual-fix-build.log、visual-fix-deployment.json、checkpoint.before-visual-recheck.json、recheck-visual-fix.result.json、resume-visual-fix.result.json。后续仍需Agent修复、完整审片、重新渲染和独立视听复核，不得宣称画面已修好。

## 2026-10-30 17:52 标题修复通过，补齐诊断定位后继续正式修复
- 17:41 的正式 Agent 回执已修复 shared.drawSectionSign：按实际字体测量标题宽度，自动扩展牌子画布，保留共享接口。真实浏览器复查已越过前部所有章标题；人工查看 shot-1-3-part-2 的 review-3500ms.jpg，标题完整可读。不能将此写为后段画面已通过。
- 后续复查停在 shot-3-4（全片145036–156202ms）：三个稳定采样细节占用仍3.2%。发现旧诊断只含镜头内相对时间，director 回执因此误定位到开头；已在 lemo-project-runtime.ts 添加 shotId、sceneFile、全片起止时间及相对/绝对时间换算说明。
- lemo-repair-continuation、lemo-project 两文件40/40通过；Electron类型检查和生产构建通过。17:49关闭无活动请求的隔离应用后部署新构建，主进程PID11788。
- 免费 recheck-code 已确认新诊断包含 shot-3-4、scene-3 与正确全片窗口；17:52:08仅对原run正式resume一次。任务保持项目绑定Opus 5.5、原稿/字幕/时间线/素材/1080p60fps不变，未手改生成代码或样片。
- 证据：document.after-title-repair.json、visual-location-tests.log、visual-location-typecheck.log、visual-location-build.log、recheck-visual-location.result.json、resume-visual-location.result.json。当前仍在Agent修复阶段，新视频尚未导出验收。


## 2026-10-30 20:19–20:44 跨盘渲染恢复与扩大契约复测

- 17:52 后的正式 Agent 已继续处理 shot-3-4 与 shot-4-a。scene-3 的成功回执把 shot-4-a 调整为中景并同步后续镜头的构图尺度；所有修改仍由正式 Agent 提交。本轮审计没有手改影片源码、原稿、时间线或素材。
- 模型实际使用情况必须更正：后续 Opus 渠道遇到 Hetune 403 额度不足、GeekAI 402 余额不足；隔离实例后续修复已切换到 Moe 的 `gemini-3.1-pro-high`（OpenAI-compatible）。原任务名称中仍有 Opus 字样，不能据此称作 Opus 5.5 全程验收。已有成功回执继续复用。
- 最新渲染失败根因是 E 盘可用约 4.01 GB，预检要求 4777 MB。程序原先把任务素材、帧缓存、片段和混音都放在任务盘，无法单独指定临时工作盘。
- `electron/director-renderer.ts` 增加 `renderRootDir`，在实际临时盘做空间预检；素材缓存、帧流、片段、混音及临时成片写该盘。最终输出经过探测后复制回原任务的 `director-renders/<renderId>/exports`，保留产物路径契约。`electron/main.ts` 的单镜、整片、字幕复检、媒体复检均接入 `STORYDREAM_VIDEO_RENDER_SCRATCH_DIR`，拒绝相对路径。未配置时保留原行为；这仍是环境变量配置，尚无界面选择工作盘或自动选盘。
- 隔离实例设置临时目录 `I:/StoryDreamCreativeAudit-20261029-opus-paper-render-scratch`，构建部署后于 20:19:57 恢复原 run `ae7650fa-9e4a-483a-a358-facb3d1aa70e`，没有创建新样片。此次 renderId 为 `9cab1399-bb68-41d2-88f5-acba56032566`，原视频 selected=false，不能用它代替新结果。
- 跨盘与预算测试 17/17 通过，生产构建成功。扩大验证 16 文件初次 330/332，通过后仍有两处旧契约：历史类型名期望旧“VOX 视觉”；按钮断言只搜页面中的 `aria-label`，未考虑公共 IconButton 的 label 转换。名称同步为现行“创意动画”；按钮改为真实渲染 QueuePage，对 draft/pending/running/paused/failed/cancelled/completed 七个状态逐项验证“继续/重试”按钮数量，原 handler/API 断言保留。复测 16 文件 332/332 通过。新增测试的 React children 类型错误另外修正，最终类型检查结果见后续验收记录。
- 20:43 实际帧高水位 10860/12174；逐帧采集仍运行，无失败节点。138 节点中当时完成136项，render/verify 未完成；本段不能作为最终完成结论。
- 证据目录 `E:/StoryDreamCreativeAudit-20261029-opus-paper/`：`scratch-render-progress.jsonl`、`document.scratch-render-inflight.json`、`checkpoint.scratch-render-inflight.json`、`scratch-final-contract-tests.log`（初次失败）、`scratch-final-contract-retest.log`（332/332）、`scratch-current-ui-contract-final.log`、`scratch-final-typecheck-retest.log`。脚本 `finish-scratch-verification.cjs` 只读取生产状态和文档，完成后启动独立验证，不调用生成或 resume。

## 2026-10-30 20:53–20:57 正式全流程完成及最终验收

本段更新上一段渲染进行中的状态：原正式 run `ae7650fa-9e4a-483a-a358-facb3d1aa70e` 已 completed，138/138 节点全部 completed，active/failed 均为空，render 与 verify 均已完成。技术全流程已跑通；成片视觉质量仍有不足，尚未达到审美验收。

- **新成片**：`E:/StoryDreamCreativeAudit-20261029-opus-paper/userData/storydream/tasks/3dd20493a024c05401424bdf22ba49bf54f8afca668dcf19/director-renders/9cab1399-bb68-41d2-88f5-acba56032566/exports/director-1793362814856-ed66721c-1e0a-425f-abaa-66bd6cf52b80.mp4`。当前 selected=true、pinned=true；旧 render `d660a559-0073-4b9b-8d72-e472e242efa2` 已取消选中。
- 文件大小16,919,745 bytes；SHA-256为 `06ad52498bde1673448f1588437431cc1200f0da030d749edc6372679acaac0d`。验收前后以及收尾复核哈希一致。
- **独立验证**：FFmpeg `-xerror` 完整音视频解码退出码为0；1920×1080、60fps、约202.92秒，音视频流齐全且非静音。采集12174帧，成片12175帧，最后不足一帧的目标时长由末帧延展覆盖。机器媒体检查14/14通过，响度-16 LUFS、真峰值-1.2 dBTP，未检出黑屏区间。
- **抽帧审片**：共抽取111帧，覆盖22个镜头中点、21个切点窗口及首尾；人工查看总览、旧问题对照和三张切点联系表。章标题裁切已修复；shot-3-4、shot-4-a、shot-4-4主体较旧片更大；切点抽样未见黑屏或解码断裂。中后段构图仍重复、留白偏多，前部人物偏小，末尾缩小退场后主体仍很小。没有完成全片人工听看，程序 `aestheticReview:false`，不得表述为审美验收通过。验证JSON中的decodeSeconds包含解码与抽帧脚本总耗时，不能称作纯解码耗时。
- **真实界面**：已在原项目的“成片 / 预览与导出”加载新视频；页面显示“成片已同步”“制作完成”“138/138 步 · 已完成”。视频元数据为1920×1080、202.916667秒，静音播放实测从23.666秒前进至24.826606秒，无video error或pageerror。测试后已暂停并恢复原mute设置。1650×1075与1080×720两视口无document横向溢出；两张截图已人工查看，成片预览、完成状态和导出按钮可见。应用保留在新成片预览。
- **代码验证收尾**：扩大界面/IPC/渲染契约16文件332/332通过；修正新增测试的React children类型写法后，受影响契约文件15/15通过；`npm run typecheck`退出码为0。跨盘与预算17/17、恢复前生产构建也通过。这些是本轮选定范围的结果，不代表整个仓库所有测试均运行通过。
- **数据保留**：9项保存检查全部为true；保持同一run，原稿与时间线同旧完整快照一致，本轮渲染前后规划、生成文件、回执及付费节点attempt/requestId未变。20:19:57恢复后的Electron defaultSession网络观察未见模型/媒体请求；该观察不覆盖其他session或进程，另以保存的付费节点和回执对照确认本轮复用了成功结果。没有手工改样片、影片源码、原稿、时间线或素材。
- **仍存在的限制**：20:19:57恢复至20:53完成约33分钟，其中逐帧采集约26分钟，渲染速度问题仍未解决。临时工作盘目前通过 `STORYDREAM_VIDEO_RENDER_SCRATCH_DIR` 配置，没有界面选盘或自动选盘。后续Agent修复实际使用Moe的 `gemini-3.1-pro-high`，并非Opus 5.5全程成功；原任务名称保留Opus字样不改变这一事实。
- **证据**：`E:/StoryDreamCreativeAudit-20261029-opus-paper/` 下的 `scratch-render-final-status.json`、`document.scratch-render-completed.json`、`checkpoint.scratch-render-completed.json`、`scratch-render-preservation-checks.json`、`final-independent-verification-scratch/verification.json`、`scratch-completed-ui.json`、`scratch-completed-ui-normal.png`、`scratch-completed-ui-compact.png` 和 `scratch-final-audit-conclusion.json`。原始失败记录保留。
