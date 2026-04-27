# 批注截图增强下一步详细方案

> 日期：2026-04-27
> 状态：待确认
> 背景：批注截图增强核心开发已完成，但当前工作树存在大量本轮之前的未提交改动，提交和推送前需要先明确范围。

## 1. 当前完成情况

已完成核心功能：

- `screenshot` 成为批注截图主数据路径，并兼容 cloud 旧字段 `thumbnailUrl` / `attachmentId`。
- 截图上传支持 `sourceAnnotationId`、`description`、`annotation_screenshot` 类型元数据。
- 工作区、表格、时间线支持截图缩略图和大图预览。
- 错误类型统一为“原则错误 / 一般错误 / 图面错误”。
- 删除批注和重拍截图时异步清理旧附件。
- 云线批注截图上传显示进度，重拍前有确认提示。

已通过验证：

- `npm test -- src/components/review/annotationTableSorting.test.ts src/components/review/AnnotationTableView.test.ts src/components/review/annotationWorkspaceModel.test.ts src/composables/useToolStore.screenshot.test.ts src/composables/useScreenshot.test.ts`
- `npm run type-check`
- `ReadLints` 检查相关修改文件无诊断错误。

## 2. 提交前阻塞点

当前仓库不是干净工作树，存在大量本轮前已有改动：

- 多个 `.cursor/`、`.planning/`、`llmdoc/` 文件处于删除状态。
- `.tmp/`、`wiki/`、验证截图、临时脚本等大量未跟踪文件存在。
- 本次修改涉及的部分文件在本轮开始前已经有旧改动，同文件内难以用普通 `git add <path>` 精确拆分。

因此不建议直接 `git add .` 或提交全仓变更。

## 3. 推荐提交策略

### 方案 A：本次功能完整文件提交（推荐）

只暂存本次截图增强涉及的文件完整变更，不纳入 `.tmp/`、wiki、`.cursor/` 删除等无关内容。

优点：

- 操作风险可控。
- 能快速形成可推送 commit。
- 不会把明显临时文件和大量删除带进提交。

风险：

- 若这些文件在本轮前已有旧 hunks，会随完整文件一起进入提交。

适用条件：

- 用户接受同文件内旧 hunks 一并提交。
- 当前目标是快速推送截图增强功能分支。

### 方案 B：先拆分工作树再提交

把本轮前已有改动挪到单独提交或临时保留，再提交截图增强。

优点：

- 提交历史最干净。
- PR 审查范围最准确。

风险：

- 当前缺少本轮前 diff 快照，手工拆 hunk 成本较高。
- 若误拆，可能破坏用户已有未提交工作。

适用条件：

- 需要严格审查粒度。
- 用户愿意先处理当前脏工作树。

### 方案 C：全仓提交

提交当前仓库所有变更。

不推荐，原因：

- 会包含大量删除、临时文件、wiki、截图和不相关文档。
- PR 噪音极大，回滚风险高。

## 4. 建议纳入方案 A 的文件

功能与 API：

- `src/api/reviewApi.ts`
- `src/composables/useScreenshot.ts`
- `src/composables/useToolStore.ts`
- `src/components/tools/AnnotationPanel.vue`
- `src/components/review/annotationWorkspaceModel.ts`
- `src/components/review/annotationTableSorting.ts`
- `src/components/review/annotationTableExport.ts`
- `src/components/review/AnnotationTableView.vue`
- `src/components/review/AnnotationWorkspace.vue`
- `src/components/review/ReviewCommentsTimeline.vue`

测试：

- `src/composables/useScreenshot.test.ts`
- `src/composables/useToolStore.screenshot.test.ts`
- `src/components/review/annotationWorkspaceModel.test.ts`
- `src/components/review/annotationTableSorting.test.ts`
- `src/components/review/AnnotationTableView.test.ts`

文档：

- `docs/CHANGELOG.zh-CN.md`
- `docs/plans/2026-04-27-annotation-screenshot-enhancement-plan.md`
- `docs/plans/2026-04-27-annotation-screenshot-next-steps-plan.md`

## 5. 推送前验证计划

最低验证：

1. 目标测试：
   `npm test -- src/components/review/annotationTableSorting.test.ts src/components/review/AnnotationTableView.test.ts src/components/review/annotationWorkspaceModel.test.ts src/composables/useToolStore.screenshot.test.ts src/composables/useScreenshot.test.ts`
2. 类型检查：
   `npm run type-check`
3. 检查暂存内容：
   `git diff --cached --stat`
   `git diff --cached --name-only`

可选验证：

- `npm run lint`
- 全量 `npm test`
- 手工进入三维校审页面，验证截图添加、重拍、删除批注、表格/工作区/时间线展示。

## 6. Commit 与 Push 计划

建议 commit message：

```text
feat(review): 增强批注截图数据与展示链路
```

提交步骤：

1. 用户确认提交范围采用方案 A。
2. 使用显式路径暂存文件，避免 `git add .`。
3. 提交前检查 staged diff。
4. 创建 commit。
5. 推送当前分支到 origin。
6. 返回 commit hash 和远端分支信息。

## 7. 后续联调建议

1. 确认后端附件上传是否接受 `sourceAnnotationId` 字段。
2. 确认附件 DELETE 对重复删除、已不存在附件的返回口径。
3. 在 PMS 嵌入流程中验证截图 URL 是否能跨角色正常访问。
4. 若需要离线兜底，单独设计 localStorage/IndexedDB 缓存方案，不混入本轮功能提交。
