# Implementation Plan: 模型版本时间轴拖拽浏览（model-version-timeline-scrub）

## Overview

按 `plan.md` 的阶段顺序实施：开工前先对齐设计稿与共享样例，阶段 1 在 gen-model `refactor` 做实时历史几何、时间点解析、属性时点与 `/health` 观测，阶段 2 在 plant3d-web 做纯函数、接线与界面，阶段 3 在 rocksdb 档上做联调与性能实测。

验收以 `requirements.md` 为准，模块划分与属性编号以现行 `design.md` 为准（Correctness Properties 1–39）。界面对照 `ui/版本管理/version-timeline.pen` 的六帧：第 1 帧「浏览模式」(IXhiA)、第 2 帧「单钉四态」(mPA9i)、第 3 帧「双钉对比」(bDcot)、第 4 帧「拖动、簇、加载中」(O1am8)、第 5 帧「容器 · 所有子节点」(b6sLdj)、第 6 帧「空范围、缺时间、旧服务端」(lusKv)。刻度排布以需求为准：按会话链等距，不按日历疏密。

后端用 Rust（gen-model、`../vendor/e3d-model`），前端用 TypeScript + Vue 3。后端只改 `refactor`，不合 `publish`、不部署。

## Tasks

### 开工前对齐

- [x] 1. 对齐设计稿与共享样例
  - [x] 1.1 按链序口径更新设计稿 `ui/版本管理/version-timeline.pen`
    - 设计稿任务：用 pen.dev 工具（pencil MCP）修改，不直接读写 .pen 文件
    - 第 1 帧「浏览模式」(IXhiA)：刻度改成按会话链等距排布；去掉日历窗口文案「窗口 09-13 — 09-18」，改成序号窗口（例如「sesno 573 — 630 · 第 41–53 版」）；日期只作轴下的次级标注；补一颗「时间异常」刻度，悬停时同时列出本版与前一个带时间版本的 sesno 与时间
    - 第 4 帧「拖动、簇、加载中」(O1am8)：「全历史」窗口改成等距；点簇说明里的「或只剩 60 秒」改成「或可见范围只剩 5 个刻度」
    - 第 6 帧「空范围、缺时间、旧服务端」(lusKv)：删掉「部分会话缺少时间，按会话序号排布」块及其说明「有时间的表才从左到右按会话时间排」，换成时间异常示例（异常刻度、悬停显示两版的 sesno 与时间、游标标签带「时间异常」），再放一颗缺时间刻度，标注「无时间」；其余块（空范围、只看几何变的为空、本范围无变化、降级横幅、失败刻度与重试、日期错误）保留
    - 第 3 帧「双钉对比」(bDcot)：删掉沿用第 2 帧的角标「浏览 · sesno 626 · 对照 A · sesno 573」，改成对比模式的 A / B 角标（「A · sesno 573」「B · sesno 630」）
    - 六帧图例统一用一套词：采用 `src/components/model-version/nodeVersionPanelFormat.ts` 的 `impactLabel`（与纵向列表徽章同词），第 1 帧的「几何 / 位置 / 交付 / 删除 / 仅属性」与其余帧对齐
    - 第 2、5 帧交互不改
    - _Requirements: 1.2, 1.3, 1.4, 1.7, 1.13, 2.7_

  - [x] 1.2 新建时间点解析共享样例 `docs/fixtures/version-time-resolve-cases.json`
    - 每条 `{ rows: [{ sesno, session_time | null }], at, expect: { sesno, session_time } | { error } }`，`error` 取 `invalid-format` / `before-oldest` / `no-resolvable`
    - 必含：会话 1 的时间晚于其后全部会话（AvevaMarineSample 形态）、中间一段时间倒退、同秒多行、无偏移时间点、全部无时间、t 早于全部带时间行、t 恰等于某行 v 的时间但 sesno 更大的某行时间不晚于 v（往返结果 w ≠ v）
    - plant3d-web 与 gen-model `refactor` 各放一份同名文件，内容逐字节一致
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 8.7, 10.2_

### 阶段 1：gen-model `refactor`（后端）

- [x] 2. e3d-model 停止钩子与共用投影函数
  - [x] 2.1 在 e3d-model 实现 `generate_subtree_with_hooks`
    - 新增 `Stop { Cancelled, LimitExceeded }`、`GenerationHooks::should_stop(visited)`，显式栈 DFS 每次 `stack.pop()` 调一次
    - `generate_subtree_with_cache` 改为以空钩子调用它，行为不变
    - _Requirements: 6.8, 6.9, 6.14_

  - [x] 2.2 为停止钩子写例子测试
    - 空钩子输出与 `generate_subtree_with_cache` 逐项相同；钩子在第 k 个元素返回 `Stop` 时恰访问 k 个元素
    - _Requirements: 6.8, 6.14_

  - [x] 2.3 抽出 `pub(crate) fn project_historical_records`（bake + project）
    - 把 `e3d_model_service.rs` 里私有的 `bake_elements` 与 `project_geometry_delta` 收进这一个函数，产出 `Vec<ProjectedGeometry>`；bake 每处理一个元素前查一次取消标志
    - Legacy `apply_geometry_delta_on(ProjectionScope::Historical(key), …)` 改调它后照常 `commit`，现有 Legacy 测试保持通过
    - _Requirements: 6.12, 6.15_

  - [x] 2.4 核实共享网格目录的并发写是否安全
    - 读 `bake_element` 的网格写入：是否「临时文件 + 原子重命名」，同 `mesh_id` 内容是否相同
    - 不安全时，实时路径对网格写入加按 `mesh_id` 的细粒度锁，仍不拿每库锁；结论写进 `docs/verification/` 的阶段 1 记录
    - _Requirements: 6.12_
    - _结论（2026-10-29）：安全，不加网格锁。`ensure_mesh_file` 走同目录临时文件 + `hard_link` 原子发布（create-if-absent），修复走进程内 `REPAIRS` 互斥 + `rename`；`mesh_id` 是内容寻址，同 id 即同内容。记录：`docs/verification/model-version-timeline-scrub/phase1-mesh-write-safety.md`_

- [x] 3. 配置、历史输入缓存与实时计算源
  - [x] 3.1 新增 `bounded_setting(raw, min, max, default)` 与四项配置
    - `model_history_realtime_concurrency`（1–64，缺省 4）、`model_history_realtime_cache`（0–1024，缺省 32）、`model_history_query_timeout_secs`（1–600，缺省 60）、`model_history_input_max`（0–64，缺省 4），各有 `AIOS_*` 环境变量覆盖
    - 越界值启动时回落缺省并 `log::warn!` 一行
    - _Requirements: 6.9, 7.1, 7.2_

  - [x] 3.2 实现只给历史用的输入缓存 `fast_model/historical_input.rs::HistoricalInputLru`
    - 键 `(dbnum, sesno, identity)`，容量取 `model_history_input_max`（0 = 每次现建），按最近使用淘汰
    - 同键并发构建用 `DashMap<Key, Arc<OnceCell<GenerationInput>>>` 合并成一次；提供条数与容量统计给 `/health`
    - 不替换当前模型用的 `generation_input`
    - _Requirements: 7.5_

  - [x] 3.3 实现 `CancelToken` 与 `E3dModelService::realtime_compute_source`
    - `fast_model/cancel.rs`：`CancelToken(Arc<AtomicBool>)` 与 `CancelOnDrop`（`Drop` 时置位）
    - `realtime_compute_source` 不拿 `db_generation_lock`，输入取自 `HistoricalInputLru`，DFS 走 `generate_subtree_with_hooks`：钩子查取消标志，`visited > MAX_HISTORY_ELEMENTS` 时中途返回 `LimitExceeded`
    - `generate_snapshot_source` 改为调用同一个内部函数（空钩子、原输入缓存、外面套锁），两路求值代码一致
    - 调用方在 `spawn_blocking` 里运行它
    - _Requirements: 6.1, 6.8, 6.9, 6.14, 6.15_

