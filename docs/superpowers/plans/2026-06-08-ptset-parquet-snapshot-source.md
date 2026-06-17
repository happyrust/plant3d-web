# ptset 显示与测量捕捉同源实施计划

> **For agentic workers:** Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

**Goal:** 将正式 ptset 显示、BRAN 子元件点集检查、测量 hover 捕捉统一到当前加载模型包的 parquet 快照，消除后端实时数据与 viewer 快照不一致导致的点位漂移。

**Architecture:** `useDbnoInstancesParquetLoader` 作为 ptset 单一数据入口；`ViewerPanel` 和 `PtsetPanelDock` 只负责触发与展示；`usePtsetVisualizationThree` 复用 `ptsetTransform` 的共享坐标链路。

**Tech Stack:** Vue 3 + TypeScript + DuckDB-WASM + Parquet + Vitest + vue-tsc。

**Spec:** `docs/superpowers/specs/2026-06-08-ptset-parquet-snapshot-source-design.md`

**验证策略:** 单元测试覆盖 loader 摘要查询和坐标链路；`npm run type-check` 覆盖 Vue/TS 类型约束。

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `src/composables/useDbnoInstancesParquetLoader.ts` | 修改 | 新增 parquet 直子元件 ptset 摘要查询 |
| `src/components/dock_panels/ViewerPanel.vue` | 修改 | 正式 ptset 显示改走 parquet |
| `src/components/dock_panels/PtsetPanelDock.vue` | 修改 | BRAN 子元件检查与绘制改走 parquet |
| `src/composables/usePtsetVisualizationThree.ts` | 修改 | 复用共享坐标变换工具 |
| `src/utils/three/ptsetTransform.ts` | 修改 | 补方向向量变换工具 |
| `src/composables/useDbnoInstancesParquetLoader.test.ts` | 修改 | 增加摘要查询和缺失 ptsets 表测试 |
| `src/utils/three/ptsetTransform.test.ts` | 新建 | 覆盖 ptset 坐标链路 |

---

## Task 1: 建立 parquet 子元件 ptset 摘要入口

**Files:**

- Modify: `src/composables/useDbnoInstancesParquetLoader.ts`
- Modify: `src/composables/useDbnoInstancesParquetLoader.test.ts`

- [x] **Step 1.1: 新增 `ParquetPtsetChildSummary` 类型**

字段包括：

- `refno`
- `noun`
- `name`
- `success`
- `ptCount`
- `errorMessage`

- [x] **Step 1.2: 新增 `queryDirectChildrenPtsetSummary(dbno, ownerRefno)`**

实现要求：

- 从 `instances.parquet` 读取 `owner_refno_str = ownerRefno` 的直子元件。
- 当 manifest 包含 `ptsets` 表时，按 `cata_hash` 聚合点数。
- 当 manifest 不包含 `ptsets` 表时，仍返回子元件列表，但全部标记为不可用。

- [x] **Step 1.3: 补单元测试**

覆盖：

- 有 ptset 的子元件返回 `success: true` 和点数。
- 无 ptset 点的子元件返回明确错误。
- 缺少 `ptsets.parquet` 时仍列出子元件并标记不可用。

---

## Task 2: 正式 ptset 显示改走 parquet

**Files:**

- Modify: `src/components/dock_panels/ViewerPanel.vue`

- [x] **Step 2.1: 移除正式显示对 `pdmsGetPtsetWithContext` 的依赖**

`ptsetVisualizationRequest` watcher 中改为：

```ts
const dbno = getDbnumByRefno(normalized);
const response = await parquetLoader.queryPtsetByRefnoFromParquet(dbno, refnoKey);
```

- [x] **Step 2.2: 解析失败时直接提示**

当 refno 无法解析 dbno 时，toast 明确提示，不走后端回退。

- [x] **Step 2.3: 保留原显示行为**

成功后仍执行：

- `renderPtset(refnoKey, response)`
- `flyToPtset()`
- toast “已显示 N 个连接点”

