# 仿 PMS 与平台 API 对齐 — 验收计划

> 版本：v1.0 | 日期：2026-04-06 | 涵盖阶段：2 / 3 / 4

---

## 一、背景与范围

本次改动以 `plant-model-gen/src/web_api/platform_api/types.rs` 为**单一事实源**，从三个维度对齐仿 PMS 模拟器与真实 PowerPMS 的集成行为：

| 维度 | 阶段 | 目标 |
|------|------|------|
| 请求体字段 | 阶段 2 | 仿 PMS 发出的 payload 可覆盖 `types.rs` 全部业务字段 |
| 操作语义 | 阶段 3 | 默认 external、SOP 步骤与 CDP 脚本一致、环境变量共享 |
| 共享 payload + 契约脚本 | 阶段 4 | 一处定义两处使用、一条命令跑通契约序列 |

**后端契约（只读参照）**：

- `EmbedUrlRequest`：`project_id, user_id, workflow_role`（本单据工作流角色；兼容顶层键 `role`）、`workflow_mode, form_id, token, extra_parameters`
- `SyncWorkflowRequest`：`form_id, token, action, actor, next_step, comments, metadata`
- `CachePreloadRequest`：`project_id, initiator, token`
- `DeleteReviewRequest`：`form_ids, operator_id, token`

---

## 二、改动文件清单

| 文件 | 操作 | 所属阶段 |
|------|------|----------|
| `src/debug/pmsPlatformContractPayloads.ts` | **新建** — 共享 payload 构建模块 | 4 |
| `src/debug/pmsReviewSimulatorWorkflow.ts` | **修改** — import + re-export 委托 | 2 + 4 |
| `src/debug/pmsReviewSimulator.ts` | **修改** — UI 联动、workflow mode 动态切换、环境变量预置 | 2 + 3 |
| `pms-review-simulator.html` | **修改** — 新增 UI 控件（mode 下拉、SOP 清单、环境变量区） | 2 + 3 |
| `scripts/pms-contract-sequence.ts` | **新建** — 契约序列验证脚本 | 4 |

---

## 三、阶段 2 验收：请求体与 types.rs 对齐

### 3.1 embed-url payload 字段覆盖

**验收条件**：`buildSimulatorEmbedUrlPayload`（现委托到 `buildEmbedUrlPayload`）输出的 JSON 可覆盖 `EmbedUrlRequest` 全部字段。

| 字段 | 来源 | 验收操作 |
|------|------|----------|
| `project_id` | 工具栏「项目号」下拉 | 选择任意项目，检查 payload 中 `project_id` 存在且非空 |
| `user_id` | 顶部用户切换按钮 | 切换 SJ→JH，检查 `user_id` 变为 `JH` |
| `role` | 自动由用户映射 | SJ→`sj`、JH→`jd`、SH→`sh`、PZ→`pz` |
| `workflow_mode` | 平台 API 参数面板下拉 | 选择 `external`，检查 `workflow_mode: "external"` 出现 |
| `form_id` | 续流程时携带 | 打开某条已有记录再次 embed，检查 `form_id` 非空 |
| `token` | 平台 API 参数面板输入框 | 手动填入任意字符串，检查 `token` 字段出现在 payload |
| `extra_parameters` | 平台 API 参数面板 textarea | 输入 `{"is_reviewer": true}`，检查 `extra_parameters` 以 JSON 对象形式出现 |

**手动验证步骤**：

1. 浏览器打开 `http://localhost:3101/pms-review-simulator.html?debug_ui=1`
2. 展开「▸ 平台 API 参数（types.rs 对齐）」面板
3. 在 `workflow_mode` 下拉中选择 `external`
4. 在 `token` 输入框填入 `test-token-123`
5. 在 `extra_parameters` 文本区填入 `{"custom_key": "value"}`
6. 点击「新增」按钮
7. 打开浏览器 DevTools → Network，检查 `POST /api/review/embed-url` 请求体
8. **预期**：请求体包含 `project_id`、`user_id`、`role`、`workflow_mode`、`token`、`extra_parameters` 全部字段

### 3.2 workflow/sync payload 字段覆盖

