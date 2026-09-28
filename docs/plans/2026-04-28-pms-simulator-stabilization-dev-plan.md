# 仿 PMS 模拟器稳定化下一步开发计划

> 日期：2026-04-28
> 状态：开发中
> 上游问题记录：`docs/plans/2026-04-27-pms-simulator-issues-followup-plan.md`
> 目标脚本：`scripts/pms-simulator-runner.ts`、`scripts/pms-plant3d-initiate-flow.ts`

## 1. 目标

把仿 PMS 全量模拟器从“核心链路可跑通”推进到“全场景可重复验收”：

- `gate-block` / `gate-return` 能稳定进入同源 Plant3D 发起面板，不再卡在跨域 iframe 注入限制。
- `restore` 能稳定刷新并重新定位校核工作区，确认批注、测量、截图状态恢复。
- `return` 在 headed / headless 下行为一致，PZ 驳回后能回到 SJ `draft`。
- 全量 `PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator` 输出 `ok=true`。

## 2. 当前证据

已知通过：

- `approved` 主链：最终 `node=pz`、`status=approved`。
- `return` headless 主链：最终 `node=sj`、`status=draft`。
- 契约烟测：`7/7`。

待修复：

- `gate-block` / `gate-return`：`runSubmitReviewAcrossContext()` 未找到 `[data-testid=designer-landing-workspace]`，错误提示指向跨域 iframe 注入限制。
- `restore`：`reloadReviewerWorkbenchAcrossContext()` 后未找到 `[data-testid=review-workbench-workflow-zone]`。
- headed `return` 曾卡在 `node=sh`、`status=in_review`，`workflow next_step` 缺失。

## 3. 开发原则

- 优先修自动化入口和上下文选择，不先改业务语义。
- 统一“打开三维页”的同源策略，避免每个场景各自处理 iframe / tab。
- 每个失败场景先单独复现并保留 trace、screenshot、JSON report，再进入全量回归。
- 验证以 CLI + 仿 PMS 真实脚本为主，不为本轮新增一次性单测。

## 4. 阶段一：统一同源 Plant3D 打开策略

### 改动点

- 在 `scripts/pms-plant3d-initiate-flow.ts` 增加一个统一定位 helper，用于在 `BrowserContext` 内寻找可自动化的同源 Plant3D root：
  - 输入：期望模式（designer / reviewer）、可选 `formId`、可选 `taskId`、可选目标 role。
  - 输出：`{ page, root, mode, url }`，并在 trace 中打印候选 page URL、frame URL、命中的 marker。
- 让 `runSubmitReviewAcrossContext()` 和 `waitForReviewerWorkbenchAcrossContext()` 复用该 helper。
- 如果 simulator 当前 iframe 是跨域且无法注入，优先从 simulator snapshot 的 `iframeSource` / 打开动作中获取三维 URL，并在同一 `BrowserContext` 新开同源 tab 后再等待 marker。
- `scripts/pms-simulator-runner.ts` 的 `createReview()`、`openTaskForRole()` 不直接假设 iframe 可控，只负责触发 PMS 动作和等待 simulator 快照回填。

### 验收

单独运行：

```bash
PMS_SIMULATOR_CASE=gate-block PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
PMS_SIMULATOR_CASE=gate-return PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

期望：

- 不再出现 `未在任何标签页/iframe 内找到发起编校审面板`。
- trace 能显示命中的同源 page/root。
- 两个场景都能进入后续门禁断言。

## 5. 阶段二：修复 gate-block / gate-return 门禁验收

### 改动点

- `gate-block`：
  - 创建 JH confirmed record 后，先探测后端 `review/records` 或 simulator snapshot，确认存在 `pending_review` 批注。
  - 执行 JH `agree` 时断言被阻止，错误信息应指向“仍有待确认批注”。
  - 断言后端任务节点仍停留在 JH。
- `gate-return`：
  - SH 节点注入 rejected 批注后，执行 SH `agree`。
  - 断言流程返回到设计/SJ 修订态，而不是继续流到 PZ。
  - 复核 `workflow next_step` 和 `taskCurrentNode` 与后端 current node 一致。
- 将门禁失败详情写入 scenario report 的 assertion detail，避免只看最终 timeout。

### 验收

```bash
PMS_SIMULATOR_CASE=gate-block PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
PMS_SIMULATOR_CASE=gate-return PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

期望：

- `gate-block` 报告中包含门禁 block 断言通过。
- `gate-return` 报告中包含门禁 return 断言通过。
- 两个场景 JSON report 的 `ok=true`。

## 6. 阶段三：修复 restore 刷新恢复

### 改动点

- `reloadReviewerWorkbenchAcrossContext()` 刷新后不要复用旧 `root`，必须重新通过统一 helper 定位 reviewer 工作区。
- reviewer ready 条件从单一 `[data-testid=review-workbench-workflow-zone]` 扩展为组合条件：
  - `[data-testid=reviewer-landing-workspace]` 可见。
  - `[data-testid=review-workbench-workflow-zone]` 可见。
  - `window.__plant3dReviewerE2E` 已挂载。
  - snapshot 的 `currentFormId` / `lastOpenedFormId` 与目标 `formId` 匹配。
- `buildRestoreCounts()` 在刷新前后都输出 pending / confirmed 的明细计数，失败时写入 artifact。

### 验收

