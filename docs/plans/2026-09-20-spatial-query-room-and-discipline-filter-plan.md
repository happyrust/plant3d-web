# 空间范围查询：按房间与所属专业过滤 开发计划

> 日期：2026-09-20。来源：考问（grill-with-docs）两轮——fable-5-1-56 第 1 轮 Q1–Q9、第 2 轮 Q10–Q17，用户两轮都「全按推荐」；
> 共识登记 zhimo `d-137`。上位计划：`docs/plans/2026-09-13-spatial-range-query-gen-model-v1-memory-tree-plan.md`（v1 源接入内存空间树；
> 其 §5-1「v1 源下隐藏专业维度」自本计划起作废）。词条：`CONTEXT.md`「房间」「房间归属」「专业」；决策：ADR 0067。
> 前端基线 `plant3d-web@715b8f2e`（工作树里 `genModelV1Api.ts` / `ports.ts` / `legacy/index.ts` 有已收尾会话的未提交改动，本计划只改不重叠区域、提交时 `git add -p` 只收自己的 hunk）；
> 后端基线 `gen-model-model-cache@b64262136`（`codex/model-projection-cache`，`:8022` 二进制的来源；用户 Q8 拍板落这条线）。
>
> 状态：**PR-A / B / C / D 四个 PR + 复审修正已提交（2026-09-20 09:47–11:40），真机已验（13:15–13:37，复验 15:49–15:58）**——
> 验证库 AMS 7997、并排实例 `:8027`（`gen-model-model-cache@805170bd4` release、mem 档、`room_membership=true`）：HTTP 金样 50 项 + 复验 39 项全过、
> 真 UI 完整流八张截图、e2e `spatial-query-gen-model-v1-ui.spec.ts` 首次真机 9 passed / 1 skipped。记录
> `docs/verification/spatial-query-room-discipline-2026-09-20/README.md`，摘要见 §6；各 PR 完成备注见 §5。

## 0. 一句话

抽屉「范围 / 距离查询」多两个与 noun 并列的过滤维度：**房间**（多选，候选 ∩ 所选房间的成员，任一归属即命中）与**所属专业**
（gen-model-v1 源下由服务端按 SITE 名关键字派生，与 legacy 同一规则，现有专业 UI 原样点亮）；两者都在服务端**分页前**过滤，
`total_count` / 分组 / 分页 / 批量操作的全集自然一致。房间清单来自新只读路由 `GET /api/v1/spatial/rooms`。

## 1. 已核实的基线（2026-09-20 查证）

1. 抽屉现状：范围 / 距离两 Tab 共用过滤块（noun、关键字、仅看已加载、仅看可见、负实体、专业 `specValues`）。v1 源
   `capabilities.specValues=false` → 专业 chips / 「按专业」排序 / 专业分组全部收起，结果按库（dbnum）分组。服务端
   `GET /api/v1/spatial/nearby` 参数只有 `refno|x,y,z, radius, shape, nouns, keyword, sort, include_self, include_negative, dbnums, page, per_page`。
2. 房间在 gen-model：名字含 `room_key_word`（配置 `-RM`）的 `FRMW`（`project_hd`）/ `SBFR`（`project_hh`）元素；`room_num` = 名字按 `-`
   切的最后一段（hd 再过 `^[A-Z]\d{3}$`）；面板 = 其下 1–2 层的 `PANE`（`room_model.rs` L305–355）。**房间归属**是生成模型时按网格算出的
   `panel -> room_relate -> element` 边（`inside_count` / `center_dist`；一个构件可挂多间房，按这两键排序、首条是材料表取的主归属）。
3. 房间归属的**存放随数据形态不同**：落盘 / 摄入形态边在 `SUL_DB` 的 `room_relate`；**读透形态（`store_mode=mem`，`:8022` / `:8024` 都是）
   不落边**，`e3d.room.lookup` 每次用常驻房间模型 + 内存投影现算（`data_interface/room_read_through.rs`，`MemoryRoomCalculator`）。
   对外只有 `POST /api/v1/query` 的 `e3d.room.lookup`（单 refno），没有「列房间」「列房间成员」路由。
4. 房间总开关 `room_membership` 缺省 **false**（2026-09-11 起；`_runs` 下配置都是 false），环境变量 `AIOS_ROOM_MEMBERSHIP=1` 压过配置；
   `gen-model-model-cache` 缺省 features 含 `project_hd`，`:8022` 那种 `--features http_api` 构建里房间子系统在。
