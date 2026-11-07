# gen-model `refactor` @ `ffe864f1a` 沙箱验收（2026-11-07）

按用户要求「检查 gen-model 最近的修改，然后再次重新测试一遍，检查还有哪些某些问题」做的一轮干净构建验收。
只读验收：不改 gen-model 源码，不动主工作区的未提交改动，不动线上 8009 / 8022。

## 1. 被验收的代码

### 1.1 gen-model 本地 `refactor` 领先 `origin/refactor` 的 5 个提交

| 提交 | 内容 |
|---|---|
| `f16daa4aa` | `perf(rvm-check)`：比对报告流式落盘、直接从结构体判色，不再经 `serde_json::Value` 树（`rvm_check/mod.rs`、`report.rs`，+279/−90） |
| `c164c8fd5` | `feat(rvm-check)`：`aios-database rvm-check` 子命令——给库号与 E3D 连接信息，自动枚举根、导基准、生成、比对、汇总（+2067/−51，新增 `rvm_check/batch.rs` 1548 行） |
| `91829a8fc` | `feat(rvm-check)`：比对结果入库 `rvm_check_run` / `rvm_check_mismatch`，每条差异带 `reason_kind`（+2102/−62，新增 `rvm_check/store.rs` 1030 行） |
| `c9a153a97` | `chore(read-set)`：随 e3d-model 桥架件托盘空间 / 斜梯扶手标架新读的 16 个属性重生成 `generation_read_set.json` |
| `ffe864f1a` | `test(read-set)`：读取集合条数 183 → 199 |

新增的 16 个属性：`ALENG` `CTTYP` `EXDIST` `HROFF` `HRSTAR` `LLENG` `LPITCH` `OLENG` `SLENG` `SSLENG` `TIERHE` `TRAYH` `TRAYOW` `TRAYRW` `TRAYSW` `TRAYW`。

### 1.2 五个 vendor 仓（均取各自最新**已提交** HEAD，工作区干净）

