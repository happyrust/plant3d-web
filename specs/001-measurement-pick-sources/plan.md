# Implementation Plan: Measurement Pick Sources

**Branch**: `001-measurement-pick-sources` | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-measurement-pick-sources/spec.md`

## Summary

Add selectable measurement pick sources for Mesh Pick Point, PTSET, Position, and Primitive Key Point. The implementation should replace the current ptset-only pick flow with a source resolver that owns source settings, candidate display, snap priority, hover prefetch, and user-facing miss reasons. PTSET remains enabled by default to preserve current behavior. The MVP includes the source settings UI, the resolver, PTSET source behavior, and opt-in Mesh Pick Point fallback. Position can be delivered next in the frontend. Primitive Key Point requires a generated data contract, including local coordinate unit metadata, before full snap/display support.

## Technical Context

**Language/Version**: TypeScript with Vue 3 in `plant3d-web`; Rust in sibling `plant-model-gen` only for the Primitive Key Point export contract.

**Primary Dependencies**: Vue 3 composition API, Three.js, xeokit/DTX viewer integration, DuckDB/Parquet model package loader, existing measurement store/composables.

**Storage**: Browser `localStorage` for measurement style/source preferences; existing viewer store persistence for measurement records; generated model package Parquet files for model point data.

**Testing**: Manual quickstart validation with real model package data; `npm run type-check`; targeted existing Vitest files only if implementation changes require it.

**Target Platform**: Browser-based Plant3D viewer.

**Project Type**: Frontend web application with an optional sibling backend data-export dependency.

**Performance Goals**: Hover source resolution should remain interactive at viewer frame rate. Candidate generation must be scoped to hovered/nearby refnos and cached; it must not load all primitive or PTSET points for a whole model on every pointer move.

**Constraints**: Preserve ptset default behavior; do not revert unrelated dirty worktree changes; keep old measurement records readable; define Primitive Key Point data and unit contract before frontend assumes availability.

**Scale/Scope**: Measurement panel, xeokit measurement pointer flow, point-source candidate visualization, source settings persistence, and optional generated primitive key point package data.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Domain Contract First**: Pass. Primitive Key Point is planned through an explicit generated-data contract.
- **Preserve Existing Measurement Behavior**: Pass. PTSET remains default visible and snappable; Mesh Pick Point fallback is opt-in.
- **Source Separation**: Pass. The plan introduces a shared measurement pick source resolver instead of adding more branches to `pickSurfacePoint()`.
- **Compatibility And Traceability**: Pass. New point source metadata is optional; old records remain valid.
- **Real Data Validation**: Pass. `quickstart.md` requires real viewer validation and names observable behaviors.

## Project Structure

### Documentation (this feature)

```text
specs/001-measurement-pick-sources/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── measurement-pick-source-contract.md
│   └── primitive-keypoints-parquet-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── components/tools/
│   └── MeasurementPanel.vue
├── composables/
│   ├── useXeokitMeasurementTools.ts
│   ├── useXeokitMeasurementStyleStore.ts
│   ├── useToolStore.ts
│   ├── usePtsetSnap.ts
│   ├── usePtsetVisualizationThree.ts
│   ├── useDbnoInstancesParquetLoader.ts
│   └── useMeasurementPickSources.ts
├── utils/
│   ├── xeokitMeasurementFormat.ts
│   └── three/
│       ├── ptsetTransform.ts
│       └── measurementPickTransforms.ts
```

```text
../plant-model-gen/
└── src/fast_model/export_model/export_dbnum_instances_parquet.rs
```

**Structure Decision**: Keep the feature in existing frontend composables and measurement UI. Add a new `useMeasurementPickSources.ts` abstraction only because it separates real source logic from `useXeokitMeasurementTools.ts`. Primitive Key Point export is documented as a sibling backend contract and should be implemented only when that phase is selected.

## Phase Plan

### Phase 0: Research

Research resolved the source definitions and defaults:

- Position is the instance placement/origin point.
- Mesh Pick Point is the transient viewer ray-pick surface point.
- PTSET remains the existing parquet/API point set and current default measurement source.
- Primitive Key Point is generated primitive geometry key point data transformed into scene coordinates.
- Snap resolution uses source priority first, then screen-space distance within a source.

### Phase 1: Design And Contracts

Design artifacts:

- [research.md](./research.md)
- [data-model.md](./data-model.md)
- [measurement-pick-source-contract.md](./contracts/measurement-pick-source-contract.md)
- [primitive-keypoints-parquet-contract.md](./contracts/primitive-keypoints-parquet-contract.md)
- [quickstart.md](./quickstart.md)

### Phase 2: Task Generation

Tasks are grouped by user story in [tasks.md](./tasks.md). MVP scope is User Story 1, including the foundational resolver, PTSET source migration, and opt-in Mesh Pick Point source.

## Complexity Tracking

No constitution violations are required for the MVP. The only planned cross-repository work is Primitive Key Point export, justified because frontend display/snap cannot be correct without a generated model data contract.
