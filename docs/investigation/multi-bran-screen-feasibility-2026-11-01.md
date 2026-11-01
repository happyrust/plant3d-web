# 多 BRAN 同屏可行性侦察（只读，2026-11-01）

只回答四个问题的事实与代价，**不给结论、不写该做 / 不该做**。所有数字都可复现，取数命令附在每节末尾。

前置事实（两条口径，别混）：

- **单 BRAN 通道**：URL 参数 `mbd_refno` 是**单值**，只喂 `/api/mbd/v2/pipe/{refno}`，一次一个 BRAN。
- **19 206 条 / 450 ms 的来源**：`docs/plans/2026-10-29-mbd-dimension-remaining-work-dev-plan.md` §11.17 的一次性 `npx tsx` 探针——把 `24381_1443` 房间的 310 个 BRAN 的记录**全量灌进布局**，不经任何界面路径。

---

## 1. `mbd_refno` 单值链路改多值，要动哪些文件

按数据流顺序列，每条给「现在是什么」与「多值要改的形状」。行号对应当前 `main`。

### 1.1 URL 写入端（两处，都是单值 `set`）

| 文件 | 位置 | 现在 | 多值要改的形状 |
| --- | --- | --- | --- |
| `src/dimension/ui/DimensionPanelDock.vue` | `:380-401`（`mbdRefnoInput` / `writeMbdRefno` / `applyMbdRefno`）| `url.searchParams.set('mbd_refno', normalized)`，单个输入框 | 参数编码要定：逗号分隔、重复 key（`mbd_refno=A&mbd_refno=B`）还是新参数 `mbd_refnos`。`set` 改 `append` 或改编码；输入框从 `ref<string>` 变 `ref<string[]>` 或逗号解析 |
| `src/components/model-tree/ModelTreePanel.vue` | `:1138-1150`（`viewMbdDimensions`）| 右键「查看尺寸标注」`set('mbd_refno', ...)` 后 `replaceState` + 派发 `popstate`，**覆盖**上一个 | 要么改成 `append`（累加选中），要么维持覆盖语义并另给「加入当前视图」的入口。这决定「同屏」是「选中累加」还是「显式列表」 |

### 1.2 URL 读取端（两处，都是单值 `get`）

| 文件 | 位置 | 现在 | 多值要改的形状 |
| --- | --- | --- | --- |
| `src/dimension/ui/DimensionPanelDock.vue` | `:384-388`、`:494-497`（`syncDisplayModeFromLocation`）| `get('mbd_refno')?.trim() ?? ''` | 同上解析；面板还要显示 N 个 BRAN 各自的记录数 / 诊断 |
| `src/composables/useMbdExternalSync.ts` | `:168-177` | `params.get('mbd_refno')?.trim() \|\| ''`，空则 `replaceExternalSource('mbd', [])` | 解析成 `string[]`；空数组才清空 |

### 1.3 取数层（一次一个 BRAN）

| 文件 | 位置 | 现在 | 多值要改的形状 |
| --- | --- | --- | --- |
| `src/api/mbdV2Api.ts` | `:136-216`（`fetchMbdV2PipeData`）| 单 refno → 单 URL；15 s 超时、20 MB 体积护栏、单路 AbortController | 每 BRAN 一次请求，需要并发上限（否则 310 个 BRAN 同时打后端）、逐请求超时、部分失败策略（一包失败是否整屏失败） |
| `src/composables/useMbdExternalSync.ts` | `:183-220` | `await deps.fetchPipeData(mbdRefno)` 单包；`mappedSkipped.length > 0 && !partialEnabled` 时**整包原子拒绝**（ADR 0046）| 原子拒绝的粒度要重新定义：现在是「这一包整包拒」，多包时是「任一包拒则全拒」还是「逐包拒、成功的照常显示」。这是语义变化，不是纯重构 |

### 1.4 外部记录容器（一个 `mbd` 槽位）

