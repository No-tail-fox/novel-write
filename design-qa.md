# AI 漫剧成熟流程设计 QA

验收日期：2026-09-18
验收对象：StoryDream AI 漫剧八阶段生产链
验收范围：分集、分幕分场、角色/场景/道具、分镜图、远程视频、导出
自动化报告：`I:\opc\.artifacts\motion-comic-workbench\report.json`

## 结论

本轮同画布复核未发现可执行的 P0、P1 或 P2 视觉问题。StoryDream 已把 Huobao 展示的成熟生产顺序落实为自己的八阶段工作区，并沿用现有 StoryDream 壳层、Fluent 语义色和 Director Desk。验收目标是流程结构、信息层级、可操作性和产品质量，不是复制 Huobao 的品牌、源码或 UI。

Huobao 参考图使用真实生成媒体，StoryDream 验收图使用离线 raster、MP4 和任务夹具以避免付费调用，因此不能从本轮证据推断真实模型画质相同。该差异属于明确的测试状态边界，不是界面缺失。

## 来源与比较契约

- Source visual truth：`I:\opc\.artifacts\motion-comic-design-qa\reference\04-episodes.png` 至 `09-export.png`。
- 上游来源：[chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama)，固定提交 `575790acaad0d0ed5346bdbe5a202ac6a3d02ee0`。
- 许可：CC BY-NC-SA 4.0；这些截图只用于本地设计对照。StoryDream 没有复制 Huobao 源码、提示词、品牌或布局。
- Huobao 原图：`2880×1800`，深色主题，16:10。
- StoryDream 主比较图：`1536×1024`，深色主题；另测 `1040×720` 深浅主题。
- 归一化：Huobao 原图保持纵横比缩到 `1536×960`，在 `1536×1024` 面板内居中；StoryDream 保持原始 `1536×1024`。不拉伸、不裁掉全图。
- 状态边界：项目内容、镜头数量、媒体和供应商不同，不做像素误差或生成画质等价断言。
- 文件哈希、原图尺寸、归一化位置和裁切坐标：`I:\opc\.artifacts\motion-comic-design-qa\manifest.json`。

## 全景与聚焦证据

| Huobao 状态 | StoryDream 实现图 | 全景同画布 | 聚焦同画布 |
| --- | --- | --- | --- |
| 04 分集 | `21-stage-episodes-dark-desktop-1536x1024.png` | `comparison-full-04-episodes.png` | `comparison-focus-04-episodes.png` |
| 05 剧本 | `25-stage-scenes-dark-desktop-1536x1024.png` | `comparison-full-05-script-scenes.png` | `comparison-focus-05-script-scenes.png` |
| 06 资产 | `29-stage-assets-dark-desktop-1536x1024.png` | `comparison-full-06-assets.png` | `comparison-focus-06-assets.png` |
| 07 分镜 | `45-stage-storyboard-dark-desktop-1536x1024.png` | `comparison-full-07-storyboard.png` | `comparison-focus-07-storyboard.png` |
| 08 视频 | `49-stage-video-dark-desktop-1536x1024.png` | `comparison-full-08-videos.png` | `comparison-focus-08-videos.png` |
| 09 导出 | `57-stage-export-dark-desktop-1536x1024.png` | `comparison-full-09-export.png` | `comparison-focus-09-export.png` |

