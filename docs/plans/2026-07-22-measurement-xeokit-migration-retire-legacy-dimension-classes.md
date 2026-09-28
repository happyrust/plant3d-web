# 测量统一到 xeokit 渲染 · 退役旧尺寸类（AlignedDimension/AngleDimension）实施方案

> 状态：草案（待评审）。日期：2026-07-22。
> 背景关联：ADR 0001（从零重建尺寸子系统）、ADR 0038（旧尺寸系统以构建全绿删除）。
> 本方案只负责“最后一段”：把仍依赖旧尺寸类的测量渲染切换到 xeokit，从而安全删除
> `MeasurementAnnotationManager` + `AlignedDimension`/`AngleDimension`。

## 目标（终态）

- `store.measurements`（旧测量记录）不再有**活的生产者**与**渲染依赖**。
- 测量的三维渲染统一由 xeokit 侧负责（`useXeokitMeasurementTools` + `Xeokit*Measurement` 类）。
- 删除 `src/composables/useMeasurementAnnotation.ts`（`MeasurementAnnotationManager`）、
  `src/utils/three/annotation/annotations/AlignedDimension.ts`、`AngleDimension.ts`（含各自 `.test.ts`）
  及 `index.ts` 中的导出。
- 保留：`computeDimensionOffsetDir(InLocal)`（被 `XeokitDistanceMeasurement` 使用）、
  `MeasurementRecord` 类型 + `toXeokitMeasurement` 转换器（用于解析历史持久化/审查数据）、
  整个管净距系统（`usePipeDistanceStore` / `usePipeDistanceAnnotationThree`）。

## 前置事实（含证据）

- **目标侧已就绪**
  - 程序化写入 API：`store.addXeokitDistanceMeasurement(rec)` / `addXeokitAngleMeasurement`（`src/composables/useToolStore.ts:1284/1293`）。
  - 记录形状：`XeokitDistanceMeasurementRecord` 只比旧 `DistanceMeasurementRecord` 多一个 `approximate: boolean`（`src/composables/useToolStore.ts:148-156` vs `97-104`）。
  - 渲染：`useXeokitMeasurementTools.syncFromStore` 遍历并渲染 `store.xeokitDistanceMeasurements` 全量记录（`src/composables/useXeokitMeasurementTools.ts:1571-1604`），由 watch 驱动，非草稿记录始终渲染。
- **旧→xeokit 转换器已存在**：`toXeokitMeasurement(measurement: MeasurementRecord)`（`src/components/review/reviewRecordReplay.ts:298`），审查回放已使用它（`approximate: false`，并保留 `formId/taskId`）。
- **真正阻塞的活写入只有 2 个工具**：
  - `measure_object_to_object` → `store.addMeasurement`（`src/composables/useDtxTools.ts:2318`）
  - `measure_point_to_object` → `store.addMeasurement`（`src/composables/useDtxTools.ts:4167`）
- **管净距不是阻塞项**：`measure_pipe_to_structure` / `measure_pipe_to_pipe` 使用独立的
  `usePipeDistanceAnnotationThree`（前缀 `pipe_distance:`，由 `src/components/pipe-distance/PipeDistanceDrawer.vue` 挂载），
  与 `store.measurements`/旧尺寸类无关。
- **其余 `store.measurements` 关联点**
  - 审查批量确认写入：`src/components/DockLayout.vue:1371`（读 `toolStore.measurements.value`），门槛用旧 `measurementCount`。
  - 面板列表兜底：`src/components/tools/MeasurementPanel.vue:77`（非 xeokit 模式列 `store.measurements`）。
  - E2E 钩子：`src/components/review/ReviewPanel.vue` 的 `addMockMeasurement`（仅自动化测试用）。
  - 持久化：`useToolStore` v6 快照含 `measurements`；另有 legacy 归档链路（保留）。