| 文件 | 位置 | 现在 | 多值要改的形状 |
| --- | --- | --- | --- |
| `src/dimension/services/externalDimensionRegistry.ts` | `:24-78` | `recordsBySource: Map<ExternalDimensionSource, records>`，`replaceSource('mbd', records)` **整槽覆盖**；跨槽 id 重复直接抛错 | 两条路：**(a)** 仍用一个 `'mbd'` 槽，把 N 个 BRAN 的记录拼成一个数组再 `replaceSource`；**(b)** 扩 `ExternalDimensionSource`，给每个 BRAN 一个槽（`'mbd'` → `'mbd:24381_145018'` 之类）。**代价差在诊断与清除粒度**：(a) 拿不到「哪个 BRAN 出问题」，(b) 要改 `ExternalDimensionSource` 联合类型 + `externalDimensionCategory` 之外所有按 source 分支的地方 |
| `src/dimension/adapters/normalizeExternalDimensions.ts` | `:12-18` | `ExternalDimensionSource` 是字面量联合 | 选 (b) 时要改这个联合；选 (a) 不用 |

**id 冲突实测：不冲突。** MBD 记录 id 就是 `primitive.id`（`src/dimension/adapters/mbdV2ExternalAnnotations.ts:334`），后端按 `<refno>:isoline:...` 生成。实测 `24381_145018`（77 个图元）与 `24381_146979`（178 个图元）的 id 交集为 **0**。所以 (a) 路不会被 `replaceSource` 的重复 id 检查挡住。

### 1.5 诊断（单包快照）

| 文件 | 位置 | 现在 | 多值要改的形状 |
| --- | --- | --- | --- |
| `src/composables/useMbdDiagnosticsStore.ts` | `:8-30`、`:64-85` | `snapshot` 是**单例单包**：`sourceId: string \| null`、`issues: []`、`skipped: []`、`sourceVersion: 单个` | 要么变数组（每个 BRAN 一份快照），要么保留一份但加 `perRefno` 映射。面板 `DimensionPanelDock.vue:874-884` 现在直接读 `mbdDiagnostics.sourceId`，要跟着改 |
| `src/composables/useMbdExternalSync.ts` | `:146-160` | `lastFailureToast` 按 `{refno, message}` 去重，**单条记忆** | 多包时会被下一个包的失败顶掉，刷屏或漏报二选一 |

### 1.6 视图装配端

| 文件 | 位置 | 现在 | 多值要改的形状 |
| --- | --- | --- | --- |
| `src/components/dock_panels/ViewerPanel.vue` | `:2866-2882` | `createMbdExternalSync({...})` + `handleMbdLocationChange` → `sync(system)`；`popstate` 时全量重跑 | 同步函数签名从「读 URL 拿一个 refno」变「读 URL 拿 N 个」；取消语义 `isCancelled: () => dimensionSystem !== system` 仍可用，但多请求要各自可取消 |
| `src/components/dock_panels/ViewerPanel.vue` | `:4067-4072` | `show_refno` 决定**几何**装哪个单元；与 `mbd_refno` 是两条独立链路 | 多 BRAN 同屏时几何侧也要多根（`show_refno` 目前同样单值），否则只有标注没有构件 |

**改动面小结（不计测试）**：必须动 **6 个文件**（`DimensionPanelDock.vue`、`ModelTreePanel.vue`、`useMbdExternalSync.ts`、`mbdV2Api.ts`、`useMbdDiagnosticsStore.ts`、`ViewerPanel.vue`）；条件动 **2 个**（`externalDimensionRegistry.ts`、`normalizeExternalDimensions.ts`，取决于选 (a) 还是 (b)）。其中 `useMbdExternalSync.ts` 的**原子拒绝语义**与 `useMbdDiagnosticsStore.ts` 的**单包快照形状**是两处真正的设计改动，其余是参数编解码。

---

## 2. 多 BRAN 叠加后段数 / 记录数分布

数据源：`docs/verification/mbd-3d-dimension-presentation-2026-09-12/all-pipes-brans.json`，2 469 条 HTTP 200 记录（2 693 条里剩下的 224 条非 200）。

### 2.1 单 BRAN 分布（n = 2 469）

| 量 | p50 | p90 | p99 | max | 均值 |
| --- | --- | --- | --- | --- | --- |
| 图元数（`primitives`）| 25 | 77 | 257 | **463** | 38.5 |
| 记录数（图元数 − `label` 数，`label` 与 `leader_line` 合成一条）| 19 | 63 | 229 | **419** | 30.8 |

图元合计 95 091；记录合计 75 947。

### 2.2 随机叠加（每组 400 次有放回抽样，取合计值）

