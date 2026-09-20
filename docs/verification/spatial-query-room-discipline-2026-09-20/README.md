# 空间查询 · 房间过滤 + 专业过滤——HTTP 金样 + 真 UI 完整流 + e2e 首次真机（2026-09-20 13:15–13:37；复验 15:49–15:58；查询中心对拍 16:17–16:38）

计划：`docs/plans/2026-09-20-spatial-query-room-and-discipline-filter-plan.md`（§6 真机步骤；本文是它的记录）。决策 ADR 0067、共识 zhimo `d-137`。
后端 `gen-model-model-cache` PR-A `3707c5b1d` + 复审修正 `805170bd4`（`spawn_blocking` / 记忆锁 / `sort=spec_distance`）；
前端 plant3d-web PR-B `155becef` / PR-C `2c7f65a3` / PR-D `c2c2942a` / 复审 `f852ced1`（验证时 HEAD `f852ced1`，工作树里别的会话的版本对比 / 模型树改动在途、与本轮无关）。
脚本：HTTP 金样与真 UI 流的脚本在仓外（`%TEMP%`，一次性）；e2e 那份在仓（§5）。

## 1. 环境：并排起的 `:8027`（mem 档、`room_membership=true`）

| 项 | 值 |
| --- | --- |
| 二进制 | `_runs\spatial-rooms-8027\aios-database-805170bd4.exe`，`/health` `build_id = 0.1.28+g805170bd41d7.1789880404`，`version 0.1.28`——干净 worktree `.scratch\wt-spatial-rooms-805170bd4`（detached @ `805170bd4`）`cargo build --release --features http_api --bin aios-database`，独立 `CARGO_TARGET_DIR=D:\Rust\target-spatial-rooms`（13:03 出 exe，214 MB） |
| 配置 | `DbOption.toml` 从 `surface-clearance-8024` 复制，只改两处：`http_api_addr = "127.0.0.1:8027"`、`room_membership = true`（介质由 `AIOS_STORE_MODE=mem` 决定，`store_mode` 键已随 ADR-080 失效）；`watch_dbnums = [7998, 8000]` 沿用；`manual_db_nums = [7997, 7998, 7999, 8000]` |
| 形态 | `data_face = read-through`，`sul_db.medium = mem / durable = false`（`embedded:mem`），`project AvevaMarineSample / mdb /ALL / namespace 1516`，MDB 闭包 29 个库全部装载 |
| 房间体制 | `features.room.status = available / executor = memory`；常驻房间模型启动即就绪：**215 间房 / 230 块在册面板 / 230 块有几何 / 0 块无几何**，网格 230/230 预热 0.6 MB，228 ms（`room_build.resident.startup.summary`），`generation 72979202d2…394211` |
| 起点 | 13:15:03 起，`/health ok`；13:15:18 首拍（`http/01-health.json`）：`spatial_tree.state = ready_empty / entries 0`、`model_cache.resident_records 0 / roots 0`——整棵树与投影都要靠下面的整库 ensure 长出来 |
| 前端 | dev `:3111`（别的会话起的 vite，工作树 = `f852ced1` + 他们的在途改动），页面 `?model_source=gen-model-v1&gm_backend_port=8027` |

起服务（cwd = 运行目录；与 09-17 `:8024` 同法）：

```powershell
$run = 'D:\work\plant-code\old\_runs\spatial-rooms-8027'
$env:DB_OPTION_FILE = "$run\DbOption.toml"; $env:PLANT_ASSET_ROOT = "$run\assets"
$env:AIOS_E3D_SCHEMA_ROOT = 'D:\work\plant-code\old\vendor\e3d-io\schema'; $env:RUST_MIN_STACK = '134217728'; $env:AIOS_OPEN_BROWSER = '0'
$stamp = Get-Date -Format yyyyMMdd-HHmmss
(Start-Process "$run\aios-database-805170bd4.exe" -ArgumentList serve -WorkingDirectory $run -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$run\logs\$stamp.stdout.log" -RedirectStandardError "$run\logs\$stamp.stderr.log").Id | Set-Content "$run\service.pid"
# 停掉：Stop-Process -Id (Get-Content $run\service.pid)
```

