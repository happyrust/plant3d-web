# 空间查询 · 房间层级树——HTTP 金样 + 抽屉树态真机 + 行文字截断复核 + 结果区剪辑真机 + 模型树「房间」页签真机 + 两批合入后同屏确认 + 管件带直段（2026-09-20 17:26–18:07、20:13；2026-09-21 00:20–00:27、16:52–16:54、18:35、20:1x）

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
| `spatial-tree-check.ps1` | HTTP 金样脚本（§3；参数 `-Base / -Room / -RoomSlash / -SecondRoom / -Bran / -Dbnum / -Out / -Sha / -SkipEnsure`，缺省 `:8027` / R432 / `24381_105030` / 7997）；2026-09-22 加第 9 段 `tubes=1` 三条（§10） |
| `http/00b-summary-2aab735df.json` `03c-nearby-tree-single-room-tubes.json` `07c-room-tree-tubes.json` `07c-room-tree-tubes-account.json` | 后端 T1（`2aab735df`）上 41 项全过的汇总；3 m 球 / 整房 `tubes=1` 整树（159 / 162 段直段）与账（§10） |
| `http/05c-nearby-tree-100m-many-rooms-tubes.json` `00c-tubes-summary.json` | 仓外一次性脚本 `tubes-check.ps1` 的 100 m 多房 `tubes=1` 账（1893 段、未截断、3092 ms）与 24 项汇总（§10） |
| `ui/tubes-tree-01…04-*.png` `ui/tubes-tree-summary.json` | 树里列出直段前端四步（§11）：抽屉 BRAN 单元下的直段行与摘要 / 点直段行选中 BRAN / 房间页签只读 TUBI 行 / 右键两项；summary 带两条树请求 URL、每条直段行的文字 / title / 键、选中 refno |
| `e2e-tube-rows-both-specs-2026-09-22-1629.txt` | T3 后两份 e2e 同机复跑 15 passed / 1 skipped（各 +1 直段行用例，§11） |
| `http/00d-t2-records-tube-summary.json` | T2 真机账（§12）：`:8027` 换上 T2 二进制后 R432 28 根 BRAN 的 `model/records` 逐根 记录数 / TUBI 数 / 带 `tube` 数 / 树里直段数与对上数 / 去 `tube` 后与旧版逐字相同，11 项检查 |
| `e2e-tube-eyes-both-specs-2026-09-22-2117.txt` | T4 后两份 e2e 同机复跑 15 passed / 1 skipped（两条直段用例各扩逐段眼睛一段，§12） |
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
| `ui/final-01…04b-*.png` `ui/final-summary.json` | 两批全部合入后（main @ `7779b876`）的本地同屏确认四步（§8 末）：页签记忆过整页刷新 / 外部选中联动到已展开的房 / 右键加载进三维 / 抽屉树态与房间页签同屏；summary 带逐行文字、树请求 URL 与「已加载 0」的交叉核对 |
| `e2e-tubing-both-specs-2026-09-21-2025.txt` | 管件带直段合入后两份 e2e 同机复跑 13 passed / 1 skipped（§9 末） |
| `ui/tubing-01…05-*.png` `ui/tubing-summary.json` | 管件带直段五步（§9）：抽屉「加载」单元把 BRAN 直管 + 范围外管件一起装 / 「隔离」直管实体、另一条 BRAN XRAY / 「全部隐藏」直管随隐 / 房间页签单元「隔离」/ 眼睛；summary 每步带各 refno 名下的 DTX 对象数、visible / xrayed |
| `design/R1-drawer-flat.png` `R2-drawer-room-tree.png` `R3-model-tree-room-tab.png` `R4-ui-to-api-map.png` | 设计稿 `ui/空间查询/room-hierarchy-tree.pen` 四帧导出（2×，pen.dev `Export`；R3 / R4 的状态标已改「已合入」）——抽屉平铺态 / 抽屉树态 / 模型树「房间」页签 / 界面动作 → 请求 → 状态 |

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
**回归复跑**（17:3x，PR-D 全部合入后）：抽屉那份 `spatial-query-gen-model-v1-ui.spec.ts` 同机 `--workers=1` **9 passed / 1 skipped（25.8 s）**，与 09-21 00:20 基线一致——页签改动没碰到抽屉。

