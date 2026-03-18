# M4 Reviewer Workbench

Mission-specific reference for `M4：审核工作台基础版`.

## Scope
- Review workbench shell and sectioning
- Normalized task context fields
- Standard submit/return workflow actions
- Confirmed-record presentation and boundaries
- Task-driven auxiliary data and collision behavior
- Sync import/export semantics inside the workbench

## Formal Field Priorities
- Prefer `checkerName` and `approverName` for reviewer-facing roles
- Treat `currentNode` as workflow truth
- Treat `formId` as business lineage; do not silently normalize it to `task.id`
- Keep `returnReason` and `workflowHistory` aligned with the active task

## Data-Line Boundaries
- Workflow history: flow timeline and node actions
- Confirmed records: reviewer confirmation snapshots only
- Comments: out of scope for M4 and must remain independent

## Validation Focus
- Reviewer inbox -> workbench entry
- Task switching without stale state
- Submit/return state refresh
- Aux-data/collision queries from task context
- Sync import/export refresh behavior
- Regression boundary only for M5/M6 surfaces

## Scoped Verification Contract
- Treat M4 validation as gated by `npm run type-check` plus `.factory/services.yaml` command `test:m4-scoped`.
- Do not fall back to whole-repo `npm test` as the milestone gate for M4 reviewer workbench work.
- If unrelated annotation/parquet suites fail during exploratory whole-repo validation, record them as baseline noise tied to `VAL-CROSS-005` rather than blocking M4 implementation.
- Keep the noise note specific: list the unrelated suites or areas, then state that scoped reviewer workbench checks still passed.


## Shell Invariants
- The five M4 zones (context, workflow actions/history, confirmed records, aux-data, sync) are default-visible workbench structure and should read as one stable shell grouping, not scattered top-level cards or optional modules.
- The shell must not retain a second aux-data request path with silent `task.id`, `default`, or `guest` fallbacks once `ReviewAuxData` is the compliant implementation.
