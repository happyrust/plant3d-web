---
status: accepted
date: 2026-09-20
depends_on: ADR-0067
---

# 空间查询结果与房间浏览共用一棵服务端聚合的房间层级树：房间 → 专业 → 最小交付单元类型 → 单元 → 构件

选了房间的范围 / 距离查询要按层级看结果——房间是根、其下按专业分、再按最小交付单元类型、单元、构件；模型树的 ROOM 标签页在 gen-model-v1 源下也要一棵
同样形状的房间浏览树（legacy 那棵 `room-tree` 没有专业层，且 v1 源下 `:3100` 不在听）。服务端的 `nearby` 每条命中只有 refno / noun / 盒 / 专业，不说它属于
哪间房、哪个单元；结果还是分页的。我们决定：**（1）树由服务端一次聚合**——新只读路由 `GET /api/v1/spatial/nearby/tree`（同 `nearby` 全部参数、`rooms=` 必填）
在同一条过滤链之后按 refno 去重、对每条命中解出所属的所选房间（`rooms=` 已算出的 `面板 → 构件` 边顺手保留 `构件 → 房间`）与最小交付单元根
（沿属主链找首个 `delivery_unit_types` 里的 noun，逐级记忆同专业派生），折成 房间 → 专业 → 单元类型 → 单元 → 构件，不属任何单元的构件归专业下的「其他构件」按 noun 分；
叶子随树内联（refno / noun / 距离，不带名字），叶子放置数超过上限时省略、按节点另取。**（2）横跨多间所选房间的构件在每间房下都出现**（与 ADR 0067「任一归属即命中」同一口径），
只在 `total_count` 里算一次，节点上标「跨 N 房」。**（3）单元是树里独立的一层**，不折进单元类型——它是整根加载与版本对比的入口。**（4）房间浏览是同一聚合器的
第二个入口** `GET /api/v1/spatial/rooms/{refno}/tree`：以房间自身的包围盒为范围、`rooms=` 它自己、不算它自己的面板。抽屉在选了房间时直接以树代替平铺分组，
不加第三态开关；未选房间不建树（要对全部候选反查归属，即 ADR 0067 不给房间 facet 的那笔账）。

## Considered Options

- **前端自己拼树**：`nearby/refnos` 全集 + 逐条 `e3d.room.lookup` + 逐条查单元根——几千条命中就是几千次请求，且「共 N 项」与树对不上；ADR 0067 已为同一理由把过滤放到服务端。
- **在 `nearby` 的每条结果上加 `rooms` / `unit` 两个字段、前端按页分组**：一页只能建半棵树，跨页的单元被切开；分页对树没有意义。
- **树里不给「单元」这一层（单元类型下直接挂构件）**：少一层更瘦，但「整根加载」「看这根 BRAN 的版本」就没处点。
- **跨房构件只挂主归属那一间**：与范围查询「这间房里有什么」的问法相悖，且主归属是材料表的口径。
- **「按专业 | 按库 | 树」三态开关**：多一个控件；树态不选房间本来就不成立，选房即树更少。
- **没选房间也建树（根 = 涉及的每间房 + 「不在任何房间」）**：要对全部候选逐条现算归属，大半径下几万条，先不给。

## Consequences

- 后端多两条只读 GET（第八、第九条），`RoomScope` 多一份 `构件 → 所选房间` 映射（`nearby` 响应一字不变），新增单元根派生与其记忆；树路由按 refno 去重，
  空间树里同一 refno 多条条目的现象在这条路上消失。叶子上限 5000 次放置。
- 前端 `SpatialSource` 多 `tree()`，`capabilities.tree`（legacy false）；store 在「有房间过滤且源支持树」时改打树路由，`items` 由叶子摊平供既有批量动作复用；
  新组件 `SpatialResultTree.vue`；树态下房间列表 / 分页 / 分组开关不再出现。结果区顺势剪辑（图标排 / 单行卡片 / 缩句）另一个 PR。
