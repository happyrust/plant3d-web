# User Testing

## Validation Surface

### Browser UI (agent-browser)
- **Reviewer workbench**: Task list, task selection, annotation tools, comment threads, confirmation flow, workflow submit/return dialogs, confirmed records zone, embed mode entry
- **Designer surfaces**: Task creation, task list, returned-task panel, task detail, resubmit flow, confirmed evidence
- **URL**: http://localhost:3101 (Vite dev server)
- **Auth**: Review auth can be disabled via backend config `[review_auth] enabled = false`
- **Prerequisites**: Backend on 3100, SurrealDB on 8020, frontend on 3101

### curl/HTTP (API contract)
- **Records API**: POST create, GET by-task, DELETE item, DELETE clear-task
- **Comments API**: POST create, GET by-annotation, DELETE
- **Workflow Sync API**: POST query/mutations
- **Base URL**: http://localhost:3100
- **Auth**: JWT token from `/api/review/auth/login` or disabled

### WebSocket
- **Endpoint**: ws://localhost:3100/ws/review/user/{userId}
- **Events**: record_saved, comment_added, task status changes

## Validation Concurrency

### agent-browser
- Machine: 64GB RAM, 32 CPU cores, ~8.5GB free at baseline
- Dev server (frontend + backend): ~2GB combined
- Each agent-browser instance: ~500MB (browser + overhead)
- **Max concurrent validators: 2** (conservative given 86% base RAM utilization)
- Rationale: 2 instances = ~1GB + ~2GB services = ~3GB, within 8.5GB headroom with 70% safety margin

### curl
- No meaningful resource constraint
- **Max concurrent validators: 5**

## Known Pre-Existing Issues

43 pre-existing test failures concentrated in:
- ResubmissionTaskList / ReviewAuxData / ReviewWorkflowPanel component rendering
- AnnotationMaterials linewidth assertion
- SolveSpaceBillboardVectorText height assertion
- SlopeAnnotation3D / WeldAnnotation3D text group structure
- useReviewStore.persistence localStorage mock
- ReviewConfirmDialog / ReviewActionToolbar / ReviewWorkflowHistory rendering

These are NOT caused by this mission and should not block validation.