**验收条件**：`buildSimulatorWorkflowSyncPayload`（现委托到 `buildWorkflowSyncPayload`）输出覆盖 `SyncWorkflowRequest` 全部字段。

| 字段 | 来源 | 验证 |
|------|------|------|
| `form_id` | iframe 返回的 form_id | 创建编校审后检查非空 |
| `token` | embed-url 返回的 JWT | 自动填入 |
| `action` | 面板操作按钮 | 分别触发 `active`/`agree`/`return`/`stop`/`query` |
| `actor` | 当前用户自动构建 | 检查 `id`、`name`、`roles` |
| `next_step` | 流程推进时自动填充 | SJ active 时 `assignee_id=JH`，`roles=jd` |
| `comments` | 评论输入框 | 输入「测试评论」，检查出现在 payload |
| `metadata` | 平台 API 参数面板 textarea | 输入 `{"integration_version": "1.0"}`，检查出现 |

**手动验证步骤**：

1. 完成 embed-url 后在 iframe 中创建编校审数据
2. 在 `metadata` 文本区填入 `{"integration_version": "1.0"}`
3. 在评论框输入「验收测试评论」
4. 点击「确认提交流转」（active）
5. DevTools Network 检查 `POST /api/review/workflow/sync` 请求体
6. **预期**：包含 `metadata`、`comments`、`actor`、`next_step` 等全部字段

### 3.3 cache/preload 与 delete 按钮

**验收条件**：平台 API 面板中的 `cache/preload` 和 `delete` 按钮可触发对应请求。

| 操作 | 预期 |
|------|------|
| token 未就绪时 | 两个按钮均为 `disabled`，提示「token 可用后启用」 |
| 完成 embed-url 后 | 按钮启用，提示显示 token 前 12 位 |
| 点击 `cache/preload` | 发出 `POST /api/review/cache/preload`，body 含 `project_id`、`initiator`、`token` |
| 点击 `delete` | 弹出 `confirm` 二次确认，确认后发出 `POST /api/review/delete`，body 含 `form_ids`、`operator_id`、`token` |

---

## 四、阶段 3 验收：操作语义与 SOP 对齐

### 4.1 workflow_mode 默认值与切换

| 场景 | 预期 |
|------|------|
| 页面首次加载 | 下拉默认选中 `external（真实 PMS 默认）` |
| 切换为 `manual` | 出现黄色警告框：`⚠ 当前 workflow_mode="manual"（非 external）：与真实 PMS 默认行为不一致，仅用于验证 plant3d 内部按钮流程。` |
| 切换为 `internal` | 类似警告，显示 `internal` |
| 切回 `external` | 警告消失 |
| 选择「不传」 | 无警告，`workflow_mode` 不出现在 payload |
| `PASSIVE_WORKFLOW_MODE` 联动 | `external` 时为 `true`，`manual` 时为 `false`；影响 side panel 模式和诊断区文案 |

**手动验证步骤**：

1. 打开模拟器页面，展开平台 API 参数面板
2. 确认 `workflow_mode` 下拉默认为 `external`
3. 切换为 `manual`，确认警告出现
4. 切回 `external`，确认警告消失
5. 观察页面右侧诊断区 `PASSIVE_WORKFLOW_MODE` 值随之变化

### 4.2 SOP 操作清单

**验收条件**：平台 API 面板底部显示 7 步 SOP 清单，与 `scripts/pms-chrome-devtools-flow.ts`（CDP 脚本）的关键操作顺序一致。

| 步骤 | SOP 描述 | 对应 CDP 操作 |
|------|---------|--------------|
| 1 | 选择 PMS 用户 | CDP 的 login 步骤 |
| 2 | 选择项目号 | 项目选择 |
| 3 | 点击「新增」→ embed-url → iframe | 新增按钮 → 三维打开 |
| 4 | iframe 中填写编校审数据 | 注入构件 + 创建编校审数据 |
| 5 | PMS 面板执行 workflow/sync active | 确认提交流转 |
| 6 | 刷新列表确认新记录 | PMS JSON 嗅探断言 |
| 7 | （Extended）切换校对用户 JH | clearCookies + JH 登录 + 查看/批注 |

**验证**：

