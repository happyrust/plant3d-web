# SolveSpace 3D 尺寸标注：数据流与交互链路说明

日期：2026-02-06

本文档目的：
- 固化“尺寸标注统一走 SolveSpace 移植绘制”的工程约定
- 让后续维护者快速定位：数据从哪里来、在哪里转换、在哪里画、在哪里交互写回

范围（Scope）：
- **尺寸标注（dimensions）**：线性尺寸、角度尺寸，以及 MBD 管道输出的 `dims`
- **非范围**：测量（measurement）当前仍采用 DOM overlay（不强制统一为 3D 尺寸标注）

---

## 1. 核心约定（必须遵守）

1) “尺寸标注绘制”的唯一实现为：
- `src/utils/three/annotation/annotations/LinearDimension3D.ts`
- `src/utils/three/annotation/annotations/AngleDimension3D.ts`

2) 用户创建的尺寸，**唯一真源**为：
- `src/composables/useToolStore.ts` 中的 `store.dimensions`

3) Viewer 层只做两件事：
- 负责把 `store.dimensions` 同步到 3D 标注对象（创建/更新/删除）
- 负责把交互（拖拽、双击编辑等）写回 `store.dimensions`

4) 尺寸偏移方向（offsetDir）的“面向相机”策略统一为 helper：
- 世界空间：`src/utils/three/annotation/utils/computeDimensionOffsetDir.ts`
- local->world 挂载（MBD 用）：`src/utils/three/annotation/utils/computeDimensionOffsetDirInLocal.ts`

---

## 2. 术语与坐标系

### 2.1 两套常见坐标系

- **local（后端原始坐标）**
  - MBD dims 点位：`MbdDimDto.start/end`
  - 通常单位是 mm（由后端/模型导出决定）

- **world（Three.js 场景世界坐标）**
  - 相机 `camera.position`、raycaster、屏幕交互等均在 world 语义下工作

### 2.2 globalModelMatrix

Viewer 中通过 `globalModelMatrix` 统一处理：
- 单位归一化（例如 mm -> m）
- 重心/原点重定位（recenter）

因此常见结构为：
- 标注对象本身使用 local 坐标（与后端数据一致）
- 标注容器 `group.matrix = globalModelMatrix`，把 local 挂到 world

---

## 3. 用户尺寸标注（store.dimensions）链路

### 3.1 数据流（从输入到绘制）

```text
[ViewerPanel.vue]
  Ribbon 命令：dimension.linear / dimension.angle
        |
        v
[useToolStore.ts]
  store.toolMode = 'dimension_linear' | 'dimension_angle'
        |
        v
[useDtxTools.ts]
  canvas pointer 事件收集点位（pickSurfacePoint）
  - dimensionPoints 收集
  - updateDimensionPreview 画 dim_preview（LinearDimension3D/AngleDimension3D）
  - 完成后 store.addDimension(...)
        |
        v
[ViewerPanel.vue]
  DimensionAnnotationManager.sync(store.dimensions)
  - 创建/更新 LinearDimension3D / AngleDimension3D
  - 设置 userData.pickable=true / draggable=true
        |
        v
[useAnnotationThree.ts]
  annotationSystem.update(camera) + renderLabels(...)
```

关键文件：
- 输入与 preview：`src/composables/useDtxTools.ts`
- 真源数据结构：`src/composables/useToolStore.ts`（`DimensionRecord`）
- 同步管理器：`src/composables/useDimensionAnnotation.ts`（`DimensionAnnotationManager`）
- 标注系统：`src/composables/useAnnotationThree.ts`

### 3.2 交互链路（从拖拽到写回）

```text
[AnnotationInteractionController.ts]
  hover/click/select/drag 事件
        |
        v
[ViewerPanel.vue]
  annotationSystem.onInteraction((ev) => { ... })
  - select/deselect -> store.activeDimensionId
  - 双击文字(label) -> store.pendingDimensionEditId + 打开 DimensionPanel
  - drag:
      role=offset -> store.updateDimension({ offset, direction })
      role=label  -> store.updateDimension({ labelT })
        |
        v
[DimensionAnnotationManager]
  watch(store.dimensions, deep) -> setParams(...) 重建几何
```

关键文件：
- 交互控制器：`src/utils/three/annotation/interaction/AnnotationInteractionController.ts`
- Viewer 写回逻辑：`src/components/dock_panels/ViewerPanel.vue`

### 3.3 offsetDir 计算统一点

此前 `ViewerPanel.vue` 与 `useDtxTools.ts` 各自实现了 `computeDimensionOffsetDirectionByCamera(...)`。
现在它们都内部转调到统一 helper：
- `computeDimensionOffsetDir(startW, endW, cameraW)`

目标：
- preview 与落盘创建时方向一致
- 拖拽过程中按相机重算方向时一致

---

## 4. MBD 管道标注（后端 dims）链路

### 4.1 数据流（从 API 到绘制）

```text
[ViewerPanel.vue]
  getMbdPipeAnnotations(refno, params)
        |
        v
[src/api/mbdPipeApi.ts]
  GET /api/mbd/pipe/{refno} -> MbdPipeData
        |
        v
[useMbdPipeAnnotationThree.ts]
  renderBranch(data):
    group.matrix = globalModelMatrix
    renderDims(data.dims) -> LinearDimension3D
    renderWelds(data.welds) -> WeldAnnotation3D
    renderSlopes(data.slopes) -> SlopeAnnotation3D
    renderSegments(data.segments) -> Line（骨架）
```

关键文件：
- API：`src/api/mbdPipeApi.ts`
- 渲染与管理：`src/composables/useMbdPipeAnnotationThree.ts`

### 4.2 方向与 offset 的特殊性（local vs world）

MBD dims 的点位是 local，而相机在 world：
- 若直接用 local 点去做“面向相机”计算，结果会错（尤其在有旋转/缩放/平移的 globalModelMatrix 下）。

因此 MBD dims 的 direction 计算采用：
- `computeDimensionOffsetDirInLocal(startLocal, endLocal, cameraWorld, globalModelMatrix)`

其逻辑为：
1) local 点位先用矩阵变换到 world
2) 在 world 空间用 `computeDimensionOffsetDir(...)` 得到 worldDir
3) 将 worldDir 用 `inv(M3)` 逆回 localDir，作为 `LinearDimension3D.direction`

### 4.3 MBD dims offset 策略

MBD dims 的 offset 不再写死常量，统一为“随长度变化 + clamp”的简单策略：
- `src/composables/mbd/computeMbdDimOffset.ts`

当前实现（可按 UI 反馈迭代）：
- `offset = clamp(distance * 0.15, 50, 500)`（distance 与点位同一坐标空间）

---

## 5. 清理项（方案B 的一致性）

MBD 方案B 已不再创建 DOM label，因此旧 `.mbd-label*` 样式已删除：
- `src/assets/main.scss`

若未来重新引入 DOM label（不推荐），必须补充：
- 明确是否与 3D text 共存
- 避免同屏存在两套表现导致困惑

---

## 6. 回归与验证

已跑通的验证命令：
- 单测：`npm test`
- 类型：`npm run type-check`
- 构建：`npm run build-only`
- E2E：`npm run test:e2e`

注意：
- e2e 期间若后端未启动，Vite proxy 可能出现 `/api/e3d/world-root` 的 `ECONNREFUSED` 日志；只要用例不依赖该接口，属于可接受噪声。

