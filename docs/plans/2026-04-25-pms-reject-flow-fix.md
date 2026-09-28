# 2026-04-25 仿 PMS 驳回链路修复计划

## 背景

本计划来源于 `artifacts/browser-use-reject-20260425-1002/report.md` 以及同场景的两份机器轨迹：

- `artifacts/pms-simulator-reject-20260425-095905.json`
- `artifacts/pms-simulator-return-trace-20260425-100008.json`

用户态的 browser-use 尝试在"保存编校审单数据"之后即卡死，后续 JH / SH / PZ 驳回链路无法推进。脚本化 `scripts/pms-simulator-runner.ts` 的 `scenarioReturn` 虽能绕过 UI 点击进行到 PZ 阶段，但最终 `finalNode` 期望 `sj`、实际落到 `jd`，同步失败。

两条路径指向两类缺陷，本计划同时覆盖。

## 失败链路与定位

### A. 嵌入页保存 → PMS 侧无感知（手测 browser-use 阻塞）

1. `src/components/review/InitiateReviewPanel.vue` 的 `handleSubmit` 在 `externalWorkflowMode` 下调用 `userStore.createReviewTask(...)`，成功后 **仅** 触发 Vue 的 `emit('created', task.id)`，**不向 `window.parent` 发送任何 `postMessage`**。
2. `src/debug/pmsReviewSimulator.ts` 的 `handleWindowMessage` 只识别 `plant3d.workflow_action`，没有 `form_saved`。
3. 因此 PMS 的 `state.iframeMeta.taskId` 不会更新；即使 `reviewTaskGetList` 能返回该 task，模拟器也不会自动把 `formId → row` 选中。
4. `resolveSimulatorWorkflowAccess` 看到 `iframeSource ∈ {task-view, task-reopen}` 且 `workflowNextStepRole` 为空、`taskCurrentNode/taskAssignedUserId` 又无法回落（因为无选中行），命中 `workflow-unresolved` 分支 → `canMutateWorkflow=false` → 送审提交变灰。

**表现**：
- PMS 面板：`任务编号=--`、`components 数=0`、`workflow next_step=--`、"仅可查看"。
- JH 刷新看不到单据（单据仍在 `sj/draft`，被 inbox 过滤）。

### B. scenarioReturn 从 PZ 驳回到 SJ 实际落到 JD（脚本阻塞）

JSON 断言：

- `return-verify` passed=false，但 detail 为"验证通过，可继续流转"——**部分由本计划修复**：原状态机 `lastVerifyAction` 在访问被阻时保留上一次 agree 的成功值，导致 detail 看起来是"验证通过"。本次提交在 access blocked / missing formId 路径上也写入 `lastVerifyAction=action / lastVerifyOk=false`，下一轮报告会暴露真实失败原因，而不是停留在上次 agree 的残余字符串。
- `return-sync` detail："workflow next_step 缺失，当前仅能按任务当前节点与指派判断（JH / jd）；当前用户仅可查看。"——这意味着即使 PZ 角色，simulator 在执行 return 前的访问检查就已经把它当成"非 PZ 节点处理人"拦截。最可能的原因是：当时 sidePanelMode 不是 'workflow'，`canMutateWorkflow` 通过 `task-current-node` fallback 计算时，`workflowSnapshot.next_step` 里仍然记着 SH→PZ 的 `(JH / jd)`，绕过了实际 PZ 角色判定。
- `return-node` 期望 `sj` 实际 `jd`，`return-side-panel` 期望 `initiate` 实际 `readonly`。
- `finalNode=jd, finalStatus=submitted`。

**初步怀疑（待 runtime 真实日志校核）**：

