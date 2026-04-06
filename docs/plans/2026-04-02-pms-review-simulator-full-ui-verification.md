# 仿 PMS 调试页全链路 UI 验收收口（2026-04-02）

## 1. 结论

当前仿 PMS 调试页的关键流程，已经拿到**同一条任务、一镜到底、全 UI 串行闭环**的真实证据。

最终状态定义：

> **status: single-run-full-ui-verified**

本次已确认：

1. `manual/internal` 审批主链可在仿 PMS 页面内按真实按钮完整走通：
   - `SJ 创建`
   - `JH agree`
   - `SH agree`
   - `PZ agree`
   - 最终 `approved`
2. `external/passive` 模式下，`workflow/sync` 主链已通过真实界面点击跑通：
   - `SJ active -> JH agree -> SH agree -> PZ agree -> approved`
   - `SJ active -> JH agree -> SH stop -> cancelled`
   - `SJ active -> JH agree -> SH agree -> PZ return -> sj -> SJ reopen initiate`
3. `approved / cancelled` 两类终态已在 3 个事实源上对齐：
   - `review_tasks.status`
   - `workflow/sync?action=query`
   - `embed-url` 返回的 `form.status / lineage.status`
4. 附件回写阶段此前出现的 `localhost:3100` vs `127.0.0.1:3101` 本机跨域问题已解除，本轮回归未再出现 `PATCH ... net::ERR_FAILED` / `CORS policy` / `updateTaskAttachments failed`。
5. 基于固定测试 BRAN **`24381_145018`** 的仿 PMS 真实界面点击证据链已补齐：
   - `JH` 阶段可真实添加 **1 条批注 + 1 条测量 + 1 个附件**
   - 最终 `approved` reopen 时，iframe 内已恢复：
     - 批注
     - 测量
     - 附件条目（当前展示为 attachment `description` / 标签）
6. 当前剩余边界已收敛为：
   - iframe 内附件 tab 已显示附件条目
   - 但默认显示的是 `workflow/sync query.data.attachments.description`
   - **尚未强制显示原始上传文件名**

---

## 2. 本轮修复口径

### 2.1 修复一：本机 loopback 地址统一走同源 `/api` 代理

问题现象：

- 页面 origin：`http://127.0.0.1:3101`
- 开发环境 API base：`http://localhost:3100`

浏览器会把它们视为不同 origin，导致：

- `PATCH /api/review/tasks/:id`
- 附件回写
- 其他带 preflight 的请求

在调试页里出现跨域预检失败。

本轮收口方式：

- 在 `src/utils/apiBase.ts` 中新增 `resolveBackendApiBaseUrl(...)`
- 当满足以下条件时，开发环境直接回退到 `''`，统一走同源 `/api` proxy：
  - `envBase` 是 loopback 地址（`localhost` / `127.0.0.1`）
  - 浏览器当前 origin 也是 loopback 地址

这样即使 `.env.development` 仍写成：

```text
VITE_GEN_MODEL_API_BASE_URL=http://localhost:3100
```

前端在 `http://127.0.0.1:3101` 下访问时，也会自动收口到同源代理，避免本机 host 名不一致带来的跨域噪音。

---

### 2.2 修复二：仿 PMS 改为“PMS 用户 + 工作流角色”双轨模型

之前 manual/internal 主链卡死在 `JH` 的根因不是按钮文案，而是：

- 仿 PMS 固定角色按钮是：`SJ / JH / SH / PZ`
- 真实任务负责人是：
  - `checkerId = proofreader_001`
  - `approverId = manager_001`
- 旧逻辑切到 `JH` 时，仍直接拿 `user_id = JH` 去换 token

结果后端权限校验会报：

> `权限不足：用户 JH 不是「校对」节点的负责人`

本轮收口方式：

- 新增 `src/debug/pmsReviewSimulatorWorkflow.ts`
- 先把仿 PMS 的**PMS 用户**与**工作流角色**拆开建模

当前统一口径如下：

| 维度 | 含义 |
|------|------|
| `SJ / JH / SH / PZ` | PMS 测试用户 |
| `sj / jd / sh / pz` | 当前这张单据的工作流角色 |
| `requesterId / checkerId / approverId` | 任务事实字段，仅用于诊断，不再被仿 PMS 直接反写成当前用户 |

当前 simulator 已统一成：

1. `ensureRoleAuth()`：以 `当前 PMS 用户 + 当前工作流角色` 申请 token
2. `requestEmbedUrlData()`：向 `/api/review/embed-url` 发送 `user_id=当前 PMS 用户`、`workflow_role=当前工作流角色`，并兼容旧 `role`
3. `requestWorkflowSync()`：`actor.id / actor.name = 当前 PMS 用户`，`actor.roles = 当前工作流角色`

也就是说，仿 PMS 现在不再假扮 `checkerId / approverId` 等任务参与人，而是更接近真实 PMS 的“用户 + workflowRole”合同。

---

## 3. 本次相关代码范围

