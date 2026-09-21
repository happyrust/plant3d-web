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

### 5.3 「新增」场景：A 侧不存在的横幅（22:5x，修前证据 `a618-b628-added-before-fix-*`）

用户点名「587→602 的 CYLI 24384/26483」——那个 CYLI 只在 `modelUnitVersionCompare.test.ts` 的夹具里；真库里 EQUI 24384/26480 从 587 到 602 十个版本
`instances` 都只有 BOX 24384_26481 一条（587→602 = 修改 1 / 其余 0，10 份快照查完即删）。真库里的「新增」在另一条会话第 2 轮留下的
**EQUI `/1-LNR-Q005-PJ` = 24384/24776**：19:49 `A-add-box.mac` 建 BOX `/CODEX_DB8000_EQ_ADD_BOX` = **24384/26495**（sesno 628），19:50 `B-del-box.mac` 又删了（632）。

| 项 | 事实 |
|---|---|
| 对比 618→628 | **新增 1 / 删除 0 / 修改 0 / 未变 1**，A 1 对象 / B 2 对象 |
| 属性历史对比面板（缺省对准第一条变更 24384_26495「增」） | **横幅「该构件在版本 A 不存在（新建于 A 之后）」**，「变更 29 / 29」，A 列全 `—`、B 列 BOX 的 29 行（`XLEN 500 / YLEN 400 / ZLEN 300` 等）；「显示未变」29 行；`@618` 回 `exists:false`（0 行，4 ms）、`@628` BOX 29 行（3 ms），两条都 200；pageerror 0 |
| **顺手撞到的缺口 ①（树）** | 该 BOX 在 628 新增、632 又被删，**当前会话（636）里已不在**：`expandPathToNode(24384_26495)` 查祖先 404 → 定位不到 → 「1 个变更未能定位到树（已计入统计）」，**树里一行都没有**（`treeRowCount 0`，连祖先都不列）。差异模式的树是「当前树 + 幽灵行」，只有 `deleted` 才走幽灵；「B 版有、当前没有」的新增 / 修改行没有落点。 |
| **顺手撞到的缺口 ②（右侧属性面板）** | 首条变更 24384_26495 进全局选中 → `element/attributes` 404 → 红条「not_found (404): … 会话 Some(636) 的索引里没有 24384/26495」。§5.2 的「已删除」登记只认 `status=deleted` 的幽灵，这条是 `added`，没兜住。 |

两个缺口同一个根：**变更集里的构件不一定还在当前会话**（B 版之后又被删了）。**2026-09-19 10:1x 已修（用户拍板），见 §5.4**；
上面这一栏的修前形态留在 `a618-b628-added-before-fix-*`（`treeRowCount 0`、`unplacedHint「1 个变更未能定位到树」`）。

### 5.4 B 版之后又被删的构件：幽灵行保留「增 / 改」徽章 + 行尾「当前已不在」（2026-09-19 10:1x）

