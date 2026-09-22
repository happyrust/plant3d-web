# 房间层级树里列出直段（方案 B）· 小计划

> 日期：2026-09-21（fable-5-1-20 起草未落盘，fable-5-1-25 于 2026-09-22 补写）。来源：用户验收房间层级树时提「如果是管件，需要显示对应的直段」→
> 方案 A（前端按整条 BRAN 走，`331f2e9b`，共识 `d-81`）已合入 → 用户接着选「**B 也要：树里 / 计数里列出直段，先出一份小计划（要动 gen-model-model-cache）**」。
> 上位：ADR 0068（房间层级树，含 2026-09-21「管件带直段」追记）；计划 `2026-09-20-spatial-room-hierarchy-tree-plan.md`；教程 `SPATIAL_QUERY_TUTORIAL.md` §6.1「管件带直段」。
> 基线：plant3d-web `main@4affeded`（方案 A `331f2e9b` 在内）；gen-model-model-cache `main@579b1d8b2`（`:8027` 验证实例，AMS，`room_membership=true`）。
> 状态：**待拍板 D1–D7（§8）**。拍完按 §4 分 PR 做；本计划自身一笔提交。

## 0. 一句话

树的叶子今天只有管件：直管（TUBI）没有独立 refno、不进空间索引，所以两棵树（抽屉树态 / 模型树「房间」页签）**列不出、也数不到**直段。
方案 A 只解决了三维里「管件带着直段走」；方案 B 要让**树上有直段行、计数里有直段数**。直段的身份与盒后端都有（内存投影 `ProjectedTube`、落盘 `tubi_relate`），
缺的是把它们**按所属 BRAN 补进树响应**（后端）和**画出来**（前端）。本计划推荐「按树里已有的 BRAN 单元补直段、独立 `tube_count`、opt-in 参数、前端先只读」这条最小路径。

## 1. 已核实的基线（2026-09-21 20:4x–21:0x、09-22 10:3x 查证）

### 1.1 直段在后端长什么样

| 事实 | 出处 |
|---|---|
| 隐式管身**不进**空间 R*-tree：`projected_tree_entry` 见 `record.tube.is_some()` 直接回 `None`（ADR-072 D4「隐式管身不进树，`tubi_relate` 从来不在树上」） | `gen-model-model-cache/src/fast_model/aabb_tree.rs` L11–21，单测 `projected_tree_entry_mirrors_world_bounds_and_skips_tubes_and_invalid_boxes` |
| 内存投影里每段直管一条 `ProjectedGeometry`：`source_refno` = **容器 BRAN**、`world_bounds` / `world_transform` / `dbnum`、`tube: Some(ProjectedTube { route_ordinal, from, to, invalid })`；身份 `GeometryId::ImpliedTube { container_refno, route_ordinal, from_refno, to_refno }` | `model_memory_store.rs` L76–106 |
| `route_ordinal` **只在同一对 `(from, to)` 里唯一**，无关两段常都是 0；落盘 `tubi_relate:[pe:⟨branch⟩, 槽位]` 的槽位是**分支全局连号**（整分支重置后重新发号），行上有 `leave` / `arrive` / `aabb` / `world_trans` / `invalid` / `anc` / `dbnum`，**没有** `route_ordinal` | `model_db_adapter.rs` L18、L2663–2666、L3101–3102 |
| `model/records` 把直管投成 `refno = BRAN, generic = 'TUBI', insts = [{ geo_hash, is_tubi, is_invalid_tubi }]`——**没有两端、没有序号**；内存路 `projection_record_to_query`，冷读路 `tubi_projection` 同形 | `model_record_reader.rs` L103–108、L119–170；前端 `genModelV1Api.ts` `GeomInst` L484–489 |
| 一根的记录：内存 `ModelMemoryStore::records_of_root(scope, root)`；overlay 之外冷读 `durable_records_of_root`（两路各走索引再 `array::union`，**2–3 ms / 根**；改前 0.76 s） | `model_memory_store.rs` L1363；`model_record_reader.rs` L45、L75–90 |
| 树的折法：`nearby_tree` → `scan_global_tree`（只扫到管件）→ `resolve_rooms_for_scan`（`RoomScope`）→ `assemble_tree`：过滤 → 按距离排 → 按 refno 去重 → 每条命中查 `member_rooms` 与 `unit_root_of` → 房间 → 专业 → 单元类型 → 单元 → 叶子；`leaf_count > leaf_cap(5000)` 省略全部叶子，`unit=` / `other_noun=` 只内联一组 | `spatial_query.rs` L1342–1373；`spatial_tree_view.rs` L417–612 |
| 响应形状 `TreeLeaf { refno, noun, distance, shared_rooms? }` / `TreeUnit { refno, noun, name, count, min_distance, elements? }` / `TreeUnitType` / `TreeSpec` / `TreeRoom` / `TreeResponse { total_count, leaf_count, leaves_inline, inlined, … }`；`count` 全部是**管件数** | `spatial_tree_view.rs` L303–398；spec `docs/specs/web-service-api.md` §4.13.5 L1265 / §4.13.6 L1324 |
| `RoomScope` 只有 `rooms: Vec<RoomRef { refno, room_num }>` + `members` + `member_rooms: HashMap<RefU64, Vec<usize>>`——**没有房间盒**；成员按 ADR 0067 的「面板 → 构件」边（读透）或 `room_relate`（落盘）解，都是按 refno，直段解不出 | `spatial_rooms.rs` L166–188 |
| query 入口：`SpatialTreeReq { identity, query: RawSpatialQuery, leaves: RawLeafSelector }`，`tree_options()` 只认 `unit` / `other_noun` | `web_service/handlers.rs` L1557–1576、L1581、L1609 |

