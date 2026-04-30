# RUS-239 Findings

## 已确认事实

- [需求] RUS-239 指向“驳回的问题设计人员处理后无法重新流转”，核心链路是退回到设计节点后再次发起流转。
- [复现入口] 仿 PMS `bran-mixed` 场景覆盖多 BRAN 驳回、批注处理和重新提交流程，是当前最接近 RUS-239 的自动化反馈环。
- [验证] `bran-mixed` 已完整通过，最终 `status=approved / node=pz`，覆盖 `SJ active -> JH return -> SJ fixed -> SJ active -> JH agree -> SH agree -> PZ agree`。
- [验证] 最小 HTTP `active -> return -> active` 链路通过：创建任务约 110ms，三次 `workflow/sync` 分别约 100/88/76ms，第二次 `active` 正常回到 `jd/submitted`。
- [验证] 带批注状态的最小 HTTP 链路通过：`JH reject -> return sj -> SJ fixed -> active jd` 全部在约 65-113ms 内完成。
- [验证] `bran-mixed` 失败留下的真实任务 `FORM-70298B7939F9` / `task-6b6cc0a0-9648-4247-9696-84dc8974a174` 在 API-only 下可继续完成 `return -> SJ fixed -> active`，结果为 `currentNode=jd / taskStatus=submitted`。
- [验证] 前端桥接修复后重跑 `bran-mixed` 已越过 RUS-239 关键节点并最终通过：日志显示 `active -> return -> SJ active -> JH/SH/PZ agree` 均已执行。
- [后端] `workflow/sync active` 只允许从 `sj` 发起，并要求目标 `next_step` 为 `jd`。
- [后端] `workflow/sync return` 只允许在 `jd/sh/pz` 执行，目标节点必须位于当前节点之前；退回到 `sj` 后状态应回到 `draft`。
- [后端] `workflow/sync active` 和旧 `/api/review/tasks/{id}/submit` 都会调用 `evaluate_annotation_check(... intent=submit_next)`，所以批注状态真源会直接影响重新流转。
- [前端] `TaskReviewDetail.vue` 的“再次提交”按钮在 `isReturnedTask && currentNode === 'sj' && status === 'draft'` 时显示，但点击后调用 `userStore.submitTaskToNextNode()`，即旧 `/tasks/{id}/submit` 路径。
- [前端] 已新增 `workflowBridge`，在外部被动流程且存在父窗口时发送 `plant3d.workflow_action`；设计处理页和详情弹窗的重新流转入口已接入 `active`。
- [仿 PMS] `pmsReviewSimulator.ts` 已有 `PASSIVE_WORKFLOW_MODE` 下的 `workflow/sync active/return/agree` 直接驱动逻辑；旧平台任务推进只在非 sync-only 场景执行。
- [稳定性] 完整 `bran-mixed` 失败后，`/api/review/tasks` 和单任务详情曾短时超时，但后端监听进程更换后同一数据读取恢复到约 108-184ms，疑似仿 PMS 完整跑法触发瞬态后端查询/锁等待或进程重启。
- [稳定性] 早期 `bran-mixed` 后段超时与 runner 保留额外独立 `3d-view` 页面有关；创建任务后关闭该自动化页、仅保留 simulator iframe 后，完整场景通过且清理未再超时。
- [稳定性] `pmsReviewSimulator.ts` 的诊断刷新已改为并发读取 task detail 与 workflow query，避免 task detail 慢请求串行阻塞 workflow 快照更新。

## 当前假设

- [假设 A] 后端 `workflow/sync` 与 `annotation-states/apply` 通用逻辑允许重新流转；已由最小 HTTP 与完整 `bran-mixed` 共同验证。
- [假设 B] 设计侧“再次提交”入口在外部 PMS 上下文走旧 `submitTaskToNextNode()`，可能与 PMS `workflow/sync active` 的 actor、next_step、诊断和外部状态同步语义不一致；该入口已改为优先通知父窗口走 `active`。
- [假设 C] 完整 `bran-mixed` 后段超时属于自动化负载问题：额外独立 `3d-view` 页面未关闭导致后端读取压力放大，关闭后场景全绿。

## 风险

- [风险] 真实 PMS 环境仍需按实际嵌入窗口验证父窗口是否接收 `plant3d.workflow_action active`。
- [风险] 若把所有“再次提交”都改为 `workflow/sync active`，可能影响非 PMS/本地任务场景。
- [风险] 若仅放宽 `annotation_check`，可能让未处理批注绕过校审门禁。
- [风险] 当前工作区存在大量无关脏变更，RUS-239 修改必须显式暂存，避免混入 RUS-238 或其他联调产物。

## 决策

- [决策] 最小 HTTP 反馈环已恢复；后续修复判断转向外部 PMS UI 入口和完整仿 PMS 稳定性。
- [决策] RUS-239 验证优先使用 HTTP JSON、仿 PMS simulator 和必要的 Chrome CDP，不新增独立测试文件。
- [决策] 外部 PMS 上下文中的重新流转应以 `workflow/sync active` 为事实源；旧 `/tasks/{id}/submit` 只作为内部平台路径。
- [决策] 仿 PMS 创建单据只短暂打开独立 `3d-view` 用于自动发起，提交后立即关闭，后续流程统一在 simulator iframe 中执行。
