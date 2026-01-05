<!-- 这整个块是给其他代理的原始情报报告。它不是最终文档。 -->

### Code Sections (The Evidence)

<!-- 列出支持你答案的每一段代码。要详尽。 -->

- `src/api/genModelTaskApi.ts` (modelShowByRefno): 定义了 `/api/model/show-by-refno` REST API 端点的调用函数，接受 refnos 数组、db_num、regen_model 等参数，返回包含 bundle_url、metadata 和 parquet_files 的响应。

- `src/composables/useModelGeneration.ts` (showModelByRefno): 实现了按需显示模型的核心逻辑，调用后端 API 获取模型数据，然后使用 Parquet 加载器将模型加载到 3D 场景中，支持自动飞行到模型视图。

- `src/components/dock_panels/ViewerPanel.vue` (showModelByRefnos): 提供了批量显示模型的函数，监听 `showModelByRefnos` 自定义事件，调用后端 API 并处理 Parquet 文件加载，包含错误处理和自动聚焦功能。

- `src/components/model-tree/ModelTreePanel.vue` (setVisible): 在模型树右键菜单操作中调用 `showModelByRefno`，当用户选择显示元件时，如果模型不存在则触发按需生成和加载。

- `src/types/task.ts` (ModelExportParameters): 定义了导出模型任务的参数类型，包含 refno 和 regenModel 字段，这些参数也被 show-by-refno API 使用。

### Report (The Answers)

#### result

`api_show_by_refno` 实际上是项目中 `/api/model/show-by-refno` REST API 的前端实现，用于按需生成和显示 3D 模型。该系统包含以下核心组件：

1. **API 层**: `src/api/genModelTaskApi.ts` 中的 `modelShowByRefno` 函数定义了 API 调用接口
2. **业务逻辑层**: `src/composables/useModelGeneration.ts` 中的 `showModelByRefno` 函数实现了完整的模型生成和加载流程
3. **UI 集成层**: `src/components/dock_panels/ViewerPanel.vue` 和 `src/components/model-tree/ModelTreePanel.vue` 提供了用户交互入口

#### conclusions

- **API 端点**: `POST /api/model/show-by-refno` - 接受 refnos 数组和可选参数，返回模型数据和 Parquet 文件列表
- **核心功能**: 零时任务模式，不保存任务记录，直接生成并加载模型到 3D 场景
- **数据流程**: API 调用 → 获取 bundle_url 和 parquet_files → Parquet 加载器处理 → 3D 场景渲染 → 自动飞行聚焦
- **集成方式**: 通过模型树右键菜单、控制台命令和自定义事件系统触发
- **错误处理**: 包含完整的错误捕获、用户提示和回退机制

#### relations

- `src/api/genModelTaskApi.ts` (modelShowByRefno) → `src/composables/useModelGeneration.ts` (showModelByRefno): API 层提供调用接口，业务逻辑层实现具体功能
- `src/composables/useModelGeneration.ts` (showModelByRefno) → `src/composables/useParquetModelLoader.ts` (loadParquetToXeokit): 模型生成后调用 Parquet 加载器进行 3D 场景渲染
- `src/components/model-tree/ModelTreePanel.vue` (setVisible) → `src/composables/useModelGeneration.ts` (showModelByRefno): 模型树用户操作触发按需模型生成
- `src/components/dock_panels/ViewerPanel.vue` (showModelByRefnos) → 全局事件系统: 监听 `showModelByRefnos` 事件实现批量模型加载
- `src/types/task.ts` (ModelExportParameters) → API 参数类型: 为 show-by-refno API 提供类型定义支持