# 批注表格 · Ribbon 入口 · PR 4 详细设计 · 2026-04-23

> 本文档是 `docs/plans/2026-04-22-annotation-dock-mvp-plan.md` § 4.PR 4 的展开实施细则。
> PR 3 已合入 `DesignerCommentHandlingPanel.vue` 的 `annotationListViewMode` tab 切换，
> 本 PR 负责把 Ribbon 校审组的"批注表格"按钮连到 dock 的 `viewMode = 'table'` 切换。

## 0. 目标

- 在 Ribbon 「校审 · 面板」 group 新增 **批注表格** 按钮，图标 `table`
- 点击后：
  1. 打开（或激活） `designerCommentHandling` dock 面板
  2. 把面板内部的 `annotationListViewMode` 切到 `'table'`
  3. 若处于详情页，自动回到 `annotation_list` 顶层视图
- 不改 `commandBus` 本体（复用 `emitCommand` / `onCommand`）
- 不引入新的 store

## 1. 跨组件通信设计

Ribbon 按钮点击 → `emitCommand('panel.annotationTable')` → DockLayout 的 `handleRibbonCommand` 接收 → 两步：
1. `ensurePanelAndActivate('designerCommentHandling')` 打开面板（面板可能此时才 mount）
2. `requestDesignerCommentViewMode('table')` 更新一个全局 ref bus

面板内部 watch 这个 ref 切换 viewMode。**核心理由**：`commandBus` 是即发即触型，面板若未 mount 会错过命令；而 ref bus 是"latest value"型，面板 mount 后能读到最后一次请求（匹配现有 `annotationProcessingEntry.ts` 的风格）。

## 2. 文件清单

| 文件 | 变更 | 行数估算 |
|------|------|---------|
| `src/components/review/designerCommentViewModeBus.ts` | 新增 · ref bus | ~35 |
| `src/components/review/designerCommentViewModeBus.test.ts` | 新增 · 单元测试 | ~60 |
| `src/ribbon/ribbonIcons.ts` | 加 `table` 图标导入 + 映射 | +2 |
| `src/ribbon/ribbonConfig.ts` | `review.panel` group 加按钮 | +1 |
| `src/components/DockLayout.vue` | `handleRibbonCommand` 加 case | +6 |
| `src/components/review/DesignerCommentHandlingPanel.vue` | watch viewMode request | +15 |
| `src/components/review/DesignerCommentHandlingPanel.test.ts` | 加 1 用例 | +35 |
| `CHANGELOG.md` | PR 4 段 | +12 |
| `docs/plans/2026-04-22-annotation-table-ribbon-entry-pr4-design.md` | 本文档 | ~120 |

## 3. `designerCommentViewModeBus` 设计

```ts
import { readonly, ref } from 'vue';

export type DesignerCommentViewMode = 'split' | 'table';

export type DesignerCommentViewModeRequest = {
  mode: DesignerCommentViewMode;
  requestedAt: number;
};

const requestRef = ref<DesignerCommentViewModeRequest | null>(null);

export function useDesignerCommentViewModeRequest() {
  return readonly(requestRef);
}

export function requestDesignerCommentViewMode(mode: DesignerCommentViewMode): void {
  requestRef.value = { mode, requestedAt: Date.now() };
}

export function clearDesignerCommentViewModeRequest(): void {
  requestRef.value = null;
}
```

## 4. `DesignerCommentHandlingPanel` 改动

```ts
const viewModeRequest = useDesignerCommentViewModeRequest();

watch(
  () => viewModeRequest.value?.requestedAt ?? null,
  () => {
    const request = viewModeRequest.value;
    if (!request) return;
    annotationListViewMode.value = request.mode;
    // 若处于详情页，切回列表页才能看到 tab
    if (workspaceView.value === 'annotation_detail' && request.mode === 'table') {
      workspaceView.value = 'annotation_list';
    }
    clearDesignerCommentViewModeRequest();
  },
  { immediate: true },
);
```

## 5. Ribbon 配置

```ts
{
  kind: 'button',
  id: 'panel.annotationTable',
  label: '批注表格',
  icon: 'table',
  commandId: 'panel.annotationTable',
},
```

放在 `review.panel` group 的 `panel.resubmissionTasks` 之后、`panel.myTasks` 之前（位置贴近"批注处理"）。

## 6. DockLayout 处理

```ts
case 'panel.annotationTable':
  ensurePanelAndActivate('designerCommentHandling');
  requestDesignerCommentViewMode('table');
  return;
```

## 7. 测试策略

| # | 文件 | 测试名 | 断言 |
|---|------|--------|------|
| 1 | `designerCommentViewModeBus.test.ts` | request 更新 ref | readonly ref 的 `mode` 字段匹配 |
| 2 | `designerCommentViewModeBus.test.ts` | clear 后 ref 为 null | 先 request 后 clear，ref 为 null |
| 3 | `designerCommentViewModeBus.test.ts` | 连续 request 更新 timestamp | 两次 request，requestedAt 不同 |
| 4 | `DesignerCommentHandlingPanel.test.ts` | Ribbon 请求切到 table 视图 | mount 后在 annotation_list 视图，调 `requestDesignerCommentViewMode('table')` → table view 出现 |

## 8. 验收清单

- [ ] Ribbon 校审 → 面板组看到"批注表格"按钮
- [ ] 按钮点击后 `designerCommentHandling` 面板打开 / 激活
- [ ] 面板 `annotationListViewMode` 自动切到 `'table'`
- [ ] 若当前处于详情页，自动回列表页
- [ ] `designerCommentViewModeBus.test.ts` 3 用例全绿
- [ ] `DesignerCommentHandlingPanel.test.ts` 新用例 + 原 10 用例全绿
- [ ] `AnnotationTableView.test.ts` 20 用例无破坏
- [ ] `npx vue-tsc --noEmit` / `eslint` 均通过
- [ ] CHANGELOG 新增 PR 4 条目

## 9. 非目标

- 不改 `commandBus` 本体
- 不做 Ribbon 按钮的动态显示/隐藏（根据角色）
- 不做"回切到 split"的 Ribbon 按钮（点卡片列表 tab 就够）
- 不做从 Ribbon 点击后自动打开非当前任务（若没任务就落在 `task_entry` 页）
