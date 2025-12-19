# Architecture of Ptset Visualization System

## 1. Identity

- **What it is:** 跨 API、状态管理、可视化渲染的 ptset 数据加载和显示系统。
- **Purpose:** 从后端获取元件连接点数据并在 3D 场景中进行交互式可视化呈现。

## 2. Core Components

- `src/api/genModelPdmsAttrApi.ts` (PtsetPoint, PtsetResponse, pdmsGetPtset): 定义 ptset 数据类型和 REST API 调用函数，从后端 `/api/pdms/ptset/{refno}` 端点获取点集数据。

- `src/composables/usePtsetVisualization.ts` (usePtsetVisualization, generateSphereGeometry, generateArrowLines): 核心可视化 composable，管理点集对象渲染、清理、可见性控制、相机跟踪标签位置。

- `src/composables/useToolStore.ts` (PtsetVisualizationRequest, requestPtsetVisualization, clearPtsetVisualizationRequest): 跨组件通信的请求队列，用于将右键菜单操作传递给 viewer 组件。

- `src/components/viewer.vue` (ptset visualization watch): 监听 ptset 可视化请求，调用 API 获取数据，触发渲染和飞行到视图。

- `src/components/model-tree/ModelTreePanel.vue` (showPtset, context menu): 在右键菜单中提供"显示点集"选项，调用 toolStore.requestPtsetVisualization。

- `src/assets/main.scss` (.ptset-label, .ptset-label-content, etc.): 点集标签的 CSS 样式，定义黑色背景、绿色点号、灰色坐标、黄色外径的显示样式。

## 3. Execution Flow (LLM Retrieval Map)

### 初始化阶段

1. **Viewer 组件启动:** `src/components/viewer.vue:50` - 初始化 `usePtsetVisualization` composable，传递 viewer 和 overlay 容器引用。

2. **状态管理初始化:** `src/composables/useToolStore.ts:241` - 创建 `ptsetVisualizationRequest` ref，初始值为 null。

### 用户交互流程

3. **右键菜单触发:** 用户在模型树中右键点击一个元件，菜单显示"显示点集"按钮 `src/components/model-tree/ModelTreePanel.vue:656`。

4. **请求入队:** 点击"显示点集"调用 `src/components/model-tree/ModelTreePanel.vue:442-449` 中的 `showPtset()` 函数，验证 refno 格式后调用 `toolStore.requestPtsetVisualization(contextNodeId.value)`。

5. **状态更新:** `src/composables/useToolStore.ts:714-716` - `requestPtsetVisualization()` 将请求对象 `{ refno, timestamp }` 设置到 reactive ref。

### 数据加载流程

6. **请求监听:** `src/components/viewer.vue:57-79` - watch 监听 `store.ptsetVisualizationRequest`，触发 ptset 数据加载。

7. **API 调用:** `src/api/genModelPdmsAttrApi.ts:79-81` - 调用 `pdmsGetPtset(refno)` 从后端获取点集数据，返回 `PtsetResponse` 类型（包含 ptset 数组和 world_transform 矩阵）。

8. **渲染请求:** `src/components/viewer.vue:64-68` - API 成功后调用 `ptsetVis.renderPtset(refno, response)` 和 `ptsetVis.flyToPtset()`。

### 渲染执行流程

9. **清理旧对象:** `src/composables/usePtsetVisualization.ts:189-204` - `renderPtset()` 首先调用 `clearAll()` 清除之前渲染的所有点集对象。

10. **遍历点集:** `src/composables/usePtsetVisualization.ts:227-261` - 对每个 `PtsetPoint`：
    - 应用世界坐标变换矩阵（如果存在）到点位置和方向向量
    - 计算变换后的世界坐标

11. **球体创建:** `src/composables/usePtsetVisualization.ts:263-300` - 对每个连接点：
    - 调用 `generateSphereGeometry()` 生成球体网格（16 段细分）
    - 创建 `ReadableGeometry` 和 PhongMaterial（绿色 #2ecc71）
    - 创建 `Mesh` 对象放置在世界坐标位置

12. **箭头创建:** `src/composables/usePtsetVisualization.ts:304-321` - 如果方向向量存在：
    - 调用 `generateArrowLines()` 生成箭头线段数据
    - 创建 `LineSet` 渲染橙色方向箭头

13. **标签创建:** `src/composables/usePtsetVisualization.ts:323-342` - 为每个点创建 HTML div 标签：
    - 包含点号、坐标、管道外径信息
    - 应用 CSS 类名：`ptset-label`、`ptset-label-content` 等
    - 初始不可见（opacity: 0）

14. **对象追踪:** `src/composables/usePtsetVisualization.ts:345-355` - 将所有创建的对象（mesh、geometry、material、arrow、label）存储在 `visualObjects` Map 中。

15. **标签位置更新:** `src/composables/usePtsetVisualization.ts:360` - 调用 `updateLabelPositions()` 将 3D 世界坐标投影到屏幕坐标。

### 相机追踪流程

16. **投影计算:** `src/composables/usePtsetVisualization.ts:366-390` - `updateLabelPositions()` 对每个点：
    - 调用 xeokit 相机的 `projectWorldPos()` 方法投影 3D 点到屏幕 2D 坐标
    - 更新标签的 left/top CSS 属性
    - 设置标签 opacity: 1

17. **相机事件监听:** `src/composables/usePtsetVisualization.ts:466-482` - 注册 viewer 相机的 'matrix' 事件监听器，通过 `requestAnimationFrame` 实时更新标签位置。

### 飞行到视图流程

18. **包围盒计算:** `src/composables/usePtsetVisualization.ts:418-449` - `flyToPtset()` 计算所有点的 AABB 包围盒，添加 10% padding。

19. **相机飞行:** `src/composables/usePtsetVisualization.ts:451-455` - 调用 `viewer.cameraFlight.flyTo()` 以 0.8 秒动画飞行到包围盒视图。

### 请求清理

20. **请求重置:** `src/components/viewer.vue:77` - ptset 数据加载完成后调用 `store.clearPtsetVisualizationRequest()` 将请求重置为 null。

## 4. Design Rationale

**状态管理分离:** PtsetVisualizationRequest 在 useToolStore 中管理，使右键菜单（ModelTreePanel）与 Viewer 组件解耦，通过 reactive 状态实现跨组件通信。

**世界坐标变换:** 后端返回的 world_transform 4x4 矩阵支持元件的位置和旋转变换，确保点集在复杂装配体中的正确显示。

**球体几何生成:** 在客户端生成球体网格而非从服务器获取，减少数据传输并支持动态调整球体大小。

**实时标签追踪:** 通过相机 'matrix' 事件监听和 RAF 防抖实现标签的高效投影更新，避免每帧都计算。

**清理机制:** 每次渲染前自动清除旧对象，模型加载时清除 ptset 可视化，防止内存泄漏。
