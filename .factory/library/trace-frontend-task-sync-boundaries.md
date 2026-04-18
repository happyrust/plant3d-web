# trace-frontend-task-sync-boundaries

## Scope
- Feature: `trace-frontend-task-sync-boundaries`
- Goal: split frontend evidence into three boundaries: create/save, internal submit|return, and external/passive `workflow/sync`; explain `externalWorkflowMode` with exact references.
- Constraint: this repo proves frontend call chains and documented architecture only; it does **not** prove backend implementation details beyond what repo docs state.

## Proven In This Repo

### 1. Create/save boundary = `InitiateReviewPanel` -> `useUserStore.createReviewTask` -> `POST /api/review/tasks`
- `InitiateReviewPanel` resolves `externalWorkflowMode` from query/session/local/embed state and defaults to `true` when no override is present, so the default UX is external-workflow-first. See `src/components/review/InitiateReviewPanel.vue:242`, `src/components/review/InitiateReviewPanel.vue:246`, `src/components/review/InitiateReviewPanel.vue:270`, `src/components/review/InitiateReviewPanel.vue:276`, `src/components/review/InitiateReviewPanel.vue:349`.
- The submit button text and success copy already encode the split: external mode says "保存编校审单数据" / "已保存到编校审单，流程流转由外部系统继续处理", while internal/manual mode says "创建并提交编校审单" / "已提交到校审流程". See `src/components/review/InitiateReviewPanel.vue:501`, `src/components/review/InitiateReviewPanel.vue:515`, `src/components/review/InitiateReviewPanel.vue:522`.
- On submit, the panel always creates/saves the task first by calling `userStore.createReviewTask(...)` with title/description/modelName/components/formId/attachments, and in external mode it intentionally leaves `checkerId`, `approverId`, `priority`, and `dueDate` unset. See `src/components/review/InitiateReviewPanel.vue:563`, `src/components/review/InitiateReviewPanel.vue:575`.
- `useUserStore.createReviewTask` builds a `ReviewTaskCreateRequest` and sends it through `reviewTaskCreate(request)`. See `src/composables/useUserStore.ts:794`, `src/composables/useUserStore.ts:845`, `src/composables/useUserStore.ts:859`.
- `reviewTaskCreate` maps that call to `POST /api/review/tasks`. See `src/api/reviewApi.ts:196`, `src/api/reviewApi.ts:201`.

### 2. Internal workflow transition boundary = `submit|return` on `/api/review/tasks/{id}`
- `InitiateReviewPanel` only auto-submits after create when `externalWorkflowMode` is false; the code path is explicit: `if (!isExternal) await userStore.submitTaskToNextNode(task.id, '发起编校审')`. See `src/components/review/InitiateReviewPanel.vue:603`.
- `useUserStore.submitTaskToNextNode` calls `reviewTaskSubmitToNext(taskId, comment)` and then refreshes tasks; this is a task-internal transition keyed by `taskId`. See `src/composables/useUserStore.ts:1037`, `src/composables/useUserStore.ts:1042`.
- `useUserStore.returnTaskToNode` similarly calls `reviewTaskReturn(taskId, targetNode, reason)`. See `src/composables/useUserStore.ts:1104`, `src/composables/useUserStore.ts:1109`.
- `reviewTaskSubmitToNext` is `POST /api/review/tasks/{taskId}/submit`, and `reviewTaskReturn` is `POST /api/review/tasks/{taskId}/return`. See `src/api/reviewApi.ts:372`, `src/api/reviewApi.ts:382`, `src/api/reviewApi.ts:389`, `src/api/reviewApi.ts:399`.
- Repo docs describe this as the platform-internal `task_id` flow, distinct from external `form_id` sync: `submit|return` is the real entry for internal node progression, not `workflow/sync`. See `开发文档/三维校审/新的三维校审流程分析.md:297`, `开发文档/三维校审/新的三维校审流程分析.md:311`, `开发文档/三维校审/新的三维校审流程分析.md:352`, `开发文档/三维校审/新的三维校审流程简版.md:9`, `开发文档/三维校审/新的三维校审流程简版.md:10`.

