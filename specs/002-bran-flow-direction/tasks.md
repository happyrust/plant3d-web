# Tasks: BRAN Pipe Flow Direction

**Input**: Design documents from `/specs/002-bran-flow-direction/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks are included because the feature spec and quickstart explicitly require BRAN fixture, panel, type-check, and visual validation coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other tasks in the same phase or story because it touches different files and has no dependency on unfinished work.
- **[Story]**: Maps to the user story in `spec.md`.
- Every task includes exact file paths.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm current MBD implementation points and prepare the existing test surfaces.

- [x] T001 Review current MBD pipe rendering, visibility, cleanup, and return type patterns in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T002 [P] Review existing BRAN fixture expectations in `src/fixtures/bran-test-data.test.ts`
- [x] T003 [P] Review existing MBD panel mock shape and checkbox patterns in `src/components/tools/MbdPipePanel.mode.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the shared flow direction state, object model, materials, and lifecycle support that every user story depends on.

**CRITICAL**: No user story implementation should start until this phase is complete.

- [x] T004 Add `showFlowDirection: Ref<boolean>` and a flow object accessor to `UseMbdPipeAnnotationThreeReturn` in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T005 Define the internal flow direction object shape and object collection keyed by segment id in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T006 Add reusable flow centerline and arrow materials with readable cyan/blue and orange styling in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T007 Add helper logic to validate segment `arrive`/`leave`, compute normalized direction, length, and bounded arrow sizing in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T008 Integrate flow object geometry cleanup into `clearAll()` and flow material disposal into `dispose()` in `src/composables/useMbdPipeAnnotationThree.ts`

**Checkpoint**: Composable has the state and lifecycle primitives required by all stories, but the overlay may not yet be user-visible.

---

## Phase 3: User Story 1 - Toggle Flow Direction Overlay (Priority: P1)

**Goal**: Users can toggle the flow direction overlay from both MBD control locations, with default hidden session-only behavior.

**Independent Test**: Open/render BRAN annotation data, verify `showFlowDirection` defaults to false, toggle from panel or ribbon, and verify visibility changes without a page/model reload.

### Tests for User Story 1

- [x] T009 [P] [US1] Add BRAN fixture test for default `showFlowDirection=false` and hidden flow objects in `src/fixtures/bran-test-data.test.ts`
- [x] T010 [P] [US1] Add MBD panel test for the `流向` checkbox reading and toggling `vis.showFlowDirection.value` in `src/components/tools/MbdPipePanel.mode.test.ts`
- [x] T011 [P] [US1] Add ribbon config test for `mbd.flow_direction` button id, command id, label, and icon in `src/ribbon/ribbonConfig.mbd.test.ts`

### Implementation for User Story 1

- [x] T012 [US1] Add `showFlowDirection` to the returned composable object in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T013 [US1] Include `showFlowDirection` in the existing visibility watcher and apply `isVisible.value && showFlowDirection.value` in `applyVisibility()` in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T014 [US1] Add the `流向` checkbox to the existing display checkbox grid in `src/components/tools/MbdPipePanel.vue`
- [x] T015 [US1] Add `mbd.flow_direction` to the MBD display controls in `src/ribbon/ribbonConfig.ts`
- [x] T016 [US1] Handle `mbd.flow_direction` in `handleRibbonCommand()` by toggling `mbdPipeVisRef.value.showFlowDirection.value` and calling `requestRender()` in `src/components/dock_panels/ViewerPanel.vue`

**Checkpoint**: MVP complete. Flow direction can be toggled from the panel and ribbon, defaults hidden, and respects overall MBD visibility.

---

## Phase 4: User Story 2 - Read Segment Flow Direction (Priority: P1)

**Goal**: Valid BRAN segments render centerlines and direction arrows from `arrive` to `leave`.

**Independent Test**: Render the representative BRAN fixture, enable flow direction, and verify sample segment arrows point +X and +Y as expected.

### Tests for User Story 2

