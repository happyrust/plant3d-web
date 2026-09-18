# 版本对比 · gen-model-v1 端到端复验（2026-09-18）

计划：`docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md` §5 A3 出口。
代码：plant3d-web `ec187960`（B + A1）、`961a3ea5`（A3）；gen-model-refactor `ef2284f12`（A2，ADR-081）。
后端：本机 `:8022` 15:32 换成 `d47d747fd` = `codex/model-projection-cache@7bcdd60df` + cherry-pick `ef2284f12`（见 `swap-record-d47d747fd.json`——
不能直接拿 gen-model-refactor 分支头，`:8022` 上别的会话在用的 surface-clearance 四条口径只在 model-projection-cache 那条线上）。
前端：dev `:3111`（别的会话起的 vite，工作树 = `961a3ea5` + 他们未提交的 clearance 文档），浏览器侧 `routeWebSocket` 掐掉 HMR 防中途整页刷新。
脚本：`old\.scratch\mvc-e2e-run.mjs`（Playwright headless chromium，一次性，不入库）。

## 1. 接口（curl 级）

| 请求 | 结果 |
|---|---|
| `GET /api/v1/model/versions?dbnum=8000&refno=24384/26480`（冷） | 200，2.35 s（服务端 2.20 s，release）；EQUI，latest 623；**11 版**：587 delivery → 9 × placement（589–602）→ 604 tombstone；与 09-15 证据文档「新建、挪、DELETE」一致 |
| 同一请求（`24384_26480` 写法） | 200，17 ms，`cached: true` |
| `refno=24384/1` | 404 `REFNO_NOT_FOUND` |
| `dbnum=7997&refno=24384/26480` | 400 `INVALID_REFNO` |
| `since_sesno=999999` | 404 `SESSION_NOT_FOUND` |
| `since_sesno=595&limit=2` | 200，`truncated: true`，`[596, 598]`（前端适配器据此连续拉） |

## 2. 浏览器端到端（两条场景）

入口 URL：`/?model_source=gen-model-v1&gm_backend_port=8022&unit_refno=24384_26480&compare_autorun=1[&compare_a=587&compare_b=602]`

| 检查点 | 场景 ① 缺省最近两版（602 → 604） | 场景 ② `compare_a=587&compare_b=602` |
|---|---|---|
| `compare_autorun` 打开面板（DockLayout） | ✅ | ✅ |
| 版本表（11 条，标签 `sesno · 时刻 · impact_kind`） | ✅ A=602 B=604 自动选中 | ✅ A=587 B=602 按 URL 选中 |
| 对比结果 | 新增 0 / **删除 1** / 修改 0（B 是 tombstone） | 新增 0 / 删除 0 / **修改 1**（BOX 24384/26481 被挪） |
| ViewerPanel（`__modelUnitVersionCompare`） | beforeObjects 1 / afterObjects 0；B 卡「该版本单元已删除」 | beforeObjects 1 / afterObjects 1 |
| 单视口切 A、双视口分屏 | ✅ 「左 A · sesno 602 · 右 B · sesno 604」 | ✅ 两个视口各一只盒子、位置不同（`a587-b602-04-split.png`） |
| 模型树差异模式（§1.4 桥接） | ✅ 「602 → 604 差异模式」，幽灵节点 `24384/26481（已删除）` | ✅ 「587 → 602 差异模式」，修改 1 |
| 关闭对比 | `DELETE /api/v1/model/history/{key}` × **1**（tombstone 侧没生成快照）；差异模式退出 | `DELETE` × **2**；差异模式退出 |
| 请求账 | versions 1 · generate 1 · tasks 1 · query 2 · DELETE 1 | versions 1 · generate 2 · tasks 2 · query 4 · DELETE 2 |
| pageerror | 0 | 0 |
| 控制台 error | 12 / 13 条，全是页面加载期 projects 404 / 401 与被掐掉的 vite websocket——与 11:54 swap 记录里同一批噪音 | 同 |

截图：`latest-two-0[1-5]-*.png`、`a587-b602-0[1-5]-*.png`；原始数据 `*-summary.json`。

## 3. 顺手看到的（不在本次范围）

