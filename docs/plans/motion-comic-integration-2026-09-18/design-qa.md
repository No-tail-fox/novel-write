# AI 漫剧成熟流程设计验收

验收日期：2026-09-18  
验收方式：隔离 Electron/CDP QA 与 Huobao 同画布对比  
自动报告：`I:\opc\.artifacts\motion-comic-workbench\report.json`  
完整报告：`I:\opc\design-qa.md`

## 结论

AI 漫剧八阶段工作台通过桌面视觉与交互验收。流程为“剧本导入 → 分集拆解 → 分幕分场 → 角色资产 → 分镜图 → 远程视频 → 配音合成 → 成片导出”。1536×1024 与 1040×720、深色与浅色主题均未出现横向溢出、控件裁切或互相遮挡。

Huobao 04-09 与 StoryDream 当前实现已生成六组全景和六组聚焦同画布对比并逐张复审。目标是核对生产顺序、信息层级、可操作性和产品质量，没有复制 Huobao 的品牌、源码或布局。最终没有遗留 P0、P1 或 P2。

## 证据

- 60 张 Electron 截图位于 `I:\opc\.artifacts\motion-comic-workbench\`，覆盖创建流程、source、episodes、scenes、assets、storyboard、video、audio、export。
- 对比图和清单位于 `I:\opc\.artifacts\motion-comic-design-qa\`；归一化规则、文件哈希与裁切坐标记录在 `manifest.json`。
- 人物、场景、道具补录入口在两个视口和两种主题中均可见、启用，并完成实际点击；持久化数量由 `1/1/1` 增至 `2/2/2`。
- 远程视频阶段明确显示 Provider、模型、关键帧就绪、任务状态、费用、运动提示词和生成队列；导入型项目没有本地图片运镜入口。
- 分镜、视频、配音与导出状态按当前分集、镜头、有效资产和输入指纹严格校验。

## 主题 QA 修正

初始浅色证据只修改根节点 `data-theme`，Fluent Provider 没有同步，因此输入框仍显示深色。这是 QA 状态失真，不是产品主题缺陷。脚本现通过真实持久化主题接口切换主题，并同时断言根主题与 `.storydream-provider[data-storydream-theme]`。修正后重跑全部 60 张截图，浅色表单、资产补录、配音和导出控件均显示正确。

## 自动断言

- `status: passed`，60 张截图全部非空。
- 视口：`1536×1024`、`1040×720`；主题：dark、light。
- `runtimeErrors: 0`。
- renderer 外网请求：0；main 外网请求：0；付费生成调用：0。
- 视频任务使用 `image-to-video` 离线夹具；导入型项目 `remoteOnly=true`。
- 页面无乱码、路由错误、横向溢出、控件裁切或边界越界。

## 证据边界

离线 raster、MP4 和任务夹具验证工作流、布局、状态与请求契约，不证明真实远程模型的画质、人物一致性、延迟或账单结果。真实 Provider 在本轮没有被调用。

final result: passed
