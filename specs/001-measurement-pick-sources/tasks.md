# Tasks: Measurement Pick Sources

**Input**: Design documents from `specs/001-measurement-pick-sources/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: New one-off tests are not required by the spec. Use manual quickstart validation and existing type/lint checks unless implementation risk requires targeted existing Vitest coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the feature context and protect existing behavior before implementation.

- [x] T001 Review `specs/001-measurement-pick-sources/spec.md`, `specs/001-measurement-pick-sources/plan.md`, and `specs/001-measurement-pick-sources/contracts/measurement-pick-source-contract.md` before code changes.
- [x] T002 Inspect existing measurement entry points in `src/composables/useXeokitMeasurementTools.ts`, `src/components/tools/MeasurementPanel.vue`, and `src/composables/useXeokitMeasurementStyleStore.ts` and record any conflicting dirty user changes before editing.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared domain, settings, and resolver skeleton that every user story depends on.

- [x] T003 [P] Create measurement source domain types and default source settings in `src/composables/useMeasurementPickSources.ts`.
- [x] T004 Extend measurement style persistence and legacy migration in `src/composables/useXeokitMeasurementStyleStore.ts`, mapping old `keypointSnapEnabled=false` to `ptset.show=false` and `ptset.snap=false`.
- [x] T005 Add resolver skeleton, display filtering, snap filtering, candidate projection, priority sorting, and miss-reason output in `src/composables/useMeasurementPickSources.ts`.
- [x] T006 [P] Extend source-aware overlay palette or labels in `src/composables/xeokitMeasurementUi.ts`.

**Checkpoint**: Source settings and resolver core can exist without changing measurement behavior.

---

## Phase 3: User Story 1 - Choose Visible And Snappable Point Sources (Priority: P1) MVP

**Goal**: Users can control source display/snap state and can measure with default PTSET or opt-in Mesh Pick Point fallback.

**Independent Test**: Toggle source display/snap checkboxes, confirm default PTSET measurement still works, then disable PTSET snap and enable Mesh Pick Point snap to create a surface-based measurement point.

- [x] T007 [US1] Replace the single PTSET snap setting with a source display/snap checkbox matrix in `src/components/tools/MeasurementPanel.vue`.
- [x] T008 [US1] Expose current PTSET hover rendering, async fetch, cache, and candidates to the unified resolver in `src/composables/useXeokitMeasurementTools.ts`.
- [x] T009 [P] [US1] Implement Mesh Pick Point as a transient source using existing surface pick data in `src/composables/useMeasurementPickSources.ts`.
- [x] T010 [US1] Refactor `pickSurfacePoint()` in `src/composables/useXeokitMeasurementTools.ts` to consume the unified resolver for PTSET and Mesh Pick Point.
- [x] T011 [US1] Update measurement mode status and pointer lens text for enabled source combinations in `src/composables/useXeokitMeasurementTools.ts`.
- [ ] T012 [US1] Validate default PTSET behavior and opt-in Mesh Pick Point fallback using `specs/001-measurement-pick-sources/quickstart.md`.

**Checkpoint**: The MVP is independently usable: PTSET remains default, Mesh Pick Point is opt-in, and source checkboxes affect both display and snap.

---

## Phase 4: User Story 2 - Resolve Multiple Candidate Sources Deterministically (Priority: P2)

**Goal**: A unified resolver selects candidates consistently when multiple enabled sources are near the cursor.

**Independent Test**: Enable multiple snap sources and confirm repeated clicks at the same cursor location select the same source and candidate.

- [x] T013 [US2] Add stable tie-break behavior for same-priority and same-distance candidates in `src/composables/useMeasurementPickSources.ts`.
- [x] T014 [US2] Add source-priority diagnostics to pointer lens or debug output in `src/composables/useXeokitMeasurementTools.ts`.
- [ ] T015 [US2] Validate repeated-click priority behavior with at least two enabled sources using `specs/001-measurement-pick-sources/quickstart.md`.

**Checkpoint**: Multi-source conflicts resolve by source priority, then screen distance, then stable candidate ID.

---

## Phase 5: User Story 3 - Position Source (Priority: P3)

**Goal**: Users can display and snap to instance position/origin points.

**Independent Test**: Enable Position display/snap and verify a hovered instance shows one position marker that can be selected.

- [x] T016 [US3] Implement Position candidate generation from refno/object transform data in `src/composables/useMeasurementPickSources.ts`.
- [x] T017 [P] [US3] Add reusable non-PTSET candidate marker rendering in `src/composables/useXeokitMeasurementTools.ts`.
- [x] T018 [US3] Wire Position display and snap settings into the resolver flow in `src/composables/useXeokitMeasurementTools.ts`.

**Checkpoint**: Position source works without primitive key point package data.

---

## Phase 6: Backend Dependency - Primitive Key Point Export Contract

**Goal**: Produce a model package data contract that the frontend can consume without guessing primitive key point coordinates or units.

**Independent Test**: Export a package that contains `primitive_keypoints.parquet`, a manifest entry, and `primitive_keypoint_unit` metadata, then inspect the package data before frontend integration.

- [x] T019 [US3] Add primitive key point Parquet schema and export rows in `../plant-model-gen/src/fast_model/export_model/export_dbnum_instances_parquet.rs`.
- [x] T020 [US3] Add model manifest entry and `primitive_keypoint_unit` metadata for `primitive_keypoints.parquet` in `../plant-model-gen/src/fast_model/export_model/export_dbnum_instances_parquet.rs`.
- [x] T021 [US3] Validate exported primitive key point rows and unit metadata with the backend repository's CLI/json verification workflow.

**Checkpoint**: Primitive Key Point frontend work has a verified generated package contract.

---

## Phase 7: User Story 3 - Primitive Key Point Source (Priority: P3)

**Goal**: Users can display and snap to generated primitive geometry key points when the model package provides them.

**Independent Test**: Load a package with primitive key point data, enable the source, and verify markers and snap work for all xeokit measurement modes.

- [x] T022 [US3] Add primitive key point manifest typing and DuckDB query support in `src/composables/useDbnoInstancesParquetLoader.ts`.
- [x] T023 [US3] Implement Primitive Key Point candidate loading, unit conversion, and transform composition in `src/composables/useDbnoInstancesParquetLoader.ts` and `src/composables/useXeokitMeasurementTools.ts`.
- [x] T024 [US3] Render Primitive Key Point markers through the existing non-PTSET hover candidate marker layer in `src/composables/useXeokitMeasurementTools.ts`.
- [x] T025 [US3] Validate unavailable-state behavior when primitive key point data or unit metadata is missing.

**Checkpoint**: Primitive Key Point source is fully data-driven and unavailable states are clear.

---

## Phase 8: User Story 4 - Preserve And Explain Measurement Records (Priority: P3)

**Goal**: New records carry source metadata and old records remain compatible.

**Independent Test**: Load old measurement records and create new records from multiple sources; verify both render and format.

- [x] T026 [US4] Extend optional measurement point source metadata in `src/composables/useToolStore.ts` without breaking old records.
- [x] T027 [US4] Store optional source metadata on new measurement points in `src/composables/useXeokitMeasurementTools.ts`.
- [x] T028 [US4] Normalize old and new measurement records in `src/composables/useToolStore.ts`.
- [x] T029 [US4] Include source labels where appropriate in `src/utils/xeokitMeasurementFormat.ts`.

**Checkpoint**: Measurement records are traceable without requiring migration of old data.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup.

- [x] T030 Run `npm run type-check` from the `plant3d-web` repository root.
- [ ] T031 Run `npm run lint` from the `plant3d-web` repository root if implementation touched linted source files. Blocked: `eslint.config.js` imports missing package `@eslint/js`.
- [ ] T032 Complete the manual scenarios in `specs/001-measurement-pick-sources/quickstart.md` and record results in the implementation handoff.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup completion and blocks all user stories.
- **US1 Controls + PTSET/Mesh Resolver (Phase 3)**: Depends on Foundational and is the MVP.
- **US2 Deterministic Conflict Resolution (Phase 4)**: Depends on US1 resolver.
- **US3 Position (Phase 5)**: Depends on US1 resolver.
- **Backend Primitive Export (Phase 6)**: Depends on accepted primitive data/unit contract and can be handled as a backend milestone.
- **US3 Primitive Source (Phase 7)**: Depends on US1 resolver and Phase 6 package data.
- **US4 Records (Phase 8)**: Depends on stable resolver output shape.
- **Polish (Phase 9)**: Depends on the selected implementation scope.

### User Story Dependencies

- **User Story 1 (P1)**: MVP; complete with PTSET behavior preserved and Mesh Pick Point fallback opt-in.
- **User Story 2 (P2)**: Builds on the MVP resolver and hardens multi-source conflict behavior.
- **User Story 3 (P3)**: Position can be delivered before Primitive Key Point; Primitive depends on generated package data and unit metadata.
- **User Story 4 (P3)**: Can be implemented after resolver returns source metadata.

### Parallel Opportunities

- T003 and T006 can run in parallel.
- T008 and T009 can run in parallel after T005 defines the resolver contract.
- T016 and T017 can run in parallel.
- T019 and T022 should not be treated as one implementation unit; T022 starts only after T019-T021 produce verified package data.

## Parallel Example

```text
Task: T008 Wrap current PTSET snap/cache behavior in src/composables/useMeasurementPickSources.ts
Task: T009 Implement Mesh Pick Point source in src/composables/useMeasurementPickSources.ts
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 so the source checkbox UI, PTSET source, Mesh Pick Point source, and resolver integration all work together.
3. Stop and validate the quickstart default PTSET and Mesh Pick Point scenarios.

### Incremental Delivery

1. Add deterministic conflict diagnostics and tie-break validation.
2. Add Position source after the resolver is stable.
3. Add Primitive Key Point only after the package data and unit contract are verified.
4. Add record source metadata after candidate source IDs are stable.

### Avoid

- Do not make Mesh Pick Point fallback default-on.
- Do not derive primitive semantic points from raw mesh vertices.
- Do not require old measurement records to migrate before rendering.
- Do not load all model point candidates on every pointer move.