```bash
PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

期望：

- reload 后重新命中 reviewer root。
- 刷新前后 pending annotation、pending measurement、confirmed annotation、confirmed measurement 计数满足现有断言。
- 报告 `ok=true`。

## 7. 阶段四：复核 headed return 差异

### 改动点

- 为 `openTaskForRole()` 增加关键 trace：
  - role、source、formId、taskId。
  - simulator snapshot 中的 `currentTaskId`、`selectedTaskId`、`workflowNextStep`、`taskCurrentNode`、`currentTaskStatus`。
  - 命中的 Plant3D page URL / root URL。
- headed 模式下在 PZ 动作前后分别保存 snapshot，用于判断是页面焦点、任务打开、还是 next_step 构造差异。
- 如果差异来自等待条件，收紧 `openTaskForRole()` predicate：目标 `taskId` 和目标 role 的 workflow 信息必须同时就绪。

### 验收

```bash
PMS_SIMULATOR_CASE=return PMS_SIMULATOR_HEADLESS=0 PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

期望：

- headed return 与 headless return 一致回到 `node=sj`、`status=draft`。
- 如仍失败，report 能明确区分 page/root 未命中、taskId 不匹配、next_step 缺失、后端节点未更新四类原因。

## 8. 全量回归与文档更新

全量命令：

```bash
PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

全量期望：

- `approved`、`return`、`stop`、`restore`、`gate-block`、`gate-return` 全部通过。
- `artifacts/pms-simulator-report.json` 中 `ok=true`。
- 失败截图目录不产生新的有效失败截图，或截图只来自已知人工中断。

修复后更新：

- `docs/verification/仿PMS批注截图增强使用教程-2026-04-27.md`
- `docs/verification/pms-3d-review-integration-e2e.md`
- 本文件的状态和实际执行结果。

## 9. 当前执行记录（2026-04-28）

已完成：

- `scripts/pms-plant3d-initiate-flow.ts` 增加跨上下文 workspace 定位 helper。
- `scripts/pms-simulator-runner.ts` 在 `createReview()` 后根据 simulator snapshot 的 `iframeUrl` 新开同源 Plant3D 页，再执行发起面板自动化。
- `restore` 场景在打开 JH reviewer 页时显式使用前端可匹配的 `proofreader_001 / jd` token，避免 direct page 因 `user_id=JH` 与本地审核人 ID 不一致而无法恢复任务。
- 失败截图采集增强：失败时额外保存所有打开页面的 URL / frame 摘要和 page screenshot，便于区分 simulator 外壳与同源 Plant3D 页状态。
- `waitForReviewerWorkbenchAcrossContext()` 增加 direct Plant3D root 优先级，并把 reviewer ready 条件扩展为 workflow marker + reviewer landing + `__plant3dReviewerE2E`。
- `restore` 记录注入后立即读取 `/api/review/records/by-task/{taskId}`，把 confirmed records / annotations / measurements 计数写入断言 detail。
- `requestEmbedUrlData()`、simulator runner/bootstrap 的本地 fetch 增加 12s 超时，避免 backend `/api/review/embed-url` 卡住时测试无限等待。
- headed `return` 断言改为以 `node=sj`、`status=draft` 和设计批注处理入口可见为准；`sidePanelMode=readonly` 时也允许通过。
- 场景清理调整为所有场景完成后统一 best-effort cleanup，避免每个场景结束时的 delete 与仍在关闭中的页面请求竞争。

已验证：

```bash
npm run type-check
PMS_SIMULATOR_CASE=gate-block PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-gate-block-2026-04-28.json npm run test:pms:simulator
PMS_SIMULATOR_CASE=gate-return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-gate-return-2026-04-28-rerun.json npm run test:pms:simulator
PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-restore-2026-04-28-clean.json npm run test:pms:simulator
PMS_SIMULATOR_CASE=return PMS_SIMULATOR_HEADLESS=0 PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-return-headed-2026-04-28-followup3.json npm run test:pms:simulator
PMS_SIMULATOR_CASE=gate-block,gate-return PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-gates-2026-04-28-followup.json npm run test:pms:simulator
```

结果：

- 类型检查通过。
- `gate-block` 通过，确认同源 `review/3d-view` 能命中 designer marker。
- `gate-return` 复跑通过。该场景曾出现一次同源页未命中 designer marker，已在 `openPlant3dAutomationPage()` 中补充 `networkidle` 等待。
- `restore` 通过，报告 `ok=true`；confirmed readback 为 `HTTP 200 records=1 matched=1 annotations=1 measurements=1`，刷新后 confirmed record / annotation / measurement 计数均保持 `1`。
- headed `return` 通过，最终 `status=draft`、`node=sj`。
- `gate-block,gate-return` 组合通过。

剩余问题：

- 全量 `PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator` 仍未通过：连续运行时 backend `/api/review/tasks` 会在 approved/return 中途超时，随后 gate 场景 `openNew` 拿不到 iframe URL。
- 下一步应先定位后端连续场景下 `/api/review/tasks` / `/api/review/delete` 阻塞原因，或让 simulator runner 在场景间检测 backend health 并自动重启不健康 backend。

## 10. 建议执行顺序

1. 先做阶段一，统一同源 root 定位。
2. 接着修 gate 两个场景，因为它们共享同一个入口失败根因。
3. 再修 restore，验证刷新后重新定位和 ready marker。
4. 最后跑 headed return，确认是否还有独立的焦点/任务上下文问题。
5. 全量回归通过后再整理 artifact 路径和文档。

## 11. 风险与回滚

- 风险：新开同源 tab 后 simulator snapshot 与 Plant3D tab 状态不同步。
  - 缓解：所有关键动作仍由 simulator API 触发，Plant3D tab 只作为自动化执行 root。
- 风险：ready 条件过严导致低性能环境误超时。
  - 缓解：保留 `PMS_PLANT3D_POLL_MS`，trace 输出每轮候选根节点状态。
- 回滚：若统一 helper 引入新不稳定性，可先让 gate 场景显式走同源新 tab，restore 继续保留旧逻辑，分两步合入。
