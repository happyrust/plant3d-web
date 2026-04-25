# 变更日志

## 2026-04-25（仿 PMS 驳回链路修复）

### 嵌入页保存 → PMS 模拟器无感知（P0）

- **新增** `src/components/review/InitiateReviewPanel.vue`
  - 新增 `EmbeddedFormSavedMessage` 类型与 `notifyParentFormSaved` 帮助函数
  - `handleSubmit` 在 `externalWorkflowMode=true` 成功保存后向 `window.parent` 发送 `plant3d.form_saved`，携带 `taskId / formId / componentCount / packageName`
- **新增** `src/debug/pmsReviewSimulatorEmbedMessages.ts`（新模块）
  - 抽离 `EmbeddedWorkflowActionMessage` / `EmbeddedFormSavedMessage` 类型
  - 抽离 `parseEmbeddedWorkflowActionMessage` / `parseEmbeddedFormSavedMessage` 类型守卫，纯函数零状态
- **新增** `src/debug/pmsReviewSimulator.ts`
  - 新增 `handleEmbeddedFormSaved`：收到 `form_saved` 后更新 `iframeMeta` → `refreshList` → `setSelectedTask` → `refreshDiagnosticsSnapshot`
  - `handleWindowMessage` 分两路分发 workflow_action 与 form_saved
  - `refreshList` 若没有 `selectedTaskId`，按 `iframeMeta.formId || lastOpenedFormId` 自动回选
  - `executeWorkflowAction` 进入决策前先 await `refreshDiagnosticsSnapshot`，避免角色切换 / 重开 iframe 后 diagnostics 异步刷新与 `runWorkflowAction` 之间的 race
  - 访问被阻 / 缺 formId 路径也写入 `workflowVerify.lastVerifyAction = action / lastVerifyOk = false`，避免下一轮 JSON 报告里 detail 沿用上一步成功动作的"验证通过"残文

### scenarioReturn 断言口径与后端独立证据

- **新增** `scripts/pms-simulator-runner.ts`
  - 新增 `describeWorkflowVerifyDetail` / `describeWorkflowSyncDetail` / `assertWorkflowVerify` / `assertWorkflowSync` 帮助函数
  - scenarioApproved / scenarioReturn / scenarioStop 的所有 `*-verify` / `*-sync` 断言改用新帮助函数；detail 直接输出 `expected_action / actual_action / ok / message` 四元组，便于读出 action 错位
  - 新增 `getJson` 通用 helper
  - 新增 `probeBackendTaskByFormId(runtime, formId)`：直接 `GET /api/review/tasks` 读后端真实 `current_node / status`
  - scenarioReturn 在 PZ return 之后、reopen 为 SJ 之前新增 `return-backend-current-node` 断言，给 root cause 三选一提供独立证据

### 测试与文档

- **新增** `src/debug/pmsReviewSimulatorEmbedMessages.test.ts` — 10 个单测，覆盖类型守卫的全部分支
- **新增** `src/components/review/form-binding.test.ts` 中 external mode 场景对 `window.parent.postMessage('plant3d.form_saved', ...)` 的断言
- **新增** `docs/plans/2026-04-25-pms-reject-flow-fix.md` — 失败链路定位 / 修复目标 / 改动清单 / 风险对策 / 追踪表格 / 已提交改动摘要
- **回归** `npx vue-tsc --noEmit --pretty false` → 0 errors
- **回归** `npx vitest run` → **162 files / 1236 tests / 0 failed**

### 待 runtime 验证（未提交）

- E2 PZ return → SJ 实际落到 jd 的根因仍需起 `vite (3101) + plant-model-gen (3100)`、跑 `bun run test:pms:simulator -- --cases=return,stop,approved` 后看新 JSON 三元组（`return-verify` / `return-sync` / `return-backend-current-node`）
- E4 gate-return 403（SH 不是 checker 节点负责人 JH）需 owner 拍板由测试改身份还是后端放权

## 2026-04-24（晚间 · Wave 3D）

### ReleaseNotesDialog 回归修复

- **修复** `src/utils/releaseNotes.ts` 的 `VERSION_HEADING_RE`：同时支持 `## [Unreleased]` 与 `## 2026-04-24（自由式）` 两种版本标题格式
- **修复** `src/components/ReleaseNotesDialog.test.ts` 断言：用 `/2026-04-\d{2}|Unreleased/` 正则兼容两种格式
- **背景**：提交 `9ac1d9c` 把 CHANGELOG.md 格式从 `## [Unreleased]` 改为 `## 2026-04-24（...）` 后，`parseReleaseNotes` 无法解析，对话框内容为空导致测试失败

### Wave 4 新功能选题定稿

- **发现** 远端 `b33545c feat(dtx): add object nearest measure ui` 已落地"两个构件最近点测量" MVP v1（ObjectMeasureDrawer + useDtxTools 算法）
- **决策** Wave 4 按 ROI 降序推进：
  1. 最近元素测量 V2 结果卡（~3h）— 结果展示 / 保存到校审 / 截图（复用 CaptureOptions.annotation_shot）
  2. 批注截图自动触发（~2h）— 云批注完成后调用 auto_cloud_finish 截图 + 缩略图
  3. 构件空间定位 MVP（~5h）— useSpatialQuery 扩展，属新能力线
- **详见** `docs/plans/2026-04-24-wave3-continuation-plan.md` §9 Wave 3D 决策章节

## 2026-04-24（晚间 · Wave 3C）

### 测量体系统一 Phase B 启动

