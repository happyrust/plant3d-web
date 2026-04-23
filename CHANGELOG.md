# Changelog

本文件记录 `plant3d-web` 面向部署与用户可见行为的变更摘要。

## [Unreleased]

### Added（Ribbon · MVP++ PR 10 · 按钮角色可见性）

- **`RibbonButtonItem` 新增可选 `roles: UserRole[]` 字段**：声明后仅对命中角色的用户可见；未声明（默认）则始终可见，向后兼容。类型见 `src/ribbon/ribbonTypes.ts`。
- **纯函数 `ribbonItemVisibility.ts`**：导出 `isRibbonButtonVisibleForRole` / `filterRibbonItemsForUser`。未登录 + 按钮声明了 roles 时按"保守策略"隐藏（`undefined` role 视为无权限），避免敏感功能意外曝露。
- **`panel.annotationTable` 限制为 review 角色**：在 `ribbonConfig.ts` 中把"批注表格"按钮的 `roles` 设为 `[DESIGNER, PROOFREADER, REVIEWER, MANAGER, ADMIN]`（即除 VIEWER 外所有角色），避免纯查看者看到无法使用的按钮。
- **`RibbonBar.vue` 接入过滤**：新增 `activeTabVisibleGroups` computed，依据 `useUserStore().currentUser.value?.role` 对每个 group 的 items 过滤；`v-for` 切到 `activeTabVisibleGroups`。
- **测试**：`ribbonItemVisibility.test.ts` 6 用例全绿（无声明可见 / 空数组可见 / 命中可见 / 不命中隐藏 / 无 role 有限制→隐藏 / filter 保留 stack+separator）。累计 **75/75 测试全绿**（PR 8 + PR 9 + PR 10）。
- **非目标**：不做 stack 内嵌按钮的角色过滤（留给后续）；不对其他 review 按钮（`panel.initiateReview` / `panel.reviewerTasks` / `panel.myTasks` 等）设置 roles（避免影响既有用户预期）。
- **设计文档**：`docs/plans/2026-04-23-ribbon-annotation-table-role-visibility-pr10-design.md`。

### Changed（批注表格视图 · MVP++ PR 9 · Ribbon 按钮智能分发）

- **Ribbon "批注表格" 按钮按角色 / 已打开面板智能分发**：`DockLayout.handleRibbonCommand` 的 `panel.annotationTable` 分支从硬编码走 DCH 改为按以下优先级路由：
  1. 若 `review`（Reviewer 工作台）面板已打开 → 在 `review` 面板切表格视图；
  2. 否则若 `designerCommentHandling`（批注处理）面板已打开 → 在 DCH 面板切表格视图；
  3. 否则按用户角色默认：`isReviewer && !isDesigner` → 打开 `review` 面板；其他（含 sj、双重角色、未知角色）→ 打开 DCH 面板。
- **新增 `reviewerWorkbenchViewModeBus`**：`src/components/review/reviewerWorkbenchViewModeBus.ts` 镜像 `designerCommentViewModeBus` 的 latest-value ref 模式，为 Reviewer 工作台提供独立的 viewMode 请求通道（完全隔离，避免双面板互相污染）。导出 `useReviewerWorkbenchViewModeRequest` / `requestReviewerWorkbenchViewMode` / `clearReviewerWorkbenchViewModeRequest`。
- **`ReviewPanel` watch 请求**：新增 `watch(reviewerWorkbenchViewModeRequest, ...)`，消费后立即 `clearReviewerWorkbenchViewModeRequest()` 避免重放。
- **UX 一致性**：sj 用户默认路径（无任何面板打开时点击 Ribbon）保持不变，仍然落到 DCH 面板；现有 E2E `annotation-table-ribbon.spec.ts` 的 designer 场景无需改动。
- **测试**：
  - 新增 `reviewerWorkbenchViewModeBus.test.ts`（3 用例：request 更新 ref / clear 回 null / 连续 request 新 requestedAt）；
  - `ReviewPanel.test.ts` 新增 1 用例（外部 `request('table')` → 面板切表格视图），累计 **25 用例全绿**；
  - 无回归：`DesignerCommentHandlingPanel.test.ts`（13 ✓）/ `designerCommentViewModeBus.test.ts`（3 ✓）/ `AnnotationTableView.test.ts`（20 ✓）/ `DockLayout.test.ts`（5 ✓）。
