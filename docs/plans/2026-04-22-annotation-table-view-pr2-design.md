# AnnotationTableView · PR 2 详细设计 · 2026-04-22

> 本文档是 `docs/plans/2026-04-22-annotation-dock-mvp-plan.md` § 4.PR 2 的展开实施细则。
> PR 1 已合入纯函数层（[`ceef73f`](../../src/components/review/annotationTableSorting.ts)），本 PR 负责组件层。

## 0. 目标

- 交付一个**可独立运行、可独立单测**的批注表格视图组件 `AnnotationTableView.vue`
- 不接入 `DesignerCommentHandlingPanel.vue`（留给 PR 3）
- 不改 `DockLayout.vue` / Ribbon（留给 PR 4）
- 复用 PR 1 的纯函数，不引入新的数据源

## 1. 组件 API

### Props

```ts
defineProps<{
  /** 批注数据（上游已做过 formId / externalEntry 等 scope）*/
  items: AnnotationWorkspaceItem[];
  /** 当前选中批注（用于行高亮），null 表示未选 */
  currentAnnotationId?: string | null;
  /** 当前选中批注类型（配合 id 匹配） */
  currentAnnotationType?: AnnotationType | null;
  /** 空状态标题 */
  emptyTitle?: string;
  /** 空状态描述 */
  emptyDescription?: string;
  /** 任务 key，用于 CSV 文件名 */
  taskKey?: string | null;
}>();
```

### Emits

```ts
defineEmits<{
  /** 单击行 · 对应"打开 drawer" */
  (e: 'select-annotation', item: AnnotationWorkspaceItem): void;
  /** 双击行 · 对应"飞到 3D" */
  (e: 'open-annotation', item: AnnotationWorkspaceItem): void;
  /** 点操作列的定位按钮 */
  (e: 'locate-annotation', item: AnnotationWorkspaceItem): void;
}>();
```

**事件命名与 `AnnotationWorkspace.vue` 对齐**，PR 3 可无缝复用既有事件处理。

## 2. 布局结构（对齐 HTML 原型 workspace.html #view-table）

```
<section class="flex h-full flex-col overflow-hidden">
  <!-- 1. Toolbar：标题 + 副标题 + 搜索 + 严重度筛选 + 状态筛选 -->
  <header class="...border-b...">...</header>

  <!-- 2. Stats：计数 / 筛选态提示 / 导出 CSV 按钮 -->
  <div class="...border-b...">...</div>

  <!-- 3. Table Head：5 列 · 可点击排序（序号/错误标记/处理情况） -->
  <div class="flex h-9 items-center bg-slate-50 border-b border-slate-200 px-4 ...">
    <div class="w-10 text-center">序号</div>
    <div class="w-24">错误标记</div>
    <div class="flex-1">校核发现问题</div>
    <div class="w-56">处理情况</div>
    <div class="w-16 text-center">操作</div>
  </div>

  <!-- 4. Table Body：行 · 单双击 · 右侧两个 lucide icon -->
  <div class="flex-1 overflow-y-auto ...">
    <div v-for="(row, index) in paged" :key="row.id" role="row" ...></div>
    <!-- 或 empty state -->
  </div>

  <!-- 5. Footer：分页 · 1-3/共3 · ‹ 1/1 › -->
  <div class="h-8 border-t ...">...</div>
</section>
```

## 3. 核心交互规则

| 交互 | 触发 | 行为 |
|------|------|------|
| 行单击 | `@click` | emit `select-annotation` · 行高亮（黄底 2px 边框） |
| 行双击 | `@dblclick` | emit `open-annotation`（区分单击用 300ms delay 确定不是双击）|
| 行 Enter | `@keydown.enter` | 同单击 |
| 行 Space | `@keydown.space` | 同双击 |
| 行 ↑↓ | `@keydown.arrow` | 移动 focus · 不触发 select |
| 表头点击 | `@click` | 切换 sort（asc → desc → 取消） · 仅序号/错误标记/处理情况列可排 |
| 搜索输入 | `@input` + debounce 300ms | 过滤 |
| 严重度筛选 | `<select>` 切换 | 立即过滤 |
| 状态筛选 | `<select>` 切换 | 立即过滤 |
| 操作列 · 定位 icon | `@click.stop` | emit `locate-annotation` · 阻止冒泡（不触发行 select）|
| 操作列 · 讨论 icon | `@click.stop` | emit `select-annotation` · 同单击语义 |
| 导出 CSV | `@click` | `toAnnotationTableCsv` + `downloadCsv` |
| 分页 ← | `@click` | 页码 −1（若 > 1）|
| 分页 → | `@click` | 页码 +1（若 < totalPages）|

### 单/双击冲突处理

默认 `@click` 在 250ms 内双击会连续触发两次；需要：

```ts
let clickTimer: ReturnType<typeof setTimeout> | null = null;
function handleRowClick(item) {
  if (clickTimer) return;
  clickTimer = setTimeout(() => {
    emit('select-annotation', item);
    clickTimer = null;
  }, 220);
}
function handleRowDblClick(item) {
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  emit('open-annotation', item);
}
```

## 4. `useAnnotationTableFilter` composable

### 职责

- 持有 `sort` / `filters` 状态（session 级 · Vue `ref`）
- 提供 `setSort` / `setStatusFilter` / `setSeverityFilter` / `setSearch` / `reset` helper
- 提供 `filteredItems` computed（内部调 `applyAnnotationTablePipeline`）

### 签名

