# 「模型生成」面板链路实测 · SITE / DBNUM / 空间索引 / 房间归属（2026-10-15）

「模型生成」抽屉背后四条 API 链路的 CLI 实测：先验 MDB 全库房间模型前置，再测
SITE 级 `model/generate`、DBNUM 级 `update/execute`，最后验证空间索引与房间归属贯通。

上位文档：`spatial-bran-range-query-2026-10-14/README.md`（同日后端现场、7999 初始化记录）。

## 环境

| 项 | 值 |
| --- | --- |
| 后端 | gen-model `0.1.39+release.20261014235333.gb760b0d8ea80`，`http://127.0.0.1:3100`（兼容口 → 内部 `http.bind_addr=127.0.0.1:8022`） |
| 身份 | `project=AvevaMarineSample, mdb=/ALL, namespace=1516` |
| 监听范围 | `watch_dbnums=[7997,7998,7999,8000]`（命令行 `--watch-dbnum` 收窄，`watch_dbnums_origin=命令行 --watch-dbnum`） |
| 存储 | `sul_db medium=rocksdb, durable=true`；`data_face=ingest` |
| 初始化 | `initialization.status=model_ready`，`data_ready/model_ready/model_phase_open=true`，`auto_initialize_new_dbnums=false` |

## ① MDB 全库房间模型前置 —— ready

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 房间体制开关 | `GET /api/v1/health` → `features.room` | `status=available`，`executor=durable`，generation `72979202d292…`；`room_membership=true` |
| 常驻房间模型 | 同上 → `room_build.resident` | `status=ready`：**215 间房 / 230 块在册面板全部有几何**，`mdb_dbnums_loaded` = 29 库全到位，启动时 2.06 s 建好（`startup_duration_ms=2059`）；`bootstrap.status=idle`（无排队） |
| 房间查询面 | `GET /api/v1/spatial/rooms` | `status=ready`，`definition_version` = 常驻代，215 间房（主体 dbnum 7997，如 `/1RX-RM01-R101`） |
| 各库房间边对齐 | `GET /api/v1/dbnums?project=AvevaMarineSample` → `room_alignment` | **7997/7998/7999/8000 全 `current=true`**（gen=res=`72979202`）；其余 DESI 库 `init=false`、`current=false`（未初始化、watch 范围外）；DICT/SYST/MISC/COMM 无此格（不参与房间） |

4 个 watch 库水位全对齐：

| dbnum | applied/model/file | verdict | room_alignment |
| --- | --- | --- | --- |
| 7997 | 357/357/357 | in_sync | current |
| 7998 | 540/540/540 | in_sync | current |
| 7999 | 205/205/205 | in_sync | current |
| 8000 | 646/646/646 | in_sync | current |

## ② SITE 生成 —— `model/generate` 一次过

```powershell
POST /api/v1/model/generate {"project":"AvevaMarineSample","refno":"24381/42520","force":true}
```

目标：SITE `/1RB-CIVI`（`24381_42520`，dbnum 7997，`tree/roots` 直出）。回执：

```json
{"status":"Generated","model_available":true,"model_instance_count":24,
 "generation_root_count":17,"cached_root_count":7,"generated_root_count":10,
 "dbnum":7997,"model_source":"database","durable":true,"publication_status":"ready"}
```

- 新版服务端（v0.1.39）对 SITE 一次返回 `generation_roots[17]`；前端的 422 `container` 逐层展开兜底（`modelRecords.ts::generateThenCollect`）**未触发**，兼容路径保留。
- `POST /api/v1/model/records {"generation_root":"24381/42520"}` → **24 条记录**，`truncated=false`，`owner` 回填 SITE 自身。

## ③ DBNUM 整库管线 —— `update/execute` 回执语义正确

```powershell
POST /api/v1/update/execute {"project":"AvevaMarineSample","dbnums":[7997,7998,7999,8000,1112]}
```

→ `202`：`scanned=21, up_to_date=21, enqueued/merged/already_covered/blocked 全空`。

`warnings` 三条均符合契约：

1. watch 限定模式总提示（只处理 `7997,7998,7999,8000`，SYS meta 不受限）；
2. `dbnum=1112: 在执行范围内，但本次扫描没有找到它的候选文件，没有可入队的批次` —— 点名 watch 外库被如实跳过（面板「按库」Tab 页脚注的同款文案）；
3. 目录版本核对另起任务（`/health.catalogue_reconcile`）。

无任务入队 = 五段管线（数据→生成→发布→空间树→房间归属）此前已跑完；面板这时渲染
「上次执行：最新 21」，与 `useModelGenerationAdmin.executeSummary` 语义一致。

