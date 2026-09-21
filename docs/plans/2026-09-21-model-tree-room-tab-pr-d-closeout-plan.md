# 模型树「房间」页签（PR-D）收口 · 房间层级树第二批 开发计划

> 日期：2026-09-21。来源：用户「分析范围查询按房间 → 专业 → 最小交付单元展开的实现进展」→「用 pencil 看看现在的交互界面」→
> 「放到 plant3d-web 里」→「把 room-hierarchy-tree.pen 随 PR-D 一起提交，然后用 plannotator 制定开发计划」。
> 上位计划：`docs/plans/2026-09-20-spatial-room-hierarchy-tree-plan.md`（§4.5 ROOM 标签页、§5 第 5 条 PR-D「待定」）；决策 ADR 0068（第 4 条：房间浏览是同一聚合器的第二个入口）；
> 词条 `CONTEXT.md`「空间查询」一节：房间层级树 / 其他构件。
> 设计稿：`ui/空间查询/room-hierarchy-tree.pen`（`14ece7b6`，六帧：R0 说明 · R1 抽屉平铺态 · R2 抽屉树态 · R3 模型树「房间」页签 · R4 界面→接口映射 · L 实时页面）。
> 前端基线：plant3d-web `main@14ece7b6` + 工作树未提交的 PR-D 代码（§1.2）；后端 `gen-model-model-cache@65dacd576`（`:8027` 验证实例，mem 档、`room_membership=true`、AMS 7997 已 ensure）。
>
> 状态：**Plannotator 已批准**（2026-09-21 16:43，`{"decision":"approved"}`，无批注）——D1–D7 按 §6 推荐项执行。
> **P1-a 真机 → P0 提交 → P2 文档 已完成（16:52–17:1x）**：真机十步全过（README §8）；PR-D 一笔 `plant3d-web@92d928fc`（9 文件 +1730，别人的 hunk 一个没碰）；
> 上位计划 §4.5 / §5 改完成、教程 §6.1.1 + §9 一行、CHANGELOG 一条覆盖 ADR 0068、CONTEXT 词条改口。
> **P1-b e2e 已完成（17:11）**：`e2e/model-tree-room-tab-gen-model-v1.spec.ts` 三条（D2 新建），`:3111` + `:8027` `--workers=1` **3 passed / 11.2 s**，日志入验证目录。**P3-a/b/d 未开工**（P3-c 按 D6 不做）。

## 0. 一句话

房间层级树的第一批（抽屉树态 + 剪辑 + 文档，PR-A/B/B2/C）已合入 main 并真机验过；第二批 PR-D——模型树「房间」页签——**代码已在工作树里写完大半但没提交、没真机、没文档、没 e2e**，
而上位计划里它的状态仍是「等用户定：新建 v1 房间页签 / 取消」。本计划把 PR-D 按「新建」收口：先把混在工作树里的 PR-D 代码干净地提交（P0），再补真机 + e2e（P1）、
文档三处 + CHANGELOG（P2），最后按设计稿 R3 对照收几处小缺口（P3）。不改后端，不动抽屉树态。

## 1. 已核实的基线（2026-09-21 15:5x–16:4x 查证）

### 1.1 已合入 `main`

