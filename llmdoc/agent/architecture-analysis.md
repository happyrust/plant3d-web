<!-- Investigation Report: Plant3D Web - Complete Architecture Analysis -->

### Code Sections (The Evidence)

#### 核心框架和入口点
- `src/main.ts`: Vue 3 应用入口，注册所有面板组件（ViewerPanel、ModelTreePanel、MeasurementPanel 等），挂载 vuetify UI 框架
- `src/App.vue`: 应用根组件，包含 DockLayout 布局管理器
- `src/components/DockLayout.vue`: Dockview 布局管理器，使用 localStorage 存储面板位置，支持默认布局恢复

#### 3D 查看器和渲染核心
- `src/components/viewer.vue`: 主 3D 查看器组件，初始化 xeokit Viewer，管理模型加载、相机控制、观察工具
- `src/composables/useXeokitTools.ts`: xeokit 工具集 composable，集成距离/角度测量、文字/云线/矩形/OBB 批注、高亮选择
- `src/composables/usePtsetVisualization.ts`: 连接点可视化 composable，渲染球体、箭头和标签，相机实时追踪

#### 状态管理系统
- `src/composables/useToolStore.ts`: 中央工具状态存储，管理五种批注类型（Text、Cloud、Rect、OBB）、测量记录、活跃工具模式、持久化版本管理（V1/V2/V3）
- `src/composables/useSelectionStore.ts`: 元件选择状态，管理选中 refno、属性数据加载和错误状态
- `src/composables/useReviewStore.ts`: 审核流程状态存储（未在此阅读，但在调查报告中引用）
- `src/composables/useUserStore.ts`: 用户认证和权限状态（未在此阅读，但在 DockLayout 中使用）

#### 后端 API 接口层
- `src/api/genModelE3dApi.ts`: E3D 树形结构 API 调用函数（e3dGetWorldRoot、e3dGetNode、e3dGetChildren、e3dGetSubtreeRefnos、e3dSearch）
- `src/api/genModelPdmsAttrApi.ts`: PDMS 属性和点集 API 调用函数（pdmsGetUiAttr、pdmsGetPtset），定义 PtsetPoint、PtsetResponse 数据类型
- `src/api/genModelRoomTreeApi.ts`: 房间树 API 调用函数（可能在模型树中使用）
- `src/api/genModelSpatialApi.ts`: 空间查询 API 调用函数（可能用于空间分析）

#### 类型定义系统
- `src/types/auth.ts`: 用户角色枚举（ADMIN、MANAGER、REVIEWER、PROOFREADER、DESIGNER、VIEWER）、User 类型、ReviewTask 类型、AnnotationComment 评论类型、角色检查函数
- `src/types/spec.ts`: 其他类型定义（未详细阅读）

#### 组件层 - 主面板
- `src/components/dock_panels/ViewerPanel.vue`: 3D 查看器外壳面板
- `src/components/dock_panels/ModelTreePanelDock.vue`: 模型树面板容器
- `src/components/dock_panels/AnnotationPanelDock.vue`: 批注管理面板容器
- `src/components/dock_panels/MeasurementPanelDock.vue`: 测量数据面板容器
- `src/components/dock_panels/ReviewPanelDock.vue`: 审核面板容器
- `src/components/dock_panels/ReviewerTaskListPanelDock.vue`: 审核任务列表面板
- `src/components/dock_panels/PropertiesPanelDock.vue`: 对象属性面板
- `src/components/dock_panels/ManagerPanelDock.vue`: 管理工具面板
- `src/components/dock_panels/HydraulicPanelDock.vue`: 液压系统分析面板

#### 组件层 - 功能组件
- `src/components/tools/AnnotationPanel.vue`: 批注编辑和管理界面，支持标题/描述编辑、对象高亮、创建后编辑对话
- `src/components/tools/MeasurementPanel.vue`: 测量结果显示和管理
- `src/components/tools/ToolManagerPanel.vue`: 工具模式选择和切换
- `src/components/tools/HydraulicPanel.vue`: 液压功能（特定领域）
- `src/components/tools/PtsetPanel.vue`: 连接点可视化控制面板（新建）
- `src/components/model-tree/ModelTreePanel.vue`: 模型树展示、搜索、右键菜单（包含"显示点集"选项）
- `src/components/model-tree/ModelTreeRow.vue`: 树节点行渲染组件
- `src/components/review/ReviewPanel.vue`: 审核工作流界面
- `src/components/review/ReviewConfirmation.vue`: 审核确认对话
- `src/components/review/InitiateReviewPanel.vue`: 启动审核界面
- `src/components/review/ReviewerTaskList.vue`: 审核任务列表
- `src/components/model-project/ModelProjectSelector.vue`: 项目选择器
- `src/components/model-query/ModelQueryPanel.vue`: 模型查询面板

