# Reviewer 工作台批注表格视图 · PR 8 详细设计 · 2026-04-23

> 本 PR 是批注表格视图（`docs/plans/2026-04-22-annotation-dock-mvp-plan.md` 的 MVP 主线）后续扩展之一，把已经在 `DesignerCommentHandlingPanel`（sj 角色）落地的表格视图能力迁移到 `ReviewPanel`（jh 角色校核工作台）。

## 0. 动机

MVP 验收报告（`docs/verification/2026-04-23-annotation-table-mvp-verification.md` §7 "后续建议 #1"）记录：

> 接入 Reviewer 工作台：`ReviewPanel.vue` 的 reviewer 视图同样可以受益于表格浏览

校核（jh）角色处理批注时也存在"批注多、卡片堆叠低效"的痛点，希望一视同仁地能在卡片列表 / 批注表格之间切换。

## 1. 目标

- `ReviewPanel.vue` 的批注工作区顶部新增 `卡片列表 / 批注表格` tab 切换（对齐 `DesignerCommentHandlingPanel` 体验）
- 表格视图作为**只读浏览**：行单击 = 选中（蓝色高亮联动 3D pin），行双击 = 飞到 3D + 选中，右键菜单复制
- 表格视图**不接入** "确认当前数据" 按钮、工具启动器、timeline 回复（这些保留在卡片列表 / split 视图下）
- `annotationListViewMode` 持久化到 localStorage（独立于 Designer 面板的持久化 key）
- 复用现有 `AnnotationTableView.vue` 组件，0 新增组件代码

## 2. 非目标

- **不**做 Ribbon 按钮路由到 ReviewPanel（新按钮 / 智能分发留给 PR 9）
- **不**改 reviewer 的任何既有工作流（confirm / submit / reject / drawer）
- **不**在表格视图下暴露工具启动器（reviewer 可以创建批注，但该入口留在 split 视图）
- **不**接入 `designerCommentViewModeBus`（该 bus 是 sj 专属，不跨角色共享，避免概念污染）

## 3. 设计产出

### 3.1 数据源分工

```
toolStore.annotations / cloudAnnotations / rectAnnotations / obbAnnotations
        │
        ▼ buildAnnotationWorkspaceItems (已有)
        │
allAnnotationItems → scopeAnnotationWorkspaceItemsByFormId → scopedAnnotationItems (已有)
                                                                      │
                                                                      ├─→ filterAnnotationWorkspaceItems → filteredAnnotationItems
                                                                      │   │
                                                                      │   └─→ AnnotationWorkspace (split view)
                                                                      │
                                                                      └─→ AnnotationTableView (table view · 绕过 annotationFilter)
```

和 `DesignerCommentHandlingPanel` 一致：table view 消费 `scopedAnnotationItems`（未过滤），表格内部独立的搜索 / 严重度 / 状态筛选与 `AnnotationWorkspace` 的 pill 筛选解耦。

### 3.2 状态

| ref | 作用 | 持久化 |
|-----|------|--------|
| `annotationListViewMode: 'split' \| 'table'` | 当前 reviewer 工作台的视图模式 | 是（新 key `plant3d-web-nav-state-reviewer-workbench-v1`） |

### 3.3 事件接线

| 来源 | 事件 | 处理 |
|------|------|------|
| `AnnotationTableView` | `select-annotation` | `selectWorkspaceAnnotation(item)`（已有） |
| `AnnotationTableView` | `open-annotation` | `locateWorkspaceAnnotation(item)`（双击 = 飞到 3D + 选中，**不进 detail 页**，因为 reviewer 没 detail 视图） |
| `AnnotationTableView` | `locate-annotation` | 同上 `locateWorkspaceAnnotation` |
| `AnnotationTableView` | `copy-feedback` | 通过 `emitToast` 反馈 `copied` / `fallback` / `failed`（新增 `handleCopyFeedback` 函数，对齐 DCH 实现） |

注意 reviewer 与 designer 的关键差异：
- Designer 的"双击行" → `enterAnnotationDetail` 切到 annotation_detail 子视图
- Reviewer 没有 detail 子视图，所以"双击行"=定位到 3D + 选中（回到 split view 让用户看到详细处理面板）

→ 所以 reviewer 下的双击行为是：先 `annotationListViewMode = 'split'` 再 `locateWorkspaceAnnotation(item)`，这样用户双击后看到的是"3D 飞到位 + 右侧 Drawer 打开"的完整流程。

## 4. 变更清单

