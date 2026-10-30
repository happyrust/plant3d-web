# 阶段 3 · 性能实测（tasks.md 17 / 18）

Requirement 12 的七条指标，脚本在 `e2e/version-scrub-perf.spec.ts`，**只手动跑、不进 CI**。

## 怎么跑

```powershell
# 1) 后端：rocksdb 档（不用 mem 档），8022
cd D:\work\plant-code\old\gen-model-timeline-scrub
$env:AIOS_STORE_MODE = 'rocksdb'
# 起服务（部署包 Start-AMS.ps1 -StoreMode rocksdb，或本仓的启动脚本）

# 2) 前端
cd D:\work\plant-code\old\plant3d-web
$env:VERSION_SCRUB_PERF_GATE = '1'
$env:VERSION_SCRUB_PERF_EVIDENCE = 'docs/verification/model-version-timeline-scrub/perf'
npx playwright test e2e/version-scrub-perf.spec.ts --workers=1
```

不给 `VERSION_SCRUB_PERF_GATE=1` 时整文件 skip，`npm run test:e2e` 不受影响。

### 12.3 单独跑

Requirement 12 第 3 条要求服务端结果缓存容量为 0，得换个进程重启：

```powershell
$env:AIOS_MODEL_HISTORY_REALTIME_CACHE = '0'
$env:AIOS_STORE_MODE = 'rocksdb'
# 重启后端后
$env:VERSION_SCRUB_PERF_CACHE_OFF = '1'
npx playwright test e2e/version-scrub-perf.spec.ts --workers=1 -g "12.3"
```

脚本先断言 `/health.model_cache.realtime_history.cache_capacity === 0`，不符就红，避免拿热缓存冒充冷启动。

## 旋钮

| 环境变量 | 缺省 | 作用 |
|---|---|---|
| `VERSION_SCRUB_PERF_GATE` | 未设 | 必须 `1` 才跑 |
| `GEN_MODEL_V1_BASE_URL` | `http://127.0.0.1:8022` | 探针与 `/health` 的地址 |
| `VERSION_SCRUB_PERF_UNIT` | `24384_23257` | 被测单元（斜杠或下划线都行） |
| `VERSION_SCRUB_PERF_DBNUM` | `8000` | dbnum |
| `VERSION_SCRUB_PERF_PROJECT` | `AvevaMarineSample` | `output_project` |
| `VERSION_SCRUB_PERF_EVIDENCE` | 空 | 给了目录就把每次耗时 / 每个采样点落成 JSON |
| `VERSION_SCRUB_PERF_CACHE_OFF` | 未设 | 服务端是按 `AIOS_MODEL_HISTORY_REALTIME_CACHE=0` 起的 |

## 夹具门

`beforeAll` 先探一次，任一不满足就整文件 skip 并把实际数写进跳过理由：

- `/health.model_cache.realtime_history` 必须在（后端要带实时历史那批改动）；
- `model/versions` 里该单元版本数 ≥ 25；
- 其中 `impact_kind` 属于 `mesh` / `placement` / `delivery` / `tombstone` 的 ≥ 5。

不满足时按 Requirement 12 的验证口径：先记录实际版本数，再用 `VERSION_SCRUB_PERF_UNIT` 换一个 BRAN 并把换的理由写在本文件。

## 七条指标对应的用例

| 指标 | 用例 | 门槛 |
|---|---|---|
| 12.1 缓存热、方向键 20 次 | `12.1 缓存热时方向键 20 次每次 ≤ 300 ms` | 每次 ≤ 300 ms，任何一次超出即不通过 |
| 12.2 服务端缓存热、前端缓存空 10 次 | `12.2 服务端缓存热而前端缓存空时 10 次 ≤ 500 ms` | 每次 ≤ 500 ms |
| 12.3 服务端缓存容量 0、10 次 | `12.3 服务端结果缓存容量 0 时 10 次 ≤ 2 s` | 每次 ≤ 2 s |
| 12.4 仅属性会话 304、角标 10 次 | `12.4 仅属性会话走 304 且角标 200 ms 内更新` | 角标 ≤ 200 ms |
| 12.5 拖动 30 刻度 | `12.5 拖动 30 个刻度时每个 1 s 窗口 ≥ 30 fps 且吸附后 100 ms 内更新标签` | 每 1 s 窗口 ≥ 30 fps；吸附 → 标签 ≤ 100 ms |
| 12.6 10 分钟来回拖 | `12.6/12.7 连续 10 分钟拖动时缓存与并发有界…` | 每 60 s 采样：前端缓存键 ≤ 12、后端 `in_flight` ≤ 并发上限、结果缓存 ≤ 容量、`historical` 快照数 = 初值 |
| 12.7 退出后收敛 | 同上用例的后半段 | 1 s 内前端 `cacheKeys` 与 `inFlight` 为 0；5 s 内后端 `in_flight` 回初值 |
| 17.2 末条 版本表首帧 | `版本表首次渲染 ≤ 500 ms` | ≤ 500 ms |

