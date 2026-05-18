# 审核面板批注表格视图 form_id 收敛 · 实施计划 · 2026-05-18

> 上一轮 `docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` 在审核员工作台（`ReviewPanel.vue`）回填了「卡片列表 ⇄ 批注表格」切换。本轮补一个紧贴的可见性 bug：**批注表格分支没有按 `form_id` 收敛**，在 SJ 经 PMS 进入驳回单据这条主链路上，切到表格视图会泄露其它单据的批注；卡片列表却会正确收敛——同一个面板出现两种 scope 行为，违反 `.plannotator/plan-sj-reject-ui.md` §6 的「UI 不显示跨单据批注」约定。
>
> **执行者：** 任意熟悉 Vue 3 + Vitest 的工程师 / agent。每个 Task 内步骤 ≈ 5 分钟，TDD + 高频 commit。
> **范围：** 单仓 `plant3d-web`，**不**触 `plant-model-gen` 或 `rs-core`。
> **关键依赖：** 上一轮 v-if 可见性修复已落地（split / table tab 在有 `currentTask` 时即可见，表格区不依赖 `count > 0`）；`scopeAnnotationWorkspaceItemsByFormId` helper 已存在并被 `DesignerCommentHandlingPanel.vue` 使用。

---

## 0. 背景

### 0.1 现象

- 角色：审核员（jh / sh / pz）或被收敛到 ReviewPanel 的 SJ（外部 PMS 流程驳回单据，参见 `.plannotator/plan-sj-reject-ui.md`）
- 操作路径：从 PMS 入口 / Ribbon `panel.review` 打开当前 `form_id` 对应的单据 → 切到「批注表格」视图
- 期望：表格视图只显示当前 `form_id` / `currentTask` 关联的批注
- 实际：表格视图列出 `toolStore.annotations / cloudAnnotations / rectAnnotations / obbAnnotations` **全集**，把其它单据的批注一并展示
- 对比：同一个面板的「卡片列表」视图（split）会按 `form_id` 收敛，行为不一致

### 0.2 根因（精确到行号）

`src/components/review/ReviewPanel.vue` 当前 HEAD：

- 第 1355–1424 行 `allAnnotationItems`（喂给卡片列表 split 视图）：
  ```ts
  const scopedFormId = isExternalSjFormFocused.value ? activeReviewFormId.value : null;
  const shouldIncludeRecord = (record: { formId?: string }) => {
    if (!scopedFormId) return true;
    return normalizeFormId(record.formId) === scopedFormId;
  };
  for (const a of toolStore.annotations.value) {
    if (!shouldIncludeRecord(a)) continue;
    ...
  }
  ```
  → 在 SJ 外部 form_id 聚焦模式下按 `form_id` 严格过滤，其它模式放行全集

- 第 1429–1442 行 `annotationWorkspaceItems`（喂给批注表格 table 视图的 `<AnnotationTableView :items="annotationWorkspaceItems" />`）：
  ```ts
  const annotationWorkspaceItems = computed<AnnotationWorkspaceItem[]>(() =>
    buildAnnotationWorkspaceItems({
      annotations: toolStore.annotations.value,
      cloudAnnotations: toolStore.cloudAnnotations.value,
      rectAnnotations: toolStore.rectAnnotations.value,
      obbAnnotations: toolStore.obbAnnotations.value,
      getCommentCount: (type, id) => toolStore.getAnnotationComments(type, id, activeReviewFormId.value ?? undefined, currentTask.value?.id ?? undefined).length,
    }),
  );
  ```
  → **完全不做 form_id 过滤**，直接喂 toolStore 全集

对比 `DesignerCommentHandlingPanel.vue` 第 518–535 行：
```ts
const scopedAnnotationItems = computed<AnnotationWorkspaceItem[]>(() => {
  const currentFormId = currentTask.value?.formId ?? null;
  const externalFormId = externalEntryTarget.value?.formId ?? null;
  let items = scopeAnnotationWorkspaceItemsByFormId(
    allAnnotationItems.value,
    currentFormId || externalFormId || passiveRestoredTaskFormId.value,
  );
  ...
});
```
→ DCH 已经统一在一个 `scopeAnnotationWorkspaceItemsByFormId` 调用里做 form_id 过滤，且 split / detail / 表格三个分支共用同一份 scoped 结果

