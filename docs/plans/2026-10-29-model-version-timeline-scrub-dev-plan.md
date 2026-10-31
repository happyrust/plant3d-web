# 模型版本时间轴拖拽浏览（model-version-timeline-scrub）开发计划 · 全量重排 · 2026-10-29

> ## 执行状态（2026-10-31 晚更新）
>
> **W0–W10 全部完成**，D9 / D10 / D11 已按推荐执行（用户 2026-10-31：「全部按推荐继续执行」）。
> 剩下的见紧接本节的「剩余工作」：W4 第 2、3 步（等主工作区处理那 6 个重叠文件），
> 以及修 W10 期间新复现的两条（W10-5、W10-6，待拍板 D12 / D13）。
> 本文件正文仍是 2026-10-29 的「待执行」措辞，作为历史依据保留；以本节和「剩余工作」为准看进度。
>
> | 阶段 | 状态 | 落地 |
> |---|---|---|
> | W0 入库与规格收尾 | 完成 | 两仓全部提交，规格 14 处修订已落盘 |
> | W1 后端编排与路由 | 完成 | `realtime_history/query.rs` 编排 + `model_history_geometry` handler |
> | W2 resolve / attributes-at / health | 完成 | 三条只读路由 + `/health` 分项 |
> | W3 后端测试补齐 | 完成 | 属性测试 29–39 与例子测试；`cargo test --lib` 2762 passed |
> | W4 集成验证与合入 | **部分** | 两个验证脚本全绿；第 1 步已做（rebase 到 `refactor`，`cargo test --lib` 2773 passed）；**合入未做**（见下） |
> | W5 前端纯函数测试补齐 | 完成 | 11 模块 + 16 测试文件 |
> | W6 前端接线 | 完成 | 三条路由客户端、`versionSource` 接线 |
> | W7 浏览主流程 | 完成 | `useVersionFrames` 约 880 行 |
> | W8 界面 | 完成 | `VersionTimelineScrubber.vue`、面板接入 |
> | W9 联调与性能 | 完成 | Requirement 12 七条指标全部落地 |
> | W10 审核发现修复 | 完成 | `02fefa7f` / `7c737d26` / `0f739544` / `ba74df9e`，性能复跑 `b3af89bd` |
>
> **验收结果**：前端全量 vitest 423 文件 / 4 158 passed / 1 todo（W10 后，+9）；`type-check` 新增 0；
> 两个联调脚本全绿（smoke 20 步 ok、vs-legacy 37 组合零不一致）；
> 性能 e2e 4 passed / 3 skipped / 0 failed（12.4 与版本表首帧按夹具跳过），W10 后复跑 12.1 / 12.5 / 12.6-12.7 仍 3 passed。
>
> **后端分支**：`feat/model-version-timeline-scrub` @ `d0f2a479c`（2026-10-31 由 `62619584f` rebase 到
> `refactor` @ `2badaf2e0`），领先 9 个提交、落后 0 个，工作树干净，没有推送到远端。
>
> **W4 合入**：第 1 步已做；第 2 步要等主工作区所有者先处理那 6 个重叠文件，见「剩余工作 · W4 收尾」。
>
> **期间修掉的实质问题**：27 条，见 `docs/verification/model-version-timeline-scrub/phase3-perf.md`。
> **一处规范冲突已裁决**：R6.3 / R8.10 选第 3 条出路（改 R8.10 措辞为「所有子节点」），
> 见 `docs/verification/model-version-timeline-scrub/finding-r6-3-vs-r8-10.md`。
> **2026-10-31 审核**：10-30 晚至 10-31 的四个修复提交（ba146905、307f97f7、31e5f250、e2d82c95）里
> 有 4 条问题待修，其中 2 条已用临时用例复现，列为 W10；307f97f7 没有问题。4 条已全部修完；
> 修的过程中又用临时用例复现了两条（W10-5、W10-6），未改，待拍板。

## 剩余工作（2026-10-31 重排，以本节为准）

顺序：**W10**（前端修复，只动本仓，每条一个提交、可逐条回滚）→ **W4 收尾**（后端合入，动 `refactor`，需确认）→
**未提交内容处置**（需确认）。W10 与 W4 第 1 步互不依赖，可以并行。

**2026-10-31 晚进度**：W10-1～4 完成，门禁全绿；W4 第 1 步完成；未提交内容已按 D10 (a) / D11 (b) 处置。
剩 W4 第 2、3 步，以及 W10-5 / W10-6（D12 / D13）。

### W10 · 审核发现修复（前端）

**W10-1 · 子树请求中止补全**（ba146905 没覆盖的两条路径，已复现）—— **已修 `02fefa7f`**

- 现象：`useVersionFrames.ts:609` `loadUnits` 的 `AbortController` 在任务真正开始时才创建，`exitBrowse` 只能中止并发上限内已经开始的那几个。`exitBrowse`（`:839`）在中止之后、`ctx = null`（`:855`）之前对每个缓存帧 `await releaseFrameGeometry(...)`，就在这几轮里 `runBounded` 启动排队任务，拿到的是未中止的 signal。另外 `fetchUnitAt`（`:648`）在 `await query(...)` 之后不查 signal 就 `commit(putFrame(...))`，而 `retryOnBusy` 的 `raceAbort` 只让上层先拿到 AbortError，不会停掉底下的请求。
- 实测（临时用例，已删）：10 个单元、前 4 个立即返回、其余挂起，退出后 unit_9 / unit_10 仍被发出且 signal 未中止；放行响应后，已清空的缓存从 0 变成 6。
- 修法：每次 `loadUnits` 先建一个共享的 `AbortController` 登记进 `subtreeControllers`（或改成会话级 controller：`enterBrowse` 新建、`exitBrowse` abort），所有任务共用它的 signal，任务开始前先查 `aborted`；`fetchUnitAt` 在 `await query(...)` 之后、`commit` 之前再查一次 signal 与会话（见 W10-2）。
- 测试：ba146905 那条用例里「退出后不落地」的断言没有约束力（假数据源永不返回，去掉修复也绿）。新增用例：有排队任务、退出后才放行响应，断言退出后没有新请求、`cacheKeys` 保持 0。回滚验证：去掉修复后该用例必须红。

**W10-2 · 会话守卫改为身份比较**（已复现，频率低）—— **已修 `7c737d26`**（保留 `mode` 检查，另加 `ctx !== context`；`fetchUnitAt` 响应回来后也查会话）

- 现象：`loadUnits` 落地前的守卫是 `mode.value !== 'browse'`（`:625`），退出后同一轮内重进时旧会话会越过它，用 `setTick(context.cursor, null)` 清掉新会话的「加载中」刻度。手动点击之间碰不到，程序里连着 exit → enter 的路径会碰到。
- 注释（`:623-624`）说「不能比 `ctx !== context`，`enterBrowse` 里 `ctx = { ...context }` 是新对象」，这个理由不成立：`requestCursorFrame` 与 `answerConfirm` 都是 `const context = ctx` 后往下传，`loadUnits` 收到的就是 `ctx` 本身，同一会话内恒等。
- 修法：守卫改为 `if (ctx !== context) return;`（或会话号），更正 `:623-624` 与 `:143-147` 的注释。
- 测试：退出后立即重进，旧会话的结果不得改写新会话的 `tickStatus` / `errors` / 角标。

**W10-3 · DTX 网格取回超时覆盖响应体**（31e5f250 补完）—— **已修 `0f739544`**（另补：重拉成功后各图层的兜底盒子换成真几何）

- 现象：`useDbnoInstancesDtxLoader.ts` 的 `ensureGeometryForGeoHash` 在 `fetch(meshUrl, { signal })` 返回响应头后立即 `clearTimeout`，后面的 `await resp.arrayBuffer()` 不受超时约束——响应体卡住时同一 geoHash 仍会永久挂起，正是这条提交要修的症状。超时只在 `debug` 时打日志；超时与 404 / 解析失败一样记进 `loadedGeoHash` + `failedGeoHash`，之后只有强制重载（`forceRetryNotFound`）才重拉。
- 修法：`clearTimeout` 挪到读完响应体之后（同一个 signal 也会中止响应体读取）；超时单独 `console.warn`，不受 `debug` 控制；超时不记 `loadedGeoHash`，下次调用可以重试，404 / 解析失败保持现状。
- 测试：假 `fetch` 先回头、响应体永不结束，假计时器推 8 s 后任务结束且 `loadingGeoHash` 清空；超时后再次调用会重新发请求。

**W10-4 · 面板进入浏览的重试循环**（e2d82c95）—— **已修 `ba74df9e`**（8 次失败的提示放在时间轴下方而不是视口角标：角标要浏览图层建好才显示，这时恰好没有图层。根治的实际落点见 W10-6）

