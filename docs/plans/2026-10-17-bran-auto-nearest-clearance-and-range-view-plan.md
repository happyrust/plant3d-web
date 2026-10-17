# 选中 BRAN → 自动按类型标注最近净距 + 中心线范围显示 · 开发计划

> 日期：2026-10-17。来源：用户审核 #91（管道→墙/柱/楼板表面净距，已关单）后提出两条新需求：
> ①「选中一个 BRAN，自动标注它距离哪些类型的最近距离」；②「加个范围，快速显示这个 BRAN 中心线按一定范围距离的所有模型」。
> 上位：#91（`surface-clearance` 精算 → `ClearanceStore`）、#63/#64（ClearanceStore 统一）、
> gen-model 计划 `docs/plans/2026-09-16-bran-centerline-nearest-clearance-v1-dev-plan.md`（`/nearest-clearance` 口径）。
> 基线：plant3d-web `main@c935540a`；gen-model `/api/v1/spatial/nearest-clearance`、`/nearby/refnos`、`/surface-clearance` 均已在 `:8024` 实例可用。
> 状态：**进行中**。plannotator 评审已通过（2026-10-17，`{"decision":"approved"}`，无批注）；**T1、T2 已在工作区落地（未提交）**，T3–T6 待做；D1–D4 已拍板，D5–D7 待拍板（推荐值见 §3，评审未提出异议）。

## 0. 一句话

「按类型找最近 → 画尺寸 → 逐条精算」这条流水线在 `SpatialComputePanel`（BRAN 中心线最近清距场景）里**早已跑通**，缺的只是**触发方式**（手动填 refno 点按钮）和**周边可视化**（只画尺寸线、看不到周边构件）。
本计划把它补成：选中 BRAN / 管件即自动算并画出每类型最近 1 条（估算），一键把半径内全部构件加载并隔离显示，再按需批量升级为网格精算；不新增后端接口。

## 1. 已核实的基线（2026-10-17 查证）

### 1.1 后端：三个接口各管一段

| 接口 | 作用 | 精度 | 出处 |
|---|---|---|---|
| `GET /api/v1/spatial/nearest-clearance`（`source_mode=bran_centerline`, `group_by=noun`） | 沿 BRAN 真实中心线（`branch_query` 成员序，含隐式管身）在进程内 `GLOBAL_AABB_TREE` 圈半径内候选，剔自身 / 负几何 / `exclude_nouns`，**线段→候选 AABB 精确最近点对**（分段二次驻点法），按 noun 分桶、距离升序、每桶截 `max_per_group`；每条带可直接画的 `annotation{start,end,label_mm}` | **估算**：目标侧是包围盒不是网格（异形件偏小）；源侧从中心线起算，`surface=1` 才扣 `outside_diameter/2`（前端目前**不发**） | gen-model `spatial_clearance.rs` L385–416 / L594–780、`spatial_centerline.rs` L190–319、`spatial_query.rs` L687–718 |
| `GET /api/v1/spatial/nearby/refnos`（同参） | 同一条粗筛流水线，回**完整命中 refno 集**（不分页，`result_cap`）+ `by_dbnum` / `by_spec_value` | 只判「在不在半径内」 | `spatial_query.rs` L1299–1343 |
| `GET /api/v1/spatial/surface-clearance?target_kind=any` | 一对 refno 两侧真实网格外表面最近点，`exact-surface`，`error_bound ≤ 0.5mm`，带面元数据 / 垂距 / 两侧 sesno | **精算** | #91 验证包 `docs/verification/pipe-to-structure-clearance-2026-10-17/` |

### 1.2 前端：现成的拼装件

