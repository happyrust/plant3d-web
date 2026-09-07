# 模型加载性能优化方案

**日期:** 2026-07-30
**范围:** `plant3d-web`（前端）+ `plant-model-gen`（后端 web_server / web_api）+ `rs-core`（aios_core）
**触发现象:** 在模型树上点击单个 EQUI 节点显示模型，进度长时间停在 `10% 查询可见实例范围... 24381_46777`

---

## 1. 结论摘要

单节点加载慢，**不是几何数据量的问题**，而是链路上有若干段的成本与"你点了多大的节点"无关，只与"整个 dbnum 有多大"有关；另有若干段把单节点成本按 N 倍放大。

| 编号 | 问题 | 位置 | 成本量级 | 是否每次都付 |
|---|---|---|---|---|
| P0 | 交互接口误用了为离线批量生成设计的全库快照 | `query_compat.rs:248` → `pe_owner_snapshot.rs:324-370` | O(全库节点数)，疑似 O(N²/2000) | 每进程每 dbnum 一次 |
| P1 | 可见性过滤"先全读、后筛选"，无缓存 | `e3d_tree_api.rs:1320-1432` / `1053-1096` | O(全库实例数) | **每次请求** |
| P2 | `showModelByRefnos` 串行 for 循环 | `ViewerPanel.vue:4983-5017` | ×N | 每次多选/关联加载 |
| P3 | 后端两处串行 DB 往返放大 | `inst_query.rs:81-93`、`rs-core/.../inst.rs:267-318` | ×N/50 与 ×N | 每次实例查询 |
| P4 | `recompile()` 每批全量重建 GPU 资源 | `DTXLayer.ts:842-899` | O(场景总量) × 批数 | 每批 |
| P5 | 响应体冗余（双份矩阵、TUBI 双写） | `model_runtime.rs:379-431` | 常数倍，但基数大 | 每次 |

> **P0 与 P1 的行为不同，可用于快速定性**：P0 是一次性的（`OnceCell` 按 dbnum 缓存），P1 是每次都付。
> 连续点击同一库中两个此前未点过的节点，若第二次明显变快 → 主因 P0；若第二次一样慢 → 主因 P1。

> **P0/P1 的最终方向：把层级图与几何可见集做成"进程内嵌入式 mem-kv + rkyv 持久种子"的本地索引，交互路径不再触碰主库全表。**
> 这是 2026-07-30 一轮 `/grill-with-doc` 设计评审（14 个决策点）的结论，完整设计见 **§4 层级索引重构设计**，落地任务见 §5 阶段 2。
> 快照本身没有设计错误，错的是交互接口复用了为离线批量生成设计的全库快照；预加载不采纳（只是把扫表挪到启动阶段）。

---

## 2. 完整调用链路

点击树节点 → `ModelTreePanel.vue:238` → `showModelByRefno()`（`useModelGeneration.ts:568`）：

```
[10%] queryLoadScopeRefnos()                useModelGeneration.ts:670
      └─ GET /api/e3d/visible-insts/{refno}     ← 当前卡点
         ├─ query_deep_visible_inst_refnos()    query_compat.rs:248
         │  └─ get_or_load_pe_snapshot(dbnum)   ← P0 全库装载
         ├─ PeOwnerTreeStore::fetch_node_metas() e3d_tree_api.rs:1261（chunk=500 串行）
         └─ 可见性过滤三选一                     ← P1 全库重读
            ├─ 读整份 instances_{dbnum}.json → serde_json 全量解析 → 递归遍历整棵树
            ├─ ParquetReader::finish() 整文件读成 DataFrame → 逐行扫
            └─ query_geometry_instances()（回退，只查 candidates，快）

      resolveActualModelLoadScope()          useModelGeneration.ts:711
      └─ GET /api/pdms/type-info             ← 串行等待，只为判断 root 是否 BRAN/HANG

[20%] loadDbnoInstancesForVisibleRefnosDtx() useModelGeneration.ts:807
      └─ POST /api/model/realtime-instances-by-refnos（全部 refno 一个请求，不分批）
         ├─ query_insts_with_batch(chunk=50)  ← P3a 串行循环
         └─ collect_export_data(bran_roots = 全部 refno)
            └─ query_tubi_insts_by_brans()    ← P3b 每 refno 一条 SQL 串行

      ensureGeometriesForGeoHashes()         useDbnoInstancesDtxLoader.ts:790（并发写死 8）
      └─ GET /files/meshes/lod_L1/{geo_hash}_L1.glb ×N（dev 下多一跳 Vite 代理）

      dtxLayer.recompile()                   useDbnoInstancesDtxLoader.ts:1025 ← P4
```

---

## 3. 逐项分析

### P0 — 交互接口误用了为离线批量生成设计的全库快照

`visible-insts` 做的第一件事是 `query_deep_visible_inst_refnos` → `get_or_load_pe_snapshot(dbnum)`。

```rust
// pe_owner_snapshot.rs:332-341
"SELECT id, owner, noun, cata_hash, children FROM pe \
 WHERE dbnum = {dbnum} AND id > {last_key} ORDER BY id LIMIT {page};"   // page = 2000
```

这个函数**不看传入的 refno**，它按 dbnum 把整张 `pe` 表游标分页拉进内存建树。点一个 EQUI 和点整个 SITE 的代价完全一样。

