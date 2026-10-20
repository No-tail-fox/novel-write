# 动画成熟度分析计划

日期：2026-10-20。范围：AI 漫剧、Vox、HTML 动画。当前分析任务完成；后续实现另见 implementation-plan.md。

### Phase 1：当前链路与历史改造证据
**Status:** complete
- 已读取视频请求、默认编排、模板、字幕、抠图与运行时。
- 已读取本地项目匿名统计，区分真实生产记录、单镜样本与合成 QA。

### Phase 2：GitHub 方案核验
**Status:** complete
- 已核验 Toonflow、wind-comic、Jellyfish、vox-video-starter、HyperFrames、voxstylehub-steven 的源码与许可。
- 固定提交保存在 repo-source-snapshots.json；不以热度替代质量证据。

### Phase 3：Storybound 本地对照
**Status:** complete
- 已读取当前入口实际引用的 HTML 模块，清点 17 个模板、双画幅、字幕、焦点/视差与渲染协议。
- 原始提取文件留在本地临时目录，仅提交行为摘要。

### Phase 4：结论与实施拆分
**Status:** complete
- README.md 提供问题、证据、选型与可复用边界。
- implementation-plan.md 提供四个工程包和真实样片验收条件。
- 已核验文档编码、相对链接目标、JSON 结构和关键统计。

## 本轮约束
- 仅分析与验证，没有修改生产代码、批量迁移或调用付费生成。
- 根目录原有计划文件与其他未提交内容保持原状。
- 不记录密钥、账户或用户正文。

## 遇到的问题与处理
- Firecrawl 未认证，GitHub 匿名 API 后续限流：改用已完成的只读浅克隆。
- Python 控制台编码问题：使用 UTF-8 输出。
- HyperFrames clone 超时：工作树和 HEAD 已可核验，复用已下载文件，未重复克隆。
- 浏览器默认值未配置：公开源码不依赖它；本地 Storybound 通过专用 CDP 读取。