- **前两步已完成的清理（本方案的前置）**
  - 已删死代码 `LinearDimension` 类与 `createLinearDimension`（commit `ea4aa55`）。
  - 已删 `useDtxTools` 里不可达的 `measure_distance/measure_angle` 死分支（commit `141f5a3`）。
  - 因此当前无任何工具再产出旧 `angle` 测量记录；`AngleDimension` 仅剩“渲染历史/持久化 angle 记录”这一潜在用途。

## `store.measurements` 生产者 / 消费者清单

| 角色 | 位置 | 处理 |
| --- | --- | --- |
| 生产·object_to_object | `useDtxTools.ts:2308-2318` | Phase 1 改 xeokit |
| 生产·point_to_object | `useDtxTools.ts:4149-4167` | Phase 1 改 xeokit |
| 生产·E2E 钩子 | `ReviewPanel.vue addMockMeasurement` | Phase 2 改 xeokit |
| 生产·持久化加载 | `useToolStore` v6 反序列化 | Phase 2 加载时转 xeokit |
| 渲染·3D | `MeasurementAnnotationManager`（`useMeasurementAnnotation.ts`），`ViewerPanel.vue:4090-4137` | Phase 3 删除 |
| 消费·列表 | `MeasurementPanel.vue:77` | Phase 2 去旧兜底 |
| 消费·审查写入 | `DockLayout.vue:1371` | Phase 2 改读 xeokit |
| 消费·审查快照 | `workflowSyncAdapter.appendMeasurements`（形状无关） | 无需改（payload 透传） |
| 转换·历史 | `reviewRecordReplay.toXeokitMeasurement` | 保留 |

## 阶段实施

### Phase 0 — 决策（开工前确认）
1. object/point 最近点测量的 `approximate`：建议 `false`（实线），与当前 `AlignedDimension` 观感一致；若希望区分“近似最近点”可设 `true`（虚线）。
2. 历史持久化/审查中的旧 `measurements`：走“加载/回放时转 xeokit”的向后兼容（建议采纳）。

### Phase 1 — 迁移 2 个活工具（小、可逆）
- 改 `useDtxTools.ts`：
  - object_to_object（2308）与 point_to_object（4149）构造的 `DistanceMeasurementRecord` 改为 `XeokitDistanceMeasurementRecord`（补 `approximate`，按 Phase 0 决策取值），调用 `store.addXeokitDistanceMeasurement(rec)` 取代 `store.addMeasurement(rec)`。
- 确认选中/高亮：这两类记录改由 xeokit 管理后，选中走 `activeXeokitMeasurementId` 与 xeokit 渲染（`ViewerPanel.vue` 的 `meas_` 分支不再接收它们）。
- 验证：
  - 手动/CLI：创建 object/point 测量 → 由 xeokit 渲染、进 xeokit 列表、`store.measurements` 不增长。
  - `npx vitest run src/composables/useDtxTools.objectMeasure.test.ts`（并按需更新断言到 xeokit store）。
  - `npm run type-check`。

### Phase 2 — 审查/持久化/面板切离 store.measurements
- `DockLayout.vue:1371`：批量确认改读 `allXeokitMeasurements`，门槛用 xeokit 计数。
- 持久化：加载 v6 快照时用 `toXeokitMeasurement` 把旧 `measurements` 合并进 xeokit 列表；停止写入新旧记录（升 v7 或按 legacy 归档模式处理），保留旧字段解析以兼容历史。
- `MeasurementPanel.vue:77`：移除旧 `store.measurements` 兜底，仅列 xeokit。
- E2E 钩子 `addMockMeasurement`：改用 `store.addXeokit*Measurement`；同步更新引用它的 PMS/审查 e2e 断言。
- 验证：
  - 审查批量确认能收录测量、刷新后恢复、面板列表正确。
  - **双胞胎面板 5 套回归**（AGENTS.md 强制）：
    `npx vitest run src/components/review/ReviewPanel.test.ts src/components/review/DesignerCommentHandlingPanel.test.ts src/components/review/AnnotationTableView.test.ts src/components/review/AnnotationSheetWorkspace.test.ts src/components/review/ReviewCommentsTimeline.test.ts`
  - 用**旧格式 fixtures** 增补持久化/回放迁移测试（确保历史 angle/distance 记录仍可见）。

