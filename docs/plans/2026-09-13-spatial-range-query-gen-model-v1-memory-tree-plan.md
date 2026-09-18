# 「按范围查找」接 gen-model-refactor 内存空间树开发计划

- 日期：2026-09-13
- 状态：**已实施（2026-09-13 21:10；Plannotator 第 2 轮 `approved` 10:38）**，§5 六项均按推荐项 (a)；
  **§7 第 1–6 步已核**（第 2–3 步 22:03 在真服务 `127.0.0.1:18122` 上过；第 4 步的 503 信封以单测钉住，线上因树一直 Ready 复现不了；
  第 5 步后半 v1 源 22:32 在 headless Chrome 里对着 `:3101` dev server 走完，legacy 源因 `:3100` 是 detached 运行时（`sqlite-spatial` 404）
  做不了；**第 6 步 22:40 核出 B4 成立**——`当前选中` / `拾取中心` 把场景坐标（m、已重心化）当 mm 发给服务端，基线 `9d34701` 就如此，
  见 §7 联调记录；**用户 22:49 拍板按建议修，23:57 已修（plant3d-web `00beb54`）并在真机复核通过**）
  - 提交清单：old-aios-core `8758023`（P0）；gen-model-refactor `12bf601e9`（P1 路由 + 模块 + 单测）、`69f732e6b`（spec §4.13）、
    `dec2c67d8`（§7 第 4 步：`spatial_not_ready` 503 信封单测）；
    plant3d-web `8127bcb`（P2）、`12c66fe`（P3）、`610581f`（P4）、`fb8b841`（P0 / P1 备注）、`0152256`（P5 = 教程 §9 + 状态行）、
    `cd05652` / `73f8ce8`（§7 联调记录）、`00beb54`（B4 修复 + 6 条单测）、`d521332`（B4 修复记录）、
    `2578ca8`（「加载当前页」改为只动当前页）、`05d5b5f`（「只加载未加载」改回全集）、`73b8d8c`（跨页三按钮 > 200 项弹确认）、
    `11d21e8`（`getSubtreeAABB`：「当前选中」取子树盒）、`12ac0f7`（没加载几何的 owner 发 refno 由服务端解中心）、
    `d521332` / `ae5bfb6` / `6767ff7` / `9e1aaa6` / `0e36728` / `6533df1`（以上各步的计划 + 教程记录）、本交接说明 = 本提交
  - **交接说明（2026-09-13 23:5x – 09-14 01:2x 这一段，plant3d-web 上 7 个代码提交 + 7 个文档提交，用户逐条拍板，全部真机复核）**：
    1. **B4 修复**（`00beb54` + 记录 `d521332`）：`useSpatialQuery.ts` 新增 `resolveSceneWorldTransform(viewer)`（读 `__dtxLayer.getGlobalModelMatrix()`，
       缺失 / 单位阵 / NaN / 不可逆退恒等）；口径定为 **store 内一律 E3D mm**，只在读查看器（选中盒、拾取 worldPos、本地扫描的盒 → mm）与写查看器
       （飞向结果 bbox、代理盒缓存 → 场景）两个边界换算，抽屉不用改。单测 +6。真机：选中 FLOOR 17496_100380 查 1 m 请求 `x=0&y=0&z=450`、
       `results[0]` 即自身（验收项 6 原文通过）。共识落库 zhimo `d-344`。
    2. **「加载当前页」只动当前页**（`2578ca8` + `ae5bfb6`）：`loadResults` / `pickResultItems` / `resolveBatchRefnos` 加 `pages?: 'current' | 'all'`；
       1387 项下 13 s 收工（改前 3 分钟没回来）。**「只加载未加载」先跟着改按页、随后按用户拍板改回全集**（`05d5b5f` + `6767ff7`）——
       它的语义是「把命中集合里没加载的都补上」，跨页；分组「加载本库 / 本专业」、全部显示、隔离也都是全集。§2 目标 1 那句「加载本页语义不变」作废。
    3. **大数量确认**（`73b8d8c` + `9e1aaa6`）：store 加 `countLoadTargets(options)`（与 `loadResults` 同一套取法）；抽屉里「只加载未加载」与分组
       「加载本库 / 本专业」在 `count > 200` 时走全局 `ConfirmDialog`（「加载数量较多 / 「…」将加载 N 个模型（超过 200 个）… / 取消 · 加载 N 个」），
       不超过同步直跑；「加载当前页」不设门。真机：1387 项弹「加载 1376 个」、取消 0 请求；库 7997 弹「加载 1346 个」；库 1112（41 项）不弹。
    4. **BRAN 盒中心差 295 / 573 mm 的追查**（记录 `0e36728`，记忆 zhimo `mem-371`）：不是换算错——查看器 `getAABB([refno])` 只并该 refno 自己的对象，
       DTX loader 把 TUBI 挂在 owner BRAN 的 refno 下、成员各有 refno，所以 BRAN 的盒 = 管子盒；服务端 refno 模式 = 子树并集（spec §4.13）。
       `/api/v1/model/records` 22 条 = 11 TUBI + 9 ELBO + OLET + VALV，差的正是 VALV 24381_145035 那一块的一半。
    5. **方案 2：`DtxCompatScene.getSubtreeAABB`**（`11d21e8`）：自己的对象 ∪ loader `resolveDtxObjectIdsByUnitRefno`（沿 owner 链）的盒并集，
       `applyCurrentSelection` 先取它、取不到退回 `getAABB`；`getAABB` 语义不动。新测试文件 `src/viewer/dtx/DtxCompatScene.getSubtreeAABB.test.ts`
       4 条 + store 1 条。真机：BRAN 当前选中请求 `x=5963.7737&y=9972.2395&z=16551.9712` = 服务端 `refno_aabb_center` 逐位相等。
    6. **方案 3 作兜底：没加载几何的 owner 发 refno**（`12ac0f7` + `6533df1`）：`selectedCenterRefno` 标记，请求带 `refno` + `includeSelf:false`
       走服务端 refno 模式（到源盒表面量距、剔自身子树），`center` 回来写回 `draft.center`；抽屉摘要「<refno> · 未加载几何，查询时由服务端解中心」。
       真机：模型树点选 PIPE 24381_144975 → 200，center 同 BRAN 的子树中心，共 1753 项。
    - **仍开着的**：§7 第 5 步 legacy 对拍要一台带 sqlite 空间索引的完整 `plant-web-server`（`:3100` 是 detached）；成员部分加载时子树盒仍不全；
      子树里一个都没生成过的 owner 仍是服务端 404 折成的「…还没生成过模型」提示。真机脚本（选中中心 / 叶子 / owner 兜底 / 加载当前页 / 确认框 / BRAN 盒）
      都在 `%TEMP%\spatial-ui-*.mjs`，没进仓；要作回归得整理成 `e2e/spatial-query-*.spec.ts`。别人的在飞文件（测量 / 尺寸系统）一个都没碰。
    - 最终状态：`vitest` useSpatialQuery 29 / SpatialQueryDrawer 22 / getSubtreeAABB 4 / spatialSource 7 / realBranHelper 6 全绿；`eslint` 0；
      `type-check` 基线之外只剩别处在飞改动带来的 5 条 `useDtxTools.*.test.ts`。
  - 进度：**P2 已完成**（2026-09-13 11:45，plant3d-web `8127bcb`）；**P3 代码与单测已完成**（11:53，`12c66fe`；真服务联调等 P1）；
    **P4 已完成，「整库生成」入口除外**（12:05，单独一提交，见 §4 P4 备注——入口怎么接需要拍板；用户 12:13 拍板：先不接入口）；
    **P0 已完成**（old-aios-core `8758023`，21:03；代码 20:40 已在工作树、本轮验证后提交）；**P1 已完成**（gen-model-refactor
    `12bf601e9` 路由 + 模块 + 单测，15:45；spec §4.13 `69f732e6b`，21:03）；**P5 已完成**（21:10，教程 `SPATIAL_QUERY_TUTORIAL.md` 新增 §9
    「gen-model-v1 数据源下的差别」+ §5 / §6 / §7 / 注意事项各一句指过去）
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
   合并 / 翻页 / 全部显示 / 隔离 / 加载本页的现有语义不变。（「加载本页」一条后来作废：它原本加载的是全集，用户 2026-09-14 拍板改成
   真的只加载当前页，`2578ca8`，见 §7 联调记录「既有口径」一条。）
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
  （上一版分析 B4，本计划 §7 验收项 6）。**已核实为真并修复（`00beb54`）**：`useSpatialQuery.ts` 新增 `resolveSceneWorldTransform`，
  `draft.center` / 请求 / 结果项一律 mm，只在读查看器（选中盒、拾取点、本地扫描的盒 → mm）与写查看器（飞行盒、代理盒 → 场景）两个边界换算。
