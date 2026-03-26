# PMS Review Simulator Design

**Date:** 2026-03-25
**Scope:** `pms-review-simulator.html`, `src/debug/pmsReviewSimulator.ts`

## Goal

Keep the simulator as a pure HTML debugging page, but reshape it so the user experience matches the old PMS review page more closely:

- PMS-style list page and toolbar
- first-layer modal with `left iframe + right workflow panel`
- second-layer confirm modal for `active / agree / return / stop`
- bottom diagnostics demoted to support-only feedback

## Product Direction

- Preserve the current simulator positioning; do not migrate this page into the formal Vue review surface.
- Favor old PMS visual language over modern dashboard styling.
- Make the overall flow feel closer to the legacy PMS interaction model, not just one panel.

## Approved UX Structure

### 1. List Page

- Keep the left dark navigation, breadcrumb header, role switch, toolbar, and task table.
- Push the page further toward PMS legacy styling rather than introducing modern cards or dashboard widgets.
- Keep the bottom diagnostics workspace, but remove the main workflow action entrypoints from it.

### 2. First-Layer Main Modal

- Open from `新增`, `查看`, or row double-click.
- Keep a large centered dialog.
- Split the body into two fixed regions:
  - left: embedded plant3d iframe
  - right: PMS-style workflow side panel
- Keep top actions for refresh/reopen and close.

### 3. Right Workflow Side Panel

Two panel modes:

- **Initiate mode**
  - package/basic info
  - description / opinion input
  - component area
  - attachment placeholder
  - primary `发起` action

- **Review mode**
  - current workflow node
  - summary of recent history / current state
  - comment input
  - actions: `同意 / 驳回 / 终止`

The side panel is the primary interaction surface once the modal opens.

### 4. Second-Layer Confirm Modal

The first-layer action buttons do not submit directly. They open a second dialog:

- `active` / `agree`: confirmation dialog with comments
- `return`: confirmation dialog with target node and return reason
- `stop`: destructive confirmation dialog with required reason emphasis

Only the second-layer dialog performs the final request.

### 5. Diagnostics Area

The bottom diagnostics area remains for debugging and verification, but not as the main UX path.

It should continue showing:

- task and form context
- workflow snapshot summary
- latest workflow action result
- timestamps / backend response hints

It should no longer own any authoritative workflow form input. The current diagnostics textarea/buttons are removed from the primary state graph; the authoritative inputs move to:

- first-layer right panel comment field
- second-layer confirm dialog fields

## State Model

The page should keep one shared source of truth in `src/debug/pmsReviewSimulator.ts`:

- list and selected task state
- iframe meta/open state
- diagnostics state
- workflow result state
- new first-layer modal side-panel mode
- new second-layer dialog form state

Recommended additions:

- `sidePanelMode: 'initiate' | 'workflow' | 'readonly'`
- `workflowDialog: { open, action, comment, targetNode, submitting }`
- `sidePanelDraftComment`
- `workflowNodeRaw`
- `lastSubmittedWorkflowComment`

### Authoritative Input Ownership

- Delete the current diagnostics-owned workflow textarea/buttons as authoritative inputs from both markup and runtime state.
- The new authoritative input ownership is:
  - first-layer side panel draft comment
  - second-layer dialog draft comment
  - second-layer dialog selected return target
- Diagnostics only mirrors the final submitted values and results after the action completes.

### DOM Strategy

- Use explicit, always-present DOM sections for `initiate`, `workflow`, and `readonly` panel regions.
- Toggle them with `hidden`/class state instead of rebuilding panel HTML from scratch.
- Keep TypeScript on fixed `getEl(...)` refs for maintainability and parity with the existing simulator style.

### Side Panel Mode Matrix

- `新增` entry -> `initiate`
- `查看` / row double-click + role `SJ` + missing `form_id` -> `initiate`
- `查看` / row double-click + role `SJ` + existing `form_id` -> `workflow`
- `查看` / row double-click + role `JH` / `SH` / `PZ` + existing `form_id` -> `workflow`
- any open state with missing task context but existing iframe -> `readonly`
- any failure/loading fallback where actions should be hidden but context still needs to render -> `readonly`

`readonly` means:

- show context, current node/status, and latest feedback
- show an informational textarea/value block as read-only only
- hide mutation buttons
- keep only close / reopen / refresh style actions

For `新增`, the panel starts in `initiate` with editable comment/input placeholders even before `form_id` is resolved. If embed resolution later provides a `form_id`, the panel may remain in `initiate` until the user performs a workflow action.

### Return Action Contract

The simulator keeps the existing `workflow/sync` contract and does **not** add a backend `targetNode` field.

- The return dialog still exposes a target node selector for PMS-like UX.
- Allowed options are derived from the same ordered workflow chain used in formal review UI: `sj -> jd -> sh -> pz`, limited to nodes before the current node.
- Current node derivation must normalize raw node ids first (`sj/jd/sh/pz`) before mapping to labels; never derive targets from already-localized text.
- On submit, the selected return target is encoded into the existing `comments` string, for example:
  - `[return->jd 校核] 退回原因...`
- Diagnostics and the first-layer side panel should show both:
  - the selected return target
  - the final comment payload actually sent to `workflow/sync`

This keeps the simulator visually faithful without inventing a new backend contract.

### Comment and Payload Rules

- The first-layer side panel keeps the user-editable draft comment.
- Opening the second-layer dialog prefills that draft comment for all actions.
- On confirm, a helper builds the final payload string actually sent to `workflow/sync`.
  - for `active`, `agree`, `stop`: final payload equals trimmed draft comment
  - for `return`: final payload equals encoded string with target node prefix
- After success:
  - the side panel keeps the human-readable draft reason/comment
  - diagnostics and result summary show the exact final payload sent
  - diagnostics also show the selected return target label when applicable

## Modal Layering Rules

- The second-layer dialog must fully block pointer interaction with the iframe and the first-layer right panel while open.
- Closing the first-layer modal force-closes the second-layer dialog.
- `Esc` closes the second-layer dialog first; only when it is closed may it close the first-layer modal.
- Mask click should close only the top-most currently open layer.

## Implementation Boundaries

- Do not change backend contracts.
- Continue using existing task query, embed URL, and `workflow/sync` flows.
- Do not directly mount formal Vue review components into the simulator.
- Prefer reusing field semantics and visual structure from existing review UI, while implementing the simulator surface in plain HTML + TypeScript.

## Verification Targets

The work is done when all four are true:

1. The list page visually feels closer to old PMS.
2. The main modal is clearly `left iframe + right workflow panel`.
3. Workflow actions are completed through a second-layer dialog.
4. Diagnostics still reflect the latest workflow results after submit.

## Risks

- Modal layering and z-index can break if the second dialog does not fully cover the iframe region.
- The current simulator logic couples diagnostics and workflow actions; this needs careful splitting to avoid stale state.
- Because the page remains plain HTML, the implementation should stay focused and avoid recreating too much business-component complexity.