### 0.3 故障链

```
PMS 入口/Ribbon 触发 panel.review
  → DockLayout 拉起 ReviewPanel（上一轮已支持 status-agnostic + v-if 修复）
    → 切到批注表格视图 (annotationListViewMode = 'table')
      → <AnnotationTableView :items="annotationWorkspaceItems" />
        ← annotationWorkspaceItems 无 form_id 过滤
          → 其它单据的批注被一并渲染
            ← 用户感受：「切到批注表格后看到不属于本单据的批注 / 数量比卡片列表多」
```

### 0.4 关联规约 / 文档

- `.plannotator/plan-sj-reject-ui.md` §6：「校审面板内只看当前 form_id …… 复用 `scopeAnnotationWorkspaceItemsByFormId()` 或等价过滤，保证 UI 不显示跨单据批注」
- `.plannotator/plan-sj-reject-ui.md` §8：测试条目「ReviewPanel.test.ts：匹配任务时只显示当前 form_id 的批注/确认记录」
- `docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` §8 / §11.5：把「数据源对齐」「split 与表格统一 scope」明确归入下一 PR 范围；本计划就是该「下一 PR」之一
- `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md`：上次回归的根因防御规则要求「ReviewPanel + DCH 任意改动必须本地跑 5 套件回归」，本计划同样适用

---

## 1. 目标 / 非目标

### 1.1 目标

1. **行为对齐**：ReviewPanel 批注表格视图与卡片列表视图在 form_id scope 行为上一致。在 SJ 外部 form_id 聚焦模式下，表格视图只显示当前 `form_id` 关联的批注。
2. **代码对齐**：复用 `scopeAnnotationWorkspaceItemsByFormId` helper，消除 ReviewPanel 内手写过滤与 helper 的双轨。
3. **回归守护**：补 vitest 用例锁定 form_id scope 行为，覆盖 SJ 外部、非聚焦、`activeReviewFormId` 为空三种状态。
4. **不引入新 fail**：双胞胎面板的 5 套件回归（AGENTS.md 规定）相对 baseline 不新增 fail。
5. **不增加文档碎片**：把本次 fix 在 `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` 末尾追加「2026-05-18 补丁」一节，不再单开 ADR。

### 1.2 非目标

- **不**改卡片列表视图本身的 scope 实现（行 1355–1424 的 `allAnnotationItems` 保持手写，作为可控的局部行为）
- **不**改 `AnnotationTableView.vue`、`DesignerCommentHandlingPanel.vue`、`annotationWorkspaceModel.ts` 的对外签名
- **不**改 ribbon 按钮、DockLayout 路由、reviewerWorkbenchViewModeBus
- **不**同时把审核员（非 SJ）的 form_id scope 默认开启（见 §2 决策 A1 vs A2）
- **不**碰 `DesignerCommentHandlingPanel.vue` 的未提交修改（在另一条线，避免本次 PR 跨范围）
- **不**清理 ReviewPanel.test.ts 历史 fail（属另一项目）

---

## 2. 架构方案与决策

### 2.1 候选方案

| 方案 | 描述 | 优势 | 劣势 |
|---|---|---|---|
| **A1 · 与 `allAnnotationItems` 行为一致**（推荐） | `annotationWorkspaceItems` 在 `isExternalSjFormFocused.value` 时按 `activeReviewFormId` 过滤；其它模式放行全集 | 最小侵入；行为与 split 视图严格一致；不引入审核员侧的 scope 行为变化 | 与 DCH 实现略有差异（DCH 不分角色都过滤） |
| A2 · 与 DCH 对齐（更严格） | 只要 `currentTask.formId / activeReviewFormId` 存在就过滤；不区分角色 | 实现统一；语义最干净 | 审核员侧默认行为变化，可能撞 ReviewPanel.test.ts 现有用例；需额外评估回归面 |
| A3 · 抽 composable 让 split / table 共用 | 新增 `useReviewerScopedAnnotations()` composable | 长期最干净 | 当前 ReviewPanel 数据结构尚未对齐（split 用本地 `AnnotationListItem`，table 用 `AnnotationWorkspaceItem`），抽 composable 需要先做类型统一，超本次范围 |