| 文件 | 变更 | 行数影响 |
|------|------|---------|
| `src/components/review/ReviewPanel.vue` | import AnnotationTableView / useNavigationStatePersistence · 加 viewMode ref · 加 bindRef · 加 handleCopyFeedback · template 加 tab bar · 加 AnnotationTableView 分支 | ~60 |
| `src/components/review/ReviewPanel.test.ts` | 新增 3–4 用例（tab 切换 / 单击选中 / 双击定位 + 切回 split / persistence 恢复） | ~120 |
| `CHANGELOG.md` | 新增 PR 8 段 | ~20 |
| `docs/plans/2026-04-23-reviewer-workbench-annotation-table-pr8-design.md` | 本文件 | ~150 |

## 5. 实现细节

### 5.1 import 增补

```ts
import AnnotationTableView from './AnnotationTableView.vue';
import { useNavigationStatePersistence } from '@/composables/useNavigationStatePersistence';
```

`AnnotationListViewMode` 类型沿用 DCH 的 `'split' | 'table'`，为隔离依赖，在 ReviewPanel 本地同名声明即可（或 export 到共享工具，暂不做）。

### 5.2 state + 持久化

放在现有 `annotationFilter` 声明附近：

```ts
type AnnotationListViewMode = 'split' | 'table';
const annotationListViewMode = ref<AnnotationListViewMode>('split');

const navigationState = useNavigationStatePersistence('plant3d-web-nav-state-reviewer-workbench-v1');
navigationState.bindRef<AnnotationListViewMode>('annotationListViewMode', annotationListViewMode, 'split');
```

### 5.3 事件 handler

```ts
function handleTableCopyFeedback(payload: {
  kind: 'refno' | 'row';
  result: 'copied' | 'fallback' | 'failed';
}) {
  const label = payload.kind === 'refno' ? '批注编号' : '批注记录';
  if (payload.result === 'copied') emitToast({ kind: 'success', text: `已复制${label}` });
  else if (payload.result === 'fallback') emitToast({ kind: 'info', text: `已复制${label}（使用兼容模式）` });
  else emitToast({ kind: 'error', text: `复制${label}失败，请手动选择文本` });
}

function handleTableOpenAnnotation(item: AnnotationWorkspaceItem) {
  annotationListViewMode.value = 'split';
  void locateWorkspaceAnnotation(item);
}
```

注：`emitToast` 已在 ReviewPanel 中通过既有通道使用（如果没有，fall back 到 `console.warn` 即可，MVP 不要求 toast）。

### 5.4 template 改动

替换 `<AnnotationWorkspace v-if="currentTask" role="reviewer" ...>` 一整块：

```html
<div v-if="currentTask" class="flex min-h-0 flex-1 flex-col">
  <div class="mb-3 inline-flex items-center gap-1 self-start rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
    role="tablist"
    aria-label="批注视图切换"
    data-testid="reviewer-annotation-list-view-mode-tabs">
    <button type="button"
      role="tab"
      :aria-selected="annotationListViewMode === 'split'"
      class="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold transition"
      :class="annotationListViewMode === 'split'
        ? 'bg-slate-900 text-white shadow-sm'
        : 'text-slate-600 hover:bg-slate-100'"
      data-testid="reviewer-annotation-list-view-mode-split"
      @click="annotationListViewMode = 'split'">
      卡片列表
    </button>
    <button type="button"
      role="tab"
      :aria-selected="annotationListViewMode === 'table'"
      class="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold transition"
      :class="annotationListViewMode === 'table'
        ? 'bg-slate-900 text-white shadow-sm'
        : 'text-slate-600 hover:bg-slate-100'"
      data-testid="reviewer-annotation-list-view-mode-table"
      @click="annotationListViewMode = 'table'">
      批注表格
    </button>
  </div>

  <AnnotationWorkspace v-if="annotationListViewMode === 'split'"
    role="reviewer"
    :items="filteredAnnotationItems"
    ... (保持原有 props / emits / workflow slot)
    >
    <template #workflow> ... </template>
  </AnnotationWorkspace>

  <AnnotationTableView v-else
    :items="scopedAnnotationItems"
    :current-annotation-id="selectedAnnotationId"
    :current-annotation-type="selectedAnnotationType"
    :task-key="currentTask?.id ?? null"
    :subtitle="currentTask?.title ?? null"
    data-testid="reviewer-annotation-table-view"
    @select-annotation="selectWorkspaceAnnotation"
    @open-annotation="handleTableOpenAnnotation"
    @locate-annotation="(item) => void locateWorkspaceAnnotation(item)"
    @copy-feedback="handleTableCopyFeedback" />
</div>
```

### 5.5 测试