- [ ] 4. 时间点解析（`fast_model/time_resolve.rs`）
  - [x] 4.1 实现 `select_latest_at`、`parse_instant`、`resolve_at_rows`
    - 链序规则：从 sesno 最大的行往前，跳过无时间行，取第一个秒级 Session_Time ≤ t 的行；没有带时间的行为 `NoResolvable`，都晚于 t 为 `BeforeOldest`；无偏移的 t 按链序中第一条带时间行的偏移解释
    - 现有 `select_session_at` 改成 `select_latest_at(&chain.sessions, |s| s.time, at)` 的薄包装，Legacy `generate` 行为不变
    - 先读一遍现有 `select_session_at` 的比较精度与无偏移时间的解释方式；与上面不一致时以现有实现为准，同步改 1.2 的样例
    - _Requirements: 6.3, 8.1, 8.2, 8.3, 8.6_

  - [x] 4.2 写属性测试：时间点解析遵循链序规则（Rust）
    - **Property 29: 时间点解析遵循链序规则，前端、后端与会话链包装一致**
    - `select_latest_at`、`resolve_at_rows`、`select_session_at` 包装三者对暴力参考实现，proptest 100 次
    - **Validates: Requirements 6.3, 8.1, 8.2, 8.3, 8.6, 10.2**

  - [x] 4.3 写属性测试：时间点解析往返（Rust）
    - **Property 31: 时间点解析往返**
    - **Validates: Requirements 8.7**

  - [x] 4.4 写共享样例对拍测试（Rust）
    - 读 `docs/fixtures/version-time-resolve-cases.json`，`resolve_at_rows` 与 `select_session_at` 包装逐条对拍；现有 `select_session_at` 单元测试保持通过
    - _Requirements: 8.1, 8.10, 10.2_

- [ ] 5. 实时查询纯逻辑（`fast_model/realtime_history/` 子模块）
  - [x] 5.1 实现参数校验 `realtime_history/validate.rs`
    - 参数以 `Option<String>` 接收，自己裁决；缺 `dbnum` / `unit_refno` → 400 `INVALID_FIELD`（`detail.field`）；refno 不是两个正整数以 `_` 或 `/` 连接，或 `refno.dbno() != dbnum` → 400 `INVALID_REFNO`
    - `sesno` 与 `time` 恰好一个，`sesno` ∈ [1, 2³¹−1]，`time` 走 `parse_instant`；失败 400 `INVALID_SELECTOR`，`detail.params` 列出无效参数名
    - 按 Requirement 6.16 的优先级只返回最高一条
    - _Requirements: 6.2, 6.6, 6.16_

  - [x] 5.2 写属性测试：请求校验与错误优先级
    - **Property 33: 请求校验与错误优先级（后端）**
    - **Validates: Requirements 6.2, 6.6, 6.16**

  - [x] 5.3 实现单元不存在判定 `realtime_history/absent.rs::classify_absent`
    - 版本表为空 → `REFNO_NOT_IN_CHAIN`（404）；请求会话之前（含）无行 → `UNIT_NOT_PRESENT` + `not-yet`；最后一行是 tombstone → `UNIT_NOT_PRESENT` + `deleted`；非 tombstone 但索引无根 → 500 `GEOMETRY_GENERATION_FAILED`
    - _Requirements: 6.5_

  - [x] 5.4 写属性测试：单元不存在的原因判定
    - **Property 34: 单元不存在的原因判定（后端）**
    - **Validates: Requirements 6.5**

  - [x] 5.5 实现 `realtime_history/digest.rs` 的 `geometry_digest` 与 `source_set_fingerprint`
    - 摘要：每行去 `snapshot_key` 与 `direct_model.sesno`，键按字典序规范化，按 `(kind, source_refno, id)` 排序，逐行 `kind \0 json \n` 喂 SHA-256，取前 16 字节 hex，前缀 `g:`；空单元同算法
    - 指纹：设计库文件 `source_fingerprint` ‖ 当前 MDB 全部 pin（含 CATA）按 `(dbnum, path)` 排序后的 (路径, 长度, mtime)，可按 1 s TTL 记住
    - _Requirements: 6.10, 6.11, 7.4_

  - [x] 5.6 写属性测试：geometryKey 是几何内容摘要
    - **Property 35: geometryKey 是几何内容摘要（后端）**
    - **Validates: Requirements 6.10, 6.11**

  - [x] 5.7 实现结果缓存 `realtime_history/cache.rs::RealtimeResultCache`
    - 键 `(dbnum, unit, sesno, fingerprint)`，存序列化后的响应体字节与头部；容量 0–1024（0 = 停用），满时淘汰最久未使用
    - 只写 200；指纹变化整表清空；命中数 / 未命中数原子计数，只增不减；条目数只算当前指纹
    - _Requirements: 6.17, 7.2, 7.3, 7.4, 7.5_

  - [x] 5.8 写属性测试：结果缓存模型
    - **Property 36: 结果缓存模型（后端）**
    - **Validates: Requirements 6.17, 7.2, 7.3, 7.4, 7.5**

  - [x] 5.9 实现并发闸 `realtime_history/gate.rs::RealtimeGate`
    - `semaphore.clone().try_acquire_owned()`；`in_flight = limit − available_permits()`；`Retry-After = clamp(1 + in_flight / limit, 1, 5)` 秒
    - `OwnedSemaphorePermit` 随计算闭包移进阻塞线程，计算真正停下时释放
    - _Requirements: 6.17, 7.1, 7.5_

