---
name: designer-tracking-worker
description: Execute annotation refactor designer list/detail/resubmit continuity features with task-scoped draft isolation.
---

# designer-tracking-worker

## When to Use

Use this skill for milestone leaves that change designer main list, returned-task panel, detail reload, resubmit continuity, or designer-side task-scoped draft isolation.

## Required Reading Order

1. mission `mission.md`
2. mission `validation-contract.md`
3. mission `features.json`
4. mission `validation-state.json`
5. `.factory/library/architecture.md`
6. `.factory/library/environment.md`
7. `.factory/library/user-testing.md`
8. `.factory/library/reviewsnapshot-restore-notes.md`

## Procedure

1. Restate the assigned leaf feature ID and owned assertion IDs before editing.
2. Map the designer main list, returned-task list, detail, and resubmit flow before touching state or UI.
3. Use TDD first for deterministic returned-task recognition, ordering, lineage preservation, and task-scoped draft keys.
4. Keep same-task continuity explicit: return/resubmit loops advance the same `taskId` and preserve confirmed evidence lineage.
5. Verify both authoritative history reload and fallback-on-failure behavior in detail surfaces.
6. Run mission-scoped verification before handoff:
   - `npm run type-check`
   - `npm run lint`
   - focused vitest for designer tracking/state changes
7. Perform browser validation for main list, returned-task panel, detail, resubmit, and task-switching flows.
8. Stop processes you started and preserve unrelated dirty files.

## Example Handoff JSON

```json
{
  "featureId": "M6-F2-designer-returned-task-continuity-and-draft-isolation",
  "assertionsCovered": ["VAL-DESIGN-003", "VAL-DESIGN-015"],
  "salientSummary": "Kept returned-task continuity on the same task while isolating designer drafts by task scope.",
  "verification": {
    "commandsRun": [
      { "command": "npm run type-check", "exitCode": 0 },
      { "command": "npm run lint", "exitCode": 0 }
    ],
    "interactiveChecks": [
      { "action": "Opened returned task, resubmitted it, and refreshed detail", "observed": "The same task advanced back into review flow and returned-only UI cleared." }
    ]
  },
  "filesChanged": [
    "src/components/task/TaskDetail.vue"
  ],
  "returnToOrchestrator": false
}
```

## Return to Orchestrator When

- canonical returned-task recognition conflicts with the frozen workflow semantics
- same-task continuity would require cloning or mutating unrelated task data
- validation is blocked by missing returned-task fixtures or unavailable local services
- assertion ownership would overlap with reviewer-side draft isolation features
