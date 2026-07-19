# Frozen Dimension Fixtures

These JSON files are non-executable evidence captured before ADR-0038 removal.
They must not import or invoke the legacy dimension implementation.

## Baseline

Captured on 2026-07-19 before creating these fixtures.

- `npm run type-check`: PASS (exit code 0). `vue-tsc --noEmit --pretty false` reported no diagnostics.
- `npm run build`: PASS (exit code 0). Vite transformed 2,711 modules and completed the production build in 11.81 s. Existing warnings reported outdated Browserslist data, three modules that are both statically and dynamically imported, and chunks larger than 500 kB.
- `npm test`: FAIL (exit code 1).
  - Test files: 21 failed, 170 passed, 191 total.
  - Tests: 87 failed, 1,410 passed, 1,497 total.
  - Vitest duration: 13.31 s.

Failed test files and failing-test counts:

- `src/utils/versionInfo.test.ts`: 1.
- `src/debug/pmsSimulatorAutomation.test.ts`: 1.
- `src/types/auth.severity.test.ts`: 5.
- `src/utils/duckdbBundles.test.ts`: 1.
- `src/composables/useScreenshot.test.ts`: 3.
- `src/composables/useUserStore.pendingReviewTasks.test.ts`: 1.
- `src/composables/useUserStore.createReviewTask.test.ts`: 3.
- `src/api/genModelE3dParquetApi.test.ts`: 2.
- `src/composables/useDbnoInstancesParquetLoader.test.ts`: 19.
- `src/components/review/reviewerTaskListActions.test.ts`: 1.
- `src/components/review/ReviewConfirmation.test.ts`: 1.
- `src/composables/useToolStore.clearMeasurementResults.test.ts`: 1.
- `src/composables/useToolStore.unifiedMeasurements.test.ts`: 5.
- `src/composables/useToolStore.screenshot.test.ts`: 1.
- `src/composables/useToolStore.severity.test.ts`: 2.
- `src/composables/useReviewStore.confirm.test.ts`: 1.
- `src/components/DockLayout.test.ts`: 2.
- `src/components/review/TaskReviewDetail.test.ts`: 3.
- `src/components/review/InitiateReviewPanel.minDeliveryUnit.test.ts`: 1.
- `src/components/review/DesignerCommentHandlingPanel.test.ts`: 17.
- `src/components/review/ReviewPanel.test.ts`: 16.

The only failing assertion whose suite or test name explicitly concerns legacy dimension behavior is `useToolStore.clearMeasurementResults.test.ts`; it fails because `store.clearMeasurementResults` is not a function. The other 86 failures are outside the dedicated dimension layout and renderer suites. The run reported all 10 dimension-named suites passing (101 tests), including the V5 store migration, 3D linear/angle/radius renderers, classic linear/aligned/angle measurements, the pipe-clearance scenario, and offset-direction helpers.

This is a deliberately red repository baseline. Task 1 does not repair or reinterpret any failure.

## Gate 1 Verification

Captured after the legacy runtime and final V6 tool-store state were removed:

- `npm run type-check`: PASS.
- `npm run build-only`: PASS with the same existing chunk/import warnings.
- Targeted archive, replay, measurement, annotation, and removal-guard suites: PASS.
- Full `npm test`: 23 failed files / 90 failed tests, 164 passed files / 1,372 passed tests.

Compared with the earlier snapshot, the full run includes three additional, dimension-independent failures already present in unchanged HEAD files: one dashboard background-token assertion, two spatial-query design-token assertions, and one file-upload design-token assertion (three files, four assertions; the earlier failing-file list and current Vitest aggregation differ by concurrent suite selection/order). No failing test imports the removed runtime or concerns the V5/V6 archive, and all dedicated Gate 1 tests pass. These unrelated design-token assertions were not modified as part of the dimension rebuild.

## Provenance

- Legacy schema: `useToolStore` V5.
- Layout semantics: SolveSpace revision `9aeb715efd8c274851af0fdad5b275dde1198bf5`.
- Accepted decisions: `CONTEXT.md`, `docs/adr/0001`–`0040`.
- The layout golden is a data-only transcription of a confirmed legacy layout-first geometry assertion. It is historical evidence, not an executable compatibility harness.

## Cases

- `v5-samples/valid-linear.json`: V5 linear record with both `worldPos` and trusted `designWorldPos`.
- `v5-samples/unresolvable-worldpos.json`: V5 world-only record that must migrate invalid; its `textOverride` is preserved only as raw migration evidence.
- `canonical/linear.json`: aligned two-anchor case with a derived value of 1 m.
- `canonical/projected.json`: stable Design Space X-axis projection whose signed projection is negative but displayed length is 1 m.
- `canonical/angular.json`: one right-angle geometry with minor 90° and major 270° variants.
- `canonical/radial.json`: one circle geometry with radius and diameter display variants.
- `goldens/layout/legacy-linear.json`: structural legacy line and label-anchor expectations.
- `interactions/create-linear.json`: semantic create-linear action sequence without browser event objects.

## Fixture Rules

- Every JSON file is inert data. No fixture imports, invokes, or bundles an implementation module.
- Canonical coordinates are Design Space metres. Expected length values are metres and expected angle values are radians.
- Expected values are derived assertions, not persisted user-entered labels. Display units and precision remain viewport preferences.
- Projected values are absolute lengths along a stable design or semantic axis.
- Angular and radial variants intentionally reuse one anchor geometry so arc and display choices remain explicit.
- A V5 `worldPos` is never treated as Design Space when `designWorldPos` is absent.
- Frozen files are edited only through an explicit fixture-review change; ordinary test runs must never rewrite them.