5. 抽屉里既有「房间列表」（结果区展开后解析当前页条目所在房间）打旧后端 `:3100 /api/room-tree/ancestors`，v1 源下这条路是断的；只展示不过滤。
6. 专业：legacy 的 `spec_value` 由 **SITE 名关键字**派生（`plant-model-gen src/fast_model/export_model/spec_info.rs::site_name_to_spec_value`：
   PIPE→1 管道、ELEC/DIANQI/电气→2 电气、INST/INSTR→3 仪表、HVAC→4 暖通、CIVI/CIVIL/ARCH→5、STRU/STRUCT→6、其余 0），沿属主链继承。
   前端 `SiteSpecValue` 枚举只认 0–4。gen-model 任何表都没有这一列；`DirectTreeService` 有 `ancestors`（每级回元素记录读一次 OWNER）、
   `name_of`、`dbnum_of`。
7. 后端两条线已分叉（`gen-model-refactor` 与 `gen-model-model-cache` 互不为祖先）；此刻 `:8022` / `:3100` 都没在听。

## 2. 目标 / 非目标

目标：

1. v1 源下，两 Tab 的过滤块多「房间」（可搜索多选 + 手输房间号 + 「当前选中所在房间」）；服务端按房间成员集过滤，分页 / 计数 / 全集一致。
2. v1 源下结果带 `spec_value`，专业过滤 / 「按专业」排序 / 专业分组 / 「加载本专业 / 仅显示本专业」原样点亮；前端枚举补 5 土建 / 6 结构。
3. 结果分组加「按专业 | 按库」两态切换（缺省按专业），按库那一套按钮保留。
4. 房间不可用（开关关 / 非 hd·hh 构建 / 房间模型未就绪）时整块收起并写原因；legacy 源不做房间过滤。
5. 抽屉既有「房间列表」从断掉的 `:3100` 改接 v1 `e3d.room.lookup`。

非目标：

- 「房间作为范围本身」（不给中心 / 半径查整间房）——另一张表单、与空间树无关，另起。
- 房间 facet（`filter_options.rooms` 全集计数）——大半径下要对几万候选反查归属，先不给。
- legacy 后端 / `:3100` 的任何改动；`e3d.room.lookup` 本身不动。
- 按主归属过滤（材料表口径）。

## 3. 决策记录（考问结论）

| # | 题 | 决定 | 理由 / 边界 |
| --- | --- | --- | --- |
| Q1 | 「按房间过滤」语义 | **(a) 结果过滤器**，范围仍是点 + 半径 / refno + 半径 | 「房间就是范围」是另一件事，混进来搅口径 |
| Q2 | 多归属 | **(a) 任一归属含所选房间即命中** | 范围查询问「这间房里 / 附近有什么」，漏掉横跨墙的管子更糟 |
| Q3 | 过滤在哪 | **(a) 服务端**，`rooms=` / `spec_values=` 分页前过滤 | 前端后筛会让「共 N 项」与页数失真（09-13 已踩） |
| Q4 | 房间怎么选 | **(a)+(c) 可搜索多选**，选项来自 `GET /api/v1/spatial/rooms`；手输房间号前端解析成 refno；「当前选中所在房间」走 `e3d.room.lookup` | 在册房间清单在常驻房间模型里现成 |
| Q5 | 房间不可用 | **(a)** `capabilities.rooms` + `/spatial/rooms` 的 `status` 决定，不可用整块收起写原因；legacy `rooms:false` | 四种不可用都答不出来 |
| Q6 | v1 的专业 | **(a) 服务端按 SITE 名关键字派生**（同 legacy），关键字表进 `DbOption.toml`（`spec_value_rules`）、缺省即 legacy 那张 | 两源对同一构件报同一专业；现有 UI 不新做 |
| Q7 | 房间 facet | **(a) 不给**；「房间列表」改接 v1 lookup | 反查几万候选要量过才知多贵 |
| Q8 | 后端落哪 | **(a) `gen-model-model-cache`** | `:8022` 从它构建，验证在那儿 |
| Q9 | 验证 | **(a)** 单测 + 夹具做全，curl / Playwright 脚本备好，用户起服务后跑真机；验证库用户稍后指 | — |
| Q10 | 枚举补全 | **(a) 补 5 土建 / 6 结构**（简称 / 全称 / 配色） | 不然显示「未知专业(5)」 |
| Q11 | v1 分组 | **(b) 「按专业 \| 按库」两态切换**，缺省按专业 | 分组已抽成 `DisplayGroup{kind}`，不废掉已验过的整库流 |
| Q12 | 房间参数形状 | **(a) 线上只收 `rooms=<房间 refno,…>`**（`a/b` / `a_b`）；房间号在前端解析，同号多间全选并提示 | 房间号不保证全库唯一 |
| Q13 | 归属不是当前代 / 未算 | **(a) 照常答**，响应 `room_status` + warning | 探索性查询，过期也比空好，但要说出来 |
| Q14 | 两 Tab | **(a) 共用** | noun / 关键字就是这样 |
| Q15 | 词条 / ADR | **(a)** 三条词条 + ADR 0067 | 派生规则、任一归属、服务端过滤三个取舍都难回头 |
| Q16 | 在飞文件 | **(a)** 直接改不重叠区域，`git add -p` | 那条版本对比会话已收尾 |
| Q17 | 验证实例 | **(a)** 不动 `:8022`，并排起一台 mem 档 + `AIOS_ROOM_MEMBERSHIP=1` | 与 09-17 `:8024` 同法 |

