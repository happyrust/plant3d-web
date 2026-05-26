# Verification: 校审批注截图关联

## Commands

| Command | Purpose | Expected pass condition | Evidence location |
| --- | --- | --- | --- |
| `npx vitest run src/composables/useScreenshot.test.ts` | 验证截图 composable、默认文件名、上传元数据、并发门禁和错误分支 | 全部通过；upload mock 收到正确 metadata | `progress.jsonl` |
| `npx vitest run src/components/tools/AnnotationPanel.test.ts` | 验证批注面板四类批注截图入口与替换逻辑 | 全部通过；不回归原有批注列表行为 | `progress.jsonl` |
| `npx vitest run src/components/review/AnnotationWorkspace.test.ts src/components/review/ReviewCommentsTimeline.test.ts` | 验证工作台详情和讨论时间线展示截图 | 全部通过；缩略图和预览弹层可断言 | `progress.jsonl` |
| `npx vitest run src/review/adapters/reviewRecordAdapter.test.ts src/review/adapters/toolStoreAdapter.test.ts src/review/adapters/workflowSyncAdapter.test.ts` | 验证截图字段随 snapshot/replay 保留 | 全部通过；screenshot payload 不丢失 | `progress.jsonl` |
| `npx vitest run src/components/review/ReviewPanel.test.ts src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/AnnotationTableView.test.ts src/components/review/reviewerWorkbenchViewModeBus.test.ts` | 仓库要求的 review 面板回归守护 | 不新增失败；记录 baseline vs after | `progress.jsonl` |
| `npm run type-check` | TypeScript 合约验证 | 无类型错误，尤其是 `CaptureOptions` 与 screenshot 字段 | `progress.jsonl` |
| `npm run lint` | ESLint 与导入顺序 | 无新增 lint 错误；若自动修复，记录变更 | `progress.jsonl` |

## Manual Checks

- 先查看 GPT Image 2 效果图：`goals/review-annotation-screenshots/assets/review-annotation-screenshot-capture-flow.png` 与 `goals/review-annotation-screenshots/assets/review-annotation-screenshot-timeline-detail.png`，确认实现覆盖相机入口、预览确认、保存后缩略图三种关键状态。
- 启动本地页面，进入一个校审任务，创建或选择 text 批注，点击“添加截图 · 记录当前视角”，确认预览显示的是当前三维视图。
- 在预览中点击取消，确认没有新增附件请求，也没有出现截图缩略图。
- 再次点击截图并保存，确认批注详情/讨论区出现缩略图，点击可查看大图。
- 对 cloud、rect、obb 至少各做一次截图保存；若 OBB 在 reviewer 路径隐藏，则在可访问 OBB 的调试/创建入口验证或记录不可验证原因。
- 刷新页面或重新打开同一个 form/task，确认截图仍显示在原批注上。
- 对已有截图执行重拍，确认旧图被替换，旧附件删除失败时有 warning 提示或日志。
- 若后端契约改动，检查 Network 中上传/patch 请求携带 taskId、formId、sourceAnnotationId、sourceAnnotationType、fileType。

## Evidence Rules

- Record verification results in `progress.jsonl`.
- Include command, status, timestamp, and artifact path when available.
- Do not rely on passing tests unless they cover the requirement being claimed.
- Manual evidence should include at least one screenshot or short recording path showing the saved annotation screenshot after refresh.
- Manual evidence should include a short note comparing the implemented UI to the GPT Image 2 effect images, focusing on interaction state rather than pixel-perfect matching.
- If a command cannot run because of environment constraints, record the exact failure and the unverified risk.
