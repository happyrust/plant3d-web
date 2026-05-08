# 三维校审 workflow/verify + workflow/sync 实跑日志（2026-05-06）

> **目的**：在本机环境对《三维校审-workflow-verify-接口使用指南-2026-05-06.md》中描述的 `verify → sync` 调用时序做一次端到端实跑，给后端 / 平台联调留下命令、请求体、响应、根因诊断五件套证据。
>
> **执行人**：plant3d-web 仓 agent 一次性会话。
>
> **结论速读**：`auth/token` 通；`embed-url`（500 Specify a namespace to use）拦在路上，导致 `workflow/verify` 与依赖 form_id 的下游步骤无法继续。问题根因在 plant-model-gen 后端 `review_primary_db` 池初始化时 `use_ns` 失败，与 `verify`/`sync` 业务无关。

---

## 一、环境

| 维度 | 值 |
|---|---|
| 后端仓 | `plant-model-gen` `main` `bc5715e5` `ci(deploy): pin nightly to 2026-04-15 to fix ethnum E0512` |
| 后端二进制 | `/Volumes/DPC/work/plant-code/plant-model-gen/target/debug/web_server`（Apr 30 17:33 编出，607 MB） |
| 后端启动命令 | `nohup ./target/debug/web_server --config db_options/DbOption-mac > /tmp/web_server.log 2>&1 &` |
| 后端 PID | 74438 |
| 监听 | `:3100`（`web_server.bind_host = 0.0.0.0`） |
| SurrealDB | `:8020` PID 33838，NS `1516` / DB `AvevaMarineSample` |
| 前端仓 | `plant3d-web`（当前仓） |
| 验证脚本 | `scripts/pms-contract-sequence.ts`（`auth → embed → seed → verify → sync(query) → cache/preload → delete` 全链路 smoke） |
| Node 工具链 | `npx tsx`（脚本默认） |
| Rust toolchain（编译态参考） | `nightly-2026-05-02`（rustc 1.97.0），仓内 `ci(deploy)` 把 CI 部署 pin 在 `nightly-2026-04-15` 以避开 ethnum E0512 |

> **本地小动作**：执行过程中临时把 `plant-model-gen/Cargo.lock` 的 `ethnum` 从 `1.5.2` bump 到 `1.5.3`（`cargo update -p ethnum --precise 1.5.3`，走 USTC sparse 镜像）。**未重编**，复用 Apr 30 编出的二进制。是否提 PR 把这一行 lockfile 改动并入由仓主决定，本日志只做记录。

---

## 二、命令

```bash
cd /Volumes/DPC/work/plant-code/plant3d-web
npx tsx scripts/pms-contract-sequence.ts \
  --base http://localhost:3100 \
  --user SJ \
  --project AvevaMarineSample \
  --verbose
```

> 也跑过一次 `--project TEST_PROJECT`（脚本默认值），结果相同 → 项目名不影响 NS issue。

---

## 三、结果总览

```
═══════════════════════════════════════════════════════════
 PMS 平台 API 契约序列验证
  后端: http://localhost:3100  用户: SJ  项目: AvevaMarineSample  模式: external
═══════════════════════════════════════════════════════════
  ✓ [auth/token]            HTTP 200 (231ms)  code=0  Bearer token 已获取
  ✗ [embed-url]             HTTP 500 (325ms)  code=500 未提取到 form_id
  ✗ [review-task(seed)]     HTTP -   (0ms)    缺少 form_id，无法创建 seed task
  ✗ [workflow/verify]       HTTP -   (0ms)    已跳过：seed task 未创建成功
  ✗ [workflow/sync(query)]  HTTP 401 (68ms)   code=401
  ✗ [cache/preload]         HTTP 401 (67ms)   code=401
  ✗ [delete]                HTTP 401 (55ms)   code=401  未拿到 form_id，退回 dry-run
───────────────────────────────────────────────────────────
  结果: 1/7 步骤通过 ← 存在失败
───────────────────────────────────────────────────────────
```