- 现象：`ModelUnitVersionComparePanel.vue:769-783` 每轮都要等整帧加载完（秒级）；期间用户退出或面板卸载（`onBeforeUnmount` 里 `void frames.exitBrowse()`，`:968`），下一轮仍会再调 `frames.enterBrowse`，把浏览图层建回来，卸载后留下孤儿图层；8 次都失败时静默返回，没有日志也没有角标。这段没有单元测试。
- 修法：进入时取一个令牌（仿照面板已有的 `requestId`），每轮前检查令牌未变、组件未卸载、用户未退出；8 次失败打 `console.warn` 并给角标。根治（单列、可选）：让关对比之前就发出的 `open` 被取代后不再执行 `clear()`（控制器侧加世代号），之后可去掉重试循环。
- 测试：面板例子测试——重试期间触发退出 / 卸载，之后不得再调 `browseEnter`；连续 8 次图层未就绪时有告警。

**W10 门禁**：全量 `npx vitest run`、`npm run type-check` 新增 0、改动文件 eslint 干净；每条一个提交。W10-1 / 2 / 4 落地后，在 8022 后端起着时重跑性能 e2e 12.1 / 12.5 / 12.6-12.7，更新 `docs/verification/model-version-timeline-scrub/perf/`，`phase3-perf.md` 记一行。

- 结果（2026-10-31）：全量 vitest 423 文件 / 4 158 passed / 1 todo（+9）；`type-check` 439 / 439，新增 0；改动文件 eslint 干净；
  四条各一个提交，提交说明里都记了回滚验证。性能复跑（后端 `0.1.44+g1ca68639061e`）：12.1 worst 37 ms、12.5 最低 59 fps /
  吸附 ≤ 20 ms、12.6/12.7 `cacheKeys` 在 12 封顶、退出后归零，3 passed；证据 `b3af89bd`。

### W10 期间新发现（未改，待拍板 D12 / D13）

**W10-5 · 子树装载用的是「当前游标」，不是发起时那一版**（已用临时用例复现，用例已删）

- 现象：`requestSubtreeFrame(context, sesno)`（`useVersionFrames.ts:553`）拿到明确的 `sesno`，交给 `loadUnits(context, units)`（`:604`）后却处处读 `context.cursor`：排队任务开跑时才求值的 `fetchUnitAt(unitRefno, context.cursor, signal)`（`:618`）、`addError({ sesno: context.cursor })`（`:634`）、`setTick(context.cursor, …)` 与角标（`:641-644`）。`cursorChanged`（`:708`）就地改 `context.cursor`（`:711`）。`pendingConfirm`（`:601`）在游标移走后不清，`answerConfirm`（`:829`）按 `context.cursor` 装。
- 实测（临时用例）：游标 10 → 12 之后 10 那批才失败——10 的刻度一直「加载中」，12 的刻度被标「失败」（它自己那批还在加载），错误记在 12 名下，角标「sesno 12 · 1 个单元加载失败」。10 的待确认挂着时游标移到 12，答「全部装」，按 10 算出的 3 个单元全以 12 发出。子树范围下方向键连按就会碰到。
- 修法（推荐）：`loadUnits` 显式收 `sesno`，取数与结算都用它；结算时游标已不在 `sesno`，只结它自己的刻度与错误，不动角标、不 `showCursorFrame`；`requestSubtreeFrame` 在 `await diffSummary` 之后若游标已移走就清掉这一格返回；`cursorChanged` 清 `pendingConfirm` 及其刻度（不变式：待确认只属于当前游标）。不改对外类型。备选：游标一移就中止旧批次（丢掉在路上的有效帧，也与 `reassignOnCursorMove`「就近转预取、不中止」不一致）；或延后。
- 测试：上面两条临时用例转正；回滚验证。

**W10-6 · 对比装载中点「浏览」：装完的 `open` 拆掉浏览图层**（W10-4 根治的实际落点，已用临时用例复现，用例已删）

- 现象：面板 `enterBrowse`（`ModelUnitVersionComparePanel.vue:759`）只调 `closeCompare()`，它不作废在飞的对比装载——`runCompareUnits`（`:601`）装完（秒级）比的仍是 `requestId`，照样 `dispatch(view.detail)` 派 `open`；控制器 `open` 一开头就 `clear()`（`modelUnitCompareController.ts:937`），里面 `browseExit()`（`:779`）把浏览图层拆掉。这时重试循环早在第一帧装好后就返回了，兜不住；`frames.mode` 仍是 `browse`，面板显示「退出浏览」，视口却是对比。「浏览」按钮在对比装载期间可点（`VersionTimelineScrubber.vue:482`），`compare_autorun=1` 挂载即装载，最容易碰到。
- W10-4 原文的「控制器侧世代号」抓不到它：这次 `open` 是在浏览进入之后才派发的，控制器分不出它是旧的。
- 实测（临时用例）：对比装载挂起时点「浏览」，帧装好（`enter,pending:897,show:897`）后放行装载，面板又派了 1 次 `open`。临时改法——`runCompareUnits` 装载前记下 `browseRequestId`，装完不等就不派、几何还回去——加上后该用例转绿，面板其余 36 条不受影响；已还原。
- 修法（推荐）：即上面的临时改法（约 5 行，只动面板），`browseRequestId` 声明挪到 `requestId` 旁边；重试循环保留（它还兜视口没就绪时 `browseEnter` 静默返回的情形）。备选：按原文做控制器世代号（抓不到这条）；或延后。
- 测试：临时用例转正；回滚验证。

### W4 收尾 · 后端合入 `refactor`（需确认后执行）

2026-10-31 只读核查（`git merge-tree` 预演，没有动任何分支）：

- 特性分支改 24 个文件（+6 885 / −450）。预演只有 **1 处冲突**：`src/fast_model/spatial_centerline.rs`（特性侧 `89914b3f5` 改 1 行；`refactor` 侧 `9b539f814`、`6e881ecdf` 改了同一处测试夹具）。原先预期的三处现在都能自动合并。
- 真正的阻碍：主工作区 `old/gen-model`（检出 `refactor`）有 142 条未提交改动，其中 6 个文件与特性改动重叠：`docs/specs/web-service-api.md`、`src/fast_model/e3d_model_service.rs`、`src/fast_model/mod.rs`、`src/mbd/branch_query.rs`、`src/options.rs`、`src/web_service/handlers.rs`。在主工作区 `git merge` 会被拒绝；`tasks.md:204` 说的「用独立 worktree 合入」也行不通——`refactor` 已检出在主工作区，绕开它直接移动 `refactor` 引用，会让那 142 条改动看起来像在回退合入内容。
- 步骤：
  1. （不碰 `refactor`，可先做）特性工作树 `git rebase refactor`，解决 `spatial_centerline.rs` 夹具冲突，跑 §7 的 `cargo test --lib`。分支未推送，rebase 不需要强推。
     **已做（2026-10-31）**：`62619584f` → `d0f2a479c`（基于 `refactor` @ `2badaf2e0`）。`spatial_centerline.rs` 取 `refactor` 的 JSON `member()` 夹具，特性侧那 1 行随之不需要，该文件退出特性改动（24 → 23 个文件）；`branch_query.rs` 的 `bore: point.bore` 一处 `refactor` 已有，自动消掉，最终内容与 rebase 前一致；`Cargo.lock` 差异 441 → 107 行（`refactor` 已去掉 duckdb / arrow）。`cargo test --lib --no-default-features --features ws,gen_model,manifold,project_hd,http_api`：2 773 passed / 0 failed / 117 ignored。
  2. （需要主工作区所有者先处理）那 6 个重叠文件先提交或另存，然后在主工作区 `git merge --ff-only feat/model-version-timeline-scrub`（rebase 后可快进）。
     rebase 后复核（2026-10-31）：特性改 23 个文件，与主工作区未提交改动重叠的仍是上面这 6 个；`refactor` 仍在 `2badaf2e0`，可以快进。
  3. 合入 SHA 写进 `tasks.md` 第 8 组（`:207` 的「未做」改掉）；不合 `publish`、不部署、不推送。

### 未提交内容处置（需确认）

- `docs/verification/model-version-timeline-scrub/realtime-history-smoke.json`：只有数字变化（`cache_entries` 32→7、命中 / 未命中计数、耗时），是一次复跑覆盖了已提交的证据，换行为 CRLF。—— **已作为复跑证据提交 `708c809e`（D10 a）**
- `ui/版本管理/version-timeline.pen`：+843 / −355 的设计稿改动，来源不明。—— **不动（D11 b）**
- 不属于本计划、不动：`.planning/` 下 room-* / w41 / w54-* 数据与 `adjust_weld.live.rs.bak`、`src/dimension/kernel/layout/polar/place/`（MBD 标注工作线）。审核里 bbf3f367 的分帧批大小问题（只按第一批算条数）也归 MBD 标注计划。

