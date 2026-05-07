# RUS-244 修复 design-A · UI 空态拆解 + embedContextRestore 入口收紧

> **日期**：2026-05-07
> **状态**：待用户评审
> **范围**：plant3d-web 内部，2 个文件改动
> **关联 issue**：RUS-244（评论 `7f5095f0` 4-fix 拆分中的 Fix 1+2 子集）
> **关联文件**：`docs/superpowers/specs/2026-05-07-pms-returned-review-empty-state-design.md`（早期身份别名假设方向，已被进一步排查取代，保留为历史推演）
> **关联 plan**：`docs/plans/2026-05-07-pms-simulator-review-flow-automation-plan.md`、`docs/plans/2026-05-07-pms-simulator-automation-followup-plan.md`

---

## 0. 与既有 spec 的关系

既有 `2026-05-07-pms-returned-review-empty-state-design.md` 假设根因是 PMS token 用户（`U020`）与内部任务 `requesterId`（`SJ`）的别名差异，方案聚焦 `form_id` 强绑定查询。该方向**未被进一步排查证实**——RUS-244 后续深度排查（评论 `7f5095f0`）确认真实根因是 3 个失败模式叠加：

- **Mode A · 口径分裂（中心根因）**：`embedContextRestore.ts` 在 `passiveWorkflowMode` 下无条件 force-open `DesignerCommentHandlingPanel`，但 panel 内部 `currentTask` computed 二次过滤 `isCanonicalReturnedTask`，两层口径不一致 → 非驳回 task 被 force-open 后渲染空白。
- **Mode B · 校核流转入库缺失**：`ReviewPanel.handleReturnToNode` 在 `isPassiveWorkflow` 早返回 + `confirmCurrentData` 仅手动调，导致 PMS 嵌入下校核走 PMS 工具栏驳回时，plant3d 这边 batch 保存路径不被触发。
- **Mode C · 跨平台同步缺位**：`DockLayout.vue` 的 postMessage 桥仅出站，没有 PMS → plant3d 的 `workflow_action` 入站。

本 design-A **仅覆盖 Mode A 的 UI 层修复（Fix 1+2）**：

- Fix 1 = `DesignerCommentHandlingPanel.vue` 拆 3 态（驳回 / 非驳回引导 / 无任务）
- Fix 2 = `embedContextRestore.ts` 入口去掉 passive 旁路，统一走 `isCanonicalReturnedTask` 过滤

Mode B 和 Mode C 由 design-B（`docs/superpowers/specs/2026-05-07-pms-cross-platform-workflow-sync-design.md`）覆盖（已存在并完成 4-fix 映射修订）。

---

## 1. 一句话定位

让 PMS 嵌入下设计人员打开被驳回单据时，**要么看到批注信息（驳回态），要么看到明确引导空态（非驳回态），永不看到无意义空白**；并把"是否驳回态"这一判定的单一事实源固定在 `reviewTaskFilters.ts::isCanonicalReturnedTask`，消除入口与显示层的口径分裂。

---

## 2. 背景

### 2.1 现场

- PMS「三维校审单」列表点开任意单据 → plant3d 嵌入页 → `DesignerCommentHandlingPanel` 直接打开
- 若被打开的 task 不是驳回态（`status != rejected` 且 `currentNode != sj+draft`），panel 渲染**完全空白**（无标题、无批注、无原因），用户误以为"批注被吃了"
- 截图 RUS-244 报告人观察：FORM-FB4EF9F13DF1 在某些角色下空白，在其他角色下正常

### 2.2 现状代码（关键 5 段）

| 文件 | 行 | 现状 |
|---|---|---|
| `src/components/review/DesignerCommentHandlingPanel.vue` | 117–121 | `currentTask` computed 用 `isCanonicalReturnedTask` 二次过滤，非驳回 → null |
| `src/components/review/embedContextRestore.ts` | 136–145 | `shouldOpenDesignerCommentHandling` 在 `passiveWorkflowMode` 下**无条件**为 designer 打开 panel |
| `src/components/review/reviewTaskFilters.ts` | 58–67 | `isCanonicalReturnedTask` 是稳定的事实源（多处复用） |
| `src/components/review/ReviewPanel.vue` | 631 | `handleReturnToNode` 在 `isPassiveWorkflow` 早返回（design-B 覆盖） |
| `src/components/DockLayout.vue` | 241–307 | postMessage handler 只接 `ping` / `select_refno`，无 `workflow_action` 入站（design-B 覆盖） |