**这不是"快照该不该缓存"的问题，是"这个接口根本不该走快照"的问题。**

快照本身没有设计错误。看 `invalidate_pe_snapshots()` 的注释（`pe_owner_snapshot.rs:311-312`）：

> 失效全部快照。**每次生成 run 开始必须调用**（`gen_all_geos_data` 入口）

它是为**离线批量模型生成**设计的 —— 那个场景确实要遍历全库，一次装载摊到整轮生成上完全划算。问题在于**交互式 web 接口复用了同一个 helper**，把批量场景的前置成本压到了单次点击上。

**关键证据：同一个文件里其他接口都不走快照。**

| 接口 | 实现 | 是否需要全库 |
|---|---|---|
| `get_ancestors`（`e3d_tree_api.rs:1111`） | `PeOwnerTreeStore::query_ancestors` | 否，`(.owner)` 递归 |
| `get_subtree_refnos`（`e3d_tree_api.rs:1156`） | `PeOwnerTreeStore::query_descendants` | 否，`<-pe_owner<-pe` 子树递归 |
| **`get_visible_insts`**（`e3d_tree_api.rs:1240`） | **`query_compat` → 全库快照** | **是** ← 唯一的例外 |

也就是说，DB 侧的子树查询路径**已经在生产中跑着**，只有 `visible-insts` 是漏网的那个。

**`query_deep_visible_inst_refnos` 需要的能力，`PeOwnerTreeStore` 全都有现成的：**

| 快照调用（`query_compat.rs`） | 可替换为（`pe_owner_tree.rs`） |
|---|---|
| `get_node_meta_dual(refno)`（249、256） | `get_node_meta(refno)`（:472） |
| `query_children_filtered(refno, None)`（267、277） | `query_children(parent)`（:113） |
| `query_visible_geo_descendants(refno)`（271） | `query_descendants_filtered(root, VISBILE_GEO_NOUNS, None)`（:258） |
| `query_descendants_bfs(refno, BRAN_HANG)`（273） | `query_descendants_filtered(root, ["BRAN","HANG"], None)`（:258） |
| 循环取每个 bran_hang_root 的 children（275-278） | `children_batch(&roots)`（:334，chunk 500 批量） |

全部是子树范围的图查询，代价随**你点的那棵子树**大小走，而不是随全库走。

**疑似二次放大（待实测确认）：** 现有索引只有 `idx_pe_dbnum_noun(dbnum, noun)`（`pe_owner_tree.rs:502`）。查询同时要 `dbnum` 等值 + `id` 范围 + `ORDER BY id`，很可能走不到索引，导致每一页都要扫排该 dbnum 全量行，页数 = N/2000，整体逼近 O(N²/2000)。这解释了为什么"装进内存"比想象中还慢得多。

代码里已有 `[pe_snapshot] dbnum=... nodes=... elapsed_ms=...` 日志（`pe_owner_snapshot.rs:377-383`），可用于定量确认改造前后的差距。

### P1 — 可见性过滤"先全读、后筛选"，且零缓存

`e3d_tree_api.rs:1320-1432`，三条回退路径中前两条都是全库读：

**JSON 路径**（1333-1362）：
```rust
let bytes = fs::read(&instances_path_new)...              // 整个文件读进内存
serde_json::from_slice::<serde_json::Value>(&bytes)       // 全量解析成 Value（最慢的解析方式）
collect_component_refnos(&json, &mut available);          // 递归遍历整棵 JSON 收集所有 refno
// ↓ 筛选发生在这之后
for r in candidates.iter() { if available.contains(&key) { out.push(r) } }
```

**Parquet 路径**（1069-1081）：
```rust
let df = ParquetReader::new(file).finish().ok()?;         // 整个 parquet 读成 DataFrame
for value in refno_col.into_iter().flatten() {            // 遍历全库每一行
    if wanted.contains(value) { available.insert(...) }
}
```

两条都是"建全库集合 → 再看你那几个 refno 在不在里面"。你只要 3 个 refno，也得先把全库实例表读一遍。**而且这里没有任何缓存，每次点击从头再来一遍。**

> 排查时注意：本机 `d:\work\plant-code` 下未找到任何现役 `instances_*.json` 或部署用 parquet（只有其他 worktree 的旧产物）。若目标环境同样没有，则会回退到第三条 `query_geometry_instances(&candidates)` —— 那条只查 candidates，很快。**那样的话 P1 不成立，卡点就只剩 P0。** 需要按实际部署的 output_root 确认。

### P2 — `showModelByRefnos` 是串行 for 循环

`ViewerPanel.vue:4983-5017`：

```js
for (const r of unique) {
  await mg.showModelByRefno(r, { ... })   // 每个 refno 走一整轮三段链路 + 一次全量 recompile
}
```

每轮 = `visible-insts` + `type-info` + `realtime-instances` + `recompile()`，而且 `await` 串着走，零并发、零批量。

走这个事件的入口包括：审查面板（`ReviewPanel.vue`）、设计者处理面板、批注面板、空间查询（`useSpatialQuery.ts:1200`）、尺寸标注面板、增量更新面板、房间信息面板、任务监控面板。

旧日志 `.tmp-incremental-vite.err.log:1692-2176` 里同一秒十几个不同 refno 的 `visible-insts` 请求，就是这个模式的现场证据。

