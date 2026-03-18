---
name: review-collaboration-worker
description: Implement task-thread and annotation-thread collaboration contracts, APIs, refresh behavior, and UI for the M7 reviewer/designer collaboration mission.
---

# review-collaboration-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure for M7 collaboration features in `plant3d-web`.

## When to Use This Skill

Use this skill for features that touch:
- `src/components/review/ReviewCommentsPanel.vue`
- collaboration state in `src/composables/useReviewStore.ts`
- collaboration contracts in `src/api/reviewApi.ts` and related shared types
- task-thread / annotation-thread UI integration
- mentions, attachments, unread state, resolve/unresolve, and targeted refresh behavior

## Work Procedure

1. Read mission context first:
   - mission `mission.md`
   - mission `AGENTS.md`
   - `validation-contract.md`
   - `features.json`
   - `.factory/library/architecture.md`
   - `.factory/library/environment.md`
   - `.factory/library/user-testing.md`
   - `.factory/library/m6-m7-review-collaboration.md`
2. Inspect the current collaboration path before editing:
   - `src/components/review/ReviewCommentsPanel.vue`
   - `src/composables/useReviewStore.ts`
   - `src/api/reviewApi.ts`
   - relevant shared types and designer/reviewer integration points
3. Write failing tests first (red). Cover contract shape, UI behavior, and refresh behavior before implementation.
4. Implement the smallest change that makes tests pass while keeping task-thread and annotation-thread semantics explicit and separate.
5. Do not let message attachments collapse into existing task attachment semantics. Keep message/thread payload ownership clear.
6. Prefer quasi-real-time targeted refresh behavior over broad architectural churn unless the feature explicitly requires more.
7. Run targeted validation before handoff:
   - focused Vitest files
   - `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check`
   - focused `npx eslint <files>`
8. Perform manual verification in browser on seeded tasks for both thread scopes, recording each meaningful collaboration flow in `interactiveChecks`.
9. Stop any ad hoc services/processes you start unless a validator is explicitly reusing them.

## Example Handoff

```json
{
  "salientSummary": "Implemented explicit task-thread and annotation-thread collaboration with reply/edit/delete, resolve/unresolve, mentions, attachments, and targeted refresh updates for the active review surfaces.",
  "whatWasImplemented": "Added separate task-thread and annotation-thread contracts to the review API/store path, updated ReviewCommentsPanel to render the correct scope with message actions and attachment support, and added targeted refresh hooks so active collaboration views and unread badges update without full page reload. Kept task-thread and annotation-thread UI entry points explicit rather than collapsing them into one mixed panel.",
  "whatWasLeftUndone": "Unread aggregation across very large thread histories is functional but not yet optimized for huge datasets; pagination follow-up can address that if needed.",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web test -- src/api/reviewApi.test.ts src/composables/useReviewStore.websocket.test.ts src/components/review/ReviewCommentsPanel.test.ts",
        "exitCode": 0,
        "observation": "Focused collaboration tests passed, covering dual-scope contracts, refresh updates, mentions, and attachment metadata."
      },
      {
        "command": "npm --prefix /Volumes/DPC/work/plant-code/plant3d-web run type-check",
        "exitCode": 0,
        "observation": "Type-check passed after collaboration contract and UI changes."
      },
      {
        "command": "npx eslint src/components/review/ReviewCommentsPanel.vue src/api/reviewApi.ts src/composables/useReviewStore.ts --max-warnings 0",
        "exitCode": 0,
        "observation": "No lint violations in collaboration-owned files."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened a seeded reviewer task, added replies in task-thread, resolved the thread, and refreshed only the collaboration region.",
        "observed": "Task-thread showed the new replies, resolve state, and unread badge updates without requiring a full page reload."
      },
      {
        "action": "Selected a canonical annotation, opened annotation-thread, added a mention and message attachment, then opened the same task in the designer surface.",
        "observed": "Designer saw the same annotation-thread continuity with mention markup and attachment metadata preserved."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "/Volumes/DPC/work/plant-code/plant3d-web/src/components/review/ReviewCommentsPanel.test.ts",
        "cases": [
          {
            "name": "task-thread and annotation-thread render different scope entry points",
            "verifies": "UI keeps collaboration scopes explicit rather than mixing them."
          },
          {
            "name": "thread actions update active view through targeted refresh",
            "verifies": "Reply/edit/delete/resolve flows refresh the affected collaboration surface without full reload."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Collaboration requires a backend schema or message lifecycle decision that is not specified in the mission.
- Stable annotation identity is missing, preventing correct annotation-thread lineage.
- Attachment or mention scope would leak beyond the approved task-participant boundaries.
- Seeded collaboration tasks are not available for manual validation.
