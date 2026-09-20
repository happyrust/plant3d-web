# 空间查询结果与房间浏览的「房间层级树」 开发计划

> 日期：2026-09-20。来源：考问（grill-with-docs）两轮——fable-5-1-7 第 1 轮 Q1–Q6、第 2 轮 Q7–Q12，用户两轮都「全按推荐」
> （Q1 先答成两条相反的，追问后定 (c) 两处都要）；另一条硬约束：**「范围查询界面要尽可能剪辑，不要堆太多东西」**。
> 上位计划：`docs/plans/2026-09-20-spatial-query-room-and-discipline-filter-plan.md`（房间 / 专业过滤，ADR 0067，已真机验证）。
> 词条：`CONTEXT.md`「房间层级树」「其他构件」；决策：ADR 0068。共识登记 zhimo `d-157`。
> 前端基线 `plant3d-web@1dec21bb`；后端基线 `gen-model-model-cache@805170bd4`（`codex/model-projection-cache`，`:8027` 验证实例的来源）。
>
> 状态：**计划已定，PR-A 起干**（2026-09-20 16:3x）。各 PR 完成备注见 §5。

## 0. 一句话

抽屉「范围 / 距离查询」选了房间之后，结果区不再是平铺分组而是一棵 **房间 → 专业 → 最小交付单元类型 → 单元 → 构件** 的层级树
（不属于任何最小交付单元的构件归在专业下的「其他构件」里、按 noun 分）；树由服务端一次聚合（`GET /api/v1/spatial/nearby/tree`），
覆盖全集、不分页、计数按 refno 去重。同一聚合器再开一个入口 `GET /api/v1/spatial/rooms/{refno}/tree`（以房间自身包围盒为范围），
给模型树 ROOM 标签页在 v1 源下做房间浏览树（第二批）。顺带把结果区现有的九个按钮、三行卡片、长提示剪到最少。

## 1. 已核实的基线（2026-09-20 查证）

1. 结果区现状（`SpatialQueryDrawer.vue` L460–735）：标题 + 两行摘要 + 「查看结果」；3 个按钮（加载当前页 / 只加载未加载 / 清空）；展开后
   6 个（全部显示 / 全部隐藏 / 隔离结果 / 恢复场景 / 复制当前页 Refno / 复制已返回 Refno）；中心坐标一行；warnings；**房间列表**一块
   （刷新 + 每行 信息 / 显示）；分页一行；覆盖面提示两行长句；「结果分组 按专业 | 按库」开关；分组头（加载本专业 / 仅显示本专业）；
   每条 3 行卡片（名 / refno / noun · 已加载 · 距离 三个 chip）+ 眼睛 / 定位 / 标注图标。
2. 服务端 `nearby` 响应每条只有 refno / dbnum / noun / spec_value / name / aabb / distance；**不带这条属于哪间房、属于哪个单元**。
   `room_status` 只是汇总（`matched` / `unresolved`）。结果分页（`per_page` ≤ 1000）。
3. **最小交付单元**（CONTEXT.md 既有词条）：类型以后端项目配置为唯一口径，`/health.delivery_unit_types` 缺省 `BRAN / HANG / SUPPO / EQUI`；
   后端 `generation_root.rs` 有 `resolve_element_generation_root(refno, unit_types, lookup)`（纯函数：沿属主链找最近的单元 noun，
   `GenerationRootKind::DeliveryUnit`；找不到给 `Normal` 根），链的取数可以接 `DirectTreeService::lineage_step`（`spatial_discipline` 已经这么接）。
4. 房间归属的成员集在 `spatial_rooms::RoomScope.members`（`HashSet<RefU64>`）；读透形态由 `MemoryRoomCalculator::calculate_for_root` 的
   `面板 → 构件` 边过滤出来（边上有 `panel`，面板 → 房间的映射在 `select_rooms` 手里），落盘形态是 `room_relate WHERE in IN [面板]`——
   两条路都能顺手给出 **构件 → 所属的所选房间** 这一层，今天只是没保留。
