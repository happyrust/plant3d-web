# BRAN 最近距离 / 净距测量缺陷修复与交互体验收敛计划

> 日期：2026-10-19
> 基线：`plant3d-web` `main@be19130b`
> 关联前序计划：`docs/plans/2026-10-17-bran-auto-nearest-clearance-and-range-view-plan.md`、`docs/plans/2026-09-11-measurement-clearance-dimension-convergence-plan.md`
> 状态：**已通过 Plannotator 评审并完成 T1–T6 实施验证（D1–D3 按推荐方案 (a) 落地）**

---

## 0. 一句话概述

对 `plant3d-web` 当前实现的「BRAN 中心线最近清距」全链路代码与真机验证截图（`docs/verification/bran-auto-clearance-2026-10-17/shots/`）进行全面排查后，定位出 **6 项破坏功能闭环或交互可用性的具体缺陷**（含源 BRAN 自身管件在 X 光/仅显示/范围显示下被误半透明或隐藏、按需补装目标几何触发 `resetScenario` 抹掉计算与精算结果、单条精算报错导致 `ViewerPanel` 清空全屏 3D 标注、点击管件目标行「跳转」触发自动模式误切源 BRAN、真实相交 `aabb-overlap-center` 精算误抛错，以及窄幅 Dock 下表格与控件严重挤压竖排）。本计划在不改动后端接口的前提下，分 6 个原子任务一次性收敛修复。

---

## 1. 现状诊断与根因定位（2026-10-19 代码核实）

