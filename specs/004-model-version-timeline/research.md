# Research: 模型版本时间线与历史模型树

> 详细事实依据见 `research/backend-api-facts.md`（后端）与 `research/frontend-integration-points.md`（前端），本文件汇总关键决策。

## Decision: 时间线双层数据源

**Decision**: 时间线主刻度使用发布版本（`/api/model-version/releases`），细刻度使用会话锚点（`/api/model-history/anchors?dbnum=`），两层按 dbnum 对齐、可切换显示粒度。

**Rationale**: 发布版本承载完整工作流/质量语义与 diff 能力，适合作为主节点；锚点提供会话级细粒度且是唯一合法历史入口（backend-api-facts §2、§3）。

**Alternatives considered**:

- 只用发布版本：无法满足"任意时刻模型树"的会话级需求（US3）。
- 只用锚点：丢失 lifecycle/quality 语义与 release diff 摘要，且受 retention 窗口影响。
- 合并为单一列表不区分类型：节点操作集不同（锚点无 diff 摘要、无 A/B 钉选必要），合并会造成操作歧义。

## Decision: 双轴状态徽章（lifecycle 与 quality 不合并）

**Decision**: 版本节点同时展示 `release_lifecycle`（staged/validating/assets_materialized/indexed/published/failed）与 `release_quality`（complete_visual/quarantined_visual/degraded_visual/patch_only/non_visual）两个独立徽章（FR-004）。

**Rationale**: 后端已将 legacy `release_status` 拆为双轴（backend-api-facts §1【纠偏】），单徽章会把"已发布但质量隔离"这类关键状态压扁，误导对比基准选择。

**Alternatives considered**:

- 读 legacy `release_status` 单字段：官方注释明确新代码应使用双轴；且 status 九态混轴难以着色。
- 只显示 quality：丢失"未发布不可作为快照/对比目标"（FR-032）的判断依据。

## Decision: 树内差异复用 `plant3d:incremental-version-compare` 事件通道

**Decision**: 时间线面板选定版本对后，通过现有 window 事件 `plant3d:incremental-version-compare` 向 ModelTreePanel / ViewerPanel 注入差异上下文；协议只增不改。

**Rationale**: ModelTreePanel 已有 `IncrementalCompareContext` 解析与高亮通道，ViewerPanel 已监听同一事件做双版本渲染（frontend-integration-points §1、§2），复用可让 US2 增量成本最低。

**Alternatives considered**:

- 新建事件协议：需要三处组件同时改造且与增量更新面板的既有派发方重复。
- 组件 props 直传：面板间无直接父子关系，dock 布局下事件总线是既定模式。

## Decision: 会话级历史只走锚点入口

**Decision**: 历史快照统一流程为 `resolve-anchor(dbnum, sesno)` → `snapshot(dbnum, sesno, refno)`；404 AnchorMissing 提示并回退最近可用锚点或发布版本，410 Expired 提示"历史已过期，请改用发布版本粒度"（FR-018/019/020）。

**Rationale**: plant-model-gen AGENTS.md 明确"锚点是唯一业务入口"，且 `HistoryError::Expired` 映射 410（backend-api-facts §2、§3）。

**Alternatives considered**:

- 绕过锚点直查 VERSION：被后端仓库规则明令禁止。
- 前端静默吞掉 410/404：违背 SC-008，用户无法理解为何看不到历史。

## Decision: 大差异集合并计算移出主线程

**Decision**: diff 行与树节点的合并（refno 归一化、祖先路径保留、幽灵节点回插）在差异量超过阈值（约 2000 条）时放入 Web Worker 或按帧分片执行，UI 始终虚拟滚动渲染。

**Rationale**: FR-014/SC-004 要求 5000 条差异下交互响应 < 200ms；主线程同步逐节点扫描在大库（AMS DB1112 数万组件）上会秒级卡顿（spec 注意点④）。

**Alternatives considered**:

- 主线程同步合并：小库可行，大库不满足 SC-004。
- 后端聚合出"树+diff"复合接口：改后端，超出本 feature 只读边界（FR-035）。

## Decision: 历史树数据按 versionKey 缓存

**Decision**: 历史模型树数据以 `project:dbnum:release_id`（或 `project:dbnum:sesno`）为键做内存缓存，带条目上限的 LRU；退出快照模式不清空，会话结束自然释放。

**Rationale**: FR-017/SC-006 要求二次进入 < 500ms；runtime-scene 为分页接口，整树重拉代价高（backend-api-facts §5）。

**Alternatives considered**:

- 不缓存：来回对比场景体验差。
- localStorage/IndexedDB 持久化：违背"会话级状态不持久化"的假设，且数据量大。

## Decision: 面板与入口沿用 dock + ribbon 既有模式

**Decision**: 新增 dock 面板 `versionTimeline`（DockLayout `addPanelSafely` + 面板 id 白名单 + `panel.versionTimeline` ribbon 命令），双树对比作为独立面板/工作台组件，刻度条挂在 ViewerPanel 视口内。

**Rationale**: `modelVersionCompare` 面板已示范完整注册链路（frontend-integration-points §4、§5），沿用可保持交互一致并直接复用 `ensurePanelAndActivate`。

**Alternatives considered**:

- 独立路由页：脱离三维工作台上下文，无法与树/3D 联动。
- iframe 嵌后端诊断页：正是本 feature 要替换的形态（研究纠偏③）。

## Decision: 未发布 / 隔离版本守护策略

**Decision**: 默认只允许 `published` 生命周期版本作为快照/对比目标；非 published 需显式开启"诊断模式"才可选（FR-032）。`quarantined_visual` 在时间线、对比、快照、刻度条全入口显示红色警示（FR-031），对比前必查 `compare-readiness` 并展示 problems/warnings/recommended_action（FR-027）。

**Rationale**: compare-readiness 返回 production_ready/classification 等结论（backend-api-facts §1），前端不应自行放宽；隔离版本被误用作基准是真实风险（现网默认演示数据即 quarantine release）。

**Alternatives considered**:

- 不限制、仅提示：用户容易忽略，验收 SC-007 无法保证。
- 完全隐藏非 published 版本：诊断场景（后端排障）需要可见性，隐藏过度。
