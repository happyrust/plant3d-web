# 任务对象补回流转历史——修复 #86「退回没写 return 步」开发计划（2026-10-10）

> 状态：**进行中**。plannotator 评审已通过（2026-10-10，`{"decision":"approved"}`，无批注）；§7 五项 2026-10-10 用户拍板「全按推荐」；**T5 已落地**（本仓，见 §9），T1–T4 待在 gen-model 开工。
> 依据：问题记录 `docs/issues/review-task-workflow-history-missing-return-step-2026-10-10.md` 与 [happyrust/plant3d-web #86](https://github.com/happyrust/plant3d-web/issues/86)；后端 `gen-model@858c94fb0`（main）；前端 `plant3d-web@d4dcdc6a`（main）。
> 性质：跨仓计划（gen-model 校审后端为主 · 本仓一处归一 + 走查）。本文只定「改什么、分几步、怎样算完成」；契约字段形状以 `gen-model/docs/specs/review-api.md` 为准，改契约先改那份再改本文。

## 0. 一句话

`review_tasks.workflow_history` 自建单写 `[]` 之后再没人追加，真流转步全在 `review_workflow_history` 表里；本计划让 `GET /api/review/tasks` 与 `GET /api/review/tasks/{id}` 在返回前**按本页 task_id 一次性把 `review_workflow_history` 合进 `workflowHistory`**（方案 A，表为唯一事实源），摘掉任务行上的死字段，前端只补一处「步内 `timestamp` 字符串 → 毫秒」的归一，让 `reviewTaskFilters` 现有口径自动拿到精确的「退回自 / 退回时间 / 排序」，`updatedAt` 兜底退为真正的兜底。

## 1. 现状（2026-10-10 核过，出处见问题记录 §3）

| 项 | 现状 | 出处 |
| --- | --- | --- |
| 写 | 内部 `return_to_node` / submit / approve / reject 与 PMS `workflow/sync` 两条事务都是 `UPDATE review_tasks SET current_node, status, return_reason, updated_at` + `CREATE review_workflow_history`；任务行 `workflow_history` 不追加 | gen-model `tasks.rs:220-336`、`platform/workflow_sync.rs:295-430` |
| 建单 | `CREATE review_tasks SET … workflow_history = []` | `tasks.rs:596-616` |
| 读 | `list_tasks` → `query_review_task_page`、`get_task` 都 `SELECT * FROM review_tasks` → `TaskRow::to_review_task()` 原样吐 `workflow_history`；只有 `GET /tasks/{id}/workflow` 读真表 | `common.rs:768-795`、`common.rs:322`、`tasks.rs:1181`、`tasks.rs:2555-2680` |
| 契约 | 任务对象承诺 `workflowHistory: [{node, action, operatorId, operatorName, comment?, timestamp:"YYYY-MM-DD HH:MM:SS"}]` | `gen-model/docs/specs/review-api.md:96` |
| 真表形状 | `review_workflow_history`：`task_id, form_id, node, target_node, action, operator_id, operator_name, actor_id, actor_role, actor_name, source, comment, timestamp, created_at`；SCHEMAFULL，RUS-244 之后 `operator_*` 为 `option`，有的行只带 `actor_*` | `schema.rs`、ADR-075 §D5 |
| 前端读 | `reviewApi.normalizeReviewTask` 把 `workflow_history` **原样透传**（不逐步归一）；`/workflow` 的 `history` 也原样用。`WorkflowStep.timestamp` 类型是 `number`，后端给的是字符串 | `reviewApi.ts:2181-2183`、`types/auth.ts:156-163` |
| 前端算 | `getResubmissionLatestReturnTime` 用 `Math.max(...timestamps)`：字符串进去得 `NaN` → 仍走 `updatedAt`「约」——**后端修完若前端不归一，面板看不出变化** | `reviewTaskFilters.ts:100-116` |
| 已有先例 | 同仓已有 `WHERE task_id IN $task_ids` 一次取多单记录再内存分组的写法 | `common.rs:1998`、`sync.rs:80`、`platform/review_form.rs:445` |
| 分页反序列化脆弱 | `review_tasks` 整页 `take::<Vec<TaskRow>>` 曾因单字段形状整页报错，留有逐行探测退路 | `common.rs:784-793`、`REVIEW_TASK_FALLBACK_PROBE_CAP` |

## 2. 目标与非目标

- G1 列表 / 详情接口返回的 `workflowHistory` 与 `GET /tasks/{id}/workflow` 的 `history` **逐条相等**（同序、同字段值）。
- G2 `review_workflow_history` 是唯一事实源：不回填、不双写；任务行上的 `workflow_history` 不再写入、不再读取。
- G3 列表接口不 N+1：每页最多一次附加查询。
- G4 前端不改口径、不改组件：只在 `normalizeReviewTask`（和 `/workflow` 响应）补步内 `timestamp` 归一；`reviewTaskFilters` 现有函数因此拿到精确值，面板「退回自 校对（张校对员）· 2026-10-10 06:55」不带「约」、切换器按真实退回时间排序。
- G5 回归：gen-model `cargo test --lib --features http_api web_service::review` 不比基线少；本仓双胞胎 5 套 + `reviewTaskFilters.test.ts` + `reviewApi.test.ts` 不新增 fail；type-check 不新增错误。

**非目标**

- 不改 `review_workflow_history` 表结构、不改两条写事务（它们写得对）。
- 不动 `GET /tasks/{id}/history`（`user_id / user_name`、DESC 的旧形状，另有消费方）。
- 不动 `TaskReviewDetail.vue` 单独拉 `/workflow` 的做法（修完它与任务对象一致，留着无害；收口另议）。
- 不处理「`timestamp` 字符串是北京时间、前端按本地时区解析」的既有偏差——`created_at / updated_at` 一直如此，统一改时区表示不在本计划。
- 不做 PMS 侧任何改动。

## 3. 方案选择

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| **A 读接口聚合（选）** | 读路径把真表合进任务对象 | 单一事实源、零回填、契约立刻兑现、前端几乎不改；代价是列表多一次查询 |
| B 写时双写 + 回填 | 两条事务 `workflow_history += $step` + 一次性回填脚本 | 三处改、两份副本会漂（`review_forms.delete_workflow_history` 只清一边） |
| C 前端按单拉 `/workflow` | 面板 n 次请求 overlay | 契约仍坏、再分叉一次；只配做过渡 |
| D 契约删字段 | 任务对象去掉 `workflowHistory`，一律走 `/workflow` | 破坏性，前端 harness / 夹具 / 本地模式全要改，收益不比 A 多 |

A 内部两种实现：

- **A1 一次 `IN` 查询 + 内存分组（推荐）**：`query_review_task_page` / `get_task` 拿到 `Vec<ReviewTask>` 后，收集 id，`SELECT task_id, node, action, operator_id, operator_name, actor_id, actor_name, comment, timestamp FROM review_workflow_history WHERE task_id IN $task_ids ORDER BY timestamp ASC`，按 `task_id` 分组塞回。不碰 `SELECT * FROM review_tasks` 那条脆弱的反序列化路径；与同仓 `IN $task_ids` 先例同款。
- A2 子查询列：`SELECT *, (SELECT … FROM review_workflow_history WHERE task_id = record::id($parent.id) ORDER BY timestamp ASC) AS workflow_history FROM review_tasks …`。少一次往返，但把新列塞进那条曾整页报错的 `take::<Vec<TaskRow>>`，且逐行探测退路（`recover_review_task_page_with_row_probes`）也要同步带上子查询。

→ 取 **A1**（§7-Q1）。

## 4. 任务拆分（文件归属互不重叠；T1 → T2 → T4 顺序，T5 可独立先行，T3 随 T1 同笔）

### T1 · 后端：读路径聚合（gen-model）

| # | 任务 | 改动 | 验收 |
| --- | --- | --- | --- |
| T1.1 | 新 helper `attach_workflow_history(db, &mut [ReviewTask])`：空集合直接返回；否则一次 `IN $task_ids` 查询、按 `task_id` 分组、`timestamp ASC` 塞回 `workflow_history`；`operator_id / operator_name` 为空时回退 `actor_id / actor_name`（§7-Q5）；查询失败只 `warn!` 并保留空数组，不让列表 5xx | `common.rs`（放在 `query_review_task_page` 旁） | 单测：三张单 × 乱序历史 → 各自按时间升序、互不串；只带 `actor_*` 的行 operator 不为空；空集合不发查询 |
| T1.2 | `list_tasks` 的两条出口（正常页、探测恢复页）与 `get_task` 调 T1.1 | `tasks.rs:1046-1178`、`1181-1238` | V1 / V2 |
| T1.3 | `get_workflow_history` 改用同一 helper 的行映射（或抽同一个 `WorkflowStep` 转换函数），保证 G1「逐条相等」不是巧合 | `tasks.rs:2555-2680` | V1 |

### T2 · 后端：摘掉死字段（gen-model，§7-Q2）

| # | 任务 | 改动 | 验收 |
| --- | --- | --- | --- |
| T2.1 | 建单不再写 `workflow_history = []` | `tasks.rs:613` | 建单后 `SELECT workflow_history FROM review_tasks` 为 `NONE` |
| T2.2 | `TaskRow` 去掉 `workflow_history` 字段（无 `deny_unknown_fields`，老行上的 `[]` / 字符串被 serde 忽略）；`to_review_task()` 先填空数组，由 T1.1 填充；`review_task_from_value`（探测路径，`common.rs:610-750`）同步不读该键 | `common.rs:277-279, 322, 659` | `common.rs:1313-1367` 那组「legacy-string-payload」测试改为断言「忽略」仍绿 |
| T2.3 | 测试夹具里 `workflow_history = []` 的 `CREATE` 语句清理（不影响行为，只是别再暗示它有用） | `platform/tests.rs:213, 263, 1915, 1922` | 编译 + 测试过 |

### T3 · 契约与文档（gen-model）

| # | 任务 | 改动 | 验收 |
| --- | --- | --- | --- |
| T3.1 | `review-api.md` 任务对象 `workflowHistory` 一行注明「来源 `review_workflow_history`，与 `/tasks/{id}/workflow` 同源同序；`operator*` 空时回退 `actor*`」；§12 变更记录一条 | `docs/specs/review-api.md:96, §12` | 文档 |
| T3.2 | `changelog.md` 一条，引 #86 与本文路径 | `changelog.md` | 文档 |

### T4 · 后端测试（gen-model，`mem://` 实跑，放 `platform/tests.rs`）

| # | 用例 | 断言 |
| --- | --- | --- |
| T4.1 | 建单 → submit → return：`GET /tasks/{id}` 与 `GET /tasks?requester_id=` 的 `workflowHistory` 都恰好两步，第二步 `action="return"`、`node="jd"`、`comment` 为驳回原因；与 `GET /tasks/{id}/workflow` 的 `history` 逐字段相等 | V1 / V2 |
| T4.2 | PMS 路径 `workflow/sync action=return` 之后同上 | V3 |
| T4.3 | 列表三张单，其中一张无历史：各自历史不串、无历史的是 `[]`；SurrealDB 查询计数：整页只多 1 条附加查询 | V4 |
| T4.4 | 把 `review_workflow_history` 一行的 `operator_id / operator_name` 置空、只留 `actor_*`：任务对象里该步 `operatorName == actor_name` | V5 |

### T5 · 前端配合（plant3d-web，零契约改动，可先于后端合入）

| # | 任务 | 改动 | 验收 |
| --- | --- | --- | --- |
| T5.1 | `normalizeReviewTask` 对 `workflow_history` 逐步归一：`timestamp` 经 `normalizeTimestamp`（字符串 / 秒 / 毫秒都认），`operatorId / operatorName` 兼容 snake / camel，非法步丢弃；抽成 `normalizeWorkflowStep` 导出，`reviewTaskGetWorkflow` 的 `history` 走同一函数（§7-Q4） | `reviewApi.ts:2181-2183`、`1207-1213` | `reviewApi.test.ts`：字符串时间戳 → 毫秒数字；`reviewTaskFilters.test.ts` 补「后端形状（字符串时间戳）的 return 步」一组，`getResubmissionReturnTimeInfo.approximate === false`、排序正确 |
| T5.2 | 修正 `reviewTaskFilters.ts:106-109` 那段把原因猜窄的注释（「外部流转只带了 returnReason」→「后端 #86 修复前任务对象不带流转步」），口径不变 | `reviewTaskFilters.ts` | 文案 |
| T5.3 | `useUserStore.ts:196-222` 已有的 `normalizeWorkflowStep` 与 T5.1 合并为一处（二选一保留，另一处改为引用） | `useUserStore.ts` | 现有用例不变 |

### T6 · 收尾（两仓）

| # | 任务 | 验收 |
| --- | --- | --- |
| T6.1 | 真机走查：gen-model `:8022` + 本仓 dev，设计侧打开被退回的单：顶栏「退回自 校对（操作人）· 精确时间」无「约」；切换器两张退回单顺序 = `/workflow` 里 return 步时间倒序；`TaskReviewDetail` 时间线与面板一致。截图进 `docs/verification/2026-10-10-review-task-workflow-history/` | V6 |
| T6.2 | 问题记录 §7、本文 §9 回填提交号与验证数字；`gh issue close 86 --comment` 附 V1–V6 结果 | V7 |

## 5. 验收（每条第三方可独立判真假）

| # | 条件 | 判法 |
| --- | --- | --- |
| V1 | 内部 `POST /tasks/{id}/return` 后，`GET /tasks/{id}` 的 `task.workflowHistory` 与 `GET /tasks/{id}/workflow` 的 `history` JSON 逐条相等 | T4.1 + curl 对拍 |
| V2 | `GET /tasks?requester_id=…` 里同一张单的 `workflowHistory` 与 V1 相等 | T4.1 |
| V3 | PMS `workflow/sync action=return` 后同 V1 | T4.2 |
| V4 | 一页 100 张单，SurrealDB 查询数 = 基线 + 1（count、page、history 三条） | T4.3 日志 / 计数 |
| V5 | 只带 `actor_*` 的历史行在任务对象里 operator 非空 | T4.4 |
| V6 | 本仓真机：面板顶栏不含「约」、「退回自」非「—」、切换器顺序与 `/workflow` 一致 | T6.1 截图 |
| V7 | gen-model `cargo test --lib --features http_api web_service::review` ≥ 基线；本仓双胞胎 5 套 + `reviewTaskFilters.test.ts` + `reviewApi.test.ts` 全过；type-check 新增 0 | 计数 |

## 6. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 列表附加查询在大页上变慢 | 低 | `review_workflow_history` 已有 `idx_workflow_task`（`task_id`）索引（`schema.rs:174-177` 的 DDL 护栏钉着）；`IN` 集合 ≤ 页大小（默认 100）；T4.3 记一次 100 单页耗时 |
| 附加查询失败把整页列表拖成 5xx | 中 | T1.1 只 `warn!` 回空数组，列表照常返回；前端兜底「约」仍在 |
| 前端 `Math.max` 对字符串得 `NaN` → 后端修了面板看不见 | 高（静默） | T5.1 必做且可先行；T5 用例用后端真实形状（字符串时间戳） |
| `TaskRow` 去字段后老行 `workflow_history` 是字符串的那批数据 | 低 | serde 忽略未知字段；`review_task_from_value` 同步不读；保留 legacy 测试改为「忽略」 |
| `review_workflow_history` 里 `timestamp` 为 `NONE` 的脏行 | 低 | helper 对 `NONE` 用 `created_at` 兜底，再无则排最后 |
| 工作树多会话共用（两仓都是） | 中 | 只 `git add` 本计划涉及的明确路径 |

## 7. 需要拍板（2026-10-10 已拍板：五项全按推荐）

1. **聚合方式**：A1 一次 `IN` 查询 + 内存分组（推荐，不碰脆弱的整页反序列化、同仓有先例） / A2 子查询列。
2. **死字段处置**：建单停写 `workflow_history = []` 并让 `TaskRow` 不再读它（推荐，避免「写进去是 `[]`、读出来是别的」的双义） / 保留列不动只覆盖读值。老数据不迁移。
3. **`/tasks/{id}/history`** 是否顺手统一成 `WorkflowStep` 形状：推荐**不动**（非目标；它另有消费方，形状变更要单独核）。
4. **前端 `/workflow` 响应**是否与任务对象走同一个 `normalizeWorkflowStep`：推荐**是**（一个函数两处用，`TaskReviewDetail` 从此也拿毫秒数）。
5. **`operator_*` 空时回退 `actor_*`** 放在后端 helper（推荐，契约字段永远有值）/ 放前端。

## 8. 顺序与工期

1. T5（前端归一，独立一笔，先合——对现状无害，后端上线那一刻面板自动变准）：0.3 人日。
2. T1 + T3 一笔；T2 一笔；T4 随 T1 / T2 各自带上：合计 0.8 人日。
3. T6 收尾 0.2 人日。合计约 **1.3 人日**（不含拍板等待）。
4. 每笔提交信息引本文路径与 #86；交付附改动文件清单、测试计数、对应 V 条输出。

## 9. 落地记录

- 2026-10-10 · **T5 落地**（plant3d-web，fable-5-1-92）· 改动文件：`src/api/workflowStepNormalize.ts`（新：`normalizeTimestampMillis` / `normalizeWorkflowStep` / `normalizeWorkflowSteps`；独立成模块是因为十余个测试把 `@/api/reviewApi` 整个 mock 掉，放 reviewApi 里 `useUserStore` 一调就报「mock 缺导出」）、`src/api/reviewApi.ts`（`normalizeReviewTask` 对 `workflow_history` 逐步归一；`reviewTaskGetWorkflow` 的 `history` 同一函数；`normalizeTimestamp` 改为委托；re-export 两个归一函数）、`src/composables/useUserStore.ts`（删本地 `normalizeWorkflowStep`，改引用）、`src/components/review/reviewTaskFilters.ts`（T5.2 注释改口指向 #86，口径不变）、`src/api/reviewApi.test.ts`（+3）、`src/components/review/reviewTaskFilters.test.ts`（+2，后端形状经 `normalizeReviewTask` 后 `approximate === false`、按真实退回时间排序）、`scripts/type-check-baseline.txt`（498 → 495，`useUserStore` 原 `.map` on `{}` / 隐式 any 三条随删除消失）、`CHANGELOG.md` 一条。与计划的偏差：T5.3「二选一保留」落成「第三处新模块、两处引用」，原因如上。**验证**：9 个直接相关文件 157 例全过；双胞胎 5 套 134 例全过；全仓 342 文件 **3218 例全过**（3213 + 5 新增）；`npm run type-check` **495 / 基线 495、新增 0**；ESLint 触及 6 个文件 0（修了 2 处 import 顺序）。V7 前端半边达成；V1–V6 等 T1–T4。
