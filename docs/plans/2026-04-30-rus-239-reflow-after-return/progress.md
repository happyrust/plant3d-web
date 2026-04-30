# RUS-239 Progress

## 2026-04-30 · 初始化 planning-with-files

已完成：

- 创建 `task_plan.md`，按复现、超时诊断、业务语义核对、修复和验证拆分 RUS-239。
- 创建 `findings.md`，记录已确认事实、当前假设、风险和决策。
- 创建本文件作为持续执行日志。
- 创建 `rus-239-reflow-flow.html`，用自包含 HTML/SVG 表达 RUS-239 诊断和修复收口顺序。

当前状态：

- RUS-239 分析已从“泛读代码”收敛到两条主线：
  - 先定位 `annotation-states/apply` / task create 超时，恢复自动化反馈环。
  - 再判断设计侧重新流转是否应该从旧 `submitTaskToNextNode()` 切换到外部 `workflow/sync active`。

下一步：

- 继续最小 HTTP 复现，给任务创建和 annotation apply 增加明确超时边界与耗时记录。

## 2026-04-30 · 已知失败记录

`bran-mixed` 仿 PMS 失败：

```bash
PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=bran-mixed PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-239-bran-mixed-report.json npm run test:pms:simulator
```

结果：

- 自动化未进入“重新 active”阶段。
- 失败点：`POST http://127.0.0.1:3100/api/review/annotation-states/apply` 超时。
- 清理阶段也发生超时。

最小 HTTP 复现失败：

- `/api/auth/token` 返回 200。
- 后续 `/api/review/tasks` 创建任务阶段长时间无响应，进程已手动停止。

结论：

- 当前不能直接把 RUS-239 定性为 UI 按钮问题或业务门禁问题。
- 必须先把后端接口超时定位到具体 await 或数据库操作，否则主链验证无法闭环。

## 2026-04-30 · 最小 HTTP 链路复现

已完成：

- 执行最小 `active -> return -> active` 链路。
- 执行带批注状态的最小链路：`JH reject -> return sj -> SJ fixed -> active jd`。
- 使用 `bran-mixed` 失败留下的真实任务继续 API-only 链路。

结果：

- 最小任务创建：约 `110ms`。
- `workflow/sync active -> return -> active`：约 `100ms / 88ms / 76ms`，第二次 `active` 正常回到 `jd/submitted`。
- 最小批注状态链路：`annotation-states/apply` 约 `65-113ms`，可完成 `reject/fixed` 后重新 active。
- 完整 `bran-mixed` 失败任务 `FORM-70298B7939F9` / `task-6b6cc0a0-9648-4247-9696-84dc8974a174` 在 API-only 下可完成 `return -> SJ fixed -> active`，结果为 `currentNode=jd / taskStatus=submitted`。

补充观察：

- 完整 `bran-mixed` 失败后，`GET /api/review/tasks/{taskId}` 和 `/api/review/tasks` 曾短时超时。
- 后端监听进程更换后，同一任务详情恢复到约 `184ms`，列表恢复到约 `108ms`。

结论：

- RUS-239 的后端 `workflow/sync` 状态机与批注状态门禁在最小链路下允许“驳回后重新流转”。
- 当前剩余高风险点是外部 PMS UI 的“再次提交”入口仍可能走旧 `submitTaskToNextNode()`，以及完整仿 PMS 跑法触发的瞬态后端卡死。

## 2026-04-30 · 设计侧重新流转入口修复

已完成：

- 新增 `src/components/review/workflowBridge.ts`，统一判断“外部被动流程 + 父窗口可接收消息”后发送 `plant3d.workflow_action`。
- 更新 `DesignerCommentHandlingPanel.vue`：设计人员处理批注后点击“流转回校对”，外部嵌入模式下改为通知父窗口执行 `workflow/sync active`。
- 更新 `TaskReviewDetail.vue`：详情弹窗的“再次提交”同样优先走外部 `active` 桥接；非嵌入或内部模式继续使用 `submitTaskToNextNode()`。
- 在既有组件用例中补充外部桥接场景断言，避免新增独立测试文件。

