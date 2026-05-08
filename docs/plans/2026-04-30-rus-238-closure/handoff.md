# RUS-238 提交拆分交接

## 目的

本文件用于提交或 PR 前拆分变更，避免把 RUS-238 新建单据验收补丁与其它已存在的 workflow/RUS-241 改动混在同一个说明里。

## 建议提交结构

### Commit/PR A · `plant3d-web` 文档与证据

范围：

- `docs/plans/2026-04-30-rus-238-closure/task_plan.md`
- `docs/plans/2026-04-30-rus-238-closure/findings.md`
- `docs/plans/2026-04-30-rus-238-closure/progress.md`
- `docs/plans/2026-04-30-rus-238-closure/review-query-fresh-client-architecture.html`
- `docs/plans/2026-04-30-rus-238-closure/handoff.md`

说明重点：

- 新建单据 `FORM-37C372A7407F` / `task-1104fb4f-8787-4ff9-9aee-3125ecb452ff` 验收通过。
- Cursor browser 可见批注、测量和 `RefNo 24381/145018, 24381_145018`。
- 文档记录了后端阻塞根因和补丁边界。

### Commit/PR B · `plant-model-gen` RUS-238 后端短连接补丁

只归因于 RUS-238 的内容：

- `src/web_api/review_db.rs`
  - `review_db_address(...)`
  - `fresh_review_db()`
- `src/web_api/review_api.rs`
  - `fresh_review_db` import
  - `query_review_task_page(...)` 使用 fresh client
  - task list/detail/history/workflow 读接口使用 fresh client
  - records by task 使用 fresh client
  - comments by annotation 使用 fresh client
- `src/web_api/platform_api/review_form.rs`
  - review form schema/query 使用 fresh client
  - task by form lookup 使用 fresh client
- `src/web_api/platform_api/workflow_sync.rs`
  - workflow models/attachments/records/comments 查询使用 fresh client

验证重点：

- `cargo fmt -- src/web_api/review_db.rs src/web_api/review_api.rs src/web_api/platform_api/review_form.rs src/web_api/platform_api/workflow_sync.rs`
- `cargo check --bin web_server --features web_server`
- `cargo build --bin web_server --features web_server`
- direct API 四项 200：
  - task detail
  - records by task
  - comments by annotation
  - workflow
- Cursor browser 新建单据可见性通过。

## 不应归因到 RUS-238 的内容

当前 `plant-model-gen` 工作区存在大量其它 staged/unstaged 改动，其中一些与 RUS-241/workflow agree 更相关。提交说明中不要把这些写成 RUS-238 的工作：

- `WorkflowVerifyNextStepDiagnostic`
- `normalize_pms_human_code(...)`
- `verify_block_code`
- `verify_actor_id`
- `verify_owner_id`
- `verify_owner_source`
- `verify_expected_next_node`
- `verify_requested_next_step`
- workflow agree/owner diagnostics 相关测试与类型变更
- admin static assets、site registry、collab/mqtt/admin 等非 review fresh client 变更

## 推荐操作顺序

1. 先在 `plant3d-web` 单独提交 RUS-238 文档证据。
2. 在 `plant-model-gen` 中先确认 staged 区已有改动是否属于其它任务。
3. 对 `plant-model-gen` 只选择 fresh client 相关 hunks 形成 RUS-238 后端补丁。
4. RUS-241/workflow agree 相关内容单独提交或保留在原任务分支。
5. PR 描述中明确：RUS-238 的 runtime 修复位于 `plant-model-gen`，前端仓只包含验收证据和方案文档。

## 当前注意事项

- 不要用 `git reset --hard` 或 `git checkout --` 清理工作区。
- 不要在未拆分前运行全量 `git add .`。
- 如果要自动化拆分，建议先新建 worktree 或让负责人确认当前 staged 内容的归属。