- [ ] 6. 路由、属性时点与 `/health`
  - [x] 6.1 实现编排 `realtime_history/mod.rs::query_realtime`
    - 按 design §1.2 的 1–8 步：校验 → 会话解析（`sesno` 查会话链，`time` 用该单元「仅自身」版本表走 `resolve_at_rows`）→ 指纹与缓存（命中不占名额，按 `If-None-Match` 回 304 或 200）→ 并发闸 → `spawn_blocking` 计算 → 超时 504 → 写缓存
    - 计算段：根不在索引走 `classify_absent`；noun 不在 `delivery_unit_types` 复用 Legacy 判定回 422 `NOT_A_DELIVERY_UNIT_ROOT`；`LimitExceeded` 回 413；`project_historical_records` → 按 `record_id` 去重留最后一条 → 按 `(source_refno, record_id)` 排序 → `instance_json` / `tube_json` 去 `snapshot_key` → 摘要 → 拼响应体（含 `stats`）
    - `GeometryFailurePolicy::BestEffort`；计算器放在 trait 后面，便于假计算器注入；不触碰 `HistoricalModelStore`、不建任务
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.7, 6.8, 6.9, 6.10, 6.12, 6.14, 6.17, 7.1, 7.2, 7.3, 7.7, 7.8, 7.9_

  - [x] 6.2 挂路由 `GET /api/v1/model/history/geometry`
    - 在 `web_service/mod.rs` 的 `/api/v1` 表上注册，项目身份沿用 `ProjectReq`（`#[serde(flatten)]`）；`If-None-Match` 去引号、去 `W/` 前缀
    - handler 内建 `CancelToken` 与 `CancelOnDrop`；200 / 304 都带 `ETag: "<geometryKey>"`、`X-Sesno`、`X-Session-Time`（无时间为空串）、`Cache-Control: no-cache`；503 带 `Retry-After`
    - CORS `Access-Control-Expose-Headers` 加 `ETag, X-Sesno, X-Session-Time, Retry-After`；错误体沿用 `ApiError::coded`
    - _Requirements: 6.2, 6.6, 6.14, 7.1, 7.6, 7.7_

  - [x] 6.3 实现 `GET /api/v1/node/versions/resolve`
    - `scope` 只能 `self` / `subtree`、`at` 须合法，否则 400 `INVALID_SELECTOR`；节点不存在 → 404 `NODE_NOT_FOUND`
    - 取 `node_versions(dbnum, refno, scope, …)` 全表，超过 5000 行时按 `since_sesno` 翻页取全，再 `resolve_at_rows`；`NoResolvable` → 422 `NO_RESOLVABLE_SESSION`，`BeforeOldest` → 422 `TIME_BEFORE_OLDEST_SESSION`
    - 用 curl 核对 `unit_versions` 与 `node_versions(scope=self)` 对同一单元根给出相同行集
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.10_

  - [x] 6.4 实现 `GET /api/v1/element/attributes-at`
    - 把 `attributes_at` 的阻塞段抽成 `read_attributes_at(dbnum, source_file, sesno, refno, service)`，不经过快照回执；Legacy `tool=attributes` 改调它，保留 `exists: false` 语义
    - 错误：400 `INVALID_REFNO`、404 `SESSION_NOT_FOUND`、404 `REFNO_NOT_FOUND_AT_SESSION`
    - _Requirements: 6.13_

  - [x] 6.5 在 `/health.model_cache` 增加 `realtime_history`
    - 字段 `cache_entries`、`cache_capacity`、`hits_total`、`misses_total`、`in_flight`、`concurrency_limit`、`input_cache { entries, capacity }`、`timeout_secs`；`historical` 分项不变
    - _Requirements: 6.12, 7.4, 7.5_

  - [x] 6.6 写属性测试：并发闸与无快照副作用
    - **Property 37: 并发闸与无快照副作用（后端，假计算器）**
    - 用 `tokio::time::pause` 与假计算器 trait 驱动
    - **Validates: Requirements 6.12, 6.17, 7.1, 7.5**

  - [x] 6.7 写属性测试：ETag / If-None-Match 一致性
    - **Property 38: ETag / If-None-Match 一致性（后端）**
    - **Validates: Requirements 7.6, 7.7, 7.8, 7.9**

  - [x] 6.8 写属性测试：两条路由的时间解析一致
    - **Property 32: 两条路由的时间解析一致**
    - **Validates: Requirements 8.10**

  - [x] 6.9 写属性测试：非法时间点被拒（Rust）
    - **Property 30: 非法时间点被拒**
    - 覆盖 `parse_instant` 与两条路由的 400 `INVALID_SELECTOR`
    - **Validates: Requirements 6.2, 8.4, 10.2**

  - [x] 6.10 写后端例子测试
    - `SESSION_NOT_FOUND`、`NOT_A_DELIVERY_UNIT_ROOT`、注入小上限触发 413 且无几何、注入 1 s 超时与慢假计算器触发 504 且名额释放、丢弃 handler future 后假计算器在一个检查点内看到取消
    - `attributes-at` 三种错误、resolve 404 `NODE_NOT_FOUND` 与 422 `NO_RESOLVABLE_SESSION`、实时 `time` 选择器 422 `NO_RESOLVABLE_SESSION`、`REFNO_NOT_IN_CHAIN` 404、越界配置回落
    - _Requirements: 6.3, 6.4, 6.5, 6.7, 6.8, 6.9, 6.13, 6.14, 8.5, 8.6_

- [ ] 7. 阶段 1 集成验证脚本（rocksdb 档 8022）
  - [~] 7.1 编写 `scripts/verify/realtime-history-smoke.ps1`
    - 把 design.md「阶段 1 后端集成验证」的 curl 清单落成脚本：版本表计数（版本数 ≥ 25、几何变化 ≥ 5，供 Requirement 12 前提）、实时几何与耗时、缓存命中字节相同（`fc.exe /b`）、304、`time` 选择器与 resolve 的 sesno 一致（含一个时间倒退会话的时间点）、错误码、`--max-time 1` 断开后每 0.5 s 采 `in_flight` 回落、快照数不变、带 `Origin` 时能读到 `Access-Control-Expose-Headers`
    - 输出命令、节点、sesno、返回与通过 / 不通过到 `docs/verification/`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.12, 6.14, 7.3, 7.5, 7.6, 7.7, 8.10_

  - [~] 7.2 编写 `scripts/verify/realtime-vs-legacy.ps1`
    - **Property 39: 实时查询与 Legacy 路径等价（集成）**
    - BRAN `24384_23257` 与另一个 EQUI 单元的每个 sesno：实时路由与 Legacy（generate → 轮询 → query → DELETE）结果去 `snapshot_key`、按 `(source_refno, id)` 排序后比较，记录不一致组合数（期望 0）；Legacy 报错的组合实时也报错（`REFNO_NOT_FOUND_AT_SESSION` 对应 `UNIT_NOT_PRESENT`）；同组合连查两次（未命中 + 命中）逐项相等
    - 6 个并行冷查询：至少一个得到 503 与 `Retry-After`，采样 `/health` 的 `in_flight` 不超过 4
    - 结果写入 `docs/verification/`
    - **Validates: Requirements 6.10, 6.15, 7.1, 7.5**

- [~] 8. Checkpoint：阶段 1 完成
  - `cargo test`（gen-model 与 e3d-model）通过，现有 `select_session_at` 测试保持通过
  - 按 AGENTS.md 起 rocksdb 档：`gen-model/scripts/Start-Surreal8009.ps1` 起 SurrealDB 8009，`AIOS_STORE_MODE=rocksdb` 起 `aios-database.exe`（8022），加 `AIOS_MODEL_GENERATION_INPUT_MAX_DBNUMS=1`、`AIOS_MODEL_ELEMENT_CACHE_MAX_ENTRIES=60000`；不想动真实库就拷一份 `.surreal/ams-8009`。不用 mem 档
  - 7.1 与 7.2 两个脚本通过，记录在 `docs/verification/`
  - 合入 gen-model `refactor`（工作区有未提交改动时用独立 worktree），记录提交 SHA；不合 `publish`、不部署。前端还没接上也能独立合并
  - Ensure all tests pass, ask the user if questions arise.