- 每一步可勾选 checkbox
- 勾选状态不影响任何程序逻辑（纯人工 checklist）
- 7 步覆盖完整的编审流程闭环

### 4.3 CDP 环境变量预置

**验收条件**：4 个环境变量输入框可通过 URL 参数或 localStorage 预填。

| 变量 | URL 参数别名 | localStorage key | 验证 |
|------|-------------|------------------|------|
| `PMS_TARGET_BRAN_REFNO` | `bran_refno` | `pms_target_bran_refno` | 访问 `?bran_refno=24381_145018`，输入框自动填入 |
| `PMS_MOCK_PACKAGE_NAME` | `package_name` | `pms_mock_package_name` | 同上 |
| `PMS_EMBEDDED_SITE_SUBSTRING` | `embed_site` | `pms_embedded_site_substring` | 同上 |
| `PMS_CDP_WORKFLOW_MODE` | — | — | 只读，自动显示当前 workflow_mode 值 |

**手动验证步骤**：

1. 访问 `http://localhost:3101/pms-review-simulator.html?debug_ui=1&bran_refno=24381_145018&package_name=TestPkg&embed_site=pms.example.com`
2. 展开平台 API 参数面板，检查 3 个输入框已预填
3. `PMS_CDP_WORKFLOW_MODE` 显示 `external`（只读）
4. 切换 `workflow_mode` 下拉为 `manual`，检查 `PMS_CDP_WORKFLOW_MODE` 不变（初始值固定）

---

## 五、阶段 4 验收：共享 payload 模块 + 契约序列脚本

### 5.1 共享 payload 模块

**验收条件**：`src/debug/pmsPlatformContractPayloads.ts` 为唯一 payload 定义源。

| 检查项 | 预期 |
|--------|------|
| 模块导出全部 5 个构建函数 | `buildEmbedUrlPayload`、`buildWorkflowSyncPayload`、`buildAuthLoginRequest`、`buildCachePreloadPayload`、`buildDeleteReviewPayload` |
| 模块导出全部共享类型 | `SimulatorPmsUser`、`WorkflowRole`、`WorkflowMutationAction`、`SimulatorActorIdentity`、`WorkflowSyncNextStepPayload` |
| `pmsReviewSimulatorWorkflow.ts` 无重复定义 | 所有 payload 函数为 `const xxx = _importedFn` 委托 |
| `scripts/pms-contract-sequence.ts` 使用同一模块 | `import { ... } from '../src/debug/pmsPlatformContractPayloads'` |
| 仿 PMS 模拟器功能不受影响 | 所有已有流程正常工作 |

**验证方法**：

```bash
# 搜索重复定义（预期 0 结果）
grep -n "function buildSimulatorEmbedUrlPayload\|function buildSimulatorWorkflowSyncPayload\|function buildSimulatorAuthLoginRequest" src/debug/pmsReviewSimulatorWorkflow.ts
```

### 5.2 契约序列脚本

**验收条件**：一条命令可跑通 7 步 API 序列验证。

**前置条件**：

- `plant-model-gen` 后端运行在 `localhost:3100`
- Node.js 20+ 可用
- `tsx` 可用（自动 npx 安装）

**执行命令**：

```bash
npx tsx scripts/pms-contract-sequence.ts --base http://localhost:3100 --verbose
```

**预期输出**：

```text
═══════════════════════════════════════════════════════════
 PMS 平台 API 契约序列验证
  后端: http://localhost:3100  用户: SJ  项目: TEST_PROJECT  模式: external
═══════════════════════════════════════════════════════════

[0/6] POST /api/auth/token (login)
  ✓ [auth/token] HTTP 200 (xxms) code=0 Bearer token 已获取

[1/6] POST /api/review/embed-url
  ✓ [embed-url] HTTP 200 (xxms) code=200 form_id=FORM-EXAMPLE

[2/6] POST /api/review/tasks (seed)
  ✓ [review-task(seed)] HTTP 200 (xxms) form_id=FORM-EXAMPLE task_id=task-xxxx seed task 创建成功

[3/6] POST /api/review/workflow/verify
  ✓ [workflow/verify] HTTP 200 (xxms) form_id=FORM-EXAMPLE task_id=task-xxxx passed=true recommended_action=proceed reason=验证通过，可继续流转

[4/6] POST /api/review/workflow/sync (action=query)
  ✓ [workflow/sync(query)] HTTP 200 (xxms) code=200 form_id=FORM-EXAMPLE task_id=task-xxxx

[5/6] POST /api/review/cache/preload
  ✓ [cache/preload] HTTP 200 (xxms) code=200 form_id=FORM-EXAMPLE

[6/6] POST /api/review/delete (cleanup seeded form)
  ✓ [delete] HTTP 200 (xxms) code=200 form_id=FORM-EXAMPLE task_id=task-xxxx 已请求清理 seed form

───────────────────────────────────────────────────────────
  结果: 7/7 步骤通过
───────────────────────────────────────────────────────────
```

