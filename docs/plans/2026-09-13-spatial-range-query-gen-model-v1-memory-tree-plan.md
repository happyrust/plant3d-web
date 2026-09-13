# 「按范围查找」接 gen-model-refactor 内存空间树开发计划

- 日期：2026-09-13
- 状态：**已批准（Plannotator 第 2 轮 `approved`，2026-09-13 10:38）**；实施中，§5 六项按推荐项 (a) 执行
  - 进度：**P2 已完成**（2026-09-13 11:45，plant3d-web `8127bcb`，见 §4 P2 备注）；**P3 代码与单测已完成**（11:52，plant3d-web
    单独一提交，见 §4 P3 备注；与真服务联调一项要等 P1）；P0 / P1 仍等并行会话的迁移改动收口
    （gen-model-refactor 到 11:26 还在连续提交 `7bacdb81f` 等，`verification/migration-baseline-20260913/` 2 万余文件未跟踪）；
    P4 可在 P3 之上继续
  - 第 1 轮（09:36）唯一批注落在后端基线行：「先提交这个」。已落实：后端原 83 个在飞改动已由并行会话提交为
    `f888e9dc2 refactor: retire publish stage and complete lazy data routing`（10:10，215 文件），其后又有
    `b82d6fbbb fix(room)` / `8f99cbc64 fix(api)` 两条（10:25 / 10:26）；分支 10:21 改名
    `refactor/retire-publish-stage → gen-model-refactor`，备份分支 `backup/refactor-before-migration-20260913 = f888e9dc2`。
  - 第 2 轮前按用户要求把 plant3d-web 在飞改动也清零：`0a7eae4 docs(plan)`（本计划）+ `9d34701 chore(wip)`
    （240 文件快照，10:39）；随后用户在 Plannotator 里 Approve，无新增批注。
- 前端：`D:\work\plant-code\old\plant3d-web`（`main@9d34701`，工作树干净；本计划的前端改动从这里起算）
- 后端：`D:\work\plant-code\old\gen-model-refactor`（`gen-model-refactor@8f99cbc64`）。**注意**：工作树里另有并行会话正在推进的
  「迁移基线」改动（`verification/migration-baseline-20260913/`、新文件 `src/data_interface/room_read_through.rs`、
  `query_service.rs::room` 的 read-through 分支、`direct_tree.rs::is_current` 放开可见性等，10:28–10:30 仍在改、在跑 lib 测试），
  不属于本计划、不由本计划提交；P0 / P1 动工前先与该会话对齐或等其收口（§6）
- 后端依赖：`D:\work\plant-code\old\vendor\old-aios-core`（`codex/libgm-snout-caliber@88b5be3`，工作树 `Cargo.toml` /
  `src/shape/pdms_shape.rs` 有未提交改动，属并行会话的迁移基线；经 gen-model-refactor `Cargo.toml` L269 `[patch]` 指到
  `../vendor/old-aios-core`，随 gen-model-refactor 一起编）
- 上游分析：会话「空间查询」交接链（fable-5-1-46 → 66 → 92 → 106 → 118）；本计划取代 fable-5-1-46 分析里基于
  plant-model-gen `sqlite-spatial` 的「二、三」两节，前端现状「一」仍成立
- 实施纪律：两仓都有大批在飞改动，**不 reset、不替用户提交既有改动**；本计划的变更叠加在工作树代码真值上、单独列出

## 0. 结论

1. gen-model-refactor 里的「内存共享变量」是 `aios_core::room::room::GLOBAL_AABB_TREE`
   （`Lazy<tokio::RwLock<AccelerationTree>>`，rstar `RTree<RStarBoundingBox{aabb, refno, noun}>`），由模型落库后的
   `converge_tree_after_persist` 增量维护、启动按指纹复用快照或从 `inst_relate` 指针重建；属性侧的补充来源是
   `ModelMemoryStore`（进程内几何投影，带 `dbnum / ancestors / mesh_id`）。
2. 现有 HTTP 面（`/api/v1/*`）与 `/api/v1/query` 的 tool 表里**没有**范围 / 邻近查询；`model.spatial.bounds` 只回单 refno 的 AABB。
3. 因此需要：后端新增 `GET /api/v1/spatial/{nearby, nearby/refnos, negative-nouns}`，候选直接查 `GLOBAL_AABB_TREE`
   （读锁、不碰串行锁、不写树），属性从 `ModelMemoryStore` / `DirectTreeService` 补；前端按 model-source 端口模式加
   `SpatialSource`，`useSpatialQuery` 的四个取数点改成经端口注入，legacy 源零逻辑委托现有 `genModelSpatialApi.ts`。
