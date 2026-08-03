# 剪映草稿兼容性修复计划

## 目标

修复普通任务和 HTML 视频导出生成的剪映草稿无法读取的问题，确保生产环境使用 `pyJianYingDraft` 生成真实工程结构，并重新生成用户当前失败的草稿进行验证。

## 阶段

- [complete] 1. 对比失败草稿、剪映回写结果与正常草稿，确认根因
- [complete] 2. 将普通任务与 HTML 视频生产链路接入真实草稿桥接
- [complete] 3. 补充生产接线和失败行为测试
- [complete] 4. 运行类型检查、构建与完整测试
- [complete] 5. 使用现有任务素材重建草稿并检查结构
- [complete] 6. 提交并推送远程仓库

## 验收标准

- 普通任务不再通过 Storybound sidecar 生成伪剪映 JSON
- HTML 视频选择草稿模板后也使用真实桥接
- 桥接依赖缺失时任务明确失败，不再误报草稿生成成功
- 重建草稿包含本地 `materials`、真实素材 ID、非零时长和有效轨道
- 类型检查和定向测试通过

## 错误记录

| 错误 | 次数 | 处理 |
|---|---:|---|
| Storybound sidecar 生成的最小 JSON 被剪映打开后重置为空时间线 | 1 | 切换生产链路到 `runPyJianYingDraftBridge` |
| 独立重建脚本未设置 Electron 应用根目录，误用系统 Python 并提示缺少 `pyJianYingDraft` | 1 | 重建时显式使用仓库内 `vendor/python/python.exe` |