5. `Target::Refno(room)` 解中心 = 该 refno 子树（投影里祖先链含它的记录）的并集盒（`resolve_center`），`nearby?refno=24381/35580` 真机回
   `refno_aabb_center`——房间自身的包围盒是现成的；`shape=cube` + 目标盒外扩 r 取候选（`collect_candidates`）。
6. legacy 的 ROOM 标签页（plant-model-gen `/api/room-tree`）：`room-root → room-group → 房间 → comp-group（BRAN / HANG / EQUI / OTHER，按属主链折）
   → room-item（交付单元）→ 成员`，没有专业一层；v1 源下 `:3100` 不在听，整棵是空的。前端 `useRoomTree.ts` 直接 import 那套 API。
7. 空间树里同一 refno 有多条条目（09-20 真机：基线 3934 条 / 3707 个 refno），store 已按 refno 去重；服务端 `total_count` 含重复。

## 2. 目标 / 非目标

目标：

1. v1 源、选了 ≥ 1 间房间：结果区显示服务端聚合的层级树；未选房间维持平铺分组。不加开关。
2. 树覆盖全集（不分页）、每层带按 refno 去重的计数；叶子（构件）随树内联（refno / noun / distance），叶子总数超上限改为按节点展开另取。
3. 每个节点（房间 / 专业 / 单元类型 / 单元 / 其他构件按 noun）都有 加载 / 仅显示 / 隔离 三个动作；叶子沿用现有行动作。
4. 结果区剪辑：九个按钮收成一排图标、卡片改单行、提示缩句、中心坐标并进摘要；树态下房间列表 / 分页 / 分组开关不再出现。
5. 第二批：模型树 ROOM 标签页在 v1 源下 = 在册房间平铺一层（搜索框），展开一间房是同一棵树；legacy 源照旧。

非目标：

- 没选房间时的树（要对全部候选反查归属，大半径几万条现算，即 ADR 0067 Q7 不给房间 facet 的那笔账）。
- 主归属 / 材料表口径；legacy 后端与 `:3100` 的任何改动；房间分组（legacy `room-group` 那层）。
- 叶子带名字（要逐条读记录；单元节点带名字就够）。

## 3. 决策记录（考问结论）

| # | 题 | 决定 | 理由 / 边界 |
| --- | --- | --- | --- |
| Q1 | 树长在哪 | **(c) 两处都要**：后端一条聚合路由共用；先做抽屉树态，紧接着做 ROOM 标签页；一份计划两批 PR | 房间浏览就是「以房间盒为范围 + rooms= 它自己」的一次查询 |
| Q2 | 层级形状 | **(a)** 房间 → 专业 → 单元类型 → 单元 → 构件；专业下另起「其他构件」（不属任何单元，内按 noun） | 单元是版本对比 / 整根加载的入口，少了它「整根加载」没处点 |
| Q3 | 跨房构件 | **(a) 两间房下都出现**，节点标「跨 N 房」 | 与 ADR 0067「任一归属即命中」一致 |
| Q4 | 没选房间 | **(a) 树态只在选了 ≥ 1 间房时可用**，没选仍是平铺分组 | 全候选反查归属太贵 |
| Q5 | 树从哪来 | **(a) 服务端聚合**，叶子随树内联；单元根用 `resolve_element_generation_root` + `delivery_unit_types`，房间归属用 `rooms=` 已算出的边 | 与「过滤在服务端」同一理由；前端逐条 lookup 几千条就是几千次请求 |
| Q6 | 节点动作 | **都给**（加载 / 仅显示 / 隔离），复用 `loadDisplayGroup` / `showOnlyDisplayGroup` 那套 | — |
| Q7 | 剪辑程度 | **(c)** 剪到 (a) 的程度但分两个 PR：树 PR 只隐树态下的冗余块；图标排 / 单行卡片 / 缩句单独一个小 PR 紧跟 | e2e 里按按钮名字找的断言要跟着改，不与树混一个 diff |
| Q8 | 树态入口 | **(a) 选了房间就是树**，不加第三态开关 | 少一个控件；树态不选房间本来不成立（Q4） |
| Q9 | 叶子 | **(a) 随树内联**（refno / noun / distance，不带名字），叶子总数 > **5000** 改为按节点展开另取（同一路由加 `unit=` / `other_noun=`） | R432 3 m 内 1059 条一次就回来 |
| Q10 | 「共 N 项」与分页 | **(a)** 树态下 N = 去重后的构件数（= 各房间计数之和减去跨房重复），`per_page` 不生效；服务端树路由按 refno 去重 | 空间树同一 refno 多条条目那条顺手在树路由里去掉 |
| Q11 | ROOM 标签页的根 | **(a) 在册房间平铺一层**（`/spatial/rooms`，按房间号排，顶上搜索框），多库也不分 | 房间号 + 名字已带楼层 / 区信息 |
| Q12 | 词条 / ADR | **(a)** 词条「房间层级树」「其他构件」+ ADR 0068 | 服务端聚合、任一归属两处都出、单元层三个取舍难回头 |