### 3. `workflow/sync` boundary = external/passive `form_id` contract, not the panel's create/submit call path
- There is no `workflow/sync` call in `InitiateReviewPanel.vue`, `useUserStore.createReviewTask`, or the `reviewTaskSubmitToNext/reviewTaskReturn` API wrappers. The panel calls `/api/review/tasks*`; the sync contract is documented elsewhere and consumed by the simulator. Evidence: `src/components/review/InitiateReviewPanel.vue:575`, `src/components/review/InitiateReviewPanel.vue:603`, `src/composables/useUserStore.ts:845`, `src/composables/useUserStore.ts:1042`, `src/composables/useUserStore.ts:1109`, `src/api/reviewApi.ts:382`, `src/api/reviewApi.ts:399`.
- The repo documentation defines `workflow/sync` as a `form_id`-based integration surface, separate from the internal `task_id` flow. See `开发文档/三维校审/新的三维校审流程分析.md:17`, `开发文档/三维校审/新的三维校审流程分析.md:18`, `开发文档/三维校审/新的三维校审流程分析.md:332`, `开发文档/三维校审/新的三维校审流程分析.md:352`.
- The verification doc states that `POST /api/review/workflow/sync` is the model-center workflow sync endpoint: `action=query` is PMS open/refresh and only reads current snapshot, while `active|agree|return|stop` are approval actions. See `docs/verification/pms-3d-review-integration-e2e.md:174`, `docs/verification/pms-3d-review-integration-e2e.md:175`, `docs/verification/pms-3d-review-integration-e2e.md:176`, `docs/verification/pms-3d-review-integration-e2e.md:228`, `docs/verification/pms-3d-review-integration-e2e.md:232`.
- The interface design doc gives the same action split: `query` = open/refresh and no opinion write; `active|agree|return|stop` = workflow mutations. See `开发文档/三维校审/编校审交互接口设计.md:37`, `开发文档/三维校审/编校审交互接口设计.md:42`, `开发文档/三维校审/编校审交互接口设计.md:43`, `开发文档/三维校审/编校审交互接口设计.md:44`, `开发文档/三维校审/编校审交互接口设计.md:45`, `开发文档/三维校审/编校审交互接口设计.md:46`, `开发文档/三维校审/编校审交互接口设计.md:379`, `开发文档/三维校审/编校审交互接口设计.md:387`.

### 4. `externalWorkflowMode` effect on auto-submit
- The mode resolver treats `workflow_mode=manual|internal` as non-external; anything else falls back to external, including the default `return true`. See `src/components/review/InitiateReviewPanel.vue:246`, `src/components/review/InitiateReviewPanel.vue:251`, `src/components/review/InitiateReviewPanel.vue:276`.
- This changes validation and payload requirements: external mode only requires package name + selected components; manual/internal mode additionally requires checker and approver and blocks same-person assignment. See `src/components/review/InitiateReviewPanel.vue:441`, `src/components/review/InitiateReviewPanel.vue:462`, `src/components/review/InitiateReviewPanel.vue:483`.
- The behavioral split is enforced in `handleSubmit`: external mode stops after save/create + attachment sync; manual/internal mode performs the extra `submitTaskToNextNode` call. See `src/components/review/InitiateReviewPanel.vue:563`, `src/components/review/InitiateReviewPanel.vue:575`, `src/components/review/InitiateReviewPanel.vue:603`.
- Repo docs summarize the same conclusion: external mode only creates task data; only manual/internal auto-submits after create. See `开发文档/三维校审/新的三维校审流程分析.md:203`, `开发文档/三维校审/新的三维校审流程分析.md:544`.

## Request Path Map
| User action | Frontend entry | Store/API hop | Request path | Boundary |
| --- | --- | --- | --- | --- |
| Save/create review package | `InitiateReviewPanel.handleSubmit()` | `userStore.createReviewTask()` -> `reviewTaskCreate()` | `POST /api/review/tasks` | create/save |
| Auto-submit after create (manual/internal only) | `InitiateReviewPanel.handleSubmit()` | `userStore.submitTaskToNextNode()` -> `reviewTaskSubmitToNext()` | `POST /api/review/tasks/{taskId}/submit` | internal workflow transition |
| Return to previous node from review flows | review task actions / store helpers | `userStore.returnTaskToNode()` -> `reviewTaskReturn()` | `POST /api/review/tasks/{taskId}/return` | internal workflow transition |
| PMS open/refresh current snapshot | external PMS/simulator path, not this panel | `workflow/sync action=query` contract in docs | `POST /api/review/workflow/sync` | external/passive sync |
| PMS approval-style sync action | external PMS/simulator path, not this panel | `workflow/sync action=active|agree|return|stop` contract in docs | `POST /api/review/workflow/sync` | external/passive sync contract |

## Proven vs Unproven

### Proven in this repo
- The frontend panel itself separates save/create from internal submit by mode, and only calls `/api/review/tasks*` from the create path.
- `externalWorkflowMode=true` is the default unless query/session/local/embed state explicitly says `manual` or `internal`.
- Internal progression APIs are `task_id`-based `/submit` and `/return` endpoints.
- Docs consistently position `workflow/sync` as a separate `form_id` contract used for external integration and query/mutation snapshots.

### Plausible but not proven here
- After internal `/submit|return`, backend code likely triggers some external sync/notification bridge, because repo docs say so; this frontend repo does not contain the backend implementation.
- `workflow/sync` likely returns the latest cross-system snapshot keyed by `form_id`, but exact assembly logic is outside this repo.

### Requires backend verification
- Whether `/api/review/tasks/{id}/submit|return` immediately invokes `notify_workflow_sync_async` in every path and with what payload.
- Whether the external bridge consumes any `workflow/sync` response body or is pure fire-and-forget.
- The exact source and assembly rules for `workflow/sync` fields like `title`, `current_node`, `task_status`, `models`, `opinions`, and `attachments`.