## 4. 设计

### 4.1 接口契约（写进 gen-model `docs/specs/web-service-api.md` §4.13 / 新 §4.13.4）

`GET /api/v1/spatial/nearby` 与 `GET /api/v1/spatial/nearby/refnos` 新增两个可选参数：

| 参数 | 说明 |
| --- | --- |
| `rooms` | 逗号分隔的**房间 refno**（`a/b` / `a_b`）。给了它 = 只保留归属含任一所选房间的候选；不在册的房间 refno → 400 `bad_request`；房间体制不可用（开关关 / 模型未就绪）→ 422 `precondition`（`detail.reason = rooms_unavailable`，`detail.status` 同 `/spatial/rooms` 的 `status`） |
| `spec_values` | 逗号分隔的专业值（整数，0 = 其他）；只保留派生专业在其中的候选 |

过滤顺序改为：`include_self` → 负实体 → `dbnums` → **`rooms`** → 记 `filter_options.nouns` / **`filter_options.spec_values`** 计数 → `nouns` → **`spec_values`** → `keyword`。
两个 facet 计数都落在 `nouns` / `spec_values` / `keyword` 之前（选中一个不能让别的从清单上消失），落在 `rooms` 之后（房间是与 `dbnums` 同级的范围收窄）。

响应新增（老字段一字不变）：

```json
{ "results": [{ "refno": "24383_71586", "dbnum": 24383, "noun": "PIPE", "spec_value": 1, "name": null, "aabb": {...}, "distance": 123.4, "within_radius": true }],
  "groups": [{ "dbnum": 24383, "count": 0 }],
  "spec_groups": [{ "spec_value": 1, "count": 0 }],
  "filter_options": { "nouns": [...], "spec_values": [{ "value": 1, "count": 0 }] },
  "room_status": { "rooms": [{ "refno": "17496_8516", "room_num": "A101" }], "source": "memory | durable",
                   "matched": 12, "unresolved": 0, "definition_version": "…", "library_alignment_current": null },
  "warnings": ["…"] }
```

- `spec_value`：候选属主链上 SITE 名按规则派生；找不到 SITE / 规则都不匹配为 0。`spec_groups` 与 `filter_options.spec_values` 都是过滤后 / 过滤前的全集口径（同 `groups` / `filter_options.nouns`）。
- `room_status` 只在给了 `rooms` 时出现。`source`：`memory` = 读透形态用常驻房间模型 + 内存投影现算；`durable` = 读 `room_relate` 边。
  `unresolved` = 候选里既没有内存投影记录、也读不到边、判不出归属的条数（已从结果剔除）；`> 0` 时 `warnings` 加一句。
  `library_alignment_current`：落盘形态下该库房间边是否对齐到当前代（`e3d.room.lookup` 同一判据）；读透形态 `null`。不是当前代时照常答，`warnings` 加一句。
- `/nearby/refnos` 新增 `by_spec_value: { "1": ["…"] }` 与同样的 `room_status`。

`GET /api/v1/spatial/rooms`（第七条只读 GET，过身份门，不看空间树状态）：

```json
{ "status": "ready | degraded | initializing | disabled | unsupported | failed",
  "reason": null,
  "definition_version": "…",
  "rooms": [{ "refno": "17496_8516", "room_num": "A101", "name": "/A101-RM", "dbnum": 17496, "panel_count": 6 }] }
```

- 只列在册（通过关键字 + 命名校验）的房间，按 `room_num`、refno 排；`name` 由 `DirectTreeService::name_of` 补。
- `status` 由 `room_membership()` 与 `room_resident::lifecycle()` 折出：开关关 → `disabled`；`Loading` → `initializing`；`Unsupported` → `unsupported`；
  `Blocked` → `failed`；`Ready` → `ready`；`Degraded` → `degraded`（仍给清单，`reason` 带 problems 首句）。非 `ready / degraded` 时 `rooms` 为空。

`DbOption.toml` 新键（`DbOptionExt.spec_value_rules`，缺省即 legacy 那张表；首个命中的规则生效，关键字大小写不敏感）：

```toml
spec_value_rules = [
  { value = 1, keywords = ["PIPE"] },
  { value = 2, keywords = ["ELEC", "DIANQI", "电气"] },
  { value = 3, keywords = ["INST", "INSTR"] },
  { value = 4, keywords = ["HVAC"] },
  { value = 5, keywords = ["CIVI", "CIVIL", "ARCH"] },
  { value = 6, keywords = ["STRU", "STRUCT"] },
]
```