| BRAN 数 k | 记录数 p50 | p95 | max | 图元数 p50 | p95 | max |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 55 | 220 | 368 | — | — | — |
| 5 | 125 | 338 | 608 | 162 | 382 | 674 |
| **19**（房间 p50）| **563** | **934** | 1 262 | 368 | 688 | 1 192 |
| **32**（p60）| **934** | **1 372** | 1 827 | 729 | 1 145 | 1 373 |
| **66**（p90）| **2 049** | **2 598** | 3 075 | 1 872 | 2 453 | 3 246 |
| 123（p95）| 3 753 | 4 544 | 5 374 | 3 893 | 4 696 | 5 220 |
| 221（p99）| 6 724 | 7 810 | 8 694 | — | — | — |
| **310**（max）| **9 521** | **10 702** | 11 468 | 11 790 | 13 427 | 14 357 |

**与 §11.17 的 19 206 条对不上，原因要说清**：§11.17 是 `24381_1443` 这一个房间的实测，310 个 BRAN 平均 **62 记录/BRAN**；本表是 2 469 条全库抽样的随机叠加，均值 30.8 记录/BRAN。**两者不是同一个口径**——前者是「最坏房间」，后者是「典型 BRAN 的随机组合」。做容量规划要用前者，做「常见房间会长多大」要用后者。

### 2.3 段数

§11.17 实测：19 206 条记录 → **1 330 567 段**，约 **69 段/条**（`scene-glyph-run` 占 98.2 %）。按同一比例外推：

| 场景 | 记录数 | 段数（×69）| 按 40 000 段/帧的理论批数 |
| --- | --- | --- | --- |
| 19 BRAN（p50）| 563 | ≈ 3.9 万 | ≈ 1 |
| 32 BRAN（p60）| 934 | ≈ 6.4 万 | ≈ 2 |
| 66 BRAN（p90）| 2 049 | ≈ 14.1 万 | ≈ 4 |
| 310 BRAN（max，典型抽样）| 9 521 | ≈ 65.7 万 | ≈ 17 |
| 310 BRAN（`24381_1443` 实测）| 19 206 | **133.1 万** | **48（实测）** |

理论批数按「总段数 / 40 000」算，实测 48 > 33 是因为批切点按记录边界对齐（一条记录的段不能跨批），且单条记录段数 max 837。

复现命令（PowerShell，读 JSON 后统计 + `System.Random 42` 抽样）：

```powershell
$j = Get-Content 'docs/verification/mbd-3d-dimension-presentation-2026-09-12/all-pipes-brans.json' -Raw | ConvertFrom-Json
$ok = $j.rows | Where-Object { $_[3] -eq 200 }
$rec = foreach ($r in $ok) { [int]$r[5] - [int]($r[6].label) }
```

---

## 3. 现有分帧预算在 310 BRAN 场景下的实际帧数

`SEGMENT_BUDGET_PER_FRAME = 40_000`（`src/dimension/viewport/dimensionViewport.ts:79`），批大小由 `batchLayoutsFor`（`:91-108`）按段数累加切。

§11.17 实测（同一份 310 BRAN / 19 206 条 / 133 万段，热缓存、1920×1080 dpr2、Ryzen 9 7950X）：

```
NEW: batchLayouts=407 batches=48  per-batch p50=9.6ms p95=14.3ms max=18.7ms total=462ms
OLD: batchLayouts=6402 batches=3  per-batch p50=153.6ms p95=183.5ms
```

- **48 帧**补齐，60 fps 下约 **0.8 秒**的「画一半」窗口；
- 单批 p95 14.3 ms，在 16 ms 预算内；max 18.7 ms 略超；
- 总耗时 462 ms 与旧实现的 466 ms 基本一致——分帧只改分布，不改总量。

分帧期间的硬约束（W5-5）：`painting === true` 时 `render()` 早退、`renderOverlay` 会 `finishBatchedPaintNow()` 把剩余批次一次写完。所以**用户在 48 帧窗口内动一次相机，就会退化成一次同步的 462 ms 卡顿**。多 BRAN 同屏会让这个窗口按段数线性变长。

叠加后的帧数（按 40 000 段/帧、理论值）：

| 场景 | 段数 | 批数（理论）| 0.8 s 窗口按比例折算 |
| --- | --- | --- | --- |
| 19 BRAN | ≈ 3.9 万 | 1 | 无窗口 |
| 32 BRAN | ≈ 6.4 万 | 2 | ≈ 33 ms |
| 66 BRAN | ≈ 14.1 万 | 4 | ≈ 67 ms |
| 310 BRAN（典型）| ≈ 65.7 万 | 17 | ≈ 280 ms |
| 310 BRAN（`24381_1443`）| 133.1 万 | 48（实测）| ≈ 800 ms |

