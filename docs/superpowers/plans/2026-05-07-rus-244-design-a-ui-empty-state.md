# RUS-244 design-A · UI 空态拆解 + embedContextRestore 入口收紧 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 PMS 嵌入下设计人员打开非驳回单据时永不见空白 panel；判定口径以 `isCanonicalReturnedTask` 为单一事实源。

**Architecture:** A3 双边对齐 — `embedContextRestore` 入口去掉 `passiveWorkflowMode` 旁路统一过滤 + `DesignerCommentHandlingPanel` 三态分支兜底（驳回 / 非驳回引导 / 无任务）。

**Tech Stack:** Vue 3 + TypeScript + Tailwind / Vuetify + plant3d-web simulator（`npm run test:pms:simulator`）+ Playwright CDP（`npm run test:pms:cdp`）。

**Spec:** `docs/superpowers/specs/2026-05-07-rus-244-fix-design-a-ui-empty-state.md`

**验证策略:** 遵循 `plant3d-web/AGENTS.md` — simulator + CLI + 真实 web_server 优先，**不增独立 `*.test.ts`**。

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `src/components/review/DesignerCommentHandlingPanel.vue` | 修改 | 三态分支模板 + currentTask 解除过滤 |
| `src/components/review/NonReturnedGuidanceCard.vue` | 新建 | 状态 2 引导卡（独立 SFC） |
| `src/components/review/embedContextRestore.ts` | 修改 | shouldOpenDesignerCommentHandling 去 passive 旁路 |
| `src/debug/pmsReviewSimulatorState.ts` | 修改 | 注入非驳回 task 与 force-open panel 用例 |
| `scripts/pms-simulator-runner.ts` | 修改 | 新增 `rus-244-designer-non-returned-state` 场景 |

不动：`reviewTaskFilters.ts`、`ReviewPanel.vue`、`DockLayout.vue`、`useReviewStore.ts`、`useUserStore.ts`（design-B 范围）。

---

## Task 1: 新建 NonReturnedGuidanceCard 组件

**Files:**

- Create: `src/components/review/NonReturnedGuidanceCard.vue`

- [ ] **Step 1.1: 创建组件文件**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { ReviewTask } from '@/types/auth';
import { getTaskStatusDisplayName } from '@/utils/taskDisplay';

interface Props {
  task: ReviewTask;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'navigate-to-review': [];
}>();

const statusLabel = computed(() => getTaskStatusDisplayName(props.task.status));
const nodeLabel = computed(() => props.task.currentNode || '-');
</script>

<template>
  <div class="non-returned-guidance-card">
    <div class="info-block">
      <h3 class="title">当前任务暂未触发驳回流程</h3>
      <p class="description">
        该单据当前节点 <strong>{{ nodeLabel }}</strong>，状态 <strong>{{ statusLabel }}</strong>。
      </p>
      <p class="description">若需要查看或处理审查记录，请前往「我的审查工作台」。</p>
    </div>
    <button class="action-button" @click="emit('navigate-to-review')">前往审查工作台</button>
  </div>
</template>

