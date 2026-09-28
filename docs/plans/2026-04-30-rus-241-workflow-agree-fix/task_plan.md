# 任务计划：RUS-241 审批同意失败修复

## 目标

把外部 PMS 审批流中 `agree` 动作从"失败原因不清楚"推进到"可诊断、可修复、可回归"——用户在 JH/SH/PZ 节点点击同意时能看到精确失败原因，后端返回结构化阻断信息，仿 PMS 全链路只使用 HumanCode。

## 当前阶段

Phase 5 — 全部代码实施完成，回归验证通过

## 阶段

### 阶段零：仿 PMS 用户 ID 契约对齐
- [x] 仿 PMS 模拟身份默认使用真实 PMS HumanCode（SJ/JH/SH/PZ）
- [x] 删除 proofreader_001 等内部账号兼容
- [x] 测试断言统一使用 HumanCode
- **状态：** complete

### 阶段一：失败原因可见化
- [x] 后端 `VerifyWorkflowData` 增加 `block_code` / `actor_id` / `owner_id` / `owner_source` / `expected_next_node` / `requested_next_step`
- [x] 后端 `WorkflowVerifyNextStepDiagnostic` 结构化类型
- [x] 前端 `reviewApi.ts` 双格式规范化已就绪
- [x] 仿 PMS 诊断面板展示 verify diagnostics 摘要
- **状态：** complete

### 阶段二：身份一致性硬校验
- [x] 后端 `normalize_pms_human_code()` — trim + 大写 + 白名单
- [x] `ensure_owner_matches()` 改为 HumanCode 规范化后严格比较
- [x] 拒绝非法 actor/owner 并返回 `INVALID_ACTOR_ID` / `INVALID_OWNER_ID` / `OWNER_MISMATCH`
- [x] `resolve_required_next_step()` 拒绝非法 `next_step.assignee_id`
- **状态：** complete

### 阶段三：结构化 next_step 契约
- [x] 后端 `WorkflowNextStepDetail` 类型（node/roles/assignee_id/assignee_name）
- [x] 后端 `SyncWorkflowData.next_step_detail` 新增字段
- [x] 前端 `WorkflowNextStepDetail` 类型 + `normalizeWorkflowNextStepDetail`
- [x] 仿 PMS 优先读取 `next_step_detail`，回退旧 `next_step` 字符串
- **状态：** complete

### 阶段四：批注门禁提示
- [x] 仿 PMS 诊断面板新增 `buildAnnotationCheckBlockersHtml` 展示 blockers 明细
- [x] 展示每条 blocker 的 annotationType / stateLabel / title / refnos
- [x] 按 summary 统计给出建议操作（处理待确认/处理未处理/修改被驳回）
- **状态：** complete

### 阶段五：自动化回归验证
- [x] `npm run type-check` 通过
- [x] `npm run lint`（涉及文件）通过
- [x] 167 个 RUS-241 相关测试全部通过
- [x] 确认 8 个 pre-existing 测试失败与本次改动无关
- **状态：** complete

## 技术决策

| 决策 | 理由 |
|------|------|
| 不绕过 workflow/verify | verify 是外部流程落库前的唯一业务门禁，应增强诊断而不是跳过 |
| 权限裁决放后端 | 前端只做可用性提示，后端仍是最终授权方 |
| HumanCode 白名单 SJ/JH/SH/PZ | 仿 PMS 以真实 PMS 为基线，不兼容内部账号 |
| next_step_detail 新增字段 | 不破坏旧字段 next_step 字符串的兼容性，前端优先读取新结构 |
| 后端改动放 .tmp/plant-model-gen-edit | 真实后端仓不在本工作区，改动需人工同步确认 |

## 待跟进

| 项目 | 说明 |
|------|------|
| 同步后端改动到 plant-model-gen 仓 | .tmp 只是编辑副本，需 cargo check + cargo test |
| WS review DB 环境复跑集成断言 | 本机嵌入式 DB 被路由 middleware 拦截为 500 |
| 仿 PMS simulator-runner 端到端回归 | `PMS_SIMULATOR_CASE=approved/gate-block` |
| 前端提交 | 用户确认后按 Conventional Commits 拆分 |
