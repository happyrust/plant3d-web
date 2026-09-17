# 构件到墙最近距离（外表面净距）开发计划

> 日期：2026-09-17。来源：考问（grill-with-docs）两轮——fable-5-1-7 17:14 第 1 轮 Q1–Q7；fable-5-1-17 19:3x 事实纠正（`nearest-points` 不在 gen-model、网格与 parry 都在 gen-model、09-11 计划已留位）+ 第 2 轮 Q8–Q9；用户 19:4x 拍板「Q1 选 (a)：closest_points 出最近距离，命中墙主面时附 raycast 垂距；其余 Q2–Q8 全按推荐」，此前一句「这些 mesh 都是提前生成的，使用 parry3d 提供的方法」定了 Q9 与内核来源。
> 上位计划：`docs/plans/2026-09-11-measurement-clearance-dimension-convergence-plan.md`（D1 三领域分离、D2 精度不是布尔、D3 单位、D4 可失效；PR1.2 后端距离契约 v2、PR1.3 精算内核）。本计划是它 M1 里「管—墙 / 通用 mesh—mesh」那两格的第一次落地。
> 平级参照：gen-model `docs/plans/2026-09-16-bran-centerline-nearest-clearance-v1-dev-plan.md`（`/api/v1/spatial/nearest-clearance` / `centerline`，在 `gen-model-model-cache` 分支）。
> 共识：决策 `d-428`（2026-09-17 登记，含 Q1–Q9 全部口径与适用边界）。

## 0. 一句话

用户选中一个构件、再点一堵墙（直墙 / 弧墙 / 带洞墙都行），系统在 gen-model v1 后端用**两侧真实三角网格**算出外表面最近距离与两侧最近点（parry3d `closest_points`），命中墙主面时再沿墙面法向补一条**垂距**（parry3d `RayCast`）；结果作为第一个真正的 `ClearanceRecord` 进前端领域层，用外部尺寸源画出来，模型换版本自动标 stale。

## 1. 目标 / 非目标

目标：

1. 一对：选中构件（任意 noun，含 owner）→ 选中的墙（CWALL / WALL / STWALL / GWALL / PANE），外表面到外表面最近距离；穿透时距离 0 且 `intersects = true`。
2. 直墙精确；弧墙 / 带洞墙走同一条网格路径，误差 ≤ 弦高容差 `FACET_TOL_MM = 0.5 mm`，写进 `error_bound_mm`。
3. 结果带方法、精度档、两侧命中叶子 refno、命中墙面分类（内 / 外 / 顶 / 底 / 端）、E/N/U 分量、模型版本。
4. 命中墙主面（内 / 外侧）时附带「垂直于墙面的距离」（raycast），并把那条射线画成尺寸线。
5. 前端：新 `src/clearance/` 领域（09-11 D1），拾取流主入口 + 空间查询抽屉「净距标注」改接同一 service。

非目标（本期不做，二期候选）：

- 「找最近的墙」（一对多）——二期用 `/api/v1/spatial/nearest-clearance` 粗筛喂精算。
- 弧墙解析圆柱面精确解；穿透深度（最小平移量）；「轴线到墙面 − 半径」附加行。
- 前端本地算距（three / BVH）；legacy `/api/space/nearest-points` 的任何改动。
- 通用右键菜单。

## 2. 已核实的基线（2026-09-17 查证，带出处）

### 2.1 现有净距路径全是近似口径，且主路径已经不在跑

- `/api/space/nearest-points` 在 **legacy 后端 plant-model-gen**（`D:\work\plant-code\plant-model-gen\src\web_server\sqlite_spatial_api.rs` 3881–4240）：sqlite AABB 索引，只有 `centerline_aabb` / `aabb_aabb` 两种口径；**:3100 此刻没有监听**，跑着的是 gen-model :8022 / :8023（`_runs\…\aios-database.exe`）。
- 前端 `usePipeDistanceStore.runDetection` → `postSpaceNearestPoints`（`src/api/genModelSpatialApi.ts` 872）打的就是这条；失败后 `PipeDistanceDrawer.createDtxAxisDistanceFallback` 用 dtx 轴线兜底（`detectDtxBranchAxisDistances`）。
- `SpatialQueryDrawer.annotatePipeDistance`（1130–1139）把「源 refno + 结果行」塞给 `pipeDistanceStore.autoDetectBrans`，同一条死路。
- `src/utils/three/geometry/clearance/pipeClearance.ts`：无限长圆柱 × 无限平面解析式；`src/measurement/kernel/shortestDistance.ts`（d-619）只算点 / 无限线 / 无限面三种拾取操作数。
- `src/clearance/` 目录不存在；09-11 计划 PR0.1 / PR1.1 列的模块一个都还没建。

