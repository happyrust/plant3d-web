# 校审核批注 UI 修复开发计划

## 目标

修复批注处理入口、详情打开、再次提交门禁、回复区空按钮和高风险动作保护，确保用户不会遇到“点了没反应、点 A 进 B、未处理完仍可提交”的问题。

## 下一步方案

采用“小步行为修复 + 现有测试补洞”的方案：

1. 先修表格交互契约：右键“打开处理详情”和双击统一触发 `open-annotation`。
2. 再修列表筛选对详情选中的影响：详情选中来源改为当前 `formId` 下的完整批注范围，打开详情时重置卡片筛选。
3. 复用审核侧已有 `runReviewSubmitPreflight`，让设计侧再次提交前检查未保存数据和未处理批注。
4. 清理回复区无动作按钮，并对“不需解决 / 驳回”增加备注必填保护。
5. 用现有组件测试覆盖上述行为，再运行限定测试和类型检查。

## 阶段计划

### Phase 1：RED 测试

- [x] `AnnotationTableView.test.ts`：右键打开详情触发 `open-annotation`，不只触发 `select-annotation`。
- [x] `DesignerCommentHandlingPanel.test.ts`：表格打开被卡片筛选挡住的批注仍进入详情；再次提交前执行 preflight。
- [x] `ReviewPanel.test.ts`：审核侧表格打开时切回 split 视图并定位，且不受卡片筛选影响。
- [x] `ReviewCommentsTimeline.test.ts`：空备注不能执行“不需解决 / 驳回”；附件/截图按钮不渲染。

### Phase 2：GREEN 实现

- [x] 修改 `AnnotationTableView.vue` 的右键菜单事件和文案。
- [x] 修改设计侧与审核侧 `selectedAnnotation` 查找源，必要时在表格打开 handler 重置 `annotationFilter`。
- [x] 修改设计侧 `handleResubmitTask()`，复用 `runReviewSubmitPreflight`。
- [x] 修改 `ReviewCommentsTimeline.vue`，隐藏空按钮并校验高风险动作备注。

### Phase 3：验证

- [x] 运行限定 Vitest 命令。
- [x] 运行 `npm run type-check`。
- [x] 检查最近编辑文件 lints。

## 验收标准

- 表格双击与右键“打开处理详情”行为一致。
- 卡片筛选不会让表格打开详情进入空态或跳到其他批注。
- 设计侧再次提交前会阻止未确认数据和未处理批注。
- 回复区不显示不可用的附件/截图入口。
- “不需解决 / 驳回”空备注不会改状态，填写备注后正常记录。