<style scoped>
.non-returned-guidance-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-radius: 8px;
  background: rgb(248 250 252 / 0.7);
  border: 1px solid rgb(226 232 240);
}
.title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px;
  color: rgb(15 23 42);
}
.description {
  font-size: 13px;
  margin: 4px 0;
  color: rgb(71 85 105);
}
.action-button {
  align-self: flex-start;
  padding: 6px 14px;
  border-radius: 6px;
  background: rgb(59 130 246);
  color: white;
  font-size: 13px;
  border: none;
  cursor: pointer;
}
.action-button:hover {
  background: rgb(37 99 235);
}
</style>
```

> 文案占位：实施时找产品过一遍措辞，必要时把"我的审查工作台"换成对应 panel 的 i18n key。

- [ ] **Step 1.2: type-check 通过**

Run: `npm run type-check`
Expected: 0 errors。

- [ ] **Step 1.3: lint 通过**

Run: `npm run lint`
Expected: 0 errors / warnings。

- [ ] **Step 1.4: commit**

```bash
git add src/components/review/NonReturnedGuidanceCard.vue
git commit -m "feat(review): add NonReturnedGuidanceCard for design-A state-2 fallback"
```

---

## Task 2: DesignerCommentHandlingPanel 三态拆分

**Files:**

- Modify: `src/components/review/DesignerCommentHandlingPanel.vue:117-121`（currentTask computed）
- Modify: `src/components/review/DesignerCommentHandlingPanel.vue`（template 顶部）

- [ ] **Step 2.1: 解除 currentTask computed 过滤**

`DesignerCommentHandlingPanel.vue` 第 117-121 行：

```ts
// 修改前
const currentTask = computed(() => {
  const task = reviewStore.currentTask.value;
  if (task && isCanonicalReturnedTask(task)) return task;
  return null;
});

// 修改后
const currentTask = computed(() => reviewStore.currentTask.value);
```

> `isCanonicalReturnedTask` 仍 import；判定挪到模板 `v-if`。

- [ ] **Step 2.2: import NonReturnedGuidanceCard**

在 `<script setup>` 顶部已有 import 区域追加：

```ts
import NonReturnedGuidanceCard from './NonReturnedGuidanceCard.vue';
```

- [ ] **Step 2.3: 模板顶部加三态分支**

找到 `<template>` 中包裹原批注/驳回信息渲染的最外层 div（panel 主容器），改为：

```vue
<template>
  <div class="designer-comment-handling-panel">
    <!-- 状态 1: 驳回态任务（原渲染） -->
    <template v-if="currentTask && isCanonicalReturnedTask(currentTask)">
      <!-- ↓↓ 这里复制原本最外层 div 内的全部子节点（不重复 div 包裹） ↓↓ -->
      <!-- ... 原批注 / 驳回信息 / 操作按钮 ... -->
      <!-- ↑↑ 与原模板等价 ↑↑ -->
    </template>

    <!-- 状态 2: 非驳回态引导卡 -->
    <template v-else-if="currentTask">
      <NonReturnedGuidanceCard
        :task="currentTask"
        @navigate-to-review="goToReviewPanel"
      />
    </template>

    <!-- 状态 3: 无选中任务空态 -->
    <template v-else>
      <div class="no-task-empty-state">
        <p>当前没有需要处理的退回单据。请从左侧任务列表选择，或前往「我的审查工作台」。</p>
        <button class="action-button" @click="goToReviewPanel">前往审查工作台</button>
      </div>
    </template>
  </div>
</template>
```

> 状态 3 的 `no-task-empty-state` 复用现有空态样式即可；若原模板已有空态实现，直接挪到状态 3 分支不重复造。

- [ ] **Step 2.4: 实现 goToReviewPanel 函数**

在 `<script setup>` 内补：

```ts
import { useDockApi } from '@/composables/useDockApi';
const dockApi = useDockApi();

function goToReviewPanel() {
  dockApi.activatePanel('review');
}
```

> 若 `useDockApi` 已存在则复用；不存在时改用现有的 panel activation 工具函数（grep `activatePanel` 找到正确入口）。

- [ ] **Step 2.5: 检查下游 computed 是否仅在状态 1 内复用**

grep `currentTaskStatus | currentTaskPriority | returnedMetadata | latestReturnTimestamp | currentTaskConfirmedRecords | allAnnotationItems` 在 panel 模板的位置，确认全部位于 `状态 1 v-if` 子树内（与 spec §11 R3 风险一致）。

如有遗漏，在使用处改为 `isCanonicalReturnedTask(currentTask)` 守卫，或全部下沉到状态 1 子模板。

- [ ] **Step 2.6: type-check 通过**

Run: `npm run type-check`
Expected: 0 errors。

- [ ] **Step 2.7: lint 通过**

Run: `npm run lint`
Expected: 0 errors / warnings。

- [ ] **Step 2.8: commit**

```bash
git add src/components/review/DesignerCommentHandlingPanel.vue
git commit -m "feat(review): split DesignerCommentHandlingPanel into 3 states (RUS-244 Fix 1)"
```

---

## Task 3: embedContextRestore 入口收紧

**Files:**

- Modify: `src/components/review/embedContextRestore.ts:136-145`

- [ ] **Step 3.1: 修改 shouldOpenDesignerCommentHandling**

```ts
// 修改前
const shouldOpenDesignerCommentHandling = options.target === 'designer'
  && (
    (!!result.restoredTask && options.passiveWorkflowMode)
    || (!!result.restoredTask && isCanonicalReturnedTask(result.restoredTask))
  );