### 2.2 网格在 gen-model，且是现成的

- 单位网格 `assets/meshes/{geo_hash}.mesh`（rkyv；`/api/v1/meshes/{file}` 给浏览器的 GLB 是同一份，`web_service/mod.rs` 588–590）。`inst_relate` 行带 `world_trans.d`、`insts_flat[]{geo_hash, transform}`、`booled_id`（布尔后整块 `{booled_id}.mesh`，实例变换已烘进）、`model_sesno`、`aabb.d`、`anc`（祖先链，`idx_ir_anc` 索引，`anc CONTAINS pe:<refno>` 走索引）。
- `rvm_baseline/mesh_compare.rs::gen_world_mesh(db, pe_key) -> Option<TriMesh>`（330–407）已把上面这条链拼成世界 mm 的 `parry3d::TriMesh`（`#[cfg(feature = "manifold")]`，`manifold` 在默认 features 里）。它先 `tessellate_libgm_param` 再回退磁盘 `.mesh`；本计划改为**只读磁盘**（用户 2026-09-17 拍板「mesh 都是提前生成的」）。
- 模型版本：行上的 `model_sesno`（与 `gen_root.source_end_sesno` 同源）。

### 2.3 算力：parry3d 现成，不自写

- `parry3d::query::closest_points` 对 composite（TriMesh）× 任意形状走嵌套 BVH 最优先遍历（`default_query_dispatcher.rs` 256–266：`closest_points_composite_shape_shape` / `closest_points_shape_composite_shape`），TriMesh × TriMesh 得到精确三角对最近点；相交回 `ClosestPoints::Intersecting`。
- `TriMesh: RayCast`（`cast_local_ray_and_get_normal`），gen-model `data_interface/db_model.rs` 21 已在用。
- `fast_model/shared.rs` 137–225 已有 `TriMesh::project_local_point` 的采样表面距离（RVM 对拍用），说明 `TriMesh` 的 BVH 在本仓可用、可测。
- gen-model 依赖的是 `gitee.com/happydpc/parry.git` fork（`Cargo.toml` 158），本地 checkout `~/.cargo/git/checkouts/parry-255df455e436d3fa/06fd686`。

### 2.4 墙的几何与 noun 族

- CWALL（owner）→ 成员 STWALL（直墙，与 SCTN 同一条截面链）/ GWALL（挤出）/ WALL / PANE（ams1112 实测 CWALL → PANE 1995 / GWALL 122 / STWALL 76 / WALL 14，`vendor/e3d-model/src/category.rs` 285）。`/nearest-clearance` 的预置组 `wall` = WALL / PANE / GWALL / STWALL（`genModelV1Api.ts` 1110），本计划沿用并加 CWALL 作 owner。
- 弧墙：`old-aios-core/prim_geo/wire.rs` `CurveType::Spline(thick)`，bulge 折线（cavalier_contours）扫掠体；弦高容差全库唯一 `FACET_TOL_MM = 0.5 mm`（`libgm_discretise.rs` 40，libgm `arctol_` 同口径）。
- 扫掠帧约定（`old-aios-core/rs_surreal/spatial.rs` 662–665）：X = 行进左法向、Y = 上、Z = 切向；外侧面 OBOW = −X、内侧面 IBOW = +X。
- 带洞墙 = 布尔后 `{booled_id}.mesh`，与显示同一份。

### 2.5 前端可复用件

- 拾取：`useToolStore.startPickRefno(nouns, cb)` / `startBoxPickRefno` / `cancelPickRefno`（`useToolStore.ts` 1996–2060），`toolMode = 'pick_refno'`；`PipeDistanceDrawer` 69–83 是现成用法。
- 选中：`useSelectionStore().selectedRefno / selectedRefnos`。
- 画：`dimensionSystem.replaceExternalSource(sourceId, ExternalDimensionRecord[])`；`usePipeDistanceAnnotationThree.ts` 56–98 是现成的 `ExplicitLayoutInput`（`lines[{from, to, part: 'dimension' | 'projection', style}]`、`labelAnchor`、`formattedLabel`）；scene ↔ design 换算走 `__dtxLayer.getGlobalModelMatrix()`。
- v1 客户端：`genModelV1Fetch` + 身份三格 `project / mdb / namespace`（`ProjectReq`，`handlers.rs` 23–35）；refno 走 `toV1Refno`。

