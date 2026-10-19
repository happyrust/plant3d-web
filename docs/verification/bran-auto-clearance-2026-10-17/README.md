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

## 五、标注呈现回退为测量式线性尺寸 + 新增「X 光查看」（2026-10-18）

`40c4d0ac` 的 pill 引线标签 + 净距段方案经真机评审认为观感杂乱，按用户要求回退为**与测量工具同形态**的单条 external 线性尺寸（`kind: 'linear'`，`a`→`b` 尺寸线 + 线上值字），尺寸文字带目标 noun（`WALL ≈465mm`）——「距离哪些类型最近」的类型信息必须在线上直接可读。估算/精算/平行中心距/过期的文字约定不变。

新增结果表头部两个查看开关（`bran-xray-toggle` / `bran-only-toggle`，同一互斥模式 `branInspectMode`）：

- 「X 光查看」：`useSpatialQuery.isolateRefnos(keep)`——keep = 源 BRAN + 已标注目标（`withCompanions` 顺带保住成员直段），其余构件全部 X-Ray 半透明；`resolveBatchRefnos` 的显式 refno 分支提前到结果集判空之前，不经空间查询也能隔离。
- 「仅显示」：新增 `useSpatialQuery.showOnlySceneObjects(keep)`——场景级版本，keep 可见实体、其余全部隐藏，清掉残留 X-Ray；同样不要求结果集。
- 两种模式互斥：切换前先 `restoreScene` 再按新模式重放；查看开着时标注集变化（重算 / facet 勾选 / 逐条标注 / 精算）自动按当前模式与新集重放；集合清空自动 `restoreScene` 归位；「范围显示」与「恢复」都会把开关归位。

实测（:8022，BRAN `24384/22726`，自动模式 10 条已标注，场景 140 对象）：

- 开 X 光：11 实体（`24384_22726` + 10 目标）/ 129 X-Ray / 0 隐藏；退出全恢复；
- 开仅显示：11 可见实体 / 0 X-Ray / 129 隐藏；退出全恢复；
- registry `bran-clearance` = 10 条 `linear` 记录，`authoritativeText` 如 `PANE ≈0mm`、`TAPE ≈2817mm`、`FLOOR ≈1188mm`，三维内呈红色尺寸线+线上文字。

## 六、结果行 ↔ 三维标注联动（2026-10-18）

- 尺寸布局按候选序**交错排布**（`side` 交替、`offsetM` 0.5/0.9/1.3/1.7 轮转、`labelT` 错开），实测 registry 中 10 条记录 placement 两两不同，缓解线上文字叠字。
- 行悬停：`mouseenter` → `dimensionSystem.viewport.setHover(branClearanceDimensionId(row))`（同一 id 规则导出 `branClearanceDimensionId`），`mouseleave` 清除；实测悬停 STWALL 行 → `hoverId = bran-clearance:wall:24381_1776:0`。
- 「跳转」：选中目标 refno + `flyTo` 净距段场景包围盒（两端点并集 + 500mm 余量，`fit:true`）；实测 STWALL 行 → `sel=[24381_1774]`、aabb 覆盖该段。
  - 修复：`useSelectionStore()` 原在点击处理器内调用，其内部 `useQuery` 离开 setup 上下文抛 `vue-query hooks can only be used inside setup()`——改为 setup 期取一次复用（同 `useSpatialCompute` 既有用法）。
- 「相交？」徽标：估算相交的行在距离格内加 amber 警示徽标（`row.intersects` 进 `BranNearestClearanceRow`），26 行中 6 行带徽标，与「全部精算」前 0mm 行一致。
- 回归：SpatialComputePanel 12/12（新增悬停联动、跳转、交错布局断言）；adapter 6/6；useSpatialCompute 34/34；useSpatialQuery 63/63；type-check 0 新增；ESLint 干净。

### 查看模式回归矩阵（`ee0a779b` 后真机复测，235 场景对象）

