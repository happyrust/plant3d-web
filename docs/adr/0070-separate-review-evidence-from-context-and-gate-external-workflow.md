---
status: accepted
date: 2026-11-06
---

# 确认只认用户证据，外部流程下前端不改节点和状态

生产环境的校审流程模式是外部流程：节点和状态由 PMS 通过 `workflow/sync` 推进。前端此前有三条旁路。待审核详情、开始审核和任务详情「再次提交」会调用内部的 submit / return / start-review。功能区「确认数据 / 清空」直接写确认记录，不经过面板上的校验。`hasReviewConfirmPayloadData` 把 `modelContext` 和净距快照里的节点算成「有数据」，于是每换一个节点都显示有未确认修改，零证据也能写出一条空确认记录，PMS `pre_action` 自动保存也会落下这条空记录。

决定两件事。

**证据和上下文分开。** 可以确认、可以拦截提交的，只是用户证据：四类批注、测量、归一后非空的尺寸文档、带结果的净距。`modelContext` 永远不算证据。快照比较时，模型上下文用与节点无关的版本键；净距快照先拿掉内嵌的节点，没有结果的空快照视同不存在。真正写入确认记录时仍然带上上下文，但三条确认入口（校审面板、浮卡、设计侧批注处理，以及功能区转发）都提交当前完整草稿。服务端按单据、节点、操作者整槽替换批注数组，只提交增量会把同槽里已经确认过的批注盖掉。

**外部模式把门控留在界面上，内部流转代码不删。** `resolvePassiveWorkflowMode()` 为真时，待审核详情不渲染驳回和确认流转，开始审核只打开校审面板、不调用 start-review，任务详情不能再次提交，功能区不提供清空。内部模式（`manual` / `internal`）仍走原来的按钮。后端同一边界：`submit`、`return`、`start-review` 在 claims 不是 `manual|internal` 且没有 `PLANT_REVIEW_ALLOW_INTERNAL_WORKFLOW=1` 时返回 403 `WORKFLOW_MODE_EXTERNAL`。公开的 `/api/auth/token` 不接受客户端自报的流程模式。`workflow/sync action=query` 只追加 `returned`、`return_reason`、`last_action`，嵌入恢复优先读这三项，没有这三项时仍按历史推断。

## Considered Options

- **删掉内部流转组件**：待审核详情、提交弹窗、驳回弹窗、再次提交都去掉。内部联调和走查脚本还要这些入口，删掉后只能靠改环境变量临时加回。
- **确认记录改成只提交增量**：和 2026-09-28 的闭环口径字面一致，但服务端当前是整槽替换。增量提交会让同槽的旧批注从记录里消失。
- **让 `/api/auth/token` 接受客户端传入的 workflow_mode**：任何持有项目号的页面都能把自己标成内部流程，403 就没有意义。
- **把 modelContext 从确认 payload 里拿掉**：上下文仍然要随记录保存，只是不能单独构成「有未确认修改」。

## Consequences

- `src/components/review/reviewPanelActions.ts` 新增 `hasReviewEvidenceData`。面板、浮卡、设计侧和 `flushPendingConfirmForExternalAction` 改用它。
- `src/composables/useReviewConfirmSession.ts` 是三条确认入口和功能区转发的同一份草稿与基线。
- `ReviewerTaskList`、`TaskReviewDetail`、功能区配置按流程模式收口。`review.start` 从功能区删除。
- gen-model `tasks.rs` 对三条内部流转加 403；`workflow/sync` 的 query 数据多三个只增不改的字段。走查脚本 `scripts/review/walkthrough` 要在 `PLANT_REVIEW_ALLOW_INTERNAL_WORKFLOW=1` 下才能继续调用内部 submit / return。
- 不改 `/api/review` 的路径和原有响应键，不改四个节点、批注状态机、U0 作用域容器和三条恢复链路。
