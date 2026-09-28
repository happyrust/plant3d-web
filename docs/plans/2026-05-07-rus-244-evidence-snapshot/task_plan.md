# 任务计划：RUS-244 PMS 编校审被驳回单据批注/测量证据丢失修复

> Linear: [RUS-244 PMS 编校审-设计人员打开被驳回单据时批注处理与校审面板均空，看不到校核侧批注/测量证据](https://linear.app/rustdpc/issue/RUS-244)

## 当前阶段

Phase 0 — 计划制定 + 仿 PMS 基线复现（待用户审核后切到 Phase 1 落代码）

## 目标

在 PMS 编校审主路径（PMS 平台按钮 → `POST /api/platform/workflow/sync`）下，把校核侧（JH/SH/PZ）在 plant3d-web 内的批注 / 测量证据**与工作流推进同步落库**，使设计人员（SJ）打开被驳回单据时能看到完整的批注列表、测量证据、评审状态。

不再依赖 plant3d-web 的「保存新增证据」按钮人工触发，证据落库与节点推进由后端原子完成。

## 根因（已对照代码确认）

- 写入路径：`POST /api/review/records` → `create_record`（`src/web_api/review_api.rs` L2129-L2412） → `sync_annotation_states_from_snapshot`，**只在前端「保存新增证据」按钮被点击时触发**。
- 推进路径：`POST /api/platform/workflow/sync` → `apply_workflow_active / agree / return / stop`（`src/web_api/platform_api/workflow_sync.rs` L1276 起），**只 UPDATE `review_tasks` + 同步 `review_forms` + CREATE `review_workflow_history`**，从未触碰 `review_records` / `review_annotation_states`。
- PMS 编校审主流程是 PMS 平台直发 `workflow/sync`，绕过 plant3d-web 前端的「保存新增证据」按钮 → 两张表为空 → SJ 打开被驳回单据时 `loadConfirmedRecords` 返空 → `confirmedRecordsRestorer` 不回放 → toolStore 空 → `DesignerCommentHandlingPanel.scopedAnnotationItems` 空。

`task_id` 在工作流流转中**从未变化**（所有 workflow 动作都是 `WHERE record::id(id) = $task_id` 同行 UPDATE，详见 `apply_workflow_*` 内的 SQL），故"task_id 切片导致查不到"这条线已被排除。

## 方案 B：`workflow_sync` 携带 evidence snapshot 同步落库

### B.1 API 契约扩展（向后兼容）

`SyncWorkflowRequest`（`src/web_api/platform_api/types.rs`）新增可选字段 `evidence_snapshot`。

```rust
pub struct SyncWorkflowRequest {
    /* 既有字段 */
    #[serde(default, alias = "evidenceSnapshot")]
    pub evidence_snapshot: Option<EvidenceSnapshotPayload>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EvidenceSnapshotPayload {
    #[serde(default)]                                pub annotations:       Vec<serde_json::Value>,
    #[serde(default, alias = "cloudAnnotations")]    pub cloud_annotations: Vec<serde_json::Value>,
    #[serde(default, alias = "rectAnnotations")]     pub rect_annotations:  Vec<serde_json::Value>,
    #[serde(default, alias = "obbAnnotations")]      pub obb_annotations:   Vec<serde_json::Value>,
    #[serde(default)]                                pub measurements:      Vec<serde_json::Value>,
    #[serde(default)]                                pub note:              Option<String>,
}
```

未传 `evidence_snapshot` 时行为与今天完全一致；老 PMS 不需要改动即可继续工作（但仍会复现 RUS-244，需走 B.5 的兜底）。

### B.2 抽公共落库函数 `persist_evidence_snapshot`

把 `create_record` 写库主体（slot_key 计算、snapshot_hash、UPSERT、`sync_annotation_states_from_snapshot` 调用）抽成共享函数：

```rust
pub(crate) enum EvidencePersistMode { OwnerChecked, Trusted }

pub(crate) async fn persist_evidence_snapshot(
    form_id: &str,
    task_id: &str,
    current_node: &str,
    operator_id: &str,
    operator_name: &str,
    operator_role: &str,
    payload: &EvidenceSnapshotPayload,
    mode: EvidencePersistMode,
) -> Result<ConfirmedRecordWithMeta, EvidencePersistError>;
```

- `OwnerChecked`：既有 `create_record` 调用，保留 owner 检查（前端调用方场景）。
- `Trusted`：`workflow_sync` 调用方使用。`workflow_sync` 在 precheck 阶段已校验 actor/owner 一致性（见 RUS-241 修复结论），不再重复 owner 检查。

slot_key、snapshot_hash、`sync_annotation_states_from_snapshot` 全部复用既有逻辑，避免代码分叉。

### B.3 接入 `apply_workflow_agree` / `apply_workflow_return`

```rust
async fn apply_workflow_agree(/*...*/) -> Result<Option<String>, WorkflowSyncActionError> {
    let task = &precheck.task;
    let current_node = precheck.current_node.clone();

    if let Some(snapshot) = request.evidence_snapshot.as_ref() {
        let actor = request.actor();
        persist_evidence_snapshot(
            &request.form_id, &task.id, &current_node,
            actor.id.trim(), actor.name.trim(),
            actor.role.as_deref().unwrap_or(""),
            snapshot, EvidencePersistMode::Trusted,
        ).await.map_err(|e| WorkflowSyncActionError::plain(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("写入评审证据失败: {e}"),
        ))?;
    }

    /* 既有 UPDATE review_tasks / sync_review_form / CREATE workflow_history 不动 */
}
```

`apply_workflow_return` 同形。`apply_workflow_active` 不接（SJ 是发起方，没有"校核侧证据"语义）。`apply_workflow_stop` 不接（终止不需要保留证据）。

**写入顺序：先 evidence → 再 UPDATE review_tasks**。理由：snapshot 落库失败必须阻断 workflow 推进，否则会出现"任务已流转 / 证据丢失"的不一致。

### B.4 PMS ↔ plant3d-web postMessage 桥协议

PMS 平台不持有 toolStore 状态，需要通过 iframe 向 plant3d-web 取 snapshot：

```
PMS → plant3d-web : { type: 'plant3d.evidence_snapshot.request', requestId, formId }
plant3d-web → PMS : { type: 'plant3d.evidence_snapshot.response', requestId,
                       snapshot: { annotations, cloudAnnotations, rectAnnotations,
                                   obbAnnotations, measurements, note } | null,
                       reason?: string }
```

plant3d-web 端在 `src/components/review/workflowBridge.ts` 新增监听，复用 `buildReviewConfirmSnapshotPayload(...)` 输出 snapshot；带 `formId` 校验防止串号。

PMS 平台改动：「通过 / 驳回」按钮 click → 先 request snapshot（带 1500ms timeout 兜底）→ 再调 `workflow/sync` 把 snapshot 放进请求体。

### B.5 兼容旧 PMS（双保险，过渡期保留）

PMS 改造前：plant3d-web 监听到 `plant3d.workflow_action`（agree/return）postMessage 时，**并行**立即调一次 `POST /api/review/records`（既有 `create_record` 路径，OwnerChecked 模式），不阻塞 PMS 的 `workflow_sync`。

新 PMS 上线后这段兜底可下线，但短期它确保"老 PMS + 新后端"也能落库。

### B.6 失败策略 & 幂等性

- snapshot 落库失败 → `workflow_sync` 返回 5xx，PMS 端不推进；前端通过 `workflow/verify` 自检仍是当前节点 → 重试不会跳节点。
- slot_key = `form_id + current_node + operator_id`（与 `create_record` 一致）→ 同节点同操作者重复 sync 会 UPSERT 同一行，幂等。
- snapshot_hash 不变时进入既有 no-op 分支（`review_api.rs` L2241–L2311），不重复 fire `sync_annotation_states_from_snapshot`。

## 阶段

### Phase 0：基线复现 + 计划评审 ⬅️ **当前**
- [ ] **0.1 仿 PMS 跑 return 场景拿基线**：`bun run test:pms:simulator -- --cases=return`，录到 `artifacts/baseline/`
- [ ] **0.2 SQL 抓证据**：直连 `surreal sql` 验证 PZ return 后 `review_records` / `review_annotation_states` 是否真为空、`review_tasks.task_id` 是否在 JH→SH→PZ→SJ 全程不变
- [ ] **0.3 前端复现**：在浏览器以 SJ 身份打开被驳回单据，确认 `DesignerCommentHandlingPanel` 的批注处理面板与校审面板都为空
- [ ] **0.4 用户评审**：`task_plan.md` + `findings.md` 交付确认；用户批准后进 Phase 1

### Phase 1：types + 公共函数（后端，单仓 plant-model-gen）
- [ ] **1.1** `src/web_api/platform_api/types.rs` 增 `EvidenceSnapshotPayload` + `SyncWorkflowRequest.evidence_snapshot`
- [ ] **1.2** `src/web_api/review_api.rs` 抽出 `persist_evidence_snapshot` 公共函数，`create_record` 重构为 `OwnerChecked` 调用
- [ ] **1.3** `cargo check -p aios-database --features web_server`（不跑 cargo test）

### Phase 2：workflow_sync 接入 + 后端 curl 验证
- [ ] **2.1** `apply_workflow_agree` / `apply_workflow_return` 接入 `persist_evidence_snapshot(Trusted)`
- [ ] **2.2** 重启 plant-model-gen `web_server`
- [ ] **2.3** 用 curl 三场景验证：
  - 不传 `evidence_snapshot` → 行为与今天一致（task 流转 OK，review_records 仍空）
  - 传合法 `evidence_snapshot` → review_records / review_annotation_states 各加一行，task 流转 OK
  - DB 故意失败（surreal 关闭）→ 返回 5xx，task 未流转
- [ ] **2.4** SQL 抓证据写入 `artifacts/phase2-curl/`

### Phase 3：前端 postMessage 监听 + 兜底
- [ ] **3.1** `src/components/review/workflowBridge.ts` 增 evidence snapshot request/response 监听
- [ ] **3.2** `src/components/review/workflowBridge.ts` 增 PMS workflow_action 监听 → 触发 `reviewRecordCreate`（B.5 兜底）
- [ ] **3.3** 关键 path 单测复用既有 vitest 文件结构（仅当 CLI 无法覆盖时再写，参考 plant3d-web AGENTS.md）

### Phase 4：仿 PMS 端到端回归
- [ ] **4.1** `scripts/pms-simulator-runner.ts` 给 JH agree / SH agree / PZ return 注入 `evidenceSnapshot` 字段
- [ ] **4.2** 新增断言：return 后 SJ 视角 `GET /api/review/records/by-task/{task}` 返回 ≥ 2 行（JH + SH）
- [ ] **4.3** 浏览器视角断言：SJ iframe 打开被驳回单据，`scopedAnnotationItems.length > 0`
- [ ] **4.4** `bun run test:pms:simulator -- --cases=return,stop,approved` 全绿

### Phase 5：文档与提交
- [ ] **5.1** `docs/verification/rus-244-evidence-snapshot-2026-05-07.md` 落地验证记录
- [ ] **5.2** `CHANGELOG` 追加；按 Conventional Commits 拆 commit（types / persist_helper / workflow_sync / frontend / simulator）
- [ ] **5.3** PR 描述包含变更背景、影响模块、跑过的命令与 artifacts

## 一键命令

```bash
# 启 plant-model-gen 后端（plant-model-gen 仓）
cargo run --bin web_server --features web_server -- --config db_options/DbOption-mac

# 仿 PMS 端到端（plant3d-web 仓）
cd /Volumes/DPC/work/plant-code/plant3d-web
bun run test:pms:simulator -- --cases=return,stop,approved
# 之后 cat artifacts/pms-simulator-*.json 取最新一份
```

## 关键文件

### plant-model-gen
- `src/web_api/platform_api/types.rs` — `SyncWorkflowRequest` / `EvidenceSnapshotPayload`
- `src/web_api/platform_api/workflow_sync.rs` — `apply_workflow_agree` / `apply_workflow_return`
- `src/web_api/review_api.rs` — `create_record` → 抽 `persist_evidence_snapshot`
- `src/web_api/review_annotation_state.rs` — `sync_annotation_states_from_snapshot`（不变，被 helper 调用）

### plant3d-web
- `src/components/review/workflowBridge.ts` — postMessage 协议扩展
- `src/components/review/DesignerCommentHandlingPanel.vue` — 兜底/降级文案（不改主逻辑）
- `scripts/pms-simulator-runner.ts` — 注入 `evidenceSnapshot` + 增加 SJ 视角断言

## 风险与边界

| 风险 | 评估 | 缓解 |
|---|---|---|
| PMS 平台改造受阻（拿不到接口改动机会） | 中 | B.5 前端兜底先行，覆盖"老 PMS + 新后端"过渡期 |
| evidence snapshot 体量过大 | 低 | JH 典型 < 200KB；后端 body limit 已留 buffer，必要时分批 |
| 写入失败阻断 workflow → 用户体验下降 | 低 | 后端日志 + 前端 verify 自检；PMS 端可自动重试 |
| slot_key 复用导致同节点多次 sync 互相覆盖 | 已知行为 | 与 `create_record` UPSERT 语义一致，符合"最近一次最权威"直觉 |

## 不在本次范围

- 改 SJ 发起阶段（active）的证据写入语义
- PMS 平台本身的 UI / 业务流改造（仅做协议层接入）
- 修复 plant3d-web 在非 PMS 模式下的「保存新增证据」按钮（独立的 UX 问题）

## 失败兜底

如果 Phase 1/2 在重构 `persist_evidence_snapshot` 时影响到 `create_record` 既有路径（前端「保存新增证据」按钮失效），**MUST** 立即回滚 Phase 1/2 提交，恢复 `create_record` 到独立实现，再重新评估抽公共函数的边界。