4. 出参形状与旧 `/api/sqlite-spatial/nearby` 对齐，`useSpatialQuery` 的合并 / 翻页 / 批量操作语义一行不改；
   v1 源下**没有专业（spec_value）维度**，UI 隐藏专业筛选与专业分组、改按 dbnum 分组（§5-1 待拍板）。

## 1. 证据

### 1.1 后端内存变量与查询原语

| 变量 | 位置 | 要点 |
|---|---|---|
| `GLOBAL_AABB_TREE` | `vendor/old-aios-core/src/room/room.rs` L12 | 全进程唯一；`tokio::sync::RwLock` |
| `RStarBoundingBox` / `AccelerationTree` | `vendor/old-aios-core/src/accel_tree/acceleration_tree.rs` L24 / L80 | `aabb: parry3d::Aabb`（f32，mm，世界坐标）、`refno: RefU64`、`noun: String`；`refno_index` 是**私有**字段，按 refno 取自身盒目前没有只读 API |
| `query_within_distance(loc, r)` | 同上 L298 | rstar `locate_within_distance(p, r²)`，距离口径 `PointDistance::distance_2` = **AABB 到点的最小距离平方**，与前端 `aabbMinDistanceToPoint` 同口径 |
| `locate_intersecting_bounds(&Aabb)` | 同上 L309 | `locate_in_envelope_intersecting`；cube 与 refno-AABB 目标用它 |
| `projected_tree_entry` | `gen-model-refactor/src/fast_model/aabb_tree.rs` L18 | 隐式管身 `tube` **不进树**；NaN / Inf / 反向盒剔除（`aabb_is_usable` L942） |
| `converge_tree_after_persist` | 同上 L48；调用点 `model_db_adapter.rs` L876 / L1579 | `PersistTarget::global().converge_spatial = true`（L212-216）；盒取投影 `world_bounds`，不回读库 |
| `load_project_tree_verified` | 同上 L619；调用 `lib.rs` L506 / L2407 | `AIOS_SPATIAL_COMPUTE=0` 跳过整套装载（`options.rs` L1307） |
| `spatial_state::ensure_spatial_ready` | `fast_model/spatial_state.rs` L250 | 只有 `Ready / ReadyEmpty` 放行；错误码 `SPATIAL_TREE_NOT_READY` |
| 锁序 | `spatial_state.rs` 模块注释 | `DATA_COMMIT_SERIAL → SPATIAL_STATE_SERIAL → GLOBAL_AABB_TREE`；读者只 `.read().await`，`room_model.rs` L759 同款 |
| 写点白名单 | `aabb_tree.rs` 测试 `tree_write_sites_stay_on_the_audited_whitelist` L2073 | 新模块**不得出现** `GLOBAL_AABB_TREE.write()` |
| `ModelMemoryStore` | `fast_model/model_memory_store.rs` L537；`ProjectedGeometry` L88；索引 `by_source / by_ancestor` L249-273；`records_of_root` L833 | std `RwLock`，同步读；每库一棵 `room_spatial`（含 tube，pub(crate)，只给房间算法用） |
| 数据面 | `options.rs` L895 `data_face`；`model_read_route.rs` L27 | 默认 `spawned-mem` → read-through → `ProcessStore{durable:false}`，照常写进程内 SurrealDB、照常收敛树；**`ProjectionOnly` / memory-only 库的盒只在 `ModelMemoryStore`，不在全局树** |

### 1.2 后端路由事实

`web_service/mod.rs` L394-480 注册了 `/api/v1/{health, query, search, tree/*, model/ensure, model/records, meshes/{file},
dbnums, element/*, tasks, queue/*, ws}` 与 `/api/mbd/v2/pipe/{refno}`；`query_service.rs` L230 tool 表有
`model.spatial.bounds`（L727，exact/subtree 的单 refno AABB；read-through 读 `ModelMemoryStore.records_of_root`）、
`e3d.room.lookup` 等。**没有** nearby / range。

### 1.3 前端接线事实

- 端口模式：`src/model-source/ports.ts`（`TreeSource / ModelRecordSource / MeshSource / AttributeSource / KeypointSource`）、
  `src/model-source/index.ts` L33 `getModelSource()`、`src/model-source/genModelV1/index.ts`、`src/model-source/legacy/index.ts`。
