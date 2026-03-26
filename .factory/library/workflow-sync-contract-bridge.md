# workflow/sync contract and bridge evidence

## Scope
- Feature: `trace-workflow-sync-contract-and-bridge`
- Goal: explain `workflow/sync` query/mutation semantics, the passive-sync position of `plant3d`, and why `notify_workflow_sync_async` is an internal bridge instead of a second public API.
- Evidence base: repo docs, verification notes, and prior worker notes in `.factory/library/`.

## Proven in this repo

### 1. `workflow/sync` is a `form_id`-keyed external contract, not the same thing as internal task submit/return
- The architecture note explicitly separates two chains: a public `form_id` sync chain (`/api/review/embed-url`, `/api/review/workflow/sync`, `/api/review/delete`, `/api/review/aux-data`) and an internal `task_id` chain where `/api/review/tasks/{id}/submit|return` updates the task and then asynchronously calls an external path. See `开发文档/三维校审/新的三维校审流程分析.md:17`, `开发文档/三维校审/新的三维校审流程分析.md:18`.
- The short version repeats the same split: frontend node progression uses `/api/review/tasks/{id}/submit|return`, not `/api/review/workflow/sync`. See `开发文档/三维校审/新的三维校审流程简版.md:10`, `开发文档/三维校审/新的三维校审流程简版.md:42`, `开发文档/三维校审/新的三维校审流程简版.md:54`, `开发文档/三维校审/新的三维校审流程简版.md:65`.
- The frontend evidence note confirms `InitiateReviewPanel` and `useUserStore` never call `workflow/sync` directly on create/submit paths; they only hit `/api/review/tasks*`. See `.factory/library/trace-frontend-task-sync-boundaries.md` and references there, especially `src/components/review/InitiateReviewPanel.vue:575`, `src/components/review/InitiateReviewPanel.vue:603`, `src/composables/useUserStore.ts:1042`, `src/composables/useUserStore.ts:1109`.

### 2. `workflow/sync` action semantics are query-vs-mutation, and that contract is distinct from submit/return APIs
- The verification doc states `POST /api/review/workflow/sync` is implemented on the model-center side and that `action=query` is used when PMS opens or refreshes the embedded page / document and only pulls the current workflow snapshot; it does not create a `review_opinion` record even if `comments` are present. See `docs/verification/pms-3d-review-integration-e2e.md:174`, `docs/verification/pms-3d-review-integration-e2e.md:175`, `docs/verification/pms-3d-review-integration-e2e.md:228`.
- The same doc says `active|agree|return|stop` are approval-style actions. See `docs/verification/pms-3d-review-integration-e2e.md:176`, `docs/verification/pms-3d-review-integration-e2e.md:232`.
- The interface design doc provides the clearest semantics table: `query` = open/refresh, read-only; `active` = initiate workflow; `agree` = approve; `return` = reject; `stop` = terminate. It also states that non-query actions write opinion records, while `query` does not. See `开发文档/三维校审/编校审交互接口设计.md:37`, `开发文档/三维校审/编校审交互接口设计.md:43`, `开发文档/三维校审/编校审交互接口设计.md:44`, `开发文档/三维校审/编校审交互接口设计.md:45`, `开发文档/三维校审/编校审交互接口设计.md:46`, `开发文档/三维校审/编校审交互接口设计.md:387`.
- The detailed architecture note aligns with that contract and adds storage meaning: `workflow/sync` non-query actions write `review_opinion`, while internal `/submit|return` writes `review_workflow_history`. See `开发文档/三维校审/新的三维校审流程分析.md:349`, `开发文档/三维校审/新的三维校审流程分析.md:350`, `开发文档/三维校审/新的三维校审流程分析.md:420`, `开发文档/三维校审/新的三维校审流程分析.md:449`, `开发文档/三维校审/新的三维校审流程分析.md:462`.

### 3. `plant3d` is positioned as the passive-sync side in this repository's architecture
- The verification doc describes `workflow/sync action=query` as PMS opening/refreshing a document and pulling the current snapshot from the model center. The direction shown in the sequence diagram is PMS -> MC, with MC returning `data.models / opinions / attachments`. See `docs/verification/pms-3d-review-integration-e2e.md:174`, `docs/verification/pms-3d-review-integration-e2e.md:208`, `docs/verification/pms-3d-review-integration-e2e.md:228`, `docs/verification/pms-3d-review-integration-e2e.md:229`.
- The architecture note explicitly says the stable cross-system key is `form_id`, and `workflow/sync?action=query` can return models by querying the `form_id` aggregation. See `开发文档/三维校审/新的三维校审流程分析.md:12`, `开发文档/三维校审/新的三维校审流程分析.md:409`.
- The simulator-consumption note proves the frontend debug surface treats `workflow/sync` as an already-produced snapshot that it consumes after normalization; it does not construct the snapshot itself. See `.factory/library/pms-simulator-sync-consumption.md`.
- Together these sources support a bounded conclusion: within this repo, `plant3d` is described as returning current aggregated document state when external PMS/simulator code calls `workflow/sync`; this repo does not show `plant3d-web` proactively pushing that snapshot on its own.

