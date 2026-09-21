# 空间查询 · 房间层级树——HTTP 金样 + 抽屉树态真机 + 行文字截断复核 + 结果区剪辑真机 + 模型树「房间」页签真机（2026-09-20 17:26–18:07、20:13；2026-09-21 00:20–00:27、16:52–16:54）

计划：`docs/plans/2026-09-20-spatial-room-hierarchy-tree-plan.md`（§6 真机步骤；本文是它的记录）。决策 ADR 0068、共识 zhimo `d-157`；
上位记录 `docs/verification/spatial-query-room-discipline-2026-09-20/`（房间 / 专业过滤，ADR 0067）。
后端 `gen-model-model-cache` PR-A `06b067b51`（树路由 + `member_rooms` + 单元根派生）+ 补 `65dacd576`（树路由先核房间在册再扫树）；
前端 plant3d-web PR-B `fb2ed9a3`（端口 / 适配器 / store 树态 / `SpatialResultTree`）+ 补 `37b40691`（行文字截断）+ PR-B2 `f9c07ea5`（结果区剪辑）+ PR-D `92d928fc`（模型树「房间」页签，§8）。
脚本：HTTP 金样 `spatial-tree-check.ps1`（在本目录，可重跑，见 §3）；抽屉截图的 Playwright 临时 spec 在仓外（一次性，跑完即删）；e2e 那份在仓（§6）。

## 1. 环境：`:8027` 换成 PR-A 二进制（mem 档、`room_membership=true`）

| 项 | 值 |
| --- | --- |
| 二进制 | `_runs\spatial-rooms-8027\aios-database-65dacd576.exe`，`/health` `build_id = 0.1.28+g65dacd576ebd.1789896841`——干净 worktree `.scratch\wt-spatial-rooms-805170bd4`（detached @ `65dacd576`）`cargo build --release --features http_api --bin aios-database`（增量 3 min，产物 `D:\Rust\target\release`） |
| 配置 | `DbOption.toml` 同上位记录 §1（`http_api_addr = "127.0.0.1:8027"`、`room_membership = true`）；**介质必须由 `AIOS_STORE_MODE=mem` 给**（ADR-080 起 toml 的 `store_mode` 失效——第一次没带它，进程起来去连 `:8009` 的 SurrealDB 然后退出，这就是 17:08 用户那边「二进制已起」却还是 `805170bd4` 的原因） |
| 起点 | 17:37:01 起；mem 档重启即空，17:26:40 / 17:37 各 `POST /api/v1/dbnums/7997/model/ensure`（要带 `Content-Type: application/json` + `{}`，不带回 415）：6772 根 / 66 135 条房间边，85 s；`/health` `spatial_tree ready / 61 807 条`、`resident 52 386 / 6 772 根`（`http/02-dbnum-model-ensure-task.json`） |
| 房间体制 | `features.room.status = available`，`delivery_unit_types = [BRAN, HANG, SUPPO, EQUI]`（缺省表，`/health` 与树响应同一份） |
| 前端 | dev `:3111`（别的会话起的 vite），页面 `?model_source=gen-model-v1&gm_backend_port=8027`；PR-B2 那轮（00:20 起）工作树 = `10579537`（legacy 已退役）+ PR-B2 剪辑 |

起服务同上位记录 §1 的命令，多一行 `$env:AIOS_STORE_MODE = 'mem'`，二进制换 `aios-database-65dacd576.exe`。

## 2. 数据：AMS 7997，R432（`24381_35580`，`/1RX-RM04-R432`）为主，R143（`24381_1407`）作第二间

两种查询中心会给两组数（上位记录 §6 发现 A）：**refno 中心**（`?refno=24381/35580`，量到 R432 盒的最小面距）3 m 内 **1298** 条；
**点中心**（抽屉手输 R432 盒中心 `-6379.57, -11350.16, 5030`）3 m 内 **1055** 条。§3 金样用前者，§4–§6 抽屉用后者；两组各自满足契约的全部恒等式。

## 3. HTTP 金样（17:43:24–17:43:56；`http/00-summary.json` **38 项检查 38 过 / 0 败**）

```powershell
# 重跑（-SkipEnsure 表示 7997 已 ensure 过；-Sha 是 /health build_id 里要带的短 sha）
& .\spatial-tree-check.ps1 -Out .\http -SkipEnsure -Sha 65dacd576 -SecondRoom 24381_1407
```