| 编号 | 缺陷现象 | 根因位置（文件与行号） | 影响面 |
| :--- | :--- | :--- | :--- |
| **F1** | **「X 光查看 / 仅显示 / 范围显示」下，源 BRAN 自身的弯头、三通、法兰等管件被误半透明（X-Ray）或隐藏，只剩隐式直管（TUBI）保持实体**（见验证记录：`24384_22726 + 10 目标 = 11 实体`，源 BRAN 下的 `BEND 24384_22730` 等管件全进了 129 个 X-Ray/隐藏集合） | 1. `src/composables/deliveryUnitScene.ts` L42–50 / L78–101：`branOwnerOfLoaded(key)` 在 `owner === key`（即传入的 `key` 本身就是 BRAN 根）时返回 `null`；而 `withCompanions(keep)` 在无空间查询树时 `units = []`，导致 `sceneCompanionsOf([bran, ...targets], [])` 不会把源 `bran` 加入 `owners`，`deliveryUnitSceneRefnos(bran)`（`leavesOfRoot(bran)`）未执行。<br>2. `src/composables/useSpatialQuery.ts` L2515：`isolateResults(keepRefnos)` 直接拼接 `[...withCompanions(...), ...keepRefnos]`，`keepRefnos` 未经 `deliveryUnitSceneRefnos` 展开。 | 源 BRAN 在隔离/仅显示查看时变成“只有直管段、弯头阀门全消失或半透明”的断节管。 |
| **F2** | **点击「X 光查看 / 仅显示」或「跳转」补装未加载目标几何时，触发 `__dtxAfterInstancesLoaded` 清空当前净距结果、抹掉已精算记录与 Facet 勾选状态** | 1. `src/components/dock_panels/ViewerPanel.vue` L3676：`__dtxAfterInstancesLoaded` 无条件调 `spatialComputeStore.handleInstancesLoaded()`。<br>2. `src/composables/useSpatialCompute.ts` L786–794：`handleInstancesLoaded()` 无条件调 `resetScenario("branNearestClearance")`。当 `ensureRefnosLoaded(keep)` 确实加载了跨库/未加载的目标构件时，手动模式下整表与 3D 标注直接被清空；自动模式下虽在 350ms 后重查，但此前耗时的「精算/全部精算」结果（`candidateProvenance`）与用户手动筛选的 Facet / 标注勾选全部丢失。 | 手动模式下点 X 光/仅显示一旦遇到未加载目标即清空结果；自动模式下精算结果与筛选被重置。 |
| **F3** | **单条「精算」或「全部精算」中任意一条失败写 `state.error` 时，`ViewerPanel` 立即清空屏幕上全部 3D 净距标注**，违反「失败保留包围盒估算、不阻塞其余」契约 | `src/components/dock_panels/ViewerPanel.vue` L3784–3798：`offBranClearanceWatch` 判定 `if (loading || error || candidates.length === 0) { clearBranClearanceAnnotations(); return; }`。而 `useSpatialCompute.ts` L642 / L662 在精算失败时设置 `state.error` 并保留 `annotationCandidates`，`ViewerPanel` 却因 `error` 非空把所有成功候选的 3D 标注一并擦除。 | 10 条「全部精算」只要 1 条网格报错，其余 9 条已算好的 3D 尺寸全部从三维视图消失。 |
| **F4** | **结果行「跳转」（`jumpToRow`）三大缺陷**：<br>① 开启「自动计算」时，点击目标为管件（`FTUB/ELBO/BEND/FITT` 等，属邻居 BRAN）的行「跳转」，会选中该管件并触发自动模式把源 BRAN 切换为邻居 BRAN；<br>② 未勾选「标注」的候选行（每类第 2、3 条）点「跳转」拿不到净距段端点 AABB；<br>③ 目标未加载进场景时直接 `getAABB` 为空无法飞入。 | `src/components/spatial-query/SpatialComputePanel.vue` L649–668：<br>① `selectionStore.setSelectedRefno(row.refno)` 触发 `useSpatialCompute` 的 `watch(selection.selectedRefno)` → `resolveOwnerBranRefno(row.refno)` 解出邻居 BRAN 并自动重查。<br>② `match` 只在 `computeState.value.annotationCandidates`（仅含 `drawn=true`）中找，未画出的行找不到 `candidate.annotation`。<br>③ 仅调同步 `viewer.scene.ensureRefnos([row.refno])`，未调异步 `ensureRefnosLoaded([row.refno])`。 | 巡检结果行时点「跳转」会把当前源 BRAN 冲掉；非首条候选跳转视野不准；未加载目标无法定位。 |
| **F5** | **精算后同桶候选距离乱序 & 真实网格相交（`witness === "aabb-overlap-center"`）被精算判为异常失败** | `src/composables/useSpatialCompute.ts` L636–659：<br>① `refineBranCandidate` 死卡 `result.witness !== "closest-points"`，但 `gen-model` `surface-clearance` 在两网格真实相交时返回 `intersects: true, distance_mm: 0, witness: "aabb-overlap-center"`（对比 `clearanceService.ts` L77）。<br>② 包围盒假相交（0mm）经精算纠正为较大距离（如 `WALL 0mm → 233mm`、`PANE 0mm → 2547mm`）后，桶内 `candidates` 未按更新后的 `distance_mm` 重排，且 `branClearanceDimensionId` 依赖数组下标 `index`。 | 真实碰撞构件无法完成精算确认；假相交精算后远距离项仍排在桶首。 |
| **F6** | **窄幅 Dock 面板（~300px）下 `SpatialComputePanel.vue` 四处严重排版挤压与文字竖排折行**（真机截图 `01/02/03-*.png`） | `src/components/spatial-query/SpatialComputePanel.vue`：<br>① L95–104：卡片头部标题与 `shrink-0` 的「默认样例」并排，标题被挤成每行 2 字竖排；<br>② L185–195：「选中 BRAN / 管件自动计算」与右侧长副标题同行挤压，主文案折成 5 行；<br>③ L227–256：「范围显示」标签+输入框+两个按钮强塞一行，「显示范围内模型」被压成 1 字宽；<br>④ L339–395：结果表固定列宽 `130 + 70 + 56 + flex-1 + 150 = 406px+` 远超 Dock 宽度，`Refno` 截成 `2...`、`BRAN 段` 剩 1 字宽 `管`、操作按钮文字竖排。 | 面板核心信息（构件 Refno、净距来源、操作按钮）在默认 Dock 宽度下不可读。 |