### 2.3 关联事故

- 早期 spec `2026-05-07-pms-returned-review-empty-state-design.md` §3 提出的"身份别名（U020 vs SJ）"假设，CDP 验证后**未发现稳定别名差异**；空白的真实触发点是 Mode A 的口径分裂（passive 入口放行 + UI 层过滤）
- 与 RUS-244 评论 `7f5095f0` 给出的 4-fix 拆分对齐

---

## 3. 失败模式（仅 Mode A）

### 3.1 复现条件

| 条件 | 必需性 |
|---|---|
| `embedModeParams.isEmbedMode = true` 且 `embedTokenVerified = true` | 必需 |
| 进入路径 `target = designer`、`passiveWorkflowMode = true` | 必需 |
| URL `form_id` 命中的 task 满足 `restoredTask != null` 但 `isCanonicalReturnedTask(restoredTask) === false`（如 task 状态为 `submitted`、`approved`、`in_review`，或 currentNode != sj） | 触发 |

### 3.2 期望与实际

| 维度 | 期望 | 实际（修复前） |
|---|---|---|
| panel 是否打开 | 仅驳回态打开；非驳回态走默认 landing | 任意 task force-open |
| 非驳回 task 被打开后 panel 渲染 | 给明确引导（"该任务非驳回态"） | **完全空白** |
| 用户认知 | 知道"该单据不需要在这里处理批注" | 误以为"批注丢失 / 系统坏了" |

### 3.3 影响

- 所有从 PMS 嵌入入 plant3d 的设计人员路径
- 用户支持负担（误报"批注丢失"）
- 后续修复（design-B 同步桥）依赖 panel 三态行为稳定

---

## 4. 改动清单

| 文件 | 改动类型 | 行数估算 |
|---|---|---|
| `src/components/review/DesignerCommentHandlingPanel.vue` | currentTask computed 解除过滤；模板加 3 态 v-if 分支；新增 NonReturnedGuidanceCard 组件（行内或独立） | +30 / -3 |
| `src/components/review/embedContextRestore.ts` | `shouldOpenDesignerCommentHandling` 去掉 passive 旁路 | +1 / -3 |
| **不动**：`reviewTaskFilters.ts` | 事实源稳定 | 0 |
| **不动**：`ReviewPanel.vue` / `DockLayout.vue` / `useReviewStore.ts` / `useUserStore.ts` | design-B 范围 | 0 |

---

## 5. 数据流（A3 vs 当前）

### 当前（断裂）

```
PMS 嵌入 → DockLayout.restoreEmbedWorkbenchContext
  → embedContextRestore.shouldOpenDesignerCommentHandling
    = (designer && passiveWorkflowMode && restoredTask)  ← passive 旁路
      || (designer && isCanonicalReturnedTask(restoredTask))
  → force-open DesignerCommentHandlingPanel
  → panel.currentTask computed
    = isCanonicalReturnedTask(reviewStore.currentTask) ? task : null  ← UI 层二次过滤
  → null → 模板渲染空白 ❌
```

### A3（对齐）

```
PMS 嵌入 → DockLayout.restoreEmbedWorkbenchContext
  → embedContextRestore.shouldOpenDesignerCommentHandling
    = designer && restoredTask && isCanonicalReturnedTask(restoredTask)  ← 单一过滤
  ├─ true  → force-open panel → currentTask = task → 状态 1 渲染原批注/驳回信息 ✅
  └─ false → 走 default landing (ReviewPanel 等) ← 入口不强开批注 panel
            + UI 兜底：若任何路径（手动 click / 第三方调度 / 未来扩展）
                     再次 force-open → panel.currentTask = task
                     → 模板按 isCanonicalReturnedTask 渲染状态 2 引导卡 ✅
```

---

## 6. 接口契约

### 6.1 `DesignerCommentHandlingPanel.vue` 模板三态