### 3.1 代码文件

- `src/utils/apiBase.ts`
- `src/debug/pmsReviewSimulator.ts`
- `src/debug/pmsReviewSimulatorWorkflow.ts`
- `src/api/reviewApi.ts`
- `src/components/DockLayout.vue`
- `src/components/review/ReviewPanel.vue`
- `src/components/review/embedFormSnapshotRestore.ts`

### 3.2 测试文件

- `src/utils/apiBase.test.ts`
- `src/debug/pmsReviewSimulatorWorkflow.test.ts`
- `src/api/reviewApi.test.ts`
- `src/components/review/ReviewPanel.test.ts`
- `src/components/review/embedFormSnapshotRestore.spec.ts`

---

## 4. 定向验证结果

### 4.1 单元 / 类型检查

执行：

```bash
cd /Volumes/DPC/work/plant-code/plant3d-web
npm test -- src/utils/apiBase.test.ts src/debug/pmsReviewSimulatorWorkflow.test.ts
npm test -- src/api/reviewApi.test.ts
npm run type-check
```

结果：

- `src/utils/apiBase.test.ts`：通过
- `src/debug/pmsReviewSimulatorWorkflow.test.ts`：通过
- `src/api/reviewApi.test.ts`：通过
- `type-check`：通过

### 4.2 external/passive 回归

执行：

```bash
cd /Volumes/DPC/work/plant-code/plant3d-web
node ./.tmp_check_external_flow.mjs
```

关键结果：

- `passiveWorkflowMode = true`
- `lastAction = "active"`
- `lastOk = true`
- `lastMessage = "workflow/sync active 提交成功（外部流程驱动，未推进内部任务状态）"`
- `requestFails = []`

说明：

> `external/passive` 模式的 `SJ active` 已可走通，且附件 PATCH 的本机跨域噪音已消失。  
> 注意：页面 success message 仍沿用“未推进内部任务状态”的旧文案，但后续 CLI / query / embed 三处事实已证实 backend 会真实推进外部流程状态。

---

### 4.3 external/passive 主链与终态事实

#### A. `SJ active -> JH agree -> SH agree -> PZ agree -> approved`

已通过 **仿 PMS 真实界面点击** 跑通：

- `SJ` 点击 **送审提交**
- `JH` 双击打开并点击 **同意**
- `SH` 双击打开并点击 **同意**
- `PZ` 双击打开并点击 **同意**

关键终态事实：

- `task_status = approved`
- `form_status = approved`
- `embed-url lineage.status = approved`
- `current_node = pz`

页面行为：

- `PZ` 点击同意成功后，当前页会在刷新收敛后自动进入：
  - `accessDecisionSource = task-terminal`
  - `accessDecisionReason = 当前单据已处于已完成终态，仅可查看。`
  - `sidePanelMode = readonly`

#### B. `SJ active -> JH agree -> SH stop -> cancelled`

已通过 **仿 PMS 真实界面点击** 跑通：

- `SH` 在 `sh` 节点点击 **终止**

关键终态事实：

- `task_status = cancelled`
- `form_status = cancelled`
- `embed-url lineage.status = cancelled`
- `current_node = sh`

页面行为：

- 取消后的单据 reopen 时保持：
  - `accessDecisionSource = task-terminal`
  - `accessDecisionReason = 当前单据已处于已取消终态，仅可查看。`
  - `sidePanelMode = readonly`

#### C. `SJ active -> JH agree -> SH agree -> PZ return -> sj -> SJ reopen initiate`

已通过 **仿 PMS 真实界面点击** 跑通：

- `PZ` 点击 **驳回**
- 目标节点选择 `sj`
- `SJ` 再次双击打开同一条单据

关键回写事实：

- `task_status = draft`
- `current_node = sj`
- `checker/reviewer/approver` 已清空
- `returnReason` 已写入

页面行为：

- `PZ return` 成功后，页面即时显示：
  - `workflowNextStep = sj`
  - `currentWorkflowRole = sj`
- `SJ` reopen 后会重新进入：
  - `taskAssignedUserId = SJ`
  - `canMutateWorkflow = true`
  - `sidePanelMode = initiate`

---

## 5. 最强证据：同一条任务的一镜到底全 UI 串行闭环

### 5.1 验证对象

- `title`: `AUTO-UI-SINGLE-RUN-1775066430611`
- `taskId`: `task-dc5f1425-dda7-4717-a4d0-1e5c0ebf8be7`
- `formId`: `FORM-BDD1D2550C74`

创建时页面实际选中的责任人：

- `checker = proofreader_001`
- `approver = manager_001`

### 5.2 UI 串行结果

#### A. SJ 创建

页面内真实创建成功，随后后端同一条任务状态为：

- `status = submitted`
- `currentNode = jd`

#### B. JH 点击 agree

页面内 `/api/auth/verify` 返回当前 token claims：

- `user_id = proofreader_001`
- `role = jd`

同时：