### 阶段 2：plant3d-web（前端）— 纯函数

- [ ] 9. 依赖、端口类型、刻度排布与格式化
  - [x] 9.1 新增 devDependency `fast-check`
    - `npm install -D fast-check`，同步更新 `package-lock.json`
    - 属性测试文件命名 `*.property.test.ts`，标签 `// Feature: model-version-timeline-scrub, Property N: …`，`{ numRuns: 100 }`
    - _Requirements: 测试基础设施，支撑本表全部前端属性测试，无单独对应条款_

  - [x] 9.2 在 `src/model-source/ports.ts` 定义版本来源扩展类型
    - `HistoryGeometryRequest`、`HistoryGeometryResult`（`ok` / `not-modified`）、`HistoryQueryError`（`code`、`status`、`reason`、`retryAfterMs`）
    - `ModelVersionSource` 增加可选 `queryHistoryGeometry`、`attributesAtSesno`、`resolveNodeTime`、`readRealtimeLimit`；`ModelVersionGeometry` 增加可选 `geometryKey`
    - _Requirements: 3.12, 4.10, 6.13, 8.8, 9.9, 10.1, 10.6_

  - [x] 9.3 实现 `src/utils/versionScrub/tickLayout.ts`
    - `orderVersions`（sesno 升序）、`fullViewport`、`minSpanOf`（min(5, n)）、`layoutTicks`（x 只由序号决定；按序号分桶成簇，`k = ceil(4 / gapPx)`，簇带 `anomaly`）、`timeLabels`（次级时间标注，缺省 80 px 间隔）、`timeAnomalies`、`ghostOrdinal`、`zoomViewport`（跨度钳在 [min(5, n), n]）、`viewportForCluster`、`impactPalette`（五态各一色，`noop` 空心）
    - 无 Vue、无 DOM、无网络
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 1.10, 1.13_

  - [x] 9.4 写属性测试：簇划分是刻度序列的有序切分
    - **Property 1: 簇划分是刻度序列的有序切分**
    - **Validates: Requirements 1.1, 1.7**

  - [x] 9.5 写属性测试：刻度按序号等距排布
    - **Property 2: 刻度按序号等距排布**
    - 同一表生成两套不同的 Session_Time，断言布局相同
    - **Validates: Requirements 1.2**

  - [x] 9.6 写属性测试：时间异常标记
    - **Property 3: 时间异常标记**
    - **Validates: Requirements 1.3, 1.7**

  - [x] 9.7 写属性测试：影响类型配色
    - **Property 4: 影响类型配色**
    - **Validates: Requirements 1.4**

  - [x] 9.8 写属性测试：序号缩放约束
    - **Property 6: 序号缩放约束**
    - **Validates: Requirements 1.8, 1.13**

  - [x] 9.9 实现 `src/utils/versionScrub/scrubFormat.ts`
    - 悬停提示：sesno、Session_Time、保存人、备注、影响类型，缺字段写「—」；异常版本附前一个带时间版本的 sesno 与时间；簇提示写簇内 sesno 最小与最大版本；「所有子节点」范围附「单元 n」（只改属性为 0）
    - 游标标签：sesno + 时间，缺时间写「无时间」，异常写「时间异常」
    - 角标文本 `browseBadgeText`：「浏览 · sesno N · 时间」、单钉「对照 A · sesno M」（第 2 帧）、「正在加载 sesno N」、「该版本没有这个单元」、「该版本单元已删除」、「sesno N 未加载（已取消）」、「最新版本，无历史差异」、子树失败单元数
    - 影响类型文字复用 `nodeVersionPanelFormat.ts` 的 `impactLabel`，图例、悬停与纵向列表同词
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 2.7, 3.2, 3.6, 3.11, 5.4, 9.1, 9.2, 9.6, 9.8_

  - [x] 9.10 写属性测试：提示与游标标签格式化
    - **Property 5: 提示与游标标签格式化**
    - **Validates: Requirements 1.3, 1.5, 2.7**

- [x] 10. 游标、停留门、钉
  - [x] 10.1 实现 `src/utils/versionScrub/cursorNav.ts`
    - `isGeometryChange`（`noop` 与 null 为否）、`navigableTicks`、`snapToPointer`（并列取 sesno 大者，超出两端取首末）、`stepCursor`（端点不动）、`clickTick`（簇取 sesno 最大的可导航版本）、`initialCursor`（sesno 最大）、`coerceCursorForGeometryOnly`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.9, 2.10, 2.11_

  - [x] 10.2 写属性测试：游标不变量
    - **Property 8: 游标不变量**
    - **Validates: Requirements 2.1, 2.4, 2.9, 2.11**

  - [x] 10.3 写属性测试：指针吸附与初始位置
    - **Property 9: 指针吸附与初始位置**
    - **Validates: Requirements 2.2, 2.3**

  - [x] 10.4 写属性测试：链序离散移动
    - **Property 10: 链序离散移动**
    - **Validates: Requirements 2.5, 2.6**

  - [x] 10.5 写属性测试：勾选「只看几何变的」时的游标迁移
    - **Property 11: 勾选「只看几何变的」时的游标迁移**
    - **Validates: Requirements 2.10**

  - [x] 10.6 实现 `src/utils/versionScrub/dwellGate.ts`
    - `createDwellGate({ delayMs, fire, schedule })`：每次吸附到新刻度重启计时，停满才 `fire`；`flush` 立即触发并取消计时；`schedule` 注入
    - 两个实例：150 ms（游标请求）、300 ms（预取）
    - _Requirements: 3.3, 3.4, 4.3_

  - [x] 10.7 写属性测试：拖动停留门
    - **Property 12: 拖动停留门**
    - **Validates: Requirements 3.3**

  - [x] 10.8 实现 `src/utils/versionScrub/pins.ts`
    - `pinSide`（同 sesno 拒绝，返回 `same-version`）、`normalizePins`（A 的 sesno 大于 B 时交换，不看 Session_Time）、`pinsWithPrevious`、`pinsWithLatest`（首末版返回 null）
    - _Requirements: 5.1, 5.2, 5.3, 5.10, 5.11, 5.12_

  - [x] 10.9 写属性测试：钉不变量
    - **Property 21: 钉不变量**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 10.10 写属性测试：与上一版比 / 与最新比
    - **Property 22: 与上一版比 / 与最新比**
    - **Validates: Requirements 5.10, 5.11, 5.12**