真机数（09-21，AMS）：BRAN `24381_105030 /Copy-of-1RCS380MP-YK/301VP` `model/records` 58 条 = 36 管件 + **22 段 TUBI**；R432 整房树 1298 管件（BRAN 28 单元 / 226），3 m 球 1055——这些数里**一段直管都没有**。

### 1.2 前端今天怎么吃树

| 事实 | 出处 |
|---|---|
| 类型 `SpatialTreeLeaf / Unit / UnitType / OtherNoun / Spec / Room / Response`、`SpatialTreeLeafSelector`；`genModelV1SpatialNearbyTree` / `genModelV1SpatialRoomTree` | `src/api/genModelV1Api.ts` L1680–1790 |
| 端口 `SpatialSource.tree(params, only?)` / `roomTree(roomRefno, options?, only?)` / `capabilities` | `src/model-source/ports.ts` L264–275；适配 `genModelV1/spatialSource.ts` |
| 纯函数 `spatialTree.ts`：`forEachTreeLeaf` / `fullMatchesFromTree` / `mergeTreeLeaves`（`unit=` 补叶后合并）/ `treeNodeLeavesInline` / `treeNodeRefnos` / `treeToNearbyResult` / `branUnitRefnosCoveredBy` / `branUnitRefnosOfTree` | `src/composables/spatialTree.ts` |
| 抽屉树态 `SpatialResultTree.vue`：五层行，计数格 `data-testid="spatial-tree-count"` 直出 `count`，title 拼 `${count} 个构件` | L22 / L42 / L64 / L86 / L244 / L249 |
| 房间页签节点模型 `RoomTreeNodeKind = 'room' \| 'spec' \| 'unitType' \| 'unit' \| 'others' \| 'otherNoun' \| 'element'`，id `room:` / `spec:` / `utype:` / `others:` / `unit:` / `onoun:` / `elem:<房间>:<refno>`；`flattenRoomTree` / `refnosUnder` / `pendingLeafNodesUnder` / `branUnitRefnosUnder` | `src/composables/roomTreeNodes.ts` L23–27；`useRoomTree.ts`；`RoomTreePanel.vue` |
| 三维里直管对象 id 是**计数器**：`${prefix}:${BRAN}:${objectCounter++}`，只记 `tubiObjectIds` 集合、不记「第几段」——今天**没有**「一段直管 → 一个场景对象」的稳定映射 | `src/composables/useDbnoInstancesDtxLoader.ts` L94、L1103；`instanceMapping.ts` L98–125 |
| compat scene 的显隐 / XRAY 状态按 **refno** 记（`DtxCompatViewer`），逐段直管的显隐没有落点 | 方案 A 查证（README §9） |
| 方案 A：`deliveryUnitScene.ts` 只读记录缓存，单元级动作带整条 BRAN；构件行不扩 | `331f2e9b` |

