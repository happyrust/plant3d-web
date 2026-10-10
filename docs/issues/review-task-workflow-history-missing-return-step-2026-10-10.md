# Issue: 退回单在任务列表 / 详情接口里没有 return 步——`review_tasks.workflow_history` 只在建单时写 `[]`，流转步只落 `review_workflow_history` 表

| 元信息 | 值 |
|------|------|
| 上报日期 | 2026-10-10 |
| 严重度 | P2（不丢数据、不阻断流转；但设计侧「批注处理」面板的退回来源 / 退回时间 / 退回单排序全部拿不到精确值，只能靠前端兜底标「约」） |
| 影响范围 | `GET /api/review/tasks`、`GET /api/review/tasks/{id}` 返回的 `workflowHistory`；前端一切从任务对象上读流转历史的地方：`reviewTaskFilters.ts`（退回节点 / 退回时间 / 排序 / 退回判定）、`DesignerCommentHandlingPanel.vue` 顶栏、`DesignerTaskSwitcher.vue` 下拉行、`useAnnotationDraftScopeSync.ts`（已被迫改口径） |
| 修复状态 | ⏳ 待拍板。前端已于 2026-10-10（设计侧批注处理面板计划 P1.2）兜底：缺 return 步时「退回自」显示「—」、退回时间回退 `updatedAt` 并标「约」。**根因在 gen-model 后端，未修。** |
| 责任文件 | gen-model：`src/web_service/review/tasks.rs`（`create_task` / `list_tasks` / `get_task` / `return_to_node` / `apply_internal_workflow_mutation_transaction`）、`src/web_service/review/platform/workflow_sync.rs`（`apply_workflow_mutation_transaction`）、`src/web_service/review/common.rs`（`TaskRow::to_review_task`、`query_review_task_page`）；plant3d-web：`src/api/reviewApi.ts`（`normalizeReviewTask`）、`src/components/review/reviewTaskFilters.ts` |
| 跟踪 | [happyrust/plant3d-web #86](https://github.com/happyrust/plant3d-web/issues/86) |

## 1. 现象描述

设计侧打开被退回的编校审单（校对 / 审核 / 批准任一节点点「驳回」退回到 SJ），在「批注处理」面板和退回单切换器里：

- 顶栏「退回自 X（操作人）· 时间」拿不到 X 和操作人，显示「退回自 —」；
- 退回时间显示「约 2026-10-10 06:55」而不是精确时间；
- 切换器里多张退回单按「退回时间」排序，实际按 `updatedAt` 排——单据只要被 PATCH 过（改标题 / 换附件 / 改构件）顺序就会变；
- 同一张单进「任务详情」（`TaskReviewDetail.vue`）却能看到完整流转时间线，含那一步「驳回」。

也就是说：**同一张单，列表 / 面板路径看不到 return 步，详情路径看得到。**

这不是「外部（PMS）流转才会漏写」——plant3d-web 自己走 `POST /api/review/tasks/{id}/return` 退回的单一样没有。`reviewTaskFilters.ts` 里那句「外部流转只带了 returnReason、没写 return 步」的注释把原因猜窄了。

## 2. 复现条件

后端模式（`USE_BACKEND = true`，gen-model `:8022` 或任一带 `/api/review/*` 的实例）：

1. 新建一张编校审单并提交到校对（`POST /tasks` → `POST /tasks/{id}/submit`）。
2. 以校对身份驳回到 SJ：`POST /api/review/tasks/{id}/return`，body `{"targetNode":"sj","reason":"复现用"}` → `200 {"success":true}`。
3. 对比三个读接口：

   ```bash
   # 列表：workflowHistory 是 []
   curl -s "$BASE/api/review/tasks?requester_id=$ME" | jq '.tasks[] | select(.id=="'$ID'") | {status, currentNode, returnReason, workflowHistory}'
   # 详情：还是 []
   curl -s "$BASE/api/review/tasks/$ID" | jq '.task | {status, currentNode, returnReason, workflowHistory}'
   # 流转历史：这里有 submit 和 return 两步
   curl -s "$BASE/api/review/tasks/$ID/workflow" | jq '.history'
   ```

   前两条 `workflowHistory: []`、`returnReason: "复现用"`，第三条 `history` 含 `{node:"jd", action:"return", comment:"复现用", …}` 即复现。

4. 前端对应现象：`DesignerCommentHandlingPanel` 顶栏「退回自 —」+ 时间带「约」；`TaskReviewDetail` 时间线有「驳回」。

本地模式（`USE_BACKEND = false`）**不复现**：`useUserStore.returnTaskToNode` 的本地分支自己往 `task.workflowHistory` 推了一条 `action: 'return'`（`useUserStore.ts:1270-1302`）。

## 3. 根本原因分析

### 3.1 后端：任务行上的 `workflow_history` 是一条从没被追加过的死字段

gen-model `src/web_service/review/`：

- **建单时写死 `[]`**：`tasks.rs:596-616` 的 `CREATE review_tasks SET … workflow_history = [] …`；响应体同样 `workflow_history: vec![]`（`tasks.rs:744-746`）。
- **每一次流转都不碰它**。两条写路径都是「`UPDATE review_tasks` 改状态 + `CREATE review_workflow_history` 另起一行」，没有 `workflow_history +=`：
  - 内部路径 `apply_internal_workflow_mutation_transaction`（`tasks.rs:220-336`）：`UPDATE review_tasks SET current_node, status, return_reason, updated_at`（240-248 行）→ `CREATE review_workflow_history CONTENT {task_id, node, target_node, action, actor_*, comment, timestamp}`（265-280 行）。`return_to_node`（`tasks.rs:2320-2540`）就是以 `history_action: "return"` 调它（2477-2495 行）；submit / approve / reject 同款。
  - 外部（PMS）路径 `apply_workflow_mutation_transaction`（`platform/workflow_sync.rs:295-430`）：同样 `UPDATE review_tasks …`（308-325 行）→ `CREATE review_workflow_history …`（342-357 行）；`apply_workflow_return`（2008-2060 行）以 `history_action: "return"` 调它。
- 全仓 `rg 'workflow_history\s*(\+=|=)' src/web_service/review` 只命中建单的 `= []` 和测试夹具。

### 3.2 后端：列表 / 详情接口原样吐这条死字段，只有 `/workflow` 读真表

- `GET /api/review/tasks` → `list_tasks`（`tasks.rs:1046`）→ `query_review_task_page`（`common.rs:768-795`）：`SELECT * FROM review_tasks …` → `TaskRow::to_review_task()` → `workflow_history: self.workflow_history.unwrap_or_default()`（`common.rs:322`）。
- `GET /api/review/tasks/{id}` → `get_task`（`tasks.rs:1181-1238`）：同一条 `SELECT * FROM review_tasks`，同一个 `to_review_task()`。
- `GET /api/review/tasks/{id}/workflow` → `get_workflow_history`（`tasks.rs:2555-2680`）：`SELECT * FROM review_workflow_history WHERE task_id = $task_id ORDER BY timestamp ASC`，映射成 `WorkflowStep`——**这是唯一把真历史按契约形状吐出来的接口**。
- `GET /api/review/tasks/{id}/history` → `get_task_history`（`tasks.rs:1750-1844`）：也读 `review_workflow_history`，但形状不同（`user_id / user_name`，没有 `node`，DESC），前端只存进 `reviewStore.reviewHistory`，没人拿它推退回元数据。

契约文档 `gen-model/docs/specs/review-api.md:96` 写明任务对象带 `workflowHistory: [{node, action, operatorId, operatorName, comment?, timestamp}]`——**契约承诺了，实现从建单之后就没兑现过**。这个字段连同建单时的 `= []` 是从旧端 plant-model-gen 原样移植过来的（ADR-075、2026-09-12 review-backend-port-plan），`common.rs:1313-1367` 的测试还在兼容它曾经被写成字符串的历史形态。

### 3.3 前端：面板链路只走任务对象，没有二次拉 `/workflow`

- 列表：`useUserStore.loadReviewTasks`（`useUserStore.ts:800`）→ `reviewTaskList`（`reviewApi.ts:1046-1061`）→ `normalizeReviewTask`（`reviewApi.ts:2181-2183`）：后端给 `[]` 就是 `[]`。
- 选中：`useReviewStore.setCurrentTask`（`useReviewStore.ts:704-731`）用 `reviewTaskGetById` 补水，`workflowHistory: response.task.workflowHistory ?? task.workflowHistory`（722 行）——详情接口也是 `[]`，补了等于没补。
- 消费：`reviewTaskFilters.ts` 的 `getLatestReturnStep`（3-12 行）找不到 return 步 → `getCanonicalReturnedMetadata.returnFromNode = null`（25-40 行）→ 面板「退回自 —」（`DesignerCommentHandlingPanel.vue:150-156`）；`getResubmissionReturnTimeInfo`（106-116 行）回退 `updatedAt` 标 `approximate` → 「约」（面板同上，切换器 `DesignerTaskSwitcher.vue:63-71`）；`sortTasksByLatestReturn` 实际按 `updatedAt` 排。`isCanonicalReturnedTask`（61-70 行）靠 `returnReason?.trim()` 兜住，所以「已退回」判定本身没错。
- 唯一拉真历史的是 `TaskReviewDetail.vue`：`getTaskWorkflowHistory` → `/workflow`（281 行），再用 `getCanonicalReturnedTaskView(task, history)` 盖回任务对象（77 行）——这就是详情看得到、面板看不到的分叉点。
- 这个分叉早已经咬过一次：`useAnnotationDraftScopeSync.ts:50-53` 明说「不从 workflowHistory 数 return 推：列表 / 详情两条路径 history 有无不一致，会把同一任务的草稿劈成两个 key」。

### 3.4 `updatedAt` 兜底为什么只能是「约」

`UPDATE review_tasks SET … updated_at = time::now()` 和 `CREATE review_workflow_history … timestamp: time::now()` 在同一事务里，退回那一刻两者相等；但 `PATCH /tasks/{id}`（`update_task`，`tasks.rs:1241-1296`）、状态更新、附件变更都会推 `updated_at`，之后就对不上了。前端只能标「约」。

## 4. 待评估的方案（本 issue 不预设结论）

### 方案 A：读接口聚合——`list_tasks` / `get_task` 把 `review_workflow_history` 合进 `workflow_history`

在 `SELECT * FROM review_tasks` 上加一个子查询列，或在 `to_review_task()` 之后按本页 `task_id` 集合做一次 `WHERE task_id IN $ids` 再内存分组（**一次**查询，不 N+1）：

```sql
SELECT *,
  (SELECT node, action, operator_id, operator_name, comment, timestamp
     FROM review_workflow_history
    WHERE task_id = record::id($parent.id)
    ORDER BY timestamp ASC) AS workflow_history
FROM review_tasks …
```

- 优点：`review_workflow_history` 成为唯一事实源；历史数据不用回填；契约 `review-api.md:96` 立刻兑现；前端一行不改。
- 缺点：列表接口多一次关联；`workflow_history` 列若仍保留会变成「写进去是 `[]`、读出来是别的」的双义字段，宜一并去掉（见 D）。
- 风险：`review_tasks` 分页查询已有过反序列化整页报错的历史（`common.rs:784-793`、`REVIEW_TASK_FALLBACK_PROBE_CAP`），子查询列要确认不触发那条退路。

### 方案 B：写时双写——两条事务里追加 `workflow_history += {…}`

在 `apply_internal_workflow_mutation_transaction` 与 `apply_workflow_mutation_transaction` 的 `UPDATE review_tasks SET …` 里加一句 `workflow_history += $step`（同一事务，原子），再跑一次回填脚本把现有 `review_workflow_history` 按 `task_id` 灌回各任务行。

- 优点：读路径零改动；列表不加关联。
- 缺点：两处写、一处回填，三份代码；此后 `review_workflow_history` 与任务行上的数组是两份副本，`review_forms.delete_workflow_history`（`platform/review_form.rs:442-445`）这类只清一边的操作会让它们漂移。

### 方案 C：前端自救——面板按单拉 `/workflow` 再 overlay

`DesignerCommentHandlingPanel` / `DesignerTaskSwitcher` 在列表就绪后对每张退回单调 `getTaskWorkflowHistory`，用 `getCanonicalReturnedTaskView` 盖回。

- 优点：只动前端。
- 缺点：n 张退回单 n 次请求；契约仍是坏的，别的消费方（dashboard、导出、`useAnnotationDraftScopeSync`）照样踩；和 `TaskReviewDetail` 一样再分叉一次。**不推荐单独采用**，最多作为 A 落地前的过渡。

### 方案 D：契约瘦身——任务对象去掉 `workflowHistory`，前端一律走 `/workflow`

`review_tasks.workflow_history` 字段与契约字段一起删除，前端 `ReviewTask.workflowHistory` 改为由 `/workflow` 填充的派生态。

- 优点：没有双义字段。
- 缺点：破坏性，前端 harness / 双胞胎夹具 / `normalizeReviewTask` / 本地模式都要改；收益不比 A 多。

倾向：**A**（单一事实源、不回填、契约兑现），并顺手把建单时的 `workflow_history = []` 和 `TaskRow.workflow_history` 一起摘掉以免双义；A 落地前前端保持现有「—」/「约」兜底不动。拍板后再开计划。

## 5. 相关文件

| 文件 | 作用 |
|------|------|
| gen-model `src/web_service/review/tasks.rs` | `create_task`（596-616 写 `workflow_history = []`）、`apply_internal_workflow_mutation_transaction`（220-336）、`list_tasks`（1046）、`get_task`（1181）、`get_task_history`（1750）、`return_to_node`（2320-2540）、`get_workflow_history`（2555-2680） |
| gen-model `src/web_service/review/platform/workflow_sync.rs` | `apply_workflow_mutation_transaction`（295-430）、`apply_workflow_return`（2008-2060）——PMS 侧退回 |
| gen-model `src/web_service/review/common.rs` | `TaskRow`（277-279）与 `to_review_task`（282-325，322 行原样吐 `workflow_history`）、`query_review_task_page`（768-795） |
| gen-model `src/web_service/review/schema.rs` | `review_workflow_history` 表定义（SCHEMAFULL，RUS-244 形态） |
| gen-model `docs/specs/review-api.md:96` | 任务对象契约里 `workflowHistory` 的承诺 |
| plant3d-web `src/api/reviewApi.ts` | `reviewTaskList`（1046-1061）、`reviewTaskGetById`（1067-1076）、`reviewTaskReturn`（1188-1201）、`reviewTaskGetWorkflow`（1207-1213）、`normalizeReviewTask`（2147-2188） |
| plant3d-web `src/composables/useUserStore.ts` | `loadReviewTasks`（800）、`returnTaskToNode`（1251-1302：后端分支只 `loadReviewTasks`，本地分支自己推 return 步） |
| plant3d-web `src/composables/useReviewStore.ts` | `setCurrentTask`（704-731）用详情接口补水 `workflowHistory` |
| plant3d-web `src/components/review/reviewTaskFilters.ts` | `getLatestReturnStep` / `getCanonicalReturnedMetadata.returnFromNode` / `getResubmissionReturnTimeInfo` / `sortTasksByLatestReturn`——兜底口径所在 |
| plant3d-web `src/components/review/DesignerCommentHandlingPanel.vue:144-159`、`DesignerTaskSwitcher.vue:63-71` | 「退回自 —」与「约」的呈现 |
| plant3d-web `src/components/review/TaskReviewDetail.vue:77, 281` | 唯一拉 `/workflow` 盖回任务对象的地方（详情看得到的原因） |
| plant3d-web `src/composables/useAnnotationDraftScopeSync.ts:50-53` | 因同一分叉被迫放弃「从 workflowHistory 数 return」的前例 |

## 6. 参考

- `docs/plans/2026-10-10-designer-comment-table-inline-processing-plan.md`：§2 非目标「不改后端接口；『退回没写 return 步』的根因另开问题追，P1.2 只做前端兜底」；§5 风险表「退回步缺失是数据问题，前端回退到 `updatedAt` 可能误导」；§8 P1「`returnFromNode` 只认 return 步 / `getResubmissionReturnTimeInfo` 缺 return 步时回退 `updatedAt` 并标『约』」。
- gen-model `docs/adr/ADR-075-review-data-persistence.md`：`review_workflow_history` 表的来历与 SCHEMAFULL / `OVERWRITE` 约束（2026-05-09 静默拒收事故）。
- gen-model `docs/plans/2026-09-12-review-backend-port-plan.md`：校审后端从旧端移植的计划，`review_tasks.workflow_history` 字段随之带过来。

## 7. 处置记录

- 2026-10-10：前端兜底随设计侧批注处理面板 P1（`3d262a64`）落地；本记录建立，等后端拍板 A / B。
- GitHub issue：[happyrust/plant3d-web #86](https://github.com/happyrust/plant3d-web/issues/86)（labels: bug, ready-for-human）。
