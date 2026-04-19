---
name: review-frontend-worker
description: Implement annotation refactor frontend features in plant3d-web (Vue 3 + TypeScript)
---

# Review Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Frontend-only features in the annotation refactor: ReviewSnapshot types/adapters, comment thread store, restore unification, confirmed record replay, task-scoped drafts, dual-layer rendering, feature flags, annotation UI changes.

## Required Skills

- `agent-browser` — For browser-based verification of reviewer/designer UI flows. Invoke after implementation to manually verify key user interactions.

## Work Procedure

1. **Read the feature description** carefully. Identify which files need changes from `.factory/library/architecture.md`.

2. **Write tests first (RED)**:
   - Create or update test files matching `src/**/*.test.ts`
   - Write failing tests covering: happy path, error states, empty states, boundary conditions
   - Run `npm test -- --run --reporter=verbose` and confirm new tests fail (pre-existing 43 failures are OK)

3. **Implement to pass tests (GREEN)**:
   - Follow existing patterns in the codebase (composables, component structure)
   - Use TypeScript strictly — no `any` types without justification
   - Keep ReviewPanel.vue and useToolStore.ts changes minimal; prefer extracting to new files
   - Use `@/*` path aliases

4. **Run quality gates**:
   - `npm run type-check` — MUST pass with zero errors
   - `npm run lint` — MUST pass
   - `npm test -- --run` — No NEW failures beyond 43 pre-existing

5. **Browser verification** (when feature has UI changes):
   - Invoke `agent-browser` skill
   - Start frontend if not running: services.yaml has the commands
   - Navigate to http://localhost:3101
   - Test the specific UI flows affected by this feature
   - Record each check as an `interactiveChecks` entry

6. **Commit** with conventional commit format: `feat(review): ...` or `test(review): ...`

## Example Handoff

```json
{
  "salientSummary": "Implemented ReviewSnapshot type definitions and task-restore adapter. Wrote 12 tests covering snapshot construction from confirmed records, empty-task handling, and stale-state clearing. All type-check/lint/test pass. Browser-verified task restore shows annotations correctly.",
  "whatWasImplemented": "Added src/review/domain/reviewSnapshot.ts with ReviewSnapshot interface and builder. Added src/review/adapters/reviewRecordAdapter.ts converting confirmed records to ReviewSnapshot. Updated confirmedRecordsRestore.ts to use the new adapter path.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm run type-check", "exitCode": 0, "observation": "Zero errors" },
      { "command": "npm run lint", "exitCode": 0, "observation": "No warnings" },
      { "command": "npm test -- --run", "exitCode": 1, "observation": "843 passed, 43 failed (all pre-existing), 12 new tests pass" }
    ],
    "interactiveChecks": [
      { "action": "Selected task in reviewer inbox", "observed": "Workbench hydrated with task context, confirmed records replayed into 3D scene" },
      { "action": "Switched from task with records to empty task", "observed": "Scene cleared correctly, no stale annotations visible" }
    ]
  },
  "tests": {
    "added": [
      { "file": "src/review/domain/reviewSnapshot.test.ts", "cases": [
        { "name": "builds snapshot from confirmed records", "verifies": "ReviewSnapshot construction" },
        { "name": "handles empty record list", "verifies": "Empty state" },
        { "name": "deduplicates annotations across records", "verifies": "Dedupe logic" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature requires backend API changes not yet implemented
- useToolStore.ts changes would exceed 50 lines (may need architectural guidance)
- Pre-existing test failures increase beyond 43 baseline
- Feature flag interaction with other features is unclear