- [x] 11. 帧缓存、预取、忙重试
  - [x] 11.1 实现 `src/utils/versionScrub/frameCache.ts`
    - 键 `${dbnum}|${unitRefno}|${sesno}`，缺省上限 12 个键；淘汰顺序：不受保护且不属于当前游标的最久未使用键 → 不受保护的键 → 暂时超限；`trimFrames` 在游标改变后收回到 12
    - 按 `geometryKey` 引用计数共享几何；`putSharedFrame` 供 304 使用；引用归 0 才产出 `free-geometry`；淘汰产出带 `legacySnapshotKey` 的 `evicted`
    - 纯函数只产出副作用清单
    - _Requirements: 4.1, 4.2, 4.7, 4.10, 10.5_

  - [x] 11.2 写属性测试：帧缓存 LRU 与几何共享
    - **Property 16: 帧缓存 LRU 与几何共享**
    - 对比直白的参考 LRU 模型
    - **Validates: Requirements 4.2, 4.7**

  - [x] 11.3 实现 `src/utils/versionScrub/prefetchPlan.ts`
    - `prefetchCandidates`：游标前后各 2 格，同距离先前后后，跳过 cached / inFlight / failed / excluded
    - `planPrefetch`：游标请求进行中为空，否则至多 `2 − activePrefetches` 个
    - `reassignOnCursorMove`：旧游标请求在新游标 ±2 内且预取名额未满时转预取，否则中止；±2 外的进行中预取中止、排队项移出；都不标失败
    - _Requirements: 3.15, 4.3, 4.4, 4.5, 4.8, 4.9, 4.11, 9.4_

  - [x] 11.4 写属性测试：预取计划
    - **Property 18: 预取计划**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.9, 4.11, 9.4**

  - [x] 11.5 写属性测试：游标移动时的请求重分配
    - **Property 19: 游标移动时的请求重分配**
    - **Validates: Requirements 3.15, 3.16, 4.8**

  - [x] 11.6 实现 `src/utils/versionScrub/busyRetry.ts`
    - `retryOnBusy(run, { maxRetries = 3, sleep, signal, shouldRetry, onWait })`：遇 `HISTORY_BUSY` 按 `retryAfterMs` 等待后重发，合计不超过 4 次，用尽后抛出该 `HISTORY_BUSY`；其他错误与成功原样返回；`signal` 触发时以 `AbortError` 结束；`shouldRetry` 返回 false 时停止重发
    - `retryAfterMs`：`Retry-After` 秒钳到 [1, 5] 后乘 1000，缺头按 1 s
    - 游标请求与子树请求共用
    - _Requirements: 3.16, 4.11, 9.10_

  - [x] 11.7 写属性测试：`HISTORY_BUSY` 有界重试（`retryOnBusy` 部分）
    - **Property 15: `HISTORY_BUSY` 有界重试**
    - 文件 `src/utils/versionScrub/busyRetry.property.test.ts`，假时钟注入 `sleep`
    - **Validates: Requirements 3.16, 9.10**

- [x] 12. 时间解析、直达链接、子树计划
  - [x] 12.1 实现 `src/utils/versionScrub/timeResolve.ts`
    - `parseInstant`（语法 `YYYY-MM-DD[T| ]HH:mm[:ss[.fff]][Z|±HH:MM]`，截到秒）、`resolveAt`：与 4.1 同一链序规则；错误 `invalid-format` / `before-oldest` / `no-resolvable`
    - 已加载的带时间行都晚于 t 或都没时间、且还有更早的页时，由调用方先按 `since_sesno` 补齐再解析
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 10.2_

  - [x] 12.2 写属性测试：时间点解析遵循链序规则（前端）
    - **Property 29: 时间点解析遵循链序规则，前端、后端与会话链包装一致**
    - Session_Time 生成单调、会话 1 最晚、随机乱序三种形态
    - **Validates: Requirements 6.3, 8.1, 8.2, 8.3, 8.6, 10.2**

  - [x] 12.3 写属性测试：非法时间点被拒（前端）
    - **Property 30: 非法时间点被拒**
    - **Validates: Requirements 6.2, 8.4, 10.2**

  - [x] 12.4 写属性测试：时间点解析往返（前端）
    - **Property 31: 时间点解析往返**
    - **Validates: Requirements 8.7**

  - [x] 12.5 写共享样例对拍测试 `src/utils/versionScrub/timeResolve.test.ts`
    - 读 `docs/fixtures/version-time-resolve-cases.json`，`resolveAt` 逐条对拍
    - _Requirements: 8.10, 10.2_

  - [x] 12.6 实现 `src/utils/versionScrub/scrubUrl.ts`
    - `writeScrubUrl`：写 `unit_refno`（`/` 规整为 `_`）、`scope`、`cursor`，有钉才写 `compare_a` / `compare_b`，删掉 `compare_autorun`，`gm_backend` 等其余参数原样保留
    - `readScrubUrl`：无 `cursor` 返回 `none`；`cursor` 须为正整数、`scope` 只能 `self` / `subtree`，否则 `invalid` 并指明参数
    - `reconcileScrubState`：cursor 回落到 sesno 不大于它的最后一版，没有则 sesno 最小的一版；钉非整数或不在表中忽略并提示；A = B 只留 A；A 大于 B 时交换
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6, 11.7, 11.8_

  - [x] 12.7 写属性测试：直达链接往返并保留其他参数
    - **Property 26: 直达链接往返并保留其他参数**
    - **Validates: Requirements 11.1, 11.4**

  - [x] 12.8 写属性测试：链接状态校正
    - **Property 27: 链接状态校正**
    - **Validates: Requirements 11.2, 11.3, 11.7, 11.8**

  - [x] 12.9 写属性测试：非法链接参数
    - **Property 28: 非法链接参数**
    - **Validates: Requirements 11.6**

  - [x] 12.10 实现 `src/utils/versionScrub/subtreeFramePlan.ts`
    - `planSubtreeFrames`：游标等于最新版 → `latest`；未缓存单元数超过成本阈值或 20 → `confirm`，`top` 按变化构件数降序、同数 refno 升序取前 20；否则 `load`
    - `runBounded(tasks, limit)`：同时进行（含忙重试等待中）的任务不超过 `limit`
    - _Requirements: 9.2, 9.3, 9.9_

  - [x] 12.11 写属性测试：子树装载计划
    - **Property 24: 子树装载计划**
    - **Validates: Requirements 9.2, 9.3**

  - [x] 12.12 写属性测试：子树请求有界并发
    - **Property 25: 子树请求有界并发**
    - **Validates: Requirements 9.9**

  - [x] 12.13 写属性测试：自比较全为未变
    - **Property 23: 自比较全为未变**
    - 文件 `src/utils/modelUnitVersionCompare.property.test.ts`，对现有 `compareModelUnitGeometry(x, x)`
    - **Validates: Requirements 5.4**

- [x] 13. Checkpoint：纯函数完成
  - `npx vitest run src/utils/versionScrub src/utils/modelUnitVersionCompare.property.test.ts` 通过，共享样例对拍通过
  - Ensure all tests pass, ask the user if questions arise.

### 阶段 2：plant3d-web（前端）— 接线

