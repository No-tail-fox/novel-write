# 短片生成与 Lemo：剩余工作状态对照

核对日期：2026-11-02（Asia/Shanghai）。

**当前实施与验收以 [最新范围收尾记录](remaining-work-closure-2026-11-02.md) 为准。** 以下内容保留为本轮实施之前的审计快照；其中“仍缺实现”和 Lemo 剪映待办已由后续实施及用户范围调整取代，不再直接作为当前任务表。

最新范围修订：用户明确 Lemo 创意动画只生成最终成片，不映射剪映。本文历史核对中的 Lemo 草稿、双输出及其恢复不再是待办；普通短片/Pixelle 双输出与剪映验收仍保留。其余实现缺口正在推进，进度以根任务计划最新章节为准。

同日按用户要求再次实跑 Pixelle 全部模板：31/31 MP4 与草稿双输出、124 处草稿媒体引用、3 个运动模板及 205/205 相关回归通过。独立新产物目录为 .artifacts/pixelle-retest-20261102/run-1793596515734，中文清单、范围和预览见[Pixelle 全模板本轮复测报告](pixelle-template-retest-2026-11-02.md)。原有证据保留；此结果不等于剪映应用实开或真实美术/听审通过。

- 当前分支：`codex/storydream-project-plan-20261102-upload`。
- 本轮拉取后的核对基线：`4582571`。下列源码行号以该提交为基线；本轮未提交修复可能移动行号，查找时同时使用所列函数名。
- 对照方案：[尚未完成部分实施方案](remaining-work-implementation-plan-2026-10-31.md)。
- 本文区分“已有实现”“尚待验收”和“缺少实现”。旧日志中的测试通过数字不是 2026-11-02 本轮重新执行结果。
- 用户已明确：仅保留官方 SDK v4 新生产路径；旧项目不纳入迁移、兼容或续跑范围，不回退旧 Agent。
- 本文更新只涉及状态记录，不发起付费调用、不修改样片或工程数据。官方 SDK v4 已接入主入口，但本机工程闭环通过不等于真实渠道、艺术质量或发行验收完成。

## 1. 当前推进结论

官方 SDK v4 新生产链已接通主界面、素材准备、宿主旁白测长、唯一字幕/镜头时间轴、整片创作、实帧审片与 `finish_film` 回执、最终有声 MP4。主入口要求完整官方执行/恢复依赖；缺失时提前失败，旧版 native 项目明确不支持，不迁移、不续跑、不回退。暂停、取消与退出信号已贯通 SDK 和渲染；不通过新建运行绕过未决请求。

当前完成的是**新生产路径的本机工程与恢复闭环**。真实渠道、原创艺术及全片听审、多风格长片、剪映草稿双输出恢复、安装发行和网络素材仍未全部验收，不能标记整个项目完成。整合说明见[官方生产链整合报告](official-production-integration-2026-11-02.md)；图文短片与创意动画前序补测见[两条流程测试报告](two-flow-test-report-2026-11-02.md)。

本次按任务和方案再次核对源码，补充明确：真实渠道能力档案/据此自动适配、产品可见的轮次与总预算、细分创作阶段/局部依赖失效，以及官方 v4 草稿双交付集成均不能只记作“等实测”；它们仍有实现缺口。现有配置与本机运行时预检、单 film 持久化恢复、MP4 交付已经完成，不重复列为缺失。

**2026-11-02 本轮已验收：**

