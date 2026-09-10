# 开发计划：`show_dbnum` 整库显示由服务端拉起（kv-mem 读透形态 + e3d-io 树）

> 状态：**第 2 稿 approved 并已落地（§9）；第 3 稿 §12 用户 17:1x 确认读法、已落地（§12.6）**——用户口径「按 e3d-model 的方式去生成模型，实时生成」把 S1 的生成内核与前端的等待方式各改一处，端点不动。live 仍等用户起服务（§11）。第 1 稿走 `dbnums/{dbnum}/model/rebuild`，评审标注推翻了它的底座，见 §0。
> 上游背景：`2026-09-09-gen-model-v1-closeout-and-next-steps-plan.md` §12 / §15 / §16。

## 0. 评审回执与本稿的改动

**用户标注（Plannotator，2026-09-10）**：「让 gen-model 使用 kv-mem 模式来做模型数据支撑。模型树使用 e3d-io 提供。」

这条把底座换了，第 1 稿的主干随之作废。逐条对照：

| 第 1 稿 | 本稿 | 为什么 |
| --- | --- | --- |
| 整库入口接 `POST /dbnums/{dbnum}/model/rebuild` | **作废** | 该端点是**摄入形态**的整库重建：要 applied watermark，且把根 seed 进 durable `model_update_pending` 队列。kv-mem 读透形态下水位从不建立（`start()` 直接报 `dbnum=… has no applied watermark`），而且判成 `Memory` 的库按设计**就不该进那条队列**（`model_read_route.rs:187`）。 |
| D1「根清单从哪来」——要服务端新开 roots 端点 | **缺口自动消失** | 读透形态的 `model/ensure` 回执**本来就带 `generation_roots`**（`handlers.rs:1751`），即这棵子树的全部生成根。 |
| D3「强制重建的代价」 | **不存在了** | 没有 rebuild，也就没有「每点一次全库重算 + 期间同库 ensure 全 409」。 |
| 「模型树改由 e3d-io 提供」 | **已经是现状，不是新活** | `tree/{roots,children,ancestors}` 与 `search` 早已是 e3d-io 直读（`DirectTreeService`，spec §4.10）；连 `ensure` 解生成根走的也是 e3d-io 骨架，legacy 那条经 SurrealDB `pe` 上溯的路 2026-09-08 已退役（`handlers.rs:1699`）。 |
| D2「完成判据要不要轮询 `/tasks/{id}`」 | **保留，但只在选了 B 时才需要** | 见 §4。 |

**新的真问题**：kv-mem 形态下「服务端拉起子树全生成」本来就是 `ensure` 的语义——卡住整库的不是「谁来编排生成」，而是**一发 HTTP 只有 120 s 预算，而整库生成按分钟到小时计**。详见 §3。

## 1. 目标与形态

**形态（本稿前提）**：gen-model 跑 kv-mem / 零摄入读透——`in_memory_db = true`（或部署脚本 `-InMemory`、环境变量 `AIOS_IN_MEMORY_DB`）。`data_face` 由介质派生、不由配置直说：非持久介质 ⇒ `ReadThrough`（`options.rs:881`）。这一档下：

- 模型树、生成根解析：**e3d-io 直读文件**，SurrealDB 里根本没有元素行。
- 模型数据：`ensure` 直接从文件生成进**进程内投影**（`ModelMemoryStore`），不落 rocksdb、不进 durable 队列，回执 `durable: false`。
- `model/records` 从投影供数，`source = "model-memory"`；**这根没 ensure 过就 409 `not_generated:`**（spec §4.12）。

**目标态**：点一次整库显示 → 服务端把该库该生成的根一次编排完（前端不逐根催）→ 前端只按根取 `records` 装 DTX。