### 待拍板（在 plannotator 里批注即可）

- **D9 · W4 怎么推进。** (a) 现在只做第 1 步（特性工作树 rebase + `cargo test`，不碰 `refactor`），第 2 步等主工作区那 6 个文件处理完再做（推荐：可回滚，只改未推送的特性分支）；(b) 第 1–3 步一起做，由你先处理主工作区；(c) W4 整体延后。—— **已定 (a)，第 1 步已做**
- **D10 · 冒烟复跑结果。** (a) 作为复跑证据提交（推荐，与 96d79c77「留复跑结果」一致）；(b) 还原成已提交版本。—— **已定 (a)，`708c809e`**
- **D11 · `.pen` 设计稿。** (a) 是本特性的改动就按 §6 单独提交；(b) 不动（推荐，来源不明时不替别人提交）。—— **已定 (b)**
- **D12 · W10-5（子树装载读当前游标）。** (a) 按 W10-5 的修法改（推荐：只动 `useVersionFrames.ts`、不改对外类型，两条复现用例直接转正）；(b) 游标一移就中止旧批次；(c) 延后。
- **D13 · W10-6（对比装载晚到的 `open` 拆掉浏览图层）。** (a) 面板侧作废在飞的对比装载（推荐：约 5 行，已试过能让复现用例转绿）；(b) 按 W10-4 原文做控制器世代号（抓不到这条）；(c) 延后。

依据是同日对 `plant3d-web/.kiro/specs/model-version-timeline-scrub/` 四份规格与四个工作区的只读审核，以及随后落盘的 14 处规格修订（§1.1）。所有结论带 `file:line`；行号以 2026-10-29 的工作树为准：plant3d-web `main` @ `a07e26b3`（工作区脏，107 条），gen-model 主工作区 `refactor` @ `1caf3a848`（12311 条未提交改动，本特性不碰），本特性后端工作树 `old/gen-model-timeline-scrub/` 分支 `feat/version-time-resolve-cases` @ `d82cd90ce`（18 条改动全部未提交），`old/vendor/e3d-model` `main` @ `f1f98b8`（停止钩子已提交）。

本文件只是计划，不改代码。按用户 2026-10-29 的选择做**全量重排**：18 个任务组全部重新排进 W0–W9；已完成的 41 个子任务不重做，只进 §4.0 的回顾与验收表。任务编号、属性编号沿用 `tasks.md` / `design.md`（Correctness Properties 1–39），验收以 `requirements.md` 为准；需要编译、跑测试、起服务的步骤都由用户在工作包末尾按 §7 自己执行。

## 0. 一句话

**后端纯逻辑已经写到路由门口，前端纯函数已经写完但属性测试只写了一半，接线与界面一行没有，而且这些代码一条提交都没有。** 所以顺序是：先把已有的东西入库、把规格里三处矛盾改掉、把 2.4 的并发结论补上（W0，规格部分今天已做）；再把后端剩下的编排 + 路由 + 测试补到能在 rocksdb 档 8022 上跑通两个验证脚本并合入 `refactor`（W1–W4），同时把前端纯函数缺的 14 条属性测试补齐（W5）；然后才接线、做界面、联调测性能（W6–W9）。后端与前端两条线并行，在 W9 汇合。

## 1. 现状与依据

### 1.1 规格修订（2026-10-29 已落盘，14 处）

| # | 文件:行 | 改了什么 | 为什么 |
|---|---|---|---|
| S1 | `plan.md:18` | 「开工前先对齐」改为记录 design §2.1 / §2.3 / 属性 1、2、5 已于 2026-10-29 对齐 | 原文仍写「待对齐」，实际早已改完 |
| S2 | `plan.md:20-21` | 两条 `[ ]` → `[x]`，附完成说明 | 设计稿 1.1 与共享样例 1.2 已完成 |
| S3 | `plan.md:23` | `HISTORY_BUSY`：游标请求按 `Retry-After` 自动重发最多 3 次、等待期间保持「正在加载」、用尽才标失败；预取遇忙不标失败；子树同样最多 3 次 | 原文「遇忙直接标失败」与 `requirements.md` 3.16 / 4.11 / 9.10、`design.md:57`、`busyRetry.ts` 的 `maxRetries = 3` 矛盾 |
| S4 | `plan.md:40` | 点名 `scripts/verify/realtime-history-smoke.ps1`、`realtime-vs-legacy.ps1` 放 plant3d-web `scripts/verify/`，记录写 plant3d-web `docs/verification/` | 原文没说脚本在哪个仓；`tasks.md:566` 的实施假设就此定稿 |
| S5–S10 | `tasks.md:40 / 89 / 252 / 316 / 358 / 411` | 2.2、4.4、9.10、11.4、12.6、14.3 → `[x]` | 代码与 `tasks.meta.json` 的 pbtResults 都证明已完成，状态是旧的 |
| S11 | `requirements.md:224`（R8.1） | 无偏移的 t 按「该版本表中 Chain_Order 第一条带 Session_Time 的行所用的时区偏移」解释；后端 `time` 选择器与前端降级同此规则 | 原文「按 Session_Time 所用的时区」没说是哪一行；`time_resolve.rs` 与 `timeResolve.ts` 实际都取链序第一条带时间行 |
| S12 | `requirements.md:289`（R12.4） | 加前提「Realtime_Result_Cache 已含目标版本条目」 | 未命中时 304 仍要先算完几何（`design.md:131-150`），200 ms 对未命中不成立；用户选「补前提，不改后端」 |
| S13 | `requirements.md:294`（验证口径） | 第 2、4 条先对目标 sesno 各发一次请求让缓存命中；第 3 条以缓存容量 0 启动 | 与 S12 配套，W9 的脚本按此写 |
| S14 | `plant3d-web/.planning/2026-10-29-model-version-timeline-scrub/` | 新建目录 | 放本计划的门禁结果 |

`design.md` 本次未改：§1.2 `query_realtime` 签名（`:244`）、§4.1 / §4.2 组合式函数（`:622` / `:653`）、§5 浏览接口（`:694`）、「阶段 1 后端集成验证」curl 清单（`:1179-1205`）、「合并前门槛」（`:1221`）仍是实施依据。

### 1.2 后端现状（`gen-model-timeline-scrub/`，全部未提交）

| 任务 | 位置 | 状态 |
|---|---|---|
| 2.1 / 2.2 停止钩子 | `vendor/e3d-model/src/pipeline.rs:468` `Stop`、`:481` `GenerationHooks`、`:533` `generate_subtree_with_hooks`；`tests/generation_hooks_real.rs` 两条用例（空钩子等价、第 k 个停） | 已提交 `f1f98b8` |
| 2.3 共用投影 | `src/fast_model/e3d_model_service.rs:4576` `project_historical_records`；例子测试 `:5836`、`:5881`；`historical_model.rs:1090` 源码钉 | 已写 |
| 2.4 网格并发写 | — | **没有结论、没有记录** |
| 3.1 配置 | `src/options.rs:1228` `bounded_setting`；四项 `model_history_*` 与 `AIOS_MODEL_HISTORY_*` | 已写 |
| 3.2 输入缓存 | `src/fast_model/historical_input.rs:38` `HistoricalInputLru` | 已写 |
| 3.3 取消与实时计算源 | `cancel.rs:15` `CancelToken`；`e3d_model_service.rs:3026` `realtime_compute_source` 与 `:2997` `generate_snapshot_source` 共用内部函数；源码钉 `:10601-10608` | 已写；**还没有调用方** |
| 4.1 / 4.4 时间点解析 | `time_resolve.rs:45` `parse_instant_text`、`:121` `parse_instant`、`:160` `select_latest_at`、`:188` `resolve_at_rows`；`historical_model.rs:731` `select_session_at` 薄包装；样例对拍 `time_resolve.rs:519`（`docs/fixtures/version-time-resolve-cases.json`，与 plant3d-web 副本 SHA-256 一致 `4E44A2E5…E756F`） | 已写 |
| 4.2 / 4.3 属性 29、31 | — | 未写 |
| 5.1 校验 | `realtime_history/validate.rs:111` `validate_request`；Property 33 proptest `:760` | 已写；proptest **未跑**（5.2 `[-]`） |
| 5.3 缺失判定 | `realtime_history/absent.rs:98` `classify_absent` | 已写；属性 34 未写 |
| 5.5 摘要 / 指纹 | `realtime_history/digest.rs:36` `geometry_digest`、`source_set_fingerprint` | 已写；属性 35 未写 |
| 5.7 结果缓存 | `realtime_history/cache.rs:112` `RealtimeResultCache` | 已写；属性 36 未写 |
| 5.9 并发闸 | `realtime_history/gate.rs:29` `retry_after_secs`、`:37` `RealtimeGate` | 已写；属性 37 未写 |
| 6.1 编排 | `realtime_history/mod.rs` 只有 `pub mod` 与 re-export，**没有 `query_realtime`** | 未写 |
| 6.2–6.5 路由 / resolve / attributes-at / health | `web_service/mod.rs`、`handlers.rs` 在工作树里**未改动** | 未写 |
| 6.6–6.10、7.1、7.2、8 | — | 未写 |

