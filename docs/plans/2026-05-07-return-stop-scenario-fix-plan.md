# Return/Stop 场景修复方案

> 日期：2026-05-07  
> 状态：待执行  
> 关联进度：task="三仓更新合并并验证三维校审流程"

---

## 1. 问题概述

仿 PMS 模拟器中 `return`/`stop` 场景在多角色并发流转时失败。approved 主链稳定通过。

**失败表现**：
- `openTaskForRole(SH)` 阶段超时：`等待 simulator 快照切到 form_id=... 超时`
- 后端 `probeBackendTaskByFormId` 超时：`POST /api/review/workflow/sync 超时`
- 后端清理请求超时：`POST /api/review/delete 超时`

**根因**：rs-core 后端 SurrealDB 校审数据库上下文切换超时

---

## 2. 根因分析

### 2.1 错误链路追踪

```
前端 runWorkflowAction(agree) 
  → 后端 POST /api/review/workflow/sync
  → ensure_review_db_context 中间件
    → use_ns_db_compat(&SUL_DB, ns, db)         // 2s 超时，可容忍失败
    → ensure_review_primary_db_context()         // 5s 超时，失败则 500
      → use_ns_db_compat(review_primary_db, ns, db) 
      → 🔴 SurrealDB WS 发送 "USE NS ... DB ..." 查询
      → 🔴 超时 → "校审数据库上下文切换超时"
```

### 2.2 SurrealDB 层面的竞争条件

后端日志关键证据：
```
[WARN] review api primary db context ensure failed: ns=1516, db=AvevaMarineSample, error=校审数据库上下文切换超时
[ERROR] surrealdb::engine::remote::ws: Failed to send query results to channel: SendError(..)
```

**分析**：

1. **`REVIEW_PRIMARY_DB` 是全局单例 `OnceCell<Surreal<Client>>`**（review_db.rs:9）
2. **每次请求都调用 `use_ns_db_compat`**（review_db.rs:52-57）重新发送 `USE NS ... DB ...` 
3. SurrealDB WS 客户端是**单连接**（`Surreal<Client>`），多个并发请求共享同一个 WebSocket
4. 当多角色快速流转时（SJ→JH→SH→PZ），并发请求争抢同一个 WS 连接
5. WS 消息队列满或响应超时 → `SendError` → 后续请求全部阻塞

### 2.3 为什么 approved 主链通过但 return 失败

- approved 主链：步骤间有较大间隔（页面切换、iframe 加载），SurrealDB 有时间处理
- return 场景：4 角色连续流转 + 驳回 + 重新打开，请求密度更高
- return 场景中 `probeBackendTaskByFormId` 的额外探测请求加剧了并发

---

## 3. 已完成修复（前端侧）

| # | 修复 | 文件 | 影响 |
|---|---|---|---|
| F1 | `runSubmitReviewAcrossContext` 返回类型 `string` → `InitiateReviewResult { packageName, createResult }` | `pms-plant3d-initiate-flow.ts` | runner 能获取 hook 捕获的 taskId/formId |
| F2 | CDP 流适配新返回类型 | `pms-chrome-devtools-flow.ts` | 兼容性 |
| F3 | `reviewTaskCreate` 前端超时 12s → 30s | `reviewApi.ts` | 容忍后端慢响应 |
| F4 | bootstrap `FETCH_TIMEOUT_MS` 15s → 30s，重试间隔 1.5s → 3s | `pms-simulator-bootstrap.ts` | 预热容忍度 |
| F5 | `ensureBackendBinary` Windows `.exe` 检测 | `pms-simulator-bootstrap.ts` | 避免无谓 cargo build |
| F6 | runner `postJson`/`getJson` 超时 12s → 30s | `pms-simulator-runner.ts` | 后端探测容忍度 |

---

## 4. 待执行修复（后端侧）

### 方案 A：消除冗余的 `USE NS DB` 切换（推荐）

**问题**：`ensure_review_primary_db_context()` 每次请求都发 `USE NS ... DB ...`，但 ns/db 在服务器生命周期内不变。

**修复**：
1. 在 `init_review_primary_db` 时设置好 ns/db 后，用 `AtomicBool` 标记已初始化
2. `ensure_review_primary_db_context()` 只在首次初始化时执行 `use_ns_db_compat`
3. 如需支持热加载（`DbOption` RwLock），在 `DbOption` 变更时重置标记

**修改文件**：
- `plant-model-gen/src/web_api/review_db.rs`