## 3. 决策记录（考问结论）

| # | 题 | 决定 | 理由 / 边界 |
| --- | --- | --- | --- |
| Q1 | 「最近距离」语义 | **(a) 外表面到外表面**（`closest_points`）为主结果；命中墙主面（内 / 外侧）时附**垂距**（自源侧最近点沿命中三角法向 `cast_ray` 到墙面），射线画成尺寸线 | 射线量距要先知道方向，最近距离没有先验方向：构件在墙端外斜靠、弧墙径向逐点不同、构件自身曲面——三种场面纯 raycast 都会算错或落空。两口径在构件正对墙面时相等 |
| Q2 | 领域 | **(b) `ClearanceRecord`**（09-11 D1），空间查询抽屉是第一个消费者 | 「两个工程对象之间可重算的最近关系」；塞进 Measurement 会重踏「净距伪装成测量」 |
| Q3 | 在哪算 | **gen-model v1 后端新端点**；前端不算；legacy `nearest-points` 不动 | 网格、`model_sesno`、parry 都在 gen-model；legacy 后端不在跑 |
| Q4 | 弧墙保真 | **(c) 一期统一三角网格**，`error_bound_mm = 0.5`；解析圆柱面二期 | 一条路径覆盖直 / 弧 / 带洞 / 斜切；0.5 mm 已是已知量 |
| Q5 | 粒度 | **(a) 选中节点下全部叶子并集取最小**，结果标命中的叶子 refno（两侧） | `anc CONTAINS` 走索引；选什么算什么 |
| Q6 | 结果内容 | 距离 + 两最近点 + E/N/U 分量 + 命中墙面分类 + `intersects`（+ Q1 垂距）；不做穿透深度、「轴线 − 半径」 | 穿透深度要最小平移量，贵；「轴线 − 半径」与主口径冲突 |
| Q7 | 一对 / 一对多 | **一期只一对** | 「找最近的墙」二期用 `nearest-clearance` 粗筛喂精算 |
| Q8 | 入口 | **(c) 拾取流主入口 + 抽屉「净距标注」改接同一 service**；不做右键 | 抽屉那条现在打的是死路；仓里没有通用右键菜单（只有 `MeasurementContextMenu`） |
| Q9 | 性能 | 网格现成 → **同步、不降级**，预计毫秒到百毫秒级；网格按 `(refno, model_sesno)` LRU 缓存 | 用户 2026-09-17 拍板「mesh 都是提前生成的」；重新三角化的成本不存在。PR-A 落地后必须用真数据量一次 |
| — | 接口 / 画法 / 版本 | 新端点 `POST /api/v1/spatial/surface-clearance`（§5）；画法走外部尺寸源 `clearance`；「创建尺寸」显式命令（D1）；`sourceModelVersion = model_sesno`，换版标 stale（D4） | 按 09-11 计划直接定，未再问 |

## 4. 算法

### 4.1 输入解析：refno → 叶子网格集合

1. `refno` → `pe:<a>_<b>`；查 `inst_relate` 自身行 ∪ `WHERE anc CONTAINS pe:<refno>` 的行（`idx_ir_anc`），只取有 `model_sesno` 的模型面行。
2. 每行 → 世界 mm `TriMesh`：有 `booled_id` 读 `{booled_id}.mesh` × `world_trans`；否则对 `insts_flat` 每项读 `{geo_hash}.mesh` × `world_trans × inst.transform`（同 `gen_world_mesh` 330–407 的磁盘支路；**不再** `tessellate_libgm_param`；缺文件 → 该叶子记 warning 并跳过，一个都没有 → 404 `no_model_mesh`）。
3. 叶子级缓存：`LruCache<(pe_key, model_sesno), Arc<TriMesh>>`（含已建 BVH）；容量按三角数上限（如 2e6 三角）。
4. 墙侧目标必须是墙族（CWALL / WALL / STWALL / GWALL / PANE），否则 422 `target_not_wall`——**仅当请求 `target_kind = wall`**；`target_kind = any` 时任何有网格的构件都收（抽屉复用）。

