# RUS-239 Linear 评论草稿

RUS-239 已修复并验证。

根因是外部 PMS / 被动流程下，设计侧“流转回校对”和详情弹窗“再次提交”入口仍可能走旧内部提交路径 `/api/review/tasks/{id}/submit`。修复后，外部嵌入场景统一通过父窗口桥接触发 `plant3d.workflow_action active`，由 PMS 事实源 `workflow/sync active` 推进；非嵌入 / 内部平台路径继续保留旧提交逻辑，避免影响本地任务流转。

验证结果：

- 修复提交：`090eca4 fix(review): restore external reflow after return`
- 验证 BRAN：`24381_145018`
- 验证命令：`PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=bran-mixed PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-239-bran-mixed-report.json npm run test:pms:simulator`
- 平台 API 契约烟测：`7/7` 通过
- 仿 PMS `bran-mixed`：`ok=true`
- 完整链路：`SJ active -> JH return -> SJ active -> JH agree -> SH agree -> PZ agree`
- 最终结果：`approved / pz`
- 关键断言：`bran-mixed-sj-reactive-sync`、`bran-mixed-sj-reactive-backend-current-node`、`bran-mixed-console-no-review-errors` 均通过

截图说明：

- 仿 PMS 入口与当前列表：`docs/verification/images/rus-239-reflow-after-return/01-simulator-entry.png`
- RUS-239 验收证据页：`docs/verification/images/rus-239-reflow-after-return/02-rus-239-evidence-summary.png`

补充：已使用 Cursor Browser 打开 RUS-239，但当前浏览器会话停留在 Linear 登录页；本地没有 `LINEAR_API_KEY` 或 Linear CLI，所以暂未能由自动化直接写入 Issue。登录 Linear 后可直接复制本评论发布。
