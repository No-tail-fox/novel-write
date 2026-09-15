# VOX 动画缺失：本地诊断与 GitHub skill 对照

调研日期：2026-09-14。范围：只读检查 StoryDream 当前实现、最新 VOX 项目数据与渲染产物，读取 GitHub 公开仓库的 skill 和源码。本轮未修改生成实现，未运行付费生成或重新渲染用户项目。

## 结论

当前默认流程会退化为每镜头一张扁平图片加缓慢推进。它能生成 MP4，但没有兑现规划中的主体切片、标签等独立动画。用户觉得像图片轮播有实际依据。

Vox 风格没有唯一技术实现；核对的开源项目主要采用两条路线：独立图层的程序动画，以及关键帧图生视频。镜头内的揭示、对比、组装、运动和旁白配合，才是这些项目着重实现的内容。

## 本地实际项目证据

数据库中最新的真实 VOX 成片为《撒日朗》，项目 ID 为 ed32643f-e9bb-496b-b8eb-f3824da5ecda，2026-09-14 00:06 创建、00:11 完成。未确认这就是用户当前屏幕中的项目。

- 总时长 34.253 秒，16:9，共 4 镜头，时长分别为 9.364、7.513、7.350、10.026 秒。
- 所有镜头使用 deterministic-layers，每镜头只有 1 张图片绑定到 background；subject 和 label 没有 assetVersionId。
- 任务历史为 4 次文生图、4 次 TTS、1 次本地渲染，没有 image-to-video 任务。
- 背景 scale 从 1 变为 1.04，相机 zoom 从 1 变为 1.06。画面并非逐帧完全静止，但主要是整图推进。
- 实际导出 MP4 存在，大小 7,001,385 字节。

实际 [scene-001.html](/C:/Users/foxnotail/AppData/Roaming/storydream/storydream/tasks/fd04965e6bc29ce9707664e5bc7e5c83c24337d779017252/director-renders/54c51d05-12f5-41ad-98d6-8654ab535223/html-scenes/scene-001.html:29) 只有一个 scene-layer 图片；第 38、39 行分别为上述单层与相机关键帧。

## 代码因果链

| 环节 | 现状 | 证据 |
|---|---|---|
| 分镜初始化 | 创建背景、主体、标签 3 层，但默认都为无资产的 SVG 占位；默认本地关键帧策略 | [editorial-collage.ts](/I:/opc/src/shared/editorial-collage.ts:473) |
| 镜头生图 | generateShot 调用一次 generateImageLab | [EditorialCollagePage.tsx](/I:/opc/src/features/editorial-collage/EditorialCollagePage.tsx:694) |
| 绑定结果 | 一张生成图只绑定第一个 generated-image 或视觉层；默认是 background | [director-generation.ts](/I:/opc/src/features/director-desk/director-generation.ts:472) |
| 构造渲染场景 | source 为 svg 且没有资产的层被直接跳过；只要剩下一层仍可继续 | [director-render.ts](/I:/opc/src/shared/director-render.ts:567) |
| 实际捕帧 | 按帧 seek、capturePage、编码；已有时间轴驱动能力 | [html-video-renderer.ts](/I:/opc/electron/html-video-renderer.ts:114) |
| AI 视频分支 | living-poster 已实现独立视频生成入口，并要求成功的 image-to-video 任务和视频资产 | [EditorialCollagePage.tsx](/I:/opc/src/features/editorial-collage/EditorialCollagePage.tsx:826)、[director-render.ts](/I:/opc/src/shared/director-render.ts:536) |
| 混合分支 | hybrid 尚未完成，当前导出会明确报错 | [director-render.ts](/I:/opc/src/shared/director-render.ts:531) |

因此，主要问题是素材生成、逐层绑定与镜头动作设计不足。仅增大缩放幅度或在图片提示词里加入“动态”无法让扁平图片中的对象独立运动。也不能据此把问题归因于 MP4 编码器或捕帧没有推进。

## GitHub 一手来源

### liangdabiao/paper-cutout-remotion

