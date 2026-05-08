# 仿 PMS 全量回归后端健康稳定化开发计划

> 日期：2026-04-28
> 状态：开发中
> 上游计划：`docs/plans/2026-04-28-pms-simulator-stabilization-dev-plan.md`
> 目标脚本：`scripts/pms-simulator-runner.ts`、`scripts/pms-simulator-bootstrap.ts`

## 1. 背景

当前单场景与小组合已经收敛：

- `restore` 单场景通过，confirmed record 读回与刷新恢复断言均通过。
- headed `return` 单场景通过，最终 `node=sj`、`status=draft`。
- `gate-block,gate-return` 组合通过。
- `npm run type-check` 通过。

剩余问题集中在全量连续运行：

- 全量 `PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator` 运行到 approved / return / restore 后，backend 会出现 `/api/review/tasks` 或 `/api/review/delete` 超时。
- backend 进入超时状态后，后续 gate 场景的 `openNew` 无法拿到 `iframeUrl`，最终报 `等待 createReview ... 新建 iframe URL 超时`。
- 这不是 gate / restore / return 的单场景业务断言失败，而是连续场景运行下的 backend health / cleanup / 并发请求阻塞问题。

## 2. 目标

把全量 simulator 从“单场景通过、连续运行会拖垮 backend”推进到“六个场景连续运行可重复通过”：

- runner 在每个场景前后都能识别 backend 是否健康。
- 如果 backend 不健康，能在不污染报告的前提下自动重启并继续后续场景。
- cleanup 不再影响后续场景执行；清理失败要进入独立 artifact，而不是导致后续业务场景误失败。
- 全量报告 `artifacts/pms-simulator-full-2026-04-28-*.json` 中六个场景均 `ok=true`。

## 3. 当前证据

已通过：

```bash
npm run type-check
PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-restore-2026-04-28-clean.json npm run test:pms:simulator
PMS_SIMULATOR_CASE=return PMS_SIMULATOR_HEADLESS=0 PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-return-headed-2026-04-28-followup3.json npm run test:pms:simulator
PMS_SIMULATOR_CASE=gate-block,gate-return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-gates-2026-04-28-followup.json npm run test:pms:simulator
```

全量失败证据：

- `artifacts/pms-simulator-full-2026-04-28-followup.json`：前四个场景通过，`restore` cleanup `/api/review/delete` 超时，后续 gate 场景 `openNew` 超时。
- `artifacts/pms-simulator-full-2026-04-28-followup2.json` / terminal：`return` 中途 `GET /api/review/tasks?limit=5000&offset=0` 超时。
- `artifacts/pms-simulator-full-2026-04-28-followup3.json` / terminal：approved 后 backend `/api/review/tasks` 不响应，后续场景只到 `openNew`。

## 4. 开发原则

- 优先修 runner health 管理与诊断，不先改业务语义。
- cleanup 必须 best-effort，不允许让后续场景误判为业务失败。
- 先用最小探针复现 backend hang，再决定是否需要改 backend。
- 继续以 CLI + 仿 PMS 真实脚本验证，不新增一次性单测。

## 5. 阶段一：场景间 backend health gate

### 改动点

- 在 `scripts/pms-simulator-bootstrap.ts` 或 `scripts/pms-simulator-runner.ts` 增加 health helper：
  - `probeBackendHealth(env)`：检查 `/api/health`、`POST /api/auth/token`、`GET /api/review/tasks?limit=1&offset=0`。
  - 每个请求使用 5-8s 超时，输出具体失败 endpoint 和耗时。
- 在每个 scenario 前执行 health gate：
  - 健康则继续。
  - 不健康则尝试重启 backend，再重试一次 health gate。
  - 重启失败时让该场景失败为 `backend-health-failed`，不要继续用业务超时掩盖。
- 在每个 scenario 后执行轻量 health probe：
  - 只记录，不立即失败。
  - 如果已经不健康，在下一个 scenario 前统一恢复。

### 验收

```bash
PMS_SIMULATOR_CASE=approved,return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-health-approved-return.json npm run test:pms:simulator
```

期望：

- 如果 backend 健康，两个场景都通过。
- 如果 backend 变慢，trace 明确显示哪个 endpoint 超时，并在下一场景前恢复或失败为 backend health。

## 6. 阶段二：cleanup 去耦与 artifact 化

### 改动点

- 保留当前“全量结束后统一 cleanup”的方向，但增加：
  - cleanup 独立 timeout 与 retry。
  - cleanup report artifact，例如 `artifacts/pms-simulator-artifacts/cleanup-report.json`。
  - cleanup 失败不改变 scenario `ok`，但在顶层 report 增加 cleanup warning（如当前类型不方便扩展，则先写 artifact + console warning）。