---

## 4. 不做多 BRAN 的话，19 206 条 / 450 ms 是否只是能力上限

**是。有两条独立证据。**

### 4.1 现有 UI 没有多 BRAN 同屏入口

`mbd_refno` 在读取端只有 `params.get(...)` 单值（`useMbdExternalSync.ts:169`、`DimensionPanelDock.vue:387`、`:497`），写入端只有 `set(...)` 覆盖（`DimensionPanelDock.vue:393`、`ModelTreePanel.vue:1144`）。`show_refno` 同样单值（`ViewerPanel.vue:4069`）。

后果：`/api/mbd/v2/pipe/{refno}` 一次只能喂一个 BRAN 的记录，`replaceExternalSource('mbd', records)` 整槽覆盖。**任何 URL 组合都产不出「310 个 BRAN 的记录同时在布局里」这个状态**——19 206 条是探针直接调 `layoutViewport` 的结果，不是界面路径。

§11.17 也记了同一条：试过用 Playwright 打开 `24381_1443` 等 300 秒拿不到布局，因为几何侧（`show_refno`）与 MBD 侧（`mbd_refno`）都不会跟着房间走。

### 4.2 实测的「每 BRAN 成本」与真实房间分布

单 BRAN 实测（本次 W4-1 B / C 采集，每步强制全量布局，dev 构建 / DPR 1 / headless）：

| BRAN | 记录数 | 画出 | `layoutMs` P95 | `paintMs` P95 | `frameMs` P95 |
| --- | --- | --- | --- | --- | --- |
| `24381_145018` | 63 | 21 | 3.30 | 17.80 | 19.30 |
| `24381_146979` | 166 | 58 | 5.30 | 17.10 | 19.80 |

`layoutMs` 与记录数近似线性（≈ 0.02 ms/条），`paintMs` 几乎不随记录数变（15.5～17.3 ms，固定开销主导）。按这个斜率外推 19 206 条：`layoutMs` ≈ 380 ms（与 §11.17 实测的 88.6 ms 布局 + 450 ms 绘制同一量级，后者含字形 run 的额外成本），`paintMs` 则要看段数而不是记录数——§11.17 的 450 ms 与 2k 记录场景的 78.6 ms 差 5.7 倍，而记录数差 9.6 倍，说明 paint 在超大输入上才开始按段数走。

也就是说：**这条链的瓶颈不是「现在慢」，而是「现在没有任何路径会走到那里」**。要把它变成「必须优化到的场景」，前置条件是先有多 BRAN 同屏的入口（第 1 节的 6～8 个文件改动）。

### 4.3 现状下 310 BRAN 房间的真实行为

`show_refno=24381_1443` 只装单元子树几何，`mbd_refno` 只能给一个 BRAN → 同屏最多 **1 个 BRAN 的 MBD 标注**，其余 309 个 BRAN 的 MBD 数据不参与布局。所以今天打开 R144 的成本与打开任意单 BRAN 房间相同（`layoutMs` 数毫秒、`paintMs` 十几毫秒），与 19 206 条无关。

---

## 附：本次侦察的取数

| 用途 | 命令 / 来源 |
| --- | --- |
| BRAN 图元分布 | `docs/verification/mbd-3d-dimension-presentation-2026-09-12/all-pipes-brans.json`（2 693 行 / 2 469 条 200）|
| 记录数 = 图元数 − `label` 数 | `mbdV2ExternalAnnotations.ts:333-344`（`label` 与 `leader_line` 合成一条记录）|
| id 跨 BRAN 唯一性 | `GET http://127.0.0.1:8022/api/mbd/v2/pipe/{refno}`，比较 `primitives[].id`；`24381_145018` ∩ `24381_146979` = 0 |
| 段数 / 批数实测 | 计划 §11.17（`24381_1443` 探针）|
| 单 BRAN 成本 | `docs/verification/mbd-perf-baseline-2026-10-29/README.md`「B / C 真实 BRAN」表 |
| 后端可用性 | `aios-database.exe` 监听 `127.0.0.1:8022`（rocksdb 档），`/api/v1/health` 200 |