## 2. 已查证的事实（本轮真查，带出处）

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 | 读透形态的 `ensure`：用 e3d-io 骨架 `generation_roots_in_subtree(root, unit_types)` 解出**整棵子树**的全部生成根，一口气 `ensure_model_scope_generated_from_roots`；memory 库的整段生成包在 `scope_memory_only(dbnum, …)` 里 | `handlers.rs:1660`–`1716` |
| F2 | 读透形态的 `ensure` 回执**多给 `generation_roots`**（全部根）、`snapshot_epoch`、`publication_status`；另有 `dbnum` / `model_source` / `model_source_reason` / `durable:false` 四格 | `handlers.rs:1737`–`1770`；spec §4.12 |
| F3 | **一发 `ensure` 的服务端预算是 120 s**（`await_background_without_cancelling`）。耗尽回 504 timeout（正文「按后台继续执行」），**后台不取消**；spec 另有 202 `generation_pending` 一档 | `handlers.rs:1696`、`1724` |
| F4 | 前端今天对 pending/timeout 的处理：该根进 `result.pending[]`，**这次显示就没有它的几何**，不重试。也就是说**一发 SITE ensure 一超时，整棵子树这次全丢** | `modelRecords.ts:303` |
| F5 | 超时后后台还在跑，同根再发会撞「生成根忙」的 conflict，不排队 | `handlers.rs:1725` 注释 |
| F6 | `model/records` 在 memory 形态要求这根**在本进程 ensure 过**，否则整批 409 `not_generated:`；空数组不表达「没生成过」 | spec §4.5.2 / §4.12 |
| F7 | `dbnums/{dbnum}/model/rebuild` 依赖 `DbnumState` 的 applied watermark 与 durable pending 队列 | `model_rebuild.rs:59`；`model_update_pending.rs:1362` |
| F8 | 判成 `Memory` 的库**不进 durable 队列、不落 rocksdb**；读透形态下每个库恒 `memory` / `read-through` | `model_read_route.rs:14`、`141`、`187` |
| F9 | `durable:false` 的代价是硬的：**进程一退投影就没了**，下次起服务第一次整库显示要重新全生成 | spec §4.12；`DbOption.toml:101` 注释 |
| F10 | kv-mem 层级分片按 dbnum 冷加载、**目前无淘汰策略、只增不减**（规格要求的 RSS 观测也未落地） | `docs/diagrams/data-parse-pipeline.drawio` p3_s3 |
| F11 | 规模参考：spec 举例 7997 = 2720 根；母计划 §8.9 实测 200 根逐根 269 s | spec §4.5.1；母计划 §8.9 |
| F12 | 本机 `:9099` 现在是 **0.1.21 + `data_face=ingest`**，且 `data_ready:false`、28 个库全在 `no_credential_dbnums`；`:8022` 没人听。切 kv-mem 要改配置重起（**长驻进程由用户自己起**） | 本机 `/health` 实测 |

## 3. 缺口：不是「谁编排」，是「一发装不下」

kv-mem 形态下，「服务端拉起整棵子树的生成」= 对该子树发一次 `ensure`，服务端自己解根、自己生成、把根清单回给你。编排已经在服务端了。真正卡住整库的是两件事：

1. **120 s 预算 vs 整库时长**（F3/F11）。今天整库是逐 SITE ensure，一个 SITE 几百根，大概率超时 → 整棵子树进 `pending`，这次点击白点（F4），重发还撞忙根 conflict（F5）。
2. **没有进度也没有完成判据**。memory 形态没有 durable pending 可查，`/dbnums` 的水位列在读透形态恒中性，前端只能靠「再问一次 records」猜。

## 4. 待拍板

### D1 · 库级入口的形状