- 「一个 refno 的盒」口径：查看器 `getAABB([refno])` 只并该 refno 自己的对象（BRAN 即隐含管子，成员各有 refno），服务端 refno 模式是子树并集；
  「当前选中」为与服务端同口径改走 `getSubtreeAABB`（`11d21e8`，见 §7 B4 修复记录末条）。
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
- **完成备注（2026-09-13，old-aios-core `codex/libgm-snout-caliber@8758023`）**：
  - 签名取 `Cow<'_, [RStarBoundingBox]>` 而不是 `&[…]`：索引新鲜时 `Borrowed` 零拷贝，过期时线性扫描要 `Owned`。
  - **不 `debug_assert!`**（与本节草案不同）：直接 `bincode::deserialize` 出来的树（`#[serde(skip)]` 让索引落成空表——快照复用
    启动正是这条路）到第一次写树之前索引一直是过期的，断言会让 debug 构建的服务在第一条按 refno 的查询上崩掉；过期时静默退化为
    O(n) 扫描，结果仍正确，写路径下一次 `ensure_refno_index` 治愈。
  - 用例两条：草案那条 + `entries_of_falls_back_to_a_linear_scan_while_the_index_is_stale`（反序列化、绕过 API 直插 `tree`、
    再经 `sync_refnos` 治愈三段都断言）。
  - 验证：`cargo test --lib entries_of` 2 passed、`cargo test --lib refno_index_keeps_legacy_bincode_compatible` 1 passed；
    只按路径 `git add` 了 `acceleration_tree.rs`，并行会话的 `Cargo.toml`（rkyv `validation`）/ `pdms_shape.rs` 仍留在工作树。

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
- **完成备注（2026-09-13，gen-model-refactor `12bf601e9` 代码 + 单测 15:45、`69f732e6b` spec §4.13 21:03）**：
  - 与草案的几处取舍：
    1. 503 不加在 `ApiError` 上，而是 `handlers::SpatialApiError { Api(ApiError), NotReady(SpatialTreeState) }` 单独成型——
       `ApiError` 的统一信封把 `detail` 写死为 `null`、也不带响应头，而 `spatial_not_ready` 要 `Retry-After: 5` 与
       `detail.state`；不去改十几处构造点。
    2. query 参数全部按字串收（`RawSpatialQuery`，`serde(flatten)` 进 `SpatialNearbyReq`）、`SpatialQueryParams::parse` 自己解：
       axum 的 urlencoded 在 `flatten` 下把值先缓冲成字串，数字字段直接标 `f32` / `usize` 会报「invalid type: string」；自己解还能
       给中文 400 消息。
    3. 集成用例不碰全局树：`scan_tree(tree, state, params, memory)` 把树与状态都做成入参，用例用本地 `AccelerationTree` +
       显式 `Rebuilding` / `ReadyEmpty`，不需要 `evict_tree_entries_for_test` / `mark_spatial_tree_fixture_preloaded`；
       refno 组仍独占 `4000000011/*`。
    4. `sort=name` 只对本页解名字，全集按 noun、refno 作近似序（§5-2 按 (a) 的直接后果，写进 spec）。
    5. `direct_tree.rs` 末尾追加 `name_of`（读 `named_attmap("NAME")`，与 `noun_of` 同代价、只按页调）。
  - 单测 16 条（`fast_model::spatial_query::tests`）：两条距离函数、参数默认值与两种 refno 写法、坏参数报错、状态门禁、
    sphere / cube 角落差异、refno 目标盒到盒量距 + 默认剔子树、中心缺盒 404、中心来自投影并覆盖子树、负实体与 noun 计数顺序、
    排序 / 分组 / 分页 / 只给本页补名、同距按 dbnum → refno、`/refnos` 全集按库分组、候选上限截断、负实体清单去重、
    源码钉「不写树、不取串行锁」；`web_service::tests::spatial_routes_are_read_only_get_endpoints` 钉三条都是 GET。
  - 验证（21:00，工作树含并行会话 20:54 的合并 `655285ce8`）：`cargo test --lib spatial` **39 passed**（含上述 17 条 + 既有
    `spatial_state` / `aabb_tree` 等）；`cargo clippy --lib --tests` exit 0，P1 五个文件 0 警告（剩余警告全在既有 bin / tests）。
    §7 第 2–4 步（起服务、`/model/ensure` 后 `GET /spatial/nearby`、未 Ready 回 503）**未验证**——服务是长驻进程，等用户起。
  - 现场备注：`12bf601e9` 之后并行会话的合并把 `spatial_query.rs` 等 9 个文件的工作树 EOL 翻成 CRLF（`git diff -w` 为空、
    `git ls-files --eol` 见 `i/lf w/crlf`），内容无差，本轮没碰。

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
- **完成备注（2026-09-13；「整库生成」入口未做，见末条）**：
  - 批量加载 v1 分支**比本节草案少一步**：代码真值是 `loadDbnoInstancesForVisibleRefnosDtx`（`useDbnoInstancesDtxLoader.ts` L757-771）
    在页面开关为 v1 时已把 `dataSource` 改写成 `gen-model-v1` 并自己调 `records.instanceEntriesByRefnos`（内部 ensure → records），
    所以 store 里 `loadRefnosBySource(...,'backend')` 这一步就是 ensure → records，不必再单独调一次；v1 分支只需**跳过 parquet
    探测与旧后端 SSE 生成**，backend 加载后仍缺的就是「没有可渲染几何」，交给既有的 AABB 代理兜底。
  - 结果自带 `dbnum` 优先分桶：`BatchLoadOptions.dbnumByRefno`（store 从本页条目的 `dbnum` + 全集 `by_dbnum` 汇成，legacy 下
    条目没有 dbnum 时只有全集那份），`batchLoadSpatialQueryRefnos` 先查它、缺失才 `getDbnumByRefno`。
  - store 新增：`spatialCapabilities`（`getModelSource().spatial.capabilities`）、`resolveBatchRefnos / loadResults({dbnum})`、
    `showOnlyDbnumGroup(dbnum)`；结果集带 `items[].dbnum`、`dbnumGroups`、`coverage`；范围查询默认排序在无专业维度时由
    `specThenDistance` 退到 `distanceAsc`（否则 v1 下抽屉高亮着一个不存在的「按专业」）。
  - 抽屉按 `spatialCapabilities.specValues`：隐藏专业过滤块与「按专业」排序档；结果分组抽象成 `DisplayGroup{kind:'spec'|'dbnum'}`，
    v1 下按库分组（组头「库 24381」、小计取服务端 `dbnumGroups` 全量计数、全集有而本页无的库也露组头）、按钮改「加载本库 / 仅显示本库」；
    摘要 / 空态文案随维度切换；`coverage === 'global-tree'` 时结果区顶部提示「结果仅含已生成过模型的构件…先显示它们再查会被纳入」。
  - **未做：「整库生成」入口。** 整库显示的实现 `showModelByDbnum` 在 `useModelGeneration(options)` 里，实例由 `ViewerPanel.vue`
    持有（`modelGenerationRef`），今天只有 URL `?show_dbnum=` 一条路触发；抽屉要接它，得要么走 `useViewerContext` 那种
    `window` 事件 + ViewerPanel 侧 handler（照 `showModelByRefnos` 的先例，要改 4000 行的 ViewerPanel），要么在抽屉里直接
    `getGenModelV1ModelSource().collectDbnum()` + 分批装 DTX（把 ViewerPanel 的整库装载策略再写一遍）。两条都不是本切片该自己定的，
    先只给提示文字；入口按拍板结果另起一小切片。
  - 验证：`npx vitest run src/composables/useSpatialQuery.test.ts src/model-source src/api/genModelV1Api.test.ts src/api/genModelSpatialApi.test.ts
    src/components/spatial-query` → 14 文件 190 用例全绿（store 18 → 20：v1 结果集 / 默认排序 / 按库作用域 / 仅显示本库、v1 缺省批量加载
    跳 parquet 与 SSE 且不逐个查库号；抽屉 18 → 20：legacy 与 v1 各一条 DOM 断言）；`node scripts/type-check.mjs` 本切片文件 0 新增
    （剩余 5 条新增全在并行会话正在改的 `useDtxTools.*.test.ts`）；`npx eslint` 改动文件 0 错。真服务 / 浏览器（§7 第 5 步）**未验证**，等 P1。