另外 `usePdmsOwnerTree.ts:466-482`（树上的眼睛图标 / 可见性切换）也调 `visible-insts`，且**失败会用 wrapped id 再调一次** —— 最差一次点击两轮全库读。

### P3 — 后端两处串行 DB 往返

**P3a** `inst_query.rs:81-93`：
```rust
let batch = batch_size.unwrap_or(50).max(1);
for chunk in refnos.chunks(batch) {     // 串行，无并发
    // 每个 chunk 还是 2 条 SQL（bool 路径 + geo 路径）
}
```
5000 个 refno = 100 轮 × 2 = 200 次串行往返。

**P3b** 更严重。`model_runtime.rs:362-369` 把**全部 refno**当 `bran_roots` 传下去：
```rust
crate::fast_model::export_model::collect_export_data(
    geom_insts, refnos, &mesh_dir, false,
    Some(refnos),   // ← bran_roots = 全部 refno，未过滤出真正的 BRAN/HANG
    false,
).await?
```
而 `rs-core/src/rs_surreal/inst.rs:267-318` 的 `query_tubi_insts_by_brans` 是：
```rust
for bran_refno in bran_refnos {          // 一个 refno 一条 SQL，串行
    let sql = format!("SELECT ... FROM tubi_relate:[{ref0}, {ref1}, NONE]..=[{ref0}, {ref1}, ..]");
    let mut results = model_primary_db().query_take(&sql, 0).await?;
    all_results.append(&mut results);
}
```
**N 个 refno = N 次串行数据库往返**，既没批量、也没先过滤。

> 注：`plant-model-gen/Cargo.toml:333-334` 把 `aios_core` patch 到 `../rs-core`，所以生效的是上面这个逐条循环的版本。

### P4 — `recompile()` 每批全量重建

`DTXLayer.ts:842-899` → `compile()`（786-834）：dispose 掉全部 8 张 DataTexture、geometry、4 个 material、mesh，然后把**整个场景**的顶点/法线/索引/矩阵/颜色/逐三角形映射重新拷进新 TypedArray 再上传。

`_createPrimitiveToObjectTexture`（1168-1203）是逐三角形写入，`_createPositionsTexture` / `_createNormalsTexture` 是逐顶点写入 —— 都是 O(场景总量)，且在主线程同步执行。

Parquet 路径每 1000 refno 一批、每批调一次（`useModelGeneration.ts:904-922`），总成本 ≈ 批数 × 场景总量。**场景越大越慢，近似二次增长。**

好消息：CPU 侧缓冲区已经是可增长的（`_ensureVertexCapacity` 等，1.5 倍扩容，`DTXLayer.ts:537-589`），且 `setObjectVisible` / `setObjectMaterial` 已经在做"原地写 texture data + `needsUpdate = true`"（1652-1720）。**增量化的地基是有的。**

### P5 — 响应体冗余

`model_runtime.rs:379-431`：每个实例带一份 16 个 f64 的 `matrix`，**外加又一份 16 个 f64 的 `refno_transform`**，再加 `aabb` 和 `uniforms`，全部是 JSON 文本。TUBI 还会**同时挂到自己和 owner 名下写两遍**（428-431）。

几千个实例即数十 MB JSON，序列化、传输、前端 `JSON.parse` 全在关键路径上。

---

## 4. 层级索引重构设计（kv-mem + rkyv）

> 本节是 2026-07-30 `/grill-with-doc` 设计评审的结论，逐条决策由用户拍板。它替代原先 P0「预加载快照」和 P1「过滤结果缓存」的思路，是 §5 阶段 2 的实现依据。

### 4.1 一句话设计

把交互查询依赖的两类数据 —— **层级图（pe + pe_owner）** 和 **几何可见集（哪些 refno 有几何）** —— 从"每次点击扫主库全表"改成"**加载进各进程内嵌入式 `mem://` SurrealDB 实例，用 rkyv 文件做持久化种子**"。查询语句一套不变（`PeOwnerTreeStore` 的 `<-pe_owner<-pe` 子树图查询），只是把连接目标从主库切到 mem 实例。

```
解析 DESI dbnum ──写──▶ pe 图 rkyv（refno/owner/order/noun/name/cata_hash，文件名带 dbnum-sesno）
                                │                       （不存 children 数组；order = 同胞下标）
                    ┌───────────┴───────────┐
              web 进程                   生成进程
        加载 rkyv → 内嵌 mem://      加载 rkyv → 生成快照的加载源
        重建 pe 记录 + pe_owner 边    （替代扫全库 pe 重建 HashMap）
        跑子树图查询（连 mem）

几何可见集 ──独立一条──▶ 按需从主库 inst_relate 拉进 kv-mem，凭据用 model_unit_commit_head 水位
```

### 4.2 决策表（Q1–Q14）

