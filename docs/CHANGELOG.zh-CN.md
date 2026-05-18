# 更新日志

## 2026-05-18

### JD/JH 可确认 SJ 已处理的驳回批注

- 外部 `form_id` 聚焦场景下，`ReviewPanel.vue` 同步批注处理状态改为按 `formId` 查询，不再强绑当前内部 `taskId`。
- 修复 SJ、JD、JH 在同一外部单据上恢复到不同内部 taskId 时，JD/JH 看不到 SJ 已提交的 `fixed/wont_fix`，导致“同意 / 驳回”被禁用的问题。
- 后端 `plant-model-gen` 已同步补充 `jh` 角色的 `agree/reject` 权限白名单，避免 JH token 被服务端拒绝。
- 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` 11/11 通过；`npm run build` 通过；后端本地 `cargo check` 因缺少 NASM 被环境阻断，线上部署后 `/api/health` 与 `/api/version` 均 HTTP 200。

### SJ 驳回单据批注处理确认入口恢复

- 修复 SJ 打开驳回/退回单据进入 `ReviewPanel` 后，评论线程调用 `buildCommentThreadKey()` 报 `buildCommentThreadKey is not defined` 的运行时错误。
- `useToolStore.ts` 显式导入 `buildCommentThreadKey`，避免类型层面通过但运行时未注入。
- 外部 SJ returned/rejected 场景保留 `designer-only` 语义，恢复“已修改 / 不需解决 → 提交处理结果”入口，用于逐条确认批注已处理。
- 仍不开放校审侧“同意 / 驳回”动作，也不恢复新增批注/测量证据入口；“确认当前数据”继续只服务新增证据保存。
- 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` + `commentThread.test.ts` + `commentThreadStore.test.ts` 35/35 通过；`npm run build` 通过。

### SJ 外部单据仅在驳回/退回状态下进入校审面板

- 修正 `sj + 外部 form_id` 被无条件路由到 `ReviewPanel` 的问题：普通未驳回单据保持设计端落点。
- 只有恢复到的任务确认为 canonical returned/rejected 时，SJ 打开该单据才显示校审面板。
- `embedRoleLanding.ts` 不再仅凭 `sj + form_id` 把落点改为 reviewer；`form_id` 仍用于权限与批注 scope 判定。
- `embedContextRestore.ts` 支持 returned designer task panel 选择，外部 SJ returned/rejected 场景可路由到 `review`。
- `DockLayout.vue` 在任务恢复后结合 `isCanonicalReturnedTask()` 决定是否收敛到校审面板。
- 验证：`embedRoleLanding.test.ts` + `embedContextRestore.test.ts` 35/35 通过；`npm run type-check` 通过；`git diff --check` 通过。

## 2026-05-08

### RUS-239 驳回后重新流转 — UX 增强与健壮性提升

- 设计批注处理面板新增**驳回原因提示框**：驳回任务打开时在任务级动作区域顶部显示 amber 提示框，展示驳回原因并引导用户点击「流转回校对」。
- 「流转回校对」按钮就绪态增加 ring 高亮效果，禁用态显示 title 提示（未处理批注 / 未保存证据）。
- `workflowBridge.ts` 新增 `notifyParentWorkflowActionWithAck()`，发送 workflow action 后等待父窗口 `plant3d.workflow_action_ack` 回执，5 秒超时返回 `'timeout'`。

## 2026-04-30

### RUS-239 驳回后重新流转修复

- 新增外部流程桥接判断，仅在 PMS/仿 PMS 嵌入模式下向父窗口发送 `plant3d.workflow_action`。
- 设计批注处理页“流转回校对”和任务详情“再次提交”已接入 `workflow/sync active` 语义，避免外部流程场景继续走内部 submit。
- 仿 PMS runner 在发起后关闭额外 `3d-view` 页面并降低诊断等待耦合，`bran-mixed` 已验证通过至 `PZ approve`。
- 保留独立/内部模式的旧提交流转路径，并补充 RUS-239 计划、发现和执行记录。

### RUS-238 测量路径展示增强

- 测量列表、确认测量回放和批注测量证据已支持异步解析模型树完整路径。
- 新增统一展示层 `useMeasurementPathSummaries`，初始仍显示 refno fallback，路径解析成功后再替换为完整路径。
- 完整路径查询失败、模型树数据不可用或历史记录缺上下文时，继续显示 `24381/145018` 这类规范化 refno，不影响页面渲染。
- 批注证据仅在展示层增强，保留原有定位链路和同步 summary fallback。
- 补充 RUS-238 UI 接入、验收与后续 PMS/编校审验证计划文档。

### RUS-238 推送后验收规划

- 新增 planning-with-files 规划目录，包含任务计划、findings、progress、验收输入清单和工作区盘点。
- 新增自包含 HTML/SVG 流程图，展示真实验收、PMS/编校审验收、二次开发判断与工作区收敛路径。
- 明确真实验收继续依赖目标 BRAN、PMS 包名/任务单、验收角色和入口输入。

### RUS-238 仿 PMS 验收记录

- 使用 BRAN `24381_145018` 跑通 approved 主链，最终 `status=approved` / `node=pz`。
- restore 场景中 BRAN、测量和确认记录读回通过；整体失败来自刷新前评论内容 UI 断言，非测量路径展示失败。
- Chrome CDP full flow 通过真实 PMS 入口创建三维校审单，并在嵌入站点接口命中包名或 BRAN。

## 2026-04-27

### 三维校审批注截图增强

- 统一批注截图数据模型，以 `screenshot` 作为主路径，并兼容历史 cloud 批注的 `thumbnailUrl` / `attachmentId`。
- 截图上传支持 `sourceAnnotationId`、描述信息和 `annotation_screenshot` 类型元数据，便于服务端追踪来源批注。
- 审查工作区、批注表格和处理时间线支持展示批注截图缩略图，并可点击预览大图。
- 表格筛选、排序、CSV 导出和工作区错误类型统一为“原则错误 / 一般错误 / 图面错误”。
- 删除批注和重拍截图时会异步清理旧截图附件，降低服务端孤儿附件残留。
- 批注面板截图上传时显示进度；已有截图重拍前会提示确认。
