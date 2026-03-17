---
name: review-workbench-worker
description: Implement M4 reviewer workbench structure, workflow/records integration, and task-driven auxiliary data behavior for plant3d-web.
---

# review-workbench-worker

NOTE: Startup and cleanup are handled by the mission worker base. This skill defines the work procedure for M4 reviewer-workbench features.

## When to Use This Skill

Use this skill for features that touch:
- `src/components/review/ReviewPanel.vue`
- `src/components/review/ReviewAuxData.vue`
- `src/components/review/ReviewDataSync.vue`
- `src/composables/useReviewStore.ts`
- `src/composables/useUserStore.ts`
- `src/api/reviewApi.ts`
- focused tests/docs for the M4 reviewer workbench milestone

Do not use this skill for M5 annotation-panel decomposition or M6 comment-collaboration work.

## Work Procedure

1. Read mission context first:
   - mission `mission.md`
   - mission `AGENTS.md`
   - mission `validation-contract.md`
   - mission `features.json`
   - `/Volumes/DPC/work/plant-code/plant3d-web/.factory/library/environment.md`
   - `/Volumes/DPC/work/plant-code/plant3d-web/.factory/library/user-testing.md`
   - `/Volumes/DPC/work/plant-code/plant3d-web/.factory/library/m4-review-workbench.md`
2. Inspect the current reviewer workbench chain before editing:
   - `src/components/review/ReviewPanel.vue`
   - `src/components/review/ReviewAuxData.vue`
   - `src/components/review/ReviewDataSync.vue`
   - `src/components/review/reviewPanelActions.ts`
   - `src/composables/useReviewStore.ts`
   - `src/composables/useUserStore.ts`
   - `src/api/reviewApi.ts`
3. Keep M4 boundaries explicit:
   - workbench shell, workflow actions, confirmed records, aux-data/collision, and sync are in scope
   - M5/M6 surfaces are regression boundaries only
4. Use focused TDD where practical:
   - update or add small focused tests first when behavior is being changed materially
   - if a feature is primarily structural and existing tests already cover it, document why new tests were not added
5. Normalize data semantics while editing:
   - prefer `checkerName` / `approverName` over `reviewerName`
   - prefer task/business `formId` over silent `task.id` fallback
   - keep confirmed records, workflow history, and comments separate
6. Validate against the design/document contract:
   - reviewer-facing information architecture should align with `ui/三维校审/review-reviewer.pen`
   - use `review-flow.pen` only to sanity-check cross-role transitions, not to expand scope
7. Run targeted verification before handoff:
   - `npm run type-check`
   - `npx eslint <changed-files>`
   - focused vitest on changed reviewer workbench files
   - if unrelated global `npm test` suites fail outside M4 scope, record them as baseline noise and continue with mission-scoped verification
8. Perform manual smoke validation where feasible:
   - open `http://127.0.0.1:3101/`
   - navigate to the reviewer workbench path
   - verify at least the nearest available M4 smoke flow for the changed surface
9. Stop extra processes you start and do not leave background watchers running.

## Return To Orchestrator If
- the feature requires a contract decision that the mission did not freeze (for example, authoritative `project_id` source)
- seeded reviewer tasks, confirmed records, or ownership prevent validation and require environment setup
- the requested change spills into `AnnotationPanel` decomposition or comment-collaboration redesign