---

## 2. 修复方案与任务拆解（T1–T6）

### T1：补齐源 BRAN 及其伴随管件的整根展开（修复 F1）

1. **`src/composables/deliveryUnitScene.ts`**：
   - 在 `sceneCompanionsOf(refnos, unitRefnos)` 中，不仅检查 `branOwnerOfLoaded(key)`（子管件 → 所属 BRAN），同时检查 `key` 本身是否已是记录缓存中的生成根（`recordCache()?.leavesOfRoot?.(key)?.length` 非空，或 `peek(key)` 中含 `is_tubi === true` / `owner_noun === BRAN && owner_refno === key`）。若是，直接将 `key` 加入 `owners` 集合，展开 `deliveryUnitSceneRefnos(key)`（包含 BRAN 自身及该根下已缓存的全部管件叶子 refno）。
2. **`src/composables/useSpatialQuery.ts`**：
   - `isolateResults(keepRefnos: string[] = [])`：将 `keepRefnos` 一并纳入 `withCompanions`（即 `withCompanions([...resolveBatchRefnos(), ...keepRefnos], all)`），保证「范围显示」传入 `[bran]` 时源 BRAN 的全部管件同样保留为实体。
3. **单测**：
   - `deliveryUnitScene.test.ts`：新增直接传入 `[BRAN]` 根 refno 时 `sceneCompanionsOf([BRAN])` 返回该 BRAN 下全部管件叶子的断言。
   - `useSpatialQuery.test.ts`：验证 `isolateRefnos([BRAN, target])`、`showOnlySceneObjects([BRAN, target])` 与 `isolateResults([BRAN])` 将源 BRAN 及其管件叶子一并保留为实体/可见。

---

### T2：区分「场景按需补装几何」与「模型范围变更」，避免冲掉当前净距结果（修复 F2）

1. **`src/composables/useSpatialCompute.ts`**：
   - `nearest-clearance` 查询的是服务端 `scope: all_loaded`，前端为查看/定位某条已算出的候选而调 `ensureRefnosLoaded`（或「范围显示」调 `loadResults`）把缺失网格补装进 DTX 时，**源 BRAN 的后端净距结果并未失效**。
   - 新增精细化的实例加载处理策略：
     - 提供 `suppressNextInstancesReset` 计数/守卫（或 `runWithPreservedResults<T>(fn: () => Promise<T>): Promise<T>`），供面板「X 光查看 / 仅显示」（`applyBranInspect`）、「范围显示」（`showBranRange`）和行「跳转」（`jumpToRow`）在调用 `ensureRefnosLoaded` / `loadResults` 期间挂起 `handleInstancesLoaded` 的重置动作；
     - 同时改进 `handleInstancesLoaded()`：若当前已有生效的 `queriedSourceRefno`（说明结果已经针对该 BRAN 算好），外部增量加载新构件进场景时：
       - 若已开启 `autoFollowSelection` 且无精算结果（全为初始估算），仅静默刷新或保留当前状态；
       - **若当前已有用户精算记录（`Object.keys(state.candidateProvenance).length > 0`）或处于手动模式，不主动清空既有结果**（用户切换 BRAN、点「执行计算」或切换项目 `modelProjectChanged` 时才重置）。
2. **单测**：
   - `useSpatialCompute.test.ts` & `SpatialComputePanel.test.ts`：验证手动/自动模式下精算后触发「X 光查看」（含补装几何）或「范围显示」不会抹掉已精算结果与 Facet 勾选。

---

### T3：`ViewerPanel` 仅在整次查询级失败或空候选时清标注，单条精算报错保留已画出尺寸（修复 F3）

