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
2. `external/passive` 模式下，`workflow/sync active` 可走通。
3. 附件回写阶段此前出现的 `localhost:3100` vs `127.0.0.1:3101` 本机跨域问题已解除，本轮回归未再出现 `PATCH ... net::ERR_FAILED` / `CORS policy` / `updateTaskAttachments failed`。

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

### 2.2 修复二：仿 PMS 角色按钮改为“真实任务负责人身份”

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
- 把仿 PMS 角色与真实任务身份的映射统一收口到 `resolveSimulatorActorIdentity(...)`

映射规则如下：

| 仿 PMS 角色 | 真实 actor 解析规则 |
|------------|---------------------|
| `SJ` | 优先 `requesterId/requesterName`，缺失时回退 `SJ` |
| `JH` | 优先 `checkerId/checkerName`，缺失时回退 `reviewerId/reviewerName`，再回退 `JH` |
| `SH` | 优先 `approverId/approverName`，缺失时回退 `SH` |
| `PZ` | 优先 `approverId/approverName`，缺失时回退 `PZ` |

这个真实 actor 已接入：

1. `ensureRoleAuth()`：切角色后的 token 获取
2. `requestEmbedUrlData()`：打开 reviewer/designer iframe 时给 `/api/review/embed-url` 的 `user_id`
3. `requestWorkflowSync()`：`workflow/sync` 请求里的 `actor.id / actor.name`

因此现在点击：

- `JH`
- `SH`
- `PZ`

不再只是“切一个 UI 标记”，而是会拿到与当前任务负责人一致的真实身份 token。

---

## 3. 本次相关代码范围

### 3.1 代码文件

- `src/utils/apiBase.ts`
- `src/debug/pmsReviewSimulator.ts`
- `src/debug/pmsReviewSimulatorWorkflow.ts`

### 3.2 测试文件

- `src/utils/apiBase.test.ts`
- `src/debug/pmsReviewSimulatorWorkflow.test.ts`

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
- `lastMessage = "workflow/sync active 提交成功（未推进内部任务状态）"`
- `requestFails = []`

说明：

> `external/passive` 模式仍可走通，且附件 PATCH 的本机跨域噪音已消失。

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

> 当前仿 PMS 调试页已经拿到 single-run full UI 验收：同一条任务可在同一轮页面会话里完成 `SJ 创建 -> JH approve -> SH approve -> PZ approve`，最终后端状态到 `approved`。同时 external/passive 模式的 `workflow/sync active` 也可正常走通，附件 PATCH 的本机 CORS 噪音已解除。

---

## 7. 当前建议的提交范围

由于当前工作区存在大量与本任务无关的改动，提交时建议只筛这次真正相关的文件：

```text
src/utils/apiBase.ts
src/utils/apiBase.test.ts
src/debug/pmsReviewSimulator.ts
src/debug/pmsReviewSimulatorWorkflow.ts
src/debug/pmsReviewSimulatorWorkflow.test.ts
docs/plans/2026-04-02-pms-review-simulator-full-ui-verification.md
```

如果后续要继续补 UI handoff 或旧文档同步，再单独评估是否把以下文件也纳入：

```text
docs/plans/2026-04-01-pms-review-simulator-ui-handoff.md
开发文档/三维校审/三维校审PMS调试模拟器任务单.md
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
