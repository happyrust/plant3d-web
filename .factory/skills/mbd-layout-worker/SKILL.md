---
name: mbd-layout-worker
description: Implement frontend-first deterministic MBD branch layout, hint normalization, lane assignment, and focused regression tests for plant3d-web.
---

# mbd-layout-worker

Use this skill for implementation features in the MBD layout consistency mission.

## Scope
- Extract pure branch-level layout logic from `useMbdPipeAnnotationThree`
- Integrate deterministic layout into dimension and auxiliary annotation rendering
- Update `MbdLayoutHint` typing for backward-compatible optional fields
- Add or update focused unit and fixture tests that prove deterministic behavior

## Procedure

1. Read mission artifacts first:
   - mission `AGENTS.md`
   - mission `validation-contract.md`
   - mission `features.json`
2. Read repo mission library docs:
   - `.factory/library/architecture.md`
   - `.factory/library/environment.md`
   - `.factory/library/mbd-layout-testing.md`
   - `.factory/library/mbd-layout-contract.md`
3. Characterize the current behavior before implementation:
   - inspect `src/composables/useMbdPipeAnnotationThree.ts`
   - inspect `src/api/mbdPipeApi.ts`
   - inspect existing regression tests in `src/composables/useMbdPipeAnnotationThree.flyTo.test.ts` and `src/fixtures/bran-test-data.test.ts`
4. Prefer TDD for new pure-layout logic:
   - add focused tests first when introducing new helpers or modules
   - keep assertions semantic: same-side, lane ordering, camera independence, override precedence
5. Implement the smallest cohesive change set that satisfies the assigned feature.
6. Run mission-scoped validation:
   - `npm run type-check`
   - focused eslint from `.factory/services.yaml`
   - mission-scoped Vitest files from `.factory/services.yaml`
   - any new focused tests added for pure layout modules
7. In the handoff, map implemented behavior to the feature's claimed assertion ids and call out any residual gaps.

## Implementation Guidance

- Keep `useMbdPipeAnnotationThree` as the public entrypoint; refactor under it.
- Move primary placement decisions into pure functions where possible.
- Demote camera-sensitive direction resolution to a true fallback path.
- Preserve manual session overrides as higher priority than auto-layout.
- Do not widen scope into unrelated viewer, Dock, PMS, or backend work.

## Return to Orchestrator When

- The feature requires backend producer changes outside this repo
- The BRAN-specific regression target cannot be reproduced and blocks meaningful evidence
- Unexpected concurrent edits appear in the same mission-owned files
- Focused mission validators fail for unrelated baseline reasons and you need a scope decision