1. **`src/components/dock_panels/ViewerPanel.vue`**：
   - 修改 `offBranClearanceWatch`（L3784–3798）：
     - 只要 `!loading && candidates.length > 0`，即调用 `syncBranClearanceDimensions()` 正常渲染/更新所有 `annotationCandidates`（其中精算成功的显示精确值，精算失败的保持原包围盒估算值 `≈`）；
     - 仅在 `loading || candidates.length === 0` 时调用 `clearBranClearanceAnnotations()`（整次 `submitScenario` 请求失败时 `clearScenarioResults` 已将 `annotationCandidates` 清空为 `[]`，因此 `candidates.length === 0` 自然覆盖了查询失败场景）。
2. **`src/composables/useSpatialCompute.ts`**：
   - 将精算失败提示与查询级致命错误解耦（保留 `state.error` 供面板顶部提示，但不再因 `state.error` 阻断 `annotationCandidates` 渲染）。

---

### T4：修复结果行「跳转」误触发自动重查、未标注行缺端点盒与未加载目标补装（修复 F4）

1. **`src/components/spatial-query/SpatialComputePanel.vue` (`jumpToRow`)**：
   - **抑制自动跟随误触发**：在 `jumpToRow` 选中目标构件 `row.refno` 时，调用 `spatialCompute.suppressAutoFollowForRefno(row.refno)`（在 `useSpatialCompute` 中记录本次选中来自结果表目标巡检，不触发 `autoSubmitForSelection`），防止点中邻居管道上的 `ELBO/FTUB` 把当前源 BRAN 替换掉。
   - **全量候选查找净距段端点**：从 `computeState.value.branGroups`（而非仅 `annotationCandidates`）中按 `row.candidateKey` 查找候选的 `annotation.start_point / end_point`，确保未勾选「标注」的第 2、3 条候选行点击「跳转」也能精准框住净距段（管表面点 ↔ 目标最近点 + 500mm 余量）。
   - **异步补装未加载目标几何**：先通过 `spatialQuery.ensureRefnosLoaded([row.refno])`（配合 T2 不重置结果）确保目标构件已在场景中，再执行 `setObjectsVisible`、`setObjectsSelected` 与 `cameraFlight.flyTo`。

---

### T5：支持真实网格相交精算收口 & 稳定候选尺寸 ID（修复 F5）

1. **`src/composables/useSpatialCompute.ts` (`refineBranCandidate`)**：
   - 放宽 `witness` 校验为 `(result.witness === closest-points || (result.intersects === true && result.witness === aabb-overlap-center))`（与 `clearanceService.ts` 对齐）。当两构件真实网格相交时，允许升级为 `surface-to-surface` / `exact-surface` 并保留 `intersects = true`、`distance_mm = 0`。
2. **`src/dimension/adapters/branExternalDimensions.ts` & `src/composables/useSpatialCompute.ts`**：
   - 精算更新 `candidate.distance_mm` 后，对当前桶 `group.candidates` 按 `distance_mm` 升序重排；
   - `branClearanceDimensionId(targetGroup, refno, index)` 同步保持与 `annotationCandidates` 当前桶内位置一致，确保桶内重排后行悬停 `branRowDimensionId` 与 3D 尺寸 ID 恒定对应。

---

### T6：重构 `SpatialComputePanel.vue` 窄幅 Dock 响应式布局（修复 F6）

针对 Dock 默认宽度（300–360px）做紧凑化排版，彻底消除竖排断字与列宽溢出：

