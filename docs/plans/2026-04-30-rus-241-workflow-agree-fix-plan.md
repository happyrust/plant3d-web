# RUS-241 审批同意失败修复开发计划

> 日期：2026-04-30  
> 状态：开发中  
> 关联问题：RUS-241 `走到审批流程无法完成同意操作`  
> 架构说明：`docs/verification/rus-241-workflow-agree-architecture.md`

## 1. 目标

把外部 PMS 审批流中的 `agree` 动作从“失败原因不清楚”推进到“可诊断、可修复、可回归”：

- 用户在 JH / SH / PZ 节点点击“同意”时，前端能明确展示失败原因。
- 后端 `workflow/verify` 能返回结构化阻断信息，而不是只给通用错误。
- 仿 PMS 的 `user_id`、`actor.id`、`next_step.assignee_id` 默认使用与真实 PMS 一致的 HumanCode（如 `SJ/JH/SH/PZ`）。
- 任务 owner、actor、next_step 全链路统一使用 PMS HumanCode；不再兼容 `proofreader_001` 这类历史/内部账号。
- `next_step` 使用结构化对象表达下一处理人，减少前端猜测。
- SJ -> JH -> SH -> PZ -> approved 主链和批注门禁链路可重复验证。

## 2. 当前判断

基于现有代码和架构文档，RUS-241 的高概率根因集中在三类：

- 身份不一致：真实 PMS、仿 PMS、任务负责人字段必须同源为 HumanCode；如果任务 owner 仍是内部账号，应视为数据/模拟构造错误并修正源头，而不是在校验层兼容。
- 下一步处理人不明确：`next_step` 在部分响应中只有字符串，前端无法稳定知道目标节点和 assignee。
- 批注门禁被正确拦截但 UI 没解释清楚：存在待处理、待确认或被退回批注时，用户只看到“同意失败”。

## 3. 影响范围

前端：

- `src/debug/pmsReviewSimulator.ts`
- `src/debug/pmsReviewSimulatorWorkflow.ts`
- `src/debug/pmsPlatformContractPayloads.ts`
- `src/api/reviewApi.ts`
- `src/components/review/ReviewPanel.vue`
- `src/components/review/reviewPanelActions.ts`

后端：

- `.tmp/plant-model-gen-edit/src/web_api/platform_api/types.rs`
- `.tmp/plant-model-gen-edit/src/web_api/platform_api/workflow_sync.rs`
- 如后续同步到真实后端仓，应迁移到对应 `plant-model-gen/src/web_api/platform_api/*`

验证：

- `pms-review-simulator.html`
- `scripts/pms-simulator-runner.ts`
- `scripts/pms-plant3d-initiate-flow.ts`
- 相关 Vitest：`src/debug/pmsReviewSimulatorWorkflow.test.ts`、`src/api/reviewApi.test.ts`、`src/components/review/reviewPanelActions.test.ts`

## 4. 阶段零：仿 PMS 用户 ID 契约对齐

状态：已完成。

### 改动点

- 明确仿 PMS 的模拟身份来源以真实 PMS 为准：
  - URL 参数：`user_id=SJ/JH/SH/PZ`
  - workflow actor：`actor.id=SJ/JH/SH/PZ`
  - 下一步处理人：`next_step.assignee_id=JH/SH/PZ`
  - 展示名称：默认同 HumanCode，除非真实 PMS 后续提供中文姓名字段。
- 复核 `src/debug/pmsPlatformContractPayloads.ts`：
  - `resolveSimulatorPmsUserIdentity()` 继续返回 HumanCode。
  - `buildEmbedUrlPayload()` 继续发送 HumanCode `user_id`。
  - `buildWorkflowSyncPayload()` 继续发送 HumanCode `actor.id`。
- 复核 `src/debug/pmsReviewSimulatorWorkflow.ts`：
  - `deriveWorkflowMutationTarget()`、`resolveWorkflowAccessDecision()` 的默认 assignee 不能回退到 `proofreader_001` 这类内部账号。
  - 从后端任务字段读取到内部账号时，判定为数据不一致并给出诊断，不做兼容匹配。
- 更新 `src/debug/pmsReviewSimulatorWorkflow.test.ts`：
  - 主链断言统一使用 `SJ/JH/SH/PZ`。
  - 删除或改写内部账号 owner 兼容测试，改为断言这类数据会被识别为不一致。

### 验收

- 仿 PMS 发起、打开、同意、退回的 payload 中不再主动生成 `designer_001/proofreader_001/reviewer_001/manager_001`。
- 自动化 snapshot 中 `currentPmsUserId`、`workflowNextStepUserId`、`taskAssignedUserId` 的主链期望均为 HumanCode。
- 内部账号只允许出现在“错误输入/数据不一致”测试中，不能被视为可通过审批的合法 owner。
- 已验证：`npm test -- src/debug/pmsReviewSimulatorWorkflow.test.ts`。
- 已验证：`npm run type-check`。

