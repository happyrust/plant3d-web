# 管道 → 墙 / 柱 / 楼板 净距测量验证（2026-10-17）

在 RocksDB 副本库上对「构件 → 结构构件表面净距」链路做的真实后端验证。
源构件统一为 BRAN `24384/22726`（8000 库，模型 sesno 650），目标覆盖墙族、楼板与柱。

## 环境

- 后端：`aios-database`（gen-model `refactor` 线，`AIOS_STORE_MODE=rocksdb`）`:8024`
- 数据：SurrealDB 副本 `:8011`，项目 `AvevaMarineSample`
- 模型：8000 库 953 roots 实机重建（source_sesno 650），目标库为既有模型（sesno 357/738）

## 实测矩阵

| 目标 | noun | `target_kind` | 表面净距 | 面 / 垂距 | 证据 |
|---|---|---|---|---|---|
| `24381/1776` | WALL | `wall` | **607.0304 mm** | `outer` + `ray`（法向 (-0.93, 0.37, 0)） | `api-wall-24381_1776.json` |
| `24381/1774` | STWALL | `wall` | **392.085 mm** | `bottom` | `api-stwall-24381_1774.json` |
| `24381/3014` | PANE | `wall` | **169.661 mm** | `end` | `api-pane-24381_3014.json` |
| `17496/72729` | FLOOR | `any` | **587.5 mm** | `bottom` | `api-floor-17496_72729.json` |
| `24381/2306` | SCTN（柱） | `any` | **5935.297 mm** | `outer` + `edge`（最近点在柱棱上） | `api-sctn-24381_2306.json` |

### 复现命令

```powershell
curl "http://localhost:8024/api/v1/spatial/surface-clearance?source_refno=24384_22726&target_refno=24381_1776&target_kind=wall"
curl "http://localhost:8024/api/v1/spatial/surface-clearance?source_refno=24384_22726&target_refno=24381_2306&target_kind=any"
```

### 负例（如实报错）

- `target_kind=wall` + FLOOR/SCTN 目标 → **HTTP 422**，错误点名 noun 不在墙族（`CWALL/WALL/PANE/GWALL/STWALL`）
- source = target → **HTTP 400**
- 无网格 refno → **HTTP 404 `no_model_mesh`**

## 结论

- `target_kind=wall` 精确墙族：WALL / STWALL / PANE 全部返回 `surface_to_surface + exact-surface + error_bound ≤ 0.5mm`。
- `target_kind=any` 覆盖任意已建模构件：FLOOR 楼板、SCTN 柱如实返回距离与面信息；垂距 `method=edge` 表示最近点落在构件棱上，连线作近似垂线。
- 跨库模型版本正确分离：`model.source_sesno=650`（8000 库当次重建）/`target_sesno=357|738`（目标所在库既有模型）。
- `/nearby` 的 AABB 距离与 `surface-clearance` 的网格距离差异属正常语义（AABB 重叠 ≠ 网格相交）。

## 截图

`shots/05-saved-clearance-records.png` — `harness/spatial-query.html` 注入上述 5 条真实响应复刻的记录后，
空间查询抽屉「已保存的构件净距」区的真实组件渲染（距离、当前计算状态、定位/重算/隐藏/移除操作）。
其余 `01–04` 为抽屉与计算面板全景。