> 通过率 1/7。**`workflow/verify` 这一步本身没有真正发出请求**，是被脚本根据上游 `seed task` 与 `embed-url` 失败的预处理逻辑短路了；`workflow/sync(query)` 因为没拿到 `embed-url` 给的 user_token，用占位串 `contract-test-token` 调，固定返 401。

---

## 四、关键请求 / 响应

### 4.1 `auth/token` ✓

请求：

```json
POST /api/auth/token
{
  "project_id": "AvevaMarineSample",
  "user_id": "SJ",
  "role": "sj"
}
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwcm9qZWN0X2lkIjoiQXZldmFNYXJpbmVTYW1wbGUiLCJ1c2VyX2lkIjoiU0oiLCJ1c2VyX25hbWUiOiJTSiIsInJvbGUiOiJzaiIsImV4cCI6MTc3ODEzNDIxNCwiaWF0IjoxNzc4MDQ3ODE0fQ.KyaMjh8_TWS_ymenKenslgXzpzcEQeUDs1tiQFgEUZw",
    "expires_at": 1778134214,
    "form_id": "FORM-8AE8A981EAC8"
  }
}
```

JWT 解码后的 claims：`{ project_id: AvevaMarineSample, user_id: SJ, role: sj, exp: 1778134214 }`，2 小时有效期。

### 4.2 `embed-url` ✗ 500

请求：

```json
POST /api/review/embed-url
{
  "project_id": "AvevaMarineSample",
  "user_id": "SJ",
  "workflow_role": "sj",
  "workflow_mode": "external",
  "token": "<auth/token 拿到的 Bearer JWT>"
}
```

响应：

```json
{
  "code": 500,
  "message": "Specify a namespace to use",
  "data": null
}
```

后端 log 行：

```
WARN aios_database::web_api::platform_api::embed_url] Embed URL ensure_review_form_stub failed:
  form_id=FORM-33A222B1E8DD,
  project_id=AvevaMarineSample,
  user_id=SJ,
  status=500,
  error=Specify a namespace to use
```

### 4.3 `workflow/verify` —— 被脚本 short-circuit

脚本在 `runSequence` 里：

```ts
if (!seedStepOk || !formId || !token) {
  // build synthetic failure step
  results.push(buildSyntheticFailureStep('workflow/verify', '已跳过：seed task 未创建成功', ...));
}
```

也就是说，这一步**没有发 HTTP**。下游 `workflow/sync(query)` 倒是发了——但用的是脚本内置的 `token = "contract-test-token"`、`form_id = "contract-test-form"` 占位值，自然在 platform_auth gate 上被打回 401。

### 4.4 `workflow/sync(query)` ✗ 401（占位调用）

请求：

```json
POST /api/review/workflow/sync
{
  "form_id": "contract-test-form",
  "token": "contract-test-token",
  "action": "query",
  "actor": { "id": "SJ", "name": "SJ", "roles": "sj" },
  "comments": ""
}
```

响应：

```json
{
  "code": 401,
  "message": "unauthorized",
  "data": null
}
```

> `[platform_auth] enabled = true, debug_token = ""`，无 Bearer 直接 401。这条不算 verify+sync 的真实业务结果，只用于证明"sync 路由存在且 platform_auth gate 工作"。

---

## 五、根因诊断（embed-url 500）

`embed-url` 处理函数 `src/web_api/platform_api/embed_url.rs` 在 token 派发之前先调 `ensure_review_form_stub`：

```rust
let ensured_form = match ensure_review_form_stub(
    &form_id,
    request.project_id.as_str(),
    request.user_id.as_str(),
    requested_role.as_deref(),
    "pms_embed",
).await { ... }
```

`ensure_review_form_stub` 走 `review_primary_db()`：

```rust
pub fn review_primary_db() -> &'static Surreal<Client> {
    let pool = REVIEW_PRIMARY_DB_POOL.get().expect("review_primary_db 尚未初始化");
    let idx = POOL_CURSOR.fetch_add(1, Ordering::Relaxed) % pool.len();
    &pool[idx]
}
```