- **非目标**：不新增独立的 Ribbon reviewer 按钮（那是 PR 11 的事）；不做 Ribbon 按钮角色可见性（那是 PR 10 的事）。
- **设计文档**：`docs/plans/2026-04-23-ribbon-annotation-table-smart-dispatch-pr9-design.md`。

### Added（批注表格视图 · MVP++ PR 8 · Reviewer 工作台接入批注表格）

- **`ReviewPanel.vue` 新增 `卡片列表 / 批注表格` tab 切换**：校核（jh）角色的批注工作区顶部新增与 `DesignerCommentHandlingPanel` 对齐的 tab bar（`data-testid="reviewer-annotation-list-view-mode-tabs"`），在卡片列表与批注表格之间互斥切换。
- **表格视图 = 只读浏览模式**：表格模式下隐藏 AnnotationWorkspace 的工具启动器 / timeline / "确认当前数据" 按钮，这些只在卡片列表视图下渲染；用户切回卡片列表即可继续编辑 / 确认 / 流转。
- **行交互语义**：
  - 单击行 → `selectWorkspaceAnnotation`（蓝色高亮联动 3D pin，保持表格视图）；
  - 双击行 → `annotationListViewMode = 'split'` + `locateWorkspaceAnnotation`（飞到 3D 并切回卡片列表，让用户看到完整的 reviewer 处理面板）；
  - 右键菜单复制 → `handleReviewerTableCopyFeedback` 经 `emitToast` 反馈 `success / warning` 两态。
- **独立持久化 key**：`annotationListViewMode` 通过新实例 `useNavigationStatePersistence('plant3d-web-nav-state-reviewer-workbench-v1')` 写入 localStorage，与 Designer 面板的 `...-designer-comment-handling-v2` 键完全隔离。
- **数据源分工**：表格视图消费未过滤的 `scopedAnnotationItems`（仅按 formId scope），表格内部独立的搜索 / 严重度 / 状态筛选与卡片列表的 pill 筛选**解耦**，避免双重筛选；与 `DesignerCommentHandlingPanel` 保持一致。
- **组件复用**：直接接入已有的 `AnnotationTableView.vue`，0 新增组件代码；仅对 `ReviewPanel.vue` 做 ~80 行局部改动（script ~30 + template ~50）。
- **测试**：`ReviewPanel.test.ts` 新增 4 用例（tab 切换 / 双击飞到 3D + 切回卡片 / 持久化恢复 / copy-feedback toast 分发），累计 **24/24 全绿**；`DesignerCommentHandlingPanel.test.ts`（13 ✓）/ `AnnotationTableView.test.ts`（20 ✓）/ `DockLayout.test.ts`（5 ✓）无回归。
- **非目标**：不做 Ribbon 命令路由到 ReviewPanel（留给后续 PR 9 智能分发 / 独立 reviewer 批注表格按钮）；不改 reviewer 既有 workflow（confirm / submit / reject / dialog）。
- **设计文档**：`docs/plans/2026-04-23-reviewer-workbench-annotation-table-pr8-design.md`。

### Added（批注表格视图 · MVP++ PR 7 · Onboarding 引导）

- **设计师引导流程新增"批注表格"步骤**：`src/components/onboarding/roleGuides/designerGuide.ts` 在"处理退回批注"之后追加 `annotation-table-btn` 步骤，向 target `[data-command="panel.annotationTable"]` 提示新按钮，步骤文案说明：
  - 支持搜索 / 严重度筛选 / CSV 导出 / 键盘导航 / 右键复制；
  - 单击行选中、双击行飞到 3D 并进入处理详情；
  - 面板内顶部可随时用"卡片列表 / 批注表格"切换视图。
- **只对 active workflow（内部流程）展示**：与 `resubmission-panel` 步骤一致，PMS 等外部驱动工作流在平台侧处理，不重复提示。
- **canSkip: true**：降低新手压力，用户可直接跳过。

### Added（批注表格视图 · MVP++ PR 6 · Playwright 冒烟 E2E）