## 2. 数据：AMS 7997 整库 ensure，挑一间房

1. `GET /api/v1/spatial/rooms`（`http/02-spatial-rooms.json`，235 ms）→ `status ready`、`reason null`、**215 间**（7997 库 214 间 + 8000 库 1 间；10 间 `panel_count = 0`），按 `room_num`、refno 排；`definition_version` 与 `/health` 的房间 generation 同一串。
2. `POST /api/v1/dbnums/7997/model/ensure` → 202，任务 `dbnum-model-ensure-7997-20260920-131518-000000`：6772 个根，`already_ready 0 → newly_ready 6772`，`failed 0 / missing 0`，`room_edges_written 66 135`、`rows_upserted 66 442`、43 次提交（`durable=false`，只进进程内存），**90 s**（13:15:19–13:16:46；`http/03-dbnum-7997-model-ensure-task.json`）。之后空间树 61 807 条（100 m 查询的 `candidate_count`；15:5x 复验时 61 801 条 / 47 751 个 refno，见 §6）。
3. 选房（`http/04-room-pick.json`）：对 12 间 `panel_count ≥ 2` 的 `1RX` 房间各打一次「以房间盒中心为圆心、r = 3 m」的 `nearby`（不带 / 带 `rooms=`），要 `0 < 带 rooms 的 total < 不带的 total`。全部 12 间 `unresolved = 0`；`R971` 命中 0、`R445` 命中 2，最后取命中最多的 **`R432` = `24381_35580` `/1RX-RM04-R432`（2 块面板；名字「反应堆冷却剂泵环路 3」）**：`1303 / 3934`。
   中心 = `nearby?refno=24381/35580` 回的 `refno_aabb_center` **(−6379.5703, −11350.16, 5030)**，下面所有查询都用它 + `radius=3000&shape=sphere`。

## 3. HTTP 金样（13:16:49–13:17:04；`http/00-summary.json` **50 项检查 50 过 / 0 败**）

> 本节金样以 **refno 中心**（`?refno=24381/35580`）为圆心，`radius=3000` 量的是**到 R432 房间盒的最小面距**——所以基线 3934 / rooms 1303 比 §4/§6 的点中心版（1302 / 1059）大，房间自己的墙 `distance 0`。两种中心都对、都在当前树复现，见 §6 发现 A；同一节内的所有恒等式自洽。

