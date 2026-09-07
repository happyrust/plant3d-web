# 测量语义点捕捉完善方案：TUBI LEAVE/ARRIVE 与 E3D PLIN

> 日期：2026-08-03  
> 状态：待实施  
> 范围：`plant3d-web`、`plant-model-gen`、`rs-core`  
> Oracle MCP：`measuremen-semantic-snap-review`（GPT-5.5 Pro，133k 上下文）

## 1. 结论

新增版本化的 `semantic_snap_points.parquet`，存放**实例级工程语义点**；Web 端继续复用现有 `primitive_key_point` 捕捉源、距离优先排序、异步 pending 保护和 `MeasurementPoint.sourceInfo`，不新增 UI 点源体系。

首期只覆盖：

1. TUBI 直段的 `tubi_leave`、`tubi_arrive`；
2. E3D catalog PLIN 的实例化 `pline_pkey`；
3. 不把 SPINE、PLOOP 或通用 CAD polyline 顶点混入本需求。

权威坐标选择：

- TUBI LEAVE = `TubiData.start_pt`；
- TUBI ARRIVE = `TubiData.end_pt`；
- `leave_axis_pt` / `arrive_axis_pt` 是相邻元件轴线参考，不作为该直段端点；
- PLIN 点必须用当前 design instance 参数上下文求值，禁止由网格、AABB 或圆柱轴反推。

## 2. 已确认的现状

### 2.1 Web 捕捉链

`useXeokitMeasurementTools.ts` 当前流程为：

```text
surface pick -> refno
  -> async load PTSET / primitive keypoints
  -> merge position / mesh surface
  -> project to canvas
  -> distance-first rank（4 px 内按源优先级）
  -> persist sourceInfo
```

现有点源为 `mesh_pick_point | ptset | position | primitive_key_point`。`primitive_keypoints.parquet` 是 `geo_hash` 级、可复用、局部坐标的几何点，不适合混入实例级 TUBI/PLIN 语义事实。

### 2.2 TUBI 数据缺口只在导出层

`rs-core::geometry::TubiData` 已定义并由 `plant-model-gen` 写入 `tubi_relate`：

- `start_pt`：直段 world-space leave endpoint；
- `end_pt`：直段 world-space arrive endpoint；
- `leave_axis_pt` / `arrive_axis_pt`：元件轴线参考点。

当前 `export_dbnum_instances_parquet.rs` 的 `TubiQueryResult` 与 `tubings.parquet` schema 没有读取这些 `vec3`，所以 Web 只能捕捉圆柱表面或通用几何点。

### 2.3 PLIN 不是通用 polyline

本代码中的 PLIN 是 E3D catalog P-line：

- `ScomInfo.plin_map` 以 `PKEY` 保存 `PX/PY`、`DX/DY`、`PLAX` 表达式；
- `resolve_cata_comp` 目前只为几何定位使用选中的 `JUSL` 与 `NA`；
- PLIN 捕捉需要在同一实例参数上下文中求值得到参考点，再变换到 design world。

## 3. 数据契约

新增可选表：

```text
semantic_snap_points.parquet
```

最小 v1 schema：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `point_id` | UTF8 | 稳定候选 ID |
| `instance_refno_str` | UTF8 | 点所属实例；TUBI 为当前 tubi/leave refno |
| `owner_refno_str` | UTF8 nullable | TUBI 的 BRAN/HANG owner；普通元件可为空 |
| `point_index` | UInt32 | TUBI order 或 PLIN 稳定序号 |
| `kind` | UTF8 | `tubi_leave`、`tubi_arrive`、`pline_pkey` |
| `name` | UTF8 | `LEAVE`、`ARRIVE` 或原始 `PKEY` |
| `x`,`y`,`z` | Float64 | design-world 坐标，单位见 manifest |

不在每行重复写 `model_version`、`coordinate_space` 或 `transform_version`。它们属于不可变 manifest：

```json
{
  "tables": {
    "semantic_snap_points": {
      "file": "semantic_snap_points.parquet",
      "rows": 1234,
      "key": "point_id",
      "schema_version": 1
    }
  },
  "semantic_snap_point_unit": {
    "source_unit": "mm",
    "target_unit": "m",
    "conversion_factor": 0.001,
    "coordinate_space": "design_world"
  }
}
```

稳定 ID：

```text
semantic:tubi:<owner_refno>:<order>:leave
semantic:tubi:<owner_refno>:<order>:arrive
semantic:pline:<instance_refno>:<normalized_pkey>
```

不把模型版本写入 ID，保证同一工程实体跨版本仍可重绑；版本隔离由 manifest URL/cache token 保证。