其他：`src/mbd/branch_query.rs` 也在改动列表里，归属待核（W0-3）；`Cargo.toml` 的 `e3d-model` 走路径依赖 `../vendor/e3d-model`，钩子提交 `f1f98b8` 对工作树即时生效。

### 1.3 前端现状（plant3d-web，特性文件全部未跟踪）

| 任务 | 位置 | 状态 |
|---|---|---|
| 9.1 fast-check | `package.json` devDependency `fast-check ^4.10.2`（`package.json` / lock 为 `M`） | 已写 |
| 9.2 端口类型 | `src/model-source/ports.ts:341`、`:355`、`:644`；`modelVersionErrors.ts:65` `HistoryQueryError` | 已写 |
| 9.3 / 9.9 / 10.1 / 10.6 / 10.8 / 11.1 / 11.3 / 11.6 / 12.1 / 12.6 / 12.10 纯函数 | `src/utils/versionScrub/` 11 个模块：`tickLayout.ts`、`scrubFormat.ts`、`cursorNav.ts`、`dwellGate.ts`、`pins.ts`、`frameCache.ts`、`prefetchPlan.ts`、`busyRetry.ts`、`timeResolve.ts`、`scrubUrl.ts`、`subtreeFramePlan.ts` | 全部已写 |
| 属性测试 | 7 个 `*.property.test.ts`：Property 1 / 2 / 3 / 4 / 6（`tickLayout.property.test.ts:37 / 133 / 225 / 257 / 324`）、5（`scrubFormat….ts:98`）、8（`cursorNav….ts:48`）、12（`dwellGate….ts:125`）、16（`frameCache….ts:207`）、18（`prefetchPlan….ts:62`）、21 / 22（`pins….ts:27 / 109`） | 12 条已写，`tasks.meta.json` 记录 12 条 pbtResults 通过 |
| 14.3 `setPins` | `src/composables/useNodeVersionTimeline.ts:107`、`:219`；测试文件同步改 | 已写 |
| 共享样例 | `docs/fixtures/version-time-resolve-cases.json` | 已放，与后端逐字节一致 |
| 10.3–10.5、11.5、11.7、12.2–12.5、12.7–12.9、12.11–12.13 | — | 14 条属性 + 1 条样例对拍**未写** |
| 14.1 / 14.2 客户端 | `versionSource.ts` / `genModelV1Api.ts` 里没有 `queryHistoryGeometry`、`attributesAtSesno`、`resolveNodeTime`、`readRealtimeLimit` | 未写 |
| 14.4–14.16、15.x、16、17.x、18 | 没有 `useVersionScrubber.ts`、`useVersionFrames.ts`、控制器浏览接口、`VersionTimelineScrubber.vue`、e2e 脚本、`scripts/verify/`、`docs/verification/` | 未写 |

### 1.4 工作区卫生

- plant3d-web：`.kiro/specs/model-version-timeline-scrub/`（7 个文件）、`docs/fixtures/`、`src/utils/versionScrub/`（18 个文件）全部 `??`；`ports.ts`、`modelVersionErrors.ts`、`useNodeVersionTimeline.ts(.test.ts)`、`package(-lock).json`、`ui/版本管理/version-timeline.pen` 为 `M`。临时文件 `.tmp-verify/check.js`、`.tmp-verify/seed.js`（10-29 11:51）、`.tl-eslint.txt`、`.tl-probe.txt`（10-29 04:38）未跟踪、不在 `.gitignore`。`.gitignore` 的改动是 impeccable 段，与本特性无关；同仓 `.archify/`、`src/dimension/**` 等别的工作线改动本计划不碰。
- gen-model-timeline-scrub：8 个 `M` + 10 个 `??`，零提交；分支名 `feat/version-time-resolve-cases` 已名不副实。
- gen-model 主工作区 `refactor`：12311 条未提交改动，其中 `e3d_model_service.rs`、`options.rs`、`fast_model/mod.rs` 两边都改 → 合入时必有冲突（§6）。
- vendor/e3d-model：`examples/zz_tmp_*.rs`（1 个 `M` + 4 个 `??`）、`.eslint-dwell.log` 是本特性探查遗留；`src/bin/rvm_compare.rs`、`tests/relocation_noise_real.rs`、`.cursor/rules/` 属别的工作线，不碰。

### 1.5 完成度

子任务 104 条（含 4 个 checkpoint），`[x]` 41 条。按组：1（2/2）、2（3/4）、3（3/3）、4（2/4）、5（5/9）、6（0/10）、7（0/2）、8（0/1）、9（10/10）、10（7/10）、11（5/7）、12（3/13）、13（0/1）、14（1/16）、15（0/8）、16（0/1）、17（0/2）、18（0/1）。属性测试：前端 32 条任务完成 12 条，后端 10 条完成 0 条（Property 33 已写未跑），集成 1 条（Property 39）未动。按工作量估约 35–40 %：后端纯逻辑约七成、编排与路由零；前端纯函数十成、接线与界面零。

## 2. 目标与完成定义

1. **入库**：后端特性分支按主题 3 次提交并改名（D4）；前端特性文件分 2 次提交；临时文件清掉（D6）；`git status --porcelain` 里不再有本特性的 `??`。
2. **后端可用**：`GET /api/v1/model/history/geometry`、`GET /api/v1/node/versions/resolve`、`GET /api/v1/element/attributes-at`、`/health.model_cache.realtime_history` 在 rocksdb 档 8022 上可用；`realtime-history-smoke.ps1` 与 `realtime-vs-legacy.ps1` 通过（不一致组合数 0，6 并发至少一个 503，`in_flight` ≤ 4），记录在 `docs/verification/model-version-timeline-scrub/`；Properties 29–38 的 proptest 与 6.10 的例子测试在 `cargo test` 里绿；合入 `refactor` 并把 SHA 写进 `tasks.md` 第 8 组。
3. **前端纯函数**：前端应有的 26 条属性全部有测试；`npx vitest run src/utils/versionScrub src/utils/modelUnitVersionCompare.property.test.ts` 绿，样例对拍绿。
4. **接线与界面**：六帧全部可对照（IXhiA / mPA9i / bDcot / O1am8 / b6sLdj / lusKv）；`npm run type-check` 不新增基线外错误、`npm run lint` 与 `npm test` 绿；不改 `ReviewPanel.vue` / `DesignerCommentHandlingPanel.vue`。
5. **性能**：`e2e/version-scrub-perf.spec.ts` 按修订后的 R12 口径（S12 / S13）实测七项并记录；500 ms / 2 s 若需调整写明理由。
6. **文档一致**：`tasks.md` 状态与代码一致；`plan.md` / `requirements.md` 不再有互相矛盾的句子；2.4 的结论有记录。

## 3. 阶段与依赖

| 包 | 内容 | 对应任务 | 依赖 | 性质 |
|---|---|---|---|---|
| W0 | 入库与规格收尾：2.4 结论、临时文件、分支改名、3 + 2 次提交、`branch_query.rs` 归属 | 2.4、（S1–S14 已做） | 无 | git + 文档 + 一条只读分析 |
| W1 | 后端编排与路由 | 6.1、6.2 | W0-1（2.4 结论决定要不要加网格锁） | 代码 |
| W2 | resolve / attributes-at / health | 6.3、6.4、6.5 | W0；与 W1 并行，只共用路由表 | 代码 |
| W3 | 后端测试补齐 | 4.2、4.3、5.2（跑）、5.4、5.6、5.8、6.6–6.10 | 4.x / 5.x 现在就能写；6.6–6.10 依赖 W1 / W2 | 测试 |
| W4 | 集成验证与合入 | 7.1、7.2、8 | W1–W3 + rocksdb 档 8022 | 脚本 + git |
| W5 | 前端纯函数测试补齐 | 10.3–10.5、11.5、11.7、12.2–12.5、12.7–12.9、12.11–12.13、13 | 无；与 W1–W4 并行 | 测试 |
| W6 | 前端接线 | 14.1、14.2、14.4–14.8 | W0（纯函数已在） | 代码 + 测试 |
| W7 | 浏览主流程 | 14.9–14.16 | W6；mock 先行（D5），真路由在 W4 之后 | 代码 + 测试 |
| W8 | 界面 | 15.1–15.8、16 | W6、W7 | 代码 + 测试 |
| W9 | 联调与性能 | 17.1、17.2、18 | W4 + W8 | 埋点 + 脚本 + 记录 |