| 组 | 请求 | 结果 |
| --- | --- | --- |
| 基线 | `nearby?…&per_page=1000`（`05-nearby-baseline.json`，31 ms） | `total_count 3934 / candidate_count 3940`；响应键集与改前一字不变、**不带 `room_status`**；每条 `results[].spec_value` 都是整数；`spec_groups {0: 198, 3: 3497, 4: 113, 5: 126}`，`filter_options.spec_values` 同一组数 |
| 房间 | `…&rooms=24381_35580`（`06-nearby-rooms.json`，466 ms） | `total_count 1303 < 3934`；`room_status = { rooms: [{24381_35580, R432}], source: "memory", matched: 1298, unresolved: 0, library_alignment_current: null }`，`warnings []`；本页 1000 条与全集 1303 条都 ⊂ 基线全集（`nearby/refnos` 不带 rooms）；`spec_groups {0: 10, 3: 1293}` 之和 = `groups(dbnum) {7997: 1303}` 之和 = `filter_options.spec_values` 之和 = 1303；本页 `spec_value` 分布 `{0: 10, 3: 990}`（非全 0） |
| 两间 | `…&rooms=24381_5062,24381_35580`（L505 + R432；`07b-nearby-two-rooms.json`） | 200，`total 1303 ≥ 单间`，`room_status.rooms` 两条（L505 在别处、对本圆无贡献） |
| 交叉核对 | `POST /api/v1/query` `e3d.room.lookup`（`07-room-lookup-crosscheck.json`） | 命中样本 16 条里答得出的 **11 条全部**列出 `R432`（多为 3 间房共有：R432 + R143 + R144）；被滤掉的样本 16 条里答得出的 **9 条全部**不含 R432。答不出的 5 + 7 条回 `409 {"code":"updating","message":"model is not ready"}`（GWALL / STWALL 那些），见 §6 发现 C |
| 专业 | `…&rooms=…&spec_values=3`（`08-nearby-rooms-spec.json`，447 ms） | `total 1293` = 上面 `spec_groups[3]`；结果全是 3；**`filter_options.spec_values` / `filter_options.nouns` 与不带 `spec_values=` 时逐字相同（选中不收窄清单）**；`spec_groups` 只剩 `{3: 1293}`。`spec_values=0,3`（`08b`）→ 1303 = 两桶之和 |
| 排序 | `…&rooms=…&sort=spec_distance&per_page=652&page=1|2`（`09-…-p1/p2.json`） | 652 + 651 = 1303 条，两页并起来 = `refnos(rooms=)` 全集（多重集）；页内 `spec_value` 升序（p1 前 10 条是 0、后面全 3）、同专业距离升序；**跨页**第 1 页末 3 ≤ 第 2 页首 3；`sort=SPEC_DISTANCE` 大小写不敏感 |
| 全集 | `nearby/refnos?…&rooms=…`（`10-nearby-refnos-rooms.json`，460 ms） | `refnos` 1303 条 = `total_count` = nearby 的 `total_count`；`by_spec_value {0: 10 条, 3: 1293 条}` 之和 = 1303；nearby 本页 ⊂ 它；带同一份 `room_status`。不带 rooms 的 `refnos`（`05b`）：3934 条、无 `room_status` |
| 出错 | `rooms=1_1` / `rooms=abc` / `spec_values=x` / `sort=bogus`（`11`–`14`） | 都是 `400 bad_request`：「rooms 里的 1/1 不是在册房间（名字不含房间关键词或房间号不合规），可先 GET /api/v1/spatial/rooms 看清单」/「rooms 必须是逗号分隔的房间 refno（a/b 或 a_b，收到 abc）」/「spec_values 必须是逗号分隔的专业值整数（收到 x）」/「sort 只接受 distance/name/spec_distance（收到 bogus）」；`rooms=`（空串）= 不给：200、无 `room_status` |
| 100 m | 同心 `radius=100000`（`15-timing-100m.json`） | 首发 **1096 ms**（61 807 候选全部派生专业：记忆冷，`spec_groups {0: 16029, 3: 31129, 4: 13517, 5: 1132}`）→ 第二发 **247 ms**（记忆热）；`+rooms=` **3381 ms**（`total 1303 / matched 1298 / unresolved 0`）；`sort=spec_distance` 318 ms |

**未验**（本机没有条件）：`room_membership=false` 实例上 `/spatial/rooms status=disabled` 与带 `rooms=` 的 `422 rooms_unavailable`（`:8022` 是 ADR 0067 之前的 `a382b2cf3`、此刻也没在听；单测覆盖）；落盘形态（`room_relate` 边、`library_alignment_current`）——只有 mem 档实例，`source` 始终 `memory`。

`http/05`–`09` 各文件的 `results` 只存了前 25 条（整页 1000 / 652 / 651 条太大），`total_count` / `returned_count` / facet / `room_status` 是整的；全集看 `05b` / `10` 的 `refnos`（3934 / 1303 条一条不少）。

## 4. 真 UI 完整流（13:32–13:33；Playwright 无头，脚本在仓外；`ui/`）

页面 `http://127.0.0.1:3111/?model_source=gen-model-v1&gm_backend_port=8027`，抽屉「范围」Tab，手输 R432 盒中心、r = 3 m、每页 100、缺省排序「按专业」（v1 源现在发 `sort=spec_distance`）。全部数字见 `ui/ui-room-filter-flow-summary.json`，`pageerror` 0。

