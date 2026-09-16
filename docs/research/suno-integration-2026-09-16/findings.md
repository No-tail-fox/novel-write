# 调研证据

- 用户提供网站：https://www.suno-api.io/create/。
- 本项目已有 `src/features/music-mv/MusicMvPage.tsx`，正在并行检查其生成 / 素材结构。
- 密钥已仅写入 Windows 用户环境变量 `SUNO_API_KEY`，不写入项目文件。
- 官网 2026-09-15 更新的首页明确自称第三方服务，与 Suno 官方无隶属关系。
- Docsify 文档入口公开列出 40 个 Markdown 文件，含生成、歌词工程、克隆、编辑、分轨、授权等。正读取源文档。
- 首页标价 ¥0.60 / 次，每次两首，网页和 API 共用 Key / 余额；最终以具体接口计费为准。
- Jina Reader 返回匿名 IP reputation 401；已改用公开官网源文档，内容可直接读取。
- 免费实测：GET /api/user/balance 成功，effective_amount=30 yuan，账号和 token 状态均为 1；GET /v1/models 返回 suno-v6 / suno-v6-mini / suno-v6-wild，以及两个内部路由名。未实测生成质量与扣费。
- 下载了 40 个目录文档，并从总览发现 5 个额外当前文档。PowerShell 将 application/octet-stream 的字节数组隐式转为空格分隔数字；已还原原始 UTF-8 字节，无需重复网络请求。
- 当前推荐协议为 /api/music/*，非 OpenAI 音频接口；异步轮询支持真实 song_id，pending: 占位 ID 不可直接用于 query。
- song_ids 以逗号分隔字符串为推荐格式；歌词 timeline 返回逐词 start_s/end_s 数组。
- 项目分析：现有音乐 MV 是导入主歌曲后做视频；可新增 music-lab，复用受管 BGM 导入和音乐轨道，需专用生成任务及音乐资产记录。
- 免费授权资格实测：累计充值 30 元，个人当前门槛 200 元、企业 500 元，均未满足，身份未绑定。未发起身份绑定或证书签发。
- 公开手动克隆与网页 20 元自动克隆不同；后者依赖 Create UI 登录态。已在长期价格与参考记录中说明。
- 当前总览共 61 行能力目录（存在同路径不同 kind 和一行两路径），另补 GET /v1/models；不把行数当不重复端点数。
