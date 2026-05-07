# RUS-244 design-B · PMS 跨平台 workflow 同步桥 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PMS 嵌入下校核走 PMS 工具栏 [驳回] / [同意] / [转办] 时，自动把 plant3d 这边未保存批注落库为 `ReviewRecord` batch（Mode B），并把 PMS workflow 变更推回 plant3d 后端 `review_task` 表（Mode C）。

**Architecture:** 双向 postMessage 协议 — `pms.workflow_pre_action` ↔ `plant3d.workflow_pre_action_acked`（Mode B：confirm 完才 ack），`pms.workflow_changed` ↔ `plant3d.workflow_synced`（Mode C：调内部 sync API 后回执）。新增 `embedPostMessageBridge.ts` 抽离 message handler，`useReviewStore` 暴露两个 imperative 方法。

**Tech Stack:** Vue 3 + TypeScript + window.postMessage + plant3d-web simulator + Playwright CDP；PMS 端需配套发送 `pms.workflow_pre_action` / `pms.workflow_changed`。

**Spec:** `docs/superpowers/specs/2026-05-07-pms-cross-platform-workflow-sync-design.md`

**验证策略:** simulator + CLI 优先；plant3d 单边接收能力可独立交付，端到端联调依赖 PMS 端发送方落地。

**前置依赖:** design-A 实施 plan（`2026-05-07-rus-244-design-a-ui-empty-state.md`）已 merged 或同期推进；与 design-A 改动文件无重叠。

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `src/components/review/embedPostMessageBridge.ts` | 新建 | 抽离 message handler，定义入站消息协议类型 |
| `src/components/review/embedPostMessageMessages.ts` | 新建 | 入站消息类型定义（pms.workflow_pre_action / pms.workflow_changed），与现有 `pmsReviewSimulatorEmbedMessages.ts` 对偶 |
| `src/composables/useReviewStore.ts` | 修改 | 新增 `flushPendingConfirmForExternalAction` / `applyExternalWorkflowChange` |
| `src/components/review/ReviewPanel.vue` | 修改 | passive 解锁 + 暴露 flushPendingConfirm imperative API |
| `src/components/DockLayout.vue` | 修改 | 接入 embedPostMessageBridge，注入 store 回调 |
| `src/debug/pmsReviewSimulatorEmbedMessages.ts` | 修改 | 增加发送 `pms.workflow_pre_action` / `pms.workflow_changed` 的 helper |
| `scripts/pms-simulator-runner.ts` | 修改 | 新增 `bug-rus-244-designer-empty-after-return` 场景 |

不动：`embedContextRestore.ts` / `DesignerCommentHandlingPanel.vue` / `reviewTaskFilters.ts`（design-A 范围）；不改 PMS 端代码。

---

## Task 1: 入站消息类型定义（embedPostMessageMessages.ts）

**Files:**

- Create: `src/components/review/embedPostMessageMessages.ts`

- [ ] **Step 1.1: 创建入站消息类型文件**

```ts
// src/components/review/embedPostMessageMessages.ts

export interface PmsWorkflowPreActionMessage {
  type: 'pms.workflow_pre_action';
  formId: string;
  action: 'agree' | 'return' | 'redirect' | 'terminate';
  requestId?: string;
}

export interface PmsWorkflowChangedMessage {
  type: 'pms.workflow_changed';
  formId: string;
  action: 'agree' | 'return' | 'redirect' | 'terminate';
  targetNode?: string;
  comments?: string;
  pmsActor?: string;
  requestId?: string;
}

export type PmsInboundMessage = PmsWorkflowPreActionMessage | PmsWorkflowChangedMessage;

export interface Plant3dWorkflowPreActionAckedMessage {
  type: 'plant3d.workflow_pre_action_acked';
  ok: boolean;
  error?: string;
  requestId?: string;
}

export interface Plant3dWorkflowSyncedMessage {
  type: 'plant3d.workflow_synced';
  formId: string;
  action: string;
  ok: boolean;
  taskId?: string;
  status?: string;
  currentNode?: string;
  error?: string;
  requestId?: string;
}

export type Plant3dOutboundSyncMessage =
  | Plant3dWorkflowPreActionAckedMessage
  | Plant3dWorkflowSyncedMessage;

export function isPmsWorkflowPreAction(data: unknown): data is PmsWorkflowPreActionMessage {
  return !!data
    && typeof data === 'object'
    && (data as { type?: unknown }).type === 'pms.workflow_pre_action'
    && typeof (data as { formId?: unknown }).formId === 'string'
    && typeof (data as { action?: unknown }).action === 'string';
}

export function isPmsWorkflowChanged(data: unknown): data is PmsWorkflowChangedMessage {
  return !!data
    && typeof data === 'object'
    && (data as { type?: unknown }).type === 'pms.workflow_changed'
    && typeof (data as { formId?: unknown }).formId === 'string'
    && typeof (data as { action?: unknown }).action === 'string';
}
```