## 5. 阶段一：失败原因可见化

状态：进行中，前端 API 契约规范化与仿 PMS 诊断面板展示已完成；真实后端仓的 `workflow/verify` 结构化字段已实现并通过编译检查。

### 改动点

- 扩展后端 `workflow/verify` 失败响应，增加诊断字段：
  - `block_code`
  - `current_node`
  - `actor_id`
  - `owner_id`
  - `owner_source`
  - `expected_next_node`
  - `requested_next_step`
  - `annotation_check`
- 保持 `passed=false` 的语义不变，避免前端误以为 verify 失败可以继续 sync。
- 前端 `requestWorkflowVerify` 和仿 PMS 诊断区读取这些字段，按“身份 / 节点 / 下一步 / 批注”分类展示。
- 在 `executeWorkflowAction('agree')` 中，把 verify 拦截详情写入可见提示和 trace。
- 前端 `reviewVerifyWorkflow()` 已支持规范化以下结构化字段：
  - `block_code -> blockCode`
  - `actor_id -> actorId`
  - `owner_id -> ownerId`
  - `owner_source -> ownerSource`
  - `expected_next_node -> expectedNextNode`
  - `requested_next_step -> requestedNextStep`
- 仿 PMS 诊断面板已展示 verify diagnostics 摘要，包含 block、actor、owner、expected_next、requested_next。
- 真实后端 `plant-model-gen/src/web_api/platform_api/types.rs` 已新增 `WorkflowVerifyNextStepDiagnostic`，`VerifyWorkflowData` 已支持 `block_code`、`actor_id`、`owner_id`、`owner_source`、`expected_next_node`、`requested_next_step`。
- 真实后端 `plant-model-gen/src/web_api/platform_api/workflow_sync.rs` 已在 owner mismatch 与 annotation gate block 中填充结构化诊断字段。

### 验收

手动或脚本制造错误用户审批：

```bash
PMS_SIMULATOR_CASE=approved PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

期望失败提示中能看到当前用户、期望处理人、当前节点和后端 block code。

已验证：

```bash
npm test -- src/debug/pmsReviewSimulatorState.test.ts src/api/reviewApi.test.ts src/debug/pmsReviewSimulatorWorkflow.test.ts
npm run type-check
cargo check --lib --features web_server
```

验证限制：

- `cargo test --features web_server test_workflow_verify_agree_returns_annotation_gate_block_without_mutation` 被仓库既有 integration test `tests/regression_room_batch_compute.rs` 编译错误拦截，未进入目标用例。
- `cargo test --lib --features web_server test_workflow_verify_agree_owner_mismatch_returns_structured_diagnostics` 在本机嵌入式 DB 配置下被 `review_primary_db 仅支持 ws` 的路由 middleware 拦截为 500；该断言需在 WS review DB 环境复跑。

## 6. 阶段二：身份一致性硬校验

状态：已完成后端实现与可编译验证；WS review DB 环境下的路由集成断言仍需复跑。

### 改动点

- 在后端新增 HumanCode 规范化 helper：
  - 输入：`actor.id` 或 owner 字段。
  - 输出：trim 后的大写 HumanCode。
  - 只接受 `SJ/JH/SH/PZ` 或真实 PMS 后续确认的 HumanCode 集合。
- `ensure_owner_matches` 从原始字符串比较改为规范化 HumanCode 后的严格相等。
- 如果 owner 是 `proofreader_001` 这类内部账号，直接返回数据不一致错误，不做通过性兼容。
- 返回诊断时同时带上 owner 来源，例如 `checker_id`、`reviewer_id`、`approver_id`。
- 真实后端 `plant-model-gen/src/web_api/platform_api/workflow_sync.rs` 已实现：
  - `normalize_pms_human_code()`：trim + 大写化，只接受 ASCII 字母/数字/连字符。
  - `resolve_required_next_step()` 会拒绝非法 `next_step.assignee_id`。
  - `ensure_owner_matches()` 会拒绝非法 actor/owner，并在 verify 诊断中返回 `INVALID_ACTOR_ID`、`INVALID_OWNER_ID` 或 `OWNER_MISMATCH`。

### 验收

- JH 用户在任务 owner 为 `JH` 时可以通过 `agree`。
- SH 用户在任务 owner 为 `SH` 时可以通过 `agree`。
- PZ 用户在任务 owner 为 `PZ` 时可以通过最终审批。
- JH 用户在任务 owner 为 `proofreader_001` 时必须被拒绝，并提示 owner 不是合法 PMS HumanCode。
- 非当前节点用户仍被拒绝。

已验证：

```bash
cargo test --lib --features web_server normalize_pms_human_code
rustfmt --edition 2024 src/web_api/platform_api/types.rs src/web_api/platform_api/workflow_sync.rs src/web_api/platform_api/tests.rs
cargo check --lib --features web_server
```

## 7. 阶段三：结构化 next_step 契约

### 改动点

- 后端响应新增 `next_step_detail`，结构建议：

```json
{
  "node": "sh",
  "roles": "sh",
  "assignee_id": "SH",
  "assignee_name": "SH"
}
```

- 如果当前分支尚未发布，直接把下一步处理人收敛为结构化 `next_step_detail`，不为旧字符串语义额外做兼容分支。
- 前端构建 `agree` payload 时优先使用 `next_step_detail.assignee_id` 和 `next_step_detail.roles`。
- 仿 PMS 写入 `next_step.assignee_id` 时必须保持 HumanCode，不把节点角色转换为内部账号。
- 如果结构化字段缺失，才回退旧字符串和任务字段推断。
- 校验 `jd -> sh`、`sh -> pz`、`pz -> approved` 的目标节点必须与后端预期一致。

### 验收

- JH agree payload 中 `next_step.roles=sh`。
- SH agree payload 中 `next_step.roles=pz`。
- PZ agree 不要求下一处理人，最终状态为 `approved`。
- 旧脚本如仍依赖 `next_step` 字符串，应同步更新为读取结构化字段。

## 8. 阶段四：批注门禁提示

### 改动点

- 后端 `evaluate_annotation_check` 返回 blockers 明细：
  - `id`
  - `title`
  - `ref_no`
  - `status`
  - `owner`
  - `required_action`
- 前端在 verify 失败时，如果 block code 是 `ANNOTATION_CHECK_FAILED`，展示 blockers 列表。
- 仿 PMS 右侧面板把“无法同意”文案改为可执行提示：
  - 先处理待确认批注。
  - 切换到正确处理人。
  - 或联系管理员修正任务负责人字段。

### 验收

- 存在未确认批注时，`agree` 必须被拦截。
- UI 显示 blockers 数量和至少一条具体批注。
- 批注处理完成后，再次 `agree` 可以继续流转。

## 9. 阶段五：自动化回归

### 建议命令

```bash
npm run type-check
npm test -- src/api/reviewApi.test.ts src/components/review/reviewPanelActions.test.ts
PMS_SIMULATOR_CASE=approved PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
PMS_SIMULATOR_CASE=gate-block PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