我自己定的（写出来供否决）：排序——房间按请求顺序，专业同 `spec_distance`（`spec_value` 升序、0「其他」在前），单元类型按
`delivery_unit_types` 配置表顺序、「其他构件」排最后（内按 noun 计数降序再字母），单元按最近成员距离，构件按距离；legacy 源不画树；
`sort` / `page` / `per_page` 对树路由不生效（收下不报错）。

## 4. 设计

### 4.1 接口契约（写进 gen-model `docs/specs/web-service-api.md` §4.13.5 / §4.13.6）

**`GET /api/v1/spatial/nearby/tree`**：参数与 `nearby` 完全相同（`refno|x,y,z, radius, shape, source_mode, nouns, keyword, include_self,
include_negative, dbnums, rooms, spec_values`），**`rooms=` 必填**（没给 → 400 `bad_request`「tree 需要 rooms=」）；`sort` / `page` / `per_page`
收下不生效。另两个可选参数只在叶子超上限后用：`unit=<单元 refno>` / `other_noun=<NOUN>`——只把这一组的叶子内联进来，树骨架照常给。

```json
{ "center": {...}, "radius": 3000, "shape": "sphere",
  "total_count": 1055,
  "candidate_count": 3940, "truncated_candidates": false, "candidate_cap": 200000,
  "leaves_inline": true, "leaf_cap": 5000, "leaf_count": 1061,
  "delivery_unit_types": ["BRAN", "HANG", "SUPPO", "EQUI"],
  "rooms": [
    { "refno": "24381_35580", "room_num": "R432", "name": "/1RX-RM04-R432", "count": 1055,
      "specs": [
        { "spec_value": 0, "count": 8,
          "unit_types": [],
          "others": { "count": 8, "by_noun": [ { "noun": "GWALL", "count": 5, "elements": [ { "refno": "24381_4090", "noun": "GWALL", "distance": 0.0 } ] } ] } },
        { "spec_value": 3, "count": 1047,
          "unit_types": [
            { "noun": "BRAN", "count": 900, "units": [
                { "refno": "24381_1200", "noun": "BRAN", "name": "/C-IY-1R330-B", "count": 80, "min_distance": 12.3,
                  "elements": [ { "refno": "24381_1240", "noun": "TUBI", "distance": 12.3, "shared_rooms": 2 } ] } ] },
            { "noun": "EQUI", "count": 100, "units": [ ... ] }
          ],
          "others": { "count": 47, "by_noun": [ ... ] } }
      ] }
  ],
  "room_status": { ... 同 nearby ... }, "warnings": [ ... ],
  "spatial_state": "ready", "coverage": "global-tree" }
```