| 事实 | 出处 |
|---|---|
| `useSpatialCompute`：`submitScenario` → `fetchBranNearestClearance`（`group_by=noun`、`max_per_group=3`、`exclude_nouns=WELD,ATTA`、`radius=5000`、`scope=all_loaded`，**无 `surface`**）→ `branGroups` → `nounFacets`（全勾）→ `drawnCandidateKeys`（每类最近 1 条）→ `annotationCandidates` | `src/composables/useSpatialCompute.ts` L371–383、L526–579 |
| `refineBranCandidate(key)`：单条 `surface-clearance` 精算，原位替换距离 / 端点 / provenance（`surface-to-surface` / `exact-surface`），**只能逐条点** | 同上 L581–620 |
| `ViewerPanel` watch `annotationCandidates` → `syncBranClearanceDimensions` → `bran-clearance` external source 画尺寸（E3D mm / 1000 → design 米）；标签按 provenance 标「≈包围盒估算」 | `ViewerPanel.vue` L2019–2039、L3784–3798 |
| 结果持久化：`createScopedResultPersistence(prefix 'plant3d-bran-clearance-v1')`，恢复后全标 stale | `useSpatialCompute.ts` L478–489 |
| `findOwnerBranRefnoAcrossAllDbnos(refno)`：管件 → 所属 BRAN（owner_noun / 自身 noun / 前缀匹配），`measure_pipe_to_structure` 已在用 | `useDbnoInstancesDtxLoader.ts` L739–750 |
| `useSpatialQuery`：距离查询 `distanceCenterSource='bran_centerline'` 已支持；`loadResults({onlyUnloaded, flyTo})` 批量加载 + 飞行；`isolateResults()` 命中实体、其余 X-Ray；`restoreScene()` 按首次快照还原；`draft` 为抽屉共享单例 | `useSpatialQuery.ts` L1751–1762、L2328–2446、L2485–2536 |
| `measure_pipe_to_structure` 工具：点一根管 → `nearest-clearance` 取墙/柱候选 → 前端网格采样最近点 → `ClearanceStore`（`sampled-object`）；与本计划是**两条平行路**，不合并 | `useDtxTools.ts` L3604–3717 |

### 1.3 已拍板（2026-10-17，用户）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 触发方式 | **开关式**：面板「选中 BRAN / 管件自动计算」开关，开着时跟随选中；关掉回手动 |
| D2 | 精度档位 | 自动画**估算**（`nearest-clearance` 一次请求）；精算按需 |
| D3 | 目标类型 | **半径内全类型 + facet**（现状），不预设白名单 |
| D4 | 源识别 | **管件也算**：经 `findOwnerBranRefnoAcrossAllDbnos` 解到所属 BRAN |

## 2. 目标 / 非目标

**目标**
1. 开着开关时，三维 / 模型树里选中 BRAN 或其任一管件 → 350 ms 内自动提交查询 → 每类型最近 1 条尺寸自动画出；同一根重选不重复请求；选中非 BRAN 不打扰现有结果。
2. 面板一键「显示范围内模型」：沿当前 BRAN 中心线按用户给的半径圈全部构件，未加载的自动加载并飞到结果盒，命中实体、其余半透明，**源 BRAN 保持实体**；「恢复」一键还原。
3. 一键「全部精算」：把当前画出的候选批量升级为 `surface-clearance` 精确值（并发受控、可中断、失败逐条保留估算）。
4. 既有契约不破：`nearest-clearance` 请求参数金样（`useSpatialCompute.test.ts` L96–107）不动；`useSpatialQuery` 63 个用例不回归；`ViewerPanel` 不改。

**非目标（本计划不做）**
- 不新增 / 修改 gen-model 接口；不碰 `GLOBAL_AABB_TREE`。
- 不把自动结果写进 `ClearanceStore`（那是 #91 的「记录」口径：一对一记录、校审持久化；这里是「随选中刷新的瞬时标注」，两种生命周期不同——真要留档走行上「精算」→ 它已经写 provenance，再由 #64 的统一入口转记录，另立票）。
- 不做「永远自动」（D1 已否）；不做类型白名单预设（D3 已否）。
- 不改 `measure_pipe_to_structure` 工具链。

## 3. 方案与任务

### T1 自动跟随选中（**已落地**，工作区未提交）