- **Ribbon 入口端到端冒烟测试**：新增 `e2e/annotation-table-ribbon.spec.ts`，2 个 Playwright test：
  1. `校审 ribbon 的"批注表格"按钮应可见并带正确 label`：断言 `[data-command="panel.annotationTable"]` visible，且包含文本"批注表格"。
  2. `点击"批注表格"按钮应打开批注处理 dock 面板`：点击后 `[data-panel="designerCommentHandling"]` 可见。
- **运行方式**：`npm run test:e2e -- --grep "annotation-table-ribbon"`（本 PR 只提交代码，不强制在 CI 内运行；由维护者按需验证）。
- **范围**：只验证 Ribbon → 面板开启链路，不测表格内部交互（行单双击 / 搜索 / 排序 / 导出 / 飞到 3D 均由组件级 Vitest 覆盖）。
- **设计文档**：`docs/plans/2026-04-23-annotation-table-ribbon-smoke-pr6-design.md`。

### Added（批注表格视图 · MVP++ PR 5 · viewMode 持久化）

- **`annotationListViewMode` 写入 localStorage**：`DesignerCommentHandlingPanel` 里原 session 级的 `'split' | 'table'` 状态改用 `useNavigationStatePersistence.bindRef` 持久化，与 `selectedTaskId` / `selectedAnnotationKey` / `showInitiateDrawer` 共用 storage key `plant3d-web-nav-state-designer-comment-handling-v2`。效果：切到"批注表格"后刷新或重新挂载，面板首屏仍旧是 table，省一次点击。
- **向后兼容**：旧版用户 localStorage 无此字段时，`bindRef` 走 fallback `'split'`；非法值理论上会退化但 MVP 不做增强校验。
- **测试**：`DesignerCommentHandlingPanel.test.ts` 新增 1 用例（`persistenceState.set('annotationListViewMode', 'table')` → 挂载即 table），累计 **13/13 全绿**。
- **设计文档**：`docs/plans/2026-04-23-annotation-list-view-mode-persistence-pr5-design.md`。

### Added（批注表格视图 · MVP PR 4 · Ribbon 入口 + viewMode 请求总线）

- **Ribbon 校审组新增"批注表格"按钮**：`校审 → 面板 → 批注表格`（图标 `table`），对应新命令 `panel.annotationTable`。点击后：
  1. `ensurePanelAndActivate('designerCommentHandling')` 打开（或激活）批注处理 dock 面板；
  2. 通过 `requestDesignerCommentViewMode('table')` 请求面板内部切到表格视图；
  3. 若用户此时处于批注详情页，自动回到 `annotation_list` 顶层视图再切表格。
- **`designerCommentViewModeBus` 轻量 ref 总线**：新增 `src/components/review/designerCommentViewModeBus.ts`，导出 `useDesignerCommentViewModeRequest()` / `requestDesignerCommentViewMode(mode)` / `clearDesignerCommentViewModeRequest()`。采用"latest value" ref（非即发即触 commandBus）以保证面板被按钮触发打开时，即使尚未 mount 也能在 mount 后读到最近一次请求（风格对齐 `annotationProcessingEntry`）。
- **DockLayout 命令路由**：`src/components/DockLayout.vue` 的 `handleRibbonCommand` 新增 `'panel.annotationTable'` case，`src/ribbon/ribbonIcons.ts` 注册 `table` 图标，`src/ribbon/ribbonConfig.ts` 在 `review.panel` group 的 `panel.resubmissionTasks` 与 `panel.myTasks` 之间插入新按钮。
- **DesignerCommentHandlingPanel watch 请求**：面板内部新增 `watch(designerCommentViewModeRequest, ...)`，消费请求后立即 `clearDesignerCommentViewModeRequest()` 避免重放。
- **测试**：
  - 新增 `designerCommentViewModeBus.test.ts` 3 用例（request 更新 ref / clear 回 null / 连续 request 新 timestamp）；
  - `DesignerCommentHandlingPanel.test.ts` 新增 2 用例（Ribbon 请求切换 viewMode / 详情页下 Ribbon 请求回到列表 + 表格视图）；
  - AnnotationTableView 原 20 用例、PR 3 新增的 3 用例继续绿，累计 **35 用例全绿**。
- **设计文档**：`docs/plans/2026-04-22-annotation-table-ribbon-entry-pr4-design.md` 记录组件通信模式、文件清单、测试矩阵。
- **MVP 主线收尾**：PR 1 – PR 4 全部落地，批注表格视图功能闭环。PR 5（响应式 Drawer 浮层）已在 PR 2.5 `useContainerQuery` + AnnotationTableView Compact 卡片形态中提前实现，无独立 PR 需求。