- HTTP 基座：`src/api/genModelV1Api.ts`（`genModelV1Fetch`、`GenModelV1ApiError{code,status,...}`、`toV1Refno / fromV1Refno`）。
- `src/composables/useSpatialQuery.ts`：`createSpatialQueryStore` 的 `options.queryNearbyByPosition / queryNearbyByRefno /
  querySpatialIndex / fetchNegativeNouns` 已可注入（L96-99，默认值 L914-915）；`queryNearbyRefnos`（L1241）仍是直接 import；
  `batchLoadSpatialQueryRefnos`（L672）里 `parquetLoader.isParquetAvailable`、`generateMissingRefnos`
  （`triggerBatchGenerateSse` / `enqueueParquetIncremental`）是 legacy 专有，`loadRefnosBySource(...,'backend')`（L584）→
  `loadDbnoInstancesForVisibleRefnosDtx` 已按源选 `.mesh`；`ensureDbMetaInfoLoaded / getDbnumByRefno` 已支持 v1。
- 专业：前端 `spec_value` 来自实例 `uniforms.spec_value`（`useDbnoInstancesDtxLoader.ts` L943）；v1 链路的
  `ProjectedGeometry`、`aios_core::GeomInstQuery`、`model-source/genModelV1/instanceMapping.ts` 都没有它。
- 单测：`src/composables/useSpatialQuery.test.ts`（17 个用例，全部经注入 mock）。

## 2. 目标 / 非目标

**目标**
1. gen-model-v1 源下，抽屉的「范围查询」（点 + 半径）与「距离查询」（refno + 半径）都能出结果，结果带 `dbnum`，
   合并 / 翻页 / 全部显示 / 隔离 / 加载本页的现有语义不变。
2. 后端查询只读 `GLOBAL_AABB_TREE`，不取串行锁、不写树；树不 Ready 时返回可分型的 503，而不是空结果。
3. 距离口径与前端本地扫描一致（AABB 到点 / AABB 到 AABB 的最小表面距离），sphere / cube 两种形状。
4. legacy 源行为逐字不变（零逻辑委托），17 个既有用例继续通过。

**非目标**
- 不覆盖 `ModelMemoryStore`-only 的盒（`ProjectionOnly` / memory-only 库）；响应带 `coverage:"global-tree"` 说明（§5-5）。
- 不做服务端 60 s 扫描快照缓存（rstar 查询 ms 级，先每页重扫；有需要另起切片）。
- 不在查询接口里隐式 `ensure` 生成模型（§5-3）。
- 不派生专业维度（§5-1 按推荐项：v1 源下隐藏）。
- 不动 `/api/sqlite-spatial/*` 与 plant-model-gen。

## 3. 设计

### 3.1 接口契约（写进 `gen-model-refactor/docs/specs/web-service-api.md` 新 §4.13）

`GET /api/v1/spatial/nearby`

| 参数 | 类型 | 说明 |
|---|---|---|
| `refno` \| `x,y,z` | string \| f32 mm | 二选一；refno 收 `a/b` 与 `a_b` |
| `radius` | f32 mm | 必填，`0 < r ≤ 100000` |
| `shape` | `sphere` \| `cube` | 默认 `sphere` |
| `nouns` | 逗号分隔 | 大写比较 |
| `keyword` | string | 分页前，匹配 refno / noun（name 见 §5-2） |
| `sort` | `distance` \| `name` | 默认 `distance`；同距按 dbnum、refno 兜底 |
| `include_self` | bool | refno 模式默认 false：剔除自身与 `ancestors` 含 target 的子树 |
| `include_negative` | bool | 默认 false：按 `aios_core::pdms_types::TOTAL_NEG_NOUN_NAMES`（26 个）过滤 |
| `dbnums` | 逗号分隔 u32 | 可选，限定库 |
| `page` / `per_page` | usize | `per_page` 默认 500，上限 1000 |
| `project / mdb / namespace` | | 与其它 `/api/v1` 一致，经 `resolve_identity` |

响应（200）：

```json
{
  "results": [{ "refno": "24383_71586", "dbnum": 24383, "noun": "PIPE", "name": null,
                "aabb": { "min": [x,y,z], "max": [x,y,z] }, "distance": 123.4, "within_radius": true }],
  "center": { "x": 0, "y": 0, "z": 0, "source": "position | refno_aabb_center" },
  "radius": 5000, "shape": "sphere",
  "total_count": 0, "returned_count": 0, "page": 1, "per_page": 500, "has_more": false,
  "candidate_count": 0, "truncated_candidates": false, "candidate_cap": 200000,
  "groups": [{ "dbnum": 24383, "count": 0 }],
  "filter_options": { "nouns": [{ "value": "PIPE", "count": 0, "is_negative": false }] },
  "spatial_state": "ready", "coverage": "global-tree"
}
```

