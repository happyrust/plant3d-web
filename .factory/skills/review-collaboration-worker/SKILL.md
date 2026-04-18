---
name: review-collaboration-worker
description: Execute annotation refactor collaboration, detached comment-source, contract, and realtime convergence features across review surfaces.
---

# review-collaboration-worker

## When to Use

Use this skill for milestone leaves that change detached annotation-thread behavior, comment/workflow-sync contract handling, or websocket-driven refresh/convergence rules.

## Required Reading Order

1. mission `mission.md`
2. mission `validation-contract.md`
3. mission `features.json`
4. mission `validation-state.json`
5. `.factory/library/architecture.md`
6. `.factory/library/environment.md`
7. `.factory/library/user-testing.md`
8. `.factory/library/reviewsnapshot-restore-notes.md`
9. `.factory/library/workflow-sync-contract-bridge.md`

## Procedure

1. Restate the assigned leaf feature ID and assertion IDs before editing.
2. Identify whether the feature owns browser thread UX, HTTP contract work, realtime convergence, or a mix; keep scope explicit.
3. Use TDD first for deterministic contract adapters/store reducers and focused tests around chronological ordering, merge identity, and refresh targeting.
4. Keep task-thread and annotation-thread semantics separate; do not let detached comment work collapse them into one mixed stream.
5. For contract work, prefer live request/response probes against the backend rather than assumptions.
6. For realtime work, verify endpoint shape, event targeting, reconnect behavior, and heartbeat no-op behavior with browser/network evidence.
7. Run mission-scoped verification before handoff:
   - `npm run type-check`
   - `npm run lint`
   - focused vitest and/or curl/browser checks tied to owned assertions
8. Report explicit contract gaps instead of filling them with guessed frontend behavior.
9. Stop processes you started and preserve unrelated dirty files.

## Example Handoff JSON

```json
{
  "featureId": "M5-F1-review-realtime-convergence",
  "assertionsCovered": ["VAL-CONTRACT-027", "VAL-CONTRACT-028"],
  "salientSummary": "Standardized websocket convergence so record, comment, and history refreshes target the correct review surfaces.",
  "verification": {
    "commandsRun": [
      { "command": "npm run type-check", "exitCode": 0 },
      { "command": "npm run lint", "exitCode": 0 }
    ],
    "interactiveChecks": [
      { "action": "Observed websocket frames during comment add and record save", "observed": "Only the expected thread/record/history refreshes fired; heartbeat stayed inert." }
    ]
  },
  "filesChanged": [
    "src/composables/useReviewStore.ts"
  ],
  "returnToOrchestrator": false
}
```

## Return to Orchestrator When

- backend contract gaps block the owned assertions and need a milestone-level decision
- detached comment identity would duplicate threads across task-context and workflow-sync paths
- websocket payloads cannot support idempotent merge without expanding scope beyond the assigned feature
- services or seeded data needed for validation are unavailable
