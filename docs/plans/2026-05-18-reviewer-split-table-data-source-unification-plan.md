# 审核面板 split / table 视图数据源统一 · 设计计划 · 2026-05-18

> 紧贴当日早些时候的 `docs/plans/2026-05-18-reviewer-annotation-table-formid-scope-plan.md`（已合并并 push）的下一阶段。后者用最小侵入方案 A1 把表格视图的 form_id 收敛行为对齐到了卡片列表，但 ReviewPanel.vue 内部仍存在两条独立的批注数据源：
>
> - 卡片列表 split 视图：本地类型 `AnnotationListItem` + 手写 `shouldIncludeRecord` 过滤
> - 表格 table 视图：`AnnotationWorkspaceItem` + `scopeAnnotationWorkspaceItemsByFormId` helper
>
> 这条"双轨"是导致 2026-05-18 早些 bug 的根本原因，本计划把两条数据源统一为单一真理之源，让未来任何 form_id / 过滤 / 排序变更只需改一处即可同步生效。本工作量明显大于早些的"打补丁"plan（涉及 ReviewPanel.vue 渲染层重构），按"设计计划"形态先列骨架，落地前需要单独 sprint 评估、用户确认实施时间窗。

---

## 0. 背景

### 0.1 现状（2026-05-18 push 后）

`src/components/review/ReviewPanel.vue`：

| 数据流 | 视图 | 类型 | 过滤 |
|---|---|---|---|
| `allAnnotationItems` (1355–1424) | 卡片列表 (split) | 本地 `AnnotationListItem`（含 `id/type/title/description/createdAt/visible/commentCount/refno/formId/reviewState`） | 手写循环 + `shouldIncludeRecord(scopedFormId)`，scopedFormId 来自 `isExternalSjFormFocused.value ? activeReviewFormId.value : null` |
| `annotationWorkspaceItems` (1429–1448) | 批注表格 (table) | `AnnotationWorkspaceItem`（含 `id/type/title/description/createdAt/visible/refnos/severity/reviewState/authorId/statusKey/statusLabel/statusTone/priority/priorityLabel/priorityTone/activityAt/commentCount/formId`） | `buildAnnotationWorkspaceItems` + 早些 plan 加的 `if (isExternalSjFormFocused.value) scopeAnnotationWorkspaceItemsByFormId(...)` |

行为已经对齐（两条都只在 SJ 外部 form_id 聚焦时过滤），但**实现路径未对齐**。任何未来变更——比如新增 severity 过滤、新增 archived 状态隐藏、新增按 author 过滤——都需要在两处同步实现，再次面临漂移风险。

### 0.2 已经处理但未根治的事

- ✅ 表格视图 form_id 泄露（2026-05-18 早 plan，方案 A1）
- ✅ v-if 可见性（2026-05-17 plan）
- ⚠ 卡片列表与表格的事件协议、选中 / 飞到 3D / 复制 RefNo 的协议都跨两套实现（split 用 `expandedAnnotationId` + `flyToAnnotationItem`，table 用 `handleTableSelectAnnotation / handleTableOpenAnnotation`）

### 0.3 关联文档

