# 2026-04-25 仿 PMS 驳回链路修复 · Wave 2（runtime 验证 + root cause 收敛）

> 接续 `2026-04-25-pms-reject-flow-fix.md`。Wave 1 已合入 commit `45bf5ec`，覆盖了所有可静态落地的改动；Wave 2 全部依赖真实 runtime 证据。

## 触发条件

- vite (`http://127.0.0.1:3101`) + plant-model-gen 后端 (`http://127.0.0.1:3100`) 均能在本机起来；或者使用现成的 `bun run test:pms:simulator` 触发自动化 bootstrap。
- 或者人工配合 browser-use 跑一遍完整三场景。

## 一键命令

```bash
cd plant3d-web
# 推荐用法：bootstrap 会自动起 vite/plant-model-gen/surreal，跑完后保留 artifacts
bun run test:pms:simulator -- --cases=return,stop,approved
# 之后 cat artifacts/pms-simulator-*.json 取最新一份
```

## 必须采集的字段

新生成的 `artifacts/pms-simulator-*.json` 在 scenarioReturn 中至少包含：

| key | 来源 | 用途 |
|---|---|---|
| `return-verify` | simulator 内存 | workflow/verify 是否通过 |
| `return-sync` | simulator 内存 | workflow/sync(action=return) 是否通过 |
| `return-backend-current-node` | 直接 GET /api/review/tasks | 后端实际 current_node / status，正交于 simulator |

后端日志（plant-model-gen）保留以下行的输出供分析：

- `[WORKFLOW_SYNC] form_id=…, action=return, actor=…/…`
- `apply_workflow_return` 起止与返回值
- 任何 4xx/5xx 异常

## 三选一根因决策树

| return-verify | return-sync | return-backend-current-node | 结论 | 修复方向 |
|---|---|---|---|---|
| fail (action≠return 或 ok≠true) | 任意 | 任意 | 访问检查在 verify 之前已挡住 | 检查 PZ 角色下 sidePanelMode / canMutateWorkflow，在 `pmsReviewSimulatorWorkflow.ts` 修 fallback；新增 `simulator workflow access PZ-pz` 用例 |
| pass | fail | 任意 | workflow/sync 写库失败或 verify→sync 之间状态被改 | 看后端日志 `apply_workflow_return` 是否真正被调用、SQL 是否成功；如未调用，前端 sync 请求形态需复核 |
| pass | pass | not-`sj` | sync 自报成功但库实际没动到 sj | plant-model-gen 的 `apply_workflow_return` 写库逻辑 / next_step 解析有问题，或 race；按字段排查 SQL bind |
| pass | pass | sj，但 reopen-as-SJ 仍看到 jd | simulator 重开后 diagnostics race 仍在 | 在 `openIframe` / `restorePersistedIframeIfNeeded` 同样补一次 await refreshDiagnosticsSnapshot |

## Wave 2 任务（按依赖顺序）

