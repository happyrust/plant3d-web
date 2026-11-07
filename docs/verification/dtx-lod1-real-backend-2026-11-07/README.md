# 显示用粗网格（LOD1）· 真后端装载与帧时间对照（2026-11-07）

对应改动：gen-model `feat/mesh-lod1`（已快进到 `origin/refactor` `9346a8312`，ADR-096）与 plant3d-web `5932034d`（`addLod1Geometry` 拒收不比原网格小的网格）。
目的：第一次对着**真会产粗网格的后端**跑完整条链——启动预生成 → 回填 → `?lod=1` 真返回粗网格 → 前端补拉装入 → 远处构件改画粗网格，并给出 LOD 开 / 关的装载、内存、帧时间对照。此前 11-06 的两轮复测都对着不认 `?lod=` 的 8022，那两轮里没有粗网格参与。

**结论先说**：

- 链路通了。18 个库 196 792 个构件、31.6M 三角形的场景里，前端补拉 3388 次 `?lod=1`：2080 次 200（全是真粗网格，共 47.8 MB，`Cache-Control: public, max-age=604800`、`ETag "...-lod1v1"`）、1308 次 404，2080 份 L1 全部装入图层，28 638 个构件具备粗网格档。
- 静止帧按视图省 12–28% 时间：全景直出 339 → 247 ms、E3D 683 → 500 ms（三角形 31.6M → 23.3M），中景 188 → 136 ms，近景 15.9 → 13.8 ms；拖动帧全景 39.4 → 29.3 ms。两轮数字相差不到 1%，拾取不变。
- 代价：GC 后堆多 140 MB（1.83 → 1.97 GB）；补拉在装载结束后 1.9 s 开始、5.3 s 内做完、一次 recompile。装载总耗时两档各两轮都在 115–142 s 之间波动，分不出差异。
- 1308 个 404 里只有一部分是 `.none`（省不够）；其余是沙箱库里那些**用旧生成器发布**的库（7326 / 7327 / 7333 …）——回填按当前生成器算出的键在盘上没有 L0（`unpublished`），这些键既没有粗网格也没有标记。生产上这些库会被「生成器变了」重排、顺手产出粗网格，沙箱是关了重排才这样。

## 环境

| 项 | 值 |
| --- | --- |
| 后端二进制 | `gen-model-lod/target/debug/aios-database.exe`，`build_id 0.1.44+g9346a83128cd`（`feat/mesh-lod1` 合并 `origin/refactor` 之后，已推送并快进到 `origin/refactor`） |
| 后端配置 | `DB_OPTION_FILE` 指向仓库外一份改过的 `DbOption.toml`：`v_port 8019`、`http_api_addr 127.0.0.1:8052`、`enable_log true`、`startup_autorun false`、`server_release_ip 9199`；环境变量 `AIOS_STORE_MODE=rocksdb` `AIOS_MESH_LOD1=1` `PLANT_ASSET_ROOT=D:/work/plant-code/old/gen-model/assets` `AIOS_MODEL_REBUILD_ON_GENERATOR_CHANGE=0` `AIOS_MODEL_GENERATION_INPUT_MAX_DBNUMS=1` `AIOS_MODEL_ELEMENT_CACHE_MAX_ENTRIES=60000`；参数 `serve --watch-dbnum 7997,7998,8000` |
| 库 | SurrealDB 2.1 fork，`rocksdb:gen-model-lod/.surreal/sandbox-lod1`（`ams-8009` 11-06 的拷贝），绑 `127.0.0.1:8019`。生产 8009 / 8022 没动（8022 在中途因整机内存耗尽退出过一次，已按原命令拉回） |
| 网格目录 | 与生产共用 `gen-model/assets/meshes`（L0 118 447 个，前后不变）；粗网格在 `lod1-v1/` |
| 前端 | plant3d-web `main` 工作树（含 `5932034d`；工作树里另有一位同事未提交的 `useDbnoInstancesDtxLoader.ts` 改动——对回原网格的后端按响应头等大判负缓存——对本轮 8052 的真粗网格路径没有影响：2080 个 200 全部装入），`npx vite --port 3121`，`VITE_GEN_MODEL_V1_BASE_URL=http://127.0.0.1:8052` |
| 浏览器 | Playwright 1.58 + 本机 Chrome，headless，1920×1080，`--use-angle=d3d11 --enable-gpu --js-flags=--expose-gc --enable-precise-memory-info` |
| 脚本 | 本目录 `bench.mjs`（从 11-06 的 `.scratch/ams-lod-result/bench.mjs` 改：库表换成沙箱里 `model_verdict=in_sync` 的 18 个、采样前 GC、给 `recompile` 计时、记 lod1 响应头）；运行时放在仓库外 |
| 日期 | 2026-11-07 13:20–14:25 |