### 4.2 后端流水线（gen-model-model-cache）

新模块 `src/fast_model/spatial_discipline.rs`：

- `SpecValueRule { value, keywords }`、`default_spec_value_rules()`（legacy 表）、`classify_site_name(rules, name) -> i64`。
- `spec_value_of(tree: &DirectTreeService, refno) -> i64`：沿 OWNER 链向上找 `TYPE = SITE`，读它的 `NAME` 分类；**逐级记忆**
  （全局 `SpecMemo`，键含 `DirectTreeService::epoch()`，换代即清）：链上每个已算过的祖先都能截断本次爬升，所以整个进程生命期
  每个元素的记录最多读一次；首个 100 m 查询对 5 万候选约 5 万次记录读（与 `name_of` 同代价），之后命中记忆。
- `ElementAttributes` trait 加 `fn spec_value_of(&self, refno) -> i64`（缺省 0，单测查表实现不必改）。

新模块 `src/fast_model/spatial_rooms.rs`：

- `RoomsResponse` / `list_rooms(attrs) -> RoomsResponse`（`/spatial/rooms`）。
- `RoomScope { rooms, panels, members: HashSet<RefU64>, unresolved, source, definition_version, library_alignment_current }`
  与 `resolve_room_scope(rooms, candidates: &[RefU64]) -> Result<RoomScope, SpatialQueryError>`：
  1. 取常驻模型 `room_resident::current_for_calculation()`（取不到 → 422 `rooms_unavailable`）；请求的房间必须都在 `map.rooms` 里（否则 400）；
     面板集 P = 所选房间的 `panels` 并集。
  2. **读透形态**（`data_face().is_read_through()`）：`ModelMemoryStore::room_records_for_members(候选)` 取候选的投影记录，
     `MemoryRoomCalculator::new(model, meshes_dir)` + `calculate_for_root(&records)`（`spawn_blocking`）→ 边里 `panel ∈ P` 的 `member.refno` 进 `members`；
     没有记录的候选计入 `unresolved`。**不取空间串行锁**（只读投影快照；与 `e3d.room.lookup` 不同，那条要对单个构件给出可承诺的答案）。
  3. **落盘形态**：`SELECT VALUE record::id(out) FROM room_relate WHERE in IN $panels`（`SUL_DB`）→ `members`；`unresolved = 0`；
     `library_alignment_current` 按候选所在库逐个用 `query_service` 同一判据算，任一为 false 就 false。
- 候选先按 refno 去重再解归属；候选数为 0 时不算。

`spatial_query.rs`：`RawSpatialQuery` / `SpatialQueryParams` 加 `rooms` / `spec_values`；`Hit` / `NearbyItem` 加 `spec_value`；
`FilterOptions.spec_values`、`NearbyResponse.spec_groups` / `room_status` / `warnings`、`NearbyRefnosResponse.by_spec_value` / `room_status`；
`filter_candidates(candidates, params, center, attrs, room_scope: Option<&RoomScope>)`；`nearby` / `nearby_refnos` 在 scan 之后、assemble 之前
按 `params.rooms` 调 `resolve_room_scope`。

`handlers.rs`：新 `spatial_rooms`；`web_service/mod.rs` 加路由并把它加进 `spatial_routes_are_read_only_get_endpoints` 的清单。

单测（`fast_model::spatial_query::tests` / `spatial_discipline::tests` / `spatial_rooms::tests`）：规则分类（六档 + 大小写 + 中文 + 兜底 0）；
记忆截断（父已算、子只读一次）；`spec_values` 过滤与 facet 计数不受选中影响；`rooms` 过滤只留成员、`unresolved` 计数、`room_status` 形状；
读透路径用 `ResidentRoomModel::from_projection` 合成一块 1000³ 面板 + 一内一外两条记录；参数解析（坏 refno / 坏整数 400）；路由守卫。

### 4.3 前端（plant3d-web）

- `types/spec.ts`：`SiteSpecValue` 加 `Civil = 5`（土建 / 土建·建筑系统，橙）、`Stru = 6`（结构 / 结构系统，青）；选项表、配色、名称函数同步。
- `api/genModelSpatialApi.ts`（legacy 形状）：`SpatialNearbyParams.rooms?: string`；`SpatialNearbyResult.room_status?`、`warnings` 已有；
  `SpatialNearbyRefnosResult.room_status?`。新增 `SpatialRoomsResult { status, reason, rooms: SpatialRoomOption[] }`。