### P5 — 文档与收口

- 交付：plant3d-web `docs/guides/SPATIAL_QUERY_TUTORIAL.md` 补「gen-model-v1 源」一节（覆盖面、无专业、503 重试）；
  本计划状态改「已实施」并记录两仓提交 SHA；spec §4.13 定稿。
- 验收：§7 清单逐项打勾。
- **完成备注（2026-09-13 21:10）**：
  - 教程新增 §9「gen-model-v1 数据源下的差别」：legacy / v1 四处差别对照表（覆盖面、专业维度→按库分组、距离查询起点没生成过模型的
    404 提示、空间树未就绪的 503 提示）+ 不变口径（mm、形状、半径上限、关键字只匹配 refno / noun、负实体默认剔除、加载走 ensure → records）
    + 「先显示再查 / 整库显示」的提示；§5 专业筛选与关键字两行、§6 分组、§7 分组按钮、注意事项各加一句指向 §9；目录加第 9 项。
  - spec §4.13 已在 gen-model-refactor `69f732e6b` 定稿（P1 备注）。
  - §7 打勾情况：第 1 步（`cargo test` / `cargo clippy`）✅（见 P1 备注）；第 5 步前半（`vitest` / 类型检查）✅（见 P2–P4 备注）；
    **第 2–3 步 ✅（22:03，真服务，见 §7 联调记录）**；**第 4 步 ✅（单测口径）**：线上树一直 Ready，503 复现不了，改由
    gen-model-refactor `dec2c67d8` 的 `spatial_not_ready_is_a_503_with_retry_after_and_the_state_in_detail` 钉住六个非 Ready 状态的
    503 + `Retry-After: 5` + `detail.state`（门禁一侧原有 `scan_is_gated_by_the_spatial_state`）；**第 5 步后半 v1 ✅ / legacy ✗（环境）**、
    **第 6 步 ✅（核出 B4 成立，已修 `00beb54`，真机复核通过）**——都见 §7 联调记录。

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