---

## Task 3: BRAN 子元件检查改走 parquet

**Files:**

- Modify: `src/components/dock_panels/PtsetPanelDock.vue`

- [x] **Step 3.1: 移除 `e3dGetChildren` 和后端 batch ptset 查询**

BRAN 子元件列表改由 `queryDirectChildrenPtsetSummary()` 提供。

- [x] **Step 3.2: 单个子元件绘制改走 parquet**

`renderBranchChild(refno)` 调用：

```ts
queryPtsetByRefnoFromParquet(dbno, refno)
```

- [x] **Step 3.3: 全部成功项叠加显示改走 parquet**

`renderAllBranchChildren()` 对成功摘要项逐个拉完整 `PtsetResponse`，再用：

- `renderPtset()` 绘制第一项
- `appendPtset()` 叠加后续项

---

## Task 4: 坐标链路收敛到共享工具

**Files:**

- Modify: `src/utils/three/ptsetTransform.ts`
- Modify: `src/composables/usePtsetVisualizationThree.ts`
- Create: `src/utils/three/ptsetTransform.test.ts`

- [x] **Step 4.1: 新增 `applyPtsetTransformToDir()`**

方向向量只应用矩阵线性部分，不应用平移。

- [x] **Step 4.2: 渲染器复用共享 transform**

`usePtsetVisualizationThree` 使用：

- `applyPtsetTransformToPoint()`
- `applyPtsetTransformToDir()`

- [x] **Step 4.3: 补坐标链路测试**

测试链路：

```text
ptset local point
  -> unit_info.conversion_factor
  -> world_transform
  -> globalModelMatrix
  -> scene coordinate
```

---

## Task 5: 验证与收敛

- [x] **Step 5.1: 运行目标单测**

```bash
npx vitest run \
  src/composables/useDbnoInstancesParquetLoader.test.ts \
  src/utils/three/ptsetTransform.test.ts
```

结果：

- `src/composables/useDbnoInstancesParquetLoader.test.ts`：13 tests passed
- `src/utils/three/ptsetTransform.test.ts`：2 tests passed

- [x] **Step 5.2: 运行类型检查**

```bash
npm run type-check
```

结果：通过。

- [x] **Step 5.3: 运行完整 Vitest 套件并记录现状**

```bash
npm test
```

结果：失败。当前完整测试集结果为 155 个测试文件通过、27 个测试文件失败；失败集中在 `ReviewPanel`、`TaskReviewDetail`、`MbdPipePanel`、`MeasurementPanel` 等既有区域。与本次 ptset parquet 改造直接相关的目标测试文件仍通过。

- [x] **Step 5.4: IDE 诊断检查**

结果：编辑文件无 linter diagnostics。

- [x] **Step 5.5: 运行本次改动文件的 ESLint 检查**

```bash
npx eslint \
  src/composables/useDbnoInstancesParquetLoader.ts \
  src/components/dock_panels/PtsetPanelDock.vue \
  src/components/dock_panels/ViewerPanel.vue \
  src/composables/usePtsetVisualizationThree.ts \
  src/utils/three/ptsetTransform.ts \
  src/composables/useDbnoInstancesParquetLoader.test.ts \
  src/utils/three/ptsetTransform.test.ts
```

结果：通过。修复了导入排序、数组类型和模板缩进后，目标单测与 `npm run type-check` 已重新通过。

---

## 后续人工验收建议

- 打开一个包含 `ptsets.parquet` 的模型包。
- 在模型树右键一个普通构件，选择显示点集，确认绿色十字与标签出现。
- 进入测量模式，hover 同一构件，确认可吸附关键点与正式显示位置一致。
- 对 BRAN 节点打开点集面板，确认直子元件列表来自当前模型快照，并可单个/全部叠加显示。
- 使用缺少 `ptsets.parquet` 的模型包验证错误提示，不应回退到后端实时 ptset。