### Added（批注表格视图 · MVP PR 3 · 接入 Dock 面板）

- **DesignerCommentHandlingPanel 接入 AnnotationTableView**：在批注列表视图顶部加入 `卡片列表 / 批注表格` **tab 切换**（`role="tablist"`，`aria-selected` 语义）。切到"批注表格"时，原 `AnnotationWorkspace` 卡片列表被 `AnnotationTableView` 替换，三端（卡片 / 表格 / 3D 图钉）共用同一份 `scopedAnnotationItems`，保持数据一致。
- **交互一致性**：
  - 表格行**单击** → `selectWorkspaceAnnotation`（与卡片单击同义：仅选中高亮，不跳转）
  - 表格行**双击** → 先 `locateAnnotation`（飞到 3D 对应构件）再 `enterAnnotationDetail`（进详情页）
  - 操作列**定位按钮** → 复用现有 `locateAnnotation`
  - **右键菜单**复制 RefNo / 批注行 → 新增 `handleCopyFeedback` 通过 `emitToast` 反馈 `copied` / `fallback` / `failed` 三态
- **详情页布局稳定性**：进入 `annotation_detail` 时自动把 `annotationListViewMode` 重置为 `'split'`，保证详情页始终走 `AnnotationWorkspace` detail 布局，避免 table 侧栅格错乱。
- **viewMode 状态管理**：新增 `annotationListViewMode: 'split' | 'table'` ref（session 级，不入 `useNavigationStatePersistence`），仅在 `annotation_list` 顶层视图下渲染 tab bar，详情页与任务入口页不显示。
- **数据源分工**：表格视图直接消费**未经 `annotationFilter` 过滤**的 `scopedAnnotationItems`（仅 `formId` scope），表格内部独立的搜索 / 严重度 / 状态筛选与卡片列表的 pill 筛选**解耦**，避免双重筛选。
- **测试**：`DesignerCommentHandlingPanel.test.ts` 新增 3 用例（tab 切换 · 表格行单击保持列表视图 · 表格行双击进详情并切回 split），`AnnotationTableView.test.ts` 原 20 用例无破坏；`npm run lint` / `npx vue-tsc --noEmit` 均通过。
- **设计文档**：`docs/plans/2026-04-22-annotation-table-dock-integration-pr3-design.md` 记录组件 API、数据源分工、事件接线、测试矩阵与风险点。
- **未做**：Ribbon 按钮入口（留给 PR 4）· `useDockLayoutMode` hook 独立（PR 2.5 的 `useContainerQuery` 已够用）。

### Added（批注表格视图 · MVP PR 2.7 · 右键菜单）

- **AnnotationTableView 右键菜单**：对齐 Pencil `9xPyi` 设计稿落地行级 contextMenu，支持四项可用动作：
  - **🎯 定位到三维模型**（快捷键 Enter） → emit `locate-annotation`
  - **▢ 打开处理详情 drawer** → emit `select-annotation`
  - **🔗 复制 refno** → 调用 `navigator.clipboard.writeText`（降级 `execCommand('copy')`）
  - **📋 复制为记录卡一行** → 使用 PR 1 的 `toCsvLine` + 默认列 · 输出 1 行 CSV，可直接粘贴到 Excel
  - MVP 不含"修改严重度"/"删除批注"（sj 角色权限受限，按 Pencil `WSaGR` 工作流）
- **交互细节**：`@contextmenu.prevent` 阻止原生菜单；视口边界自动偏移；点菜单外 / `Esc` 关闭；`Teleport` 到 `body` 避免被父容器裁切；`role="menu"` 无障碍语义。
- **新增文件**：
  - `src/components/review/annotationTableClipboard.ts` · `copyToClipboard(text)`（带 execCommand 兜底）+ `buildRowClipboardLine(item)` + `pickItemRefno(item)`
  - `src/components/review/annotationTableClipboard.test.ts` · 7 个单测