## ④ 空间索引 + 房间归属 —— 全链路贯通

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 空间树 | `/health` → `spatial_tree` | `state=ready`，82811 条，7997-8000 水位 `[357,357]/[540,540]/[205,205]/[646,646]`，`drift=false` |
| 邻近查询 | `GET /api/v1/spatial/nearby?refno=24381/42520&radius=50000&include_self=true` | `spatial_state=ready`，82364 候选，命中 PANE/WALL 等 |
| 构件房间归属 | `POST /api/v1/query {tool:"e3d.room.lookup", arguments:{refno:"24381/44295"}}` | `ready_nonempty`：归属 **R162**（`24381_1489`，panel `24381_1491`），`published_version=357`，`publication_status=current`，`stale=false`；同 SITE 其它构件 `ready_empty`（算过、不在任何房间） |
| 房间过滤查询 | `spatial/nearby?refno=24381/42520&radius=100000&rooms=24381/1489` | `room_status.source=durable`（落盘 `room_relate` 边）、`matched=333`、`unresolved=0`；结果首条 `24381_44295` WALL 正是上一步归属的构件——**生成→发布→房间边→查询闭环一致** |

注：`radius` 上限 100000 mm（`400 bad_request` 会提示）。

## 边界观察：watch 外 / 未初始化库的直接 `model/generate`

对 dbnum 1112 的 SITE `/1RS-CIVI`（`9304/2`，未初始化、`init=false`）直接 generate：

```json
{"status":"Generated","model_instance_count":4934,"generation_root_count":18,
 "dbnum":1112,"model_source":"memory",
 "model_source_reason":"data_watermark_unestablished","durable":false}
```

**能生成，但只落内存不落盘**：数据摄入段没跑过就没有水位，服务端退回读透形态。
印证操作顺序要求——**要 durable 产物必须先把库纳入 `update/execute` 范围**
（`watch_dbnums` 或重启配置），否则生成结果进程一重启即失，且无空间树 / 房间边。

`spatial/nearby` 的 `library_alignment_current=false` 同因：半径内候选跨了对齐库
（7997-8000）与未初始化库——按库看 watch 内各自 `current=true`，属如实提示而非缺陷。

## ⑤ 前端真机走查（`npm run dev` → `localhost:3101`，Chrome DevTools）

dev 态 `/api/v1` 直连 `localhost:8022`（与上面同一进程；`:3100` 是其兼容口）。

| 步 | 操作 | 结果 |
| --- | --- | --- |
| 入口 | ribbon「视图 → 模型生成」 | 抽屉挂载 `data-testid=model-generation-drawer` |
| SITE | 「按节点 / SITE」手输 `24381_42520` → `+` | chip `SITE /1RB-CIVI · 待生成`（noun/name 由 `element/attributes` 回填） |
| SITE 生成 | 「重新生成选中目标」 | `24 实例 · 已生成，可点眼睛加载`，与 CLI 回执一致 |
| DBNUM 列表 | 「按库」Tab | 42 行：21「已同步」（7997-8000 水位 `A/M/F` 对齐）+ 21「不参与」（watch 外 DESI `0/0/0`） |
| DBNUM 执行 | 勾 `7997` + `1112` →「初始化 / 更新所选（2）」 | `上次执行：最新 18`（回执 `up_to_date=18`） |

**实测发现并修复一个 UI 缺陷**（`useModelGenerationAdmin.ts`）：

- 症状：`update/execute` 回执的 `warnings`（watch 限定 + `dbnum=1112` 被跳过 + 目录核对说明）
  在面板「服务端告警」框里**不出现**。
- 根因：`executeSelected` 把回执告警并入 `dbWarnings`，但同函数末尾
  `pollTasksOnce().then(() => refreshDbnums())` 会用 `/dbnums` 响应的 `warnings`（本现场为空）
  **整体覆盖** `dbWarnings`——回执告警约一秒内被冲掉。
- 修复：回执告警不再写进 `dbWarnings`，改由 `lastReceipt` 派生 `combinedWarnings`
  （`dbWarnings ∪ lastReceipt.warnings`）给告警框用；`ModelGenerationDrawer` 换绑该 computed。
- 复验：重跑同一组勾选 → 告警框持久显示全部三条回执告警；`eslint` 两文件 0 问题，
  `npm run type-check` 新增 0（基线 476）。

**「使用当前选中（可多选）」**：无选中时正确提示「查看器当前没有选中构件」；
有选中分支与手输共用 `addTargetByRefno`（上方已验）。模型树行点击不写
`selectionStore`（该 store 由三维拾取 / `autoLocateRefno` / PMS 桥填充），属既有行为。

## 结论

- **前置**：MDB 全库房间模型（常驻 published 形态）已 ready 且与查询面同代；SITE/DBNUM
  生成前无需额外动作——本轮前置检查通过即可直接下发。
- **SITE**：`model/generate`（面板「按节点 / SITE」底层）200 Generated、durable、可 `model/records` 回读。
- **DBNUM**：`update/execute`（面板「按库」底层）回执完整：watch 内全 `up_to_date`、watch 外点名库进 `warnings`，语义与面板展示一致。
- **空间索引 + 房间自动计算**：`e3d.room.lookup` 与 `rooms=` 过滤均 `durable` 源、`publication_status=current`；生成构件即刻有房间边。