#### 工具和服务
- `src/composables/useModelTree.ts`: 树形结构管理 composable
- `src/composables/useModelProjects.ts`: 项目管理 composable
- `src/composables/usePdmsOwnerTree.ts`: PDMS 所有权树 composable
- `src/composables/useRoomTree.ts`: 房间树 composable
- `src/composables/useDockApi.ts`: Dockview API 访问 composable
- `src/composables/useViewerContext.ts`: 全局 viewer 上下文 composable，提供 viewer、tools、store 全局访问
- `src/ribbon/commandBus.ts`: 命令事件总线，实现跨组件命令触发（onCommand、emitCommand）
- `src/ribbon/toastBus.ts`: 吐司通知事件总线（emitToast）
- `src/ribbon/ribbonConfig.ts`: 功能区配置
- `src/ribbon/ribbonTypes.ts`: 功能区类型定义
- `src/ribbon/ribbonIcons.ts`: 功能区图标资源
- `src/components/ribbon/RibbonBar.vue`: 功能区条组件

#### 样式和资源
- `src/assets/main.scss`: 全局样式，包含批注标签样式、ptset 标签样式
- `src/assets/tailwind.css`: Tailwind CSS 样式
- `src/lib/utils.ts`: 通用工具函数
- `src/lib/pdmsTypeIcon.ts`: PDMS 类型图标映射
- `src/plugins/vuetify.ts`: Vuetify 框架配置

#### 模型加载
- `src/aios-prepack-bundle-loader.ts`: AIOS 预打包模型加载器，支持 LOD、层级结构、边线渲染、懒加载

---

### Report (The Answers)

#### result

##### 1. 项目架构的分层模型

Plant3D Web 项目采用标准的 Vue 3 + TypeScript 前端架构，分为 5 层：

**第1层 - 应用入口层（src/main.ts）**
- 创建 Vue 3 应用实例
- 注册全局组件（11 个 dock 面板组件）
- 集成 vuetify UI 框架

**第2层 - 布局管理层（src/components/DockLayout.vue）**
- 使用 dockview-vue 库实现可停靠面板布局
- 管理面板的显示/隐藏、位置调整、尺寸变化
- 支持布局持久化和恢复

