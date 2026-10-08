# VOX 图像风格参考图

这里保存应用随包携带的三张 AI 风格参考图。它们使用同一个“城市记忆与时间”的题材（自行车、街区、时钟、地图），便于比较风格差异。参考图用于选择风格时的预览，不是项目已经生成的素材，也不会被自动写入分镜。

| 文件 | 对应风格 |
| --- | --- |
| archival-red.webp | 档案红黑 |
| swiss-signal.webp | 瑞士信号 |
| museum-paper.webp | 博物馆纸本 |

原始图片和完整请求保存在 `.artifacts/vox-style-samples/<style-id>/original/`。同名 JSON 保存不含凭据的来源、实际尺寸和文件校验值。原图实际为 3840 × 2160；预览图在本地压缩为 768 × 432 WebP，悬停时只读取这些本地资源。

从现有原图重新压缩，不调用模型：

```powershell
pwsh -NoProfile -File scripts/build-vox-style-previews.ps1
```

需要重新生成时，在确认当时的渠道价格及费用授权后，传入 `-Generate` 和一个新的 `-ArtifactsDirectory`。脚本每种风格只请求一次 `gpt-image-2.5`，不自动重试，也不覆盖原有请求目录。凭据只由用户环境变量传给技能脚本，项目文件不保存凭据。
