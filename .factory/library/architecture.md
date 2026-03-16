# M5 Consistency Follow-up Architecture

## Mission Scope

This follow-up mission repairs consistency across the already-implemented M5 designer/reviewer flows in `plant3d-web`.

Primary scope:
- canonical returned-task / resubmittable-task semantics
- designer tracking consistency across list/detail/resubmit surfaces
- cross-flow consistency between designer and reviewer views
- websocket payload normalization and realtime list convergence
- navigation persistence consistency across designer/reviewer/resubmission task lists

This mission does **not** introduce new product features or change backend API contracts.

## Source-of-Truth Rules

- Designer tracking surfaces: `src/components/review/DesignerTaskList.vue`, `src/components/review/ResubmissionTaskList.vue`, `src/components/review/TaskReviewDetail.vue`
- Shared task-state/filter logic: `src/composables/useUserStore.ts`, `src/components/review/reviewTaskFilters.ts`
- Reviewer visibility and actions: `src/components/review/ReviewerTaskList.vue`, `src/components/review/reviewerTaskListActions.ts`
- Realtime path: `src/composables/useUserStore.ts`, `src/composables/useUserStore.websocket.test.ts`
- Navigation persistence path: `src/composables/useNavigationStatePersistence.ts`

Workers should repair these existing seams instead of adding alternate state models or parallel UI logic.

## Expected Data Flow

### Returned-task consistency path
1. Reviewer returns a task to the designer.
2. Store normalization and filter helpers classify it with one canonical returned/resubmittable rule.
3. Designer task lists and detail surfaces render the same task semantics.
4. Designer resubmits the task.
5. UI clears stale returned-state markers and the reviewer inbox receives the same task identity again.

### Realtime and persistence path
1. Task events arrive via REST refresh or websocket payloads.
2. Payload fields normalize before list filtering or ownership checks.
3. Designer/reviewer/resubmission surfaces converge to the same task truth.
4. Each list restores only its own persisted search/filter/scroll state after navigation.

## Highest-Risk Seams

- Returned-task semantics currently risk diverging between `useUserStore` and `reviewTaskFilters`.
- Detail modal and resubmit action boundaries can drift, producing stale or contradictory UI.
- Websocket payloads may arrive in shapes that differ from REST-normalized task objects.
- Persistence behavior can appear implemented in one surface while lacking matching evidence or isolation in another.