- `actorMatched = true`
- `roleMatched = true`
- `lastAction = agree`
- `lastOk = true`
- `lastMessage = 接口调用成功`

后端回读同一条任务：

- `currentNode = sh`
- `status = in_review`

#### C. SH 点击 agree

页面内 `/api/auth/verify` 返回当前 token claims：

- `user_id = manager_001`
- `role = sh`

同时：

- `actorMatched = true`
- `roleMatched = true`
- `lastAction = agree`
- `lastOk = true`

后端回读同一条任务：

- `currentNode = pz`
- `status = in_review`

#### D. PZ 点击 agree

页面内 `/api/auth/verify` 返回当前 token claims：

- `user_id = manager_001`
- `role = pz`

同时：

- `actorMatched = true`
- `roleMatched = true`
- `lastAction = agree`
- `lastOk = true`

后端最终回读：

- `currentNode = pz`
- `status = approved`

### 5.3 本轮串行验收的环境噪音

本轮同一条任务的最终结果里：

- `requestFails = []`

说明这次一镜到底验证里，没有再遇到阻断性网络错误或本机跨域失败。

---

## 6. 当前可对外复用的结论口径

如果要向另一个会话或联调人员说明当前状态，建议直接使用下面这段：

> 当前仿 PMS 调试页已经拿到两条可复用结论：  
> 1. `manual/internal` 下，同一条任务可在同一轮页面会话里完成 `SJ 创建 -> JH agree -> SH agree -> PZ agree -> approved`；  
> 2. `external/passive` 下，`workflow/sync` 主链也已打通，已通过真实界面点击验证 `approved / cancelled / return->sj` 三类结果，并且终态 reopen 会自动进入 readonly。

### 6.1 基于 BRAN `24381_145018` 的数据证据链（2026-04-02）

本轮新增了一条更贴近真实交付的证据链，固定使用：

- `PMS_TARGET_BRAN_REFNO=24381_145018`

执行方式：

```bash
cd /Volumes/DPC/work/plant-code/plant3d-web
node ./.tmp_check_pms_simulator_full_evidence.mjs
```

关键运行态事实：

1. `SJ` 发起时，iframe 内真实写入构件：
   - `24381_145018`
2. `JH` 阶段真实执行：
   - 添加 1 条批注
   - 添加 1 条距离测量
   - 上传 1 个截图附件
   - `confirmData(...)`
   - 点击 `agree`
3. `SH agree -> PZ agree` 后，终态进入：
   - `task_status = approved`
   - `form_status = approved`
   - `lineage.status = approved`
4. `approved` reopen 时：
   - iframe 内可恢复批注与测量
   - iframe 内“附件材料”tab 已显示 1 条附件
   - 当前默认展示 attachment 的 `description` / 标签文案，而非原始上传文件名

典型证据目录示例：

```text
.tmp/pms-simulator-evidence-1775126273652
```

建议重点查看：

- `04-jh-annotation-measurement-confirmed.png`
- `13-pz-readonly-reopen.png`
- `14-pz-readonly-attachments-tab.png`

---

## 7. 当前建议的提交范围

由于当前工作区存在大量与本任务无关的改动，提交时建议只筛这次真正相关的文件：

```text
src/utils/apiBase.ts
src/utils/apiBase.test.ts
src/debug/pmsReviewSimulator.ts
src/debug/pmsReviewSimulatorWorkflow.ts
src/debug/pmsReviewSimulatorWorkflow.test.ts
src/api/reviewApi.ts
src/api/reviewApi.test.ts
src/components/DockLayout.vue
src/components/review/ReviewPanel.vue
src/components/review/ReviewPanel.test.ts
src/components/review/embedFormSnapshotRestore.ts
src/components/review/embedFormSnapshotRestore.spec.ts
docs/plans/2026-04-02-pms-review-simulator-full-ui-verification.md
docs/verification/pms-3d-review-integration-e2e.md
```

如果后续要继续补 UI handoff 或旧文档同步，再单独评估是否把以下文件也纳入：

```text
docs/plans/2026-04-01-pms-review-simulator-ui-handoff.md
开发文档/三维校审/三维校审PMS调试模拟器任务单.md
.tmp_check_pms_simulator_full_evidence.mjs
```

---

## 8. 后续建议

### 8.1 若继续收口提交

建议顺序：

1. 先只看本次相关文件 diff
2. 确认没有误带入其他调试改动
3. 做一次最小回归：
   - `npm test -- src/utils/apiBase.test.ts src/debug/pmsReviewSimulatorWorkflow.test.ts`
   - `npm test -- src/api/reviewApi.test.ts`
   - `npm run type-check`
4. 再做 commit

### 8.2 若继续做文档同步

建议把以下旧文档补一个“2026-04-02 当前状态”小节：

- `docs/plans/2026-04-01-pms-review-simulator-ui-handoff.md`
- `开发文档/三维校审/三维校审PMS调试模拟器任务单.md`

同步结论即可，不需要大改叙述结构。
