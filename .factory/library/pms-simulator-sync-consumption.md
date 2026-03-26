# PMS simulator workflow/sync consumption evidence

## Scope
- Feature: `trace-pms-simulator-sync-consumption`
- Source of truth: `src/debug/pmsReviewSimulator.ts`
- Goal: prove how the simulator consumes `workflow/sync` response fields, especially title precedence, and where it falls back to local task data.

## Proven in this repo

### 1. workflow/sync responses are normalized before any UI render path reads them
- `fetchWorkflowQuery()` stores the `query` result directly into `state.diagnostics.workflowSnapshot` via `requestWorkflowSync(formId, 'query')`. See `src/debug/pmsReviewSimulator.ts:1329` and `src/debug/pmsReviewSimulator.ts:1333`.
- `requestWorkflowSync()` always wraps both the primary and fallback HTTP responses with `attachWorkflowTitle(...)` before returning them. See `src/debug/pmsReviewSimulator.ts:1284`, `src/debug/pmsReviewSimulator.ts:1315`, and `src/debug/pmsReviewSimulator.ts:1325`.

### 2. Title precedence is: `data.title` -> top-level `title` -> default literal, then render code may fall back to local task title only if workflow snapshot is missing
- `attachWorkflowTitle()` computes `title` as `dataTitle || responseTitle || resolveWorkflowTitleFallback()`, where `resolveWorkflowTitleFallback()` returns `'三维校审单'`. It then writes that resolved title back to both `response.title` and `response.data.title`. See `src/debug/pmsReviewSimulator.ts:531`, `src/debug/pmsReviewSimulator.ts:535`, and `src/debug/pmsReviewSimulator.ts:538`.
- Because of that normalization step, once a workflow snapshot exists, downstream render code reads `state.diagnostics.workflowSnapshot?.data?.title || state.diagnostics.workflowSnapshot?.title` and effectively gets the normalized workflow title first. See `src/debug/pmsReviewSimulator.ts:858`.
- The side panel then falls back to local task data only when no workflow title is available at all: `workflowTitle || detail?.title || selected?.title || '三维校审单'`. See `src/debug/pmsReviewSimulator.ts:861`.
- The diagnostics panel uses the same precedence pattern: `workflow?.data?.title || workflow?.title || detail?.title || selected?.title || '三维校审单'`. See `src/debug/pmsReviewSimulator.ts:1042`.
- Therefore the simulator proves the precedence required by `VAL-CONSUME-001`: first `workflow/sync.data.title`, then `workflow/sync.title`, then local task title / selected row title, and finally the default literal.

### 3. `current_node` is consumed from local task detail first, then from workflow snapshot
- `deriveWorkflowNodeRaw()` prefers `state.diagnostics.taskDetail?.currentNode`, then `workflowSnapshot.data.current_node`, then `workflowSnapshot.data.currentNode`. See `src/debug/pmsReviewSimulator.ts:569`.
- `renderSidePanelState()` uses `deriveWorkflowNodeRaw()` and then `getNodeLabel(...)` to display the node label in the side panel metadata. See `src/debug/pmsReviewSimulator.ts:853`, `src/debug/pmsReviewSimulator.ts:865`, and `src/debug/pmsReviewSimulator.ts:897`.
- `renderDiagnostics()` repeats the same precedence explicitly as `detail?.currentNode || workflow?.data?.current_node || workflow?.data?.currentNode || '--'`. See `src/debug/pmsReviewSimulator.ts:1039`.
- This means the simulator does read `workflow/sync.current_node`, but only after local task detail is absent.

### 4. `task_status` is read from workflow snapshot only as a fallback behind local task status
- Helper `getCurrentTaskStatus()` returns `taskDetail.status || workflowSnapshot.data.task_status || workflowSnapshot.data.taskStatus || '--'`. See `src/debug/pmsReviewSimulator.ts:578`.
- `renderDiagnostics()` duplicates that precedence with `detail?.status || workflow?.data?.task_status || workflow?.data?.taskStatus || '--'`. See `src/debug/pmsReviewSimulator.ts:1041`.
- `renderSidePanelState()` currently displays status from local task/selected row only: `detail?.status || selected?.status || 'draft'`, then maps that through `statusLabel(...)`. See `src/debug/pmsReviewSimulator.ts:866`.
- So `workflow/sync.task_status` is consumed in the diagnostics surface and helper logic, but the side panel status badge does not prefer it over local task state.

