# Implementation Plan: BRAN Pipe Flow Direction

**Branch**: `002-bran-flow-direction` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-bran-flow-direction/spec.md`

## Summary

Add a session-scoped MBD BRAN pipe flow direction overlay that is hidden by default and can be toggled from both the MBD ribbon display controls and the MBD pipe annotation panel. The implementation will extend the existing MBD pipe annotation composable with a `showFlowDirection` visibility state, render flow centerlines and arrow markers from each valid segment's `arrive -> leave` coordinates inside the existing MBD annotation group, and reuse the current visibility, global model matrix, cleanup, and test fixture patterns.

## Technical Context

**Language/Version**: TypeScript with Vue 3 Composition API in a Vite web application

**Primary Dependencies**: Vue refs/watchers, Three.js scene objects/materials/geometries, existing MBD pipe DTOs and annotation composable patterns

**Storage**: N/A. Flow direction visibility is session-only and must not be persisted.

**Testing**: Vitest with happy-dom plus existing BRAN fixture tests under `src/fixtures/bran-test-data.test.ts`; type validation with `npm run type-check`

**Target Platform**: Browser-based 3D viewer

**Project Type**: Frontend web application

**Performance Goals**: Flow overlay generation should be linear in the number of BRAN segments and should not require model reloads when toggled.

**Constraints**: Preserve default BRAN annotation visuals; skip invalid segment coordinates; keep overlay scoped to MBD BRAN pipe annotations; avoid changes to backend contracts or source model data.

**Scale/Scope**: Current loaded BRAN pipe annotation data, including representative fixtures with multiple segments and real generated packages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Domain Contract First**: PASS. The spec fixes the flow contract to segment `arrive -> leave` and avoids topology inference or backend field changes.
- **Preserve Existing Measurement Behavior**: PASS. This feature is scoped to MBD BRAN annotation display and does not alter measurement pick sources or saved measurement records.
- **Source Separation**: PASS. Not applicable to measurement pick sources; the plan keeps this overlay as an independent MBD display state rather than mixing it with label visibility or segment skeleton visibility.
- **Compatibility And Traceability**: PASS. The overlay is session-only and does not alter persisted model, DTX, or measurement data.
- **Real Data Validation**: PASS. Validation uses the existing representative BRAN fixture and should include manual viewer validation against an MBD demo or generated package after implementation.

No constitution violations are expected.

## Project Structure

### Documentation (this feature)

```text
specs/002-bran-flow-direction/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── flow-direction-ui-renderer-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Created by /speckit-tasks, not by this plan
```

### Source Code (repository root)

```text
src/
├── composables/
│   ├── useMbdPipeAnnotationThree.ts
│   └── useMbdPipeAnnotationThree.flyTo.test.ts
├── components/
│   ├── dock_panels/
│   │   └── ViewerPanel.vue
│   └── tools/
│       ├── MbdPipePanel.vue
│       └── MbdPipePanel.mode.test.ts
├── fixtures/
│   ├── bran-test-data.json
│   └── bran-test-data.test.ts
└── ribbon/
    └── ribbonConfig.ts
```

**Structure Decision**: Keep the feature inside the existing frontend MBD annotation surface. The composable owns rendering and visibility state, the panel and ribbon expose user controls, and fixture tests verify rendering behavior with representative BRAN data.

## Phase 0: Research

Research output is captured in [research.md](./research.md). All unknowns are resolved:

- Flow semantics: use segment `arrive -> leave`.
- Visibility scope: session-only global overlay controlled by `isVisible && showFlowDirection`.
- Visual strategy: readable semi-transparent centerlines and orange arrows, independent from text/label controls.
- Validation strategy: extend existing BRAN fixture and MBD panel/ribbon tests.

## Phase 1: Design & Contracts

Design output:

- [data-model.md](./data-model.md) defines flow segment validity, overlay object ownership, and state transitions.
- [contracts/flow-direction-ui-renderer-contract.md](./contracts/flow-direction-ui-renderer-contract.md) defines the UI and renderer contract expected by implementation and tests.
- [quickstart.md](./quickstart.md) defines targeted verification steps.

## Implementation Approach

1. Extend `UseMbdPipeAnnotationThreeReturn` with `showFlowDirection` and a test/debug accessor for flow overlay objects.
2. Add flow overlay materials and object collections in `useMbdPipeAnnotationThree.ts`.
3. Render flow centerlines and arrows after segment data is loaded, using local BRAN coordinates so the existing annotation group global matrix applies uniformly.
4. Apply visibility through the existing watcher and `applyVisibility()` path with `isVisible && showFlowDirection`.
5. Clean overlay geometries in `clearAll()` and dispose new materials in `dispose()`.
6. Add the MBD pipe panel checkbox and the ribbon command/button.
7. Extend tests for default hidden state, toggle visibility, arrow direction, invalid segment skipping, and cleanup.

## Post-Design Constitution Check

- **Domain Contract First**: PASS. The contract artifact documents the exact `arrive -> leave` source and invalid segment behavior.
- **Preserve Existing Measurement Behavior**: PASS. No measurement paths are in scope.
- **Source Separation**: PASS. Flow direction has its own visibility state and is not tied to labels or existing skeleton segment controls.
- **Compatibility And Traceability**: PASS. No persisted data changes.
- **Real Data Validation**: PASS. Quickstart names the fixture test and manual MBD demo validation path.

## Complexity Tracking

No constitution violations or additional complexity exceptions.