```ts
// 用例 1 · tab 切换
it('Reviewer 工作台可以在卡片列表和批注表格之间切换 · PR 8', async () => {
  currentTask.value = createReviewTask();
  const mounted = await mountReviewPanel();
  expect(document.querySelector('[data-testid="reviewer-annotation-table-view"]')).toBeNull();
  await mounted.find('[data-testid="reviewer-annotation-list-view-mode-table"]').trigger('click');
  expect(document.querySelector('[data-testid="reviewer-annotation-table-view"]')).toBeTruthy();
  mounted.unmount();
});

// 用例 2 · 表格行单击保持表格视图
it('Reviewer 表格行单击 → 选中高亮，保持表格视图 · PR 8', async () => { ... });

// 用例 3 · 表格行双击 → 切回 split + 定位
it('Reviewer 表格行双击 → 飞到 3D + 切回卡片列表 · PR 8', async () => { ... });

// 用例 4 · 持久化恢复
it('Reviewer 工作台刷新后恢复上次 annotationListViewMode · PR 8', async () => {
  persistenceState.set('annotationListViewMode', 'table');
  currentTask.value = createReviewTask();
  const mounted = await mountReviewPanel();
  expect(document.querySelector('[data-testid="reviewer-annotation-table-view"]')).toBeTruthy();
  mounted.unmount();
});
```

mock 策略：现有 `ReviewPanel.test.ts` 如果没 mock `useNavigationStatePersistence`，需要加 mock。对齐 `DesignerCommentHandlingPanel.test.ts` 的实现。

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| `ReviewPanel.test.ts` 没现成的 `useNavigationStatePersistence` mock，需要补 | 中（测试 setup 复杂） | 从 DCH 测试直接拷贝 mock 片段，稳定重用 |
| reviewer 表格双击后 split 视图里未自动聚焦到 selected annotation | 低 | `locateWorkspaceAnnotation` 已 set selectedAnnotation；split 视图依赖 `selectedAnnotation` prop 自动滚动 |
| ReviewPanel 有 embed 外部入口逻辑（`externalProcessingTarget`），可能与 table 模式冲突 | 低 | embed 场景会直接 set selectedAnnotation，表格模式下也能正常高亮；但 embed **初始**模式强制 `'split'` 更稳妥（已有 `resolvePreferredWorkspaceAnnotation` 作为保险） |
| reviewer 表格模式下用户意外失去 workflow 操作（confirm/submit/reject） | 中 | 文档说明表格是浏览模式；UI 切回"卡片列表"即可 |
| 整体 ReviewPanel.vue 1700+ 行加改动后难以 review | 中 | 本 PR 严格限制在 ~60 行 template 改动 + ~20 行 script；不改 workflow/embed/props 任何既有逻辑 |

## 7. 验收标准

- [ ] `npm run type-check` 通过
- [ ] `npm run lint src/components/review/ReviewPanel.vue src/components/review/ReviewPanel.test.ts` 通过
- [ ] `npx vitest run src/components/review/ReviewPanel.test.ts` 新增 4 用例 + 原既有用例全绿
- [ ] `npx vitest run src/components/review/AnnotationTableView.test.ts` 不被破坏（20 用例全绿）
- [ ] `npx vitest run src/components/review/DesignerCommentHandlingPanel.test.ts` 不被破坏（13 用例全绿）
- [ ] 手动验证（可选）：jh 角色登录 → 校审 tab → 选任务 → 切换到批注表格 → 行双击 → 回到卡片列表 + 批注高亮
- [ ] `CHANGELOG.md` 新增 PR 8 段

## 8. 非工程交付

无（本 PR 不需要新设计稿，复用 `ui/三维校审/review-designer.pen` 的 `JaP7C` table state 参考）。

## 9. 执行顺序

1. 建设计文档（本文件）
2. 实现 `ReviewPanel.vue` 改动（分 script / template 两段）
3. 补 `ReviewPanel.test.ts` mock + 4 用例
4. lint + type-check + vitest 全绿
5. CHANGELOG + commit message 草稿
6. 留给用户决定是否 commit

## 10. 后续建议（超出本 PR）

- **PR 9**：Ribbon "批注表格"按钮智能分发（按当前用户角色开 DCH panel 或 ReviewPanel；或新增独立 reviewer 批注表格按钮）
- **PR 10**：Ribbon 按钮角色可见性分组（根据 ribbonConfig 的 `visibleWhen` 能力，设计期可先从 verification doc 标注）
- **PR 11**：把 `AnnotationListViewMode` 类型 + 两个面板的 mode 迁移到共享 module（如 `src/components/review/annotationListViewMode.ts`），减少重复