| # | 决策点 | 结论 |
|---|---|---|
| Q1 | kv-mem 服务范围 | 层级图进程内嵌入式，服务生成与 web；不引入外部 8011 共享实例 |
| Q2 | 层级索引数据 | 解析 DESI dbnum 时把 refno/owner/noun/name 写 rkyv，加载进 mem 还原 pe + pe_owner 图 |
| Q3 | rkyv 文件名 sesno 语义 | 新鲜度标记，只留 latest（不做多版本并存） |
| Q4 | web 交互是否读 rkyv | 读；缺失/过期时 web 自己重建（配合 Q13 的回退与后台构建） |
| Q5 | rkyv 定位（关键纠正） | rkyv 是**加载种子**不是查询数据源；查询仍走 SurrealQL 图查询，只是打在 mem 实例上 |
| Q6 | 承载层级图的 mem 实例拓扑 | 各进程内嵌入式 `mem://`，rkyv 做共享媒介（`kv-mem` 已无条件编译，零新进程） |
| Q7 | rkyv 命中时是否等 | 等 —— 同步反序列化 + 批量 INSERT 进 mem（秒级） |
| Q8 | 查找链与失效凭据 | 一个 dbnum 一个 rkyv，文件名带 `dbnum-sesno`，文件内也写 dbnum+sesno 二进制头；查找链：查 ref0 是否在 kv-mem → 不在就找对应 rkyv 加载 → rkyv 也没有就单独解析 db file |
| Q9 | mem 图内存上限 | 按 dbnum 做 LRU 驱逐，上限可配（rkyv 在盘上，驱逐后重载是秒级） |
| Q10 | 可见性过滤（第 3 段） | 把"哪些 refno 有几何"也装进 kv-mem |
| Q11 | 几何可见集的装载时机与凭据 | 与 pe 图**分离**：按需从主库 `inst_relate` 拉进 kv-mem，凭据用 `model_unit_commit_head` 水位（不进解析期 rkyv、不共用 sesno 凭据） |
| Q12 | 已装图的过期探测真源 | 解析产物水位：`stat db_meta_info.json`，mtime 变化时重载并比对该 dbnum 的 `latest_sesno` |
| Q13 | 解析兜底档当前请求是否等 | 不等：解析转后台，当前请求立即回退主库子树图查询；主库也没有则明确报「该库尚未解析」 |
| Q14 | 生成侧如何接入 | 快照种子化：rkyv 作为生成快照的加载源；attmap 提速独立做真批量化；att/CATA 不进 kv-mem |
| Q15 | 同胞顺序的存储方式 | **不存 `children` 数组**，改用 `pe_owner` 关系边管理父子；rkyv 每节点存 `order`（同胞下标），装载时重建 `pe_owner:[owner, order]` 边，查询靠 `<owner><-pe_owner ORDER BY id` 保序 |

### 4.3 关键组件与落点

**(a) pe 图 rkyv 种子（Q2/Q15）**
- schema：`{ dbnum, sesno(二进制头), nodes: [{ refno, owner, order, noun/noun_hash, name, cata_hash }] }`
  - **不存 `children` 数组**（Q15）。`order` = 该节点在其 owner 的 `pe.children` 里的枚举下标，是同胞顺序的唯一持久来源
  - `name`、`cata_hash` 必须存：`TreeNodeDto`（`e3d_tree_api.rs:431`）需要 `name` 且为空时按 `"{noun} {order+1}"` 生成；`cata_hash` 缺失时消费侧要回退 attmap 计算
- 装载（写进 mem 实例）：每个节点 `CREATE pe:<refno> SET owner/noun/name/cata_hash` + `INSERT RELATION INTO pe_owner [{ id: pe_owner:[<owner>, <order>], in: <refno>, out: <owner> }]`
  - 这样 mem 实例的图结构与主库**同构**，`PeOwnerTreeStore::query_children`（`<owner><-pe_owner ORDER BY id`，`pe_owner_tree.rs:113-121`）一字不改即可跑
  - `order` 语义对齐现有 `rebuild-pe-owner`（`cli.rs:1466-1482`：`pe_owner:[owner, order]`，order 来自 children 枚举下标）
- 文件名：`pe_graph_{dbnum}_{sesno}.rkyv`（或等价形式），旧 sesno 文件当垃圾清（Q3）
- 原子落盘：抄 `transform_rkyv_cache.rs:184-197` 的 `写 .tmp → rename`
- 写入方：解析 DESI dbnum 的流水线（与 `db_meta_info.json` 更新同一处，`database.rs:1948/2830/3269` 附近），枚举每个父节点的 children 得到每个子节点的 `order`

**(b) 进程内嵌入式 mem 实例 + LRU**
- `kv-mem` 引擎在 `rs-core/Cargo.toml:121-124` 无条件编译，直接 `connect("mem://")`
- 按 dbnum 装载、LRU 驱逐、上限可配；顺手替换 `SNAPSHOT_CELLS`（`pe_owner_snapshot.rs:281`）那个只增不减的 DashMap
- 并发去重用 `OnceCell` collapse（`pe_owner_snapshot.rs:285-294` 现成模式）

**(c) 连接选择改造**
- `PeOwnerTreeStore` 全部硬编码 `project_primary_db()`；需把连接目标变成参数 / 上下文，以便同一套查询既能打主库（回退）也能打 mem 实例

**(d) 查找链（Q8 + Q12 + Q13）**
```
visible-insts(refno) 入口:
  0. stat db_meta_info.json；mtime 变了则重载，比对该 dbnum latest_sesno（Q12 过期探测）
  1. ref0 在 kv-mem 且未过期 → 直接跑子树图查询（快路径，命中）
  2. 不在/过期 → 找 pe_graph_{dbnum}_{sesno}.rkyv：
       命中 → 同步反序列化 + 批量 INSERT 进 mem（Q7 等），再跑查询
  3. rkyv 也没有 → 后台起解析（parse_single_db_file，database.rs:3092）；
       当前请求立即回退主库 PeOwnerTreeStore 子树查询（Q13 不等）；
       主库也没有该 dbnum → 明确返回「该库尚未解析」
```