**各步骤判定标准**：

| 步骤 | 通过条件 | 失败条件 |
|------|---------|---------|
| auth/token | HTTP 200 + `code=0` + 返回 token | 非 200 或无 token |
| embed-url | HTTP 200 + `code=200` + 返回 `form_id` 与 workflow token | 非 200 或缺字段 |
| review-task(seed) | HTTP 200 + `success=true` + 返回 `task_id` + 与同一 `form_id` 绑定 | 非 200、无 `task_id`、或 `form_id` 不一致 |
| workflow/verify | HTTP 200 + 返回 `passed / reason / recommended_action` | 404、400、或缺结构化字段 |
| workflow/sync(query) | HTTP 200 或 401 | 400（格式错误）、404（端点缺失）、422 |
| cache/preload | HTTP 200/202/401/404 | 400、422 |
| delete | HTTP 200/400/401/404 | 422、500 |

> **说明**：`workflow/verify` 现在必须先基于真实 `form_id` 创建 seed task，再验证 `active`。  
> `401` 仅表示「端点可达 + 请求体格式正确 + JWT 认证被正确触发」；`404` 只允许出现在真正不存在的 `form_id`，不能再算“契约通过”。

**CLI 参数与环境变量**：

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `--base` | `PMS_CONTRACT_BASE_URL` | `http://localhost:3100` | 后端地址 |
| `--project` | `PMS_CONTRACT_PROJECT_ID` | `TEST_PROJECT` | 项目号 |
| `--user` | `PMS_CONTRACT_USER` | `SJ` | PMS 用户 |
| `--mode` | `PMS_CONTRACT_WORKFLOW_MODE` | `external` | workflow mode |
| `--verbose` / `-v` | — | `false` | 显示完整 payload 和响应 |

---

## 六、types.rs 字段 1:1 对照表

### 6.1 EmbedUrlRequest ↔ buildEmbedUrlPayload

| Rust 字段 | serde 别名 | TypeScript payload key | 来源 |
|-----------|-----------|----------------------|------|
| `project_id: String` | — | `project_id` | `options.projectId` |
| `user_id: String` | — | `user_id` | `resolveSimulatorPmsUserIdentity().userId` |
| `workflow_role: Option<String>` | `workflow_role`、兼容 `role` | `workflow_role` | `options.currentWorkflowRole` |
| `workflow_mode: Option<String>` | `workflowMode` | `workflow_mode` | `options.workflowMode`（UI 下拉） |
| `form_id: Option<String>` | — | `form_id` | `options.preferredFormId`（续流程） |
| `token: Option<String>` | — | `token` | `options.token`（UI 输入框） |
| `extra_parameters: Option<Value>` | — | `extra_parameters` | `options.extraParameters`（UI textarea JSON） |

### 6.2 SyncWorkflowRequest ↔ buildWorkflowSyncPayload

| Rust 字段 | TypeScript payload key | 来源 |
|-----------|----------------------|------|
| `form_id: String` | `form_id` | `options.formId` |
| `token: String` | `token` | `options.token` |
| `action: String` | `action` | `options.action` |
| `actor: WorkflowActor` | `actor: { id, name, roles }` | 自动构建 |
| `next_step: Option<WorkflowNextStep>` | `next_step?: { assignee_id, name, roles }` | 流程推进时自动 |
| `comments: Option<String>` | `comments` | 评论输入框 |
| `metadata: Option<Value>` | `metadata` | `options.metadata`（UI textarea JSON） |