- 最新真实官方 SDK 本机 smoke：`run-1793594163773` 通过，4 次本机 Messages 请求、0 次付费请求；固定插件加载、受控文件创作、实帧送审、后续模型轮确认与 `finish_film`、实际有声 MP4 已完整往返。输入使用本地确定性 Messages、仓库图片和 Windows SAPI 夹具，不冒充真实云渠道或原创艺术验收。证据：`.artifacts/lemo-official-production-20261102/run-1793594163773/report.json`。
- 同轮 7 项恢复负例全部拒绝：源码、素材清单、审片帧、finish 回执被篡改，以及请求账本、阶段回执、阶段身份缺失；恢复保留原运行身份，不新增模型请求。证据：同目录 `tamper-recovery-evidence.json`。
- 实际最终 MP4 解码为 **24 fps、118 帧**，`qualityObservations=[]`；此结论属于该本机夹具的工程检查，不代表原创影片的审美或完整听审。证据：同目录 `final-frame-timing-evidence.json`、`final-media-probe.json` 与 `report.json`。
- 官方主界面离线 Electron QA **62/62**、8 张截图通过：1536×1024 和 1040×720、深浅主题、失败/unknown 恢复；恢复沿用原运行，记录核对不承诺解除官方账本阻断，操作后键盘焦点与 Escape 关闭已验证。零页面错误、零服务商调用。证据：`.artifacts/lemo-official-ui-20261102/report.json`。
- 最新应用、Electron、scripts、独立 worker 四套类型检查及应用/worker 构建通过。证据：`.artifacts/lemo-official-production-20261102/verification/typechecks.json`、`build.json`。
- **最终扩大回归：36 文件、855/855 通过，0 失败、0 pending**。初轮测试超时后清理竞态已修复，保留原 5 秒标准、全部断言与失败报告；不与前序重叠测试累计。证据：`.artifacts/lemo-official-production-20261102/verification/regression.json`、`verification.json`。

**本轮前序阶段证据（保留，不替代上述整链验收）：**

- 账本显式恢复与排他接管、响应限额持久化、JSON/SSE 内容块与工具参数完整性已落地。
- 同一轮 6 文件 **320/320**；应用、Electron、scripts、独立 worker 四套 TypeScript 检查均通过；Electron/worker 构建通过，固定上游 2519/313 原文件核验通过。
- 官方 SDK 0.3.314 / CLI 2.1.314 两项本机协议场景通过：工具拒绝后反馈场景 2 次本机请求；断流场景仅 1 次本机请求，4 次后续尝试被阻断。付费模型请求 0。
- 早一批 C4 证据：`.artifacts/lemo-recovery-20261102/verification.json`、同目录 `regression.json`；本机协议报告另见 `.artifacts/lemo-agent-gateway-smoke/report.json`，保留原始哈希，不冒充后续新增文件的验证。
- 后续新增受控文件工具、会话请求与持久化阶段三文件 **97/97**；实际官方 SDK 文件写入、同会话续跑、提交中取消与 unknown 阻断通过，3 次本机请求、0 次付费请求。证据：`.artifacts/lemo-session-20261102/regression-final.json`、`offline-session-report.json`。
- 图文短片核心 **263/263**、创意动画核心 **294/294**；Pixelle 专项 **205/205**、31/31 模板真实双输出、124 处草稿媒体引用及 3 个运动模板复验通过。各套存在重叠，不相加冒充独立总数。该批 UI、构建与源码哈希以两条流程报告和 `.artifacts/two-flow-20261102/verification.json` 为准；官方 v4 最新整链结果以上述证据为准。

## 2. 已有实现

