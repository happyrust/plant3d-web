# 评论真源迁移 PROMOTE 执行计划 · 2026-04-23

> 前置依赖：`docs/plans/2026-04-19-review-comment-thread-refactor-plan.md`
> Phase A（测试修复）已完成。本文件是 Phase C 的细化执行计划。

---

## 0. 当前状态

| 项目 | 状态 |
|------|------|
| `commentThreadStore` | 已实现，8 测试全绿 |
| `commentThreadDualRead` | 已实现，9 测试全绿 |
| `commentEventLog` | 已实现，7 测试全绿 |
| `sharedStores` / `reviewSnapshot` | 已实现，12 测试全绿 |
| `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` flag | 默认 OFF |
| 评论读取路径（inline） | `useToolStore.getAnnotationComments()` + `annotation.comments` |
| 评论写入路径（inline） | `addAnnotationComment` / `updateAnnotationComment` / `removeAnnotationComment` |

---

## 1. Step 1 · 开启 DUAL_READ 默认值（~30min）

**目标**：把 `DUAL_READ` flag 默认开启，让 store 在后台始终保持同步。

### 改动

1. `src/review/flags.ts`：`REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ: true`
2. `src/review/flags.ts`：`REVIEW_C_EVENT_LOG: true`

### 验证

- 64 个 review domain/services 测试全绿
- 全量 vitest 无新增失败
- 开发环境运行，Console 无 `dual_read_diff` 事件

---

## 2. Step 2 · 读路径 PROMOTE（~2h）

**目标**：UI 读评论从 `useToolStore.annotations[i].comments` 切到 `commentThreadStore`。

### 改动

| 文件 | 变更 |
|------|------|
| `ReviewCommentsTimeline.vue` | 已接入 store（确认无需改动） |
| `AnnotationWorkspace.vue` | 评论列表数据源改从 `sharedStores` 读取 |
| `ReviewPanel.vue` | 评论计数 / 未读标记改从 store 读取 |
| `DesignerCommentHandlingPanel.vue` | 评论显示改从 store 读取 |
| `AnnotationTableView.vue` | 评论列渲染改从 store 读取 |

### 验证

- 所有 ReviewPanel 系列测试通过
- DesignerCommentHandlingPanel 13 测试通过
- AnnotationTableView 20 测试通过

---

## 3. Step 3 · 写路径 PROMOTE（~3h）

**目标**：评论的增/改/删操作改为写入 `commentThreadStore`，inline 变为投影。

### 改动

| 函数 | 当前位置 | 改动 |
|------|----------|------|
| `addAnnotationComment` | `useToolStore` | 改为先写 `store.upsertComment`，再通过投影同步到 inline |
| `updateAnnotationComment` | `useToolStore` | 同上 |
| `removeAnnotationComment` | `useToolStore` | 改为先写 `store.deleteComment`，再通过投影同步到 inline |
| `getAnnotationComments` | `useToolStore` | 改为从 store 读取 |

### 关键设计

```
用户操作 → store.upsertComment/deleteComment → notify listeners
                                                      ↓
                                         mirrorStoreToInline()
                                                      ↓
                                         annotation.comments 投影更新
                                                      ↓
                                         Vue reactivity 驱动 UI 刷新
```

### 验证

- `commentThreadStore.test.ts` 8 测试通过
- `useToolStore.severity.test.ts` 5 测试通过
- ReviewPanel / DesignerCommentHandlingPanel 全部通过

---

## 4. Step 4 · 稳定 + 回滚验证（~1h）

1. 保留 DUAL_READ flag 一个迭代
2. 验证 flag 关闭后回退到 inline 行为正常
3. eventLog 无 `dual_read_diff`
4. 更新 CHANGELOG

---

## 5. 执行顺序

```
Step 1 (开启 DUAL_READ) → Step 2 (读路径) → Step 3 (写路径) → Step 4 (稳定)
       ↓                       ↓                  ↓                ↓
     ~30min                  ~2h               ~3h              ~1h
```

**总预估：~6.5h**

Step 1 立即开始。
