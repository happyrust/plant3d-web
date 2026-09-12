# plant3d-web 适配 gen-model-refactor kv-mem 模式开发计划

- 日期：2026-09-11
- 状态：Plannotator 已批准；P0–P5 与冻结源会话推进的 E3D 操作门均已完成
- 前端：`D:\work\plant-code\old\plant3d-web`
- 后端：`D:\work\plant-code\old\gen-model-refactor`
- 外部复核：Oracle MCP，模型选择已验证为 `GPT-5.6 Sol`、推理档已验证为 `Pro`

## 0. 结论

当前不是“前端完全没适配”，而是“基础链已适配，整库目标链在后端断了一段”：

1. 已能对接当前 `gen-model-refactor`：
   - `/api/v1/health`
   - `/api/v1/tree/{roots,children,ancestors}`、`/api/v1/search`
   - `/api/v1/dbnums` 的 `ref0s`
   - `/api/v1/element/attributes`
   - `/api/v1/model/ensure`
   - `/api/v1/model/records` 单根与 `generation_roots[]` 多根批量
   - `/api/v1/meshes/{hash}.mesh`
2. 当前最大断点：
   - `plant3d-web` 已调用 `POST /api/v1/dbnums/{dbnum}/model/ensure`；
   - 已调用 `GET /api/v1/dbnums/{dbnum}/model/roots?ready=1`；
   - `gen-model-refactor` 当前路由表中没有这两条路由；
   - `GET /api/v1/tasks/{id}` 已存在，可以直接复用。
3. 因此：
   - BRAN/EQUI 等单节点 `show_refno` 基本可用；
   - 大 SITE、ZONE 与 `show_dbnum` 不可靠；
   - 当前逐 SITE 退路仍受单次 `/model/ensure` 120 秒预算、超时后后台继续、忙根冲突影响，不能作为最终架构。
4. 推荐做法：把历史 `kvmem-dbnum-model-ensure` 分支的设计向前移植到当前
   `gen-model-refactor`，但不要直接 cherry-pick。当前分支相对旧提交已经大幅改造了
   `handlers.rs`、`task_registry.rs`、`model_refresh.rs` 和模型持久化边界，应按现行接口重写薄适配。

## 1. 本轮证据

### 1.1 当前工作树

- `plant3d-web`：`main@7cbc1cf`，有 4 个与本计划无关的 MBD/测试未提交改动。
- `gen-model-refactor`：`refactor/retire-publish-stage@757b23e94`，有一批正在进行的发布阶段退役、
  默认 `spawned-mem`、房间开关等未提交改动。
- 实施前必须先固定后端基线，不得覆盖或顺带提交这些在飞改动。
- 2026-09-11 实施记录：Plannotator 审批结果为 `approved`；两仓完整基线 SHA 已写入后端
  `docs/specs/web-service-api.md`。本轮不 reset、不替用户提交既有改动，P0/P1 变更叠加在上述
  工作树代码真值上并单独列出；“实施分支干净”这一提交隔离门留待既有改动归档后完成。

### 1.2 路由事实

`gen-model-refactor/src/web_service/mod.rs` 当前注册了：

- `GET /api/v1/tasks/{id}`
- `POST /api/v1/model/ensure`
- `POST /api/v1/model/records`
- `POST /api/v1/dbnums/{dbnum}/model/rebuild`
- tree/search/attributes/mesh/dbnums

但没有：

- `POST /api/v1/dbnums/{dbnum}/model/ensure`
- `GET /api/v1/dbnums/{dbnum}/model/roots`

历史分支 `kvmem-dbnum-model-ensure` 的 `d6a5d49ac` 曾实现这两条接口，但不在当前分支。

### 1.3 kv-mem 当前语义

`StoreMode` 已有四档：

- `external`：外置、可持久；
- `spawned-rocksdb`：服务拉起、可持久；
- `spawned-mem` / `kv-mem`：服务拉起 memory SurrealDB，有真端口，进程退出即丢失；
- `embedded-mem`：进程内 `mem://`，没有外部端口，进程退出即丢失。

`data_face` 由介质派生：

- durable 两档 → `ingest`
- memory 两档 → `read-through`