- `docs/plans/2026-05-18-reviewer-annotation-table-formid-scope-plan.md` §8 后续建议第 1 项（明确把本工作列为下一 PR）
- `docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` §8 第 1 项「下一 PR · 数据源对齐」
- `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §11
- `.plannotator/plan-sj-reject-ui.md` §6
- `src/components/review/DesignerCommentHandlingPanel.vue` 第 504–516 行 `allAnnotationItems` + 518–535 行 `scopedAnnotationItems`：可作为目标形态参考

---

## 1. 目标 / 非目标

### 1.1 目标

1. **单一数据源**：ReviewPanel.vue 内只有一份原始批注数据 `reviewerAnnotationItems: AnnotationWorkspaceItem[]`，作为 split / table 两个视图的共同来源
2. **统一过滤**：所有 form_id / 角色 / 状态过滤都通过 `scopeAnnotationWorkspaceItemsByFormId` + `filterAnnotationWorkspaceItems` 组合实现，与 DCH 完全一致
3. **行为不变**：卡片列表 split 视图的渲染、选中、飞到 3D、评论展开行为全部保持现状（外部用户无感）
4. **0 新增 fail**：双胞胎面板 5 套件回归不新增 fail；上一轮被划为「PR 8 未转绿」的 5 条用例（`docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` §11.5）借此机会评估转绿可能性
5. **类型干净**：删掉本地 `AnnotationListItem`（如果未在其它地方依赖），用 `AnnotationWorkspaceItem` 直接驱动模板
6. **文档闭环**：把"双轨终结"写入事故复盘 §12，并在 CHANGELOG 标注「重构 · 不改行为」

### 1.2 非目标

- **不**改 `AnnotationTableView.vue` / `AnnotationWorkspace.vue` / `annotationWorkspaceModel.ts` 的对外签名
- **不**改 ribbon / DockLayout / reviewerWorkbenchViewModeBus
- **不**在本计划同时实施 A2 升级（让审核员侧也默认按 currentTask.formId 收敛）—— A2 仍留作产品确认后单独 PR
- **不**碰 DCH 的未提交修改
- **不**重写 split 视图的卡片样式（保留现有外观）

---

## 2. 架构方案

### 2.1 推荐：方案 B-Strict（与 DCH 对齐）

新建一个 setup-script 局部 computed：

```ts
// 单一原始来源
const reviewerAnnotationItems = computed<AnnotationWorkspaceItem[]>(() => {
  return buildAnnotationWorkspaceItems({
    annotations: toolStore.annotations.value,
    cloudAnnotations: toolStore.cloudAnnotations.value,
    rectAnnotations: toolStore.rectAnnotations.value,
    obbAnnotations: toolStore.obbAnnotations.value,
    getCommentCount: (type, id) => toolStore.getAnnotationComments(type, id, activeReviewFormId.value ?? undefined, currentTask.value?.id ?? undefined).length,
  });
});

// scope 收敛（与早些 fix 行为一致）
const scopedReviewerItems = computed<AnnotationWorkspaceItem[]>(() => {
  if (!isExternalSjFormFocused.value) return reviewerAnnotationItems.value;
  return scopeAnnotationWorkspaceItemsByFormId(reviewerAnnotationItems.value, activeReviewFormId.value);
});