两条线：后端 W1 → W2 → W3 → W4，前端 W5 → W6 → W7 → W8，W9 汇合。与 `tasks.md:577-595` 的 wave 图一致，只是把已完成的 wave 0–2 项剔除。

## 4. 工作包

### 4.0 已完成项回顾与验收表（不重做，用户按右列核）

| 项 | 回顾要点 | 验收方式 |
|---|---|---|
| 1.1 设计稿六帧 | 第 1 / 4 / 6 / 3 帧按链序等距、序号窗口、时间异常刻度、A / B 角标、图例统一 `impactLabel` | 打开 `ui/版本管理/version-timeline.pen` 对照 `tasks.md:16-24` 六条 |
| 1.2 共享样例 | 七种必含形态齐全 | `Get-FileHash` 两份文件哈希相同（均为 `4E44A2E5…E756F`） |
| 2.1 / 2.2 停止钩子 | `generate_subtree_with_cache` 改为空钩子调用，行为不变 | e3d-model：`cargo test --test generation_hooks_real` |
| 2.3 共用投影 | Legacy `apply_geometry_delta_on(Historical)` 改调它后仍 `commit` | 工作树：`cargo test project_historical_records`（含 `:5836`、`:5881` 两条） |
| 3.1 配置 | 越界回落 + `log::warn!` 一行 | `cargo test bounded_setting`；起服务时给 `AIOS_MODEL_HISTORY_REALTIME_CONCURRENCY=999` 看日志 |
| 3.2 输入缓存 | 同键并发合并成一次构建；容量 0 每次现建 | `cargo test historical_input` |
| 3.3 实时计算源 | 不拿 `db_generation_lock`；两路共用内部函数（源码钉 `:10601-10608`） | `cargo test realtime_compute_source`；人工读 `:3026-3100` 确认没有 `db_generation_lock` |
| 4.1 / 4.4 时间点解析 | 链序规则、无偏移取第一条带时间行偏移（S11）；`select_session_at` 薄包装 | `cargo test time_resolve`、`cargo test select_session_at` |
| 5.1 / 5.3 / 5.5 / 5.7 / 5.9 | 校验优先级、四种缺失、摘要规范化、只写 200 / 指纹变化清空、`Retry-After = clamp(1 + in_flight / limit, 1, 5)` | `cargo test realtime_history`（Property 33 的 proptest 一并跑，跑绿后 5.2 → `[x]`） |
| 9.1–9.3、9.9、10.1、10.6、10.8、11.1、11.3、11.6、12.1、12.6、12.10 | 纯函数无 Vue / DOM / 网络；`frameCache` 淘汰顺序、`retryOnBusy` 合计 ≤ 4 次、`scrubUrl` 删 `compare_autorun`、`timeResolve` 偏移规则同 S11 | `npx vitest run src/utils/versionScrub`（12 条属性 + 现有例子） |
| 14.3 `setPins` | 允许一端 null，走 `beforePairChange`，`pairReady` 不变 | `npx vitest run src/composables/useNodeVersionTimeline.test.ts` |

回顾时发现的三处要在后续包里顺手处理：`realtime_compute_source` 没有调用方（W1 接上）；Property 33 只写未跑（W3）；`tasks.md:561` 的「标 `*` 的子任务」一句无对应标记（D8）。

### W0 · 入库与规格收尾

- **W0-1 · 2.4 网格并发写结论**（只读分析 + 一份记录）：读 `e3d_model_service.rs` 里 `bake_element` 的网格落盘路径，回答两问：是否「临时文件 + 原子重命名」；同 `mesh_id` 内容是否相同。结论写 `docs/verification/model-version-timeline-scrub/phase1-mesh-write-safety.md`（plant3d-web）。不安全 → W1 的实时路径对网格写入加按 `mesh_id` 的细粒度锁（`DashMap<MeshId, Mutex<()>>`），仍不拿每库锁；安全 → 记录即完成。然后 `tasks.md:49` → `[x]`。
- **W0-2 · 临时文件**（D6，用户确认后删）：plant3d-web `.tmp-verify/check.js`、`.tmp-verify/seed.js`、`.tl-eslint.txt`、`.tl-probe.txt`；e3d-model `examples/zz_tmp_source_chain.rs`（`M`，先 `git checkout --` 还原）、`examples/zz_tmp_cmpf_list.rs`、`zz_tmp_joint_list.rs`、`zz_tmp_ref_walk.rs`、`zz_tmp_slodir_census.rs`、`.eslint-dwell.log`。删之前 `git diff` / 看一眼内容，确认都是探查脚本。
- **W0-3 · `src/mbd/branch_query.rs` 归属**：`git diff src/mbd/branch_query.rs`，与本特性无关则不进下面三次提交（留在工作区或单独提交）。
- **W0-4 · 后端三次提交 + 改名**（D4）：`git branch -m feat/model-version-timeline-scrub`；提交 ① `feat(history): 实时计算源、取消令牌、历史输入缓存与 model_history_* 配置`（`Cargo.toml/lock`、`options.rs`、`cancel.rs`、`historical_input.rs`、`e3d_model_service.rs`、`fast_model/mod.rs`、`lib.rs`）；② `feat(history): 时间点解析与共享样例对拍`（`time_resolve.rs`、`historical_model.rs`、`docs/fixtures/version-time-resolve-cases.json`）；③ `feat(history): realtime_history 校验、缺失判定、摘要、结果缓存与并发闸`（`realtime_history/*`）。提交前不编译；用户在 ③ 之后跑一次 `cargo test`。
- **W0-5 · 前端两次提交**（D4）：① `docs(spec): model-version-timeline-scrub 规格、计划与共享样例`（`.kiro/specs/model-version-timeline-scrub/` 7 个文件、`docs/fixtures/`、本计划、`.planning/` 门禁结果、`ui/版本管理/version-timeline.pen`）；② `feat(version-scrub): 时间轴纯函数、端口类型、setPins 与 12 条属性测试`（`src/utils/versionScrub/`、`ports.ts`、`modelVersionErrors.ts`、`useNodeVersionTimeline.ts(.test.ts)`、`package.json`、`package-lock.json`）。`.gitignore` 与 `.archify/`、`src/dimension/**` 不进这两次提交。
- **W0-6 · 文档收尾**：`tasks.md:561` 按 D8 改句；本节完成后 `tasks.md` 第 2 组勾成 `[x]`。

### W1 · 后端编排与路由（6.1、6.2）