当前**工作树代码真值**已经把“两个形态键都没写”解析为 `spawned-mem`，仓根
`DbOption.toml` 也显式声明了该形态；相对当前 HEAD，这批改动仍未提交。联调和验收继续显式设置
`AIOS_STORE_MODE=spawned-mem`，目的是排除环境变量、旧 `in_memory_db` 键和现场配置差异，
不是等待另一次默认值翻转。

### 1.4 已验证

前端 gen-model 相关定向测试：

```text
10 test files passed
98 tests passed
```

后端当前契约定向测试（tree 路由、mesh 路由、单/多根 records）：

```text
4 tests passed
```

本轮没有启动长驻服务，未做 live kv-mem 验证。

P0/P1 实施后验证（2026-09-11）：

- `cargo check --lib --tests`：通过；
- 冻结快照/终态单测：5/5 通过；
- single-flight 与固定路由单测：4/4 通过；
- `web_service`：67/67 相关用例通过；完整集合另有 1 条相邻 `plant-ui/web/public/index.html`
  在本轮期间新增第 4 处 `window.location.origin` 后触发的既有计数断言，未改该仓；
- 本轮仍未启动长驻服务，P5 live 验收未执行。

P2/P3 实施后验证（2026-09-11）：

- capability true / false / 缺失三态、POST 404/405/501、409 单次退路、任务绑定 roots、
  roots 缺失等待终态、旧 task 404 重探 health 均已覆盖；
- 服务代次 token、legacy 断线恢复、records/tree/dbnums/ref0 缓存失效、异步响应 generation fence、
  `not_generated:` 单次 ensure 重试均已覆盖；
- P2/P3 定向 Vitest：117/117 通过；完整 Vitest：265 个文件、2014/2014 通过；
- 本轮触及的 TypeScript/Vue 文件 ESLint 通过；
- `npm run type-check` 对本轮文件无新增错误；全仓仍被同时在改的 review 任务 7 条基线外错误挡住
  （`InitiateReviewPanel.vue`、`TaskContextSection.vue`、`useUserStore.createReviewTask.test.ts`），
  本轮未触碰；
- live kv-mem 与浏览器重启场景仍留在 P5。

P4 与 review 类型门收口（2026-09-11）：

- 生产无配置时 gen-model base 已改为空串，请求为同源 `/api/v1/*`；显式 `/gm` 只留给
  Vite dev proxy 或部署方已有 rewrite，独立生产站点须配置远端绝对地址；
- `.env.example`、Vite 注释与本地/生产部署指南已同步，未改发布包脚本；
- 同轮清掉 review 模块 7 条基线外类型错误，并把 type-check baseline 从 631 收紧到 624；
- `npm run type-check`：624/624 基线、0 新增；P4/review 定向测试 41/41 通过；
- 完整 Vitest：265 个文件、2015/2015 通过；本轮触及文件 ESLint 通过。

P5 live 验收（2026-09-11，当前 `gen-model-refactor` 0.1.22 debug 构建）：

- `spawned-mem`：`data_face=read-through`、`durable=false`；单根 CLI 全链通过（BRAN
  22 records / 12 构件 / 10 个 mesh hash 全部 200）。
- 浏览器 `show_refno`：BRAN `24381_145018` = 22 对象 / 12 refno，EQUI
  `24381_109581` = 40 / 41，ZONE `24381_101410` = 11 / 8。
- 浏览器 `show_dbnum=7997`：冻结根 6769，任务 3.0 分钟 `succeeded 6769/6769`；首批
  records 在终态前进入视口，所有任务 roots 都带 `task_id`，无逐根 `model/ensure`，批量
  `generation_roots[]` 均 ≤64。
- CLI 整库复核：106 批 / 107 页，66,251 records / 48,251 构件，11.8 秒；
  复用任务 2.2 秒终态，RSS 714→714 MiB。
- 保持浏览器打开后调用 setup restart：27.1 秒用例通过；`started_at`/generation 改变、
  旧 task 404、下一次显式取数重新 ensure，当前场景对象数不被动清空。
- `embedded-mem`：`endpoint=embedded:mem`，单根全链通过；并发两个整库 POST 复用同一
  task（expected 6769）。
- `external@8010`：路由普查为 Database 2 库、Memory 27 库；dbnum 1112 → 409，
  model-lagging dbnum 7326 → 202。
- `spawned-rocksdb`：新库 dbnum 7997 → Memory/202；手动初始化 dbnum 7998 后
  `applied_sesno=model_sesno=12`，翻为 Database/409（75.3 秒）。
