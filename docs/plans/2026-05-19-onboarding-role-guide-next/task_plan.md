# 教程向导角色化入口后续开发计划

## 目标

在已完成“帮助入口按当前登录角色直启向导”的基础上，继续完善教程向导体验，让用户无论从顶栏帮助、面板操作指南，还是外部 PMS 工作流入口进入，都能进入与当前工作流角色、当前页面上下文匹配的向导步骤，并且有清晰的可验证回归测试。

## 背景

- 当前已修复 `help.reviewGuide`：点击后直接执行 `startGuideForCurrentRole()`，不再弹出导航中心选择窗口。
- 当前已集中角色解析：`resolveGuideRoleFromUserRole()` 支持前端角色与 `sj/jd/jh/sh/pz` 工作流码，避免 `sh/admin` 落到设计师向导。
- `ReviewGuideCenter` 弹窗仍保留，可作为“浏览全部教程 / 高级选择”的入口，但不再作为顶栏帮助的默认路径。

## 用户体验原则

1. 顶栏帮助：直接进入当前登录角色完整向导。
2. 面板操作指南：直接进入当前面板相关步骤，而不是先弹出选择窗口。
3. 外部工作流：避免引导用户去应用内待办列表，优先落到当前校审面板或发起编校审面板。
4. 未识别角色：不静默失败，应给出轻量提示或回退到导航中心。
5. 可回归：每个入口都要有命令级或组件级测试证明不会重新退化成弹窗选择。

## 开发阶段

### Phase 1：入口矩阵梳理

状态：完成

任务：
- 梳理所有调用 `openGuideCenter(...)` 的入口，包括顶栏、发起编校审面板、待办任务面板、校审面板。
- 标注每个入口的期望起始步骤，例如 `initiate-review-panel`、`reviewer-task-list`、`review-panel`、`review-panel-tools`。
- 明确每个入口在 `manual/internal/external` 三类 workflow mode 下的行为差异。

验收：
- 形成入口矩阵表。
- 每个入口都有“当前角色、目标面板、目标 stepId、外部流程行为”的定义。

### Phase 2：抽象上下文启动 API

状态：完成

任务：
- 在 `useOnboardingGuide` 中新增面向入口的启动方法，例如 `startGuideForCurrentRoleTopic(topic)` 或 `startContextualGuide(topic)`。
- 将 topic 到 stepId / panelId 的映射集中管理，减少组件内散落的 `startGuideForRole(..., { stepId })`。
- 对未识别角色返回明确结果，便于 UI 决定提示或回退。

验收：
- 面板组件不再直接打开 `ReviewGuideCenter` 来完成常规“操作指南”。
- topic 映射逻辑可以单测覆盖。
- API 不破坏已有 `startGuideForCurrentRole()` 和 `startGuideForRole()` 调用。

### Phase 3：面板操作指南直启

状态：完成

任务：
- `InitiateReviewPanel` 的“操作指南”直接启动设计师发起编校审步骤。
- `ReviewerTaskList` 的“操作指南”按当前角色启动待办任务步骤。
- `ReviewPanel` 的“操作指南”按当前角色和工作流模式启动校审面板步骤。
- 保留导航中心入口，但转为显式“浏览全部教程”类操作，不再作为主要帮助路径。

验收：
- 点击三个面板“操作指南”均不会弹出选择窗口。
- 当前角色为 `proofreader/reviewer/manager` 时，校审面板入口进入对应角色向导。
- 外部流程模式下不引导到应用内待办任务列表。

### Phase 4：未识别角色与提示体验

状态：完成

任务：
- 定义 `viewer`、空用户、异常角色码的行为。
- 优先提供 toast 或小提示：“暂未识别当前工作流角色，请从导航中心选择教程”。
- 对确实需要人工选择的情况再打开导航中心。

验收：
- 未识别角色不会进入错误的设计师向导：`startContextualGuide()` 返回 `false` 且不启动向导。
- 用户能看见明确反馈：显示 warning toast “暂未识别当前工作流角色，请从导航中心选择教程”。
- 相关测试覆盖未识别角色回退：断言打开导航中心、保留 topic、发送 toast。

### Phase 5：回归测试与验证

状态：待开始

任务：
- 扩展 `useOnboardingGuide.test.ts` 覆盖 topic 映射、外部流程过滤、未识别角色。
- 扩展组件测试覆盖三个面板入口。
- 针对涉及 `ReviewPanel.vue` 或 `DesignerCommentHandlingPanel.vue` 的改动，按仓库规则运行双胞胎面板回归测试集合。

验收：
- 目标 Vitest 全部通过。
- `npm run type-check` 通过。
- 若触碰 `ReviewPanel.vue`，记录 5 套回归测试 baseline vs after 的 pass/fail 差量。

## 风险与边界

- 不在本阶段重做向导 UI 视觉样式，避免把入口逻辑和设计改版混在一起。
- 不删除 `ReviewGuideCenter`，因为它仍适合作为浏览全部教程的高级入口。
- 不把外部 PMS 角色直接等同前端角色名；统一通过角色解析函数转换。
- 不默认为设计师兜底，除非用户明确选择设计师教程。

## 建议实施顺序

1. 先做 Phase 1 和 Phase 2，把入口矩阵与 API 固化。
2. 再逐个改面板入口，每改一个入口配一个测试。
3. 最后补未识别角色提示和全量验证。

## 当前完成状态

- 已完成：顶栏 `help.reviewGuide` 直启当前角色向导。
- 已完成：右上角帮助图标直启当前角色向导。
- 已完成：角色解析兼容前端角色与工作流码。
- 已完成：新增顶栏帮助入口和角色解析回归测试。
- 已完成：面板级“操作指南”通过 `startContextualGuide(topic)` 直启上下文步骤。
- 待完成：宽回归集合中的既有失败收敛。
