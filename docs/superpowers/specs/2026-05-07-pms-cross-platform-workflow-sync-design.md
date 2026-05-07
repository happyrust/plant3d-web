# PMS 跨平台工作流同步与校核批注落库设计（RUS-244 design-B）

**日期：** 2026-05-07
**状态：** 待用户评审
**关联 Issue：** [RUS-244](https://linear.app/rustdpc/issue/RUS-244)
**关联评论：** `7f5095f0` · 4-fix 拆分

## RUS-244 4-fix 映射

| Fix | Mode | Spec | 范围 |
|---|---|---|---|
| Fix 1 | A · UI 拆空态 | [`design-a-ui-empty-state`](./2026-05-07-rus-244-fix-design-a-ui-empty-state.md) | DesignerCommentHandlingPanel 三态分支 |
| Fix 2 | A · 入口收紧 | 同上 | embedContextRestore 统一 `isCanonicalReturnedTask` |
| Fix 3 | B · 校核批注落库 | **本文件** | ReviewPanel + DockLayout 入站 `pms.workflow_pre_action` 触发 confirm |
| Fix 4 | C · 跨平台同步 | **本文件** | DockLayout 入站 `pms.workflow_changed` → 调内部 sync API |

**关联设计：**

- `docs/superpowers/specs/2026-05-07-rus-244-fix-design-a-ui-empty-state.md`（design-A · Fix 1+2）
- `docs/superpowers/specs/2026-05-07-pms-returned-review-empty-state-design.md`（早期 `form_id` 强绑定假设，**已被 design-A 取代**，保留为历史推演）

## 范围

- `src/components/DockLayout.vue`
- `src/components/review/ReviewPanel.vue`
- `src/components/review/embedRoleLanding.ts`
- `src/api/reviewApi.ts`
- `src/composables/useReviewStore.ts`
- `src/composables/useUserStore.ts`
- `src/debug/pmsReviewSimulator.ts`、`scripts/pms-simulator-runner.ts`

## 背景

RUS-244 复盘后确认问题不是单点 bug，而是 3 个失败模式叠加：

| 代号 | 失败模式 | 影响位置 |
|---|---|---|
| Mode A | UI 入口与显示层口径分裂（`embedContextRestore` passive 旁路 + `DesignerCommentHandlingPanel.currentTask` 二次过滤） | `embedContextRestore.ts` / `DesignerCommentHandlingPanel.vue` |
| Mode B | 校核侧批注未落库为 `ReviewRecord` batch | `ReviewPanel.handleReturnToNode` / `confirmCurrentData` |
| Mode C | PMS 工具栏触发 [驳回]/[同意]/[转办] 等不会推回 plant3d-web 后端 | `DockLayout.tryRegisterEmbedPostMessageBridge` |

**design-A**（spec：[`design-a-ui-empty-state`](./2026-05-07-rus-244-fix-design-a-ui-empty-state.md)）覆盖 **Mode A**——UI 三态拆分 + 入口 `isCanonicalReturnedTask` 收紧（口径事实源单一化）。本 **design-B** 覆盖 **Mode B + Mode C**，与 design-A 互补不冲突。

> 早期假设："PMS token 用户与内部任务 requesterId 别名差异" 方向（spec：`2026-05-07-pms-returned-review-empty-state-design.md`）经 CDP 排查未稳定证实，已被 design-A 的"口径分裂"根因取代。

### 为什么 Mode B + C 必须独立处理

即使 Track A 完整修好「按 form_id 找到任务并打开面板」，仍会出现：

1. 设计端打开后看到 `currentTask` 已绑定，但右侧「校审」面板仍是「暂无确认记录 / 0 批次 0 批注 0 测量」——因为校核根本没把批注存进 `review_record` 表。
2. 设计端看到的 `task.status / currentNode` 仍是「审批中」，不是「已驳回」——因为 PMS 工具栏的 [驳回] 改了 PMS 自己的状态，没改 plant3d-web 的 `review_task` 表。

只有 Track A + Track B 同时上线，整条编校审返工流程才真正闭环。

## 目标

1. PMS 嵌入模式下，校核做完批注后从 PMS 工具栏点 [驳回]，应自动把当前 toolStore 中未保存的批注先落成一条 `ReviewRecord` batch（**Mode B** 修复）。
2. PMS 工具栏上 [同意] / [驳回] / [转办] / [终止] 等工作流动作应推回 plant3d-web 后端，让 `review_task.status / currentNode / workflowHistory` 与 PMS 保持一致（**Mode C** 修复）。
3. 设计端再次打开同一 form_id 时，能看到完整的批注列表 + 任务状态正确为「已驳回」+ 「批注处理」面板和「校审」面板都有数据。
4. 修复后 simulator 用例 `bug-rus-244-designer-empty-after-return` 能稳定通过。

## 非目标

- 不改 PowerPMS 自身后端逻辑；只改 plant3d-web 接收/响应侧。
- 不引入新的工作流引擎；继续复用 `reviewTaskReturn` / `reviewTaskApprove` 等已有 API。
- 不修改 design-A 范围内的文件（`embedContextRestore.ts` / `DesignerCommentHandlingPanel.vue`）；design-B 仅触达 `DockLayout.vue` / `ReviewPanel.vue` / `useReviewStore.ts` / `useUserStore.ts`。
- 不引入早期 Track A 假设的 `form_id` 强绑定查询（`reviewApi.ts` 不加 `formId` 参数；后端不新增 `/api/review/task/by-form-id`）。
- 本阶段不写代码；只产出 spec + plan 文档。

## 当前数据流

```
[校核 PMS embed]
  Reviewer 在 plant3d-web 加批注 (toolStore.annotations 等)
  → 校核点 plant3d-web 的「确认当前数据」按钮
       ├─ 走：调 reviewStore.addConfirmedRecord → reviewRecordCreate → 后端 review_record 表 ←── 仅这条路径会持久化 batch
       └─ 不走（PMS embed 常态）：直接点 PMS 工具栏 [驳回]
              → notifyParentWorkflowAction(action='return') postMessage 给 PMS
              → PMS 改自己的状态，回调（如果约定了）调 plant3d-web /workflow/sync
              → /workflow/sync 改 review_task.status，但 toolStore 里的批注从未变成 ReviewRecord

[plant3d-web 端 message handler]
  DockLayout.tryRegisterEmbedPostMessageBridge 监听 window.message
       ├─ plant3d.ping → pong
       ├─ plant3d.select_refno → 选构件
       └─ <无> 没有 PMS 的 workflow_action 入站监听
```

## 推荐方案

### Mode B：校核批注落库的两道保险

PMS embed 模式下校核走 PMS 工具栏 [驳回] 时，必须确保此前 toolStore 里的批注/测量已经持久化为 batch，否则设计端永远看不到。

**保险 1（plant3d-web 主动）：在 PMS [驳回] 触发的 postMessage 之前，自动 confirm 一次。**

`ReviewPanel.notifyParentWorkflowAction` 当前的调用方都已主动发送了 message。Mode B 修改点：抽出一个新函数 `prepareForExternalWorkflowAction(action)`，在校核侧 inflow 操作（[驳回] / [同意] / [转办]）触发前调用，函数内部判断：

- 若 `hasUnsavedPendingData.value === true`，自动调 `confirmCurrentData()`（已存在）。
- 若 `confirmCurrentData()` 抛错，整个 PMS 动作中止并给出明显错误提示，禁止 silent skip。

但 `handleReturnToNode` 在 passive mode 早返回了（`if (isPassiveWorkflow.value) return;`），因此本保险只在 plant3d-web 自身有「驳回」按钮的非 passive 路径生效。这是问题：在 PMS embed 下 plant3d-web 内部的「驳回」按钮根本不工作，没有触发点。

**保险 2（PMS 入站触发，必须）：增加 PMS → plant3d-web 入站 message `pms.workflow_pre_action`。**

约定 PMS 工具栏点 [驳回] / [同意] / [转办] 时，**先**给 plant3d-web 发一条 `pms.workflow_pre_action` postMessage（带 action 类型 + 当前 form_id），等到 plant3d-web 响应 `plant3d.workflow_pre_action_acked`（已 confirm 完毕）后，PMS 才走自己的后端逻辑。

plant3d-web 在 `DockLayout.tryRegisterEmbedPostMessageBridge` 里加该入站监听：

1. 收到 `pms.workflow_pre_action` → 在合适的 panel（`reviewer` target 时为 `ReviewPanel`）触发 `confirmCurrentData()`。
2. 完成（成功或失败）→ 回 `plant3d.workflow_pre_action_acked` 带 `ok: boolean` + `error?: string`。
3. PMS 收到 ack 后再决定是否真正提交工作流动作。

PMS 侧不接此协议时降级行为：plant3d-web 仍记录入站事件（如果有的话），无副作用。

### Mode C：PMS 工作流动作的双向同步桥

校核或审核在 PMS 工具栏点 [同意] / [驳回] / [转办] 后，PMS 必须告知 plant3d-web 后端工作流变更，否则 plant3d-web 的 `review_task.status / currentNode` 会陈旧。

**约定 PMS → plant3d-web 入站消息 `pms.workflow_changed`：**

```ts
type PmsWorkflowChangedMessage = {
  type: 'pms.workflow_changed';
  formId: string;
  action: 'agree' | 'return' | 'redirect' | 'terminate';
  targetNode?: string;     // 仅 return / redirect 携带
  comments?: string;
  pmsActor?: string;       // PMS 当前操作人 id
};
```

plant3d-web 在 `DockLayout` 里收到后：

1. 用 verified embed token 调对应的内部 sync API，按 action 分派：
   - `agree` → `reviewTaskApprove(taskId, comments)`（已存在）
   - `return` → `reviewTaskReturn(taskId, targetNode, comments)`（已存在）
   - `redirect` / `terminate` → 复用现有 `/workflow/sync` 路径
2. await `userStore.loadReviewTasks()` 拉新数据。
3. emit `plant3d.workflow_synced`：

```ts
type Plant3dWorkflowSyncedMessage = {
  type: 'plant3d.workflow_synced';
  formId: string;
  action: string;
  ok: boolean;
  taskId?: string;
  status?: string;
  currentNode?: string;
  error?: string;
};
```

PMS 端在 `pms.workflow_changed` 之后等待此回执，确认两边一致。这是 Track B Mode C 的核心。

### 落点协议总览

| 方向 | 类型 | 触发时机 | 内容 |
|---|---|---|---|
| plant3d → PMS | `plant3d.workflow_action`（已存在） | plant3d 内部按钮（非 passive） | action / formId / taskId / comments |
| PMS → plant3d | `pms.workflow_pre_action` | PMS 工具栏 click 之前 | action / formId |
| plant3d → PMS | `plant3d.workflow_pre_action_acked` | 收到 pre_action 完成 confirm 后 | ok / error |
| PMS → plant3d | `pms.workflow_changed` | PMS 后端工作流提交之后 | action / formId / targetNode / comments |
| plant3d → PMS | `plant3d.workflow_synced` | plant3d 后端 sync 完成 | ok / status / currentNode / error |

## 前端修改点

### `src/components/review/embedPostMessageBridge.ts`（新增）

抽离 `DockLayout.tryRegisterEmbedPostMessageBridge` 中的 message handler 到独立模块，便于测试。

- 导出 `attachEmbedPostMessageBridge(options)`
- options 接收：`onPmsWorkflowChanged`、`onPmsWorkflowPreAction`、`onPlant3dPing`、`onPlant3dSelectRefno` 几个回调
- 返回 `detach()` 卸载函数
- 入站消息解析复用 `pmsReviewSimulatorEmbedMessages.ts` 的同名风格（`isWorkflowMutationAction` 等）

### `src/components/DockLayout.vue`

- `tryRegisterEmbedPostMessageBridge` 改为调用 `embedPostMessageBridge.attachEmbedPostMessageBridge`，注入：
  - `onPmsWorkflowChanged`：调 `useReviewStore.applyExternalWorkflowChange`（见下）
  - `onPmsWorkflowPreAction`：调 `useReviewStore.flushPendingConfirmForExternalAction`（见下）

### `src/components/review/ReviewPanel.vue`

- 抽出 `prepareForExternalWorkflowAction(action)` 工具函数（或放到 `reviewPanelActions.ts`）。
- `notifyParentWorkflowAction` 调用前，主动调 `prepareForExternalWorkflowAction`。
- passive mode 下不再早返回 `handleReturnToNode`，但保留按钮 disabled，让 message bridge 接管 confirm 调用。
- 暴露一个 imperative `flushPendingConfirm()` 给 store 用，避免 panel 不挂载时无人执行 confirm。

### `src/composables/useReviewStore.ts`

新增方法：

```ts
async function flushPendingConfirmForExternalAction(formId: string): Promise<{ ok: boolean; error?: string }>;
```

- 内部判断 `currentTask.value?.formId === formId`，否则返回 `{ ok: false, error: 'form_id_mismatch' }`。
- 调用 `confirmCurrentData()` 等价路径（不弹 toast、不重置 note，只做持久化）。
- 失败时返回 error 信息。

```ts
async function applyExternalWorkflowChange(payload: PmsWorkflowChangedPayload): Promise<{ ok: boolean; status?: string; currentNode?: string; error?: string }>;
```

- 按 action 分派现有 API（`reviewTaskApprove` / `reviewTaskReturn` / 等）。
- 完成后调 `userStore.loadReviewTasks()` 重新拉缓存。
- 返回新的 `status` / `currentNode`（取自 hydrated task）。

### `src/composables/useUserStore.ts`

- 不新增 API。仅在 `applyExternalWorkflowChange` 落地后由 `useReviewStore` 调 `loadReviewTasks`。

### `src/api/reviewApi.ts`

- 不新增公开 API（已有 `reviewTaskReturn` / `reviewTaskApprove` / `reviewTaskGetList` 等）。
- 如果后端新增 `/api/review/task/by-form-id` 在 Track A 的 plan 已覆盖（task 1）；本 spec 不重复声明。

### `src/debug/pmsReviewSimulator.ts` + `scripts/pms-simulator-runner.ts`

- simulator 增加发送 `pms.workflow_pre_action` 与 `pms.workflow_changed` 的能力（仅在 simulator 上下文）。
- runner 新增场景 `bug-rus-244-designer-empty-after-return`，复现 Mode B + Mode C 联合。

## 验证计划

### 单元测试

- `src/components/review/embedPostMessageBridge.test.ts`（新建）：
  - 入站 `pms.workflow_pre_action` 触发 onPmsWorkflowPreAction，并发出 `plant3d.workflow_pre_action_acked`。
  - 入站 `pms.workflow_changed` 触发 onPmsWorkflowChanged，并发出 `plant3d.workflow_synced`。
  - 入站非 plant3d 协议消息忽略。

- `src/composables/useReviewStore.test.ts`（扩展）：
  - `flushPendingConfirmForExternalAction(formId)` 在 formId 匹配时调 `confirmCurrentData`；不匹配时返回 form_id_mismatch。
  - `applyExternalWorkflowChange({ action: 'return', ... })` 调 `reviewTaskReturn` 并 reload。
  - `applyExternalWorkflowChange({ action: 'agree', ... })` 调 `reviewTaskApprove` 并 reload。

### simulator 集成

- `scripts/pms-simulator-runner.ts` 加场景 `bug-rus-244-designer-empty-after-return`：
  1. seed：1 个 task，requester=U020，checker=U010，formId=`FORM-RUS-244-CASE`。
  2. switchUser → U010。
  3. plant3d-web 中加 1 条文字批注 + 1 条距离测量到 toolStore，**不点 confirm**。
  4. simulator 发 `pms.workflow_pre_action` action=return → 期望收到 `plant3d.workflow_pre_action_acked` ok=true。
  5. 检查后端 `review_record` 表 ≥ 1 条 batch（Mode B 通过）。
  6. simulator 发 `pms.workflow_changed` action=return targetNode=sj → 期望收到 `plant3d.workflow_synced` ok=true status=rejected currentNode=sj。
  7. 检查后端 `review_task.status === 'rejected'`（Mode C 通过）。
  8. switchUser → U020，打开同 formId。
  9. 期望 `embed_landing_state.restoreStatus === 'matched'`、`DesignerCommentHandlingPanel.currentTask` 不为 null、批注列表 ≥ 1 条、右侧「校审」面板 batch 数 ≥ 1。

### 回归

- `npm run type-check`
- `npx vitest run src/components/review/embedPostMessageBridge.test.ts src/composables/useReviewStore.test.ts --runInBand`
- `PMS_SIMULATOR_CASE=bug-rus-244-designer-empty-after-return npm run test:pms:simulator`

### 真实 PMS 回归

需 PMS 侧支持新协议后，按 RUS-244 原 issue 复现步骤跑一遍：FORM-FB4EF9F13DF1 → checker 标批注 → 工具栏 [驳回] → 切换 designer → 打开同一单据 → 期望两个面板都非空。

## 风险

- **PMS 必须接新协议**：`pms.workflow_pre_action` / `pms.workflow_changed` 是新约定，PMS 端必须改造。如果 PMS 不愿改：plant3d-web 单边修复 Mode B（保险 1，仅 plant3d 内部按钮路径）；Mode C 退化为「设计端打开时强刷 task by form_id」（Track A Task 1 的 `loadReviewTaskByFormId`）。
- **confirm 抛错时的协议**：如果 `confirmCurrentData` 失败，PMS 收到 `plant3d.workflow_pre_action_acked` ok=false 应阻止后续工作流动作；如果 PMS 仍然提交，会出现「PMS 状态变了但批注没存」的脏数据，需要监控告警。
- **postMessage 安全**：必须校验 `event.origin` 是否为可信 PMS host；当前 `tryRegisterEmbedPostMessageBridge` 只 check `embedTokenVerified`，新协议要求增加 origin 白名单。
- **重复消息**：PMS 重新加载 iframe 时如果重发 `pms.workflow_changed`，plant3d-web 要做幂等（同 `formId + action + ts` 在短窗口内只处理一次）。

## 通过标准

1. `bug-rus-244-designer-empty-after-return` simulator 场景在 main 上稳定通过。
2. RUS-244 原 issue 真实 PMS 复现路径，设计端打开时两个面板均非空。
3. 不破坏 Track A 已落地行为：原 `embed_landing_state` / `embed_mode_params` 持久化键不变，原 `plant3d.workflow_action` 出站消息不变。
4. `npm run type-check` + 上述 vitest 套件全绿。
5. 与 Track A 的 form_id 兜底查询（`loadReviewTaskByFormId`）在协议层不冲突；任意一个 Track 单独回滚都不影响另一 Track。