- ~~幽灵节点回退挂在根上（「1 个变更未能定位到树」）~~ **15:5x 已补**：v1 适配器从 `history/query` 行的 `anc`（自身 → 顶层，打包 refno）拆出逐级
  直接属主表 `ModelVersionGeometry.ownerByRefno`，面板 `buildTreeDiffModels` 把被删节点的 `ownerRefno` 从 A 侧取、B 是 tombstone 时把单元根自己也作为
  deleted 模型给树。同一场景重跑（`ownerref/`）：差异模式「全部 2 / 删除 2」，SITE 1RX03-EQUI → ZONE 1RX03-CASE-DQ 各挂 2，不再有「未能定位」；
  legacy 侧只有 parquet 行的 `owner_refno`（尽力而为）。
- 右侧属性面板对已删除的 24384/26481 报 `not_found (404): dbnum 8000 会话 Some(623) 的索引里没有 24384/26481`——选中幽灵节点后按最新会话读属性，本就读不到；
  底部「属性差异暂不可用 · 锚点缺失（HTTP 404）」是 `ModelTreeAttrDiffPanel` 钉在 legacy `/api/model-history/*`（`:3100` 未起），Q7(ii) 已定不在本计划
  ——**17:5x 追记**：该面板与 `modelHistoryApi` 已随 legacy 版本链一起删（Q25），差异模式下不再出现这块；「属性历史对比」记成 gen-model-refactor 候选需求（ADR-081 实施记录）。
- `environmentLoadedRefnos: 0`：入口 URL 没带 `show_refno`，视口本来就是空的，「最新环境模型」按 Q12 = 已加载模型 = 空；不是缺陷。

## 4. legacy 链退役后的复验（17:1x，plan §7.3）

- `legacy-retired/legacy-model-source-retired-notice.png`：`?model_source=legacy&unit_refno=24384_26480&compare_autorun=1` 打开面板，
  一进来就是「legacy 数据源的版本对比已退役：去掉 ?model_source=legacy（或改为 model_source=gen-model-v1）后再打开版本对比」，
  没有版本下拉、没有请求 legacy 库元数据、`pageerror` 0（§7.3 第 4 条）。
- 同一台 `:8022`（`d47d747fd`）+ dev `:3111`：`e2e/model-version-compare-gen-model-v1.spec.ts` 3 过（12.3 s）——删掉 legacy 链后 v1 链一处没动。

## 5. 属性历史对比·前端半边（18:2x，后端 `tool=attributes` 未落地 → 20:31 落地，真机见 §5.1）

- `attr-diff/attr-diff-panel-backend-pending.png`：587→602 对比进差异模式后，模型树底部挂出「属性历史对比 · 24384_26481 · 改」，
  两侧请求已按契约发出——`POST /api/v1/model/history/query {"snapshot_key":"24384_26480@587","tool":"attributes","arguments":{"refno":"24384/26481"}}`
  与 `@602` 一条；服务端（`d47d747fd`）还不认这个 tool，回 `unknown historical query tool "attributes"; expected snapshot/instances/tubes/geometry`，
  面板照契约给「属性历史对比暂不可用 + 原因」，pageerror 0。后端落地后这块不用再改，直接出表。
- `attr-diff/attr-diff-locate.png`：面板上「在 3D 中定位」——先把相机挪到 (53279, 62579, 58750)，点按钮后 1.2 s 相机回到 (686, 3581, 5547)
  （该 BOX 在 A / B 隔离图层里的包围盒），三维查看器面板被激活，pageerror 0。

### 5.1 后端落地后的真机（20:3x–22:1x，`attr-diff/live-8026/`）

后端：gen-model-refactor `6a76eefb4`（20:19，代提 `element_attributes.rs`）→ `2f891b370`（20:31，`tool=attributes` 落地：按快照回执的
`(source_file, sesno)` 开会话钉死、走同一个属性渲染器）；跑在 **`:8026`**（build `0.1.27+g2f891b370`）。前端 dev `:3111`（本仓工作树）。
跑法 `old/.scratch/attr-diff-live.mjs --backend 8026 --unit … --a … --b …`：进对比 → 点树里第一条带徽章的行 → 读底部「属性历史对比」面板。