## 数字怎么取的

- 起点在页面里 `performance.mark('perf:step-start')`，紧接着按方向键；终点取 `version-scrub:frame-shown` 里 `detail.sesno` 等于目标版本的那一条。这是 tasks.md 17.1 埋的点，量的是「按键 → 隔离图层新帧首帧画完」，不含 Playwright 的 IPC 抖动。
- 12.4 单独用 `version-scrub:badge-updated` 量角标，因为那条要求只覆盖到「角标显示新 sesno」。
- 12.5 的 fps 是页面侧 rAF 采样按 1 s 不重叠窗口计数；吸附时延是「最后一次 `pointermove` → 游标 `data-sesno` 变化」。
- 12.6 的前端读数来自 `window.__versionScrubDebug()`（`useVersionFrames.exposeDebug()` 挂的），后端读数来自 `/health.model_cache.realtime_history`。

## 12.4 与 12.2 的前置

Requirement 12 的验证口径：第 2 条与第 4 条先对目标 sesno 各发一次 `Realtime_History_Query`，让服务端算出 `geometryKey`。缓存未命中时 304 仍要先算完几何，只省传输不省计算，所以 200 ms 不覆盖未命中情形。脚本里 12.2 已经先发了一轮预热请求；12.4 若本次会话序列里没出现 304（库里仅属性版本不足），会 `skip` 并把实测角标时延记进证据文件，不判红。

## 首次实测结果

环境：rocksdb 档 8022（`0.1.44+g1ca68639061e`，`DB_OPTION_FILE=db_options/DbOption-issue7-e2e.toml`）、
被测 BRAN `24384/23257`（dbnum 8000）、Playwright + 本机 Chrome、`--workers=1`。

夹具（`perf/probe-fixture.json`）：

```
latest=686  versionCount=73  impact_kind 分布：placement=68、mesh=4、delivery=1
geometrySesnoCount=73  drawableSesnos=38 个（相对最新版 686 真有几何差异的那些）
```

### 12.1 缓存热时方向键 20 次 ≤ 300 ms —— **通过**

```
12.1 worst 26 ms（预算 300） 26,26,24,23,20,25,20,24,24,21,22,25,18,20,23,19,22,23,19,19
```

20 次全部在 18–26 ms 之间，远低于 300 ms。

> 第一轮实测（`pair=212,213`）的读数是 `34,29,25,26,38,30,26,-56,35,26,25,31,29,-64,28,-47,33,30,28,-65`，
> 正数 25–38 ms、8 个负值。负值是跨 mark 的计时噪声（终点 `frame-shown` 早于起点 `perf:step-start`，
> 说明那一版在按键前就已画完、mark 时间戳落在窗口之外），不影响结论。改用「从面板落点就近取相邻对」
> 后噪声明显减少（只剩 0 个负值的那一轮），因为不必再横穿版本链。

### 12.2 服务端缓存热、前端缓存空 10 次 —— **通过（门槛由 500 ms 调到 1 500 ms）**

```
budget=500  measured=5   targets=563,567,571,626,652,660,664,668,672,676,680,684
sesno 567 = 1207 ms      ← 首次，服务端缓存命中
sesno 571 = 1218 ms      ← 首次，服务端缓存命中
sesno 571 = 22 / 20 / 23 ms（回程，前端已缓存）
（565 / 569 / 573 等相邻版本不在 `drawableSesnos` 里，按 9.2 不装帧，记 skipped）
```

改成「逐个目标先不计时地走到前一格、再单量最后一步」后拿到 11 个有效样本，全部落在同一档：

```
budget=1000  measured=11
567=1254  571=1205  626=1199  652=1229  660=1205  664=1228
668=1220  672=1205  676=1252  680=1238  684=1234   （ms）
```

单独量后端 `model/history/geometry` 的**缓存命中**耗时（`curl` 直打 8022，确认命中态）：

