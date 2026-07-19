# 后端 API 事实清单（plant-model-gen）

> 用途：为「模型版本时间线」spec 提供后端事实依据，防止 spec 引用不存在的接口。
> 核实方式：直接阅读 `d:\work\plant-code\plant-model-gen` 源码（2026-07-18）。
> 每条事实附来源文件与行号区间。

## 1. 发布版本 Release 接口（`src/web_api/model_version_api.rs`）

路由注册位于 `model_version_api.rs:64-151`，与时间线相关的只读接口：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/model-version/releases` | GET | 版本列表，返回 `ModelReleaseListResponse { project_name, releases: ModelReleaseRecord[] }`（types.rs:885-888） |
| `/api/model-version/releases/{release_id}` | GET | 单个版本详情 |
| `/api/model-version/releases/{release_id}/runtime-scene` | GET | 版本运行时场景（分页：offset/limit/has_more），组件带 `owner_refno_str/owner_refno_u64/owner_noun`（types.rs:1083-1115），支持 `component_key`、`project` 过滤 |
| `/api/model-version/releases/{release_id}/events` | GET | 版本状态事件流 `ModelReleaseEventsResponse { release, events: [{release_id, release_status, reason, created_at}] }`（types.rs:891-902） |
| `/api/model-version/releases/{release_id}/state-machine` | POST | 生命周期状态机操作（release_state_machine.rs:43-62） |
| `/api/model-version/compare-readiness` | GET | 版本对可比性 `ModelReleasePairReadinessResponse`：classification、production_ready、problems、warnings、recommended_action、diff_summary（types.rs:1024-1050） |
| `/api/model-version/diff` | GET | 组件级 diff。参数：project、from_release_id、to_release_id、limit、change_type、component_key。行结构含 change_type/component_key/refno_str/refno_u64/noun/old_component_hash/new_component_hash；summary 含 added/changed/deleted/unchanged/emitted/total_old/total_new（前端 ModelVersionComparePanel.vue 已消费） |
| `/api/model-version/unit-diff` | GET | 单元级 diff（`ModelUnitDiffSummary`，types.rs:1175-1183） |
| `/api/model-version/component-impact` | GET | 组件影响面查询 |

**ModelReleaseRecord 关键字段**（types.rs:647-677）：
`release_id`、`project_name`、`branch_id`、`release_lifecycle`、`release_quality`、`release_quality_reason`、`validation_flags`、`release_status`（legacy，新代码应读 lifecycle+quality 双轴）、`release_label`、`dbnum`、`created_at`、`registered_at`、`rows_by_table`、`baseline_state_manifest_path`。

**生命周期枚举**（types.rs:745-752）：`staged → validating → assets_materialized → indexed → published / failed`。
【纠偏】原分析写作 "staged→validating→indexed→published/failed"，实际多一个 `assets_materialized` 阶段。

**质量态枚举**（types.rs:787-793）：`complete_visual / quarantined_visual / degraded_visual / patch_only / non_visual`。
【纠偏】原分析写作 "degraded/quarantined" 二态，实际为五态；legacy `ModelReleaseStatus` 里还有 `Degraded/Quarantined/PatchOnly`（types.rs:681-691）。时间线 UI 需按 quality 五态设计徽章。

## 2. 会话锚点 / 历史快照接口（`src/web_api/pe_att_history_api.rs`）

路由注册位于 pe_att_history_api.rs:20-25（specs/022 PE/ATT 历史查询最小集）：

| 接口 | 参数 | 说明 |
|---|---|---|
| `GET /api/model-history/anchors` | `dbnum`（必填）、`limit`（0/缺省=不截断） | 返回 `{ dbnum, count, anchors: rows }`（:109-123），底层 `aios_core::list_anchors` |
| `GET /api/model-history/resolve-anchor` | `dbnum`、`sesno`、`exact_only` | 解析到 `sesno_version_anchor`；找不到返回 404 `AnchorMissing`（:125-154） |
| `GET /api/model-history/snapshot` | `dbnum`、`sesno`、`refno`、可选 `pe_key` | 任意时刻元素快照，底层 `snapshot_at`（:156-180） |

**410 过期行为属实**：`HistoryError::Expired` 映射为 HTTP 410 GONE `"Expired"`（pe_att_history_api.rs:91-95）。retention 配置有限窗口时，窗口外查询返回明确过期错误（plant-model-gen AGENTS.md:23）。

## 3. 硬约束（plant-model-gen AGENTS.md:19-24）

- **锚点是唯一业务入口**（AGENTS.md:22）：对外只暴露 `sesno_version_anchor` 已固化的 sesno；历史查询走 `model-version history *`（rs-core `version_query`），前端勿绕过锚点裸查 VERSION。
- **同 dbnum 增量串行**（AGENTS.md:21）：watch-incremental 单队列，锚点一致性依赖此约束。
- **retention 默认 0 = 无限保留**（AGENTS.md:23）；可按站点改 `90d/30d` 等，改配置重启即可。有限窗口时前端必须准备「历史已过期」降级路径。

## 4. 元素级变更数据

- 前端 `src/api/incrementalUpdateApi.ts` 已有 `IncrementalModelChange`（dbnum、model_refno、model_category、source_change_count、source_operations、source_nouns、pe_exists 等，:105-116）与 `loadIncrementalAttrDiff`（dbnum/refno/from_sesno/to_sesno，:345-354）。
- 【纠偏 2026-07-19】前端调用的 `GET /api/model/incremental/*`（model-changes / attr-diff / monitor / run 等 6 个端点）在 plant-model-gen 后端**不存在**（全仓 grep 无路由；后端只有 `/api/incremental/*` 站点同步检测 console API）。前端 try/catch 后回落到 `/incremental-demo/1112_896_897_*.json` 演示数据。详见 `feature-feasibility-2026-07-19.md` C1/B3。
- 结论：树内差异数据源必须用 `/api/model-version/diff`（组件级、release 对 release，接口已就绪）；「节点属性 before/after」短期方案为 versioned 站点上 `model-history snapshot×2` 前端做差，长期等 rs-core 补组件级 attr-diff 接口。

## 5. 对时间线设计的直接约束

1. 时间线主刻度 = releases（粗）+ anchors（细）双层数据源，二者按 dbnum 对齐。
2. 版本卡片状态徽章必须同时表达 lifecycle（工作流轴）与 quality（质量轴），不能合并成一个字段。
3. 历史快照（时间旅行）必须先 resolve-anchor 再 snapshot，且处理 404 AnchorMissing 与 410 Expired 两种失败。
4. 双版本对比前先调 compare-readiness，尊重 production_ready / classification，隔离（quarantined_visual）版本要给显著警示。
5. runtime-scene 是分页接口，历史整树还原需要按 has_more/next_offset 翻页或走 scene_tree artifact。