- [x] T017 [P] [US2] Add BRAN fixture test that each valid segment creates a flow centerline and at least one arrow in `src/fixtures/bran-test-data.test.ts`
- [x] T018 [P] [US2] Add BRAN fixture test for `seg_t1` arrow direction along +X and `seg_t2` arrow direction along +Y in `src/fixtures/bran-test-data.test.ts`
- [x] T019 [P] [US2] Add BRAN fixture test that invalid or directionless segment data is skipped without blocking valid segment rendering in `src/fixtures/bran-test-data.test.ts`

### Implementation for User Story 2

- [x] T020 [US2] Implement `renderFlowDirections()` to create one centerline per valid segment in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T021 [US2] Implement arrow generation with at least one arrow on valid short segments and capped repeated arrows on longer segments in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T022 [US2] Call `renderFlowDirections(data.segments)` during `renderBranch()` after segment data is available in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T023 [US2] Ensure flow objects are added to the existing MBD annotation group so the global model matrix applies in `src/composables/useMbdPipeAnnotationThree.ts`

**Checkpoint**: Flow geometry accurately communicates `arrive -> leave` for valid segments.

---

## Phase 5: User Story 3 - Keep Flow Direction Usable With Other MBD Visibility Controls (Priority: P2)

**Goal**: Flow direction visibility stays predictable with overall MBD visibility and remains independent from labels and segment skeleton controls.

**Independent Test**: Toggle `isVisible`, `showFlowDirection`, `showLabels`, and `showSegments` in different orders and verify only `isVisible && showFlowDirection` controls flow visibility.

### Tests for User Story 3

- [x] T024 [P] [US3] Add BRAN fixture test for `isVisible=false` hiding flow direction while `showFlowDirection=true` in `src/fixtures/bran-test-data.test.ts`
- [x] T025 [P] [US3] Add BRAN fixture test proving `showLabels` and `showSegments` changes do not rewrite flow visibility state in `src/fixtures/bran-test-data.test.ts`
- [x] T026 [P] [US3] Add BRAN fixture test that `clearAll()` empties the flow direction object collection in `src/fixtures/bran-test-data.test.ts`

### Implementation for User Story 3

- [x] T027 [US3] Ensure `applyVisibility()` updates centerline and arrow visibility together in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T028 [US3] Ensure `clearAll()` removes all flow objects from the group and clears the flow object map in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T029 [US3] Ensure flow direction state is not reset by `applyModeDefaults()` unless explicitly required by current session lifecycle in `src/composables/useMbdPipeAnnotationThree.ts`

**Checkpoint**: Flow direction behaves as a first-class MBD display state and is independent from labels and segment skeleton visibility.

---

## Phase 6: User Story 4 - Use Readable Visual Styling (Priority: P2)

**Goal**: Flow direction is visually distinct, readable near pipe geometry, and does not add labels.

**Independent Test**: Enable flow direction on representative BRAN data and verify centerline/arrow colors, weak occlusion, arrow bounds, and absence of labels.

### Tests for User Story 4

- [x] T030 [P] [US4] Add BRAN fixture test or object inspection for flow centerline and arrow material colors/depth settings in `src/fixtures/bran-test-data.test.ts`
- [x] T031 [P] [US4] Add BRAN fixture test that flow direction creates no label annotations and is unaffected by label visibility in `src/fixtures/bran-test-data.test.ts`

### Implementation for User Story 4

- [x] T032 [US4] Tune flow centerline material opacity, render order, and depth behavior for readable pipe-internal display in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T033 [US4] Tune arrow material, arrow length bounds, and spacing caps to avoid oversized short-segment arrows or over-dense long-segment arrows in `src/composables/useMbdPipeAnnotationThree.ts`
- [x] T034 [US4] Verify flow arrow objects remain geometry-only and do not register with MBD label visibility or label annotation collections in `src/composables/useMbdPipeAnnotationThree.ts`

**Checkpoint**: Overlay is readable and visually distinct without adding text clutter.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup across all stories.