// 修改后
const shouldOpenDesignerCommentHandling = options.target === 'designer'
  && !!result.restoredTask
  && isCanonicalReturnedTask(result.restoredTask);
```

- [ ] **Step 3.2: type-check 通过**

Run: `npm run type-check`
Expected: 0 errors。

- [ ] **Step 3.3: lint 通过**

Run: `npm run lint`
Expected: 0 errors / warnings。

- [ ] **Step 3.4: commit**

```bash
git add src/components/review/embedContextRestore.ts
git commit -m "feat(review): tighten embedContextRestore designer entry to isCanonicalReturnedTask (RUS-244 Fix 2)"
```

---

## Task 4: simulator 注入非驳回 task + 三态触发用例

**Files:**

- Modify: `src/debug/pmsReviewSimulatorState.ts`
- Modify: `scripts/pms-simulator-runner.ts`

- [ ] **Step 4.1: 阅读 simulator state 注入入口**

`code src/debug/pmsReviewSimulatorState.ts`
找到 `setReviewTasks` / `setCurrentTaskById` / 类似 helper。确认能注入：

- 非驳回态 task（status=submitted，currentNode=jh）
- 驳回态 task（status=rejected）
- 无 task

- [ ] **Step 4.2: 在 pmsReviewSimulator.ts 增加 force-open 入口**

`src/debug/pmsReviewSimulator.ts` 添加：

```ts
export function forceOpenDesignerCommentHandlingPanel(dockApi: DockApi) {
  dockApi.activatePanel('designerCommentHandling');
  dockApi.openPanel('designerCommentHandling');
}
```

> 若 simulator 已经有等价 helper，复用即可。

- [ ] **Step 4.3: scripts/pms-simulator-runner.ts 增加场景 `rus-244-design-a-ui-empty-state`**

```ts
{
  id: 'rus-244-design-a-ui-empty-state',
  description: 'RUS-244 design-A · 三态拆分 + 入口收紧验收',
  steps: [
    // 状态 1: 驳回态 → panel 显示批注信息
    { kind: 'seed', task: { id: 'task-rejected', status: 'rejected', formId: 'FORM-A-REJECTED' /* ... */ } },
    { kind: 'switchUser', userId: 'SJ' },
    { kind: 'setEmbed', target: 'designer', formId: 'FORM-A-REJECTED', passive: true },
    { kind: 'expect', selector: '[data-testid="designer-state-1"]', visible: true },

    // 状态 2: 非驳回态 + force-open → 显示 NonReturnedGuidanceCard
    { kind: 'seed', task: { id: 'task-submitted', status: 'submitted', formId: 'FORM-A-SUBMITTED', currentNode: 'jh' /* ... */ } },
    { kind: 'setEmbed', target: 'designer', formId: 'FORM-A-SUBMITTED', passive: true },
    { kind: 'expect', panelOpened: 'designerCommentHandling', toBe: false }, // 入口收紧
    { kind: 'forceOpenPanel', id: 'designerCommentHandling' },
    { kind: 'expect', selector: '.non-returned-guidance-card', visible: true }, // UI 兜底

    // 状态 3: 清空 task + force-open → 显示无任务空态
    { kind: 'clearCurrentTask' },
    { kind: 'forceOpenPanel', id: 'designerCommentHandling' },
    { kind: 'expect', selector: '.no-task-empty-state', visible: true },
  ],
}
```

> 具体 DSL 字段名按 `pms-simulator-runner.ts` 现有风格调整；上面伪代码用作语义参考。

- [ ] **Step 4.4: 模板里加 data-testid（仅状态 1 加）**

`DesignerCommentHandlingPanel.vue` 状态 1 最外层包一层 `<div data-testid="designer-state-1">`。其余两态用 class（`.non-returned-guidance-card` / `.no-task-empty-state`）已可被 simulator 选中。

- [ ] **Step 4.5: type-check 通过**

Run: `npm run type-check`
Expected: 0 errors。

- [ ] **Step 4.6: 跑 simulator**

Run: `npm run test:pms:simulator -- --case rus-244-design-a-ui-empty-state`
Expected: 三态全 PASS（状态 1 / 2 / 3）+ 入口收紧（`panelOpened=false`）PASS。

- [ ] **Step 4.7: commit**

```bash
git add src/debug/pmsReviewSimulator.ts src/debug/pmsReviewSimulatorState.ts scripts/pms-simulator-runner.ts src/components/review/DesignerCommentHandlingPanel.vue
git commit -m "test(pms-simulator): add rus-244-design-a-ui-empty-state acceptance case"
```

---

## Task 5: 真实 PMS CDP 回归

**Files:** 无（验证任务）

- [ ] **Step 5.1: 准备环境变量**

```powershell
$env:PMS_E2E_PASSWORD='Admin@1234'
$env:PMS_EMBEDDED_SITE_SUBSTRING='powerpms.net:1801'
```

- [ ] **Step 5.2: 跑 SJ 全流程 CDP**

Run: `npm run test:pms:cdp`
Expected: SJ 全流程 6/6 PASS（design-A 不破坏既有 sj 路径）。

- [ ] **Step 5.3: 跑 JH 校核扩展 CDP**

Run: `npm run test:pms:cdp:extended`
Expected: JH 校核 / 提交 流程 PASS（design-A 不影响校核侧）。

- [ ] **Step 5.4: 实地复现 RUS-244 报告人现场**

打开 `http://pms.powerpms.net:1801/sysin.html` 用 SJ 账号登录 → 三维校审单 → 找一份非驳回单据双击 → 应**不再 force-open** 批注 panel；如果手动打开应看到引导卡。