**联调记录（2026-09-13 22:03，第 2–3 步）**：对象是已在跑的 debug 服务 `D:\Rust\target\debug\aios-database.exe`
（PID 62960，17:05 起、晚于 `12bf601e9`，`build_id 0.1.23+g0b73e51f6b04`，`127.0.0.1:18122`，AvevaMarineSample `/ALL`），
`health.spatial_tree` = `ready`、54 979 条、`file_epoch = db_epoch = 129`。树里已有 1112 / 7997 / 8000 三库的盒，没再 `POST /model/ensure`
（那台服务不是本会话起的，只发只读 GET）。脚本共 55 项断言、跑一遍 3 s，53 项直接通过，2 项是脚本假设写错
（目标同距排第 4 而非第 1；epoch 变动来自服务自身），逐条核过后结论：

- 点模式 sphere `(0,0,450) r=5000`：200 / 11 ms，`total_count 546 = candidate_count`，`groups` 1112:165 + 7997:379 + 8000:2 = 546，
  按距离升序、全部 `within_radius`、`dbnum` 无空、refno 一律 `a_b`；同参 cube 1135 ≥ 546，角落条目 `within_radius=false` 只在 `distance > r` 时出现。
- refno 模式 `17496/100380`（FLOOR，盒中心 `(0,0,450)`）：`a/b` 与 `a_b` 同 8057 条、`center.source = refno_aabb_center` 且坐标等于盒中心、
  默认不含自身、`include_self=true` 多出恰好 1 条且目标距离 0（同距按 dbnum、refno 兜底，目标排第 4，符合 spec 的全序）。
- `/nearby/refnos` 同参：546 条 = `/nearby` 的 `total_count`，`by_dbnum` 逐库计数 = `groups`，首条 = `results[0]`。
- `sort=name`：翻页不重叠；本页 20 条 `name` 全为 `null`（这些 PANE / FLOOR 在样例库里本就没有 NAME，`name_of` 口径一致）。
- 过滤：`nouns=pane` 大小写不敏感且 `total_count` = `filter_options` 里 PANE 的计数（235），`filter_options.nouns` 不因 `nouns` 收窄（20 = 20）；
  `dbnums=7997` 379 条 = 全集 `groups[7997]`；`keyword=24381/782`（`a/b` 写法）命中 1 条；`include_negative` 两种取值同 54 979
  （三库里没有负实体）；`per_page=5000` 钳到 1000。
- 错误分型全部命中：8 种参数错都是 400 `bad_request` 且 `message` 直说哪一格；`refno=1/1` 与 SITE `9304/2` 都是 404 `not_found`
  （「还没生成过模型」）；`project=Nope` 422 `identity_mismatch`；`negative-nouns` 23 个。
- 上限与耗时：100 m cube 在原点覆盖整树，`candidate_count 54 979 = entries`、未截断，`/nearby` `per_page=1000` 373 ms、`/nearby/refnos`
  54 979 条 434 ms。