- 新增有限生命周期 runner `scripts/run-gen-model-v1-p5-live.ps1` 与浏览器门
  `e2e/gen-model-v1-p5-live.spec.ts`；所有临时 HTTP/Surreal 进程均已停止。
- 冻结源会话推进门已在隔离工程 `E3D31-DBMDAT-test` 完成：dbnum 7997 会话
  `108 → 109 (apply) → 110 (restore)`，两次 SAVEWORK 都发生在 Task A `running` 时；
  Task A 的 `source_sesno=108`、`total_units=6769` 与有序根指纹
  `3b9334cf…d0d7aca` 全程不变。新投影升到 109 后，旧任务由
  `stale e3d-model session 108 cannot overwrite projected session 109` 安全收口为
  `partial`，没有用旧代覆盖新代。Task B 捕获恢复后的 `source_sesno=110`，同一
  6769 根在 103.244 秒内 `succeeded 6769/6769`；恢复后只读探针确认 BOX XLEN 回到
  100 mm，临时 HTTP/Surreal 进程均已停止。可复跑入口：
  `scripts/run-gen-model-v1-frozen-source-live.ps1`；本机证据：
  `output/gen-model-v1-frozen-source-live/20260911-134904/evidence.json`。

## 2. 契约对照

| 能力 | plant3d-web 当前调用 | gen-model-refactor 当前状态 | 处置 |
| --- | --- | --- | --- |
| 健康/身份 | `GET /health` | 已有，含 `started_at`、`data_face`、`sul_db.medium/durable` | 前端补显式类型与实例代次消费 |
| 模型树 | `tree/*`、`search` | 已有，e3d-io 直读 | 保持 |
| ref0 → dbnum | `/dbnums.ref0s` | 已有 | 保持 |
| 属性 | `POST /element/attributes` | 已有，e3d-io 直读 | 保持 |
| 单节点生成 | `POST /model/ensure` | 已有；120 秒预算，超时后台继续 | 只用于单节点/退路 |
| 单根 records | `generation_root` | 已有 | 保持 |
| 多根 records | `generation_roots[]`，≤64 | 已有 | 保持 |
| 网格 | `/meshes/{hash}.mesh` | 已有，原字节返回 | 保持 |
| 整库启动 | `POST /dbnums/{n}/model/ensure` | 缺失 | 后端补 |
| 就绪根 | `GET /dbnums/{n}/model/roots?ready=1` | 缺失 | 后端补 |
| 单任务进度 | `GET /tasks/{id}` | 已有 | 复用 |
| 持久整库重建 | `/dbnums/{n}/model/rebuild` | 已有 | 不用于 kv-mem 显示 |

## 3. 推荐决策

### D1 · 整库生成入口

推荐：在 `gen-model-refactor` 补齐库级异步 ensure 与 ready-roots 两条 API。

不推荐长期只改前端逐 SITE：

- 一次 SITE 可能包含数百根；
- `/model/ensure` 120 秒后返回 timeout，但后台不会取消；
- 前端当前把这次范围记为 pending，不再取得根清单；
- 立即细分重试又可能撞同一生成根的锁。

### D2 · live 主测介质

推荐：

- 主测 `spawned-mem`：覆盖真实发布形态、外部端口、子进程生命周期；
- 补测 `embedded-mem`：覆盖无端口的纯进程内模式；
- 是否允许整库即时 ensure **按 `model_read_route::route_for(dbnum)` 判，不按介质名判**：
  - `Memory`：允许，只写进程内投影；
  - `Database`：409，本次退兼容路径；
- `external` / `spawned-rocksdb` 各准备两类库：两水位相等且无任务在飞的 Database
  库验 409；未初始化、正在写入、模型落后或水位不一致的 Memory 库验整库即时 ensure 可用。

### D3 · 生产 base URL

推荐同源优先：

- plant3d-web 若由 gen-model-refactor 同一个 HTTP 服务托管，生产默认 base 应为空串，
  直接访问 `/api/v1/*`；
- `/gm` 只用于另有反向代理明确把 `/gm` 改写到 gen-model 的部署；
- 本地开发继续允许 `http://localhost:8022`、`gm_backend_port` 和 `gm_backend` 覆盖。