- 所有 `count` 都是该节点下**按 refno 去重**的构件数；`total_count` 是全树去重数（跨房构件只算一次）。`leaf_count` 是叶子的放置次数
  （跨房构件在每间房各算一次），它 > `leaf_cap` 时 `leaves_inline = false`、所有 `elements` 省略，客户端按 `unit=` / `other_noun=` 再取。
- `shared_rooms` 只在该构件属于 ≥ 2 间所选房间时出现（Q3）。
- 房间 `name` 由 `DirectTreeService::name_of` 补；单元 `name` 同（单元数远小于构件数）。
- 过滤链与 `nearby` 完全相同（`include_self → 负实体 → dbnums → rooms → nouns → spec_values → keyword`），因此同参数下树的 `total_count` =
  `nearby/refnos` 的去重 refno 数；`filter_options` / `spec_groups` 不再重复给。
- 房间体制不可用 → 422 `rooms_unavailable`（同 `nearby`）；不在册 → 400。

**`GET /api/v1/spatial/rooms/{refno}/tree`**（第八条只读 GET，过身份门）：以该房间为目标（`Target::Refno(room)`，`shape=cube`，`radius`
可选、缺省 0 = 与房间盒相交、上限同 `MAX_RADIUS_MM`）、`rooms=` 就是它自己、`include_self=false`（房间自己的面板不算成员）；其余可选过滤
（`nouns / keyword / include_negative / dbnums / spec_values / unit / other_noun`）透传。响应同上，`rooms[]` 恒一条。房间没有包围盒（从没
生成过面板模型）→ 404 `not_found`（同 `nearby?refno=` 的口径）。

### 4.2 后端流水线（gen-model-model-cache）

新模块 `src/fast_model/spatial_tree_view.rs`（名字避开既有的 `aabb_tree` / `spatial_tree`）：

- `RoomScope` 加 `member_rooms: HashMap<RefU64, SmallVec<[usize; 2]>>`（构件 → 它属于 `rooms` 里的哪几个下标）。读透路径在
  `members_from_records` 里由 `edge.panel` 经「面板 → 房间下标」映射填（`select_rooms` 顺手产出 `panel_rooms`）；落盘路径 SQL 改为
  `SELECT record::id(in) AS panel, record::id(out) AS member FROM room_relate WHERE in IN [...]`。`members` 语义不变，`nearby` 一字不改。
- 单元根派生 `unit_root_of(lineage, epoch, refno) -> Option<UnitRoot { refno, noun, name }>`：沿 OWNER 链找首个 `is_delivery_unit_noun` 的
  祖先（`configured_delivery_unit_types()`），逐级记忆同 `spatial_discipline`（链上每个走过的元素记它的答案；换代整体清空；锁不罩记录读）。
  找不到 → `None`（= 其他构件）。**不**复用 `resolve_element_generation_root` 的 `Normal` 分支：那是生成根的口径，树要的只是「有没有单元」。
- `assemble_tree(scan, params, attrs, room_scope, leaf_cap, only: Option<LeafSelector>) -> TreeResponse`：`filter_candidates`（同 nearby）→
  按 refno 去重（保留距离最小的一条）→ 每条：`spec_value`（已在 Hit 上）、`member_rooms`、`unit_root_of` → 折进 `房间 → 专业 → 单元类型 → 单元`
  或 `房间 → 专业 → 其他 → noun` → 各层计数按去重集合算 → 排序（§3 末）→ 叶子内联或省略。整段在 `spawn_blocking` 里跑（同 nearby 后半程）。
- `spatial_query::nearby_tree(params, centerline, attrs)`：`scan_global_tree → resolve_rooms_for_scan → assemble_off_runtime(assemble_tree)`。
  `room_tree(room, raw_query, attrs)`：把 `{refno: room, shape: cube, radius: r|0, rooms: {room}, include_self: false}` 合成 `SpatialQueryParams`
  后走同一条。