**(e) 几何可见集（独立于 pe 图，Q10 + Q11）**
- 数据源：主库 `inst_relate`（生成期写：rs-core `inst_structs.rs:191` `CREATE inst_relate:...`；增量先删后写：`pdms_inst.rs:127`）
- 装载：web 首次需要某 dbnum 时按 ref0 做 record-id range 批量拉进 kv-mem
- 凭据：`model_unit_commit_head`（`model_unit_commit.rs:202-207`）里该 dbnum 的最新 sesno 水位 —— **只在生成真正落盘时才前进**，恰好匹配"有几何"的语义；每次使用前查一条便宜的聚合，水位变了才重拉/增量刷
- **不与 pe 图共用 sesno 凭据**：pe 图凭据是解析产物水位（Q12），几何集凭据是生成水位；两者变更时机不同，共用必然有一边静默过期

### 4.4 这套设计覆盖 `visible-insts` 的哪几段

| 段 | 内容 | 由谁解决 |
|---|---|---|
| 1 | `query_deep_visible_inst_refnos` 层级遍历 | pe 图 mem 实例（4.3 a–d） |
| 2 | `fetch_node_metas` 取 noun/owner | 同上（图里已含 meta） |
| 3 | 可见性过滤（哪些 refno 真有几何） | 几何可见集 kv-mem（4.3 e） |

三段全覆盖，`visible-insts` 不再有任何一段走主库全表。

### 4.5 生成侧收益边界（Q14 的诚实说明）

- rkyv 种子化命中的是生成的**真实痛点**：每轮 run 开始 `invalidate_pe_snapshots()` 后，每个 dbnum 首次访问都要扫主库全表重建 HashMap（`pe_owner_snapshot.rs:324-370`）。改成从 rkyv 加载后，这一步从"扫表"降为"读文件"
- 但生成的**头号读热点是 attmap 逐元素点查**（`B-read-path.md` §3），不在本设计范围内。它的正解是把伪批量（rs-core `surreal_provider.rs:228` 的逐条 for 循环）改成真批量（`pe_owner_tree.rs:451` 已证明批量 SQL 语法现成），5000 元素从 5000 次查询降到约 10 次 —— 换存储后端给不了这个数量级，故 att/CATA 不进 kv-mem

### 4.6 风险与前提

1. **语义等价性**：mem 图查询与主库回退查询必须返回**完全一致的集合**（否则出现"刷新一下结果变了"）。因两条路径是同一套 SurrealQL 只换连接，风险已比"两套逻辑"低；仍建议保留对拍测试
2. **同胞顺序靠 `order` + 边（Q15）**：rkyv 每节点必须存 `order`（同胞下标），装载时据此建 `pe_owner:[owner, order]` 边，查询靠 `ORDER BY id` 保序。mem 实例里**没有 `pe.children` 字段可回退**，所以种子必须为每个父子关系都写出边（生成侧可控，天然完整，不存在主库那种"部分节点缺边"问题）；`order` 一旦漏写或错位 → 树同胞顺序错乱
3. **几何集与 pe 图的凭据必须分离**（Q11），任何"图新鲜就认为几何也新鲜"的简化都会重现 specs/023 §0-2 静默漏元素
4. **内存翻倍**：web 与生成各持一份 mem 图（Q6 代价），靠 LRU 上限（Q9）兜底
5. **连接改造波及面**：`PeOwnerTreeStore` 硬编码 `project_primary_db()`，改连接选择会触及所有调用点，需回归

---

## 5. 优化方案

### 阶段 0：先量化（必做，不改行为）

在动任何优化之前必须先定性，否则容易优化错地方。

**Task 0.1 — 采集基线**

- 后端日志抓 `[pe_snapshot] dbnum=... elapsed_ms=`（已有，无需改代码）
- 浏览器 Network 面板记录一次单节点点击的三段耗时：`visible-insts` / `type-info` / `realtime-instances-by-refnos`
- 连点两个同库未点过的节点，对比第一次与第二次

**Task 0.2 — 补分段计时（可选，若 0.1 不足以定性）**

- Modify: `plant-model-gen/src/web_api/e3d_tree_api.rs`
- 在 `get_visible_insts_inner` 内对三段（snapshot / node_metas / 过滤）分别 `Instant::now()` 计时，写进已有的 `VisibleInstsDebug` 结构（它已经透传到前端 console，见 `genModelE3dApi.ts:233-235`）
- 验证：点一次节点，前端 console 直接看到三段耗时

**出口条件：** 能明确回答"时间花在 P0 还是 P1"。

---

### 阶段 1：后端低风险高收益（P3）

改动最小、收益最确定，且不依赖阶段 0 的结论。

**Task 1.1 — `bran_roots` 只传真正的 BRAN/HANG**

