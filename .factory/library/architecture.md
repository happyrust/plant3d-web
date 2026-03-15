# Three-Review M1-M2 Architecture

## Mission Scope

This mission implements the first two three-review milestones in `plant3d-web`:

- `M1 发起侧闭环`
- `M2 审核入口统一化`

The mission does **not** expand into M3 designer tracking polish, M4 workbench restructuring, M5 annotation decomposition, or M6 comment formalization.

## Source-of-Truth Rules

- Initiation-side product baseline: `ui/三维校审/review-designer.pen`
- Reviewer-entry product baseline: `ui/三维校审/review-reviewer.pen`
- Cross-role handoff sanity-check only: `ui/三维校审/review-flow.pen`
- Task creation and normalization contract: `src/api/reviewApi.ts`, `src/composables/useUserStore.ts`
- Reviewer entry and workbench hydration contract: `src/components/review/ReviewerTaskList.vue`, `src/components/review/ReviewPanel.vue`, `src/composables/useReviewStore.ts`

Workers should update the existing seams above instead of creating parallel flow logic.

## Expected Data Flow

### M1 initiation path
1. Designer enters the main UI and opens the initiation-side review surface.
2. Designer selects components and fills required task metadata.
3. The initiation flow constructs a stable review task payload with explicit role assignments.
4. Backend returns a normalized review task context with `taskId` and, when available, `formId`.
5. Attachment upload waits for stable lineage and then persists against the created task context.

### M2 reviewer entry path
1. Reviewer-facing inbox filters tasks by role and workflow node.
2. Reviewer selects a task from the inbox.
3. The app hydrates that task into the review workspace.
4. Reviewer uses standard submit/return dialogs as the primary workflow action path.
5. Task data and workflow history refresh after mutation so the workbench stays aligned with backend truth.

## Highest-Risk Seams

- `reviewerId` compatibility still masquerading as checker semantics without tests that make it explicit.
- `currentNode` and `status` both influencing reviewer behavior and producing ambiguous workflow entry rules.
- Attachment lineage falling back to the wrong identifier when both `taskId` and `formId` are in play.
- Existing frontend on port `3101` being served from another checkout instead of the mission worktree during validation.