- [ ] **Step 5.5: 记录验证结果到 docs/verification**

新建 `docs/verification/2026-05-07-rus-244-design-a.md`，附：

- simulator 截图 + 输出片段
- CDP report 关键日志
- 手工复现的 PMS URL + 用户 + 单据 + 截图
- 通过/失败结论

- [ ] **Step 5.6: commit**

```bash
git add docs/verification/2026-05-07-rus-244-design-a.md
git commit -m "docs(verification): RUS-244 design-A simulator + CDP + 真实 PMS 验收"
```

---

## Task 6: PR 提交与 RUS-244 状态更新

**Files:** 无（流程任务）

- [ ] **Step 6.1: 准备 PR 描述**

按 `plant3d-web/CLAUDE.md` 的提交规范，PR 标题：

```
feat(review): RUS-244 design-A · UI 空态拆解 + embedContextRestore 入口收紧
```

PR body 模板：

```markdown
## Why
RUS-244 评论 7f5095f0 4-fix 拆分中的 Fix 1+2（Mode A 口径分裂）。PMS 嵌入下设计人员打开非驳回单据时 panel 渲染空白，用户误以为批注丢失。

## What
- DesignerCommentHandlingPanel 三态分支（驳回 / 非驳回引导 / 无任务）
- NonReturnedGuidanceCard 新组件
- embedContextRestore.shouldOpenDesignerCommentHandling 去 passive 旁路，统一 isCanonicalReturnedTask

## Verify
1. npm run type-check ✅
2. npm run lint ✅
3. npm run test:pms:simulator -- --case rus-244-design-a-ui-empty-state ✅
4. npm run test:pms:cdp ✅
5. 真实 PMS 复现 → docs/verification/2026-05-07-rus-244-design-a.md

## Refs
- Spec: docs/superpowers/specs/2026-05-07-rus-244-fix-design-a-ui-empty-state.md
- Plan: docs/superpowers/plans/2026-05-07-rus-244-design-a-ui-empty-state.md
- Linear: RUS-244
```