- `handlers.rs`：`spatial_nearby_tree` / `spatial_room_tree`；`web_service/mod.rs` 两条路由 + `spatial_routes_are_read_only_get_endpoints` 守卫清单。
- 单测：`member_rooms` 两条路径的填法；单元根派生（有单元 / 无单元 / 记忆截断 / 换代清空）；`assemble_tree` 在 `filter_tree` 夹具上的形状
  （两间房、跨房构件 `shared_rooms=2` 且 `total_count` 只算一次、其他构件按 noun、排序、`leaf_cap` 触发后 `elements` 省略、`unit=` 只内联一组）；
  `rooms=` 缺失 400；路由守卫含两条新路由。

### 4.3 前端（plant3d-web）——第一批

- `api/genModelV1Api.ts`（只动 spatial 区）：`SpatialTreeResponse` 及各层类型；`genModelV1SpatialNearbyTree(request)`、`genModelV1SpatialRoomTree(refno, request)`。
- `model-source/ports.ts`：`SpatialSource.tree?(params): Promise<SpatialTreeResult>`；`SpatialSourceCapabilities.tree: boolean`（v1 true，legacy false）。
- `types/spatialQuery.ts`：`SpatialTreeNode` 判别联合（`room | spec | unitType | unit | others | otherNoun | element`），`SpatialQueryResultSet.tree?`。
- `useSpatialQuery.ts`：`hasRoomFilter && capabilities.tree` → 服务端查询改打 `tree`（不再打 `nearby` 分页；`nearby/refnos` 全集照取，供批量动作）；
  `resultSet.items` 由树叶子摊平（去重；`loaded / visible` 照旧从场景算），`total` = 树 `total_count`；叶子未内联时 `items` 为空、
  批量动作走 `fullMatches.refnos`；`expandTreeLeaves(node)`（`unit=` / `other_noun=` 补叶子）；节点动作 `loadTreeNode / showOnlyTreeNode / isolateTreeNode`
  按节点下的 refno 集合调既有实现。
- 新组件 `spatial-query/SpatialResultTree.vue`：五层折叠树，每行一句（图标 + 标题 + 计数 + 三个小动作），叶子行沿用现有行动作但**单行**；
  跨房构件行尾「跨 N 房」小标。抽屉在 `resultSet.tree` 存在时用它替换分组列表，并隐藏房间列表块、分页行、「结果分组」开关。
- 单测：`useSpatialQuery`（选房后打 tree、items 摊平去重、叶子未内联时 items 空、节点动作的 refno 集合、清房间回到 nearby）；
  `spatialSource`（tree 透传与映射、legacy `tree` 缺省）；`SpatialResultTree`（五层渲染、计数、展开、动作、跨房标）；`SpatialQueryDrawer`
  （树态下三块隐藏、无房间时照旧）。

### 4.4 结果区剪辑（PR-B2，紧跟 PR-B）

- 九个按钮 → 一排图标（`lucide`，带 `title`）：加载未加载（并掉「加载当前页」——树态下没有页；平铺态下按钮语义改为「加载本页未加载」）·
  全显 / 全隐 · 隔离 / 恢复 · 复制（一个按钮，点开二选：本页 / 全部）· 清空。`data-testid` 保留 `copy-current-page-refnos` / `copy-all-returned-refnos`。
- 覆盖面提示缩成一句「只含已生成过模型的构件」+ `title` 全文；中心坐标并进摘要第二行；warnings 不动。
- 构件行 3 行 → 1 行：`refno · noun · 距离`，未加载用灰字而不是 chip，名字有就替代 refno 显示、refno 进 `title`。
- e2e `spatial-query-gen-model-v1-ui.spec.ts` 里按按钮名字找的断言（「加载当前页」「复制当前页 Refno」…）跟着改；单测同步。

### 4.5 ROOM 标签页（PR-D，第二批）

