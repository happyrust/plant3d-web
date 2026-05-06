# 三维校审流程修复后续方案

> 日期：2026-05-07  
> 前置：return/stop 场景修复已完成，5/5 场景全 PASS  
> 状态：待评审

---

## 1. 当前成果

| 维度 | 结果 |
|---|---|
| 场景通过率 | 5/5（approved/return/stop/gate-block/gate-return） |
| 契约烟测 | 7/7 PASS |
| 总耗时 | 35.7s（5 场景串行） |
| 前端修复 | 7 项（plant3d-web） |
| 后端修复 | 3 项（plant-model-gen） |
| 后端日志 | 无"校审数据库上下文切换超时" |

---

## 2. 待提交变更清单

### 2.1 plant3d-web（前端）

| 文件 | 修改内容 |
|---|---|
| `scripts/pms-plant3d-initiate-flow.ts` | `InitiateReviewResult` 类型 + 函数返回值修复 |
| `scripts/pms-chrome-devtools-flow.ts` | CDP 流适配新返回类型 |
| `scripts/pms-simulator-runner.ts` | postJson/getJson 超时 30s + confirmWorkflowDialog fire-and-forget |
| `scripts/pms-simulator-bootstrap.ts` | FETCH_TIMEOUT_MS 30s + 重试 3s + ensureBackendBinary .exe |
| `src/api/reviewApi.ts` | reviewTaskCreate 超时 30s（之前已改） |
| `docs/plans/2026-05-07-return-stop-scenario-fix-plan.md` | 方案文档（新增） |

### 2.2 plant-model-gen（后端）

| 文件 | 修改内容 |
|---|---|
| `src/web_api/review_db.rs` | AtomicBool 缓存 + reset 函数 |
| `src/web_api/review_api.rs` | 中间件精简，移除 SUL_DB 冗余切换 |
| `src/web_api/review_annotation_state.rs` | 中间件精简对齐 |
| `src/web_api/platform_api/mod.rs` | 中间件精简对齐 |

---

## 3. 推荐下一步（优先级排序）

### P0：提交变更 + 补跑剩余场景

**目标**：锁定修复，确认 restore + bran-mixed 场景也通过

**步骤**：
1. 分别在 plant3d-web 和 plant-model-gen 仓库提交修复
2. 运行 `PMS_SIMULATOR_CASE=restore,bran-mixed` 验证剩余 2 个场景
3. 运行全量 `PMS_SIMULATOR_CASE=all`（7 场景串行）做最终回归

**commit 建议**：
- plant-model-gen: `fix(review): 消除 SurrealDB 冗余 USE NS DB 切换，解决多角色并发时 context 超时`
- plant3d-web: `fix(simulator): 修复 initiate 返回类型 + 超时容忍度 + confirmWorkflowDialog 阻塞`

---

### P1：SurrealDB WS SendError 调查

**背景**：测试期间仍有 `surrealdb::engine::remote::ws: Failed to send query results to channel: SendError(..)` 错误，发生在 get_pe 大量查询时。当前不影响功能，但可能是潜在性能瓶颈。

**调查方向**：
1. SUL_DB（主连接）的 `with_capacity(1000)` 是否足够应对并发模型查询
2. get_pe 查询是否可以批量化（目前逐条 refno 查询）
3. 考虑是否需要为 review 模块使用独立的 SurrealDB 连接池

**文件**：
- `rs-core/src/rs_surreal/mod.rs` — `connect_surreal` 容量配置
- `rs-core/src/query_provider/surreal_provider.rs` — get_pe 查询实现

---

### P2：仿 PMS iframe 真实建单验证

**背景**：当前 5 场景使用 seed 模式（`PMS_SIMULATOR_SEED_REVIEW_TASK=1`），跳过了真实 iframe 建单流程。之前 approved 主链已在真实 iframe 模式下通过，但 return/stop 的 iframe 建单需要单独验证。

**步骤**：
1. 移除 `PMS_SIMULATOR_SEED_REVIEW_TASK` 环境变量
2. 运行 `PMS_SIMULATOR_CASE=return,stop` 验证 iframe 建单 + 驳回/终止流程
3. 关注 `runSubmitReviewAcrossContext` 新返回类型在 iframe 模式下的正确性

---

### P3：部署到测试服务器

**背景**：本地验证通过后，需要部署到 123.57.182.243 做远程验证。

**步骤**：
1. 编译 release 后端：`cargo build --bin web_server --features web_server --release`
2. scp 二进制到服务器
3. 前端 `npm run build` → 部署 dist/ 到 nginx
4. 在服务器上运行仿 PMS 模拟器验证

---

### P4：长期改进 — SurrealDB 连接管理

**当前问题**：
- `REVIEW_PRIMARY_DB` 是独立的 WS 连接（`Surreal<Client>`），与 `SUL_DB`（`Surreal<Any>`）共用同一个 SurrealDB 实例
- 两条连接在高负载时仍可能在 SurrealDB 服务端竞争
- `AtomicBool` 方案消除了客户端冗余调用，但服务端瓶颈仍在

**长期方案**：
1. 评估 `REVIEW_PRIMARY_DB` 是否可以复用 `SUL_DB`（避免额外 WS 连接）
2. 或者为 review 模块使用 SurrealDB 连接池（多个连接负载均衡）
3. 考虑将 get_pe 查询迁移到只读副本

---

## 4. 风险与注意事项

| 风险 | 缓解 |
|---|---|
| `reset_review_db_context_flag` 未在热加载时调用 | 当前 DbOption 热加载路径需要确认是否触发此函数 |
| `confirmWorkflowDialog` fire-and-forget 可能丢失错误 | `waitFor` 轮询会检测 `lastOk === false` 的情况，错误仍会被捕获 |
| seed 模式与 iframe 模式的行为差异 | P2 中需要验证 iframe 模式 |
