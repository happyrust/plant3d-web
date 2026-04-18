---
name: review-workbench-worker
description: Execute annotation refactor workbench-shell and restore-entry features for reviewer surfaces in plant3d-web.
---

# review-workbench-worker

## When to Use

Use this skill for milestone leaves that change reviewer inbox/workbench entry, embedded reopen behavior, workflow action shells, normalized task context display, or workflow history continuity.

## Required Reading Order

1. mission `mission.md`
2. mission `validation-contract.md`
3. mission `features.json`
4. mission `validation-state.json`
5. `.factory/library/architecture.md`
6. `.factory/library/environment.md`
7. `.factory/library/user-testing.md`
8. `.factory/library/reviewsnapshot-restore-notes.md`
9. `.factory/library/trace-frontend-task-sync-boundaries.md`

## Procedure

1. Restate the assigned leaf feature ID and the exact assertion IDs it owns before editing anything.
2. Inspect current reviewer entry/workbench files and identify the minimum surface required for the owned assertions.
3. Use focused TDD first for any logic change with deterministic state transitions.
4. Keep normalized task semantics explicit: `formId` fallback states must be shown, not guessed; legacy reviewer fields remain compatibility inputs only.
5. Treat embedded reopen and workflow history refresh as restore/state-management work, not as a reason to expand into unrelated UI redesign.
6. Run mission-scoped verification before handoff:
   - `npm run type-check`
   - `npm run lint`
   - focused vitest or browser checks tied to the owned assertions
7. Perform manual verification for any browser-owned assertion set and capture screenshots/network evidence.
8. Stop processes you started and leave unrelated dirty files untouched.

## Example Handoff JSON

```json
{
  "featureId": "M2-F1-reviewer-workbench-entry-and-workflow-shell",
  "assertionsCovered": ["VAL-REVIEW-001", "VAL-REVIEW-002"],
  "salientSummary": "Normalized reviewer inbox/workbench entry and workflow shell behavior for embedded reopen and history refresh.",
  "verification": {
    "commandsRun": [
      { "command": "npm run type-check", "exitCode": 0 },
      { "command": "npm run lint", "exitCode": 0 }
    ],
    "interactiveChecks": [
      { "action": "Reopened reviewer surface from embedded formId path", "observed": "Explicit mapped/unmapped/no-form states rendered correctly." }
    ]
  },
  "filesChanged": [
    "src/components/review/ReviewPanel.vue"
  ],
  "returnToOrchestrator": false
}
```

## Return to Orchestrator When

- a required assertion would force editing unrelated dirty files
- embedded reopen semantics conflict with the frozen mission contract
- backend/service availability blocks validation on ports 3100 or 3101
- assertion ownership would need to move across features to avoid duplication