| 场景 | 事实 |
|---|---|
| **正例** 573→626（BRAN 24384_23257，FTUB 24384_23262 抬高 500） | 对比「修改 1 / 未变 8」；点 `FTUB 改` 行 → 面板 **「变更 2 / 68」**：`POS 10887, 12332, 2900 → 3400`、`SPAMAP 1400029000, -2147483647 → 1400034000, -2147483647`；「显示未变」68 行；两条 `tool=attributes` 请求 `@573` / `@626` 都 200（FTUB 68 行，4–5 ms）；pageerror 0（`a573-b626-attr-diff-*`） |
| **反例** 602→604（EQUI 24384_26480 → 604 tombstone；BOX 24384/26481 被删）**第一次（20:40）没过** | 对比「删除 1 / 其余 0」、树「602 → 604 差异模式 · 全部 2 · 删除 2」，但 **树里一行带 `data-diff-status` 的都看不见**：SITE / ZONE 各挂着「2」，ZONE 收着；脚本等 60 s 超时（`a602-b604-attr-diff-99-failure.png` 留作修前对照）。 |
| 原因 | `useTreeVersionDiff.resolvePaths` 对被删节点只 `expandPathToNode(ownerRefno)`——把路径展开**到**挂载点，挂载点自己不展开；而 `buildResult` 只在 `expandedIds` 含挂载点时才插幽灵行 → 幽灵行永远藏在收着的 ZONE 下面，要用户手点。另外 BOX 的 `ownerRefno` 是同批被删的 EQUI，拿它去后端查祖先只会 404。修改类节点没这个问题（目标就是它自己，路径展开完它就可见），所以 §6 的 BRAN 正例从没暴露。 |
| 修法（本次提交） | `usePdmsOwnerTree.expandPathToNode(refno, { expandSelf })`：连目标自己也展开并加载子节点；`resolvePaths` 对被删节点沿 `ownerRefno` 链跳过同批被删、且不在树中的原父，落到最近可能存活的祖先（与 `resolveGhostOwner` 同一条链），带 `expandSelf` 去解析；同一节点既是修改行又是挂载点时取「展开」。 |
| **反例 修后（22:09）** | ZONE 1RX03-CASE-DQ 自动展开，下面两条幽灵行 `24384/26481 (已删除) 删`、`24384/26480 (已删除) 删`；点第一条 → 面板 **「变更 28 / 28」+ 横幅「该构件在版本 B 不存在（已删除）」**，B 列全 `—`，「显示未变」仍 28 行；只发了 `@602` 一条请求（BOX 28 行，7 ms）——B 是 tombstone 没句柄，适配器直接给 `exists:false` 不打后端；pageerror 0（`a602-b604-attr-diff-changed-only.png` / `-with-unchanged.png` / `-summary.json`） |
| 回归 | 修后重跑正例 573→626：同样「变更 2 / 68」、68 行、pageerror 0（`a573-b626-*` 为修后那次） |
| 测试 | vitest `ModelTreePanel.versionDiff.test.ts` **11 过**（新增「整单元被删：挂载点沿链落到最近存活祖先并被自己展开，幽灵行随之可见」；原「路径解析目标」用例改成 5 个目标 + `expandSelf` 标记）；e2e 第 1 条新增断言「解析完成后至少一条带徽章的行可见；tombstone 时至少一条幽灵行可见」——`GEN_MODEL_V1_BASE_URL=http://127.0.0.1:8026 PLAYWRIGHT_PORT=3111`：缺省单元 24384_26480（末两版 602→604）**3 过**（12.9 s）、`MODEL_VERSION_E2E_UNIT=24384_23257` **3 过**（13.2 s） |

~~顺手看到（未动）：点幽灵行时右侧常规「属性」面板也去拉当前会话的属性，红条「not_found (404): dbnum 8000 会话 Some(636) 的索引里没有 24384/26481」——
被删构件在当前会话本来就不在，属于该面板对 ghost 行的处理口径，与属性历史对比无关。~~ **22:3x 已收（用户拍板）**，见 §5.2。