- cleanup 前先关闭 browser context，避免页面仍在轮询 workflow / records / tasks。
- cleanup 对 formIds 分批执行，避免一次 delete 阻塞所有清理。

### 验收

```bash
PMS_SIMULATOR_CASE=restore,gate-block PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-cleanup-restore-gate.json npm run test:pms:simulator
```

期望：

- 即使 restore 清理慢，也不影响 gate-block 创建 iframe。
- cleanup 失败时能看到独立 warning / artifact。

## 7. 阶段三：定位 backend 阻塞根因

### 改动点

- 在 runner health probe 发现 `/api/review/tasks` 或 `/api/review/delete` 超时后，立即采集：
  - 当前 scenario、formId、taskId、已执行 action。
  - backend PID、运行时长、监听端口。
  - `curl` 探测 `/api/health`、`/api/review/tasks?limit=1&offset=0`、`/api/auth/token` 的结果。
- 若 artifact 能稳定证明 backend hang，再转到 `plant-model-gen` 后端排查：
  - `GET /api/review/tasks` 是否被大查询 / 锁 / SurrealDB 请求阻塞。
  - `POST /api/review/delete` 是否与正在打开的 review page / workflow query 争用同一数据锁。
  - web_server 是否缺少请求级 timeout 或连接池隔离。

### 验收

```bash
PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-full-health-diagnostics.json npm run test:pms:simulator
```

期望：

- 如果全量失败，报告能明确区分 `backend-health`、`cleanup`、`business-assertion`。
- 不再只看到后续 gate 的 `openNew iframe URL 超时`。

## 8. 阶段四：全量回归

全量命令：

```bash
PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-full-2026-04-28-final.json npm run test:pms:simulator
```

全量期望：

- `approved`、`return`、`stop`、`restore`、`gate-block`、`gate-return` 全部通过。
- 顶层 `ok=true`。
- 如 cleanup 有 warning，必须不影响场景结果，并有独立 artifact 可追踪。

## 9. 风险与回滚

- 风险：自动重启 backend 掩盖真实 backend bug。
  - 缓解：每次重启都写入 artifact，并保留失败 endpoint / scenario / formId。
- 风险：cleanup 延后导致本地测试数据短时间堆积。
  - 缓解：记录 cleanup formIds，失败时输出可手工重放的 delete payload。
- 回滚：如果 health gate 引入不稳定，可只保留诊断 artifact，不启用自动重启。

## 10. 当前执行记录（2026-04-28）

已完成：

- `scripts/pms-simulator-runner.ts` 增加 `ensureBackendHealthy(caseId)` 场景前回调。
- `scripts/pms-simulator-bootstrap.ts` 增加 backend health probe：
  - `/api/health`
  - `POST /api/auth/token`
  - `GET /api/review/tasks?limit=1&offset=0`
- health probe 失败时自动停止并重启 backend，再复测一次。
- health 结果写入 `artifacts/pms-simulator-artifacts/backend-health.jsonl`。
- `InitiateReviewPanel.vue` 的 E2E mock component hook 改为直接注入本地 selected component，避免 `pdmsGetUiAttr()` 慢请求导致 submit 按钮一直 disabled。
- `runPlant3dInitiateOnRoot()` 提交后不再强依赖成功 toast；toast 未捕获时交由 simulator form_id 回填等待判定创建结果。
- `approved` 场景不再依赖 `reopenLast` 做最终 readonly 检查，改为使用 PZ agree 后的 workflow snapshot 断言 `approved` / `pz`。

已验证：

```bash
npm run type-check
PMS_SIMULATOR_CASE=approved,return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-health-approved-return-2026-04-28-rerun2.json npm run test:pms:simulator
```

结果：

- 类型检查通过。
- health gate 能在场景前探测 backend 状态，并在 `return` 前检测到 `/api/review/tasks?limit=1&offset=0` 超时后自动重启 backend。
- `return` 场景在重启后能完成到 `node=sj`、`status=draft`。

剩余问题：

- `approved,return` 组合仍未整体通过：`return` 创建后出现 `task_id=--`，随后 `probeBackendTaskByFormId()` 的大列表查询 `/api/review/tasks?limit=5000&offset=0` 超时。
- 这说明场景前 health 已恢复，但 `return` createReview / task 创建链路仍可能把 backend 带入超时状态；下一步应聚焦 `reviewTaskCreate` / `/api/review/tasks` 后端阻塞与 task_id 回填缺失。
- cleanup 仍会在全量结束后可能超时，应继续推进 cleanup artifact 化与分批 best-effort。
