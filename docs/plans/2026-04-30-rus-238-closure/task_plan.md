# RUS-238 新建单据测量路径显示开发方案

## 目标

在仿 PMS 新建单据链路中，确认并稳定恢复测量/批注记录，使右侧校审卡片和模型视图都能显示目标构件路径：

- 下划线格式：`24381_145018`
- 斜杠格式：`24381/145018`

本方案同时覆盖本轮暴露出的后端阻塞：`plant-model-gen` 的 `review_primary_db` 池化 SurrealDB ws client 挂起导致 review 查询 500/超时。

## 当前结论

- 新建单据 `FORM-37C372A7407F` / `task-1104fb4f-8787-4ff9-9aee-3125ecb452ff` 已创建并验收通过。
- 数据库内 task、record、annotation、measurement、comment 均存在。
- 独立 `surreal sql` 查询毫秒级返回，说明 SQL 与数据不是根因。
- patched backend 下，Cursor browser 可见：
  - 审核记录 `1`
  - 历史流转 `1`
  - 批注 `1`
  - 待处理 `1`
  - `RefNo 24381/145018, 24381_145018`
  - 模型视图批注与 `1.00 m` 测量标记。

## 开发阶段

### Phase 1 · 固化后端短连接读路径

状态：已实现，待评审。

范围：

- `plant-model-gen/src/web_api/review_db.rs`
  - 新增 `fresh_review_db()`。
  - 复用现有 ws 地址、root 登录、ns/db 选择逻辑。
- `plant-model-gen/src/web_api/review_api.rs`
  - 将 task list/detail/history/workflow、records by task、comments by annotation 切到 fresh client。
- `plant-model-gen/src/web_api/platform_api/review_form.rs`
  - 将 form lookup 和 task by form lookup 切到 fresh client。
- `plant-model-gen/src/web_api/platform_api/workflow_sync.rs`
  - 将 workflow query 读路径切到 fresh client。

验收标准：

- 不再因为池化 ws client 挂起导致新页面进入时 records/history/workflow 查询 500/超时。
- 写路径保持原样，避免扩大变更面。

### Phase 2 · 固化 RUS-238 新建单据回归验证

状态：已手工验证，建议补自动化最小脚本。

最小脚本目标：

1. 创建或复用新建单据。
2. 写入包含 `refnos: ["24381/145018", "24381_145018"]` 的 annotation。
3. 写入 distance measurement。
4. 用 JH external token 打开 Plant3D review 页面。
5. 断言右侧卡片出现：
   - `RefNo 24381/145018, 24381_145018`
   - 批注计数 `1`
   - 审核记录 `1`
   - 历史流转 `1`

建议先保留为 CLI/browser 验证，不急于新增大规模 e2e，避免扩大不稳定面。

### Phase 3 · 文档与 Linear 收口

状态：已完成初版。

已更新：

- `progress.md`
- `findings.md`
- Linear RUS-238 评论

待确认：

- 是否将 Linear RUS-238 状态从 `In Progress` 改为 `Done`。
- 跨仓提交时是否把 `plant-model-gen` 后端补丁与 `plant3d-web` 验证文档拆成两个 commit/PR。

## 风险与约束

- `fresh_review_db()` 是最小稳定性修复，代价是每个关键读请求新增一次 ws 连接开销。
- 长期更优方案仍是为 `review_primary_db` 池增加健康检查、熔断与恢复，或升级 SurrealDB client。
- 当前变更有意只覆盖新建单据验收依赖的读路径；不要顺手重构所有 review 写路径。
- `plant-model-gen` 文件已有未提交状态，整理提交前需要确认 staged/unstaged 内容边界，避免混入无关改动。

## 跨仓变更边界

### `plant3d-web`

本仓当前 RUS-238 规划/证据只应包含：

- `docs/plans/2026-04-30-rus-238-closure/task_plan.md`
- `docs/plans/2026-04-30-rus-238-closure/findings.md`
- `docs/plans/2026-04-30-rus-238-closure/progress.md`
- `docs/plans/2026-04-30-rus-238-closure/review-query-fresh-client-architecture.html`

