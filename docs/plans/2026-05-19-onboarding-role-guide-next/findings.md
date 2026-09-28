# 教程向导角色化入口 Findings

## 已确认事实

- [入口] 顶栏帮助里的 `help.reviewGuide` 由 `ReviewGuideCenter.vue` 监听，修复前调用 `openGuideCenter('currentRole')`，因此会弹出导航中心。
- [入口] `InitiateReviewPanel.vue`、`ReviewerTaskList.vue`、`ReviewPanel.vue` 的“操作指南”目前仍调用 `openGuideCenter(topic)`，属于下一步应评估的面板级入口。
- [角色] `useOnboardingGuide.ts` 修复前直接把 `currentUser.role` 当作 `GuideRole` 使用，遇到 `sh/admin` 等非 `designer/proofreader/reviewer/manager` 值时会默认落到 `sj`。
- [角色] `src/types/auth.ts` 中已有后端工作流码到前端角色的语义：`sj=设计`、`jd=校对`、`jh/sh=审核`、`pz=批准`、`admin=管理员`。
- [工作流] `workflowMode === 'external'` 时，向导应避免强调应用内待办列表和提交/驳回类内部流转动作。
- [保留] `ReviewGuideCenter` 仍有价值：用于浏览全部角色教程、显式切换教程、展示使用建议，不应在直启入口改造中删除。
- [实现] `startContextualGuide(topic)` 已成为常规帮助入口的统一启动 API，负责 topic 到角色、面板、stepId 的映射。
- [实现] 顶栏帮助命令、右上角帮助图标、发起编校审面板、待办任务面板、校审面板均已切到上下文直启。
- [实现] 未识别角色时不再静默失败或默认设计师向导，会显示 warning toast 并打开导航中心保留原 topic。
- [回归排查] 单独运行 `DesignerCommentHandlingPanel.test.ts` 仍 17/17 failed，说明不是整组并发串扰；失败集中在测试期望 `批注列表`、`annotation-row-*`、`annotation-workspace-list`、`annotation-table-view` 等旧/目标结构，而当前组件实际渲染 `全部批注` 和自有卡片结构。
- [回归排查] `DesignerCommentHandlingPanel` 原本会把不同 `formId` 的批注混入当前单据列表，首个测试实际选中了“其他单据批注”；已补最小 formId 过滤，避免跨单据批注污染当前处理上下文。

## 已完成验证

- `npx vitest run src/components/onboarding/ReviewGuideCenter.test.ts src/composables/useOnboardingGuide.test.ts`
- `npm run type-check`
- `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE=1 npx vitest run src/components/review/DesignerCommentHandlingPanel.test.ts` 当前仍 0 passed / 17 failed；formId 过滤后首例已从“混入其他单据批注”变为“文案/testid 期望不一致”，剩余失败仍是组件结构与测试期望不一致。
- `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE=1 npx vitest run src/components/onboarding/ReviewGuideCenter.test.ts src/composables/useOnboardingGuide.test.ts src/components/review/ReviewPanel.test.ts src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/AnnotationTableView.test.ts src/components/review/reviewerWorkbenchViewModeBus.test.ts` 当前 after 结果：67 passed / 27 failed。失败集中在 `DesignerCommentHandlingPanel.test.ts` 全量 17 例及 `ReviewPanel.test.ts` 部分既有区域，主要表现为测试环境/fixture 未渲染预期工作台区域或既有 mock 缺少 `annotationReviewStatesQuery`，未定位到与“操作指南入口直启”直接相关。

## 待确认问题

- 外部 PMS 嵌入模式下，发起编校审入口是否仍允许设计师完整向导，还是只保留当前页面步骤。
