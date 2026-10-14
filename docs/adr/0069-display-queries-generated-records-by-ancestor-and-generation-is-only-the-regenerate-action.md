---
status: accepted
date: 2026-10-12
depends_on: ADR-0065
---

# 显示只按祖先查已生成的记录，生成只由右键「重新生成模型」直接调 `/model/generate`

gen-model-v1 源下「显示一个节点」至今是 D5-A 那条流水（plan `docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md`）：
`POST /model/ensure(force=false)` → 服务端解根、缺的就生成 → 按回执里的 `generation_roots` 分页 `model/records`；摄入形态回 `422 container` 时客户端
展开一层子节点逐个 ensure（深度 3 / 128 根），整库显示则是 `POST dbnums/{n}/model/ensure` 起任务 + 轮询 `tasks/{id}` / `roots?ready=1`。它的根因是**显示动作会改模型库**：
点一次眼睛可能持锁、生成、跑满服务端 120 s 预算；超时、`409 not_generated`、空白三维混成一片，分不清「没生成」「正在后台生成」「出错了」。plant-ui 已在
ADR-0030（2026-10-09）把原则改成「显示只按 `inst_relate` 的 `anc` 索引查已生成的产物，生成只在右键」，gen-model 的服务端半边 ADR-086 已在 v0.1.38 落地：
`/model/records` 在每条路由上都以请求里的根为**祖先**回答（ZONE / SITE 展成名下盖过章的根，BRAN 下的一个 VALV 找到头上那根），没生成过是 **200 空**而不是 409，
`/model/ensure` 改名 `/model/generate`、旧名留一个版本的别名。我们决定 plant3d-web 跟着切：**（1）显示 = 查询。** 眼睛、`showModelByRefno`、几何装载的记录补齐、整库显示，
凡语义是「让三维里出现它」的入口一律只 `POST /model/records { generation_roots: [节点] }`——点下去的树节点就是查询范围，客户端不解根、不展开容器、不生成、不持锁。
查空就是空：树行停在「未加载」，一句 INFO「范围内没有已生成的模型；右键「重新生成模型」可生成」，**不记 ERROR、不弹警告**；409 `conflict`（该库正被整库任务占用）
当「稍后再显示」，同样不生成。**（2）生成只在右键「重新生成模型」**，确认之后对目标 `POST /model/generate { refno, force: true }`（请求体与 ensure 时一字不变；
老服务端 404 时退回 `/model/ensure` 同一请求体，日志点名一次「模型服务是旧版」），**成功回执之后再按（1）对同一目标查 records 并替换场景里的旧几何**；
`generation_pending` / `timeout` 回执不显示，日志写明「服务端后台继续生成，完成后再点眼睛」。摄入形态服务端对 SITE / ZONE 回 `422 container` 时右键里保留**有界**的
展开一层逐个 generate（深度 3 / 128 根）——这是客户端仅存的解根，只发生在右键里，显示路径没有。**（3）整库显示 = 该库 `tree/roots` 下的 SITE 逐个按祖先查**，
构件预算（50 000）照旧；`dbnums/{n}/model/ensure` 整库任务与 `roots?ready=1` 轮询从显示路径退役，API 函数留给后续显式的「重新生成模型（整库）」动作，本轮不加 UI。
**（4）ensure 这个词从客户端消失**：`genModelV1ModelGenerate` / `ModelGenerateResponse` / 记录源的 `collectByAncestor` + `generateThenCollect`；
`forceRegenerate` 不再是几何装载的参数——生成不是装载的副作用。前提：对接的 gen-model ≥ v0.1.38。

## Considered Options

- **保留 D5-A，只修 409 `not_generated` 那条退路**：服务端 ADR-086 之后 409 确实没了，但眼睛照样会生成、照样撞 120 s，修的是症状。
- **显示路径改调 `generate(force=false)` 当「确保有」**：名字换了事没换——显示仍会改模型库；用户原话「显示节点的模型，默认都是使用查询 inst_relate 的 anc 索引」。
- **加一个只解根不生成的接口，客户端拿根清单逐根查 records**：plant-ui ADR-0030 第一稿，用户否了——显示有 `anc` 索引，生成接口自己会解根，第三个东西多余。
- **整库显示保留服务端整库任务（边生成边进视口）**：那是「显示会生成」在整库上的形状；整库生成该是任务队列里的显式动作，不该由「显示整库」触发。
- **右键也完全不解根（与 plant-ui 一字不差）**：对摄入形态服务端，SITE / ZONE 一发 generate 回 422 后右键就什么也做不了；留有界的展开只在右键里，代价可控。
- **树行加「未生成 / 已过期」数据态**：要服务端在回执里报每根状态，ADR-086 D3 不给；显示查空就是未加载、过期与否由人判断。

## Consequences