| 步 | 动作 | 看到 | 图 |
| --- | --- | --- | --- |
| 1 | 不带房间查一次 | 请求 `x/y/z + radius=3000 + shape=sphere + sort=spec_distance + include_negative=false + page=1 + per_page=100`；摘要「共 **1302** 项，当前页 100 项」= 服务端 `total_count` | `ui-01-baseline-no-room.png` |
| 2 | 展开「更多条件」：房间块与专业块都在；房间搜索框占位「搜索房间号 / 名称（在册 215 间），回车按房间号精确加入」；输 `R432` → 下拉 1 项 → 回车 | chip **「R432 · /1RX-RM04-R432」** | `ui-02-room-search-dropdown.png`、`ui-03-room-chip-selected.png` |
| 3 | 「执行空间查询」 | 请求多了 `rooms=24381/35580`；摘要「共 **1059** 项」= `total_count`，`room_status.matched 1055 / unresolved 0 / source memory`，`warnings []`；专业 chips「仪表(1051) 其他(8)」 | `ui-04-room-filtered-results.png` |
| 4 | 「结果分组」缺省**按专业**（组标题「未知或其他」「仪表系统」）→ 点「按库」 | 组标题变「库 7997」；再切回按专业 | `ui-05-group-by-dbnum.png` |
| 5 | 结果区「房间列表」（经 store `roomsOf` → v1 `e3d.room.lookup`，不再打 `:3100`） | 「当前页涉及 **7** 个房间」：R132 / R143 / R144 / R231 / R332 / **R432（92 项）** / R532，每行 refno + `FRMW` + 「信息 / 显示」 | `ui-06-room-list.png` |
| 6 | 点专业 chip「仪表(1051)」再「执行空间查询」 | 请求多了 `spec_values=3`；摘要「共 **1051** 项」，结果全是仪表；清掉 chip 重查回到 1059 | `ui-07-room-plus-spec-chip.png` |
| 7 | 清空房间 → 重查 | 请求不带 `rooms`，摘要回到 1302 | — |
| 8 | `?model_source=legacy` | `room-filter` 整块不画（`capabilities.rooms = false`；`:3100` 没在听，树是空的，其余 UI 同改前） | `ui-08-legacy-no-room-block.png` |

> 这里的 1302 / 1059 与 §3 的 3934 / 1303 是**两种查询中心**的两组数（半径 / 房间相同）：§3 金样用 refno 中心（`?refno=`，量到 R432 盒的最小面距），本节 UI 用点中心（`?x/y/z=`，量到中心点）——同一棵树上都复现，见 §6 发现 A。两组数各自都满足契约里的全部恒等式。

## 5. e2e `e2e/spatial-query-gen-model-v1-ui.spec.ts` 首次真机：**9 passed / 1 skipped**

`PLAYWRIGHT_PORT=3111 GEN_MODEL_V1_BASE_URL=http://127.0.0.1:8027 npx playwright test e2e/spatial-query-gen-model-v1-ui.spec.ts --workers=1`：
13:37 上一会话首次跑绿（当时 `test-results/.last-run.json` 记 `passed`），15:49 本会话复跑 **9 passed / 1 skipped（拾取中心要 `--headed`），36.8 s**。这份 spec 09-13 入仓时标「未真机验证」，本轮为它改了两类东西（同一 commit）：

- **口径翻过来（ADR 0067）**：第 1 条原断言 v1 下 `spec-filter` 与「按专业」排序档**不存在**，现改为 `spec-filter` / `room-filter` / `spatial-sort-specThenDistance` **都在**，并加一段：点「按专业」→ 请求 `sort=spec_distance`、页内 `spec_value` 非降、同专业内距离非降。`expectedRowOrder` 缺省按专业分组（v1 抽屉缺省即按专业），`StoreResultItem` 加 `specValue`。
- **三处不是功能问题的真机修正**：(1) 测试里裸 `import('/src/…')` 在 HMR 过的 dev 上会另起一份模块实例（store 不是页面那份，还撞 vue-query 注入报错）——helper 加 `installAppModuleResolver`，从 `performance.getEntriesByType('resource')` 找页面实际加载的带 `?t=` 戳的 URL；(2) Windows 上 Chrome 剪贴板回读是 CRLF，按 `/\r?\n/` 切；(3) 树里同一 refno 多条条目（发现 B），store 按 refno 合并成一条：服务端页序按去重后的集合比，「已加载」按 store 条目数比（不再等于服务端 `returned_count`：本机那一页 37 条 / 去重后 22 项）。

