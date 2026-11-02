# 最新范围收尾与验收记录

日期：2026-11-02。分支：codex/storydream-project-plan-20261102-upload，基线 4582571。当前改动未提交或推送。

## 范围

- Lemo 创意动画只交付最终有声 MP4，不映射剪映，不新增 Lemo 草稿或双交付分支。
- 只维护官方 SDK v4 新生产链；旧项目迁移、旧 Agent 回退不在本次范围。
- 普通图文短片与 Pixelle 保留 MP4/剪映草稿双输出。
- 以下将代码实现、本机确定性验证、真实服务验证分别记录，不用其中一项代替另一项。

## 实现与本机验收

| 工作包 | 本次落地内容 | 验收与边界 |
| --- | --- | --- |
| B 渠道能力 | 按渠道、模型、配置指纹保存能力档案；最多六次的显式能力测试；工具往返、图像、SSE、本机取消、输出参数；配置变化、过期、unknown 阻断生产 | 固定回环服务测试通过；本地夹具不能解锁真实生产。max_tokens 被接受不代表完整长输出，取消也不保证远端不计费。 |
| C3 阶段与预算 | treatment、风格帧、声音/时序锁定、整片、修复、导出；请求/每阶段轮次/整片时限/保守估算费用/共享修复额度可见可配 | 同一运行共享账本、截止时间与预算；显式阶段不能重建丢失预算，零请求时删除预算同样阻断。SDK 续跑可能包含历史费用，因此每次真实调用保守累加，可能提前耗尽额度。 |
| C3 局部返工 | 选择镜头并填写修复要求；只允许目标模块变化，素材和其他文件冻结，目标须实际改变，其他镜头每镜三帧像素对照 | 最新实际 SDK 本机整链 18 次回环请求、零外部/付费请求，4.916 秒有声 MP4；8 项篡改/缺失回执检查通过。抽样画面对照不等于数学上逐帧不变。 |
| A 网络素材 | Pexels 配置/密钥托管、检索、导入、取消、出处与许可链接记录；并入原素材池和双输出 | HTTP 夹具实际下载、媒体探测、普通/Pixelle 双输出和数据库重开通过；素材 UI 12/12。未把记录许可链接说成已抓取并审阅许可正文。 |
| UI | 能力、预算、修复入口及命令清单；进度弹窗关闭后恢复主界面可访问性与焦点 | 新 Lemo Electron UI 21/21、8 张普通/紧凑深浅色截图；历史六项映射到当前四文件，34/34。旧失败日志缺失，映射依据历史记录与 Git 源码，不冒称重获原日志。 |
| Pixelle | 默认视频字幕避让原品牌栏；原图文固定文字框使用实际 DOM 边界缩放，过密时明确拒绝；宿主缓存版本升级 | 31 原模板及 6 个扩展场景 37/37 实际双输出、148 处草稿引用和 5 个运动场景通过；长文图文与底栏避让最终帧已目检。最终宽英文补修另有 37 项真实 DOM 边界检查（34 可排版、3 明确拒绝）和 3 组受影响双输出复验。固定上游文件未修改。 |
| E 发行 | 固定 Node/worker/SDK/CLI/插件，完整性清单、原子激活/回滚、安装态定位，禁用全局 Bash 自动发现；Python staging 校验后事务替换 | Node-only PATH 下真实 SDK probe/start/resume/cancel、包内 Python/Chromium/FFmpeg、未授权首次启动通过。正式版已生成：`.artifacts/StoryDream-1.0.3/StoryDream-Setup-1.0.3.exe`、对应 `.blockmap` 与 `StoryDream-Portable-1.0.3.zip`；便携 ZIP 通过 7-Zip CRC（29,269 文件）。未运行安装器，未宣称干净 Windows 或已授权生产验收；安装器/便携 EXE 未签名。 |

## 正式版产物校验

- 安装器 SHA-256：`1783A614C0BAFFB5C244AD3A00A6250674669099C0638234BFD9561B0388715E`。
- blockmap SHA-256：`6402C1A8DA4B5B3312F894340CC2A6FBE1CBEC9B27204E2BB75CD24DA19B2E5F`。
- 便携 ZIP SHA-256：`030F30B55D8DB4D732CD293BAFD8188CE9606966B72F170BB5DD40E83211D8F5`。
- 包内 Python v9、Lemo 官方 SDK/CLI/worker、首次未授权 license gate 与本机资源 smoke 证据位于 `.artifacts/StoryDream-1.0.3/`。
- 完整摘要：`.artifacts/StoryDream-1.0.3/formal-release-report.json`；Python、Lemo、更新元数据和发行物哈希均在其中。

## 真实服务与外部条件