| # | 检查 | 结果 |
| --- | --- | --- |
| 1–2 | `/health` 200、`build_id` 带 `65dacd576`、`room_membership=true` | 过 |
| 3–18 | **单房** `nearby/tree?refno=24381/35580&radius=3000&shape=sphere&rooms=24381_35580`：200（首发 440 ms、热 532 ms）；`rooms[]` 一条 = R432；`rooms[0].count = total_count = 1298`；`Σ specs.count = rooms.count`；每个专业 `Σ unit_types.count + others.count = spec.count`、`Σ by_noun.count = others.count`；每个单元类型 `Σ units.count`；专业 `0, 3` 升序 0 在前；单元类型按配置表序 `BRAN > EQUI`；单元按 `min_distance` 升序；`leaves_inline=true` 时每组 `elements` 数 = `count`、`Σ 叶子 = leaf_count = 1298 = total_count`；带 `room_status`（`source=memory`、`unresolved=0`）与 `delivery_unit_types`；**不再给** `filter_options / spec_groups / groups / results`；`total_count 1298` = 同参 `nearby/refnos` 去重数（原始 1303 条、`total_count` 1303——空间树同一 refno 多条条目，树路由按 refno 去重）；叶子集合 = refnos 全集（missing 0 / extra 0） | 过。形状：spec 0 = 5（其他构件 GWALL 2 / PANE 2 / STWALL 1）；spec 3 = 1293 = BRAN 226（28 个单元）+ EQUI 1067（45 个单元） |
| 19–21 | **两间房** `rooms=24381_35580,24381_1407`：200、`rooms` 两条按 `room_num` 排 `R143:1337 / R432:1298`；`Σ rooms.count 2635 ≥ total_count 1925`；差 **710** = 带 `shared_rooms` 的构件数，每个都在两间房下各出现一次 | 过 |
| 22–23 | 100 m 单房：200（首发 5.9 s、热 3.9 s），`leaf_count 1298 ≤ cap 5000`（记录，不判） | 过 |
| 24–27 | 100 m + **60 间房**：200（5.1 s），`total_count 15 578`、`leaf_count 23 591 > 5000` → `leaves_inline=false`、所有 `elements` 省略；`unit=24381_30585` 只内联那一个单元（`inlined=unit:…`，4.4 s）；`other_noun=PANE` 只内联那个 noun 组（49 组，4.1 s） | 过 |
| 28 | `unit` 与 `other_noun` 同给 → 400 | 过 |
| 29–31 | `rooms/24381_35580/tree`：200（303 ms）、`rooms` 一条、`center.source=refno_aabb_center`、`radius=0`、`shape=cube`、`total 1298`；`?radius=500` 外扩 ≥ 不外扩；`?nouns=PANE` 透传（叶子全 PANE，2 条） | 过 |
| 32–37 | 六条 400：`nearby/tree` 不带 `rooms=`；`rooms=1_1`（不在册，**补 `65dacd576` 前这条在 `rooms/1_1/tree` 上答 404**——房间既是范围又是过滤，先扫树就先撞「没盒」）；`rooms/abc/tree`；`rooms/{refno}/tree?x,y,z`；`rooms/1_1/tree`；`unit=zzz` | 过（`http/08-errors.json`） |
| 38 | 耗时记录 | 3 m 440 / 532 ms；100 m 单房 5875 / 3865 ms；60 房 5084 ms；`rooms/{refno}/tree` 303 ms；`nearby/refnos` 412 ms |

## 4. 抽屉树态（18:02–18:07；Playwright 无头；`ui/tree-01…03.png`、`ui/ui-tree-flow-summary.json`）

页面同 §1，抽屉「范围」Tab，手输 R432 盒中心、r = 3 m、每页 100。`pageerror` 0。

| 步 | 动作 | 看到 | 图 |
| --- | --- | --- | --- |
| 1 | 搜 `R432` 回车 → 执行 | 请求打 `nearby/tree`（不再打分页的 `nearby`）；摘要「共 **1055** 项（去重）· 1 间房」= 服务端 `total_count`；结果区是树：R432 1055 = 未知或其他 4（其他构件 4）+ 仪表系统 1051（BRAN / EQUI） | `tree-01-room-selected-tree.png` |
| 2 | 展开一个 BRAN 单元（`24381_148125`，11 个构件） | 11 条叶子行；「仅显示」可点 | `tree-02-unit-expanded-leaves.png` |
| 3 | 加 R143 → 执行 | 两个房间节点 661 + 1055、总 **1056**（去重）；叶子上「跨 2 房」标 11 处 | `tree-03-two-rooms.png` |
| 4 | 清房间 → 执行 | 回到平铺分组，共 1302 | — |