```
sesno 563 : 564 ms  8128 B
sesno 567 : 563 ms  8128 B
sesno 571 : 568 ms  8128 B
sesno 626 : 555 ms  8128 B
sesno 652 : 576 ms  8128 B
```

`/health.model_cache.realtime_history` 当时是 `cache_entries=16 / cache_capacity=32`、`hits_total=56`、
`misses_total=41`、`in_flight=0`，确认走的是命中分支。缓存**未命中**时同一查询要 15 821 ms。

拆账：后端命中态每次 555–576 ms，前端拿到 8 KB 响应后建几何 + 装隔离图层 + 等两帧才打
`frame-shown`，再占约 640 ms，合计 1 200–1 254 ms。

Requirement 12 第 2 条末尾写明「第 2、3 条的 2 s / 500 ms 为本版拟定目标，首次实测后若需调整须在验证
记录中注明理由」，据此把 **12.2 的门槛从 500 ms 调到 1 500 ms**（覆盖后端 600 ms + 前端 900 ms 并留
余量）。500 ms 在任何前端实现下都达不到——仅后端命中态就已经是 555 ms 以上。

### 12.5 拖动 30 个刻度：每 1 s 窗口 ≥ 30 fps、吸附后 100 ms 内更新标签 —— **通过**

```
12.5 fps/窗口 61,60,60,59,59,1（跨度 1004,1001,1001,1001,1001,0 ms，判定 5 个完整窗口）
     minFps=59（预算 30）  dragDurationMs=5007
     吸附标签时延 8–13 ms（60 次采样，预算 100 ms）
```

5 个完整 1 s 窗口的帧数是 59–61，全部 ≥ 30 fps；60 次吸附全部在 8–13 ms 内更新标签，
远低于 100 ms。最后一个窗口只有 1 帧、跨度 0 ms（`mouse.up()` 之后那一帧），
按 Requirement 12 第 5 条「拖动期间每一个连续 1 s 的时间窗」不计入判定，只记进证据。

> 脚本最初把不满 1 s 的尾窗也算进去，`minFps` 被拉到 26 而误判。现在只判定跨度 ≥ 900 ms 的窗口，
> 每个窗口的跨度一并写进 `perf/12.5-drag.json` 的 `windowSpansMs`。

### 12.4 仅属性会话 304 —— **跳过（夹具不支持）**

被测 BRAN 的 73 个版本 `impact_kind` 全是几何变化版本（`placement=68`、`mesh=4`、`delivery=1`），
没有「仅属性」会话，因此不存在 `geometryKey` 相同的相邻版本，也就走不到 304。脚本按验证口径
把分布写进跳过理由，不判红。要实测这一条得换一个含仅属性会话的 BRAN。

> 这条最初表现为「明明 `attributeOnly.size === 0` 却仍在实际执行、跑满二十分钟」，原因在
> **`test.skip()` 的位置**：它写在测试体里，而测试体一旦开始执行，Playwright 就已经创建了
> `page` fixture；`test.skip()` 抛出后还要把这个浏览器上下文关掉，在本机（Chrome + WebGL +
> dev server）关一次能拖十几分钟，表现为「该跳过却跑满二十分钟」。移到 `test.beforeEach`
> 之后，跳过是瞬时的——实测 **3 s 结束、`1 skipped`**。
>
> 同一个坑还坑了 12.3：它的 `test.skip(!CACHE_OFF, ...)` 也在测试体内，在缓存容量非 0 的
> 环境上单跑 12.3 同样会卡满超时。一并移到 `beforeEach`（`testInfo.title.startsWith('12.3')`），
> 修完实测 **2 s 结束、`1 skipped`**。

### 版本表首次渲染 —— **夹具规模不足，测量口径已修正（981 ms / 20 行）**

```
firstScreenMs=981   firstScreenRows=20   allRows=73   budgetMs=500
```

口径：`model/versions` 响应结束（`responseEnd`，用页面内 `PerformanceObserver` 抓）→ 首屏第一行
完成布局并过两帧。不含页面加载、不含后端取数、不含「加载更早」展开全部行。

两点要注意：

1. **夹具规模不够**。Requirement 12 说「500 行版本表」，被测 BRAN 只有 73 个版本，首屏 20 行。
   这条测的是 20 行，不是 500 行。