- `useSpatialCompute.ts`：`createSpatialComputeStore(options?)` 新增 `resolveOwnerBran` / `autoFollowDebounceMs` 注入；`autoFollowSelection` ref + `setAutoFollowSelection(enabled)`；`watch(selection.selectedRefno)` 防抖 → `autoSubmitForSelection`（解 BRAN → 与 `autoQueriedBranRefno` 比对 → 写 `suppoRefno` → `submitScenario`）；版本对比（`calculationsAllowed=false`）静默跳过；`dispose` / `resetScenario` / `modelProjectChanged` 清 timer 与缓存。缺省 resolver 动态引入 `useDbnoInstancesDtxLoader`（避免把 three.js 链拖进面板 / 测试）。
- `SpatialComputePanel.vue`：BRAN 场景下加开关行（`data-testid="bran-auto-follow"`）。
- 测试：`useSpatialCompute.test.ts` 新 describe 3 例（管件→BRAN 触发并默认标注、同 BRAN / 非 BRAN / 换 BRAN 边界、关闭后不触发）；mock `useSelectionStore` 改真 `ref`。
- 验证：29/29 通过；type-check 0 新增；ESLint 干净。

### T2 中心线范围显示（**已落地**，工作区未提交）

- `useSpatialQuery.ts`：`isolateResults(keepRefnos?: string[])`——额外 refno 留在实体侧（源 BRAN 因 `include_self=false` 不在命中里）。
- `SpatialComputePanel.vue`：「范围显示」行（距离输入 mm，默认 5000；「显示范围内模型」/「恢复」）。`showBranRange()`：`setMode('distance')` + `distanceCenterSource='bran_centerline'` + refno（`queriedSourceRefno` 优先，退回输入框）+ radius；**清掉抽屉残留的 noun / keyword / rooms / specValues / 显隐过滤**；`submitQuery()` → 空结果报错 → `loadResults({onlyUnloaded:true, flyTo:true})` → `isolateResults([bran])`。结果同时落在空间查询抽屉结果区。
- 测试：`SpatialComputePanel.test.ts` 新 describe 3 例（参数与过滤清理、无 BRAN / 非法半径内联报错、空结果与恢复）。
- 验证：3 文件 98/98 通过；type-check 0 新增；ESLint 干净。

### T3 批量精算（待做，≈0.5 天）

- `useSpatialCompute.ts` 新增 `refineAllDrawn(options?: { concurrency?: number })`：对 `annotationCandidates` 里 provenance 非 `surface-to-surface` 的候选，按 `concurrency`（缺省 **3**，`surface-clearance` 单次 100–500 ms、后端网格读有锁）排队调 `refineBranCandidate`；暴露 `refiningAll: Ref<boolean>` 与 `cancelRefineAll()`；用现有 `requestTokens.branNearestClearance` 作 epoch，切 BRAN / reset 自动作废队列。
- 面板：facet 区右侧加「全部精算 (N)」按钮，进行中显示 `k/N` 与「停止」。
- 测试：队列并发上限、中途切 BRAN 作废、单条失败不阻塞其余（复用现有 `retains estimates when refinement returns *` 的 fetch 桩）。
- **D5 待拍板**：自动模式下要不要「自动精算」（选中即排队精算所有画出的候选）？推荐 **否**（默认估算即时、精算一键），理由：N 类 N 请求，连点管件会把后端网格读打满。

### T4 `surface=1` 口径（待做，1 行代码 + 1 个决策）

- 现状：自动画的是「管**中心线**到目标包围盒」，比真实管表面净距**大一个管半径**；标签只说「≈包围盒估算」没说起点。
- **D6 待拍板**：`fetchBranNearestClearance` 是否加 `surface: true`？
  - **(a) 加**（推荐）：距离 = 中心线距离 − OD/2（≥0），起点推到管表面；`distance_method` 变 `centerline_surface_aabb_clearance_mm`；BRAN 无外径时服务端出 warning 并退回中心线起算（面板已显示 warnings）。标签文案改「≈管表面到包围盒」。
  - (b) 不加：维持 gen-model 计划 D4 的「未拍板」状态，但要在标签里明确「中心线起算」。
- 影响：`useSpatialCompute.test.ts` L96–107 的参数金样加一格 `surface: '1'`；`provenanceMethodLabel` 文案；`docs/guides` 里空间计算教程一句。

### T5 开关与半径持久化（待做，≈0.25 天）