- ROOM 标签页经新端口 `RoomTreeSource`：legacy 适配器包现有 `room-tree` API，v1 适配器用 `/spatial/rooms` 平铺在册房间、展开一间房走 `rooms/{refno}/tree`。
- 词条：`房间层级树` / `其他构件` 入 `CONTEXT.md`「空间查询」。计划 `docs/plans/2026-09-20-spatial-room-hierarchy-tree-plan.md`。

**追记（2026-09-21，管件带直段）**：树的叶子只有管件——gen-model 把 BRAN 的隐式直管（TUBI）挂在 BRAN 自己的 refno 上、空间索引里不收 TUBI。
只按叶子 refno 做加载 / 显隐 / 隔离，管件会悬空。用户拍板**前端按整条 BRAN 走**（方案 A；把 TUBI 入索引当伪构件的方案 B 未取）：
抽屉批量加载命中管件后按记录缓存里的属主再装它所属 BRAN 的整体（BRAN 自己 + 缓存里这一根的全部构件），单元级及以上的仅显示 / 隔离 / 显隐
与「全部显示 / 隐藏 / 隔离结果」都带上这份整体；构件行的眼睛 / 定位不扩。代价是范围 / 房间之外的那段 BRAN 也会画出来，与模型树「加载模型」
按生成根整条装的既有行为对齐。实现 `composables/deliveryUnitScene.ts`，只读记录缓存、不多打接口。

**追记 ②（2026-09-22，树里 / 计数里列出直段——方案 B）**：用户接着要「树里也要看到直段」。**不把 TUBI 塞进空间树**（gen-model ADR-072 D4 保持），
改为服务端**按单元补**：`nearby/tree` / `rooms/{refno}/tree` 加 opt-in `tubes=1`，折完管件后按树里出现的每个 BRAN 单元读它根名下的管身记录（投影有回执取投影，
否则冷读 `tubi_relate`），直段按与管件同一把尺过范围、按两端管件的房间归属挂到该房的单元下，输出 `units[].tubes[]{ordinal, from, to, from_noun, to_noun, distance,
length, aabb, invalid, shared_rooms?}` 与各层 `tube_count`、顶层 `total_tube_count`；`count` / `total_count` 不变、直段放置数计入 `leaf_count` 共用 `leaf_cap`；
缺省关、关着时响应逐字节相同（小计划 `docs/plans/2026-09-21-room-tree-tube-segments-plan.md`，D1–D7 全按推荐；后端执行计划
gen-model-model-cache `docs/plans/2026-09-22-room-tree-tube-segments-backend-dev-plan.md`，spec §4.13.5「`tubes=1`」；`86bf22f51` + `2aab735df`）。
前端（T3）：`SpatialSource.tree()` / `roomTree()` 恒带 `tubes=1`，端口类型多 `SpatialTreeTubeNode` / `tube_count` / `total_tube_count`；抽屉 BRAN 单元下构件行之后
一组只读直段行（`SpatialResultTreeTubes.vue`：「直管 · A → B · 长度」、无效 / 跨房小标，点行 = 选中所属 BRAN + 按直段盒飞），单元行尾「N 段直管」、各层 title
与摘要带「M 段直管」；房间页签 `roomTreeNodes` 多 `tube` 节点（`tube:<房>:<单元>#<from>-<to>#<ordinal>`，`ModelTreeRow` 只读行、无眼睛 / 勾选，右键只有聚焦 / 查看属性），
`refnosUnder` / `branUnitRefnosUnder` / `pendingLeafNodesUnder` 跳过它；直段行不进任何 refno 集，方案 A 的单元级动作原样。**D5 取 (i) 只读 + 定位**，逐段眼睛（要
`model/records` 直段元数据 + 对象级显隐）另立 T4。已知漏洞：管件全在范围外、只有直段穿过范围的「孤直段」列不出。