- **组件改动**：`AnnotationTableView.vue` 新增 contextMenu 状态 / 生命周期 hook（document mousedown + keydown 监听）/ 4 个菜单动作 handler / 菜单 template
- **新 emit 事件**：`copy-feedback({ kind: 'refno' | 'row', result: 'copied' | 'fallback' | 'failed', item })`，便于父组件 toast 提示
- **测试**：AnnotationTableView.test.ts 新增 3 用例（contextmenu 弹出 + Esc 关闭 / "定位"项 emit / 菜单外点击关闭）· clipboard.test.ts 7 个 · **累计 107 用例全绿**

### Added（批注表格视图 · MVP PR 2.6 · 键盘导航 + 搜索高亮）

- **键盘导航**：`AnnotationTableView` 根容器监听键盘事件，当焦点在行（`role="row"` / `role="listitem"`）上时支持：
  - `↑` / `↓` 移动到上/下一行（越界不翻转，停在首/末）
  - `Home` / `End` 跳转首/末行
  - `PageUp` / `PageDown` 翻分页（若有分页）
  - 无障碍专用，对齐 Pencil `JUta4` 设计稿；行仍保留 `Enter` 单击 / `Space` 双击语义。
- **搜索高亮**：新增 `annotationTableHighlight.ts` · `highlightMatches(text, query)` 纯函数，先 HTML 转义文本再用正则包裹 `<mark>`，多段匹配全部高亮；同时暴露 `escapeHtml` / `hasMatch` 辅助函数。
  - `AnnotationTableView` 的 title / description（表格模式和 Compact 卡片模式）都通过 `v-html` 使用 `highlightTitle` / `highlightDescription`，所有用户输入走 escape 通道，**XSS 防护内置**（专项 test：`<script>` 被转义为 `&lt;script&gt;`）。
- **测试**：`annotationTableHighlight.test.ts` 15 个用例（转义 / 空查询 / 大小写 / 多段 / 中文 / RegExp 元字符 / XSS / 空 text）+ `AnnotationTableView.test.ts` 新增 3 个（↑↓导航、Home/End、XSS 防护）+ 搜索 test 改为断言 `<mark>` 渲染。累计 **97 个单测全绿**。
- **设计依据**：Pencil `JUta4` (键盘无障碍) + 交互细则 §10 对 `/` `↑↓` `Enter` `Esc` `Space` 的约定。

### Added（批注表格视图 · MVP PR 2.5 · 响应式退化）

- **`useContainerQuery` 通用响应式 hook**：基于 `ResizeObserver` 监听任意容器宽度变化，返回 `mode: 'compact' | 'medium' | 'wide'` 与 `width` 两个响应式 ref。断点默认 `compactMax=640` / `mediumMax=960`，可选自定义；支持 SSR / 测试环境的 `initialMode`；组件卸载自动 `disconnect`。
- **`AnnotationTableView` 响应式退化**：接入 `useContainerQuery` 后根据容器（而非视口）宽度自动切换三档布局：
  - **Wide（≥960px）**：保留 PR 2 原有 5 列表格布局。
  - **Medium（640–960px）**：隐藏"校核发现问题"列的次要描述（只保留 title）、"处理情况"列从 `w-56` 收窄到 `w-40`。
  - **Compact（<640px）**：表格整体降级为纵向卡片列表（`role="listitem"`）：每张卡片头部含序号 + 严重度 pill + 操作按钮，中部标题 + 描述截断，底部状态 + 讨论数。表头完全隐藏。
  - 根 `<section>` 自动输出 `data-layout-mode="..."`，方便调试与 E2E 定位。
- **测试覆盖**：`useContainerQuery.test.ts` 5 用例（初始化 / 三档切换 / 自定义断点 / initialMode / 卸载清理）+ `AnnotationTableView.test.ts` 新增 2 用例（Compact 卡片化 + Medium 隐藏描述），全 79 用例绿。
- **设计文档**：`docs/plans/2026-04-22-annotation-table-responsive-pr2-5-design.md`。

### Added（批注表格视图 · MVP PR 2/5）

