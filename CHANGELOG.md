# 变更日志

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
