# PMS Review Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the PMS review simulator into a more legacy-PMS-like pure HTML page with a first-layer `iframe + workflow side panel` modal and a second-layer workflow confirm dialog.

**Architecture:** Keep the simulator in plain HTML + TypeScript. Restructure `pms-review-simulator.html` so the main modal contains the left iframe and right workflow panel, and extend `src/debug/pmsReviewSimulator.ts` with explicit UI state for side-panel mode and second-layer dialog lifecycle while reusing the existing backend APIs.

**Tech Stack:** Vite, TypeScript, plain HTML/CSS, existing review API helpers, browser-native DOM state management

---

## File Map

- Modify: `pms-review-simulator.html`
  - Restyle the list page toward PMS legacy appearance
  - Move workflow controls out of the bottom diagnostics section
  - Add first-layer modal right panel markup
  - Add second-layer confirmation dialog markup
- Modify: `src/debug/pmsReviewSimulator.ts`
  - Add refs for new modal/panel/dialog nodes
  - Introduce side-panel/dialog state
  - Route workflow actions through second-layer dialog
  - Keep diagnostics and post-submit refresh behavior working
- Verify: `pms-review-simulator.html`
- Verify: `src/debug/pmsReviewSimulator.ts`

### Task 1: Reshape the HTML/CSS shell

**Files:**
- Modify: `pms-review-simulator.html`

- [ ] **Step 1: Identify the exact UI blocks to replace**

Inspect and note the current sections in `pms-review-simulator.html`:
- bottom diagnostic workflow button block
- current single-column iframe modal body
- modal/footer/header class structure that can be preserved

Expected outcome: a precise map of which DOM blocks will be removed, kept, or expanded.

- [ ] **Step 2: Rework the diagnostics block to support-only**

Update the bottom diagnostic area so it keeps:
- task/detail query buttons
- workflow result hint area
- diagnostic content container

Remove the workflow action textarea/buttons from this area entirely. The old diagnostics inputs must no longer participate in the state graph or submission flow.

Expected outcome: diagnostics remains visible but no longer presents the primary workflow action entry.

- [ ] **Step 3: Add first-layer side-panel containers with explicit readonly/initiate/workflow regions**

The right panel markup should have explicit containers or sections for:
- common task/meta summary
- initiate-only fields/actions
- workflow-only fields/actions
- readonly-only feedback
- latest submitted payload/result summary

Keep these sections always present in the DOM and toggle visibility with classes/attributes; do not switch to fully dynamic innerHTML rendering for the modal side panel.

Expected outcome: the TS layer can toggle modes without rebuilding large HTML strings ad hoc.

- [ ] **Step 4: Replace the single-body iframe modal with two-column structure**

Inside `#iframe-modal`, create a main body that includes:
- left iframe region
- right PMS-style workflow panel region

The right panel should include placeholders/containers for:
- panel title and meta
- package info / current node / status summary
- comments textarea
- component list area
- attachment placeholder
- action buttons
- latest action feedback

Expected outcome: the first-layer modal shell is structurally ready for state-driven rendering.

- [ ] **Step 5: Add a second-layer workflow confirm dialog shell**

Add a second modal to `pms-review-simulator.html` with:
- dialog title
- optional target-node selector region
- confirm comment textarea
- cancel / confirm buttons
- result or warning text area

Expected outcome: the page contains a dedicated second-layer dialog above the main iframe modal.

- [ ] **Step 6: Update CSS to match the approved direction**

Adjust styles so the page feels closer to old PMS:
- toolbar/table/surface styling more legacy and less dashboard-like
- modal uses clear layered borders and pale panel surfaces
- right panel reads like a traditional approval sheet
- second-layer dialog is obviously stacked above the first modal

Expected outcome: static markup already looks substantially closer to PMS before state wiring.

### Task 2: Add explicit UI state and rendering paths

**Files:**
- Modify: `src/debug/pmsReviewSimulator.ts`

- [ ] **Step 1: Extend state types for panel/dialog lifecycle**

Add state for:
- `sidePanelMode`
- workflow dialog open/action/comment/targetNode/submitting
- parent modal open state
- side-panel draft comment
- dialog draft comment
- last submitted payload text
- normalized current workflow node id
- any derived labels needed for panel rendering

Use this explicit mode matrix:
- `新增` -> `initiate`
- `查看` / double-click + role `SJ` + missing `form_id` -> `initiate`
- `查看` / double-click + existing `form_id` -> `workflow`
- context missing or action-blocked fallback -> `readonly`

`readonly` must render context + status + latest feedback, keep text read-only, and hide mutation buttons.

Expected outcome: the simulator can distinguish between first-layer and second-layer workflow UI.

- [ ] **Step 2: Delete diagnostics-owned workflow refs/listeners and replace them with new authoritative refs**

Remove or retire the old refs/listeners for:
- `workflowCommentInput`
- `workflowActionActiveBtn`
- `workflowActionAgreeBtn`
- `workflowActionReturnBtn`
- `workflowActionStopBtn`

