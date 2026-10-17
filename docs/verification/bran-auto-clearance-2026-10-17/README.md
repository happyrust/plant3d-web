# BRAN 自动净距 + 范围显示 验证（2026-10-17）

`docs/plans/2026-10-17-bran-auto-nearest-clearance-and-range-view-plan.md` T6 的真机对账。
源统一为 BRAN `24384/22726`（8000 库，source_sesno 650），与 #91 验证包同环境、同源。

## 环境

- 后端：`aios-database`（gen-model `refactor` 线，`AIOS_STORE_MODE=rocksdb`）`:8024`
- 数据：SurrealDB 副本 `:8011`，项目 `AvevaMarineSample`；`spatial_tree.state=ready`
- 前端提交：`6d41269f`（T1+T2）、`bfb1fad5`（T3）、`ac9e4568`（T4）、`d64da99f`（T5）
- 单测：39/39（useSpatialCompute 33 + SpatialComputePanel 6）；type-check 0 新增；ESLint 干净

## 一、`surface=1` 口径（T4 拍板项）

`GET /api/v1/spatial/nearest-clearance?source_refno=24384/22726&source_mode=bran_centerline&group_by=noun&exclude_nouns=WELD,ATTA&radius=5000&scope=all_loaded&max_per_group=3[&surface=true]`

| 项 | `surface=true` | 默认（不发） |
|---|---|---|
| `distance_method` | `centerline_surface_aabb_clearance_mm` | `centerline_aabb_clearance_mm` |
| `resolved_filters.surface` | `true` | `false` |
| `source.outside_diameter_mm` | 25（OD 25 → 半径 12.5） | 同左 |
| `source.segment_count` | 9（含隐式管身） | 同左 |
| warnings | `1 个成员没有长度（穿过件），不参与走廊` | 同左 |

每类最近 1 条的差值**恒 = 12.5 mm = OD/2**（PANE / WALL 两桶两条都 0——中心线已进盒，扣半径后仍钳 0）：

| noun | `surface=1` | 默认 | 差 |
|---|---|---|---|
| FTUB `24384_22737` | 46.5 | 59.0 | 12.5 |
| STWALL `24381_1774` | 387.5 | 400.0 | 12.5 |
| ELBO `24383_75299` | 411.1 | 423.6 | 12.5 |
| FLOOR `17496_72729` | **587.5** | 600.0 | 12.5 |
| SCTN `24381_2306` | 661.1 | 673.6 | 12.5 |
| REDU `24383_75317` | 4399.5 | 4412.0 | 12.5 |

半径 5000 内 noun_counts 共 **16 类**（BEND 61 / BOX 5 / COUP 1 / ELBO 21 / FITT 15 / FLOOR 9 / FTUB 188 / GWALL 4 / PANE 177 / REDU 1 / SBFI 2 / SCTN 28 / STRT 14 / STWALL 4 / TAPE 2 / WALL 11）——facet 驱动的「半径内全类型」口径成立。

证据：`api-nearest-clearance-surface1.json` / `api-nearest-clearance-default.json`。

## 二、估算 vs 精算（「全部精算」的对账基准）

同一源 `24384/22726` 对三类最近候选跑 `surface-clearance target_kind=any`：

| 目标 | noun | 估算（管表面→盒） | 精算（网格→网格） | 差 | 说明 |
|---|---|---|---|---|---|
| `17496/72729` | FLOOR | **587.5** | **587.500** | 0.000 | 平板盒≈实体，估算即精算值 |
| `24381/1774` | STWALL | 387.5 | **392.085** | −4.585 | 盒略大于实体，估算略保守 |
| `17496/105912` | WALL | **0（相交）** | **232.964** | −232.964 | 墙盒沿墙长方向拉大，中心线穿盒但管表面离墙网格还有 233mm——估算报相交、精算纠正 |

结论：**估算方向性正确但有盒误差**——盒≈实体时（板）即精算值；异形/长条盒时低估，极端时把不相交报成「相交」。
这正面回答了「为什么需要精算档」：自动模式先出估算，「全部精算」一键纠正。三例 `error_bound ≤ 0.5mm`、`accuracy_class=exact-surface`，sesno 正确分离（源 650 / 目标 357·738）。

证据：`api-exact-floor-17496_72729.json` / `api-exact-stwall-24381_1774.json` / `api-exact-wall-17496_105912.json`。

## 三、范围显示（T2）

`GET /api/v1/spatial/nearby/refnos?refno=24384/22726&source_mode=bran_centerline&radius=3000&scope=all_loaded`
→ `total_count=265`、`truncated=false`、`by_dbnum`：1112 / 7997 / 7999 / 8000 四库；
`radius=5000` → `total_count=558`。

面板「显示范围内模型」走同一参数口径 → `loadResults` 按 `by_dbnum` 只加载未加载的 → `isolateResults([bran])` 隔离并把源 BRAN 留实体。
单测已覆盖：draft 过滤清零、空结果报错、恢复路径（`SpatialComputePanel.test.ts` 3 例）。

证据：`api-nearby-refnos-r3000.json`。

## 四、UI 侧交互（harness/真机手测清单）

以下两条需要三维界面里人工点选确认，留待下一次带界面的验证：

- [ ] 开「选中 BRAN / 管件自动计算」→ 点 `24384/22726` 下任一管件 → 面板自动出 16 类 facet、三维每类 1 条尺寸（文字「≈…mm（管表面到包围盒估算）」）；再点同根另一管件 → 无新请求；点非 BRAN → 结果不变
- [ ] facet 头「全部精算 (N)」→ 逐条变「精算中 k/N」→ 全部标「实体外表面净距」，数值与 §二对账一致；「停止」中断队列