当前生产缺省 `/gm` 不能直接假定适用于 gen-model-refactor 自身托管的静态站点。

### D4 · 版本/能力协商

推荐给 `/health` 增加可选、只加不改的能力块：

```json
{
  "capabilities": {
    "dbnum_model_ensure": true,
    "dbnum_model_ready_roots": true,
    "model_records_batch_max_roots": 64,
    "mesh_formats": ["mesh", "glb"]
  }
}
```

老服务端没有该块时，前端仍保留路由试探。

能力协商是三态：

- 两个整库能力都明确为 `true`：优先整库链，运行时错误仍按契约处理；
- 任一个明确为 `false`：直接走兼容链，不再试探；
- capabilities 整块缺失：才试探固定路由。

## 4. 目标架构与不变量

```text
tree / attributes
  plant3d-web ───────────────────────→ e3d-io HTTP API

show_refno
  POST model/ensure
    → POST model/records
    → GET meshes/{hash}.mesh

show_dbnum
  POST dbnums/{dbnum}/model/ensure
    → GET tasks/{task_id}
    + GET dbnums/{dbnum}/model/roots?task_id=...&ready=1
    → POST model/records { generation_roots[] }
    → 新就绪根分批进入 DTX
```

必须保持：

1. plant3d-web 不直连 SurrealDB，不读 `pe`、`gen_root`、`model_update_pending` 或进程内投影内部结构。
2. `show_dbnum` 是异步任务；`show_refno` 才允许使用同步 120 秒入口。
3. ready 的唯一判据是 `ModelMemoryStore` 中该根的发布回执，与 `model/records` 的
   `not_generated` 判据相同。
4. 整库 kv-mem ensure 不进 durable 队列、不推进水位、不调用 `model/rebuild`。
5. 一个整库任务只冻结一次源文件身份/会话和一次生成根集合；`expected_roots`、
   `TaskRegistry.total_units`、任务进度与任务 roots 查询必须消费同一集合。
6. `/tasks/{id}` 只查当前页面自己创建的整库任务；不恢复任务列表轮询、WS `model_drain`
   或被动场景重载。
7. kv-mem 服务重启后任务和投影均失效；前端只清取数缓存，不自动移除/重载已显示场景。
   用户下一次显式显示时重新 ensure。
8. mesh 以内容哈希寻址，不随服务实例代次清缓存。

## 5. 分阶段实施

### P0 · 固定基线与契约

涉及：

- 两仓 git 状态
- `gen-model-refactor/docs/specs/web-service-api.md`
- 本计划

任务：

1. 先把 `gen-model-refactor` 当前在飞改动落到明确提交，或从该提交创建专用 worktree。
2. 记录前后端基线 SHA。
3. 先在 spec 定义整库任务的冻结契约：
   - 一个任务只冻结一次 dbnum 源文件身份与会话；
   - 根枚举与模型生成使用同一冻结源；
   - 根选择复用现行生成根/交付单元判据；
   - 任务拥有固定、去重保序的 expected-root 集合；
   - `POST ensure` 的 `expected_roots`、TaskRegistry 的 `total_units` 与任务 roots 查询
     使用同一集合。
4. 把 spec 里仍写着旧 pending/publish 阶段的历史段落标为退役，避免实现时照抄旧架构。
5. 明确 D1–D4；未确认 D3 时不改生产 base URL。

验收：两仓实施分支干净；计划之外的现有改动不进入提交。

### P1 · 后端前移植整库 kv-mem 能力

涉及：

- 新增 `gen-model-refactor/src/data_interface/model_dbnum_ensure.rs`
- `gen-model-refactor/src/data_interface/mod.rs`
- `gen-model-refactor/src/data_interface/task_registry.rs`
- `gen-model-refactor/src/web_service/handlers.rs`
- `gen-model-refactor/src/web_service/mod.rs`
- `gen-model-refactor/docs/specs/web-service-api.md`

任务：

1. 为整库任务创建独立、进程内、有界的任务快照：
   - `task_id`
   - dbnum
   - 冻结文件身份与会话
   - 固定、去重保序的 expected-root 集合
   - 每根要求的最小 `source_sesno`
   - 创建/终态时间
   快照不能把数千根塞进每次 `/tasks/{id}` 的 JSON；TaskRegistry 的 `detail` 只放数量、
   冻结源摘要和失败摘要。终态后仍保留快照一段有界时间，供前端最后一次 roots 对账。
