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

## 四、UI 侧真机实测（`:3101` dev server + Chrome DevTools，BRAN `24384/22726`）

注意：dev server 代理到 `:8022`（read-through，`sul_db mem`，与 :8024 rocksdb 非同一档）。
:8022 上该 BRAN 的 `nearest-clearance` 出 10 类 facet（PANE 77 / WALL 8 / STWALL 2 / STRT 14 / SCTN 17 / FLOOR 4 / FITT 15 / BEND 2 / TAPE 2 / BOX 2，26 条候选），`nearby/refnos` r3000 → `total_count=104`（单库；:8024 为 265/4 库）——数字不同是后端档差异，链路行为一致。

| 步骤 | 操作 | 实测结果 |
|---|---|---|
| 自动触发 | 勾选「选中 BRAN / 管件自动计算」 | 立即发出 1 次 `nearest-clearance`（URL 含 `surface=true`），10 类 facet + 26 行结果 + 10 条「已标注」（每类默认画最近 1 条）；warning「1 个成员没有长度（穿过件），不参与走廊」正确透出 |
| 持久化（T5） | 刷新页面 | 开关恢复为开、`rangeDistance=3000` 恢复；页面加载期间查询自动重放（探针注入前已发出），打开面板即见 facet——快照持久化 + 开关联动求值生效 |
| 管件选中 | `setGlobalSelectedRefno('24384_22730')`（同 BRAN BEND） | 0 次新请求；`findOwnerBranRefnoAcrossAllDbnos('24384_22730')` → `24384_22726`——管件解回所属 BRAN 后命中去重 |
| 非 BRAN 选中 | `setGlobalSelectedRefno('17496_105912')`（WALL） | 0 请求，结果保留不动 |
| 同 BRAN 重选 | `setGlobalSelectedRefno('24384_22726')` | 0 请求 |
| 「全部精算 (10)」 | 点击 | 10 次 `surface-clearance`，10/10 行标签翻成「实体外表面净距（网格精算）」：PANE `24381_1130` **0相交→2547mm**、WALL `24381_1776` **0相交→465mm**、STWALL `24381_1774` 388→350mm、STRT 660→877、SCTN 661→740、FLOOR 1188→1997、FITT 1378→1401、BEND 2685→2771、TAPE 2817→2870、BOX 4105→4107——两条 AABB 假相交被精算纠正（同 §二 WALL 例） |
| 范围显示 r3000 | 点击「显示范围内模型」 | `nearby` + `nearby/refnos`（`source_mode=bran_centerline&radius=3000&include_self=false`）→ 104 项进空间查询抽屉（「共 104 项，已加载 100 项，未加载 0 项」，`48 未知 · 36 暖通 · 20 土建`）→ 约 93 条模型/记录加载 → 隔离 |
| 恢复 | 点击「恢复」 | 无报错，隔离态还原 |

**实测发现并修复一个集成缺陷**（`fix` 提交在本包之后）：
`__dtxAfterInstancesLoaded` 无条件 `resetScenario('branNearestClearance')`——范围显示加载命中件的几何时，把刚算出的结果与标注一并清空、面板归零且不再重查（watcher 只在 refno 变化时触发）。
修复：改走 `handleInstancesLoaded()`——先按原语义重置（手动模式行为不变），自动模式开着且当前选中仍解出 BRAN 时经同一条 350ms 防抖路径补一次重查（多库分批加载合并为一次）。
实测修复后：范围显示加载完成 → 自动补发 1 次 `nearest-clearance` → 10 类 facet / 26 行 / 10 条标注自动恢复。
回归：useSpatialCompute 34/34 含新用例「新批次实例加载使结果失效：自动模式补一次重查，手动模式只清不查」。

## 五、标注呈现改为 pill 引线标签 + 净距段（`40c4d0ac` 之后）

每条候选由一条 external 线性尺寸改为两条记录：

- `bran-clearance:<noun>:<refno>:<i>`：**pill 引线标签**（explicit + tag）——锚点 `b`（目标表面点）画圆点 + 引线 + 白底药丸「NOUN ≈587mm」；tag 走 billboard 求解（多角 × 多环候选位，避让其他标签），密集场景不再互相压字。
- `…:seg`：**净距段**（annotation 类）——`a`（管表面点）→`b` 细直线 + `a` 端圆点，`formattedLabel` 为空，只画几何。

实测（:8022，BRAN `24384/22726`，自动模式重选后）：registry `bran-clearance` = 20 条记录（10 候选 × 2），
pill 文字实测为「PANE ≈0mm / WALL ≈0mm / STWALL ≈388mm / STRT ≈660mm / SCTN ≈661mm / FLOOR ≈1188mm / FITT ≈1378mm / BEND ≈2685mm / TAPE ≈2817mm / BOX ≈4105mm」——全部可读无叠字。
截图见 `shots/01-auto-follow-annotations.png`（三维 pill+引线+周边范围构件）、`02-result-rows.png`（结果行 标注/跳转/精算）、`03-auto-follow-switch-and-range.png`（自动计算开关 + 范围显示控件）。