表中实现图位于 `I:\opc\.artifacts\motion-comic-workbench\`，比较图位于 `I:\opc\.artifacts\motion-comic-design-qa\`。六张全景和六张聚焦图均已逐张打开复审。

补充证据：

- 紧凑视口总览：`implementation-compact-dark-contact-sheet.png`。
- 人物、场景、道具手动补录：`implementation-assets-manual-controls.png`。
- 资产补录原图：`33-stage-assets-character-dark-desktop-1536x1024.png`、`34-stage-assets-scene-dark-desktop-1536x1024.png`、`35-stage-assets-prop-dark-desktop-1536x1024.png`。

## 逐张检查

### 04 分集

Huobao 用项目卡片管理集；StoryDream 用可编辑分集清单、原文侧栏和八阶段步进器。StoryDream 额外展示“等待 AI 结构化”和继续操作，符合导入后先确认分集的目标。低集数造成的留白不会隐藏控件，也没有改变层级。

### 05 剧本与分幕分场

Huobao 把 AI 改写剧本作为一块长文；StoryDream 将内容拆成幕、场和镜头，并把幕标题、场次标题、摘要与时长直接设为可编辑字段。这是为了支持人工审阅和局部修订的功能扩展。桌面与紧凑视口均未见折行冲突、控件重叠或横向溢出。

### 06 角色、场景与道具

Huobao 首屏突出带预览图的资产卡；StoryDream 先固定系列定位，再按人物、场景、道具维护一致性定义和参考图版本。最终 QA 已实际滚动并点击“新增人物”“新增场景”“新增道具”，三类按钮在深浅主题及两个视口均可见、启用。添加后数量从 `1/1/1` 增至 `2/2/2`，Provider 任务和费用保持不变。

### 07 分镜图

Huobao 将任务列表、提示词、参考素材和已生成媒体放在同一工作区；StoryDream 使用镜头清单、稳定中央预览、胶片条和右侧关键帧检查器。镜头选择、提示词、模板、运镜和关键帧动作集中在可扫读区域，主预览没有空白或被上方导航挤压。

### 08 远程视频

StoryDream 的视频阶段明确显示“远程视频”、服务、模型、关键帧就绪、任务状态、费用、运动提示词和生成队列。它比参考图更清楚地区分关键帧与视频任务，且导入型项目没有本地视频策略入口。右侧检查器内部滚动，主预览与底部胶片条保持稳定。

### 09 导出

Huobao 展示镜头选择和拼接；StoryDream 在同一导演台先显示审片质量门，再进入合成与导出。参考图是部分镜头已生成、部分待生成的项目，StoryDream 是三镜头离线完成但尚待审片的状态，因此不比较按钮文案和素材数量。质量门、镜头列表和预览均可见，未见控件遮挡。

## 五项必检面

- 字体与排版：两者均使用紧凑的中文桌面 UI 层级；StoryDream 的标题、阶段、字段标签、状态和辅助文字权重清楚。长中文在 1536×1024 与 1040×720 没有越界、不可读缩放或异常负字距。
- 间距与布局：StoryDream 的八阶段步进器、列表/预览/检查器三栏和内部滚动边界稳定。全景与紧凑证据均没有持久控件被裁、重叠或横向溢出。
- 色彩与 token：Huobao 使用橙色动作和深蓝黑表面；StoryDream 保留项目珊瑚色、绿色完成态、中性深色表面和浅色主题。品牌色不同是既有产品约束，语义状态在各阶段一致。
- 图像质量与资产保真：参考图中的人物和场景是 Huobao 演示媒体；StoryDream 图像是本地离线 raster 夹具，视频是本地离线 MP4。裁切、比例、锐度和预览容器均正常，但真实远程模型画质不在本轮结论内。
- 文案与内容：StoryDream 的“剧本、分集、分幕、资产、分镜图、视频、配音、导出”与用户目标一致；“远程视频”、就绪条件、费用和审片状态直接表达实际约束，没有 Vox 流程文案泄漏。

图标来自现有图标库，线宽和尺寸一致；主要操作均有文字标签。自动检查覆盖横向溢出、控件边界和乱码。完整键盘顺序、屏幕阅读器朗读和真实系统缩放仍属于后续无障碍专项，不作为这次成熟流程视觉对照的阻塞项。

## Findings

没有可执行的 P0、P1 或 P2 差异。

残余证据边界：

- 离线夹具不能证明真实远程图片或视频的主体质量、人物一致性、延迟和账单结果。
- Huobao 只提供 `2880×1800` 深色桌面参考，没有相同项目数据、1040×720 或浅色状态；这些状态只做 StoryDream 自身的响应式和主题 QA。
- Huobao 的 07 与 08 截图都使用视频制作工作区，不能作为“分镜图”和“视频”视觉分离的精确目标；StoryDream 通过独立阶段和检查器动作主动消除了该歧义。

## 比较历史

1. 初始实现证据包含 48 张截图，六组全景/聚焦对比未发现 P0、P1 或 P2，但人物、场景、道具手动补录缺少明确点击证据。该项记录为证据缺口，没有据此宣称通过。
2. 复核发现原浅色截图只修改根节点 `data-theme`，Fluent Provider 没有同步，输入框仍显示深色。QA 改为调用真实持久化主题接口，并同时断言根节点与 `.storydream-provider[data-storydream-theme]`。
3. 最终 Electron QA 扩展为 60 张截图，增加三类资产按钮在深浅主题、1536×1024 和 1040×720 的可见/启用断言，并实际点击完成补录。修正主题切换后重新生成全部截图、当前暗色同画布和聚焦图并逐张复审。
4. 本轮最终比较没有遗留 P0、P1 或 P2，因此不需要产品视觉修复和再次捕获循环；只补全了验收证据。

## 交互与运行证据

- 自动报告状态：`passed`，60 张截图。
- 视口：`1536×1024`、`1040×720`；主题：dark、light。
- 已访问：source、episodes、scenes、assets、storyboard、video、audio、export。
- 手动资产入口：新增人物、新增场景、新增道具，均已点击验证。
- renderer 外网请求：0；main 外网请求：0；runtime errors：0；paid generation calls：0。
- 视频任务均为 `image-to-video` 离线夹具，导入型项目 `remoteOnly=true`。

## 实施清单

- [x] 六组 Huobao 参考图与当前实现放入同一比较画布。
- [x] 对高密度内容生成聚焦比较并逐张检查。
- [x] 深浅主题与桌面/紧凑视口覆盖。
- [x] 人物、场景、道具补录入口可见、可点击且不触发生成。
- [x] 八阶段状态与远程视频限定清楚可见。
- [x] 记录媒体、视口和项目数据不完全相同的证据边界。
- [x] 无遗留 P0/P1/P2。

final result: passed

## 2026-10-21 最终成片审片绑定

- 使用生产 Electron 构建、隔离 profile 与既有可播放 MP4；新增脚本 `scripts/qa-director-quality-ui.py` 不触发付费生成。
- 深浅主题 × 1536×1024 / 1040×720 四张截图，检查质量门文字、SHA、确认状态、滚动到底部和横向溢出。常规与紧凑窗口均通过；截图在 `.artifacts/director-quality-binding/`。
- 实际点击核验/确认后检查持久数据。相同文件尺寸下修改一个字节后焦点返回，原确认撤销；旧报告缺 SHA、P1 pending 和删除文件均不可确认。Vox/漫剧两路由通过，未保存镜头提示词保留。
- 发现文件变化后右上角仍写“已通过”，已修复为“成片已变化 / 成片已丢失 / 成片不可读 / 成片待核验 / 成片核验中”，与实际摘要状态同步。
- 机器报告 8 项检查通过，页面异常 0，外网请求 0。12 条报告项为明确标记的离线 UI 夹具，不能当作影片视觉质量已通过。

## 2026-10-22 后台批量剧本工作台

- 依据 Toonflow、Jellyfish、wind-comic 固定提交的分阶段与持久任务流程实现，保留现有 StoryDream 组件、主题和导航。源分集项目不再用阻塞生成弹窗承载逐集制作。
- 生产 Electron 隔离 profile、24 集离线夹具，深浅主题 × 1536×1024 / 1040×720 四张截图均已查看。报告和截图在 `.artifacts/novel-script-workflow/`，`status=passed`、页面异常 0、付费调用 0。
- 初验发现 1040×720 的冗余标题挤占编辑区；已将筛选并排并压缩重复标题。最终分集列表/节拍编辑区/场次列表分别为 263/183/102px；桌面分别为 460/345/216px。独立滚动、完整编辑字段、底部批准操作和无横向溢出断言通过。
- 实际点击覆盖：未审阅禁用批准、当前版本批量批准、后集分镜先应用、重复应用拒绝、草稿切集与重载保持、保存修订后下游过期、批量提交后立即退出弹窗和离开页面再返回。
- 此结果只证明离线流程与桌面界面，不证明真实小说改编质量、远程连续性、口型或付费媒体恢复。完整证据与未完成项见 `docs/research/2026-10-22-novel-script-workflow/acceptance.md`。

## 2026-10-22 Vox 第三张流程大纲实施：阶段 A

用户选择第三张为实施基准。已完成左侧四阶段及单一镜头导航、中央预览、下方旁白/画面就地编辑、固定整片操作与按需高级抽屉；本节结论只适用于页面简化及定向回归。预设、完整自动链、脱离页面执行和真实自动样片仍属后续 B–E。

- 来源：`I:/opc/docs/design/2026-10-22-vox-generation-simplification/concepts/process-outline/design.png`，1536×1024。
- 实现：`I:/opc/docs/design/2026-10-22-vox-generation-simplification/implementation-evidence/desktop-dark-final.png`，1536×1024，真实 React Vox 页 + Vox runtime、隔离 Electron、模拟 API/保存。
- 全景及四组聚焦：`I:/opc/docs/design/2026-10-22-vox-generation-simplification/implementation-evidence/comparisons/01-full-view.png` 至 `05-fixed-footer.png`。原尺寸同画布，局部不拉伸；另检查紧凑深浅主题、窄窗口双抽屉、嵌套模板、200% 缩放及共享漫剧，前九张比较画布和桌面深浅原图均已目视复核。
- 五项必检面：字体使用现有 13px 控件/14px 正文及中文回退；布局采用 300/248px 大纲、独立滚动及 92/80px 固定底栏；颜色/6px 圆角/Lucide 服从 StoryDream token；真实 16:9 项目采用 contain，保留安全区和字幕；文案按真实镜头和状态显示，主按钮明确为「生成现有镜头成片」。静态参考约 2.35:1 的预览、较宽大纲、示例正文与装饰效果没有强加到真实项目。
- 修复历史：关闭抽屉残留遮挡、紧凑预览过高、受控/嵌套弹窗焦点返回、相同旁白不应使配音失效、截图过渡等待、窄窗口粘性标题遮住抽屉关闭按钮。最终 overlay 修复后重拍，并检查关闭按钮命中、实际点击和焦点返回。
- Vox：78 项检查 / 24 张截图，覆盖深浅主题、1536×1024 / 1040×720 / 860×720、真实 200% 缩放、100 镜头/长标题/空项目、保存重载、抽屉草稿和键盘、模拟生成忙碌/失败；页面异常、console error、付费调用均为 0。多次 Tab/视口断言不等于独立端到端用例数量。
- 共享漫剧：最新生产 Electron 离线定向回归 22 项 / 4 张截图通过，原布局/检查器/胶片条、批量取消和共享弹窗焦点正常，无新增 provider job、外网请求或页面异常。
- 代码检查：6 文件 / 55 项聚焦测试、三套类型检查、生产构建通过。并行高负载运行的调度器超时已如实记录，独立重跑未放宽超时。旧产品流程 4 条字符串断言和旧 8 阶段完整漫剧 QA 不计入本次通过范围。

没有遗留可执行 P0 / P1 / P2 视觉问题。预览城市图只为隔离 QA 夹具，未加入正式应用；本次没有新增真实自动样片，也不证明完整导航/真实付费执行、高清长片内存、Vox 词级/VLM 或远程漫剧连续性/口型/完整上传下载恢复。

完整来源、差异、修复历史与证据：[本轮设计 QA](I:/opc/docs/design/2026-10-22-vox-generation-simplification/design-qa.md)；命令、旧基线和后续门槛：[实施验收](I:/opc/docs/design/2026-10-22-vox-generation-simplification/acceptance.md)。

final result: passed（仅阶段 A 页面简化与本次定向验收）