- **新增** `src/composables/unifiedMeasurement.ts`
  - `UnifiedMeasurementRecord` 类型（含 `approximate: boolean` + `source: 'classic' | 'xeokit' | 'replay'`）
  - 正反向适配器：`fromClassicMeasurement` / `fromXeokitMeasurement` / `toClassicMeasurement` / `toXeokitMeasurement`
  - 聚合函数：`combineMeasurements(classic, xeokitDistance, xeokitAngle)`
  - Flag helper：`isUnifiedMeasurementStoreEnabled()`（默认 false，`localStorage['measurement.unified_store']` 或 `VITE_MEASUREMENT_UNIFIED_STORE` 可覆盖）
- **新增** `useToolStore.unifiedMeasurements`（只读 computed）— 三路测量的聚合投影，**写入路径不变**
- **新增测试** 20 个：
  - `unifiedMeasurement.test.ts` — 15 个（适配器正反向 + combine + flag）
  - `useToolStore.unifiedMeasurements.test.ts` — 5 个（store 集成：新增/删除时 computed 同步变化）
- **承接计划** `docs/plans/2026-04-23-measurement-unification-plan.md` Phase B B1–B2

## 2026-04-24（归档 · 规划文档 + 设计稿）

### 新增规划文档

- `docs/plans/2026-04-23-measurement-unification-plan.md` — 测量体系统一与增强开发计划（经典/Xeokit 双轨合一、类型安全强化、管到管核心算法补齐）
- `docs/plans/2026-04-24-next-phase-development-plan.md` — 下一阶段开发计划（CUTOVER 收尾 + E2E 补全 + 代码清理 + 下一功能准备）

### 新增设计稿

- `ui/三维校审/annotation-screenshot-feature.pen` — 批注截图特性（CaptureOptions / 自动云收束截图 / 截图缩略图展示）Pencil 设计稿

## 2026-04-24（晚间 · Wave 3B）

### 空间距离查询抽屉 UI 按设计稿重构

- **新增**"拾取物项"按钮（distance + refno 模式）— 点击复用 `applyCurrentSelection` 从 viewer 当前选中回填 `draft.refno`
- **新增** refno 状态指示：绿色圆点 + 当前 Refno 显示；未选中时显示"尚未选中物项"
- **新增** 半径滑动条（100–10000 mm，步长 100）+ 4 个预设 Chip（100 / 500 / 1000 / 5000 mm）
- **重构** 通用 section：distance 模式下只保留"最大结果数"（半径已迁移至专属滑动条区块），range 模式保持原布局
- **新增** `src/components/spatial-query/SpatialQueryDrawer.test.ts` — 6 个单测覆盖拾取按钮、状态圆点、滑动条、预设 Chip、模式切换隔离
- **对齐** `ui/空间查询/distance-query.pen` 设计稿

## 2026-04-24（晚间 · Wave 3A）

### 截图能力扩展 + 测试

- **新增** `CaptureOptions` 类型（`kind` + `sourceAnnotationId`），向后兼容 `string` filename 入参
- **新增** `buildDefaultFilename` 的 3 条分支：
  - `annotation_shot` + `sourceAnnotationId` → `annotation-<id>-<ts>.png`
  - `auto_cloud_finish` + `sourceAnnotationId` → `cloud-<id>-<ts>.png`
  - 其他 → `screenshot-<ts>.png`
- **新增** `src/composables/useScreenshot.test.ts` — 12 个单测覆盖分支/兼容性/错误/辅助函数
- **接入** `src/components/tools/AnnotationPanel.vue` 的 `captureCloudAnnotationShot` 已使用新签名

## 2026-04-24

### 评论体系 CUTOVER 收尾

- **删除** `commentThreadDualRead.ts` 及其测试 — 双读层不再需要
- **清理** `_isCommentStoreActive()` 死分支 — 4 处 if 检查内联化
- **更新** `flags.ts` — `REVIEW_C_COMMENT_THREAD_STORE_CUTOVER` 默认 `true`
- **简化** `sharedStores.ts`、`commentEventLog.ts`、`ReviewCommentsTimeline.vue` 等相关文件

### MBD 标注布局修复

- **修复** `resolveSemanticLane` — 保留语义车道顺序，不再在 `offset_level` 存在时归零
- **启用** `applyPortDimLabelDeclutter()` — 端口尺寸密集时自动错位排布与稀疏化
- **新增** `applyChainOffsetUnification()` — 同组 chain 尺寸统一偏移，形成共线风格
- **修复** 10 个 3D 标注测试失败（AnnotationMaterials/Slope/Weld/BillboardText/flyTo）

### 测量类型安全强化 (Phase A)

- **强化** `ReviewSnapshotMeasurementPayload` — 从 `Record<string, unknown>` 升级为明确的测量字段类型
- **收紧** `buildReplayMeasurements` 参数 — `unknown[]` → `ReviewSnapshotMeasurementPayload[]`
- **收紧** `SnapshotMeasurement.payload` — `Record<string, unknown>` → `ReviewSnapshotMeasurementPayload`
- **更新** `toolStoreAdapter.ts`、`reviewPanelActions.ts` 中的测量类型

### 空间查询

- **修复** Refno 回退路径未传 `spec_values` 到服务端的 Bug
- **新增** 空间距离查询 UI 设计稿 (`ui/空间查询/distance-query.pen`)

### 测试

- 155/155 测试文件全绿，1173/1173 测试通过
- `npm run type-check` 零错误

---

## 2026-04-23

### 评论真源迁移 PROMOTE 闭环

- DUAL_READ + EVENT_LOG 默认开启
- getAnnotationComments 透明切换到 commentThreadStore
- 写路径 PROMOTE — 评论增/改/删同步到 commentThreadStore
- lowerSnapshotComment 适配器测试

### 批注表格 MVP++ (PR 1–10) 全部完成

- 基础设施 → 表格组件 → 响应式 → 键盘导航 + 搜索高亮 → 右键与 clipboard → Ribbon 批量落地
