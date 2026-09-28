# RUS-241 技术发现

## 架构发现

### 前端 reviewApi.ts 已有完整双格式规范化
- 所有 Workflow 响应类型（Verify/Sync）同时支持 `snake_case` 和 `camelCase`
- 后端只需发 `snake_case`，前端自动规范化
- `RawWorkflowVerifyData` 已有 `block_code/actor_id/owner_id/owner_source/expected_next_node/requested_next_step` 的双格式读取

### 仿 PMS 诊断面板已有 verify diagnostics 展示
- `summarizeWorkflowVerifyDiagnostics()` 和 `summarizeVerifyAnnotationCheck()` 已输出结构化摘要
- `buildWorkflowVerifyDiagnostics()` 已从 verify response 中提取 block/actor/owner/next_step 信息
- 本次新增 `buildAnnotationCheckBlockersHtml()` 展示 blocker 明细

### next_step 当前实现方式
- 后端 `SyncWorkflowData.next_step` 是 `Option<String>`（仅节点名如 "sh"）
- 前端 `getWorkflowNextStepPayload()` 尝试读取 next_step 对象，但后端返回的是字符串
- 本次新增 `next_step_detail` 结构化字段解决此问题

## 身份校验发现

### owner 字段映射
- `sj` 节点 → `requester_id`
- `jd` 节点 → `checker_id`（优先） / `reviewer_id`（回退）
- `sh` / `pz` 节点 → `approver_id`
- owner 来自 `current_node_owner()` 函数

### HumanCode 校验规则
- 只允许 ASCII 字母/数字/连字符
- trim + 大写化后必须在白名单 SJ/JH/SH/PZ 内
- 内部账号（proofreader_001 等）直接返回 INVALID_OWNER_ID 错误

## 测试发现

### pre-existing 测试失败（与 RUS-241 无关）
- `AnnotationOverlayBar.test.ts` — disabled 属性匹配失败
- `useMbdPipeAnnotationThree.flyTo.test.ts` — 模式默认显示映射
- `useModelProjects.test.ts` — 项目切换
- `useReviewStore.confirm.test.ts` — severity 跨快照保留
- `useToolStore.severity.test.ts` — 严重度更新/规范化
- `useUserStore.test.ts` — inbox 可见性和 websocket 通知
- `auth.severity.test.ts` — 严重度常量排列

### RUS-241 相关测试：167 个全部通过
- `pmsReviewSimulatorWorkflow.test.ts` — 39 tests
- `reviewPanelActions.test.ts` — 24 tests
- `reviewApi.test.ts` — 38 tests
- `ReviewPanel.test.ts` — 34 tests
- 其他 debug/*.test.ts — 32 tests
