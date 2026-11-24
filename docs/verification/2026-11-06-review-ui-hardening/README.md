# 三维校审外部流程门控（2026-11-06）

生产环境走外部流程：流转在 PMS。这一批把前端旁路收掉，确认只认用户证据，后端对内部 submit / return / start-review 加了外部模式 403。

## 自动化

`npx playwright test e2e/review-external-mode-gating.spec.ts`

`dtx_demo=primitives`。`/api/auth`、`/api/users`、`/api/review` 由测试路由替身，不写校审库。模型树仍连本机 gen-model。

断言：

- 待校对详情只有「流转请在 PMS 操作」和「关闭」，卡片按钮是「打开校审」，不调用 start-review。
- 没有批注时没有「待保存证据」浮卡，状态条 `data-state="empty"`，`POST /api/review/records` 为 0。换节点和 `flushPendingConfirmForExternalAction` 也不落记录。
- 功能区「确认数据」和面板「确认当前数据」都提交当前完整草稿，单据号和任务号相同。

2026-11-06 本机结果：1 passed，约 5 秒。视频关掉，因为页面持有模型 WebSocket 时，失败保留视频的收尾赶不上上下文关闭。

截图：

- `external-task-detail.png`：发起人显示为「王设计师」，底部是「流转请在 PMS 操作」。
- `external-empty-evidence.png`：校审面板写明外部流程模式，节点名是编制 / 校对 / 审核 / 批准，计数为 0，没有浮卡。

嵌入页默认布局（模型树收起、校审面板宽 420–520、三维视口至少一半）由 `DockLayout.test.ts` 断言 `applyReviewEmbedLayout`。

## 后端

`cargo test --lib test_external_workflow_mode_blocks_internal_transitions` 与 `test_review_forms_project_id_survives_create_task_and_internal_submit` 各 1 passed。

外部模式的 claims 调用 submit / return / start-review 得到 403 `WORKFLOW_MODE_EXTERNAL`。`workflow_mode=manual` 的内部提交仍然通过。公开 `/api/auth/token` 不接受客户端自报的流程模式。走查脚本要设置 `PLANT_REVIEW_ALLOW_INTERNAL_WORKFLOW=1` 才能继续调用内部流转。

本机正在跑的 `:8022` 没有换成这次编译的二进制，所以上面的 403 没有打到这个进程。

双胞胎面板 5 套和 `embedFormSnapshotRestore.spec.ts` 通过。`npm run type-check` 新增 0（当前 0 / 基线 0）。上述改动文件 ESLint 0。
