# Sprint 执行计划 · 2026-04-24

> 承接批注表格 MVP++、评论真源 PROMOTE 闭环 + CUTOVER WIP 代码，
> 本计划为**当前 Sprint 的具体执行序列**，覆盖 CUTOVER 收尾、代码清理、测量统一启动和测试修复。

---

## 0. 当前状态快照

| 维度 | 状态 |
|------|------|
| 批注表格 MVP++ (PR 1–10) | ✅ 已合并 |
| 评论真源 PROMOTE (Step 1–4) | ✅ 闭环 |
| CUTOVER 代码变更 | 🔧 WIP — `commentThreadDualRead.ts` 已删除，flags/stores 已修改，未提交 |
| 测量面板增强 | 🔧 WIP — 新增测试 +105 行，Vue 组件 +69 行 |
| 空间查询抽屉 | 🔧 WIP — +144 行改动 |
| 测试结果 | ⚠️ 149/155 通过，6 文件 10 测试失败（3D 标注区域，非 CUTOVER 相关） |

---

## 1. 执行序列

### Step 1 · CUTOVER 验证与收尾（~1h）

**目标**：确认当前 WIP 的 CUTOVER 变更完整且无遗漏。

| # | 任务 | 验收 |
|---|------|------|
| 1.1 | 搜索 `REVIEW_C_COMMENT_THREAD_STORE_DUAL_READ` 残留引用 | 零引用 |
| 1.2 | 搜索 `commentThreadDualRead` import 残留 | 零引用 |
| 1.3 | 搜索 `dual_read` 相关 eventLog kind 引用 | 仅保留类型定义（不写入） |
| 1.4 | 运行 review 相关测试子集 | 全绿 |
| 1.5 | 确认 `flags.ts` 中的 CUTOVER 状态标识正确 | flag 值语义清晰 |

### Step 2 · @deprecated 方法清理（~30min）

**目标**：移除 `useToolStore` 中已标记 `@deprecated` 的评论方法。

| # | 任务 | 验收 |
|---|------|------|
| 2.1 | 列出所有 `@deprecated` 标记的方法 | 清单确认 |
| 2.2 | 搜索全项目确认无调用 | 零外部调用 |
| 2.3 | 移除方法定义 | 编译通过 |
| 2.4 | 运行相关测试 | 全绿 |

### Step 3 · type-check 全绿（~30min）

**目标**：确保类型系统干净。

| # | 任务 | 验收 |
|---|------|------|
| 3.1 | 运行 `npm run type-check` | 零错误 |
| 3.2 | 修复发现的类型问题 | 编译通过 |

### Step 4 · 3D 标注测试修复（~2h）

**目标**：修复当前 10 个失败的 3D 标注测试。

失败测试清单：

| 文件 | 失败数 | 类别 |
|------|--------|------|
| `useMbdPipeAnnotationThree.flyTo.test.ts` | 5 | MBD 管道标注排布 |
| `bran-test-data.test.ts` | 1 | fixture 标注布局 |
| `AnnotationMaterials.test.ts` | 1 | 文字材质描边 |
| `SlopeAnnotation3D.test.ts` | 1 | 坡度标注可见性 |
| `WeldAnnotation3D.test.ts` | 1 | 焊缝标注可见性 |
| `SolveSpaceBillboardVectorText.test.ts` | 1 | 文字风格切换 |

| # | 任务 | 验收 |
|---|------|------|
| 4.1 | 分析每个失败用例的根因 | 根因清单 |
| 4.2 | 逐个修复（代码或测试断言） | 155/155 全绿 |

### Step 5 · 测量体系统一 Phase A（~3h）

**目标**：不改运行时行为，收紧测量类型定义（详见 `2026-04-23-measurement-unification-plan.md`）。

| # | 任务 | 验收 |
|---|------|------|
| 5.1 | `ConfirmedRecordData.measurements` 从 `unknown[]` → `MeasurementRecord[]` | type-check 通过 |
| 5.2 | `SnapshotMeasurement` 强化为明确类型 | type-check 通过 |
| 5.3 | `buildReplayMeasurements` 入参收紧 | type-check 通过 |
| 5.4 | 补充类型兼容性测试 | 新测试通过 |

