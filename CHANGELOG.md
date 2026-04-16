# Changelog

本文件记录 `plant3d-web` 面向部署与用户可见行为的变更摘要。

## [Unreleased]

### Added

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
