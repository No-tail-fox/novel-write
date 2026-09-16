# 全部模型 API 多配置设置

用户要求：音乐创作 API 在系统设置中配置，可同时保存多个模型方案并选择启用项；随后明确全部模型配置均采用相同行为。

覆盖七类模型：LLM、绘图、视频、音乐、TTS、语音转文字、视觉分析。每类独立保存多套配置及启用项。现有单配置和已加密凭据自动迁移；本地 Whisper 备用引擎保留原有配置方式。

## 共同合同

AppConfig.music = { enabled: boolean; activeProfileId: string; profiles: MusicProviderProfile[] }。
MusicProviderProfile = { id: string; name: string; provider: 'suno-api'; baseUrl: string; apiKey: string; model: MusicModel; useEnvironmentKey: boolean }。
默认 id 为 default-music，站点为 https://www.suno-api.io，模型 suno-v6，useEnvironmentKey 为 true，沿用已登记的 Windows SUNO_API_KEY。新配置 useEnvironmentKey 默认 false。
密钥槽为 music/<encoded-profile-id>/apiKey。公开配置不含明文密钥。

每种能力独立保存多套配置。编辑/保存选中项不切换运行配置，点击「启用」才切换。测试可测选中项但不改变启用项。
音乐目前支持 Suno-API 兼容协议，不暗示任意音乐供应商的协议均兼容。地址为 HTTPS 站点根地址；用户环境密钥仅允许用于默认 Suno 官方登记站点，不发送到新填写的域名。

运行时按音乐配置 id 和服务地址隔离实例和持久任务，旧 default-music 在原站点继续使用既有 music-lab/music-voices/music-enhanced 路径。其它配置使用相应目录下 profiles/<SHA256(id + 换行 + origin)> 子目录。修改地址不会重定向已提交任务；切回原配置可读取其历史。源音频仍由原 dataDir/bgm 管理。

转写配置保存为 speechToTextProfiles / activeSpeechToTextProfileId，视觉配置保存为 viral.visionProfiles / activeVisionProfileId。运行时继续使用 speechToText / viral.vision 的当前启用项投影。独立密钥槽为 speechToText/<id>/apiKey 与 viralVision/<id>/apiKey。

## 工作分工

- config agent：types/defaults/normalize/secrets/profile utilities/validation + focused tests。
- UI agent：SettingsPage/settings-controls、新音乐与视频多配置界面及 save/activate 分离。
- runtime agent：provider 和三个音乐 runtime 支持 baseUrl/storageDirectory + isolation tests；不编辑 main。
- root：main 绑定当前配置、测试入口、MusicLabPage 展示启用项/默认模型与设置跳转，集成验证。

## 状态

- [完成] 七类模型配置、独立密钥与旧配置迁移
- [完成] 保存和测试与启用分离，新增/复制/删除配置，保护当前启用项
- [完成] 音乐运行时绑定、免费余额连接测试、创作页设置入口及默认模型
- [完成] 19 个测试文件共 291 项回归通过；补充验证全部七类 config:test IPC 目标
- [完成] 26 项浏览器检查通过，含七类保存/测试/启用、重载和双主题 1440/1040 布局
- [完成] 完整应用设置入口、默认模型同步、返回导航与草稿保留检查
- [完成] 生产构建通过

全项目类型检查仍受已有错误影响：browser-fallback 缺少 updateHtmlVideoSceneStructure / updateMusicMvTask，storage 测试缺少 updateMusicMvTask，main 的已有任务更新 ratio 类型不匹配。本次配置和音乐实现无新增类型错误。

截图与检查记录：docs/plans/music-lab-2026-09-16/model-settings-*；补充设置 QA 见 docs/plans/music-settings-2026-09-16/。

现有项目另有未提交改动，保留。验证不提交收费任务。
