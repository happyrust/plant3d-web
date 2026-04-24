# 变更日志

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