- `api/genModelV1Api.ts`（只动 L1443 起的 spatial 区）：`GenModelV1SpatialNearbyRequest.rooms? / specValues?`，query 串 `rooms` / `spec_values`；
  `SpatialNearbyItem.spec_value?`；`SpatialNearbyResponse.spec_groups? / filter_options.spec_values? / room_status?`；
  `SpatialNearbyRefnosResponse.by_spec_value? / room_status?`；新 `genModelV1SpatialRooms()`；新 `genModelV1RoomLookup(refno)`
  （`POST /api/v1/query` `e3d.room.lookup`，放新文件 `api/genModelV1RoomApi.ts`，只 import `genModelV1Fetch`）。
- `model-source/ports.ts`：`SpatialSourceCapabilities.rooms: boolean`；`SpatialSource.rooms(): Promise<SpatialRoomsResult>`；
  `SpatialSource.roomOf?(refno): Promise<string[]>`（所在房间 refno 列表；legacy 走 room-tree ancestors，v1 走 lookup）。
- `genModelV1/spatialSource.ts`：`rooms` / `spec_values` 透传；`spec_value` 直取；`filter_options.spec_values` / `groups`（专业）/ `by_spec_value` 映射；
  `GEN_MODEL_V1_SPATIAL_CAPABILITIES.specValues = true`、`rooms = true`；`rooms()` / `roomOf()`。`legacy/spatialSource.ts`：`rooms:false`，
  `rooms()` 回 `{status:'unsupported'}`，`roomOf` 走现有 `resolveContainingRoomInfo`。
- `types/spatialQuery.ts`：`SpatialQueryFilters.rooms: string[]`；`SpatialQueryDraft.rooms: SpatialQueryRoomSelection[]`（refno + roomNum + name）；
  `SpatialQueryCapabilities.rooms`；`SpatialQueryResultSet.roomStatus?`；`SpatialQueryRoomOption` / `SpatialRoomsStatus`。
- `useSpatialQuery.ts`：`makeFilters` 带 rooms；`toNearbyParams` / `querySpatialServer` 发 `rooms`（逗号）；`matchFilters` 不判房间（服务端为准）；
  **房间过滤在时本地独有命中不追加、「仅看已加载 / 仅看可见」改走服务端 + 本页后筛**（本地扫描判不了归属）；`roomOptions` / `roomsStatus` /
  `loadRoomOptions()`（抽屉打开 / 源切换时拉一次）；`applySelectedRefnoRooms()`（当前选中 → `roomOf` → 加进 `draft.rooms`）；
  `addRoomsByNumber(text)`（对 `roomOptions` 精确匹配 room_num，同号多间全加并回提示）；`groupDimension: 'spec' | 'dbnum'`（v1 缺省 spec）。
  `spatialCapabilities.rooms`。响应 `room_status.unresolved > 0` / `library_alignment_current === false` 的 warning 由服务端给、抽屉原样显示。
- `SpatialQueryDrawer.vue`：过滤块加「房间」：可搜索下拉（按 room_num / 名称 / refno 过滤 `roomOptions`）、已选 chips、「当前选中所在房间」按钮、
  手输房间号回车；`capabilities.rooms && roomsStatus.status ∈ {ready, degraded}` 才显示，否则一行灰字写原因（`disabled` →「服务端未开启房间归属计算
  （room_membership=false）」…）。专业块随 `hasSpecDimension` 在 v1 下自然出现。结果区标题旁加「按专业 | 按库」切换（只在两维都在时）。
  「房间列表」改走 `spatialSource().roomOf`。
- 单测：`useSpatialQuery.test.ts`（rooms 进请求、房间过滤下不追加本地独有、onlyLoaded + rooms 走服务端、addRoomsByNumber 同号多间、分组维度切换）；
  `spatialSource.test.ts`（rooms / spec_values 透传、spec 映射、rooms() 状态）；`SpatialQueryDrawer.test.ts`（房间块三种状态、专业块在 v1 出现、切换分组）；
  `spec.test.ts`（5 / 6 名称）。

### 4.4 词条与 ADR

- `CONTEXT.md` 新节「空间查询」：**房间**、**房间归属**、**专业**（只讲概念，不带字段名）。
- `docs/adr/0067-derive-room-and-discipline-dimensions-of-spatial-queries-on-the-server.md`：专业按 SITE 名（不按库 / 不按 noun）；
  房间按任一归属；两者都在服务端分页前过滤。

## 5. PR 拆分与状态

1. **PR-A（gen-model-model-cache）**：`spatial_discipline.rs`、`spatial_rooms.rs`、`spatial_query.rs` 参数 / 过滤 / 响应、`handlers::spatial_rooms`、
   路由 + 守卫、`DbOptionExt.spec_value_rules`、spec §4.13 / §4.13.4、单测。验收：`cargo test --lib -- spatial` 全过、`cargo clippy --lib --tests` 本切片 0 警告、
   守卫测试含第七条路由。
   **完成**：`gen-model-model-cache@3707c5b1d`（09:47）——`cargo test --lib -- spatial` 74 passed（`spatial_discipline` 5 / `spatial_rooms` 5 / `spatial_query` +3），
   守卫测试含 `/spatial/rooms`；spec §4.13 / §4.13.4 同一 commit。