- [ ] 14. 版本来源、组合式函数与三维浏览接口
  - [x] 14.1 在 `versionSource.ts` / `genModelV1Api.ts` 实现三条新路由的客户端
    - `queryHistoryGeometry`：`If-None-Match: "<geometryKey>"`；超时用 `setTimeout` + `AbortController`（缺省 60 s，抛 `CLIENT_TIMEOUT`，界面显示「查询超时」）；304 从 `ETag` / `X-Sesno` / `X-Session-Time` 取值；200 的 `instances` / `tubes` 复用 `loadVersion` 现有映射，拆成共享函数 `mapHistoryRows`
    - `attributesAtSesno`、`resolveNodeTime`、`readRealtimeLimit`（读 `/health.model_cache.realtime_history.concurrency_limit`）
    - 只有「404 / 405 且响应体不是带 `error.code` 的 JSON」抛 `ModelVersionRouteUnavailableError`；带码 404 是业务错误；网络失败抛 `HistoryQueryError('NETWORK')`；主动中止抛 `AbortError`
    - _Requirements: 3.10, 3.12, 4.10, 6.13, 8.8, 9.9, 10.1, 10.6_

  - [x] 14.2 为 `versionSource` 写例子测试
    - 200 / 304 / 带错误码的 404 / 无码 404 / 405 / 503 / 网络错误 / 客户端超时各一例，核对结果类型与是否抛 `ModelVersionRouteUnavailableError`
    - _Requirements: 10.1, 10.6_

  - [x] 14.3 在 `useNodeVersionTimeline.ts` 增加 `setPins(pins)`
    - 直接写 `beforeSesno` / `afterSesno` 两端，允许一端为 null，同样走 `beforePairChange`；`pairReady` 不变，只有一钉时「对比 A / B」禁用
    - _Requirements: 5.1, 5.5, 5.9_

  - [x] 14.4 实现 `src/composables/useVersionScrubber.ts`
    - 吃 `useNodeVersionTimeline` 的 `rows`，不另取版本表；刻度与列表表头「本范围 n 版」同口径（排除 `attributeOnly` 与 `inScope === false` 的行）；`user` → 保存人、`comment` → 备注、`timelineRowImpact` → 影响类型、`unitsChanged` → 单元数
    - 范围切换保留游标与钉，视口重置为全量；不在新表的游标 / 钉按 `ghostOrdinal` 出灰标「本范围无变化」
    - 首次显示游标放 `initialCursor`；`zoom` 先把指针 x 反算成序号；`clickCluster` 缩放并把游标放簇内 sesno 最大的可导航版本
    - `resolveDate`：`parseInstant` 先拦格式；再调 `resolveNodeTime`；收到 `ModelVersionRouteUnavailableError` 后本面板会话改用 `resolveAt`；失败时游标不动、输入框文本保留、显示原因（格式无效 / 早于最早版本 / 节点不存在 / 没有可解析的版本）
    - 钉通过 `setPins` 写回；`onCursorChange(cb)` 带触发方式 `drag | release | click | key | resolve | url`
    - _Requirements: 1.8, 1.9, 1.10, 1.13, 2.2, 2.6, 2.8, 5.1, 5.2, 5.9, 8.8, 8.9, 10.2_

  - [x] 14.5 写属性测试：切换范围保留游标与钉，灰标位置正确
    - **Property 7: 切换范围保留游标与钉，灰标位置正确**
    - **Validates: Requirements 1.9, 1.10**

  - [x] 14.6 在 `src/viewer/modelUnitCompareController.ts` 增加浏览接口
    - `browseEnter` / `browseShow` / `browsePending` / `browseMissing` / `browseBadge` / `replaceSide` / `browseExit`；复用 A 侧隔离图层
    - `browseEnter` 只隐藏环境中这些单元；`browseShow` 按单元比 `geometryKey`，相同只改角标；进入后第一帧 `fitToBox`，之后不动相机；`focusRefno` 时只高亮该构件
    - `browseMissing` 清图层且环境同单元保持隐藏；`browseExit` 卸图层、恢复环境、清角标与属性横幅；角标文本来自 `browseBadgeText`
    - _Requirements: 3.1, 3.2, 3.8, 3.9, 3.11, 3.14, 5.8, 9.5_

  - [x] 14.7 写属性测试：相同 geometryKey 不重装
    - **Property 14: 相同 geometryKey 不重装**
    - 文件 `src/viewer/modelUnitCompareBrowse.property.test.ts`，mock DTX 层，只计装载调用
    - **Validates: Requirements 3.8**

  - [x] 14.8 为浏览接口写例子测试（`modelUnitCompareController.test.ts` 追加）
    - 进入浏览只隐藏该单元、首帧 fit 之后不动相机、退出恢复、`replaceSide` 不重建另一侧、叶子只高亮自身
    - _Requirements: 3.1, 3.9, 3.14, 5.8, 9.5_

  - [~] 14.9 实现 `src/composables/useVersionFrames.ts` 的浏览主流程（实时路由）
    - 请求表 `Map<FrameKey, { controller, role, promise }>`，同键只一个请求；游标落到正在预取的键上改角色为 `cursor`
    - 游标移动：先 `reassignOnCursorMove`；拖动经 150 ms 门，松开 / 点击 / 方向键立即请求；300 ms 停留后 `planPrefetch`；游标请求结束后再计划一次
    - 只写缓存，完成时 sesno 仍是当前游标才 `browseShow`；进行中 `browsePending`；视口已装入同单元时带 `If-None-Match`，304 → `putSharedFrame`
    - 游标请求经 `retryOnBusy`，`onWait` 保持「正在加载」，`shouldRetry` 只在角色仍为 `cursor` 时重发；每次 HTTP 单独计 60 s
    - 失败与超时标刻度失败、追加 `errors`、视口不动，`retry` 清标重发；预取失败标失败并进 `failed`；预取忙不标失败；`UNIT_NOT_PRESENT` 缓存为空帧，装入时 `browseMissing`
    - `exitBrowse`：中止全部请求与重试等待，`clearFrames`，执行副作用
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.11, 3.12, 3.13, 3.15, 3.16, 4.1, 4.3, 4.4, 4.5, 4.6, 4.8, 4.9, 4.10, 4.11_

  - [~] 14.10 在 `useVersionFrames.ts` 实现单钉着色、对比模式与子树浏览
    - 只有一个钉：`compareModelUnitGeometry(pinFrame, cursorFrame)` 算四态交给 `browseShow(frame, { diffRows })`；钉所在帧受缓存保护，缺失时按游标规则请求
    - `enterCompare`：缓存里有的 A / B 帧直接用，只请求缺失侧，`buildModelUnitCompareView` 拼 detail 调 `controller.open`；拖钉只 `replaceSide`；一侧失败时钉不变、另一侧不变、显示错误
    - 子树：游标变化 → `diffSummary(cursor, latest)` → `planSubtreeFrames`；`load` 用 `runBounded`（上限取 `readRealtimeLimit`，未取得按 4，每个任务包 `retryOnBusy`）；`confirm` 置 `pendingConfirm`，`answerConfirm('cancel')` 不发请求；差异摘要失败不发几何请求；部分失败成功单元照常显示、失败单元保持当前几何并列出
    - 子树预取只针对需装单元 ≤ 5 的相邻版本（`excluded`）
    - _Requirements: 5.4, 5.6, 5.7, 5.8, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [~] 14.11 在 `useVersionFrames.ts` 实现旧服务端降级
    - `queryHistoryGeometry` 抛 `ModelVersionRouteUnavailableError` → `legacyFallback = true`，本面板会话改走 `loadVersion`（超时 300 s），帧带 `legacySnapshotKey`；停留门与预取规则不变，预取 generate 任务不超过 2 个
    - 淘汰 / 退出时 `release(snapshotKey)` 删除本会话创建且已移出缓存的键，失败或 10 s 未返回只 `console.warn`
    - 404 / 405 以外的错误与网络错误不降级，下次照常请求新路由；`gm_backend` 改变或面板关闭时复位
    - 降级时属性点选退回现有 `attributesAt(snapshot)`
    - _Requirements: 3.10, 10.1, 10.4, 10.5, 10.6_

  - [~] 14.12 写属性测试：装载一致性
    - **Property 13: 装载一致性**
    - 文件 `src/composables/useVersionFrames.property.test.ts`，mock 来源与控制器，可控 Promise
    - **Validates: Requirements 3.2, 3.5, 3.6, 3.7, 4.1, 10.4**

  - [~] 14.13 写属性测试：304 复用已装入几何
    - **Property 17: 304 复用已装入几何**
    - **Validates: Requirements 4.10**

  - [~] 14.14 写属性测试：退出浏览的资源清理
    - **Property 20: 退出浏览的资源清理**
    - **Validates: Requirements 4.6, 10.5**

  - [~] 14.15 写属性测试：`HISTORY_BUSY` 有界重试（`useVersionFrames` 部分）
    - **Property 15: `HISTORY_BUSY` 有界重试**
    - 追加到 `busyRetry.property.test.ts`：游标请求忙等待期间角标始终为「正在加载 sesno <游标>」，只有重试用尽才标失败
    - **Validates: Requirements 3.16, 9.10**

  - [~] 14.16 为 `useVersionFrames` 写例子测试
    - 方向键 / 点击 / 松开立即请求、失败与超时标记与重试、游标请求忙重试 3 次后成功 / 用尽标失败 / 等待中游标移走、`UNIT_NOT_PRESENT` 两种原因、对比只请求缺失侧、一侧失败、子树确认三选项与取消、差异摘要失败、部分失败、降级与非 404 不降级
    - _Requirements: 3.4, 3.11, 3.12, 3.13, 3.16, 5.6, 5.7, 9.3, 9.6, 9.7, 9.8, 10.1, 10.6_