1. PASSIVE_WORKFLOW_MODE=true 时 `shouldUseSyncOnlyWorkflowAction`=true → simulator 不再调用 `reviewTaskReturn`，仅靠 workflow/verify+workflow/sync。如果上一步 SH agree 时 `state.diagnostics.workflowSnapshot.data.next_step` 已被写成 `{jd / JH}`（这是 server 给 SH agree 后下一步的那次回填），PZ 重开页面、未刷新这条 snapshot 的话，`resolveSimulatorWorkflowAccess` 的 fallback 路径会按这个旧 next_step 继续判 PZ 没权限。
2. 即使能进入 verify，`validate_workflow_return` 用 `task.current_node` 作判定；只要 PZ 没有重新 fetchTaskDetail，前端发的 `actor.roles=pz` 与后端 task 的 current_node=pz 是一致的，verify 应能通过——所以 `return-verify` 的真正失败必须由实际响应日志确认。
3. 后端 `apply_workflow_return` 写库本身没有问题（已审）；如果落到 jd/submitted，最可能是上一步 SH agree 的写入"被 PZ 阶段重新走了一遍"，即 frontend 把 SH 的 cached state 重新发出（这与 #1 是同一根因）。
4. 还有一种可能：PZ 重开后 `state.diagnostics.workflowSnapshot` 被旧值覆盖，`resolveCurrentWorkflowRoleState` 推出来的 `currentWorkflowRole` 其实仍然是 `jd`（因为 next_step.roles=jd），导致 `resolveSimulatorWorkflowMutationTargetRole` 在 action='return' 时仍按"行 PZ 角色发 return"算，但 Actor 本身写的是 jd→sj 的 next_step，这能解释为什么落地是 jd（next_step 错配）。

### C. 次要问题

- `pms-simulator-runner.ts` 中 `return-verify` 断言用了 `lastVerifyMessage` 作为 detail，但 `passed` 依赖 `lastVerifyOk` 标志，两者口径不统一。
- iframe 可访问性（ISSUE-003）影响自动化可达性，与业务缺陷正交。
- `gate-return` 403 是角色不匹配（SH 不是 checker 节点负责人 JH）；需确认 API 授权规则和测试角色期望。

## 修复目标 / 验收标准

1. **目标 1（P0）**：UI 路径下 SJ 保存后，PMS 模拟器能立刻感知 `taskId/formId` 的绑定，自动把对应行选中并加载 workflow/sync。"送审提交"按钮可按预期启用。
2. **目标 2（P0）**：`scenarioReturn` 的 `return-node` 断言通过（PZ 驳回后 task 回到 sj、status 可驳回态）。
3. **目标 3（P1）**：`return-verify` 断言语义一致；`verifyPassed=true` 与 detail 同步。
4. **目标 4（P2）**：更新契约文档和测试脚本，保证 gate-return 的用户角色与门禁规则匹配。

验收命令（依次执行，顺序不可变）：

```bash
cd /Volumes/DPC/work/plant-code/plant3d-web
bun run pms:contract-sequence    # 契约 smoke 7/7 PASS
bun run pms:simulator -- --cases=return,approved,stop  # 三场景 all PASS
```

## 改动清单（逐条可落地）

### 第 1 阶段：保存 → PMS 感知 桥梁（目标 1）

- [ ] **E1.1** `src/components/review/InitiateReviewPanel.vue` `handleSubmit` 成功分支（`externalWorkflowMode` 为 true 时）新增：

  ```ts
  if (window.parent !== window) {
    window.parent.postMessage({
      type: 'plant3d.form_saved',
      formId: task.formId ?? requestFormId ?? null,
      taskId: task.id,
      componentCount: selectedComponents.value.length,
      source: 'initiate-review-panel',
    }, '*');
  }
  ```

- [ ] **E1.2** `src/debug/pmsReviewSimulator.ts` 增加：
  - `EmbeddedFormSavedMessage` 类型与 `parseEmbeddedFormSavedMessage` 守卫
  - `handleEmbeddedFormSaved`：更新 `state.iframeMeta`、`state.lastOpenedFormId`，并依次 `refreshList() → setSelectedTask(taskId) → fetchTaskDetail(taskId) → requestWorkflowSyncQuery(formId)`，最后触发 `renderSidePanelState / renderDiagnostics`
  - 在 `handleWindowMessage` 中分派该消息
- [ ] **E1.3** 在 `src/debug/pmsReviewSimulatorWorkflow.ts` 增加 SJ 自救规则：
  - 当 `iframeSource ∈ {task-view, task-reopen}` 且 `taskCurrentNode=sj`、`taskStatus=draft`、`currentPmsUser === requesterId` 时，把 `canMutateWorkflow` 设为 true、`decisionSource` 标为 `self-draft-resume`，与 `new-entry` 语义一致。保持 `'approved' / 'cancelled'` 的 short-circuit 不变。
- [ ] **E1.4** 给新增的可视逻辑补单测：
  - `src/components/review/InitiateReviewPanel.*.test.ts` 或新建 `InitiateReviewPanel.formSaved.test.ts`：mock `window.parent.postMessage`，断言 external mode 下发送 `plant3d.form_saved`。
  - `src/debug/pmsReviewSimulatorWorkflow.test.ts` 新增 SJ self-draft-resume 的用例。