### 5. `models` is consumed only from workflow snapshot and compared against local task components
- `summarizeWorkflowModels()` reads `workflowSnapshot?.data?.models`, coerces each item to string, trims, and filters empties. See `src/debug/pmsReviewSimulator.ts:827`.
- `renderDiagnostics()` calls that helper, stores the result in `workflowModels`, and displays the count, the list, and set-difference comparisons versus `task.components`. See `src/debug/pmsReviewSimulator.ts:1034`, `src/debug/pmsReviewSimulator.ts:1097`, `src/debug/pmsReviewSimulator.ts:1139`, and `src/debug/pmsReviewSimulator.ts:1147`.
- The side panel component list does not use `workflow/sync.models`; it uses local `task.components` through `collectComponentRefs()`. See `src/debug/pmsReviewSimulator.ts:646` and `src/debug/pmsReviewSimulator.ts:867`.
- Therefore `models` is a diagnostics-only workflow snapshot field in this simulator file.

### 6. `attachments` is also read from workflow snapshot, but only for attachment display / placeholder text
- `collectAttachmentLabels()` reads `state.diagnostics.workflowSnapshot?.data?.attachments`. If absent, it returns a placeholder string saying the UI is reusing `workflow/sync` output. See `src/debug/pmsReviewSimulator.ts:656`.
- `renderSidePanelState()` then renders those labels into the attachment list. See `src/debug/pmsReviewSimulator.ts:868` and `src/debug/pmsReviewSimulator.ts:910`.

## Field-to-UI mapping

| Field | Read location | UI surface | Precedence |
| --- | --- | --- | --- |
| `data.title` / `title` | `attachWorkflowTitle()` and `renderSidePanelState()` / `renderDiagnostics()` | browser document title, side-panel title, diagnostics title | `data.title` -> `title` -> local task title -> default literal |
| `data.current_node` / `data.currentNode` | `deriveWorkflowNodeRaw()` and `renderDiagnostics()` | side-panel node metadata, readonly summary, diagnostics current node | local `taskDetail.currentNode` first, then workflow fields |
| `data.task_status` / `data.taskStatus` | `getCurrentTaskStatus()` and `renderDiagnostics()` | diagnostics task status (helper also exposes same precedence) | local `taskDetail.status` first, then workflow fields |
| `data.models` | `summarizeWorkflowModels()` -> `renderDiagnostics()` | diagnostics count/list/diff blocks | workflow snapshot only |
| `data.attachments` | `collectAttachmentLabels()` -> `renderSidePanelState()` | side-panel attachment list | workflow snapshot only, else placeholder |

## When the simulator falls back to local task data
- Title: falls back to `detail?.title` or `selected?.title` only when no workflow snapshot title survives normalization. See `src/debug/pmsReviewSimulator.ts:861` and `src/debug/pmsReviewSimulator.ts:1042`.
- Current node: falls back to workflow snapshot only when `taskDetail.currentNode` is absent; otherwise local task detail wins. See `src/debug/pmsReviewSimulator.ts:569` and `src/debug/pmsReviewSimulator.ts:1039`.
- Task status: falls back to workflow snapshot only when `taskDetail.status` is absent; otherwise local task detail wins. See `src/debug/pmsReviewSimulator.ts:578` and `src/debug/pmsReviewSimulator.ts:1041`.
- Models: no local fallback for the workflow-model list itself; local task components are shown separately and compared side-by-side. See `src/debug/pmsReviewSimulator.ts:1034` and `src/debug/pmsReviewSimulator.ts:1147`.

## Important boundary: simulator consumption vs backend construction
- This file proves how the simulator consumes the `workflow/sync` payload after receipt and normalization.
- This file does **not** prove how the backend constructs `title`, `current_node`, `task_status`, `models`, or `attachments` inside the response. That remains a backend verification item.

## Requires backend verification
- Exact backend source of `workflow/sync.data.title` and whether it is always populated before top-level `title`.
- Whether backend `task_status` is intended to diverge from local review task status, since the side panel still prefers local task status.
- Whether `models` and `attachments` are authoritative snapshots or lossy summaries relative to task detail.