- **A（零服务端改动）**：前端把粒度切细到能落进 120 s——SITE 超时就展开 ZONE、ZONE 再超时展开下一层（`maxContainerDepth` today = 3），逐段推进并把已成功的根立刻取 records 显示。改动全在 `collectDbnum.ts`。代价：一次整库要几十到几百发 `ensure`，「服务端拉起」的成色打折；超时那几发的后台生成仍在跑，前端得避开忙根。
- **B（推荐）**：gen-model 加 `POST /api/v1/dbnums/{dbnum}/model/ensure`（读透形态版整库入口）：`202 {task_id, expected_roots}`，后台把该库全部根生成进投影；`GET /tasks/{task_id}` 报 `completed/expected_roots`；任务回执（或配套 `GET /dbnums/{dbnum}/model/roots`）给根清单。前端就三发：起任务 → 看进度 → 取 records。**这是把 rebuild 那套异步骨架搬到 memory 形态**，服务端不必碰 durable 队列。
- **C**：不等生成完，前端边生成边取——服务端每完成一根就可查。需要服务端给「已就绪的根」增量视图，比 B 复杂。

### D2 · 完成判据（只有选 B 才需要）

只能轮询 `GET /tasks/{task_id}`。这与收口计划 §12（决策 d-195）「前端不轮询 `/tasks`、不订阅服务端任务」正面撞上。

我的读法：d-195 禁的是「拿服务端任务反推别人改了什么」（P5 模型变更同步），这里是「我自己按下的这一发什么时候完」。**口径是用户的，要点头才开这个口子**，且在计划里写死边界：只查自己发起的那一个 `task_id`，不列表、不订阅 `model_drain`、不与已加载根求交。

### D3 · 形态代价，先认下来

- 进程一退投影全没（F9）：每次重起服务后第一次整库显示都要重新全生成。接受，还是要一个「起服务时预热常用库」的开关？
- kv-mem 分片只增不减（F10）：整库常驻的内存没有上限也没有观测。整库 = 几千根的投影 + 全库层级行，**这一档要不要先量一次 RSS 再放开整库入口**？
- 本机切形态要重起服务（F12），且 `:9099` 那份 0.1.21 出厂包没有 §4.5.2 的多根批量 `records`——要 live 量速度，得起一份 `2e9d65e91` 之后的构建。**长驻进程我不起，命令给你，你在自己的终端跑。**

**推荐组合：B + D2 认可 + D3 先量一次内存再放开。**

## 5. 目标时序（按推荐组合）

```
点「整库显示 dbnum=N」
  → POST /api/v1/dbnums/N/model/ensure     （读透形态整库入口）→ 202 {task_id, expected_roots}
  → 轮询 GET /api/v1/tasks/{task_id}        （2–3 s 一次；进度条读 completed/expected_roots）
  → 任务回执 / GET /dbnums/N/model/roots    （拿全部生成根）
  → POST /api/v1/model/records              （≤64 根一批，收口计划 §15 的批量链路原样复用）
  → 分批装 DTX（现有代码不动）
```

选 A 的话时序退化为「逐 SITE / 逐 ZONE ensure（回执自带 `generation_roots`）→ 每段就地取 records」，前端多一层「超时就再切细一层」的收敛逻辑。

## 6. 任务拆分

### S0 · 形态切换与摸底（先做，成本最低）

把本机 gen-model 切到 kv-mem 读透起一次（用户执行），确认 `/health` 的 `data_face=read-through`、`in_memory_db` 栏为真；对一个中等 SITE 发一次 `ensure`，记录**耗时、回执 `generation_roots` 条数、进程 RSS**。这三个数直接决定 D1 选 A 还是 B——A 只在「单 SITE 稳定落在 120 s 内」时才成立。

### S1 · gen-model 服务端（仅 D1 选 B；写锁 `src/web_service/`）

1. `POST /api/v1/dbnums/{dbnum}/model/ensure`：读透形态整库入口，202 + `{task_id, expected_roots}`，后台按 e3d-io 根清单逐根生成进投影（复用 `scope_memory_only` + 现有并发闸），任务进 `TaskRegistry`。
2. 根清单出口：任务 `detail` 带全部根，或配套 `GET /api/v1/dbnums/{dbnum}/model/roots`。
3. spec §4.5.1 / §4.12 各补一节；`cargo test --lib -- web_service` 全绿、`rustfmt --check` 干净。

### P12-1 · 前端 API 层（`src/api/genModelV1Api.ts`）

