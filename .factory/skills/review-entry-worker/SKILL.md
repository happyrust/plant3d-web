---
name: review-entry-worker
description: Implement M2 reviewer entry unification, workflow action cleanup, and inbox/workbench contract alignment for plant3d-web.
---

# review-entry-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for M2 reviewer-entry mission features in `plant3d-web`.

## When to Use This Skill

Use this skill for features that touch:
- `src/components/review/ReviewerTaskList.vue`
- `src/components/review/WorkflowSubmitDialog.vue`
- `src/components/review/WorkflowReturnDialog.vue`
- `src/components/review/ReviewPanel.vue` when the change is specifically about entry, task switching, or workflow actions
- `src/composables/useReviewStore.ts`
- `src/composables/useUserStore.ts`
- `src/api/reviewApi.ts` workflow endpoints and normalization
- reviewer-entry tests, workflow action tests, and M2 docs under `开发文档/三维校审`

## Work Procedure

1. Read mission context first:
   - mission `mission.md`
   - mission `AGENTS.md`
   - `features.json`
   - `.factory/library/architecture.md`
   - `.factory/library/environment.md`
   - `.factory/library/user-testing.md`
2. Inspect the current reviewer-entry chain before editing:
   - `src/components/review/ReviewerTaskList.vue`
   - `src/components/review/WorkflowSubmitDialog.vue`
   - `src/components/review/WorkflowReturnDialog.vue`
   - `src/components/review/reviewerTaskListActions.ts` and related tests
   - `src/components/review/ReviewPanel.vue`
   - `src/composables/useReviewStore.ts`
   - `src/composables/useUserStore.ts`
   - `src/api/reviewApi.ts`
3. Follow TDD strictly:
   - write or update failing focused tests first
   - confirm the test fails for the targeted reviewer-entry behavior
   - implement the smallest change that makes the test pass
4. Keep M2 boundaries explicit:
   - the main reviewer path is inbox -> select task -> workbench -> submit/return
   - new behavior should prefer `/submit` and `/return`
   - any old `/start-review`, `/approve`, or `/reject` compatibility must remain visible and intentional
5. Do not leave workflow truth ambiguous:
   - if you touch `currentNode`, `status`, or `reviewerId` compatibility, update tests so the final behavior is explicit
   - if the UI text depends on node semantics, make the mapping testable
6. When editing the reviewer UI, verify it against `ui/三维校审/review-reviewer.pen`; use `ui/三维校审/review-flow.pen` only to sanity-check cross-role transitions.
7. If the feature affects task selection, current-task hydration, or websocket subscription behavior, verify both initial entry and task switching behavior.
8. Run targeted verification before handoff:
   - `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 run type-check`
   - read-only lint on changed review files (no `--fix`)
   - focused Vitest files for reviewer entry, review API, and affected store logic
9. Perform manual verification on the live app:
   - open `http://127.0.0.1:3101/`
   - click a project card to enter the main UI
   - open or navigate to the reviewer-facing review entry surface
   - validate at least one task selection plus one workflow action path or the nearest available smoke equivalent
10. If docs are part of the feature, keep M2 task/checklist wording aligned with the actual workflow behavior that shipped.
11. Stop any extra processes you start and do not leave test runners or browser sessions running.

## Example Handoff

```json
{
  "salientSummary": "Unified the reviewer entry path around the inbox and standard workflow dialogs, removed hidden start-review assumptions from the main path, and tightened the tests around workflow action semantics.",
  "whatWasImplemented": "Updated ReviewerTaskList, workflow dialogs, and the related store/API helpers so reviewer entry consistently flows from inbox selection into the workbench using explicit submit/return actions. Clarified compatibility handling for reviewerId/currentNode/status in code and tests, and aligned the M2 documentation with the shipped reviewer-entry behavior.",
  "whatWasLeftUndone": "The final cleanup of legacy approve/reject endpoints remains deferred because the confirmed M2 scope keeps them as compatibility paths rather than removing them outright.",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 run type-check",
        "exitCode": 0,
        "observation": "Type-check passed after reviewer entry action and workflow mapping changes."
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && npx eslint src/components/review/ReviewerTaskList.vue src/components/review/WorkflowSubmitDialog.vue src/components/review/WorkflowReturnDialog.vue src/components/review/ReviewPanel.vue src/composables/useReviewStore.ts src/composables/useUserStore.ts src/api/reviewApi.ts",
        "exitCode": 0,
        "observation": "Targeted read-only lint passed for the changed M2 files."
      },
      {
        "command": "cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && npx vitest run src/components/review/reviewerTaskListActions.test.ts src/api/reviewApi.test.ts src/composables/useReviewStore.websocket.test.ts",
        "exitCode": 0,
        "observation": "Focused M2 tests passed, covering reviewer entry actions, workflow API behavior, and current-task websocket subscription semantics."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened http://127.0.0.1:3101/, clicked a project card, and navigated to the reviewer-facing entry surface.",
        "observed": "The app shell, dock layout, and review-related menus loaded successfully, confirming that reviewer-entry smoke validation is executable in the local environment."
      },
      {
        "action": "Selected a review task from the inbox and triggered the primary workflow dialog path.",
        "observed": "The selected task hydrated into the workbench context and the submit/return path used the standard dialog flow instead of an implicit legacy action."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "/Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2/src/components/review/reviewerTaskListActions.test.ts",
        "cases": [
          {
            "name": "reviewer entry prefers standard workflow actions",
            "verifies": "The main reviewer path uses submit/return semantics rather than silently depending on a legacy start-review action."
          },
          {
            "name": "task selection hydrates reviewer workbench context consistently",
            "verifies": "Selecting a task from the inbox maps the current task, action labels, and entry semantics in a stable way."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "non_blocking",
      "description": "Some local review task fixtures still populate `reviewerId` as a checker alias, so user-facing reviewer naming can remain confusing until the broader compatibility window closes.",
      "suggestedFix": "Introduce explicit local fixtures that separate checker and reviewer compatibility cases so UI labels and permissions can be validated independently."
    }
  ]
}
```

## When to Return to Orchestrator

- The feature needs a workflow or permission decision that is not fixed in the mission (for example, whether start-review remains user-visible or becomes fully internal).
- Existing local changes in the mission worktree overlap with the same reviewer-entry files and cannot be safely separated.
- Validation is blocked because the reviewer-facing UI surface cannot be reached from the approved local entry path.
- The requested work spills into M4 workbench restructuring or M3 designer tracking beyond the confirmed M2 milestone.