- [SKILL.md](https://github.com/liangdabiao/paper-cutout-remotion/blob/HEAD/SKILL.md)
- [cutout.tsx](https://github.com/liangdabiao/paper-cutout-remotion/blob/HEAD/templates/remotion-project/src/cutout.tsx)
- [layering.md](https://github.com/liangdabiao/paper-cutout-remotion/blob/HEAD/references/layering.md)

流程：先确定镜头构图，再分别生成无人背景和角色素材，抠出独立透明 PNG，用 Remotion 的 PaperActor、PaperLayer、BackgroundPan 编排。PaperActor 根据帧数计算位移、缩放、透明度和轻微浮动，主次角色用不同 delay、幅度和层级错峰出现。背景只做辅助慢推。

可借鉴：素材必须按独立运动对象制作；不能先把人物画死在背景里。此仓文档含旧 zIndex 示例与后续修正，应使用最终“前景高于主体”的定义，不宜整段直接复制。

### Phantomlau3674/voxstylehub-steven

- [SKILL.md](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/SKILL.md)
- [PaperActor.tsx](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/PaperActor.tsx)
- [DrawnArrow.tsx](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/xingchen-vox-collage/assets/remotion-template/vox-collage/DrawnArrow.tsx)
- [UPSTREAM.md](https://github.com/Phantomlau3674/voxstylehub-steven/blob/HEAD/UPSTREAM.md)

默认 editorial-explainer 采用独立素材和确定性 Remotion 动画；精确文字、数字、图表、地图和证据标注由代码控制。DrawnArrow 使用 spring 和 strokeDashoffset 逐步画出线条。图生视频主要用于不依赖精确布局、文字、身份和数量的比喻镜头。

明确的验收边界：不能把扁平海报说成独立对象动画；不能把纯缩放说成镜头编排；不能只有字幕在变化。要求可播放短片及入场、稳定、离场等检查点，单张截图不够。

该仓是 xingchen-skill-family 的发行层，UPSTREAM.md 标明 v2026.07.22 导出来源；不应把它当成完全独立的一套原创上游重复计数。

### Alisa0808/vox-director

- [仓库](https://github.com/Alisa0808/vox-director)
- [clips.py：镜头动画提交与下载](https://github.com/Alisa0808/vox-director/blob/main/scripts/clips.py#L139)
- [clips.py：运镜与元素动作分开描述](https://github.com/Alisa0808/vox-director/blob/main/scripts/clips.py#L58)
- [SKILL.md：镜头节奏](https://github.com/Alisa0808/vox-director/blob/main/SKILL.md#L130)
- [local-engine.md：本地分层路线](https://github.com/Alisa0808/vox-director/blob/main/references/local-engine.md#L14)

已核对其默认流水线具有独立 image-to-video 阶段。clips.py 分别处理 camera_move 和 element_motion，调用 prov.submit_video，保存每镜头 clip_*.mp4，再做组装。不能将关键帧图片直接视为完成的动画。

该仓建议通常 3–6 秒一镜，把 8–10 秒旁白拆为广角和细节两镜；这是该项目的节奏建议，不是 Vox 的普遍硬性标准。

限定：仓库还提供 kenburns.py 本地降级路线，因此不能说它完全禁止单图推进。应区分默认生成动画与降级效果。其 [motion.py](https://github.com/Alisa0808/vox-director/blob/main/scripts/motion.py#L152) 仍有 Ronaldo 示例的硬编码名称、坐标和时刻，本地分层路线不能当成已验证的任意主题全自动编舞模块。部分文档对运镜和多元素动作的要求也存在新旧不一致，宜借鉴关键环节而非整份照搬。

### CK42BB/vox-explainer-skill

- [仓库](https://github.com/CK42BB/vox-explainer-skill)
- [SKILL.md：逐关键帧生成动画](https://github.com/CK42BB/vox-explainer-skill/blob/main/SKILL.md#L107)

已核对其默认工作流覆盖脚本、关键帧、image-to-video、旁白、音乐和本地装配。先生成旁白并测时长，再制作关键帧和视频；运动提示词包括层间视差、纸片滑入、云烟横移等，要求任务完成后下载 MP4，并检查文字变形和画风破坏。短片长度对齐允许尾帧延长，不代表所有镜头都以静态图片替代动画。

以上依据 skill 和实现源码，未调用这些仓库的付费模型复现宣传样片，不据仓库描述承诺实际出片质量。

## 针对 StoryDream 的修复建议

1. **给每个镜头明确动作。** 在分镜里定义主体、变化过程、触发旁白和完成状态，例如对象依次进入、箭头追踪、数据增长或前后对比；避免所有镜头只有同一缓慢推进。
2. **补全独立图层生产。** 为背景、主体、道具逐层生成或引用资产，处理透明边缘并逐层绑定。中文标签、数字、图表和线条直接渲染为代码图元；需要的图层缺失时不能静默跳过并算作完成。
3. **按镜头使用已有图生视频分支。** 对适合对象连续动作的镜头，执行关键帧 → 运动提示词 → 视频任务 → 视频资产 → 时长适配 → 合成。精确信息类镜头优先本地图层，避免被视频模型改写文字和数字。
4. **把可播放样片纳入验收。** 首先用一个主体动作明显、旁白可对齐的短镜头证明链路；核查进入、变化、落定三个时间点。缺视频、缺主体素材、只有相机缩放或字幕变化时，不能宣称已完成预定拼贴动画。
5. **现有渲染器可先保留。** 它已有逐帧驱动，不必为了用开源 skill 立即迁移到 Remotion。先补齐素材契约和动画语义；若需要大量地图、动态图表、遮罩与纸片组件，再评估引入 Remotion。

最值得组合借鉴的是 paper-cutout-remotion 的逐层素材生产、voxstylehub 的动画验收规则，以及 vox-director 的逐镜头图生视频编排。当前 UI 的“AI 动态海报”可以验证视频通路，但不能代替默认分层流程的修复。