### 4.2 最近距离：叶子对 + AABB 剪枝

1. 源叶子 S = {s_i}，目标叶子 W = {w_j}，各带世界 AABB（行上 `aabb.d` 或从 TriMesh 取）。
2. 枚举 (i, j)，按 `aabb_distance(s_i, w_j)` 升序；维护 `best`；`aabb_distance ≥ best` 即停（AABB 距离是下界）。
3. 每对调 `parry3d::query::closest_points(&Isometry::identity(), &s_i, &Isometry::identity(), &w_j, best)`（`max_dist = best` 让内层 BVH 也剪）：`WithinMargin(p, q)` → 更新 best、记 (i, j, p, q)；`Intersecting` → `distance = 0`、`intersects = true`，立即返回（parry 不给相交点，一期 p / q 取两 AABB 交集中心并标 `witness = 'aabb-overlap-center'`）；`Disjoint` → 略。
4. 顶点全 f32（parry 默认 `Real = f32`）：世界 mm 量级 1e5，单精度绝对误差 ~1e-2 mm，低于 0.5 mm 弦高误差，可接受；结果里 `error_bound_mm = 0.5`（直墙也如此报——一期不判目标是否含曲面）。

### 4.3 命中墙面分类

命中三角法向 n（世界）；取墙叶子的 `world_trans` 旋转 R，`n_local = Rᵀ n`：

- |n_local.y| 最大 → `top`（+）/ `bottom`（−）；
- |n_local.z| 最大 → `end`；
- 否则 n_local.x > 0 → `inner`（IBOW 侧，+X），< 0 → `outer`（OBOW 侧，−X）。

弧墙的扫掠帧沿弧旋转，`world_trans` 只是起点帧——一期对弧墙的内 / 外用**几何兜底**：以该叶子 AABB 中心为近似圆心，`n · (hit − center) < 0` 判 `inner`；结果里 `target_face.confidence = 'frame' | 'geometric'`。精确解等二期读 `Spline` 参数。

### 4.4 垂距（raycast）

仅当 `target_face.kind ∈ {inner, outer}`：射线起点 = 源侧最近点 p，方向 = −n（指向墙面），`w_j.cast_local_ray_and_get_normal(&ray, max_toi = distance × 4, solid = false)`；命中 → `perpendicular = {distance_mm: toi, from: p, to: hit}`；未命中或 toi 与 distance 差 > 1% → `perpendicular = null` 并 warning `perpendicular_ray_missed`。相交时不算垂距。

### 4.5 输出组装

- `vector = q − p`（E3D 世界 mm，dx / dy / dz 即 E / N / U）；`unit = 'mm'`；`method = 'surface_to_surface'`；`accuracy_class = 'exact-surface'`（09-11 D2 命名）；`model = {source_sesno, target_sesno}`（各取参与叶子的 `model_sesno` 最大值；两侧不一致记 warning）。
- 单位 / 坐标：API 一律 E3D 世界 mm；前端 adapter 边界转 design-world m（09-11 D3），scene-world 只在 viewer adapter（`getGlobalModelMatrix`）。

## 5. 接口契约：`POST /api/v1/spatial/surface-clearance`

请求（JSON；身份三格沿用 `ProjectReq`）：

```json
{
  "project": "…", "mdb": "…", "namespace": "…",
  "source_refno": "24381/145018",
  "target_refno": "17496/105812",
  "target_kind": "wall",
  "perpendicular": true,
  "max_distance_mm": 50000
}
```

响应（200）：

```json
{
  "success": true,
  "unit": "mm",
  "method": "surface_to_surface",
  "accuracy_class": "exact-surface",
  "error_bound_mm": 0.5,
  "source": { "refno": "24381/145018", "noun": "EQUI", "leaf_count": 12, "triangle_count": 48210 },
  "target": { "refno": "17496/105812", "noun": "STWALL", "leaf_count": 1, "triangle_count": 12 },
  "result": {
    "distance_mm": 312.4,
    "intersects": false,
    "source_point": { "x": 0, "y": 0, "z": 0 },
    "target_point": { "x": 0, "y": 0, "z": 0 },
    "vector": { "dx": 0, "dy": 0, "dz": 0 },
    "source_leaf_refno": "24381/145130",
    "target_leaf_refno": "17496/105812",
    "target_face": { "kind": "outer", "normal": { "x": 0, "y": 0, "z": 0 }, "confidence": "frame" },
    "perpendicular": { "distance_mm": 312.4, "from": { "x": 0, "y": 0, "z": 0 }, "to": { "x": 0, "y": 0, "z": 0 } }
  },
  "model": { "source_sesno": 17, "target_sesno": 17 },
  "timing_ms": { "load": 4, "query": 11 },
  "warnings": []
}
```

