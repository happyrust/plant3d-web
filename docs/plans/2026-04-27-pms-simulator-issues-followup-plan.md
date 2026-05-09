# 仿 PMS 模拟问题记录与下一步开发计划

> 日期：2026-04-27
> 状态：待开发
> 关联教程：`docs/verification/仿PMS批注截图增强使用教程-2026-04-27.md`

## 1. 本次模拟结论

本轮重新跑了聚焦场景：

```bash
PMS_SIMULATOR_CASE=approved,return \
PMS_SIMULATOR_TRACE=1 \
PMS_SIMULATOR_OUTPUT=artifacts/pms-simulator-approved-return-2026-04-27-post-screenshot.json \
npm run test:pms:simulator
```

结果：

- 契约烟测通过：`7/7`。
- `approved` 主链通过：最终 `node=pz`、`status=approved`。
- `return` 驳回链通过：最终 `node=sj`、`status=draft`。

## 2. 已知问题

### P1：全量模拟器 restore 场景超时

来源：

- `artifacts/pms-simulator-report.json`

表现：

- `restore` 场景失败。
- 报错：未在任何标签页/iframe 内找到校核工作区 `[data-testid=review-workbench-workflow-zone]`。

影响：

- 不能确认刷新恢复场景在当前自动化中稳定。
- 可能掩盖真实用户刷新页面后批注/测量/截图恢复问题。

初步判断：

- JH 从仿 PMS 打开含该编校审单的三维/校审入口时，页面定位或等待条件不稳定。
- 也可能是自动化在 reload 后没有重新绑定正确 iframe / 同源 tab。

下一步：

1. 单独运行：
   `PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator`
2. 捕获失败截图和 final snapshot。
3. 对比 `openTaskForRole()` 与 `reloadReviewerWorkbenchAcrossContext()` 的 tab/iframe 选择逻辑。
4. 若实际页面可见但 selector 不可见，补充更稳定的 ready marker。

### P1：gate-block / gate-return 场景无法进入发起面板

来源：

- `artifacts/pms-simulator-report.json`

表现：

- `gate-block` 失败。
- `gate-return` 失败。
- 报错：未在任何标签页/iframe 内找到发起编校审面板 `[data-testid=designer-landing-workspace]`。
- 报错提示：跨域 iframe 无法用 Playwright 注入，应改为新开同源标签或调整嵌入方式。

影响：

- 批注门禁 block/return 的自动化证据不稳定。
- 无法用全量模拟器一次性覆盖门禁场景。

初步判断：

- 不是业务接口必然失败，而是自动化控制面进入目标页面失败。
- 需要统一仿 PMS 自动化的“同源打开三维页”策略。

下一步：

1. 单独运行：
   `PMS_SIMULATOR_CASE=gate-block PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator`
2. 单独运行：
   `PMS_SIMULATOR_CASE=gate-return PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator`
3. 检查 `openScenarioPage()`、`createReview()`、`runSubmitReviewAcrossContext()` 对 iframe / new tab 的处理。
4. 优先让 gate 场景走同源新标签，避免跨域 iframe 注入限制。

### P2：headed return 曾出现 SH 节点卡住

来源：

- `artifacts/pms-simulator-return-2026-04-27.json`

表现：

- headed return 场景失败。
- 最终 `node=sh`、`status=in_review`。
- `sh-agree-sync` 失败，提示当前上下文未形成可执行 workflow/sync 动作。
- `return-sync` 失败，提示 `workflow next_step` 缺失。

对照：

- 本轮 headless `approved,return` 复跑已通过，return 最终回到 `sj/draft`。

影响：

- headed 模式和 headless 模式可能存在上下文差异。
- 后续人工演示如果用 headed 模式，需要复核是否稳定。

下一步：

1. 单独复跑 headed：
   `PMS_SIMULATOR_CASE=return PMS_SIMULATOR_HEADLESS=0 PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator`
2. 对比 headless 成功报告与 headed 失败报告中的 `openTaskForRole role=PZ` snapshot。
3. 检查 PZ 节点 action panel 是否取到了正确 `next_step` / `workflow_role`。

## 3. 推荐开发顺序

1. **先修 gate 场景同源打开问题**：它影响两个场景，且错误信息明确。
2. **再修 restore 场景 ready marker**：确认刷新后工作区恢复是否真的失败。
3. **最后复核 headed return**：如果 headless 稳定、headed 不稳定，优先定位浏览器上下文/焦点差异。

## 4. 验收标准

下一轮修复后，全量命令应通过：

```bash
PMS_SIMULATOR_TRACE=1 npm run test:pms:simulator
```

期望：

- `approved`：通过。
- `return`：通过。
- `stop`：通过。
- `restore`：通过。
- `gate-block`：通过。
- `gate-return`：通过。
- JSON 报告 `ok=true`。

## 5. 后续文档更新

修复后需要更新：

- `docs/verification/仿PMS批注截图增强使用教程-2026-04-27.md`
- `docs/verification/pms-3d-review-integration-e2e.md`
- 必要时补充新的 artifact 路径和关键断言。