## 后端侧

### 启动预生成

二次启动日志（`lod1-v1/` 里已经有 234 个规范圆柱）：

```
[mesh-lod1] 标准图元粗网格就绪: written=0 reused=234 known_skipped=0 skipped=0 unmatched=0 failed=0 dir=...\meshes\lod1-v1 elapsed=5152.6ms
```

### 回填

`POST /api/v1/mesh-lod1/backfill` 分三批（第二批在整机内存耗尽时随进程一起没了，重启后把没跑到的 7 个库再提一批；回填是幂等的，重提即可）：

| 任务 | dbnums | 根 | unpublished | written | reused | known_skipped | skipped | unmatched | failed | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mesh-lod1-20261107-132914-000000` | 7997, 7998, 8000 | 7726 | 0 | 5 | 1644 | 641 | 17 | 0 | 0 | 1 m 55 s |
| `mesh-lod1-20261107-133545-000001` | 1112, 7324, 7326, 7327, 7329, 7330, 7331, 7332 …（到 7333 中途进程退出） | — | 1112:0 · 7324:1090 · 7326:7158 · 7327:11466 · 7329:1014 · 7330:80 | 237 | 16992 | 3586 | 245 | 0 | 0 | — |
| `mesh-lod1-20261107-135125-000000` | 7333, 7350, 7352, 7353, 7354, 7356, 7999 | 40981 | 19330 | 767 | 47005 | 2038 | 287 | 0 | 0 | 12 m |

回填结束时 `lod1-v1/`：2312 个 `.mesh`、830 个 `.none`。

`unpublished` 是「按当前生成器算出的 L0 键在盘上没有文件」：7326 / 7327 / 7333 这些库在沙箱里是用更早的 e3d-model 发布的，键对不上；7997 / 7998 / 8000 当天上午被生产 8022 按「生成器变了」重排过，所以是 0。回填不为对不上的键写任何东西（写了就是给旧键配新内容），这些键前端请求 `?lod=1` 会 404 且没有 `.none`。

### HTTP 契约（8052）

```
GET /api/v1/meshes/e3d_baked_v2_0b8e5053….mesh            200  54492 B  public, max-age=31536000, immutable  ETag "e3d_baked_v2_0b8e5053…"
GET /api/v1/meshes/e3d_baked_v2_0b8e5053….mesh?lod=1      200  32988 B  public, max-age=604800               ETag "e3d_baked_v2_0b8e5053…-lod1v1"
GET /api/v1/meshes/e3d_baked_v2_0b8e5053….glb?lod=1       200  33680 B  model/gltf-binary，同上缓存头
GET /api/v1/meshes/e3d_baked_v2_0b8e5053….mesh?lod=2      400  {"code":"bad_request","message":"lod 只支持 0 或 1: 2"}
GET /api/v1/meshes/e3d_baked_v2_004f2b8b….mesh            200  228204 B
GET /api/v1/meshes/e3d_baked_v2_004f2b8b….mesh?lod=1      404  {"code":"not_found","message":"网格 e3d_baked_v2_004f2b8b… 没有粗精度副本"}   （盘上是 .none）
```

### 进程退出一次（不是 LOD 的问题）

13:42:45 沙箱后端 `alloc_failed`（`logs/crash-notes.log`：`working_set_mb=583 commit_mb=587`，整机 commit 86.2 / 87.6 GB），两秒后生产 8022 同样 `alloc_failed`。整机提交额度被别的进程吃满（Cursor 22.5 GB、多个 cargo），回填自己只用了 0.5 GB 工作集。正在跑的回填任务随进程消失，没有断点续跑；重启后重提即可。

## 前端侧：LOD 开 / 关各两轮

同一后端、同一浏览器、同一 18 个库按同一顺序 `showModelByDbnum`；`&dtx_lod=0` 关粗网格。装完后等补拉与 recompile 稳定（统计 8 s 不变且 3 s 内没有 `lod=1` 响应），再在三个机位测 15 帧取中位数。

| 轮 | 装载总耗时 | lod1 请求 200 / 404 | 粗网格字节 | 补拉窗口（相对装载结束） | L1 装入 | 具备粗网格档的构件 | recompile 次数 / 总 ms | 堆峰值 | GC 后堆（装完 / 补完） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| off-1 | 115.2 s | 0 / 0 | 0 | — | 0 | 0 | 未计 | 4.10 GB | 2.47 / 2.44 GB（未 GC） |
| on-1 | 140.3 s | 2080 / 1308 | 47.8 MB | −111.2 s 起、持续 112.6 s | 2080 | 28 638 | 未计 | 4.51 GB | 3.23 / 3.88 GB（未 GC） |
| off-2 | 129.8 s | 0 / 0 | 0 | — | 0 | 0 | 69 / 7706 | 4.10 GB | 1.84 / 1.83 GB |
| on-2 | 142.1 s | 2080 / 1308 | 47.8 MB | +1.9 s 起、持续 5.3 s | 2080 | 28 638 | 70 / 7872 | 3.63 GB | 1.83 / 1.97 GB |

- on-1 的补拉在第一个库（7997）装完后就开始了：`holdDtxLod1Backfill` 只盖住一次 `showModelByDbnum`，两次调用之间空档超过 300 ms 补拉就会插进来，之后一直跟着后面的库跑。on-2 两次调用之间没留出空档，补拉整体落在装载之后——两种都是现行设计允许的行为，前者让装载多了约 25 s、堆峰值高 0.4 GB。
- 装载总耗时：off 115 / 130 s，on 140 / 142 s。on-2 的补拉在装载之后才开始，装载却比 off-2 慢 12 s，而 off 自己两轮相差 15 s；本机同时有别人的 cargo 在编，这个量级的差异分不开，不作为结论。
- GC 后堆：装完两档相同（1.84 / 1.83 GB），补完 on 多 140 MB——2080 份 L1 在 `lod1GeometryByGeoHash` 与图层缓冲各一份。
- 多出来的那一次 recompile 约 170 ms（7872 − 7706）。

帧时间（中位数 ms；三角形 = 实际提交的；段 = multi-draw 段数；lodObj = 当帧改画粗网格的构件）：

| 机位 / 状态 / 通道 | off-1 | off-2 | on-1 | on-2 | 三角形 off → on | 段 off → on | lodObj |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 全景 / 静止 / 直出 | 338.7 | 339.8 | 245.9 | 248.1 | 31.60M → 23.27M | 29 → 23 697 | 28 581 |
| 全景 / 静止 / E3D | 683.1 | 684.0 | 498.6 | 502.4 | 同上 | 同上 | 28 581 |
| 全景 / 拖动 / 直出 | 39.3 | 39.5 | 28.7 | 29.8 | 3.56M → 2.58M | 5934 → 6082 | 1583 |
| 中景 / 静止 / 直出 | 186.9 | 188.5 | 135.4 | 136.1 | 17.14M → 12.66M | 2874 → 17 448 | 16 545 |
| 中景 / 静止 / E3D | 395.5 | 397.2 | 291.4 | 291.8 | 同上 | 同上 | 16 545 |
| 中景 / 拖动 / 直出 | 66.8 | 67.0 | 55.4 | 55.7 | 6.15M → 5.11M | 19 670 → 19 451 | 3463 |
| 近景 / 静止 / 直出 | 15.8 | 15.9 | 13.5 | 14.0 | 1.18M → 0.99M | 633 → 1408 | 747 |
| 近景 / 静止 / E3D | 62.4 | 62.8 | 57.9 | 59.3 | 同上 | 同上 | 747 |
| 近景 / 拖动 / 直出 | 11.0 | 11.3 | 10.7 | 11.1 | 0.75M → 0.71M | 2116 → 2242 | 183 |

拾取 100 个随机屏幕点：三机位中位 1.2–2.1 ms、命中 41 / 99 / 100，两档一致（拾取读的仍是原网格）。

全景静止的段数从 29 涨到 23 697：改画粗网格的构件各自成段。帧时间仍然降了 27%，但这是 11-06 「按通道分表选段」计划里已经点名的下一处热点。

### 守卫复核（对着不认 `?lod=` 的 8022）

另起 `npx vite --port 3122` 指向生产 8022（`build 0.1.44+g7f5576f0e288`，`?lod=1` 原样返回原网格、`immutable`），装 8000 库（2684 构件）：`?lod=1` 200 × 9、共 467 KB，`lod1Geometries = 0`、`lodCapableObjects = 0`——原网格没有被当成粗网格存第二份。同事未提交的那份 loader 改动在这条路上按响应头等大判负缓存、攒够 4 块后本会话停拉，所以 14 个候选只发了 9 次请求。

## 没做 / 已知限制

- 没有做视觉对照截图：4 mm 弦高下限对远处构件的观感本轮没评。
- 沙箱关了「生成器变了就重排」（`AIOS_MODEL_REBUILD_ON_GENERATOR_CHANGE=0`），旧生成器发布的库拿不到粗网格（见 `unpublished`）；生产口径下这些库会重排，不需要回填。
- 6003 / 7009 / 7321 在沙箱里没有数据水位（`model_source=memory`），没装。
- 回填任务没有断点续跑；进程退出后重提同一批库，已有的按 `reused` / `known_skipped` 跳过。

## 复现

```powershell
# 库与后端（沙箱）
.\bin\surreal.exe start --user root --pass root --bind 127.0.0.1:8019 rocksdb:<sandbox-dir>
$env:DB_OPTION_FILE='<改过端口的 DbOption.toml>'; $env:AIOS_STORE_MODE='rocksdb'; $env:AIOS_MESH_LOD1='1'
$env:PLANT_ASSET_ROOT='D:/work/plant-code/old/gen-model/assets'; $env:AIOS_MODEL_REBUILD_ON_GENERATOR_CHANGE='0'
.\target\debug\aios-database.exe serve --watch-dbnum 7997,7998,8000
Invoke-WebRequest -Method POST http://127.0.0.1:8052/api/v1/mesh-lod1/backfill -ContentType application/json -Body '{"dbnums":[7997,7998,8000]}'

# 前端
$env:VITE_GEN_MODEL_V1_BASE_URL='http://127.0.0.1:8052'; npx vite --port 3121 --strictPort
node docs/verification/dtx-lod1-real-backend-2026-11-07/bench.mjs http://127.0.0.1:3121 '&dtx_lod=0' lod-off.json
node docs/verification/dtx-lod1-real-backend-2026-11-07/bench.mjs http://127.0.0.1:3121 ''           lod-on.json
```

原始结果：本目录 `lod-off-1.json` `lod-on-1.json` `lod-off-2.json` `lod-on-2.json`。