- [ ] **W2.1 采证**：跑一轮 `bun run test:pms:simulator -- --cases=return`，把生成的 JSON 与 `dev.log` / `frontend.log` 一并归档到 `artifacts/wave2-evidence/`。
  - 2026-04-25 现场增量：3100/3101 均可访问，但 `scenarioReturn` 卡在 `createReview case=return openNew`，尚未进入 PZ return 业务段。
  - 证据文件：`artifacts/wave2-evidence/pms-simulator-return-20260425-202643.json` / `.log`。该次由 watchdog 在 240s 后终止，JSON 记录 `Target page, context or browser has been closed`，log 最后一行是 `createReview case=return openNew`。
  - 最小探针：Playwright 直接调用 `__pmsReviewSimulatorTest.openNew()` 时，`POST /api/review/embed-url` 30s 未响应。
  - 后端探针：`POST /api/review/embed-url`、`GET /api/review/tasks?limit=5`、`POST /api/review/workflow/sync(action=query)` 均超时；`/api/auth/token`、`/api/projects`、`/api/health` 正常。
  - SurrealDB 探针：`surreal sql --endpoint ws://127.0.0.1:8020 --namespace 1516 --database AvevaMarineSample 'INFO FOR DB;'` < 1s 返回，说明 8020 本身可用。
  - 临时结论：当前阻塞点不是 return 决策树的 1/2/3/4，而是运行了约 11 小时的 3100 后端内 `review_primary_db` / review DB 访问路径疑似 stale/hung。下一步应重启后端或修复 review DB 连接超时/重连后，再重新采 `return-verify` / `return-sync` / `return-backend-current-node`。
  - 重启 3100 后端后复跑成功进入业务段：`artifacts/wave2-evidence/pms-simulator-return-20260425-203950.json` / `.log`。
  - 新三元组：`return-verify` 失败，detail 为 `expected_action=return ｜ actual_action=active ｜ ok=true`；`return-sync` 失败，detail 为 `actual_action=return ｜ ok=false ｜ 当前单据缺少 workflow next_step 指定的处理角色或处理人，仅可查看。`；`return-backend-current-node` 为 `current_node=jd status=submitted`。
  - 关键时间线：log 显示 PZ 执行 return 前 `runWorkflowAction action=return ... node=jd`，说明问题发生在 PZ return 之前：JH/SH agree 链路没有把后端任务推进到 `pz`，PZ return 因访问判定为只读而未真正写库。
  - 修复采证 runner 后复跑：`artifacts/wave2-evidence/pms-simulator-return-waitfix-20260425-204321.json` / `.log`，`ok=true`，最终 `finalNode=sj`、`finalStatus=draft`。
  - 新增断言结果：SJ active 后端节点 `jd/submitted`、JH agree 后端节点 `sh/in_review`、SH agree 后端节点 `pz/in_review`、PZ return 后端节点 `sj/draft`，全部通过。
- [ ] **W2.2 根因决策**：按决策树读 JSON + 日志，归类落到 1/2/3/4 哪条。
  - 当前归类：先落入“访问检查在 verify 之前已挡住”，但更准确的子问题是中间 `active/agree/agree` 没有逐步断言，导致 JH/SH 推进失败被吞掉，最终才在 PZ return 暴露为 `jd/submitted`。
  - 下一步：给 `scenarioReturn` 增加与 `scenarioApproved` 相同的 `sj-active` / `jh-agree` / `sh-agree` verify+sync 断言，并在每个阶段直接 probe 后端 current_node，先证明是哪一步没有推进。
  - 已完成：`scenarioReturn` 现在等待角色打开后的 diagnostics 上下文，再执行 workflow action；并加入上述中间阶段 verify/sync + 后端节点断言。根因是自动化 runner 过早点击 workflow action，不是 `apply_workflow_return` 业务写库错误。
- [ ] **W2.3 修复落地**：根据 W2.2 的归类，最多动 1–2 处代码（前端 / plant-model-gen / 两端各一）。修完跑同一命令验证三个断言全 pass。
- [ ] **W2.4 回归**：再跑 `--cases=return,stop,approved` 三场景全绿，加上契约 smoke。
  - 2026-04-25 回归：`artifacts/wave2-evidence/pms-simulator-main-three-20260425-204429.json` 中 `approved` 与 `return` 均通过。
  - 同次 `stop` 失败在 `createReview case=stop openNew` 之后，报“未找到发起编校审面板”；单独跑 `stop` 也卡在 `openNew`。这发生在 workflow action 前，暂归为既有 iframe 自动化可达性/创建面板启动问题，不是本次 diagnostics 等待修复引入的 return/agree 回归。
- [ ] **W2.5 gate-return 裁定**（owner 决策后开工）：
  - 若选"改测试身份"：在 `pms-simulator-runner.ts` 的 `scenarioGateReturn` 把保存批注的角色切到 JH。
  - 若选"放权后端"：plant-model-gen 的 `/api/review/records` 把 owner 检查放宽到"checker 节点同节点上下游 + 显式协办"，并补单测。
- [ ] **W2.6 文档收尾**：CHANGELOG 追加 Wave 2 章节；`docs/verification/pms-3d-review-integration-e2e.md` 同步描述 plant3d.form_saved postMessage 协议。

## 不在 Wave 2 范围

- iframe 自动化可达性（ISSUE-003）：仍是工程性建议项，单独立项。
- 任何与驳回链路无关的优化。

## 失败兜底

如果 W2.3 试了一处仍未通过，**MUST** 在 commit 中保留改动并写进 PR 描述里，随后停下来与 owner 同步证据，不允许继续盲改第二处。
