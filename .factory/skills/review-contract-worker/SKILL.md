---
name: review-contract-worker
description: Document and freeze annotation refactor contracts, terminology, and migration boundaries
---

# Review Contract Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

M1 contract freeze features: terminology documentation, field mapping tables, compatibility window rules, feature flag setup, annotationKey v1 generation code, migration boundary definitions.

## Required Skills

None — contract work produces documentation and lightweight code artifacts.

## Work Procedure

1. **Read reference documents**:
   - Mission description and all referenced development plan documents
   - `.factory/library/architecture.md` for current system architecture
   - Existing code in `src/components/review/`, `src/composables/useToolStore.ts`, `src/composables/useReviewStore.ts`
   - Backend API in `D:\work\plant-code\plant-model-gen\src\web_api\review_api.rs`

2. **Produce contract artifacts**:
   - Terminology table with authoritative definitions
   - Field mapping between frontend and backend
   - Compatibility window rules (what old/new clients see)
   - Feature flag definitions in `src/review/flags.ts`

3. **Implement annotationKey v1** (if in scope):
   - Create `src/review/domain/annotationKey.ts` with key generation
   - Create `src/review/domain/annotationKey.test.ts` with tests
   - Follow the v1 strategy from the supplementary document

4. **Run quality gates**:
   - `npm run type-check`
   - `npm run lint`
   - `npm test -- --run`

5. **Commit** with `chore(review): ...` for docs or `feat(review): ...` for code

## Example Handoff

```json
{
  "salientSummary": "Froze annotation refactor terminology table and field mapping. Created annotationKey v1 generation with 8 tests. Feature flag skeleton in src/review/flags.ts. All quality gates pass.",
  "whatWasImplemented": "Created src/review/domain/annotationKey.ts with sha1-based key generation. Created src/review/flags.ts with flag constants for all phases. Updated .factory/library/ with terminology table.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm run type-check", "exitCode": 0, "observation": "Zero errors" },
      { "command": "npm test -- --run", "exitCode": 1, "observation": "843 passed + 8 new, 43 pre-existing failures" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "src/review/domain/annotationKey.test.ts", "cases": [
        { "name": "generates stable key for text annotation", "verifies": "Key stability" },
        { "name": "different positions produce different keys", "verifies": "Key uniqueness" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Backend team disagrees on field naming conventions
- Compatibility window rules conflict with existing deployed clients
- annotationKey v1 collision rate exceeds acceptable threshold
