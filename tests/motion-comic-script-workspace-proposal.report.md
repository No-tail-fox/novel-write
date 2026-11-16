# 离线工作区提案集成验收

执行环境：Windows、已安装 Python313 的 Playwright、已安装 Chrome；Vite 将真实组件构建为静态离线页面。读取并遵守仓库 AGENTS。仅新增测试文件，未修改生产 UI 或后端。

## 边界

真实加载 `MotionComicScriptWorkspace`、其内部 `ScriptEditor`、`MotionComicScriptReview`、`MotionComicScriptProposal`、`useWorkspaceDraft` 和 `WorkspaceNavigationProvider`。不是独立提案组件回调测试。

`StoryDreamApi.getMotionComicScripts/proposeMotionComicScriptChange/adoptMotionComicScriptChange/editMotionComicScript` 和 `withSavedProject` 是内存 mock。所有请求用生产 schema 解析；snapshot 本身在生产中是 interface，fixture 组合实际 task/candidate/approval/storyboard/original/proposal schema 对返回值逐项解析。采用复用生产 `applyMotionComicScriptProposal`，但内存 revision 更新不等价于真实数据库事务。

**不是 Electron IPC，不包含真实 store、后端 CAS、授权、账户或计费链路验证。** 没有引入 Electron、provider 或 LLM。浏览器只允许本次随机 loopback 端口的静态资源，其他请求全部阻断。`withSavedProject` 返回克隆的已保存项目，不模拟真实项目落盘。

## 覆盖

- 从第二集切到第一集，真实工作区传递正确 taskId、r3 与 saved-project timestamp。
- pending 期间按钮与 editor 锁定；返回 ready 候选后 current candidate 和 editor 不变。
- 修改真实 editor 产生未保存草稿时，生成与采用均 disabled；撤销恢复资格，不触发 API。
- 采用 r3 → r4 回灌 editor、saved view、task revision 与 history baseline；保存按钮 disabled，撤销新改动回到 r4。
- 首次模型原稿 snapshot 深比较不变，原稿只读视图仍是原文。
- 延迟返回的旧 baseRevision ready 候选不可采用；轮询返回 stale 状态也不可采用。
- 请求期间切换 task、请求拒绝、再切回：任务级草稿保留，原任务持久化请求凭据保持锁定。
- dirty draft 保存 pending/拒绝时，editor 和 localStorage 均保留草稿。
- 采用拒绝时 current 保持 r3，原稿不变，不自动重试。

## 执行

```powershell
$env:PYTHONIOENCODING='utf-8'
& 'C:\Users\foxnotail\AppData\Local\Programs\Python\Python313\python.exe' tests/motion-comic-script-workspace-proposal.browser.py
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

报告与截图输出到 `artifacts/script-workspace-proposal-ui/`：`report.json`、`01-ready.png`、`02-adopted-r4.png`、`03-late-stale.png`、`04-rejected-draft.png`。截图使用真实组件 CSS 和 viewport flex host，没有强制 click 或产品 CSS 修改。内部滚动区域保持产品本来布局，因此截图不会展开所有滚动内容。

未发现本次覆盖路径中的生产功能缺陷。测试搭建中生产 schema 明确要求至少一个 sceneAsset；旧独立组件 fixture 使用空数组，新集成 fixture 已提供合法场景资产。它只说明旧 fixture 数据不够真实，不应据此推断生产 bug。
