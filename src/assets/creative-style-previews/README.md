# 创意动画风格封面

59 张图均为 [LemoLab / Lemo Opuscar 官方风格库](https://lemomo-ai.github.io/lemo-opuscar/)中对应影片的静帧封面，作者 **LemoLab**，按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 使用。来源项目：[lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)。

变更：从官方 JPEG 等比例缩小至不超过 768 × 432，转换为 WebP；未裁剪、未修改画面内容。`manifest.json` 逐项记录来源、尺寸、文件大小及原图和本地图的 SHA-256。原始下载缓存位于 `.artifacts/creative-style-previews/originals/`。

这些资源仅用于风格选择的缩略图、悬停预览和样片播放前的封面，不作为用户制作素材或成片。封面可离线显示，官方影片按需在线播放。未打包影片、音频或原片配音。

重建（显式执行才联网；已有原图缓存优先复用，无付费 API 调用）：

```powershell
& I:/opc/vendor/python/python.exe I:/opc/scripts/build-creative-style-previews.py
```

普通构建直接打包这些 WebP，不需要联网。