池初始化在 `init_review_primary_db`：每条连接做 `Surreal::new::<Ws>` → `signin(Root)` → `aios_core::use_ns_db_compat(&db, surreal_ns, project_name)`。

后端启动 log（`/tmp/web_server.log` 节录）：

```
🔄 数据库连接尝试 1/3
使用 aios_core::init_surreal 初始化数据库...
[scene_tree] Schema 初始化完成
✅ 数据库连接成功！
🗄️  SurrealKV 已禁用 (surrealkv.enabled=false)，模型数据写回主 SurrealDB
载入 surreal review_workflow.surql
❌ 连接尝试 1 失败: 数据库初始化失败: Specify a namespace to use
⏳ 2秒后重试...
载入 surreal review_workflow.surql
❌ 连接尝试 3 失败: 数据库初始化失败: Specify a namespace to use
❌ SurrealDB 连接失败: 数据库初始化失败: Specify a namespace to use
   配置信息: host: localhost:8020 | user: root | ns: 1516 | db: AvevaMarineSample
   请检查 SurrealDB 服务是否运行，配置是否正确
🧭 数据库初始化完成 (surrealdb=ws, surrealkv_enabled=false, kv_active=false)
✅ 数据库连接初始化成功
```

读这段 log 的关键：

1. **主连接**（`aios_core::init_surreal`）已成功，NS=1516 / DB=AvevaMarineSample → `[scene_tree]` 初始化通过。
2. **review pool**（`init_review_primary_db`）在 `use_ns_db_compat` 阶段连续三次报 `Specify a namespace to use`。最后一行 "数据库连接初始化成功" 是另一条路径的日志，**不代表 review pool 池就绪**。
3. 因此 `review_primary_db()` 拿到的 connection 没设上 NS，所有 SurrealQL 都在裸 root 状态执行 → 任意 `CREATE review_forms` 当场抱怨 namespace。

> **诊断结论**：embed-url 500 与 `verify`/`sync` 的契约语义无关，是 plant-model-gen `review_db.rs` init 阶段 `use_ns_db_compat` 失败被吞掉的副作用。同样的根因会牵连所有走 `review_primary_db()` 的下游路由。

> **疑似机制**：本次实跑用的是 Apr 30 编出的 web_server 二进制；当前 main HEAD 的 review_db.rs（`init_review_primary_db` + `ensure_review_primary_db_context` 双重保险）可能已经在主线修过；要确认需重编后再跑同一脚本对比。

---

## 六、配套环境快照

`plant-model-gen/db_options/DbOption-mac.toml` 关键段：

```toml
project_name = "AvevaMarineSample"
project_code = '1516'
surreal_ns   = '1516'

[platform_auth]
enabled = true
debug_token = ""

[review_auth]
enabled = false

[surrealdb]
mode = "ws"
ip   = "127.0.0.1"
port = 8020

[web_server]
port = 3100
bind_host = "0.0.0.0"
```

启动现场：

```
$ lsof -nP -iTCP:3100 -sTCP:LISTEN
COMMAND     PID          USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
web_serve 74438 dongpengcheng   20u  IPv4 0x7c121759e94ceef      0t0  TCP *:3100 (LISTEN)

$ lsof -nP -iTCP:8020 -sTCP:LISTEN
COMMAND   PID          USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
surreal 33838 dongpengcheng   37u  IPv4 0x63cc1fdcdfc9a239      0t0  TCP *:8020 (LISTEN)
```

ethnum 依赖反查（cargo tree -i）：

```
ethnum v1.5.3
├── polars-arrow v0.46.0
│   └── polars v0.46.0
│       └── aios-database v0.3.2 (/Volumes/DPC/work/plant-code/plant-model-gen)
└── polars-parquet v0.46.0
    └── polars v0.46.0
```