- 当前保存配置经正常 ConfigService/CredentialVault 只读检查：文本模型为 OpenAI 协议，图像和火山 V3 配音凭据存在，未配置 Messages 模型或 Pexels Key。检查使用隔离数据库及 Local State，未修改用户配置，未输出密钥。
- 一次真实 gpt-image-2 图像请求返回 HTTP 403，未重试；因此真实图像与完整图文成片验收未通过。不能把本机色条/正弦波夹具当作真实作品。
- 独立一次真实火山 V3 配音请求返回 HTTP 200；MP3 完整解码，1.632 秒、24 kHz、单声道、非静音。该结果不代表整条生成链成功或完整成片听审。
- Lemo 真实供应商能力验证、15–30 秒原创片、长片/多风格艺术与完整听审仍依赖可用 Messages 配置；Pexels 真实服务验收依赖其 Key。已向用户发出配置询问，未擅自猜测模型或更换渠道。
- 普通/Pixelle 草稿已验证引用和时间轴，但剪映应用实际打开仍未验收。系统登记有剪映专业版，不将其简单记为未安装。
- 干净 Windows 真实安装/已授权生产工作区与隔离未授权首次启动分别记录；没有绕过授权、安装或发布。

## 环境事故与恢复

旧 Python 准备脚本先删除活动目录、后下载校验；遇 get-pip SHA 漂移时导致本轮运行时丢失。已向用户说明并恢复固定版本与浏览器，实际三模板渲染通过。新准备流程使用独占锁、同盘 staging、下载双 SHA/固定版本/浏览器截图验证，失败保留旧目录并回滚；11 项真实 PowerShell 文件系统测试通过。原 bootstrap 固定 SHA 未跳过，已从官方仓库定位到不可变提交 5e84c8360eaf92009551b3eec69d734137f31cec，下载文件与原 SHA256 a341e1a43e38001c551a1508a73ff23636a11970b61d901d9a1cad2a18f57055 一致，独立 Git blob SHA1 同样匹配；清洁准备验证单独记录。

## 全仓回归收尾

- 首次全仓串行回归：4,922 项中 4,843 通过、79 失败。原始 JSON 和日志完整保留，不以定向通过覆盖初次结果。
- 新 v4 多阶段入口替换旧单阶段生产后，断点恢复测试须在实际 authoring 阶段制造中断；unknown、过期 hash、不重复付费及阶段先后关系保持严格检查，退役入口明确断言拒绝且零派发。
- 静态 UI 契约追踪拆分后的真实组件、项目模型与分集来源；版本显示发现真实硬编码并修复为读取 package 版本。旧台词样本的闭引号分句变动在测试中以文本等价映射重放，产品不增加旧项目兼容。
- 分数帧合成与 HTML 色彩集成测试先前误用系统 Python/FFmpeg 7.0.2；绑定桌面实际内置 Python/FFmpeg 7.1 后，原有 PCM、帧数、PTS、颜色误差与失败保留输出断言全部通过（媒体与叙事 13/13）。未放宽时序或误差门槛。
- HTML 跨窗口异常包装曾重复 Error 前缀并将本地路径混入提示，已修复；详细诊断保存于 cause，原始用户消息及销毁窗口断言保留。HTML/字幕回归 86/86。
- 最终全仓回归：4,927/4,927 通过、0 失败、0 pending；四套 TypeScript 检查通过。发行包已完成并通过包内资源 smoke；未运行安装器。

## 证据索引

- 最新预算化分阶段 SDK/MP4：.artifacts/lemo-official-production-20261102/run-1793601853782/report.json
- 同轮预算/镜头隔离：同目录 execution-budget-evidence.json、local-repair-evidence.json
- 网络素材与 UI：.artifacts/stock-media-tests-20261102/acceptance-summary.md
- 真实图像请求：.artifacts/ordinary-live-output-20261102/report.json
- 独立真实配音：.artifacts/ordinary-live-tts-20261102/report.json
- 历史 UI 六项对照：.artifacts/remaining-work-20261102/historical-ui-mapping.json
- Pixelle 最终矩阵：.artifacts/pixelle-expanded-20261102/final/matrix/report.json
- Pixelle 宽英文/字体边界：.artifacts/pixelle-caption-layout-20261102/report.json
- get-pip 来源与原始哈希：.artifacts/get-pip-investigation-20261102/provenance.md
- 首次全仓串行回归：.artifacts/remaining-work-20261102/full-regression.json
- 媒体与叙事定向回归：.artifacts/remaining-work-20261102/media-regression-r1.json
- HTML 与字幕定向回归：.artifacts/remaining-work-20261102/html-caption-regression.json

最终全仓回归为 4,927/4,927，0 失败、0 跳过；正式发行物及 SHA-256 见“正式版产物校验”。真实服务、干净安装及作品质量仍按上文边界保留待验收。所有阶段数字独立记录，不累计为独立总数。