## 2. 目标 / 非目标

**目标**
1. 两条树路由都能把一条 BRAN 单元名下**落在查询范围内、属于该房间**的直段列出来，并给每层一个直段计数。
2. 两棵树在 BRAN 单元下画出直段行（两端管件、长度、无效告警），单元 / 单元类型 / 专业 / 房间 / 摘要的计数句带上直段数。
3. 不破坏既有契约：`count` / `total_count` 语义不变、HTTP 金样 38 条不改、既有 e2e 13 passed 不回归。

**非目标（本计划不做）**
- 不把 TUBI 塞进主空间 R*-tree（ADR-072 D4 保持）；不改快照格式 / 启动判据 / `/health` 十六键。
- 抽屉**平铺态**（`nearby` 结果列表）不列直段——它按 refno 一行一项，直段没有 refno。
- HANG / EQUI 没有隐式直管，不涉及。材料表 / 主归属口径不涉及（沿 ADR 0068 非目标）。
- 不改方案 A：单元级动作仍按整条 BRAN 走；本计划只**加行、加数**，不改已有行为。

## 3. 方案

### 3.1 后端（gen-model-model-cache）

**B1 直段从哪来（拍板 D1）**

- **(b) 按树里已有的 BRAN 单元补**（推荐）：`assemble_tree` 折完管件后，收集本次出现的 BRAN `UnitRoot`（每间房各自那份），对每根取直段记录——先 `ModelMemoryStore::records_of_root(Current, root)`，overlay 没有再 `durable_records_of_root`（新加一个只取 `tubi_relate` 的窄读，不拉 `inst_relate`），过滤 `tube.is_some()`；
  每段按与 `filter_candidates` 同一把尺算「到中心 / 到目标盒的最小表面距离」（`Candidate.distance` 的算法，对 `world_bounds`），`> radius` 的丢；再按 D4 判房；剩下的挂到该单元下。
  代价：O(BRAN 单元数 × 一次根读)——R432 整房 28 根、3 m 球 17 根，冷读 2–3 ms / 根，**< 0.1 s**；100 m 多房那档（`05b` 金样，`candidate_cap` 截断）BRAN 单元数以百计，**要设直段总预算**（如 `tube_root_cap = 500` 根，超了 `tubes_truncated=true` + warning 一句），不许把树路由拖成秒级。
  漏洞：**一条 BRAN 的管件全在范围外、只有直段穿过范围**——这根不在树上，直段补不出来。写进 spec 与教程，接受。
- **(a) 独立的管身 R*-tree**：与主树并行的第二棵树，条目 `{ BRAN, from, to, ordinal, aabb, dbnum }`，随 `sync_tree_after_commit` 增量维护、启动从 `tubi_relate` 重建（或进快照 V5）。查得全（穿过范围的孤直段也命中）、O(log n)，但要碰 ADR-072 D4 的整套一致性闭环（快照头、水位指纹、漂移判据、`/health`），**+2 天**，且树上多出一类没有 refno 的条目要在 `Candidate` / `Hit` / 过滤链全程特判。
  本计划**不取**，作为「(b) 的漏洞真被踩到」之后的升级路。

**B2 响应形状（拍板 D2 / D6 / D7）**