## 5. 行文字截断复核（20:13；PR-B 补 `37b40691`；`ui/tree-04…06.png`、`ui/tree-rows-truncation-summary.json`）

336 px 抽屉里树行曾被截成 `R432 · /1RX-RM…` / `BRAN · 17…`：三个动作按钮 `opacity-0` 仍占行宽 1/3，且 Vuetify `main.css` 的
`.opacity-0` / `.pointer-events-none` 带 `!important`，Tailwind `group-hover:opacity-100` 压不过——改前那三个按钮真机悬停根本不出现
（Playwright 把 opacity 0 当可见，e2e 没拦住）。改为动作绝对定位叠在标题单元格右端、平时 `invisible`、行悬停 / 键盘焦点才 `visible`；
房间行只显房号、单元行只显名字、名字 / refno / 说明 / 构件数进 `title`。复核：面板 308 px 宽，12 行主标识 ≤ 28 字的都不再溢出
（`truncated=false`），计数右缘离面板右缘 **12 px**，动作静态 `hidden` / 悬停 `visible` 且不盖计数；`pageerror` 0。

## 6. 结果区剪辑真机（2026-09-21 00:20–00:27；PR-B2 `f9c07ea5`；`ui/trim-01…04.png`、`ui/trim-summary.json`、e2e 日志）

**e2e** `e2e/spatial-query-gen-model-v1-ui.spec.ts`（`PLAYWRIGHT_PORT=3111 GEN_MODEL_V1_BASE_URL=http://127.0.0.1:8027 npx playwright test … --workers=1`）：
**9 passed / 1 skipped**（拾取中心要 `--headed`），4.9 min，日志 `e2e-spatial-query-gen-model-v1-ui-2026-09-21-0020.txt`。改了断言的两条：
「结果动作」核图标排的七个 `aria-label`、旧文字按钮 0 个、单行 title 带 refno 与距离、复制二选「本页」条数 = 行数、「加载未加载」把本页未加载清零；
「大数量确认」每页改 1000（平铺态只补本页，20 / 页凑不出 > 200），确认框数量 = 摘要「未加载 U 项」。

**截图**（同 §4 的页面与查询，视口 1440×1500，收起「更多条件」让结果区进画面）：

| 图 | 看到 |
| --- | --- |
| `trim-01-flat-icon-row-single-line-rows.png` / `trim-01b-drawer-only.png` | 平铺态：摘要两行（第二行 `56 未知 · 1177 仪表 · 69 土建 · 中心 -6380, -11350, 5030 · position`，整行 `title`）；一排七个图标 `加载未加载（本页）· 全部显示 · 全部隐藏 · 隔离结果 · 恢复场景 · 复制 Refno · 清空`；覆盖面一句「只含已生成过模型的构件」（`title` 全文）；构件行单行 `24381_1409 · PANE · 0 m · 未加载`（title）。房间列表 / 分页 / 「结果分组」仍在（平铺态） |
| `trim-02-copy-menu-open.png` | 「复制 Refno」点开：`本页 68` / `全部命中 1227`（本页 100 条按 refno 去重 68 行；全集 1302 条去重 1227） |
| `trim-03-tree-with-icon-row.png` / `trim-03b-tree-drawer-only.png` | 选 R432 → 树态：摘要「共 1055 项（去重）· 1 间房」，「加载未加载（整棵树）」，房间列表 / 分页 / 分组开关 **0 个**，树 R432 1055 → 未知或其他 4 / 仪表系统 1051 → BRAN 17 个单元 116 → 单元行（名字 · 距离 · 计数） |
| `trim-04-tree-copy-menu.png` | 树态「复制 Refno」只剩 `全部（去重） 1055` |

`pageerror` 0、错误横幅 0。

## 7. 文件