错误（`/api/v1` 信封 `{code,message,detail}`）：`bad_request`（参数）、`not_found`（refno 模式在投影与树里都没有盒）、
`spatial_not_ready`（503 + `Retry-After: 5`，`detail.state` 为 `spatial_state` 字面值）。

`GET /api/v1/spatial/nearby/refnos`：同参、忽略分页，返回 `{ refnos: [], by_dbnum: { "24383": [] }, total_count,
truncated_results, result_cap: 100000, center, radius, shape }`。

`GET /api/v1/spatial/negative-nouns`：`{ nouns: [...] }`，直接吐 `TOTAL_NEG_NOUN_NAMES`。

### 3.2 后端流水线（新模块 `src/fast_model/spatial_query.rs` + `handlers.rs` 三个 handler）

1. `resolve_identity` → 参数校验（radius 范围、二选一、per_page 钳位）。
2. `spatial_state::ensure_spatial_ready()`；Err → 503 `spatial_not_ready`；`ReadyEmpty` → 直接回空结果。
3. 解中心：
   - 点模式：`(x,y,z)`；`center.source = "position"`。
   - refno 模式：`ModelMemoryStore::global()` 里 `source_refno == target || ancestors.contains(packed(target))`、
     `mesh_id` 非空、盒可用的记录并成 AABB（同 `query_service.rs` L750-783 `spatial_bounds` subtree 口径）；投影里没有 →
     `GLOBAL_AABB_TREE.read().await.entries_of(refno)`（P0 新增只读 API）；都没有 → 404。`center.source = "refno_aabb_center"`。
4. 候选（持读锁期间只 `collect()` 成 `Vec<RStarBoundingBox>`，随即放锁；不在持锁时补属性、不 await）：
   - 点 + sphere：`query_within_distance(center, r)`，距离即 `sqrt(distance_2)`；
   - 点 + cube：`locate_intersecting_bounds(&Aabb(center ± r))`；
   - refno 目标：`locate_intersecting_bounds(&target.外扩 r)`，sphere 再按 AABB-AABB 最小距离 `≤ r` 过滤；
   - 候选上限 `candidate_cap = 200000`，超出置 `truncated_candidates`。
5. 过滤顺序：`include_self` → 负实体 → `dbnums` → 记 `filter_options.nouns` 计数 → `nouns` → `keyword`。
6. 补属性：`dbnum` 先取 `ModelMemoryStore` 记录，缺则 `state.direct_tree.get().await?.dbnum_of(refno)`（`direct_tree.rs` L248）；
   `name` 见 §5-2（推荐：只对本页补，`DirectTreeService::name_of` 新增）。
7. 排序 → 全集 `groups`（按 dbnum）→ 切页。
8. `/nearby/refnos` 复用 1-5，跳过 6-7，`result_cap = 100000`。

距离辅助（放 `spatial_query.rs`，纯函数，单测钉住）：

```rust
/// AABB 到 AABB 的最小表面距离：逐轴 max(0, a.min - b.max, b.min - a.max) 的欧氏范数。
fn aabb_min_distance(a: &Aabb, b: &Aabb) -> f32
/// AABB 到点：parry3d `Aabb::distance_to_local_point(p, true)`，与 rstar `distance_2` 的 sqrt 一致。
fn aabb_point_distance(a: &Aabb, p: &Point<f32>) -> f32
```

### 3.3 一致性口径

- 树无 tube：与旧 sqlite 索引同；前端 `queryLocal` 会把已加载的 tubi 当「已加载但不在索引」补入，行为不变。
- 单位 mm、f32、世界坐标；`__dtxLayer.getGlobalModelMatrix()` 非单位阵时拾取点与 `center` 回显的偏差需在真实站点核一次
  （上一版分析 B4，本计划 §7 验收项 6）。
- 覆盖面是「已生成过模型的构件」：gen-model-v1 按需生成，没 `ensure` 过的构件不在树里。前端在 v1 源下于结果区提示
  「结果仅含已生成模型的构件」，并给「整库生成」入口（`collectDbnum` 已有）。

### 3.4 前端端口与适配

```ts
// src/model-source/ports.ts
export type SpatialSource = {
  nearby(params: SpatialNearbyParams): Promise<SpatialNearbyResult>;      // = genModelSpatialApi 现有形状
  nearbyRefnos(params: SpatialNearbyParams): Promise<SpatialNearbyRefnosResult>;
  negativeNouns(): Promise<string[]>;
  /** v1 源无专业维度；抽屉据此隐藏专业筛选 / 专业分组 */
  readonly capabilities: { specValues: boolean };
};
export type ModelSource = { /* …现有五个端口… */ readonly spatial: SpatialSource };
```

