# Architecture — Annotation Refactor

## System Overview

Plant3D-Web is a Vue 3 + Three.js industrial 3D visualization app. The annotation refactor restructures the review/annotation subsystem across two repositories:

- **plant3d-web** (D:\work\plant-code\plant3d-web): Vue 3 frontend — reviewer/designer workbench, annotation tools, comment threads, confirmed records, 3D viewer
- **plant-model-gen** (D:\work\plant-code\plant-model-gen): Rust/Axum backend — review task CRUD, records, comments, workflow sync, JWT auth, WebSocket notifications

## Data Layers (Current → Target)

### Current State
1. **Tool Draft Layer** (`useToolStore.ts`): annotations, measurements, xeokit measurements — user's in-progress work
2. **Comment Layer** (`ReviewCommentsTimeline.vue` + `/api/review/comments`): per-annotation discussion, inline on annotation objects
3. **Confirmed Record Layer** (`useReviewStore` + `/api/review/records`): batch snapshots of confirmed annotations/measurements, keyed by taskId
4. **Workflow Sync Layer** (`/api/review/workflow/sync`): aggregated restore payload by formId (records + comments + attachments + models)

### Target State (After Refactor)
1. **Annotation Entity**: stable `annotationKey` + `annotationId`, with `workflowNode` and `reviewRound`
2. **Detached Comment Thread**: independent comment source, not embedded in annotation objects
3. **ReviewSnapshot**: unified restore intermediate — all sources (task, workflow-sync, import) convert to this before UI consumption
4. **Draft Layer**: task-scoped (project + db + taskId), isolated per task
5. **Confirmed Layer**: separate from draft, persists independently, always visible

## Key Components

### Frontend (plant3d-web)
| Component | File | Purpose |
|-----------|------|---------|
| ReviewPanel | src/components/review/ReviewPanel.vue (72KB) | Main reviewer workbench shell |
| InitiateReviewPanel | src/components/review/InitiateReviewPanel.vue (42KB) | Designer task creation |
| ReviewCommentsTimeline | src/components/review/ReviewCommentsTimeline.vue | Annotation comment threads |
| ReviewerTaskList | src/components/review/ReviewerTaskList.vue | Reviewer inbox |
| DesignerTaskList | src/components/review/DesignerTaskList.vue | Designer task list |
| ResubmissionTaskList | src/components/review/ResubmissionTaskList.vue | Returned task handling |
| TaskReviewDetail | src/components/review/TaskReviewDetail.vue | Designer task detail |
| useToolStore | src/composables/useToolStore.ts (1786 lines) | Annotation/measurement state |
| useReviewStore | src/composables/useReviewStore.ts | Review mode, task context, WebSocket |
| reviewRecordReplay | src/components/review/reviewRecordReplay.ts | Record replay/restore engine |
| confirmedRecordsRestore | src/components/review/confirmedRecordsRestore.ts | Scene restore from confirmed records |
| embedFormSnapshotRestore | src/components/review/embedFormSnapshotRestore.ts | Embed mode form restore |
| embedContextRestore | src/components/review/embedContextRestore.ts | Embed mode context resolution |
| reviewPanelActions | src/components/review/reviewPanelActions.ts | Workflow action helpers |
| reviewApi | src/api/reviewApi.ts | All review API calls |

### Backend (plant-model-gen)
| Module | File | Purpose |
|--------|------|---------|
| review_api | src/web_api/review_api.rs (156KB) | Task/record/comment CRUD |
| workflow_sync | src/web_api/platform_api/workflow_sync.rs | PMS ↔ plant3d workflow bridge |
| jwt_auth | src/web_api/jwt_auth.rs | JWT middleware for review routes |

## Restore Paths (Three Entries → One ReviewSnapshot)

1. **Platform Task Restore**: ReviewerTaskList → setCurrentTask → loadConfirmedRecords → replay
2. **Workflow Sync Restore**: Embed formId → workflow/sync query → replay records + attach comments
3. **Import Package Restore**: Sync import → records + attachments

The refactor unifies these behind a single `ReviewSnapshot` semantic layer.

## Workflow Model

4-node pipeline: `sj (设计/编制)` → `jd (校对)` → `sh (审核)` → `pz (批准)`
- Forward flow: submit to next node
- Return flow: return to any prior node with reason
- Each node has a role: PROOFREADER(jd), REVIEWER(sh), MANAGER(pz)

## Key Invariants

- `taskId` is stable across return/resubmit cycles
- `formId` links to external PMS system and is stable
- Confirmed records are immutable once created (slot-stable idempotent)
- Comments are always associated via `annotationId + annotationType`
- WebSocket notifications are user-scoped at `/ws/review/user/{userId}`