Replace them with authoritative refs/listeners for:
- first-layer side-panel inputs/buttons
- second-layer dialog inputs/buttons

Expected outcome: workflow mutations can no longer be triggered from the old diagnostics block.

- [ ] **Step 3: Extend refs for the new DOM nodes**

Add `getEl(...)` refs for:
- right panel containers/labels/inputs/buttons
- second-layer dialog root/title/form controls/buttons
- any new hint/result containers

Expected outcome: all new markup is addressable without query-selector sprawl.

- [ ] **Step 4: Introduce render helpers for the new UI**

Create focused render helpers such as:
- `renderSidePanelState()`
- `renderWorkflowDialogState()`
- `deriveSidePanelMode()`
- `normalizeWorkflowNodeId()`
- `buildWorkflowCommentPayload()`

These helpers should:
- infer initiate vs workflow mode from current role/context
- treat `openIframe({ source: 'new' })` as `initiate` even before task context exists
- populate current task/form/node/status information
- keep the button enabled/disabled state coherent
- compute return-target options from normalized raw node ids, not labels
- keep a human-readable side-panel draft comment separate from the final submitted payload string shown in diagnostics

Expected outcome: modal UI updates become explicit and readable instead of being folded into diagnostics rendering.

### Task 3: Route workflow actions through the second-layer dialog

**Files:**
- Modify: `src/debug/pmsReviewSimulator.ts`

- [ ] **Step 1: Replace direct workflow button submission behavior**

Current workflow actions call `executeWorkflowAction(...)` directly. Change this so the first-layer buttons:
- open the second-layer dialog
- preload action/comment/target fields as needed

Expected outcome: no workflow mutation happens until the second-layer dialog confirms.

- [ ] **Step 2: Implement dialog-specific behavior by action**

Support these rules:
- `active` / `agree`: comment-based confirm
- `return`: requires target node and reason
- `stop`: confirm-style warning flow

For `return`, do **not** invent a new backend field. Derive the selectable target nodes from ordered workflow stages `sj -> jd -> sh -> pz`, limited to nodes before the current node, and encode the selection into the existing submitted comment text (example: `[return->jd 校核] 退回设计补充依据`).

Expected outcome: each action presents the correct form shape and copy.

- [ ] **Step 3: Submit from the second-layer dialog and refresh shared state**

On confirm:
- set submitting/loading state
- call the existing workflow mutation request path
- refresh diagnostics snapshot after success
- update first-layer panel result message
- close second-layer dialog on success or keep it open with error on failure

Expected outcome: workflow mutation flow is centralized and visually staged.

- [ ] **Step 4: Keep reopen/close/list interactions coherent**

Verify and fix edge cases for:
- closing the main modal while second-layer dialog is open
- switching roles after a workflow action
- reopening current task/form after dialog use
- preserving or resetting comments appropriately
- making sure the iframe is fully pointer-blocked while the child dialog is open
- ensuring `Esc` and mask clicks only close the top-most layer first

Expected outcome: modal state never gets stranded or visually inconsistent.

- [ ] **Step 5: Implement layered modal interaction mechanics**

Add explicit interaction handling for:
- child dialog backdrop click closes child only
- parent modal backdrop click closes parent only when child is absent
- `Esc` closes child first, then parent
- parent close force-resets child dialog state
- iframe region gets a pointer-blocking overlay/class while child dialog is open

Expected outcome: the second-layer dialog behaves like a real top-most approval modal, not a visual overlay only.

### Task 4: Final polish and verification

**Files:**
- Modify: `pms-review-simulator.html`
- Modify: `src/debug/pmsReviewSimulator.ts`

- [ ] **Step 1: Polish copy and PMS-like affordances**

Tighten labels and button order so they read like a legacy approval workflow:
- clearer titles
- more traditional button semantics
- simpler helper text in the diagnostics section

Expected outcome: the simulator reads as one coherent PMS-like surface rather than a debug prototype.

- [ ] **Step 2: Run focused verification**

Run:

```bash
npm run type-check
```

Expected: PASS

If type-check fails because of unrelated repository issues, capture whether the new simulator files are implicated.

- [ ] **Step 3: Manual validation in the simulator**

Open:

```text
http://127.0.0.1:3101/pms-review-simulator.html
```

Verify:
- list page still loads
- row double-click opens the first-layer modal
- `新增` opens initiate mode correctly without task context
- first-layer modal shows left iframe + right workflow panel
- right-panel actions open the second-layer dialog
- confirm flow updates diagnostics/latest result areas
- `重开当前` still works
- role switch resets or safely closes layered modal state
- `重开最近 form_id` still works
- diagnostics refresh still works through `查任务详情 / 查 form_id 聚合`
- failed workflow submission keeps useful feedback visible and does not leave loading state stuck

Expected outcome: approved behavior is visible in the running page.

- [ ] **Step 4: Summarize residual risks**

Record any remaining issues, especially:
- exact PMS visual differences still not matched
- dialog layering quirks
- workflow edge cases not covered in manual verification

Expected outcome: clear handoff notes for reviewer/user.