**两批合入后的本地同屏确认**（18:35，main @ `7779b876`；同一台 `:3111` + `:8027`，Playwright 无头 1600×1000，仓外一次性脚本；`ui/final-01…04b-*.png`、`ui/final-summary.json`）：

| 步 | 动作 | 看到 | 图 |
| --- | --- | --- | --- |
| 1 | 切「房间」→ 整页刷新 | 刷新前 `localStorage['plant3d.modelTree.activeTab'] = room`；刷新后「房间」页签仍在前台（`shadow-sm`）、状态句「在册 215 间房 · 展开一间房看 专业 → 最小交付单元 → 构件」、215 行房间平铺 | `final-01-tab-remembered-after-reload.png` |
| 2 | 搜 `R432`、只展开房间层 → 外部 `setGlobalSelectedRefno('24381_105033')` | 树自己把 `仪表系统 → BRAN · 28 个单元 → Copy-of-1RCS380MP-YK/301VP` 三层祖先展开，`BEND 24381_105033` 行 `data-selected=true` 且只此一行选中；虚拟列表可见 35 行，文字与 §8 第 3 步金样一致（`1298 个构件` / `未知或其他 · 5` / `仪表系统 · 1293` / `BRAN · 28 个单元 · 226` / `Copy-of-1RCS380MP-YK/301VP · 3` / `REDU 24381_105031` …） | `final-02-selection-sync.png` |
| 3 | 右键单元行 → 「加载模型（3 个构件）」 | `scene.getLoadedRefnos()` 含 `24381_105031 / 105032 / 105033`，三维里出现这段管线，属性面板停在 `/Copy-of-1RCS380MP-YK/301VP`（右键即选中） | `final-03-unit-loaded-in-3d.png` |
| 4 | 打开抽屉「范围」：手输 R432 盒中心 `-6379.57, -11350.16, 5030`、r = 3 m、房间 `R432` → 执行；收起「更多条件」，展开树里首个 BRAN 单元 | 一发 `nearby/tree?x…&radius=3000&shape=sphere&rooms=24381/35580` 200，`leaves_inline=true`；摘要「共 **1055** 项（去重）· 1 间房，已加载 0 项，未加载 1055 项」；树 `R432 1055 → 未知或其他 4 / 仪表系统 1051 → BRAN 17 个单元 116 / EQUI 28 个单元 935 → /Copy-of-1RCS0307-1R90004 0.21 m · 11` → 11 条叶子行（refno · noun · 距离 · 眼睛 / 飞行）。左侧房间页签同屏仍是 R432 五层（1298 / 28 单元 / 226）——**同一间房两套数**：页签是整房（`rooms/{refno}/tree`），抽屉是 3 m 球内（`nearby/tree`），与 §2 两种中心的口径一致 | `final-04-drawer-tree-and-room-tab.png`（整页）/ `final-04b-drawer-tree-panel.png`（树面板） |

「已加载 0 项」交叉核对：树响应 JSON 里**不含**第 3 步加载的三个 refno（`loadedElementsInsideTree = []`——那条 BRAN 的 `HPOS -4229, -7991, 3814` 离中心约 4.2 m，在 3 m 球外），摘要为 0 是对的。`pageerror` **0**。

## 9. 管件带直段（2026-09-21 20:1x；ADR 0068 追记，方案 A；`ui/tubing-01…05-*.png`、`ui/tubing-summary.json`）

**起因**：验收时用户提「如果是管件，需要显示对应的直段」。核数据：`model/records` 里 BRAN `24381_105030` 58 条 = 36 个管件 + **22 段 TUBI，全部挂在 BRAN 自己的 refno 上**（`refno == owner`，`generic = TUBI`），
空间索引（`nearby/tree` / `rooms/{refno}/tree`）里**没有 TUBI**。改前三处不一致：房间页签「加载模型」走生成根整条装（直段在）；抽屉「加载」只画命中的管件 refno（直段没有）；
两棵树单元级「隔离 / 仅显示 / 眼睛」的 refno 集里没有 BRAN 自己（直段被 XRAY / 隐掉）。改法：`composables/deliveryUnitScene.ts` 只读记录缓存认属主、取整根；抽屉批量加载装完命中项再装 BRAN 整体；
单元级及以上动作与「全部显示 / 隐藏 / 隔离结果」带上 BRAN 整体；构件行不扩。

