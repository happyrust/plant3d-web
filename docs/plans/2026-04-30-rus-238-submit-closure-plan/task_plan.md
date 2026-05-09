# RUS-238 提交收敛开发方案

> 使用 `planning-with-files` 管理：本文件记录阶段计划；`findings.md` 记录事实与决策；`progress.md` 记录执行日志。
> 流程图：`rus-238-submit-closure-flow.html`。

## 目标

在 RUS-238 测量完整路径展示、restore 刷新恢复、approved 主链验证均已通过的基础上，制定一个可执行的提交收敛方案：只提交本轮相关改动，隔离工作区已有大量无关变更，并保留可复核的验证证据。

## 当前事实

- RUS-238 测量路径展示已完成并推送过一次。
- 本轮追加了 restore / approved 验证收敛，以及 automation hook 单测覆盖。
- `restore` 仿 PMS 已通过：确认测量回放、BRAN fallback、评论正文 UI 均通过。
- `approved` 仿 PMS 复跑已通过：`SJ active -> JH agree -> SH agree -> PZ agree`，最终 `approved / pz`。
- `ReviewPanel.test.ts` 全文件 34 个用例在 `--testTimeout=10000` 下通过。
- 工作区仍有大量既有脏变更，不能批量暂存。

## 提交候选范围

只允许纳入以下本轮相关文件：

- `src/components/review/ReviewPanel.vue`
- `src/components/review/ReviewPanel.test.ts`
- `scripts/pms-simulator-runner.ts`
- `docs/plans/2026-04-30-rus-238-post-push/task_plan.md`
- `docs/plans/2026-04-30-rus-238-post-push/progress.md`
- `docs/plans/2026-04-30-rus-238-post-push/findings.md`
- `docs/plans/2026-04-30-rus-238-post-push/acceptance-inputs.md`
- `docs/plans/2026-04-30-rus-238-submit-closure-plan/`

提交前必须再次确认是否需要纳入 `src/composables/useCommentThread.ts`。当前它在工作区为未跟踪文件，但已被现有评论线程组件依赖；若不是本轮创建，不应在未确认边界前混入。

## 非目标

- 不清理 `.tmp/`、历史文档、PMS 联调大批量改动。
- 不提交与 RUS-238 无关的 Review UI / DTX / spatial query 改动。
- 不新增新的测试文件。
- 不修改已通过的业务逻辑路径，只收敛 automation 验证链路。

## Phase 1 · 提交边界复核

状态：待执行。

任务：

- 查看 focused diff，确认候选文件只包含 RUS-238 submit closure 相关内容。
- 检查 `src/composables/useCommentThread.ts` 的归属，决定是否纳入或单独留给前序任务。
- 用 `git status --short` 记录工作区仍有无关脏变更。

通过条件：

- 得到一组明确的 `git add` 路径。
- 无关文件不进入 staged 区。

## Phase 2 · 验证门禁

状态：已具备通过记录，提交前建议复跑最小集。

最小验证集：

```bash
npx eslint src/components/review/ReviewPanel.vue src/components/review/ReviewPanel.test.ts scripts/pms-simulator-runner.ts
npm run type-check
npm test -- src/components/review/ReviewPanel.test.ts --testTimeout=10000
PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=restore PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-238-post-push-restore-rerun-report.json npm run test:pms:simulator
PMS_TARGET_BRAN_REFNO=24381_145018 PMS_SIMULATOR_CASE=approved PMS_SIMULATOR_TRACE=1 PMS_SIMULATOR_OUTPUT=artifacts/rus-238-post-push-approved-rerun-report.json npm run test:pms:simulator
git diff --check -- <focused paths>
```

通过条件：

- 静态验证通过。
- 单测通过。
- restore / approved 至少使用最近一次通过报告作为提交说明证据。

## Phase 3 · 文档与证据收敛

状态：进行中。

任务：

- 确认 `post-push` 目录记录了 restore、approved、CDP full 和单测结果。
- 确认本目录记录提交边界和风险。
- 在提交说明中引用报告路径，不提交大体积临时产物，除非仓库已有约定允许。

通过条件：

- Reviewer 能从文档复核：为什么改、改了什么、如何验证。

## Phase 4 · 提交

状态：等待用户明确授权。

任务：

- 只暂存候选路径。
- 使用 Conventional Commits，例如：

```text
fix(review): stabilize RUS-238 restore verification
```

通过条件：

- `git status` 显示只有本轮相关 staged 文件进入提交。
- 提交后不推送，除非用户明确要求推送。

## Phase 5 · 推送 / 后续

状态：等待用户指令。

选项：

- 若用户要求推送：推送当前分支。
- 若用户要求 PR：基于当前分支创建 PR，并在描述中写清验证命令。
- 若不提交：保留本目录作为下一轮恢复入口。

## 风险控制

- 工作区极脏：所有 `git add` 必须显式列路径。
- 仿 PMS 有偶发后端超时：若一次失败，先看失败阶段；同类 cleanup / snapshot timeout 可复跑确认，不应盲目改业务逻辑。
- `ReviewPanel.test.ts` 默认 5 秒 timeout 偏紧：全文件验证使用 `--testTimeout=10000`。