- [ ] **Step 1.2: type-check 通过**

Run: `npm run type-check`
Expected: 0 errors。

- [ ] **Step 1.3: lint 通过**

Run: `npm run lint`
Expected: 0 errors。

- [ ] **Step 1.4: commit**

```bash
git add src/components/review/embedPostMessageMessages.ts
git commit -m "feat(review): define PMS<->plant3d inbound/outbound workflow sync message types"
```

---

## Task 2: useReviewStore 新增 flushPendingConfirmForExternalAction

**Files:**

- Modify: `src/composables/useReviewStore.ts`

- [ ] **Step 2.1: 阅读现有 confirmCurrentData 实现**

Run: `code src/composables/useReviewStore.ts` 查找 `confirmCurrentData`，理解其当前依赖（toolStore / reviewRecordCreate / 等）。

- [ ] **Step 2.2: 抽出共享 confirm 内核**

如果 `confirmCurrentData` 当前在 ReviewPanel.vue 内（非 store 内），先在 store 内抽一个 imperative 内核函数 `confirmCurrentDataInternal({ silent: boolean })`，参数控制 toast / dialog 副作用。原 ReviewPanel 调用切到 `confirmCurrentDataInternal({ silent: false })`，向后兼容。

```ts
// useReviewStore.ts
async function confirmCurrentDataInternal(options: { silent?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  const { silent = false } = options;
  const task = currentTask.value;
  if (!task) return { ok: false, error: 'no_current_task' };
  try {
    // ... 原 confirmCurrentData 持久化逻辑 ...
    if (!silent) {
      // ... 原 toast / note 重置 ...
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

> 具体抽离边界视现有代码而定；如果 confirmCurrentData 已经在 store 中且参数化，可跳过抽离直接复用。

- [ ] **Step 2.3: 新增 flushPendingConfirmForExternalAction**

```ts
async function flushPendingConfirmForExternalAction(formId: string): Promise<{ ok: boolean; error?: string }> {
  const task = currentTask.value;
  if (!task) return { ok: false, error: 'no_current_task' };
  if (task.formId !== formId) return { ok: false, error: 'form_id_mismatch' };
  if (!hasUnsavedPendingData.value) return { ok: true };
  return confirmCurrentDataInternal({ silent: true });
}
```

> `hasUnsavedPendingData` 应已在 store 中存在（用于 ReviewPanel 按钮 disable）；如不存在则按当前 toolStore 状态推导（`toolStore.annotations.length + cloudAnnotations + rectAnnotations + measurements > 0` 且 task batch 中未保存）。

- [ ] **Step 2.4: export 新方法**

在 store return 块加上：

```ts
return {
  // ... 既有 ...
  confirmCurrentDataInternal,
  flushPendingConfirmForExternalAction,
};
```

- [ ] **Step 2.5: type-check 通过**

Run: `npm run type-check`
Expected: 0 errors。

- [ ] **Step 2.6: lint 通过**

Run: `npm run lint`
Expected: 0 errors。

- [ ] **Step 2.7: commit**

```bash
git add src/composables/useReviewStore.ts
git commit -m "feat(review-store): add flushPendingConfirmForExternalAction for PMS pre_action handshake (RUS-244 Fix 3)"
```

---

## Task 3: useReviewStore 新增 applyExternalWorkflowChange

**Files:**

- Modify: `src/composables/useReviewStore.ts`
- Modify: `src/composables/useUserStore.ts`（如果需要 expose loadReviewTasks 或新查询）

- [ ] **Step 3.1: import 现有 workflow API**

```ts
import { reviewTaskApprove, reviewTaskReturn } from '@/api/reviewApi';
```

- [ ] **Step 3.2: 实现 applyExternalWorkflowChange**

```ts
import type { PmsWorkflowChangedMessage } from '@/components/review/embedPostMessageMessages';