| 操作 | 实测 |
|---|---|
| 范围显示 r3000 后「恢复」 | 234/234 实体、0 X-Ray、0 隐藏 |
| 开 X 光（10 条已标注） | 11 实体 / 224 X-Ray / 0 隐藏，按钮 `aria-pressed=true` |
| X 光开着取消一条标注 | 自动重放：10 实体 / 225 X-Ray，模式保持 |
| X 光开着点「仅显示」 | 互斥切换：10 可见 / 0 X-Ray / 225 隐藏，X 光按钮归位 |
| 仅显示开着清空全部 9 条标注 | 自动 `restoreScene`：235/235 实体，开关随空集消失 |
| 全选 26 条标注 + X 光 | 27 实体 / 211 X-Ray，交错位文字可读（截图留存） |

控制台全程无 `branXrayOn` 残留告警、无新增错误。

### 净距标注点选 → 选中目标构件（真机）

- 链路：尺寸 overlay 捕获阶段 `pointerdown` → `hitTest` 命中 → `viewport.setSelection(dimId)` → `ViewerPanel` 订阅回调用 `branClearanceTargetRefno(id)` 反解目标 refno → 走与点模型同一套 `selectionStore.setSelectedRefno` + `ensureRefnos` + `setObjectsSelected`。
- 修复的遮挡缺陷：`pointerdown` 被尺寸层 `stopImmediatePropagation` 消费后主画布 `onDown` 不跑（`clickState.down=null`），而 `pointerup` 无活动会话返回 NOT_CONSUMED，`onUp` 照常 GPU 拾取落空→清空选中。现在 `onUp` 在 `down==null` 时跳过场景拾取。
- 实测（`:3101`，BRAN `24384_22726`，10 条已标注）：
  - 点 SCTN 尺寸线（`extension` 段）→ `scene.selectedObjectIds = ['24381_2306']`，up 后保持；
  - 点 FITT 标签（`label` 段）→ `sceneSel = ['24381_71806']`；
  - 点空白处 → `['24381_71806'] → []`，清空行为不回归；
  - 直接点目标模型本体 → `24381_1774` 选中（GPU 拾取原生链路，此前已验证）。
- 测试：adapter 8/8（新增 `branClearanceTargetRefno` 正反例）；type-check 0 新增；ESLint 干净。

## 七、T1–T6 缺陷修复与窄幅 Dock 排版收敛真机验证（2026-10-19）

关联计划：`docs/plans/2026-10-19-bran-nearest-clearance-fix-plan.md`（Plannotator 评审通过，D1–D3 均按推荐项 `(a)` 落地）。

| 编号 | 验证项 | `:3101` + `:8022` 真机实测（源 BRAN `24384_22726`） |
|---|---|---|
| **T1（F1）** | 源 BRAN 整根管件在「X 光 / 仅显示 / 范围显示」下保持实体可见 | `deliveryUnitSceneRefnos('24384_22726')` 展开 9 个成员（`24384_22726` + `24384_22727..24384_22735`）。开启「X 光查看」后（场景 140 对象）：**19 实体**（源 BRAN 全套 9 成员 + 10 条已标注目标）/ **121 X-Ray**，`sourceLeavesInXray = []`；开启「仅显示」后：**19 可见实体 / 121 隐藏**，源 BRAN 弯头与管件不再消失或半透明 |
| **T2（F2）** | 按需补装几何（`runWithPreservedResults`）保留净距结果与已精算状态 | 执行「全部精算 (10)」后切换「X 光查看 / 仅显示」及行「跳转」补装目标几何，10 条 `surface-to-surface` 精算记录与 26 行结果完整保留，不被 `handleInstancesLoaded` 重置 |
| **T3（F3）** | 单条精算报错不清空全屏 3D 净距标注 | `ViewerPanel.vue` `offBranClearanceWatch` 仅在 `loading || candidates.length === 0` 时清屏；单条精算报错保留其余候选的 3D 尺寸线 |
| **T4（F4/D1a）** | 点击邻管管件行「跳转」或点选 3D 净距标注不误切源 BRAN，未标注行同样飞入净距段 AABB | 点击第 2 条未标注 `FITT` 行（`24381_71800`，`drawn=false`）的「跳转」：`selectedRefno` 切至 `24381_71800` 并补装几何飞入净距段包围盒，`suppressAutoFollowOnce` 抑制单次自动重查，源 BRAN 保持 `24384_22726`、10 条已精算状态不丢失 |
| **T5（F5/D2a）** | 真实网格相交（`witness='aabb-overlap-center'`，`intersects=true`）精算放行，且精算后桶内按 `distance_mm` 升序重排 | 精算后同桶候选按更新后的真实距离升序重排，已标注项 `drawnCandidateKeys` 与 3D 尺寸 ID 同步更新 |
| **T6（F6/D3a）** | 窄幅 Dock（274px 行宽）双行紧凑卡片排版 | 行高由 93px 收敛至 **59px**（首行左 `Refno + Noun`、右 `精算 / 已标注 / 跳转` 全部单行 26px 高无竖排折行；次行展示 `距离 + 相交? + 来源段说明`），`shots/01,02,03-*.png` 已同步更新 |

