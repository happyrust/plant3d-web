# ptset 显示与测量捕捉同源设计

> **日期**：2026-06-08
> **状态**：已实现，待评审
> **范围**：ptset 正式显示、BRAN 子元件点集检查、测量 hover 捕捉的快照一致性

---

## 1. 一句话定位

把“右键显示 ptset”“BRAN 子元件点集检查”和“测量 hover 捕捉 ptset”统一到当前加载模型包的 parquet 快照，避免后端实时 ptset 与前端模型快照不一致导致的点位错位。

---

## 2. 背景

当前 viewer 已经通过 parquet 模型包加载 DTX 几何、实例矩阵和测量 hover 所需的 ptset 候选点。但正式 ptset 显示链路仍有历史路径：

- `ViewerPanel.vue` 监听 `ptsetVisualizationRequest` 后调用 `/api/pdms/ptset/:refno`。
- `PtsetPanelDock.vue` 的 BRAN 子元件检查调用 `e3dGetChildren()` 和 `/api/pdms/ptset/batch-query`。
- `useXeokitMeasurementTools.ts` 的 hover 捕捉调用 `queryPtsetByRefnoFromParquet()`。

这意味着用户看到的绿色十字/标签，和测量实际吸附的关键点，可能来自不同数据源。

---

## 3. 问题定义

### 3.1 失败模式

| 模式 | 描述 | 用户影响 |
|---|---|---|
| 数据源分裂 | 正式显示走后端实时接口，测量捕捉走 parquet 快照 | 看见的 ptset 与可吸附点不一致 |
| 快照漂移 | 模型包已更新，但后端 `/api/pdms/ptset` 返回另一个版本的数据 | 点位、方向箭头、标签坐标可能偏移 |
| BRAN 列表漂移 | 子元件列表来自后端实时接口，不一定等于当前模型快照内的实例集合 | 面板列出当前模型没有的子元件，或漏列快照内子元件 |
| 坐标链路重复 | 渲染器和吸附工具各自维护一份 ptset transform 逻辑 | 后续修改一边时产生隐性回归 |

### 3.2 期望

同一 viewer 会话内，所有 ptset 显示、列表、测量捕捉都以当前模型包中的 parquet 数据为事实源。

---

## 4. 目标

1. 正式 ptset 显示不再调用 `/api/pdms/ptset/:refno`，改用 `queryPtsetByRefnoFromParquet(dbno, refno)`。
2. BRAN 子元件点集检查不再调用 `/api/pdms/ptset/batch-query`，改用 parquet 的 `instances.parquet + ptsets.parquet`。
3. 子元件列表以 `instances.parquet.owner_refno_str` 为来源，保证和当前模型快照一致。
4. 渲染器复用共享 ptset 坐标变换工具，和测量吸附保持同一条坐标链。
5. 当模型包缺少 `ptsets.parquet` 时，不静默回退后端实时接口，而是明确提示当前模型包不支持 ptset。

---

## 5. 非目标

- 不修改后端 `/api/pdms/ptset` 接口；它可以继续作为其他调用方或调试接口存在。
- 不引入新的 ptset 数据格式；继续使用现有 parquet manifest 中的 `ptsets` 表声明。
- 不改变测量工具“必须捕捉 ptset 关键点”的业务规则。
- 不改变点集视觉样式：绿色十字、橙色方向箭头、HTML 坐标标签仍保持现有样式。

---

## 6. 设计方案

### 6.1 数据源统一

正式显示入口：

```
ModelTreePanel.showPtset()
  → toolStore.requestPtsetVisualization(refno)
  → ViewerPanel watch(ptsetVisualizationRequest)
  → queryPtsetByRefnoFromParquet(dbno, refno)
  → usePtsetVisualizationThree.renderPtset()
```

测量 hover 入口保持现状：

```
useXeokitMeasurementTools.scheduleHoverPtsetFetch()
  → queryPtsetByRefnoFromParquet(dbno, refno)
  → usePtsetSnap.upsertCandidates()
  → usePtsetVisualizationThree.renderPtset()  // 仅显示十字
```

BRAN 子元件检查：

