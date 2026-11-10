# 根目录过程文件索引（D-2）

按用户决定（ADR-04“只加 `.gitignore`，不移动文件”），根目录的过程文件**原地保留，不搬到本目录**。本文件只做索引，说明每份文件的性质，以及其中没完成的事项现在归到 backlog 哪一条。

当前的权威清单是 [`docs/design/2026-11-10-project-backlog.md`](../design/2026-11-10-project-backlog.md)，决策见 [`docs/design/2026-11-10-decision-record.md`](../design/2026-11-10-decision-record.md)。

## 已跟踪的过程文件（历史记录，不再更新）

| 文件 | 性质 | 未完成事项 → backlog |
|---|---|---|
| `task_plan.md` | 2026-10/11 多阶段计划 | MoneyPrinter 网络素材 → **S-1**；剪映实开、真实美术/听审、安装包验收 → **S-2**、**P-1/P-2**；原歌曲 MV 完整生成（HTTP 402 余额不足）→ **M-1**；Lemo 官方 SDK 宿主、请求账本、原创成片 → **S-1/L-8**（账本部分已由 G-3 覆盖）；Pixelle 原版 31 模板全量渲染 → **P2 架构条目**；“全局 UI 契约 6 项失败” → 已在 **Q-1** 中修复 |
| `progress.md`、`findings.md` | 上述计划的进度日志和发现 | 无独立未完成项 |
| `design-qa.md` | 设计 QA 记录 | 真实小说改编质量等验收见 `docs/research/2026-10-22-novel-script-workflow/acceptance.md`，属于 **Q-6** 真实回归集 |
| `storybound_gap_task_plan.md`、`storybound_gap_progress.md`、`storybound_gap_findings.md` | Storybound 差距分析（已完成） | 无 |
| `storybound_ai_creation_prompt_audit_2026-06-24.md`、`storybound_e_reverse_audit_2026-06-24.md` | 2026-06 提示词审计 | 无 |
| `ordinary-video-multi-source-media-design.md` | 普通视频多来源素材设计 | 网络素材部分 → **S-1** |

## 未跟踪的过程文件（本地文件，不进仓库）

| 文件 | 性质 | 未完成事项 |
|---|---|---|
| `task_plan_music_mv_sync.md`、`progress_music_mv_sync.md`、`findings_music_mv_sync.md` | 音乐 MV 音画同步修复记录 | 原歌曲完整生成被 HTTP 402 阻塞 → **M-1** |
| `disk_cleanup_*.md` | 本机磁盘清理记录 | 与产品无关（ENV-2） |
| `前端重构完成说明.md`、`FRONTEND_REFACTOR_README.md`、`REFACTOR_COMPLETION_REPORT.md` | 其他分支/会话的前端重构报告 | 未核实与当前分支的关系【未核实】 |
| 其余与本项目无关的个人文档 | 不在此列出 | 无 |