2. **PR-B（plant3d-web）**：类型 / 端口 / 两个适配器 / store / `spec.ts` + 单测。验收：既有 `useSpatialQuery` 29 / `spatialSource` 7 / `SpatialQueryDrawer` 23 不回归；新增用例全绿。
   **完成**：`plant3d-web@155becef`（09:49）——`useSpatialQuery` 41 → 48、`spatialSource` 7 → 11、`index.test` 断言更新；新增 `api/genModelV1RoomApi.ts`
   （`e3d.room.lookup`）；type-check 本切片 0 新增。`genModelV1Api.ts` / `ports.ts` 只收了自己的 hunk。
3. **PR-C（plant3d-web）**：抽屉 UI（房间块 / 分组切换 / 房间列表改接）+ 单测。验收：两源各一条 DOM 断言；`eslint` 0；`type-check` 基线之外 0 新增。
   **完成**：`plant3d-web@2c7f65a3`（10:59）——`SpatialQueryDrawer` 23 → 34（房间块 legacy / disabled / error / ready 四种形态、下拉与 chips、回车加入、
   「当前选中所在房间」、「按专业 | 按库」切换、房间列表经 store）；`eslint` 0；`type-check` 基线外 0 新增（基线外唯一一条在
   `versionSource.test.ts`，属在飞的版本对比改动，不在本 PR）。房间过滤 / 分组切换 / 房间列表全部只经 store（`roomsOf` / `roomAttributes`），
   抽屉不再 import `resolveContainingRoomInfo` / `pdmsGetUiAttr`。
4. **PR-D（docs）**：教程 `SPATIAL_QUERY_TUTORIAL.md` §5 / §6 / §9；本计划状态与完成备注；真机验证记录（§6）。
   **完成**：教程 §5 过滤表加「房间过滤」行、专业行改口径，§6 分组切换，§9 差别表 六处 → 七处 + 房间列表改接；`CONTEXT.md`「空间查询」
   三词条；ADR 0067；本计划。真机验证记录 `docs/verification/spatial-query-room-discipline-2026-09-20/`（README + 22 份 JSON + 8 张截图）与本计划 §6 第 6 条，
   随 e2e 口径翻转一起提交。
5. **复审修正（2026-09-20 11:00–11:40，fable-5-1-61 对四个 PR 实读后）**：
   - 后端 `gen-model-model-cache@805170bd4`：(1) `nearby` / `nearby_refnos` 的后半程（过滤 / 派生专业 / 排序 / 切页 / 补 name）挪进
     `spawn_blocking`——`filter_candidates` 现在要对每个候选调 `spec_value_of`（回记录读 OWNER，首个大半径查询可达 `CANDIDATE_CAP` 200k 次同步读），
     原先跑在 tokio worker 上；`ElementAttributes` 加 `Send`、入参改 `Arc<dyn ElementAttributes>`。(2) `spatial_discipline` 共享记忆的 Mutex
     只罩查表 / 写回，记录读在锁外（`try_lock` 探针单测钉住），并发查询不再在 I/O 上串行。(3) `sort=spec_distance`（`SortBy::SpecDistance`：
     `spec_value` 升序再距离 / dbnum / refno）——此前 v1 不认这一档、适配器折成 `distance`，抽屉「按专业」在 v1 下只剩页内分组、跨页不是专业序。
     `cargo test --lib -- spatial` 74 → 76，clippy 本切片 0。spec §4.13 `sort` 三档。
   - 前端：适配器 `spec_distance` 同名直通（`toV1Sort`），`SpatialSort` 类型加这一档；`spatialSource` 11 用例改断言 + 兜底分支。
   - 未改（记在案）：源切到 legacy 时 `draft.rooms` 不随 `capabilities.rooms=false` 清空（模型源是页面级开关，换源要刷新，线上撞不到）；
     落盘路径（`resolve_members_durable` / `library_alignment_current`）只有单测、没有真机可验（`:8022` 开关关着）。

## 6. 验收 / 联调步骤（命令在你自己的终端跑；服务是长驻进程，本会话不代跑）

