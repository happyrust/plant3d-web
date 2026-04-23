# AnnotationTableView 接入 Dock · PR 3 详细设计 · 2026-04-23

> 本文档是 `docs/plans/2026-04-22-annotation-dock-mvp-plan.md` § 4.PR 3 的展开实施细则。
> PR 1 / 2 / 2.5 / 2.6 / 2.7 已合入基础设施、表格组件、响应式退化、键盘导航 + 搜索高亮、右键菜单。
> 本 PR 负责把 `AnnotationTableView.vue` **接入到 `DesignerCommentHandlingPanel.vue`**，提供与 `AnnotationWorkspace.vue` 卡片列表互斥的表格视图。

## 0. 目标

- 在 `DesignerCommentHandlingPanel.vue` 的 `annotation_list` 视图（workspace 段）顶部加入 `split / table` **tab 切换**
- 当 `viewMode === 'table'` 时渲染 `AnnotationTableView`，替换原 `AnnotationWorkspace` 列表
- **进入批注详情（`annotation_detail`）时强制回到 `split` 布局**，保证详情页布局稳定
- 事件接线与 `AnnotationWorkspace.vue` 对齐，复用现有 `locateAnnotation` / `enterAnnotationDetail` / `selectWorkspaceAnnotation` 等处理函数
- 不改 `DockLayout.vue` / Ribbon（留给 PR 4）
- 不引入新的 store 或 API，严格复用 `scopedAnnotationItems`

## 1. 用户路径

```
任务页 (task_entry)
   │ 选择退回任务
   ▼
批注列表页 (annotation_list) · 默认 viewMode = 'split'
   │
   ├─ 点顶部 "表格" tab → viewMode = 'table'
   │     │
   │     │ 行单击   → select-annotation → 选中高亮 (viewMode 不变)
   │     │ 行双击   → open-annotation   → 进详情 (annotation_detail, viewMode 自动回 'split')
   │     │ 定位按钮 → locate-annotation → 现有 locateAnnotation
   │     │ 右键菜单 → copy-feedback     → emitToast
   │     │
   │     └─ 点顶部 "卡片" tab → viewMode = 'split'（AnnotationWorkspace 列表）
   │
   └─ 原 AnnotationWorkspace 列表行为保持不变
```

## 2. 组件改动

### 2.1 新增 state

```ts
type AnnotationListViewMode = 'split' | 'table';
const annotationListViewMode = ref<AnnotationListViewMode>('split');
```

- **session 级**：只持有在组件内部 `ref`，不入 `useNavigationStatePersistence`
- 复用 PR 2 设计稿的约定，与现有 `workspaceView: 'task_entry' | 'annotation_list' | 'annotation_detail'` 正交
- **进入详情时副作用**：`enterAnnotationDetail()` 内部把 `annotationListViewMode.value = 'split'`，保证详情页布局稳定

### 2.2 tab bar 渲染规则

```
annotation_list 视图下渲染，详情视图隐藏
```

```html
<div v-if="showAnnotationList" class="mb-3 flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
  <button :class="annotationListViewMode === 'split' ? 'bg-slate-900 text-white' : 'text-slate-600'"
    data-testid="annotation-list-view-mode-split"
    @click="annotationListViewMode = 'split'">
    卡片
  </button>
  <button :class="annotationListViewMode === 'table' ? 'bg-slate-900 text-white' : 'text-slate-600'"
    data-testid="annotation-list-view-mode-table"
    @click="annotationListViewMode = 'table'">
    表格
  </button>
</div>
```

### 2.3 模板分支

原分支：

```html
<div v-if="showAnnotationList" data-testid="designer-comment-annotation-list">
  <AnnotationWorkspace ... />
</div>
```

改为：

```html
<div v-if="showAnnotationList" data-testid="designer-comment-annotation-list">
  <!-- tab bar -->
  ...
  <!-- split 卡片列表 -->
  <AnnotationWorkspace v-if="annotationListViewMode === 'split'" ... />
  <!-- 表格视图 -->
  <AnnotationTableView v-else
    :items="scopedAnnotationItems"
    :current-annotation-id="selectedAnnotationId"
    :current-annotation-type="selectedAnnotationType"
    :task-key="currentTask?.formId || currentTask?.id || null"
    :subtitle="currentTask?.title || null"
    data-testid="designer-comment-annotation-table"
    @select-annotation="selectWorkspaceAnnotation"
    @open-annotation="(item) => { void locateAnnotation(item); enterAnnotationDetail(item); }"
    @locate-annotation="(item) => void locateAnnotation(item)"
    @copy-feedback="handleCopyFeedback" />
</div>
```

### 2.4 数据源选择

**用 `scopedAnnotationItems`（未经 `annotationFilter` 过滤）**，原因：

- 表格视图内部通过 `useAnnotationTableFilter` **独立维护** sort / filter / search 状态
- 顶部 `annotationFilter`（pending / fixed / rejected / high_priority）只作用于 `AnnotationWorkspace` 的卡片列表
- 保持两种视图的筛选独立 · 避免"表格模式下筛选被双重限制"的困惑

### 2.5 事件接线

| AnnotationTableView emit | 接线 | 复用 |
|--------------------------|------|------|
| `select-annotation` | `selectWorkspaceAnnotation(item)` | 同 AnnotationWorkspace 卡片单击 |
| `open-annotation` | `void locateAnnotation(item)` + `enterAnnotationDetail(item)` | 双击语义：飞到 3D + 进详情 |
| `locate-annotation` | `void locateAnnotation(item)` | 操作列定位按钮 |
| `copy-feedback` | `handleCopyFeedback(payload)` | 新增 helper：emitToast 成功/失败提示 |

### 2.6 `handleCopyFeedback` 设计