| 文件 | 内容 |
| --- | --- |
| `spatial-tree-check.ps1` | HTTP 金样脚本（§3；参数 `-Base / -Room / -RoomSlash / -SecondRoom / -Dbnum / -Out / -Sha / -SkipEnsure`，缺省 `:8027` / R432 / 7997） |
| `http/00-summary.json` | 17:43 全流程汇总：38 项检查、耗时、各场景关键数 |
| `http/01-health.json` `02-dbnum-model-ensure-task.json` | `/health` 与整库 ensure 的 202 回执 + 终态 |
| `http/03-nearby-tree-single-room.json` `03b-nearby-refnos-single-room.json` | 单房整树（1298 叶子）与同参 refnos 全集 |
| `http/04-nearby-tree-two-rooms.json` | 两间房整树（710 个 `shared_rooms=2`） |
| `http/05-nearby-tree-100m-capped.json` `05b-…-many-rooms-capped.json` | 100 m 单房 / 60 房（超上限、`elements` 省略） |
| `http/06-…-unit-selector.json` `06b-…-other-noun-selector.json` | `unit=` / `other_noun=` 只内联一组 |
| `http/07-room-tree.json` `07b-room-tree-variants.json` | `rooms/{refno}/tree` 与 `radius=500` / `nouns=PANE` 两个变体 |
| `http/08-errors.json` | 六条 400 的响应体 |
| `ui/tree-01…03-*.png` `ui/ui-tree-flow-summary.json` | 抽屉树态三步（§4） |
| `ui/tree-04…06-*.png` `ui/tree-rows-truncation-summary.json` | 行文字截断复核（§5） |
| `ui/trim-01…04-*.png` `ui/trim-summary.json` | 结果区剪辑（§6） |
| `e2e-spatial-query-gen-model-v1-ui-2026-09-21-0020.txt` | PR-B2 后 e2e 全量输出（9 passed / 1 skipped） |
| `ui/room-tab-01…08-*.png` `ui/room-tab-summary.json` | 模型树「房间」页签真机十步（§8；summary 里带请求账与逐层对照） |
| `e2e-model-tree-room-tab-gen-model-v1-2026-09-21-1711.txt` `…-1725.txt` | 房间页签 e2e 三条首次真机（3 passed）与加上页签记忆 / 选中联动第 ④ 条后（4 passed），§8 末 |

## 8. 模型树「房间」页签真机（2026-09-21 16:52–16:54；PR-D `92d928fc`；`ui/room-tab-01…08.png`、`ui/room-tab-summary.json`）

计划 `docs/plans/2026-09-21-model-tree-room-tab-pr-d-closeout-plan.md` §P1-a。同一台 `:8027`（`65dacd576`，7997 已 ensure，`/spatial/rooms` `ready` 215 间）+ dev `:3111`（工作树 = PR-D 代码），
页面 `?model_source=gen-model-v1&gm_backend=http://127.0.0.1:8027&output_project=AvevaMarineSample`（不带 `show_refno`，场景一开始是空的），Playwright 无头 1600×1000，仓外一次性脚本。
金样取自同机 `GET /spatial/rooms/24381_35580/tree`（R432：`total_count` 1298 / 专业 0 = 5（其他构件 5）/ 专业 3 = 1293 = BRAN 28 单元 226 + EQUI 45 单元 1067；首个 BRAN 单元 `24381_105030` `/Copy-of-1RCS380MP-YK/301VP` 3 个构件）。

| 步 | 动作 | 看到 | 图 |
| --- | --- | --- | --- |
| 1 | 模型树面板切「房间」 | 一发 `GET /spatial/rooms` 200；状态句「在册 215 间房 · 展开一间房看 专业 → 最小交付单元 → 构件」，搜索框 placeholder「搜索房间号 / 名称（在册 215 间）」；虚拟列表渲染 35 行 | `room-tab-01-roots.png` |
| 2 | 搜 `R432` | 「匹配 1 / 215 间房」，一行 `ROOM R432 · /1RX-RM04-R432` | `room-tab-02-search-r432.png` |
| 3 | 展开 R432 → 仪表系统 → BRAN → 首个单元 | 一发 `rooms/24381_35580/tree` 200；行文字**逐层等于金样**：`R432 · /1RX-RM04-R432 · 1298 个构件` / `未知或其他 · 5` / `仪表系统 · 1293` / `BRAN · 28 个单元 · 226` / `EQUI · 45 个单元 · 1067` / `Copy-of-1RCS380MP-YK/301VP · 3`（行上去掉了名字的前导 `/`，与 PDMS 树同一规矩）/ 三条构件行 `REDU 24381_105031` `BEND 24381_105032` `BEND 24381_105033`；9 项对照全 ok | `room-tab-03-five-levels.png` |
| 4 | 右键单元行 | 菜单七项：聚焦飞行 / 隔离（XRAY 其它）/ 取消隔离 / 显示 / 隐藏 / **加载模型（3 个构件）** / 查看属性；右键同时选中该单元，属性面板切到 `/Copy-of-1RCS380MP-YK/301VP` | `room-tab-04-context-menu.png` |
| 5 | 点「加载模型（3 个构件）」 | 三对 `model/ensure` + `model/records` 200；`scene.getLoadedRefnos()` 从不含三个 refno 变为全含（点之前 `scene.objects[refno]` 已有占位对象、`loaded=false`），相机飞过去；toast「已从 gen-model 加载 58 个几何实例」 | `room-tab-05-loaded-full-page.png` |
| 6 | 点构件行 `24381_105031` 的眼睛 | `scene.objects['24381_105031'].visible === false`，行上眼睛变红叉；再点一次回 `true` | `room-tab-06-element-hidden.png` |
| 7 | 搜 `ZZZ-不存在` | 「匹配 0 / 215 间房」+ 「没有匹配的房间」 | — |
| 8 | 搜 `R131`（`24381_1280`，`panel_count` 0）→ 展开 | `rooms/24381_1280/tree` **404** → 树上方一句 `R131 · /1RX-RM01-R131：房间 24381_1280 还没有包围盒（从未生成过面板模型），先显示它再展开`，行仍在、不出子级 | `room-tab-07-no-box-room-error.png` |
| 9 | 切回 PDMS 再切回房间 | PDMS 页 37 行可见、房间面板隐藏；切回来 R432 那棵**原样在**（展开态、计数、已加载的三条构件行都在——两棵树 `v-show` 常驻） | `room-tab-08-state-kept-after-tab-switch.png` |
| 10 | 点刷新 | `reset()` + 重拉 `/spatial/rooms`：回到 215 行、R432 折回无计数的一行（刷新就是清空，按设计） | — |