示例：

```json
{"point_id":"semantic:tubi:24381_145018:7:leave","instance_refno_str":"24381_145041","owner_refno_str":"24381_145018","point_index":7,"kind":"tubi_leave","name":"LEAVE","x":12.3,"y":4.5,"z":6.7}
{"point_id":"semantic:tubi:24381_145018:7:arrive","instance_refno_str":"24381_145041","owner_refno_str":"24381_145018","point_index":7,"kind":"tubi_arrive","name":"ARRIVE","x":14.9,"y":4.5,"z":6.7}
{"point_id":"semantic:pline:24381_145041:PKEY1","instance_refno_str":"24381_145041","owner_refno_str":null,"point_index":1,"kind":"pline_pkey","name":"PKEY1","x":14.9,"y":4.7,"z":6.8}
```

## 4. 上游实施方案

### P0：TUBI LEAVE/ARRIVE

在 `plant-model-gen/src/fast_model/export_model/export_dbnum_instances_parquet.rs`：

1. 扩展 `TubiQueryResult` SQL，读取 `start_pt.d` 与 `end_pt.d`；
2. 为每条有效 `tubi_relate` 生成两条 `SemanticSnapPointRow`；
3. 复用现有 `UnitConverter`，统一转换为 manifest 声明的 design-world 单位；
4. 写 `semantic_snap_points.parquet`，并更新 root/bucket/unit manifests；
5. 任一点缺失或非有限值时跳过该点并计数告警，不能生成 `(0,0,0)` 假点。

P0 不需要修改 `TubiData`、TUBI 生成逻辑或已有 `tubings.parquet`。

### P1：E3D PLIN PKEY

在 `rs-core` 与 `plant-model-gen` 复用现有 PLIN 表达式求值，不另写一套公式：

1. 在 `rs-core/src/expression/query_cata.rs` 提取可复用的 PLIN point 求值函数，使用现有 `CataContext` 与 `ResolveEvalCache`；
2. 为当前实例解析 `plin_map` 中所有可成功求值的唯一 `PKEY`；单个 PKEY 失败只记录诊断，不阻断模型；
3. 在 `rs-core/src/geometry/mod.rs` 为实例产物增加最小的 PLIN 语义点 payload；
4. 在 `plant-model-gen/src/fast_model/gen_model/cata_model.rs` 将 PLIN 局部点应用实例 world transform，得到 design-world 坐标；
5. 在 `plant-model-gen/src/fast_model/gen_model/pdms_inst.rs` 持久化实例 PLIN 点，供版本化 Parquet 导出；
6. 在 `export_dbnum_instances_parquet.rs` 合并 TUBI 与 PLIN rows 写入同一语义点表。

PLIN `PLAX` 第一阶段只参与点位置求值，不导出/捕捉方向。需要方向箭头或方向约束时再以 schema v2 增加 `has_dir/dir_x/dir_y/dir_z`。

## 5. Web 实施方案

### 5.1 Loader

在 `src/composables/useDbnoInstancesParquetLoader.ts`：

1. manifest 增加可选 `semantic_snap_points`；旧模型没有该表时返回空数组；
2. 新增 `SemanticSnapPointCandidate` 与 `querySemanticSnapPointsByRefnoFromParquet`；
3. 查询同时匹配 `instance_refno_str` 与 `owner_refno_str`，覆盖 TUBI 子对象和 BRAN/HANG surface pick；
4. 表中坐标已经是 design world，只应用 `dtxLayer.getGlobalModelMatrix()` 一次，禁止再乘 instance/geo transform；
5. cache key 包含 manifest URL/cache token，模型版本切换时失效。

### 5.2 捕捉编排

在 `src/composables/useXeokitMeasurementTools.ts`：

1. 复用 primitive keypoint 的异步加载、错误缓存和 pending click 保护；
2. 将语义点映射为 `source: 'primitive_key_point'`；
3. 标签使用 `直段 LEAVE`、`直段 ARRIVE`、`PLIN <PKEY>`；
4. `candidateId` 直接使用 `point_id`；现有 `sourceInfo.candidateId/refno/label` 已足够持久化，P0 不扩展 archive schema；
5. 更新捕捉源显示名为“语义/基本体关键点”，并在发布样本确认表可用后启用其默认 snap。

### 5.3 排序与重合点

保留现有规则：

1. 先按各点源 threshold 过滤；
2. 像素距离差大于 4 px 时，距离优先；
3. 4 px tie band 内，语义点优先于通用 primitive/PTSET/position/mesh；
4. 不能让较远的语义点无条件覆盖更近点。

