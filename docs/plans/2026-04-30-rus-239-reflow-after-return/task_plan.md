# RUS-239 驳回后重新流转开发方案

## 目标

定位并修复 Linear RUS-239：编校审单被驳回后，设计人员处理批注后无法重新流转的问题。方案需要覆盖外部 PMS 驱动链路、内部平台旧链路、批注状态门禁，以及仿 PMS 自动化复现。

## 背景判断

- 业务主链应是 `SJ active -> JH return -> SJ 处理批注 -> SJ active -> JH/SH/PZ agree`。
- 外部 PMS 模式下，流程推进应通过 `/api/review/workflow/sync` 的 `active/return/agree` 驱动。
- 当前代码里仍存在直接调用 `/api/review/tasks/{id}/submit` 的 UI 入口，可能绕开外部流程语义。
- 仿 PMS `bran-mixed` 是最接近 RUS-239 的回归场景；修复后已完整跑通 `SJ active -> JH return -> SJ active -> JH/SH/PZ agree`。

## 计划文件

- 流程图：[`rus-239-reflow-flow.html`](./rus-239-reflow-flow.html)
- 发现记录：[`findings.md`](./findings.md)
- 执行日志：[`progress.md`](./progress.md)

## Phase 0：复现基线与阻塞拆分

状态：`complete`

目标：

- 固化当前已知复现：`bran-mixed` 在批注状态 apply 阶段超时。
- 构造更小的 HTTP 链路：创建任务后直接执行 `workflow/sync active -> return -> active`。
- 判断阻塞属于“后端接口超时”还是“重新流转业务校验失败”。

验收：

- 记录每个请求的 endpoint、输入、状态码、耗时和失败点。
- 若最小链路挂在任务创建或批注 apply，先进入后端超时诊断。
- 若最小链路进入第二次 `active` 并返回明确 4xx/409，进入业务校验诊断。

## Phase 1：后端超时诊断

状态：`complete`

目标：

- 定位 `POST /api/review/annotation-states/apply` 超时点。
- 同时核对 `POST /api/review/tasks` 在最小复现中拿 token 后挂起的原因。
- 排查 SurrealDB schema/context 切换、任务查询、review round 计算、annotation state UPSERT 是否存在锁等待或慢查询。
- 收敛仿 PMS 自身额外页面和诊断请求带来的后端压力，避免自动化验证制造超时。

重点文件：

- `plant-model-gen/src/web_api/review_annotation_state.rs`
- `plant-model-gen/src/web_api/review_api.rs`
- `plant-model-gen/src/web_api/platform_api/review_form.rs`

建议动作：

- 用 HTTP JSON 最小请求复现，不新增 Rust test。
- 在 handler 的关键 await 前后补临时 tracing 或复用现有日志，确认卡点。
- 优先让仿 PMS 反馈环恢复可跑，再判断 RUS-239 业务根因。

## Phase 2：重新流转业务语义核对

状态：`complete`

目标：

- 核对被退回到 `sj` 后，任务状态、当前节点、负责人、批注门禁是否满足再次 `active`。
- 明确 `workflow/sync active` 与旧 `/tasks/{id}/submit` 的行为差异。
- 判断设计侧按钮是否应该统一走外部 `workflow/sync active`，而不是 `submitTaskToNextNode()`。

重点文件：

- `src/components/review/TaskReviewDetail.vue`
- `src/components/review/DesignerCommentHandlingPanel.vue`
- `src/components/review/ReviewPanel.vue`
- `src/debug/pmsReviewSimulator.ts`
- `src/api/reviewApi.ts`
- `plant-model-gen/src/web_api/platform_api/workflow_sync.rs`

验收：

- 退回后的任务应为 `current_node=sj` 且非终态。
- 设计人员处理完批注后，`workflow/verify active` 应通过或返回可解释的门禁原因。
- 第二次 `workflow/sync active` 应推进到 `jd`，并清理或隐藏过期的驳回面板。

## Phase 3：修复方案

状态：`complete`

候选方向：

1. UI 入口修复：外部 PMS/被动流程上下文中，设计侧“再次提交”统一走 `workflow/sync active`。
2. 状态修复：退回到 `sj` 后确保 `status=draft`、`current_node=sj`、`return_reason` 与 workflow history 一致。
3. 批注门禁修复：设计侧处理后的 `fixed/wont_fix` 状态能被 `annotation_check` 正确识别为可重新提交。
4. 稳定性修复：消除 `annotation-states/apply` / task create 超时，避免自动化无法覆盖主链。

选择标准：

- 优先修复事实根因，不叠加兼容 shim。
- 只改与 RUS-239 相关的入口、状态机和门禁。
- 不引入新的独立测试文件；必要行为覆盖落到现有组件用例中，主验收仍按项目约定使用仿 PMS、HTTP JSON 和 Chrome CDP。

已落地：

- 新增 `workflowBridge`，只在外部被动流程且存在父窗口时向 PMS/仿 PMS 发送 `plant3d.workflow_action`。
- `DesignerCommentHandlingPanel.vue` 的“流转回校对”在外部嵌入模式下发送 `active`，不再直接走旧 `/tasks/{id}/submit`。
- `TaskReviewDetail.vue` 的“再次提交”在外部嵌入模式下同样发送 `active`，独立/内部模式保留旧提交路径。
- 仿 PMS 打开任务时诊断并发读取 task detail 与 workflow query，避免慢 task detail 串行阻塞 workflow 快照。
- runner 在创建编校审单后关闭额外打开的独立 `3d-view` 自动化页面，只保留 simulator iframe 执行后续流转，降低完整场景后端读负载。

## Phase 4：验证与文档

状态：`complete`

验证命令候选：

```bash
PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=bran-mixed PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-239-bran-mixed-report.json npm run test:pms:simulator
```

补充验证：

- 最小 HTTP `active -> return -> active` 链路。
- 必要时运行真实 PMS CDP 指定 BRAN 的 smoke。
- 更新 `findings.md`、`progress.md` 和中文 changelog。

完成标准：

- `bran-mixed` 至少跑过“重新 active”节点。`done`：2026-04-30 重跑已完整通过，最终 `status=approved / node=pz`。
- 设计侧处理批注后可以重新流转到校核节点。
- 若仍被门禁拦截，错误能明确指出未处理批注，而不是按钮无效或流程卡死。

当前剩余：

- RUS-239 自动化主链已全绿；真实 PMS 环境仍可按需做 Chrome CDP smoke 验证。