### 2.2 选定方案：A1

理由：
- 上一轮 (`2026-05-17-...restore-plan.md`) 已定 ADR：方案 A 系列「最小侵入」；本计划延续
- 本次只补已经被识别为 bug 的 form_id 不一致；不主动扩散到其它模式
- 不会撞 ReviewPanel.test.ts 现有用例的隐含假设
- 后续若需走 A2，本方案是 A2 的子集，可平滑演进（只需把分支条件放宽）

### 2.3 关键边界

- `isExternalSjFormFocused.value` 当前定义（行 218–222）：`isPassiveWorkflow && persistedWorkflowRole === 'sj' && !!activeReviewFormId`。本计划复用这个开关，**不**改动它的定义。
- 表格视图的过滤复用 `scopeAnnotationWorkspaceItemsByFormId(items, formId)` helper（默认 `includeUnbound: false`，与 DCH 一致）。
- `getCommentCount` 仍传 `activeReviewFormId.value ?? undefined`、`currentTask.value?.id ?? undefined`，不变；评论计数本身已经按 form_id / taskId scope。

---

## 3. 文件级变更清单

| 文件 | 操作 | 估算行数 | 责任 |
|---|---|---|---|
| `src/components/review/ReviewPanel.vue` | 修改 | +14 / −2 | 在 `annotationWorkspaceItems` computed 内插入 `scopeAnnotationWorkspaceItemsByFormId` 调用 + 必要 import |
| `src/components/review/ReviewPanel.test.ts` | 修改 | +90 / −0 | 新增 3 条 form_id scope 用例（SJ 聚焦过滤 / 非聚焦放行 / formId 为空放行） |
| `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` | 修改 | +30 / −0 | 末尾追加「2026-05-18 补丁：表格视图 form_id scope 修复」一节 |
| `CHANGELOG.md` | 修改 | +5 | Unreleased 段加一条 fix |

⚠ **不修改的文件**（明确范围）：`AnnotationTableView.vue` / `annotationWorkspaceModel.ts` / `DesignerCommentHandlingPanel.vue` / `DockLayout.vue` / `ribbonConfig.ts` / `reviewerWorkbenchViewModeBus.ts` / `AGENTS.md`（已经写过双胞胎面板回归条款）。

---

## 4. 实施步骤（TDD · 每步可独立 commit）

### Task 1 · 跑 baseline，锁住「不新增 fail」基线

**Files:** 无修改

- [ ] **Step 1.1 · 跑 ReviewPanel.test.ts baseline**

```bash
npx vitest run src/components/review/ReviewPanel.test.ts 2>&1 | tee .tmp-vitest-baseline-review.txt
```

预期：与 `2026-05-17-...restore-plan.md` §11.3 一致，约 15 fail / 19 pass（具体数字可能因 progress 已有 commit 而变化，以 baseline log 为准）。把 pass/fail 数写入 progress.context。

- [ ] **Step 1.2 · 跑双胞胎面板 5 套件 baseline**

```bash
npx vitest run \
  src/components/review/ReviewPanel.test.ts \
  src/components/review/DesignerCommentHandlingPanel.test.ts \
  src/components/review/AnnotationTableView.test.ts \
  src/components/review/reviewerWorkbenchViewModeBus.test.ts \
  src/components/review/annotationWorkspaceModel.test.ts \
  2>&1 | tee .tmp-vitest-baseline-twin.txt
```

记录 baseline pass / fail 数到 progress；后续 after 必须与之相等或更优。

- [ ] **Step 1.3 · type-check baseline**

```bash
npm run type-check 2>&1 | tee .tmp-typecheck-baseline.txt
```

预期：0 error；如有 error 则与本次无关，先单独修后再继续。

### Task 2 · 加测试用例（先 RED）

**Files:**
- Modify: `src/components/review/ReviewPanel.test.ts`