- Modify: `plant-model-gen/src/web_server/model_runtime.rs:362-369`
- 当前把全部 refno 当 bran_roots 传下去。改为先用已有的 node meta 过滤出 noun ∈ {BRAN, HANG} 的子集再传
- 收益：`query_tubi_insts_by_brans` 的循环次数从 N 降到实际 BRAN/HANG 数量（通常 1~2 个数量级差距）
- 风险：低。若过滤过严会漏 TUBI，需回归验证管道类模型仍有直管段
- 验证：加载一个含 BRAN 的 PIPE，确认 TUBI 数量与改前一致

**Task 1.2 — `query_tubi_insts_by_brans` 批量化**

- Modify: `rs-core/src/rs_surreal/inst.rs:267-318`
- 把逐条 for 循环改成单条多 range 的批量查询，或退一步用 `futures::stream::buffer_unordered(8)` 并发
- 风险：中（改的是共享 crate，`plant-model-gen` / `plant-ui` / `rs-core-pin` 都可能引用）。建议先做 1.1，1.2 视 1.1 后的实测决定是否还需要
- 验证：`rs-core` 现有测试 + 加载同一 PIPE 结果比对

**Task 1.3 — `query_insts_with_batch` 并发化**

- Modify: `plant-model-gen/src/fast_model/gen_model/inst_query.rs:81-93`
- `for chunk in refnos.chunks(50)` 改为 `buffer_unordered(N)`，N 取 4~8 视 SurrealDB 连接池而定
- 风险：中，需确认连接池容量与数据库并发承受能力
- 验证：大 refno 集合（>1000）的加载耗时对比

---

### 阶段 2：层级索引重构（P0 / P1，实现 §4 设计）

本阶段落地 §4 的 kv-mem + rkyv 设计。任务按依赖顺序排列：先立地基（回退路径、连接抽象），再上 rkyv 种子与 mem 装载，最后接几何可见集。**Task 2.1 本身即可独立消除 P0**（回退路径就是子树图查询），后续任务在其上叠加 rkyv 快路径。

**Task 2.1 — `visible-insts` 主库回退路径：改走子树图查询（先落地，独立消除 P0）**

这是整套设计的兜底路径（§4.3 d 第 3 步），也是不依赖任何新基建就能先消除 P0 的一步。

- Create: `plant-model-gen/src/web_api/visible_insts_query.rs`（或在 `e3d_tree_api.rs` 内新增私有函数）
- Modify: `plant-model-gen/src/web_api/e3d_tree_api.rs:1216-1252`（把 `query_compat::query_deep_visible_inst_refnos` 换成新实现）
- 按 §3 P0 映射表，用 `PeOwnerTreeStore` 重写等价逻辑，保持四条分支语义不变：
  1. owner 是 BRAN/HANG → 只返回自身
  2. 自身是 BRAN/HANG → 返回直接子节点
  3. 否则 → 可见几何子孙 + BRAN/HANG 子孙及其子节点
  4. 请求根自身补进 candidates
- **不动 `query_compat.rs`**：离线生成管线继续用快照（阶段 2.4 会把它的加载源换成 rkyv，但查询形态不变）
- 收益：单节点成本从 O(全库) 降到 O(子树)，首次点击不再扫全表
- 风险：中。语义等价性是关键，`query_children` 的同胞顺序与快照 `collect_children` 需比对
- 验证：新增单测对同一批 refno 比对新旧两条路径返回集合完全一致（临时保留旧实现做 diff）；用例 A/B/C 端到端；重点覆盖 BRAN/HANG（管道）与普通 EQUI

**Task 2.2 — `PeOwnerTreeStore` 连接目标抽象化（§4.3 c）**

- Modify: `plant-model-gen/src/versioned_db/pe_owner_tree.rs`（全部硬编码的 `project_primary_db()`）
- 把连接目标改成参数 / 上下文（主库 vs 某 dbnum 的 mem 实例），使同一套子树查询既能打主库回退也能打 mem 快路径
- 风险：中。触及所有调用点，需回归 `get_ancestors` / `get_subtree_refnos` 等既有接口
- 验证：既有树接口行为不变；新增"指定连接"单测

**Task 2.3 — 进程内嵌入式 mem 实例 + 按 dbnum LRU（§4.3 b，Q6/Q9）**

- Create: `plant-model-gen/src/versioned_db/pe_mem_store.rs`（暂定）
- `connect("mem://")`（`kv-mem` 已无条件编译，`rs-core/Cargo.toml:121-124`），按 dbnum 建独立 namespace/db 或独立实例
- LRU 驱逐 + 可配上限；用 `OnceCell` collapse 去重并发装载（抄 `pe_owner_snapshot.rs:285-294`）
- 顺手替换 `SNAPSHOT_CELLS`（`pe_owner_snapshot.rs:281`）那个只增不减的 DashMap
- 风险：中。内存占用需实测（事实 19：样例项目 63 dbnum，各进程一份）
- 验证：装载/驱逐/重载单测；连续点击多个 dbnum 观察内存上限生效

**Task 2.4 — pe 图 rkyv 种子：写入 + 加载（§4.3 a，Q2/Q3/Q7/Q8/Q14/Q15）**

