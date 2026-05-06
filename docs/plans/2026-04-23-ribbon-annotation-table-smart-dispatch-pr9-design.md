# Ribbon 批注表格按钮智能分发 · PR 9 详细设计 · 2026-04-23

> 承接 PR 8（`docs/plans/2026-04-23-reviewer-workbench-annotation-table-pr8-design.md`）：
> Reviewer 工作台已接入批注表格视图。本 PR 让 Ribbon 的 `批注表格` 按钮按"当前已打开面板 → 用户角色"智能分发到对应 dock。

## 0. 动机

PR 4 把 Ribbon `panel.annotationTable` 硬编码路由到 `designerCommentHandling` 面板，对 reviewer（jh / sh / pz / admin）角色：
- 点击按钮**永远打开 DCH 面板**，而不是 `review` 面板
- reviewer 工作台的批注表格视图只能通过"先打开 review panel → 手动切 tab"访问

PR 8 已经补齐了 reviewer 侧的视图能力，缺的是入口。本 PR 让按钮"聪明"一点。

## 1. 目标

- Ribbon `panel.annotationTable` 命令按以下优先级路由：
  1. 若 `review` 面板已打开 → 在 `review` 面板切表格视图
  2. 否则若 `designerCommentHandling` 面板已打开 → 在 DCH 面板切表格视图
  3. 否则按用户角色默认：reviewer（含 admin/manager/checker/approver）→ 开 `review` 面板；designer 或其他 → 开 `designerCommentHandling` 面板
- 新增独立的 `reviewerWorkbenchViewModeBus`（与 DCH bus 同构），保持两个面板对 viewMode 请求通道的**完全隔离**
- 不改 Ribbon 按钮本身（仍然是单个 `panel.annotationTable` 命令），只改 DockLayout 侧的路由分发
- 不改 Ribbon 按钮的 Onboarding 引导（PR 7 已做），文案不变

## 2. 非目标

- **不**新增独立的 reviewer 批注表格按钮（可选延伸留给 PR 10）
- **不**做 Ribbon 按钮的角色可见性（那是 ribbonConfig `visibleWhen` 机制的范畴，留给 PR 10）
- **不**改 DCH / Review panel 本身的内部逻辑（仅加一个 watch）
- **不**为此引入 `useUserStore` 到 DockLayout（已经有）

## 3. 设计

### 3.1 路由决策树

```
命令: panel.annotationTable
  │
  ▼
查 dockPanelExists('review')?
  │
  ├── 是 → ensurePanelAndActivate('review')
  │        requestReviewerWorkbenchViewMode('table')
  │        return
  │
  └── 否 → 查 dockPanelExists('designerCommentHandling')?
          │
          ├── 是 → ensurePanelAndActivate('designerCommentHandling')
          │        requestDesignerCommentViewMode('table')
          │        return
          │
          └── 否 → 查 userStore.isReviewer.value && !userStore.isDesigner.value?
                  │
                  ├── 是 → open review, request reviewer table
                  │
                  └── 否 → open DCH, request designer table  (default)
```

### 3.2 新 bus：`reviewerWorkbenchViewModeBus`

文件：`src/components/review/reviewerWorkbenchViewModeBus.ts`

接口（镜像 DCH bus）：

```ts
export type ReviewerWorkbenchViewMode = 'split' | 'table';
export type ReviewerWorkbenchViewModeRequest = {
  mode: ReviewerWorkbenchViewMode;
  requestedAt: number;
};

export function useReviewerWorkbenchViewModeRequest(): Readonly<Ref<ReviewerWorkbenchViewModeRequest | null>>;
export function requestReviewerWorkbenchViewMode(mode: ReviewerWorkbenchViewMode): void;
export function clearReviewerWorkbenchViewModeRequest(): void;
```

选择独立 bus（而不是合并到一个 `annotationListViewModeBus`）的理由：
- 两个面板生命周期独立、storage key 已独立（PR 5 / PR 8），bus 也独立保持一致
- 避免误触发（如果用 "target: 'reviewer' | 'designer'" 字段的单一 bus，双面板都会 watch，多余分支）
- 复用已验证的 DCH pattern，成本最低

### 3.3 ReviewPanel.vue watch

在 `useReviewerWorkbenchViewModeRequest()` 上加一个 watch，对齐 DCH 面板：

```ts
const reviewerWorkbenchViewModeRequest = useReviewerWorkbenchViewModeRequest();

watch(reviewerWorkbenchViewModeRequest, (request) => {
  if (!request) return;
  annotationListViewMode.value = request.mode;
  clearReviewerWorkbenchViewModeRequest();
});
```

### 3.4 DockLayout.vue 路由

改 `case 'panel.annotationTable':` 分支：