| 层 | 提交 | 要点 |
|---|---|---|
| 后端两条树路由 | `gen-model-model-cache@06b067b51` + `65dacd576` | `GET /api/v1/spatial/nearby/tree`（`rooms=` 必填）与 `GET /api/v1/spatial/rooms/{refno}/tree`（房间盒为范围、`rooms=` 自己、`include_self=false`、`radius` 缺省 0）；按 refno 去重、每层计数、叶子内联 `leaf_cap` 5000、`unit=` / `other_noun=` 补叶；HTTP 金样 38 / 38 |
| 抽屉树态（PR-B） | `fb2ed9a3` + `37b40691` | `SpatialSource.tree()` / `capabilities.tree`；`useSpatialQuery` 选房即打 tree；`spatialTree.ts` 纯函数；`SpatialResultTree.vue` 五层 + 悬停 加载 / 仅显示 / 隔离 |
| 结果区剪辑（PR-B2） | `f9c07ea5` | 七图标排、单行卡片、中心并进摘要；e2e `spatial-query-gen-model-v1-ui.spec.ts` 9 passed / 1 skipped |
| 文档（PR-C） | `7f4042fa` | 教程 §6.1、验证记录 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/`、CONTEXT 两词条、ADR 0068 |
| 设计稿 | `14ece7b6` | `ui/空间查询/room-hierarchy-tree.pen` 六帧（本轮） |

### 1.2 工作树里未提交的 PR-D 代码（`git status`，16:0x）

| 文件 | 状态 | 内容 |
|---|---|---|
| `src/composables/roomTreeNodes.ts` (+ `.test.ts` 5 例) | 未跟踪 | 节点模型与纯函数：id 体系 `room:` / `spec:` / `utype:` / `others:` / `unit:` / `onoun:` / `elem:<房间>:<refno>`；`flattenRoomTree`（一间房整树展成带 parent / children 的节点表，行名带计数）、`refnosUnder`、`pendingLeafNodesUnder`、`ancestorsOf`、`roomRootNode` |
| `src/composables/useRoomTree.ts` (+ `.test.ts` 8 例) | 未跟踪 | 精简重写（不再有 legacy 的 `room-group` / `comp-group`）：`loadRoots`（`rooms()` → 按房号自然序，非 ready 折成 `unavailable` + 原因）、`filterText` 过滤、`ensureRoomTree`（`roomTree(refno)` 整树缓存 → 展平 → 勾选按父继承）、`ensureLeaves`（未内联的单元 / noun 组按选择器补 → `mergeTreeLeaves` 再展）、`setVisible` / `getCheckState`（勾选由子构件推导）、`selectByRowIndex`、`flyTo`、`isolateXray` / `clearXray`、`roomIdsOfRefno`、`reset` |
| `src/components/model-tree/RoomTreePanel.vue` | 未跟踪 | 搜索框（`room-tree-search`）+ 刷新 + 状态句 + 虚拟列表 `ModelTreeRow` + 右键菜单（聚焦飞行 / 隔离 / 取消隔离 / 显示 / 隐藏 / 加载模型（N 个构件，> 200 先确认）/ 查看属性）；`active` 为假时不拉数据 |
| `src/components/model-tree/ModelTreePanel.vue` | 未暂存 hunk（与另一会话的已暂存 hunk 混在同一文件） | PDMS / 房间 两页签（`model-tree-tabs` / `model-tree-tab-pdms` / `model-tree-tab-room`），两棵树 `v-show` 常驻；搜索 / 类型筛选 / 差异工具条 / 属性差异面板只在 PDMS 页 |
| `src/model-source/ports.ts` | 未暂存 hunk | `SpatialSource.roomTree(roomRefno, options?, only?)` + `SpatialRoomTreeOptions`（`margin` / `nouns` / `keyword` / `includeNegative` / `dbnums` / `specValues`） |
| `src/model-source/genModelV1/spatialSource.ts` (+ `.test.ts` +41 行) | 未暂存 | `roomTree()` 适配：404 →「还没有包围盒（从未生成过面板模型），先显示它再展开」、400 → 不在册 / 路径坏、422 → 房间体制不可用一句 |
| `src/api/genModelV1Api.ts` | 未暂存 hunk（同文件另有已暂存的版本对比 hunk） | `genModelV1SpatialRoomTree(room, request, only)`（L1791） |

**本轮验证**：`npx vitest run` 空间 6 文件 + 房间页签 2 文件 = **8 files / 128 passed**；`npm run type-check` 504 / 基线 539，**新增 0**（已消失 35）；`npx eslint` 8 个相关文件 **0**。
**没做的**：真机一次没跑（dev `:3111` 跑的就是工作树，页签在，但没人点过）；无 e2e；上位计划 §4.5 / §5 未改；教程 / CHANGELOG / CONTEXT 里没有「房间」页签一个字。

### 1.3 设计稿 R3 vs 实现（逐行对照 `RoomTreePanel.vue` / `ModelTreePanel.vue` diff）

**设计有 · 实现有** ✅：PDMS / 房间 两页签 + gen-model 徽标；搜索框「搜索房间号 / 名称（在册 N 间）」+ 刷新；状态句「在册 N 间房 · 展开一间房看 专业 → 最小交付单元 → 构件」；
`ModelTreeRow` 行（折叠 · 勾选三态 · 类型小标 · 名字带计数）；房间 → 专业 → 单元类型 → 单元 → 构件 + 其他构件；「跨 N 房」；未内联时展开再取（loader）；右键七项。

**设计有 · 实现没有或不一样** ⚠️（P3 的对象）：

| # | 设计稿 R3 | 实现现状 | 收口 |
|---|---|---|---|
| G1 | 房间根行「R432 · /1RX-RM04-R432 · 1298 个构件」——树取回前就有计数 | 计数要等 `roomTree` 取回（`count: null`）；`/spatial/rooms` 只给 `panel_count` | 不做（后端 `rooms[]` 不带成员数；要就是另一笔后端账）——只记 |
| G2 | 页签切换后保留上次页签 | `activeTab` 是组件内 `ref`，刷新回 PDMS | P3-a（拍板 D4） |
| G3 | 查看器 / 抽屉里选中一个构件，页签里自动展开到它 | `roomIdsOfRefno` 写了没接线；PDMS 树有这条（`useSelectionStore` → 展开定位） | P3-b（拍板 D5） |
| G4 | 房间行 title 里的「构件 N 个放置 > 上限 5000，按单元展开时再取」 | 已在 title；行上没有可见提示 | 不做——与抽屉树态口径一致（warning 一句），只记 |

**实现有 · 设计稿没画** 🆕：`unavailable` / `error` / `loading` 三种状态句；展开失败在树上方列一句原因（`room-tree-node-errors`）；「加载模型」> 200 个先确认。P2 文档写进去即可，设计稿不补。

## 2. 分期

### P0 · 把 PR-D 干净地提交（半天，不写新功能）

- **P0-a** 先核工作树里 PR-D 之外的改动都不是自己的：`ModelUnitVersionComparePanel*` / `GPUPicker*` / `ViewerPanel.vue` / `modelUnitVersionCompare*` / `nodeVersionTimeline` / `treeSource*` / `versionSource*` / `history.txt` /
  `docs/verification/model-version-compare-*` 全部属于版本对比那条会话（它的计划 `2026-09-21-node-version-view-design-sync-and-gap-closure-plan.md` §1.3 已认领），**一个 hunk 都不碰**。
- **P0-b** `git add` 五个未跟踪文件（`roomTreeNodes.ts` / `.test.ts`、`useRoomTree.ts` / `.test.ts`、`RoomTreePanel.vue`）+ `spatialSource.ts` / `.test.ts` 整文件；
  `git add -p` 只收：`ports.ts` 的 `roomTree` + `SpatialRoomTreeOptions` hunk、`genModelV1Api.ts` 的 `genModelV1SpatialRoomTree` hunk（同文件已暂存的版本对比 hunk 另一会话负责，**不 reset 它**）、
  `ModelTreePanel.vue` 的页签 hunk（同文件已暂存的无名构件短名 hunk 同上）。
- **P0-c** 一笔提交：`feat(model-tree): 「房间」页签——在册房间平铺 + 展开一间房吃 rooms/{refno}/tree 的房间层级树（ADR 0068，PR-D）`。**先 P1 真机再提交还是先提交再真机**——拍板 **D1**，推荐先真机（页签一次没点过，怕提交完立刻 fix）。
- 出口：`npx vitest run src/composables/useRoomTree.test.ts src/composables/roomTreeNodes.test.ts src/model-source/genModelV1/spatialSource.test.ts src/components/spatial-query src/composables/useSpatialQuery.test.ts` 全绿；
  `npm run type-check` 基线外 0；`npx eslint` 触及文件 0；`git show --stat HEAD` 只有上面列的文件。

### P1 · 真机 + e2e（1 天）

- **P1-a 真机**（dev `:3111` + `:8027`，页面 `?model_source=gen-model-v1&gm_backend_port=8027`）按上位计划 §6 第 5 步：模型树面板切「房间」→ 状态句「在册 215 间房」→ 搜 `R432` → 一条 →
  展开 → 五层（对照 `rooms/24381_35580/tree` 金样 `http/07-room-tree.json`：1298 / 专业 0 = 5、3 = 1293 / BRAN 28 单元 226 / EQUI 45 单元 1067）→ 展开一个 BRAN 单元出构件行 → 取消勾选一个已加载构件、场景里它消失 →
  右键单元「加载模型（N 个构件）」→ 加载并飞过去 → 「查看属性」属性面板切到它 → 搜索框清空、刷新按钮重拉。另两条：搜一个不存在的房号 →「没有匹配的房间」；对一间**从没生成过面板模型**的房展开 → 行下出「还没有包围盒…」一句
  （挑 `/spatial/rooms` 里 `panel_count` 最小的一间试，找不到就标未验）。
  截图 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/ui/room-tab-01…06.png` + `room-tab-summary.json`，README 追 **§8 模型树「房间」页签**。
  **不可验**（记进 README）：`room_membership=false` 的 `unavailable` 状态句——要另起一台关着开关的实例；本计划不起。