| 项 | 事实 |
|---|---|
| 修法（树） | `useTreeVersionDiff.resolvePaths` 改成**每条变更一份解析计划**：非删除的先试它自己（只要路径可见），查不到再沿 `ownerRefno` 链逐级试幽灵挂载点（挂载点必须 `expandSelf`，`buildResult` 才插幽灵行），第一个成功的祖先为准。「自己查不到」= 它在 B 版之后又被删了 → 记进 `unresolved`，`buildResult` 里和被删构件走同一条幽灵分支；徽章按 `model.status` 给（不再写死 `deleted`）。**解析没落定之前不算数**，仍记「未定位」，免得只是还没加载就先闪一行「当前已不在」。 |
| 修法（行文案） | `ModelTreeRow`：`ghost && diffStatus !== 'deleted'` → 行尾 `(当前已不在)`（title 说明「B 版里还在、当前模型里已不在」），被删的仍是 `(已删除)`。 |
| 修法（右侧属性面板） | 幽灵行点击本来就按 `row.ghost` 走 `selectDeletedRefno`，天然覆盖新增 / 修改的幽灵；要补的是**首条选中的时机**——`treeDiff.apply` 改为返回路径解析的 promise，`applyTreeDiffContext` 对「不是删除、当前树里又还没有」的首条**等解析落定再决定**走哪条登记（期间用户换了选中 / 退出差异模式就不再回写），被删的首条仍同步登记、不必等。 |
| 真机 618→628（`a618-b628-added-attr-diff-*`，`old/.scratch/attr-diff-live.mjs --status added`） | 树里出现 `SITE 1RX03-EQUI → ZONE 1RX03-CASE-DQ → EQUI 1-LNR-Q005-PJ → 24384/26495 (当前已不在) 增`，**`treeRowCount 5`（修前 0）、`unplacedHint null`**；点它 → 面板仍「变更 29 / 29」+ 横幅「该构件在版本 A 不存在（新建于 A 之后）」，`@618 exists:false`（5 ms）/ `@628` BOX 29 行（7 ms）两条 200；pageerror 0 |
| 真机 618→628 属性面板（`a618-b628-properties-panel-*`，`attr-deleted-notice-live.mjs`） | 进差异模式即「该构件已删除，属性见底部属性历史对比」（首条就是这条 `added` 幽灵，`data-ghost=true`），点它仍是提示、无 `not_found`；关闭对比 → 提示消失；**全程 `element/attributes` 0 条**，pageerror 0 |
| 回归 602→604（删除） | 幽灵行仍 `24384/26481 (已删除) 删`、`treeRowCount 5`、横幅「该构件在版本 B 不存在（已删除）」、变更 28 / 28、`element/attributes` 0 条、pageerror 0 |
| 回归 573→626（修改，正常行） | `FTUB 改`、变更 2 / 68、68 行；属性面板**照常发 `element/attributes {24384/23262}` 200 一条、无提示**——等解析落定再登记没有把正常行也拖成幽灵；pageerror 0 |
| 幽灵构件的「在 3D 中定位」（10:5x，`old/.scratch/attr-locate-live.mjs`，`*-locate-*`） | `focusModelUnitVersionCompare` 是把 A / B 两个隔离图层的包围盒**并起来**找的，找不到就直接 return（相机纹丝不动）——所以「相机动没动」就是「找没找到」的精确信号。三条都把相机先停到 (53279, 62579, 58750) 再点按钮：**新增幽灵**（只在 B 层有）镜头故意切到 A 侧 → 飞到 target (−2821.3, 8004, 1400)，位移 96816.5；**删除幽灵**（只在 A 层有，B 是 tombstone `afterObjects 0`）镜头故意切到 B 侧 → 飞到 target (−2821.3, 8004, 3900)，位移 95340.2；**正常修改行**（FTUB，非幽灵）→ 飞到 (11059.6, 12165.3, 3165)。pageerror 0 |
| 顺手撞到并一起收掉 | 第一次跑「新增幽灵」时红条回来了：`ViewerPanel.focusModelUnitVersionCompare` 里 `selectionStore.setSelectedRefno(normalized)` 把 §5.2 的「已删除」登记又换成了普通选中 → `element/attributes {24384/26495}` 404、提示消失。加一道判断：当前选中已经是这个 refno 且是「已删除」登记时不覆盖。修后三条里两条幽灵**全程 `element/attributes` 0 条**、提示一直在，正常行不受影响 |
| 测试 | `ModelTreePanel.versionDiff.test.ts` **13 过**（新增「新增的构件在 B 版之后又被删：解析不到自己 → 挂最近存活祖先的幽灵行，徽章仍是「增」」与「连原父都定位不到 → 回退挂根 + `ghostUnplaced`」；原两条的 `resolveTotal` 从「唯一目标数」改成「变更条数」5→6 / 1→2）；`vue-tsc` / eslint 触及文件 0 错 |
| e2e 护栏（11:0x） | `model-version-compare-gen-model-v1.spec.ts` 新增第 4 条「B 版之后又被删的构件」：幽灵行 `[data-diff-status=added][data-ghost=true]` 可见且含「当前已不在」、无「未能定位」、点它给 `properties-deleted-notice` 且 `element/attributes` **一条都没有**、停好相机后点「在 3D 中定位」相机必须飞离停放点（找不到时 `focusModelUnitVersionCompare` 直接 return、相机不动）、飞完提示仍在且请求仍是 0。夹具（`24384_24776` 618→628）不在就整条跳过，可用 `MODEL_VERSION_E2E_GHOST_UNIT/_A/_B` 换。第 1 条的 tombstone 分支也补上「行尾『已删除』+ 提示 + 定位飞得动」。**`:8026` 4 过（13.6 s）、`:8033` 4 过（54.0 s）、`:8026` + `MODEL_VERSION_E2E_UNIT=24384_23257` 4 过（13.2 s）** |

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

## 7. 节点版本视图（ADR 0066）页面级真机 + `:8022` 换成带新路由的 release 构建（2026-09-19 10:5x–11:1x，`node-version-view/`）

前置：`:8022` 自昨晚 20:1x 起没在听（`d47d747fd` 与它连的 SurrealDB `:8009` 一并停了，那台 rocksdb 库的数据目录在盘上找不到）；
用户 10:2x 拍板「换成带新路由的 release 构建（先确认没人在用），然后在页面上真机走一遍节点版本面板」。

