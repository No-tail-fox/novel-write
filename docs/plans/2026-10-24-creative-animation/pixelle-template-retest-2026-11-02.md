# Pixelle 全模板本轮复测报告

日期：2026-11-02（Asia/Shanghai）。这是用户询问“pixel 哪些模板测试一下，跑得通吗”后的新一次实际执行，未复用前次 PASS 作为本轮结论。

## 结果

- 当前固定版本全部 31/31 模板实际运行通过：31 个 MP4 和 31 个剪映草稿。
- 124 处草稿媒体引用均存在、位于交付目录内；轨道引用可解析。
- 3 个视频/通用模板的实际运动帧检查通过；另有 3 个实际片段用例覆盖图片、视频定格补尾、通用素材黑帧补尾，以及失败时原产物保持不变。
- 相关 9 文件回归 205/205 通过。模板缓存与交付缓存重试均复用，无重复渲染。
- 全部 31 个原 HTML 哈希匹配固定上游版本。付费请求 0，未修改用户项目、上游模板或生产源码。

## 全部模板清单

| 画幅 | 类型 | 界面名称 | 模板文件 | MP4 / 草稿 |
| --- | --- | --- | --- | --- |
| 1080x1080 | 图片 | 极简边框 | 1080x1080/image_minimal_framed.html | 通过 / 通过 |
| 1080x1920 | 图片 / 视频 | 通用图像与视频 | 1080x1920/asset_default.html | 通过 / 通过 |
| 1080x1920 | 图片 | 模糊背景卡片 | 1080x1920/image_blur_card.html | 通过 / 通过 |
| 1080x1920 | 图片 | 书籍图文 | 1080x1920/image_book.html | 通过 / 通过 |
| 1080x1920 | 图片 | 卡通图文 | 1080x1920/image_cartoon.html | 通过 / 通过 |
| 1080x1920 | 图片 | 经典图文 | 1080x1920/image_default.html | 通过 / 通过 |
| 1080x1920 | 图片 | 雅致图文 | 1080x1920/image_elegant.html | 通过 / 通过 |
| 1080x1920 | 图片 | 文字摘录 | 1080x1920/image_excerpt.html | 通过 / 通过 |
| 1080x1920 | 图片 | 复古时尚 | 1080x1920/image_fashion_vintage.html | 通过 / 通过 |
| 1080x1920 | 图片 | 全幅图片 | 1080x1920/image_full.html | 通过 / 通过 |
| 1080x1920 | 图片 | 治愈图文 | 1080x1920/image_healing.html | 通过 / 通过 |
| 1080x1920 | 图片 | 养生知识 | 1080x1920/image_health_preservation.html | 通过 / 通过 |
| 1080x1920 | 图片 | 人生感悟 · 深色 | 1080x1920/image_life_insights.html | 通过 / 通过 |
| 1080x1920 | 图片 | 人生感悟 · 浅色 | 1080x1920/image_life_insights_light.html | 通过 / 通过 |
| 1080x1920 | 图片 | 长文图文 | 1080x1920/image_long_text.html | 通过 / 通过 |
| 1080x1920 | 图片 | 现代图文 | 1080x1920/image_modern.html | 通过 / 通过 |
| 1080x1920 | 图片 | 霓虹图文 | 1080x1920/image_neon.html | 通过 / 通过 |
| 1080x1920 | 图片 | 心理卡片 | 1080x1920/image_psychology_card.html | 通过 / 通过 |
| 1080x1920 | 图片 | 紫色图文 | 1080x1920/image_purple.html | 通过 / 通过 |
| 1080x1920 | 图片 | 讽刺漫画 | 1080x1920/image_satirical_cartoon.html | 通过 / 通过 |
| 1080x1920 | 图片 | 黑色极简 | 1080x1920/image_simple_black.html | 通过 / 通过 |
| 1080x1920 | 图片 | 简约线稿 | 1080x1920/image_simple_line_drawing.html | 通过 / 通过 |
| 1080x1920 | 静态排版 | 经典纯文字 | 1080x1920/static_default.html | 通过 / 通过 |
| 1080x1920 | 静态排版 | 纯文字摘录 | 1080x1920/static_excerpt.html | 通过 / 通过 |
| 1080x1920 | 视频 | 经典视频 | 1080x1920/video_default.html | 通过 / 通过 |
| 1080x1920 | 视频 | 治愈视频 | 1080x1920/video_healing.html | 通过 / 通过 |
| 1920x1080 | 图片 | 书籍图文 | 1920x1080/image_book.html | 通过 / 通过 |
| 1920x1080 | 图片 | 电影图文 | 1920x1080/image_film.html | 通过 / 通过 |
| 1920x1080 | 图片 | 全幅图片 | 1920x1080/image_full.html | 通过 / 通过 |
| 1920x1080 | 图片 | 超宽极简 | 1920x1080/image_ultrawide_minimal.html | 通过 / 通过 |
| 1920x1080 | 图片 | 暗色科技 | 1920x1080/image_wide_darktech.html | 通过 / 通过 |

## 检查了什么

每个模板使用当前产品的模板准备、真实 Electron/FFmpeg 渲染和草稿写出流程。检查尺寸、约 2.2 秒时长、非黑画面、有声输出、字幕模式及时间窗、视频自身音轨静音以防双重混音、生成缓存、交付重试缓存。另检查草稿素材引用与实际视频运动。

字幕矩阵按当前用例配置：图片/静态模板使用模板字幕，视频模板使用时间轴字幕，通用素材模板关闭字幕。全模板矩阵的短素材补齐使用定格；独立片段用例额外验证黑帧补尾。

## 覆盖边界

本轮采用本地工程测试图、0.5 秒运动色条和两段 1 秒 440 Hz 正弦音。实际产物可编码/解码且包含非静音音轨，不代表真人配音、TTS 听感或 AI 美术效果验收。测试未覆盖全部参数/字幕组合、通用素材的图片分支、复杂长文与长片，也未在剪映应用实际打开草稿。

## 预览与证据

三张联系表已目检，覆盖全部 31 个模板。视频字幕初看疑似重叠，经 SRT/HTML 核对为单条合并字幕，只有一个 caption 元素；未发现双层烧录。默认视频模板原品牌底栏与宿主字幕区域相交，已记录为非阻断排版观察，尚不属于完整美术排版验收。

![模板实测联系表 1](D:/opc/novel-write/.artifacts/pixelle-retest-20261102/run-1793596515734/matrix/contact-sheet-1.png)

![模板实测联系表 2](D:/opc/novel-write/.artifacts/pixelle-retest-20261102/run-1793596515734/matrix/contact-sheet-2.png)

![模板实测联系表 3](D:/opc/novel-write/.artifacts/pixelle-retest-20261102/run-1793596515734/matrix/contact-sheet-3.png)

本轮独立产物目录：D:/opc/novel-write/.artifacts/pixelle-retest-20261102/run-1793596515734

- matrix/report.json：每个模板的实际产物、尺寸、时长、音轨和缓存结果。
- matrix/delivery-verification.json：媒体引用、运动与联系表。
- clips/report.json：定格/黑帧补齐、实际帧数据和失败原子性。
- regression.json：本轮 205 项回归。
- verification.json：模板明细、源码/报告/MP4/草稿内容哈希。

原有 .artifacts/pixelle-validation-20261102 和此前两流程报告保持不变。本轮结论仅对应以上工程输入和默认模板配置。