| 工作项 | 已有实现与边界 | 源码或历史证据 |
| --- | --- | --- |
| 普通短片与 Pixelle 双输出 | 统一任务、素材池、MP4/剪映草稿交付；已有本地素材托管、缓存和失败恢复。不能据此认定网络检索、剪映实开或 AI 艺术质量通过。 | `src/shared/short-video-material-runtime.ts`、`src/shared/task-output-runner.ts`；2026-10-31 根计划/进度记录 31/31 模板、4 例本地混剪、124 个草稿媒体引用与 3 个运动模板验收。 |
| 官方 SDK v4 新生产入口 | 主界面仅创建 v4 native 制作；固定一个官方整片创作阶段，官方依赖与协议/运行时预检在付费素材和配音前完成。旧项目明确不支持，不迁移或退回旧入口。 | `electron/main.ts`、`electron/lemo-official-production.ts`、`electron/lemo-official-runtime-config.ts`、`electron/vox-production-runtime.ts`、`electron/vox-production-service.ts`。 |
| 官方 SDK 会话与影片工具 | 固定 SDK/CLI、原插件真实加载；worker 支持 probe/start/resume/cancel；受控文件工具、`read_library`、`review_film`、`finish_film`、会话与工件状态持久化。实际 SDK 已贯通整片生产，结束会话仍须独立通过交付门槛。 | `services/lemo-agent-worker/session.ts`、`creative-tools.ts`、`production-tools.ts`、`stage-store.ts`、`electron/lemo-agent-session-runtime.ts`；前序 `.artifacts/lemo-session-20261102/` 与本轮官方生产链证据。 |
| 素材、宿主旁白与唯一时间轴 | 已绑定真实本地素材及清单哈希；宿主旁白测长后统一字幕/镜头时间窗，再交给官方工程并混音导出。审片回执和最终导出以实际源文件为依据；同轮取消信号贯通渲染。 | `electron/lemo-official-production.ts`、`electron/vox-production-runtime.ts`、`electron/lemo-upstream-picture.ts`、`src/shared/director-render.ts`；最新 smoke 的 `speech-evidence.json`、`export.json`、`final-media-probe.json`。 |
| 请求账本与网关 | 提交前落账；unknown/rejected 阻断新请求；不自动重试、不自动换端点；完整响应缓冲后交付。仅是请求安全层。 | `services/lemo-agent-worker/request-ledger.ts` 的 `begin`/`settle`；`messages-gateway.ts:38` 的 `startLemoMessagesGateway`。2026-10-31 历史记录为 47 项网关/账本与 27 项 SDK 回归。 |
| C4 完整响应基础层 | `response.bin` 与 manifest 保存于私有工件目录，文件 flush 后目录改名提交；读取验证指纹、长度、哈希和协议回执；可显式补记 received。 | `response-store.ts:41` 的 `LemoResponseStore`、`:95` 的 `recoverStoredLemoResponse`、`request-ledger.ts:139` 的 `recordRecoveredResponse`。 |
| C4 提交顺序 | 网关先保存完整响应，再持久化 received，最后返回 SDK；普通账本不保存正文。 | `services/lemo-agent-worker/messages-gateway.ts:112`、`:113`。这不代表 SDK 已应用工具或创作阶段已经完成。 |
| 旧生产链的历史语义 | 本地 `response.json` 可恢复时禁止再调用模型，既有旁白和绝对字幕/镜头时间窗的设计仍可参考。旧生产入口已退役；保留纯函数/库测试不等于继续支持旧项目。 | `electron/lemo-upstream-production.ts:23` 的 `lemoProductionContext`、`:44` 的 `recoverUpstreamStep` 属历史对照；官方新链的完成证据以上述 v4 报告为准。 |

## 3. 本轮验收与仍待验收事项

