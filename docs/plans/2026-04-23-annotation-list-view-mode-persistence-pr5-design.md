# 批注列表 viewMode 持久化 · PR 5 详细设计 · 2026-04-23

> 本文档对应 `docs/plans/2026-04-22-annotation-dock-mvp-plan.md` 主线之外的**延伸小 PR**。
> 目标是把 PR 3 / PR 4 已经落地的 `annotationListViewMode` 状态从 session 级提升到 localStorage，避免刷新后回到默认的"卡片列表"模式。

## 0. 目标

- `annotationListViewMode: 'split' | 'table'` 的值写入 localStorage，下次进入 `DesignerCommentHandlingPanel` 时恢复。
- 复用项目现有的 `useNavigationStatePersistence` 基础设施（与 `selectedTaskId` / `selectedAnnotationKey` / `showInitiateDrawer` 等一致）。
- **不动 Ribbon 按钮角色可见性**（该项需要 ribbonConfig 架构级改动，延后处理）。
- **不改** 已有持久化策略的 storage key。

## 1. 为何小？

- 只加一个 `navigationState.bindRef('annotationListViewMode', ..., 'split')` 调用。
- 不引入新 composable、不改组件 API、不影响其他视图。
- 测试只需补 1 用例（mock localStorage 预填值 → 挂载后 viewMode 应自动为 `'table'`）。

## 2. 变更清单

| 文件 | 变更 |
|------|------|
| `src/components/review/DesignerCommentHandlingPanel.vue` | `navigationState.bindRef('annotationListViewMode', annotationListViewMode, 'split')` |
| `src/components/review/DesignerCommentHandlingPanel.test.ts` | 加 1 用例：`persistenceState.set('annotationListViewMode', 'table')` 后挂载，面板首屏即 table 视图 |
| `CHANGELOG.md` | PR 5 小段 |
| `docs/plans/2026-04-23-annotation-list-view-mode-persistence-pr5-design.md` | 本文件 |

## 3. 放置位置

现有 bindRef 调用：

```ts
navigationState.bindRef('selectedTaskId', selectedTaskId, null);
navigationState.bindRef('selectedAnnotationKey', persistedAnnotationKey, null);
navigationState.bindRef('showInitiateDrawer', showInitiateDrawer, false);
```

新增一行挨在下面：

```ts
navigationState.bindRef<AnnotationListViewMode>('annotationListViewMode', annotationListViewMode, 'split');
```

## 4. 测试

```ts
it('刷新后恢复上次 annotationListViewMode · PR 5', async () => {
  currentTaskRef.value = createTask();
  persistenceState.set('annotationListViewMode', 'table');

  const mounted = await mountPanel();

  expect(document.querySelector('[data-testid="annotation-table-view"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="annotation-workspace-list"]')).toBeNull();

  mounted.unmount();
});
```

mock 策略：现有测试里 `useNavigationStatePersistence` 已用 `persistenceState` Map 作 mock 存储，直接 `set` 预填即可。

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 持久化值污染被 Ribbon 请求覆盖 | Ribbon request 是"显式用户动作"，覆盖是预期行为；不影响持久化 |
| 旧版本用户 localStorage 无此 key | `bindRef` 内部走 fallback `'split'`，向后兼容 |
| 值被人为改到非法字符串 | `'split' / 'table'` 以外的值会在组件渲染时 fallback 到 split 分支（因为 `annotationListViewMode === 'split'` 判定为 false → else 分支，渲染 table）；可考虑增强但 MVP 不做 |

## 6. 验收

- [ ] 新用户首次进入默认 split 模式
- [ ] 切到 table 后刷新页面仍是 table
- [ ] 切回 split 刷新页面仍是 split
- [ ] `DesignerCommentHandlingPanel.test.ts` 13 用例（12 + 1 PR 5）全绿
- [ ] `vue-tsc` / `eslint` 绿