- 只读旁证：跑完后 `entries` / `last_rebuild_attempts` 不变；`db_epoch` 129→130 是服务自己的 `write_behind` 持久化
  （`persist_attempts` 3→4、`initialization.epoch_id` 59→60、随后 `file_epoch` 也到 130、`drift=false`），epoch bump 只出现在
  `model_db_adapter` / `fast_delete` / `aabb_refresh` / `helper` / `window_repair` 的事务里，`spatial_query` 无写点
  （`spatial_query_never_writes_the_tree_or_takes_the_serial_lock` 钉住）。

**联调记录（2026-09-13 22:32，第 5 步后半）**：Playwright 1.58 + 本机 Chrome（headless，SwiftShader WebGL）对着已在跑的 Vite dev server
`127.0.0.1:3101`（plant3d-web 工作树）；页面 `?model_source=gen-model-v1&gm_backend_port=18122&show_refno=24381_145018`，
徽标「已连接 gen-model :18122」，`show_refno` 加载 12 refno / 22 对象。并行会话在改 plant3d-web，HMR 整页刷新会把查看器和抽屉一起拆掉，
脚本把 dev server 的 HMR websocket mock 掉才跑完（前两遍都被刷新打断）。

- **范围 Tab**（手输坐标 = BRAN 夹具盒中心 `(5642.7, 9188.4, 15979.0)`，5 m，每页 20）：请求
  `GET /api/v1/spatial/nearby?x&y&z&radius=5000&shape=sphere&sort=distance&include_negative=false&page=1&per_page=20` +
  `/nearby/refnos`（全集）+ `/negative-nouns`；结果区「共 1387 项，当前页 20 项」= 服务端 `total_count`，覆盖面提示可见，
  `spec-filter` 0 个（专业维度隐藏），分组「库 1112 | 库 7997」各带「加载本库 / 仅显示本库」；下一页发 `page=2`、首条换了；
  排序只剩「按距离 / 按名称」。
- **全部显示 / 隔离结果 / 加载当前页**（改 2 m → 16 项，`groups 7997:16`）：全部显示后 16 个结果对象都进场景并可见（原 240 → 255）；
  隔离结果后其余 239 个对象 xray、16 个保持可见；加载当前页 12 s 完成，「已加载 1 → 16，未加载 15 → 0」，无错误横幅；恢复场景可用。
- **距离 Tab**（通过 Refno `24381_145018`，5 m）：请求 `…/nearby?refno=24381%2F145018&radius=5000&…&include_self=false`，
  「共 6685 项」= 服务端，中心行「中心 5964, 9972, 16552 · refno_aabb_center · 24381_145018」，结果里不含源构件（页面上带
  `data-refno=24381_145018` 的那一格是左侧模型树行）。
- **legacy 源做不了**：`:3100` 的 `plant-web-server`（`D:\Rust\target\release`，09-09 起）是 **detached** 运行时——
  `/api/sqlite-spatial/stats` 回兼容空壳、`/negative-nouns` / `/nearby` 404「route not available in detached plant-web-server runtime」，
  `/api/mbd/pipe/24381_145018` 也是 `MODEL_REFNO_NOT_FOUND`；`show_refno` 在 legacy 下 128 s 后「无法解析 dbnum」。legacy 链路的
  行为不变只由 P2 的委托单测保证，要真机对拍得起一台带 sqlite 空间索引的完整 `plant-web-server`。
- 顺手看到的**既有口径**（基线 `328ca8b` 就有，不是本计划改的）：`加载当前页` 走 `loadResults({flyTo:true})` →
  `resolveBatchRefnos()` 无范围时返回 `fullMatches.refnos`，即**加载的是全集**而不是当前页——1387 项那次点下去 3 分钟没回来。
  标签与行为不符，要不要改另议。**→ 用户 2026-09-14 00:0x 拍板改，`2578ca8` 已落地**：`loadResults` / `pickResultItems` /
  `resolveBatchRefnos` 加 `pages?: 'current' | 'all'`，「加载当前页」传 `pages:'current'`、只动 `resultSet.items`（摘要行「当前页 N 项」
  数的就是这一页）；**「只加载未加载」保持全集语义**（`2578ca8` 曾一并改成按页，用户 00:1x 拍板改回，`05d5b5f`：它的意思是
  「把命中集合里没加载的都补上」，跨页）；分组按钮「加载本库 / 加载本专业」、全部显示、隔离也仍走缺省 `all`（它们旁边的计数是全量）。
  单测 store +1（当前页 2 条 / 全集 4 条：`pages:'current'` 只拿本页、`onlyUnloaded` 缺省拿全集里未加载的、缺省拿 4 条）/ drawer 断言同步。
  真机 5 m / 每页 20 → 1387 项：「加载当前页」13 s 收工、「已加载 1 → 20，未加载 19 → 0」、场景对象 240 → 259、无错误横幅。
  §2 目标 1 里「加载本页的现有语义不变」自此作废，教程 §六 同步。
  **→ 跨页的三个按钮加大数量确认（用户 00:2x 拍板，`73b8d8c`）**：store 新增 `countLoadTargets(options)`（与 `loadResults` 同一套取法），
  抽屉里「只加载未加载」与分组「加载本库 / 本专业」在 `count > 200` 时先经全局 `ConfirmDialog`（「加载数量较多 / 「…」将加载 N 个模型
  （超过 200 个），可能需要几分钟… / 取消 · 加载 N 个」），点确认才 `loadResults`；不超过阈值同步直跑。「加载当前页」只动本页，不设门。
  真机同一组 1387 项：「只加载未加载」弹「加载 1376 个」（全集减去查看器里已加载的 11 个），取消后 0 次 ensure / records、摘要不变；
  「加载本库」库 1112（41 项）不弹直接加载，库 7997 弹「加载 1346 个」、取消后 0 请求；2 m / 16 项不弹、11 s 加载完。
  单测 drawer +1 及分组用例三段、store 补 `countLoadTargets` 四种取法。