- legacy：`model-source/legacy/spatialSource.ts` 零逻辑委托 `queryNearbySpatial / queryNearbyRefnos / fetchNegativeNouns`，
  `capabilities.specValues = true`。
- gen-model-v1：`model-source/genModelV1/spatialSource.ts` → `genModelV1Api.ts` 新增 `genModelV1SpatialNearby /
  genModelV1SpatialNearbyRefnos / genModelV1SpatialNegativeNouns`；映射：refno `fromV1Refno` 归一 `a_b`；`spec_value` 置 0；
  `filter_options.spec_values = []`；`groups` 直接透传 dbnum 分组；`spatial_not_ready` → `GenModelV1ApiError.isRetryable`。
- `useSpatialQuery.ts`：新增 `options.queryNearbyRefnos`；四个默认值改为 `getModelSource().spatial.*`；
  `batchLoadSpatialQueryRefnos` 在 `getModelSourceKind() === 'gen-model-v1'` 时跳过 parquet 分支、把 `generateMissingRefnos`
  换成 `getModelSource().records.instanceEntriesByRefnos(dbno, refnos)`（内部 ensure → records）后再走 `loadRefnosBySource`；
  结果自带 `dbnum` 时优先用它分桶，缺失才 `getDbnumByRefno`。
- `SpatialQueryDrawer.vue`：读 `spatial.capabilities.specValues`，为 false 时隐藏专业 chips、`specThenDistance` 排序项与
  「加载本专业 / 仅显示本专业」，分组标题改「按库（dbnum）」。

## 4. 分阶段任务

每阶段独立可合、可回退；P0 → P1 → P2 → P3 顺序有依赖，P4 与 P3 并行。

**排期前置**：gen-model-refactor 与 old-aios-core 当前有并行会话的迁移改动在飞（见文头），P0 / P1 动工前先与其对齐或等其收口；
P2 只碰 plant3d-web，可以先行。P1 的新代码集中在新模块 `spatial_query.rs` + 三条路由 + 三个 handler，**不改**
`query_service.rs` 的 tool 表（避开并行会话正在改的 `room`），`direct_tree.rs` 只在文件末尾追加 `name_of`。

### P0 — `AccelerationTree` 只读辅助（vendor/old-aios-core）

- 交付：`pub fn entries_of(&self, refno: RefU64) -> &[RStarBoundingBox]`（走 `refno_index`，先 `ensure_refno_index` —— 需
  `&mut self` 或改为在 `load / sync_refnos / replace / remove_by_refnos` 后索引恒新鲜；推荐后者：删掉 `DerefMut` 触发的
  `usize::MAX` 懒重建路径以外的场景都已同步维护，`entries_of` 取 `&self` 时若 `indexed_tree_len != tree.size()` 退化为线性扫描
  并 `debug_assert!`）。
- 验收：单测 `entries_of_returns_all_boxes_of_a_refno_and_nothing_else`；`bincode` 兼容测试 `refno_index_keeps_legacy_bincode_compatible`
  继续通过（不新增序列化字段）。
- 文件：`vendor/old-aios-core/src/accel_tree/acceleration_tree.rs`。

### P1 — 后端 `/api/v1/spatial/*`（gen-model-refactor）

- 交付：`src/fast_model/spatial_query.rs`（参数结构、`resolve_center`、`collect_candidates`、`filter_sort_page`、两条距离函数）；
  `handlers.rs` 新增 `spatial_nearby / spatial_nearby_refnos / spatial_negative_nouns`；`web_service/mod.rs` 三条 `.route`；
  `ApiError` 新增 `spatial_not_ready`（503 + `Retry-After`）；spec §4.13。
- 验收：
  - 单测（纯函数）：`aabb_min_distance` 相交为 0 / 轴向分离 / 对角分离；点 + sphere 的距离等于 rstar `distance_2` 的 sqrt；
    `include_self` 剔除子树；负实体过滤；分页 `has_more` / `total_count`；`groups` 为全集计数。
  - 集成（`#[tokio::test]`，走 `evict_tree_entries_for_test` 同款准备，独占一组 `4000000011/*` refno；
    `mark_spatial_tree_fixture_preloaded` 置 Ready）：sphere 与 cube 候选集差异、`ReadyEmpty` 回空、`Rebuilding` 回
    `spatial_not_ready`。
  - 源码钉：新模块与 handler 不含 `GLOBAL_AABB_TREE.write()`（白名单测试自动覆盖）、不含 `lock_spatial_serial`。
  - `cargo test -p <crate> spatial_query` 与 `cargo clippy` 干净。
- 文件：`src/fast_model/{mod.rs, spatial_query.rs}`、`src/web_service/{mod.rs, handlers.rs}`、`docs/specs/web-service-api.md`。