async function applyExternalWorkflowChange(
  payload: Pick<PmsWorkflowChangedMessage, 'formId' | 'action' | 'targetNode' | 'comments'>
): Promise<{ ok: boolean; taskId?: string; status?: string; currentNode?: string; error?: string }> {
  const task = currentTask.value;
  if (!task) return { ok: false, error: 'no_current_task' };
  if (task.formId !== payload.formId) return { ok: false, error: 'form_id_mismatch' };

  try {
    if (payload.action === 'agree') {
      await reviewTaskApprove(task.id, payload.comments ?? '');
    } else if (payload.action === 'return') {
      const targetNode = payload.targetNode || 'sj';
      await reviewTaskReturn(task.id, targetNode, payload.comments ?? '');
    } else if (payload.action === 'redirect' || payload.action === 'terminate') {
      return { ok: false, error: `action_${payload.action}_not_implemented` };
    } else {
      return { ok: false, error: `unknown_action_${payload.action}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  await userStore.loadReviewTasks();
  const refreshed = userStore.findTaskById(task.id);
  return {
    ok: true,
    taskId: task.id,
    status: refreshed?.status ?? task.status,
    currentNode: refreshed?.currentNode ?? task.currentNode,
  };
}
```

> `userStore.findTaskById` 若不存在，添加一个简单的查询 helper；或直接通过 `userStore.allTasks.find(t => t.id === task.id)` 实现。

- [ ] **Step 3.3: export 新方法**

```ts
return {
  // ...
  applyExternalWorkflowChange,
};
```

- [ ] **Step 3.4: type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: 0 errors。

- [ ] **Step 3.5: commit**

```bash
git add src/composables/useReviewStore.ts src/composables/useUserStore.ts
git commit -m "feat(review-store): add applyExternalWorkflowChange for PMS workflow_changed sync (RUS-244 Fix 4)"
```

---

## Task 4: 新建 embedPostMessageBridge.ts

**Files:**

- Create: `src/components/review/embedPostMessageBridge.ts`

- [ ] **Step 4.1: 创建 bridge 模块**

```ts
// src/components/review/embedPostMessageBridge.ts

import {
  isPmsWorkflowPreAction,
  isPmsWorkflowChanged,
  type PmsWorkflowPreActionMessage,
  type PmsWorkflowChangedMessage,
  type Plant3dWorkflowPreActionAckedMessage,
  type Plant3dWorkflowSyncedMessage,
} from './embedPostMessageMessages';

interface BridgeOptions {
  onPmsWorkflowPreAction: (msg: PmsWorkflowPreActionMessage) => Promise<{ ok: boolean; error?: string }>;
  onPmsWorkflowChanged: (msg: PmsWorkflowChangedMessage) => Promise<{
    ok: boolean;
    taskId?: string;
    status?: string;
    currentNode?: string;
    error?: string;
  }>;
  onPlant3dPing?: (source: WindowProxy, requestId?: string) => void;
  onPlant3dSelectRefno?: (source: WindowProxy, refno: string, requestId?: string) => void;
  trustedOrigins?: string[];
}

export function attachEmbedPostMessageBridge(options: BridgeOptions): () => void {
  const handler = async (event: MessageEvent) => {
    const source = event.source;
    if (!source || typeof (source as WindowProxy).postMessage !== 'function') return;

    if (options.trustedOrigins && !options.trustedOrigins.includes(event.origin)) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (isPmsWorkflowPreAction(data)) {
      const result = await options.onPmsWorkflowPreAction(data);
      const ack: Plant3dWorkflowPreActionAckedMessage = {
        type: 'plant3d.workflow_pre_action_acked',
        ok: result.ok,
        error: result.error,
        requestId: data.requestId,
      };
      (source as WindowProxy).postMessage(ack, '*');
      return;
    }

    if (isPmsWorkflowChanged(data)) {
      const result = await options.onPmsWorkflowChanged(data);
      const synced: Plant3dWorkflowSyncedMessage = {
        type: 'plant3d.workflow_synced',
        formId: data.formId,
        action: data.action,
        ok: result.ok,
        taskId: result.taskId,
        status: result.status,
        currentNode: result.currentNode,
        error: result.error,
        requestId: data.requestId,
      };
      (source as WindowProxy).postMessage(synced, '*');
      return;
    }

    // 其他消息（plant3d.ping / plant3d.select_refno）由 DockLayout 现有 handler 处理；
    // 本 bridge 只接 sync 协议，不接管原入站。
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
```

> **关键决策**：本 bridge 与 DockLayout 现有 ping/select_refno handler **并存**，不替换。监听的 message event 类型互不冲突（不同 `data.type`）。

- [ ] **Step 4.2: type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: 0 errors。

- [ ] **Step 4.3: commit**

```bash
git add src/components/review/embedPostMessageBridge.ts
git commit -m "feat(review): add embedPostMessageBridge for PMS<->plant3d workflow sync"
```

---

## Task 5: ReviewPanel passive 解锁 + 不破坏现有按钮 disabled

**Files:**

- Modify: `src/components/review/ReviewPanel.vue:631`

- [ ] **Step 5.1: 修改 handleReturnToNode**

```ts
// 修改前
async function handleReturnToNode() {
  if (isPassiveWorkflow.value) return;
  if (!currentTask.value || !canReturnToPrevNode.value) return;
  // ... 既有逻辑 ...
}

// 修改后
async function handleReturnToNode() {
  if (!currentTask.value || !canReturnToPrevNode.value) return;
  // 注：passive 模式下按钮仍 disabled（看 template 的 :disabled），所以正常 UI 不会触发；
  // 仅由 store imperative 调用（如 applyExternalWorkflowChange 内调）触达；
  // ... 既有逻辑保持不变 ...
}
```

- [ ] **Step 5.2: 确认按钮 disabled 状态不变**

grep `handleReturnToNode` 在 template 内的 `<button>` 节点，确认 `:disabled` 仍包含 `isPassiveWorkflow` 或等价限制；passive 下用户点不到。

```vue
<!-- 期望保留（grep 现有代码确认） -->
<button
  :disabled="isPassiveWorkflow || workflowLoading || workflowActionLoading || !canReturnToPrevNode"
  @click="handleReturnToNode"
>...</button>
```

如果原 template 没有 `isPassiveWorkflow` 在 disabled 里（依赖函数内早返回），则在 disabled 中显式加上：`isPassiveWorkflow || workflowLoading || ...`。

- [ ] **Step 5.3: 同样处理 handleSubmitToNextNode（如有 passive 早返回）**

grep `if (isPassiveWorkflow.value) return;` 在 ReviewPanel.vue。除 handleReturnToNode 外，所有 passive 早返回点同样审视；按 design-B 协议，imperative 调用应能走通，UI 触发由 :disabled 控制。

- [ ] **Step 5.4: type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: 0 errors。

- [ ] **Step 5.5: commit**

```bash
git add src/components/review/ReviewPanel.vue
git commit -m "refactor(review-panel): unlock passive handleReturnToNode for imperative calls (RUS-244 Fix 3)"
```

---

## Task 6: DockLayout 接入 bridge

**Files:**

- Modify: `src/components/DockLayout.vue`

- [ ] **Step 6.1: import bridge + store**

```ts
import { attachEmbedPostMessageBridge } from '@/components/review/embedPostMessageBridge';
import { useReviewStore } from '@/composables/useReviewStore';
```

- [ ] **Step 6.2: 在 setup 内接入 bridge**

找到 `tryRegisterEmbedPostMessageBridge` 的调用位置（应在 onMounted 或 watchEffect 内）。新增并行 bridge：

```ts
const reviewStore = useReviewStore();
let detachWorkflowSyncBridge: (() => void) | null = null;

function tryRegisterWorkflowSyncBridge() {
  const shouldEnable = embedModeParams.value.isEmbedMode && embedTokenVerified.value;
  if (!shouldEnable) {
    if (detachWorkflowSyncBridge) {
      detachWorkflowSyncBridge();
      detachWorkflowSyncBridge = null;
    }
    return;
  }
  if (detachWorkflowSyncBridge) return;

  detachWorkflowSyncBridge = attachEmbedPostMessageBridge({
    onPmsWorkflowPreAction: async (msg) => reviewStore.flushPendingConfirmForExternalAction(msg.formId),
    onPmsWorkflowChanged: async (msg) => reviewStore.applyExternalWorkflowChange({
      formId: msg.formId,
      action: msg.action,
      targetNode: msg.targetNode,
      comments: msg.comments,
    }),
    // trustedOrigins 在 spec §风险 中要求；首版用 PMS_EMBEDDED_SITE_SUBSTRING 推断
    // 暂时不强制白名单（保留未来加）
  });
}
```

在与 `tryRegisterEmbedPostMessageBridge()` 相同的 watchEffect / onMounted 内调用 `tryRegisterWorkflowSyncBridge()`，并在 onUnmounted 调 detach。

- [ ] **Step 6.3: type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: 0 errors。

- [ ] **Step 6.4: commit**

```bash
git add src/components/DockLayout.vue
git commit -m "feat(dock-layout): wire workflow sync bridge to review store (RUS-244 Fix 3+4)"
```

---

## Task 7: simulator 增加发送能力 + 协议测试

**Files:**

- Modify: `src/debug/pmsReviewSimulatorEmbedMessages.ts`
- Modify: `scripts/pms-simulator-runner.ts`

- [ ] **Step 7.1: 在 pmsReviewSimulatorEmbedMessages.ts 增加发送 helper**

```ts
import type {
  PmsWorkflowPreActionMessage,
  PmsWorkflowChangedMessage,
} from '@/components/review/embedPostMessageMessages';

export function emitPmsWorkflowPreAction(
  iframeWindow: Window,
  payload: Omit<PmsWorkflowPreActionMessage, 'type'>
): void {
  iframeWindow.postMessage({ type: 'pms.workflow_pre_action', ...payload }, '*');
}

export function emitPmsWorkflowChanged(
  iframeWindow: Window,
  payload: Omit<PmsWorkflowChangedMessage, 'type'>
): void {
  iframeWindow.postMessage({ type: 'pms.workflow_changed', ...payload }, '*');
}

export interface AwaitedAck {
  ok: boolean;
  error?: string;
  raw: unknown;
}

export async function awaitPlant3dAck(
  expectedType: 'plant3d.workflow_pre_action_acked' | 'plant3d.workflow_synced',
  timeoutMs = 5000
): Promise<AwaitedAck> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', listener);
      resolve({ ok: false, error: 'timeout', raw: null });
    }, timeoutMs);

    const listener = (event: MessageEvent) => {
      const data = event.data as { type?: string; ok?: boolean; error?: string };
      if (data?.type === expectedType) {
        clearTimeout(timer);
        window.removeEventListener('message', listener);
        resolve({ ok: !!data.ok, error: data.error, raw: data });
      }
    };
    window.addEventListener('message', listener);
  });
}
```

- [ ] **Step 7.2: scripts/pms-simulator-runner.ts 增加 `bug-rus-244-designer-empty-after-return` 场景**

参照 spec §验证计划 / simulator 集成的步骤 1-9。伪代码核心：

```ts
{
  id: 'bug-rus-244-designer-empty-after-return',
  description: 'RUS-244 design-B · Mode B+C 端到端复现 + 修复验收',
  steps: [
    // seed
    { kind: 'seed', task: { id: 'task-rus-244', requesterId: 'U020', checkerId: 'U010', formId: 'FORM-RUS-244-CASE', status: 'in_review', currentNode: 'jh' } },

    // checker U010 加批注但不点 confirm
    { kind: 'switchUser', userId: 'U010' },
    { kind: 'setEmbed', target: 'reviewer', formId: 'FORM-RUS-244-CASE', passive: true },
    { kind: 'addAnnotation', kind: 'text', refno: 'A1' },
    { kind: 'addMeasurement', kind: 'distance', from: 'A1', to: 'A2' },

    // 模拟 PMS 发 pre_action（发驳回前）
    { kind: 'emitPmsWorkflowPreAction', payload: { formId: 'FORM-RUS-244-CASE', action: 'return' } },
    { kind: 'awaitAck', expectedType: 'plant3d.workflow_pre_action_acked', expectOk: true },
    { kind: 'expectBackend', resource: 'review_record', filter: { taskId: 'task-rus-244' }, minCount: 1 }, // Mode B 通过

    // 模拟 PMS 发 workflow_changed
    { kind: 'emitPmsWorkflowChanged', payload: { formId: 'FORM-RUS-244-CASE', action: 'return', targetNode: 'sj' } },
    { kind: 'awaitAck', expectedType: 'plant3d.workflow_synced', expectOk: true, expectStatus: 'rejected', expectCurrentNode: 'sj' },
    { kind: 'expectBackend', resource: 'review_task', filter: { id: 'task-rus-244' }, expect: { status: 'rejected', currentNode: 'sj' } }, // Mode C 通过

    // 切换 designer U020 打开同 form_id → 看到批注 + 任务为已驳回
    { kind: 'switchUser', userId: 'U020' },
    { kind: 'setEmbed', target: 'designer', formId: 'FORM-RUS-244-CASE', passive: true },
    { kind: 'expect', selector: '[data-testid="designer-state-1"]', visible: true }, // design-A 状态 1
    { kind: 'expectBatch', minCount: 1 },                                              // 校审面板有 batch
  ],
}
```

> 具体 DSL 字段名按 simulator 实际 API 调整。`expectBackend` / `expectBatch` 若 simulator 不直接支持，先以 simulator 输出 + 手动 curl 验证替代，记入 `docs/verification/2026-05-07-rus-244-design-b.md`。

- [ ] **Step 7.3: type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: 0 errors。

- [ ] **Step 7.4: 跑场景**

Run: `npm run test:pms:simulator -- --case bug-rus-244-designer-empty-after-return`

Expected:

- 修复前（Task 5 / 6 未做时）：在 `awaitAck plant3d.workflow_pre_action_acked` 处 timeout（plant3d 没 listener）→ FAIL，符合预期复现。
- 修复后（全部 Task 完成）：所有 step PASS。

- [ ] **Step 7.5: commit**

```bash
git add src/debug/pmsReviewSimulatorEmbedMessages.ts scripts/pms-simulator-runner.ts
git commit -m "test(pms-simulator): add bug-rus-244-designer-empty-after-return E2E case"
```

---

## Task 8: 真实 PMS 联调（依赖 PMS 端配合）

**Files:** 无（联调验证）

> **前置：** PMS 团队需上线 `pms.workflow_pre_action` / `pms.workflow_changed` 发送端。本 Task 在 PMS 端就绪前 **不能完成 step 8.3**。

- [ ] **Step 8.1: 与 PMS 团队对齐协议**

发送：
- `docs/superpowers/specs/2026-05-07-pms-cross-platform-workflow-sync-design.md` §落点协议总览（5 类消息）
- `src/components/review/embedPostMessageMessages.ts`（类型定义）

获 PMS 工程师确认能在工具栏 [驳回]/[同意]/[转办] 按钮上接入发送。约定 PMS 端 ETA。

- [ ] **Step 8.2: PMS 端就绪前 plant3d 单边 deploy**

不需 PMS 配合即可 deploy plant3d 接收侧（design-B Task 1-7）：

- 不影响现有用户（PMS 不发消息时无副作用）
- design-A 已上线后用户体验不退化

- [ ] **Step 8.3: PMS 端就绪后 真实 PMS 联调**

按 spec §真实 PMS 回归 步骤：

```powershell
$env:PMS_E2E_PASSWORD='Admin@1234'
$env:PMS_EMBEDDED_SITE_SUBSTRING='powerpms.net:1801'
```

```bash
npm run test:pms:cdp:extended
```

测试用例：
1. JH 校核：打开 FORM-FB4EF9F13DF1 → 加批注 → PMS 工具栏点 [驳回]
2. 期望：plant3d 收 pre_action → confirmCurrentData 完成 → 回 ack ok=true
3. 期望：PMS 收到 ack 后提交后端 → 发 workflow_changed
4. 期望：plant3d 调 reviewTaskReturn → 回 plant3d.workflow_synced ok=true status=rejected
5. SJ 设计：再打开 FORM-FB4EF9F13DF1 → 看到批注 + design-A 状态 1 渲染

- [ ] **Step 8.4: 验证报告归档**

```bash
docs/verification/2026-05-07-rus-244-design-b.md
```

含：simulator 输出 + CDP 报告 + 真实 PMS 截图 + PMS 工程师 sign-off。

- [ ] **Step 8.5: commit**

```bash
git add docs/verification/2026-05-07-rus-244-design-b.md
git commit -m "docs(verification): RUS-244 design-B simulator + real PMS 联调验收"
```

---

## Task 9: PR 提交与 RUS-244 收尾

**Files:** 无（流程任务）

- [ ] **Step 9.1: PR 描述**

PR 标题：

```
feat(review): RUS-244 design-B · PMS 跨平台 workflow 同步桥
```

PR body：

```markdown
## Why
RUS-244 评论 7f5095f0 4-fix 拆分中的 Fix 3+4（Mode B+C）。校核走 PMS 工具栏驳回时 plant3d batch 未保存 + PMS workflow 不推回 plant3d 后端。

## What
- 新增 embedPostMessageBridge.ts + embedPostMessageMessages.ts
- useReviewStore 新增 flushPendingConfirmForExternalAction / applyExternalWorkflowChange
- ReviewPanel 解锁 passive handleReturnToNode 给 imperative 调用
- DockLayout 接入新 bridge
- simulator 加 bug-rus-244-designer-empty-after-return 场景

## Verify
1. npm run type-check ✅
2. npm run lint ✅
3. npm run test:pms:simulator -- --case bug-rus-244-designer-empty-after-return ✅
4. PMS 端就绪后：npm run test:pms:cdp:extended ✅
5. 真实 PMS → docs/verification/2026-05-07-rus-244-design-b.md

## Refs
- Spec: docs/superpowers/specs/2026-05-07-pms-cross-platform-workflow-sync-design.md
- Plan: docs/superpowers/plans/2026-05-07-rus-244-design-b-cross-platform-workflow-sync.md
- 前置 design-A: docs/superpowers/plans/2026-05-07-rus-244-design-a-ui-empty-state.md
- Linear: RUS-244

## 依赖
- PMS 团队需配套上线 pms.workflow_pre_action / pms.workflow_changed 发送端（参见 spec §落点协议总览）
```

- [ ] **Step 9.2: 推送分支并创建 PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(review): RUS-244 design-B · PMS 跨平台 workflow 同步桥" --body-file <PR_BODY_FILE>
```

- [ ] **Step 9.3: 更新 RUS-244 Linear 状态**

PR merge + Task 8.3 通过 → Linear 标 Done；PMS 端未就绪时 → 标 In Progress + 备注"待 PMS 端协议落地"。

---

## 工时估算（中位）

| Task | 估时 | 备注 |
|---|---|---|
| Task 1 消息类型 | 0.5 h | |
| Task 2 flushPendingConfirm | 1.5 h | 含 confirmCurrentData 抽离 |
| Task 3 applyExternalWorkflowChange | 1.5 h | |
| Task 4 embedPostMessageBridge | 1 h | |
| Task 5 ReviewPanel passive 解锁 | 0.5 h | |
| Task 6 DockLayout 接入 | 0.5 h | |
| Task 7 simulator 协议 + 场景 | 2 h | |
| Task 8 PMS 联调 | 2 h | + PMS 团队 ETA |
| Task 9 PR | 0.5 h | |
| **plant3d 单边小计** | **~10 h** | step 8.3 / 8.4 / 9.3 依赖 PMS |

---

## 验证 milestone

| Milestone | 通过条件 |
|---|---|
| M1 类型协议落地 | Task 1 完成 |
| M2 store 双方法 | Task 2 + Task 3 完成 |
| M3 bridge 接收能力 | Task 4 + Task 6 完成 |
| M4 ReviewPanel 单元 OK | Task 5 完成 |
| M5 simulator 端到端 | Task 7 PASS（修复后） |
| M6 plant3d 单边 PR merge | Task 9.2 完成（不依赖 PMS） |
| M7 真实 PMS 闭环 | Task 8.3 + 8.4 完成（依赖 PMS） |
| M8 RUS-244 Done | M7 + design-A 已 merged |

---

## Self-Review

**1. Spec coverage:**

| Spec 章节 | 对应 Task |
|---|---|
| §推荐方案 Mode B 保险 1（plant3d-web 主动） | Task 5（passive 解锁） |
| §推荐方案 Mode B 保险 2（PMS 入站 pre_action） | Task 4 onPmsWorkflowPreAction + Task 2 flushPendingConfirm |
| §推荐方案 Mode C 双向同步桥 | Task 4 onPmsWorkflowChanged + Task 3 applyExternalWorkflowChange |
| §落点协议总览 5 类消息 | Task 1（类型定义）+ Task 4（bridge 实现） |
| §前端修改点 embedPostMessageBridge.ts | Task 4 |
| §前端修改点 useReviewStore | Task 2 + Task 3 |
| §前端修改点 ReviewPanel | Task 5 |
| §前端修改点 DockLayout | Task 6 |
| §前端修改点 simulator | Task 7 |
| §验证计划 simulator 集成 | Task 7.4 |
| §验证计划 真实 PMS 回归 | Task 8.3 |
| §风险 PMS 不接协议时降级 | Task 8.2 plant3d 单边 deploy 已显式覆盖 |
| §风险 confirm 抛错协议 | Task 4 onPmsWorkflowPreAction 返回 error，bridge 在 ack 中 ok=false |
| §风险 postMessage origin 安全 | Task 4 trustedOrigins 字段已留出（首版 noop）→ 后续可在 deploy 后加白名单（标 follow-up） |
| §风险 重复消息幂等 | Task 3 applyExternalWorkflowChange 调内部 sync API 时由后端幂等保证；如需短窗口去重，加 follow-up issue |
| §通过标准 1 simulator 场景 | Task 7.4 PASS |
| §通过标准 2 真实 PMS 复现 | Task 8.3 |
| §通过标准 3 不破坏 Track A | design-A 改动文件 design-B 不动（File Structure 已对齐）|
| §通过标准 4 type-check + vitest | type-check 全跑；本计划无新 vitest（按 simulator-first） |
| §通过标准 5 与 Track A form_id 不冲突 | design-B 不引入 form_id 强查询 |

**2. Placeholder scan:**

- "具体 DSL 字段名按 simulator 实际 API 调整"（Task 7.2）— 实施时会按 simulator 现状对齐，非永久占位
- "trustedOrigins 首版 noop"（Task 4）— 显式留 follow-up，不构成 plan 漏洞
- 无 TBD / TODO / "implement later" 留在步骤里

**3. Type consistency:**

- `flushPendingConfirmForExternalAction(formId: string)` 在 Task 2.3 / 4.1 / 6.2 三处一致
- `applyExternalWorkflowChange(payload)` 在 Task 3.2 / 4.1 / 6.2 三处一致
- `PmsWorkflowPreActionMessage` / `PmsWorkflowChangedMessage` / `Plant3dWorkflowPreActionAckedMessage` / `Plant3dWorkflowSyncedMessage` 四类型在 Task 1 / 4 / 7 跨文件一致
- `confirmCurrentDataInternal({ silent })` 在 Task 2.2 / 2.3 一致

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-07-rus-244-design-b-cross-platform-workflow-sync.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 每 Task 一个 subagent，两阶段 review，迭代快。本 plan 9 个 Task，建议 Task 8 单独标记 blocked 等 PMS 端配合。

**2. Inline Execution** — 本会话内分批执行，checkpoint review。Task 7 之前可全部本会话完成；Task 8 标 follow-up。

待用户选择执行方式（design-A plan 同步选择）。