2. 从同一冻结的 `DirectTreeService`/文件快照中枚举该 dbnum 的权威生成根；去重、保序。
3. 只扩展当前 `TaskEntry`、`TaskState`、`finish`、`set_units_done`：
   - 新增 task kind `dbnum_model_ensure`；
   - 不复制历史分支任务结构或旧 durable 队列；
   - 提供单锁下按 `(kind, dbnum)` 的原子 get-or-create；
   - 只有 `Created` 一方可以 spawn，`Existing` 返回原 task、固定分母和当前进度。
4. 新增：
   - `POST /api/v1/dbnums/{dbnum}/model/ensure`
   - `GET /api/v1/dbnums/{dbnum}/model/roots`
5. roots 接口增加可选 `task_id`：
   - 带 `task_id`：读取该任务的冻结根集合，供在飞/终态对账；
   - 不带 `task_id`：只作当前文件快照诊断，不能参与某个任务的进度对账。
6. ensure 先用 `model_read_route::route_for(dbnum)`：
   - `Memory`：允许；
   - `Database`：409，并明确本端点只服务即时内存投影；
   - 不受 `watch_scope` 限制，与单节点按需显示同轴。
7. 在**真正执行生成的 spawned task 内**进入 `scope_memory_only(dbnum, ...)`；task-local
   作用域不能只包在 handler 外层后再 spawn。
8. 给当前 ModelRefreshPolicy 增加显式冻结源入口，或等价地把按该冻结源构造的一份
   `E3dModelService` 注入执行层；禁止普通 HTTP 任务退回 `from_current()`，否则根枚举和生成
   可能跨会话。
9. 把所有未 ready 根一次交给当前 `generate_roots_report`/同一批量流水线：
   - 不得逐根构造 `E3dModelService`；
   - 不得恢复 durable pending、rebuild 或 watermark 路径；
   - 初始 `units_done` 等于已满足本任务 `source_sesno` 的 receipt 根数，不是固定 0。
10. 生成期间每秒按“冻结根 ∩ 不早于任务源会话的投影回执”更新 `units_done`。
    receipt 只负责 ready/进度；生成 future 返回后保留
    `TargetedGenerationReport.failures`，再做最终 receipt 对账。
11. 任务终态：
    - `expected_roots == 0`：立即 `succeeded`；
    - 全部根 ready 且无 report failure：`succeeded`；
    - 至少一根 ready，但有失败或缺失：`partial`；
    - 非空集合一根都未 ready 且生成出错/根失败：`failed`；
    - result 至少含 expected、already_ready、newly_ready、failed、missing 和根级失败摘要。
12. 对正常返回、顶层错误、取消、JoinError 和 panic 都保证恰好一次终态收口，不能留下永不
    剔除的 `running` 行。
13. roots 接口：
   - 每行 `{generation_root,noun,name,ready}`；
   - `?ready=1` 只返回 ready 根；
   - `total` 恒为全根数；
   - `ready_total` 为当前 ready 根数；
   - `only_ready` 回显查询形态。
14. `/health.capabilities` 同步公布能力。

注意：`d6a5d49ac` 只能作设计参考。当前模型写入、房间与任务收口已变，禁止直接
cherry-pick 后用冲突解决结果当实现。

验收：

- Rust 单测覆盖根枚举、同库任务去重、Memory/Database 分流、ready 与 receipt 同源、
  冻结会话不漂移、零根/全预热/部分成功/顶层失败、任务终态和重启后任务缺失。
- 并发两个整库 POST 只能创建一个 task、spawn 一次生成。
- memory-only 整库任务不得进入 durable 队列、推进水位或调用 rebuild。
- `cargo check --lib --tests`
- `cargo test --lib -- web_service`
- `cargo fmt --check`

### P2 · 前端混合版本兼容与能力探测

涉及：

- `plant3d-web/src/api/genModelV1Api.ts`
- `plant3d-web/src/model-source/genModelV1/collectDbnum.ts`
- `plant3d-web/src/composables/useGenModelV1Health.ts`
- 对应测试

任务：

1. 给 Health DTO 增加：
   - `started_at`
   - `sul_db.medium`
   - `sul_db.durable`
   - `capabilities`