```ts
function handleCopyFeedback(payload: {
  kind: 'refno' | 'row';
  result: 'copied' | 'fallback' | 'failed';
  item: AnnotationWorkspaceItem;
}): void {
  const kindLabel = payload.kind === 'refno' ? 'RefNo' : '批注行';
  if (payload.result === 'failed') {
    emitToast({ message: `复制${kindLabel}失败`, level: 'warning' });
    return;
  }
  emitToast({
    message: payload.result === 'fallback' ? `已复制${kindLabel}（降级）` : `已复制${kindLabel}`,
    level: 'success',
  });
}
```

### 2.7 `enterAnnotationDetail` 副作用补丁

```ts
function enterAnnotationDetail(item, source = 'manual') {
  if (!item) return;
  selectWorkspaceAnnotation(item, source);
  workspaceView.value = 'annotation_detail';
  annotationListViewMode.value = 'split'; // 详情视图永远 split
}
```

## 3. 测试计划（`DesignerCommentHandlingPanel.test.ts` 补 3 个）

| # | 测试名 | 断言要点 |
|---|-------|---------|
| A | 点击"表格" tab 切换到 AnnotationTableView | `[data-testid="annotation-list-view-mode-table"]` 点击后 `[data-testid="annotation-table-view"]` 出现，卡片列表隐藏 |
| B | 表格行单击 emit select-annotation 后仍在列表视图 | 单击 `.annotation-table-row` → 等待 230ms → 断言 `workspaceView` 仍是 annotation_list、selectedAnnotationId 更新 |
| C | 表格行双击 emit open-annotation 进入详情并切回 split | 双击 `.annotation-table-row` → `[data-testid="designer-comment-annotation-detail"]` 出现 + `showModelByRefnosWithAck` 被调用 + `annotationListViewMode` 回 split |

### mock 策略

- `AnnotationTableView` 不做 stub，直接挂真组件（`useAnnotationTableFilter` 也是纯 Vue + ref，测试环境可正常运行）
- `useContainerQuery` 在 happy-dom 下 `clientWidth === 0` 会退回 `initialMode = 'wide'`，默认就是表格态，符合测试预期
- 时间快进：用 `vi.useFakeTimers()` + `vi.advanceTimersByTime(230)` 推进 220ms 单击延时

## 4. 响应式策略

暂不做额外工作——PR 2.5 已给 `AnnotationTableView` 装好 `useContainerQuery`，Dock 面板 narrow 时表格会自动切 Compact 卡片形态。

## 5. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| `AnnotationTableView` 在测试 mount 时依赖 document 事件 (contextmenu listener) 造成内存泄漏 | 低 | 低 | `DesignerCommentHandlingPanel.test.ts` 每次 `mounted.unmount()` 清理，`onBeforeUnmount` 会卸载监听 |
| 切到 table 视图时现有 `persistedAnnotationKey` 的恢复逻辑失效 | 低 | 中 | `useAnnotationTableFilter` 的 state 是 session 独立的，但 `currentAnnotationId` 继续走 `selectedAnnotationId` ref，不破坏持久化 |
| `open-annotation` 双触发 locate + enterDetail 导致视图抖动 | 中 | 低 | `locateAnnotation` 内部已经 `ensurePanelAndActivate('viewer')` 异步 · `enterAnnotationDetail` 是同步 ref 切换，同一 tick 完成 |

## 6. 验收清单

- [ ] 新增 `annotationListViewMode` ref
- [ ] annotation_list 视图下渲染 tab bar（`split` / `table`）
- [ ] 表格视图接入 `AnnotationTableView`，事件全部接线
- [ ] 表格视图行单/双击 / 定位 / 右键复制路径正确
- [ ] `enterAnnotationDetail` 自动切回 `'split'` 布局
- [ ] `DesignerCommentHandlingPanel.test.ts` 新增 3 用例全绿
- [ ] `AnnotationTableView.test.ts` 现有 20 用例不破坏
- [ ] `npm run lint && npm run type-check && npm test` 全绿
- [ ] CHANGELOG 新增 PR 3 条目
- [ ] 不改 `DockLayout.vue` / Ribbon（留给 PR 4）
- [ ] 不改 embed 相关逻辑（`embedContextRestore`, `embedFormSnapshotRestore`, `embedRoleLanding`）

## 7. 文件清单

| 文件 | 变更 | 行数估算 |
|------|------|---------|
| `src/components/review/DesignerCommentHandlingPanel.vue` | 改 · 加 viewMode + tab bar + AnnotationTableView 分支 + handleCopyFeedback | +80 |
| `src/components/review/DesignerCommentHandlingPanel.test.ts` | 加 · 3 个新用例 + mock 保持现状 | +120 |
| `CHANGELOG.md` | 加 · PR 3 段 | +15 |
| `docs/plans/2026-04-22-annotation-table-dock-integration-pr3-design.md` | 新 · 本文档 | ~180 |

## 8. 实施顺序

1. 写 PR 3 设计文档（本文）
2. 改 `DesignerCommentHandlingPanel.vue`：引入 AnnotationTableView + viewMode ref + tab bar + 事件接线 + handleCopyFeedback
3. 补 3 个测试到 `DesignerCommentHandlingPanel.test.ts`
4. 写 CHANGELOG 条目
5. `npm run lint && npm run type-check && npx vitest run src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/AnnotationTableView.test.ts` 全绿
6. 完工

## 9. 非目标（明确不做）

- Ribbon 按钮（PR 4 负责）
- `useDockLayoutMode` hook（设计稿 `useContainerQuery` 已够用）
- 三栏布局重构（MVP 不动）
- 表格视图下的 StatusBar 联动
- `viewMode` 持久化到 localStorage（session 级足够）
- 响应式额外优化（PR 2.5 已完成）
