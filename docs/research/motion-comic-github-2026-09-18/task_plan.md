# AI 漫剧 GitHub 对标与移植评估

## 目标
对照 StoryDream 当前漫剧生成链路，实时核实 GitHub 高星同类项目和底层模型，给出可移植模块、接入位置、许可证条件与实施优先级。

## 阶段
- [complete] 本地生成链路和缺口审计。
- [complete] GitHub 项目检索与一手源码、许可证核实。
- [complete] 对照矩阵和具体移植方案。
- [complete] 交付结论并核对证据链接。

## 工作约束
- 当前工作区已有大量未提交改动；本次独立研究目录保存材料。
- 用户本轮要求对比与可行性评估。先给出具体模块和接入方案，不将模型部署或整体重写冒充完成。
- 原始联网材料存放用户临时目录；最终研究结果写入本目录。
- Star 记录实时查询时间；源码结论尽可能固定 commit。

## 工具情况
- GitHub CLI 未安装，使用公开 GitHub API 获取一手信息。
- web-access 默认浏览器未设置；发现已有 Chrome 9222，本次临时选择 Chrome，不修改默认配置。
- PowerShell 读取和写入中文均显式 UTF-8。
- GitHub 匿名 API 达到额度后改用 GitHub HTML、raw 与只读浅克隆；Chrome CDP 代理连接超时不影响公开资料取得。
- StoryDiffusion 初始 owner 猜测返回 404，已按原始 README/官方页面校正为 HVision-NKU/StoryDiffusion。
- shuohao 稀疏目录部分根文件未物化，用 git show 读取 LICENSE/NOTICE；扩展 skills 路径后运行原仓库离线自测通过。