| 工作项 | 当前状态 | 关闭条件 |
| --- | --- | --- |
| C4 崩溃后显式接管 | **本地接口验收通过**：新增 `inspectInterruptedOwner` / `recoverInterruptedOwner`；普通 open 继续拒绝孤儿锁。 | 同主机、死亡 PID、快照匹配才可显式接管；活 owner、未知主机、旧格式、链接、并发竞争和损坏日志均拒绝。恢复过程自身崩溃留下 guard 仍保守阻断，不自动抢占。 |
| C4 响应恢复限额 | **验收通过**：新增不可隐式更改的 `limits.json`；保存与重开恢复沿用同一上限。 | 已验证大于 32 MiB 的原始响应恢复、冲突限额、策略损坏、超限、篡改和 legacy 明确限额迁移；不从 manifest 自动扩大额度。 |
| JSON/SSE 回执严格性 | **验收通过**：166 项定点测试；网关集成负例验证不完整内容保持 unknown。 | 块次序/索引/start-delta-stop/类型/工具 JSON/终止校验通过；已知完整工具结果只查外层并保留字节，不宣称深层业务或作品完成。 |
| C4 真实故障注入 | **前序 18 项恢复测试通过，包含真实跨进程故障注入**：真实子进程在 submitted、完整响应保存后、received 后直接退出；另覆盖恢复过程本身退出。 | 原 run/journal/requestId 保留；完整结果原字节恢复且不新增请求，缺失响应保持 unknown；三进程争抢仅一个获得 owner。该批仅证明账本层边界，后续真实 SDK/工具/影片恢复证据另列，不倒填旧记录。 |
| C1/C3 官方生产与同会话恢复 | **本机闭环通过**：新入口只执行 v4；恢复保留原运行/阶段身份，unknown 不自动重发；审片帧、finish、账本、阶段记录与源码一致性分别校验。 | 最新 smoke 的 7 项恢复负例及原运行重开恢复通过；不把 received、SDK completed 或人工核对记录当作成片完成。真实渠道长时间中断及更大工程覆盖仍需后续验证。 |
| D 宿主声音与成片时钟 | **本机桥接通过**：素材、旁白实测时长、唯一时间轴、原生画面与最终混音 MP4 已贯通；最终 MP4 实际解码帧时序通过。 | 新链声音桥接不再列为缺少实现。真实渠道音质、完整听审、长片音画稳定性及剪映草稿双输出恢复仍待验收。 |
| 官方恢复 UI | **62/62 本轮检查通过**：普通/紧凑窗口、深浅主题、官方步骤标签、原运行恢复、焦点与 Escape 关闭。 | 保留 `.artifacts/lemo-official-ui-20261102/` 的 8 张截图和 JSON 报告；该局部结果不替代全部历史 UI 失败证据对照。 |
| Pixelle 剪映实开/真实艺术效果 | 本轮工程矩阵 31/31、124 媒体引用及 3 个运动模板通过，已目检三张联系表；剪映实际打开、AI 美术与完整听审仍未验收。 | 在剪映实际打开代表工程，验证媒体、中文字体、时间轴、音轨和编辑边界；真实艺术/听感单列结论。 |
| Pixelle 排版与扩展覆盖 | 已观察到默认视频模板原品牌底栏与宿主时间轴字幕区域相交；未发现双重字幕烧录。31 模板短场景工程测试通过，不能代替全部参数、复杂长文/长片及通用素材图片分支。 | 在宿主字幕布局层处理区域冲突并回归 MP4/草稿一致性，保持固定模板原文件；补充代表性的文字长度、参数/字幕组合与通用素材图片分支。此项不把 31/31 编码交付结果改称失败。 |
| 历史 UI 失败证据对照 | 旧六项失败已有后续修复记录，但仍需将旧测试名与新证据逐项关联。 | 以原失败名称和修复后日志闭环；不重新编造六个失败，不把指定文件回归等同全仓通过。 |

## 4. 仍待实现或完整验收的工作