- **P1-b e2e**：拍板 **D2**——(a) 新建 `e2e/model-tree-room-tab-gen-model-v1.spec.ts`（推荐，页签与抽屉是两个面板、失败互不牵连）；(b) 追进 `spatial-query-gen-model-v1-ui.spec.ts`。
  三条用例：① 切页签 → `room-tree-status` 含「在册 N 间房」且 N = `GET /spatial/rooms` 的 `rooms.length`；搜 `R432` → 行数 1；② 展开 R432 → 各层行的计数与同机 `rooms/24381_35580/tree` 响应逐层相等（房间 / 专业 / 单元类型 / 前 3 个单元）；
  ③ 右键第一个单元「加载模型」→ 确认（若 > 200）→ 构件行勾选态变 checked、`viewer.scene.objects` 里出现该单元的 refno。helper 复用 `e2e/helpers/spatialQueryGenModelV1.ts` 的取数与等待。
  跑法与既有一致：`PLAYWRIGHT_PORT=3111 GEN_MODEL_V1_BASE_URL=http://127.0.0.1:8027 npx playwright test e2e/model-tree-room-tab-gen-model-v1.spec.ts --workers=1`。

### P2 · 文档三处 + CHANGELOG（半天）

- **P2-a** 上位计划 `2026-09-20-spatial-room-hierarchy-tree-plan.md`：§5 第 5 条 PR-D 从「待定」改「完成」+ 完成备注（sha、单测数、真机数）；§4.5 末「二选一等用户定」改成「已按新建落地（2026-09-21）」；顶部状态行同步。
- **P2-b** 教程 `docs/guides/SPATIAL_QUERY_TUTORIAL.md`：§6.1 末加一段「同一棵树的第二个入口：模型树「房间」页签」（怎么进、根是什么、展开一间房 = `rooms/{refno}/tree`、与抽屉树态的三点不同：不需要中心 / 半径、范围就是房间盒、勾选 = 场景显隐而不是「仅显示」）；
  §9 差别表加一行「模型树房间页签」；目录同步。拍板 **D3**：页签的用法写进空间查询教程（推荐，词条与 ADR 都在这条线）还是另起 `docs/guides/MODEL_TREE_ROOM_TAB.md`。