// 后续视图使用
const totalAnnotationItemCount = computed(() => scopedReviewerItems.value.length);
const annotationWorkspaceItems = scopedReviewerItems;  // 表格直接复用
// 卡片列表模板从 allAnnotationItems 改为 scopedReviewerItems 直接渲染，但需要适配字段差异
```

### 2.2 候选：方案 B-Lite（保留 allAnnotationItems 形态）

只把 `annotationWorkspaceItems` 改成"复用 allAnnotationItems 然后 build 二次"。代码量小但本质仍是双轨；不推荐。

### 2.3 候选：方案 C（抽 composable）

新增 `src/components/review/useReviewerAnnotationItems.ts` 把 buildAnnotationWorkspaceItems + scopeAnnotationWorkspaceItemsByFormId 包成一个 hook，ReviewPanel / DCH 共用。比 B-Strict 大；放在 §8 后续 PR。

### 2.4 选定：B-Strict

理由：
- 一次性消除双轨，避免再来一次 2026-05-18 早 plan 那样的"打补丁"PR
- 卡片列表模板替换工作量可控（DCH 已有完整参照）
- 类型对齐后，未来扩展过滤维度（status / priority / author）只需改 helper

---

## 3. 文件级变更清单

| 文件 | 操作 | 估算行数 | 责任 |
|---|---|---|---|
| `src/components/review/ReviewPanel.vue` | 修改 | +100 / −80 | 删除 `allAnnotationItems` + `AnnotationListItem` 类型；新增 `reviewerAnnotationItems` / `scopedReviewerItems`；卡片列表模板字段映射对齐 `AnnotationWorkspaceItem`；事件 handler 统一返回 `AnnotationWorkspaceItem` |
| `src/components/review/ReviewPanel.test.ts` | 修改 | +30 / −20 | 调整既有用例的字段假设（如 `refnos[]` vs `refno`）；保留早些 plan 加的 3 条 form_id scope 用例；评估 5 条 PR 8 未转绿用例是否可转 |
| `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` | 修改 | +25 | 末尾追加 §12「双轨终结：split / table 数据源统一」 |
| `CHANGELOG.md` | 修改 | +6 | Unreleased 段加一条 refactor |
| `docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` | 修改 | +3 | §8 第 1 项打 ✅ 标记 + 关联 commit |

⚠ 不修改：`AnnotationTableView.vue` / `annotationWorkspaceModel.ts` / `AnnotationWorkspace.vue` / DCH 源码。

---

## 4. 实施步骤（高层 · TDD 但每 Task 工作量约 30–60 min）

### Task 1 · Baseline + 类型差异勘察
- 跑 `npm run type-check` / 双胞胎 5 套件 / lint 锁 baseline（沿用早些 plan 的 baseline 命令）
- 在 ReviewPanel.vue 头部用注释列出 `AnnotationListItem` ↔ `AnnotationWorkspaceItem` 字段差异表（`refno: string` vs `refnos: string[]` / 多出 `statusKey/statusLabel/priority/...`）
- 写 dev note 决定模板里哪些字段需要 fallback / 隐藏 / 重写

### Task 2 · 引入 scopedReviewerItems 并迁移表格视图
- 加上述 `reviewerAnnotationItems` + `scopedReviewerItems`
- 把 `annotationWorkspaceItems` 改成 `scopedReviewerItems` 的别名（or 直接删除别名，模板里用 `scopedReviewerItems`）
- 跑测试确认表格视图行为不变
- commit `refactor(review): introduce scopedReviewerItems as single source for table view`

### Task 3 · 卡片列表模板字段映射
- 把模板里所有 `item.refno` 改为 `item.refnos[0]`（or 用一个 computed util）
- 把 `item.reviewState?.updatedByName / updatedByRole / updatedAt` 改为映射后的 `AnnotationWorkspaceItem` 字段（已经直接存在，无需改）
- `flyToAnnotationItem(item)` 改为接 `AnnotationWorkspaceItem`，重新计算 refnos 数组
- commit `refactor(review): rewire ReviewPanel card list template to AnnotationWorkspaceItem`

### Task 4 · 删除 AnnotationListItem 与 allAnnotationItems
- 确认 IDE 全局 Grep 无引用后删除类型定义与 computed
- type-check / lint
- commit `refactor(review): drop legacy AnnotationListItem from ReviewPanel`

### Task 5 · 双胞胎回归 + 评估 PR 8 5 条未转绿用例
- 跑 5 套件回归，与 baseline 对比
- 看 `Reviewer 卡片筛选为待处理时，表格打开已修改批注仍定位该批注` 等 5 条 PR 8 用例是否因数据源统一而转绿
- 若转绿则 plan §11.5 与本 PR 描述同步标注「随手转绿 X 条」
- commit / docs / CHANGELOG / push

预期总时长：**0.5–1 个工作日**（含 review buffer）；如果遇到模板字段重写引起的连锁回归，可能扩到 1.5 个工作日。

---

## 5. 验收清单

- [ ] `npm run type-check` 0 error
- [ ] `npx eslint src/components/review/ReviewPanel.vue` 0 error 0 warning
- [ ] 双胞胎 5 套件 fail 数 ≤ baseline（含早些 plan 已转绿的 3 条 form_id scope）
- [ ] 早些 plan 的 3 条 form_id scope 用例仍 PASS
- [ ] `Reviewer 卡片筛选为待处理时...` 等 PR 8 用例：评估并标记转绿数（至少不引入新增 fail）
- [ ] CHANGELOG 与事故复盘 §12 同步
- [ ] PR 描述包含 baseline / after diff + 字段映射注释截图

---

## 6. 风险与缓解

| 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|
| 模板字段重写引起卡片列表渲染回归（如 refno 显示为 undefined） | 高 | 中 | Task 3 之前先在 dev server 手测一遍现状；改完再手测；用 stub 测试加视觉断言 |
| `flyToAnnotationItem` 失去 `refno` 单一字段后逻辑变化 | 中 | 中 | 写一个适配器 `function flyToWorkspaceItem(item: AnnotationWorkspaceItem)` 显式处理 `refnos[]`；保留单测 |
| `AnnotationListItem` 被其它文件引用（实际上 Grep 0 引用，但要再验证一次） | 低 | 低 | Task 4 之前 Grep `AnnotationListItem`，0 命中再删 |
| ReviewPanel.test.ts 现有 16+ fail 中部分依赖 `AnnotationListItem` 形态 mock | 中 | 中 | Task 1 baseline 比对；fail 内容如果只是 mock 字段名问题，单测内迁，不视为回归 |
| 与上一轮 v-if 修复同时回滚困难 | 低 | 低 | 本 plan 不动 v-if 模板结构；只动数据 computed + 模板内字段引用 |

---

## 7. 回滚预案

每条 commit 独立 revert。最坏情况：

```bash
git revert <commit-task5> <commit-task4> <commit-task3> <commit-task2>
```

回滚后回到早些 plan 落地状态（双轨但行为对齐），不影响 form_id scope 修复。

---

## 8. 进一步后续（不在本计划范围）

- **A2 升级 PR**：让审核员（jh/sh/pz）侧也默认按 `currentTask.formId` 收敛 split + table 视图，不再要求 SJ 外部模式才过滤。需产品确认。
- **共用 composable PR**：抽 `useReviewerScopedAnnotations(): { items, scoped, summary, filter }` 让 ReviewPanel / DCH 共用，进一步减少双胞胎面板的实现重复。
- **CI 升级**：把 form_id scope 3 条 + 数据源统一新增的回归用例放入 PR check 必跑 list。
- **删除 wiki/Plant3d-web/raw/sources lint 噪音**：考虑把 wiki 子模块从 lint 范围中 exclude，或者用 `.eslintignore` 屏蔽该目录，让 `npm run lint` 真正能反映 src 状态。

---

## 9. 关键文件锚点

| 用途 | 文件:行 |
|---|---|
| 双轨数据源 a（要删） | `src/components/review/ReviewPanel.vue:1355-1424` |
| 双轨数据源 b（要扩） | `src/components/review/ReviewPanel.vue:1429-1448` |
| 目标形态参照 | `src/components/review/DesignerCommentHandlingPanel.vue:504-535` |
| 类型对照 | `src/components/review/annotationWorkspaceModel.ts:1-200`（AnnotationWorkspaceItem 完整字段） |
| 早些 plan + commit | `docs/plans/2026-05-18-reviewer-annotation-table-formid-scope-plan.md` + commits `b6c87c4 / d07ada0 / bc51c22` |
| 上一轮 v-if 修复 | `docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` §11 |

---

## 10. 启动条件

执行本计划前，建议：

1. 早些 plan 三 commit 已 push（✅ 已完成 2026-05-18，`94b26db..bc51c22`）
2. 用户产品方面确认是否同时启动 A2 升级（同 PR 还是分两 PR）
3. 当前 git status 中未提交的 `DesignerCommentHandlingPanel.vue` 修改先决定去留（同 PR 内 lint 噪音可能联动）

---

> **当前状态：** 计划已起草，**未实施**。早些 plan 已 push 远程 main，行为修复已上线。本计划落地需要 0.5–1 个工作日 + 用户确认实施时间窗。