### 第 2 阶段：PZ return → SJ（目标 2）

> 本阶段需要**真实运行时日志**才能定位，已通过第 1 阶段的 `workflowVerify` 状态修正消除上一次 agree 的残余 detail，下一轮报告会暴露真实失败原因。

- [ ] **E2.1** 启动 vite (3101) + backend (3100)，跑 `bun run test:pms:simulator -- --cases=return`，拿到：
  - 每次 workflow/verify 请求 + 响应（含 next_step / actor / current_node）
  - 每次 workflow/sync(action=return) 请求 + 响应
  - PZ 切换到 SJ 后 `reviewTaskGetById` 的当前 task 实际 current_node / status
- [ ] **E2.2** 根据日志判断三种主假设之一：
  - 前端在 PZ 阶段把上一次 (SH agree → JH 的) `next_step` cache 重新发出，导致 sync 应用错误目标节点；
  - PASSIVE_WORKFLOW_MODE 下 sidePanelMode 推断错位，`canMutateWorkflow` 阻断了 PZ 真正的 return；
  - 后端 `apply_workflow_return` 在某个 race 下写库失败，但前端没看到错误。
- [ ] **E2.3** 根据根因，最可能的修复点：
  - `executeWorkflowAction` 在每次提交前重置 `state.diagnostics.workflowSnapshot`，避免读到上次 agree 的 next_step；
  - 或 `resolveWorkflowMutationNextStep` 接受显式 `currentWorkflowRole` 而不是从 snapshot 推导；
  - 或后端在 apply_return 前 reload task 防止 stale。
- [x] **E2.4** `scripts/pms-simulator-runner.ts` 新增 `probeBackendTaskByFormId`：scenarioReturn 在 PZ return 之后、reopen 为 SJ 之前，从后端 `/api/review/tasks` 直接读 task 的 `currentNode/status`，并写入 `return-backend-current-node` 断言。下一轮 JSON 报告可以在不依赖 simulator 内存状态的情况下，告诉我们后端实际是不是把 task 落到了 sj。

### 第 3 阶段：断言口径对齐（目标 3） — done

- [x] **E3.1** `scripts/pms-simulator-runner.ts` 中所有 `*-verify` / `*-sync` 的非"门禁"断言统一走 `assertWorkflowVerify` / `assertWorkflowSync` 帮助函数，detail 输出 `expected_action / actual_action / ok / message` 四元组，"验证通过"字样不再单独出现，可直接读出错位的 action。
- [x] **E3.2** `src/debug/pmsReviewSimulator.ts` 中 `state.workflowVerify` 的更新通过统一的 `updateWorkflowVerifyState` 写入；access blocked / missing formId 路径都已补上同样的写入。

### 第 4 阶段：gate-return 403（目标 4）

- [ ] **E4.1** 确认业务意图：checker 节点是否只允许 JH 写 `/api/review/records`？若是，测试脚本改为以 JH 身份执行该场景；若否，后端放行同节点其他成员并更新文档。
- [ ] **E4.2** 相应更新 `scenarioGateReturn` / 或后端 handler，并补契约文档。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 修 workflow return 动到后端可能引发其它用例回归 | 动手前先跑 `pms:contract-sequence` 与 `cases=approved` 获得基线；修改后逐 case 对比 |
| postMessage 增加跨域消息可能被误读 | 明确 `type` 前缀 `plant3d.`，parser 层做字段完整性校验；target 仍使用 `'*'` 但仅信任 `event.source === iframeWindow` |
| 前端可视回退逻辑改动影响"新增"入口判定 | SJ 自救条件收紧到 `taskStatus=draft && currentNode=sj && requesterId === currentPmsUser`，不影响新入口分支 |
| 计划执行期间 vite 3101 未启动 | 开发时以单元测试覆盖主要分支，E2E 回归请求具体启动命令后再跑 |

## 后续 Wave 2

完整的 runtime 验证 + root cause 收敛任务详见 [`2026-04-25-pms-reject-flow-fix-wave2.md`](./2026-04-25-pms-reject-flow-fix-wave2.md)。

## 执行顺序（强耦合，请按序）