- **AnnotationTableView 表格视图组件**：基于 PR 1 的纯函数层，交付可独立 mount 的批注表格组件。**本 PR 不接入 dock 面板，由 PR 3 负责集成；不接入 Ribbon 入口，由 PR 4 负责。**
  - **`src/components/review/AnnotationTableView.vue`**：5 列（序号 / 错误标记 / 校核发现问题 / 处理情况 / 操作）· 列头可点击三态排序（asc / desc / 重置）· 顶部工具栏含搜索（300ms debounce）/ 严重度下拉 / 状态下拉 / 导出 CSV · 底部分页（pageSize 默认 10）· 空状态插画占位 · 键盘导航（Enter 单击语义、Space 双击语义）· `role="row"` + `aria-selected` 无障碍属性。
  - **`src/composables/useAnnotationTableFilter.ts`**：session 级状态容器（不入 localStorage），暴露 `sort / filters / filteredItems / currentPage` ref 与 `toggleSort / setSearch / setStatusFilter / setSeverityFilter / setPage / reset` 方法；搜索或排序变化自动把 `currentPage` 重置为 1。
  - **单双击区分**：单击行后延迟 220ms 再 emit `select-annotation`，期间若发生双击则改为 emit `open-annotation`，彻底避免单双击冲突。
  - **事件命名与 `AnnotationWorkspace.vue` 对齐**：`select-annotation`（打开 drawer 语义）· `open-annotation`（飞到 3D 语义）· `locate-annotation`（操作列按钮，`@click.stop` 不冒泡到行 select），PR 3 集成时可无缝接入现有处理函数。
  - **测试覆盖**：`AnnotationTableView.test.ts` 12 个用例（渲染 / 空态 / 单击 / 双击 / 排序 / 搜索 debounce / 严重度筛选 / 状态筛选 / locate 冒泡阻止 / 行高亮 / 分页翻页 / CSV 导出调用链）全绿。
  - **设计文档**：`docs/plans/2026-04-22-annotation-table-view-pr2-design.md` 240 行，记录 API 契约、交互规则、测试策略与 PR 3 接入预告。

### Added（批注表格视图 · MVP PR 1/5）

- **批注表格视图基础设施**：为后续 `AnnotationTableView.vue` 组件与 Ribbon 入口铺设数据层基础。本次仅新增纯函数与单元测试，不改动任何现有组件或面板，零风险。
  - **`src/components/review/annotationTableSorting.ts`**：提供 `searchAnnotationTableRows`（大小写不敏感；refno 支持 `_` 与 `/` 双形式，搜 `24381_145018` 和 `24381/145018` 均命中）、`filterByStatus` / `filterBySeverity`（状态与严重度静态筛选）、`sortAnnotationTableRows`（按 `index / severity / status / activity / refno` 稳定排序，tiebreaker 为 `activityAt` 降序，中文走 `localeCompare('zh-Hans-CN')`）、`applyAnnotationTablePipeline`（filter → search → sort 聚合流水线）。
  - **`src/components/review/annotationTableExport.ts`**：提供 `toAnnotationTableCsv`（RFC 4180 字段转义 + Windows `\r\n` 行尾，空数组保留表头）、`downloadCsv`（UTF-8 with BOM，保证 Excel 打开中文不乱码）、`buildCsvFilename`（基于任务 key 与日期的合规文件名）、默认列集对应《校审记录卡》模板。
  - **测试覆盖**：`annotationTableSorting.test.ts`（36 用例）+ `annotationTableExport.test.ts`（24 用例）共 60 条单测全绿，`vue-tsc --noEmit` 与 ESLint 均通过。
  - **设计与计划**：新增 `docs/plans/2026-04-22-annotation-dock-mvp-plan.md` 开发计划，规范 4 个 PR 的实施路径与验收标准；配套 Pencil 稿（`ui/三维校审/review-designer.pen` 新增 8 张设计稿）与 HTML 交互原型（`.tmp/review-annotation-dock/` 下 `index.html` / `journey.html` / `compact.html` / `workspace.html`）。

### Fixed

- **versionInfo 跨时区稳定性（PR 8 · 非批注表格 scope）**：`src/utils/versionInfo.ts` 的 `formatBuildDateFromIso` 与 `normalizeVersionInfo` 原来用 `getFullYear` / `getMonth` / `getHours` 等依赖 local timezone 的方法拼"北京时间"，导致 CI（UTC+0）和工位（UTC+8）输出不同的北京时间字符串，`versionInfo.test.ts` 跨机器红绿不一致。
  - 修复：新增 `formatMsAsBeijing(ms)` 工具函数，先把 UTC 时间戳加 8 小时，再用 `getUTC*` 系列方法读字段，确保输出与宿主 timezone 无关。
  - `normalizeVersionInfo` 里 UTC / UTC+8 两种格式先规范为 ISO（`T` 分隔 + `Z` / `+08:00` 后缀）再走 `formatMsAsBeijing`，语义更清晰。
  - 测试：`versionInfo.test.ts` 从 2 用例扩到 3 用例（UTC → 北京时间 · UTC+8 → 保持墙钟 · HTML fallback），时间字符串断言固定，不再依赖运行环境。
