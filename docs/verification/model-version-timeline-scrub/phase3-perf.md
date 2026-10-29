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
