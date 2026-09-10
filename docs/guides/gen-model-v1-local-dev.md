# 本地联调：gen-model `:8022` + plant3d-web `:3101`（`model_source=gen-model-v1`）

模型树与三维几何从 gen-model `/api/v1` 取数的联调步骤、URL 开关、验证脚本与常见故障。设计见 `docs/adr/0054-load-model-tree-and-geometry-from-gen-model-v1.md`，落地记录见 `docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md` §8。

**2026-09-09 起 `gen-model-v1` 是缺省数据源**：不带参数打开页面就走 gen-model，所以 gen-model 不在时树是空的、徽标红点（见 §7）；要回旧链路写 `?model_source=legacy`（或 `VITE_MODEL_SOURCE=legacy`），legacy 开关保留一个发布周期。

## 1. 起 gen-model

在 gen-model 仓（`D:\work\plant-code\old\gen-model`）的运行目录里，`DbOption.toml` 至少要有：

```toml
http_api_addr = "127.0.0.1:8022"   # 没这一行 HTTP 服务不起
http_api_cors = ["*"]              # 前端默认直连，跨域要放开
project_name = "AvevaMarineSample"
mdb_name = "ALL"
```

启动后终端会打一行 `Web 服务已启动: http://127.0.0.1:8022/api/v1`。先探一下：

```powershell
curl http://127.0.0.1:8022/api/v1/health
```

`initialization.model_ready=true`、`model_phase_open=true` 才接按需生成；`data_face` 是 `read-through`（零摄入，SITE/ZONE 的 ensure 由服务端自己解生成根）还是 `ingest`（容器回 `422 container`，前端展开一层）都能用，行为差别见 §5。

**kv-mem 读透形态**（整库显示走服务端整库入口要它，收口计划 §17）：`data_face` 由存储介质派生、不由配置直说——`store_mode` 两档内存（`embedded-mem` 进程内嵌 `mem://`，无端口；`spawned-mem` 本进程拉起一个 `--memory` 后端的 surreal 子进程绑到 `v_ip:v_port`，端口是真的）⇒ `read-through`，`external` / `spawned-rocksdb` ⇒ `ingest`。不改配置文件的起法是环境变量压过去：

```powershell
$env:AIOS_STORE_MODE = 'embedded-mem'   # 或 'spawned-mem'（要 v_port 空着）；旧开关 AIOS_IN_MEMORY_DB=1 等价于 embedded-mem
.\aios-database.exe serve                # 运行目录里要有 DbOption.toml
```

`/health` 上看 `data_face=read-through`、`sul_db.medium=embedded-mem`。代价是硬的：模型投影与整库任务都只活在进程内，**服务一退全没**，下次起服务后第一次整库显示要重新全生成；库进了进程里，`embedded-mem` 下 `/sql` 探针、`rvm_verify` 这类靠 ws 连库的工具够不着（要留证据用 `spawned-mem`）。

> 端口不是 8022 时（比如 plant-1 的运行目录是 `18082`），下面所有地方用 `?gm_backend_port=<port>` 或 `VITE_GEN_MODEL_V1_BASE_URL` 指过去即可。

## 2. 起 plant3d-web

```powershell
cd D:\work\plant-code\old\plant3d-web
npm install
npm run dev          # http://127.0.0.1:3101
```

`.env.development`（本地、不入库）里与 gen-model 相关的三行：

```ini
VITE_GEN_MODEL_V1_BASE_URL=http://localhost:8022   # 直连；写 /gm 走 Vite 同源代理
# VITE_GEN_MODEL_V1_PROXY_TARGET=http://localhost:8022   # /gm 代理的上游（仅 dev）
# VITE_MODEL_SOURCE=gen-model-v1                         # 缺省 gen-model-v1（2026-09-09 起）；写 legacy 整站回旧链路
```

旧后端 `VITE_GEN_MODEL_API_BASE_URL=http://localhost:3100` 那一行**不要动**：尺寸标注、MBD、校审等还在 `:3100`；过渡期一个页面同时挂两个后端是预期形态。

## 3. URL 开关