> 2026-09-20 11:00 状态：四个 PR 已提交，本节一步都还没跑。前提缺两样：(1) **PR-A 的 release 二进制**——要按第 2 步冷构建一次
> （用独立 `CARGO_TARGET_DIR`，别与共享目录里在飞的构建互相判陈旧）；(2) **验证库**——用户待指定。候选：AMS 设计库 **7997**。
> 端口建议 `:8027`，运行目录 `_runs\spatial-rooms-8027`，配置从 `surface-clearance-8024\DbOption.toml` 复制、只改 `http_api_addr` 与 `room_membership = true`。
>
> **2026-09-20 11:51 用户拍板 AMS 7997 → 13:15 `:8027` 起来（用户按 `805170bd4` 构建）→ 13:15–13:37 第 1–5 步全部跑完，15:49–15:58 复验；结果见第 6 条，
> 全文与证据 `docs/verification/spatial-query-room-discipline-2026-09-20/`。**

1. 后端单测：`cd D:\work\plant-code\old\gen-model-model-cache && cargo test --lib -- spatial && cargo clippy --lib --tests`。
2. 干净 worktree 构建（不带别人在途改动）：`git worktree add --detach .scratch\wt-spatial-rooms <sha> && cd .scratch\wt-spatial-rooms && cargo build --release --features http_api --bin aios-database`。
3. 并排起一台 mem 档验证实例（照 09-17 `:8024` 的法子，独立 `_runs\spatial-rooms-80xx`，配置从 `p3-verify-8023\DbOption.toml` 复制、只改 `http_api_addr`）：
   `$env:AIOS_ROOM_MEMBERSHIP='1'; .\aios-database.exe serve`；`GET /api/v1/health` 看 `features.room.status`。
4. 对验证库（用户指定）的房间与构件各 `POST /api/v1/model/ensure` 一次，然后：
   - `GET /api/v1/spatial/rooms` → `status=ready`、`rooms[]` 含目标房间；
   - `GET /api/v1/spatial/nearby?x=&y=&z=&radius=5000&rooms=<房间 refno>` → `total_count` 只含该房成员、`room_status.source=memory`、`results[].spec_value` 非全 0；
   - 同参 `&spec_values=1` → 只剩管道；`filter_options.spec_values` 不因选中收窄；
   - `GET /api/v1/spatial/nearby/refnos?...&rooms=` → `refnos` 数 = `total_count`、`by_spec_value` 各桶之和 = 总数；
   - 不在册房间 → 400；`AIOS_ROOM_MEMBERSHIP` 未开的实例 → `/spatial/rooms` `status=disabled`、带 `rooms=` 的 nearby → 422 `rooms_unavailable`。
5. 前端：`npx vitest run src/composables/useSpatialQuery.test.ts src/model-source src/api/genModelV1Api.test.ts src/api/genModelSpatialApi.test.ts src/components/spatial-query src/types`；
   `npm run lint`；`npm run type-check`；`?model_source=gen-model-v1&gm_backend_port=80xx` 下抽屉：房间块出现、选房间后「共 N 项」变小、专业 chips 出现、
   「按专业 | 按库」切换、房间列表可解析；`?model_source=legacy` 下房间块收起、其余同改前。
6. **真机结果（2026-09-20，`:8027` = `805170bd4` release / mem 档 / `room_membership=true` / AMS 7997 整库 ensure 6772 根 90 s）**：
   - 第 4 步 HTTP（`http/00-summary.json` 50 项全过；15:55 复验 `http/16-recheck-1555.json` 39 项全过）：`/spatial/rooms` `ready` 215 间；以 `R432 = 24381_35580`
     盒中心 r = 3 m——13:17 基线 3934 / `rooms=` **1303**（`matched 1298 / unresolved 0 / source memory / library_alignment_current null`），
     15:55 同参 1302 / **1059**（`matched 1055`；两组数是同一查询打在两种树状态上——13:17 撞上一次性大盒异常、干净重启复不出来，见 README §6 A，两组各自满足全部恒等式）；
     `spec_groups` / `groups` / `filter_options.spec_values` 三处和都 = `total_count`；`spec_values=3` = `spec_groups[3]`、facet 不收窄；
     `sort=spec_distance` 两页并起来 = 全集、跨页专业序成立、大小写不敏感；`refnos` 数 = `total_count`、`by_spec_value` 桶和 = 总数；
     `rooms=1_1` / `abc` / `spec_values=x` / `sort=bogus` 四条 400、`rooms=` 空串 = 不给；`e3d.room.lookup` 交叉核对：答得出的 11 条命中样本全在 R432、9 条滤掉样本全不在。
     **未验**：`422 rooms_unavailable`（要一台 `room_membership=false` 的新二进制实例）、落盘形态（`room_relate` / `library_alignment_current`）。
   - 第 5 步前端：真 UI 完整流（`ui/`，八张截图）1302 → 选 R432 → **1059** → 专业 chip「仪表(1051)」→ 1051 → 清房间 → 1302，「按专业 | 按库」组标题
     「未知或其他 / 仪表系统」↔「库 7997」，房间列表 7 间含 R432（92 项），legacy 下房间块不画，`pageerror` 0；
     e2e `spatial-query-gen-model-v1-ui.spec.ts` 首次真机 **9 passed / 1 skipped**（口径按 ADR 0067 翻过来 + 三处真机修正，见 README §5）；
     `eslint` 0；`type-check` 基线外仍只有别的会话那条。
   - 计时：首个 100 m（61 807 候选、冷记忆）**1096 ms** → 热 247 ms；3 m `+rooms=` 228–466 ms；100 m `+rooms=` **3.4–4.9 s**（读透现算 61 801 候选）。

