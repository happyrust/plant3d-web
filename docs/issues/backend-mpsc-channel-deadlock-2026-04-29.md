# Issue: 后端 review_primary_db SurrealDB ws client mpsc channel 死锁导致 simulator-runner 跑不完整

| 元信息 | 值 |
|------|------|
| 上报日期 | 2026-04-29 |
| 严重度 | P1（阻塞 simulator-runner 自动化 + 真实 PMS 联调多角色并发） |
| 影响仓库 | **`plant-model-gen`**（不在本仓 `plant3d-web` 修复范围） |
| 受影响文件 | `plant-model-gen/src/web_api/review_db.rs`、surrealdb 依赖 |
| 复现率 | 100%（每次 simulator-runner 跑 bran-mixed 都会触发） |
| 修复状态 | 🟡 已有 RUS-238 验收级缓解，长期池健康治理待落地 |

## 1. 现象

跑 `npm run test:pms:simulator -- bran-mixed` 时：
- 第一次跑（backend 启动后初次）：14:27 28 项断言全绿（已存档 `artifacts/bran-mixed-run-20260429-142722.log`）
- 重启 backend 后再次跑：跑到 task/form 创建后 backend 进入 hang 状态
- `/api/review/tasks?limit=10` 30s+ 不返回；`/api/review/records/by-task/...` 12s+ 不返回
- backend 进程仍然能签发 token（轻量路由 OK），但所有走 SurrealDB 查询的路由都 hang

## 2. 关键日志

`backend-pool16.log` 中（即使把池大小从 4 调到 16）：

```
[2026-04-29T09:38:18Z ERROR surrealdb::engine::remote::ws] Failed to send query results to channel: SendError(..)
```

这是 SurrealDB 0.5/3.x ws client 已知问题：**单个 ws Surreal<Client> 内部用 mpsc channel 串行化所有响应，channel 缓冲区满后 send 失败，client 无法继续处理新查询**。

## 3. 根因分析

### 当前实现（`plant-model-gen/src/web_api/review_db.rs:1–127`）

```rust
const DEFAULT_POOL_SIZE: usize = 4;
static REVIEW_PRIMARY_DB_POOL: OnceCell<Vec<Surreal<Client>>> = OnceCell::new();
static POOL_CURSOR: AtomicUsize = AtomicUsize::new(0);

pub fn review_primary_db() -> &'static Surreal<Client> {
    let pool = REVIEW_PRIMARY_DB_POOL.get().expect("…");
    let idx = POOL_CURSOR.fetch_add(1, Ordering::Relaxed) % pool.len();
    &pool[idx]
}
```

注释里已经识别到 mpsc 锁死的风险：

> 单 ws Surreal\<Client> 在高并发（如 newContext 后 plant3d-web 并发 30+ review 请求）时 mpsc channel 会被打满锁死；多路连接池可线性扩展并发能力。

**问题**：
1. 池只是把锁死风险**摊薄**到 N 个 client，但**每个 client 内部仍是单 mpsc channel**
2. simulator-runner 跑 `bran-mixed` 时，4 BRAN 注入 + 注释 + 决议 + workflow query 在短时间内并发触发可能 30+ 个查询，**轮询调度会让某个 client 轮到很多 long-running 查询，channel 占满后整个 client 锁死**
3. 一旦某个 client 锁死，`POOL_CURSOR` 还是会**轮询到这个 client**，新请求继续 hang 在那个 client 上

### 验证

| 池大小 | 结果 |
|---|---|
| 4（默认） | 跑到 createReview 后立刻 hang |
| 16（`REVIEW_PRIMARY_DB_POOL_SIZE=16`） | 仍 hang，在 `Listing review tasks` 后 mpsc SendError |

### 2026-04-30 RUS-238 新建单据复核

在 RUS-238 新建单据 browser use 验收中再次复现同类问题：

- 新单据：`FORM-37C372A7407F`
- task：`task-1104fb4f-8787-4ff9-9aee-3125ecb452ff`
- 现象：页面能识别 task 标题，但 `/api/review/records/by-task/...`、`/api/review/tasks/{id}/history`、`/api/review/workflow/sync` 返回 500 或超时。
- 独立 `surreal sql` 直连同一 `review_tasks`、`review_records`、`review_comments` SQL 均毫秒级返回，确认数据和 SQL 正常。
- 结论：阻塞仍在 `review_primary_db` 池化 ws client，而不是业务数据缺失。

## 4. 修复建议（按优先级）

### 方案 1：池调度跳过死锁的 client（最小改动）

`review_primary_db()` 增加一个"健康标记"，当某个 client 出现 SendError 后将该 idx 标为 dead，跳过到下一个：

```rust
static POOL_HEALTH: OnceCell<Vec<AtomicBool>> = OnceCell::new();

pub fn review_primary_db() -> &'static Surreal<Client> {
    let pool = REVIEW_PRIMARY_DB_POOL.get().expect("…");
    let health = POOL_HEALTH.get().expect("…");
    for _ in 0..pool.len() {
        let idx = POOL_CURSOR.fetch_add(1, Ordering::Relaxed) % pool.len();
        if health[idx].load(Ordering::Relaxed) { return &pool[idx]; }
    }
    &pool[0] // 全死则降级
}
```