### Phase 3 — 删除旧渲染器与尺寸类
- `ViewerPanel.vue`：移除 `MeasurementAnnotationManager` 初始化 + 3 个 watch + import（`4090-4137`、`84`）；重指或移除 `meas_` 选中分支（`4064-4086`）。
- 删 `src/composables/useMeasurementAnnotation.ts`。
- 删 `src/utils/three/annotation/annotations/AlignedDimension.ts`、`AngleDimension.ts` 及 `.test.ts`；`src/utils/three/annotation/index.ts` 去掉两者导出。
- 可选退役 `store.measurements` 运行态（`ref`、`addMeasurement/removeMeasurement/clearMeasurements`、`activeMeasurementId`、`measurementCount`）；**保留** `MeasurementRecord` 类型 + `toXeokitMeasurement`。
- 保留 `computeDimensionOffsetDir(InLocal)`（xeokit 依赖）。
- 验证：`npm run type-check` + 全量 `npm test` + 关键 e2e（测量、审查）。

### Phase 4 — 守护与文档
- 扩 `src/testing/dimensionLegacyRemovalGuard.test.ts` 的 forbidden 列表，加入 `AlignedDimension`/`AngleDimension`（确认生产源无残留），保持绿。
- 更新过时描述：`docs/notes/solvespace-dimension-compare.md` 等。

## 风险与缓解

- **历史数据向后兼容（最大风险）**：旧持久化/审查快照里的 `measurements` 必须在读时转 xeokit，否则历史测量“消失”。缓解：保留 `MeasurementRecord` 类型 + `toXeokitMeasurement`，并用旧 fixtures 加迁移测试后再进 Phase 3。
- **观感变化**：`approximate` 影响线型（实/虚）。缓解：Phase 0 定值，默认 `false` 保持现状。
- **选中/active id 统一**：object/point 从 `activeMeasurementId` 切到 `activeXeokitMeasurementId`。缓解：Phase 1 覆盖 hover/select 测试。
- **E2E 钩子/断言**：PMS 与审查 e2e 可能引用旧 `addMockMeasurement`/旧列表。缓解：Phase 2 同步更新。
- **elevation 记录**：旧 union 含 elevation_point/delta，历史数据可能存在；`toXeokitMeasurement` 已覆盖，加载转换即可。

## 回滚

- 每阶段独立提交；Phase 1 可通过把 add 调用切回 `store.addMeasurement` 回滚。
- Phase 3 的删除必须在 Phase 1–2 完成并验证通过后执行；未过验证不得删类。

## 工量粗估

- Phase 1 ≈ 0.5 人日；Phase 2 ≈ 1–2 人日（数据兼容为主）；Phase 3 ≈ 0.5–1 人日；Phase 4 ≈ 0.5 人日。
- 合计约 **3–4.5 人日**。

## 最终删除清单（Phase 3 勾选）

- [ ] `ViewerPanel.vue` 移除 `MeasurementAnnotationManager` 接线与 `meas_` 选中分支
- [ ] 删 `src/composables/useMeasurementAnnotation.ts`
- [ ] 删 `AlignedDimension.ts` / `AlignedDimension.test.ts`
- [ ] 删 `AngleDimension.ts` / `AngleDimension.test.ts`
- [ ] `index.ts` 去掉 `AlignedDimension`/`AngleDimension` 导出
- [ ] （可选）退役 `store.measurements` 运行态，保留类型 + 转换器
- [ ] 扩守护测试禁基础尺寸类并保持绿