2. 能力三态：
   - 两个整库 capability 都为 true：优先整库链；
   - 任一个明确为 false：直接走兼容链；
   - capabilities 缺失：试探固定路由。
3. 混合发布期把**尚未成功创建任务时**目标 POST 的 404、405、501 识别为
   “服务端不支持整库入口”：
   - 只对该固定路径和这些状态降级；
   - 不把任意 500/internal 吞成能力缺失。
4. 继续保持：
   - 404/405/501：按 API 对象记一次 no；
   - 409：只退本次，不把整个服务记为 no；
   - roots 无 `ready`：等终态后整取；
   - batch records 失败：退逐根。
5. `genModelV1DbnumModelRoots` 增加 `taskId`，在整库任务期间每次都带刚创建的
   `task_id`，只读取任务冻结集合。
6. 如果 POST 已创建任务、后续 roots 路由缺失或返回静态 fallback 的非 JSON 内容：
   - 不能立即并发启动逐 SITE ensure；
   - 先等待已有任务终态，再走兼容取数；
   - 兼容识别只限这个固定 GET 路径，不能吞任意 `invalid_response`。
7. capability 明确为 true 时，普通资源 404 不能把服务永久记成 no。
8. `serverEntrySupportByApi` 与批量 records 支持记忆必须绑定服务代次，或提供统一 reset。
9. UI/日志明确区分：
   - “服务端版本不支持整库入口，已走逐 SITE 兼容路径”；
   - “该库当前以 database 为准，已走兼容路径”；
   - “整库即时生成失败”。

说明：当前后端有 SPA GET fallback，未知 POST 可能表现为 405 而不是 JSON 404；前端只认
`error.code === not_found` 不足以保证退路生效。

验收：补 405/501、capabilities、409 不记 no、旧 roots 无 ready 等 Vitest。

### P3 · kv-mem 服务代次与前端缓存生命周期

涉及：

- `plant3d-web/src/model-source/genModelV1/modelRecordSource.ts`
- `plant3d-web/src/model-source/genModelV1/treeSource.ts`
- `plant3d-web/src/composables/useGenModelV1Dbnums.ts`
- `plant3d-web/src/composables/useGenModelV1Health.ts`
- `plant3d-web/src/model-source/genModelV1/index.ts`

任务：

1. 定义服务代次 token：

```text
normalize(effectiveBaseUrl) + nonEmpty(health.started_at)
```

可再记录 `snapshot_epoch` 作为源骨架代次，但不能用它触发被动场景刷新。

2. health 探针由 gen-model-v1 **数据源生命周期**启动，徽标只消费状态，不负责缓存正确性：
   - 数据源激活时立即探测；
   - 任务 404、网络失败后恢复、准备接受长期正缓存命中前，走合并去重的 freshness 检查；
   - 60 秒定时器只是后台观测，不能是发现重启的唯一办法。
3. 老服务没有 `started_at` 时采用保守策略：连接失败后重新成功即清全部非 mesh 正缓存；
   `base + undefined` 不能被当作可跨重启的稳定代次。
4. token 变化时：
   - `modelRecordSource.invalidate()`；
   - 清 requested-result memo、root/leaves 归档；
   - 通过新增的 `treeSource.invalidate()` 清 roots Promise 缓存；
   - 清 `/dbnums` 共享缓存和 ref0→dbnum 派生缓存；
   - 清“支持整库入口/批量 records”的进程级能力记忆。
5. 建立统一 generation number：
   - 每个异步请求捕获发起时 generation；
   - 返回时若 generation 已变化，不得写回 records/tree/dbnums/requested-result 等缓存；
   - 可取消的在飞请求一并 abort；
   - 解决“先 invalidate、旧请求后完成又把旧数据写回来”的竞态。
6. 旧 task id 返回 404 时立即重探 health：
   - `started_at` 已变化：终止旧整库收集，不能把新进程 roots 当旧任务结果；
   - 服务代次没变：按任务被逐出的兼容语义收尾。
7. 不清 mesh 的浏览器缓存，geo_hash 是内容地址。
8. 不自动卸载当前场景；下一次显式显示再 ensure。
9. 如果对“已认为 ready”的根实际请求 records 得到：

```text
HTTP 409 + code == "conflict" + message startsWith("not_generated:")
```

则：
   - 清该根缓存；
   - 重新走一次 ensure；
   - 只重试一次，防止循环。

