# RUS-238 提交收敛 Findings

## 已确认事实

- [实现] `ReviewPanel.vue` automation hook 新增 `refreshAnnotationCommentThread()`，用于刷新后端直写后的当前批注评论线程。
- [实现] `pms-simulator-runner.ts` restore 场景不再额外打开独立 reviewer `3d-view` 页面，降低后端读写负载。
- [测试] `ReviewPanel.test.ts` 已在现有文件中补充 automation hook 最小覆盖，不新增测试文件。
- [验证] `restore` 仿 PMS 通过，最终 `status=submitted` / `node=jd`，评论正文 UI、确认记录、确认测量和 BRAN 均通过。
- [验证] `approved` 仿 PMS 复跑通过，最终 `status=approved` / `node=pz`。
- [验证] `ReviewPanel.test.ts` 全文件 34 个用例在 `--testTimeout=10000` 下通过。
- [验证] 目标 `eslint`、`npm run type-check`、focused `git diff --check` 均通过。

## 当前阻塞

- [阻塞] 提交需要用户明确授权。
- [阻塞] 工作区有大量无关脏变更，不能批量暂存。
- [待确认] `src/composables/useCommentThread.ts` 当前为未跟踪文件，但属于评论线程功能依赖；提交前必须确认是否属于本轮边界。

## 风险

- [风险] 仿 PMS 后端偶发超时，尤其是 snapshot wait 和 cleanup delete；失败时需先区分环境抖动和真实回归。
- [风险] 如果提交时误用 `git add .`，会混入大量 unrelated PMS / Review UI / DTX / 文档变更。
- [风险] `ReviewPanel.test.ts` 默认 5 秒 timeout 偏紧，容易产生假阴性；提交说明中应写明全文件验证使用 `--testTimeout=10000`。

## 决策

- [决策] RUS-238 submit closure 只提交 focused paths，不做全工作区整理。
- [决策] restore runner 的 out-of-band 后端评论注入必须显式刷新前端评论线程，这是测试自动化语义，不改变真实用户流程。
- [决策] 若 `approved` 或 `restore` 单次因 cleanup / snapshot timeout 失败，允许在记录失败后复跑一次确认；连续失败才进入诊断。
- [决策] 不主动提交，直到用户明确要求提交。

## 推荐提交边界

建议暂存：

```text
src/components/review/ReviewPanel.vue
src/components/review/ReviewPanel.test.ts
scripts/pms-simulator-runner.ts
docs/plans/2026-04-30-rus-238-post-push/task_plan.md
docs/plans/2026-04-30-rus-238-post-push/progress.md
docs/plans/2026-04-30-rus-238-post-push/findings.md
docs/plans/2026-04-30-rus-238-post-push/acceptance-inputs.md
docs/plans/2026-04-30-rus-238-submit-closure-plan/
```

暂不自动纳入：

```text
src/composables/useCommentThread.ts
artifacts/*.json
.tmp/**
其他未跟踪文档和联调脚本
```
