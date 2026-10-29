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

**尚未实测**（需 rocksdb 档 8022 与 `npm run dev`）。跑完后把每个用例的 `console.log` 行与 `perf/*.json` 一并记到本文件「实测记录」小节，并注明是否调整过 300 ms / 500 ms / 2 s 门槛及理由。

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

## 7.2 实测结果（2026-10-29，新构建）

等价比较按 `(source_refno, id)` 排序、去 `snapshot_key` 后逐项比：

- 6 个组合（`24384/23257` 的 676–686）全部 `instances` 与 `tubes` 相等，不一致 0；
- 同组合连查两次（未命中 + 命中）`ETag` 与 `instances` 逐项相等；
- 并发闸：6 个并发冷查询 → `200,503,200,200,200,200`，`in_flight` 峰值恰好 4（等于 `concurrency_limit`），有请求被拒。

并发闸这一条要**冷**会话才会触发：缓存命中不占名额（R7.1 明写），脚本会先跳过本次已请求过的
会话，再从链上取未被碰过的版本并发打。第一次跑时误用了刚预热过的会话，六个全 200、`in_flight` 峰值 2，
改成冷会话后闸正常拒。

## 一处需要裁决的规范冲突

见 `finding-r6-3-vs-r8-10.md`：对**交付单元根**，R6.3（`time` 用单元「仅自身」版本表）与
R8.10（与 `resolve?scope=self` 一致）指向两张不同的表——`unit_versions` 73 行 vs
`node_versions(scope=self)` 5 行。实测 `resolve?scope=subtree` 与 `unit_versions` 行集完全相同，
所以冲突只在 `scope=self` 这一档。文档里列了三条出路，都需要规范所有者裁决。



