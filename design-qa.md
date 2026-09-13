# Director Desk 设计复核（2026-09-06）

## 当前结论

声音设计切片于 2026-09-06 15:18 验收通过：VOX/漫剧的 1536×1024 与 1040×720 上下部截图均已复审，修复五页签窄屏折行，控件滚动/命中/横向溢出检查通过。证据：`E:/StoryDream-QA/director-sound/results/report.json` 及同目录八张工作流截图；导入、编辑、重开、预览、真实成片与失效处理通过，未调用收费生成。此切片验收不替代下述整体视觉保真门。

操作回归通过不等于视觉复刻通过。此前以 1536px 对比 1440px 原图的结论已撤回。本报告替代旧报告，不宣称 1:1 或全部完成。

## 对照证据

- Source visual truth: I:/opc/.artifacts/product-design-rework/director-desk.png，真实尺寸 1440×1024。
- Implementation screenshot: I:/opc/.artifacts/director-desk-qa/vox-reference-1440x1024.png。
- 全图同画布：I:/opc/.artifacts/director-desk-comparison/comparison-full-final-1440x1024.png。
- 预览焦点：I:/opc/.artifacts/director-desk-comparison/comparison-center-preview-final.png。
- 检查器焦点：I:/opc/.artifacts/director-desk-comparison/comparison-right-inspector-final.png。
- 比较来源：同目录 report.json，无缩放、补黑或越界裁切。以上三张比较图已逐一打开复审。
- Viewport: 对照 1440×1024；交互另测 1536×1024 与 1040×720。
- State: 深色 VOX、本地关键帧、生成 tab。原图八镜头演示选第五镜头；实现四镜头 QA 项目选第一镜头，媒体/字幕/任务数据不同，不作像素误差断言。

## Findings

- [P2，精确复刻未收口] 目标使用人像；实现已移除冒充人像的茶馆图，改为真实音色信息和“音色头像未提供”状态。主体误导已修复，但没有把未提供的音色头像伪装成目标人像，因此不能称为视觉 1:1。
- [已修复 P2] 原右侧标签过大、过亮，已统一为 11px/500 权重及 shell-muted；最新同视口检查器图已复审。新增双引擎/服务状态造成部分字段需要内部滚动，这是功能扩展的明确布局差异，保留记录而非归因于栅格化。
- [已修复 P2] 新字幕面板的单字按钮过宽、时间标签换行、紧凑窗口页签滚出视口；已收紧按钮、把时间标签放在输入框上方，并分离参数/队列滚动。新增滚动边距避免边界被裁 1.3px；严格控件检测和双尺寸上下部截图均通过。
- [已修复 P0/P2] 操作区曾遮挡“画面比例”。footer 已移出滚动容器，作为独立 flex 区域；参数可滚动，生成操作保持可达。最新检测包含滚动、裁切祖先与五点命中验证，三尺寸通过。

## 五项保真表面

- 字体：标签层级已修正，输入文本清晰，时间字段标签不换行；仍不能确认与栅格目标的字体家族完全一致。
- 间距与布局：1440 下 274/770/396 三栏，1536 下 274/770/492；中央宽度保留。footer 无覆盖；紧凑窗口内部滚动为功能性适配。
- 色彩：保留项目珊瑚主动作、蓝色 tab、绿/红状态 token；原图 tab 更偏珊瑚，该差异来自现有组件约束，未另建主题。
- 图像：预览与素材使用实际 raster/本地视频和真实项目内容；叙述者不再错误使用场景图。目标人像与当前无头像数据状态不同，保真门仍保留。
- 文案：生成、禁用、失败、重试反映实际状态；项目标题、镜头数、时长、Provider 名称为动态内容，允许不同。QA 数据未硬编码进生产默认值。

## 交互证据与限制

I:/opc/.artifacts/director-desk-qa/report.json 最新完成于 2026-09-06 10:52:43；status=passed，runtimeErrors=[]，paidGenerationCalls=0。

