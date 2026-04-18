# Annotation Refactor User Testing

## Primary Validation Surfaces

1. Reviewer inbox and workbench shell
2. Reviewer direct-launch annotation and measurement actions
3. Reviewer annotation thread and confirmation surfaces
4. Confirmed record replay and workflow-sync reopen
5. Designer main list, returned-task panel, detail, and resubmit loop
6. Cross-entry restore equivalence (task, workflow-sync, import/package)
7. Realtime refresh and reconnect convergence

## Required Local Endpoints

- Frontend UI: `http://127.0.0.1:3101`
- Backend API / websocket: `http://127.0.0.1:3100`
- Optional supporting service checks: `http://127.0.0.1:8020`

## Evidence Expectations

- Capture screenshots for each claimed browser assertion.
- Capture request/response or websocket evidence for contract/realtime assertions.
- Capture console errors whenever a validation step expects no client failure.
- Tie each evidence item back to the assertion IDs owned by the worker's leaf feature.

## Reviewer Flow Checklist

- Inbox shows only reviewer-relevant tasks and preserves filters on return.
- Embedded reopen handles valid form, missing mapped task, and missing form states explicitly.
- Workbench exposes direct-launch annotation/measurement actions without losing task context.
- Annotation thread shows canonical type semantics, counts, empty states, chronological ordering, and correct lifecycle actions.
- Confirmation UI appears only for draft changes, preserves drafts on failure, and refreshes history/records correctly on success.
- Reopen/refresh restores the same evidence set and clears stale state on empty snapshots.

## Designer Flow Checklist

- Main list remains requester-scoped and distinguishes canonical returned tasks from ordinary drafts.
- Returned list uses latest return metadata, latest-first ordering, and same-task identity.
- Detail reloads authoritative workflow history with fallback on API failure.
- Resubmit only appears for canonical returned drafts at `sj`, advances the same task, and clears returned-only UI on success.
- Confirmed evidence remains visible across return/resubmit loops while new drafts stay task-scoped.

## Contract / API Checklist

- Records create/read/delete and workflow-sync probes use real HTTP calls where possible.
- Comment create/read/filter/delete/update-gap behavior is captured explicitly.
- Workflow-sync query stays read-only, keyed by `formId`, and returns explicit empty arrays for blank forms.
- Compatibility-window payload samples are preserved when metadata fields are not yet present.

## Realtime Checklist

- Confirm websocket endpoint shape and user scope.
- Verify `record_saved`, `comment_added`, and task status events refresh the correct surface only.
- Verify reconnect does not duplicate or misorder comments.
- Verify heartbeat frames do not trigger unrelated XHR refreshes.

## Validation Strategy

- Prefer focused validation per milestone first, then run the end-to-end cross-area checks once M7 is ready.
- Treat missing seed data or service availability as blockers; do not lower the contract bar to compensate.