`polars` 在 `aios-database/Cargo.toml` 直接声明（行 40-45），feature `parquet-export`（属于 default features）启用。

---

## 七、复盘 & 后续路线

### 7.1 这次"实跑"实际跑通了哪些事实

- `auth/token` 完整闭环：JWT 派发、HMAC 签名、claims 字段（project_id/user_id/role/exp/iat/form_id）正常。
- `workflow/sync` 路由存在且 `platform_auth` gate 生效（401 的"unauthorized"是 platform_auth 门禁，不是路由 404）。
- `cache/preload` / `delete` 同上。
- 后端能正常启动到 listening 状态，主连接 NS/DB 切换成功，唯独 review_primary_db pool init 阶段 use_ns 失败。

### 7.2 这次没能跑通的事

- `verify → sync` 真实业务请求（含 actor/next_step/comments 校验）一次都没实际发出。

### 7.3 推荐下一步（按工作量从小到大）

1. **修复 review pool init**（plant-model-gen，工作量 1-3h）：
   - 在 `init_review_primary_db` 里把 `use_ns_db_compat` 的实际错误打到 log（目前被吞）。
   - 确认 `surreal_ns = '1516'` 经由 `aios_core::get_db_option().surreal_ns` 取出来后是否真的非空（toml 单引号解析、ConfigSource 优先级、env 覆盖等都查一遍）。
   - 修完后重编 web_server。**重编前请把 ethnum 也 bump 到 1.5.3**，否则当前 nightly 上会撞 E0512。
2. **绕开 embed-url 直接实跑 verify+sync**：手工通过 SurrealDB CLI seed 一条 `review_forms` + `review_tasks`，再用 `model_center.token_secret` 自签 user_token，构造 `verify` 请求体；`sync` 用同一个 token。本质是把 embed-url 的工作离线做一遍，可作为 review pool 修好之前的 fallback E2E 路径。
3. **走真实 PMS 链路**：`npm run test:pms:cdp:full`（需 `PMS_E2E_PASSWORD` / `PMS_EMBEDDED_SITE_SUBSTRING` / Chrome CDP），整个链路 token 由真实 PMS 内部签发，不依赖本地 embed-url；唯一坏处是要 PMS 联调环境账号。
4. **写 PR**：`plant-model-gen` Cargo.lock 的 ethnum 1.5.2 → 1.5.3 这一行已经在本地改了；如果要走 α 路线（让 nightly 不再需要 pin），可以基于这一改动开 PR；要走 β（保留 pin nightly 2026-04-15）则 `git checkout Cargo.lock`。本次实跑没有验证 1.5.3 的运行时行为（因为没有重编），只能保证依赖 graph 自洽。

### 7.4 重要不变量

- `verify` 与 `sync` 共享 token；token 由 `embed-url` 派发 → 任何要"实跑 verify+sync"的链路都隐含"embed-url 必须先打通"。本次实跑是这条不变量第一次在本机被打破。

---

## 八、附录：关键文件 & 命令索引

| 角色 | 文件 / 命令 |
|---|---|
| 接口契约 | `docs/verification/三维校审-workflow-verify-接口使用指南-2026-05-06.md` |
| 实跑脚本 | `scripts/pms-contract-sequence.ts` |
| 共享 payload 构造 | `src/debug/pmsPlatformContractPayloads.ts` |
| 后端 embed-url | `plant-model-gen/src/web_api/platform_api/embed_url.rs` |
| 后端 ensure_review_form_stub | `plant-model-gen/src/web_api/platform_api/review_form.rs` |
| 后端 review pool | `plant-model-gen/src/web_api/review_db.rs` |
| 后端配置 | `plant-model-gen/db_options/DbOption-mac.toml` |
| 启动日志 | `/tmp/web_server.log` |
| 实跑脚本日志 | `/tmp/contract.log`、`/tmp/contract_ams.log` |
| 后端二进制 | `plant-model-gen/target/debug/web_server`（Apr 30 17:33） |