- 新端口 `RoomTreeSource`（`model-source/ports.ts`）：`roots()` / `children(nodeId)` / `ancestors(nodeId)` / `search(keyword)`；legacy 适配器包现有
  `genModelRoomTreeApi`；v1 适配器：`roots()` = `/spatial/rooms` 平铺（按 `room_num` 排，节点 id `room:<refno>`），`children(room)` = `rooms/{refno}/tree`
  展成 `spec:<room>:<v>` → `utype:<room>:<v>:<NOUN>` / `others:<room>:<v>` → `unit:<room>:<refno>` / `onoun:<room>:<v>:<NOUN>` → 构件（id = refno，
  与场景对象同键，显隐勾选才作数）。一间房的树取一次整棵缓存在适配器里，各层 `children` 从缓存切。
- `useRoomTree.ts` 改经端口；`ModelTreePanel.vue` 的 ROOM 标签在 v1 源下顶上加房间搜索框（按房间号 / 名字过滤根列表）；显隐勾选 / 选中 / 定位沿用。
- 单测：v1 适配器展平（五层 id 与 parent 关系、构件 id = refno）、`roots()` 排序与搜索；`useRoomTree` 在两种适配器下的 children 加载。

### 4.6 词条与 ADR

- `CONTEXT.md`「空间查询」加：**房间层级树**、**其他构件**。
- `docs/adr/0068-aggregate-a-room-hierarchy-tree-on-the-server-for-spatial-results-and-room-browsing.md`。

## 5. PR 拆分与状态

第一批：

1. **PR-A（gen-model-model-cache）**：`spatial_tree_view.rs`、`RoomScope.member_rooms`、单元根派生、两条路由 + 守卫、spec §4.13.5 / §4.13.6、单测。
   验收：`cargo test --lib -- spatial` 全过、`cargo clippy --lib --tests` 本切片 0 警告；`:8027`（还在跑，`805170bd4`）换新二进制后
   `nearby/tree?…&rooms=24381_35580` 的 `total_count` = `nearby/refnos` 去重数、各层计数相加相等。
   **完成**：`gen-model-model-cache@06b067b51`（16:56）+ 补 `65dacd576`（17:33，树路由先核房间在册再扫树——真机 `rooms/1_1/tree` 曾答 404）。
   `cargo test --lib -- spatial` 76 → 84 passed（`spatial_tree_view` 7 + `member_rooms` 1），clippy 本切片 0。
   **真机**（`:8027` = `65dacd576` release、mem 档、7997 整库 ensure 6772 根 / 66 135 条房间边，17:37–17:44）：HTTP **38 项 / 0 败**
   （`docs/verification/spatial-room-hierarchy-tree-2026-09-20/http/00-summary.json`）——R432 3 m：`total_count` 1298 = `nearby/refnos` 去重数、
   叶子集合 = 全集、每层计数相加相等、专业 0 在前、单元类型按配置表序、单元按距离；R432 + R143 两间房：1298 + 1337 = 2635 ≥ 1925 去重，
   差 710 = 带 `shared_rooms` 的构件数、每个都在两间房下各出现一次；60 间房 100 m：`leaf_count` 23 591 > 5000 → 全部 `elements` 省略，
   `unit=` / `other_noun=` 只内联那一组；`rooms/{refno}/tree` 200（`refno_aabb_center`、cube、radius 0；`radius=500` 外扩 ≥；`nouns=PANE` 透传）；
   不带 `rooms=` / 不在册 / 坏路径 / `x,y,z` / 两个选择器同给 → 400。耗时：3 m 461 ms（热 434），100 m 单房 2.95 s，60 房 3.6 s，`rooms/{refno}/tree` 216 ms。
