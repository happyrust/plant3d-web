# 按区域动态 Frustum Culling 移植评估与计划

## 1. 构思方案（Thought）

### 1.1 目标与范围
- 目标：从 `doc/xeokit-sdk.es.js` 移植/复用 frustum culling + k-d tree 思路，实现“按区域”动态视锥裁剪，降低渲染开销。
- 范围：DTX 渲染路径（对象可见性由 DataTexture 控制），不改动 Three.js 默认 frustumCulled 机制。

### 1.2 现状分析（关键事实）
- xeokit 里已有 `ObjectsKdTree3`，按场景 AABB 建树，模型增删触发重建（`doc/xeokit-sdk.es.js:7828`）。
- 项目已移植 `ObjectsKdTree`，包含 AABB 构建与 `queryFrustum` 逻辑（`src/utils/three/dtx/selection/ObjectsKdTree.ts:1`）。
- DTXLayer 明确禁用三维网格默认裁剪：`_mesh.frustumCulled = false`（`src/utils/three/dtx/DTXLayer.ts:1082`）。
- DTXLayer 提供批量可见性更新接口：`setObjectsVisible`/`setAllVisible`（`src/utils/three/dtx/DTXLayer.ts:1427`）。
- 视图渲染循环已计算相机变化（`cameraChanged`），适合挂接裁剪更新（`src/components/dock_panels/ViewerPanel.vue:417`）。
- DTXSelectionController 已使用 `ObjectsKdTree` 做射线候选集加速（`src/utils/three/dtx/selection/DTXSelectionController.ts:41`）。

### 1.3 设计概览（按区域动态裁剪）
- 区域定义：按空间树划分（对场景 AABB 进行 k-d tree 递归切分），每个区域持有 AABB 与对象集合。
- 空间索引：
  - 采用 xeokit 的空间树思路：节点 AABB 固定为切分子空间，对象仅在“完全包含”的子节点下沉，否则留在当前节点。
  - 本次只做“区域级”裁剪，不做对象级二级裁剪。
- 运行时流程：
  1) 相机变化 → 计算 frustum。
  2) 使用区域 k-d tree 查询与 frustum 相交的区域。
  3) 根据区域→对象映射批量更新可见性（diff 更新）。
- 更新节流：只在相机变化时触发，必要时加时间阈值（如 50~100ms）避免高频更新。

## 2. 提请审核

### 2.1 已确认决策
1) 区域定义：按空间树划分（与 xeokit 一致）。
2) 裁剪粒度：区域级。
3) 可见性优先级：用户隐藏/隔离 > frustum 裁剪。
4) 性能目标：30 FPS 内可接受的裁剪开销。
5) 需要调试开关与可视化/统计支持。

### 2.2 待确认问题
无。

### 2.3 当前假设（未确认）
- 区域 AABB 由对象 AABB 聚合得到（若后端提供区域 AABB 可直接复用）。

## 3. 分解为具体任务

### Implementation Plan（中文）
1) 定义区域数据结构：`RegionIndex`（regionId、aabb、objectIds、child/parent）。
2) 构建空间树（xeokit 思路）：
   - 以场景 AABB 为根节点，按最长轴二分。
   - 对象 AABB “完全包含”则下沉，否则留在当前节点。
   - 达到深度上限或对象数阈值时作为区域节点（叶子）。
3) 生成区域列表：从叶子节点抽取 `regionId + aabb + objectIds`。
4) 实现 `DtxRegionFrustumCuller`：
   - 输入 camera → 计算 frustum。
   - 遍历空间树节点做区域级相交测试，得到可见区域集合。
   - 根据 diff 更新 `setObjectsVisible`（避免全量重置）。
   - 与用户隐藏/隔离状态合并：最终可见性 = 用户可见 && frustum 可见。
5) 接入渲染循环：在 `ViewerPanel` 的 `cameraChanged` 分支中触发裁剪更新。
6) 处理模型更新：模型/区域变动时标记索引 dirty，异步重建。
7) 调试与统计：输出可见区域数量、对象数量、耗时；可选区域 AABB 可视化。

### Task List（中文）
- [x] 确认区域定义与裁剪粒度（空间树划分 + 区域级）。
- [ ] 新增区域索引与 AABB 生成逻辑。
- [ ] 实现空间树构建（xeokit 插入规则）。
- [ ] 区域级 frustum 查询与 diff 可见性更新。
- [ ] 新增裁剪控制器并接入 `ViewerPanel` 渲染循环。
- [ ] 批量可见性 diff 更新与节流策略。
- [ ] 与用户隐藏/隔离状态合并（优先级）。
- [ ] 补充调试开关、性能统计与可视化。
- [ ] 验证：相机移动、区域切换、隐藏/隔离互斥逻辑。