- **6.1 `realtime_history/mod.rs::query_realtime(req, cancel)`**，签名按 `design.md:244`，返回 `RealtimeOutcome::{Fresh, Cached, NotModified}` 或 `ApiError`。步骤：① `validate_request`；② 会话解析——`sesno` 查会话链，`time` 取该单元「仅自身」版本表 `resolve_at_rows`（`NoResolvable` → 422 `NO_RESOLVABLE_SESSION`，`BeforeOldest` → 422 `TIME_BEFORE_OLDEST_SESSION`）；③ `source_set_fingerprint` → `RealtimeResultCache::get`，命中不占名额，按 `If-None-Match` 回 304 或 200；④ `RealtimeGate::try_acquire` 失败 → 503 `HISTORY_BUSY` + `Retry-After`；⑤ `spawn_blocking` 跑计算器，permit 随闭包进阻塞线程；⑥ `tokio::time::timeout(model_history_query_timeout_secs)` 超时 → 504 `HISTORY_QUERY_TIMEOUT` 并置位 `CancelToken`，阻塞线程在下一个检查点退出；⑦ 只写 200 进缓存；⑧ 返回。计算段：根不在索引 → `classify_absent`（404 `REFNO_NOT_IN_CHAIN` / 404 `UNIT_NOT_PRESENT` + `not-yet` / `deleted` / 500 `GEOMETRY_GENERATION_FAILED`）；noun 不在 `delivery_unit_types` → 422 `NOT_A_DELIVERY_UNIT_ROOT`；`LimitExceeded` → 413；`project_historical_records` → 按 `record_id` 去重留最后 → 按 `(source_refno, record_id)` 排序 → 去 `snapshot_key` → `geometry_digest` → 响应体（含 `stats`）。计算器放 `trait RealtimeCalculator`（真实现包 `realtime_compute_source` + `project_historical_records`；假实现给 W3）。`GeometryFailurePolicy::BestEffort`；不触碰 `HistoricalModelStore`，不建任务。W0-1 判定不安全时在真实现里加网格锁。
- **6.2 路由与 handler**：`web_service/mod.rs` 的 `/api/v1` 表注册 `GET /model/history/geometry`；`handlers.rs` 新 handler：`ProjectReq` `#[serde(flatten)]` + `RealtimeQueryParams`（全 `Option<String>`）；`If-None-Match` 去引号、去 `W/`；handler 内建 `CancelToken` + `CancelOnDrop`；200 / 304 都带 `ETag: "<geometryKey>"`、`X-Sesno`、`X-Session-Time`（无时间空串）、`Cache-Control: no-cache`；503 带 `Retry-After`；错误体 `ApiError::coded`。CORS `Access-Control-Expose-Headers` 加 `ETag, X-Sesno, X-Session-Time, Retry-After`。`AppState` 挂 `RealtimeHistoryState { gate, cache, input_lru, timeout, fingerprint_ttl }`，容量 / 并发从 3.1 的配置取。
- 验收：用户按 `design.md:1185-1205` 的 curl 清单手工过一遍（200、再查字节相同、304、错误码、`--max-time 1` 后 `in_flight` 回落、快照数不变）；正式验收在 W4。

### W2 · resolve / attributes-at / health（6.3、6.4、6.5）

- **6.3 `GET /api/v1/node/versions/resolve`**：`scope ∈ {self, subtree}`、`at` 走 `parse_instant`，否则 400 `INVALID_SELECTOR`；节点不存在 404 `NODE_NOT_FOUND`；取 `node_versions(dbnum, refno, scope, …)` 全表，> 5000 行按 `since_sesno` 翻页取全，再 `resolve_at_rows`；422 两码同 6.1。用户 curl 核对 `unit_versions` 与 `node_versions(scope=self)` 对同一单元根行集相同。
- **6.4 `GET /api/v1/element/attributes-at`**：把 `attributes_at` 的阻塞段抽成 `read_attributes_at(dbnum, source_file, sesno, refno, service)`，不经快照回执；Legacy `tool=attributes` 改调它，保留 `exists: false`；错误 400 `INVALID_REFNO`、404 `SESSION_NOT_FOUND`、404 `REFNO_NOT_FOUND_AT_SESSION`。
- **6.5 `/health.model_cache.realtime_history`**：`cache_entries`、`cache_capacity`、`hits_total`、`misses_total`、`in_flight`、`concurrency_limit`、`input_cache { entries, capacity }`、`timeout_secs`；`historical` 分项不变。`docs/specs/web-service-api.md` 同步三条路由与 health 字段（合入 `refactor` 前）。

### W3 · 后端测试补齐（4.2、4.3、5.2、5.4、5.6、5.8、6.6–6.10）

| 任务 | 属性 | 位置 | 要点 |
|---|---|---|---|
| 4.2 | 29 | `time_resolve.rs` tests | `select_latest_at` / `resolve_at_rows` / `select_session_at` 包装对暴力参考实现；三种时间形态（单调、会话 1 最晚、乱序） |
| 4.3 | 31 | 同上 | 往返：`resolve(at(v)) = w`，`w` 的时间 ≥ `v` 且 sesno ≥ v |
| 5.2 | 33 | `validate.rs:760` | 只需跑绿；失败按实现修 |
| 5.4 | 34 | `absent.rs` tests | 随机行表 + tombstone 位置 |
| 5.6 | 35 | `digest.rs` tests | 键序、`snapshot_key`、`direct_model.sesno` 无关；行序无关；内容变则变 |
| 5.8 | 36 | `cache.rs` tests | 对参考 LRU 模型；只写 200；指纹变化清空；计数只增 |
| 6.6 | 37 | `realtime_history/mod.rs` tests | `tokio::time::pause` + 假计算器；`in_flight` ≤ limit；超限 503；超时释放名额；全程不触碰 `HistoricalModelStore` |
| 6.7 | 38 | 同上 | 同 `geometryKey` 带 `If-None-Match` → 304 且头一致；不同 → 200 |
| 6.8 | 32 | 同上 | 实时 `time` 选择器与 resolve 路由对同一行表给同一 sesno |
| 6.9 | 30 | `time_resolve.rs` + handler tests | 非法文本 `parse_instant` 为 None，两条路由 400 `INVALID_SELECTOR` |
| 6.10 | 例子 | handler tests | `tasks.md:182-183` 全部条目：413 无几何、1 s 超时 + 慢假计算器 → 504 且名额释放、丢弃 future 后一个检查点内看到取消、attributes-at 三错、resolve 404 / 422、越界配置回落 |

每条 proptest 100 次，注释 `// Feature: model-version-timeline-scrub, Property N: …`。全部写完后用户跑 §7 的后端命令；绿了把 `tasks.md` 对应项与 `tasks.meta.json` 的 pbtResults 一起更新。

### W4 · 集成验证与合入（7.1、7.2、8）

- **7.1 `scripts/verify/realtime-history-smoke.ps1`**（plant3d-web，只调 HTTP）：参数 `-BaseUrl`（缺省 `http://127.0.0.1:8022`）、`-Dbnum`、`-UnitRefno`（缺省 `24384_23257`）、`-Origin`；按 `tasks.md:188` 清单逐项 PASS / FAIL，输出 Markdown 到 `docs/verification/model-version-timeline-scrub/phase1-smoke-<yyyyMMdd>.md`（命令、节点、sesno、返回、耗时）。版本数 ≥ 25、几何变化 ≥ 5 两项只记录不判失败（供 W9 决定是否换 BRAN）。
- **7.2 `scripts/verify/realtime-vs-legacy.ps1`**（Property 39）：BRAN `24384_23257` + 一个 EQUI 单元，每个 sesno 实时 vs Legacy（generate → 轮询 → query → DELETE），去 `snapshot_key`、按 `(source_refno, id)` 排序比较；记录不一致组合数（期望 0）、错误映射（`REFNO_NOT_FOUND_AT_SESSION` ↔ `UNIT_NOT_PRESENT`）、同组合连查两次逐项相等；6 个并行冷查询至少一个 503 + `Retry-After`，`/health.in_flight` ≤ 4。输出 `phase1-realtime-vs-legacy-<yyyyMMdd>.md`。
- **8 Checkpoint**：用户按 `tasks.md:200-203` 起 rocksdb 档（`Start-Surreal8009.ps1` + `AIOS_STORE_MODE=rocksdb` 的 `aios-database.exe` 8022，`AIOS_MODEL_GENERATION_INPUT_MAX_DBNUMS=1`、`AIOS_MODEL_ELEMENT_CACHE_MAX_ENTRIES=60000`；真实库先拷 `.surreal/ams-8009`），跑两个脚本；然后 `git rebase refactor`（冲突只会在 `e3d_model_service.rs`、`options.rs`、`fast_model/mod.rs` 三处，保留两边）→ `cargo test` 绿 → 合入 `refactor` → SHA 写进 `tasks.md` 第 8 组。不合 `publish`、不部署。

### W5 · 前端纯函数测试补齐（10.3–10.5、11.5、11.7、12.2–12.5、12.7–12.9、12.11–12.13、13）

