# 三维校审批注单次主操作 E2E 稳定化开发计划

日期：2026-04-27  
范围：`plant3d-web` PMS simulator、真实 PMS CDP extended flow、批注单次主操作验收证据归档。  
前置文档：

- [`2026-04-27-review-annotation-single-action-plan.md`](./2026-04-27-review-annotation-single-action-plan.md)
- [`2026-04-27-review-annotation-single-action-followup-plan.md`](./2026-04-27-review-annotation-single-action-followup-plan.md)
- [`2026-04-27-review-annotation-e2e-validation-plan.md`](./2026-04-27-review-annotation-e2e-validation-plan.md)
- [`../verification/review-annotation-single-action-phase-d-2026-04-27.md`](../verification/review-annotation-single-action-phase-d-2026-04-27.md)

## 1. 当前状态

已完成：

- 批注状态以后端 `AnnotationReviewStateView` 为真源。
- evidence-only diff 已落地，纯 `reviewState` 变化不再触发保存证据阻塞。
- `ReviewCommentsTimeline` 已收敛为单一处理表单。
- OBB 当前按辅助证据展示，不进入 `reviewAnnotationCheck` 门禁。
- 本地单元/组件回归与 `type-check` 已通过。

仍阻塞：

- `npm run test:pms:simulator` 启动后长时间无输出，疑似卡在前端、后端、SurrealDB 或 backend contract readiness 的健康检查阶段。
- 真实 PowerPMS CDP extended flow 需要外部密码、嵌入站点地址与可访问网络环境。

本计划目标不是继续扩大业务改造，而是把 E2E 环境变成可诊断、可复跑、可归档。

## 2. 目标与完成标准

### 2.1 目标

1. simulator 失败时能明确输出卡住阶段、health URL、最近错误和日志路径。
2. simulator 跑通时能产出 SJ/JH 退回、设计处理、复核确认的结构化报告。
3. 真实 PMS extended flow 在具备环境变量后可以按同一验收清单复跑并归档。
4. PR 合并前至少形成一条完整 E2E 证据；若环境仍阻塞，阻塞原因必须具体到可交接的服务或外部条件。

### 2.2 完成标准

- `PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator` 不再出现 8 分钟无任何有效阶段日志。
- simulator 报告或真实 PMS 报告至少覆盖：
  - 设计侧提交 `已修改` 或 `不需解决`。
  - 未新增证据时不被“保存新增证据”阻塞。
  - 校审侧提交 `同意` 或 `驳回`。
  - 任务流转仍走 `reviewAnnotationCheck` 后端门禁。
- 验收结果更新到 `docs/verification/review-annotation-single-action-phase-d-2026-04-27.md` 或新增真实 PMS 验收文档。
- 回归门禁保持通过：

```bash
npm test -- src/api/reviewApi.test.ts src/components/review/annotationWorkspaceModel.test.ts src/components/review/ReviewCommentsTimeline.test.ts src/components/review/reviewPanelActions.test.ts src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/ReviewPanel.test.ts src/components/review/AnnotationTableView.test.ts
npm run type-check
```

## 3. Phase A：让 simulator bootstrap 可诊断

### A1. 增加阶段日志

文件：`scripts/pms-simulator-bootstrap.ts`

建议新增轻量日志函数：

```ts
function traceBootstrap(message: string): void {
  if (process.env.PMS_SIMULATOR_TRACE !== '1') return;
  console.error(`[pms-simulator-bootstrap] ${message}`);
}
```

插入点：

- `main()` 开始后打印 `env.simulatorUrl`、`env.backendBaseUrl`、`artifactDir`、`outputPath`。
- `ensureSurreal()` 前后打印 SurrealDB 模式、bind 端口、是否复用已有端口。
- `ensureBackend()` 前后打印 health URL、build log、backend log。
- `waitForBackendContractReadiness()` 每次失败时记录最近一次 `/api/auth/token` 或 `/api/review/embed-url` 错误摘要。
- `ensureFrontend()` 前后打印 Vite URL 和 frontend log。
- `runContractSmoke()` 与 `runPmsSimulatorScenarios()` 前后打印阶段开始/结束。

验收：

- 即使失败，也能在终端看到最后停留在 `surreal`、`backend binary build`、`backend health`、`backend contract readiness`、`frontend health` 或 `scenario browser` 中的一个阶段。
- 失败信息包含对应日志路径。

### A2. 超时信息带最后错误

当前 `waitForBackendContractReadiness()` 已保留 `lastError`，但 bootstrap 的通用 `waitForHealth()` / TCP 等待若只输出固定文案，仍不利于定位。

建议：

- 对 HTTP health wait 记录最近一次状态码、响应文本前 300 字符或连接错误。
- 对 TCP wait 记录目标 host/port 和最后一次 socket 错误 code。
- 超时时统一输出 `lastError`、`logPath`、建议复跑命令。

验收：

- 用户无需打开源码即可知道下一步该看 `frontend.log`、`backend.log`、`backend-build.log` 还是 `surreal.log`。

## 4. Phase B：分段健康检查与最小复现命令

### B1. 前端单独确认

命令：

