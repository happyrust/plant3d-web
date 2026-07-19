# 研究：`.pen` 原型 ↔ 现有 Vue 组件映射与差距

> 对应 wayfinder 票 [#38](https://github.com/happyrust/plant3d-web/issues/38)（地图 [#37](https://github.com/happyrust/plant3d-web/issues/37)）。
> 按地图 Notes 要求，分「现状事实」与「重构建议」两部分记录。

## 结论速览

- `ui/` 下 15 张 `.pen` 覆盖 9 个功能域。其中 **8 个功能域已有 Vue 实现**（需重构到 pencil-new 设计系统），**「管道建模」的 7 张面板仅有原型、代码中无对应组件**（`src/components/` 无 `piping/` 目录）——需决定是「新建实现」还是划出本效应范围。
- 目标设计系统 = pencil-new tokens（slate + 蓝 + 绿/琥珀/红语义 + Fira Code 数据层 + 近黑 ink 主操作）。现有代码用 shadcn slate 默认变量（`src/assets/tailwind.css`）+ 各面板内联色（橙/蓝/Inter 混杂），**无统一的 mono 数据层与 ink 主操作约定**。
- 多数「面板」是 `dock_panels/*Dock.vue` 容器包裹「内容组件」的形态；重构应以内容组件为主，dock 容器主题另议。

## 映射表（现状事实）

| `.pen` 面板 | 主要 Vue 组件（`src/components/`） | 相关 composable | 状态 |
| --- | --- | --- | --- |
| `pencil-new.pen`（版本时间线 / 模型树差异 / 历史快照 / 双版本对比 / 3D 刻度条 等 10 frame） | `model-version/VersionTimelinePanel.vue`、`model-version/ModelVersionComparePanel.vue`、`dock_panels/ModelVersionComparePanelDock.vue`、`model-tree/ModelTreeAttrDiffPanel.vue` | `useVersionTimelineStore`、`useTreeVersionDiff` | 已实现（spec 004），需重构 |
| `task_wizard.pen`（创建向导 / 进度 / 详情 / Admin 站点） | `task/TaskCreationWizard.vue`、`TaskMonitorPanel.vue`、`TaskStatusCard.vue`、`TaskDetailModal.vue`、`ModelExportPanel.vue`、`TaskCreationPanelShadcnDraft.vue`；Admin→`site/SiteDashboardPanel.vue`、`SiteCreationWizard.vue`、`SiteEditWizard.vue`、`SiteDetailDrawer.vue` | `useTaskCreation(Store)`、`useTaskMonitor`、`useDeploymentSites` | 已实现，需重构 |
| `三维校审/dashboard.pen` | `dashboard/DashboardPanel.vue`、`DashboardOverview.vue`、`DashboardLayout.vue`、`DashboardReviewsPanel.vue`、`dock_panels/DashboardPanelDock.vue` | `useDashboardWorkbench`、`dashboardRecentProjects` | 已实现，需重构 |
| `三维校审/review-designer.pen` | `review/DesignerTaskList.vue`、`DesignerCommentHandlingPanel.vue`、`AnnotationWorkspace.vue`、`AnnotationTableView.vue`、`WorkflowSubmitDialog.vue`、`WorkflowReturnDialog.vue`、`AssociatedFilesList.vue`、`WorkflowStepBar/Timeline.vue`；`dock_panels/DesignerCommentHandlingPanelDock.vue` | `useReviewStore`、`useAnnotation*` | 已实现，需重构 |
| `三维校审/review-reviewer.pen` | `review/ReviewerTaskList.vue`、`ReviewPanel.vue`、`ReviewCommentsTimeline.vue`、`ReviewCommentsPanel.vue`、`AnnotationTableView.vue`、`ResubmissionTaskList.vue`；`dock_panels/ReviewPanelDock.vue` | `useReviewStore` | 已实现，需重构 |
| `三维校审/annotation-screenshot-feature.pen` | `tools/AnnotationPanel.vue`、`AnnotationCard.vue`、`AnnotationOverlayBar.vue` | `useDtxTools`（批注卡）、`useScreenshot` | 已实现，需重构；注意含 3D overlay 卡片（`main.scss` 的 `.dtx-anno-label`，部分非 DOM，属 out-of-scope 的渲染层） |
| `空间查询/distance-query.pen` | `spatial-query/SpatialQueryDrawer.vue`、`SpatialComputePanel.vue`；`dock_panels/SpatialComputePanelDock.vue` | `useSpatialQuery`、`useSpatialCompute` | 已实现（见 #22），需重构 |
| `管道标注/pipe-distance-annotation-panel.pen` | `pipe-distance/PipeDistanceDrawer.vue` | `usePipeDistanceStore`、`usePipeDistanceAnnotationThree`、`pipeDistanceSeverity` | 已实现，需重构 |
| `管道建模/pipe-spec / pipe-editor / pipe-router / pipe-sketching / pipe-slope / pipe-splitting / component-editor`（7 张） | **无**（`src/components/` 无 `piping/`） | — | **仅原型，未实现** |

## 差距与重构建议

1. **设计系统落地（→ #39/#40）**：`src/assets/tailwind.css` 是未改动的 shadcn slate 默认（`--primary` 近黑）；各面板大量内联色与旧身份（管道橙 `#FF6B00`、Inter）。目标需把 pencil-new 的 slate/蓝/语义/ink 收敛为统一 token。
2. **mono 数据层（→ #40）**：代码中没有「数字/ID/工程标签用等宽」这一约定；需在 token/组件层引入 Fira Code 数据层并约定使用位置。
3. **ink 主操作（→ #40）**：现有主按钮多为 shadcn 近黑或各家内联蓝/橙；需统一为「蓝留给强调/链接/选中、近黑 ink 留给主操作」的契约（与 pencil-new 一致）。
4. **图标（fog）**：`.pen` 用 lucide；代码图标现状（Vuetify mdi / 自绘 / lucide）需在 #39 核实并决定是否统一到 lucide。
5. **dock 容器（fog）**：`dockview` + Vuetify + Tailwind 三层混用；重构以内容组件为主，容器/主题边界另议（原型票 #42 会先暴露真实问题）。
6. **管道建模 7 面板（→ 范围决策，见 #41）**：无实现。需裁定本效应是否包含「按原型新建这些面板」，还是仅重构已实现面板、把新建列为后续独立效应。

## 浮现的范围问题（已在地图 #37 记为 fog）

- 管道建模 7 面板在代码中无实现：本效应是「新建 + 套新设计系统」还是「仅重构已实现面板」？建议在迁移策略票 #41 中裁定。