- [ ] **Step 2.1 · 阅读现有 SJ 外部 form_id 测试 setup**

```bash
rg -n "isExternalSjFormFocused|activeReviewFormId|persistedEmbedParams|workflowRole" src/components/review/ReviewPanel.test.ts
```

定位现有 setup 用了哪种 mock 方式（`vi.mock('@/composables/useReviewStore')` / props / window state），复用同样的 mock 路径，**禁止**新建第二种 mock 风格。

- [ ] **Step 2.2 · 新增 describe block 「批注表格视图 form_id scope」**

在 `ReviewPanel.test.ts` 末尾追加：

```ts
describe('批注表格视图 form_id scope（2026-05-18 补丁）', () => {
  it('SJ 外部 form_id 聚焦模式下，annotationWorkspaceItems 只包含当前 form_id 的批注', async () => {
    // 1. 准备 toolStore：3 条 text annotation，其中 2 条 formId='FORM-A'，1 条 formId='FORM-B'
    // 2. 模拟 isExternalSjFormFocused=true，activeReviewFormId='FORM-A'
    //    （通过 mock useReviewStore.currentTask.formId='FORM-A' + persistedEmbedParams.workflowRole='sj' + isPassiveWorkflow=true）
    // 3. mount ReviewPanel；点击「批注表格」tab
    // 4. expect: <AnnotationTableView> 收到 :items 长度 = 2，且都是 formId='FORM-A'
    // 5. expect: 卡片列表（如果切回）同样 2 条（行为一致）
  });

  it('非 SJ 外部 form_id 聚焦模式下（如 reviewer），annotationWorkspaceItems 仍包含全部批注（与现有 baseline 行为一致）', async () => {
    // 1. 准备 toolStore：3 条 annotation，2 条 formId='FORM-A'，1 条 formId='FORM-B'
    // 2. 模拟 reviewer 角色，isExternalSjFormFocused=false
    // 3. mount ReviewPanel；切到表格 tab
    // 4. expect: items 长度 = 3
  });

  it('activeReviewFormId 为空时（SJ 外部 form_id 模式未生效），annotationWorkspaceItems 不被收敛', async () => {
    // 1. 准备 toolStore：3 条 annotation，formId 不一
    // 2. 模拟 isPassiveWorkflow=true + workflowRole='sj' + 但 form_id 解析失败 → isExternalSjFormFocused=false
    // 3. mount ReviewPanel；切到表格 tab
    // 4. expect: items 长度 = 3
  });
});
```

> ⚠ 具体 mock 写法请按 Step 2.1 调研结果对齐 `ReviewPanel.test.ts` 现有风格（顶部 `vi.mock(...)` + 测试体 `setup` 注入 currentTask）。**不要**复制 DCH 的 mock，因为两者 store wiring 路径不同。

- [ ] **Step 2.3 · 跑测试验证第 1 条 RED，第 2、3 条 GREEN**

```bash
npx vitest run src/components/review/ReviewPanel.test.ts -t "form_id scope" 2>&1 | tee .tmp-vitest-task2-red.txt
```

预期：
- 「SJ 外部 form_id 聚焦模式下 …」 **FAIL**（实际 items=3，期望 2）
- 「非 SJ 外部 …」 **PASS**
- 「activeReviewFormId 为空时 …」 **PASS**

如果第 1 条意外 PASS，说明 mock 没真正打开 `isExternalSjFormFocused`，回到 Step 2.1 复查。

- [ ] **Step 2.4 · commit RED**

```bash
git add src/components/review/ReviewPanel.test.ts
git commit -m "test(review): add form_id scope regression for ReviewPanel annotation table view"
```

---

### Task 3 · 修复 ReviewPanel.vue（GREEN）

**Files:**
- Modify: `src/components/review/ReviewPanel.vue`

- [ ] **Step 3.1 · 加 import**

在现有 import 区追加（紧贴 `buildAnnotationWorkspaceItems` 同源 import）：

```ts
import {
  buildAnnotationWorkspaceItems,
  scopeAnnotationWorkspaceItemsByFormId,
  type AnnotationWorkspaceItem,
} from './annotationWorkspaceModel';
```