若同一连接位置存在 `A ARRIVE` 与 `B LEAVE`：

- 候选数据中保留两个 `point_id`，不得按 XYZ 合并语义；
- 渲染层可以共用一个 marker；
- 若交互暂不支持候选轮换，按稳定 ID 决定默认项，但 sourceInfo 必须保存实际选中 ID；
- 通用网格/primitive 点与某语义点同坐标时，可在显示层隐藏通用 marker，不能删除 PTSET 或另一语义候选。

`src/dimension/adapters/dtxDimensionSnapPort.ts` 继续映射为 `primitive-key-point/exact`；稳定 `candidateId` 支撑后续重绑，无需新增 dimension semantic source 枚举。

## 6. 分期与验收

### P0：直段端点（最高优先级）

- 导出 TUBI LEAVE/ARRIVE；
- Web 加载、显示、捕捉、sourceInfo 持久化；
- 截图场景中测量值落在直段中心线两端，而不是管壁表面；
- 旧 manifest 不报错，现有 PTSET/position/mesh 行为不回归。

### P1：PLIN PKEY

- 按实例参数求值所有有效 PKEY；
- 参数不同的同 catalog 实例得到不同坐标；
- PLIN 点使用名称标签且可被测量和 dimension 编辑共同捕捉；
- 明确排除 SPINE/PLOOP/general polyline。

### P2：只在有真实需求时增加

- PLIN direction 显示或方向约束；
- 重合语义候选轮换 UI；
- nozzle/support/instrument 等新 semantic kind；
- SPINE/PLOOP 控制点。

## 7. 最小验证集

### Rust

```powershell
cargo test semantic_snap_points
```

最少覆盖：

1. 一条 TUBI 产生两个点且 LEAVE/ARRIVE 分别等于 start/end；
2. 非有限/缺失端点不产生假行；
3. 同 catalog、不同参数的两个实例得到不同 PLIN PKEY；
4. world transform 与单位转换只执行一次；
5. point_id 在重复导出中稳定。

### Parquet 真实数据

```powershell
duckdb -c "DESCRIBE SELECT * FROM 'output/.../semantic_snap_points.parquet';"
duckdb -c "SELECT kind, count(*) FROM 'output/.../semantic_snap_points.parquet' GROUP BY kind ORDER BY kind;"
duckdb -c "SELECT * FROM 'output/.../semantic_snap_points.parquet' WHERE owner_refno_str='24381_145018' ORDER BY point_index, kind LIMIT 20;"
```

不新增一次性 `inspect-semantic-points` CLI；现有导出命令加 DuckDB 查询已能验证契约。

### Web

```powershell
npm run type-check
npx vitest run src/composables/useDbnoInstancesParquetLoader.test.ts src/composables/useMeasurementPickSources.test.ts src/composables/useXeokitMeasurementTools.test.ts src/dimension/adapters/dtxDimensionSnapPort.test.ts
```

真实场景验收：

1. 用 BRAN `24381_145018` 加载包含语义点表的模型版本；
2. 对同一直段分别 hover LEAVE、ARRIVE，lens 显示语义名称；
3. 完成距离测量，两个端点 `candidateId` 分别以 `semantic:tubi:` 开头；
4. 检查测量值与 Parquet 两点欧氏距离一致；
5. 重载/切换模型版本后无旧坐标缓存；
6. PLIN 样本验证 PKEY 坐标随实例参数变化。

## 8. 主要风险

1. **坐标重复变换**：TUBI/PLIN 表统一为 design world，Web 只能追加 viewer global matrix；这是 P0 必测项。
2. **TUBI 身份歧义**：`tubi_refno` 不足以唯一标识段，稳定 ID 必须包含 owner + order。
3. **PLIN 求值分叉**：必须复用现有表达式 evaluator/cache，不能在 exporter 或 Web 复制 PX/PY/DX/DY 公式。
4. **hover refno 不一致**：查询必须兼容实例 refno 与 owner refno；用真实 DTX objectId 验证。
5. **旧包兼容**：语义表缺失只代表该能力不可用，不得阻断模型加载或污染其它点源状态。

## 9. 不采用的方案

- 不给 `tubings.parquet` 不断追加各类工程语义列；它仍是几何实例表。
- 不向 `primitive_keypoints.parquet` 写 nullable instance rows；这会破坏 `geo_hash -> reusable local points` 的缓存假设。
- 不从 mesh/AABB 推导端点；上游已有权威事实。
- 不为本功能新增 UI source family、dimension source enum 或一次性验证 CLI。