| 环节 | 事实 |
|---|---|
| 构建 | gen-model-refactor **`a382b2cf3`**（10:39，`node/versions` 那一笔）→ `git worktree add --detach .scratch\wt-nv-a382b2cf3` → `cargo build --release --features http_api --bin aios-database`（5 m 13 s，含等别的会话的 build 锁）→ 拷到 `_runs\review-full-8031\aios-database-a382b2cf3.exe` |
| 启动 | cwd `_runs\node-versions-8022\`（`DbOption.toml` 抄自 `gen-model-model-cache` 仓库根：`http_api_addr 0.0.0.0:8022`、`watch_dbnums [7998, 8000]`、`startup_autorun = true`、`e3d31`），`serve`，非提权 `Start-Process`，env `AIOS_STORE_MODE=mem RUST_MIN_STACK=134217728 AIOS_OPEN_BROWSER=0 AIOS_RESTART_HANDOFF=1 RUST_BACKTRACE=1`，日志 `stdout.log / stderr.log`，pid `gm-8022-a382b2cf3.pid`；10:55:00 起，**2 s** 后 `/health` ok，`build_id 0.1.27+ga382b2cf3ace.1789785740`（干净、非 dirty），`medium: mem / durable: false`——**内存库：重启即重建，`:8022` 上没有任何东西是持久的**（`8022-swap-2026-09-19-a382b2cf3.json`） |
| 后端四条路由 curl | `node/versions` SITE 24384/22399 subtree 冷算 **3.45 s**（639 会话 / 47,522 候选 / 3,786 在范围 / 640 个会话集），`since_sesno=618` 命中缓存 **20 ms** → 626 / 628 / 630 / 632 各「单元 1」；BRAN 24384/23257 subtree **57 行与 `model/versions` 逐行同序同档**（2.4 s vs 6.6 s）；FTUB 24384/23262 self **53 行与 `element/versions` 左列一致**；ZONE 24384/22400 subtree 198 行 / self 5 行；`scope=bogus` 400、不存在 refno 404、dbnum 不符 400、`since_sesno` 不在链上 404。`attribute-history` / `diff-summary` / `element/versions` 同机 200 |
| 页面（dev `:3111` + `:8022`，`e2e/node-version-view-gen-model-v1.spec.ts`，`--workers=1`） | **2 passed（23 s）**，pageerror 0。**叶子 FTUB 24384_23262**（`leaf-*`）：`unit_refno=…&compare_autorun=1` 开面板；叶子没成员 → 缺省「仅自身」、「所有子节点」置灰；时间线「本范围 53 版」，行上 `dpc · CODEX db8000 FTUBE 4 … · 属性 2 · 本构件 mesh`；缺省 A=626 B=630 自动装所属单元 BRAN 24384_23257 → **修改 1 / 未变 8**；属性对比 tab **`A 626 → B 630 · 2 项变化`：POS `10887, 12332, 3400 → …2900`、SPAMAP `1400034000 → 1400029000`**。**容器 SITE 24384_22399**（`container-*`）：提示「子树时间线 **298** 版来自 node/versions」、手填会话号那一栏不再露出、自动跑不再报「没有几何」；缺省「仅自身」在范围 3 版（node/versions self 2 版 ∪ attribute-history 的 sesno 10：两个 UDA 被设值，模型口径不算变化）；切「所有子节点」→ 299 版全在范围、动过几何的行带「单元 n」（sesno 5 「单元 521」）；点行选 A=630 B=632 → 属性对比 tab「有变的构件 2 个」（EQUI 24384_24776 修改 · mesh、BOX 24384_26495 删除 · tombstone），点开 EQUI 拉它自己的时间线；模型对比 tab 差异摘要「变了的单元 1 / 未变 525 / 删除 1 / 修改 1」、容器自己的「在三维中对比」禁用、分组只有 EQUI 一组 → 点它 → **`24384_24776 · 删除 1 / 未变 1`**，树进 630 → 632 差异模式、幽灵行 `24384/26495（已删除）`、底部属性历史对比「该构件在版本 B 不存在」 |
| 入口之三 | 右侧「属性」面板标题栏多了「历史」按钮（选中谁查谁，见 `leaf-model-compare.png` 右上角）；点击走 `requestModelVersionInspect + ensurePanelAndActivate('modelVersionCompare')`，单测 2 条，页面级没单独点（选中要先在树 / 三维里点对象） |

顺手看到：
- ~~`node/versions` / `element/versions` 的「自身那一列」按模型口径（`diff_ele_data`）算，**只设 UDA 的会话不成一行**（SITE 24384/22399 的 sesno 10：`UDA:2902d6e2 = JS`、`UDA:2902d6e3 = PIPERB`），`attribute-history` 却列它——面板按并集列，所以「仅自身」多出一行 `属性 2 · noop`，前端「本范围 n 版」的数字 ≠ 任一条回执的行数。~~ **11:4x 用户拍板改面板**：两条路由口径不动（一条问「模型变没变」、一条问「改了什么」），面板把只在属性时间线里的会话标 **「仅属性」**、不计入版数——标题「本范围 2 版 · 仅属性 1」（`container-self-timeline.png`），2 = `node/versions?scope=self` 行数；切「所有子节点」= 「本范围 298 版 · 仅属性 1」，298 = subtree 行数。e2e 断言两个数各自与回执对得上，2 passed。
- `:8022` 现在是内存库：`dbnum_consistency.judged = 0`（模型按需懒生成），`history/generate` 与四条版本路由都不依赖它；别的会话若要 `model/records` 里的持久模型（校审 / 净距那些），得先 `dbnums/8000/model/ensure` 或把 `:8009` 那台 rocksdb 库找回来再换 `AIOS_STORE_MODE=rocksdb` 重起。
- **13:47:32 `:8022`（pid 56280）随上一会话的终端一起没了**：`stdout.log` 最后一行 13:47:32 的增量检测、没有任何退出日志；同一时刻全部会话在交接（13:46 批量导出），`Start-Process` 起的子进程跟终端的 Job 一起被收——昨晚 20:12 `d47d747fd` 那次多半也是这么没的（`:3111` 的 vite 是用户自己 cmd 里起的，所以活着）。13:50:04 接班会话用同一 exe / cwd / env 重起，**改走 `Win32_Process.Create`（父进程 WmiPrvSE，不挂在任何终端下）**，pid 84280，2 s 后 health ok（内存库、重启即重建，缓存全冷）；五条路由 200，e2e 2 passed（11.9 s）。第一段日志挪到 `stdout.run1-1055-1347.log`，`8022-swap-2026-09-19-a382b2cf3.json` 追了 `restarts[0]`。

## 8. 三维按差异着色 + 单视口角标 + 「三维只看差异」（2026-09-21 00:1x，`3d-diff-color/`，plan §11）

用户 20:36 拍板 A（ADR 0066「三维联动」的落地）。前置：`:8022` 已由别的会话重起（pid 31780，`0.1.27+ga382b2cf3`，内存库），无需再起；dev `:3111`（本仓工作树）。
脚本：`old\.scratch\mvc-3d-diff-color-run.mjs`（Playwright headless chromium，一次性，不入库；`routeWebSocket` 掐掉 HMR）。
入口：`/?model_source=gen-model-v1&gm_backend_port=8022&unit_refno=24384_23257&compare_autorun=1&compare_a=626&compare_b=630`（§6.1 那例：FTUB 24384_23262 U 3400 → 2900，**修改 1 / 未变 8**）。

| 步 | 截图 | 事实 |
|---|---|---|
| 对比就位（单视口缺省 B） | `a626-b630-01-single-b-colored.png` | 整根 BRAN 石板灰、只有 FTUB 那一段琥珀；左上角标 **「B · sesno 630」**（绿），下一行只读图例 **「修改 1 新增 0 删除 0 未变 8」**；`__modelUnitVersionCompare`：A/B 各 9 对象、`statusCounts {modified 1, unchanged 8}`、`hiddenWhenDiffOnly {before 8, after 8}`、`diffOnly false` |
| 点列表修改行定位 | `a626-b630-02-single-b-focus-modified.png` | 飞到 FTUB：琥珀那段贴着灰管；面板「三维查看」节 A / B 卡下多了「三维只看差异」勾选（未勾） |
| 面板勾「三维只看差异」 | `a626-b630-03-single-b-diff-only.png` | 视口只剩那根琥珀 FTUB；运行态 `diffOnly true`，视口图例多出 **「只看差异 · 未变已藏」** 标签（`data-diff-only="true"`），面板勾选按回传的运行态勾上 |
| 切 A | `a626-b630-04-single-a-diff-only.png` | 角标变 **「A · sesno 626」**（蓝），仍只剩 FTUB（A 那版的位置） |
| 双视口分屏 | `a626-b630-05-split-diff-only.png` | 左右两枚角标「A · sesno 626」「B · sesno 630」照旧 + 图例（带标签）；两侧各只剩 FTUB，**左高右低 = 那 500 mm**——两版不叠加、各在各的设计坐标 |
| 面板取消勾选 | `a626-b630-06-split-all.png` | 两侧整单元回来（未变灰、FTUB 琥珀），图例标签撤掉（`data-diff-only="false"`、标签计数 0） |
| 退出 | `a626-b630-07-closed.png` | 角标 / 图例撤掉（两种 overlay 计数 0），`__modelUnitVersionCompare` 回 null |

pageerror **0**；console error 5 条全是环境噪音（vite HMR websocket 被脚本掐掉 1 条、`/files/*` 503 4 条，与从前各轮相同）。`a626-b630-3d-diff-color-summary.json` 有每步的文本与运行态。

**开关为什么不放视口里**：第一版在图例里放了勾选框，e2e 缺省 1280×720 下视口只有三百来像素宽，`.dtx-viewport-gizmo`（右上 100px，z 1000）和左侧竖排工具栏（`left-3 top-1/2`，z 940）
先后把它盖住——Playwright `click` 一直 `intercepts pointer events` 重试到超时（第 1 条 5.4 min 才红）。视口里那两样都吃指针，可点的东西不该挤在它们中间；改成只读标签、开关只留面板「三维查看」节（A / B、单视口 / 分屏都在那儿），角标 / 图例限宽 `calc(100% - 8.5rem)` 让窄视口换行。

e2e `e2e/model-version-compare-gen-model-v1.spec.ts` 第 1 条加角标 / 图例 / 开关断言（缺省 B 角标、切 A 角标、分屏两枚角标且单视口角标计数 0、图例四格 = 摘要四格、有差异时开关开 / 关 → 运行态 `diffOnly` + 图例 `data-diff-only` + 标签有 / 无；无差异时置灰）：
`PLAYWRIGHT_PORT=3111` 缺省单元 `24384_26480`（末版 tombstone）**4 passed（19.2 s）**；`MODEL_VERSION_E2E_UNIT=24384_23257`（修改 1）**4 passed（12.5 s）**。

单测：`modelUnitVersionCompare.test.ts` 10 过（+2：`applyModelUnitVersionSide` 带 hidden 只写显示那一侧 / 四态计划 + 计数 + 色值）、`ModelUnitVersionComparePanel.test.ts` 16 过（+1：勾选派发 `set-diff-only`、回传才算勾上、全 unchanged 置灰）。
`node scripts/type-check.mjs` 基线外 0 新增；ESLint 触及文件只剩 `ViewerPanel.vue:27` 那条 import 分组空行（HEAD `10579537` 合并就有，未动）。

顺手看到：
- **分屏比单视口暗一档**（老截图 `bran-ftub-move/a626-b630-04-split.png` 的蓝 / 绿同样发暗，不是这轮引入）：四态色在分屏里成了深棕 / 藏青，仍分得开。split 路径直接 `renderer.render`，单视口有选中时走 `selection.renderOutline()`，两条路的色彩空间 / 后处理不一致——记在 plan §11，不在本轮。
- 「三维只看差异」与列表「包含未变化」同一口径、各自开关：列表缺省只列差异，三维缺省整单元都在（留着看变了的那件在哪），没并成一个开关是有意的。

### 8.1 点 A / B 构件 → 属性面板读那一版（2026-09-21 01:3x，`3d-diff-color/a626-b630-pick-*`，plan §11.1）

先核了现状：GPU 拾取只认主图层的 picking mesh，A / B 隔离图层的构件**根本点不到**（`parseRefnoFromObjectId` 也只认 `o:`）——从前在对比里点单元要么没反应、要么选到后面的环境构件。
修法见 plan §11.1：当前显示那一侧的隔离图层做 CPU 射线拾取，命中就把选中钉到那一版（`setSelectedRefnoAtVersion`），属性经面板带来的 `attributesAt` 取自那一侧的版本几何快照。
脚本 `old\.scratch\mvc-3d-pick-version-attrs-run.mjs`：先点列表修改行飞到 FTUB，再把它在隔离图层里的包围盒中心投影到画布坐标去点（A / B 两版位置差 500 mm，各自重投影）。

| 步 | 截图 | 事实 |
|---|---|---|
| 单视口 B 点 FTUB | `a626-b630-pick-01-side-b-pinned.png` | `lastPick {objectId unit-compare:b:24384_23262:4, side after, sesno 630}`；右侧属性面板标题下琥珀横幅 **「属性来自版本 B · sesno 630（版本对比里点到的那一版，不是当前会话）」**，**POS 10887, 12332, 2900**；这一步发的请求只有 `POST history/query {snapshot_key "24384_23257@630", tool "attributes", arguments {refno "24384/23262"}}`，`element/attributes` **0 条** |
| 切 A 再点 FTUB | `a626-b630-pick-02-side-a-pinned.png` | `lastPick {…:a:…, side before, sesno 626}`；横幅 **「A · sesno 626」**，**POS 10887, 12332, 3400**（挪了 500 的那一版）；请求 `snapshot_key "24384_23257@626"`，`element/attributes` 0 条 |
| 点画布空处 | — | 普通清空：横幅计数 0 |
| 再钉一次后退出对比 | `a626-b630-pick-03-closed.png` | 横幅计数 0（钉住随对比一起清，那一版快照已 DELETE） |

pageerror 0；console error 仍是那 5 条环境噪音。`a626-b630-pick-version-attrs-summary.json` 有每步投影坐标、`lastPick`、横幅文本与请求体。
单测：`PropertiesPanel.versionPin.test.ts` 2 条（钉住走 `load` 不发 `uiAttr`、横幅带 sesno、普通选中复位且当前会话值不串、B 版另一份缓存；那一版不存在给说明）、`attributeSource.test.ts` +2（同型折算 / 不存在）、纯函数 `sideFromCompareObjectId`、面板 open 事件带 `attributesAt` 断言；e2e `model-version-compare-gen-model-v1.spec.ts` 回归：缺省单元 **4 passed 13.0 s**、`24384_23257` **4 passed 12.3 s**。
分屏时拾取整体是关着的（`onDown` / `onUp` 直接 return），本条只覆盖单视口——分屏见 §8.2。

### 8.2 分屏里点左 A / 右 B 构件 → 属性面板读那一版（2026-09-21 09:4x，`3d-diff-color/a626-b630-splitpick-*`，plan §11.1「分屏拾取」）

之前分屏时 `onDown` / `onUp` 直接 return：GPU 拾取按整幅相机算、对不上左右两格画面。现在指针落在哪一格就按那一格的视口与宽高比造射线（`locateModelUnitComparePass` + `splitCompareRay`），对那一侧的隔离图层做 CPU 射线拾取，非当前显示侧拾取前临时开层、测完复位；主图层（环境）的 GPU 拾取把那一格当子视口（`sel.pick(pos, viewport)`），之后环境选中 / A–B 比远近 / 点空清空全部照单视口那一套走。分屏每格也走描边合成器，选中的环境构件两格都有描边。
脚本 `old\.scratch\mvc-3d-split-pick-run.mjs`（无环境）与 `mvc-3d-split-env-pick-run.mjs`（`show_refno=24384_23225` 带上那条 PIPE 的其他 BRAN 当环境）：把目标在 A / B 隔离图层里的包围盒中心按那一格重投影（透视下 ndcX 与 aspect 成反比：`ndcX_pass = ndcX_full · aspect_full / aspect_pass`，ndcY 不变）再点。视口 1600×1000 下画布只有 450×727，每格 225 px 宽。

**一个坑**：第一版想「临时把相机 aspect 改成那一格的 + 指针换成整幅上的等价位置」再喂 `GPUPicker`，真机 RGBA 全 0、CPU 射线却命中——`GPUPicker` 用 `setViewOffset(fullWidth, fullHeight, …)` 裁小窗，而 three 的 `setViewOffset` **会把 aspect 置成 `fullWidth / fullHeight`**，改的 aspect 被抹掉。所以整幅必须就是那一格：`GPUPicker.pick` / `DTXSelectionController.pick` 加可选 `viewport`，`computePickViewOffset` 按子视口算整幅与偏移（`GPUPicker.test.ts`）。

| 步 | 截图 | 事实 |
|---|---|---|
| 右格 B 点 FTUB | `a626-b630-splitpick-01-right-b-pinned.png` | `lastPick {objectId unit-compare:b:24384_23262:4, side after, sesno 630, viewMode split}`；横幅「属性来自版本 B · sesno 630」，**POS 10887, 12332, 2900**；只发 `POST history/query {snapshot_key "24384_23257@630", tool "attributes", arguments {refno "24384/23262"}}`，`element/attributes` 0 条 |
| 左格 A 点 FTUB（A 版位置差 500，重投影） | `a626-b630-splitpick-02-left-a-pinned.png` | `lastPick {…:a:…, side before, sesno 626, viewMode split}`；横幅「A · sesno 626」，**POS 10887, 12332, 3400**；`snapshot_key "24384_23257@626"`。拾完立刻查两层：A 层该对象 `isObjectVisible` false、B 层 true、`activeSide after`——临时开层已复位 |
| 「三维只看差异」开着再点左格 | — | 照样 `{side before, sesno 626}`（hidden 只藏两侧各 8 件 unchanged，修改件在） |
| 点右格空处 | — | 横幅计数 0（普通清空） |
| 切回单视口再点 | `a626-b630-splitpick-03-single-again.png` | `{side after, sesno 630, viewMode single}`，单视口路径没坏 |
| 退出对比 | — | 横幅计数 0 |

带环境（`a626-b630-splitenv-*`，主图层 94 件环境、`environmentLoadedRefnos 103`）：

| 步 | 截图 | 事实 |
|---|---|---|
| 右格点环境件（格内投影面积最大的那件 `o:24384_26315:172`） | `a626-b630-splitenv-01-right-env-selected.png` | **普通选中** `24384_26315`：`lastPick` 空、无横幅，属性面板 REFNO `=24384/26315`，发的是 `element/attributes {refno "24384/26315"}`（当前会话）；两格里那件都是描边色 |
| 左格点同一件 | — | 同样普通选中、无横幅（属性已缓存、不再发请求） |
| 右格点 B 版 FTUB | `a626-b630-splitenv-02-right-b-pinned.png` | `{side after, sesno 630, viewMode split}`，横幅「B · sesno 630」，`snapshot_key …@630`——环境在场时 A / B 命中比环境更近才选它 |
| 左格点 A 版 FTUB | `a626-b630-splitenv-03-left-a-pinned.png` | `{side before, sesno 626}`，横幅「A · sesno 626」，`…@626` |
| 再点环境件 | — | 横幅撤掉、回到普通选中 |
| 退出对比 | — | 横幅计数 0 |

pageerror 0；console error 仍是那 5 条环境噪音。`a626-b630-split-pick-summary.json` / `a626-b630-split-env-pick-summary.json` 有每步投影坐标（含 pass、整幅 / 格内 NDC）、`lastPick`、选中 refno、横幅文本与请求体。
单测：`modelUnitVersionCompare.test.ts` +1（`locateModelUnitComparePass`：左 / 右格 NDC、分界线归右格、格外 null、单视口等价整幅）、`GPUPicker.test.ts` +2（`computePickViewOffset`：缺省整幅 / dpr / 子视口偏移 / 贴边夹住）。e2e `model-version-compare-gen-model-v1.spec.ts` 回归（`PLAYWRIGHT_PORT=3111`）：缺省单元 `24384_26480` **4 passed 12.1 s**、`MODEL_VERSION_E2E_UNIT=24384_23257` **4 passed 12.6 s**。

### 8.3 分屏走描边合成器的开销（2026-09-21 10:3x，`3d-diff-color/split-perf-*.json`）

用户要先看性能再定要不要留。脚本 `old\.scratch\mvc-3d-split-perf-run.mjs`：把 `renderer.render` 与 `requestAnimationFrame` 包一层，用 `EXT_disjoint_timer_query_webgl2` 包住每个 rAF 回调里的全部 GL 命令读 GPU 纳秒；左键按住拖相机 ~3 s（OrbitControls 旋转，每 40 ms 一步），每档 ~280 帧。「直接 render」那档是在页里把 `selection.hasOutline` 临时置成 `() => false`，代码没加开关。
`--gpu` = headless 也用 `--use-gl=angle --use-angle=d3d11 --ignore-gpu-blocklist` 拿真显卡（缺省 headless 落在 SwiftShader 软渲染）。

真显卡 **AMD Radeon RX 590**，视口 2560×1440 → 画布 930×1164，GPU 每帧毫秒（avg / p50 / p95 / max），全部档位 rAF 都是 60 fps：

| 场景 | 单视口 · 合成器（今天的单视口） | 分屏 · 合成器 ×2（新） | 分屏 · 直接 render ×2（旧） | 单视口 · 直接 render（参照） |
|---|---|---|---|---|
| PIPE 环境 94 件（主图层 206 件） | 1.22 / 0.96 / 2.35 / 4.57 | **3.73 / 2.42 / 9.56 / 10.12** | 1.51 / 0.90 / 5.17 / 8.11 | 0.45 / 0.35 / 0.84 / 4.06 |
| 同上 · 选中一件环境构件（描边有活干） | 1.34 / 1.09 / 2.41 / 5.92 | **4.29 / 3.23 / 9.62 / 10.36** | — | — |
| ZONE 环境 1939 件 | 2.49 / 1.81 / 4.67 / 7.67 | **6.13 / 7.33 / 8.08 / 12.95** | 4.13 / 3.58 / 8.14 / 8.83 | 2.13 / 2.38 / 2.74 / 5.31 |
| 同上 · 选中一件 | 3.67 / 3.30 / 5.26 / 5.78 | **6.23 / 7.05 / 9.47 / 12.89** | — | — |

- 合成器每格的固定开销 ≈ **0.8–1.1 ms**（RenderPass 之外的 OutlinePass 掩膜 / 边缘 / 模糊 + FXAA + OutputPass，全按画布分辨率跑），分屏两格就是两份；场景越大它占的比例越小（ZONE 里分屏合成器 6.1 ms vs 直接 4.1 ms，+50%；PIPE 里 3.7 vs 1.5，+150%）。
- CPU 端（`renderer.render` 提交 + rAF 回调墙钟）三档都 < 1.3 ms，不是瓶颈。
- 按像素数外推 4K（3840×2160 ≈ 8.3 MP，是这次画布的 7.7 倍）：合成器每格 ≈ 7–8 ms，分屏两格 ≈ 15 ms 加上场景本身——这块显卡上 4K 分屏会掉到 60 fps 以下；单视口本来就付一份，4K 也只剩 ~8 ms 余量。
- **软渲染**（缺省 headless 的 SwiftShader，视口 1600×1000 → 画布 450×727，PIPE 环境）：单视口合成器 **20.8 fps**、分屏合成器 **11.4 fps**、分屏直接 render 60 fps、单视口直接 render 60 fps——没有显卡加速（远程桌面 / 虚拟机）时合成器本来就重，分屏再翻一倍。
- 若退回直接 render：选中的环境构件仍看得见——`SelectionManager.select` 会经 `setObjectColor` 把它覆成选中色（橙 `0xff8800`），只是没有描边、分屏比单视口暗一档那条老问题留着。

### 8.4 从一根管道（容器）进分屏：差异摘要按单元分组 → 逐组三维 → 分屏（2026-09-21 11:5x，`3d-diff-color/pipe-24384_23225-a300-b380-*`）

用户「查看一个管道的不同版本的分屏展示」。PIPE `24384_23225`（DB 8000）是容器、不属于任何最小交付单元；三维对比仍是**单元级**（一次装一个单元的 A / B），管道这一级的入口是「所有子节点」范围下的差异摘要按单元分组、逐组「在三维中对比」。
脚本 `old\.scratch\mvc-3d-pipe-split-run.mjs`（`--pipe 24384_23225 --a 300 --b 380 --units …`，真显卡 headless）。A 300 → B 380 这一段里 PIPE 下 5 个单元变过（改 / 删 / 增各有），拿它当样本。

| 步 | 截图 | 事实 |
|---|---|---|
| 打开 `/?…&unit_refno=24384_23225&compare_autorun=1&compare_a=300&compare_b=380` | — | 面板开、时间线列出即停（容器没有自己的几何可装）：缺省范围**仅自身**（CONTEXT 口径），本范围 49 版、缺省 **A 524 → B 532**（它自己最后两版 mesh）；`compare_a / compare_b` 对容器**不生效**——`autorunFromUrl` 到 `!hasUnit` 就 return，URL 那对没套到时间线上；主按钮「在三维中对比」置灰（title「不在任何最小交付单元下，没有几何」） |
| 切「所有子节点」→ 时间线点 A 300 / B 380 → 模型对比 tab | `pipe-24384_23225-a300-b380-01-panel-subtree-diff-summary.png` | 时间线 150 版（来自 `node/versions`，每行「单元 n」）；摘要 **A 300 → B 380 · 变了的单元 5 / 未变 16 · 新增 20 删除 6 修改 2 noop 1**，分 5 组各带「在三维中对比」：BRAN `24384_23257` 修改 1 noop 1、`24384_26324` 删除 4、`24384_26326` 删除 2、`32576_12` 新增 9、`32576_22` 新增 11（PIPE 自身那一行 `unit_root null` 的孤儿组不出按钮）；主按钮仍置灰 |
| 组 `24384_23257`「在三维中对比」 | `…-02-24384_23257-single.png` | `__modelUnitVersionCompare {unitRefno 24384_23257, 300→380, A / B 各 9 件, modified 1 unchanged 8}`；角标「B · sesno 380」、图例「修改 1 新增 0 删除 0 未变 8」；组按钮变「三维中」，面板「三维查看 24384_23257 · DB 8000」，树进「300 → 380 差异模式」 |
| 双视口分屏 | `…-02-24384_23257-split.png` | 两枚角标「A · sesno 300」「B · sesno 380」、单视口角标 0；面板「左 A · sesno 300 · 右 B · sesno 380」；两格各一根 BRAN、FTUB 琥珀、**左低右高**（POS Z 2900 → 3400，与属性历史对比那格一致） |
| 右格点 FTUB → 左格点 FTUB（各按格重投影） | `…-02-24384_23257-split-left-a-pinned.png` | 右：`lastPick {side after, sesno 380, viewMode split}`、横幅「属性来自版本 B · sesno 380」、只发 `history/query {snapshot_key "24384_23257@380", tool attributes, refno 24384/23262}`；左：`{side before, sesno 300}`、「A · sesno 300」、`…@300`；两次拾取 `element/attributes` 0 条 |
| 组 `24384_26324`（删除 4）「在三维中对比」 | `…-03-24384_26324-deleted-error.png` | **进不去**：面板报「历史投影任务 … 失败：REFNO_NOT_FOUND_AT_SESSION: refno 24384/26324 is not in the element index of dbnum 8000 at session 380」，三维空着、组按钮仍「在三维中对比」 |
| 组 `32576_22`（新增 11）「在三维中对比」 | `…-04-32576_22-added-error.png` | 同样进不去：「… refno 32576/22 … at session 300」 |
| 退出 | — | 运行态 null、两种 overlay 0、横幅 0，五个组按钮全部回「在三维中对比」 |

pageerror 0；console error 6 条 = 从前那 5 条环境噪音 + 1 条 404 = `GET :8022/api/v1/element/attribute-diff?dbnum=8000&refno=24384/23225&a=524&b=532`（容器「仅自身」缺省对 524 → 532 的属性净差；这版 `:8022` 没有这条路由，面板按「旧服务端拉时间线折」回落，是预期的探路 404）。`…-added-deleted-fail-summary.json` 留着两组修前的面板报错原文。

**发现 → 修（用户 12:1x 拍板「修」）**：
- **容器分组入口装不了 A 或 B 那侧不存在的单元**：`ModelUnitVersionComparePanel.runCompareGroup` 合成两侧 `ModelVersion` 时 `impactKind` 写死 `'mesh'`，适配器就去 `history/generate` 那一版——单元在 B 已删（或 A 还没建）就 404。单元根入口没这问题：`model/versions` 那一行自带 `tombstone`，`loadVersion` 回空集、视口显示删除空态。
  修法：纯函数 `modelUnitGroupSideImpactKinds(group)` 按摘要组里单元根那一行判——`status deleted` → B 侧 `tombstone`、`status added` → A 侧 `tombstone`，单元根那行没列出来（截断）/ 孤儿组不猜；注脚 `modelUnitVersionAbsentNote(side)`：B 侧仍「该版本单元已删除」，A 侧「该版本没有这个单元」（多半是还没建），面板 A / B 卡与视口角标（单视口一枚、分屏两枚）同一句。
- 换组 = 面板先 `close` 再 `open`，视口 `viewMode` 回缺省单视口——从管道逐组看，每换一个单元都要再点一次「双视口分屏」（未动）。
- 容器的 `compare_a / compare_b` URL 参数被忽略（见第一行）；要给容器直达某两版，`autorunFromUrl` 得在 `!hasUnit` 之前先把这对套上（不跑对比）（未动）。

**修后真机**（同一脚本、同三组一次跑完，`pipe-24384_23225-a300-b380-split-summary.json`）：

| 组 | 截图 | 事实 |
|---|---|---|
| `24384_23257`（修改 1） | 同上 `…-02-*` | 与修前一致：分屏两枚角标、右格钉 B 380 / 左格钉 A 300 |
| `24384_26324`（删除 4，B 时整单元已删） | `…-03-24384_26324-split-left-a-pinned.png` | 进得去了：`{beforeObjects 1, afterObjects 0, statusCounts {deleted 1}}`，单视口角标「B · sesno 380 · 该版本单元已删除」；分屏角标「A · sesno 300」「B · sesno 380 · 该版本单元已删除」，左格 VALV 玫红、右格空；左格点 VALV `24384_26325` → `{side before, sesno 300}`、横幅「A · sesno 300」、`history/query {snapshot_key 24384_26324@300}`；右格同一位置点下去（B 那版没有它）→ 横幅 0、选中空；属性历史对比那格「该构件在版本 B 不存在（已删除）」 |
| `32576_22`（新增 11，A 时还没建） | `…-04-32576_22-split-right-b-pinned.png` | `{beforeObjects 0, afterObjects 10, statusCounts {added 10}}`；分屏角标「A · sesno 300 · 该版本没有这个单元」「B · sesno 380」，左格空、右格整根 BRAN 翠绿；右格点 FTUB `32576_17` → `{side after, sesno 380}`、横幅「B · sesno 380」、`snapshot_key 32576_22@380`；左格同一位置 → 横幅 0；属性历史对比那格「该构件在版本 A 不存在（新建于 A 之后）」 |
| 退出 | — | 运行态 null、overlay 0、横幅 0、五个组按钮全回「在三维中对比」；pageerror 0，console 仍是那 6 条 |

单测：`modelUnitVersionCompare.test.ts` +1（两侧 impactKind 五种情形 + 注脚），`ModelUnitVersionComparePanel.test.ts` 分组用例 +2 段（单元根 deleted / added → `loadVersion` 收到的 impactKind、`open` 事件两侧、A / B 卡注脚各说各的），5 个相关文件 **39 过**；`type-check` 基线外 0 新增；ESLint 只剩 `ViewerPanel.vue:28` 那条 HEAD 就有的；e2e `PLAYWRIGHT_PORT=3111` 缺省单元 **4 passed 13.1 s**（其中 B 卡「该版本单元已删除」断言不变）、`24384_23257` **4 passed 13.1 s**。