> ⚠ 若 `buildAnnotationWorkspaceItems` 当前是 `import { buildAnnotationWorkspaceItems } from './annotationWorkspaceModel'` 单导，扩展为命名导入即可；保持 `AnnotationWorkspaceItem` 类型 import 原样。

- [ ] **Step 3.2 · 改 `annotationWorkspaceItems` computed**

把第 1429–1442 行整体替换为：

```ts
const annotationWorkspaceItems = computed<AnnotationWorkspaceItem[]>(() => {
  const allItems = buildAnnotationWorkspaceItems({
    annotations: toolStore.annotations.value,
    cloudAnnotations: toolStore.cloudAnnotations.value,
    rectAnnotations: toolStore.rectAnnotations.value,
    obbAnnotations: toolStore.obbAnnotations.value,
    getCommentCount: (type, id) => toolStore.getAnnotationComments(
      type,
      id,
      activeReviewFormId.value ?? undefined,
      currentTask.value?.id ?? undefined,
    ).length,
  });

  // form_id 收敛：与 allAnnotationItems（卡片列表）一致，仅在 SJ 外部 form_id 聚焦模式启用。
  // 防止表格视图把其它单据的批注混入，参见
  // .plannotator/plan-sj-reject-ui.md §6 / docs/plans/2026-05-18-reviewer-annotation-table-formid-scope-plan.md
  if (!isExternalSjFormFocused.value) return allItems;
  return scopeAnnotationWorkspaceItemsByFormId(allItems, activeReviewFormId.value);
});
```

> ⚠ 注释中保留两个文档锚点，方便后续 grep 追踪到这里曾按 §6 收敛过。

- [ ] **Step 3.3 · 跑目标测试验证 GREEN**

```bash
npx vitest run src/components/review/ReviewPanel.test.ts -t "form_id scope" 2>&1 | tee .tmp-vitest-task3-green.txt
```

预期：3 条全部 PASS。

- [ ] **Step 3.4 · type-check + lint**

```bash
npm run type-check 2>&1 | tee .tmp-typecheck-task3.txt
npx eslint src/components/review/ReviewPanel.vue
```

预期：0 error / 0 new warning。

- [ ] **Step 3.5 · commit GREEN**

```bash
git add src/components/review/ReviewPanel.vue
git commit -m "fix(review): scope ReviewPanel annotation table by form_id for external SJ rejection flow"
```

---

### Task 4 · 双胞胎面板 5 套件回归（防退化）

**Files:** 无修改

- [ ] **Step 4.1 · 按 AGENTS.md 规定的 5 套件全跑**

```bash
npx vitest run \
  src/components/review/ReviewPanel.test.ts \
  src/components/review/DesignerCommentHandlingPanel.test.ts \
  src/components/review/AnnotationTableView.test.ts \
  src/components/review/reviewerWorkbenchViewModeBus.test.ts \
  src/components/review/annotationWorkspaceModel.test.ts \
  2>&1 | tee .tmp-vitest-after-twin.txt
```

- [ ] **Step 4.2 · 与 baseline 对比**

```bash
diff .tmp-vitest-baseline-twin.txt .tmp-vitest-after-twin.txt | head -80
```

验收标准：**after fail 数 ≤ baseline fail 数**；新增 3 条 form_id scope 用例全部 PASS。如有 after 新增 fail，需立即定位并在 commit 前修复。

- [ ] **Step 4.3 · type-check 全工程**

```bash
npm run type-check
```

预期：0 error。

- [ ] **Step 4.4 · lint 全工程**

```bash
npm run lint
```

预期：0 error；warning 不新增。

---

### Task 5 · 文档 / CHANGELOG

- [ ] **Step 5.1 · 在事故复盘文档末尾追加补丁记录**

打开 `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md`，在最末追加：

