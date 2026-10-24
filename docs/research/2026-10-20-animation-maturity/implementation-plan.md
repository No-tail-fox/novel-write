# 动画改进工程拆分

日期：2026-10-20，按顺序实施于 2026-10-21。原始拆分规格如下；实际完成项与未验收边界见[落地验收报告](./acceptance.md)，不应把本文件中的建议清单直接视为已全部完成。依据见 [README.md](./README.md)。

## A. HTML / Vox 共用素材去底

### 范围

- 复用 `src/shared/html-video-background-removal.ts` 与 `src/shared/remove-background-worker.py`，扩成可由两种任务调用的服务。
- 调整 `electron/main.ts` 的 editorial image-lab 链路：生图成功就保存原图，抠图作为独立可重试步骤；现有项目资产版本关系保持可追踪。
- `src/shared/editorial-cutout.ts` 的绿幕算法保留为适用素材的策略，不作为所有前景的唯一出口。

### 最小契约

输出原图路径/指纹、去底图路径、方法、模型与版本、alpha/边缘指标、质量状态及错误。先检查原生透明图，必要时用分割模型；只有已满足绿幕条件的图才用色键。模型缺失、运行失败、抠图不合格应分开报错。

首次使用需要定位或安装模型并校验完整性，验证 Python ONNX runtime。当前默认目录无可确认的模型，不能依赖“机器上大概已有”。不要在每次重试时重新下载，也不要因去底失败重新付费生图。

### 验收

用现有本地图片和明确选择的测试素材验证：原图始终保留；重试去底不触发提供商生图；失败可定位；检查头发/边缘、纸张内孔、绿衣主体和透明 PNG。最后用这些资产渲染一镜 Vox 与一镜 HTML。

## B. HTML composition v2

### 范围

主要位置：`src/shared/html-video-scene-templates.ts`、`src/shared/html-video.ts`、`src/shared/html-video-captions.ts`、`src/shared/html-video-workflow.ts`、`src/shared/html-video-runner.ts`、`src/shared/task-runtime-providers.ts`、`electron/html-video-runtime.ts`。

### 协议

1. 在模板结构中加入 portrait/landscape 布局：对象 x/y、尺寸、fit、anchor、z、标题和字幕安全区。不再通过素材数量推断完整构图。
2. 对象区分主体/辅助/背景/信息标注/装饰；支持 enter、hold/motion、exit、focus-group。保留现有 preset 作为底层动画词汇。
3. beat 包含语义用途、触发 cue、目标对象、动作和持续时间；标题及字幕可指定 hero/supporting 角色。
4. 字幕时间保留来源（TTS/ASR/estimated）、词时间与可信度。优先复用已获取的语音时间；回退均分时明确标记估算。ASR 对齐不能默默覆盖原文。
5. 新字段带 schema 版本与默认迁移；旧项目仍按原始参数重放，新编译参数进入缓存/渲染指纹。

### 首批实施

先改居中主体、左右构图、引语、对比、焦点转换六类，并完成双画幅。之后引入 HyperFrames 的 kinetic-type-beats、spatial-pan-stations、constellation-hub 三种蓝图。装饰少量使用，不能用持续漂浮掩盖内容没有推进。

维持当前 `window.__tl`、ready/seek、离线资源和逐帧渲染协议。对输出增加明确的预览/成片分辨率配置；实际高分辨率渲染需在固定素材上验证内存、清晰度、耗时和字号。

### 验收

至少 6 类真实素材场景的横竖屏成片/接触表；固定声音和素材，检查首帧、中段和尾部的叙事变化、字幕对声、遮挡、主次、素材边缘。结构测试关注迁移、cue fallback、画幅布局和任意时间 seek；不能只检查 HTML 字符串存在。

## C. Vox narration cue plan

### 范围

主要位置：`src/shared/editorial-motion.ts`、`src/shared/editorial-narration-timing.ts`、`src/shared/editorial-collage.ts`，以及现有图层/Remotion 渲染适配入口。