同一台 `:3111` + `:8027`，Playwright 无头 1600×1000，仓外一次性脚本；先在房间页签装 BRAN `24381_105030`（22 段直管），再在抽屉（R432 盒中心 3 m + 房间 R432 → 树）对首个 BRAN 单元 `/Copy-of-1RCS0307-1R90004`（`24381_148125`，11 个命中管件）操作——两条 BRAN 都在场景里，隔离 / 显隐的差别看得见。

| 步 | 动作 | 看到（`tubing-summary.json` 里的场景账） | 图 |
| --- | --- | --- | --- |
| 1 | 抽屉树 单元行「加载」 | 改前只会画 11 个命中管件；现在 `24381_148125` 名下 **13 个 TUBI 对象**（`o:24381_148125:n`）+ 范围外的 9 个管件一起进场景（这条 BRAN 共 20 管件 + 13 段直管 = 21 个 refno），`getLoadedRefnos()` 58 → 三维里是一整条带弯头、阀门的管线 | `tubing-01-drawer-unit-loaded-with-tubing.png` |
| 2 | 单元行「隔离」 | `24381_148125`（直管）与它的管件 `xrayed=false`，房间页签装的 `24381_105030` 及其管件 `xrayed=true`——管件不悬空、别的 BRAN 变半透明 | `tubing-02-drawer-unit-isolated-other-bran-xrayed.png` |
| 3 | 「恢复场景」→ 单元行「仅显示」→ 摘要下「全部隐藏」→「全部显示」 | 仅显示后直管 `visible=true`；全部隐藏后 `24381_148125` 直管 `visible=false`（随命中管件一起隐）、`24381_105030` 不是结果、不动；全部显示回 `true` | `tubing-03-drawer-hide-all-tubing-hidden-other-bran-stays.png` |
| 4 | 房间页签 单元 `Copy-of-1RCS380MP-YK/301VP` 右键「隔离（XRAY 其它）」 | `24381_105030`（22 段直管）与三个管件 `xrayed=false`，抽屉那条 `24381_148125` `xrayed=true` | `tubing-04-room-tab-unit-isolated-tubing-solid.png` |
| 5 | 「取消隔离」→ 单元行眼睛 → 再点回 → 构件行 `REDU 24381_105031` 眼睛 | 单元眼睛：直管与三个管件一起 `visible=false`，`24381_148125` 不动；再点全回 `true`；构件行眼睛只隐 `24381_105031`，直管与另两个管件 `visible=true` | `tubing-05-room-tab-unit-hidden-tubing-hidden.png` |

`pageerror` **0**。单测：`deliveryUnitScene.test.ts` 4 例（属主只认 `owner_noun == BRAN`、BRAN 自己 / EQUI / 无 owner_noun / 没几何 / 没记录都不扩、源没建时退成不扩）、`spatialTree` +1（`branUnitRefnosCoveredBy` 跨房单元按任一房那份盖住即算、未内联不算）、
`roomTreeNodes` +1（`branUnitRefnosUnder`）、`useRoomTree` +1 + 2 例改口、`useSpatialQuery` +3 + 1 例改口 → 13 文件 163 过；type-check 基线外 0；eslint 触及文件 0。
**e2e 回归**：两份 spec 同机 `--workers=1` **13 passed / 1 skipped（36.2 s）**，日志 `e2e-tubing-both-specs-2026-09-21-2025.txt`。抽屉那份第 5 条「隔离结果 → 其余 X-Ray」的断言改口：
夹具 BRAN `24381_145018` 的整体（它自己 = 直管，已加载、盒在半径内时会以 viewer-local 进结果；+ 它范围外的管件）跟着留实体，此外的对象仍全部 X-Ray（helper 新增 `fetchGenerationRootRefnos`，走 `model/records` 读整根成员）。

## 10. 树里列出直段——后端 T1 真机（2026-09-22 15:28–15:47；方案 B，计划 `docs/plans/2026-09-21-room-tree-tube-segments-plan.md` §4 T1；`http/03c…` `07c…` `05c…` `00b…` `00c…`）

