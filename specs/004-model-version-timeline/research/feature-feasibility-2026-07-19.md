# 可实现性分析：当前后端（plant-model-gen）支持哪些前端版本管理功能

> 核实方式：直接阅读 `d:\work\plant-code\plant-model-gen` 源码（2026-07-19）。
> 路由挂载证据：`src/web_api/mod.rs:69-86`（`assemble_stateless_web_api_routes` 已 merge `create_model_version_routes` 与 `create_pe_att_history_routes`，并由 `web_server/mod.rs:556,1386` 装入主 Router）。

## A. 后端已就绪 —— 前端立即可实现（P1）

| # | 前端功能 | 后端接口（已核实实现） | 前端现状 | 对应原型 / FR |
|---|---|---|---|---|
| A1 | 版本时间线面板：按时间倒序列出发布版本，dbnum / 质量态过滤，生命周期+质量态双徽章 | `GET /api/model-version/releases`（`model_version_api.rs:731-780`；支持 `project`、`all_projects`、`dbnum`、`quality`、`complete_visual_only` 过滤，返回 `release_lifecycle` + `release_quality` 双轴与 `registered_at`） | 全新开发（`modelVersionApi.ts` + Dock 面板） | timeline-panel / FR-001~008 |
| A2 | 版本卡片 diff 摘要（+n ~m -k）与树内差异标注 | `GET /api/model-version/diff`（`change_type`、`limit`、`component_key` 过滤；summary 含 added/changed/deleted/unchanged/total_old/total_new） | `ModelVersionComparePanel.vue:309` 已消费；树内高亮通道 `plant3d:incremental-version-compare` 已存在（`ModelTreePanel.vue:944-1090`） | tree-diff / FR-005、009~011 |
| A3 | A/B 版本对可比性检查与质量警示 | `GET /api/model-version/compare-readiness`（classification、production_ready、problems、warnings、recommended_action） | 已消费（`ModelVersionComparePanel.vue:194`），缺"从时间线选版本对"入口 | timeline-panel + compare-ab / FR-024、027、031 |
| A4 | 3D 按版本加载差异构件、from/to 双版本分色渲染 | `GET /releases/{id}/runtime-scene`（分页 `limit` 默认 2000 / 上限 20000，`component_key` 过滤，组件带 `instance_matrix`/`aabb`/`mesh_url`）、`/releases/{id}/mesh-assets`、`/index-assets` | `ViewerPanel.vue:598-724` 已实现 fetch + `mv:{releaseId}:{geo_hash}` 几何缓存 + from 蓝/to 绿双渲染（当前仅 component_key 单构件粒度） | compare-ab 底部 3D 条 / FR-021、023 |
| A5 | 版本状态事件流（卡片展开显示 staged→validating→…→published 演进） | `GET /releases/{id}/events`（`ModelReleaseStatusEvent{release_status,reason,created_at}`） | 全新开发（时间线卡片展开区） | timeline-panel / FR-004 补充 |
| A6 | 单元级差异 / 组件影响面（进阶视图） | `GET /api/model-version/unit-diff`、`GET /api/model-version/component-impact` | 未消费 | 后续增强 |

**结论：原型里的「版本时间线面板 + 树内差异标注」两张 P1 界面，后端接口全部就绪，可直接开工。**
树内差异的数据源应采用 `/api/model-version/diff`（组件级，release 对 release），而不是现在树里走的 incremental 通道（见 C1）。

## B. 有条件可实现（接口在，有前置或规模约束）

| # | 前端功能 | 条件 / 约束 | 建议 |
|---|---|---|---|
| B1 | 历史快照模式：整棵模型树切到某发布版本（P2） | **没有 per-release 全树 HTTP 接口**。scene_tree artifact（`{dbnum}.tree`）在 release 包内，`restore_scene_tree_artifact` 是 CLI 恢复（`version_management/scene_tree_artifact.rs`），未暴露 HTTP。但 `runtime-scene` 组件带 `owner_refno_str/owner_noun`，可分页拉全量后在前端重建父子树 | AMS DB1112 规模（数千构件）可行：20k/页 ≤2 页拉完；大库需后端补"release 树导出"接口（工作量小，读现成 artifact） |
| B2 | sesno 锚点粒度时间线 + 元素级历史快照 | `GET /api/model-history/anchors / resolve-anchor / snapshot` 已挂载（`pe_att_history_api.rs:20-25`），但**依赖站点 `versioned=true`**（specs/022 实例级 RocksDB）；非 versioned 库无历史；retention 窗口外返回 `410 Expired`；snapshot 是**单元素**接口（refno+sesno），不适合整树 | 前端必须带降级 UI（FR-019/020 已进 spec）；锚点粒度作为 P3，先在 versioned 验证站点打通 |
| B3 | 「改」节点属性 before/after 面板 | release 级 diff 行只有 `old/new component_hash`，**没有组件级属性 diff HTTP**；元素属性历史可用 model-history snapshot 拉两个 sesno 快照在前端做差（仅 versioned 站点） | 短期：用 snapshot×2 前端做差（versioned 站点）；或请 rs-core 侧补组件 attr-diff 接口 |

## C. 前端 UI 已存在但数据链路是假的（需要换数据源或补后端）

| # | 现状 | 证据 | 处理 |
|---|---|---|---|
| C1 | 模型树增量对比高亮通道目前吃**演示 JSON**：前端调 `/api/model/incremental/monitor|watch-once|report|run|model-changes|attr-diff`，这 6 个端点在 plant-model-gen **不存在**（后端只有 `/api/incremental/*` 站点同步检测 console API，`web_server/mod.rs:727-763`），失败后 fallback 到 `/incremental-demo/1112_896_897_*.json` | `incrementalUpdateApi.ts:161-369` 全部 try/catch → demo | 树内差异改吃 `/api/model-version/diff`（A2，接口已就绪）；`/api/model/incremental/*` 是否补由后端/rs-core 决策 |
| C2 | `ModelVersionComparePanel` 写死 `AMS_DB1112_COMPARE_DEFAULTS`，版本对靠 URL 参数 | `ModelVersionComparePanel.vue:52-57` | 时间线面板落地后由 A/B 钉选驱动，删除写死默认 |

## D. 落地顺序建议（映射到已画原型）

1. **Phase 1（接口全就绪，纯前端工作）**：`modelVersionApi.ts`（releases/diff/compare-readiness/events 封装）→ 版本时间线 Dock 面板（timeline-panel + 三态 frame）→ 树内差异徽章/幽灵节点/筛选 chips（tree-diff frame，数据源 `/diff`）→ A/B 钉选打通现有对比面板（去写死参数）。
2. **Phase 2**：发布版本粒度历史快照（runtime-scene 分页重建树 + 只读横幅，snapshot-readonly frame）→ 3D 整版本加载扩展（ViewerPanel 现有单构件路径扩到构件集合）→ 双树并排对比（compare-ab frame）。
3. **Phase 3**：3D scrubber 播放（scrubber-3d frame）→ versioned 站点上线后的锚点粒度 + 元素属性历史（B2/B3）。

## 需要与后端 / rs-core 对齐的三件事

1. release 全树导出 HTTP 接口（读 scene_tree artifact，供大库历史快照）。
2. 组件级属性 diff（release A vs B 按 refno 出属性差异行），替代前端二次拉 snapshot 做差。
3. 验证环境哪些站点已开 `versioned=true` + retention 配置，决定锚点粒度功能的可演示范围。