| 仓 | 提交 | 说明 |
|---|---|---|
| e3d-model | `d7dae60` | 比上一轮验收的 `5775ecb` 多 9 个提交：`5182aef`(#24)、`d139a9d`/`678d456`(rvm_compare 内存)、`7272137`、`bb82906`、`7204171`、`a67420a`(桥架托盘空间)、`b573855`、`13834a5`(斜梯扶手标架)、`d7dae60`(OLET 退化) |
| e3d-io | `74bd1ee` | 新增 `1012 按 exprlib/EXPORE 读成 REAL`、`PLOD 的 ATTRIB POD` 两处目录修复 |
| e3d-attlib | `f37be2e` | 未变（与上一轮相同） |
| plant-mbd | `3db2d92` | 比上一轮 `cb046f7` 多 1 个提交（直段轴线 axis） |
| old-aios-core | `7c0c54e` | 未变 |

**未纳入**（其他工作流未提交改动，按约定不碰）：主工作区 306 个未提交文件；`vendor/e3d-model` 的 `examples/*`；`vendor/e3d-io` 的 `.cursor/`、`tests/scratch_hatch_rpro.rs`；`vendor/e3d-attlib` 的 `src/dict.rs`（455 行新文件）、`src/lib.rs`、`tests/dict_calibration.rs`。

`gen-model` 主工作区 `build.rs` 的未提交改动只是 rustfmt 换行，无逻辑差异。

## 2. 构建

`D:/work/plant-code/accept-clean/gen-model`（detached worktree）+ `accept-clean/vendor/*` 五个 detached worktree，
junction `gen-model/vendor/shared` → `accept-clean/vendor`、`accept-clean/plant-ui` → `old/plant-ui`、
`gen-model/target/debug/scripts` → `gen-model/scripts`。

```
cargo build --bin aios-database        # 53.74 s，dev profile
```

```
build_id=0.1.44+gffe864f1ab2f.1794045788   git_dirty=false
e3d_model_build_id  = 0.1.0@gd7dae6070f38
e3d_io_build_id     = 0.5.0@g74bd1ee101f2
e3d_attlib_build_id = 0.1.0@gf37be2ebe74c
```

## 3. 沙箱

| 组件 | 位置 |
|---|---|
| SurrealDB 8039 | `gen-model/.surreal/sandbox-accept-20261107`（从 `ams-8009` 整份拷出，1.76 GB），`SURREAL_ROCKSDB_BLOCK_CACHE_SIZE=4294967296` |
| 后端 8042 | `accept-clean/gen-model/target/debug/aios-database.exe`，`watch-dbnum` 20 个有 SITE 的库 |
| vite 3113 | `.scratch/accept-sandbox/vite.accept.config.mjs` |
| Chrome 9333 | profile `.scratch/accept-sandbox/chrome-profile` |

后端环境：`AIOS_STORE_MODE=rocksdb`、`AIOS_DATA_FACE=ingest`、`AIOS_MODEL_GENERATION_INPUT_MAX_DBNUMS=1`、
`AIOS_MODEL_ELEMENT_CACHE_MAX_ENTRIES=30000`、`RUST_MIN_STACK=134217728`、`AIOS_STARTUP_CAL_EQUIP=0`。

## 4. 验收通过项

### 4.1 #73 生成器指纹（含 e3d-io / e3d-attlib）

首启日志：

```
生成器核对：17 个库的库级生成器落款与本进程不一致
dbnum=[1112, 7324, 7326, 7327, 7329, 7330, 7331, 7332, 7333, 7350, 7352, 7353, 7354, 7356, 7997, 7999, 8000]
（e3d-model 0.1.0@gd7dae6070f38、e3d-io 0.5.0@g74bd1ee101f2、e3d-attlib 0.1.0@gf37be2ebe74c）
已按整库重排处理
```

17 个库全部 `reason=model_generator_changed` 整库重排，全部 `succeeded`。重排完成后
`dbnum_watermark.model_generator` 已写入三段指纹（`e3d-model:…;e3d-io:…;e3d-attlib:…;aios-database:…;<规则标签>`）。

### 4.2 #88 `durable_pending` 卡点

`equip_derived` 已是独立阶段，带自己的进度、期限与 `/health.equip_derived`。本轮三次记录：

| 库 | 根数 | 口径 | 耗时 | 预算 | deferred | failed |
|---|---|---|---|---|---|---|
| 7333 | 31470 | 整库 | 66.4 s | 300 s | 0 | 0 |
| 7997 | 6772 | 整库 | 301.8 s | 300 s | **845** | 0 |
| 8000 | 954 | 整库 | 6.0 s | 300 s | 0 | 0 |

7997 从「模型生成」到 `task_end` 全程走通，没有再现此前 35 分钟卡死；后排队列（8000）正常出队。

### 4.3 全选一键部署（17 个 DESI 库）

18:59:57 提交，`storage_version.upgrade` 17/17 `done`，`failed` 为空。后端私有内存峰值 3.0 GB，
整机提交余量最低 19.5 GB。此前三次 `memory allocation of … failed` 崩溃（18:43、19:12、19:40）未再出现。

### 4.4 39 个 SITE 全量 RVM 核对

用页面 `useRvmCheckStore().runAllSites()` 跑全部 39 站，E3D TTY 当场导出 + 进程内生成 + 比对。

```
pass 36   empty 3   fail 0   kind_differ 0   tool_error 0
```

三个 `empty` 是 `/1AXIS`（`24383_80151`）、`/MDS/TEMPLATES/ORI`（`23737_1`）、`/Steel_Template_Site`（`15201_535`），
两侧都没有可比几何，判据上算干净。

库内聚合（`rvm_check_run` 42 行，含 4 个库各多一个 SITE）：

```
both 220746   exact 220731   chord 5   reference_artifact 6   film 4
off 0   only_baseline 0   only_generated 0   kind_differ 0   unkeyable 0/0
```

`rvm_check_mismatch` 0 行。全部 42 条 run 的 `verdict` / `status` 都是 `pass`。

对照跟踪清单逐条：

| Issue | 站 | 结果 |
|---|---|---|
| e3d-model#24 | `24381/101405` | 34325 对全一致，`only_generated` 0 |
| e3d-model#21 | `23713/2343`、`15516/2`、`23734/1` | 1933 / 2091 / 2085 对全 exact |
| e3d-model#26 | `15516/2`、`23734/1` | 6 件 unkeyable 未回归，unkeyable 全 0 |
| e3d-model#27 | `24383/73927`、`24383/66456` | 4333 / 4116 对全 exact，off 0 |
| `23705/289` 的 8 只 Z 偏移 | `23705/289` | 32 对全 exact，Z 偏移未回来 |
| `23705/289` kind_differ 4 对 | `23705/289` | kind_differ 0，未回归 |

### 4.5 重建前后几何快照

`snap_all.py` 对 39 站按 `(refno, owner, generic, insts, pts, world_aabb, world_trans)` 求 sha1。

- 重建前 `before2-all.json` 与上一轮干净构建的 `after-all.json` **逐站逐字节一致**（39/39 同哈希）。
  说明 `d7dae60` + `74bd1ee` 这批 vendor 改动在这 39 站上零几何变化。
- 重建后 `after2-all.json`：27 站完全一致、10 站有差异、2 站查询 500。
  差异全部落在「实例数增加」与「同数量哈希变化」两类，与上一轮 `360b30db1` 的结果完全同形（见 §5.2）。

### 4.6 新增 rvm-check 工具链

- 子命令 `aios-database rvm-check --dbnum 7326 --site-only` 整条链路跑通：
  `E3D 导出 22.8 s → 生成 23.5 s（峰值 1606 MB）→ 比对 0.8 s`，结论 `pass 14328/14328`，退出码 CLEAN。
- 结果入库生效：`batch_id accept-sandbox/rvm-batch-7326`，1 个根、0 行 mismatch。
- 三个查询接口正常：
  - `GET /api/v1/rvm-check/history?dbnum=7326` 返回批量 run 与页面 run 混合的倒序历史
  - `GET /api/v1/rvm-check/reasons?dbnum=7997` → `{"count":0,"kinds":[]}`
  - `GET /api/v1/rvm-check/mismatches?dbnum=7997` → `{"count":0,"rows":[]}`

### 4.7 未初始化库的表现

`6003`、`7009`、`7321` 三个库本轮未初始化（不在 `upgrade.done_dbnums` 里，`pe` 表无行，
`23705_1` 的 `model/records` 返回 `model_source_reason=data_watermark_unestablished`）。
它们的 4 个 SITE 仍判 `pass`：

| 站 | dbnum | both | exact |
|---|---|---|---|
| `14195/2` | 6003 | 1 | 1 |
| `15201/535` | 7009 | 0 | 0 |
| `23705/1` | 7321 | 71 | 71 |
| `23705/289` | 7321 | 32 | 32 |

`23705/1`、`23705/289` 的几何来自 E3D 侧与生成侧的目录库解析，不依赖本库 `pe` 落盘。

## 5. 本轮发现的问题

### 5.1 P1 — `POST /api/v1/model/records` 对大体量根返回 500

**现象**：`23717_2`（7333）与 `24381_101405`（7997）连续 5 次探测全部返回

```json
{"code":"internal","message":"Internal error: receiving from an empty and closed channel: Internal error: receiving from an empty and closed channel","detail":null}
```

**数据是好的**：

- 库里 `23717_2` 有 79409 行几何（`inst_relate WHERE anc CONTAINS 101863739359234 AND aabb.d != NONE AND world_trans.d != NONE`）。
- 同一根 RVM 读到 79938 对、全部 pass；`24381_101405` 读到 34325 对、全部 pass。
- `sul_db.disconnects_total = 0`、`ping_ms = 1`，不是连接断了。

**根因**：`fast_model/model_record_reader.rs::model_records_of_root` 走 durable 冷读时，
`durable_records_sql` 拼出的 SQL **不带 `LIMIT`**，一次取回整根全部记录；
`limit` / `cursor` 只在外层 `handlers.rs::page_records_across_roots` 的内存里切片。

用同一 SQL 直连 SurrealDB 测返回体量：

| 根 | 响应体 | `model/records` |
|---|---|---|
| `23717_2` | **34.1 MB** | 500 |
| `24381_101405` | **14.2 MB** | 500 |
| `23711_1`（17076 条） | 7.4 MB | 200 |

超过阈值就撑爆 SurrealDB 的 ws 单条响应，报 `empty and closed channel`；
`retry_sul_db_transport` 的 `is_retryable_sul_db_transport_error` 认这条文本，但重试 3 次都同样失败，
最终把内部错误直接透给调用方。

**影响**：网页上这两个 SITE 的模型树与属性为空（前端 `snap_all.py` 对它们记 0 实例），几何与 RVM 不受影响。
`24381/101405` 是跟踪清单里关注度最高的站之一。

**方向**：把分页下推到 durable SQL（`START`/`LIMIT` 或按 `record_order` 游标），
或把冷读改成分块取。注意 `durable_records_sql` 同时服务 `durable_records_of_root`（房间重算），
改分页要确认那条路径仍拿全量。

### 5.2 P2 — 10 个站重建后实例数与哈希变化

`before2-all.json` → `after2-all.json`，全部是**增加**，没有一站减少：

| 站 | dbnum | 实例数 | 名称 |
|---|---|---|---|
| `24383_80211` | 7999 | 7400 → 8826 (+1426) | `/1RX-ELECBJ` |
| `23740_1` | 7356 | 894 → 1064 (+170) | `/MDS/TEMPLATES` |
| `23734_1` | 7350 | 2026 → 2085 (+59) | `/MDS/TEMPLATES` |
| `23713_2343` | 7329 | 1875 → 1933 (+58) | `/MDS/TEMPLATES` |
| `23714_1` | 7330 | 478 → 481 (+3) | `/MDS/SPECIALS` |
| `24383_73927` | 7999 | 4329 → 4331 (+2) | `/1RCV-PIPEBJ` |
| `15516_2` | 7324 | 2091 → 2091 | `/MDS/TEMPLATES` |
| `23710_1` | 7326 | 14328 → 14328 | `/MDS/HANGERS` |
| `23711_1` | 7327 | 17076 → 17076 | `/MDS/HANGERS` |
| `24383_66456` | 7999 | 4116 → 4116 | `/1WCC-PIPEBJ` |

这 10 站的重建后哈希与上一轮 `360b30db1` 的 `after-all.json` **完全一致**，
即它们是「重建（清库重排）相对未重建」的差异，不是本轮 vendor 改动引入的。
增加的原因指向 #74 修复（按根回读 + `ready_source`，失败的根不再让整库归零）与 #27 的目录库解析。
RVM 对这 10 站全部判 pass，说明增加的行与 E3D 侧一致。

### 5.3 P3 — 7997 的 `equip_derived` 到期留下 845 个未算

`[设备派生量] 根=6772 口径=整库 重算 630 台 / … / 失败 0 / 到期未算 845 301786ms`。

- 预算 `EQUIP_DERIVED_BUDGET = 300 s`，实际跑了 301.8 s，超 1.8 s。
  期限只在「已开始的那一台照常算完」之间检查（`budget_exhausted` 在循环头），单台耗时较长时必然超一点点，属预期。
- `deferred = 845` 是 995 台设备 + 287 阀门 + 193 楼板里没轮到的部分，旧派生量原样保留。
  按设计由手动 `update_cal_equip` 或下一个碰到这些设备/阀门的任务回补。
- 本轮 `cal_equi` 表共 1165 行，`nearest_relate` 0 行。7997 的 630 台重算已落库。
- **待确认**：`/health.equip_derived.deferred_total` 是进程内累加、从不递减，
  一次到期后即使后续任务补齐也不会归零，读数会一直挂着 845。这会让运维误判「还有 845 个没算」。
  建议区分「历史累计推迟」与「当前仍推迟」。

### 5.4 P3 — `SURREAL_WEBSOCKET_RESPONSE_BUFFER_SIZE=0` 未生效

沙箱按既有经验设了 `SURREAL_WEBSOCKET_RESPONSE_BUFFER_SIZE=0`（意图是取消单条响应缓冲上限），
但 §5.1 的 34.1 MB 响应仍然失败。在 gen-model 源码里搜不到这个变量的读取点，
SurrealDB 侧日志也只打印了 `Write buffer size` / `Maximum write buffers`（RocksDB 写缓冲，与 ws 无关）。
说明这个变量名对当前 `bin/surreal.exe`（2.1.x fork）不起作用，此前的「经验」是无效的。

### 5.5 待推送状态

| 项 | 状态 |
|---|---|
| `origin/refactor` | 落后本地 5 个提交（`ffe864f1a` 未推） |
| `origin/publish` | 仍在 `d0a0d6ae9`，缺 #87、#88、#73、#74 与这批 rvm-check 工具 |
| 前端 `plant3d-web` main | 本地领先 origin/main（含选库页对账修复 `040fd470`、`d10aae8d`） |

推 `publish` 会触发 `linux-binary.yml` 自动部署上线，需要明确确认。

## 6. 证据

`.scratch/accept-verify-20261106/`：

| 文件 | 内容 |
|---|---|
| `before2-all.json` | 本轮重建前 39 站快照 |
| `after2-all.json` | 本轮重建后 39 站快照 |
| `before-all.json` / `after-all.json` | 上一轮（`360b30db1`）快照，用于对照 |
| `snap_all.py` | 快照脚本 |

`.scratch/accept-sandbox/`：`aios-8042h.log`（本轮后端日志）、`surreal-8039-1107.log`、
`rvm-batch-7326/summary.json`、`probe-23717_2.json`（34.1 MB）、`probe-101405.json`（14.2 MB）、
`probe-23711_1.json`（7.4 MB）。