- [x] T035 Run targeted BRAN fixture tests with `npx vitest run src/fixtures/bran-test-data.test.ts`
- [x] T036 Run MBD panel tests with `npx vitest run src/components/tools/MbdPipePanel.mode.test.ts`
- [x] T037 Run type checking with `npm run type-check`
- [x] T038 Manually validate the MBD demo flow direction controls using `specs/002-bran-flow-direction/quickstart.md`
- [x] T039 [P] Record manual validation notes or screenshot references after implementation in `specs/002-bran-flow-direction/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on setup review and blocks all user stories.
- **US1 (Phase 3)**: Depends on foundational state/lifecycle tasks. MVP scope.
- **US2 (Phase 4)**: Depends on foundational helpers and can begin after core flow object shape exists; full value depends on US1 for user toggles.
- **US3 (Phase 5)**: Depends on US1 visibility state and US2 flow objects.
- **US4 (Phase 6)**: Depends on US2 rendered objects and can be tuned in parallel with late US3 tests once core objects exist.
- **Polish (Phase 7)**: Depends on all selected user stories.

### User Story Dependencies

- **User Story 1 (P1)**: MVP. Provides default hidden state and user toggles.
- **User Story 2 (P1)**: Adds accurate rendered geometry. Can be implemented after foundational object shape and before/alongside UI integration if needed.
- **User Story 3 (P2)**: Requires US1/US2 behavior to verify visibility interactions.
- **User Story 4 (P2)**: Requires US2 geometry to verify visual styling.

### Within Each User Story

- Add or update tests before implementation where feasible.
- Implement composable state/rendering before UI controls that depend on the new returned property.
- Complete story-specific validation before moving to lower-priority stories.

### Parallel Opportunities

- T002 and T003 can run in parallel after T001 starts.
- T009, T010, and T011 can run in parallel because they target different files.
- T017, T018, and T019 can run in parallel once the test accessor shape is known.
- T024, T025, and T026 can run in parallel after US1/US2 behavior exists.
- T030 and T031 can run in parallel after flow objects expose inspectable material/object data.
- T039 can run in parallel with final command validation once manual findings are available.

---

## Parallel Example: User Story 1

```bash
# Parallel test authoring after foundational return shape is defined:
Task: "Add BRAN fixture test for default showFlowDirection=false in src/fixtures/bran-test-data.test.ts"
Task: "Add MBD panel test for 流向 checkbox in src/components/tools/MbdPipePanel.mode.test.ts"

# Then implement UI/control integration:
Task: "Add 流向 checkbox in src/components/tools/MbdPipePanel.vue"
Task: "Add mbd.flow_direction button in src/ribbon/ribbonConfig.ts"
Task: "Handle mbd.flow_direction in src/components/dock_panels/ViewerPanel.vue"
```

## Parallel Example: User Story 2

```bash
# Parallel renderer tests once flow object contract is chosen:
Task: "Add valid segment centerline/arrow count test in src/fixtures/bran-test-data.test.ts"
Task: "Add +X/+Y direction test in src/fixtures/bran-test-data.test.ts"
Task: "Add invalid segment skipping test in src/fixtures/bran-test-data.test.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 And 2)

1. Complete Phase 1 setup review.
2. Complete Phase 2 foundational composable state and lifecycle work.
3. Complete Phase 3 US1 toggle controls and default hidden behavior.
4. Complete Phase 4 US2 segment centerline and arrow rendering.
5. Stop and validate the usable MVP through fixture, panel, and ribbon tests.

### Incremental Delivery

1. Add global state/lifecycle foundation.
2. Add user toggles and default hidden behavior.
3. Add accurate segment centerline and arrow rendering.
4. Add visibility interaction hardening.
5. Tune visual readability.
6. Run quickstart validation.

### Notes

- Keep edits scoped to MBD flow direction files listed in `plan.md`.
- Do not persist `showFlowDirection`.
- Do not infer BRAN topology; use only segment `arrive -> leave`.
- Do not couple flow direction to text label visibility.
- Do not change backend or generated model data contracts.