- 参数：`tubes=1`（`RawLeafSelector` 旁新加一格，`tree_options()` 解析），**缺省关**（D6）。关着时响应与今天**逐字节相同**——38 条金样不动、既有 e2e 不动；前端两条 `tree()` / `roomTree()` 恒带 `tubes=1`。
- `TreeUnit` 新增：`tube_count: usize`（恒有，关着时 0）+ `tubes: Option<Vec<TreeTube>>`（内联规则与 `elements` 同一套：`leaves_inline` / `unit=` 选中才内联；直段放置数计入 `leaf_count`、共用 `leaf_cap`——D7）。
- `TreeTube { ordinal: u32, from: "a_b", to: "a_b", from_noun: String, to_noun: String, distance: f32, length: f32, aabb: [[f32;3];2], invalid: bool, shared_rooms?: usize }`——`length` 取 `world_transform` 的 z 缩放（单位圆柱 z∈[0,1] 的约定，`instanceMapping.ts` L7 同一句）；`aabb` 给前端定位飞行用（前端**不用**再从三维对象反查，F4 依赖它）。
- `TreeUnitType` / `TreeSpec` / `TreeRoom` 各加 `tube_count`；`TreeResponse` 加 `total_tube_count`（跨房只算一次，同 `total_count` 口径）与 `tubes_truncated: bool`（B1 预算被截）。
- `count` / `total_count` **不变**（D2 推荐「独立计数」）：客户端已把 `count` 读成「N 个构件」，折进去会让 09-20/21 所有金样与真机账全部改口，而且直段不是 E3D 构件。
- 身份键（D3）：`(BRAN, from, to, ordinal)` 四元组，内存路直接来自 `ProjectedTube`；冷读路 `leave` / `arrive` 在、`ordinal` 缺——**落盘时把 `route_ordinal` 写进 `tubi_relate` 行**（`render_records` 多一格，`INSERT IGNORE` 追加字段、老行读成 `NONE` → 前端按 `(from, to)` 内的出现顺序补 0、1、2…）。不用槽位（整分支重置会改号）、不用几何摘要（对外没有意义）。

**B3 `model/records` 带直段元数据**（PR-T2，前端 F5 / 逐段眼睛的前置，本计划**可选**）

`GeomInst` 加 `tube?: { ordinal, from, to }`（`is_tubi` 才有）：内存路 `projection_record_to_query` 填 `ProjectedTube`；冷读路 `tubi_projection` 加 `leave AS tube_from, arrive AS tube_to, route_ordinal AS tube_ordinal`。前端 `GeomInst` 类型跟着可选加，老后端缺字段不报错。

**B4 测试 / 文档**

- `spatial_tree_view.rs` 单测：夹具加两段直管（一段在范围内、一段在外；一段两端都属该房、一段一端在别房），断 `tube_count` 逐层、`tubes` 内联与省略、`unit=` 只内联一组、`tubes=` 关着时响应与旧金样字节相等；预算截断 `tubes_truncated`。
- `model_record_reader.rs` 单测：`tube` 元数据两路同形。
- HTTP 金样：**新增** `03c-nearby-tree-single-room-tubes.json` / `07c-room-tree-tubes.json`（`spatial-tree-check.ps1` 加两条），既有 38 条不动。
- spec §4.13.5 / §4.13.6 各加一段「`tubes=1`」；ADR：**不新开**，在 ADR-072 D4 下追一句「直段不进主树，树路由按单元补」；`docs/plans/` 落一份后端侧执行计划（照 `2026-09-16-bran-centerline-nearest-clearance-v1-dev-plan.md` 的样子，PR-T1 开工时写）。

### 3.2 前端（plant3d-web）

**F1 类型与端口**：`genModelV1Api.ts` 加 `SpatialTreeTube`、各层 `tube_count`、`total_tube_count` / `tubes_truncated`（全部可选，老后端不带就是 0）；`GenModelV1SpatialNearbyTree/RoomTree` 恒带 `tubes=1`；`GeomInst.tube?`（B3 落地后）。`spatialSource.ts` 透传；`capabilities.treeTubes`（响应里出现 `total_tube_count` 才为真，前端据此决定画不画「N 段直管」）。

**F2 纯函数 `spatialTree.ts`**：`SpatialTreeUnit.tubes?`；`mergeTreeLeaves` 在 `unit=` 补叶时**连 `tubes` 一起合**；新 `treeNodeTubes(target)`（节点下全部直段，单元级及以上）与 `tubeKey(bran, tube)` = `<BRAN>#<from>-<to>#<ordinal>`（四元组拼成一个字符串键，与后端 D3 同一身份）；`treeNodeRefnos` / `branUnitRefnosCoveredBy` **不变**（直段没有 refno，方案 A 的单元级动作已经带整条 BRAN，直段行不参与）。

