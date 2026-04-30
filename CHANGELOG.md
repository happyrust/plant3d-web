# 更新日志

## [未发布]

### 变更

- **RUS-238 测量路径展示增强** (2026-04-30)
  - 测量列表、确认测量回放和批注测量证据支持异步展示模型树完整路径
  - 新增统一展示层 `useMeasurementPathSummaries`，保持 refno fallback，路径解析成功后再替换为完整路径
  - lookup 失败、模型树数据不可用或历史记录缺上下文时继续显示规范化 refno，不影响定位、隐藏、删除和回放行为
  - 补充 RUS-238 UI 接入、验收与 PMS/编校审后续验证计划文档

- **RUS-238 推送后验收规划** (2026-04-30)
  - 新增 planning-with-files 规划目录，沉淀任务计划、findings、progress、验收输入清单和工作区盘点
  - 新增自包含 HTML/SVG 流程图，说明从验收输入收集到 PMS/编校审验收与工作区收敛的路径
  - 明确真实验收继续依赖 BRAN、PMS 包名/任务单、角色和入口输入

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
