# 本地联调：gen-model `:8022` + plant3d-web `:3101`（`model_source=gen-model-v1`）

模型树与三维几何从 gen-model `/api/v1` 取数的联调步骤、URL 开关、验证脚本与常见故障。设计见 `docs/adr/0054-load-model-tree-and-geometry-from-gen-model-v1.md`，落地记录见 `docs/plans/2026-09-06-gen-model-v1-tree-and-viewer-adapter-plan.md` §8。

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
# VITE_MODEL_SOURCE=legacy                               # 默认 legacy；写 gen-model-v1 整站切过去
```

旧后端 `VITE_GEN_MODEL_API_BASE_URL=http://localhost:3100` 那一行**不要动**：尺寸标注、MBD、校审等还在 `:3100`；过渡期一个页面同时挂两个后端是预期形态。

## 3. URL 开关

| 参数 | 作用 |
| --- | --- |
| `model_source=gen-model-v1` | 本页面模型树 / 几何 / 网格 / 属性全部走 gen-model；缺省或 `legacy` = 旧链路（逐字节同前） |
| `gm_backend_port=18082` / `gm_backend=http://10.0.0.5:8022` / `gm_backend=/gm` | 本页面 gen-model 地址，压过环境变量；`/gm` 走同源代理 |
| `gm_health=1` | 在 legacy 下也把树顶部的 gen-model 徽标挂出来（只看健康与库三态，不动场景、不起同步） |
| `show_refno=24381_145018` | 启动即显示这个节点（v1 下 = `ensure → records`） |
| `debug_refno=24381_145018` | 同上，但强制重载并替换旧对象 |
| `show_dbnum=7997` | 整库：v1 下 = `tree/roots` 里该库的全部 SITE 逐个 `ensure → records`，进度在视口左下角；缺省只装**安全概览**（前 200 个生成根，toast 会说「预算外未取 N 根」），加 `show_dbnum_full=1` 才整库全量。每个生成根一次 `records`（0.5–10 s），几千根的库全量要几十分钟 |

典型联调 URL：

```text
http://127.0.0.1:3101/?model_source=gen-model-v1&gm_backend_port=8022&show_refno=24381_145018
```

期望：树顶部徽标显示「已连接 gen-model :8022 · AvevaMarineSample /ALL · 模型门 开 · 库 同步 n · 滞后 n · 未判 n」，右侧小点绿色（WS 已连）；树根是 `AvevaMarineSample / ALL`，展开是全部 SITE，行数据带 `dbnum`；BRAN `24381_145018` 的 11 个构件 + 直管出现在视口；点构件，属性面板底部有一行「e3d-io 直读：N 个属性未解码 …」。

## 4. 先用脚本证接口，再开浏览器

```powershell
pwsh scripts/verify-gen-model-v1.ps1                       # 默认 http://localhost:8022，只读 GET
pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:18082 -Refno 24381/145018 -Ensure
```

不带 `-Ensure` 只跑 `health / tree/roots / children / ancestors / search / dbnums / meshes`（全是 GET，不改任何数据）；带 `-Ensure` 才 `POST model/ensure(force=false)` + 逐根分页 `model/records`，并把记录里的 `geo_hash` 逐个 `HEAD /api/v1/meshes/{hash}.glb`。脚本每一步打一行「端点 → 状态 / 条数 / 关键字段」，任何一步非 2xx 以非零退出。

## 5. 两种形态的差别

| | `data_face=read-through` | `data_face=ingest`（如 plant-1 的实例） |
| --- | --- | --- |
| SITE / ZONE 勾选眼睛 | 服务端解出全部生成根，`generation_roots` 直接给 | `422 container` → 前端展开一层对子节点逐个 ensure（深度 3 / 128 根上限，超出计 `truncatedRoots`） |
| `/dbnums` 的 `ref0s` | 骨架预热过，每行都有 | 骨架预热过才有；没有的行整格不写，`useDbMetaInfo` 跳过它 |
| `model/records` 的 `source` | `model-memory` | 库就绪了 `model-database`，否则 `model-memory` |

## 6. 两源对拍（翻默认开关的前提）

同一 refno 开两个 tab：

```text
?model_source=legacy&show_refno=24381_145018&data_source=parquet
?model_source=gen-model-v1&show_refno=24381_145018
```

比 `loadedObjects`、场景 AABB（控制台 `__dtxViewer` 的 `sceneBoundingBox`）逐轴差 ≤ 1 mm、截图肉眼一致；再取一个 EQUI、一个 SUPPO、一个 ZONE 重复。legacy 那边需要 `:3100` 旧后端在跑。2026-09-07 只做过同源自洽对拍（P3-b 合成矩阵 × GLB 顶点 vs 服务端 `world_aabb`，22/22 ≤ 0.002 mm），两源对拍还没做，所以 `VITE_MODEL_SOURCE` 默认仍是 `legacy`。

## 7. 常见故障

| 现象 | 原因 / 处理 |
| --- | --- |
| 徽标红点「连接失败」 | gen-model 没起或端口不对：`curl /api/v1/health`；LAN 地址打开页面时环境变量的 `localhost` 会自动折到 `/gm`，此时要配 `VITE_GEN_MODEL_V1_PROXY_TARGET` |
| 树是空的 / 根展开没有 SITE | `tree/roots` 回 0 个节点：MDB 里没有可读的 DESI 文件；看 `/health.initialization` 与 `/dbnums.warnings` |
| 勾选眼睛后提示「N 个 refno 没有几何记录」 | ensure 回 `NoRenderableGeometry`（无子件的 BRAN、纯层级的 STRU）或 `generation_pending`（生成还在后台，别重试同一 refno，稍后再点） |
| 网格全是兜底方块 | `/api/v1/meshes/{hash}.glb` 404：服务端 `meshes_path` 下没有这个 `.mesh`（换过运行目录 / 网格目录没分家） |
| `tree/children?refno=…` 回 500 `internal` | Ref0 不在本 MDB（gen-model 侧今天没分型成 404 / 503，见 plan §8.2 顺手发现） |
| 模型重算后场景没刷新 | 同步靠 15 s 一次的 `GET /tasks?kind=model_drain` 对齐（服务端今天不为 `model_drain` 发 WS 事件）；徽标悬停看「模型同步」那一行有没有 `已重载 n 根` |
| 属性面板底部一行「N 个属性未解码」 | 正常：`element/attributes` 直读 e3d-io，`diagnostics.undecoded` 是服务端解不出的属性，不是前端错 |

## 8. 回退

任何时候把 URL 参数去掉（或 `?model_source=legacy`）就回到旧链路——两套代码都在，legacy 路径没有改过一行行为。相关源码：`src/model-source/**`、`src/api/genModelV1Api.ts`、`src/api/genModelV1Ws.ts`、`src/composables/useGenModelV1Health.ts`、`src/composables/useGenModelV1ModelSync.ts`。
