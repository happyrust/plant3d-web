# 校审核批注 UI 修复 Findings

## 已确认事实

- `AnnotationTableView.vue` 已声明 `open-annotation` emit，但右键菜单“打开处理详情”当前触发的是 `select-annotation`，双击才触发 `open-annotation`。
- `DesignerCommentHandlingPanel.vue` 的 `selectedAnnotation` 当前从 `filteredAnnotationItems` 查找，卡片筛选会影响详情态选中。
- `ReviewPanel.vue` 的 `selectedAnnotation` 同样从 `filteredAnnotationItems` 查找，审核侧表格打开也会受卡片筛选影响。
- `DesignerCommentHandlingPanel.vue` 的 `handleResubmitTask()` 当前直接调用 `userStore.submitTaskToNextNode()`，没有执行审核侧已有的 `runReviewSubmitPreflight`。
- `reviewPanelActions.ts` 中 `buildSubmitBlockingReviewConfirmPayload()` 已将 `obbAnnotations` 排除在提交阻塞外，符合本次不扩大 `obb` 范围的约束。
- `ReviewCommentsTimeline.vue` 的附件和截图按钮当前没有点击行为；`wont_fix` 和 `reject` 当前允许空 `actionNote` 提交。

## 实现注意点

- 详情选中态应基于 `scopedAnnotationItems`，不要再依赖卡片列表的筛选结果。
- 表格打开 handler 仍应重置 `annotationFilter` 为 `all`，确保回到卡片视图时列表能显示目标项。
- 设计侧再次提交可以复用 `runReviewSubmitPreflight`，但需要传入设计侧的未保存阻塞状态和 `reviewAnnotationCheck` 参数。
- 高风险动作备注校验应发生在后端调用和本地 store 更新前。