`genModelV1DbnumModelEnsure()` / `genModelV1DbnumModelRoots()` / `genModelV1TaskGet()`。`/tasks/{id}` 是 §12 删掉后**重新加回来的一小块**，注释写清边界并回指本节。

### P12-2 · 整库路径（`collectDbnum.ts` + `useModelGeneration.ts`）

改成「起任务 → 轮询 → 取根清单 → 批量 records」；进度弹窗第一段从「SITE i/N」改成 `completed/expected_roots`。**旧的逐 SITE 路径保留作退路**（服务端没有新端点 / 404 / 摄入形态时自动回落），做法与 §15「旧服务端不认识 `generation_roots` 就退回逐根」同一套：按 api 对象记一次能力，不每次试探。

### P12-3 · 收尾

`?show_dbnum_full=1` 与 `maxRefnos` 预算语义不变（守的是浏览器装多少构件）；`scripts/verify-gen-model-v1.ps1` 加一步整库口径；CONTEXT.md / 联调指南补 kv-mem 形态的一句；收口计划记 §17 与决策条目。

## 7. 风险

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| 投影活不过重启（F9） | 每次起服务后第一次整库显示都要全生成 | 明确写进文案；要预热的话另开一项，不混进本计划 |
| 内存只增不减（F10） | 整库常驻无上限、无观测 | S0 先量 RSS；必要时整库入口留一个「最多装多少根」的闸 |
| 超时后忙根冲突（F5） | 前端重发撞 conflict，用户看着像随机失败 | 选 B 就不再靠重发；选 A 要按根记「在飞」状态，避开已发过的根 |
| 任务只活在进程内 | 用户关标签页 / 服务重启后 `task_id` 找不回 | 页面重开时用 `GET /tasks?kind=…` 认领；认不回就退回「直接取 roots + records」看现状 |
| 本机 live 验不了 | `:9099` 是 0.1.21 摄入形态，`:8022` 没人听 | S0 先把形态切过去；要量速度得起 `2e9d65e91` 之后的构建 |

## 8. 验证计划

- 单测：`collectDbnum.test.ts`（新链路 + 退回旧链路两条主路径）、`genModelV1Api.test.ts`（新绑定的请求体与错误分型）、`useModelGeneration.genModelV1.test.ts`（进度与 toast 文案）。
- 门：`npm run type-check` 对基线 631 新增 0；触及文件 eslint 0 错；全量 vitest **0 failed**（自 `e043f37` 起是硬基线，见 §16）。
- live（用户执行长驻进程）：切 kv-mem 起服务 → `pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:8022 -Ensure` → 浏览器 `?show_dbnum=7997&gm_backend_port=8022`，量端到端耗时并与 §15 的「<60 s」目标对齐。

## 9. 落地记录（2026-09-10 下午，第 2 稿评审 approved 之后）

D1 按 **B**、D2 **认可**（边界写死：只查自己发起的那一个 `task_id`）、D3 的 S0 摸底仍待做。

