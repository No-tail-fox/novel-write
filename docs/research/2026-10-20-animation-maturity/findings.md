# Findings
- 仓库已有 Remotion、GSAP、HyperFrames 依赖，以及 Storybound 对照、AI 漫剧 GitHub 调研和多轮 Vox 改造记录，需要按当前实现复核。
- 历史记录将本地 Storybound 定位到 G:/Storybound，为 Tauri/WebView2 应用。
## 发现（第一轮）
- StoryDream 当前 AI 漫剧视频请求明确为首帧/可选尾帧 + 文本连续性约束，generateAudio=false；角色多参考图并未由这条请求直接传入视频模型，需区分定妆/分镜一致性与视频一致性。
- Vox 默认路径为 deterministic-layers，动作选择为关键词+轮换的五种固定语法；Remotion 模板为另一路径。
- HTML 视频采用模板编译成 GSAP 时间线并逐帧截图；规划格式异常可退回确定性分镜，需要检查用户实际是否常走回退。
- 本地 Storybound 安装仍在 G:/Storybound；运行库在 Local/com.dudumd.storybound，schema=30。仅两条失败 story 任务，没有 html-video 任务或 HTML 成片，无法凭当前数据对照其实际动画成片效果。
- GitHub 搜索确认新候选与当前热度；Toonflow 当前搜索标签 MIT，正在核对正文。

## 错误/改道
- Firecrawl 未认证；未要求用户登录，改用 GitHub 匿名 API 与只读 git 克隆。
- GitHub 匿名 API 后续遇到 403 限流，改用浅克隆核验。
- Python 输出使用系统 GBK 遇 emoji 编码错误，改为 PYTHONIOENCODING=utf-8。
## 新证据
- 通过只读加载安装程序资源，确认当前 Storybound 入口 index-jF7neVyo.js 实际引用 HtmlVideoPage-HBXz31xy.js；已读取当前模块，非仅依赖旧版本报告。原始产物只保存在 .codex-temp，未进入生产代码。
- Storybound 当前 HTML 视频包含 17 个版式；StoryDream 有 29 个版式，版式名称重合并不代表视觉参数或字幕计时等价。
- Storybound composition 包含 decorations / accents / captionWords；独立 landscape 布局和词级字幕时间值得优先对照。
- StoryDream 本地库 12 个漫剧项目均为 draft，无图像/视频资产；Vox 最新 21 镜项目有 46 张图/21 条音频/29 次失败任务，无 qualityReports。不能把本地夹具验证当作这些项目的整片质量验收。
- wind-comic 部分文档落后于当前代码：文档称多角度参考尚未接通，源码 registry/services 已有 refImageUrls 透传。以代码为准，同时其画质门禁在 VLM 不可用时会放行，不能照搬为严格质量保障。
- HyperFrames 浅克隆超时，但工作树已可读且 HEAD=6d357ff；后续直接复用已完成文件，不重复全量下载。

## 最终核验与结论
- 六个候选固定提交与许可已经核对。Toonflow 当前提交改为 MIT，与旧版调研结论不同；Jellyfish 当前提交与九月相同；Voxstylehub 是上游技能的发行层。
- Storybound 当前活跃模块内有 17 个模板，全部有独立横屏参数；可复现的是结构化构图、字幕时间、焦点转换、视差和标注协议。未对其完整成片进行效果比较。
- 当前 HTML 普通新任务使用默认 24fps/长边1280；编辑重建可保留既有画布。实际字幕均分计时已确认。
- 怀疑的 .captions 选择器问题已排除：实际 DOM 带有该 class，不列为缺陷。
- 最新 Vox 21 镜项目的 29 次历史失败中 23 次为 EDITORIAL_CUTOUT_BACKGROUND_NOT_ISOLATED；这些包含重试，不能等同失败镜头数或失败率。
- HTML 已有通用 ONNX 去底 worker，但默认位置未找到模型。优先保留原图、分离去底重试，再补模型与质量检查，避免重复付费生图。
- 生产改进拆为共用去底、HTML composition v2、Vox 语义 cue、漫剧媒体参考/对白/制作单元四包。验收使用真实素材短片，不用模板数量或合成夹具代替观感。
- 详细结论与固定源码链接见 README.md，具体工程范围见 implementation-plan.md。