**后端**：gen-model-model-cache `86bf22f51`（T1：`nearby/tree` / `rooms/{refno}/tree` 加 opt-in `tubes=1`）+ `2aab735df`（追笔：直段归房收窄）；执行计划
`gen-model-model-cache/docs/plans/2026-09-22-room-tree-tube-segments-backend-dev-plan.md`，契约 spec §4.13.5「`tubes=1`」。D1–D7 全按小计划推荐（用户 11:19 拍板）。
形状：`units[].tubes[] { ordinal, from, to, from_noun, to_noun, distance, length, aabb{min,max}, invalid, shared_rooms? }`、各层 `tube_count`、顶层 `total_tube_count` / `tubes_truncated`；
`count` / `total_count` 不变，直段放置数计入 `leaf_count`、共用 `leaf_cap`；**缺省关**——不带 `tubes=` 的响应一个直段键都没有。

**环境**：同一台 `:8027`（mem 档），二进制两换：15:28 `aios-database-86bf22f51.exe`（`build_id 0.1.30+g86bf22f51536.…dirty`——dirty 只因 vendor `e3d-io` 0.1.0 → 0.2.0 让 cargo
改了 `Cargo.lock`，随后别的会话已把它提交）→ 15:44 `aios-database-2aab735df.exe`（`0.1.30+g2aab735dfa9e.1790062857`，干净）；都在干净 worktree `.scratch\wt-tubes-86bf22f51`
`cargo build --release --features http_api --bin aios-database`（3 m 36 s / 3 m 13 s）；起法同 §1，改用 `Win32_Process.Create`（不挂在终端下）。每换一次 7997 整库 ensure：6772 根、
`failed 0`、`room_edges 66135`，84 s / 77 s。

**金样**：`spatial-tree-check.ps1` 加第 9 段（`-Bran` 参数，缺省 `24381_105030`）**+3 条**——「不带 `tubes=` 的两条树路由里没有任何直段键」、`03c` 3 m 球 `tubes=1`、`07c` 整房 `tubes=1`；
原 38 条一字不改。`2aab735df` 上 `-SkipEnsure` **41 过 / 0 败**（`http/00b-summary-2aab735df.json`；带 ensure 那一遍 43 项里唯一一败是脚本自己 `$tt` / `$TT` 大小写同名撞了变量，改名后复跑）。
另有仓外一次性脚本 `.scratch\tubes-verify\tubes-check.ps1` **24 过 / 0 败**（`http/00c-tubes-summary.json`；账在下表）。

| 请求 | 结果（`2aab735df`） |
| --- | --- |
| `rooms/24381_35580/tree?tubes=1`（`07c-room-tree-tubes.json`，220 ms；不带 218 ms） | `total_count 1298` 不变；**`total_tube_count 159`**，`leaf_count 1457 = 1298 + 159`，`leaves_inline true`；28 个 BRAN 单元**全部**带直段；逐层 Σ `tube_count` 自洽；每段 `distance 0`（都在房间盒里）、`length > 0`、`from ≠ to`、按距离排；**去掉四个直段键与 `leaf_count` 后与不带 `tubes` 的响应逐字相同（79 162 字节）** |
| 同上，BRAN `24381_105030`（`/Copy-of-1RCS380MP-YK/301VP`） | 房里 `count 3 / tube_count 3`（`REDU→BEND` 141.5 mm、`BEND→BEND` 152.1 mm、`BEND→BEND` 652.1 mm）≤ `model/records` 里它的 22 段 TUBI——这条 BRAN 大半在房外 |
| `nearby/tree?refno=24381/35580&radius=3000&shape=sphere&rooms=24381_35580&tubes=1`（`03c…`，414 ms；不带 428 ms） | `total_count 1298` 不变；`total_tube_count 162`，每段 `distance ≤ 3000`；整房树的 159 段 ⊆ 这 162 段（cube 外扩 0 = 与房间盒相交 ⊂ 到房间盒 ≤ 3 m）；多出的 3 段：2 段一端仍是 R432 成员、离房间盒 34 / 17 mm（`24381_105297` / `24381_148125` 的 BEND→BEND），1 段 6.4 m 长、离盒 1.29 m、两端都在 3 m 外（`24381_105222`）——两端都不在范围里、按单元的房兜底那一档 |
| `?tubes=1&nouns=PANE` / `&nouns=ELBO` / `&nouns=ELBO,TUBI` / `&keyword=ELBO` | `0` / `0`（4 个 BRAN 单元在、直段不出）/ `24` / `0`——过滤链按 spec 走 |
| `?tubes=abc` / `?tubes=0` | `400 tubes 只接受 true/false（收到 abc）` / 与不带相同 |
| 100 m + 60 间房 `tubes=1`（`05c…`，3092 ms；不带 3108 ms） | `total_tube_count 1893`、759 个 BRAN 单元放置、`tubes_truncated false`（去重后的 BRAN 根 < 500 预算）、`leaf_count 26466 > 5000` → 全部省略；`unit=24381_145594` 只内联点到的单元（4 间房里都带 `tubes`），别的单元 `elements` / `tubes` 都没有 |