**联调记录（2026-09-13 22:40，第 6 步）——B4 成立**：本站 `__dtxLayer.getGlobalModelMatrix()` **不是单位阵**：缺省
`modelUnit=mm` → `dtx_scale=0.001` 且 recenter，矩阵 = 缩放 0.001 + 平移 `(-5.964, -9.972, -16.552)`（首个加载模型盒中心的负值，单位 m）。
`viewer.scene.getAABB()` 与拾取 `hit.worldPos` 都在这套**场景坐标（m、已重心化）**里，而 `useSpatialQuery.ts::applyCurrentSelection`
（`draft.center = aabbToCenter(aabb)`）和 `pickedQueryCenter` 的 watch 原样塞进 `draft.center`、`normalizeRequestFromCenter` 直接发服务端：
选中 BRAN `24381_145018` 用「当前选中」查 1 m，请求是 `x=-0.295&y=0&z=-0.573&radius=1000`，抽屉中心摘要显示「-0, 0, -1」，服务端回的
是 E3D 原点旁的 `17496_100380 FLOOR` 等 52 项，BRAN 自己不在里面；正确的 mm 中心应是 `(5668.6, 9972.2, 15979.0)`。
「手输坐标」不受影响；本地扫描 `queryLocal` 因两边都是场景坐标而自洽，只有服务端这一半错位。**基线 `9d34701` 的 `applyCurrentSelection` /
pick watch 就没有矩阵处理**，legacy 源同样中招——不是本计划引入，但本计划 §3.3 明确把它列为 B4 待核项，现在核实为真。
建议修法（待拍板）：进服务端请求前把 `draft.center` 经 `getGlobalModelMatrix().invert()` 换回 mm（`SpatialQueryDrawer.vue::
createPipeDistanceSceneTransformPoint` 已有反向那一半可对照），服务端回来的 `results[].aabb` / `center` 在飞行、本地合并时再正变换回场景；
中心摘要按 mm 显示。

**修复记录（2026-09-13 23:57，B4，plant3d-web `00beb54`）**：用户 22:49 拍板按上面的建议修。改动只在 `useSpatialQuery.ts`（两源共用）+ 其单测：
- 新增 `resolveSceneWorldTransform(viewer)`：从 `viewer.__dtxLayer.getGlobalModelMatrix()` 读矩阵，给 point / aabb 的场景 ↔ mm 双向换算；
  矩阵缺失、单位阵、含非数或不可逆一律退回恒等——没有 DTXLayer 的路径（单测桩、legacy 无矩阵）行为不变。
- 读查看器 → mm：`applyCurrentSelection`（选中盒中心）、`pickedQueryCenter` watch 与 `resolveRequest` 的 pick 分支（拾取 `worldPos`）、
  `queryLocal`（已加载盒先换回 mm 再量距离 / 判相交——改前本地扫描在缩放场景里对 mm 中心永远扫不到，已加载构件会被标成未加载）。
- 写查看器 → 场景：`activateResult` 场景里拿不到盒时退回结果项 bbox（mm）飞行前正变换；`loadSpatialQueryAabbProxies` 缓存到
  `scene.objects[refno].aabb` 的代理盒换到场景坐标（代理盒本身仍按 mm 交给 DTXLayer，渲染时它自己乘全局矩阵）。
- 口径：`draft.center`、请求、结果项 `position` / `bbox` / `distance` 全部 mm，抽屉中心摘要随之按 mm 显示；「手输坐标」不受影响；
  `SpatialQueryDrawer.vue` 不用改。
- 单测 +6（`useSpatialQuery.test.ts`）：`resolveSceneWorldTransform` 恒等 / 0.001 缩放 + 重心化下点与盒互逆 / 奇异与 NaN 退回恒等；
  store 下「当前选中」发 mm 且本地扫描按 mm 合并成 `merged`、「拾取中心」`worldPos` 换回 mm、飞向结果 bbox 前正变换。
- 验证：`vitest` useSpatialQuery 26 passed（连带 drawer 20 / spatialSource 7 / realBranHelper 6）；eslint 0；type-check 本文件无新增错误。
  真机（`:3101` dev server → `:18122`，headless Chrome，脚本在 `%TEMP%`）：选中 FLOOR `17496_100380` 查 1 m，请求 `x=0&y=0&z=450`、
  服务端 `center` 回显 `(0, 0, 450)`、`results[0]` = `17496_100380` d=0、抽屉「共 51 项 … 已加载 1 项」（验收项 6 原文通过）；
  选中 BRAN `24381_145018` 请求 `x=5668.6&y=9972.2&z=15979.0`（改前 `-0.295 / 0 / -0.573`），中心摘要「5669, 9972, 15979」，
  10 项全在盒中心旁——BRAN 本身不会出现在自己的结果里，因为树只存 BOX / CYLI / PANE 等叶子（`filter_options.nouns` 里没有 BRAN），
  不是前端问题。