并在每个 query 出错时标记。优点：最小改动；缺点：dead client 永久不复原，需要重启 backend 周期性清扫。

### 方案 2：每次 review 请求新建独立 client（推荐治本）

放弃池化，每个请求用一个 short-lived client：

```rust
pub async fn fresh_review_db() -> Result<Surreal<Client>> {
    let cfg = aios_core::get_db_option().effective_surrealdb();
    let db = Surreal::new::<Ws>(format!("{}:{}", cfg.ip, cfg.port).as_str()).await?;
    db.signin(Root { username: cfg.user, password: cfg.password }).await?;
    aios_core::use_ns_db_compat(&db, &ns, &project_name).await?;
    Ok(db)
}
```

并在 `review_api.rs` 的每个 handler 里 `let db = fresh_review_db().await?;` 替代 `review_primary_db()`。

代价：每请求 ~50ms 连接建立开销；好处：彻底回避 mpsc 锁死，请求间无干扰。

#### RUS-238 已落地的验收级缓解

本轮已在 sibling 后端仓 `plant-model-gen` 落地一个最小范围变体：

- 新增 `fresh_review_db()`。
- 仅将 RUS-238 新建单据验收依赖的读路径切换为 short-lived client：
  - task list/detail/history/workflow
  - records by task
  - comments by annotation
  - review form lookup
  - workflow query 中 models/attachments/records/comments 读取
- 写路径暂不扩大改动，降低回归面。

验证结果：

- `cargo check --bin web_server --features web_server` 通过。
- `cargo build --bin web_server --features web_server` 通过。
- patched backend 下 direct API 复核 task/records/comments/workflow 全部 200。
- Cursor browser 打开 `FORM-37C372A7407F` 后可见审核记录 `1`、历史流转 `1`、批注 `1`、测量标记和 `RefNo 24381/145018, 24381_145018`。

注意：这是对关键 review 读路径的稳定性缓解，不等于连接池问题已经彻底消失。仍需要方案 1 或升级 client 做长期治理。

### 方案 3：升级 surrealdb crate

当前依赖（`Cargo.toml:67`）：
```toml
surrealdb = { git = "https://gitee.com/happydpc/surrealdb", branch = "dev-3.1", … }
```

升级到 surrealdb 上游 1.5+ 或检查 `dev-3.1` 是否已修复 channel 满处理。需要 backend 开发者评估 API 兼容性。

### 方案 4：用 in-process embedded DB（rocksdb）替代 ws

DbOption-mac 里如果改成 `surrealdb.mode=mem` 或 `rocksdb`，client 走内存调用，没 mpsc 风险。代价：失去多进程共享数据库能力。

## 5. 临时缓解（前端侧 / 联调侧，无需改 backend）

| 方法 | 效果 |
|---|---|
| 每跑一次 simulator-runner 都重启 backend + 清理 review_* 表 | 跑到一半仍 hang，可观察前段流程 |
| 用 ` artifacts/bran-mixed-run-20260429-142722.log` 作为已通过证据 | 避免重复跑 |
| 把 simulator-runner 的并发降到 1（`PMS_SIMULATOR_HEADLESS=1` + 增大 `intervalMs`） | 可能减轻 mpsc 压力，但不能根除 |

## 6. 14:27 那次跑通的留存证据

```
formId: FORM-CBC3F5FEFE2F
taskId: task-2110bf64-a314-49bd-a9a2-32cf7c06da17
packageName: BRAN-MIXED-REGRESSION-1777444049100
finalStatus: approved
finalNode: pz
```

28 项断言全部 passed，覆盖：
- 4 BRAN 包含验证（24381_144976/144991/145012/145018）
- SJ active → backend node=jd, status=submitted
- JH 阶段：3 同意 + 1 reject (24381_144991) → JH return → backend node=sj, status=draft
- 24381_144991 decision=rejected
- SJ rework → fix → SJ active
- JH agree → SH agree → PZ approve → status=approved, node=pz
- 4 BRAN 终态 decision=agreed

完整 log：`artifacts/bran-mixed-run-20260429-142722.log`

## 7. 状态

- [x] 现象记录（多次重启复现）
- [x] 根因定位（surrealdb ws client mpsc channel 满 + 池调度无健康检查）
- [x] 已知该问题不在本仓修复范围
- [x] backend 仓落地 RUS-238 验收级 short-lived client 读路径缓解
- [ ] backend 仓选型并落地长期方案 1/3/4，或补池健康检查/熔断/恢复
- [ ] 修复后 simulator-runner 连续跑 10 次验证稳定性

## 8. 引用

- `plant-model-gen/src/web_api/review_db.rs:10-25`（注释明示 mpsc 风险）
- `plant-model-gen/src/web_api/review_api.rs:2370`（`get_records_by_task` 单 SQL 查询，逻辑无误，问题在 client 层）
- `plant3d-web/artifacts/pms-simulator-artifacts/backend-pool16.log:`（SendError 关键证据）
- `plant3d-web/artifacts/bran-mixed-run-20260429-142722.log`（14:27 全绿基线）