这些是验收证据和开发方案，不包含运行时代码变更。

### `plant-model-gen`

RUS-238 后端补丁边界只应包含 fresh client 相关变更：

- `src/web_api/review_db.rs`
  - `review_db_address(...)`
  - `fresh_review_db()`
- `src/web_api/review_api.rs`
  - `query_review_task_page(...)`
  - task list/detail/history/workflow 读接口
  - records by task
  - comments by annotation
- `src/web_api/platform_api/review_form.rs`
  - review form schema/query
  - task by form lookup
- `src/web_api/platform_api/workflow_sync.rs`
  - workflow models/attachments/records/comments 读查询

当前 `plant-model-gen` 同一批文件中还存在其它未提交改动，例如 `WorkflowVerifyNextStepDiagnostic`、`normalize_pms_human_code`、verify diagnostics 等 RUS-241/workflow agree 方向内容。提交或 PR 拆分时不要把这些内容归因到 RUS-238。

## 验证清单

- [x] `cargo fmt -- src/web_api/review_db.rs src/web_api/review_api.rs src/web_api/platform_api/review_form.rs src/web_api/platform_api/workflow_sync.rs`
- [x] `cargo check --bin web_server --features web_server`
- [x] `cargo build --bin web_server --features web_server`
- [x] direct API 验证 task detail 200
- [x] direct API 验证 records by task 200
- [x] direct API 验证 comments by annotation 200
- [x] direct API 验证 workflow 200
- [x] Cursor browser 验证新建单据可见 RefNo 双格式、批注与测量标记
- [x] 提交前确认跨仓 diff 边界
# RUS-238 测量路径显示闭环任务计划

> 使用方式：本文件作为后续执行的主计划；`findings.md` 记录事实与决策，`progress.md` 记录每轮执行日志。  
> 关联 Linear：RUS-238 `测量数据路径显示问题`

## 1. 当前结论

RUS-238 不应只按“完整路径 UI 已接入”来关闭。当前代码侧能力已经覆盖测量路径展示，但原始工单还需要真实流程闭环：

- 文本展示：已完成。测量列表、批注测量证据、确认回放均具备 refno fallback；完整路径 lookup 已接入相关展示层。
- 历史记录读取：已补 scoped 查询为空时的 task 级 fallback，兼容历史无 `formId` 的确认记录。
- 真实验收：未完成。仍缺目标 BRAN、PMS 包名/任务单、角色和入口。

流程图：

- Mermaid 源文件：`rus-238-closure-flow.mmd`
- 渲染结果：`rus-238-closure-flow.svg`

## 2. 目标

- 证明校核人员关闭后重新进入同一单据时，3D 测量线可恢复。
- 证明右侧批注/校审记录可见，且关联测量证据不为空。
- 证明测量路径在三处入口展示一致：测量列表、批注测量证据、确认回放。
- 如果完整路径 lookup 失败，仍稳定 fallback 到规范化 refno，不暴露 `o:...:0`。
- 输出可写入 Linear/PR 的验收证据。

## 3. 非目标

- 不迁移历史确认记录。
- 不把完整路径或展示文案写回 `MeasurementRecord`。
- 不重构测量创建、定位、隐藏、删除和确认记录存储主流程。
- 不把当前工作区中与 RUS-238 无关的大量变更混入本任务。

## 4. 阶段计划

### Phase 0 · 验收输入收集

需要输入：

| 输入 | 用途 | 状态 |
| --- | --- | --- |
| 目标 BRAN/refno | 加载真实模型并创建测量 | 待提供 |
| PMS 包名或任务单 | 从 PMS/编校审入口定位同一单据 | 待提供 |
| 角色 | 至少覆盖 SJ、JH，必要时 SH/PZ | 待提供 |
| 页面入口 | 本地三维、仿 PMS 或真实 PMS | 待确认 |
| 样例测量 | 距离、角度、带批注证据的确认记录 | 待创建/定位 |