**追笔为什么**（`86bf22f51` → `2aab735df`）：第一版整房 168 段里 **8 段两端都不在本房构件里**——BRAN `24381_105498` 的 `BEND→BEND→UNIO→VALV→REDU→TEE→BEND` 连续六段、`24381_105860` 两段，
`distance 0` 穿过 R432 的房间盒，两端管件在范围里却被 `rooms=` 判成非成员（邻房的）。小计划 D4 的兜底「两端都解不出按单元的房归」把它们也收了进来；收窄成「任一端在范围里（是候选）却不是所选房间成员 = 属于别处、不列，
两端都不在范围里才兜底」后整房 168 → **159**、3 m 球 284 → **162**、100 m 多房 2260 → **1893**，单测夹具加一个范围里的非成员 GWALL + 一段挂它的直管钉住。

**前端**（T3）：见 §11。

## 11. 树里列出直段——前端 T3 真机（2026-09-22 16:2x–16:4x；`ui/tubes-tree-01…04-*.png`、`ui/tubes-tree-summary.json`、`e2e-tube-rows-both-specs-2026-09-22-1629.txt`）

同一台 dev `:3111`（工作树 = 本笔）+ `:8027`（`2aab735df`，§10），Playwright 无头 1600×1000，仓外一次性脚本 `.scratch\tubes-verify\ui-tubes.mjs`；页面不带模型（场景空，只看树与选中）。
改动：`SpatialSource.tree()` / `roomTree()` 恒带 `tubes=1`；抽屉 BRAN 单元下新 `SpatialResultTreeTubes.vue` 直段行、单元行尾「N 段直管」、各层 title 与摘要的计数句；
房间页签 `roomTreeNodes` 多 `tube` 节点、`ModelTreeRow` 只读行；`useSpatialQuery.focusTreeTube` / `useRoomTree.flyTo` 按直段盒飞（`resolveSceneWorldTransform` mm → 场景）。