验证：

- 已用 `ReadLints` 检查本次修改的 Vue/TS 文件，未发现 linter 诊断。
- 已运行 `npx eslint src/components/review/workflowBridge.ts src/components/review/DesignerCommentHandlingPanel.vue src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/TaskReviewDetail.vue src/components/review/TaskReviewDetail.test.ts`，退出码 `0`。
- 按项目约束，本轮未运行 `npm test` / `*.test.ts` 命令。

下一步：

- 使用仿 PMS `bran-mixed` 和 BRAN `24381_145018` 重新跑主链，确认设计处理后父窗口收到 `active` 并推进到 `jd/submitted`。
- 若 `annotation-states/apply` 仍超时，继续沿 Phase 1 记录的后端稳定性方向排查。

## 2026-04-30 · `bran-mixed` 重跑结果

命令：

```bash
PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=bran-mixed PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-239-bran-mixed-report.json npm run test:pms:simulator
```

结果：

- 契约烟测通过：`7/7`。
- `bran-mixed` 已执行到 RUS-239 关键路径之后：`SJ active -> JH return -> SJ active -> JH agree`。
- 日志中的关键节点：
  - `runWorkflowAction action=return ... node=jd`
  - `runWorkflowAction action=active ... node=sj`
  - `runWorkflowAction action=agree ... node=jd`
- 失败点转移为后续自动化稳定性：`JH agree` 后 `GET /api/review/tasks/task-d196f051-a00c-4cca-a5f6-62a0ace88dc7` 超时，随后等待 simulator 快照切到 `FORM-282963AE7E3B` 超时，清理 `POST /api/review/delete` 也超时。
- runner 退出后该次 bootstrap 自动启动的 backend 不再可达，因此无法继续 probe 同一任务详情。

结论：

- RUS-239 “驳回后设计处理并重新 active”路径已在仿 PMS 中跑到后续 `JH agree`，本轮前端桥接修复生效。
- 剩余失败不再是“无法重新流转”，而是完整 `bran-mixed` 后段 task detail/delete 超时与 simulator 快照等待问题。

下一步：

- 若要把 `bran-mixed` 全绿，需要继续定位 `GET /api/review/tasks/{id}` 在 JH agree 后的超时根因。
- 可考虑让 runner 在 backend probe 超时时保留 workflow/sync 快照诊断，避免后续 `openTaskForRole(SH)` 因快照不刷新掩盖真实 workflow 结果。

## 2026-04-30 · `bran-mixed` 全链路通过

已完成：

- `src/debug/pmsReviewSimulator.ts` 的诊断刷新改为并发读取 task detail 与 workflow query，避免 task detail 慢请求串行阻塞 workflow 快照。
- `scripts/pms-simulator-runner.ts` 在发起编校审单后关闭额外打开的独立 `3d-view` 自动化页面，只保留 simulator iframe 执行后续流程。

验证命令：

```bash
PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=bran-mixed PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-239-bran-mixed-report.json npm run test:pms:simulator
```

结果：

- 契约烟测通过：`7/7`。
- 仿 PMS `bran-mixed` 通过。
- 关键链路完整执行：`SJ active -> JH return -> SJ active -> JH agree -> SH agree -> PZ agree`。
- 最终结果：`status=approved / node=pz / form=FORM-9052588239E5`。
- 清理阶段未再出现 `POST /api/review/delete` 超时。

结论：

- RUS-239 “驳回后设计处理并重新流转”主链已由最小 HTTP 和仿 PMS `bran-mixed` 双重验证。
- 早期后段超时来自自动化负载放大：额外独立 `3d-view` 页面未关闭，加上 runner 后端 probe，使完整场景更容易触发短时后端超时。