| 工作包 | 未完成部分 | 当前源码边界与依赖 |
| --- | --- | --- |
| C2 Windows 运行环境与工具边界 | 已验证受控文件、原库读取、宿主审片与导出；仍需在干净安装环境验证运行资源、依赖准备、权限和资源上限。 | 工具未开放任意 Shell、联网或动态脚本执行；独立进程、环境白名单和 cwd 不宣称为系统沙箱。官方原插件的开发环境实跑不等于安装版兼容验收。 |
| C3 阶段化创作与可见预算（部分实现） | 单 film 会话/工件持久化已经实现；方案要求的 treatment、风格帧、声音锁定、镜头/局部修复等独立阶段边界、细粒度依赖失效与产品可见预算尚未完整接通。 | src/shared/lemo-upstream-graph.ts:57–59 当前只有一个 official-authoring/official-ready 阶段；electron/lemo-official-production.ts 固定 stageId=film。electron/lemo-official-runtime-config.ts:70 仍固定 64 请求、64 轮、总 30 分钟；max_tokens 可取配置不代表全部创作/费用预算已可见可配。 |
| C3/C4 更大工程恢复验收 | 官方会话、阶段身份/工件哈希、产品恢复交互及 MP4 副作用闭环已通过本机验证；后续仍需真实渠道长时中断、较大工程与更多跨阶段变更场景。 | `session.ts` 使用 `persistSession:true`；未决请求和不完整工具保持阻断，不能靠换运行/目录或人工记录绕过；只对官方 v4 新项目扩充验证，不恢复旧项目。 |
| B 真实能力档案与自动适配（缺实现，并待真实验收） | 当前读取选定配置、显式检查 Messages 协议并做本机预检；尚未形成按渠道/端点/模型/关键配置版本保存的能力证据档案和据此适配。真实 tool_result 往返、图片、SSE、取消及输出预算仍待测。 | electron/main.ts:3251–3258、electron/lemo-official-production.ts:186–195 与 services/lemo-agent-worker/probe.ts:21–31/64–70；probe 的本机 sink 禁止模型请求并返回 productionReady:false。普通模型连接测试已有单次 JSON/tool_use 检查，但不等于完整能力矩阵。 |
| D 新链双交付恢复（缺集成实现） | 官方 v4 已完成宿主配音测长、唯一字幕/镜头时间轴及最终混音 MP4；尚无本路径的输出目标选择、剪映草稿/双交付 DAG 及按输出登记恢复，之后还需实开验收。 | src/shared/vox-production.ts 的设置无 outputTargets；electron/vox-production-runtime.ts:190–196 只在视频验证后完成。普通任务的 task-output-runner 已有成功分支保留/失败重试，不能说全仓无双输出；独立 vox:export-shot 也是 MP4 镜头导出。 |
| A 网络素材（缺提供商集成） | 一家实际提供商的检索、选择、下载、授权来源记录、托管与双输出闭环。 | 本次对 src/electron/services 定点检索没有 Pexels/Pixabay/Coverr 提供商接线；现有本地素材池和生图不能替代方案要求的联网素材检索。可作为独立支线。 |
| E 原创有声片与扩充验收 | 固定 brief 的 15–30 秒官方 Agent 原创片、视觉反馈修复、全片听审；之后多风格、更长影片及横竖屏。 | 以已接通的 v4 工程链为基础，先完成真实渠道能力与明确预算前置。本机确定性 Messages、仓库素材与 SAPI 夹具不是原创艺术/听感验收，即使 `qualityObservations=[]` 也不改变该边界。 |
| E 安装发行 | 固定版本 worker、官方 SDK/CLI、独立 Node 与运行资源发现/准备、完整性/回滚、干净 Windows 验收。 | `package.json:83` 的 `extraResources` 已有 Pixelle/Python/Lemo 上游/three，但未列完整官方 SDK worker/Node/CLI 发行资源。 |

## 5. 陈旧勾选与历史证据如何处理

