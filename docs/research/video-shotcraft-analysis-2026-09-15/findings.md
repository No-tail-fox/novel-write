# Findings

- 本地资料指向 https://github.com/Vincentwei1021/video-shotcraft。
- README 宣称 157 张配方卡、214 风格/预览，新增 Motion Workbench；工作台另写 216 demo motions，需源码核对统计口径。
- 已有研究将其认定为镜头配方库，不能将 214 视为完整影片模板数量。
- 当前 main 提交为 5e71af35a2daee492dd3ea93e5e8903f32dcd13c（2026-09-09）。本地源码实际统计：157 卡片文件、library.json 157 卡/214 styles、221 个 demo TSX 文件（含公共 fixtures，不能视为 221 独立动作）。
- 项目核心是 Agent 工作流、调校后的 Remotion 代码和交付编辑器。模板 Ink Press 为单个完整影片模板。
- 音频 ATTRIBUTION.md 列出部分基础音效来源无法反查，与 README 的概括性免费商用表述存在需要解释的边界。
- 剪映导出明确烘焙镜头内部动效，原生可编辑的是字幕/镜头切段/音轨；Windows 路径未真机验证。
- CI 有 helpers 单测、demo 严格编译、首帧冒烟、workbench 构建和图库同步检查；不是只有说明文档。
- 本机实际验证：helpers 23/23 测试通过（显式 Vitest 配置隔离父项目）；工作台依赖 262 包安装成功，npm run build 在 prebuild 的 symlinkSync 失败，Windows EPERM，尚未进入 TypeScript 编译。
- 工作台有 218 个独立 demo 源文件（221 TSX 减 3 fixtures），生成器排除两项，文档解释 216 可接入动作；需要区分卡/变体/文件/注册组件。
- demoCards.ts 为 demo 统一设置空 schema；时间线可动不等于可视化改文字颜色。源码有明确文档说明。
- gen-index.mjs 的 path.relative 未标准化 Windows 反斜杠，导出服务依赖 rsync 和 POSIX .bin/remotion，属于进一步的平台适配问题（静态证据，未端到端复现）。
- 工作台专项实际运行 store/导入逻辑探针：分割字幕会提前淡出；清单尾部空白时长丢失、一帧片段被扩为两帧、空 shots 可产生空轨。证据在 workbench-review.md。
- 单 localStorage 保存槽限制项目切换后的编辑恢复；JSON 不携带源码与素材，不能理解成完整可迁移工程包。
- 当前 StoryDream 本地工作区已有 VOX Remotion 链路和 49 个原创参数化模板；上游原版尚未适配。优先精选卡片，处理 30→24 fps、比例、素材路径、沙箱与参数 schema。
