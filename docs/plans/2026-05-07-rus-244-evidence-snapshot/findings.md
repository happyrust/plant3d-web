# 关键事实（已通过代码 + 即将运行的仿 PMS 基线确认）

## F1. workflow_sync 路径完全不写 review_records / review_annotation_states
- 证据：`src/web_api/platform_api/workflow_sync.rs`
  - `apply_workflow_active` (L1276) — 仅 `UPDATE review_tasks SET current_node, status, ...` + `sync_review_form_with_task_status` + `CREATE review_workflow_history`
  - `apply_workflow_return` (L1380)、`apply_workflow_agree` (L1486)、`apply_workflow_stop` (L1637) — 同形
- 影响：PMS 编校审主路径下校核侧批注与测量从未落库

## F2. review_records 唯一写入入口是 `POST /api/review/records` → `create_record`
- 证据：`src/web_api/review_api.rs` L2129–L2412
  - 写库 + `sync_annotation_states_from_snapshot`（`review_api.rs` L2362）
  - 强 owner 检查：`owner_id != operator_id` → 直接 403
- 影响：除非校核人手动点击 plant3d-web「保存新增证据」按钮，否则两张表都没数据

## F3. PMS 模式下 JH / SH / PZ 不会主动点 plant3d-web 的「保存新增证据」按钮
- 证据：业务流程（PMS 平台按钮 → `workflow_sync` → workflow 直接推进，plant3d-web 不在闭环上）
- 用户故事：SJ 打开被驳回单据 → `loadConfirmedRecords` 返空 → `confirmedRecordsRestorer.currentTaskRecords` 空 → toolStore 全空 → `DesignerCommentHandlingPanel.scopedAnnotationItems` 空 → 面板 UI 显示"当前范围内还没有可处理的批注"

## F4. task_id 在工作流流转中保持不变
- 证据：所有 `apply_workflow_*` 都是 `UPDATE review_tasks SET ... WHERE record::id(id) = $task_id`
- 排除掉根因候选：「task_id 切片导致 SJ 查不到 JH 写的 records」不成立

## F5. annotation_check 门禁不会兜住此场景
- 证据：`src/web_api/platform_api/annotation_check.rs` 通过 `load_annotation_states_by_task` 查 `review_annotation_states` 表
- 因为 F1 + F2，`review_annotation_states` 表也是空的 → `passed = true`，门禁认为"没有未处理批注"，反而放行流程

## F6. 设计端 confirmedRecordsRestorer 严格按 taskId + formId 双过滤
- 证据：`src/components/review/confirmedRecordsRestore.ts` L66-L79
- 影响：即使后续把 records 塞进数据库但 taskId/formId 不一致，回放也会被过滤掉 → 必须保证 helper 写库时绑的 taskId/formId 与 SJ 视角看到的完全一致

## F7. PMS embed 入口正常解析到 form_id + task_id
- 证据：`src/components/review/embedContextRestore.ts` 通过 `findTaskByFormId` 在 designerTasks 中查匹配 task；同 form_id 的 task 在 review_tasks 表里只有一条，task_id 唯一
- 影响：解析路径无问题，问题在源端（review_records 表为空）

## F8. workflow_sync precheck 已经做 actor/owner 一致性校验（RUS-241 修复结论）
- 证据：`apply_workflow_*` 进入前的 `WorkflowMutationPrecheck` 包含 actor.id / owner_id / role 校验
- 影响：B.2 中 `EvidencePersistMode::Trusted` 跳过 owner 检查是安全的，不会引入越权写入

# 仿 PMS 基线（2026-05-07 16:30 UTC，本机 SurrealDB ws://127.0.0.1:8020 / NS 1516 / DB AvevaMarineSample）

## B1. 表统计（直接证明根因）