- **S1（gen-model）已落**：worktree `D:\work\plant-code\old\gen-model-kvmem`、分支 `kvmem-dbnum-model-ensure`、提交 `dadbd821d`（主树正被别的会话密集改，一行没碰）。新模块 `model_dbnum_ensure` + 两个端点 + `TaskRegistry` 新 kind + spec §4.5.3。`cargo check --lib` 干净、`cargo test --lib -- web_service model_dbnum_ensure model_rebuild task_registry` 83 passed、`cargo fmt --check` 干净、diff 纯增 422 行零删除。
- **P12-1 / P12-2（plant3d-web）已落**：三个 API 绑定、`collectRecordsForRoots`、记录源 `collectRoots`（进同一份缓存）、`collectDbnumViaServer` + 自动退回逐 SITE、进度加 `generate` 档。受影响 5 文件 60/60 绿；`type-check` 631 / 基线 631 / 新增 0；eslint 0 错；全量 vitest **264 文件 / 1985 条 / 0 failed**。
- **P12-3 已落**（2026-09-10 17:0x，接班会话）：`scripts/verify-gen-model-v1.ps1` 加 `-Dbnum <n>`（`GET …/model/roots` 探能力 → `POST …/model/ensure` 202 且 `expected_roots == roots.total` → 轮询 `tasks/{id}` 到终态、打进度、计**耗时**与任务前后 **RSS** → 全部根 ≤64 一批 `records`，整批被拒退回逐根记坏根；404 / 409 只记一句不算失败）——S0 要的三个数（耗时 / 根数 / RSS）就从它的终态那行读。对本机 `:9099`（0.1.21 摄入形态）真跑一次：四步分别「404 记一句 / 跳过 ×3」，与 `collectDbnumViaServer` 的退回判据一致。`docs/guides/gen-model-v1-local-dev.md` 补 kv-mem 读透形态的起法（`AIOS_STORE_MODE=embedded-mem`）、`show_dbnum` 两条路、`-Dbnum` 用法、§5 两行；`CONTEXT.md` 加「整库入口」词条。决策库落 §17 口径一条（见共享决策库 `arch`）。
- **S0 的构建已备**：`kvmem-dbnum-model-ensure`@`dadbd821d` 的 release 构建落在**独立** target（`D:\Rust\target-kvmem\release\aios-database.exe`，不碰共享的 `D:\Rust\target`——别的会话正从那里出包）。运行目录用 worktree 根（`DbOption.toml` 已是 `http_api_addr=0.0.0.0:8022`、`http_api_cors=["*"]`、AvevaMarineSample /ALL）；`store_mode` 走环境变量 `AIOS_STORE_MODE=embedded-mem`（本机 `v_port=8009` 已被主树的 surreal 占着，`spawned-mem` 会撞）。**长驻进程仍由用户起**，命令见 §11。
- **仍未做**：S0 三个数与 live 计时（要用户起服务）。

## 11. S0 起服务与量数（用户在自己的终端跑）

```powershell
cd D:\work\plant-code\old\gen-model-kvmem
$env:AIOS_STORE_MODE = 'embedded-mem'          # kv-mem 读透形态；/health 应见 data_face=read-through
D:\Rust\target-kvmem\release\aios-database.exe serve
```

另开一个终端量数（整库 ensure 会真的把 7997 全生成一遍，按分钟到小时计）：

```powershell
cd D:\work\plant-code\old\plant3d-web
pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:8022 -Dbnum 7997
```

看终态那行：`elapsed`（耗时）、`completed/expected_roots`（根数）、`rss=前->后 MB`。然后浏览器
`http://127.0.0.1:3101/?gm_backend_port=8022&show_dbnum=7997`，network 第一发应是 `dbnums/7997/model/ensure`，
控制台 `[model-load]` 的 ms 与 §15 的「<60 s」目标对齐（第二次点显示才是「已有投影」的成绩；第一次含整库生成）。

## 10. 明确不做

- 不动 `?show_dbnum_full=1` / `maxRefnos` 的语义。
- 不恢复 WS、不恢复 `GET /tasks` 列表轮询、不恢复 `model_drain` 消费（§12 下线的是这些；本计划最多加回单个 `task_id` 的查询）。
- 不碰摄入形态的 `dbnums/{dbnum}/model/rebuild` 与 durable 队列。
- 不动 legacy parquet 整库链路（版本对比仍走 `manifestUrl`）。
- 不改 §4.5.2 多根批量 `records` 契约。

## 12. 第 3 稿（待评审）：「按 e3d-model 的方式去生成模型，实时生成」

**用户口径（2026-09-10 17:0x）**：「按 e3d-model 的方式去生成模型，实时生成。」

### 12.1 我的读法（请确认）

两个词各指一处，端点与契约都不必动：