`eslint` 两个 e2e 文件 0；`npm run type-check` 基线外仍只有别的会话那条 `versionSource.test.ts`（e2e 不在 tsc 范围，Playwright 自己编译、跑过即证）。

## 6. 复验（15:49–15:58 同进程；16:17 重启复验 + 16:38 两种查询中心对拍）与顺手发现

`http/16-recheck-1555.json`：同一套恒等式换一份脚本再跑一遍，**39 项 39 过 / 0 败**——基线 `1302`（`candidate 1302`、1227 个 refno）；`rooms=` **1059**（`matched 1055 / unresolved 0 / memory`，`spec_groups {0: 8, 3: 1051}`，三处和都 = 1059）；`spec_values=3` 1051；`sort=spec_distance` 530 + 529 两页并起来 = 全集、跨页 3 ≤ 3；`refnos` 1059、`by_spec_value {0: 8, 3: 1051}`；五条出错路径同 §3；100 m 296 / 249 ms、`+rooms=` **4931 ms**、`spec_distance` 191 ms。真 UI 流同参重跑：1302 → 1059 → 1051 → 1302，房间列表 7 间，`pageerror` 0（截图没覆盖 `ui/`，数字与 13:33 那份逐格相同）。

- **A · 3940 vs 1302 不是树变了，是两种查询中心——一段查错方向、最后翻案的排查**：`nearby` 的中心有两种。§3 金样（`05`/`06`/`08`/`09`）走 **refno 中心**（`?refno=24381/35580`，`center.source = refno_aabb_center`）：候选按 **`aabb_min_distance`——到 R432 整个盒的最小面距**算，`radius=3000` = 「离房间盒 ≤ 3 m」，整间房 + 3 m 边全收进来，房间自己的墙贴着盒 → `distance 0`。§4 真 UI（手输坐标）、§6 复验（`16`）、重启复验（`17`）走 **点中心**（`?x=&y=&z=`，`center.source = position`）：候选按 **`aabb_point_distance`——到中心点的距离**算，`radius=3000` = 「离那个点 ≤ 3 m」的小球。同一棵树上两者天生不同数。
  排查绕了一圈：先疑「发布后盒没安定」，又照用户指示 WMI 重启 + 整库 ensure + 每 2 s 采 176 次（`http/17-repro-tree-settle-*`，全是点中心）——点中心**全程 1302、探针墙 `24381_4102` 全程 5587.56**、`candidate_changed=null`，只证明点中心稳，没碰 refno 中心。**决定性一测**（`http/18-query-shape-refno-vs-point.json`，就在这棵已就绪的树上同时打两种）：**refno 中心 base 3934 / cand 3940 / rooms 1303**、**点中心 base 1302 / rooms 1059**——13:17 与 15:5x 那两组数在**当前树上一并复现**；`24381_4102` 在 refno 中心下 `distance 0`（它是 R432 的墙、贴房间盒）、点中心下 `5587.56`（离中心点 5.6 m），盒一字没变。**所以空间树没有任何异常、没有「安定窗口」、也不是一次性 bug；先前两版猜测都作废。** 差别纯粹是 §3 金样脚本用了 `refno=`、§4/§6/§7 的 UI 与复验用了 `x/y/z=`。
  → **对本期功能的影响：无。** 契约里每条恒等式（`total = spec_groups 和 = groups 和 = filter facet 和`、`refnos = total`、`by_spec_value` 桶和、跨页专业序、四条 400）在两种中心下**各自都成立**（§3 refno 中心 50 项、§6 点中心 39 项）。房间过滤 / 专业派生 / 分页只消费候选、不关心中心是 refno 盒还是点。**遗留的只是一致性小提醒**：金样与 UI 各用了一种中心，同名对比别混着比——要么都 `refno=`、要么都 `x/y/z=`。