**第3层 - 功能组件层（src/components/**）**
- 11 个 dock 面板组件（ViewerPanel、ModelTreePanel 等）
- 功能组件（AnnotationPanel、MeasurementPanel、RibbonBar 等）
- UI 基础组件（Input、Badge、ScrollArea 等）

**第4层 - 状态管理层（src/composables/**）**
- useToolStore：中央数据存储（批注、测量、工具模式）
- useSelectionStore：选择和属性状态
- useReviewStore：审核流程状态
- useXeokitTools：xeokit 交互工具
- usePtsetVisualization：连接点可视化
- useViewerContext：全局上下文

**第5层 - API 和基础设施层**
- API 函数层：genModelE3dApi、genModelPdmsAttrApi 等
- 类型定义：auth.ts、spec.ts
- 工具函数：commandBus、toastBus、utils
- 模型加载：aios-prepack-bundle-loader

##### 2. 模块化组织方式

项目按功能域划分文件：

```
src/
  api/               - 后端 API 调用接口 (4 个模块)
  components/
    dock_panels/    - 可停靠面板组件 (11 个)
    tools/          - 工具实现组件 (7 个)
    model-tree/     - 树形结构组件 (2 个)
    review/         - 审核流程组件 (4 个)
    model-project/  - 项目选择组件
    model-query/    - 模型查询组件
    ribbon/         - 功能区条组件
    ui/             - 基础 UI 组件 (3 个)
    user/           - 用户组件
  composables/      - 业务逻辑 composables (12 个)
  types/            - TypeScript 类型定义
  lib/              - 通用工具函数
  plugins/          - Vue 插件配置
  ribbon/           - 功能区相关模块
  assets/           - 样式和图片资源
```

##### 3. 状态管理模式（Vue Composables）

采用 Vue 3 composition API + reactive refs 模式：

**useToolStore（中央存储）**
- 使用 ref 存储响应式状态（measurements、annotations、obbAnnotations 等）
- 版本化持久化系统：V1/V2/V3 格式支持向后兼容
- 深层 watch 监听自动保存到 localStorage
- 导出 getter/setter 函数（addAnnotation、updateAnnotation、removeAnnotation 等）
- 四种批注类型独立管理生命周期

**useSelectionStore**
- selectedRefno：当前选中元件
- propertiesLoading、propertiesError、propertiesData：属性查询状态
- loadProperties 函数：异步加载对象属性
- 防止重复请求的 loadSeq 机制

**useReviewStore（未详细查看）**
- 管理审核流程状态
- ConfirmedRecord 数据结构存储审核快照

**useXeokitTools**
- 绑定到 Viewer 和 store
- 实现所有 xeokit 交互工具（测量、批注、选择）
- 事件处理和几何计算

##### 4. 与后端的数据交互方式

**API 调用模式**
- 环境配置：通过 VITE_GEN_MODEL_API_BASE_URL 环境变量指定 API 基础 URL
- 统一的 fetchJson 包装函数处理 HTTP 请求
- 请求中附带 Content-Type: application/json 头
- 错误处理：HTTP 错误状态返回错误信息

**数据流向**
```
用户交互
  → 组件触发事件
  → 调用 composable 函数
  → composable 调用 API 函数
  → API 函数执行 fetch 请求
  → 响应数据映射到类型
  → store 更新 reactive state
  → watch 监听自动保存到 localStorage
  → 组件响应式更新视图
```

**具体例子：Ptset 可视化流程**
1. ModelTreePanel 右键菜单触发 showPtset()
2. 调用 store.requestPtsetVisualization(refno)
3. viewer.vue 监听请求，调用 pdmsGetPtset(refno) API
4. API 返回 PtsetResponse（包含 ptset 数组和 world_transform 矩阵）
5. usePtsetVisualization.renderPtset() 处理数据，生成 3D 对象
6. 调用 store.clearPtsetVisualizationRequest() 清理请求

##### 5. UI 框架和样式方案

**UI 框架**
- Vuetify 3：Material Design 组件库，提供按钮、对话框、菜单等组件
- dockview-vue：可停靠面板布局库，支持拖拽、分割、弹出窗口

**样式方案**
- Tailwind CSS：工具类方式编写样式
- SCSS：编写复杂样式（批注标签、ptset 标签等）
- CSS-in-Vue：Vue 单文件组件内嵌 `<style scoped>`

**样式组织**
- src/assets/main.scss：全局样式（ptset 标签、批注标签等）
- src/assets/tailwind.css：Tailwind 导入
- 各组件内 scoped 样式

##### 6. 关键设计模式

**命令总线模式（commandBus）**
- 通过 onCommand 注册命令监听
- 通过 emitCommand 发送跨组件命令
- 解耦组件间的直接依赖

**吐司通知模式（toastBus）**
- emitToast() 发送通知消息
- 由上层组件统一处理和显示

**观察器模式（watch）**
- 深层 watch 监听 store 变化
- 自动保存到 localStorage

**策略模式（ToolMode）**
- 六种工具模式：none、measure_distance、measure_angle、annotation、annotation_cloud、annotation_obb
- toolMode ref 控制当前活跃工具

**版本管理模式**
- PersistedStateV1/V2/V3：向后兼容的版本管理
- normalizeV1/V2/V3 函数自动升级数据格式
- 新增字段自动初始化默认值

---

#### conclusions

1. **架构特点**
   - 清晰的分层结构：入口 → 布局 → 组件 → 状态 → API
   - 完全的模块化，每个功能域独立文件
   - Vue 3 Composition API 作为状态管理基础，避免 Vuex 复杂性

2. **状态管理**
   - 中央 useToolStore 管理所有工具数据和批注
   - 版本化持久化确保数据向后兼容
   - 响应式系统通过 Vue ref 和 watch 自动同步视图和存储

3. **API 集成**
   - 多个 API 模块（E3D、PDMS、RoomTree、Spatial）分别处理不同数据域
   - 统一的 fetchJson 工具函数
   - 数据类型在 composables 中定义，确保类型安全

4. **组件系统**
   - 11 个 dock 面板组件提供完整的功能界面
   - 每个面板对应一个业务功能（树形、测量、批注、审核等）
   - 使用 DockLayout 实现灵活的面板布局管理

5. **批注系统**
   - 四种批注类型（Text、Cloud、Rect、OBB）统一的生命周期管理
   - 支持 comments 字段存储多角色意见
   - 审核系统通过 ConfirmedRecord 实现快照版本控制

6. **扩展友好性**
   - composable 解耦易于添加新功能
   - API 层抽象易于集成新的后端端点
   - 组件化设计易于创建新的面板和工具

---

#### relations

**数据流关键路径**

1. **用户交互 → 状态更新**
   - 组件（如 AnnotationPanel）调用 useToolStore 函数修改状态
   - store 通过 ref 更新触发响应式更新

2. **状态 → localStorage 持久化**
   - useToolStore 中 watch 监听 measurements、annotations 等
   - 自动写入 localStorage（STORAGE_KEY_V3）
   - 页面重载时通过 loadPersisted() 恢复

3. **交互事件 → API 请求**
   - viewer.vue 监听 ptsetVisualizationRequest
   - 触发 pdmsGetPtset API 调用
   - API 响应后调用 usePtsetVisualization.renderPtset()

4. **命令发送 → 跨组件通信**
   - commandBus 提供 onCommand/emitCommand
   - DockLayout 监听命令控制面板的显示/隐藏
   - 解耦组件依赖关系

5. **组件 → useXeokitTools 交互**
   - RibbonBar 选择工具模式
   - ViewerPanel 中 useXeokitTools 响应工具模式变化
   - 注册相应的 xeokit 事件处理函数

6. **模型加载 → Ptset 清理**
   - viewer.vue loadModel() 调用 aios-prepack-bundle-loader
   - 加载完成后调用 ptsetVis.clearAll() 清除旧的 ptset 可视化
   - 防止内存泄漏

7. **Model Tree → Ptset 可视化**
   - ModelTreePanel 右键菜单触发 showPtset()
   - 调用 toolStore.requestPtsetVisualization(refno)
   - viewer.vue watch 监听请求，触发 API 加载和渲染

---

### 新功能模块集成指南

#### A. 添加新的 API 接口

1. **创建新的 API 模块** `src/api/genModelNewFeatureApi.ts`
   ```typescript
   export type NewFeatureData = { ... };
   export type NewFeatureResponse = { success: boolean; data?: NewFeatureData; error_message?: string; };
   export async function fetchNewFeature(refno: string): Promise<NewFeatureResponse> {
     return await fetchJson<NewFeatureResponse>(`/api/feature/${encodeURIComponent(refno)}`);
   }
   ```

2. **添加类型定义** `src/types/newFeature.ts`
   - 定义新功能的数据结构

#### B. 添加新的状态管理

1. **扩展 useToolStore** 或创建新的 composable `src/composables/useNewFeatureStore.ts`
   - 使用 ref 定义响应式状态
   - 编写 getter/setter 函数
   - 添加 watch 监听自动持久化

2. **如果需要全局访问**
   - 在 useViewerContext 中添加引用
   - 或通过 inject/provide 传递

#### C. 创建新的 UI 组件

1. **创建面板组件** `src/components/dock_panels/NewFeaturePanelDock.vue`
   - 包装实际功能组件
   - 在 main.ts 中注册全局组件

2. **创建功能组件** `src/components/tools/NewFeaturePanel.vue`
   - 实现具体的 UI 界面
   - 调用 composable 函数更新状态

3. **在 DockLayout.vue 中添加面板配置**
   - 添加到默认布局
   - 配置面板标题和渲染器

#### D. 集成到功能区（RibbonBar）

1. **更新 ribbonConfig.ts**
   - 添加新的命令和按钮定义

2. **更新 RibbonBar.vue**
   - 添加新的按钮或菜单项
   - 绑定命令发送事件

3. **在 DockLayout.vue 中监听命令**
   - 响应命令激活/关闭面板

#### E. 添加 xeokit 交互功能

1. **在 useXeokitTools.ts 中添加函数**
   - 实现特定的交互逻辑
   - 使用 xeokit SDK 提供的 API

2. **在 viewer.vue 中注册事件监听**
   - watch 对应的状态变化
   - 调用 useXeokitTools 中的函数

#### F. 持久化新数据

1. **扩展 PersistedStateV3 或创建 V4**
   - 添加新的数据字段
   - 实现 normalize 函数处理版本升级

2. **更新 useToolStore 中的 watch**
   - 包含新数据的持久化

#### G. 集成后端审核流程

1. **扩展 ConfirmedRecord** `src/composables/useReviewStore.ts`
   - 添加新功能的数据快照字段

2. **定义角色权限检查**
   - 使用 auth.ts 中的 UserRole 和检查函数
   - 在组件中控制功能可用性

---

### 集成检查清单

- [ ] API 函数已添加到相应 API 模块
- [ ] 新数据类型已定义到 src/types/
- [ ] 新的 composable 已创建或扩展现有的
- [ ] Dock 面板组件已在 main.ts 注册
- [ ] DockLayout.vue 已配置默认布局
- [ ] RibbonBar 已添加相应的命令和按钮
- [ ] 状态管理已实现持久化
- [ ] 权限检查已集成用户角色系统
- [ ] 新组件已使用 TypeScript 进行类型化
- [ ] 样式遵循 Tailwind + SCSS 规范
- [ ] 文档已更新 llmdoc/ 目录

