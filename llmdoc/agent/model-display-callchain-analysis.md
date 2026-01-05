<!-- 模型显示完整调用链分析报告 -->

### Code Sections (The Evidence)

- `src/components/viewer.vue` (Viewer组件): 核心渲染组件，初始化xeokit-sdk场景，监听ptset可视化请求，处理模型加载和调试参数
- `src/aios-prepack-bundle-loader.ts` (loadAiosPrepackBundle): 模型加载器，支持API模式和bundle模式，创建SceneModel和LazyEntityManager
- `src/composables/usePtsetVisualization.ts` (usePtsetVisualization): ptset可视化composable，管理点集渲染、标签更新、相机追踪
- `src/composables/useDuckDBModelLoader.ts` (useDuckDBModelLoader): DuckDB数据加载器，支持远程数据库和Parquet文件查询
- `src/composables/useModelTree.ts` (useModelTree): 模型树管理，处理节点展开、选择、可见性控制
- `src/composables/useToolStore.ts` (useToolStore): 全局状态管理，存储ptset可视化请求、工具模式、测量数据
- `src/api/genModelPdmsAttrApi.ts` (pdmsGetPtset): API接口，从后端获取ptset点集数据
- `src/composables/useModelProjects.ts` (useModelProjects): 项目管理，处理项目切换和bundle URL

### Report (The Answers)

#### result

**1. 从用户操作到3D场景渲染的完整流程**

用户操作流程分为两个主要路径：

**路径A - 模型加载流程：**
1. 用户通过 `ModelProjectSelector` 选择项目 → `useModelProjects.switchProject()`
2. 触发 `modelProjectChanged` 自定义事件 → `viewer.vue` 监听并调用 `loadModel()`
3. 调用 `loadAiosPrepackBundle()` 加载模型数据 → 创建 `SceneModel` 和 `LazyEntityManager`
4. xeokit-sdk 渲染3D场景 → 自动飞行到模型视图

**路径B - Ptset可视化流程：**
1. 用户在模型树右键点击元件 → `ModelTreePanel.showPtset()`
2. 调用 `useToolStore.requestPtsetVisualization()` 设置请求状态
3. `viewer.vue` 的watch监听到请求 → 调用 `pdmsGetPtset()` API
4. API返回ptset数据 → 调用 `usePtsetVisualization.renderPtset()`
5. 创建绿色球体、橙色箭头、HTML标签 → 自动飞行到点集视图

**2. 模型数据加载机制**

系统支持三种数据加载机制：

**API模式（refnos参数）：**
- 通过 `/api/instances?refnos=xxx` 获取实例数据
- 使用 `HashInstancedManifest` 格式，支持按需加载GLB几何体
- `LazyEntityManager` 管理实体创建和可见性

**Bundle模式（manifest.json）：**
- 读取本地bundle目录的manifest.json和几何体文件
- 支持 `InstancedBundleManifest` 和 `HashInstancedManifest` 两种格式
- 可选择立即加载或延迟加载（lazyEntities选项）

**DuckDB模式：**
- 通过 `useDuckDBModelLoader` 连接远程DuckDB数据库
- 支持HTTP Range Requests虚拟化读取
- 可查询实例、几何体、空间数据

**3. xeokit-sdk的集成和使用方式**

**初始化：**
```typescript
viewer.value = new Viewer({
  canvasElement: mainCanvas.value!,
  transparent: false,
  saoEnabled: true
});
```

**场景配置：**
- Z-up坐标系（CAD/BIM标准）
- SAO（Scalable Ambient Obscurance）效果
- 边缘渲染和材质配置
- NavCubePlugin导航立方体

**模型创建：**
- `SceneModel` 管理几何体、网格、实体
- 支持LOD（Level of Detail）系统
- 延迟加载机制优化性能

**4. 模型树与3D场景的交互机制**

**双向数据绑定：**
- 模型树基于 `viewer.metaScene` 构建
- 节点可见性变化同步到场景对象
- 场景对象选择同步到模型树选中状态

**交互操作：**
- `setVisible()` 控制子树可见性
- `flyTo()` 飞行到指定节点
- `isolateXray()` X射线隔离显示
- `expandToRefno()` 展开并定位到指定refno

**5. 相关的状态管理和事件系统**

**全局状态（useToolStore）：**
- `ptsetVisualizationRequest`: ptset可视化请求队列
- `toolMode`: 当前工具模式（测量、批注等）
- `measurements/annotations`: 测量和批注数据
- 持久化到localStorage

**事件系统：**
- `modelProjectChanged`: 项目切换事件
- `metaModelCreated`: 元模型创建事件
- xeokit场景事件：`objectVisibility`、`modelLoaded`等
- 相机事件：`matrix` 变化监听标签位置更新

**跨组件通信：**
- 通过reactive ref实现状态共享
- 自定义事件解耦组件依赖
- Promise-based API调用

#### conclusions

- **分层架构**: 系统采用清晰的分层架构，UI层、状态管理层、数据加载层、渲染层职责分明
- **多数据源支持**: 支持API、Bundle、DuckDB三种数据源，适应不同使用场景
- **性能优化**: 通过延迟加载、LOD系统、虚拟化读取等技术优化大数据量场景性能
- **交互体验**: 实现了丰富的3D交互功能，包括飞行、选择、隔离、测量等
- **状态同步**: 模型树与3D场景保持实时同步，提供一致的用户体验

#### relations

- `viewer.vue` 依赖 `loadAiosPrepackBundle` 加载模型，依赖 `usePtsetVisualization` 处理点集可视化
- `useToolStore` 作为全局状态中心，被多个组件共享使用
- `useModelTree` 基于 `viewer.metaScene` 构建树形结构，通过 `viewer.scene` 控制对象可见性
- `aios-prepack-bundle-loader` 创建 `LazyEntityManager`，管理按需实体创建
- `useDuckDBModelLoader` 提供独立的数据查询能力，可与其他加载器配合使用
- `ModelTreePanel` 通过 `useToolStore.requestPtsetVisualization()` 触发点集显示
- 相机事件通过 `requestAnimationFrame` 优化标签位置更新性能