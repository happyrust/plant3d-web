# RUS-239 驳回后重新流转验证说明

## 结论

RUS-239 已解决。设计人员在编校审单被驳回后处理批注，再次触发流转时，可以通过外部 PMS 事实源 `workflow/sync active` 回到校核节点。

## 关联问题

- Linear：`https://linear.app/rustdpc/issue/RUS-239/驳回的问题设计人员处理后无法用重新流转`
- 修复提交：`090eca4 fix(review): restore external reflow after return`
- 计划与执行记录：`docs/plans/2026-04-30-rus-239-reflow-after-return/`

## 根因

外部 PMS / 被动流程下，设计侧“流转回校对”和详情弹窗“再次提交”入口仍可能走旧 `/api/review/tasks/{id}/submit`。该路径不具备 PMS 外部流程的 `actor`、`next_step`、父窗口同步语义，导致退回到设计节点后的重新流转在真实嵌入上下文中表现为不可继续。

## 解决方案

- 新增 `src/components/review/workflowBridge.ts`，仅在外部被动流程且存在父窗口时发送 `plant3d.workflow_action`。
- `DesignerCommentHandlingPanel.vue` 的“流转回校对”在外部嵌入模式下改为触发 `active` 桥接。
- `TaskReviewDetail.vue` 的“再次提交”在外部嵌入模式下同样优先触发 `active` 桥接。
- 非嵌入 / 内部平台路径继续保留旧提交逻辑，避免影响本地任务流转。
- 仿 PMS runner 在发起单据后关闭额外独立 `3d-view` 页面，降低完整场景后端读负载。

## 验证命令

```bash
PMS_TARGET_BRAN_REFNO=24381_145018 \
PMS_SIMULATOR_CASE=bran-mixed \
PMS_SIMULATOR_TRACE=1 \
PMS_SIMULATOR_OUTPUT=artifacts/rus-239-bran-mixed-report.json \
npm run test:pms:simulator
```

## 验证结果

- 平台 API 契约烟测通过：`7/7`
- 仿 PMS `bran-mixed` 通过：`ok=true`
- 关键链路完整执行：`SJ active -> JH return -> SJ active -> JH agree -> SH agree -> PZ agree`
- 最终状态：`finalStatus=approved`
- 最终节点：`finalNode=pz`
- 指定 BRAN 覆盖：`24381_145018`
- 关键重新流转断言：
  - `bran-mixed-sj-reactive-sync`：通过
  - `bran-mixed-sj-reactive-backend-current-node`：通过，后端回到 `current_node=jd / status=submitted`
  - `bran-mixed-console-no-review-errors`：通过，校审相关控制台错误数为 `0`

## 截图

- 仿 PMS 入口与当前列表：`docs/verification/images/rus-239-reflow-after-return/01-simulator-entry.png`
- RUS-239 验收证据页：`docs/verification/images/rus-239-reflow-after-return/02-rus-239-evidence-summary.png`

![仿 PMS 入口与当前列表](./images/rus-239-reflow-after-return/01-simulator-entry.png)

![RUS-239 验收证据页](./images/rus-239-reflow-after-return/02-rus-239-evidence-summary.png)

## Issue 评论建议

RUS-239 已修复并验证。根因是外部 PMS / 被动流程下设计侧重新流转入口仍可能走旧内部提交路径，修复后外部嵌入场景统一通过父窗口桥接触发 `workflow/sync active`，内部独立场景继续保留旧提交路径。已使用 BRAN `24381_145018` 跑通仿 PMS `bran-mixed`，覆盖 `SJ active -> JH return -> SJ active -> JH agree -> SH agree -> PZ agree`，最终 `approved / pz`，关键断言 `bran-mixed-sj-reactive-sync`、`bran-mixed-sj-reactive-backend-current-node`、`bran-mixed-console-no-review-errors` 均通过。截图见本验证文档。

## Linear 更新状态

已使用 Cursor Browser 打开 RUS-239，但当前浏览器会话停留在 Linear 登录页；本地环境也没有 `LINEAR_API_KEY` 或 Linear CLI，因此暂未能直接写入 Issue。登录或提供可用 Linear API 凭据后，可直接复制上方“Issue 评论建议”发布。