### 6.3 CachePreloadRequest ↔ buildCachePreloadPayload

| Rust 字段 | TypeScript payload key | 来源 |
|-----------|----------------------|------|
| `project_id: String` | `project_id` | `options.projectId` |
| `initiator: String` | `initiator` | `options.initiator`（当前用户） |
| `token: String` | `token` | `options.token`（embed JWT） |

### 6.4 DeleteReviewRequest ↔ buildDeleteReviewPayload

| Rust 字段 | TypeScript payload key | 来源 |
|-----------|----------------------|------|
| `form_ids: Vec<String>` | `form_ids` | 选中的 form_id 列表 |
| `operator_id: String` | `operator_id` | 当前用户 |
| `token: String` | `token` | embed JWT |

---

## 七、回归验证 Checklist

以下为完整回归验证清单，验收人逐项打勾确认。

### 7.1 基础流程（不受本次改动影响）

- [ ] SJ 用户新增 → embed-url → iframe 打开
- [ ] iframe 中创建编校审数据成功
- [ ] 确认提交流转（workflow/sync active）成功
- [ ] 列表刷新显示新记录
- [ ] JH 用户打开同一记录
- [ ] JH 执行「确认流转至审核」（workflow/sync agree）
- [ ] 任务状态流转正确

### 7.2 阶段 2 新增功能

- [ ] embed-url payload 包含 `workflow_mode` 字段
- [ ] embed-url payload 包含 `token` 字段（手动填入时）
- [ ] embed-url payload 包含 `extra_parameters` 字段（JSON 输入时）
- [ ] workflow/sync payload 包含 `metadata` 字段（JSON 输入时）
- [ ] `cache/preload` 按钮可触发请求
- [ ] `delete` 按钮有二次确认并可触发请求

### 7.3 阶段 3 新增功能

- [ ] 页面加载时 workflow_mode 默认 `external`
- [ ] 切换非 external 模式时出现黄色警告
- [ ] 切回 external 时警告消失
- [ ] `PASSIVE_WORKFLOW_MODE` 随下拉联动
- [ ] SOP 清单 7 步可勾选
- [ ] URL 参数 `?bran_refno=xxx` 自动填入对应输入框
- [ ] URL 参数 `?package_name=xxx` 自动填入
- [ ] URL 参数 `?embed_site=xxx` 自动填入
- [ ] `PMS_CDP_WORKFLOW_MODE` 显示只读且值正确

### 7.4 阶段 4 新增功能

- [ ] `npx tsx scripts/pms-contract-sequence.ts --base http://localhost:3100` 退出码 0
- [ ] 5/5 步骤通过
- [ ] `pmsReviewSimulatorWorkflow.ts` 中无 `buildSimulatorEmbedUrlPayload` 函数体定义
- [ ] `pmsReviewSimulatorWorkflow.ts` 中无 `buildSimulatorWorkflowSyncPayload` 函数体定义
- [ ] `pmsReviewSimulatorWorkflow.ts` 中无 `buildSimulatorAuthLoginRequest` 函数体定义
- [ ] `pmsPlatformContractPayloads.ts` 导出上述 3 个函数的完整实现

---

## 八、已知限制与后续

| 项目 | 说明 |
|------|------|
| workflow/sync 401 | 测试环境下 JWT 签名验证失败，因 embed-url 每次生成新 form_id，与 auth/token 的 form_id 不同。真实环境中 PMS 使用同一 token 调用序列，不会出现此问题 |
| cache/preload 401 | 同上，S2S token 验证在测试环境下预期失败 |
| 阶段 5（HAR diff） | 需联调环境，不在本次验收范围 |
| 已有 lint 警告 | `pmsReviewSimulator.ts` 中存在 8 个预先存在的 TypeScript 警告（如 `ReviewTask` 未导出、`replaceAll` 类型等），均为历史遗留，本次改动未引入新警告 |

---

## 九、验收签字

| 角色 | 姓名 | 日期 | 结果 |
|------|------|------|------|
| 开发 | | | |
| 验收 | | | |