| 旧记录 | 后续记录 | 当前对照口径 |
| --- | --- | --- |
| 根计划旧段“Pixelle 尚未实施”“31 模板未全过”“仅完成 23 例”“中文 UI/构建进行中”。 | 2026-10-31 后续记录 31/31 双输出、124 媒体引用、3 运动模板，以及素材池 40/Pixelle 32 桌面检查通过。 | 旧记录保留为过程历史，不能继续作为待实现清单。剪映实开、真实 AI 视觉/听感与安装验收继续未完成。 |
| 根计划旧段“全局 UI 六项仍失败”。 | 2026-10-29 后续收尾记录原四文件 27/27、扩大 19 文件 309/309、真实 Electron 46/46；声明原六项和新增八项已解决。 | 不重复修已解决事项；保留原始失败到修复证据的映射任务，不能从历史文字反推当前仍失败。 |
| 2026-10-31 方案 C4 把“完整响应原子保存”列为拟议工作。 | `4582571` 已包含 `response-store.ts`、网关保存接线和三个基础测试；本轮继续接通官方会话、工具/阶段恢复与 MP4 生产闭环。 | 本地跨进程响应恢复、官方本机闭环与 7 项恢复负例已有各自证据；真实渠道/长工程和双交付恢复仍需验证，不把原子响应保存单项等同整个 C4 完成。 |
| 本文早一轮仍写“主入口未切换”“新链声音尚未桥接”“旧工程迁移待做”。 | 本轮官方 v4 主入口、素材、旁白测长、唯一时间轴、审片 finish 与 MP4 已接通；用户明确旧项目不考虑。 | 这些判断已被当前实现与验收取代；前序文件会话证据继续保留，旧项目迁移不再列为待办。 |
| 子目录 `task_plan.md`/`progress.md` 的 2026-10-24 计划、`I:/opc/task_plan.md` 路径与八项 shell 失败。 | 根计划后续推进了 2026-10-29/31 修复和官方 SDK 迁移。 | 子目录原文视为 2026-10-24 版本历史；其中真实 AI 全片、听审、模式/风格扩充和安装的待办仍有价值，其他条目需按测试名核对，不能混同新 SDK 完成状态。 |
| “17 文件 404 项、四套类型检查、构建通过”。 | 这些数字来自 2026-10-31 请求保护阶段。 | 只能标为旧阶段证据，不能写成本轮 2026-11-02 已重跑。当前机器未找到被引用的 `.artifacts/short-video-gateway-phase-verification.json`，也未找到 E 盘 UI 汇总；本文未重新验证旧报告内容。 |
| 历史“C 盘已满”。 | 2026-10-31 剩余实施方案已记录空间状态后来变化。 | 不能沿用为当前事实；本轮需要用实际空间读数决定验证目录，不自行删除用户文件。 |

## 6. 下一批验收门槛与依赖顺序

1. **C4 本地恢复基础已验收。** 活跃 owner 不抢占；孤儿锁显式恢复；响应限额、哈希、协议校验一致。真实子进程覆盖提交后、完整响应落盘后/回执前、received 后的持久化边界。回执仍不等于 SDK 已应用工具或阶段已提交。
2. **官方 v4 本机整链与 UI 已验收。** 最新真实 SDK 本机 smoke 4 次请求、0 付费、7 项恢复负例，24 fps/118 帧有声 MP4；官方 UI 62/62、四套类型检查和应用/worker 构建通过。扩大回归以第一节的最新验证记录单列，不与前序 320/97/404 等重叠计数相加。
3. **生产范围保持单一。** 仅维护官方 v4 新项目；稳定 run/stage、官方会话与宿主工具状态均须复核，禁止用新运行或目录绕过 unknown。已接通的宿主声音与唯一时间轴继续复用，旧项目迁移和旧 Agent 入口不再推进。
4. **真实渠道与原创有声片。** 在明确渠道能力和预算前置完成后，用固定 brief 完成 15–30 秒原创片及视觉/完整听审；进一步验证真实渠道中断恢复。received、SDK completed、max_tokens 或工程检查无异常均不能代表艺术验收完成。
5. **双交付、扩充与发行。** 验证官方 v4 剪映草稿双输出及恢复、实际打开；再推进多风格/更长影片、横竖屏、历史 UI 证据对照与干净 Windows 安装。网络素材可独立推进，但仍须真实来源、授权记录及双输出验证。

## 7. 本文核对边界

本次状态审计前序读取了根 `AGENTS.md`、`task_plan.md`、`progress.md`、本目录实施方案及历史 task_plan/progress，并定点对照源码与测试。当前更新另外核对官方生产宿主/工具、最新 smoke 的报告与帧时序/7 项恢复负例、类型检查/构建证据及官方 UI 报告。旧 17 文件 404 项不作为本轮结果；各轮回归独立记录，不叠加重叠计数。读取中文均显式使用 UTF-8；未读取凭据，未调用付费模型，未修改用户样片、项目数据或固定上游源码。
