# 仿 PMS task_id 回填与任务列表超时诊断开发计划

> 日期：2026-04-28
> 状态：开发中
> 上游计划：`docs/plans/2026-04-28-pms-simulator-full-regression-health-plan.md`
> 目标脚本：`scripts/pms-simulator-runner.ts`、`scripts/pms-simulator-bootstrap.ts`
> 相关前端：`src/components/review/InitiateReviewPanel.vue`、`src/api/reviewApi.ts`
> 可能涉及后端：`plant-model-gen` 的 review task create/list/delete 接口

## 1. 背景

当前 simulator 稳定化已经完成到以下程度：

- `restore` 单场景通过。
- headed `return` 单场景通过，最终 `node=sj`、`status=draft`。
- `gate-block,gate-return` 组合通过。
- runner 场景前 backend health gate 已能发现 `/api/review/tasks?limit=1&offset=0` 超时并自动重启 backend。
- E2E mock component 已改为直接本地注入，submit 按钮不再因为 `pdmsGetUiAttr()` 慢请求一直 disabled。
- 发起成功 toast 已改为非强依赖，由 simulator `form_id` 回填继续判定。

剩余问题已经收敛到：

- `approved,return` 组合中，`return` 的 `createReview()` 有时拿到 `form_id`，但 `task_id=--`。
- 随后 `probeBackendTaskByFormId()` 访问 `/api/review/tasks?limit=5000&offset=0` 超时。
- 这说明场景前 health 正常，但 create task / task list 在场景内部仍会把 backend 带入阻塞或不可查询状态。

## 2. 目标

把问题从“创建后 task_id 缺失 + 大列表超时”定位到明确边界：

- 前端 `reviewTaskCreate()` 是否返回了 task id。
- simulator snapshot 是否正确保存了 task id。
- 后端 `/api/review/tasks` 是否能按 `form_id` 小范围查询，避免每次扫 `limit=5000`。
- 如果 task 创建后 backend 立即超时，能输出 create response、formId、packageName、backend health、tasks probe artifact。

最终目标：

- `createReview()` 必须稳定得到 `taskId`。
- `probeBackendTaskByFormId()` 不再依赖大列表全量扫描。
- `approved,return` 组合通过。
- 全量回归失败时能明确标为 backend create/list 阻塞，而不是泛化为 openNew / iframe / workflow 超时。

## 3. 当前证据

已通过命令：

```bash
npm run type-check
PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-restore-2026-04-28-clean.json npm run test:pms:simulator
PMS_SIMULATOR_CASE=return PMS_SIMULATOR_HEADLESS=0 PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-return-headed-2026-04-28-followup3.json npm run test:pms:simulator
PMS_SIMULATOR_CASE=gate-block,gate-return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-gates-2026-04-28-followup.json npm run test:pms:simulator
```

最新失败证据：

```bash
PMS_SIMULATOR_CASE=approved,return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-health-approved-return-2026-04-28-rerun3.json npm run test:pms:simulator
```

关键现象：

- `backend health before approved: health ok`
- `approved` 业务链路完成到 PZ agree。
- `backend health before return: health ok`
- `return` createReview 成功拿到 `form_id=FORM-...`，但 `task_id=--`
- 随后 `GET /api/review/tasks?limit=5000&offset=0` 超时。

## 4. 阶段一：补 createReview / create task 细粒度诊断

### 改动点

- 在 `src/components/review/InitiateReviewPanel.vue` 的 `handleSubmit()` 中，automation 模式下把 create task 结果暴露到 `window.__plant3dInitiateReviewE2E`：
  - `lastCreateTaskResponse`
  - `lastCreatedTaskId`
  - `lastCreatedFormId`
  - `lastCreateTaskError`
- 扩展 `__plant3dInitiateReviewE2E` 类型，增加 `getLastCreateResult()`。
- 在 `runPlant3dInitiateOnRoot()` 提交后读取该 hook，写 trace：
  - packageName
  - returned taskId
  - returned formId
  - error message
- 在 `createReview()` 等待 `lastOpenedFormId` 后，如果 `taskId` 缺失，读取 direct Plant3D page hook 结果作为补充证据。

### 验收

```bash
PMS_SIMULATOR_CASE=return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-return-create-diagnostics.json npm run test:pms:simulator
```

期望：

- 成功时 trace 明确显示 create task returned taskId。
- 失败时 report / trace 能显示是后端未返回 taskId、前端未保存 taskId，还是 simulator snapshot 未同步 taskId。

## 5. 阶段二：替换大列表 task probe

### 改动点