**F3 两棵树的行与计数**
- 抽屉 `SpatialResultTree.vue`：BRAN 单元展开后，管件行之后列直段行——主标识「直管 · REDU → BEND」、尾巴 `1.2 m`、无效直管带告警色小标（沿 `is_invalid_tubi` 的色）；单元 / 单元类型 / 专业 / 房间的计数格仍显 `count`，title 与状态句改成「N 个构件 · M 段直管」；摘要「共 N 项（去重）」旁加「· M 段直管」（`total_tube_count > 0` 才显）。行 `data-testid="spatial-tree-tube-row"`。
- 房间页签 `roomTreeNodes.ts`：`RoomTreeNodeKind` 加 `'tube'`，id `tube:<房间>:<BRAN>#<from>-<to>#<ordinal>`（`tubeKey` 前面挂房间），`flattenRoomTree` 在 BRAN 单元的构件行之后吐直段行（`leavesInline` 同单元）；`refnosUnder` / `pendingLeafNodesUnder` / `branUnitRefnosUnder` **跳过** `tube` 节点；`ensureLeaves` 补叶时连 `tubes` 一起并。`ModelTreeRow` 类型小标 `TUBI`、勾选框**不画**（D5-i：直段行没有自己的显隐状态，勾选由 BRAN 单元行代表）。
- 直段行的动作（拍板 D5）：**(i) 只读 + 定位**（推荐）——点整行 = 选中所属 BRAN（`setGlobalSelectedRefno(bran)`），「定位」按 `TreeTube.aabb` 飞过去；没有眼睛、没有右键。**(ii) 逐段眼睛**——要 B3 + F5 + `DtxCompatViewer` 新一档对象级显隐（refno 级动作仍是权威、会盖掉逐段状态），另立 PR-T4。

**F4 方案 A 不动**：`deliveryUnitScene.ts` / `withCompanions` / `collectSceneRefnos` 原样；直段行不进任何 refno 集。

**F5（PR-T4 才做）** `useDbnoInstancesDtxLoader`：`inst.tube` 在时记 `tubeObjectIdByKey: Map<tubeKey, objectId>`；`DtxCompatViewer` 加 `setTubeSegmentsVisible(keys, visible)`（对象级，不进 refno 状态表；`setObjectsVisible(BRAN)` 一来整条覆盖）。

**F6 测试 / 文档**
- 单测：`spatialTree.test`（合并 / `treeNodeTubes` / key）、`roomTreeNodes.test`（`tube` 节点、三个 `*Under` 跳过它）、`useRoomTree.test`（展开单元出直段行、眼睛不受影响）、`useSpatialQuery.test`（树态响应带 `tubes`，`withCompanions` 结果不变）、`SpatialResultTree` 组件测（直段行 / 计数句 / 告警色）。
- e2e：两份 spec 各加一条——展开第一个 BRAN 单元后 `spatial-tree-tube-row` 行数 = 同机 `tubes=1` 响应里该单元 `tubes.length`；房间页签同理。
- 文档：教程 §6.1「管件带直段」追一段「树里也列直段：行、计数句、只读 + 定位、漏洞（孤直段）」，§9 差别表 TUBI 行改口；CHANGELOG 一条；ADR 0068 追记 ②；CONTEXT「房间层级树」词条加半句「BRAN 单元下还列直段（不计入构件数）」；验证 README 追 §10（真机三步：抽屉展开 BRAN 见直段行 → 定位飞到一段 → 房间页签同屏；`tubes=1` 响应账）。

## 4. 分期 / PR

| PR | 仓 | 内容 | 估时 |
|---|---|---|---|
| **T1** | gen-model-model-cache | B1(b) + B2 + B4（单测、金样 +2、spec、ADR-072 追一句、后端执行计划一份） | 1.5 天 |
| **T2** | gen-model-model-cache | B3 `model/records` 直段元数据 + `tubi_relate` 落 `route_ordinal`（可与 T1 同笔，但单独一笔好回滚） | 0.5 天 |
| **T3** | plant3d-web | F1 / F2 / F3(D5-i) / F6（单测 + e2e +2 + 文档四处 + 验证 README §10 真机） | 1.5 天 |
| **T4**（可选） | plant3d-web | F5 + F3(D5-ii) 逐段眼睛 | 1 天 |