2. **PR-B（plant3d-web）**：类型 / 端口 / 适配器 / store / `SpatialResultTree.vue` / 抽屉树态 + 单测。验收：既有空间查询单测不回归；新增全绿；
   `eslint` 0；`type-check` 基线外 0 新增；`:8027` 真机选 R432 出树、计数对得上服务端。
   **完成**：`plant3d-web@fb2ed9a3`（18:02）。vitest 空间套件 112 passed（store 48 → 51、适配器 11 → 12、`spatialTree` 纯函数 5）；
   真机（dev `:3111` + `:8027` = `65dacd576`）选 R432 → 树、「共 1055 项（去重）· 1 间房」= 服务端 `total_count`，加 R143 → 两房 661 + 1055 / 去重 1056、
   「跨 2 房」11 处；清房间回平铺 1302（`docs/verification/spatial-room-hierarchy-tree-2026-09-20/ui/tree-01…03.png`）。
   **补（行文字截断，20:14）**：336 px 抽屉里 `R432 · /1RX-RM…` / `BRAN · 17…` 被截——原因是三个动作按钮 `opacity-0` 仍占行宽 1/3。
   改为：动作绝对定位叠在标题单元格右端、平时 `invisible`、行悬停 / 行内键盘焦点（`group-has-[:focus-visible]`）才显，计数始终贴右；
   房间行只显房号、单元行只显名字（没名字才 refno）、「其他构件」只四个字，名字 / refno / 说明 / 构件数全进 `title`；
   距离、「N 个单元」等短尾巴 `shrink-0`；层级缩进 18 → 12 px。顺带核出 **Vuetify `main.css` 的 `.opacity-0` / `.pointer-events-none` 带 `!important`**，
   会压掉 Tailwind 的 `group-hover:opacity-100`——改前那三个按钮在真机上悬停根本不出现（Playwright 把 opacity 0 当可见，e2e 没拦住）。
   新增 `SpatialResultTree.test.ts` 7 项（五层渲染 / 计数 / title / 动作叠放 / 展开取叶 / 跨房标 / 空态）。真机复核：12 行主标识 ≤ 28 字的都不再溢出、
   计数右缘离面板右缘 12 px、悬停动作可见且不盖计数（`ui/tree-04…06.png`、`tree-rows-truncation-summary.json`）。