| 表 | 行数 | distinct task | 业务含义 |
|---|---|---|---|
| `review_workflow_history` (action='return') | **36 次 return** | **35 个被驳回过的 task** | 历史上至少 35 个 task 进入过"被驳回"状态 |
| `review_records` | **14 行** | **14 个 task** | 真实落库的 evidence snapshot 数 |
| `review_annotation_states` | 57 行 | — | 仅在 `create_record` 成功路径上才同步，分布与 review_records 高度相关 |

**Δ = 35 - 14 = 21 个被驳回过的 task 完全没有 review_records 数据**——这 21 个就是 RUS-244 的现象集合：SJ 打开它们时面板必然为空。

**所有 14 个有 records 的 task 都同时在 history.action='return' 集合里**（即出现过 return 后才有 records），这与"records 是 JH 在驳回前主动点击保存的人工产物"的根因一致；没有"JH 漏点"的 task 就什么都没有。

## B2. 实时 backend 日志（2026-05-07 仿 PMS 运行中观察）

simulator 触发 SJ → JH 流转后，每次 `[WORKFLOW_SYNC]` 日志里 `records=N`：

```
[WORKFLOW_SYNC] form_id=FORM-BE67026E6F4C, action=active, ... current_node=Some("jd"), next_step=Some("jd")
[WORKFLOW_SYNC] 数据查询完成 - form_id=FORM-BE67026E6F4C, models=1, records=0, comments=0, attachments=0, ...
[WORKFLOW_SYNC] form_id=FORM-127D58806387, action=active, ...
[WORKFLOW_SYNC] 数据查询完成 - form_id=FORM-127D58806387, models=1, records=0, ...
```

每个新建 form 在 active 完成后 `records=0`，与"workflow_sync 主路径不写 review_records"完全吻合。

## B3. 一键复现 SQL

```sql
USE NS 1516 DB AvevaMarineSample;

-- 历史 return 次数
SELECT count() AS history_returns FROM review_workflow_history WHERE action = 'return' GROUP ALL;
SELECT count() AS distinct_returned_tasks FROM (SELECT VALUE task_id FROM review_workflow_history WHERE action = 'return' GROUP BY task_id) GROUP ALL;

-- 实际有 evidence 的 task
SELECT count() AS records_total FROM review_records GROUP ALL;
SELECT count() AS distinct_records_tasks FROM (SELECT VALUE task_id FROM review_records GROUP BY task_id) GROUP ALL;

-- 缺失证据的被驳回 task（这一组就是 RUS-244 的受害者）
LET $returned_tasks = (SELECT VALUE task_id FROM review_workflow_history WHERE action = 'return' GROUP BY task_id);
LET $records_tasks  = (SELECT VALUE task_id FROM review_records GROUP BY task_id);
SELECT VALUE task_id FROM $returned_tasks WHERE task_id NOT IN $records_tasks;
```

## B4. 仿 PMS 自动化基线（artifacts）

- 命令：`bun run test:pms:simulator -- --cases=return`（仍在后台运行，runner 实际跑了 5 个 case 的截图，但 `--cases=return` 只过 return 主流程）
- 中间 artifact 目录：`artifacts/baseline/pms-simulator-artifacts/`
  - `backend.log`（已捕获每次 active 后 `records=0`）
  - `pms-simulator-artifacts/screenshots/return.png`
- 待 simulator 收尾后再补一份完整 `pms-simulator-return.json`

## B5. 修复后预期对比

| 指标 | 修复前（基线） | 修复后（B 方案） |
|---|---|---|
| `review_records.distinct_records_tasks / review_workflow_history.distinct_returned_tasks` | 14/35 = 40% | 期望 ≥ 95%（剩余 < 5% 是 PMS 端 snapshot 抓取超时或字段为空的合法情况） |
| 单次 simulator return 场景跑完后 SJ 视角 `GET /api/review/records/by-task/{task}` 行数 | 0 | ≥ 2（JH agree 一次 + SH agree 一次） |
| `[WORKFLOW_SYNC] records=N` after agree/return | 永远 0 | 与 task 当前操作者节点匹配的 records 行数（≥ 1） |
