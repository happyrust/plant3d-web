# SPINE（spline）测量能力分析 · 2026-08-04

> 状态：分析稿（待 Oracle 复核）
> 范围：`plant3d-web`、`plant-model-gen`、`rs-core`
> 前置：`2026-08-03-measurement-semantic-snap-tubi-pline-plan.md`（TUBI/PLIN 语义捕捉，SPINE 显式列为 P2 暂缓项）；本文是该暂缓项的补充分析。

## 1. 问题定义

「spline 的测量功能」指对**带脊线（SPINE）路径的扫掠类构件**（GENSEC / SCTN / STWALL / WALL 等 Profile 类，含直线段与圆弧段的组合路径）的测量支持。当前 Web 测量对这类构件只能捕捉模型表面点：

- hover 弯曲构件没有任何语义捕捉点（无端点/顶点/圆心候选）；
- 无法对弧段做半径/直径标注（没有 arc 负载来源）；
- 无法得到「沿构件路径的长度」（弧长）；
- 08-03 计划的 TUBI/PLIN 语义点覆盖管道直段，不含结构脊线。

## 2. 现状事实（代码核实）

### 2.1 rs-core 几何层：路径数据完整存在（生成期）

- `rs-core/src/prim_geo/spine.rs`：
  - `Spine3D`：单段脊线，`curve_type ∈ {LINE, THRU(过点圆弧), CENT(圆心圆弧)}`，含 `pt0/pt1/thru_pt/center_pt/radius`，可求两端切向（`get_dir`）。
  - `SegmentPath = Line(Line3D) | Arc(Arc3D)`；`SweepPath3D { segments }`，每段可求 `length()`、`start_point()`、`end_point()`——弧长=|angle|·radius，**路径总长可直接累加**。
- `rs-core/src/prim_geo/sweep_solid.rs`：`SweepSolid { path: SweepPath3D, spine_segments: Vec<Spine3D>, … }`——扫掠体在生成期携带完整路径。
- `rs-core/src/transform/strategies/spine_strategy.rs`：spine 相关变换策略已存在。

### 2.2 数据源层：SPINE 结构在 PE/ATT 中可查

- `rs-core/src/rs_surreal/spatial.rs::get_spline_pts(refno)`：按 `owner→SPINE→子(POINSP)` 的 `POS` 取采样点（**PDMS 本地坐标**，按 order 排序）；`get_spline_line_dir` 仅两点直线。
- 弧段语义（THRU/CENT/radius）在 SPINE/POINSP 属性上，`plant-model-gen/src/data_interface/tidb_manager.rs::get_spline_path` 的完整实现处于注释状态（legacy TiDB 时代）。

### 2.3 落盘/Web 通道：路径不出生成管线

- `primitive_keypoints.parquet` 只覆盖基础体（cylinder/ctorus/dish/extrusion/box/pyramid…的 `key_points()`）；**`SweepSolid` 没有 `key_points()` 实现**，GENSEC 类构件零关键点。
- 该表 schema（`PrimitiveKeyPointRow`）为 geo_hash 级局部点 + 可选方向；Web loader 兼容可选 `circle_*/arc_*` 列并组装 `candidate.circle/arc {center,rim,normal}` 负载（径向尺寸捕捉用）。
- `semantic_snap_points.parquet`（08-03 计划）v1 仅 `tubi_leave/tubi_arrive/pline_pkey` 三种 kind，schema 预留了新 kind 的扩展空间。

### 2.4 Web 测量层：能吃 arc 负载，但没有"沿线长度"概念

- `MeasurementPickCandidate.circle/arc` 已进捕捉与 dimension snap（`dtxDimensionSnapPort` → 径向尺寸）。
- 测量类型只有 distance/angle/elevation_point/elevation_delta + 距离结果模型（r6 §7）；无 path-length 类型。
- 本日新增的 hover 线框描边/关键点显示（r6 §8.1）对 GENSEC 构件同样生效（描边有、关键点无——数据缺）。

## 3. 用户场景拆解（E3D 口径）

| # | 场景 | E3D 对应 | 数据需求 |
| - | --- | --- | --- |
| S1 | 捕捉脊线顶点/端点测距 | Snap 到构件端点/Pline 端点 | spine 顶点 design-world 坐标 |
| S2 | 弧段半径/直径标注 | 径向尺寸（Radial Dim） | 弧段 center/rim/normal |
| S3 | 构件长度（沿路径弧长） | E3D 一般读属性（SCTN/GENSEC 的 `CUTLEN` 切割长度）而非两点测量 | 路径每段长度合计（生成期已有）或属性直读 |
| S4 | hover 显示脊线中心线辅助 | 元素高亮 + Pline 显示 | 路径折线/弧折线化采样点 |

关键判断：**S3 不应做成新的"测量类型"**。两点直线距离对弯曲构件本来就不是弧长，E3D 用户预期从属性（CUTLEN）读构件长度；Web 端 Result Inspector / 属性面板显示即可，避免为单一场景发明「路径测量」交互。

