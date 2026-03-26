# Workflow/Sync Investigation Library Note

## Mission Objective

This mission investigates how `plant3d-web` participates in the current review workflow as a passive `workflow/sync` data provider, with special attention to whether a simulator / 仿 PMS surface updates its displayed package name (`title`) from `workflow/sync` responses after a flow transition.

## Core Questions

1. Which user actions create or save local review task data?
2. Which user actions trigger internal task workflow progression?
3. Where does `workflow/sync` fit relative to those internal actions?
4. Which `workflow/sync` response fields does the simulator actually consume?
5. Why does `notify_workflow_sync_async` still exist if `workflow/sync` is the public contract?
6. Which unanswered questions can only be settled in the backend repository?

## High-Value Evidence Surfaces

### Frontend task/save/submit boundary
- `src/components/review/InitiateReviewPanel.vue`
- `src/composables/useUserStore.ts`
- `src/api/reviewApi.ts`

Focus on:
- `externalWorkflowMode`
- create/save task payloads
- submit/return request payloads
- whether `title` is sent during save vs submit

### Simulator / 仿 PMS consumption
- `src/debug/pmsReviewSimulator.ts`

Focus on:
- `attachWorkflowTitle`
- title fallback order
- where `current_node`, `task_status`, and `models` are read from the workflow snapshot
- whether the simulator prefers `workflow/sync` data over local task detail

### Contract / architecture docs
- `docs/verification/pms-3d-review-integration-e2e.md`
- `开发文档/三维校审/新的三维校审流程分析.md`
- `开发文档/三维校审/新的三维校审流程简版.md`
- `开发文档/三维校审/编校审交互接口设计.md`
- `开发文档/三维校审/三维校审代码审核报告-2026-03-24.md`

Focus on:
- the separation between `task_id` and `form_id` chains
- `query` vs `active/agree/return/stop`
- the role of `notify_workflow_sync_async`
- known limitations such as fire-and-forget behavior

## Source-of-Truth Rules

- Treat code in `src/debug/pmsReviewSimulator.ts` as source of truth for how the simulator consumes a response, not for how the backend constructs that response.
- Treat architecture and verification docs as evidence for intended design and previously observed behavior, not as absolute proof of current backend implementation.
- Treat backend-specific details such as the exact source of `workflow/sync.data.title` as unverified unless this repository contains direct proof.

## Output Expectations

Every worker output should clearly label:
- Proven in this repo
- Plausible but not proven in this repo
- Requires backend verification

The final synthesis should give the orchestrator a clean explanation suitable for the user plus a short backend investigation checklist.