- schema 见 §4.3 a：每节点 `refno/owner/order/noun/name/cata_hash`（**不存 children 数组**）+ `dbnum/sesno` 二进制头
- 写入：解析 DESI dbnum 流水线（`database.rs` 更新 `db_meta_info.json` 附近，`:1948/2830/3269`），枚举每父节点 children 得到每子节点 `order`；原子落盘抄 `transform_rkyv_cache.rs:184-197`
- 加载：反序列化 → 每节点 `CREATE pe:<refno>` + `INSERT RELATION pe_owner:[owner, order]`，批量灌进 Task 2.3 的 mem 实例（Q7 同步等）。图结构与主库同构，`query_children` 无需改
- 生成侧（Q14）：把 `get_or_load_pe_snapshot` 的加载源从扫主库全表改成读 rkyv，凭据对不上再回退扫表；查询形态不变
- 风险：中高。**`order` 完整性**是硬约束（§4.6.2）；rkyv schema 变更需版本头兼容
- 验证：rkyv round-trip 单测（含同胞顺序：装载进 mem 后 `query_children` 顺序与主库一致）；生成 run 冷启动耗时对比（扫表 vs 读 rkyv）

**Task 2.5 — 查找链 + 过期探测 + 后台解析兜底（§4.3 d，Q12/Q13）**

- Modify: `visible-insts` 入口（Task 2.1 的新函数）
- 第 0 步过期探测：`stat db_meta_info.json`，mtime 变化时 `db_meta().load()` 重载（现在 `ensure_loaded` 只加载一次，`db_meta_manager.rs:289-295`），比对该 dbnum `latest_sesno`
- 查找链：kv-mem 命中且未过期 → 快路径；否则找 rkyv 加载；rkyv 缺失 → 后台 `parse_single_db_file`（`database.rs:3092`）+ 当前请求立即回退 Task 2.1 主库子树查询；主库也无该 dbnum → 返回「该库尚未解析」
- 后台解析用 `OnceCell` collapse 去重
- 风险：中。过期探测的 mtime 判定要覆盖增量提交后 json 被重写的时刻
- 验证：构造"新库未解析 / rkyv 缺失 / sesno 推进"三种场景，各自走对分支

**Task 2.6 — 几何可见集装进 kv-mem（§4.3 e，Q10/Q11）**

- 数据源：主库 `inst_relate`（生成写：rs-core `inst_structs.rs:191`；增量先删后写：`pdms_inst.rs:127`）
- 装载：web 首次需要某 dbnum 时按 ref0 做 record-id range 批量拉进 kv-mem
- 凭据：`model_unit_commit_head`（`model_unit_commit.rs:202-207`）该 dbnum 最新 sesno 水位；**独立于 pe 图凭据**（§4.6.3），每次用前查一条聚合，水位变了才重拉/增量刷
- 替换 `e3d_tree_api.rs:1320-1432` 第 3 段：命中 kv-mem 即返回，不再读 instances json / parquet 全表
- 风险：中。水位查询本身不能太贵；增量"先删后写"窗口期的一致性需确认
- 验证：生成新几何后水位推进 → 前端能看到新模型；未生成时不误报

**Task 2.7 — attmap 真批量化（生成提速，独立于上面，§4.5）**

- Modify: `rs-core/src/query_provider/surreal_provider.rs:228`（`get_pes_batch` / `get_attmaps_batch` 的逐条 for 循环）
- 改成单条多 key 批量 SQL（`pe_owner_tree.rs:451` 已证明 `SELECT ... FROM [{keys}]` 语法现成）
- 风险：中（改共享 crate）。与本阶段其余任务无依赖，可并行
- 验证：`rs-core` 现有测试；生成 run 的 attmap 阶段查询次数与耗时对比

**Task 2.8 — 复核 `pe` 分页查询的索引（收尾，可能不再需要）**

- Task 2.1/2.4 落地后交互路径不再触发全库分页，此项降为"只影响生成冷启动的扫表回退"
- 若仍要做：先 `EXPLAIN` 确认 `WHERE dbnum=X AND id>K ORDER BY id LIMIT 2000` 执行计划，再决定加复合索引或改 `id` range
- **注意：依赖实测，不要凭推断直接加索引**

---

### 阶段 3：前端串行与批量（P2）

**Task 3.1 — `showModelByRefnos` 改批量**

- Modify: `plant3d-web/src/components/dock_panels/ViewerPanel.vue:4983-5017`
- 当前每 refno 一整轮。改为：一次性收集所有 refno 的加载范围 → 一次 `realtime-instances` 请求 → 一次 `recompile()`
- 需要配套：后端提供批量版 `visible-insts`（接受 refno 数组），否则前端仍要 N 次；短期可先用 `Promise.all` 并发替代串行 `await`
- 风险：中。`debugState` 的逐项统计结构需要调整，且失败语义从"逐个失败"变成"批量部分失败"
- 验证：`ReviewPanel.componentLinkage.test.ts` 等现有测试；多选 10 个元素定位，对比耗时

**Task 3.2 — 去掉可见性切换的重复调用**

- Modify: `plant3d-web/src/composables/usePdmsOwnerTree.ts:466-482`
- `wrapSurrealThingId` 重试目前是无条件的第二次全量请求。确认 `shouldRetryWithWrappedId` 的触发条件是否还必要，能去则去
- 风险：低
- 验证：树上切换 ZONE 可见性，Network 里应只有一次 `visible-insts`

**Task 3.3 — 首屏两段并行**