- **「按 e3d-model 的方式」**指服务端的生成内核：整库那一发应当走 e3d-model / Core.dll 式的**生产者—消费者流水线**（`E3dModelService::generate_and_persist_roots`：常驻 worker 并行领根、按片提交进投影），而不是第 2 稿 S1 实际落成的「把 2720 根一根一根塞进按需 `ensure` 的机器」。
- **「实时生成」**指前端的等待方式：几何**边生成边进视口**——哪根的投影提交了，前端就取哪根的 `records` 装 DTX；而不是第 2 稿的「轮询到任务终态才开始取第一条记录」（整库几十分钟里视口一直是空的）。

另一种读法是「连投影都不要，`records` 每次现算」——每次刷新页面都把 2720 根重算一遍，`/meshes/{hash}.mesh` 也得先落盘才有 URL，我不推荐；如果你要的是这一种，说一声，方案另出。

### 12.2 本轮真查到的事实（第 2 稿落地后的实际形态）

| # | 事实 | 出处 |
| --- | --- | --- |
| F13 | S1 的 worker 按 16 根一组调 `ensure_model_scope_generated_from_roots`，它内部 **`for root in roots { … .await }` 逐根串行**，每根走 `ensure_exact_generation_root` → `generate_unit_model` → `ModelRefreshPolicy::generate_roots(mgr, [这一根])` → **每根新建一次** `E3dModelService::from_current()` → `generate_and_persist_roots(dbnum, [这一根])`。也就是说整库 2720 根 = 2720 次「建服务 + 起 1 个 worker + 1 片提交」，**全程无并行** | `model_dbnum_ensure.rs` `spawn_worker`；`on_demand_model.rs:397–412`、`:238–305`；`manual_update.rs:2816`；`model_refresh.rs:82–177` |
| F14 | `generate_and_persist_roots(dbnum, roots)` 一次给全部根时是真正的 Core.dll 式流水线：`produce_slices` 起 `resident_workers = min(geometry_workers 额度, 待领根数)` 个常驻 worker 动态领根（本机 `/health` 的 `geometry_concurrency.quota = 16`），片按 `model_regen_execution_group = 16` 根或 `model_memory_slice_elements = 8000` 个元素封口，消费者 `persist_memory_batch` **每片一提交**进 `ModelMemoryStore`；生产与消费隔一条深度 1 的通道并行跑（ADR-041 §8）。一组失败只记 `failed`，不拖整页 | `e3d_model_service.rs:660–768`、`:773–813`、`:908–943`；`concurrency.rs:375–384`；`DbOption.toml:308/313` |
| F15 | 「这根好了没」在投影里就是**有没有回执**：`ModelMemoryStore::receipt(Current, root)`——`ensure` 判缓存命中用的就是它（`memory_root_current`）；`roots(scope)` 一次列出全部有回执的根。片一提交，这些根立刻可被 `model/records` 读到（`source = model-memory`） | `model_memory_store.rs:484–508`；`on_demand_model.rs:535–545`；spec §4.12 |
| F16 | 前端 `collectDbnumViaServer` 今天**先 `waitForDbnumTask` 到终态**，再 `dbnumRoots` → `collectRoots`：终态之前一条记录都不取 | `collectDbnum.ts:216–237` |
| F17 | 规模：spec 举例 7997 = 2720 根；母计划 §8.9 逐根口径 200 根 269 s（≈1.3 s/根，含 HTTP 往返）。按 F13 的串行形态整库量级是**小时**；按 F14 的 16 路并行量级是**分钟**（几何长尾另计） | spec §4.5.1；母计划 §8.9 |

### 12.3 改法

**S1b · gen-model（worktree `gen-model-kvmem`，在 `dadbd821d` 之上；写锁 `src/data_interface/model_dbnum_ensure.rs`、`src/web_service/handlers.rs`、spec）**