| 参数 | 作用 |
| --- | --- |
| `model_source=gen-model-v1` | 本页面模型树 / 几何 / 网格 / 属性全部走 gen-model；**2026-09-09 起这就是缺省**，不写也一样。`model_source=legacy` = 旧链路（逐字节同前，保留一个发布周期） |
| `gm_backend_port=18082` / `gm_backend=http://10.0.0.5:8022` / `gm_backend=/gm` | 本页面 gen-model 地址，压过环境变量；`/gm` 走同源代理 |
| `gm_health=1` | 在 legacy 下也把树顶部的 gen-model 徽标挂出来（只看健康与库三态，不动场景、不起同步） |
| `show_refno=24381_145018` | 启动即显示这个节点（v1 下 = `ensure → records`） |
| `debug_refno=24381_145018` | 同上，但强制重载并替换旧对象 |
| `show_dbnum=7997` | 整库，两条路自动选（收口计划 §17，2026-09-10 起）。**服务端整库入口**（读透 / kv-mem 形态、且服务端含 spec §4.5.3 的构建）：`POST dbnums/7997/model/ensure` 起任务（202，服务端自己枚举全部生成根并后台生成进投影）→ 只查这一个 `task_id` 到终态（进度条第一段是 `completed/expected_roots`）→ `GET dbnums/7997/model/roots` 权威根清单 → 多根 `records`；前端一根也不催。**逐 SITE 老路**（服务端没有那条路由 404 → 记一次以后不再试；该库以 rocksdb 为准 409 → 只退这一次）：`tree/roots` 里该库的全部 SITE 逐个 `ensure → records`，进度按 SITE。两条路的 `records` 都按**多根批量**取（一次 ≤64 根，spec §4.5.2），生成根数不设预算，缺省只守 50 000 个构件（撞到 toast 会说「未轮到 N 个 SITE」），加 `show_dbnum_full=1` 连构件数也不限。服务端是不认识 `generation_roots` 的旧版（如 0.1.21 出厂包）时前端自动退回逐根（每根一次 `records`，0.5–10 s，几千根的库要几十分钟）——network 面板里第一发是 `dbnums/{dbnum}/model/ensure` 还是 `model/ensure`、`model/records` 的请求体有没有 `generation_roots`，走的哪条路一眼可辨 |

典型联调 URL：

```text
http://127.0.0.1:3101/?model_source=gen-model-v1&gm_backend_port=8022&show_refno=24381_145018
```

期望：树顶部徽标显示「已连接 gen-model :8022 · AvevaMarineSample /ALL · 模型门 开 · 库 同步 n · 滞后 n · 未判 n」（徽标只探 `/health` 与 `/dbnums`，不再有 WS 小点——前端只吃自己 ensure 出来的数据，2026-09-09 起不订阅服务端任务）；树根是 `AvevaMarineSample / ALL`，展开是全部 SITE，行数据带 `dbnum`；BRAN `24381_145018` 的 11 个构件 + 直管出现在视口；点构件，属性面板底部有一行「e3d-io 直读：N 个属性未解码 …」。

视口里**琥珀色（`#f59e0b`）的直管**不是主题色：那是服务端判定的无效直管（`model/records` 的 `insts[].is_invalid_tubi`，长度 ≤ 0 / 两端重合等），画成告警色实体、不跟主题走；控制台同时有一条「有 N 段无效直管（is_invalid_tubi），已画成告警色」，`[model-load]` 日志里也有 `invalid_tubi=N`。颜色可在 `public/config/model-display.config.json` 的 `invalidTubiMaterial` 里改，`instanceConfigs[refno]` 的显式覆盖仍最高。

## 4. 先用脚本证接口，再开浏览器

```powershell
pwsh scripts/verify-gen-model-v1.ps1                       # 默认 http://localhost:8022，只读 GET
pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:18082 -Refno 24381/145018 -Ensure
pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:8022 -Dbnum 7997      # 整库口径（kv-mem 读透形态）
```

不带 `-Ensure` 只跑 `health / tree/roots / children / ancestors / search / dbnums / meshes`（全是 GET，不改任何数据；meshes 两种口径各验一步：`.mesh` rkyv 直连 + `.glb` 过渡转换）；带 `-Ensure` 才 `POST model/ensure(force=false)` + 逐根分页 `model/records` + 同一批根的多根批量 `model/records`（`generation_roots[]`，条数须与逐根之和相同、`roots[]` 总数须与平铺条数相同；旧服务端回 422「missing field」只记一句不算失败），并把记录里的 `geo_hash` 逐个 `HEAD /api/v1/meshes/{hash}.mesh`（前端直连口径）。脚本每一步打一行「端点 → 状态 / 条数 / 关键字段」，任何一步非 2xx 以非零退出。

带 `-Dbnum 7997` 跑**整库口径**（spec §4.5.3；前端 `show_dbnum` 的四发原样重放）：`GET dbnums/7997/model/roots` 探能力并拿权威根清单 → `POST dbnums/7997/model/ensure`（202，回执 `expected_roots` 须等于 roots `total`）→ 轮询 `GET tasks/{task_id}` 到终态（每变一次进度打一行，终态那行给**耗时**、`completed/expected_roots`、`failed` 与任务前后的进程 **RSS**——这就是收口计划 §17 / plan 2026-09-10 S0 摸底要的三个数）→ 全部根按 ≤64 一批 `model/records`（整批被拒就退回逐根并记坏根）。旧构建没有整库入口（404）、该库以 rocksdb 为准（409）都只记一句不算失败——前端在这两种情况下退回逐 SITE。整库 ensure 会真的把没生成过的根全生成一遍，大库按分钟到小时计；`-DbnumWaitSec` 缺省 2 小时。

## 5. 两种形态的差别