- 回归测试：`deliveryUnitScene.test.ts` (4/4)、`useSpatialQuery.test.ts` (63/63)、`useSpatialCompute.test.ts` (36/36)、`SpatialComputePanel.test.ts` (12/12)、`branExternalDimensions.test.ts` (8/8)，合计 **5 文件 123/123 通过**；`npm run type-check` **0 新增错误**；ESLint **0 告警/错误**。

### T2 复审加固：实例加载守卫三分支 + 标注清屏与重置解耦（2026-10-19）

代码评审发现 `runWithPreservedResults` 只盖住面板主动触发的补装，无关增量加载（树按需加载、其他库批次）仍会无条件重置；且 `__dtxAfterInstancesLoaded` 在状态被保留时仍无条件清三维标注。加固后 `handleInstancesLoaded()` 返回「结果是否保住」，分三支：

| 场景 | 行为 |
|---|---|
| `runWithPreservedResults` 进行中（X 光 / 仅显示 / 跳转 / 范围显示补装） | 保留结果，三维标注不动 |
| `queriedSourceRefno` 有效 + 有精算记录 或 手动模式 | 保留结果与标注；重置只发生在切 BRAN / 点「执行计算」/ 切项目 |
| 自动模式 + 全为估算 | 重置后**锚定 `queriedSourceRefno`**（产生结果的那根 BRAN）防抖重刷——不再依赖当前选中（选中目标构件时按 `selectedRefno` 解析会静默放弃、结果永久丢失）；`ViewerPanel` 只在返回「已重置」时清标注，重查回画 |

附带修复：`suppressAutoFollowOnce` 现在连同已排队的 350ms 防抖提交一并取消（否则武装前那次选中的提交仍在防抖窗内把 BRAN 切走）。

`:3101` + `:8022` 真机复测（硬刷新加载新模块，排除 HMR 旧单例）：

- 开「X 光查看」补装 26 个目标几何：净距尺寸全程 `10→10→10→10→10`，19 实体 / 121 X-Ray，无重查；「仅显示」19 可见 / 163 隐藏同样不丢标注，退出 182/182 全恢复；
- 精算 1 行（`实体外表面净距（网格精算）`）后模拟无关 `__dtxAfterInstancesLoaded`：**dims 10→10、行 26→26、精算 1→1、零请求**（旧行为：全清且因选中是目标构件而静默无法自愈）；
- 行「跳转」选中目标 `24381_34871`（非 BRAN）后模拟无关加载：dims `10→0→10`——重置→锚定 `24384/22726` 重查→回画（旧行为：`req=0` 永久丢失）；
- 回归：`useSpatialCompute.test.ts` 38/38（新增精算守卫、锚定重查、防抖取消三用例）；五文件 **139/139**；type-check 0 新增；ESLint 干净。

注意：`externalRegistry.recordsBySource.get('bran-clearance')` 是 **Array**（非 Map），页面探针统计尺寸要用 `Array.isArray(rec) ? rec.length : rec.size`，误用会读出假的 0。

