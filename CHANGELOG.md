# Changelog

本文件记录 `plant3d-web` 面向部署与用户可见行为的变更摘要。

## [Unreleased]

### Fixed

- **评论降级去重（P1）**：`addComment` 后端失败或返回非成功时，不再写入本地 store（避免本地生成的 ID 与后端不一致导致后续列表视图拉取后评论重复显示），改为 `emitToast` 提示用户重试。
- **评论编辑回滚（P2）**：`saveEditComment` 改为乐观更新 + 后端拒绝时回滚模式（与严重度编辑策略一致），后端返回 `success: false` 时自动回滚内容并 toast 提示。
- **移除 @ts-nocheck（P3）**：`AnnotationPanel.vue` 移除顶部 `@ts-nocheck`，TypeScript 零报错，恢复类型安全。

### Changed

- **ConfirmedRecordData 类型文档（P4）**：为 `ConfirmedRecordData` 的 `unknown[]` 字段添加 JSDoc 说明设计意图（后端历史记录序列化兼容）。
- **annotationKey 冲突概率文档（P5）**：`computeAnnotationKeyV1` JSDoc 补充 64-bit key 的冲突概率数据（10k: ≈2.7×10⁻¹²）及 10 万条以上升级建议。

### Docs & Refactoring

- **三维校审实现审核报告**：`docs/verification/2026-04-19-三维校审实现审核报告.md` 对照三份 plan（2026-03-26 被动模式收紧 / 2026-04-01 仿 PMS UI handoff / 2026-04-02 external/passive 全链路验收）逐条验证代码现状，给出三级风险分类与分批 commit 建议。
- **M3 批注体系重构 plan**：`docs/plans/2026-04-19-review-comment-thread-refactor-plan.md` 补档，固化 DUAL_READ/PROMOTE/CUTOVER 三阶段判据、`commentEventLog` 6 种 kind 观测面、5 处接入点、回滚预案。解决 `src/review/services/commentEventLog.ts` 注释引用的 "§8" 死链。
- **三维校审批注与处理留痕操作教程**：`docs/verification/三维校审批注与处理留痕操作教程.md` + 同名 `images/` 目录（截图集）。
- **仿 PMS 批注链路问题汇总与修复方案**：`docs/verification/仿PMS批注链路问题汇总与修复方案.md`。
- **三维校审当前流程追踪**：`docs/verification/三维校审当前流程追踪.md` 增补与修订。
- **M3 DUAL_READ 灰度服务层**：新增 `src/review/services/commentThreadDualRead.*` / `commentEventLog.*` / `sharedStores.*` 以及 `src/components/review/ReviewCommentsTimeline.test.ts`，为批注真源从 inline 迁移到 `commentThreadStore` 提供观察期与差异诊断信道。DUAL_READ 期间 inline 真源仍驱动 UI，store 并行同步并在 `commentEventLog` 记录 `snapshot_merged` / `thread_upsert` / `dual_read_diff` 等事件。
- **M2 审核恢复自测产物**：`.factory/library/m2-restore-bootstrap.md` 与 `docs/verification/m2-restore-bootstrap.md` 同步 M2 bootstrap 说明。

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