1. `spawn_worker` 改成**一发**：过滤掉已有回执的根（与 `ensure` 同一缓存判据，重显示零成本），剩下的整批交给 `E3dModelService::from_current()` 一次建好的服务 → `scope_memory_only(dbnum, svc.generate_and_persist_roots(dbnum, roots, Lenient))`。不再经 `ensure_model_scope_generated_from_roots` / 根锁 / 逐根建服务。
2. 进度不再靠「一组一记」：worker 旁挂一个 1 s 的 ticker，`units_done = expected ∩ 有回执的根数`（F15，2720 次 map 查找），`detail` 同步 `completed / failed`；终态由 `E3dPersistReport` 收口（`failed` 来自生产者死信 + 消费失败）。
3. `GET /dbnums/{dbnum}/model/roots` 每行加 **`ready: bool`**（= 有回执），并接 `?ready=1` 只回就绪的——前端的增量取数靶子。只读、不生成，语义不变。
4. spec §4.5.3 补两句（内核换成流水线、`ready`）；单测：源码钉「`spawn_worker` 调 `generate_and_persist_roots` 且不含 `ensure_model_scope_generated_from_roots`」、`ready` 与回执一致。`cargo test --lib -- web_service model_dbnum_ensure`、`cargo fmt --check`。

**P12b · plant3d-web（`collectDbnum.ts` + `modelRecordSource.ts`；`useModelGeneration.ts` 文案）**

1. `collectDbnumViaServer` 不再等终态：每个轮询拍子（2 s）读一次 `tasks/{id}`（进度）+ `roots?ready=1`，把**新就绪**的根立刻 `records.collectRoots(newRoots)`（≤64 一批，进同一份缓存）并把构件 refno **增量回给调用方装 DTX**；任务终态后再收一次尾（剩余就绪根），结束。`maxTotalRoots` / `maxRefnos` 预算在增量边界上判。
2. `collectDbnumRefnos` 的返回形状不够用了——加 `onRootsReady?(refnos)` 增量回调（或改成 async iterator），`useModelGeneration` 的整库路径按批 `loadRefnos`；退回逐 SITE 老路时行为不变。
3. 进度文案：`generate` 档从「生成 N/M」改成「生成 N/M · 已进视口 K 根」。
4. 单测：`collectDbnum.test.ts` 加「就绪根分两拍到达、两拍各取一次 records」「终态前先有构件回调」「`ready=1` 不认识（旧 §4.5.3 构建）→ 退回等终态再整取」；全量 vitest 0 failed 基线；type-check 631 新增 0。

**不动**：三个端点的路径与 202 回执、d-195 边界（仍只查自己那一个 `task_id`）、§4.5.2 `records` 契约、`?show_dbnum_full=1` / `maxRefnos` 语义、逐 SITE 退路、rebuild 不碰。

### 12.4 验证

- 单测两仓如上；`verify-gen-model-v1.ps1 -Dbnum` 的轮询行里能看到 `units_done` 按片跳而不是按 16 根一格、`roots?ready=1` 条数随之增长。
- live（用户起 §11 的服务）：`?show_dbnum=7997&gm_backend_port=8022`，**第一批几何应在几秒到几十秒内进视口**（第一片 16 根提交即可见），整库收尾时间与 S0 的 `elapsed` 对齐；`/health.geometry_concurrency.active` 生成期间应接近 16。

### 12.5 风险

| 风险 | 处置 |
| --- | --- |
| 16 路并行生成把 RSS 顶高（F10 只增不减） | S0 先量；`geometry_workers` 是现成旋钮，必要时整库入口另给一个上限 |
| 生成中的库同时被单根 `ensure` 打 | `persist_memory_batch` 在 `db_generation_lock(dbnum)` 下提交，单根路径同一把锁，串行安全；只是慢，不冲突 |
| 旧 §4.5.3 构建（`dadbd821d`）不认 `ready` | 前端按「响应行里没有 `ready` 字段」退回等终态整取，不报错 |
| 增量装 DTX 让 `budgetLimited` 判在半路 | 预算判在每批边界，超出的根记 `truncatedRoots`、任务照常跑完（服务端不知道预算） |

### 12.6 落地记录（2026-09-10 17:1x–17:4x，用户「读法对，按 §12.3 开工」）