## 4. 方案建议

### 4.1 数据契约：复用 `semantic_snap_points`，新增 spine kinds（推荐）

沿用 08-03 的表与 manifest，不新建 UI 点源：

| kind | name | 载荷 | 说明 |
| --- | --- | --- | --- |
| `spine_vertex` | `SPINE #<order>` | xyz | 顶点/段端点（含起终点），design-world |
| `spine_arc` | `ARC #<order>` | xyz=弧中点 + `arc_center/arc_rim/arc_normal` 列 | THRU/CENT 弧段，径向标注负载 |

- 稳定 ID：`semantic:spine:<owner_refno>:<order>:vertex|arc`；owner 为 GENSEC/SCTN 等构件 refno。
- schema 演进：v2 增加可空 `arc_center_x/y/z`、`arc_rim_x/y/z`、`arc_normal_x/y/z`（与 primitive_keypoints 的可选列口径一致，旧表缺列则前端视为无弧负载）。
- 生成点：在 `SweepSolid` 几何生成处（`cate_single.rs` Profile 分支 / `pdms_inst.rs` 持久化）拿 `spine_segments`+实例 world transform，一次算好 design-world；**不要**在导出层重查 SurrealDB（`get_spline_pts` 只有本地坐标且缺弧语义）。

### 4.2 S3 构件长度：属性直读优先

- P0：Result Inspector / 属性面板显示 `CUTLEN`（已有 ui-attr 通道）；测量落在弯构件上时 Inspector 附注「构件切割长度 CUTLEN=…」。
- 备选（若 CUTLEN 缺失或不可信）：semantic 表补 `path_length` 列（生成期 `SweepPath3D::length()` 合计），Inspector 读该值。二选一，不做双源。

### 4.3 S4 hover 脊线显示：暂缓

hover 描边（r6 §8.1）已给出构件级视觉反馈；脊线中心线需要新的折线化通道（parquet 或 API），收益/成本比低于 S1/S2，列 P2。

### 4.4 Web 端改动面（S1+S2 落地时）

1. loader：`querySemanticSnapPointsByRefnoFromParquet` 解析新 kinds + 可选 arc 列（复用 `primitiveCircularGeometryFromRow` 的口径）。
2. 捕捉编排：spine 点映射 `source: 'primitive_key_point'`（同 08-03 的决策，不新增 UI 源）；label `SPINE 顶点 #n` / `SPINE 弧 #n`。
3. 排序/重合：沿用 08-03 §5.3 规则；spine 点与 PLIN/TUBI 点同位时按稳定 ID 决定默认项。
4. 径向尺寸：`dtxDimensionSnapPort` 已支持 arc 候选 → 免改。

## 5. 分期建议

| 期 | 内容 | 依赖 |
| --- | --- | --- |
| P0 | 08-03 计划的 TUBI/PLIN 先落地（尚未实施）；本分析随行文档化 | — |
| P1 | `spine_vertex`（S1）：导出 + Web 捕捉 | semantic 表 v1 管线就绪 |
| P1.5 | `spine_arc`（S2）：schema v2 弧负载 + 径向标注验收 | P1 |
| P1.5 | S3：Inspector 显示 CUTLEN（属性直读，无导出依赖，可与 P1 并行） | r6 Inspector |
| P2 | S4 hover 脊线中心线；SPINE 方向约束、POINSP 逐点标签 | 真实需求出现 |

## 6. 风险与开问题

1. **弧段语义可得性**：`spine_segments` 在部分生成路径（如 catalog GENSEC 展开）是否总是可得？`sweep_solid.rs` 存在 `spine_segments.clear()` 的路径（转换为纯 path 后清空原始段），需在生成点尽早取值。
2. **坐标一次变换**（08-03 风险 #1 同款）：spine 点必须在生成期完成 local→design-world，Web 只加 viewer global matrix。
3. **顶点 vs POINSP 序号稳定性**：`order` 取 SPINE 子序（POINSP order_num），跨版本重绑依赖它稳定。
4. **CUTLEN 属性口径**：不同 noun（SCTN/GENSEC/STWALL）长度属性名可能不同（CUTLEN/LENGTH…），需要按 noun 的属性映射表确认。
5. **E3D 实机对照**：E3D 对 GENSEC 的默认捕捉行为（是否提供 spine 顶点 snap、径向尺寸入口）未实机验证，S1/S2 交互细节留待验证后微调。

## 7. 结论

spline 测量不需要新测量类型或新点源体系：**数据侧把脊线顶点/弧段接入 semantic_snap_points（生成期 design-world 一次成型），Web 侧全部复用既有捕捉/径向尺寸/Inspector 通道；构件长度走 CUTLEN 属性直读**。优先级排在 08-03 的 TUBI/PLIN 之后（同一条数据管线，顺次扩 kind 成本最低）。