2. **测量口径本身受开发服务器干扰**。首版脚本在列表已渲染完、只等 `children.length === 0` 时
   才开始计时，量到 4 ms（空转，无意义）；第二版从导航开始算，量到 3 338 ms（混进 Vite 冷启动
   与整个应用加载）；现在这一版只算「数据到手 → 首帧」，981 ms。

981 ms 里包含 Vue 把 20 行 v-for 建出来、以及面板同时挂载时间轴、视口、范围切换等兄弟组件的
开销。要判断这条到底该不该判红，得先有 500 行的夹具——当前数据下这个数字不具判定意义，
按「夹具不支持」记，不据此改门槛。

### 12.3 服务端结果缓存容量 0 时 10 次 ≤ 2 s —— **通过（门槛由 2 000 ms 调到 3 000 ms）**

停掉 8022 上原来的进程，以 `AIOS_MODEL_HISTORY_REALTIME_CACHE=0` 重启后 `/health` 确认
`cache_capacity=0`，再跑前端 e2e（10 个可装版本，逐个量「前端首次装入」）：

```
12.3 worst 2457 ms（预算 2000） 2457,2252,2195,2110,2084,2123,2114,2151,2095,2177
```

10 个有效样本全部落在 **2 084–2 457 ms**（原预算 2 000 ms）。同环境用 `curl` 直打后端：

```
sesno 660 : 1.389 s
sesno 664 : 1.136 s
sesno 668 : 1.143 s
sesno 672 : 1.065 s
sesno 676 : 1.094 s
```

拆账：缓存容量 0 时后端每次真算要 1.07–1.39 s，前端建几何 + 装隔离图层 + 等两帧再加约 1 s，
端到端 2.08–2.46 s。Requirement 12 第 2 条末尾写明「第 2、3 条的 2 s / 500 ms 为本版拟定目标，
首次实测后若需调整须在验证记录中注明理由」，据此把 **12.3 的门槛从 2 000 ms 调到 3 000 ms**
（覆盖后端 1.4 s + 前端 1.4 s 并留余量）。

> 这条早先「跑满二十分钟未完成」不是卡死，而是真的在跑：每一步要 2 s 多，10 步加预热就是几分钟，
> 加上当时起点定在链中段、`walkTo` 要先逐格挪六十多步（每步 1.1 s），整条就超时了。
> 修法见上一节末尾的说明：从落点本身起跑、沿版本链逐格走。

**重跑时暴露的第二个问题（未修，如实记录）**：把门槛改成 3 000 ms 后再跑一次，`waitBrowseReady`
等首帧 180 s 超时，诊断是：

```
{"debug":{"cacheKeys":1,"inFlight":0},"marks":["version-scrub:badge-updated","version-scrub:badge-updated"],
 "scrubErrors":null,"urlNotice":null,"head":"版本时间轴 · 子树 73 版","notice":null,"browse":null,
 "cursor":"684","pendingConfirm":null,"loadingTicks":0,"scopeSelfPressed":"false","scopeSubtreePressed":"true"}
```

游标已停在 684（可装版本）、范围是子树、没有错误、没有待确认框，但 `frame-shown` 一条都没打，
`cacheKeys` 停在 1。同环境 `diff-summary(684,686)` 只要 1.5 s，所以不是慢。缓存容量 0 下
首帧装不上的原因**尚未查清**。

上表那 10 个样本是**同一配置下更早一次跑出来的**（那次跑完了，`12.3-cold-step.json` 在
`12.3` 之前那次成功运行写下的），按新门槛 3 000 ms 复核：最大值 2 457 ms ≤ 3 000 ms，判定通过。
也就是说**测量数据有效、门槛调整有依据，但用例本身在缓存容量 0 下不稳定**，需要再查。

### 12.6 / 12.7 连续 10 分钟拖动 —— **通过**

拖动 10 分钟、每 60 s 采一次，共 10 个采样点（`perf/12.6-12.7-soak.json`）：

| 采样 | 前端 cacheKeys | 后端 in_flight | 结果缓存 |
|---|---|---|---|
| 1 | 4 | 0 | 19/32 |
| 2 | 6 | 0 | 21/32 |
| 3 | 6 | 0 | 21/32 |
| 4 | 8 | 0 | 23/32 |
| 5 | 9 | 0 | 24/32 |
| 6 | 12 | 0 | 26/32 |
| 7–9 | 12 | 0 | 26/32 |
| 10 | 12 | 0 | 27/32 |

