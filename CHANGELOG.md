# 更新日志

## [未发布]

### 变更

- **批注错误类型替换** (2026-04-27)
  - 将批注"严重度"体系（致命/严重/一般/建议）替换为"错误类型"体系
  - 新增三种错误类型：原则错误（×）、一般错误（△）、图面错误（○）
  - 涉及文件：`auth.ts`、`AnnotationPanel.vue`、`AnnotationOverlayBar.vue`、`useToolStore.ts`

### 修复

- **测量清空修复** (2026-04-29)
  - 修复顶部菜单“测量 → 清空”只按当前测量模式清理，导致画面上已有测量标签残留的问题
  - 统一清理普通测量、xeokit 测量、未完成测量草稿，以及测量模式生成的管-墙/柱距离标注
  - 保留普通“尺寸标注”，避免误删用户手动创建的尺寸内容

- **PMS 模拟器驳回流程修复** (2026-04-27)
  - 修复 `openWorkflowDialog` 和 `executeWorkflowAction` 中 `shouldUseSyncOnlyWorkflowAction` 使用过期的 `state.sidePanelMode` 导致 SH 节点无法执行 agree 操作的问题
  - 根因：`openIframe` 异步加载诊断数据（`refreshDiagnosticsSnapshot`）后才更新 `sidePanelMode`，但 `openWorkflowDialog` 在诊断加载完成前就读取了旧值 `'readonly'`，导致 `shouldUseSyncOnlyWorkflowAction` 返回 `false`，阻止了外部流程模式下的 workflow/sync 操作
  - 修复方式：在 `openWorkflowDialog` 和 `executeWorkflowAction` 中使用 `deriveSidePanelMode()` 实时计算最新的面板模式，取代可能过期的 `state.sidePanelMode`
  - 影响范围：PMS 模拟器中的三维校审驳回（return）流程，特别是 SH→PZ→SJ 的驳回链路
  - 验证：`PMS_SIMULATOR_CASE=return` 场景 17/17 断言全部通过