错误：400 参数（refno 格式 / 两个 refno 相同）；404 `no_model_mesh`（任一侧没有模型面行或网格文件）；422 `target_not_wall`（`target_kind = wall` 且目标不在墙族）；`max_distance_mm` 内无结果 → 200 + `result: null` + warning `beyond_max_distance`。失败一律走 HTTP 状态码 + `ApiError`，200 里不报错（与 v1 其它端点同）。

前端类型：`genModelV1Api.ts` 新增 `GenModelV1SurfaceClearanceRequest` / `SurfaceClearanceResponse` + `genModelV1SurfaceClearance(req, options)`。

## 6. 前端落地

### 6.1 领域（09-11 D1 / D2 / D4）

`src/clearance/domain/clearanceRecord.ts`：

```ts
type ClearanceRecord = {
  id: string;
  kind: 'component-to-wall' | 'component-to-component';
  inputs: { sourceRefno: string; targetRefno: string };
  method: 'surface-to-surface' | 'aabb-to-aabb';        // 09-11 ComputationMethod 子集
  accuracyClass: 'exact-surface' | 'approximate-bounds';  // 09-11 AccuracyClass 子集
  snapshot: {
    distanceM: number; intersects: boolean;
    sourcePoint: Vec3; targetPoint: Vec3; vector: Vec3;   // design-world m
    sourceLeafRefno: string; targetLeafRefno: string;
    targetFace?: { kind: 'inner' | 'outer' | 'top' | 'bottom' | 'end' | 'unknown'; confidence: 'frame' | 'geometric' };
    perpendicular?: { distanceM: number; from: Vec3; to: Vec3 };
    errorBoundM: number;
  } | null;
  sourceModelVersion: { sourceSesno: number; targetSesno: number };
  status: 'current' | 'stale' | 'failed';
  warnings: string[];
  createdAt: string;
};
```

reducer 拒收缺 `method` / `accuracyClass` 的记录（09-11 M0 验收）。

### 6.2 service / store / adapter

- `src/clearance/services/clearanceService.ts`：`computeComponentToWall({ sourceRefno, targetRefno })` → 调 v1 → mm → m 转换（一次，D3）→ `ClearanceRecord`。
- `src/clearance/stores/useClearanceStore.ts`：records、active、hidden、`recompute(id)`、`markStaleIfModelChanged(sesnoByDbnum)`。
- `src/clearance/adapters/clearanceExternalDimensions.ts`：`ClearanceRecord[] → ExternalDimensionRecord[]`（源 id `clearance`）：主线 `part: 'dimension'` 连两最近点，标签 `312.4 mm · 外表面净距`；垂距存在时第二条 `style: 'dashed'`，标签 `⊥ 312.4 mm`；相交时标签 `相交`；`stale` 时标签前缀 `（过期）`。

### 6.3 入口（Q8 c）

- 工具「构件 → 墙净距」（工具栏 / 命令 `clearance.componentToWall.start`）：源 = `selectionStore.selectedRefno`（为空 → 提示先选构件）；`toolStore.startPickRefno(['CWALL', 'WALL', 'STWALL', 'GWALL', 'PANE'], ([target]) => service.computeComponentToWall(...))`；算完加入 store、画出、飞到两点 AABB（同 `PipeDistanceDrawer.onResultClick` 212–216）。
- `SpatialQueryDrawer.annotatePipeDistance` → 改调 `clearanceService.compute({ source: draft.refno, target: item.refno, targetKind: 'any' })`；不再进 `pipeDistanceStore`。`PipeDistanceDrawer`（BRAN 批量）本期不动。

### 6.4 版本与失效（D4）

`inst_relate.model_sesno` 随模型回执可得；store 监听模型刷新 / 重新生成通告，任一侧 sesno 变化 → `stale`；用户点「重算」→ 同 inputs 重调。

## 7. 金样与验证