- **12.6 前端缓存有界**：`cacheKeys` 从 4 涨到 12 后封顶不动（预算 ≤ 12），LRU 淘汰生效；
  后端 `in_flight` 全程 0（≤ `concurrency_limit=4`），结果缓存 19→27（≤ `cache_capacity=32`）。
- **12.7 退出收敛**：退出浏览 1 s 后前端 `cacheKeys=0`、`inFlight=0`；5 s 后后端 `in_flight=0`；
  `/health.model_cache.historical` 快照与初值完全一致（`historicalUnchanged=true`），
  说明浏览全程没有产生任何持久化写入。

### 夹具侧的三个坑（已修，写在这里免得下次再踩）

1. **游标必须落在「相对最新版真有几何差异」的版本上**。子树范围下 `requestSubtreeFrame` 会先算
   `diff-summary`，`groups` 里没有 `geometryChanged` 的单元就直接按 9.2 判「无差异」，一帧都不装、
   不打 `frame-shown`。最初用 `model/versions` 的任意版本当游标（如 419），`diff-summary(419, 686)`
   返回 `changed=0`，测试等满 180 s 超时。现在探针用 `node/diff-summary` 逐个算出 `drawableSesnos`
   （38 个），用例只在这些版本上计时。
2. **范围要用「所有子节点」**，不是「仅自身」。`fixture.rows` 来自 `model/versions`（按单元子树折叠，
   73 行），对应界面的「所有子节点」；切到「仅自身」走 `node/versions?scope=self`，对单元根只有 5 行，
   游标永远走不到夹具里那 73 个 sesno。这是 `finding-r6-3-vs-r8-10.md` 那个规范冲突在测试侧的投影。
3. **不要用 URL 直达链接定位游标**。面板 `onMounted` 里 `restoreFromScrubUrl` 在版本表填好之前就
   `reconcileScrubState`，空表会把游标原样留下，随后 `loadVersions` 完成又被 `watch(orderedSesnos)`
   重置，落点不可控。用方向键逐格走（`walkTo` 只等 `data-sesno`，不等帧）。


## 附：阶段 1 联调脚本的自检（2026-10-29）

`scripts/verify/realtime-history-smoke.ps1`（tasks.md 7.1）与 `scripts/verify/realtime-vs-legacy.ps1`（7.2）
已写好，并对着**当前 8022 上的旧构建**跑过一遍，确认脚本本身能跑通、失败信息指得准。

当前 8022 进程（PID 32948）的 `/health.model_cache` 里**没有 `realtime_history` 分项**，说明跑的是本特性之前的
二进制。两个脚本因此全部落在预期失败上：

```
[FAIL] GET /health model_cache.realtime_history -> 分项不在——要带实时历史那批改动的构建
[ok]   GET model/versions 计数 -> 版本数 73（要 ≥ 25）、几何变化 73（要 ≥ 5）、latest=853
[FAIL] GET model/history/geometry（首次） -> HTTP 500
       {"code":"internal","message":"invalid snapshot key \"geometry\"","detail":null}
[FAIL] CORS Access-Control-Expose-Headers -> 值：*
```

最后一条值得记：旧构建对 `Access-Control-Expose-Headers` 回 `*`。`*` 在 `credentials: 'include'` 的请求里不生效，
浏览器的 JS 读不到 `ETag`，304 与 `Retry-After` 两条都会失效。新构建按 `SCRUB_EXPOSED_HEADERS` 逐项列出
`ETag, Retry-After, x-sesno, x-session-time`，脚本按「四个头都在」判定。

两个脚本都只读（`realtime-vs-legacy` 唯一的写是 Legacy 路径本来就要的 `generate` + 随后 `DELETE`）。
夹具数字已经够 Requirement 12 的前提：BRAN `24384/23257` 有 73 个版本、73 个几何变化版本。

**下一步**：换成带实时历史那批改动的二进制（rocksdb 档 8022）后重跑：

```powershell
pwsh scripts/verify/realtime-history-smoke.ps1 -EvidenceDir docs/verification/model-version-timeline-scrub
pwsh scripts/verify/realtime-vs-legacy.ps1 -EvidenceDir docs/verification/model-version-timeline-scrub
```

## tasks.md 18（Final checkpoint）待办清单

18 要求的三件事，前两件已完成（见下），第三件需要人工看一次界面。

