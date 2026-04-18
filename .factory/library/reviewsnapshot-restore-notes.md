# ReviewSnapshot Restore Notes

## Purpose

This note exists to keep restore semantics stable across all three supported entrypoints:
- platform task restore
- `workflow/sync?action=query`
- import/package restore

## Required Semantic Guarantees

- Every restore path must produce one normalized ReviewSnapshot before rendering.
- ReviewSnapshot must be able to carry annotations, measurements, comments, attachments, task/form context, and workflow history references together.
- Empty snapshots must still produce an explicit empty replay payload so previous task/form state is cleared.
- Detached comments must be merged onto the correct annotation identity using `annotationKey` when present, with fallback behavior only during the compatibility window.
- Repeated record/comment payload items must deduplicate before scene or thread rendering.

## Compatibility Window Expectations

- If the backend only provides legacy snake_case fields, restore adapters must still normalize them.
- If `annotationKey` is absent, fallback identity must be deterministic and must not create duplicate threads once server-provided `annotationKey` arrives.
- `workflowNode` on historical records/comments represents ownership at creation time, not the task's newest node.

## Worker Reminder

When editing restore logic, validate these transitions explicitly:
1. populated form -> empty form
2. task with confirmed evidence -> task with no evidence
3. restore from in-app task context vs workflow-sync vs import/package for the same task/form
