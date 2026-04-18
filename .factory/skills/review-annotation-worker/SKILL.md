---
name: review-annotation-worker
description: Execute annotation refactor features for replay, confirmation, task-scoped drafts, and dual-layer rendering in plant3d-web.
---

# review-annotation-worker

## When to Use

Use this skill for milestone leaves that change annotation replay/restore, reviewer direct-launch actions, confirmation payloads, task-scoped drafts, or draft-vs-confirmed rendering behavior.

## Required Reading Order

1. mission `mission.md`
2. mission `validation-contract.md`
3. mission `features.json`
4. mission `validation-state.json`
5. `.factory/library/architecture.md`
6. `.factory/library/environment.md`
7. `.factory/library/user-testing.md`
8. `.factory/library/reviewsnapshot-restore-notes.md`
9. `.factory/library/review-annotations.md`

## Procedure

1. Restate the assigned leaf feature ID and owned assertion IDs before implementation.
2. Map current replay, confirmation, and draft storage seams before changing UI copy or viewer behavior.
3. Use TDD first for replay/adapter/store changes, especially dedupe, measurement filtering, task-scoped persistence, and layer separation.
4. Preserve canonical reviewer semantics (`text`, `cloud`, `rect`) and keep legacy OBB behavior out of reviewer-facing primary semantics.
5. Validate both persisted payload shape and visible scene behavior; neither alone is sufficient.
6. For dual-layer work, explicitly verify that confirmed state stays visible while confirm actions only consume the draft layer.
7. Run mission-scoped verification before handoff:
   - `npm run type-check`
   - `npm run lint`
   - focused vitest on replay/confirmation/draft files
8. Perform browser validation for the owned reviewer/designer flows and capture evidence per assertion.
9. Stop processes you started and preserve unrelated dirty files.

## Example Handoff JSON

```json
{
  "featureId": "M6-F1-reviewer-draft-isolation-and-confirm-entry",
  "assertionsCovered": ["VAL-REVIEW-033", "VAL-REVIEW-034"],
  "salientSummary": "Scoped reviewer draft state to the active task and updated confirmation entry to respect draft-only changes.",
  "verification": {
    "commandsRun": [
      { "command": "npm run type-check", "exitCode": 0 },
      { "command": "npx vitest run src/components/review src/composables --passWithNoTests", "exitCode": 0 }
    ],
    "interactiveChecks": [
      { "action": "Switched between two reviewer tasks with pending drafts", "observed": "Only the active task restored its own drafts; the other stayed clean." }
    ]
  },
  "filesChanged": [
    "src/composables/useReviewStore.ts"
  ],
  "returnToOrchestrator": false
}
```

## Return to Orchestrator When

- stable replay or draft isolation needs backend metadata not yet available in the assigned milestone
- a change would collapse draft and confirmed layers instead of separating them
- validation is blocked by missing reviewer/designer seed data or unavailable services
- assertion ownership would become duplicated across replay and dual-layer features
