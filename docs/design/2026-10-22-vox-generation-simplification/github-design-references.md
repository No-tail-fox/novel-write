# GitHub 设计技能核查与采用范围

核查日期：2026-10-22。GitHub CLI 未安装，公开 GitHub API 返回 HTTP 403；改用只读 `git ls-remote`、浅克隆和固定 commit 的 raw 原文。以下为当时核对的版本，不宣称最新永久有效，不以未经核实的 star 数证明成熟度。

## 已核对的来源

| 来源与固定版本 | 核对原文 | 可应用到 Vox 的规则 | 许可证/使用范围 |
| --- | --- | --- | --- |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable/tree/8644175285360c166e57b1e35ecadfbc85ff5209) | [distill](https://github.com/pbakaus/impeccable/blob/8644175285360c166e57b1e35ecadfbc85ff5209/skill/reference/distill.md)、[clarify](https://github.com/pbakaus/impeccable/blob/8644175285360c166e57b1e35ecadfbc85ff5209/skill/reference/clarify.md)、[audit](https://github.com/pbakaus/impeccable/blob/8644175285360c166e57b1e35ecadfbc85ff5209/skill/reference/audit.md) | 先整理信息结构；一个清楚主操作；合并重复入口；高级按需展开；文案明确动作与对象；真实异步状态 | 已检查 Apache-2.0 LICENSE；本轮只引用方法，不复制实现 |
| [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44) | [frontend-design](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/SKILL.md) | 围绕实际内容和任务建立层级，避免通用仪表盘式堆叠；延续项目既有视觉语言 | 已检查技能级 [LICENSE.txt](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/LICENSE.txt)，Apache-2.0；方法参考 |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/623a9a9037d006ea727f8213f084d02a6b6f11b5) | [技能原文](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/623a9a9037d006ea727f8213f084d02a6b6f11b5/.claude/skills/ui-ux-pro-max/SKILL.md) | 可见字段标签、处理/错误反馈、响应式与可访问性检查 | MIT；不使用其自动推荐覆盖 StoryDream token |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278) | [web-design-guidelines](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md) | 用审查规则定位布局、焦点、长内容和控件语义问题；该技能引用外部规则文件 | 未在该版本树中找到明确的根/技能级许可证，不复制、不安装，仅作为调查入口 |
| [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines/tree/434b7f91364665f2f733b310ec54809bf8f37937) | [command.md](https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/command.md) | 固定栏不能遮焦点；长内容可换行；弹性子项可收缩；异步反馈、抽屉滚动隔离、减少动态效果 | 未检查许可证，仅研究规则；不复制源码 |

完整方法与元数据保存在 [github-sources.json](github-sources.json)。外部临时检索资料位于用户的 Agent Reach scratch 目录；报告的固定版本链接和本地证据不依赖该临时目录长期保留。

## 从规则到实际决策

| 规则 | 当前页面证据 | 采用的设计决策 | 后续如何判断有效 |
| --- | --- | --- | --- |
| Impeccable：一个主目标/主操作 | 素材、视频、动画、整片和批量入口散布在检查器/模态框 | 固定项目操作条；镜头操作使用明确对象和次级样式 | 不懂引擎的用户能在任何阶段找到同一个成片入口 |
| Impeccable：逐步展开、保留能力 | 制作配方、渲染方式、创作方式连续出现 | 结果预设自动解析默认值，内部技术决定迁入高级设置 | 不需要打开高级也可制作；专家仍能改原有字段 |
| Impeccable：删除重复入口 | 同一模板既有预览下拉又有模板库按钮；镜头导航重复 | 一个模板选择入口；镜头大纲/胶片条按方案择一 | 同一任务无重复同权重入口 |
| clarify：具体动作与诚实状态 | “生成”有多种作用对象，批量不含动画生成 | 项目/镜头动作区分；状态矩阵与实际任务计划绑定 | 每个按钮可解释将生成什么；失败/未知结果有明确恢复动作 |
| Vercel：焦点/滚动/可收缩内容 | 1040×720 的右侧编辑区只有 191px，固定底区很大 | 任务细节按需展开、独立内容滚动、网格底行 | 键盘到达最后字段和按钮，长错误/200% 缩放仍可操作 |
| UI UX Pro Max：字段、反馈、响应式 | 专业字段/状态与核心路径混排 | 保留清楚标签和必要阻塞，减少默认决定数 | 不依赖图标猜意义；异步状态及缺输入可见 |
| frontend-design：实际产品语境 | 现有 StoryDream 有成熟 token/组件契约 | 保留中性 Fluent 界面、珊瑚色主操作、真实拼贴预览 | 改版仍属于同一软件，不额外引入主题或图标库 |

## 不应从这些来源推导的结论

- 设计 skill 的存在不证明完整的素材生产、配音、动画、渲染与恢复能力成熟；这些需要检查本项目执行链并实测。
- `distill.md` 在本次核对版本位于 `skill/reference/`，不按旧文章假定独立命令目录。没有为了引用而在项目中安装第三方技能。
- UI UX Pro Max 本地搜索“progressive disclosure primary action”命中不相关的排版建议，该结果未作为结论；缩小到表单负担后只采用可解释的标签/反馈建议。
- 不是逐项照抄网页通用建议。桌面工具沿用项目字号/密度与 Electron 路由；不强制替换为另一套手机控件尺寸或 URL 状态库。
- 模板总数、特效总数不是本轮的删减指标；默认路径中的决定、重复入口和不可预测生成行为才是需要解决的问题。