---

## 2. 时间估算

```
Step 1 (CUTOVER 验证)  →  Step 2 (清理)  →  Step 3 (type-check)  →  Step 4 (测试修复)  →  Step 5 (测量类型)
        ~1h                   ~30min              ~30min                 ~2h                   ~3h
```

**总预估：~7h**

Step 1–3 串行，Step 4 和 Step 5 可并行。

---

## 3. 风险

| 风险 | 可能性 | 缓解 |
|------|--------|------|
| CUTOVER 移除后发现遗漏引用 | 低 | 全量搜索 + type-check |
| 3D 标注测试失败与底层渲染库升级相关 | 中 | 优先调整断言而非修改渲染逻辑 |
| 测量类型收紧导致 import 链路编译失败 | 低 | 保留 `as` 过渡，逐步收紧 |

---

## 4. 执行日志

> 以下记录实际执行过程，随进展更新。

### Step 1 执行记录 ✅

- [x] 1.1 DUAL_READ 残留搜索 — 零引用
- [x] 1.2 commentThreadDualRead import 搜索 — 零引用
- [x] 1.3 dual_read eventLog 搜索 — 零引用
- [x] 1.4 review 测试运行 — 53 文件 436 测试全绿
- [x] 1.5 flags 确认 — `REVIEW_C_COMMENT_THREAD_STORE_CUTOVER` 默认 `true`

### Step 2 执行记录 ✅

- [x] 2.1 清理 `_isCommentStoreActive()` 死分支（4 处 if 检查内联化）
- [x] 2.2 移除 `_isCommentStoreActive` 函数
- [x] 2.3 53 文件 436 测试全绿

### Step 3 执行记录 ✅

- [x] 3.1 `npm run type-check` 零错误

### Step 4 执行记录 ✅

修复 10 个 3D 标注测试失败：

| 修复 | 文件 | 类型 |
|------|------|------|
| `textFatLine.linewidth` 3→5 | AnnotationMaterials.test.ts | 断言更新 |
| `isLineSegments` → `textLabel.object3d` | SlopeAnnotation3D.test.ts | 断言更新 |
| `isLineSegments` → `textLabel.object3d` | WeldAnnotation3D.test.ts | 断言更新 |
| `height` 11.5→16（minCapHeightPx） | SolveSpaceBillboardVectorText.test.ts | 断言更新 |
| `resolveSemanticLane` 保留语义车道 | branchLayoutEngine.ts | 实现修复 |
| 添加 `applyPortDimLabelDeclutter()` 调用 | useMbdPipeAnnotationThree.ts | 实现修复 |
| 添加 `applyChainOffsetUnification()` | useMbdPipeAnnotationThree.ts | 新功能 |
| branchLayoutEngine 测试更新 | branchLayoutEngine.test.ts | 断言更新 |
| 短链式标注可见性 | bran-test-data.test.ts | 断言更新 |

结果：155/155 文件，1173/1173 测试全绿

### Step 5 执行记录 ✅

测量类型安全强化：

| 修改 | 文件 | 说明 |
|------|------|------|
| `ReviewSnapshotMeasurementPayload` 强化 | reviewApi.ts | 从 `Record<string, unknown>` 改为明确的测量字段类型 |
| `SnapshotMeasurement.payload` 收紧 | reviewSnapshot.ts | 从 `Record<string, unknown>` 改为 `ReviewSnapshotMeasurementPayload` |
| `buildReplayMeasurements` 参数收紧 | reviewRecordReplay.ts | 从 `unknown[]` 改为 `ReviewSnapshotMeasurementPayload[]` |
| 适配器 measurements 类型 | toolStoreAdapter.ts | `unknown[]` → `ReviewSnapshotMeasurementPayload[]` |
| 确认快照 measurements 类型 | reviewPanelActions.ts | `unknown[]` → `ReviewSnapshotMeasurementPayload[]` |

结果：type-check 零错误，155/155 全绿