- Modify: `plant3d-web/src/composables/useModelGeneration.ts:662-717`
- `queryLoadScopeRefnos` 与 `pdmsGetTypeInfo` 之间没有数据依赖（后者只判断 root 的 noun），改成 `Promise.all` 并发
- 风险：低
- 验证：单节点加载，Network 里两个请求应重叠

---

### 阶段 4：渲染层增量化（P4）

收益随场景增大而增大，但改动面最大，放最后。

**Task 4.1 — 整轮加载只 recompile 一次**

- Modify: `plant3d-web/src/composables/useDbnoInstancesDtxLoader.ts:1024-1026` + `useModelGeneration.ts:904-922`
- 给 `loadDbnoInstancesForVisibleRefnosDtx` 加 `deferRecompile` 选项，让分批循环结束后由调用方统一 recompile 一次
- 收益：把 P4 的成本从"批数 × 场景总量"降到"1 × 场景总量"
- 风险：低。注意异常路径（`replacementSnapshot` 回滚）仍要 recompile
- 验证：`DTXLayer.spec.ts`；加载 5000+ refno 的 ZONE，对比耗时

**Task 4.2 — 容量未增长时不重建纹理**

- Modify: `plant3d-web/src/utils/three/dtx/DTXLayer.ts:842-899`
- 当 `_maxVertices/_maxIndices/_maxObjects` 均未扩容时，跳过 dispose + 重建，改为把新增区段写进现有 texture data 数组后置 `needsUpdate = true`（`setObjectVisible` 已是这个模式，1652-1720）
- 收益：省掉 CPU 侧全量重拷 + material/mesh/shader 重建
- 风险：中高。需保证 `_totalVertices` / `_drawIndexCount` / `primitiveOffset` 等派生量同步正确，否则会出现渲染错位
- 验证：`DTXLayer.spec.ts` + `DTXGeometry.test.ts`；视觉回归（连续增量加载后截图比对）

**Task 4.3 —（可选）真正的分块上传**

- 用 WebGL2 `texSubImage2D` 只上传新增区段，而非整张 texture 重传
- 风险：高，需要绕过 three.js 的 DataTexture 上传路径
- **仅在 4.1 + 4.2 后实测仍是瓶颈时才做**

---

### 阶段 5：响应体瘦身（P5）

**Task 5.1 — 去掉冗余字段**

- Modify: `plant-model-gen/src/web_server/model_runtime.rs:379-431`
- `refno_transform` 与 `matrix` 在多数情况下高度重复，考虑按 refno 提一层而不是每实例重复
- TUBI 双写（428-431）改为只写一次 + owner 侧存引用
- 风险：中，前端 `useDbnoInstancesDtxLoader.ts:970-977` 依赖 `refno_transform`，需同步改
- 验证：加载结果的实例数与视觉效果不变，响应体积对比

---

## 6. 验证基线

建议固定一组用例，每阶段前后各测一次：

| 用例 | 说明 |
|---|---|
| A | 服务重启后，首次点击单个 EQUI（测 P0 / rkyv 冷加载） |
| B | 紧接 A，点击同库另一个未点过的 EQUI（测 P1 / mem 命中） |
| C | 点击一个含数百子件的 ZONE（测 P3） |
| D | 多选 10 个元素定位（测 P2） |
| E | 在已有大场景基础上再加载一个 ZONE（测 P4） |
| F | 增量提交某 dbnum 后首次点击（测 Q12 过期探测 + Q13 回退） |

记录指标：`visible-insts` 耗时、`realtime-instances` 耗时与响应体积、`recompile` 耗时、端到端到首帧时间。

---

## 7. 待确认事项

§4 的设计决策已由 `/grill-with-doc` 评审拍板（Q1–Q14）。以下是实施前仍需**实测/确认**的点：

**设计相关（新增）：**

- **A. mem 图与主库回退的语义等价性** —— 同一批 refno，两条路径返回集合必须完全一致（§4.6.1）。落地前写对拍测试
- **B. `model_unit_commit_head` 水位查询成本** —— 几何可见集每次使用前要查一次水位（Task 2.6），需确认它足够便宜（一条聚合，命中索引 `idx_model_unit_commit_list`）
- **C. `inst_relate` 增量"先删后写"窗口期** —— `pdms_inst.rs:127` 删旧行与写新行之间，几何集可能瞬时不一致，需确认是否在事务内
- **D. 内存占用实测** —— 各进程一份 mem 图，样例项目 63 dbnum；LRU 上限默认值需按实际部署机器定
- **E. 嵌入式 `mem://` 的批量 INSERT 吞吐** —— 决定 Q7"同步等 rkyv 加载"的实际秒级是否成立（几十万节点批量灌入耗时）

**原有推断（仍需确认）：**

以下是**推断而非已验证的事实**：

1. **P0 是否存在二次放大** —— 取决于 SurrealDB 对 `dbnum` 等值 + `id` 范围 + `ORDER BY id` 的实际执行计划，需 `EXPLAIN` 确认
2. **P1 在目标环境是否成立** —— 取决于部署的 output_root 下是否真的存在 `instances_{dbnum}.json` 或 parquet。若都不存在则走第三条快速回退路径，P1 不成立
3. **目标 dbnum（24381）的实际 `pe` 行数** —— 决定 P0 的绝对量级
4. **SurrealDB 连接池容量** —— 决定 Task 1.3 的并发度上限