### 5.2 幽灵行进右侧「属性」面板：不拉当前会话，给「该构件已删除，属性见底部属性历史对比」（22:3x）

| 项 | 事实 |
|---|---|
| 红条从哪来 | 两条路都把被删 refno 写进全局选中：`applyTreeDiffContext` 进差异模式时把**第一条变更**设为选中（tombstone 单元里第一条就是被删的 BOX）；以及点幽灵行。`useSelectionStore` 的 `useQuery` 见到 refno 就发 `POST element/attributes` → 当前会话里没有它 → 404 → 面板按错误渲染。 |
| 修法 | `useSelectionStore`：新增「已删除」登记 `selectedIsDeleted`（`setSelectedDeletedRefno` / `setGlobalSelectedDeletedRefno`），登记时查询 `enabled=false`、`propertiesData / fullName / refFullNames / diagnostics / error` 一律按无数据（同一 key 上可能还留着上次正常选中缓存的 404），任何一次正常选中复位。`PropertiesPanel` 最前面加分支 `data-testid="properties-deleted-notice"`：「该构件已删除，属性见底部属性历史对比」（中性底色，不是错误）。`ModelTreePanel`：幽灵行点击与差异上下文首条为幽灵时走 `selectDeletedRefno`（置 `internalTreeSelection`，树内不再去后端定位）；退出差异模式（`exitDiffMode` / 上下文置空）时已删除登记的选中一起清掉。 |
| 真机 602→604（`a602-b604-properties-panel-*`，`old/.scratch/attr-deleted-notice-live.mjs`） | 进差异模式即显示提示（首条 = 被删 BOX 24384/26481），**`element/attributes` 请求 0 条**；点幽灵行仍是提示、无 `not_found`；关闭对比 → 提示消失；全程 `element/attributes` 0 条，pageerror 0 |
| 真机 573→626 对照（`a573-b626-properties-panel-*`） | 首条是修改的 FTUB：`element/attributes {refno: 24384/23262}` 200 一条、无提示；点行 / 关闭同样无提示 |
| 测试 | 新增 `PropertiesPanel.deleted.test.ts` 2 条（挂真 `VueQueryPlugin`、mock `@/model-source`）：已删除登记不发查询 / 给提示 / 正常选中复位；同一 refno 缓存过 404 再按幽灵登记不漏红条。全仓 **346 文件 / 3084 用例过**；e2e 两单元各 3 过。 |

## 6. BRAN 增量更新 → 版本对比（19:3x，`bran-ftub-move/`）

用户 18:37「测试一个 BRAN 的增量更新，然后通过在 plant3d-web 里通过模型对比来查看」。这次不再是 EQUI 夹具，而是一条真正的管线支管，
从 E3D 改动到前端看见差异整条链走一遍；数字见 `bran-ftub-move/api-evidence.json`。

