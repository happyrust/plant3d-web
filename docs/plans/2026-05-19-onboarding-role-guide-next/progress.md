# 教程向导角色化入口 Progress

## 2026-05-19

### 已完成

- 完成顶栏帮助入口修复：`help.reviewGuide` 直接启动当前登录角色向导。
- 完成角色解析修复：新增 `resolveGuideRoleFromUserRole()`，兼容前端角色与工作流码。
- 完成上下文启动 API：新增 `startContextualGuide(topic)`，集中映射当前角色、面板和起始步骤。
- 完成右上角帮助图标直启：`App.vue` 的两个菜单模式帮助按钮改为当前角色向导直启。
- 完成三个面板“操作指南”直启：
  - `InitiateReviewPanel.vue` → `initiateReview`
  - `ReviewerTaskList.vue` → `reviewerTasks`
  - `ReviewPanel.vue` → `reviewPanel`
- 完成未识别角色回退：显示 warning toast，并打开导航中心保留当前 topic，不默认进入设计师向导。
- 新增回归测试：
  - `src/components/onboarding/ReviewGuideCenter.test.ts`
  - `src/composables/useOnboardingGuide.test.ts`
- 验证通过：
  - `npx vitest run src/components/onboarding/ReviewGuideCenter.test.ts src/composables/useOnboardingGuide.test.ts`
  - `npm run type-check`

### 本次新增 planning 文件

- `docs/plans/2026-05-19-onboarding-role-guide-next/task_plan.md`
- `docs/plans/2026-05-19-onboarding-role-guide-next/findings.md`
- `docs/plans/2026-05-19-onboarding-role-guide-next/progress.md`

### 下一步

- 继续收敛宽回归集合中的既有失败，尤其是 `DesignerCommentHandlingPanel.test.ts` 和 `ReviewPanel.test.ts` 的 fixture/mock 问题。
- 若继续触碰 `ReviewPanel.vue`，同步记录双胞胎面板回归测试集合 pass/fail 差量。

### 回归集合记录

- 未设内部工作流环境变量时：60 passed / 34 failed，失败大量来自测试进入 external workflow 后缺少内部流转按钮。
- 设置 `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE=1` 后：67 passed / 27 failed。目标新增测试通过，剩余失败集中在宽回归既有 fixture/mock 区域，未显示为“操作指南入口直启”相关断言。
- 单独复现 `DesignerCommentHandlingPanel.test.ts`：仍 0 passed / 17 failed，排除并发串扰。首个失败显示组件已渲染批注处理内容，但测试期望旧文案 `批注列表` 和旧 testid/table 结构。
- 已补 `DesignerCommentHandlingPanel.vue` 的最小 formId 过滤，避免当前任务处理页混入其他单据批注；`npm run type-check` 通过。

### Phase 5 当前判断

- 不建议在本轮教程向导任务中大规模重做 `DesignerCommentHandlingPanel` 的表格/卡片双视图结构；这是独立回归修复任务，应单独设计和验证。
- 当前教程向导相关改动的聚焦测试仍通过，宽回归失败已记录为后续独立收敛项。