### 验收矩阵

| 场景 | 期望 |
| --- | --- |
| SJ active | 单据进入 JH 节点 |
| JH agree | 单据进入 SH 节点 |
| SH agree | 单据进入 PZ 节点 |
| PZ agree | 单据最终 approved |
| 错误用户 agree | verify 拦截且展示 owner 诊断 |
| 批注未处理 agree | verify 拦截且展示 blockers |
| 缺失 next_step | 非 PZ 节点拦截并提示目标节点缺失 |
| 仿 PMS payload | user_id、actor.id、next_step.assignee_id 均为 HumanCode |
| 内部账号输入 | owner 为 proofreader_001 时拒绝通过，并提示数据不一致 |

## 10. 技术决策

- 不绕过 `workflow/verify`：verify 是外部流程落库前的唯一业务门禁，应增强诊断而不是跳过。
- 权限裁决放后端：前端只做可用性提示，后端仍是最终授权方。
- 仿 PMS 以真实 PMS HumanCode 为基线：模拟器应该尽量复刻真实外部系统，不能为了适配内部任务字段而改变自身输出。
- 身份校验不做内部账号兼容：发现 `proofreader_001` 这类值时应修正数据构造或上游写入，而不是放宽审批授权。
- `next_step_detail` 采用新增字段：减少破坏性，同时给前端一个稳定结构。
- 回归优先 CLI 和仿 PMS 脚本：该问题发生在跨系统审批链路，单测只能覆盖工具函数，最终仍要用模拟器验证。

## 11. 风险与注意事项

- HumanCode 白名单需要与真实 PMS 约定保持同步，避免误拒真实新增账号。
- `pz` 终审逻辑不能强制要求 `next_step`，否则会拦截最终同意。
- 仿 PMS 如果继续混用内部账号，会让模拟结果偏离真实 PMS，后续联调仍会复发身份类问题。
- 批注门禁失败不是 bug，关键是把原因讲清楚。
- 真实后端仓与 `.tmp/plant-model-gen-edit` 之间需要确认最终改动落点，避免只修了临时编辑副本。
- 当前工作区已有大量未提交变更，实施时应只修改 RUS-241 相关文件。

## 12. 推荐开发顺序

1. 先锁定仿 PMS 用户 ID 契约，确保模拟器默认只输出真实 PMS HumanCode。
2. 后端 verify 响应补诊断字段。
3. 前端错误展示消费诊断字段。
4. 后端身份校验改为规范化 HumanCode 后严格相等，并拒绝内部账号 owner。
5. 后端新增 `next_step_detail`，前端优先使用结构化下一步。
6. 批注 blockers 展示补齐。
7. 跑 approved / gate-block 两条仿 PMS 回归。

这个顺序能先把“为什么不能同意”变成可观察事实，再逐步修复真正的权限和契约问题。