验收：

- 模拟后端 `started_at` 变化，确认旧 entries 不再直接命中、下一次显示重新发 ensure；
- 模拟旧 records 请求在 invalidate 后才返回，确认它不能重新污染缓存；
- tree roots、dbnums、ref0 映射和能力记忆都随代次失效；
- legacy 源不受影响。

### P4 · 生产同源部署收口

涉及：

- `plant3d-web/src/utils/apiBase.ts`
- `plant3d-web/vite.config.ts`
- `plant3d-web/.env.example`
- `plant3d-web/docs/guides/gen-model-v1-local-dev.md`
- 若决定替换发布前端：`gen-model-refactor/scripts/New-LocalRelease.ps1`

任务：

1. 固定解析优先级：
   1. URL 的 `gm_backend` / `gm_backend_port`；
   2. `VITE_GEN_MODEL_V1_BASE_URL`；
   3. 开发态默认 `http://localhost:8022`，LAN 开发访问仍可折到 Vite `/gm` 代理；
   4. 生产态默认空串，直接访问同源 `/api/v1/*`。
2. 部署约束：
   - `/gm` 只在显式配置 rewrite 的部署中使用；
   - 由 gen-model-refactor 托管的生产包不得默认产生 `/gm/api/v1/*`；
   - 独立站点生产部署必须显式提供 gen-model 地址；
   - 保留 `/gm` 开发代理能力；
   - 禁止把 `localhost:8022` 烘焙进生产包。
3. 若本期只做独立 plant3d-web，不替换发布包里的 plant-ui，则只改文档与构建参数，
   不动 `New-LocalRelease.ps1`。

验收：本地直连、Vite `/gm` 代理、生产同源三种测试各一条；生产无配置时请求必须是
`/api/v1/*`，不能是 `/gm/api/v1/*` 或 `localhost:8022`。

### P5 · CLI、浏览器与 live 验收

涉及：

- `plant3d-web/scripts/verify-gen-model-v1.ps1`
- `plant3d-web/e2e/model-source-default.spec.ts`
- `plant3d-web/e2e/gen-model-v1-mesh-direct.spec.ts`
- `plant3d-web/e2e/gen-model-v1-two-source-parity.spec.ts`
- 新增整库实时 E2E

执行顺序：

1. `spawned-mem` 起后端，确认：
   - `data_face=read-through`
   - `sul_db.medium=spawned-mem`
   - `sul_db.durable=false`
2. `verify-gen-model-v1.ps1 -Ensure` 验单节点全链。
3. `verify-gen-model-v1.ps1 -Dbnum 7997` 验：
   - roots 总数；
   - ensure 202；
   - task 进度；
   - 每次 roots 查询携带 `task_id`，总数与任务冻结集合不漂移；
   - ready_total 单调增长；
   - ready 根 records 不返回 409；
   - elapsed、根数、RSS。
4. 浏览器 `show_refno`：BRAN、EQUI、ZONE 各一。
5. 浏览器 `show_dbnum`：
   - 第一批几何必须在任务终态前进入视口；
   - records 请求用 `generation_roots[]`，每批 ≤64；
   - 不逐根发 ensure；
   - 日志中的 roots/refnos/instances/pending/errors/live_batches 对账。
6. 保持浏览器不关，重启后端：
   - 任务查询旧 id → 404；
   - 前端检测新 `started_at`；
   - 下一次显式显示重新 ensure；
   - 不继续把旧 record cache 当当前投影。
7. `embedded-mem` 复跑 HTTP 主链，确认 `/health.sul_db.endpoint=embedded:mem`，
   不要求外部数据库探针可达。
8. `external` / `spawned-rocksdb` 按模型读路由各验两格：
   - Database-routed 库：整库新入口 409 与逐 SITE 退路；
   - Memory-routed 库：整库即时 ensure 成功且只写内存投影。
9. 任务执行中推进源文件会话，验证任务的 frozen source、expected roots、`total_units`
   与 `roots?task_id=...` 保持不变；下一次新任务才看到新会话。
10. 两个并发整库 POST 只创建一个任务、只 spawn 一次生成。

## 6. 测试门

### 后端

- options：四种 StoreMode、durable、has_endpoint、data_face 派生。
- model records：单根、多根、跨根分页、未 ready 409。
- dbnum ensure：并发 single-flight、零根、全预热、部分成功、顶层错误、JoinError/panic、
  任务进度、Memory/Database 分流。