## 八、本地 0.1.40 栈复测「范围显示」（2026-10-19，release 0.2.7 之后）

本地栈 `3100/3101/8022` 全为 `0.1.40`（发布的是 0.1.41 在远端服务器），源 BRAN `24384_22726`。硬刷新后自动链路恢复 **39 行 / 15 条标注**（本地数据与 :8024 档不同，行数/标注数随行）。

| 步骤 | 实测 |
|---|---|
| 「显示范围内模型」r3000 | `GET /api/v1/spatial/nearby?refno=24384/22726&radius=3000&source_mode=bran_centerline&limit=500` 回 **265 项**（15 类 noun：UNSET 44 / PANE 54 / FTUB 81 / BEND 26 / SCTN 13 / STRT 11 / FITT 11 / WALL 7 / ATTA 7 / FLOOR 4 / ELBO 2 / WELD 2 / STWALL 1 / BOX 1 / TAPE 1），跨 1112/7997/7999/8000 四库 |
| 补装几何 | 场景 `130 → 418` 对象（新增 288）；`loadResults onlyUnloaded + flyTo` 生效 |
| 隔离 | **297 实体 / 121 X-Ray**——范围内命中+源 BRAN 同伴实体，其余半透明 |
| 结果保全 | 净距标注 `15→15`、结果行 `39→39` 全程不丢（`runWithPreservedResults` + D1/D2 守卫生效） |
| 「恢复」 | `418/418` 全实体、0 X-Ray、0 隐藏；标注与结果行保持 |
| 错误透出 | 「有 35 个模型加载失败」——`model/records` 抽查证实 UNSET `17496_105912` 等 refno 在本地档 `total=0` 未生成，属**本地数据缺口**而非前端缺陷；所有 265 个查询目标都在场景中有可见对象（真实几何或 AABB 代理） |

插曲：本次开页时 8022 瞬时 refused（服务尚在启动），页面拿到空数据；服务就绪后刷新即恢复——本地测试前先确认三端口都 OK。

## 九、目标类型白名单（`target_nouns`，默认结构类）（2026-10-19）

起因：「全部构件类型」按半径内全部 noun 各取最近——FTUB/BEND/ELBO/FITT/COUP/TAPE 等管件邻居把视图刷成一团，真正要看的柱/墙/楼板被淹没（用户评审原话「应该显示距离我们指定的类型，比如柱子、墙、楼板」）。

改动：`structureCategory='all'`（改名「指定类型集合（默认结构类）」）下 `group_by=noun` 附带 `target_nouns` 白名单，默认 `WALL,PANE,GWALL,STWALL,FLOOR,COLU,SCTN,GENSEC`（服务端 `wall`/`column` 预置组同口径 + 楼板 FLOOR）；面板 `target_nouns` 输入框可编辑，留空回到半径内全类型；单组类别（wall/column/beam/slab）不发该参数。快照 `inputs` 增 `targetNouns` 一格（旧快照按新默认读）。

真机实测（`:3101` + `:8022`，BRAN `24384_22726`，硬刷新后点「执行计算并定位」）：

- **改前**（全类型）：16 facet — PANE/WALL/FTUB/STWALL/ELBO/FLOOR/STRT/SCTN/BEND/FITT/BOX/TAPE/GWALL/REDU/SBFI/COUP，42 行 / 16 标注
- **改后**（白名单）：**7 facet — PANE/WALL/STWALL/FLOOR/SCTN/GENSEC/GWALL**，21 行 / 7 标注，管件邻居全消失（COLU 半径内没有故缺席）
- 服务端直查 `target_nouns=WALL,PANE,GWALL,STWALL,FLOOR,COLU,SCTN,GENSEC` → `resolved_filters.target_nouns` 回显一致、`nearest_by_group` 恰为 7 桶

测试：`useSpatialCompute.test.ts` 40/40（新增：类别分组不发 `target_nouns`、留空回全类型、自定义白名单原样发出；参数断言加 `target_nouns`）；type-check 0 新增；ESLint 干净。