### 阶段 2：plant3d-web（前端）— 界面

- [ ] 15. 时间轴组件与面板接线
  - [~] 15.1 实现 `src/components/model-version/VersionTimelineScrubber.vue`
    - 版式对照第 1 帧 (IXhiA) 与第 4 帧 (O1am8)，按 1.1 更新后的等距链序：轴标题「版本时间轴 · 本范围 n 版」、序号窗口文案、SVG 等距刻度、次级时间标注、图例、簇刻度（带数量）、Time_Anomaly_Marker、游标与标签、A / B 钉标记（第 2、3 帧）、加载 / 失败标记、悬停提示
    - 空态与异常态对照第 6 帧 (lusKv)：「该范围没有版本记录」、「当前范围没有可浏览的版本」、灰标「本范围无变化」、版本表错误码 + 消息 +「重试」、失败刻度「sesno N · 查询超时」+「重试」、日期框「跳到某一时刻，回车定位」与错误「时间格式无效」等
    - 按钮：浏览 / 退出浏览 / 钉为 A / 钉为 B / 对比 A / B / 与上一版比 / 与最新比 / 清除钉 / 复制链接 / 只看几何变的；禁用态按 Requirement 5.5、5.12；钉同一版本时提示「A 与 B 不能是同一版本」
    - `tabindex=0` 接左右键；拖动用 `pointerdown` + `setPointerCapture`，区域外松开也收到 `pointerup`；指针事件按 `requestAnimationFrame` 合帧，每帧最多吸附一次；游标只改 `transform`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 1.11, 1.12, 1.13, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 2.11, 3.12, 3.13, 5.1, 5.3, 5.5, 5.12, 8.8, 8.9_

  - [~] 15.2 为 `VersionTimelineScrubber` 写例子测试
    - 空表提示、版本表错误与重试、时间异常渲染与悬停内容、「无时间」与次级时间标注、图例、区域外松开、日期回车与各错误文案、按钮禁用态、剪贴板失败文本框
    - _Requirements: 1.2, 1.3, 1.4, 1.11, 1.12, 2.4, 5.5, 5.12, 8.8, 8.9, 11.5_

  - [~] 15.3 让 `NodeVersionTimeline.vue` 跟随游标高亮
    - 接受 `highlightSesno`，高亮并 `scrollIntoView({ block: 'nearest' })`；行在折叠段里先展开，必要时「加载更早」直到含该行（第 1 帧「版本列表 · 与游标同步」）
    - _Requirements: 2.8_

  - [~] 15.4 在 `ModelUnitVersionComparePanel.vue` 接入浏览、钉与对比
    - 时间线上方挂 `VersionTimelineScrubber`，纵向列表保留；「浏览」进入 / 退出，卸载时调 `exitBrowse`
    - 视口角标对照第 1 帧（「浏览 · sesno 630 · 2026/09/18 19:50」、「环境 · 最新模型」、「仅自身：只高亮本构件」）、第 2 帧（单钉四态与四态图例）、第 3 帧（双钉「对比中」，A / B 分屏同相机）
    - 点隔离图层构件 → `attributesAtSesno` 取属性，横幅「属性来自 sesno N」，游标变化重取
    - 任一钉改变且两钉都在时刷新「属性对比」「差异摘要」两个 tab；「清除钉」回到不着色的浏览
    - _Requirements: 3.1, 3.2, 3.10, 3.14, 5.4, 5.6, 5.8, 5.9, 5.13, 9.5_

  - [~] 15.5 在面板中接入「所有子节点」范围的浏览（第 5 帧 b6sLdj）
    - 轴标题「版本时间轴 · 子树 n 版」，游标标签与悬停带「单元 n」（只改属性为 0）
    - 确认对话框「要加载 N 个单元」，选项「全部加载 / 先装变化最大的 20 个 / 取消」；等待时角标「浏览 · sesno N · 等待确认」，取消后「sesno N 未加载（已取消）」
    - 差异摘要错误与部分失败单元列表（refno + 错误码 + 消息）
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.7, 9.8_

  - [~] 15.6 在面板中接入降级与错误显示（第 6 帧 lusKv）
    - `model/versions` 404 / 405 时沿用「服务端还没有 model/versions」，不渲染时间轴、不给「浏览」入口
    - 实时路由缺失时底部持续显示「服务端没有实时历史查询，改用逐版生成」；其它 HTTP 错误显示错误码与消息，网络错误显示「无法连接服务端」
    - 游标请求失败的错误码与消息列在面板中，`REFNO_NOT_IN_CHAIN` 等按通用错误显示
    - _Requirements: 1.12, 3.12, 10.1, 10.3, 10.6_

  - [~] 15.7 接入直达链接与「复制链接」
    - 「复制链接」用 `writeScrubUrl` 写剪贴板，成功提示「链接已复制」；失败时显示可全选的 URL 文本框与「复制失败，请手动复制」
    - URL 带 `cursor` 时按序：打开 `unit_refno` 节点 → 切 `scope`（未带时用缺省范围）→ `reconcileScrubState` 放游标、恢复钉 → 进入浏览；非法 `scope` / `cursor` 不进浏览并指明参数，能打开节点时游标放最新版；钉无效只忽略该钉并提示
    - 入口接在 `src/utils/modelUnitVersionCompare.ts` 现有 URL 解析处；不带 `cursor` 时走现有 `compare_a` / `compare_b` / `compare_autorun` 逻辑，现有用例保持通过
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6, 11.7, 11.8_

  - [~] 15.8 为面板写例子测试（`ModelUnitVersionComparePanel.test.ts` 追加）
    - 游标高亮纵向列表行并展开折叠段、属性横幅随游标更新、钉变化刷新两个 tab、清除钉、子树 Changed_Unit 提示、`model/versions` 缺失隐藏时间轴、URL 带 `cursor` 的恢复顺序；现有 `compare_a` / `compare_b` / `compare_autorun` 用例保持通过
    - _Requirements: 2.8, 3.10, 5.9, 5.13, 9.1, 10.3, 11.2_