```markdown
---

## 2026-05-18 补丁：表格视图 form_id scope 修复

### 现象
2026-05-17 的 v-if 修复让审核面板的批注列表/表格切换变得 status-agnostic，但
`annotationWorkspaceItems` computed 没有 form_id 过滤，在 SJ 外部 PMS 流程
驳回单据上下文里，切到「批注表格」会把其它 form_id 的批注一并显示。

### 根因
`src/components/review/ReviewPanel.vue` 第 1355-1424 行 `allAnnotationItems`
（卡片列表）按 `isExternalSjFormFocused` 走手写过滤，第 1429-1442 行的
`annotationWorkspaceItems`（表格）完全不过滤；两条数据源的 scope 策略
不一致。

### 修复
按 `docs/plans/2026-05-18-reviewer-annotation-table-formid-scope-plan.md`
方案 A1：在 `annotationWorkspaceItems` 末尾追加 `scopeAnnotationWorkspaceItemsByFormId`
调用，复用现有 helper，行为与卡片列表一致。

### 防御
新增 3 条 vitest 用例锁定 form_id scope 行为；双胞胎面板 5 套件回归 baseline
比对要求「不新增 fail」（沿用本 ADR 规则）。
```

- [ ] **Step 5.2 · CHANGELOG**

在 Unreleased 段 Fixed 子段插入：

```markdown
- **review/reviewer-workbench:** scope `<AnnotationTableView>` items by current `form_id` in external SJ rejection flow, aligning with the card list view and `.plannotator/plan-sj-reject-ui.md` §6. 修复审核面板切到「批注表格」时显示其它单据批注的问题。 ([2026-05-18-reviewer-annotation-table-formid-scope-plan])
```

- [ ] **Step 5.3 · commit 文档**

```bash
git add "开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md" \
        docs/plans/2026-05-18-reviewer-annotation-table-formid-scope-plan.md \
        CHANGELOG.md
git commit -m "docs(review): record 2026-05-18 form_id scope patch + plan for reviewer table view"
```

---

## 5. 验收清单（合并前必过）

- [ ] `npm run type-check`：0 error
- [ ] `npm run lint`：0 error，warning 不新增
- [ ] 双胞胎面板 5 套件回归：after fail 数 ≤ baseline fail 数（diff 截图保留）
- [ ] 新增 3 条 form_id scope 用例：全部 PASS
- [ ] 手测路径（任选其一）：
  - 用 PMS 模拟器走 SJ 驳回单据流：`npm run test:pms:cdp` 复现「打开驳回单据 → 切表格 → 只看到当前 form_id 的批注」
  - 或用 `npm run dev`：sj 角色 + URL 带 `form_id` + workflow_role=sj，在浏览器手动切换 split / table，确认两边数量一致
- [ ] CHANGELOG Unreleased 段已更新
- [ ] 事故复盘文档已追加 2026-05-18 补丁节
- [ ] Commit 历史：4 条独立 commit（test / fix / docs · 含 5.3 合并一条；可视 commit 量拆 4–5 条）
- [ ] PR 描述：包含「双胞胎面板回归差量 baseline=X fail / after=Y fail（Y≤X）」与本 plan 文档链接

---

## 6. 风险与缓解

| 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|
| 测试 mock 写法没真正打开 `isExternalSjFormFocused` → RED 错过 → 错过 bug | 高（fix 无效） | 中 | Task 2.3 严格验证 RED；如意外 PASS 必须回到 mock 调研 |
| `scopeAnnotationWorkspaceItemsByFormId` 默认 `includeUnbound: false` 会把无 form_id 的批注一并过滤掉 | 中（旧数据/离线草稿可能消失） | 低 | 与 DCH 行为一致，是 plan-sj-reject-ui.md §6 明确规约；如出现回归，按需在 Step 3.2 显式传 `{ includeUnbound: true }` |
| 把 SJ 模式之外的过滤也提前打开（误升级到 A2） | 中（审核员侧行为变） | 低 | Step 3.2 强制保留 `if (!isExternalSjFormFocused.value) return allItems;` 早返回；code review 守护 |
| 双胞胎面板回归出现新增 fail | 高 | 低 | Task 4.2 比 baseline；任何新增 fail 必须当场定位，不允许「忽略后 commit」 |
| 与 git status 中未提交的 DesignerCommentHandlingPanel.vue 改动相互干扰 | 中 | 中 | 本 plan 不动 DCH 源码；测试套件 4.1 命令包含 DCH，若 DCH 当前 17 fail 不变则相互独立 |
| ReviewPanel.test.ts 现有 mock 不暴露 `isPassiveWorkflow` 开关 | 中 | 中 | Step 2.1 调研结论决定走 vi.mock 还是 store DI；如确实没有 hook，按 progress 记录的方案补 mock 后再写测试 |