- **P2-c** `CHANGELOG.md`「未发布 / 变更」：**一条**覆盖 ADR 0068 全部（抽屉树态 + 结果区剪辑 + 「房间」页签，2026-09-20/21）——PR-C 时那文件被另一会话占着没加，现在补；格式照现有条目（粗标题 + 之前 / 现在 + 验证一行）。
- **P2-d** `CONTEXT.md`「房间层级树」词条末句「模型树的 ROOM 标签页在 v1 源下以它浏览一间房」改成「模型树的「房间」页签以它浏览一间房」（legacy 已退役，没有「v1 源下」这个限定了）。

### P3 · 设计稿 R3 对照的小缺口（半天，都要拍板）

- **P3-a（G2）页签记忆**：拍板 **D4**——(a) 不做；(b) `localStorage['plant3d.modelTree.activeTab']` 记上次页签（推荐：一行代码，PDMS 树其他持久化也在 localStorage）。
- **P3-b（G3）选中联动**：拍板 **D5**——(a) 不做；(b) 页签在前台时监听 `useSelectionStore` 的当前 refno：若该 refno 已在某间**已展开**的房下（`roomIdsOfRefno`），展开到它并选中、滚到可见；**不**为了它去拉没展开的房（那要先问 `roomsOf` 再拉整树，一次选中两发请求，不值）。推荐 (b)。
- **P3-c 外扩量**：`SpatialRoomTreeOptions.margin` 端口有了、界面没露。拍板 **D6**——(a) 不露（推荐：「房间里有什么」不该有半径；要「房间附近」去抽屉选房 + 半径）；(b) 状态句旁一个「外扩 N mm」小输入。
- **P3-d 设计稿导出**：拍板 **D7**——(a) 不导；(b) `Export` R1–R4 四帧 PNG 到 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/design/`，README §7 文件表加行（推荐：验证记录里能看图，不用开 pen.dev）。

## 3. 验证口径（每项都要）

- 单测：涉及文件全绿；`npm run type-check` 基线外 0 新增；`npx eslint` 触及文件 0。
- e2e：P1-b 那份在 `:3111` + `:8027` 上 `--workers=1` 全过；既有 `spatial-query-gen-model-v1-ui.spec.ts` 不回归（9 passed / 1 skipped）。
- 真机截图 + 请求账进 `docs/verification/spatial-room-hierarchy-tree-2026-09-20/`（README §8）；每条声称完成附「跑了什么、结果如何」；跑不了的标未验证 + 原因。
- 提交隔离：每笔 `git show --stat` 只含本计划列的文件；另一会话的已暂存 / 未暂存 hunk 原样留在工作树。

## 4. 明确不做

- 不做 legacy 的 `room-group` 那层、不做「房间分组」；不做 legacy 适配器（源已退役）。
- 不做没选房间的树、不做主归属 / 材料表口径（沿 ADR 0068 非目标）。
- 不改后端：`rooms[]` 不加成员数（G1）、不动 `leaf_cap`、不做「按库预算专业表」那条 100 m 退路（上位计划 §7 第一条，待另议）。
- 不验 `422 rooms_unavailable` 与落盘形态（要别的实例；09-20 记录里已标未验）。

## 5. 顺序建议

P1-a 真机（2 小时）→ P0 提交（D1 定后 1 小时）→ P2-a/b/c/d 文档（2 小时）→ P1-b e2e（半天）→ P3-a/b/c/d（D4–D7 定后半天）。全部 ≈ 2 天。

## 6. 要拍的决策

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| D1 | PR-D 代码何时提交 | 先真机再提交 / 先提交再真机 | 先真机（页签从没点过） |
| D2 | e2e 放哪 | 新建 `model-tree-room-tab-gen-model-v1.spec.ts` / 追进 spatial 那份 | 新建 |
| D3 | 页签用法文档放哪 | 空间查询教程 §6.1 追一段 + §9 一行 / 另起模型树房间页签指南 | 教程追一段 |
| D4 | 页签记忆 | 不做 / localStorage 记上次页签 | localStorage |
| D5 | 选中联动 | 不做 / 已展开的房内展开到选中构件（不拉新房） | 做，只在已展开的房内 |
| D6 | 房间盒外扩量露不露 | 不露 / 状态句旁小输入 | 不露 |
| D7 | 设计稿 PNG 导出 | 不导 / R1–R4 导进验证目录 | 导 |