| 任务 | 属性 | 文件 | 要点 |
|---|---|---|---|
| 10.3 | 9 | `cursorNav.property.test.ts` 追加 | 吸附取最近刻度、并列取 sesno 大者、越界取首末；`initialCursor` = sesno 最大 |
| 10.4 | 10 | 同上 | `stepCursor` 端点不动、每步恰一格 |
| 10.5 | 11 | 同上 | `coerceCursorForGeometryOnly` 落在 ≤ 原游标的最近几何变化版，没有则 null |
| 11.5 | 19 | `prefetchPlan.property.test.ts` 追加 | `reassignOnCursorMove`：±2 内且有名额转预取，否则中止；±2 外进行中预取中止、排队移出；都不标失败 |
| 11.7 | 15（`retryOnBusy` 部分） | 新建 `busyRetry.property.test.ts` | 假时钟注入 `sleep`；合计 ≤ 4 次；非忙错误原样抛；`signal` → `AbortError`；`retryAfterMs` 钳 [1, 5] s |
| 12.2 | 29 | 新建 `timeResolve.property.test.ts` | 三种时间形态对暴力参考实现 |
| 12.3 | 30 | 同上 | 非法文本 → `invalid-format` |
| 12.4 | 31 | 同上 | 往返 |
| 12.5 | 样例对拍 | 新建 `timeResolve.test.ts` | 读 `docs/fixtures/version-time-resolve-cases.json` 逐条 |
| 12.7 | 26 | 新建 `scrubUrl.property.test.ts` | 写后读回相同；其余参数原样；`compare_autorun` 被删 |
| 12.8 | 27 | 同上 | `reconcileScrubState` 回落规则、A = B 留 A、A > B 交换 |
| 12.9 | 28 | 同上 | 非法 `cursor` / `scope` → `invalid` 并指明参数 |
| 12.11 | 24 | 新建 `subtreeFramePlan.property.test.ts` | `latest` / `confirm` / `load` 三分支；`top` 排序取前 20 |
| 12.12 | 25 | 同上 | `runBounded` 同时进行 ≤ limit，结果顺序与输入一致 |
| 12.13 | 23 | 新建 `src/utils/modelUnitVersionCompare.property.test.ts` | `compareModelUnitGeometry(x, x)` 全为未变 |

**13 Checkpoint**：用户跑 `npx vitest run src/utils/versionScrub src/utils/modelUnitVersionCompare.property.test.ts`；绿后更新 `tasks.md` 与 `tasks.meta.json`。

### W6 · 前端接线（14.1、14.2、14.4–14.8）

- **14.1 客户端**：`versionSource.ts` / `genModelV1Api.ts` 实现 `queryHistoryGeometry`（`If-None-Match: "<geometryKey>"`；`setTimeout` + `AbortController` 60 s → `HistoryQueryError('CLIENT_TIMEOUT')`；304 从 `ETag` / `X-Sesno` / `X-Session-Time` 取值；200 的 `instances` / `tubes` 走抽出来的 `mapHistoryRows`，`loadVersion` 改用同一函数）、`attributesAtSesno`、`resolveNodeTime`、`readRealtimeLimit`（读 `/health.model_cache.realtime_history.concurrency_limit`）。只有「404 / 405 且体不是带 `error.code` 的 JSON」抛 `ModelVersionRouteUnavailableError`；网络失败 `HistoryQueryError('NETWORK')`；主动中止 `AbortError`。
- **14.2 例子测试**：200 / 304 / 带码 404 / 无码 404 / 405 / 503 / 网络 / 超时各一例。
- **14.4 `useVersionScrubber.ts`**（`design.md:622`）：吃 `useNodeVersionTimeline` 的 `rows`，排除 `attributeOnly` 与 `inScope === false`；范围切换保留游标与钉、视口全量、`ghostOrdinal` 灰标；`resolveDate` 先 `parseInstant` 再 `resolveNodeTime`，收到 `ModelVersionRouteUnavailableError` 后本面板会话改 `resolveAt`；钉经 `setPins`；`onCursorChange(cb)` 带 `drag | release | click | key | resolve | url`。
- **14.5 Property 7**：切换范围保留游标与钉、灰标位置 = `ghostOrdinal`。
- **14.6 控制器浏览接口**（`design.md:694`）：`browseEnter / browseShow / browsePending / browseMissing / browseBadge / replaceSide / browseExit`，复用 A 侧隔离图层；`browseShow` 按单元比 `geometryKey` 相同只改角标；首帧 `fitToBox` 之后不动相机；`focusRefno` 只高亮该构件；角标文本来自 `browseBadgeText`。
- **14.7 Property 14**（`src/viewer/modelUnitCompareBrowse.property.test.ts`，mock DTX 只计装载次数）；**14.8 例子测试**追加到 `modelUnitCompareController.test.ts`。

### W7 · 浏览主流程（14.9–14.16，mock 先行）

- **14.9 `useVersionFrames.ts` 实时路由主流程**（`design.md:653`）：请求表 `Map<FrameKey, { controller, role, promise }>`；游标移动先 `reassignOnCursorMove`，拖动经 150 ms 门、松开 / 点击 / 方向键立即请求、300 ms 后 `planPrefetch`、游标请求结束再计划一次；只写缓存，完成时 sesno 仍为游标才 `browseShow`；同单元已装入时带 `If-None-Match`，304 → `putSharedFrame`；游标请求经 `retryOnBusy`（`onWait` 保持「正在加载」，`shouldRetry` 只在角色仍为 `cursor`，每次 HTTP 单独 60 s）；失败 / 超时标刻度、追加 `errors`、视口不动；预取失败进 `failed`、预取忙不标；`UNIT_NOT_PRESENT` 缓存空帧 → `browseMissing`；`exitBrowse` 中止全部并 `clearFrames`。
- **14.10 单钉着色、对比模式、子树**：单钉 `compareModelUnitGeometry(pinFrame, cursorFrame)` 四态交给 `browseShow(frame, { diffRows })`，钉帧受保护；`enterCompare` 只请求缺失侧、`buildModelUnitCompareView` 拼 detail、拖钉只 `replaceSide`；子树 `diffSummary(cursor, latest)` → `planSubtreeFrames` → `runBounded`（上限 `readRealtimeLimit`，缺省 4，每任务包 `retryOnBusy`），`confirm` → `pendingConfirm`，部分失败照常显示成功单元；子树预取只对需装 ≤ 5 的相邻版本。
- **14.11 旧服务端降级**：`ModelVersionRouteUnavailableError` → `legacyFallback = true`，改走 `loadVersion`（300 s），帧带 `legacySnapshotKey`，预取 generate ≤ 2；淘汰 / 退出 `release(snapshotKey)`，失败或 10 s 未返回只 `console.warn`；非 404 / 405 不降级；`gm_backend` 改变或面板关闭复位；属性点选退回 `attributesAt(snapshot)`。
- **14.12–14.16 测试**：Property 13（`useVersionFrames.property.test.ts`，mock 来源 + 控制器 + 可控 Promise）、17（304 复用）、20（退出清理）、15 第二半（追加到 `busyRetry.property.test.ts`）、例子测试按 `tasks.md:484` 全部条目。
- mock 先行的含义（D5）：W7 全部对着 `ModelVersionSource` 的 mock 写并测通；W4 合入后只做一次真路由冒烟，不改逻辑。

### W8 · 界面（15.1–15.8、16）

- **15.1 `VersionTimelineScrubber.vue`**：对照第 1 / 4 帧的等距链序版式与第 6 帧的空态异常态（`tasks.md:491-495` 全部要素）；按钮十一个及禁用态（R5.5、R5.12）；`tabindex=0` 左右键；`pointerdown` + `setPointerCapture`；指针事件 `requestAnimationFrame` 合帧、每帧最多吸附一次、游标只改 `transform`。
- **15.2 组件例子测试**：`tasks.md:498` 条目。
- **15.3 `NodeVersionTimeline.vue`** 接 `highlightSesno`，`scrollIntoView({ block: 'nearest' })`，折叠段展开、必要时「加载更早」。
- **15.4 `ModelUnitVersionComparePanel.vue`**：挂时间轴、浏览进出、卸载 `exitBrowse`；三种角标（第 1 / 2 / 3 帧）；点构件 `attributesAtSesno` + 横幅「属性来自 sesno N」；钉变化刷新两个 tab；「清除钉」回不着色浏览。
- **15.5 子树范围**（第 5 帧）：轴标题「子树 n 版」、「单元 n」、确认对话框三选项、等待 / 取消角标、部分失败列表。
- **15.6 降级与错误**（第 6 帧）：`model/versions` 404 / 405 不渲染时间轴；实时路由缺失底部横幅；其它 HTTP 错误码 + 消息；网络「无法连接服务端」。
- **15.7 直达链接**：`writeScrubUrl` 写剪贴板 + 失败回退文本框；URL 带 `cursor` 的恢复顺序（打开节点 → 切 `scope` → `reconcileScrubState` → 进浏览）；入口接 `src/utils/modelUnitVersionCompare.ts` 现有解析处，不带 `cursor` 走现有逻辑。
- **15.8 面板例子测试**追加到 `ModelUnitVersionComparePanel.test.ts`；现有 `compare_a` / `compare_b` / `compare_autorun` 用例保持通过。
- **16 Checkpoint**：`npm run type-check` 不新增基线外错误（不得为放行新错误改基线）、`npm run lint`、`npm test`；本特性不改 `ReviewPanel.vue` / `DesignerCommentHandlingPanel.vue`，不跑审核面板五套回归。

### W9 · 联调与性能（17.1、17.2、18）

