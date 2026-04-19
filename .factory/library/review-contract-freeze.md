# Review Contract Freeze (M1)

## Canonical terminology

| Canonical term | Type | Authoritative owner | Stability | Current frontend field(s) | Backend field(s) in 
eview_api.rs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| nnotationId | string | Annotation payload / comments API | Stable within one stored snapshot; may change across replay/import | AnnotationRecord.id, CloudAnnotationRecord.id, RectAnnotationRecord.id, ObbAnnotationRecord.id, AnnotationComment.annotationId | CreateCommentRequest.annotation_id, CommentRow.annotation_id, comment routes /comments/by-annotation/{annotation_id} | Current compatibility anchor for comment lookup and inline comment projection. |
| nnotationKey | string | Frontend v1 now, backend v2 later | Intended stable across snapshot/replay cycles | src/review/domain/annotationKey.ts, optional SnapshotAnnotation.annotationKey, SnapshotComment.annotationKey | Not yet present in 
eview_api.rs | Use v1 hash during compatibility window; prefer backend key once M4 lands. |
| 	askId | string | Review task backend | Stable across return/resubmit cycle | ReviewTask.id, ConfirmedRecord.taskId, ConfirmedRecordData.taskId, snapshot 	askId | ReviewTask.id, record query /records/by-task/{task_id}, history/workflow routes, 	ask_id fields in rows | Canonical task-scoped identity; never derive round from changing task IDs. |
| ormId | string | External workflow / PMS lineage | Stable for form lifecycle | ReviewTask.formId, ConfirmedRecord.formId, workflow-sync request ormId, snapshot ormId | ReviewTask.form_id, CreateTaskRequest.form_id, workflow-sync payload orm_id, record context orm_id | Cross-entry restore anchor; task restore may infer it from task context. |
| workflowNode | enum sj|jd|sh|pz | Backend workflow state | Stable for a record/comment once written | ReviewTask.currentNode, snapshot workflowNode, docs/flags | ReviewTask.current_node, workflow step 
ode, task record context current_node | Canonical term; avoid inventing aliases like currentNode/阶段/环节 in new contracts. |
| 
eviewRound | integer >=1 | Backend task round state | Stable for each artifact once assigned | Optional in SnapshotAnnotation / SnapshotComment / liftAnnotationComment context | Not yet present in 
eview_api.rs | Frontend reads only; backend should atomically increment on return→resubmit boundary. |
| nnotationType | enum 	ext|cloud|rect|obb | Frontend + comments API | Stable | AnnotationType, AnnotationComment.annotationType, snapshot nnotationType | CreateCommentRequest.annotation_type, comment query 	ype filter | Required companion key with nnotationId during compatibility window. |
| source | enum/open string | ReviewSnapshot layer | Stable per restore path | ReviewSnapshot.source | Not stored in backend | Allowed values today: 	ask_records, workflow_sync, import_package; reserve open extension set. |

## Frontend ↔ backend field mapping

| Domain meaning | Frontend canonical field | Accepted backend/legacy aliases | Observed source |
| --- | --- | --- | --- |
| task id | 	askId | 	ask_id | 
eviewApi.normalizeReviewTask, workflow-sync/record adapters |
| form id | ormId | orm_id | 
eviewApi.normalizeReviewTask, workflow sync query/response |
| checker | checkerId / checkerName | checker_id, checker_name, fallback 
eviewer_id, 
eviewer_name | 
eviewApi.normalizeReviewTask, 
eview_api.rs create/list rows |
| approver | pproverId / pproverName | pprover_id, pprover_name | 
eviewApi.normalizeReviewTask, 
eview_api.rs task rows |
| workflow node | workflowNode | currentNode, current_node, workflow step 
ode | snapshot adapters + backend workflow structs |
| annotation id | nnotationId | nnotation_id | comments API + snapshot adapters |
| annotation type | nnotationType | nnotation_type | comments API + snapshot adapters |
| author role | uthorRole | uthor_role | 
ormalizeAnnotationComment, workflow sync comment normalization |
| review round | 
eviewRound | 
eview_round (planned) | snapshot/domain superset only |
| annotation key | nnotationKey | nnotation_key (planned) | snapshot/domain superset + nnotationKey.ts |

## Migration boundaries and compatibility windows

| Milestone | New contract introduced | Compatibility rule | Removal boundary |
| --- | --- | --- | --- |
| M1 contract freeze | Terminology table, flags, nnotationKey v1 | Old routes and inline comments remain authoritative; new snapshot/domain fields stay optional and additive. | Nothing removed in M1. |
| M2 ReviewSnapshot | Unified restore adapters and snapshot layer | Run snapshot generation in SHADOW/DUAL_READ without changing persisted record/comment schema; snapshot consumers must tolerate missing nnotationKey/workflowNode/reviewRound. | Cut old restore-only helpers only after snapshot cutover proves parity. |
| M3 comment thread decoupling | Detached comment thread store / event log | Continue accepting inline nnotation.comments as read projection; thread store becomes source of truth only behind dual-read/cutover flags. | Inline comments can stop being truth only after M3 cutover. |
| M4 backend metadata | nnotationKey, workflowNode, 
eviewRound persisted in records/comments | Backend must accept omission of new metadata from existing clients and frontend must normalize both camelCase and snake_case payloads. | Do not require metadata until at least two release cycles after dual-write starts. |
| M5 realtime convergence | comment_added / targeted refresh semantics | WebSocket handlers must remain idempotent and fallback to HTTP refresh when metadata missing or socket unavailable. | Legacy manual refresh stays as fallback until convergence proves stable. |
| M6 task-scoped drafts | Task-scoped local draft storage | Existing project/db scoped drafts may still be read during migration, but writes should move to task scope behind flag. | Remove legacy scope only after migration/cleanup path exists. |
| M7 dual-layer rendering | Separate draft vs confirmed viewer/store layers | Existing clear-and-replay flow remains rollback path behind 
eview.force_legacy; confirmed payload shape stays backward compatible. | Legacy single-layer restore removed only after viewer cutover and parity validation. |

## Contract notes

- 	askId remains the canonical stable lineage inside plant3d-web; return/resubmit must not mint a new task identity.
- ormId is the cross-entry lineage key and must remain queryable even when restore starts from task context.
- nnotationKey is additive in M1/M2: generate it locally for deterministic grouping, but never require backend support before M4.
- workflowNode names the node that produced an artifact; currentNode is only a transport alias on task/workflow payloads.
- 
eviewRound belongs to artifacts, not the task primary key. Existing payloads without round are still valid during the compatibility window.