- 现状：`autoFollowSelection`、`rangeDistance` 刷新即丢。
- 方案：进 `createScopedResultPersistence` 的快照（`captureSnapshot` 多两格 `autoFollowSelection` / `rangeDistanceMm`；`prepareSnapshotRestore` 校验布尔 / 1–100000 数字），随现有 `plant3d-bran-clearance-v1:<scope>` 一起落 localStorage；恢复时**不**自动触发查询（恢复结果已标 stale，由用户重选）。
- **D7 待拍板**：开关按「项目 / 任务上下文」记（随 scope）还是全局记一份？推荐**随 scope**——与同面板其余状态同生命周期，少一套键。
- 测试：快照 round-trip + 旧快照缺字段按默认值读。

### T6 真机验证 + 文档收口（≈0.5 天）

- 环境：按 AGENTS.md，SurrealDB `ams-8009` 副本 + `AIOS_STORE_MODE=rocksdb` 起 `aios-database.exe`（`:8024`），项目 `AvevaMarineSample`，源 BRAN `24384/22726`（#91 同一根，已有 sesno 650 基线）。
- 用例：
  1. 开开关 → 三维点 `24384/22726` 下任一管件 → 面板 `suppoRefno` 变 `24384_22726`、facet 出现、三维出现每类 1 条尺寸；再点同根另一管件 → Network 无新请求；点一堵墙 → 结果不变；点另一根 BRAN → 重查。
  2. 范围 3000 mm →「显示范围内模型」→ 抽屉结果区出现同一集合，场景里命中实体 / 其余半透明 / 源 BRAN 实体；「恢复」还原。
  3. 「全部精算」→ 每条距离与 #91 验证矩阵对账（`24381/1776` WALL 607.03 mm、`17496/72729` FLOOR 587.5 mm、`24381/2306` SCTN 5935.3 mm）；估算 vs 精算差值记录。
  4. D6 若取 (a)：同一根 BRAN 开关 `surface` 前后的 WALL 估算差 ≈ OD/2。
- 产出：`docs/verification/bran-auto-clearance-2026-10-xx/README.md`（命令、请求 URL、响应 JSON、截图）；`docs/guides` 空间计算教程加「自动模式 / 范围显示 / 全部精算」三节；本计划状态行更新。
- 提交拆分：T1+T2 一提交（`feat(spatial): BRAN 净距跟随选中自动计算 + 中心线范围显示`）；T3 / T4 / T5 各一提交；T6 `docs(verification)`。

## 4. 风险与边界

| 风险 | 处理 |
|---|---|
| 自动模式下连点管件打爆 `nearest-clearance` | 350 ms 防抖 + 同 BRAN 去重 + `requestTokens` 旧响应作废（已做）；D5 推荐不自动精算 |
| 版本对比里点 A/B 隔离图层也写 `selectedRefno` | `calculationsAllowed=false` 时静默跳过（已做） |
| 范围显示的候选命中但**库未加载** | `loadResults` 按 `by_dbnum` 加载未加载的；整库没进场景的构件加载慢——半径 > 20 m / 命中 > 200 项时复用抽屉的 `LARGE_BATCH_LOAD_CONFIRM_THRESHOLD` 弹确认（T2 目前未接，T6 验证时按实际加载时长决定是否补） |
| 抽屉与面板共享 `useSpatialQuery.draft` | 范围显示前清过滤（已做）；抽屉里用户再改条件会覆盖，属预期（结果区是同一份） |
| 估算偏差被当成精确值 | 标签恒标「≈」+ provenance 方法；D6 (a) 把起点推到管表面后仍是「到包围盒」，文案必须保留「包围盒」字样 |
| `findOwnerBranRefnoAcrossAllDbnos` 对未加载构件回 null | 自动模式只对场景已加载构件生效；模型树选中未加载 BRAN 时 noun 可能解不出 → 不触发，面板仍可手动「从场景读取 Refno」 |

## 5. 验收清单

- [ ] T1 / T2 提交；`npm run type-check` 0 新增、`npm run lint`、`npm test` 全绿
- [ ] T3 「全部精算」并发 ≤ 3、可停止、切 BRAN 作废
- [ ] D5 / D6 / D7 拍板并落代码 + 金样
- [ ] T5 刷新后开关与半径保留，不自动触发
- [ ] T6 真机四条用例通过，验证包落盘，教程更新