```vue
<template>
  <div class="designer-comment-handling-panel">
    <!-- 状态 1: 驳回态任务 -->
    <template v-if="currentTask && isCanonicalReturnedTask(currentTask)">
      <!-- 既有批注/驳回信息渲染（原模板内容） -->
    </template>

    <!-- 状态 2: 非驳回态任务 → 引导空态 -->
    <template v-else-if="currentTask">
      <NonReturnedGuidanceCard
        :task="currentTask"
        @navigate-to-review="goToReviewPanel"
      />
    </template>

    <!-- 状态 3: 无选中任务 -->
    <template v-else>
      <NoTaskEmptyState />
    </template>
  </div>
</template>
```

### 6.2 `currentTask` computed 解除过滤

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

> `isCanonicalReturnedTask` 判定挪到模板 v-if 与 `returnedMetadata` / `currentTaskStatus` 等下游 computed 中按需调用，保留原有显示行为。

### 6.3 `embedContextRestore.ts` 改动

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

### 6.4 `NonReturnedGuidanceCard` 组件接口（新增，行内或独立 SFC）

```ts
interface Props {
  task: ReviewTask;
}
emit: 'navigate-to-review': []
```

文案占位（提交前找产品过）：

```
标题：当前任务暂未触发驳回流程
描述：该单据当前节点 ${currentNode}，状态 ${status}。
      若需要查看或处理审查记录，请前往「我的审查工作台」。
按钮：前往审查工作台
```

---

## 7. 错误处理 / 边界

| 场景 | currentTask | shouldOpenPanel | 渲染状态 |
|---|---|---|---|
| `restoredTask = null`（formId 未匹配） | null | false | 不开 panel；若被 manual open，状态 3 |
| 非驳回态 task | task | false | 不开 panel；若被绕过 open，状态 2 引导 |
| 驳回态 task | task | true | 状态 1（原行为） |
| panel 已开后 task 被 store 更新为非驳回态 | task | — | 自动切到状态 2（响应式） |
| panel 已开后 task 被清空 | null | — | 自动切到状态 3 |

> design-B 上线后 PMS workflow_action 入站会触发 task 状态更新，状态 1 ↔ 2 ↔ 3 切换通过 reactive 自动完成，无需 design-A 代码额外处理。

---

## 8. 验证策略

按 plant3d-web AGENTS.md 优先 CLI + 真实 web_server + simulator：

| 测试 ID | 工具 | 步骤 | 通过条件 |
|---|---|---|---|
| V1 状态 1 渲染 | `npm run test:pms:simulator` | sj 角色打开驳回 task | panel 显示批注、驳回原因（原有行为） |
| V2 状态 2 渲染 | simulator 注入非驳回 task + 手动 open panel | 修改 simulator 让 currentTask 为 submitted task | panel 显示 `NonReturnedGuidanceCard` 引导卡 |
| V3 状态 3 渲染 | simulator 不选 task + 手动 open panel | 清空 currentTask | panel 显示 `NoTaskEmptyState` |
| V4 入口收紧 | simulator 选非驳回 task | embedContextRestore.target=designer | panel 不被强开，落到 ReviewPanel default landing |
| V5 入口对齐 | simulator 选驳回 task | embedContextRestore.target=designer + passive | panel 被强开 + 状态 1 |
| V6 类型检查 | `npm run type-check` | — | 0 errors |
| V7 lint | `npm run lint` | — | 0 errors / warnings |
| V8 sj 角色回归 | `npm run test:pms:cdp` SJ 全流程 | — | 6/6 PASS |
| V9 jh 角色回归 | `npm run test:pms:cdp:extended` JH 校核 | — | 校核 → 提交按钮路径不变 |

> V2/V3/V4 需在 simulator 增强（注入 currentTask 状态 + 手动 panel open trigger），可作为本 design-A 实施时的 simulator 改动配套，落到同 PR 或独立 PR。

---

## 9. 风险登记