```bash
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

检查：

- `env.simulatorUrl` 对应页面可访问。
- 若端口被占用，明确记录占用端口与处理方式。

### B2. 后端单独确认

命令：

```bash
cd ../plant-model-gen
cargo run --bin web_server -- --config db_options/DbOption-mac
```

检查：

- `/api/health` 可访问。
- `/api/auth/token` 能返回 token。
- `/api/review/embed-url` 对 `project_id/user_id/workflow_role/workflow_mode` 能返回成功 code。

注意：

- 不运行 Rust test。
- 验证接口优先使用 HTTP JSON 请求。

### B3. SurrealDB 单独确认

检查：

- `DbOption-mac.toml` 中 `web_server.auto_start_surreal`、`surrealdb.mode`、`web_server.surreal_bind` 与本机实际状态一致。
- 若 simulator 需要自启动 SurrealDB，确认 `surreal` binary 可执行，数据目录可写。
- 若复用已有 SurrealDB，确认端口健康且账号密码匹配配置。

### B4. Contract smoke 单独确认

当 backend 可访问后，优先跑 in-process contract sequence，而不是直接进入浏览器场景。

目标：

- 如果 contract smoke 已失败，就不要继续排查 Playwright 页面。
- 将失败归类为认证、embed-url、任务创建、批注状态或门禁接口之一。

## 5. Phase C：恢复 simulator 场景断言

文件：`scripts/pms-simulator-runner.ts`

### C1. 场景入口可观测性

已有 `traceSimulator()`，下一步补齐以下关键节点：

- `openScenarioPage()` 进入页面后的 URL、标题、是否发现目标 iframe。
- 等待 `designer-comment-annotation-list` 时，每隔固定周期输出当前 pages/frames 数量。
- 创建 review 后记录 `packageName/formId/taskId`。
- 每次点击主操作前记录当前角色、批注状态、选中的处理结果。

### C2. 单次主操作断言

至少保留以下断言：

- 时间线存在单一处理表单，而不是旧的多按钮直接提交体验。
- 设计侧提交 `fixed` 后，状态变为待确认。
- 无新增证据时，流转前置检查不再提示“保存新增证据”。
- 校审侧提交 `agree` 后，状态进入可流转状态。
- 若选择 `reject`，备注为空时被 UI 拦截，填写备注后状态回到需设计处理。

### C3. 失败 artifact

失败时归档：

- screenshot。
- 当前 page URL。
- 控制台错误摘要。
- `formId/taskId/packageName`，若已创建。
- scenario report JSON。

输出位置沿用 `pms-simulator-artifacts`，并在最终报告中写入相对路径。

## 6. Phase D：真实 PMS CDP extended flow 复跑

前置：

```bash
export PMS_E2E_PASSWORD='***'
export PMS_EMBEDDED_SITE_SUBSTRING='***'
export PMS_E2E_USERNAME=SJ
export PMS_CHECKER_USERNAME=JH
export PMS_CDP_VERIFY_PMS_API=1
```

执行：

```bash
npm run test:pms:cdp:extended
```

如需人工观察：

```bash
chmod +x scripts/launch-chrome-cdp.sh
./scripts/launch-chrome-cdp.sh
CHROME_CDP_URL=http://127.0.0.1:9222 npm run test:pms:cdp:attach:extended
```

验收记录至少包含：

- packageName。
- formId。
- taskId。
- PMS 三维校审单列表可见证据。
- SJ 设计处理截图。
- JH 校审确认截图。
- 若失败，记录失败页面 URL、错误文本、Network/API 响应线索。

## 7. Phase E：文档归档与交付判断

更新：

- `docs/verification/review-annotation-single-action-phase-d-2026-04-27.md`

若真实 PMS 跑通，新增：

- `docs/verification/review-annotation-single-action-pms-extended-2026-04-27.md`

交付判断：

| 情况 | 判断 | 后续 |
| --- | --- | --- |
| simulator 跑通 | 可作为合并前 E2E 证据 | 真实 PMS 可作为上线前补充 |
| 真实 PMS 跑通 | 可作为业务侧最终验收证据 | simulator 稳定化可降级为技术债 |
| 两者都失败但日志清晰 | 暂不扩大业务代码改造 | 以环境修复任务交接 |
| 两者都失败且日志仍不清晰 | 不建议合并 | 先完成 Phase A/A2 |

## 8. 建议执行顺序

1. 先做 Phase A，解决“卡住但没有阶段日志”的问题。
2. 复跑 `PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator`。
3. 若失败，按 Phase B 分段定位，不重复盲跑完整 simulator。
4. 后端 contract smoke 通过后，再进入 Phase C 的浏览器场景断言。
5. 具备外部环境时执行 Phase D。
6. 最后按 Phase E 更新验收文档和 PR 说明。

## 9. 风险

- 后端 debug 构建耗时可能被误判为健康检查卡住，需要在日志中区分 build 与 runtime。
- 本机已有 backend/frontend 进程时，simulator 可能复用旧服务；如果旧服务配置不匹配，需要检测并提示。
- 真实 PMS 页面结构、iframe 嵌入方式或登录策略变化，会导致 CDP flow 失败但不代表业务代码失败。
- 外部密码、站点地址与截图可能包含敏感信息，归档时必须脱敏。
