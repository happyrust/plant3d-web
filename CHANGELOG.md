# Changelog

本文件记录 `plant3d-web` 面向部署与用户可见行为的变更摘要。

## [Unreleased]

### Added

- **批注严重度（问题严重程度）**：为四类批注（文字/云线/矩形/OBB）新增 `severity` 字段，4 档`致命 / 严重 / 一般 / 建议`。
  - **权限**：批注作者本人或审核侧（校对/审核/经理/Admin）可修改；Viewer 与其他设计人员只读。
  - **AnnotationPanel**：顶部新增"严重度概览"条（5 档徽章+数量，点击筛选列表）；编辑区新增下拉选择；列表先按严重度降序再按创建时间降序。
  - **AnnotationOverlayBar**：画布底部悬浮条抽屉新增"当前批注严重度"与"当前类型批量严重度"两组快捷按钮，按权限自动启用/禁用，并显示"可改 N/总数"。
  - **3D 场景高亮**：`useDtxTools` 给图钉与卡片 DOM 注入 `data-severity`，`tailwind.css` 新增 `.dtx-anno-label[data-severity=...]` 彩色左边条与图钉角标，不改动 Three.js 材质。
  - **审核可见**：确认快照（`confirmCurrentData`）与导出数据（`exportReviewData`）自动携带 `severity`；`ReviewPanel` 审核 Tab 的确认记录卡片新增"严重度分布"徽章条。
  - **后端约定**：新增 `PATCH /api/review/annotations/{id}/severity?type=...` 预留接口；未上线时自动降级到本地 store + localStorage，避免用户输入丢失。
  - **创建者归属**：`addAnnotation` 系列在创建批注时自动从 `useUserStore` 回填 `authorId`，供严重度权限判断使用；已显式传入的 `authorId` 保留。
  - **单元测试**：`auth.severity.test.ts`（10）、`useToolStore.severity.test.ts`（5）、`AnnotationPanel.test.ts` +2、`AnnotationOverlayBar.test.ts` +2、`useReviewStore.confirm.test.ts` +1。
- **批注审核动作**：批注级别新增通过（approve）、驳回（reject）、撤回（revert）审核动作；`ReviewCommentsTimeline` 混合展示评论与审核事件时间线，支持附带备注。
- **OBB 包围盒批注**：`ReviewPanel` 批注列表新增 OBB 类型，支持显示、评论及审核。
- **auth 类型增强**：新增 `AnnotationReviewState`、`AnnotationReviewAction`、`AnnotationReviewEvent` 类型及 `getAnnotationReviewDisplay`、`getAnnotationReviewActionLabel`、`getRoleDisplayName` 辅助函数。
- **output_project 直达**：`App.vue` 支持 URL 参数 `output_project` 直接选中对应项目，优先级高于 token 中的 `project_id`。
- **E2E 测试**：新增 `e2e/output-project-direct-entry.spec.ts`。
- **校审流程追踪文档**：新增三维校审当前流程追踪文档与外部被动模式流程图。

### Fixed

- **隔离 XRay 显示**：隔离模型时，其他模型不再被直接隐藏，只会以半透明方式保留在场景中；原本就隐藏的对象在取消隔离后也不会被误显示。
- **校审批注与 Dock**：校核/校对在工作台启动文字/云线/矩形批注，或在三维视图中完成批注创建时，不再自动打开右侧 Dock 的「批注」页签；需查看列表或编辑详情时，仍可通过 Ribbon「批注」或画布批注悬浮条中的「打开批注面板」手动打开。批注列表中的「定位」仅做场景内选中与飞行，提示文案已与行为一致。
- **任务类型归一化**：任务列表中的 `RefnoModelGeneration` 现在会按模型生成展示，`ModelExport` 会按导出模型展示，避免前端把后端新任务类型误判成错误分类。

### Added

- **更新说明**：新增「更新说明」入口，可直接查看当前版本对应的 changelog 内容。
- **菜单模式与引导**：补充 `useMenuMode` composable 与 `hierarchicalMenuGuide`，使设计师/校核角色 onboarding 与分层菜单、`GuideContext.menuMode` 等既有类型约定一致并可正常构建。
- **空间查询专业筛选与批量加载**：空间查询新增专业筛选、按专业仅显示、加载当前结果、只加载未加载结果、按专业批量加载等操作，便于直接把查询结果带入三维场景。

### Changed

- **模型生成向导高级项**：高级参数区收敛为网格容差和 Noun 相关选项，不再显示 Web 数据包导出与并发数输入，预览区同步简化。
