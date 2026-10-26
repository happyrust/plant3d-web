# plant3d-web ↔ gen-model 增量更新联动验证（2026-10-26）

> 问题：gen-model 在 E3D 库文件前移（SAVEWORK）后做完增量批次，plant3d-web 能不能跟着变？哪些环节是自动的、哪些要人动手？
> 做法：不要 E3D，用 gen-model 的 L2 回放夹具（`db_session_fixture replay-step`）把录好的会话链逐步就地写进一个影子工程根，前端用 Chrome headless（Playwright）打开，每步前后读后端水位 / 任务、前端 DTX 世界包围盒 / 属性面板 / 模型生成对话框。
> 结论先行：**后端增量链路通，前端重载后读到的就是新数据；但前端对后端自己跑完的批次不会自动刷新（三维场景、属性面板、对话框水位行都要人点）——这是 2026-09-09 收口计划 §12 的既定设计，不是缺陷；WS 事件本身能到浏览器。**

## 1. 环境

| 件 | 值 |
|---|---|
| gen-model | `D:\Rust\target\release\aios-database.exe`，`/health` 报 `0.1.44+g83aa3c250088.1793015921.dirty`（refactor `83aa3c250`）；`AIOS_DATA_FACE=ingest`、`AIOS_STORE_MODE=rocksdb`（一次性 `bin/surreal.exe` 127.0.0.1:8199）、`AIOS_STARTUP_AUTORUN=1`、`AIOS_SKIP_STARTUP_ROOM_BUILD=1`；配置从仓根 `DbOption.toml` 派生，只改 `project_path` / `http_api_addr=127.0.0.1:9199` / `watch_dbnums=[8000]` / `auto_initialize_new_dbnums=true` / `v_ip` / `v_port`（与 `tests/increment_replay` harness 同一套改法） |
| 工程 | 影子根 `_runs\plantui-linkage\E3D3.1`：`scripts/replay/New-ShadowProjectRoot.ps1 -Replayed AvevaMarineSample\ams000\ams8000_0001`（源 `D:\AVEVA\Projects\E3D3.1`，26 个 junction / 451 个硬链接 / 17 个拷贝）；被回放的 `ams8000_0001` 由 `db_session_fixture replay-init --to 725` 写出 |
| 会话链 | `tests/fixtures/sessions/ams8000-equi-move-chain`（725 基线 → 727 EQUI =24384/24776 BY U 500 → 730 BY D 500 → 731 尾会话），接 `ams8000-equi-room-cross`（732 BY U 2000 → 733 尾会话 → 734 BY D 2000） |
| plant3d-web | 工作区 `188993f5`，Vite dev :3101；页面 `/?output_project=AvevaMarineSample&show_refno=24384_24776&gm_backend_port=9199`（第 3 轮起加 `&dtx_recenter=0`，让 DTX 世界包围盒是真坐标）；Chrome 156 headless，Playwright 1.58 `channel: 'chrome'` |
| 读数 | 后端：`GET /api/v1/dbnums`（A/M/F 三水位）、`GET /api/v1/tasks/{id}`、`POST /api/v1/model/records`；前端：`window.__dtxLayer.getObjectBoundingBox()`、属性面板 `POS` 行、模型生成对话框「按库」表 8000 行；浏览器 WS 帧与 `/api/v1/*` 请求全部记录（`data/`） |

## 2. 结果

### 2.1 后端自动路径：文件前移 → 批次 → 水位齐平