1. **卡片头部（L95–104）**：标题与「默认样例」改为 `flex-wrap` 上下紧凑排列，去掉挤压标题的横向争抢。
2. **「选中 BRAN / 管件自动计算」开关框（L185–195）**：改为上下两行结构——第一行左放 Checkbox + `选中 BRAN / 管件自动计算`（`font-semibold` 不换行），第二行小字说明 `半径内每类默认标注最近 1 条（管表面到包围盒估算）`。
3. **「范围显示」区块（L227–256）**：拆分为紧凑两行——第一行 `范围显示` + 距离输入框（`mm`）；第二行并排两个按钮 `显示范围内模型`（`flex-1 whitespace-nowrap`）与 `恢复`（`shrink-0 whitespace-nowrap`），按钮文字永不折行。
4. **结果列表（L339–395）**：由超宽 5 列窄表格改为 **紧凑双行行卡片（Two-line Row Layout）**：
   - **第一行（主信息 + 距离）**：左侧完整显示 `row.refno`（`font-mono font-semibold`）+ 类型徽标 `row.noun` + 相交警示徽标 `相交?`；右侧醒目显示距离 `formatDistanceMm(row.distanceMm)`。
   - **第二行（来源明细 + 操作按钮组）**：左侧单行截断显示 `row.label`（悬停 `title` 看全量明细）；右侧水平排列 `精算`、`标注/已标注`、`跳转` 三个紧凑按钮（`shrink-0 whitespace-nowrap`），保证在 300px 宽度下 Refno 完整可读、按钮不竖排折字。
   - 保持所有既有 `data-testid`（`bran-result-row`、`bran-refine-*`、`bran-draw-toggle-*` 等）100% 兼容，不破现有单测与 E2E 选择器。

---

## 3. 需要本次 Plannotator 拍板的决策项（D1–D3）

| # | 决策项 | 推荐方案 | 备选方案 |
| :--- | :--- | :--- | :--- |
| **D1** | **结果行点「跳转」选中邻居管件时的自动跟随行为（T4）** | **(a) 推荐：抑制本次自动重查**——点结果行的「跳转」是为了巡检当前源 BRAN 与该目标的净距，高亮目标构件但不把源 BRAN 切换过去；用户在三维视口或模型树直接点选其他 BRAN/管件时照常自动跟随。 | (b) 不选中目标构件（只飞相机），避免触发 selection watcher。 |
| **D2** | **精算更新距离后同桶候选排序策略（T5）** | **(a) 推荐：桶内按最新 `distance_mm` 升序重排**——避免假相交（0mm）精算成 2500mm 后仍排在桶内第 1 行误导用户；已勾选的 `drawnCandidateKeys` 按 `branCandidateKey` 保持不变。 | (b) 保持初始包围盒顺序不动，只改距离数字。 |
| **D3** | **结果表窄幅适配形态（T6）** | **(a) 推荐：紧凑双行卡片行（保持 `data-testid="bran-result-row"`）**——第一行完整展示 `Refno + 类型 + 距离`，第二行展示 `段/来源标签 + 精算/标注/跳转按钮`，彻底解决 300px Dock 下 `Refno` 变 `2...` 和按钮竖排问题。 | (b) 维持单行表格但支持横向滚动条（`overflow-x-auto`）。 |

---

## 4. 验证与回归清单

- [ ] **单元测试**：
  - `npx vitest run src/composables/deliveryUnitScene.test.ts`
  - `npx vitest run src/composables/useSpatialQuery.test.ts`
  - `npx vitest run src/composables/useSpatialCompute.test.ts`
  - `npx vitest run src/components/spatial-query/SpatialComputePanel.test.ts`
  - `npx vitest run src/dimension/adapters/branExternalDimensions.test.ts`
- [ ] **静态检查**：
  - `npm run type-check`（0 新增错误）
  - `npm run lint`（0 错误）
- [ ] **真机 / 浏览器复核**：
  - 源 BRAN `24384/22726` 开启「X 光查看 / 仅显示 / 范围显示」时，源 BRAN 的直管与所属弯头/管件全部保持实体可见；
  - 单条或全部精算后点「X 光查看 / 仅显示」，已精算结果不被重置；
  - 点击 `ELBO / FTUB` 目标行的「跳转」飞向该净距段，源 BRAN 保持 `24384_22726` 不被替换；
  - 右侧 Dock 在默认宽度下 `Refno`、开关文案、范围显示按钮及行操作按钮无竖排折字或截断。