| 步 | 动作 | 看到（`tubes-tree-summary.json`） | 图 |
| --- | --- | --- | --- |
| 1 | 抽屉：R432 盒中心 3 m 球 + 房间 R432 → 树；展开首个 BRAN 单元 `/Copy-of-1RCS0307-1R90004`（`24381_148125`） | 请求 `nearby/tree?x=…&radius=3000&shape=sphere&rooms=24381/35580&tubes=1`；树 `total_count 1055 / total_tube_count 78 / leaf_count 1133`；摘要「**共 1055 项（去重）· 78 段直管 · 1 间房**，已加载 0 项，未加载 1055 项」；单元行「/Copy-of-1RCS0307-1R90004 · 0.21 m · **9 段直管** · 11」，title「… · 11 个构件 · 9 段直管」；11 个构件行之后 **9 条直段行**：「直管 BEND → BEND 1.35 m」「直管 WELD → BEND 433 mm」「直管 BEND → BEND 500 mm」…，title「直管 BEND → BEND · 1.35 m · 距 0.19 m · 24381_148127 → 24381_148128」，`data-tube-key` = `24381_148125#24381_148127-24381_148128#0` | `tubes-tree-01-drawer-bran-unit-with-tube-rows.png` |
| 2 | 点第一条直段行 | 全局选中 = **`24381_148125`**（所属 BRAN）：PDMS 树展开到 `BRAN Copy-of-1RCS0307-1R90004`、属性面板切到它（TYPE BRAN）；相机按直段盒 `[-6219.8, -11489.16, 3817] → [-6186.4, -11455.76, 5168]`（mm → 场景）飞（场景为空，飞行只在单测里钉） | `tubes-tree-02-drawer-tube-row-click-selects-bran-and-flies.png` |
| 3 | 房间页签：搜 R432 → 展开 → 仪表系统 → BRAN → 单元 `Copy-of-1RCS383MP-YK/307VP`（`24381_105297`，1 管件 + 1 直段） | 请求 `rooms/24381_35580/tree?tubes=1`（`1298 / 159 / 1457`）；房间行「ROOM R432 · /1RX-RM04-R432 · **1298 个构件 · 159 段直管**」；单元行「BRAN Copy-of-1RCS383MP-YK/307VP · 1 · **1 段直管**」；构件行 `BEND 24381/105298` 之后一条 **`TUBI BRAN → BEND · 96 mm`**（`data-node-type TUBI`、`data-read-only true`、行内 **0 个按钮**——没有展开箭头、没有眼睛；title「直管 BRAN → BEND · 96 mm · 距 0 m · 24381_105297 → 24381_105298 · 属 BRAN 24381_105297」）；点它 `data-selected=true`、全局选中 = `24381_105297`、属性面板显示该 BRAN | `tubes-tree-03-room-tab-bran-unit-tube-rows.png` |
| 4 | 右键那条直段行 | 菜单只有 **「聚焦飞行」「查看属性」**（没有隔离 / 显隐 / 加载模型——直管随单元级动作走） | `tubes-tree-04-room-tab-tube-row-context-menu.png` |

`pageerror` **0**。单测：`spatialTree` +3（键 / 标签 / 长度 / 计数句、`treeNodeTubes` 去重且不进 refno 集、`mergeTreeLeaves` 连 `tubes` 一起并 / 老服务端只填 `elements`）、`SpatialResultTree` +1（直段行 / 尾巴 / title / 无效小标 / focusTube / 老服务端照旧）、
`roomTreeNodes` +1（`tube` 节点、三个 `*Under` 跳过、老服务端没有）、`useRoomTree` +1（flatRows 顺序、点行回 BRAN、聚焦按盒飞、眼睛无效、单元级动作不变）、`spatialSource` 扩 1（映射 + 老服务端一个直段键都没有）→ 11 文件 163 过；
type-check 新增 0；eslint 触及文件 0 错误（`useSpatialQuery.ts:198` 一条既有的空行 warning 不是本笔）。
**e2e**：两份 spec 各 +1，同机 `--workers=1` **15 passed / 1 skipped（1.0 m）**，日志 `e2e-tube-rows-both-specs-2026-09-22-1629.txt`——抽屉那条断 `nearby/tree` 带 `tubes=1`、直段行数 = 响应里该单元 `tubes.length`、构件行在前、无效小标数、摘要「M 段直管」、点行全局选中 = BRAN；
房间页签那条断 `rooms/{refno}/tree` 带 `tubes=1`、房间行 / 单元行的「M 段直管」、TUBI 行数 = 响应、紧跟最后一个构件行、`data-read-only` 且 0 个按钮、点行选中 BRAN、右键两项。两条在老服务端（响应没有 `total_tube_count`）上整条跳过。
**不做**（D5 (ii) → T4）：逐段眼睛；**T2**（`model/records` 直段元数据 + `tubi_relate` 落 `route_ordinal`）仍是后端另一笔。

## 12. 直段身份对上场景对象——后端 T2 真机 + 前端 T4 逐段眼睛（2026-09-22 20:28–21:2x；`http/00d-t2-records-tube-summary.json`、`e2e-tube-eyes-both-specs-2026-09-22-2117.txt`）