- 优先寻找后端是否已有按 formId / taskId 查询接口：
  - `GET /api/review/tasks/{taskId}`
  - `GET /api/review/workflow/sync?action=query` 已能按 formId 返回当前节点时，可作为 probe 来源。
  - 若无 formId 专用接口，runner 先调用 workflow query，而不是 `/api/review/tasks?limit=5000&offset=0`。
- 修改 `probeBackendTaskByFormId()`：
  - 优先使用 workflow query / 小范围接口。
  - 只有明确需要时才 fallback 到 task list。
  - fallback list 使用更小 limit，并写入 warning。
- `resolveTaskIdByFormId()` 同步使用新 probe，避免 createReview 后反复扫大列表。

### 验收

```bash
PMS_SIMULATOR_CASE=approved,return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-approved-return-no-big-list.json npm run test:pms:simulator
```

期望：

- trace 中不再出现 `GET /api/review/tasks?limit=5000&offset=0`。
- `approved,return` 组合通过，或失败点变为明确的 create task response 缺失。

## 6. 阶段三：后端 create/list 阻塞定位

仅当阶段一/二仍显示后端接口阻塞时进入。

### 改动点

- 在 `plant-model-gen` 后端定位：
  - `POST /api/review/tasks` 创建任务后是否同步触发重查询/锁。
  - `GET /api/review/tasks` 是否扫描全量、是否受 delete / workflow sync / records 查询锁影响。
  - `POST /api/review/delete` 是否阻塞 SurrealDB 或共享状态。
- 增加请求级 timeout / tracing：
  - create task 入参 formId/packageName。
  - create task 返回 taskId。
  - task list 查询耗时、返回条数。
  - delete 耗时与 formIds 数量。

### 验收

按项目规则使用真实 web_server + HTTP POST/GET 验证，不新增一次性单测：

```bash
PMS_SIMULATOR_CASE=approved,return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-approved-return-backend-fixed.json npm run test:pms:simulator
```

## 7. 阶段四：全量回归

```bash
PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-full-2026-04-28-final.json npm run test:pms:simulator
```

期望：

- `approved`、`return`、`stop`、`restore`、`gate-block`、`gate-return` 全部通过。
- 顶层 `ok=true`。
- `backend-health.jsonl` 中如有 restart，必须记录具体场景与 endpoint。
- 不再出现 `task_id=--` 进入后续 workflow 的情况。

## 8. 风险与回滚

- 风险：用 workflow query 替代 task list 会遗漏 task status 字段。
  - 缓解：只用于 runner probe；业务 UI 不改读取口径。
- 风险：前端 hook 暴露 create response 造成生产污染。
  - 缓解：仅在 `automation_review=1` 或 localStorage automation flag 开启时暴露。
- 回滚：如果 create hook 诊断过重，可保留 trace helper，先不改变业务提交逻辑。

## 9. 当前执行记录（2026-04-28）

已完成：

- `InitiateReviewPanel.vue` 的 `__plant3dInitiateReviewE2E` 增加 `getLastCreateResult()`，记录 create task 的 `taskId` / `formId` / `title` / `error`。
- `runPlant3dInitiateOnRoot()` 返回 `{ packageName, createResult }`，并在 trace 中打印 hook task/form/error。
- `createReview()` 使用 hook result 补齐 `taskId` / `formId`，避免只依赖 simulator snapshot。
- `probeBackendTaskByFormId()` 支持传入 `taskId` 时优先走 `GET /api/review/tasks/{taskId}`，fallback list 从 `limit=5000` 降为 `limit=100`。

已验证：

```bash
npm run type-check
PMS_SIMULATOR_CASE=return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-return-create-hook-2026-04-28-rerun.json npm run test:pms:simulator
PMS_SIMULATOR_CASE=approved,return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-approved-return-task-probe-2026-04-28.json npm run test:pms:simulator
```

结果：

- 类型检查通过。
- `return` 单场景通过；hook 明确返回 `task_id=task-...`、`form_id=FORM-...`。
- `approved,return` 组合仍失败，但失败原因进一步明确：`return` 的 create hook 返回 `error=POST /api/review/tasks 超时`，随后 fallback `GET /api/review/tasks?limit=100&offset=0` 也超时。

结论：

- `task_id=--` 不是前端 snapshot 丢失；成功路径中 hook 能拿到 taskId。
- 剩余根因已定位到后端 `POST /api/review/tasks` 在连续场景后超时，以及任务列表接口随后的不可用。
- 下一步应进入阶段三，在 `plant-model-gen` 后端定位 `reviewTaskCreate` / task list 的阻塞原因。