### P2 — 前端端口 + legacy 委托（plant3d-web）

- 交付：`ports.ts` 加 `SpatialSource` 与 `ModelSource.spatial`；`legacy/spatialSource.ts`；`useSpatialQuery.ts` 新增
  `options.queryNearbyRefnos` 并把四个默认值改为经 `getModelSource().spatial`。
- 验收：`useSpatialQuery.test.ts` 17 个用例不改断言全绿；新增 1 个用例钉「默认值来自 `getModelSource().spatial`」；
  `pnpm vitest run src/composables/useSpatialQuery.test.ts src/model-source`；`vue-tsc --noEmit` 干净。
- 文件：`src/model-source/{ports.ts, index.ts, legacy/index.ts, legacy/spatialSource.ts}`、`src/composables/useSpatialQuery.ts`。
- **完成备注（2026-09-13）**：
  - `negativeNouns()` 回 `NegativeNounsResult`（`{success, nouns}`）而不是本节草案的 `string[]`——沿用 `ports.ts` 文头的既定原则
    「端口形状等于现有 legacy 函数的形状，legacy 适配器零逻辑」，`useSpatialQuery.ensureNegativeNounsLoaded` 也因此一行不改；
    v1 适配器（P3）把 `{nouns}` 包成 `{success:true, nouns}` 即可。
  - store 里四个默认值按**调用时刻**解析 `getModelSource().spatial`（`getModelSource()` 每次读 URL 开关），函数签名保持
    `queryNearbyByPosition(x,y,z,r,opts)` / `queryNearbyByRefno(refno,r,opts)` 的便捷形状，参数展开与 `genModelSpatialApi.ts`
    的两个便捷函数逐字相同；新增 `options.queryNearbyRefnos` 注入点，`fetchFullMatches` 改走它。
  - `ModelSource.spatial` 是必填端口，P2 阶段 `genModelV1/index.ts` 先挂 `legacySpatialSource`（= 改前 v1 源下抽屉直连旧后端
    `/api/sqlite-spatial/*` 的行为，**零行为变化**），P3 换成 `/api/v1/spatial` 适配器。
  - 顺带导出 `__resetNegativeNounRegistryForTests()`：负实体注册表是模块级单例，新增用例要断言 `negativeNouns()` 被调用、
    既有 17 个用例之间也不再靠执行顺序共享注册表。
  - 验证：`npx vitest run src/composables/useSpatialQuery.test.ts src/model-source src/components/spatial-query` → 11 文件 149 用例全绿
    （`useSpatialQuery.test.ts` 17 → 18，`model-source/index.test.ts` 11 → 12，新增「legacy `spatial` 三方法原样转发 + `specValues:true`」）；
    `node scripts/type-check.mjs` 前后同为「587 条 / 基线 620 / 新增 7 / 消失 40」，7 条新增全部来自 HEAD `9d34701` 快照里的
    测量 / DTX 文件（`useDtxTools.*.test.ts`、`useXeokitMeasurementTools.ts`、`pickDerivation.test.ts`），stash 掉本切片后重跑数字一致，
    与本切片无关；`npx eslint` 改动文件 0 错。

### P3 — gen-model-v1 适配器（plant3d-web）

- 交付：`genModelV1Api.ts` 三个函数 + 响应类型；`genModelV1/spatialSource.ts` 映射；`genModelV1/index.ts` 装配。
- 验收：映射用例（refno 归一、`spec_value` 缺省 0、`groups` 透传、`spatial_not_ready` 分型为 retryable、`not_found` 分型）；
  与 P1 真服务联调一次（§7）。