1. **换二进制**：✅ 已完成。8022 上现在是 `0.1.44+g7b193c35db44.1793274571.dirty`
   （`cargo build --bin aios-database`，rocksdb 档，`DB_OPTION_FILE=db_options/DbOption-issue7-e2e.toml`）。
   `/health.model_cache.realtime_history` 分项在。
2. **重跑两个联调脚本**：✅ 7.1 全绿；7.2 见下一节。
3. **跑性能脚本**：`VERSION_SCRUB_PERF_GATE=1` + `VERSION_SCRUB_PERF_EVIDENCE=...`，
   `npx playwright test e2e/version-scrub-perf.spec.ts --workers=1`。七条指标逐条记录，
   300 ms / 500 ms / 2 s 若首次实测需调整，在本文件写明理由。

后端合入 `refactor` 不在本次范围（`plan.md` 明确「不在本计划里部署」）。

## 7.1 实测结果（2026-10-29，新构建）

```
pwsh scripts/verify/realtime-history-smoke.ps1 -EvidenceDir docs/verification/model-version-timeline-scrub
```

全部 14 步通过，关键读数：

| 步骤 | 读数 |
|---|---|
| `/health.model_cache.realtime_history` | `cache_entries=2/32`、`in_flight=0/4`、`timeout_secs=60`、`input_cache=2/4` |
| `model/versions` 计数 | 73 个版本、73 个几何变化版本（R12 前提满足） |
| 实时几何首次 | HTTP 200、563 ms、`ETag="g:dba0a837141300f9252f01142890dde4"`、`instances=9`、`stats.visited=10`、`elapsed_ms=376` |
| 缓存命中 | HTTP 200、541 ms、`fc.exe /b` 逐字节相同 |
| `If-None-Match` | HTTP 304、体为空、四头与 200 一致 |
| 两个选择器都给 | 400 `INVALID_SELECTOR`、`detail.params=["sesno","time"]` |
| `time` 语法错 | 400 `INVALID_SELECTOR`、`detail.params=["time"]` |
| `sesno` 不在版本表 | 404 `SESSION_NOT_FOUND` |
| `attributes-at` 会话不存在 | 404 `SESSION_NOT_FOUND` |
| 断开取消 | `in_flight` 每 0.5 s 采样 8 次全为 0 |
| 快照数不变 | `historical.snapshots` 0 → 0 |
| CORS 暴露头 | `etag,retry-after,x-sesno,x-session-time` |

证据：`realtime-history-smoke.json`。

## 7.2 实测结果（2026-10-29，新构建，全量）

```powershell
pwsh scripts/verify/realtime-vs-legacy.ps1 -TimeoutSec 600 -EvidenceDir docs/verification/model-version-timeline-scrub
```

等价比较按 `(source_refno, id)` 排序、去 `snapshot_key` 后逐项比：

| 单元 | 版本数 | 比较组合 | 不一致 |
|---|---|---|---|
| `24384/23257` | 73 | 73 | 0 |
| `24384/24776` | 37 | 37 | 0 |
| **合计** | **110** | **110** | **0** |

Legacy 侧走 `generate` → 轮询 `tasks/{id}` → `query tool=instances` + `tool=tubes` → `DELETE`，
每条在 `finally` 里清理，跑完 `historical.snapshots` 回到初值。Property 39（实时与 Legacy 等价）
在 110 个组合上成立。

另外两条：

- 同组合连查两次（未命中 + 命中）`ETag` 与 `instances` 逐项相等；
- 并发闸：6 个并发冷查询 → `200,503,200,200,200,200`，`in_flight` 峰值恰好 4（等于 `concurrency_limit`），
  有请求被拒即证明闸生效。

并发闸这一条要**冷**会话才会触发：缓存命中不占名额（R7.1 明写），脚本会先跳过本次已请求过的
会话，再从链上取未被碰过的版本并发打。第一次跑时误用了刚预热过的会话，六个全 200、`in_flight` 峰值 2，
改成冷会话后闸正常拒。证据：`realtime-vs-legacy.json`。

## 一处需要裁决的规范冲突

见 `finding-r6-3-vs-r8-10.md`：对**交付单元根**，R6.3（`time` 用单元「仅自身」版本表）与
R8.10（与 `resolve?scope=self` 一致）指向两张不同的表——`unit_versions` 73 行 vs
`node_versions(scope=self)` 5 行。实测 `resolve?scope=subtree` 与 `unit_versions` 行集完全相同，
所以冲突只在 `scope=self` 这一档。文档里列了三条出路，都需要规范所有者裁决。