## 7. 风险与开放问题

- **首个大半径查询的专业派生成本**：5 万候选 ≈ 5 万次记录读（同 `name_of` 代价），之后靠记忆；若真机 > 1 s，退到按库预算一张 refno → 专业表（一次全库遍历）。
  2026-09-20 复审后这一段已在 `spawn_blocking` 里跑、记忆锁不罩记录读（§5 第 5 条）——慢也只慢这一条请求，不再拖住别的请求。
  **真机（§6 第 6 条）：61 807 候选冷记忆 1096 ms、热 247 ms——正卡在 1 s 线上，只此一发；要不要上「按库预算专业表」那条退路，待用户定。**
- **读透形态判不出归属的候选**：树从快照恢复而投影为空（进程重启后没再 ensure 的根）→ `unresolved`，从结果剔除并 warning；要它们进来先显示一次（ensure）。
  真机整库 ensure 后 12 间试探房 + 两轮金样 `unresolved` 全为 0。
- **读透形态现算成本**：`MemoryRoomCalculator` 对每条候选记录做面板 AABB 预筛 + 跨面板者顶点点检查（读 `.mesh`）；房间级半径下候选百到千级，预期几十 ms；
  100 m 级要量。**真机：3 m（1302–3940 候选）228–466 ms；100 m（61 801 候选）3.4–4.9 s。**
- **13:17 那份基线 3940 是一次性异常，干净重启复不出来**（真机顺手发现，README §6 A）：同心同半径 `candidate_count` 13:17 = 3940（墙 / 板类条目 `distance 0`）、
  15:5x = 1302；照用户指示 WMI 重启 + 整库 ensure + 176 次采样（`http/17-repro-tree-settle-*`），candidate 只出现 0 / 1302、探针墙全程 5587 mm、整段没变一次——3940 复不出来。
  先前「发布后有两分钟安定窗口」的猜测被证否，根因在空间树那条线（本轮没动它）。与本计划的过滤无关：两种树状态下恒等式都成立。
- **树里同一 refno 多条条目**（README §6 B）：`total_count` 按条目、`room_status.matched` 按 refno；前端 store 按 refno 合并，抽屉「共 N 项」是服务端条目数。
- **房间号撞车**：线上只收 refno；手输房间号同号多间全选并提示，用户可再删。
- **`room_membership=false` 的部署**：房间块整块收起，抽屉一句话写明；专业维度不受影响。
- **spec 5 / 6 在 legacy**：legacy 服务端早就会派生 5 / 6，前端补枚举后 legacy 源同样显示「土建 / 结构」。

## 8. 关键位置速查

前端：`src/composables/useSpatialQuery.ts`；`src/components/spatial-query/SpatialQueryDrawer.vue`（房间列表 L976–1072、专业块 L296–337、分组 L888–935）；
`src/model-source/{ports.ts, genModelV1/spatialSource.ts, legacy/spatialSource.ts}`；`src/api/{genModelV1Api.ts（L1443 起）, genModelSpatialApi.ts}`；
`src/types/{spatialQuery.ts, spec.ts}`；`src/composables/useRoomInfoPanel.ts`（`resolveContainingRoomInfo`）。

后端（`gen-model-model-cache@b64262136`）：`src/fast_model/spatial_query.rs`（参数 L54–140 / 解析 L171–318 / 过滤 L756–813 / 响应 L930–1077）；
`src/web_service/handlers.rs`（`spatial_nearby` L1447）；`src/web_service/mod.rs`（路由 L582–602、守卫 L1056）；`src/query_service.rs`（`e3d.room.lookup` L701）；
`src/data_interface/room_read_through.rs`；`src/fast_model/room_model.rs`（`RoomPanelMap` L262、`MemoryRoomCalculator` L1956 / `calculate_for_root` L2616）；
`src/fast_model/room_resident.rs`（`ResidentRoomModel.map / panels` L291–296、`lifecycle` L2243、`current_for_calculation` L1783）；
`src/fast_model/model_memory_store.rs`（`room_records_for_members` L733）；`src/options.rs`（`DbOptionExt` L11、`DbOptionExtFields` L551、`room_membership` L1779）；
`docs/specs/web-service-api.md` §4.13（L962）。legacy 规则：`plant-model-gen/src/fast_model/export_model/spec_info.rs` L22–40。