- [ ] **Step 6.2: 推送分支并创建 PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(review): RUS-244 design-A · UI 空态拆解 + embedContextRestore 入口收紧" --body-file <PR_BODY_FILE>
```

- [ ] **Step 6.3: 更新 RUS-244 Linear 状态**

在 RUS-244 评论附 PR 链接 + design-A spec / plan 路径；Linear status 保持 In Progress 直到 PR merge。

---

## 工时估算（中位）

| Task | 估时 |
|---|---|
| Task 1 NonReturnedGuidanceCard | 0.5 h |
| Task 2 三态拆分 | 1.5 h |
| Task 3 入口收紧 | 0.3 h |
| Task 4 simulator 用例 | 1.5 h |
| Task 5 CDP 回归 + 真实 PMS | 1.5 h |
| Task 6 PR | 0.5 h |
| **合计** | **~6 h** |

---

## 验证 milestone

| Milestone | 通过条件 |
|---|---|
| M1 组件就位 | Task 1 完成（NonReturnedGuidanceCard + type-check） |
| M2 三态可见 | Task 2 完成（panel 模板三态分支 + type-check） |
| M3 入口收紧 | Task 3 完成（embedContextRestore 改动） |
| M4 simulator 通过 | Task 4 PASS |
| M5 CDP 通过 + 真实 PMS 不复现 | Task 5 PASS + 验证文档归档 |
| M6 PR merged | Task 6 完成 |

---

## Self-Review

**1. Spec coverage:**

| Spec 章节 | 对应 Task |
|---|---|
| §4 改动清单 | Task 1 (新建) + Task 2 + Task 3 |
| §6.1 模板三态 | Task 2.3 |
| §6.2 currentTask 解除过滤 | Task 2.1 |
| §6.3 embedContextRestore 改动 | Task 3.1 |
| §6.4 NonReturnedGuidanceCard 接口 | Task 1.1 |
| §7 边界 | Task 4.3 simulator 三态用例 |
| §8 验证 V1–V5 | Task 4.6（simulator 三态 + 入口） |
| §8 验证 V6 type-check | Task 1.2 / 2.6 / 3.2 / 4.5 |
| §8 验证 V7 lint | Task 1.3 / 2.7 / 3.3 |
| §8 验证 V8 sj CDP | Task 5.2 |
| §8 验证 V9 jh CDP | Task 5.3 |
| §11 R3 下游 computed 守卫 | Task 2.5 |
| §12 关联文件 | 全部 Task 路径已对齐 |

**2. Placeholder scan:** 仅文案占位（NonReturnedGuidanceCard 描述），实施时找产品过；无 TBD / TODO 留在步骤里。

**3. Type consistency:** `isCanonicalReturnedTask` / `currentTask` / `goToReviewPanel` / `NonReturnedGuidanceCard` 名称跨 Task 一致。Task 1 定义的组件 emit `navigate-to-review` 与 Task 2.3 模板事件名一致。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-07-rus-244-design-a-ui-empty-state.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 每 Task 一个 subagent，两阶段 review，迭代快。

**2. Inline Execution** — 本会话内分批执行，checkpoint review。

待用户选择执行方式。
