# 前端集成点事实清单（plant3d-web）

> 用途：为「模型版本时间线」spec 标注哪些现有机制可复用、哪些需扩展、哪些需新建。
> 核实方式：直接阅读本仓源码（2026-07-18）。

## 可直接复用

### 1. 增量对比上下文通道（树内高亮）
- `src/components/model-tree/ModelTreePanel.vue:39-50`：`IncrementalCompareContext { project?, dbnum?, fromSesno?, toSesno?, mode?, refnos: string[], models: IncrementalCompareModel[] }`，`models` 项含 `refno/category/status/beforeState/afterState/sourceChangeCount/sourceNouns`。
- 注入方式：window 事件 `plant3d:incremental-version-compare`（ModelTreePanel.vue:944-948 监听，:1057-1090 解析）。
- 结论：树内 diff 徽章（增/删/改）**可直接复用**该通道，不需要新协议；时间线面板只要派发同一事件。

### 2. 3D 视图按版本加载 runtime-scene
- `src/components/dock_panels/ViewerPanel.vue:598-611`：`fetchReleaseRuntimeScene(releaseId, componentKey, project?)` 已封装 `/api/model-version/releases/{id}/runtime-scene`。
- ViewerPanel.vue:677-724：from/to 双版本并排代理渲染（蓝 0x2563eb = from，绿 0x10b981 = to），几何缓存 key `mv:{releaseId}:{geo_hash}`。
- ViewerPanel.vue:4305-4312：同样监听 `plant3d:incremental-version-compare`。
- 结论：**可复用**按版本取场景与双版本渲染路径；整树级历史加载需扩展（当前按 component_key 取 limit=1）。

### 3. 版本对比面板（现状基线）
- `src/components/model-version/ModelVersionComparePanel.vue`：原生实现（非 iframe），已调 `/api/model-version/diff`、`/compare-readiness`，展示 production_ready 徽章，向树/视图派发对比事件。
  - 注意：写死 `AMS_DB1112_COMPARE_DEFAULTS`（:52-57，AvevaMarineSample DB1112 两个 quarantine release），版本对选择依赖 URL 参数，**没有**版本列表/时间线选择 UI —— 这正是本 feature 要补的入口。
- 【纠偏】早先分析称该面板是 "iframe 嵌后端页 + 写死 AMS 演示参数"：iframe 已被原生实现替代，但写死默认参数仍在（诊断页跳转 `/model-version/compare` 仍保留，:343-345）。

### 4. Dock 面板体系
- `src/components/DockLayout.vue:905-913`：`modelVersionCompare` 面板注册模式（addPanelSafely + referencePanel viewer + direction right）。新面板照此模式注册即可。
- `src/composables/useDockApi.ts`：`ensurePanelAndActivate(panelId)`（ModelVersionComparePanel.vue:249 已用）。
- 面板 id 白名单：DockLayout.vue:616-625。

### 5. Ribbon 入口
- `src/ribbon/ribbonConfig.ts:265-271`：任务页签已有「版本对比」按钮（`task.modelVersionCompare` → `panel.modelVersionCompare`）。新增「版本时间线」按钮照此加一项 + DockLayout 命令分发（:1308-1313 模式）。

### 6. 元素级变更 API 封装
- `src/api/incrementalUpdateApi.ts:105-116`：`IncrementalModelChange` 类型齐全；`loadIncrementalModelChanges`（:318-343，带 demo fallback）、`loadIncrementalAttrDiff`（:345+，属性 old/new）。
- 结论：节点级「谁在何时改了什么」**可复用**，不需要新类型。

### 7. 虚拟滚动
- 依赖 `@tanstack/vue-virtual` 已在 package.json（模型树已用）。时间线长列表、双树对比直接复用。

## 需扩展

1. **ViewerPanel 整版本场景加载**：现有 runtime-scene 调用按 component_key 单件取数（limit=1），历史版本整树 3D 加载需分页拉全量或走 scene_tree artifact。
2. **ModelVersionComparePanel 参数来源**：从「URL 写死」扩展为「时间线面板选 A/B」驱动。
3. **树数据源切换**：ModelTreePanel 目前只从当前 viewer 建树（usePdmsOwnerTree），历史快照模式需要允许树数据源替换为 release scene_tree / snapshot 结果，并加只读横幅。

## 需新建

1. `src/api/modelVersionApi.ts`：releases / release events / compare-readiness / diff / anchors / resolve-anchor / snapshot 的类型化封装（现散落在组件内 fetch，anchors 系列完全没有封装）。
2. 版本时间线 Dock 面板组件（`src/components/model-version/VersionTimelinePanel.vue` 之类）+ 状态 store（`useVersionTimelineStore`）。
3. 时间线↔树↔3D 的联动状态（选中版本、钉选 A/B、历史快照模式开关）。
4. 3D 视口底部时间刻度条（scrubber，Phase 3）。

## 现有约定注意

- 面板均为中文标题 + Tailwind 类 + `data-testid` 便于 e2e（参照 ModelVersionComparePanel.vue 模板部分）。
- 事件命名沿用 `plant3d:` 前缀 CustomEvent。
- API 返回统一 `{ success, data, message }` 包装（ModelVersionComparePanel.vue:310-313 的判断方式）。