```ts
export function useAnnotationTableFilter(items: Ref<AnnotationWorkspaceItem[]>) {
  const sort = ref({ ...DEFAULT_SORT });
  const filters = ref({ ...DEFAULT_FILTERS });

  const filteredItems = computed(() =>
    applyAnnotationTablePipeline(items.value, filters.value, sort.value),
  );

  function setSort(nextKey, direction): void;
  function toggleSort(nextKey): void;   // 点列头用
  function setStatusFilter(status): void;
  function setSeverityFilter(sev): void;
  function setSearch(query): void;
  function reset(): void;

  return { sort, filters, filteredItems, setSort, toggleSort,
           setStatusFilter, setSeverityFilter, setSearch, reset };
}
```

### 排序列头点击逻辑

```ts
function toggleSort(nextKey: AnnotationTableSortKey) {
  if (sort.value.key !== nextKey) {
    sort.value = { key: nextKey, direction: 'desc' };
    return;
  }
  // 同 key：asc → desc → 重置为 default
  if (sort.value.direction === 'desc') {
    sort.value = { key: nextKey, direction: 'asc' };
    return;
  }
  sort.value = { ...DEFAULT_SORT };
}
```

## 5. 分页策略

- `pageSize = 10`（MVP 固定 · 不做用户设置）
- 若 `filteredItems.length <= pageSize`，隐藏 footer
- 搜索/筛选变化时 `currentPage` reset 到 1

## 6. 视觉 token

完全复用 plant3d-web 现有 Tailwind token + PR 1 设计稿 HTML 原型的视觉：

| 元素 | class |
|------|-------|
| 行 hover | `hover:bg-amber-50` |
| 行选中 | `bg-amber-50 ring-1 ring-amber-300` |
| 严重度 critical pill | `bg-rose-100 text-rose-700 ring-1 ring-rose-200` |
| 严重度 severe pill | `bg-orange-100 text-orange-800 ring-1 ring-orange-200` |
| 严重度 normal pill | `bg-blue-100 text-blue-700 ring-1 ring-blue-200` |
| 处理中状态 | `text-orange-700 font-semibold` |
| 已处理状态 | `text-emerald-700 font-semibold` |
| 主 CTA | `bg-orange-500 hover:bg-orange-600 text-white` |

## 7. 测试策略

### 单元测试 · `AnnotationTableView.test.ts`

| # | 测试名 | 断言要点 |
|---|-------|---------|
| 1 | 渲染 3 行数据 | 表头 + 3 个 `[role="row"]` |
| 2 | 空数组显示 empty state | `emptyTitle` + `emptyDescription` 文字出现；不显示表头 |
| 3 | 点击行触发 select-annotation | 延迟 230ms 后 emit（避免双击冲突） |
| 4 | 双击行触发 open-annotation | emit 1 次 open；0 次 select |
| 5 | 点表头切换排序 | 行顺序变化（严重度列 desc → asc） |
| 6 | 搜索输入 debounce 后过滤 | `vi.advanceTimersByTime(350)` 后行数减少 |
| 7 | 严重度筛选 | select 变更后行数变化 |
| 8 | 状态筛选 | select 变更后行数变化 |
| 9 | 操作列 locate 触发 locate-annotation · 不触发 select | 点击 emit 1 次 locate；0 次 select |
| 10 | currentAnnotationId 匹配时行高亮 | 对应行有 `ring-*` class |
| 11 | 分页：> 10 条时显示 footer | 断言 `当前 1-10 / 共 N` 文本 |
| 12 | CSV 导出按钮点击后调用 downloadCsv | mock `downloadCsv` spy |

### mock 策略

- `toAnnotationTableCsv` 和 `downloadCsv` 通过 `vi.mock('./annotationTableExport', ...)` mock
- composable 内部状态通过 Vue `ref` 暴露给组件，不需要额外 mock

## 8. 文件清单 · 本 PR 产出

| 文件 | 行数预估 | 职责 |
|------|---------|------|
| `src/composables/useAnnotationTableFilter.ts` | ~80 | session 级状态 + pipeline 执行 |
| `src/components/review/AnnotationTableView.vue` | ~320 | 表格组件主体 |
| `src/components/review/AnnotationTableView.test.ts` | ~280 | 12 个测试 |
| `docs/plans/2026-04-22-annotation-table-view-pr2-design.md` | ~240 | 本文件 |

**4 文件 · ~920 行**。

## 9. 不做的事

- 不做 contextMenu 右键菜单（Pencil `9xPyi` 设计在 PR 后续迭代）
- 不做排序持久化到 localStorage（MVP 决定走 session 级）
- 不做虚拟滚动（批注 > 200 条场景再优化）
- 不做多列排序（单列 asc/desc/off 三态已够用）
- 不做列宽可拖调（MVP 固定列宽）

## 10. 验收清单

- [ ] `npm run type-check` 通过
- [ ] `npx eslint <new files>` 通过
- [ ] 12 个单测全绿
- [ ] 不改动任何现有文件
- [ ] `AnnotationTableView.vue` 能在 Vitest 中独立 mount 渲染
- [ ] 单双击区分正确（延迟 220ms）
- [ ] 搜索/筛选/排序/分页联动无冲突
- [ ] 操作列按钮不触发行 select（`@click.stop`）

## 11. 后续（PR 3 预告）

PR 3 集成时，`DesignerCommentHandlingPanel.vue` 的改动点：

1. 加 `viewMode: 'split' | 'table'` ref
2. 中央区 tab bar 渲染 2 个 tab 按钮
3. 当 `viewMode === 'table'` 时挂 `<AnnotationTableView>` 替换 `<AnnotationWorkspace>`
4. 事件接线：`@select-annotation` → 现有 `enterAnnotationDetail` / `@open-annotation` → 现有 `locateAnnotation` + `setViewMode('split')`