- frozen source：任务中源会话变化不改变 expected roots、total 或任务 roots 集合。
- roots：全量、`task_id`、`ready=1`、ready/receipt 会话不早于任务源。
- memory-only：不进 durable 队列、不推进水位、不调用 rebuild。
- API 未知路径：返回稳定 JSON 404；若暂不改后端 fallback，前端必须覆盖 405。

### 前端

- `genModelV1Api.test.ts`
- `modelRecords.test.ts`
- `modelRecordSource.test.ts`
- `collectDbnum.test.ts`
- `useGenModelV1Health.test.ts`
- `useGenModelV1Dbnums.test.ts`
- `useModelGeneration.genModelV1.test.ts`

必须覆盖：

- capability true / false / 缺失三态；
- 未知整库 POST 的非 JSON 405；
- 旧 task id 404 触发立即 health 重探并终止旧任务；
- 服务代次改变时统一清非 mesh 缓存；
- 过代的在飞响应不能回填缓存；
- 生产无配置时走同源 `/api/v1/*`；
- 第一批 ready 根在任务终态前进入视口。

门：

```text
npm run type-check
npx eslint <本轮触及文件>
npx vitest run <上述相关测试>
npx vitest run
```

不得通过修改 type-check baseline 放行新增错误。

## 7. 发布顺序与回滚

发布顺序：

1. 先发后端：新增路由、任务 kind、roots-ready、capabilities；旧前端不受影响。
2. 再发前端：能力探测、405 退路、缓存代次、同源 base。
3. 最后核验发布模板显式声明 `spawned-mem`，并核验所有 external 现场显式写
   `store_mode=external`；本阶段不再修改代码默认值。

回滚：

- 前端可用 `?model_source=legacy` 回旧链路；
- 新后端路由是纯增量，可先停用 capability 宣告，不影响单节点链；
- `show_dbnum` 新入口不可用时保留逐 SITE 兼容路径，但 UI 必须明确这是降级，不承诺实时性；
- 不回滚或改写 `model/records` 已有多根契约。

## 8. 风险与非目标

风险：

1. 后端当前工作树大面积未提交，直接移植旧提交容易把退役代码带回。
2. 大库并行生成会提高 RSS；live 必须记录首批可见时间、终态时间与前后 RSS。
3. `spawned-mem` 有数据库端口不等于前端应该连数据库。
4. 服务端重启后投影消失，浏览器缓存若不按服务代次失效会展示陈旧结果。
5. 生产 `/gm` 是否可用取决于外部代理；gen-model-refactor 自身并没有 `/gm` rewrite。
6. 根枚举与生成若不共享冻结源，长任务期间文件会话推进会让分母、ready 集合与实际产物错代。
7. 仅在清 Map 时失效缓存不足以挡住已在飞的旧响应，必须有异步 generation fence。

非目标：

- 不恢复 WS 模型变更同步；
- 不恢复 `/tasks` 列表轮询；
- 不把 `model/rebuild` 当显示接口；
- 不迁移版本对比、MBD、校审批注等旧后端依赖；
- 不删除 legacy；
- 不在本计划内消化后端发布阶段退役或房间模型的其它改动；
- 不在本计划内把发布包的 plant-ui 替换成 plant3d-web，除非另行确认。

## 9. 估算

- P0：0.5 天
- P1：2–3 天（含冻结源、任务快照、原子 single-flight 与失败收口）
- P2：0.75–1 天
- P3：1–1.5 天（含数据源生命周期与异步响应代次栅栏）
- P4：0.25–0.5 天
- P5：1–1.5 天，不含大库首次生成本身的等待时间

关键路径：P0 → P1 → P2/P3 → P5。P4 可与 P2/P3 并行。

推荐批准组合：D1 后端补整库 API、D2 以 spawned-mem 为主测、D3 生产同源优先、D4 加
capabilities 并保留老服务探测退路。

GPT-5.6 Sol Pro 对初稿的结论是“修改后批准”，点名的五个阻断项为：冻结源/根集合、
原子 single-flight、按 ModelReadRoute 而非介质验收、405/能力三态、在飞响应代次栅栏。
本修订稿已逐项纳入，现可提交用户拍板。