- 顺带核出的差异：BRAN 在查看器里的盒中心（`5668.6, 9972.2, 15979.0`）与树里 `refno_aabb_center`（`5963.8, 9972.2, 16552.0`）
  相差 295 / 573 mm。**追查结果（2026-09-14 00:49）**：不是换算错，是「一个 BRAN 的盒」两套口径——`DtxCompatScene.getAABB([refno])` 只并
  objectId 为 `o:<refno>:n` 的对象，而 DTX loader 把隐含管子 TUBI 挂在 owner BRAN 的 refno 下、ELBO / VALV / OLET 成员各用自己的 refno，
  所以查看器里 BRAN 的盒 = 管子盒；服务端 refno 模式并的是「目标或祖先链含目标」的全部记录（spec §4.13）= 子树并集。
  `/api/v1/model/records {generation_root: 24381/145018}` 22 条 = 11 TUBI（refno 即 BRAN）+ 9 ELBO + OLET + VALV：11 条 TUBI 的并集中心
  = 查看器盒中心，22 条并集中心 = 服务端中心，差的正是 VALV `24381_145035`（x 到 10417 / z 到 19868）那一块的一半；叶子构件两边一致。
  **处置（用户拍板方案 2，`11d21e8`）**：查看器加 `DtxCompatScene.getSubtreeAABB(refnos)`（自己的对象 ∪ loader `resolveDtxObjectIdsByUnitRefno`
  沿 owner 链落到该 refno 的对象），`applyCurrentSelection` 先取子树盒、取不到退回 `getAABB`；`getAABB` 语义不动。单测：新文件
  `src/viewer/dtx/DtxCompatScene.getSubtreeAABB.test.ts` 4 条（真机盒数据，中心差恰为 (295, 0, 573)）+ store 1 条。真机：选中 BRAN 查 1 m 请求
  `x=5963.7737&y=9972.2395&z=16551.9712`，与 `nearby?refno=24381_145018` 的 `refno_aabb_center` 逐位相等，中心摘要「5964, 9972, 16552」。
  残余：成员没加载时子树盒仍不全（部分加载时会偏）。
  **PIPE / ZONE 这类自身与成员都没加载的 owner（方案 3 作兜底，用户拍板，`12ac0f7`）**：`applyCurrentSelection` 解不出盒时不再报
  「无法解析当前选中构件的位置」，记下 `selectedCenterRefno`，提交时给请求带 `refno` + `includeSelf:false` 走服务端 refno 模式
  （口径同距离查询「通过 Refno」：到源盒表面量距、默认剔自身子树），服务端 `center` 回来写回 `draft.center` 并清掉标记；抽屉中心摘要在
  标记在时显示「<refno> · 未加载几何，查询时由服务端解中心」。有盒的选中、拾取、切手输坐标 / 换模式、resetQuery 都清标记。
  真机：模型树点选 PIPE `24381_144975`（BRAN 的父级）→ 请求 `nearby?refno=24381/144975&radius=1000&…&include_self=false` → 200，
  center (5963.7734, 9972.239, 16551.97) `refno_aabb_center`（该 PIPE 已生成的子树只有这根 BRAN），共 1753 项，无错误横幅。
  单测 store +1 / drawer +1。子树里一个都没生成过的 owner 仍会收到服务端 404 折成的「…还没生成过模型」提示（§5-3 口径不变）。

**功能测试记录（2026-09-14 01:30，全部改动落地后在 plant3d-web 上走一遍）**：headless Chrome（SwiftShader）对着 `:3101` dev server +
`:18122` v1 服务，`show_refno=24381_145018`，脚本 `%TEMP%\spatial-ui-suite.mjs`（不进仓），**32 / 32 项自动检查通过；「拾取中心」headless 下无法验证，
01:38 在 headed Chrome 里补核通过（见末条）**：
- 范围 · 手输坐标：球形 2 m 请求带 x/y/z、`shape=sphere`、`per_page=20`，摘要「共 16 项」= `total_count`，结果行与服务端本页 refno 顺序一致，
  v1 源显示覆盖面提示、无专业筛选；立方体 `shape=cube`，21 ≥ 16；排序按名称 `sort=name`、按距离 `sort=distance` 且距离非降。
- 翻页（5 m / 20 → 1387 项）：下一页 `page=2` 首条变、总数不变；上一页回到 `page=1` 首条原值。
- 过滤：`nouns=PANE` 透传、结果全 PANE、85 < 1387；`keyword=24381_110361` 只命中它；「显示负实体」`include_negative` false → true。
- 当前选中：BRAN → 子树盒中心 (5963.8, 9972.2, 16552.0) 作 mm 发出；PIPE `24381_144975`（无几何）→ 摘要「… 未加载几何，查询时由服务端解中心」、
  请求 `refno=24381/144975`、`center.source=refno_aabb_center`、查完摘要回到「5964, 9972, 16552」。
- 结果动作（2 m / 16 项）：全部显示 1/1 → 16/16 可见；隔离结果其余 239/255 xray；恢复场景 xray 清零；单行眼睛隐藏一项可见 −1；飞行定位后目标被选中且可见；
  复制当前页 Refno 剪贴板含 16 个；加载当前页 9 s「已加载 2 → 16，未加载 14 → 0」；全程无错误横幅。
- 大数量确认：1387 项「只加载未加载」弹「将加载 1354 个模型（超过 200 个）…」（此时查看器里已加载 33 个）。
- 距离 · 通过 Refno（BRAN 5 m）：`refno=24381/145018&include_self=false`，中心行「中心 5964, 9972, 16552 · refno_aabb_center · 24381_145018」，
  结果不含源构件，每行带「按管径净距标注」按钮；通过坐标走点模式。
