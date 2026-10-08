# 绘画模板样张

这组样张对应 `src/shared/config.ts` 中的 14 个内置绘画模板。每张都使用模板实际的 `prefix`、`suffix`、`negativePrompt` 和 `allowColor`，并以同一幅「临河书店中的装订师与茶具」作为画面主题，方便比较风格。

- 生成渠道：VllmProxy；请求模型：`gpt-image-2.5`。
- 原图请求及实际核验尺寸：3840 × 2160；`high` 质量。
- 程序内资源：768 × 432 WebP；悬停预览不发起生图请求。
- `manifest.json` 保存样张对应的模板定义、完整提示词、原图和预览图 SHA-256 及尺寸。修改过的模板不能继续冒用原模板样张。
- 原始图片、请求及生成元数据保存在 `.artifacts/image-style-samples/`，不写入 API 凭据。

重建压缩资源（不调用模型）：

```powershell
pwsh -NoProfile -File scripts/build-image-style-previews.ps1
```

只有显式添加 `-Generate` 才会提交缺少原图的模型请求；并发最多 3 个。已有成功原图会被复用。已有失败或不完整请求的目录会阻止自动重试，避免重复付费。模板定义改变时，旧原图也不能冒充新定义的样张。

图片是风格参考，不保证其他题材每次都得到完全相同的效果。尺寸核验只能证明收到的图像尺寸，不能独立验证供应商的上游模型身份或是否曾在服务端放大。