```rust
use std::sync::atomic::{AtomicBool, Ordering};

static REVIEW_DB_CONTEXT_SET: AtomicBool = AtomicBool::new(false);

pub async fn ensure_review_primary_db_context() -> Result<()> {
    if REVIEW_PRIMARY_DB.get().is_none() {
        init_review_primary_db(&aios_core::get_db_option()).await?;
    }
    
    if REVIEW_DB_CONTEXT_SET.load(Ordering::Acquire) {
        return Ok(());
    }
    
    let db_option = aios_core::get_db_option();
    aios_core::use_ns_db_compat(
        review_primary_db(),
        &db_option.surreal_ns,
        &db_option.project_name,
    )
    .await?;
    
    REVIEW_DB_CONTEXT_SET.store(true, Ordering::Release);
    Ok(())
}

/// 在 DbOption 热更新后调用
pub fn reset_review_db_context_flag() {
    REVIEW_DB_CONTEXT_SET.store(false, Ordering::Release);
}
```

**同步修改 review_api.rs 中间件**：移除 `use_ns_db_compat(&SUL_DB, ...)` 的冗余调用，或同样加缓存标记。

**预期效果**：并发请求不再重复发 `USE NS DB`，消除 WS 通道竞争。

---

### 方案 B：增大 `ensure_review_primary_db_context` 超时

**修改**：review_api.rs 1116-1120 行的 `Duration::from_secs(5)` → `Duration::from_secs(15)`

**评估**：治标不治本，只是推迟超时而非消除根因。不推荐单独使用。

---

### 方案 C：review_api 中间件改为软失败

**问题**：当前 `ensure_review_primary_db_context` 失败时直接返回 500。

**修复**：改为 warn 日志 + 继续执行（因为 ns/db 实际上在 `init_review_primary_db` 时已设置好）。

**评估**：可作为方案 A 的补充保底，但不应是主方案。

---

### 方案 D：review_annotation_state.rs 也需同步

`review_annotation_state.rs:151` 也调用了 `ensure_review_primary_db_context()`，且没有 timeout 包装。需与 review_api.rs 保持一致。

---

## 5. 推荐执行顺序

| 步骤 | 内容 | 仓库 | 风险 |
|---|---|---|---|
| S1 | 方案 A：`review_db.rs` 加 `AtomicBool` 缓存标记 | plant-model-gen | 低 |
| S2 | review_api.rs 中间件：SUL_DB 的 `use_ns_db_compat` 也加缓存 | plant-model-gen | 低 |
| S3 | review_annotation_state.rs 对齐处理 | plant-model-gen | 低 |
| S4 | 重编 web_server → 重跑 return 场景验证 | plant-model-gen + plant3d-web | 无 |
| S5 | （可选）方案 B+C 作为防御层 | plant-model-gen | 低 |

---

## 6. 验证方案

```powershell
# 1. 编译后端
cd D:\work\plant-code\plant-model-gen
cargo build --bin web_server --features web_server

# 2. 启动后端
$env:ADMIN_USER='admin'; $env:ADMIN_PASS='admin'
.\target\debug\web_server.exe --config db_options/DbOption

# 3. 运行 return + stop 场景
cd D:\work\plant-code\plant3d-web
$env:PMS_SIMULATOR_CASE='return,stop'
$env:PMS_SIMULATOR_SEED_REVIEW_TASK='1'
$env:PMS_SIMULATOR_TRACE='1'
npm run test:pms:simulator

# 4. 验证标准
# - 契约烟测 7/7 PASS
# - return 场景所有 assertions PASS
# - stop 场景所有 assertions PASS  
# - 后端日志无 "校审数据库上下文切换超时" warn
# - SurrealDB 无 "SendError" 错误
```

---

## 7. 关键文件索引

| 文件 | 职责 |
|---|---|
| `plant-model-gen/src/web_api/review_db.rs` | review 专用 SurrealDB 连接管理 |
| `plant-model-gen/src/web_api/review_api.rs:1091-1138` | review API 中间件（db context 切换） |
| `plant-model-gen/src/web_api/review_annotation_state.rs:126-159` | annotation state 中间件 |
| `plant-model-gen/src/web_api/platform_api/mod.rs:36-57` | platform API 中间件 |
| `rs-core/src/rs_surreal/mod.rs:182-` | `use_ns_db_compat` 实现 |
| `plant3d-web/scripts/pms-simulator-runner.ts` | 仿 PMS 场景执行器 |
| `plant3d-web/scripts/pms-simulator-bootstrap.ts` | 测试环境编排 |
