# 调研发现

- 本地项目为 Electron / React / TypeScript 的 StoryDream。
- 漫剧领域文件：src/shared/motion-comic.ts、src/shared/motion-comic-dialogue.ts、src/features/motion-comic/；生成和渲染复用 director-desk、director-render。
- 当前仓库存在大量其他任务的未提交改动，研究交付使用独立目录。
- 本地审计确认：新建项目固定三场六镜；漫剧页没有 AI 视频生成回调，已有首帧、逐句 TTS 与本地渲染。
- GitHub 搜索实时返回 Toonflow 15,737、waoowaoo 14,127、Jellyfish 6,442、ArcReel 4,985、shuohao-skills 3,536 stars（2026-09-18）。待源码验证后排序。
- 泛中文关键词“漫剧”召回大量无关书库与追番项目，改用 AI storyboard / AI comic 并按实际功能筛选。
- shuohao-skills README 表明五段链路：大纲→角色/美术→剧本→分镜，JS 标准库质量门和导出器可独立复用，需进一步核实源码。
- shuohao-skills 固定 commit 7ebef4f2f53159ee1eaaec2793271a114a8be8cc；已核实标准 Apache-2.0 和 NOTICE。分镜源码真实实现节拍恰好覆盖一次、对白时长、人物/道具引用、切点对齐等校验；H3 专用提示词规则应拆开，不应套给所有视频模型。
- Toonflow 当前许可证除 Apache 外包含商业分发/品牌补充；waoowaoo 为 Elastic License 2.0；Jellyfish 标准 Apache-2.0。以实际 LICENSE 为准，不能以 API license 标记代替。
- 模型一手页面：Wan2.2 17,543 stars，官方 TI2V-5B 指令需 24GB VRAM；S2V-14B 官方指令需 80GB。StoryDiffusion 6,460 stars，低显存版本文档仍建议 >20GB；LatentSync 1.5/1.6 最低推理显存分别 8GB/18GB。
- 本机检测到 RTX 3060 Laptop GPU；WMI AdapterRAM 不能可靠反映 NVIDIA 专用显存，不采用该字段估计容量，待 nvidia-smi 进一步确认。
- 后续 nvidia-smi 已确认 6144 MiB；本机不满足本轮候选视频模型官方推理配方。
- GPT-SoVITS 61,877 星，代码/已核实权重 MIT；CosyVoice 23,672 星，代码/CosyVoice3 权重 Apache-2.0；LatentSync 6,079 星，代码 Apache、1.6 权重 OpenRAIL++，还需处理 InsightFace 预训练模型非商业限制。
- 最终建议：P0 为结构化剧本/分镜和真正的视频生成/渲染闭环；P1 为上下文一致性及角色演绎；P2 为模型级身份控制和口型。详见 README.md 与 app-repos.md。