1. 写单元测试（先验证当前假设）→ 确认失败现象 → **第 1 阶段** E1.1 + E1.2 + E1.3 + E1.4。
2. 跑 `pms:contract-sequence` 确认 API 层未受影响。
3. 如果 vite dev server 可启动，手动验证 SJ 新增 → 保存 → 送审 → JH 接单 链路恢复。
4. **第 2 阶段** 按需补日志、定位 PZ return 落 JD 的真正 handler；修完再全量回归。
5. **第 3 / 4 阶段** 作为收尾，按需合并到同一 commit 或独立 PR。

## 追踪

| 子任务 | 负责人 | 状态 |
|---|---|---|
| E1.1 InitiateReviewPanel postMessage form_saved | agent | done |
| E1.2 pmsReviewSimulator handleEmbeddedFormSaved | agent | done |
| E1.3 workflow access SJ self-draft-resume | agent | `not-needed`（现有 fallback 在 taskDetail 加载后已自动命中 taskCurrentNode 分支；保留作为观察项） |
| E1.4 单元测试 | agent | done（`form-binding.test.ts` 中断言 postMessage；66/66 passing） |
| refreshList 自动按 formId 回选 | agent | done（`pmsReviewSimulator.refreshList`） |
| workflowVerify 状态对齐（E3.2 提前合并） | agent | done（access blocked / missing formId 均写 lastVerifyAction+lastVerifyOk=false） |
| E2.1–E2.4 PZ return sj 修复 | — | **blocked on runtime**：需要 vite dev server (3101) + backend (3100) 在线后再按 E2.2 取真实响应定位根因 |
| E3.1 断言 detail 口径 | — | pending |
| E4.1–E4.2 gate-return 403 裁定 | pending-owner-decision | pending |

## 本次已提交改动

- `src/components/review/InitiateReviewPanel.vue`：新增 `notifyParentFormSaved`，`handleSubmit` 成功分支（external mode）发送 `plant3d.form_saved`
- `src/components/review/form-binding.test.ts`：扩展 external mode 测试，断言 `window.parent.postMessage` 收到 `plant3d.form_saved` 消息
- `src/debug/pmsReviewSimulator.ts`：
  - 新增 `EmbeddedFormSavedMessage` / `parseEmbeddedFormSavedMessage` / `handleEmbeddedFormSaved`
  - `handleWindowMessage` 分发两类消息
  - `refreshList` 若没有 selectedTask，按 `iframeMeta.formId || lastOpenedFormId` 回选
  - `executeWorkflowAction` 的访问被阻 / 缺 formId 分支也写入 `workflowVerify` 状态，避免 `lastVerifyAction` 停留在上一次成功的动作
  - `executeWorkflowAction` 进入决策前先 await `refreshDiagnosticsSnapshot`：在 taskDetail 缺失或 taskDetail.id 与目标不一致、或 workflowSnapshot 为空时强制拉一次。这避免角色切换/重开 iframe 后 diagnostics 异步刷新与 `runWorkflowAction` 之间的 race，让访问检查/payload 构造拿到的是 actor 视角下的最新数据，而不是上一个角色或上一步的残留。
- `scripts/pms-simulator-runner.ts`：
  - 新增 `describeWorkflowVerifyDetail` / `describeWorkflowSyncDetail` / `assertWorkflowVerify` / `assertWorkflowSync`；scenarioApproved / scenarioReturn / scenarioStop 的所有 verify/sync 断言改用新帮助函数，detail 直接输出 `expected_action / actual_action / ok / message`。
  - 新增 `getJson` 与 `probeBackendTaskByFormId` 帮助函数，scenarioReturn 在 PZ return 后立即从后端 `/api/review/tasks` 读取真实 `current_node/status`，作为 `return-backend-current-node` 断言独立暴露后端真实状态。
- `src/debug/pmsReviewSimulatorEmbedMessages.ts`（new module）：抽离 `parseEmbeddedWorkflowActionMessage` / `parseEmbeddedFormSavedMessage`，导出 `EmbeddedWorkflowActionMessage` / `EmbeddedFormSavedMessage` 类型。pmsReviewSimulator.ts 改为从该模块导入，便于隔离测试。
- `src/debug/pmsReviewSimulatorEmbedMessages.test.ts`（new test）：10 个单测覆盖类型守卫的全部分支（非法 type / 非法 action / 非对象 / 字段类型错误 / formId 空白归一化 / 缺 taskId 拒绝等）。

验证：

- `npx vitest run` → **162 files / 1236 tests / 0 failed**
- `npx vue-tsc --noEmit --pretty false` → 0 errors
