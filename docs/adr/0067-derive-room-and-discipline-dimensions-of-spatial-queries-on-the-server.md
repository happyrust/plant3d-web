---
status: accepted
date: 2026-09-20
depends_on: ADR-0054
---

# 空间查询的房间与专业两个过滤维度在服务端分页前派生：专业按 SITE 名、房间按任一归属

抽屉「范围 / 距离查询」要能按**房间**与**所属专业**过滤。gen-model-v1 的空间树条目只有 refno / noun / 盒，两个维度都不在树上：专业在任何表里都没有一列，
房间归属是随每个生成根算出的 `面板 → 构件` 边（读透形态还不落边、每次现算）。我们决定：**（1）专业由服务端按候选属主链上 SITE 的名称关键字派生**
（PIPE→管道、ELEC/电气→电气、INST→仪表、HVAC→暖通、CIVI/ARCH→土建、STRU→结构、其余「其他」），规则表进 `DbOption.toml`、缺省即 legacy 后端
`spec_info.rs` 那张——两种数据源对同一构件报同一个专业，前端既有的专业筛选 / 排序 / 分组一行不改就点亮；不按库（dbnum）配、不按 noun 派生。
**（2）房间过滤按「任一归属」命中**：横跨两间房的构件在两间房里都算，「主归属」（材料表取的排序首条）不在这里用。**（3）两者都在服务端、分页前过滤**，
与 noun / dbnums 同一条流水线，`total_count` / 分组 / 分页 / 全集因此一致；前端不做后筛。房间清单由新只读路由 `GET /api/v1/spatial/rooms` 给，线上只收房间 refno。

## Considered Options

- **专业按库配一张 dbnum → 专业表**：库与专业未必一一对应（样例库 1112 里 PIPE / STRU 同库），且要人手维护；SITE 名规则是 legacy 已经跑了很久的口径。
- **专业按 noun 派生**（PIPE / BRAN → 管道…）：要产品口径，且同一 noun（BOX / CYLI）在各专业都出现，答不出结构与暖通之别。
- **房间只按主归属**：范围查询问的是「这间房里 / 附近有什么」，横跨墙的管子漏在两边都不算，比多算一根更糟；材料表另有它的口径。
- **前端逐页后筛**（每条 `e3d.room.lookup`）：「共 N 项」与页数按服务端全量计、每页 N 个请求，09-13 计划在「仅看已加载」上已经踩过一次。
- **房间作为范围本身**（不给中心 / 半径查整间房）：与空间树无关，是另一张表单，不混进范围查询。

## Consequences

- 后端 `/api/v1/spatial/nearby` 与 `/nearby/refnos` 多 `rooms=` / `spec_values=`，响应多 `spec_value` / `spec_groups` / `filter_options.spec_values` /
  `by_spec_value` / `room_status`；新增第七条只读 GET `/spatial/rooms`。过滤顺序固定为 `include_self → 负实体 → dbnums → rooms → 记 facet 计数 → nouns → spec_values → keyword`。
- 专业派生要回元素记录读 OWNER：按 `DirectTreeService` 换代键的逐级记忆让每个元素整个进程生命期最多读一次；首个大半径查询付一次账。
- 读透形态判不出归属的候选（树从快照恢复而投影为空）从结果剔除并计 `unresolved`、带 warning；归属不是当前代照常答、带 warning，不 409。
- 前端 `SiteSpecValue` 补 5 土建 / 6 结构；v1 源 `capabilities.specValues` 翻为 true；结果分组加「按专业 | 按库」两态。
- 词条：`房间` / `房间归属` / `专业` 入 `CONTEXT.md`「空间查询」。共识 zhimo `d-137`；计划 `docs/plans/2026-09-20-spatial-query-room-and-discipline-filter-plan.md`。