| # | 场景 | 期望 |
| --- | --- | --- |
| G1 | 直墙、构件正对墙面 | `distance == perpendicular.distance`（±0.01 mm），`target_face.kind = outer / inner` |
| G2 | 直墙、构件在墙端外斜靠 | 最近点落墙端面 / 竖棱，`target_face.kind = end`，`perpendicular = null` |
| G3 | 弧墙内侧 / 外侧各一构件 | `target_face.kind` 分别 inner / outer，`error_bound_mm = 0.5`，与解析圆柱面手算差 ≤ 0.5 mm |
| G4 | 构件穿墙 | `distance = 0`、`intersects = true`、无垂距 |
| G5 | 选 CWALL owner vs 选单块 STWALL | owner 结果 ≤ 单块结果，`target_leaf_refno` 指出命中哪块 |
| G6 | 带洞墙（`booled_id`）、构件在洞里 | 距洞壁的距离，不是未开洞墙的 0 |
| G7 | 源为 BRAN owner | 多叶子并集；`source_leaf_refno` 是某个 TUBI / ELBO |

验证命令（照本仓惯例记录命令 / 输入 / 输出）：

- gen-model：`cargo test -p aios-database surface_clearance`（合成 TriMesh 单测：两平行板、板 × 板端外、环形扇区 × 球、相交）；live：`curl -X POST http://127.0.0.1:8023/api/v1/spatial/surface-clearance -H 'content-type: application/json' -d '{...}'`，用 ams1112 `CWALL /1RS-WF03-W-C-RR001` 的 `STWALL 1 = 17496/105812`（`mesh_compare.rs` 880）当墙。
- plant3d-web：`npx vitest run src/clearance src/api src/components/spatial-query`；`npm run type-check` 不新增基线外错误；`npm run lint`。
- e2e：`?model_source=gen-model-v1&gm_backend_port=8023&show_refno=…` 下 Playwright 真点击：选构件 → 工具 → 点墙 → 断言外部尺寸源 `clearance` 出现一条、标签含 `外表面净距`；截图入 `docs/verification/`。

## 8. PR 拆分与顺序

1. **PR-A（gen-model，`gen-model-model-cache` 分支）**：`fast_model/surface_clearance.rs`（叶子加载 + LRU + `closest_points` + 分类 + raycast）+ `web_service` 路由 + 单测；把 `gen_world_mesh` 的磁盘支路抽成公共 `load_world_mesh_from_disk`（`rvm_baseline` 继续用）。
2. **PR-B（plant3d-web）**：`genModelV1Api` 类型与客户端；`src/clearance/domain | services | stores | adapters`；单测。
3. **PR-C（plant3d-web）**：拾取流入口 + 抽屉改接 + 外部尺寸源渲染 + Playwright + 截图。
4. **PR-D（docs）**：09-11 计划 PR1.2 / PR1.3 / M1 金样状态同步；本计划回填决策号、`timing_ms` 实测与验证结果。

## 9. 风险与开放问题

- **PANE 算不算墙**：沿用 `wall` 预置组（含 PANE）。若现场 PANE 多为楼板，改 §4.1 白名单一处即可。
- **f32 精度**：parry `Real = f32`；坐标 1e5 mm 量级下 ~0.01 mm 误差，低于弦高 0.5 mm。若将来要 sub-0.1 mm，需 parry `f64` feature（fork 是否开着待查）。
- **相交时的 witness**：parry `Intersecting` 不给点，一期用 AABB 交集中心；真穿透深度是二期。
- **弧墙内 / 外分类**：一期 `geometric` 兜底是近似（AABB 中心 ≠ 圆心，大跨弧墙可能判反）；二期读 `Spline` 圆心。
- **性能未实测**：Q9 按「毫秒到百毫秒」预估，PR-A 落地后必须用真数据量一次并回填 `timing_ms`。
- **legacy 抽屉路径**：改接后 `usePipeDistanceStore` 仍被 `PipeDistanceDrawer` 用；09-11 M1 再统一。
- **多 MDB / 身份**：沿 `ProjectReq`，两 refno 需在同一服务实例可见；跨库不在本期。

## 10. 完成定义

- G1–G7 金样全过并留 curl 输入 / 输出与截图；
- 前端 `clearance` 外部尺寸源在真 UI 出现，标签带精度字样，stale 可见；
- `npm run type-check` / `lint` / 相关 vitest 全绿，`cargo test` 新增单测全过；
- 决策 `d-428` 已登记（本轮已完成），09-11 计划状态已同步（PR-D）。