- 文件：`src/api/genModelV1Api.ts`、`src/model-source/genModelV1/{index.ts, spatialSource.ts}` 及对应 `*.test.ts`。
- **完成备注（2026-09-13，代码 + 单测；真服务联调待 P1）**：
  - `genModelV1Api.ts`：`genModelV1SpatialNearby / genModelV1SpatialNearbyRefnos / genModelV1SpatialNegativeNouns`（GET，参数进 query，
    refno 经 `toV1Refno`，`nouns / dbnums` 逗号拼接，`nearby/refnos` 不发 `page / per_page`）+ 响应 DTO（`SpatialNearbyResponse` 等，
    与 §3.1 逐字段）；`GenModelV1ErrorCode` 新增 `spatial_not_ready`，并入 `isRetryable`。
  - `genModelV1/spatialSource.ts`：入参 `x,y,z → position`、`nouns` 拆数组、`sort=spec_distance → distance`、`spec_values` 丢弃、
    `per_page ?? max_results`；出参 refno 归一 `a_b`、`spec_value` 一律 0、`filter_options.spec_values = []`、盒三元组转 `{x,y,z}`。
  - **专业 `groups` 不给**（v1 没有专业维度，store 现有 `buildGroups` 会把本页全部归到 spec 0「其他」一组，翻页计数仍以
    `total_count` 为准）；服务端的 dbnum 分组放进 legacy 结果类型新加的可选格 `dbnum_groups`，连同 `results[].dbnum` /
    `coverage` / `spatial_state` 一起带出——这四格是 `genModelSpatialApi.ts` 类型上的**可选新增**，legacy 服务端不给也不影响；
    P4 按 `capabilities.specValues === false` 改按库分组、优先用 `results[].dbnum` 分桶、按 `coverage` 提示「仅含已生成模型的构件」。
  - 错误：refno 模式 `not_found` 折成 `{success:false, error:"构件 X 还没有生成过模型…请先显示该构件"}`（§5-3 按 (a)，store 会把它当
    查询失败显示）；其余 `GenModelV1ApiError` 原样抛出，`spatial_not_ready`（503 + `Retry-After`）`isRetryable === true`，P4 据此提示重试。
  - 验证：`npx vitest run src/composables/useSpatialQuery.test.ts src/model-source src/api/genModelV1Api.test.ts src/api/genModelSpatialApi.test.ts
    src/components/spatial-query` → 14 文件 186 用例全绿（新增 `spatialSource.test.ts` 7 例、`genModelV1Api.test.ts` +4 例、
    `model-source/index.test.ts` 的 v1 用例补「spatial 不碰旧后端、specValues:false」）；`node scripts/type-check.mjs` 本切片文件 0 新增
    （此刻工作树里并行会话正在改测量 / 尺寸标注文件，新增的 `dtxDimensionSnapPort.ts|TS2741` 等 8 条均在那些文件里，与本切片无关）；
    `npx eslint` 改动文件 0 错。§7 第 3 / 5 步（真服务 + 浏览器）**未验证**，等 P1 落地后一并做。

### P4 — 批量加载与抽屉 UI（plant3d-web）

- 交付：`batchLoadSpatialQueryRefnos` 的 v1 分支（跳 parquet、缺失走 `records.instanceEntriesByRefnos`、优先服务端 `dbnum`）；
  `SpatialQueryDrawer.vue` 按 `capabilities.specValues` 隐藏专业 UI、分组标题改库；结果区「仅含已生成模型的构件」提示 +
  「整库生成」入口。
- 验收：既有批量加载用例（代理盒兜底、按 dbnum 分组）在 legacy 下不变；新增 v1 分支用例（不调 parquet / SSE，调
  `records.instanceEntriesByRefnos`）；抽屉在两种源下的快照或 DOM 断言各 1 个。
- 文件：`src/composables/useSpatialQuery.ts`、`src/components/spatial-query/SpatialQueryDrawer.vue`、对应测试。

### P5 — 文档与收口

- 交付：plant3d-web `docs/guides/SPATIAL_QUERY_TUTORIAL.md` 补「gen-model-v1 源」一节（覆盖面、无专业、503 重试）；
  本计划状态改「已实施」并记录两仓提交 SHA；spec §4.13 定稿。
- 验收：§7 清单逐项打勾。

## 5. 需要拍板的决策（推荐项在前）

1. **专业维度**：(a) v1 源下隐藏专业筛选 / 分组，按 dbnum 分组【推荐】；(b) 后端按 noun → 专业规则派生（PIPE/BRAN → 管道，
   CABLE/CWAY → 电气，HVAC → 暖通，…）并在 `results[].spec_value` 回填。(b) 需要产品口径，另起切片。
2. **`name` 与 `keyword`**：(a) `keyword` 只匹配 refno / noun，`name` 只对本页补（新增 `DirectTreeService::name_of`，
   读 `named_attmap("NAME")`，上限 `per_page ≤ 1000`）【推荐】；(b) `keyword` 也匹配 name —— 要对全部候选读记录，大半径下秒级，不建议。
3. **refno 模式中心缺失**：(a) 404 `not_found`，前端提示「先显示该构件」【推荐】；(b) 接口内隐式 `ensure` —— 把生成塞进查询会让
   一次 GET 挂 120 s，且与 `model/ensure` 的忙根 / 冲突语义重复。
4. **距离查询 Tab 是否也走 refno 模式**：(a) 是，refno 发服务端、按源构件表面 → 候选表面量距、`include_self=false`【推荐，
   与现状一致】；(b) 前端先取 AABB 中心再按点查 —— 与范围 Tab 合流但改变现有语义。