```ts
case 'panel.annotationTable': {
  const hasReviewPanel = dockPanelExists('review');
  const hasDesignerCommentHandling = dockPanelExists('designerCommentHandling');

  if (hasReviewPanel) {
    ensurePanelAndActivate('review');
    requestReviewerWorkbenchViewMode('table');
    return;
  }
  if (hasDesignerCommentHandling) {
    ensurePanelAndActivate('designerCommentHandling');
    requestDesignerCommentViewMode('table');
    return;
  }
  const user = userStore.currentUser.value;
  if (user && userStore.isReviewer.value && !userStore.isDesigner.value) {
    ensurePanelAndActivate('review');
    requestReviewerWorkbenchViewMode('table');
  } else {
    ensurePanelAndActivate('designerCommentHandling');
    requestDesignerCommentViewMode('table');
  }
  return;
}
```

依赖增补：
- `import { dockPanelExists } from '@/composables/useDockApi';`（已经有）
- `import { requestReviewerWorkbenchViewMode } from './review/reviewerWorkbenchViewModeBus';`
- userStore 已经在 DockLayout 中使用，不需新增

## 4. 变更清单

| 文件 | 变更 | 新/改 |
|------|------|------|
| `src/components/review/reviewerWorkbenchViewModeBus.ts` | 新 bus，镜像 DCH bus | 新 |
| `src/components/review/reviewerWorkbenchViewModeBus.test.ts` | 3 unit tests（request / clear / 连续 requestedAt） | 新 |
| `src/components/review/ReviewPanel.vue` | import bus + watch + 消费 | 改（~10 行） |
| `src/components/review/ReviewPanel.test.ts` | +1 用例（外部请求 `table` → 切到表格视图） | 改 |
| `src/components/DockLayout.vue` | `panel.annotationTable` 改成智能分发 | 改（~15 行） |
| `CHANGELOG.md` | 新 PR 9 段 | 改 |
| `docs/plans/2026-04-23-ribbon-annotation-table-smart-dispatch-pr9-design.md` | 本文件 | 新 |

## 5. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| reviewer 与 designer 身兼两职的用户（如 admin），默认路由到 reviewer 可能不合预期 | 低 | 如果 `review` 或 `designerCommentHandling` 任一已打开，直接路由到那个；fallback 仅在两者都未打开时触发（罕见） |
| DockLayout 新增对 userStore 的判断与 closure 问题 | 低 | userStore 已在文件顶部引入；`userStore.isReviewer` 等是响应式，读 `.value` 即可 |
| 原有 E2E（`annotation-table-ribbon.spec.ts`）覆盖的是 designer 路径，PR 9 不应让它 fail | 高 | E2E 用的场景：无已打开 `review`、无已打开 `designerCommentHandling`、测试用户默认是 designer → 分发到 DCH；行为一致 |
| 现有 DCH 单测（模拟 Ribbon 请求）依赖 `designerCommentViewModeBus`，PR 9 在 DockLayout 层分叉后，单测不再覆盖分叉逻辑 | 中 | PR 9 在 bus 级别加了新 unit tests；DockLayout 的单测目前不覆盖 ribbon 命令处理（主要做 embed bootstrap），不回归 |
| 新增 bus 的 mock 需在 ReviewPanel.test.ts 补上 | 低 | 仿照 DCH 测试 mock designerCommentViewModeBus 的做法 |

## 6. 验收

- [ ] `reviewerWorkbenchViewModeBus.test.ts` 3 用例全绿
- [ ] `ReviewPanel.test.ts` 新增 1 用例 + 原 24 用例全绿
- [ ] `DesignerCommentHandlingPanel.test.ts` 不回归（13/13）
- [ ] `AnnotationTableView.test.ts` 不回归（20/20）
- [ ] `DockLayout.test.ts` 不回归（5/5）
- [ ] `annotation-table-ribbon.spec.ts`（E2E）原有 2 条不回归（designer 默认路径）
- [ ] `vue-tsc --noEmit` 全绿
- [ ] `eslint` 新增/改动文件全绿
- [ ] CHANGELOG PR 9 段

## 7. 验证脚本（手动 / 可选）

```bash
# 1. 单元测试
npx vitest run \
  src/components/review/reviewerWorkbenchViewModeBus.test.ts \
  src/components/review/ReviewPanel.test.ts \
  src/components/review/DesignerCommentHandlingPanel.test.ts \
  src/components/review/designerCommentViewModeBus.test.ts \
  src/components/DockLayout.test.ts

# 2. E2E（可选）
npm run test:e2e -- --grep "annotation-table-ribbon"

# 3. 手动（可选，登录后）
# - jh 用户登录，先打开"校审"面板 → 点击 Ribbon "批注表格" → 应切到 reviewer 工作台的表格视图
# - sj 用户登录，先打开"批注处理"面板 → 点击 Ribbon → 应切到 DCH 表格视图
# - admin 用户登录，两个面板都未打开 → 点击 Ribbon → 应开 review 面板（因为 isReviewer=true && isDesigner=false）
```

## 8. 后续建议（超出 PR 9 scope）

- **PR 10**：Ribbon 按钮角色可见性（利用 ribbonConfig 的 visibleWhen），designer / reviewer 看到不同按钮集合
- **PR 11**：分别暴露两个独立按钮 "批注表格·处理"（sj） / "批注表格·校核"（jh），不走分发、显式化语义
- **PR 12**：把两个面板的 `AnnotationListViewMode` 类型 + bus 合并到共享 module（避免重复）