- `src/api/genModelV1Api.ts`：`genModelV1ModelGenerate`（`/model/generate`，404 退回 `/model/ensure` 一次并记日志）替代 `genModelV1ModelEnsure`；
  `ModelGenerateStatus / ModelGenerateResponse / GenModelV1GenerateRequest / GENERATE_TIMEOUT_MS`；`model/records` 的 `generation_root(s)` 文档改成「祖先」
  （字段名随服务端不动）；`genModelV1DbnumModelGenerate` 保留整库生成入口（服务端路径仍是 `dbnums/{n}/model/ensure`）。
- `modelRecords.ts`：显示用 `collectRecordsByAncestor(refno)`（= 多根 `records` 一批、按 `owner` 归根），右键用 `generateThenCollect(refno, { force: true })`
  （generate → 有界容器展开 → 按祖先查）；`not_generated` 重试 ensure 的退路、`onNotGenerated` 一并退役。`modelRecordSource.ts`：`collectByAncestor` 备忘 /
  进缓存，`generateThenCollect` 先清这条请求名下已缓存的根再查；`instanceEntriesByRefnos` 对未缓存的构件只查、不生成。`treeSource.visibleInsts` 只查。
- `collectDbnum.ts` 收成「逐 SITE 按祖先查」一条路：没有整库任务、没有轮询、没有 `fallback`；`onRefnosReady` 每个 SITE 收完发一批，调用方照旧对账。
- `useModelGeneration.showModelByRefno({ regenerate: true })` 先 `generateThenCollect` 再显示（替换旧几何）；`timeout` / `pending` 回执不装载。
  `useDbnoInstancesDtxLoader` 与 `ports.InstanceEntryQueryOptions` 去掉 `forceRegenerate`。
- **行为变化**：没生成过的节点点眼睛不再触发生成，要人右键；SAVEWORK 之后三维不会自己追新（与 plant-ui 同一取舍）；显示路径没有了「逐根 ensure 进度」弹窗，
  整库显示的进度按 SITE 走。老服务端（< v0.1.38 的内存路由）对未生成的范围仍回 409 `not_generated`：客户端当查空处理，同一句提示、不记 ERROR。
- 源码钉与用例：`display_never_generates`（`modelRecordSource` / `treeSource` / `collectDbnum` 的显示路径不出现 `generate`）、
  `an_empty_scope_is_a_hint_not_an_error`、`regenerate_generates_once_then_displays_the_targets`、`a_timed_out_generate_does_not_display`；
  `collectDbnum.test.ts` 按 query-only 重写。

## Addendum (2026-10-14): 有几何类型的单元 records 为空时自动生成

**背景**：用户反馈「显示模型时，如果是有几何节点的类型（BRAN/HANG/SUPPO/EQUI），但一个模型都没有，需要自动重新生成模型了再显示」，免去手动右键「重新生成模型」。

**决策**：在 `useModelGeneration.showModelByRefno` 的 records 查空分支里，对**有几何的交付单元类型**（`GEOMETRY_UNIT_TYPES = {BRAN, HANG, SUPPO, EQUI}`，来自 gen-model `delivery_unit_types`）触发一次自动生成：

1. 先 `tree.node` 读节点 `noun`，不是几何单元类型（如 SITE/ZONE 容器）不自动生成，保持原提示「范围内没有已生成的模型；右键可生成」。
2. 几何单元类型且 records 为空 → 调 `records.generateThenCollect(refno)`（即 `POST /model/generate`，非 force），成功后重新 `queryLoadScopeRefnos` 再查 records，命中缓存直接装载。
3. 同一 refno 只自动生成一次（`autoGenerateAttempted` 集合去重），避免反复点眼睛反复生成；生成失败（timeout/pending/errors）回退原提示，不进 `loadedRoots`。
4. 生成成功后弹 `[成功] {refno} 模型已自动生成并加载`，失败弹 `[提示] 自动生成未完成：{原因}`。

**与原 ADR 的关系**：原 ADR 「显示 = 查询」的原则不变——本追记是「**空 records 的兜底**」，只发生在「records 确实为空」且「节点类型明确有几何」这两个条件同时满足时；容器（SITE/ZONE）查空仍只是提示，不会自动生成整库。源码钉 `display_never_generates` 钉的是 `modelRecordSource` / `treeSource` / `collectDbnum` 三层，`useModelGeneration` 是显示流程的编排层，本追记不违反该钉。

**验证**：
- 单测：`auto_generate_on_empty_records`（BRAN 空 records 自动生成并装载）、`no_auto_generate_for_non_geometry_type`（SITE 不自动生成）、`auto_generate_only_once`（同一 refno 不重复生成）。
- E2E：`scripts/verify-auto-generate-on-display.mjs` 通过 `showModelByRefnos` 事件触发显示 `24381_144976`（BRAN，records 空），观测到请求序列 `records(空) → tree/ancestors + tree/children(typeInfo) → model/generate → records(16 items) → meshes/*(8)`，确认自动生成正确触发并装载。
- 回归：`useModelGeneration.genModelV1.test.ts` 33 tests、`model-source/genModelV1/` 全部、`model-tree/` 相关测试，共 181 tests 全绿；type-check 新增 0 错误。