- **评论降级去重（P1）**：`AnnotationPanel` 和 `ReviewCommentsPanel` 的 `addComment` 后端失败或返回非成功时，不再写入本地 store（避免本地生成的 ID 与后端不一致导致后续列表视图拉取后评论重复显示），改为 `emitToast` 提示用户重试。
- **评论编辑回滚（P2）**：两个面板的 `saveEditComment` 改为乐观更新 + 后端拒绝时回滚模式（与严重度编辑策略一致），后端返回 `success: false` 时自动回滚内容并 toast 提示。
- **移除 @ts-nocheck（P3）**：`AnnotationPanel.vue` 移除顶部 `@ts-nocheck`，TypeScript 零报错，恢复类型安全。

### Changed

- **ConfirmedRecordData 类型文档（P4）**：为 `ConfirmedRecordData` 的 `unknown[]` 字段添加 JSDoc 说明设计意图（后端历史记录序列化兼容）。
- **annotationKey 冲突概率文档（P5）**：`computeAnnotationKeyV1` JSDoc 补充 64-bit key 的冲突概率数据（10k: ≈2.7×10⁻¹²）及 10 万条以上升级建议。
- **useToolStore 评论方法标记 @deprecated**：`addCommentToAnnotation` / `setAnnotationComments` / `updateAnnotationComment` / `removeAnnotationComment` 添加 `@deprecated` JSDoc，引导新代码使用 `commentThreadStore`。

### Added（批注体系 Phase C 评论解耦）

- **AnnotationPanel DUAL_READ 接入**：新增 `dualReadSync()` 辅助函数，评论写入成功后同步推入共享 `commentThreadStore`，通过 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` flag 开关控制，默认关闭。
- **ReviewCommentsPanel DUAL_READ 接入**：三栏视图面板同步接入 `commentThreadStore`，所有评论写入点（加载/添加/编辑/删除）完成后均触发 DUAL_READ 同步。

### Added

- **批注流转门禁前端接入（V1）**：ReviewPanel 增加提交前双层校验，包含未确认草稿阻断与后端 `review/annotations/check` 校验。
  - 未确认批注/测量草稿不允许提交流转，提示明确为「请先确认数据，再执行流转」。
  - 后端返回 `recommendedAction=return` 时提示「当前应驳回，不可直接流转到下一节点」，`recommendedAction=block` 时提示待确认批注阻塞。
  - `passive / external` 只读场景仍不新增内部流转按钮，提交链路保持外部约定。


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
- **"提资"→"编校审"术语统一**：Ribbon 菜单标签（"发起编校审"/"我的编校审"）、API 注释、错误提示及工作流流转按钮文案（"确认流转至校对/审核/批准"/"确认最终批准"）全面对齐新术语；Toast 提示由"任务已提交到下一节点"改为"已确认提交流转"。

### Added（内部基础设施）

- **批注体系 Feature Flag 系统**（`src/review/flags.ts`）：引入 `REVIEW_<PHASE>_<FEATURE>_<STAGE>` 命名规范的 feature flag，支持 `localStorage` / `VITE_*` 环境变量 / 代码默认值三级覆盖，并提供 `isReviewFlagEnabled` / `clearReviewFlagOverrides` 工具函数，为批注体系多阶段重构提供安全的渐进切换能力。
- **annotationKey v1 生成策略**（`src/review/domain/annotationKey.ts`）：前端基于批注类型、任务 ID、几何签名（text/cloud/rect/obb）与文本内容计算 SHA-1 截断 key，用于跨快照/跨恢复稳定归并评论与批注；提供 `computeAnnotationKeyV1` / `resolveAnnotationKey` / `isAnnotationKeyConsistent` 接口，兼容后端 v2 UUID 回写后的平滑迁移。