| ID | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | `NonReturnedGuidanceCard` 文案与产品语调不一致 | 中 | UX 评价低 | spec 中标记占位；提交前找产品同学过文案；保留可改空间 |
| R2 | 入口收紧后 passive mode 默认 landing（ReviewPanel）在嵌入下渲染异常 | 低 | 用户进入死胡同 | 实施前手动 simulator 验证 ReviewPanel 在 passive + designer 下的渲染；如不可用则补 fallback |
| R3 | `currentTask` computed 解除过滤后，下游 `currentTaskStatus` / `returnedMetadata` / `latestReturnTimestamp` 等 computed 在非驳回 task 下出现错误显示 | 中 | 状态 2 渲染异常 | 状态 2 模板不复用这些 computed；只在状态 1 模板分支内复用；模板分支严格隔离 |
| R4 | 与 design-B 上线后 panel 状态切换抖动 | 低 | UX 抖动 | design-B 写时确保 PMS workflow_action 入站后 task store 原子更新；design-A 不引入额外 lifecycle 副作用 |
| R5 | 历史代码假设 `currentTask` 一定是驳回态 task（其他依赖此 panel 的代码可能误用） | 中 | 既有逻辑回归 | grep `currentTask`（在 panel 内）确认所有用法都在状态 1 模板分支内；不在分支内的统一加 `isCanonicalReturnedTask` 守卫 |

---

## 10. YAGNI（本 design 不做）

- 不动 `reviewTaskFilters.ts`（事实源稳定）
- 不动 `ReviewPanel.handleReturnToNode` 与 DockLayout 入站桥（design-B 范围）
- 不引入新的 store 字段或新组件库依赖（NonReturnedGuidanceCard 用现有 Vuetify / Tailwind 即可）
- 不改 PMS 端代码、不改后端 API 契约
- 不引入 `form_id` 强绑定查询（早期 spec 思路，本 design 不重启）
- 不写新单元测试（按 AGENTS.md，simulator + CLI 验证为准）；只在 V6/V7 阶段过 type-check + lint

---

## 11. 决策检查点

| 节点 | 何时 | 决策项 |
|---|---|---|
| Pre-write | 本 spec 评审 | A3 方向是否合适、文案占位是否可接受 |
| Mid-impl | currentTask 解除过滤后 | 下游 computed 是否仍稳定（R3） |
| Post-V4 | 入口收紧首次跑 simulator | passive default landing 是否合理（R2） |
| Pre-merge | V1–V8 全过 | 提交前找产品过文案（R1） |
| Post-merge | 上线后 1 周 | 用户反馈 + monitor "批注丢失" 工单是否清零 |

---

## 12. 关联文件

```
plant3d-web/
├── src/components/review/
│   ├── DesignerCommentHandlingPanel.vue    # Fix 1 主战场
│   ├── embedContextRestore.ts              # Fix 2 主战场
│   ├── reviewTaskFilters.ts                # 事实源（不动）
│   ├── ReviewPanel.vue                     # design-B 范围（不动）
│   └── embedRoleLanding.ts                 # default landing 行为（验证 R2 用）
├── src/components/
│   └── DockLayout.vue                      # design-B 范围（不动）
├── docs/superpowers/specs/
│   ├── 2026-05-07-rus-244-fix-design-a-ui-empty-state.md  # 本文件 · design-A
│   ├── 2026-05-07-pms-cross-platform-workflow-sync-design.md  # design-B (Fix 3+4)
│   └── 2026-05-07-pms-returned-review-empty-state-design.md  # 早期身份别名假设（保留）
└── docs/plans/
    ├── 2026-05-07-pms-simulator-review-flow-automation-plan.md
    └── 2026-05-07-pms-simulator-automation-followup-plan.md
```

---

## 13. 上线后观察项

- "批注丢失"用户反馈频次（应 → 0）
- panel 三态渲染分布（监控 / 日志埋点可选；本 design 不强制）
- design-B 上线前 panel 是否出现状态 2/3 异常切换（log 兜底）

---

## 14. 下一步

1. 用户评审本 spec → approve / 修订
2. design-B 复用既有 `2026-05-07-pms-cross-platform-workflow-sync-design.md`（已修订 4-fix 映射 + 与本 design-A 双向交叉引用）
3. 两份 design 都 approve 后，调用 superpowers `writing-plans` skill 产出实施 plan，再分 PR 实施