- 图片/视频服务可切换保存，不可用选项明确禁用。
- 等待/进行/失败/重试/完成、播放/暂停/seek、保存重开均有断言；runtimeErrors 为空，paidGenerationCalls 为 0。
- 三尺寸参数及操作区逐项滚动与命中检查通过；未用几何范围代替可点击性。
- 只用本地媒体与回环视频桩，未验真实付费 Provider；不能将桩成功称作云端服务验收。
- 键盘全程和屏幕阅读器仍未完整实测。
- 新字幕面板实测：新增、按句独立编辑、估算 16 个正时长 token、定位显示、保存重开、错误时间阻断、删除指定句子；旧旁白解除绑定而历史资产保留，画面提示词不变。
- 新面板证据：I:/opc/.artifacts/director-desk-qa/subtitle-editor-1536x1024.png、subtitle-editor-1040x720.png、subtitle-editor-bottom-1040x720.png；均已打开复审。
- AI 漫剧现有流程回归：I:/opc/.artifacts/motion-comic-workbench/report.json，10:52:20 passed；当前紧凑重开工作台截图已复审，无黑屏和乱码。该脚本未验证逐角色 TTS。

## 比较历史

1. 历史胶片条描边及素材区调整的旧截图，不作为本轮通过依据。
2. 旧比较补出 96px 黑边；已改真实 1440px，拒绝尺寸差异与越界裁切。
3. sticky footer 几何可见但覆盖参数；移出滚动区后严格控件 QA 通过，当前检查器图为修复后证据。
4. 生成 tab 隐藏重复引擎说明，重新捕获及生成三张比较图；仍发现上述人像/密度差异，保持 blocked。
5. Node-only Provider 和 Windows DPI 修复属于运行/媒体回归，不代替视觉迭代。
6. 本轮修正人像误导、表单标签层级、逐词按钮密度、时间标签和紧凑滚动；重新构建、捕获、生成完整/预览/检查器同画布图并复审。操作验收通过，但精确目标人像保真仍未完成。

## 实施清单

- [x] 真实同视口完整和焦点比较。
- [x] 修复参数遮挡并验证三尺寸可达性。
- [x] 移除错误主体、修复表单密度，复捕对照。
- [x] P1 逐句/逐词编辑、保存重开、时间预览、双引擎字幕导出切片验收。
- [ ] 精确目标人像保真；当前音色配置无头像，不宣称 1:1。
- [x] P1 逐角色 TTS、多轨声音设计、本地音频导入与实际 MP4 音轨验收。
- [ ] P1 真实语音时间戳服务接入仍未完成。

final result: blocked

## 2026-09-08 审片页面增量验收

- 本节仅证明审片改动，不改变上文精确设计复刻和真实语音服务的未完成状态。
- 质量摘要按 blocking/warning/pending 分别计数；警告可导出的报告显示“可导出 · 待复核”，缺失分析显示“未取得”，正常无黑帧显示“未检出”。
- 报告从 tabs 前的固定区域移入检查器滚动区；复检按钮可滚动到达，报告内容字号提升到 11-13px，重检范围可换行。
- `.artifacts/director-quality-qa/report.json` 19:56:50 passed，8 个状态/尺寸组合均可命中复检按钮且无横向溢出。已打开复审正常/警告/阻断/未知截图，1536x1024 与 1040x720 未发现报告与其他面板重叠。
- `.artifacts/director-desk-qa/report.json` 19:58:24 passed，完整操作回归未因滚动所有权调整失败。两份报告 runtimeErrors=[]、paidGenerationCalls=0。

## 2026-09-08 全文与长列表增量验收

- 全文创建显示实际分钟/秒、节拍数与镜头数；短时长冲突在原文输入下方显示，下一步禁用；全文模式和原稿可保存离开后恢复。
- 剧本入口打开只读原稿弹窗；1536x1024、1040x720 可完整显示弹窗、滚动全文和关闭按钮。
- 224 镜头场景下，选中末镜头自动定位对应胶片和左栏行，保持字幕/提示词/播放位置一致；未生成胶片不再轮播无关示例照片。
- `.artifacts/director-long-script-qa/report.json` 最终构建 20:40:52 passed，共 12 个截图组合，页面无横向溢出；已复审紧凑创建底部、原稿弹窗、桌面/紧凑末镜头。缩窗后第 224 镜头完整位于胶片可见容器内，额外几何断言通过。原稿 11,990 字符精确保留，最后一镜编辑保存重开成功，runtimeErrors=[]、paidGenerationCalls=0。
- `.artifacts/director-desk-qa/report.json` 20:39:43 passed。上一轮视频页截图曾超时，截图统一禁用 CSS 动画后单独复跑成功，交互、媒体像素和保存断言均保留。
- 仍有后续界面工作：创建页紧凑布局的长滚动、项目封面回退图片、长列表滚动后的顶部操作可达性；不将本轮增量验收视为整套界面完成。
## 2026-09-08 批次故障状态增量验收