```
PtsetPanelDock.contextRefno
  → queryDirectChildrenPtsetSummary(dbno, ownerRefno)
  → 面板展示直子元件 ptset 摘要
  → 用户选择单个或全部成功项
  → queryPtsetByRefnoFromParquet(dbno, childRefno)
  → renderPtset()/appendPtset()
```

### 6.2 新增 loader 能力

`useDbnoInstancesParquetLoader()` 新增：

```ts
type ParquetPtsetChildSummary = {
  refno: string;
  noun: string;
  name: string;
  success: boolean;
  ptCount: number;
  errorMessage: string | null;
};

async function queryDirectChildrenPtsetSummary(
  dbno: number,
  ownerRefno: string,
  options?: { forceRefresh?: boolean },
): Promise<ParquetPtsetChildSummary[]>;
```

查询逻辑：

- 从 `instances.parquet` 按 `owner_refno_str = ownerRefno` 查询直子元件。
- 如果 manifest 声明了 `ptsets` 表，则按 `cata_hash` 聚合 `ptsets.parquet` 点数。
- 如果缺少 `ptsets.parquet`，仍返回子元件列表，但全部标记为 `success: false`，错误为“当前模型包未包含 ptsets.parquet，ptset 不可用”。

### 6.3 坐标链路

统一链路：

```
ptset local point
  → * unit_info.conversion_factor
  → apply world_transform / DTX refno transform
  → apply DTXLayer.globalModelMatrix
  → scene coordinate
```

约束：

- 渲染点位和测量吸附候选必须走同一条换算语义。
- 方向向量只应用旋转/缩放，不应用平移。
- 标签投影使用已经应用 `globalModelMatrix` 的 scene coordinate。

---

## 7. UI 行为

### 7.1 右键显示单个构件

- 成功：显示点集、自动飞到点集视图、toast “已显示 N 个连接点”。
- 失败：显示 parquet loader 返回的错误，不回退后端实时接口。

### 7.2 BRAN / 容器构件

- 父构件自身没有 ptset 时，面板仍保持打开。
- 面板展示直子元件检查结果：
  - 成功项显示点数。
  - 失败项显示无 ptset 或具体错误。
- 用户可选择单个成功项绘制，也可叠加显示全部成功项。

### 7.3 可见性开关

保持现有控制：

- 整体显示/隐藏。
- 十字点显示/隐藏。
- 坐标标签显示/隐藏。
- 方向箭头显示/隐藏。
- 飞到点集视图。

---

## 8. 验收标准

1. 右键任意 refno 显示 ptset 时，网络层不再调用 `/api/pdms/ptset/:refno`。
2. 测量 hover 捕捉点与正式显示的绿色十字位置一致。
3. BRAN 子元件列表来自当前 parquet 快照，不依赖 `e3dGetChildren()`。
4. 缺少 `ptsets.parquet` 时，UI 明确提示不可用，不静默回退到后端。
5. 单元测试覆盖：
   - parquet 直子元件 ptset 摘要成功/失败项。
   - 缺少 `ptsets.parquet` 时的摘要降级。
   - ptset 坐标换算链路。
6. `npm run type-check` 通过。

---

## 9. 已覆盖测试

```bash
npx vitest run \
  src/composables/useDbnoInstancesParquetLoader.test.ts \
  src/utils/three/ptsetTransform.test.ts

npm run type-check
```

当前结果：

- `useDbnoInstancesParquetLoader.test.ts`：13 tests passed
- `ptsetTransform.test.ts`：2 tests passed
- `vue-tsc --noEmit`：passed

---

## 10. 关键文件

| 文件 | 作用 |
|---|---|
| `src/composables/useDbnoInstancesParquetLoader.ts` | parquet ptset 查询与直子元件摘要 |
| `src/components/dock_panels/ViewerPanel.vue` | 右键正式显示入口 |
| `src/components/dock_panels/PtsetPanelDock.vue` | BRAN 子元件 ptset 面板 |
| `src/composables/usePtsetVisualizationThree.ts` | Three 叠加渲染器 |
| `src/utils/three/ptsetTransform.ts` | 共享 ptset 坐标变换 |
| `src/composables/useXeokitMeasurementTools.ts` | 测量 hover 捕捉调用方 |
| `src/composables/usePtsetSnap.ts` | ptset 吸附候选与屏幕距离判断 |