**T2 后端**（gen-model-model-cache `6ad84ca80`，账在它的 changelog）：`:8027` 三换——20:28 收掉 `2aab735df`（pid 88560），`Win32_Process.Create` 起 `aios-database-2aab735df-t2.exe`
（`0.1.30+g2aab735dfa9e.1790079793.dirty`，= `2aab735df` + T2，出自钉住旧 vendor 的 worktree `.scratch\t2\`——主仓当时因 vendor `e3d-io` 新变体编不过），7997 整库 ensure 6772 根 / `failed 0` / 79 s。
仓外脚本 `.scratch\tubes-verify\t2-records-check.ps1`（换前 `-Phase before` 先把 R432 整房 28 根 BRAN 的 `model/records` 存下）→ 换后 `-Phase after` **11 / 11**（`00d…`）：
826 条记录里 **340 条 TUBI 条条带 `tube{ordinal, from, to}`**、构件记录与 EQUI 根一条不带；同 BRAN 内 `(from, to, ordinal)` 唯一；`rooms/24381_35580/tree?tubes=1` 的 **159 段直段逐条**
在所属 BRAN 的 `tube` 里找得到（树与记录同一四元组坐实）；去掉 `tube` 后 28 根 `items` 与换前旧二进制**逐字相同**；`spatial-tree-check.ps1 -SkipEnsure` **41 / 41**。
本房 `ordinal` 全 0（同 `(from, to)` 多段本就罕见）；走的是投影路（`source=model-memory`，mem 档全库常驻），冷读路与补号由后端 `mem://` 单测钉。

**T4 前端**（本仓）：`GeomInstQuery.tube?` → `instanceMapping` 折进直管实例的 `uniforms.tube` → `useDbnoInstancesDtxLoader` 登记 `tubeKey(BRAN, 段) → objectId` →
`DtxCompatScene.setTubeSegmentsVisible(keys, visible)` 只动那一个对象（对象级覆盖表 `dtxHiddenTubeKeys`，不进 refno 状态表；`setObjectsVisible(BRAN)` / 显隐回放一来按 BRAN 清）；
抽屉直段行多一颗眼睛（`spatial-tree-tube-visibility`，三态），房间页签 `tube` 节点不再只读、眼睛走 `useRoomTree.setVisible` 的直段分支、右键多「显示 / 隐藏」。
单测：`instanceMapping` +1（记录一级 `tube` → `uniforms.tube`、两端归一、构件 / 老服务端 / 缺端不给）、`useDbnoInstancesDtxLoader` +1（登记 / 跨库查 / 没身份的直管不登 / 覆盖表标清）、
`DtxCompatViewer` +1（只藏一个对象、refno 状态不动、覆盖只记作用到的键、refno 级显隐与回放清覆盖）、`useSpatialQuery` +1（`toggleTreeTubeVisible` 三种回答与方向）、
`SpatialResultTree` 扩 1（眼睛三态 / `data-tube-*` / 发 `toggleTubeVisible`）、`useRoomTree` 扩 1（未加载 `tube-not-loaded`、装进来只叫 `setTubeSegmentsVisible`、勾选与父链半选、覆盖表同真相）→ 11 文件 176 过；
type-check 新增 0；eslint 触及文件 0 错误（`useSpatialQuery.ts` 那条既有空行 warning 不是本笔）。
**e2e**（同机 `:8027` T2 二进制 + Playwright 自起的 dev `:3101`，`--workers=1`）：两份直段 spec 各扩一段——
抽屉：直段行有自己的眼睛、`data-tube-loaded=false`；点眼睛 → toast「这段直管还没装进场景…」、覆盖表没记；单元「加载」→ `isDtxTubeSegmentLoadedAcrossAllDbnos(key)` 为真、行 `data-tube-loaded=true`、`scene.isTubeSegmentVisible(key)=true`；
点眼睛 → `data-tube-hidden=true`、`isTubeSegmentVisible=false`、所属 BRAN 的 `scene.objects[bran].visible` 不动、同 BRAN 别的段仍可见；再点回来；再藏一段后单元「仅显示」→ 覆盖被清、这一段亮回来。
房间页签：TUBI 行不再 `data-read-only`、恰 1 个按钮（眼睛）、右键「聚焦飞行 / 显示 / 隐藏 / 查看属性」；未加载点眼睛 toast；单元「加载模型」后点眼睛只藏那一段、BRAN 的 refno 状态不动；再藏一段 → 单元行眼睛隐 / 显 → 这一段跟着亮、覆盖表清空。
首跑抽屉那条败在悬停：三个小动作 `invisible`、要悬到单元标题行上（悬整个单元容器会落到展开后的子行），改悬展开箭头后过；复跑两份 **15 passed / 1 skipped**（见日志）。`pageerror` **0**。