- [~] 16. Checkpoint：阶段 2 完成
  - `npm run type-check` 不新增基线外错误（不得为放行新错误改基线），`npm run lint` 与 `npm test` 通过
  - 本特性不改 `ReviewPanel.vue` / `DesignerCommentHandlingPanel.vue`，不跑审核面板那五套回归；若实施中改到这两个文件，按 AGENTS.md 跑五套并记录 baseline / after 差量
  - Ensure all tests pass, ask the user if questions arise.

### 阶段 3：联调与性能

- [ ] 17. 性能测量脚本
  - [~] 17.1 加性能测量埋点
    - 在 `modelUnitCompareController` 首帧渲染完成且角标更新后打 `performance.mark('version-scrub:frame-shown', { detail: { sesno } })`，角标更新单独打一个 mark；在 `useVersionFrames` 暴露只读的调试读数（前端缓存键数、进行中请求数），供脚本读取
    - 埋点不改变行为，生产构建可保留
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6, 12.7_

  - [~] 17.2 编写 `e2e/version-scrub-perf.spec.ts`（只手动跑，不进 CI）
    - 用环境变量守卫（未设置时 `test.skip`），默认 `npm run test:e2e` 不执行它；前端以 `gm_backend` 指向 8022
    - 先核对被测 BRAN `24384_23257` 版本数 ≥ 25、几何变化 ≥ 5，不满足时记录实际数并换 BRAN 写明
    - 覆盖：缓存已有前后各 2 版时方向键 20 次每次 ≤ 300 ms；服务端缓存热、前端缓存空时 10 次每次 ≤ 500 ms；服务端缓存容量 0（`AIOS_MODEL_HISTORY_REALTIME_CACHE=0` 重启）时 10 次每次 ≤ 2 s；「仅属性」会话收到 304 且角标 200 ms 内更新，10 次；3–5 s 拖过 30 个刻度，每个 1 s 窗口 ≥ 30 fps、吸附后 100 ms 内更新标签；连续 10 分钟每 60 s 采样前端缓存键数 ≤ 12、`in_flight` ≤ 上限、结果缓存 ≤ 容量、历史快照数等于初值，退出后 1 s 内前端进行中请求为 0、5 s 内 `in_flight` 回到初值；500 行版本表首次渲染 ≤ 500 ms
    - 每条输出命令、节点、sesno 序列、每次耗时（或采样值）与通过 / 不通过，写入 `docs/verification/`
    - _Requirements: 1.6, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

- [~] 18. Final checkpoint：阶段 3 实测
  - 后端按 8 的方式起 rocksdb 档 8022（不用 mem 档）；前端开发服务器由用户手动启动（`npm run dev`）或用 Playwright 默认 webServer（3101）
  - 手动运行 `e2e/version-scrub-perf.spec.ts`，七项指标的记录写入 `docs/verification/`；500 ms / 2 s 目标若首次实测需要调整，在记录里注明理由
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 属性测试与例子测试子任务可延后以先出 MVP；4.4、12.5、7.1、7.2 不可延后（共享样例对拍是前端、后端、Legacy 三处时间解析规则一致的守护，7.1、7.2 是阶段 1 的完成标志）
- 属性测试：前端 fast-check、后端 proptest，各至少 100 次，标签 `// Feature: model-version-timeline-scrub, Property N: …`；时序相关属性用注入的 `schedule` / 假时钟 / 可控 Promise（后端 `tokio::time::pause` 与假计算器）
- 阶段 2 的纯函数与组件可以在阶段 1 路由未就绪时先写、先测；接真实路由与浏览联调在阶段 1 于 8022 可用之后
- 联调一律 rocksdb 档，不开 mem 档（AGENTS.md）
- 以下几处为本任务表的实施假设：
  - `scripts/verify/` 两个脚本放在 plant3d-web（只调 HTTP，不依赖后端源码），记录写 plant3d-web `docs/verification/`
  - 共享样例在两个仓各放一份，内容逐字节一致，任一方修改须同步另一方
  - 图例词表采用现有 `impactLabel`（与纵向列表徽章一致）；若要换成中文词，只改 `impactLabel` 一处，列表随之变化
  - `fast_model/realtime_history/` 拆成 `validate.rs`、`absent.rs`、`digest.rs`、`cache.rs`、`gate.rs` 与 `mod.rs`，便于分开实现与测试
- 不做（沿用 `plan.md`）：
  - 不把整个库拨回某一天，也不同时看三版以上
  - 不改 Legacy 路径的快照淘汰策略；降级只是调用它，然后删掉本会话创建的键
  - 不实现已废弃的 `specs/004-model-version-timeline/`
  - 不把性能脚本放进 CI
  - 后端验证通过后只合入 gen-model `refactor`，不在本计划里部署

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.3", "3.1", "3.2", "5.1", "5.3", "5.5", "5.7", "5.9", "9.1", "9.2", "9.3", "10.6", "10.8", "11.1", "11.3", "12.10"] },
    { "id": 1, "tasks": ["2.2", "2.4", "4.1", "5.2", "5.4", "5.6", "5.8", "9.4", "9.9", "10.1", "10.7", "10.9", "11.2", "11.4", "11.6", "12.1", "12.6", "12.11", "12.13", "14.1", "14.3"] },
    { "id": 2, "tasks": ["3.3", "4.2", "9.5", "9.10", "10.2", "10.10", "11.5", "11.7", "12.2", "12.5", "12.7", "12.12", "14.2", "14.4", "14.6", "15.3"] },
    { "id": 3, "tasks": ["4.3", "6.1", "9.6", "10.3", "12.3", "12.8", "14.5", "14.7", "14.9", "15.1"] },
    { "id": 4, "tasks": ["4.4", "6.2", "6.6", "9.7", "10.4", "12.4", "12.9", "14.8", "14.10", "14.15", "15.2"] },
    { "id": 5, "tasks": ["6.3", "9.8", "10.5", "14.11"] },
    { "id": 6, "tasks": ["6.4", "6.8", "14.12", "14.16", "15.4"] },
    { "id": 7, "tasks": ["6.5", "14.13", "15.5"] },
    { "id": 8, "tasks": ["6.7", "7.1", "7.2", "14.14", "15.6"] },
    { "id": 9, "tasks": ["6.9", "15.7"] },
    { "id": 10, "tasks": ["6.10", "15.8", "17.1"] },
    { "id": 11, "tasks": ["17.2"] }
  ]
}
```