### 协议与行为

- cue 关联原始讲稿片段/稳定 token 区间与时间，不只存一个松散关键词；重复词需上下文和出现序号。
- beats 明确揭示、证据叠加、比较变化、路径推进、焦点切换；每一项知道目标图层或标注及起止状态。
- 使用已有有效词时间或 ASR；无法可靠匹配时用估算并标记，不做伪精确的逐词时间。
- 两条渲染策略共享 beat 数据，分别转成 deterministic layers 时间线或 Remotion props。模板选择需知道叙事用途、素材槽位是否填满、画幅是否支持。
- 外部开放组件保留来源/许可，禁止直接照搬演示音乐；VLM 不可用时报告未检查。

### 验收

先用现有真实素材做证据/比较/路径三镜，再组合 30–60 秒；能追溯每个语义动作对应哪段声音。检查是否只有入场、图文是否重复、关键名词出现时是否有视觉支撑。抠图、完整音频、黑帧和缺素材检查通过后，仍须观看成片。

## D. AI 漫剧参考、对白和制作单元

### 范围

主要位置：`src/shared/motion-comic-video.ts`、`src/shared/video-provider.ts`、`src/shared/video-models.ts`、`src/shared/video-routing.ts`、漫剧状态结构与 `electron/main.ts` 的提交/恢复路径。

### 先做的接线

- 从角色 look、场景、道具的已确认版本组装参考媒体，记录身份、用途、顺序和实际提交列表；通过现有 request reference 字段传入支持的模型。
- 根据当前模型能力和上限决定首帧/首尾帧/多参考等模式。模型不支持组合时给出可执行路径，不静默丢参考。
- 参考版本、顺序、音频模式、参考声音和制作单元边界进入 fingerprint；继续沿用现有过期标记、任务恢复与 remoteTaskId。
- 分开处理 image/reference upload、生成、轮询和下载的可重试阶段，避免恢复时重复计费。

### 随后的制作逻辑

- 以具体语音时长和模型离散时长拆制作单元，不统一固定每镜若干秒。
- 台词完整保留；分别记录角色对白、OS、VO、说话人和是否需要口型。
- 明确选择原生音画、音频驱动或静音视频后混音。只有实际能力和参考素材支持时才承诺口型/音色。
- 每单元记录前后状态、屏幕方向、角色/道具位置；质量检查从参考首帧到视频采样帧，再看跨镜连续性。

### 验收

同角色 3–5 镜、15–30 秒，包含不同景别、场景和一次对白；查看参考列表是否真实进入请求、声音是否完整、口型策略是否兑现、人物装束/脸/道具是否持续。此阶段才需要选择实际付费模型进行少量真实验证；本轮未发起调用，也没有把 API 价格或渠道可用性当作已核验结论。

## 交付原则

每包先产出真实可播放样片，再据样片调整协议和默认参数。记录未验证项；不将 mock、彩色方块夹具、文件生成成功或模板数量当作视觉质量结果。上一包解决的素材和时间信息应可复用，但保持任务数据迁移和旧项目重放可控。

## E. 最终 MP4 审片绑定（2026-10-21）

- [x] 导出报告记录最终文件 SHA-256；renderer 不能自报路径、摘要或确认时间。
- [x] 主进程以项目/报告/指纹/revision 重新定位唯一输出并流式计算摘要，缺失、变化、不可读及元数据歧义均导致确认撤销。
- [x] P0/P1 pending/failed 跨 severity 阻断导出/确认；waived 视为解决。旧 schema 可读但未绑定文件时不可认证。
- [x] VOX/漫剧页面接入核验与确认；焦点返回重新核验，未保存输入与并发保存受保护。
- [x] 服务/IPC/SQLite 重启回归和实际 Electron UI 深浅主题、两窗口尺寸检查通过。
- [ ] 后续生产使用中的真实成片人工审片仍需对照内容逐项完成；文件哈希只证明审查对象未变，不证明画面质量。