**S1b · gen-model**（worktree `gen-model-kvmem`，提交 **`d6a5d49ac`**，在 `dadbd821d` 之上）

- `model_dbnum_ensure::spawn_worker`：没就绪的根一次交给 `ModelRefreshPolicy::generate_roots_report`（→ `generate_and_persist_roots` 流水线），
  仍包在 `scope_memory_only` 里；起任务时已有回执的根不重算。走 `generate_roots_report` 而不是直接调服务，是为了保住它里面的
  frozen-source 钉版（Q9）与只写内存的分流——单根 `ensure` 最终也是这个函数，两条入口同一份口径。
- 进度：1 s ticker 数「预期根 ∩ 有回执」；终态 `failed` = 预期根里最终没有回执的（不再用 `generate_roots_report` 一根死信整批记失败的粗口径）。
  `detail` 加 `cached` / `pipeline`。
- `GET …/model/roots` 每行 `ready`（`root_ready` = 投影回执）、`?ready=1`、`ready_total` / `only_ready`。spec §4.5.3 同步。
- 源码钉：worker 一发交流水线且不含 `ensure_model_scope_generated_from_roots`、ticker 先于流水线起；`root_ready` 只认回执。
- 验证：`cargo check --lib --tests` 干净；`cargo test --lib -- web_service model_dbnum_ensure model_rebuild task_registry` **85 passed**（83 + 2）；
  `cargo fmt --check` 只剩 `handlers.rs:1311` 一处 HEAD 上就有的旧 diff（未动）。构建落 `D:\Rust\target-kvmem\release\aios-database.exe`。

**P12b · plant3d-web**（本笔）

- `genModelV1DbnumModelRoots(dbnum, { ready: true })` → `?ready=1`；响应类型加 `ready_total` / `only_ready` / 行 `ready`。
- `collectDbnumViaServer` 改成每拍 `tasks/{id}` + `roots?ready=1`，新就绪的根立刻 `collectRoots` 并经新回调 **`onRefnosReady`** 交给调用方
  （会被 await，DTX 装载不重叠）；服务端报了进度（或任务查不到）才开始问 `ready`；预算在批边界上判；收尾全清单对账——
  终态仍没就绪的根记 `errors`（`failed / partial`）或 `pending`（超时）。旧 §4.5.3 构建（行没有 `ready`）退化为等终态整取，
  探能力那一发就是全清单、不多打。
- `useModelGeneration.showModelByDbnumGenModelV1`：`onRefnosReady` 每批就绪构件立刻 `loadGenModelV1Refnos`，收尾只补装
  `collected.refnos` 里还没进视口的（逐 SITE 老路 = 全部）；进度条只往前走（服务端进度占到 50、已收记录占到 95）；
  文案「服务端生成 N/M 根 · 已进视口 K 根」；日志加 `live_batches`。
- 单测新增 6 条：实时两拍各取一次且终态前就有构件回调 / 一根未成不问 ready + partial 未就绪根记 errors / 预算在批边界（refnos 与 roots 两种）/
  超时记 pending / 旧构建 `onRefnosReady` 收尾给一次 / api `?ready=1`；`useModelGeneration` 实时装载一条。
- 验证：受影响 4 文件 51/51 绿；`npm run type-check` 631 / 基线 631 / 新增 0；eslint 0 错；全量 vitest **264 文件 / 1991 条 / 0 failed**。
- `verify-gen-model-v1.ps1 -Dbnum` 的进度行加 `ready=N`（`roots?ready=1` 的 `ready_total`），认 ready 的服务端上它应与 `units_done` 同步涨。

**仍未验**：live——等用户按 §11 起 kv-mem 形态的服务（构建已换成 `d6a5d49ac`，命令不变）。看点：第一片 16 根提交后视口是否就出几何、
`/health.geometry_concurrency.active` 生成期间是否接近 16、`-Dbnum 7997` 终态那行的 `elapsed` 对比第 2 稿的串行量级。