| 环节 | 事实 |
|---|---|
| E3D 改动 | `gen-model-refactor/scripts/e3d/db8000_bran_ftub_move_apply.mac`（19:31:48 写 log）：FTUBE 4 of BRANCH `/C-OR-1R345-C` = **24384/23262** `POS … U 2900mm → U 3400mm`（+500），一次 SAVEWORK；`ams8000_0001` mtime 19:31:53 |
| `:8022` 增量（`d47d747fd`，自动 `[watch]`） | task `db-20260918-193207-000027`：dbnum 8000 sesno **626..=627**，修改 3；交付单元重生成 1 = 根 **24384/23257**（BRAN `/C-OR-1R345-C`）；模型发布 write-behind；总耗时 461 ms，19:32:09 完成——SAVEWORK 后 **16 s** 模型就换好了 |
| `GET model/versions?dbnum=8000&refno=24384/23257` | BRAN，latest 627，**56 版**，末尾 `571 mesh · 573 mesh（09-13 restore）· 626 mesh（09-18 19:31）`；627 没碰它、不列 |
| `POST model/records {generation_root: 24384/23257}` | 9 条，`durable: true`；24384_23262 `world_aabb` z **3400.0 ~ 3430.0**、translation (10887, 12332, **3400**)——位移真的传播到模型记录 |
| 两份快照 `history/query tool=instances`（@573 / @626） | 各 9 行；只有 24384_23262 不同：translation z 2900 → 3400、bounds z [2900,2930] → [3400,3430]，**mesh_id 相同**（纯位移）；其余 8 行 translation / bounds / mesh_id 全同 |
| 浏览器（dev `:3111` = `381ca5c2`，入口 `unit_refno=24384_23257&compare_autorun=1`） | 面板自动开、56 版全列、A=573 B=626 自动选中；结果 **新增 0 / 删除 0 / 修改 1 / 未变 8**，修改行 `24384_23262 FTUB`；A/B 各 9 对象；分屏「左 A · sesno 573 · 右 B · sesno 626」；树差异「573 → 626」沿 SITE 1RX03-EQUI → ZONE 1RX03-LCT → PIPE 1RX-345 → BRAN C-OR-1R345-C 挂到 FTUB（标「改」）；关闭 DELETE × 2；pageerror 0（`latest-two-0[1-5]-*.png`、`latest-two-summary.json`） |
| e2e | `MODEL_VERSION_E2E_UNIT=24384_23257 PLAYWRIGHT_PORT=3111 npx playwright test e2e/model-version-compare-gen-model-v1.spec.ts --workers=1` → **3 passed**（9.2 s）——用例按回执自适应，换成 56 版的 BRAN 一处没改 |

顺手看到：
- 626 的 `impact_kind` 是 `mesh` 而不是 `placement`：FTUB 的 `POS` 变更被 `classify_operation_impact` 判成 Regen（它的几何要重新烘），
  但烘出来内容寻址同一个 `mesh_id`。对比展示按几何签名走、结果照样是「修改」，只是版本表标签比实际保守一档；要不要把 FTUB 的纯 POS 变更归到
  `placement`，是 gen-model-refactor 那边分类器的事，不在本计划。
- ~~底部「属性历史对比 · 24384_23262 · 改」仍是「暂不可用 · unknown historical query tool "attributes"」——后端 `tool=attributes` 还没落地
  （§5 那条 blocker 未解：`element_attributes.rs` 仍未提交）~~ **20:31 后端落地（`2f891b370`），22:0x 同一入口对 `:8026` 给「变更 2 / 68」（POS / SPAMAP），见 §5.1。**
- ~~这轮测试对库的净变更还没归零：`db8000_bran_ftub_move_restore.mac`（放回 U 2900）没跑~~ **19:50 已跑**（用户拍板），见下表。

### 6.1 restore 腿：净变更归零（19:50）

| 环节 | 事实 |
|---|---|
| E3D | `l3_suite --check-driver scripts/e3d/db8000_bran_ftub_move_restore.mac`（`L3_ALLOW_EXISTING_E3D_SESSION=1`，单用途 TTY 会话 11 s）：`U 3400 → 2900`，一次 SAVEWORK；`check-driver-evidence.json` outcome completed，before 629 → after 631 |
| `:8022` 增量 | `[watch]` 628..=630（含别的会话同时段新增的 EQUI 24384/24776）→ 重生成 2 根含 **24384/23257**，825 ms；631 单独一批（修改 1、无模型工作） |
| `model/versions` | 57 版，末尾 `626 mesh（19:31）· 630 mesh（19:50）`；每次 SAVEWORK 长两个会话号、改动都在前一个 |
| `model/records` | 24384_23262 `world_aabb` z 回到 **2900 ~ 2930**、translation (10887, 12332, 2900)，`durable: true` |
| 对比 626 → 630（`a626-b630-*`） | **修改 1 / 未变 8**（FTUB 回落），A/B 各 9 对象，树差异「626 → 630」，关闭 DELETE × 2 |
| 对比 573 → 630（`a573-b630-*`） | **新增 0 / 删除 0 / 修改 0 / 未变 9 · 「无几何差异」**，不进差异模式（没有非 unchanged 行），关闭 DELETE × 2，pageerror 0 |

结论：相对测试前的基线 573，库的净几何变更为零；apply / restore 两腿各自都被「增量 → 版本表 → 对比面板」如实反映。