| 步 | 会话 | 发现文件变化（F 跳） | A=M=F 齐平 | 任务 | 单元 `kind` | EQUI 包围盒 z（mm） |
|---|---|---|---|---|---|---|
| 1 | 725 → 727（BY U 500） | +3.0 s | +15.2 s | `db-20261026-212127-000047` succeeded，总耗时 1121 ms | `regen`（`transform_fallback_reason = projection incomplete`：这根是前端打开页面时按需生成的，投影不完整，按设计回 regen） | 1125..1675 → 1625..2175 |
| 2 | 727 → 730（三个会话一窗，BY D 500） | +4.6 s | +12.1 s | `db-20261026-214157-000048` succeeded | `transform` | 1625..2175 → 1125..1675 |
| 3 | 731 → 732（BY U 2000） | +4.6 s | +25.8 s（中间 +18 s 观察到 `model_source=memory`，写后落库前的窗口） | `db-20261026-215257-000050` succeeded | `transform` | 1125..1675 → 3125..3675 |
| 4 | 732 → 733（只登录，DBMDAT-only） | — | +6.1 s（+4.1 s 时 A=733 M=732 短暂 lagging） | `db-20261026-220327-000052` | 无单元 | 不变 |
| 5 | 733 → 734（BY D 2000） | — | +22.3 s | `db-20261026-220357-000053` | `model_unit_started/finished` EQUI 24384/24776 | 回 1125..1675 |

任务详情里的分步账（`steps`）都在：三个 DESI 批次的 `room_reference` 282–365 ms、`stage_apply` 242–342 ms、`units` 57–102 ms（`data/*-task-*.json`）。

### 2.2 前端：重载后读到新数据，不重载不变

| 观察点 | 步前 | 后端齐平后、页面不动 | 重载页面后 |
|---|---|---|---|
| 属性面板 `POS` z（步 1） | 1400 | 1400 | **1900** |
| 属性面板 `POS` z（步 2） | 1900 | 1900 | **1400** |
| 属性面板 `POS` z（步 3） | 1400 | 1400 | **3400** |
| DTX 世界包围盒 z（步 3，米，`dtx_recenter=0`） | 1.125..1.675 | 1.125..1.675 | **3.125..3.675**（+2.000） |
| `CACHID` | 40 | — | 41 / 42 / 43 逐步走 |

重载后前端请求的是同一套 `/api/v1/tree/*`、`POST /api/v1/model/records`、`GET /api/v1/meshes/{hash}.mesh`、`POST /api/v1/element/attributes`，没有缓存挡路（`data/step*-summary.json` 的 `apiCallsAfterStep`）。

### 2.3 模型生成对话框（「按库」表）与 WS 任务流

- 打开对话框 → 「按库」：8000 行显示 `DESI 732/732/732 已同步`（图 04）。
- 勾 8000 →「初始化 / 更新所选（1）」：`POST /api/v1/update/execute` 202 → 任务 `db-20261026-220319-000051`，前端随即 `GET /tasks/{id}` × 4、`GET /dbnums` × 2，并打开 `ws://localhost:9199/api/v1/ws`；回执区显示「上次执行：入队 1 · 最新 17」和服务端警告（监听限定模式、目录核对另起任务）（图 05）。**前端→后端的手动更新路径通。**
- WS 连上之后，后端自己触发的 733 / 734 两个批次的 `task_started` / `task_progress`（`data_batch_started/finished`、`model_unit_started/finished` EQUI 24384/24776）/ `task_finished` 共 13 帧**都到了浏览器**（`data/dialog-ws-frames.json`）。
- 但 8000 行在 733 / 734 齐平后仍显示 `732/732/732`，直到点「刷新」才变 `734/734/734`（图 06）；属性面板 `POS` 也停在 3400。原因在 `useModelGenerationAdmin.applyTaskEnvelope`：只处理前端自己登记过的 task_id，其他信封静默忽略；WS feed 也要到第一次登记任务才拉起（前三轮没点过按钮，浏览器里只有 Vite HMR 那条 WS）。这与 gen-model `docs/specs/web-service-api.md` §5.3 的注记一致：「plant3d-web 自 2026-09-09 起不再消费 task_finished 也不轮询 /tasks，只吃自己 ensure 出来的数据」。

## 3. 结论与建议