- 错误路径：不存在的 `1_1` → 服务端 404 折成「构件 1_1 还没有生成过模型，空间索引里没有它的包围盒；请先显示该构件，再按距离查询」；refno 为空时
  「执行空间查询」禁用；整轮无 pageerror。
- URL 入口：`spatial_refno=24381_145018&spatial_radius=2&spatial_radius_unit=m&spatial_autorun=1` → 抽屉自动打开、自动发 `refno=24381/145018&radius=2000`。
- **「拾取中心」（01:38 补核，真实 GPU 的 headed Chrome：ANGLE / AMD RX590 D3D11）**：headless SwiftShader 下拾取无命中（25 个采样点都空，点击确实到了
  拾取处理器——会清空选中集），换 headed 后可用：相机对准 BRAN，普通点击 (665, 490) 命中 VALV `24381_145035`（盒 mm [9545, 9624, 18272, 10417, 10231, 19868]）；
  点「拾取中心」再点同一像素，摘要「0, 0, 0」→「9939, 10190, 18817」，落在该 VALV 盒内（表面点）；查 1 m 请求 `x=9939.4&y=10190.2&z=18816.9` 与摘要一致，
  200 / 36 项，**VALV 自身在结果里 distance=0**（同距的 PANE 按 dbnum / refno 排前面）——验收项 6「拾取一构件表面点查 1 m，center 回显与该构件在结果」通过。
  脚本 `%TEMP%\spatial-ui-pick.mjs`，截图 `pick-headed.png`。
- 未验证：「仅显示本库」在 2 m 结果只有一个库时跳过（5 m 两库的分组按钮在 22:32 那轮已核）。legacy 源仍受 `:3100` detached 所限。

**整库范围显示记录（2026-09-14 03:xx，用户「配合 AMS 7997 的模型运行起来，然后范围显示」）**：headed Chrome（AMD RX590，CDP `:9444`，窗口留在桌面上）
对着 `:3101` → `:18122`，`?show_dbnum=7997`（AvevaMarineSample，6772 个生成根），再在整库场景里查 BRAN `24381_145018` 中心 5 m。
- **先撞上的问题**：本机 `:18122` 是摄入形态、7997 以 rocksdb 为准，`dbnums/7997/model/ensure` 回 409 → 前端退回逐 SITE 兼容路径，SITE 级 ensure
  在 debug 构建上 10/13 个撞 130 s 超时进 pending，**21.7 min 只装到 133 个构件**；5 m 查询「共 1637 项 … 已加载 0 项」，隔离结果后视口里只有零星几块。
  改法与数据见 `2026-09-10-show-dbnum-server-side-rebuild-plan.md` §12.7：409 分支先抽 `roots?ready=1` 已生成的根进视口，逐 SITE 只催其余的根，
  之后边生成边抽（`collectDbnum.ts`，单测 29 条）。
- **改后真机**：刷新 **22 s** 视口里 **14 083** 个构件（就绪 3487/6772 根）；范围 · 手输坐标 (5963.8, 9972.2, 16552.0) 球形 5 m / 每页 50 →
  200，`total_count` 1637（1112:26 / 7997:1611）= 摘要「共 1637 项，当前页 50 项，**已加载 50 项，未加载 0 项**」；全部显示 50/50 可见；隔离结果
  其余 13 238/14 083 有几何对象 xray、50/50 可见；相机对准结果盒；无错误横幅、无 pageerror。逐 SITE 期间每个 SITE 之后补进新就绪的根（14 083 → 14 509）。
  脚本 `%TEMP%\spatial-ui-dbnum7997-v3.mjs`，截图 `%TEMP%\spatial-ui\dbnum7997-v3-{drained,range-isolated,final-isolated}.png`（不进仓）。
- 顺带核出：`scene.objects` 里 1600 多个 key 是模型树登记的占位对象（无 `aabb`、`visible:false`），不是几何——数「已加载」要看 `getLoadedRefnos()` /
  带 `aabb` 的对象，之前 01:30 那轮脚本的 `present` 计数就是被它骗过（数出 present 50 而抽屉说已加载 0，两边其实都对）。

## 8. 关键位置速查

后端（行号以 `gen-model-refactor@8f99cbc64` + 10:30 工作树为准）：`vendor/old-aios-core/src/room/room.rs` L12；
`src/accel_tree/acceleration_tree.rs` L25-95 / L299-332；`gen-model-refactor/src/fast_model/aabb_tree.rs` L18 / L48 / L619 / L942 / L2073；
`spatial_state.rs` L88 / L250；`model_memory_store.rs` L88 / L253-267 / L551 / L671 / L833；`query_service.rs` L230 / L727；
`web_service/mod.rs` L396-472；`handlers.rs` L37 / L1067 / L2496 / L2634；`direct_tree.rs` L248 / L256 / L266；
`model_db_adapter.rs` L876 / L1579；`model_read_route.rs` L250；`options.rs` L895 / L1307；`docs/specs/web-service-api.md` §4.10-4.12。

前端：`src/model-source/{ports.ts, index.ts, genModelV1/index.ts, legacy/index.ts}`；`src/api/genModelV1Api.ts`；
`src/api/genModelSpatialApi.ts`；`src/composables/useSpatialQuery.ts` L92-102 / L584 / L672 / L914 / L1241（`resolveSceneWorldTransform` 在 `00beb54` 后约 L330-401）；
`src/components/spatial-query/SpatialQueryDrawer.vue`；`src/types/spatialQuery.ts`；`src/composables/useSpatialQuery.test.ts`。