`pageerror` **0**；请求账全在 `room-tab-summary.json`（`requests[]`）。**未验**：`room_membership=false` 时的「服务端未开启房间归属计算」状态句（要一台关着开关的实例，本轮不起）；「查看属性」「聚焦飞行」两项菜单没点（属性面板在第 4 步已随右键选中切过去）。

**e2e**（17:1x，PR-D 收口计划 §P1-b）：上面十步整理成 `e2e/model-tree-room-tab-gen-model-v1.spec.ts` 三条——① 页签 / 在册计数 = `/spatial/rooms` 条数 / 搜索 / 无匹配 / 切回 PDMS；
② 展开夹具房逐层文字与计数 = `rooms/{refno}/tree` 响应（专业行尾计数、单元类型「NOUN · n 个单元 · count」、其他构件、前 3 个单元、前 5 个构件）+ `panel_count` 0 的房 404 → 一句「还没有包围盒」；
③ 右键「加载模型（N 个构件）」→ ensure + records → 单元的构件全部进 `getLoadedRefnos()` → 眼睛切 `visible` false / true → 切页签状态保留。数量全部取自服务端响应；房间体制非 ready / degraded 整文件跳过。
`PLAYWRIGHT_PORT=3111 GEN_MODEL_V1_BASE_URL=http://127.0.0.1:8027 npx playwright test e2e/model-tree-room-tab-gen-model-v1.spec.ts --workers=1` → **3 passed（11.2 s）**，日志 `e2e-model-tree-room-tab-gen-model-v1-2026-09-21-1711.txt`；eslint 0。

**P3-a 页签记忆 + P3-b 选中联动**（17:2x，收口计划 D4 / D5 按推荐）：`modelTreeTab.ts` 把当前页签记进 `localStorage['plant3d.modelTree.activeTab']`（坏值 / 读写异常当 PDMS，单测 3 例）；
`useRoomTree.revealRefno(refno)`——refno（`a_b` / `a/b`，构件或单元）在**已取过树的房**里就展开祖先、单选、回 `flatRows` 下标（优先已展开的房；没取过树的房不拉、树里没有回 null，单测 +1），
`RoomTreePanel` 在页签前台时监听全局选中调它并 `scrollToIndex` 居中，树内点选用 `internalSelection` 标记不反弹（与 PDMS 树同法）。e2e 第 ④ 条：切到「房间」→ 整页刷新仍在「房间」（tab 带 `shadow-sm`、面板可见）→
只展开房间层 → 外部 `setGlobalSelectedRefno` 单元最后一个构件 → 该行出现、`data-selected=true`、在视口内、单元类型 / 单元行都展开、选中行只此一行 → 选单元 refno 落在单元行 → 树内点另一构件全局选中跟着变且不反弹 → 切回 PDMS 记 `pdms`。
同命令 **4 passed（15.1 s）**，日志 `e2e-model-tree-room-tab-gen-model-v1-2026-09-21-1725.txt`；vitest 页签 3 文件 17 passed；type-check 基线外 0；eslint 0。