1. **后端增量链路正常**：文件前移 3–5 s 内被看见，12–26 s 内数据 + 模型水位齐平，位移走 `transform` 便宜路，包围盒按 ±500 / ±2000 mm 平移。
2. **前端读数正确**：重载后属性、几何、水位表、update/execute 回执全部对得上后端。
3. **实时联动是缺的，而且是有意缺的**：要让前端跟着后端自动批次动，需要新增一条路——订阅 `tasks` 主题（不只是自己登记的任务），`task_finished` 且 `dbnum ∈ 已装入的库` 时：刷 `/dbnums` 那一行；按 `result.units[].root_refno` 交 已加载生成根，重读 records + 换 DTX 实例；属性面板对当前选中构件重拉 `element/attributes`。是否要做、取舍（用户正在标注 / 测量时场景被换掉的体验）要单独立项。
4. 顺带一条观察：前端按需生成过的根，紧接着的第一个位移批次会因 `projection incomplete` 走 regen 而不是 transform（步 1）；之后的批次正常 transform。对结果没影响，只是首次慢一点（102 ms vs 57–60 ms）。

## 4. 产物

- `01-step727-before-scene-pos1400.png` / `02-step727-after-reload-pos1900.png` / `03-step732-after-reload-pos3400.png`：三维查看器 + 属性面板（左下角状态栏「已连接 gen-model :9199」）。
- `04-dialog-dbnums-8000-732.png` / `05-dialog-after-update-execute.png` / `06-dialog-after-refresh-734.png`：模型生成对话框「按库」表。
- `data/step{727,730,732}-summary.json`：每轮的 before / afterStep / afterReload 读数、水位时间线、包围盒差、前端请求清单；`data/*-task-*.json`：后端任务详情（含 `steps` 与单元回执）；`data/*-log.txt`：脚本时间线；`data/dialog-ws-frames.json` / `dialog-api-calls.json`：第 4 轮浏览器收到的 WS 帧与请求。
- 驱动脚本是临时的（`%TEMP%\plantui-linkage\linkage.mjs` / `linkage-dialog.mjs`，跑完已删）；复现按 §1 的命令重建即可。影子根、rocksdb 库、服务进程跑完也已清理。
## 5. 轻量联动落地后的复验（同日，`b394940f` 及后续）

用户拍板「轻量联动：只刷水位行 + 提示『有更新，点此重载』，不自动换场景」。实现：`useGenModelV1UpdateNotice`（订阅 tasks 主题全部任务的
`task_finished`，DESI 且有变化且库已装入 / 批次里的根在场景才提示）、`GenModelV1HealthBadge` 旁的提示条（重载 / 忽略）、
`showModelByRefno({ refresh })`（清记录缓存重查 + replace 装载，不重新生成、不飞相机）、`useModelGenerationAdmin` 对非本会话任务的
`task_finished` 也刷一拍 `/dbnums`。同一套隔离栈重置到 725 后复验（前端换成自己起的 Vite :3111，其余同 §1）：

| 步 | 观察 | 结果 |
|---|---|---|
| 页面打开 | 浏览器里的 WS | `ws://localhost:9199/api/v1/ws` 在任何任务登记之前就已连上（以前只有 Vite HMR 那条） |
| 725 → 727（BY U 500） | 状态栏 | 文件前移后 16.6 s 出现「库 8000 已更新到会话 726→727（改 2 项，场景内 1 根受影响） 重载 ×」（图 07）；场景与 POS 不动 |
| 点「重载」 | DTX 可见对象 / POS | 1.5 s 内可见对象换成 `o:24384_24777:1`，z 1.125..1.675 → **1.625..2.175**（+0.500 m），旧对象隐藏；POS z 1400 → **1900**（ui-attr 查询失效重拉）；提示条消失；控制台 `[model-load] … loaded_refnos=1 objects=1`，相机未动（图 08） |
| 727 → 730（对话框「按库」开着） | 8000 行 | 24.2 s 后自动变 `730/730/730 已同步`，不点任何按钮（图 09）；提示条同时换成「728→730」 |

第一版的探针用 `isModelActuallyLoaded(root)` 判「根在不在场景」，EQUI 自己没对象（几何在成员 24777 名下）、`show_refno`
直装的路也不进 `loadedRoots`，提示条出来了但没有「重载」按钮；改成沿属主链问装载器（`resolveDtxObjectIdsByUnitRefno(dbnum, root)`）后才是上表的结果。
产物：`07-feature-notice-727.png`、`08-feature-after-reload-pos1900.png`、`09-feature-dialog-auto-refresh-730.png`、`data/feature-summary.json`、`data/feature-log.txt`。