通过条件：

- `progress.md` 写入上述输入。
- 可以复现同一单据的关闭后重新进入流程。

### Phase 1 · 本地流程验收

任务：

- 加载目标模型。
- 创建距离测量和角度测量。
- 将至少一条测量关联到批注。
- 保存确认记录。
- 关闭/切换任务后重新打开。
- 检查测量线、右侧记录和三处路径展示。

通过条件：

- 3D 场景可恢复测量线。
- 测量列表可见。
- 右侧批注记录可见。
- 批注测量证据可见。
- 确认回放可见。

### Phase 2 · PMS/编校审流程验收

任务：

- SJ 从 PMS 或仿 PMS 入口发起/打开三维校审。
- JH 校核阶段创建测量并驳回。
- 关闭三维页面，回到列表。
- JH 再次进入同一任务，检查恢复情况。
- SJ 打开退回任务，检查测量线、右侧记录和批注证据。

通过条件：

- JH 再次进入时 3D 测量线恢复。
- JH 右侧记录不为空。
- SJ 退回查看时测量线和右侧处理记录可见。
- 全流程不暴露内部 object id。

### Phase 3 · 缺口修复

只有 Phase 1/2 复现缺口时才进入代码修改。

优先排查顺序：

1. `useReviewStore.loadConfirmedRecords()`：确认记录是否按 task/formId 正确进入 store。
2. `confirmedRecordsRestore.ts`：viewer ready、tools ready、records 变化时是否触发恢复。
3. `reviewRecordReplay.ts`：历史 measurements 是否转成 xeokit 回放数据。
4. `AnnotationWorkspace.vue` / `ReviewPanel.vue` / `DesignerCommentHandlingPanel.vue`：右侧记录是否被 formId 过滤。
5. `useMeasurementPathSummaries.ts` / `measurementPathLookup.ts`：完整路径 lookup 是否失败并正确 fallback。

通过条件：

- 每个修复先有 RED 测试。
- 最小实现后测试变绿。
- 不引入持久化结构变更。

### Phase 4 · 收敛与交付

任务：

- 更新 `progress.md` 的验收结果。
- 更新 `findings.md` 的最终结论。
- 必要时更新 `docs/plans/2026-04-30-rus-238-measurement-path-acceptance-plan.md`。
- 在 Linear RUS-238 评论中写入：
  - 修复范围；
  - 验收环境；
  - 角色和数据；
  - 命令验证；
  - 截图或录屏路径；
  - 已知限制。

可关闭标准：

- 三处展示一致。
- 重新进入可恢复测量线。
- 右侧记录可见。
- PMS/编校审至少覆盖 JH 重新进入和 SJ 退回查看。
- type-check、目标测试、定向 lint 通过。

## 5. 验证命令

```bash
npm test -- "src/composables/useReviewStore.test.ts" "src/components/review/confirmedRecordsRestore.test.ts" "src/components/review/reviewRecordReplay.test.ts" "src/components/review/measurementDisplay.test.ts" "src/components/review/annotationWorkspaceModel.test.ts" "src/components/tools/MeasurementPanel.test.ts" "src/components/review/TaskReviewDetail.test.ts"
npm run type-check
npx eslint "src/composables/useReviewStore.ts" "src/composables/useReviewStore.test.ts" "src/components/review/confirmedRecordsRestore.ts" "src/components/review/reviewRecordReplay.ts" "src/components/review/measurementDisplay.ts" "src/components/review/annotationWorkspaceModel.ts" "src/components/tools/MeasurementPanel.vue" "src/components/review/TaskReviewDetail.vue"
```

## 6. 执行守则

- 每完成一个阶段，更新 `progress.md`。
- 每发现稳定事实，更新 `findings.md`。
- 每个代码修复先写失败测试，再实现。
- 如果真实 PMS 输入缺失，不声明 RUS-238 已验收完成。
