# Changelog

本文件记录 `plant3d-web` 面向部署与用户可见行为的变更摘要。

## [Unreleased]

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