顺序：T1 → T3（T3 只依赖 T1；T2 / T4 独立）。T1 合入前 T3 可先按 §3.1 的形状写类型与纯函数 + 单测（桩数据），真机与 e2e 等 `:8027` 换上 T1。全部 ≈ **3.5 天**（+1 天 T4）。

## 5. 验证口径（每项都要）

- 后端：`cargo test spatial_tree_view model_record_reader` 全绿；`spatial-tree-check.ps1` **38 + 2 条**全过（旧 38 条字节级不变——`tubes=` 缺省关是硬约束）；`:8027` 真机 `rooms/24381_35580/tree?tubes=1` 的 BRAN `24381_105030` 下 `tube_count` 与 `model/records` 里该根 TUBI 数（22）对得上（范围 = 整房时应相等或更少，多了就是 bug）；100 m 多房那档路由耗时不超过改前 +20%。
- 前端：涉及文件单测全绿；`npm run type-check` 基线外 0；`npx eslint` 触及文件 0；两份 e2e 同机 `--workers=1` 全过（13 + 2）。
- 真机截图 + `tubes=1` 响应账进 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/`（README §10）；每条声称完成附「跑了什么、结果如何」；跑不了的标未验证 + 原因。
- 提交隔离：每笔 `git show --stat` 只含本计划列的文件；别的会话的工作树改动一个 hunk 不碰；改文件前走写锁。

## 6. 明确不做

- 不改 `count` / `total_count` 语义；不把直段算成「构件」；不在平铺态列直段。
- 不建管身 R*-tree、不改快照 / 启动判据 / `/health`（D1 取 (b)）。
- 不给直段行眼睛 / 右键 / 勾选（D5 取 (i)；T4 另议）。
- 不解「孤直段」（管件全在范围外、直段穿过范围）——spec 与教程写明。

## 7. 顺序建议

拍板 D1–D7 → T1（1.5 天，含后端执行计划）→ T3 类型 / 纯函数 / 单测先行（半天，可与 T1 并行）→ `:8027` 换上 T1 → T3 剩余（真机、e2e、文档，1 天）→ T2 / T4 视需要。

## 8. 要拍的决策

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| D1 | 直段从哪来 | (a) 独立管身 R*-tree，穿过范围的孤直段也命中，+2 天、碰 ADR-072 闭环 / (b) 按树里已有 BRAN 单元读根记录补，漏孤直段 | **(b)**，孤直段写进 spec；真被踩到再升 (a) |
| D2 | 计数口径 | 独立 `tube_count` / `total_tube_count`，`count` 不变 / 折进 `count` | **独立** |
| D3 | 直段身份键 | `(BRAN, from, to, ordinal)`，落盘补 `route_ordinal` 字段 / 落盘槽位 / 几何摘要 | **四元组 + 落盘补字段**（老行按出现顺序补号） |
| D4 | 直段属于哪间房 | (i) 两端管件任一属该房（用现成 `member_rooms`，不算几何）/ (ii) 直段盒与房间盒相交（`RoomScope` 要先带上房间盒） | **(i)**；两端都解不出归属的段按 BRAN 里其它成员的房归（再解不出丢弃、计入 `unresolved`） |
| D5 | 前端直段行做到哪 | (i) 只读 + 选中 BRAN + 按 `aabb` 定位 / (ii) 逐段眼睛（要 T2 + T4） | **(i)** 先上，(ii) 另立 T4 |
| D6 | `tubes=` 缺省 | 关（前端恒带 `tubes=1`；金样 / 旧客户端不受影响）/ 开 | **关** |
| D7 | 直段与 `leaf_cap` | 计入 `leaf_count`、共用 5000 上限 / 单独上限 | **共用**（一个开关一套规则；R432 整房 1298 + 直段仍远低于 5000） |