- **17.1 埋点**：控制器首帧渲染完成且角标更新后 `performance.mark('version-scrub:frame-shown', { detail: { sesno } })`，角标更新单独一个 mark；`useVersionFrames` 暴露只读调试读数（缓存键数、进行中请求数）。不改行为，生产可留。
- **17.2 `e2e/version-scrub-perf.spec.ts`**（环境变量 `VERSION_SCRUB_PERF` 守卫，缺省 `test.skip`，不进 CI；`gm_backend` 指 8022）：先核对 BRAN `24384_23257` 版本数 ≥ 25、几何变化 ≥ 5（取 7.1 的记录），不满足换 BRAN 并写明。七项按修订后口径：① 前后各 2 版已缓存，方向键 20 次 ≤ 300 ms；② **先对目标 sesno 各发一次请求预热服务端缓存**，再清前端缓存，10 次 ≤ 500 ms（S13）；③ `AIOS_MODEL_HISTORY_REALTIME_CACHE=0` 重启，10 次 ≤ 2 s；④ **先预热**，「仅属性」会话 304 且角标 200 ms 内更新，10 次（S12）；⑤ 3–5 s 拖过 30 刻度，每 1 s 窗口 ≥ 30 fps，吸附后 100 ms 内更新标签；⑥ 10 分钟每 60 s 采样：前端缓存键 ≤ 12、`in_flight` ≤ 上限、结果缓存 ≤ 容量、历史快照数不变；退出后 1 s 内前端进行中为 0、5 s 内 `in_flight` 回初值；⑦ 500 行版本表首次渲染 ≤ 500 ms。输出 `docs/verification/model-version-timeline-scrub/phase3-perf-<yyyyMMdd>.md`。
- **18 Final checkpoint**：用户起 rocksdb 档 8022 + `npm run dev`（或 Playwright webServer 3101），手动跑 17.2；500 ms / 2 s 若需调整写明理由；`tasks.md` 全部勾完。

## 5. 决策

已定（2026-10-29，用户点选）：

- **D1** `HISTORY_BUSY`：游标与子树请求自动重发最多 3 次（合计 ≤ 4 次 HTTP），等待期间保持「正在加载」，用尽才标失败；预取遇忙不标失败。`plan.md:23` 已改。
- **D2** R12.4 补前提「结果缓存已含目标版本」，不改后端（不做「未命中也先比 ETag」的优化）。`requirements.md:289 / 294` 已改。
- **D3** R8.1 无偏移时间点按链序第一条带时间行的偏移解释，前后端与 Legacy 包装同规则。`requirements.md:224` 已改。
- **D-范围** 全量重排（本文件）；计划放 plant3d-web `docs/plans/`，门禁结果放 `.planning/2026-10-29-model-version-timeline-scrub/`。

待拍板：

- **D4 · 入库方式。** (a) 后端分支改名 `feat/model-version-timeline-scrub` + 三次主题提交，W4 末 `rebase refactor` 后合入（推荐）；(b) 不改名，一次提交。前端：(a) 直接在 `main` 两次提交（推荐，与仓库现状一致）；(b) 开 `feat/version-scrub` 分支。
- **D6 · 临时文件。** (a) W0-2 列出的 10 个文件经确认后删除（推荐）；(b) 加进 `.gitignore` 保留。

建议（无异议即按此执行）：

- **D5** W7 对 mock 先写先测，真路由只做一次冒烟；这样前端线不被后端 W1–W4 阻塞。
- **D7** 验证记录统一放 `docs/verification/model-version-timeline-scrub/`，文件名 `phase1-smoke-*.md`、`phase1-realtime-vs-legacy-*.md`、`phase1-mesh-write-safety.md`、`phase3-perf-*.md`。
- **D8** `tasks.md:561` 的「标 `*` 的子任务是测试任务，可跳过以先出 MVP」改为「属性测试与例子测试子任务可延后以先出 MVP；4.4、12.5、7.1、7.2 不可延后」——任务表里实际没有一个 `*` 标记。

## 6. 风险

- **零提交 + `refactor` 分叉**：后端全部工作在未提交的工作树里，主工作区 `refactor` 又有上万条未提交改动且三个文件两边都改。W0-4 先提交、W4 末才 rebase；中间 `refactor` 若再合入大改动，冲突面只会更大——这是把 W0 排第一的理由。
- **2.4 没有结论就接路由**：`realtime_compute_source` 不拿每库锁却会写共享网格目录；不安全时与当前模型生成并发写同一 `mesh_id` 可能出半个文件。W1 依赖 W0-1。
- **304 未命中仍要算几何**：已用 D2 把 R12.4 限定在命中情形；但用户体感上「仅属性」版本首次仍要等一次完整计算，W8 的角标文案要如实显示「正在加载」。
- **`e3d_model_service.rs` 超过一万行**：W1 / W2 只加调用、不搬代码；新逻辑全部放 `realtime_history/` 与 handler。
- **`useVersionFrames` 状态机复杂**（请求角色切换、忙重试、降级、子树确认四条线交织）：先写 Property 13 / 15 / 17 / 20 的 mock 骨架再填实现（W7 顺序），例子测试按 `tasks.md:484` 条目逐一钉住。
- **BRAN `24384_23257` 版本数可能 < 25**：7.1 先记录；不够就在 7.1 的记录里选替代 BRAN，W9 照用。
- **子树 20 单元 × 60 s**：最坏 20 个任务在上限 4 的并发下仍可能排队几分钟；`confirm` 对话框与「先装变化最大的 20 个」就是为此；W8 的角标要显示「等待确认」。
- **`.pen` 设计稿是二进制改动**（`M`）：和代码分开提交（W0-5 ①），避免以后 revert 代码时连设计稿一起回退。

## 7. 验收命令

```
# 后端（gen-model-timeline-scrub 工作树；特性集同 2026-10-28 计划 §7）
cargo test --lib --no-default-features --features ws,gen_model,manifold,project_hd,http_api time_resolve
cargo test --lib --no-default-features --features ws,gen_model,manifold,project_hd,http_api realtime_history
cargo test --lib --no-default-features --features ws,gen_model,manifold,project_hd,http_api project_historical_records
cargo test --lib --no-default-features --features ws,gen_model,manifold,project_hd,http_api historical_input
cargo test --lib --no-default-features --features ws,gen_model,manifold,project_hd,http_api bounded_setting
cargo test --lib --no-default-features --features ws,gen_model,manifold,project_hd,http_api

# e3d-model（vendor/e3d-model）
cargo test --test generation_hooks_real

# 阶段 1 集成（plant3d-web，rocksdb 档 8022 已起）
.\scripts\verify\realtime-history-smoke.ps1 -UnitRefno 24384_23257
.\scripts\verify\realtime-vs-legacy.ps1 -UnitRefno 24384_23257
GET http://127.0.0.1:8022/health            # model_cache.realtime_history

# 前端纯函数（plant3d-web）
npx vitest run src/utils/versionScrub src/utils/modelUnitVersionCompare.property.test.ts
npx vitest run src/composables/useNodeVersionTimeline.test.ts

# 前端全量
npm run type-check
npm run lint
npm test

# 阶段 3 性能（手动，不进 CI）
$env:VERSION_SCRUB_PERF = '1'; npx playwright test e2e/version-scrub-perf.spec.ts
```

## 8. 不做的事

- 不把整个库拨回某一天，不同时看三版以上。
- 不改 Legacy 路径的快照淘汰策略；降级只是调用它，然后删本会话创建的键。
- 不为 R12.4 改后端（不做「未命中先比 ETag 再算」）。
- 不实现已废弃的 `specs/004-model-version-timeline/`。
- 不把性能脚本放进 CI；不合 `publish`、不部署。
- 不动 gen-model 主工作区 `refactor` 的未提交改动；不动 plant3d-web 的 `.archify/`、`src/dimension/**`、`.gitignore`；不动 e3d-model 的 `rvm_compare.rs`、`tests/relocation_noise_real.rs`。
- 不改 `ReviewPanel.vue` / `DesignerCommentHandlingPanel.vue`。

## 9. Plannotator 门禁记录

- 首轮（2026-10-29）：`{"decision":"approved"}`（无批注）。`.planning/2026-10-29-model-version-timeline-scrub/.gate-result.json`。本计划自此为已批准版；D4 / D6 仍待拍板，在 W0-2 / W0-4 动手前定。
- 第二轮（2026-10-31，审核后重排）：`{"decision":"approved"}`（无批注）。`.planning/2026-10-29-model-version-timeline-scrub/.gate-result-2026-10-31.json`。「剩余工作」一节自此为已批准版，W10 按节内顺序执行；D9 / D10 / D11 没有批注，仍待拍板，在 W4 第 1 步与处置未提交内容之前定。