| | `data_face=read-through` | `data_face=ingest`（如 plant-1 的实例） |
| --- | --- | --- |
| SITE / ZONE 勾选眼睛 | 服务端解出全部生成根，`generation_roots` 直接给 | `422 container` → 前端展开一层对子节点逐个 ensure（深度 3 / 128 根上限，超出计 `truncatedRoots`） |
| `show_dbnum` 整库显示 | 服务端整库入口：`dbnums/{dbnum}/model/ensure` 起任务 → 只查自己那一个 `task_id` → `…/model/roots` → 多根 `records`（spec §4.5.3，服务端含 2026-09-10 之后的构建） | 已初始化的库 `409` → 逐 SITE 老路（每个 SITE 一发 `ensure`，串行）；旧构建 `404` 同样走老路且只试一次 |
| `/dbnums` 的 `ref0s` | 骨架预热过，每行都有 | 骨架预热过才有；没有的行整格不写，`useDbMetaInfo` 跳过它 |
| `model/records` 的 `source` | `model-memory` | 库就绪了 `model-database`，否则 `model-memory` |
| 服务重启后 | 投影全没：再点显示会重新生成（整库任务也只活在进程内） | 已初始化的库以 rocksdb 为准，重启即接上 |

## 6. 两源对拍（翻默认开关时的证据链）

同一 refno 开两个 tab：

```text
?model_source=legacy&show_refno=24381_145018&data_source=parquet
?model_source=gen-model-v1&show_refno=24381_145018
```

比 `loadedObjects`、场景 AABB（控制台 `__dtxViewer` 的 `sceneBoundingBox`）逐轴差 ≤ 1 mm、截图肉眼一致；再取一个 EQUI、一个 SUPPO、一个 ZONE 重复。legacy 那边需要 `:3100` 旧后端在跑。自动化版本是 `e2e/gen-model-v1-two-source-parity.spec.ts`：第一条用例就是这组对拍（legacy 输出目录缺 `scene_tree_parquet/` 时带原因 skip），第二条「v1 浏览器对象数 == `model/records` 逐根条数」不依赖 legacy，翻默认后当回归钉子一直跑。

2026-09-09 翻默认的依据（收口计划 D8 按 B 口径，母计划 §8.13）：本机 legacy 输出目录没有树 parquet、EQUI 无几何、dbnum 7997 无 SUPPO，浏览器两源全绿在它上面拿不到；改记数据级对拍——BRAN 对象数 22 = 22 且构件集相同、ZONE legacy 的 1287 个有几何构件全部在 v1 里（差异是 legacy 直管画法伪影与覆盖缺口）、EQUI v1 40 个基本体；再加 v1 浏览器 ↔ records 三类节点逐条相等（22 / 2024 / 40）与 D6 数值对拍 ≤ 0.002 mm。

## 7. 常见故障

| 现象 | 原因 / 处理 |
| --- | --- |
| 徽标红点「连接失败」 | gen-model 没起或端口不对：`curl /api/v1/health`；LAN 地址打开页面时环境变量的 `localhost` 会自动折到 `/gm`，此时要配 `VITE_GEN_MODEL_V1_PROXY_TARGET` |
| 树是空的 / 根展开没有 SITE | `tree/roots` 回 0 个节点：MDB 里没有可读的 DESI 文件；看 `/health.initialization` 与 `/dbnums.warnings` |
| 勾选眼睛后提示「N 个 refno 没有几何记录」 | ensure 回 `NoRenderableGeometry`（无子件的 BRAN、纯层级的 STRU）或 `generation_pending`（生成还在后台，别重试同一 refno，稍后再点） |
| 网格全是兜底方块 | `/api/v1/meshes/{hash}.mesh` 404：服务端 `meshes_path` 下没有这个 `.mesh`（换过运行目录 / 网格目录没分家）。`.mesh` 直连自 2026-09-09 起是默认口径（`parseMeshGeometry` 解 rkyv），`.glb` 转换口径留一个发布周期 |
| `tree/children?refno=…` 回 500 `internal` | Ref0 不在本 MDB（gen-model 侧今天没分型成 404 / 503，见 plan §8.2 顺手发现） |
| 服务端重算过、场景没自动刷新 | **这是设计**（2026-09-09 用户口径，收口计划 §12）：前端只吃自己 `ensure` 出来的数据，不订阅 `model_drain` / WS、不做被动重载。要新几何就对那个节点再显示一次（`ensure(force=false)` 会拿到服务端当前的结果），或右键「重新生成」（`force=true`） |
| 属性面板底部一行「N 个属性未解码」 | 正常：`element/attributes` 直读 e3d-io，`diagnostics.undecoded` 是服务端解不出的属性，不是前端错 |

## 8. 回退

任何时候加 `?model_source=legacy`（或整站 `VITE_MODEL_SOURCE=legacy`）就回到旧链路——两套代码都在，legacy 路径没有改过一行行为；2026-09-09 之前缺省就是 legacy，现在要显式写。相关源码：`src/model-source/**`、`src/api/genModelV1Api.ts`、`src/composables/useGenModelV1Health.ts`（`genModelV1Ws.ts` / `useGenModelV1ModelSync.ts` 已于 2026-09-09 下线）。