5. **`ModelMemoryStore`-only 盒**：(a) 第一版不覆盖，响应带 `coverage:"global-tree"`【推荐】；(b) 对 `ModelReadRoute::Memory`
   的库补扫 `room_spatial[dbnum]` —— 需要把 `room_members_intersecting` 改成返回盒的 pub(crate) 变体、且要处理 tube 在树 /
   不在树的口径差。
6. **是否做服务端扫描快照缓存**：(a) 不做，每页重扫【推荐】；(b) 仿旧后端 60 s / 8 份 —— 键含树 epoch，需要新增可读的
   epoch 计数器。

## 6. 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| 大半径（100 m）全库候选拖慢 handler | `candidate_cap` + `truncated_candidates`；读锁期间只 collect | 调低默认上限 |
| 持读锁期间阻塞写侧收敛 | 候选 collect 是 ms 级；不在持锁时补属性 / await | 无需回退 |
| `entries_of` 触发 `refno_index` 懒重建语义变化 | P0 保持 `&self` 只读、索引过期时线性扫描 + `debug_assert!` | 移除 `entries_of`，refno 模式只用投影解中心 |
| v1 源下结果比 legacy 少（未生成构件） | UI 提示 + 整库生成入口 | 用户切 `?model_source=legacy` |
| 两仓在飞改动被卷入 | 后端历史在飞改动已提交（`f888e9dc2`）；变更文件清单固定在 §4，逐阶段单独提交 | 逐阶段 revert |
| 与并行会话的迁移改动撞文件（`query_service.rs` / `direct_tree.rs` / vendor `Cargo.toml`） | P0 / P1 排在其收口之后；新代码走新模块与末尾追加；若已入协同组，改前 `acquire_file_lock` | 只保留 P2 前端端口切片，后端切片顺延 |

## 7. 验收 / 联调步骤（命令请在你自己的终端跑；后端服务是长驻进程，本会话不代跑）

1. 后端：`cd D:\work\plant-code\old\gen-model-refactor && cargo test spatial_query && cargo clippy --all-targets`。
2. 起服务（默认 `spawned-mem`）：`cargo run --bin <服务 bin> -- serve`（按仓内 readme 的启动方式），
   `GET /api/v1/health` 看 `spatial_tree.state`。
3. 先 `POST /api/v1/model/ensure` 任一 BRAN，再 `GET /api/v1/spatial/nearby?refno=<a/b>&radius=5000` 与
   `…?x=&y=&z=&radius=5000&shape=cube`：`results[0]` 应为最近构件、`dbnum` 非空、`groups` 与 `total_count` 自洽。
4. 树未 Ready（启动瞬间或 `AIOS_SPATIAL_COMPUTE=0`）时同一请求返回 503 `spatial_not_ready` + `Retry-After`。
5. 前端：`pnpm vitest run src/composables/useSpatialQuery.test.ts src/model-source && pnpm vue-tsc --noEmit`；
   `?model_source=gen-model-v1` 下抽屉两 Tab 各查一次、翻页、全部显示 / 隔离 / 加载本页；`?model_source=legacy` 下同样操作结果与改前一致。
6. 真实站点核 `getGlobalModelMatrix()`：拾取一构件表面点查 1 m，`center` 回显与该构件在结果首位。

## 8. 关键位置速查

后端（行号以 `gen-model-refactor@8f99cbc64` + 10:30 工作树为准）：`vendor/old-aios-core/src/room/room.rs` L12；
`src/accel_tree/acceleration_tree.rs` L25-95 / L299-332；`gen-model-refactor/src/fast_model/aabb_tree.rs` L18 / L48 / L619 / L942 / L2073；
`spatial_state.rs` L88 / L250；`model_memory_store.rs` L88 / L253-267 / L551 / L671 / L833；`query_service.rs` L230 / L727；
`web_service/mod.rs` L396-472；`handlers.rs` L37 / L1067 / L2496 / L2634；`direct_tree.rs` L248 / L256 / L266；
`model_db_adapter.rs` L876 / L1579；`model_read_route.rs` L250；`options.rs` L895 / L1307；`docs/specs/web-service-api.md` §4.10-4.12。

前端：`src/model-source/{ports.ts, index.ts, genModelV1/index.ts, legacy/index.ts}`；`src/api/genModelV1Api.ts`；
`src/api/genModelSpatialApi.ts`；`src/composables/useSpatialQuery.ts` L92-102 / L584 / L672 / L914 / L1241；
`src/components/spatial-query/SpatialQueryDrawer.vue`；`src/types/spatialQuery.ts`；`src/composables/useSpatialQuery.test.ts`。