---

## 7. 回滚预案

每条 commit 独立可 revert。最坏情况：

```bash
git revert <commit-docs> <commit-fix> <commit-test>
```

回滚后 ReviewPanel 回到「卡片列表收敛、表格不收敛」的当前不一致状态，不影响 DCH、不影响其它面板。

---

## 8. 后续建议（不在本计划范围）

- **下一 PR · A2 升级评估**：若产品确认审核员（jh/sh/pz）也应当默认按 `currentTask.formId` 收敛表格视图，把 Step 3.2 的 `if (!isExternalSjFormFocused.value) return allItems;` 放宽为 `if (!activeReviewFormId.value) return allItems;`，并补审核员侧测试用例 / 回归批准。
- **下一 PR · split 与 table 数据源统一**：把 ReviewPanel 的本地 `AnnotationListItem` 整体迁到 `AnnotationWorkspaceItem`，让 split 视图也走 `scopeAnnotationWorkspaceItemsByFormId`，消除手写 `shouldIncludeRecord` 与 helper 的双轨。对应 `2026-05-17-...restore-plan.md` §8 第 1 项。
- **下一 PR · 共用 composable**：抽 `useReviewerScopedAnnotations()`，让 ReviewPanel / DCH 共用，参见 `2026-05-17-...restore-plan.md` §8 第 2 项。
- **CI 升级**：把 form_id scope 这 3 条用例放进 PR check 必跑列表（与上一轮已规约的「ReviewPanel + DCH 改动必跑 5 套件」并列）。

---

## 9. 关键文件锚点速查

| 用途 | 文件:行 |
|---|---|
| 故障 computed（要改） | `src/components/review/ReviewPanel.vue:1429-1442` |
| 参照实现（卡片列表手写过滤） | `src/components/review/ReviewPanel.vue:1355-1424` |
| 参照实现（DCH 用 helper） | `src/components/review/DesignerCommentHandlingPanel.vue:518-535` |
| 复用的 helper | `src/components/review/annotationWorkspaceModel.ts:306-319` |
| 现有 SJ 外部 form_id 开关 | `src/components/review/ReviewPanel.vue:206-222` |
| 测试入口 | `src/components/review/ReviewPanel.test.ts` |
| 双胞胎面板 5 套件回归命令 | `AGENTS.md`「提交与 Pull Request 规范」段 |
| 关联规约文档 | `.plannotator/plan-sj-reject-ui.md` §6 / §8 |
| 上一轮事故 ADR（要追加补丁节） | `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` |
| 上一轮 restore plan（背景与 §8 后续清单） | `docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` |

---

## 10. 时间估算

| Task | 时间 |
|---|---|
| 1 · Baseline & type-check | 15 min |
| 2 · 写 RED 测试 + commit | 35 min |
| 3 · 修 ReviewPanel.vue + 验证 GREEN + commit | 25 min |
| 4 · 双胞胎 5 套件回归 + lint + type-check | 25 min |
| 5 · 文档 / CHANGELOG / commit | 20 min |
| **合计** | **~2 小时**（含 review buffer） |

---

## 11. 执行记录（占位）

> 实施后按 `2026-05-17-...restore-plan.md` §11 的格式填入：baseline / after 数据、转绿用例明细、仍 fail 用例归因、手测截图路径。

---

> **执行结束后：** 主控 / 用户应当看到审核面板在 SJ 外部 PMS 驳回单据上下文里，切到「批注表格」与「卡片列表」两边显示的批注数量一致、只属于当前 `form_id`；3 条新增测试 + 双胞胎面板 5 套件 baseline 比对，**0 新增 fail**；事故复盘文档追加了 2026-05-18 补丁节，CHANGELOG 同步。