### 4. `notify_workflow_sync_async` is documented as an internal bridge triggered by task-state changes
- The detailed architecture note says the internal `task_id` flow updates `/api/review/tasks/{id}/submit|return` first, then asynchronously calls `external_review.workflow_sync_path`. See `开发文档/三维校审/新的三维校审流程分析.md:18`, `开发文档/三维校审/新的三维校审流程分析.md:297`, `开发文档/三维校审/新的三维校审流程分析.md:311`, `开发文档/三维校审/新的三维校审流程分析.md:553`.
- The short note visualizes the same relationship as `/submit` -> async notify -> `external_review.workflow_sync_path`, which is why the bridge should be described as an internal notifier behind task transitions, not as a second public interface alongside `workflow/sync`. See `开发文档/三维校审/新的三维校审流程简版.md:54`, `开发文档/三维校审/新的三维校审流程简版.md:65`.
- The code-audit report names the helper directly and says `notify_workflow_sync_async` is fire-and-forget. That supports the interpretation that it is an internal bridge/notification mechanism, not a user-facing response contract. See `开发文档/三维校审/三维校审代码审核报告-2026-03-24.md:147`, `开发文档/三维校审/三维校审代码审核报告-2026-03-24.md:161`, `开发文档/三维校审/三维校审代码审核报告-2026-03-24.md:280`.

### 5. The current documented limitation is exactly the bridge gap the mission asks to call out
- The code-audit report says `notify_workflow_sync_async` is fire-and-forget and failures are only logged, with no retry mechanism. See `开发文档/三维校审/三维校审代码审核报告-2026-03-24.md:147`, `开发文档/三维校审/三维校审代码审核报告-2026-03-24.md:161`, `开发文档/三维校审/三维校审代码审核报告-2026-03-24.md:292`.
- The frontend evidence note already marks as unverified whether the bridge consumes any `workflow/sync` response body or is pure fire-and-forget. See `.factory/library/trace-frontend-task-sync-boundaries.md:58`, `.factory/library/trace-frontend-task-sync-boundaries.md:59`.
- Therefore this repo supports the limitation statement required by `VAL-BRIDGE-002`: internal task transitions appear to notify an external sync path asynchronously, but this repo does not prove any response-handling or retry semantics beyond fire-and-forget logging.

## Contract summary
- `query`: external PMS/simulator open-or-refresh read; pull current workflow snapshot by `form_id`; documented as non-writing.
- `active`: workflow initiation mutation on the external `workflow/sync` contract.
- `agree`: approval mutation on the external `workflow/sync` contract.
- `return`: rejection mutation on the external `workflow/sync` contract.
- `stop`: termination mutation on the external `workflow/sync` contract.
- `/api/review/tasks/{id}/submit|return`: separate internal task-state APIs keyed by `task_id`; these are the real platform flow-transition entry points in the reviewed architecture.

## Proven vs unproven

### Proven in this repo
- Repo docs consistently separate the public `form_id` `workflow/sync` contract from internal `task_id` submit/return APIs.
- `query` is documented as a read-only snapshot fetch, while `active|agree|return|stop` are workflow mutations.
- `notify_workflow_sync_async` is documented as an asynchronous bridge triggered after internal task transitions.
- The documented bridge limitation is fire-and-forget behavior without retry.

### Plausible but not proven in this repo
- `notify_workflow_sync_async` probably reaches the same downstream model-center workflow sync route family or related external endpoint, but the exact implementation wiring is only described in docs, not shown in code in this repo.
- Internal `/submit|return` likely cause the externally visible workflow snapshot to become fresh quickly, but this repo does not prove whether that happens by immediate synchronous readback, async push-only notification, or later polling.

### Requires backend verification
- Whether `notify_workflow_sync_async` literally calls the public `workflow/sync` mutation endpoint, a sibling internal endpoint, or some other bridge path behind `external_review.workflow_sync_path`.
- Whether the async notifier reads, depends on, or discards any downstream response body.
- Whether internal submit/return always trigger the bridge, or whether some paths skip it.
- Where `workflow/sync` response fields are assembled, especially `title`, `current_node`, `task_status`, `models`, `opinions`, and `attachments`.
- Whether the returned `title` comes from task data, form-level aggregates, or another external source of truth.
