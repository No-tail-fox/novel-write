# Pixelle-Video 视频处理研究

日期：2026-05-29

目标：研究 [AIDC-AI/Pixelle-Video](https://github.com/AIDC-AI/Pixelle-Video) 的视频处理链路，判断哪些设计可以被 Storybound Replica 借鉴。本文只做研究和后续路线建议，不包含代码实现。

## 结论

Pixelle-Video 最值得学习的不是某个模型接口，而是它把“最终视频”作为一等产物来组织流程：每个分镜先生成旁白音频，再用音频时长约束图片或视频素材，随后用 HTML 模板渲染画面层，最后通过 ffmpeg 生成分段 MP4、拼接成片并混入 BGM。

当前 Storybound Replica 的优势在任务状态、分步缓存、素材生成、TTS、字幕和剪映草稿导出。Pixelle-Video 的优势在直接 MP4 合成、音画时长校准、视频素材处理和模板渲染。两者关系更适合“并行补强”，不适合用 Pixelle-Video 替换现有剪映导出。

推荐后续优先方向：保留现有剪映草稿能力，新增一个可选的本地 MP4 导出链路。视频素材生成可以作为第二阶段能力。

## Pixelle-Video 的视频链路

参考文件：

- `pixelle_video/pipelines/standard.py`
- `pixelle_video/services/frame_processor.py`
- `pixelle_video/services/frame_html.py`
- `pixelle_video/services/video.py`
- `pixelle_video/services/media.py`

### 标准短视频流程

`StandardPipeline` 将短视频生成拆成线性生命周期：

1. 创建隔离任务目录。
2. 生成或拆分旁白文案。
3. 生成标题。
4. 根据模板类型判断是否需要媒体生成。
5. 构建 storyboard 和 frame 列表。
6. 对每个 frame 生成音频、图片或视频、模板画面和视频片段。
7. 用 ffmpeg 拼接所有片段，并按需添加 BGM。
8. 保存任务元数据和 storyboard。

这一点和 Storybound Replica 的分步 pipeline 很接近，但 Pixelle-Video 在 Step 6 之后会继续产出最终 MP4，而当前项目主要产出剪映草稿目录。

### Frame 级处理

`FrameProcessor` 的顺序很关键：

1. 先 TTS，得到 `audio_path` 和音频时长。
2. 再生成媒体。如果是视频工作流，会把音频时长作为目标视频时长传给媒体生成服务。
3. 用 HTML 模板渲染 frame 画面。
4. 如果素材是图片，将渲染后的图片和音频合成视频片段。
5. 如果素材是视频，将透明模板层叠到视频上，再替换或添加旁白音频。

这个顺序解决了短视频里最常见的问题：画面时长、字幕时长、旁白时长各算各的，最终对不齐。它把 TTS 音频时长作为更可靠的时间基准。

### HTML 模板渲染

`HTMLFrameGenerator` 用 Playwright 打开临时 HTML，并以固定 viewport 截图成 PNG。模板路径或 meta 信息提供尺寸，模板里的变量用于注入标题、正文、图片或扩展参数。

对视频素材，HTML 模板渲染出来的是透明叠层图；对图片素材，模板可以直接把图片作为背景或主体图渲进去。

这个模式的优点是模板设计成本低、预览容易、和 Web/Electron 技术栈匹配。风险是字体、透明背景、截图尺寸和本地文件 URL 在 Windows 上需要仔细处理。

### ffmpeg 合成能力

`VideoService` 封装了几个核心操作：

- 检测 ffmpeg 是否可用。
- 图片加音频生成单段 MP4。
- 视频和音频合并，自动处理视频比音频长或短的情况。
- 视频叠加透明图片层。
- 多段视频拼接，优先使用 concat demuxer，必要时使用 filter。
- BGM 循环、音量控制和混音。

它的工程价值在于把“视频合成”收敛到一个服务层，而不是散落在 pipeline、模板和 UI 中。

### 媒体工作流

`MediaService` 支持 image 和 video 两类工作流，底层通过 ComfyKit 调 RunningHub 或自托管 ComfyUI。它根据 workflow 名称和调用参数区分图片或视频结果。

这里的理念可以学：统一“媒体生成”接口，让图片和视频都是 scene asset。但具体实现不建议直接搬，因为当前项目是 TypeScript/Electron，已有 OpenAI-compatible、即梦、TTS provider 和本地缓存结构。

## 当前项目对比

参考本地文件：

- `I:\opc\src\shared\runner.ts`
- `I:\opc\src\shared\draft.ts`
- `I:\opc\src\shared\jianying-bridge.ts`
- `I:\opc\src\shared\media-providers.ts`
- `I:\opc\src\shared\story.ts`

### 当前已有优势

Storybound Replica 已经具备可复用的核心资产链：

- `runner.ts` 有步骤状态、失败恢复、任务 heartbeat、pipeline/state.json 和素材缓存。
- Step 4 支持按 scene 生成真实图片，并能并发生成和增量落盘。
- Step 5 支持真实 TTS，输出按 scene 对应的音频文件。
- `draft.ts` 会校验图片、音频、BGM 和字幕，并交给 `pyJianYingDraft` 生成剪映草稿。
- `jianying-bridge.ts` 已经有场景起止时间、画布、图片区域、字幕和音量参数的桥接模型。

这些都不需要推倒重来。新增 MP4 合成时，应复用现有 artifact、SceneAsset、SubtitleTrack、DraftTemplate 和 pipeline state。

### 当前主要缺口

当前项目距离 Pixelle-Video 的视频处理能力还差几层：

- 没有直接 MP4 输出路径，最终产物主要是剪映草稿目录。
- `SceneAsset` 只有 `sceneId` 和 `path`，无法表达 asset 是图片还是视频，也没有 duration。
- 字幕时间来自 `scene.durationMs`，不是 TTS 实际音频时长。
- 没有统一的视频 probe、trim、pad、overlay、concat、mix BGM 服务。
- 模板目前主要映射到剪映 draft 参数，还没有 HTML/Canvas 截图式 frame renderer。

## 可借鉴点分级

### 低风险可学

这些是思想和架构层面的借鉴，适合后续优先实现：

- 增加独立视频合成服务，封装 probe、图片转视频、音视频合并、拼接和 BGM 混音。
- 将 TTS 音频时长作为字幕和分镜 duration 的校准来源。
- 在现有 pipeline state 中记录最终 MP4 路径，作为剪映草稿之外的可选产物。
- 保持 scene-by-scene 的中间文件结构，方便断点续跑和局部重试。
- 对 ffmpeg 做启动前检查，错误信息给出可操作的安装或配置提示。

### 需要适配后可学

这些能力有价值，但需要按当前技术栈重写：

- HTML 模板截图：可以用 Playwright，也可以复用 Electron/Chromium 渲染能力。需要处理 Windows 文件 URL、字体、透明背景和固定尺寸截图。
- 视频叠层：需要把 HTML/Canvas 输出为透明 PNG，再用 ffmpeg overlay 到视频素材上。
- 视频素材工作流：应扩展现有 provider 接口，而不是引入 Pixelle-Video 的 Python ComfyKit 抽象。
- BGM 混音：需要支持循环、音量、淡入淡出，并明确与旁白音量的优先级。
- concat 策略：同编码片段可走快速拼接，不一致时走重编码 filter。

### 不建议直接搬

这些部分和当前项目边界不匹配：

- 不建议直接引入 Pixelle-Video 的 Python pipeline 作为主流程，否则会和现有 Electron runner、数据库、IPC、任务事件重复。
- 不建议直接采用 ComfyKit/RunningHub workflow 文件结构作为唯一媒体后端；当前项目已经有 provider profile，需要保持可插拔。
- 不建议用 Pixelle-Video 的 HTML 模板系统替换当前 DraftTemplate。更合适的是在后续 MP4 导出中增加一个 renderer adapter，把现有 DraftTemplate 转成可截图画面。
- 不建议把剪映草稿导出降级为附属功能。剪映草稿仍是可编辑交付物，MP4 是快速预览和直接发布产物。

## 推荐后续路线

### 阶段 1：本地 MP4 合成导出

目标：在现有剪映草稿之外，增加一个可选最终 MP4。

建议实现范围：

- 新增视频合成服务，优先通过 Node `child_process` 调用系统 ffmpeg，或后续评估 `ffmpeg-static`。
- 对每个 scene 使用现有图片和 TTS 音频生成 segment MP4。
- 用实际音频时长更新本次导出的字幕 timing，不直接覆盖原始文案分镜。
- 拼接 segment，按模板音量混入 BGM。
- 将最终 MP4 写入 task workDir，并记录到 artifact preview。

这个阶段可以不支持视频素材，只支持现有图片素材，风险最低。

### 阶段 2：HTML/Canvas 模板渲染

目标：让 MP4 导出画面接近剪映草稿模板，而不是仅仅静态图铺满。

建议实现范围：

- 建立 `DraftTemplate -> frame render model` 的适配层。
- 用 Playwright 或 Electron 渲染固定尺寸 frame。
- 先支持背景、主图区域、标题、字幕、免责声明和基础字体颜色。
- 每个 scene 输出一张 composited PNG，再交给视频合成服务。

这个阶段可以明显提升 MP4 质量，但需要较多视觉验证。

### 阶段 3：视频素材生成

目标：把单 scene 素材从“图片”扩展为“图片或视频”。

建议实现范围：

- 扩展 `SceneAsset` 为包含 `mediaType`、`durationMs`、`path` 的结构。
- 新增 `generateMedia` provider 接口，兼容图片和视频。
- 视频素材优先使用 TTS 音频时长作为目标时长。
- 对视频素材走 overlay + audio replace，对图片素材走 image + audio segment。

这一阶段依赖阶段 1 的视频合成服务，建议不要先做。

## 风险与注意事项

- ffmpeg 是最大外部依赖。Windows 用户需要明确安装路径、错误提示和打包策略。
- 字体和中文渲染会影响模板截图质量，需要固定字体回退链。
- 使用 TTS 实际时长后，字幕 timing 会更准，但可能和原始 `scene.durationMs` 不一致，需要避免破坏现有剪映导出。
- 视频合成会产生较大的中间文件，需要清理策略和失败恢复策略。
- Pixelle-Video 使用 Apache-2.0 许可。后续可以借鉴设计思想，但复制代码前需要保留许可声明并评估是否真的必要。

## 最小可落地设计建议

如果下一步进入实现，建议只做一个窄切：

1. 新增 MP4 导出为 Step 7，Step 6 剪映草稿保持不变。
2. 首版仅支持图片 + TTS + 字幕 + BGM。
3. 使用实际音频 duration 生成导出专用 subtitle track。
4. 每个 scene 生成一个 segment MP4，全部成功后再 concat。
5. UI 只展示最终 MP4 路径和打开位置，不增加复杂编辑器。

这样可以最大化复用现有素材管线，同时把 Pixelle-Video 最有价值的“最终视频合成链”引入当前项目。