- **B · 树里同一 refno 有多条条目**（基线也如此，与 `rooms=` 无关）：13:17 基线 3934 条 / 3707 个 refno（182 组重复，`24381_1143` 3 条），15:5x 1302 / 1227（50 组）；100 m 61 801 条 / 47 751 个 refno。`total_count` 按条目计、`room_status.matched` 按 refno 计，两者相差正好是重复条目数（1303 vs 1298、1059 vs 1055）。前端 store 按 refno 合并，抽屉「共 N 项」报的是服务端条目数——e2e 按此对齐（§5）。
- **C · `e3d.room.lookup` 对一部分构件回 409 `updating / model is not ready`**（GWALL `24381_4090` 等墙类；同批 `24381_101694` 200、列出 R432 / R143 / R144 三间）。`rooms=` 过滤不经 lookup（直接拿投影记录喂 `MemoryRoomCalculator`），所以这些墙照常被判归属；两条路径口径独立，lookup 那边为什么把墙判成 not ready 另查。
- **D · 读透形态现算成本量到了**：3 m（1302 候选）`+rooms=` 228–466 ms；100 m（61 801 候选）`+rooms=` 3.4–4.9 s——计划 §7「100 m 级要量」的答案；在 `spawn_blocking` 里，不拖别的请求。
- **E · 首个大半径查询的专业派生成本正卡在计划 §7 的 1 s 线上**：61 807 候选冷记忆 **1096 ms**（含树扫描与切页，专业派生是其中大头）→ 热 247 ms（§3）；只此一发、且在 `spawn_blocking` 里不拖别的请求。§7 写的退路是「> 1 s 退到按库预算一张 refno → 专业表」——要不要为这 96 ms 上那条退路，留给用户定。

## 7. 文件

| 文件 | 内容 |
| --- | --- |
| `http/00-summary.json` | 13:15–13:17 全流程汇总：50 项检查 + 2 条发现 |
| `http/01-health.json` `02-spatial-rooms.json` | 起点 `/health`（树空）与在册房间清单 |
| `http/03-dbnum-7997-model-ensure-task.json` | 整库 ensure 的 202 回执与终态 |
| `http/04-room-pick.json` | 12 间候选房的选房试探，`picked = R432` |
| `http/05-nearby-baseline.json` `05b-nearby-refnos-baseline.json` | 基线 nearby（结果截前 25 条）与全集 refnos（3934 条） |
| `http/06-nearby-rooms.json` `07-room-lookup-crosscheck.json` `07b-nearby-two-rooms.json` | `rooms=` 单间 / lookup 交叉核对 / 两间 |
| `http/08-nearby-rooms-spec.json` `08b-nearby-rooms-spec-multi.json` | `spec_values=3` / `0,3` |
| `http/09-nearby-rooms-spec-distance-p1.json` `p2.json` | `sort=spec_distance` 两页 |
| `http/10-nearby-refnos-rooms.json` | `refnos` + `rooms=`（1303 条、`by_spec_value`） |
| `http/11`–`14-error-*.json` | 四条 400 |
| `http/15-timing-100m.json` | 100 m 四发计时 |
| `http/16-recheck-1555.json` | 15:55 复验（39 项）含当时 `/health` 树状态 |
| `http/17-repro-tree-settle-1617.jsonl` `-summary.json` | 16:17 WMI 重启 + 整库 ensure + 176 次采样（点中心）：点中心稳定 1302、探针墙全程 5587.56（排查中间步，只证点中心稳） |
| `http/18-query-shape-refno-vs-point.json` | 16:38 决定性对拍：当前树上 refno 中心 3934/3940、点中心 1302，`24381_4102` 两种中心下 0 vs 5587.56——发现 A 定案：查询中心不同，非树异常 |
| `ui/ui-01`–`ui-08-*.png` `ui/ui-room-filter-flow-summary.json` | 真 UI 完整流八张截图与数字 |
