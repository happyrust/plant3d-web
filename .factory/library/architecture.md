# Annotation Refactor Architecture

## Mission Intent

This mission refactors the review annotation system without breaking the existing reviewer/designer workflow chain. The target state is a single ReviewSnapshot semantic layer that can restore the same evidence set whether the entrypoint is an in-app task, a `workflow/sync?action=query` reopen, or an import/package restore.

## Canonical Domain Vocabulary

- `taskId`: the internal review task identity; authoritative for reviewer/designer surfaces and task-scoped draft storage.
- `formId`: the external/business form identity; authoritative key for workflow-sync query and readonly reopen surfaces.
- `annotationId`: persisted item identity for a specific annotation payload entry.
- `annotationKey`: stable logical identity used to merge detached comments, rounds, and realtime updates across restore paths.
- `workflowNode`: the workflow node that owned a record/comment when it was created; this must stay stable after the task advances.
- `reviewRound`: the round counter used to distinguish current-round draft/comment state from accumulated history.

## Seven-Milestone Architecture Path

### M1 — Contract freeze
Freeze the field matrix and compatibility window before moving behavior. Workers should know exactly which payloads are authoritative, which fields are compatibility fallbacks, and which surfaces consume them.

### M2 — ReviewSnapshot restore unification
All restore entrypoints should normalize into one ReviewSnapshot shape before the UI renders. This includes:
- platform task restore
- workflow-sync restore keyed by `formId`
- import/export or package restore

The replay layer must be able to:
- rehydrate annotations, measurements, comments, attachments, and task context together
- deduplicate repeated items
- clear stale state on empty snapshots
- honor explicit `skipClearOnEmpty` first-entry behavior only where the mission permits it

### M3 — Comment-source decoupling
Annotation comments stop living as the sole truth inside annotation payloads. Detached comment sources should feed both reviewer and designer thread surfaces. Restore logic must reattach comments to the correct annotation identity without duplicating threads.

### M4 — Backend metadata extension
`plant-model-gen` contracts for records, comments, workflow-sync, and enhanced realtime events should expose enough metadata for stable merges:
- `annotationKey`
- `taskId`
- `formId`
- `workflowNode`
- `reviewRound`

Compatibility remains required while these fields roll out. Frontend fallback logic must keep old payloads working until metadata is universally available.

### M5 — Realtime convergence
Websocket handling should become targeted and idempotent. `record_saved` refreshes records, `comment_added` refreshes comment threads (or equivalent incremental state), and task status events refresh workflow history. Heartbeat traffic must never mutate review state.

### M6 — Task-scoped drafts
Draft annotations, measurements, and related transient review inputs must scope to `project + db + taskId`. Task switching should preserve the active task's drafts while keeping other tasks clean. Returned-task continuity must stay on the same task identity instead of cloning parallel state.

### M7 — Dual-layer draft/confirmed rendering
Viewer state splits into:
- confirmed layer: previously confirmed evidence that stays visible across rounds and restore paths
- draft layer: current unsaved work for the active task/round

Confirm actions only consume the draft layer. Export/import and reopen paths must preserve the layer boundary instead of flattening draft into confirmed payloads.

## Main Frontend Seams

Expected high-churn areas in `plant3d-web`:
- `src/components/review/*` for workbench, comments, records, and designer detail surfaces
- `src/composables/useReviewStore.ts` for task context, restore, realtime, and confirmation state
- `src/composables/useToolStore.ts` / related tool state for task-scoped drafts
- `src/api/reviewApi.ts` and related shared types for contract compatibility and metadata rollout
- replay helpers/adapters that currently mix restore interpretation with rendering side-effects

## Main Backend Seams

Expected high-churn areas in `plant-model-gen`:
- review record create/read/delete handlers
- review comment create/read/delete/update handlers or explicit gap signaling
- workflow-sync query aggregation
- review websocket payload shape

Prefer real request/response validation over speculative implementation assumptions.

## Architectural Risks To Watch

- duplicate assertion ownership across milestones causing validation ambiguity
- fallback key logic creating duplicate threads when `annotationKey` arrives
- empty snapshot restore failing to clear the previous form/task state
- task-scoped draft keys colliding across project/db/task boundaries
- dual-layer cutover accidentally mixing draft state into confirmed persistence or replay