- 队列新增“正在保存批次”，记录创建前不显示暂停/取消操作；状态保存异常后显示暂停和远端核对入口。
- 队列按已保存节点显示进度，未派发项不出现转圈；恢复时未知远端节点显示“远端状态待核对”。标题/状态分别提升至 12/11px，长节点名有完整 title。
- 最终 `.artifacts/director-batch-faults-qa/report.json` 21:10:07 passed；1536x1024、1040x720 截图已打开复审，页面横向溢出为 0，恢复/取消按钮均在视口内。
- 批次故障、父页面刷新、同进程重进、取消与 601/1501 节点应用重启验收通过，runtimeErrors=[]、paidGenerationCalls=0；测试记录确认生成 IPC 0 次、网络调用 0 次。
- 原导演台完整 `.artifacts/director-desk-qa/report.json` 21:11:59 passed，无运行错误或付费调用；生成、结构编辑、字幕、图层运动、预览和保存重开回归通过。
- 本节不改变全文/审片部分记录的未完成项，不是整套界面视觉验收结论。

## 2026-09-12 Preview-first 导演台

- **参考图**：`output/imagegen/storydream-ui-20260912/image25-focused-desk-concise/image.png`，用户选择“预览优先”。
- **已实现**：浅色/深色语义表面、统一项目栏、文案/分镜/声音/交付四阶段 rail、左侧真实镜头缩略图、中央稳定大预览与 transport、胶片条、素材区、上下文检查器；七个旧步骤通过制作步骤菜单保留。
- **交互证据**：面板 toggle 使用 `aria-controls`/`aria-expanded`，紧凑窗口支持显隐、关闭、Escape 和焦点回归；选择镜头保持胶片条与检查器同步。
- **代码证据**：`src/features/director-desk/DirectorDeskWorkspace.tsx`、`src/features/director-desk/director-workspace-navigation.ts`、`src/styles/features/director-desk.css`、`tests/director-preview-first.test.ts`。
- **截图证据**：`.artifacts/storydream-web-redesign/r3-preview-first-20260912-final/` 已生成完整生产 Electron 证据；36 张截图，`report.json` 为 passed，运行时错误与付费生成调用均为 0。
## 2026-09-08 历史容量与列表分页

- 生产历史专项：`.artifacts/director-history-qa/report.json`，21:58:05 passed；VOX/漫剧各 4500 条历史的分页、末页和搜索，最终 20000 条保存重启均通过。
- 1536x1024、1040x720 共 8 个历史/容量状态组合；列表与页码无横向溢出，容量弹窗的标题、内容滚动区与操作区在视口内。素材每页至多 36 项，生成记录/版本每页至多 20 项；旁白面板固定 162px，不随素材展开拉长。
- 配音错误在当前字幕页和公共状态区可见，详情正常打开/关闭；容量拒绝不改变旧完成任务的状态。
- 最终导演台完整 QA 21:56:22 passed，批次故障 QA 21:59:45 passed；截图复审正常。均无运行错误或付费调用，总计划未完成。

## 2026-09-08 导出资源与画面增量

- 实际 Electron 3 分钟样片：`.artifacts/html-video-resources-qa/frame-checks.png`，检查 0.5/7.4/7.6/14.9/15.1/29.9/30.1/179.5 秒，字幕 A/B、运动标记、镜头颜色与首尾状态正确，无裁切或重叠。
- 生产导演台本地 1080p 图层和动态海报两条成片路径通过，HTML 模板预览和转场输出 smoke 通过。本轮没有重做其他页面的视觉评估，既有未完成界面任务继续保留。
- 新建页默认全文已在最终生产构建验收：`.artifacts/director-long-script-qa/report.json` 22:31:59 passed，defaultFullText=true。复审桌面全文计划、1040x720 底部操作区，时长选项、46 分 20 秒计划与下一步可读可达；草稿恢复和末镜保存重开通过。紧凑页仍需要纵向滚动，其布局简化继续列入 U02 后续，不宣称已改善滚动长度。
