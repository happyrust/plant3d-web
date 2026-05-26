# 校审批注截图关联

## Outcome

为三维校审中的每条批注提供当前三维视图截图、确认保存并持久关联到该批注的完整闭环

## Context

- 三维校审批注目前覆盖 text / cloud / rect / obb 四类 record，均在 `src/composables/useToolStore.ts` 中支持 `screenshot?: AnnotationScreenshot`。
- `src/composables/useScreenshot.ts` 已能从当前 viewer canvas 截图并上传到 `/api/review/attachments`，但元数据透传与测试期望不一致。
- `src/components/tools/AnnotationPanel.vue` 当前只给云线批注提供截图按钮；用户目标是每一条批注都应有截图选项。
- `src/components/review/ReviewCommentsTimeline.vue` 已能展示传入的批注截图，但没有拍摄/确认保存交互。
- `src/components/review/AnnotationWorkspace.vue` 模板传入 `selectedAnnotation.screenshot`，但列表 item 未携带 screenshot，需补齐数据模型。
- 确认记录和 snapshot adapter 已保留批注 payload，因此截图挂在批注 record 上可参与 `review_records` 的恢复闭环。
- Plannotator 反馈要求结合 GPT Image 2 生成效果图，并参考当前前端界面；本目标包已补充两张效果图作为视觉方向参考：`assets/review-annotation-screenshot-capture-flow.png` 与 `assets/review-annotation-screenshot-timeline-detail.png`。

## Constraints

- 不破坏现有批注、评论、测量、确认记录和工作流流转逻辑。
- 截图保存必须先让用户确认；取消时不得上传附件，也不得修改批注 record。
- 截图关联必须能在刷新、workflow sync 恢复、确认记录回放后继续显示。
- 已有截图被替换时，应清理旧附件或明确记录无法清理的 warning，不得静默泄漏。
- 截图上传必须带上可追溯元数据：taskId、formId、sourceAnnotationId、sourceAnnotationType、fileType/description。
- UI 实现应参考本目标包的效果图，但不能为了贴图效果破坏现有 review 面板交互、信息架构和工程样式。
- 如果后端无法持久化已确认批注的 screenshot patch，必须暂停并让用户确认后端契约，不允许只做看似成功的前端本地关联。
- 遵守仓库测试要求：涉及 review 面板改动时跑指定 Vitest 回归组合，并尽量记录 baseline vs after。

## Non-Goals

- 不重构整个校审工作流、评论 thread store 或 review snapshot 架构。
- 不改变批注类型、严重度、处理状态、测量证据的现有语义。
- 不实现多张截图相册；本目标按“一条批注一张当前代表截图，可替换”处理。
- 不新增大规模图片编辑、标注绘制、压缩服务或截图 OCR。
- 不把 GPT Image 2 效果图直接当作最终代码；效果图只用于交互和视觉对齐，最终实现仍以现有组件约束为准。
- 不提交真实生产账号、token、环境变量或任何敏感数据。

## Ask Before

- 如果需要新增或修改后端 API、数据库表字段、SurrealDB schema 或附件存储契约，先停下征求用户确认。
- 如果发现当前 `/api/review/attachments` 不支持 `sourceAnnotationType` 或 `formId/taskId` 元数据，先提出兼容方案再实施。
- 如果需要删除历史附件、批量迁移旧 review_records 或修改已上线数据，先征求用户确认。
- 如果视觉交互需要在“截图按钮放在批注卡片”与“放在讨论时间线顶部”之间做产品取舍，先给出推荐并等待确认。

## Done Means

- 用户可在校审时对任意 text/cloud/rect/obb 批注点击截图，预览当前三维视图，确认保存后截图与该批注持久关联；刷新或恢复后仍能在批注详情/讨论区看到该截图，自动化与手工验证均有证据记录。
