# 进度

- 完成 UI 规范、路由、已有 Lab、API 接入点检查。
- 开始软件内音乐创作工作台；实际收费生成保留为用户点击行为，验证采用隔离 mock。

## 已完成

- 入口：素材库 → 音乐创作；使用现有 Fluent 组件、语义色彩及稳定的创作/曲库/详情布局。
- 简易描述、高级歌词创作、音色单次音效/循环采样；模型、纯音乐、Max、排除风格、演唱偏好、随机度、风格影响、多样性、目标时长提示。
- 歌词生成、结构插入、拼音辅助、风格润色；模式切换和纯音乐开关保留歌词草稿。
- 普通音频上传、强化上传及排队取消；人声源录音、验证文字、二次录音、可用性检查、指定人声歌曲生成。
- 16 类工具：翻唱、续写、局部重写、加伴奏、加人声、加乐器、融合、采样、灵感生成、保留片段、删段、淡化、倒放、变速、免费人声伴奏分离及收费分轨。
- 双候选与历史同步、搜索、分类、排序、收藏、参数复用；MP3/WAV/TXT/LRC/封面/MP4/MIDI 导出（MIDI 仅分轨）。
- 首次试听先保存受管音频，后续本地播放；上一首/下一首、进度、音量、加入 BGM、带标题歌词进入 MV。MV 由用户接受导入提案后替换现有草稿。
- 已知歌曲编号继续查询；提交结果不明进入待核对，不自动再次付费。强化上传 98% 且未返回正式音频时保持处理中。
- 账户、充值、授权书及网站专用 ¥20 自动克隆提供「服务与授权」入口；应用内接入公开 API 的手动录音验证流程。

## 验证

- 11 个测试文件、188 项通过：music-provider、music-lab-runtime、music-operations、music-source-tools、music-lab-ui、music-lab-ipc、music-mv-handoff、music-voice-enhanced、network-policy、provider-portals、ipc-inventory。
- 浏览器真实渲染及交互：29 项通过，详见 ui-qa-results.json。包含录音切换清理、失败下载、越界区间、实际 HTML 音频播放、BGM/MV 衔接以及双主题 1440/1040 宽度。
- 完整 App：素材库入口、深色桌面、浅色紧凑窗口检查通过。music-app-final.png 与 music-app-compact-light.png 为真实应用壳截图；其余带 QA 歌曲的截图为隔离测试数据。
- npm run build 通过；git diff --check 通过。
- npm run typecheck 未通过，均为既有问题：browser-fallback 缺少 updateHtmlVideoSceneStructure/updateMusicMvTask；storage 测试引用未实现的 updateMusicMvTask；Electron main 既有 task update 的 ratio 字段与存储类型不匹配。未扩大任务去修改这些功能。
- 全局命令清单/产品壳测试还存在既有 VOX、爆款、MV、HTML 断言不同步；本次音乐命令 owner 与导航断言已单独核验通过。

## 验证边界

- 没有提交真实收费音乐、人声生成或强化上传；音质、耗时、真实收费和供应商服务可用性仍以实际生成结果为准。
- API key 保留在 Windows 用户环境，仅 Electron 主进程读取；未写入项目、截图或前端。
- 普通整曲目标时长通过提示词引导，不能保证精确秒数；未将歌词 LRC 导出宣称为现有 MV 字幕管线的逐词自动对齐。
- 完整供应商 API 调研见 docs/research/suno-integration-2026-09-16。接口清单是研究范围，不能据此声称 61 个端点全部都有原生界面；云歌词项目、Free2、ZIP 打包等不在本次创作页面的原生接入范围。

临时可复现 UI 验证脚本：.tmp/music-lab-qa.mjs、.tmp/music-lab-qa.tsx、.tmp/music-lab-qa.html、.tmp/music-app-qa.mjs。隔离 mock 只在这些测试入口使用，不进入产品路由或构建。