3. **PR-B2（plant3d-web）**：结果区剪辑 + e2e 断言跟改。验收：单测 / e2e 全绿（e2e 在 `:8027` 上跑）。
4. **PR-C（docs）**：教程 `SPATIAL_QUERY_TUTORIAL.md` 树态一节；本计划状态；真机验证记录 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/`。

第二批：

5. **PR-D（plant3d-web）**：`RoomTreeSource` 端口 + 两个适配器 + `useRoomTree` 改经端口 + ROOM 标签页搜索框 + 单测；真机 ROOM 标签页截图。

## 6. 验收 / 联调步骤

1. 后端：`cd D:\work\plant-code\old\gen-model-model-cache && cargo test --lib -- spatial && cargo clippy --lib --tests`。
2. 干净 worktree 构建（同上位计划 §6 第 2 步，sha 换 PR-A 的），二进制放 `_runs\spatial-rooms-8027\aios-database-<sha>.exe`，停旧起新（`service.pid`）；
   mem 档重启即空，先 `POST dbnums/7997/model/ensure` 一次（90 s）。
3. HTTP：`GET :8027/api/v1/spatial/nearby/tree?refno=24381/35580&radius=3000&shape=sphere&rooms=24381_35580` →
   `rooms[0].count = total_count`（单房）、`Σ specs.count = rooms.count`、`Σ unit_types.units.count + others.count = spec.count`、
   `total_count` = 同参 `nearby/refnos` 去重数；两间房（`rooms=24381_35580,24381_5062`）→ `Σ rooms.count ≥ total_count`、有 `shared_rooms` 的构件在两房都出现；
   `radius=100000` → `leaf_count > 5000`、`leaves_inline=false`、`elements` 全省略，再带 `unit=<某单元>` 只回那一组叶子；
   `rooms/24381_35580/tree` → 200、`center.source=refno_aabb_center`、`rooms[]` 一条；不带 `rooms=` 的 `nearby/tree` → 400；`rooms=1_1` → 400。
4. 前端：`npx vitest run src/composables/useSpatialQuery.test.ts src/model-source src/components/spatial-query src/types`；`npm run lint`；`npm run type-check`；
   `?model_source=gen-model-v1&gm_backend_port=8027` 抽屉：选 R432 → 结果区是树、「共 N 项」= 树 `total_count`、五层可展开、节点「仅显示」只留该节点；
   清房间 → 回到平铺分组；`?model_source=legacy` 一切同改前。
5. PR-D：ROOM 标签页在 v1 源下列出 215 间房、搜 `R432` → 一条、展开五层、勾选显隐生效。

## 7. 风险与开放问题

- **单元根派生成本**：每条命中沿 OWNER 爬到单元（管件 2–3 级、设备 1–2 级），逐级记忆后每个元素整个进程生命期读一次；房间级候选千级，预期几十 ms；
  `rooms/{refno}/tree` 若房间很大（几万构件）与 100 m 级同量，`leaf_cap` 只省传输不省派生——真机量 100 m。
- **叶子未内联时的批量动作**：`items` 为空，加载 / 隔离走 `nearby/refnos` 全集（既有路），但「仅显示本节点」要该节点的 refno 集合——超上限时先取该节点叶子再做，动作变成两步；抽屉上提示一句。
- **跨房构件在两房都出现**：树里的 `count` 之和 ≠ `total_count`，摘要写「共 N 项（去重）」避免对不上的疑问。
- **ROOM 标签页与场景显隐**：分组节点是合成 id，没有场景对象；勾选状态由子构件推导（`useRoomTree` 现有 `getCheckState` 已是推导式）。
- **legacy**：不画树、ROOM 标签页照旧走 `:3100`；`capabilities.tree=false`。
- **Tailwind 与 Vuetify 同名工具类**：Vuetify `main.css` 的 `.opacity-0…100` / `.pointer-events-none|auto` / `.bg-white` 等带 `!important`，
  Tailwind 的 `hover:` / `group-hover:` 变体压不过。悬停显隐一律用 `invisible` / `visible`（visibility），别用 opacity；仓里另有 14 处
  `opacity-N … group-hover:opacity-100`（`ViewerPanel` 侧栏 tooltip 11、`PipeDistanceDrawer` 2、`AnnotationScreenshotCard` 1）疑似同病（未逐个真机核），
  PR-B2 剪辑时不顺手改，另开一条。

## 8. 关键位置速查

前端：`src/components/spatial-query/SpatialQueryDrawer.vue`（结果区 L460–735、`displayGroups` L1132）；`src/composables/useSpatialQuery.ts`；
`src/model-source/{ports.ts, genModelV1/spatialSource.ts, legacy/spatialSource.ts}`；`src/api/genModelV1Api.ts`（spatial 区）；`src/types/spatialQuery.ts`；
`src/composables/useRoomTree.ts`、`src/api/genModelRoomTreeApi.ts`、`src/components/model-tree/ModelTreePanel.vue`（ROOM 标签 L71–105）。

后端（`gen-model-model-cache@805170bd4`）：`src/fast_model/spatial_query.rs`（`resolve_center` L537、`collect_candidates` L685、`filter_candidates` L832、
`assemble_nearby` L1144、入口 L1301）；`src/fast_model/spatial_rooms.rs`（`RoomScope` L174、`select_rooms` L231、`members_from_records` L279、
`resolve_members_durable` L324、`resolve_room_scope` L361）；`src/fast_model/spatial_discipline.rs`（记忆模式 L71–209）；
`src/data_interface/generation_root.rs`（`DEFAULT_DELIVERY_UNIT_TYPES` L32、`is_delivery_unit_noun` L213、`configured_delivery_unit_types` L288）；
`src/web_service/handlers.rs`（`spatial_nearby` / `spatial_rooms`）；`src/web_service/mod.rs`（路由 L582–602、守卫 L1056）；`docs/specs/web-service-api.md` §4.13。
